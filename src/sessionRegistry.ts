import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AgentStatus, AgentVM, SessionIndex } from "./worktreeData";
import { systemProbes } from "./liveness";
// The VS Code-free path key, so this module stays requirable (and unit-testable)
// outside the extension host, exactly like sessionStore.
import { normalizePath as normalize } from "./worktreeUtils";

/**
 * Claude Code's own session registry, as a source of agent status.
 *
 * Since v2.1.119 Claude writes one file per session at
 * `~/.claude/sessions/<pid>.json` and records what that session is doing in a
 * `status` field, updating it on every transition:
 *
 *   { "pid": 567, "sessionId": "...", "cwd": "/repo", "status": "busy",
 *     "startedAt": 1785193745550, "version": "2.1.220", "kind": "interactive",
 *     "name": "agent-worktrees-9f" }
 *
 * That is the same question the hook emitter answers by watching events go by,
 * except it comes from the process itself and costs nothing to read. Where the
 * two disagree the registry wins: a session resumed in another terminal, one
 * whose Notification we never saw, or one running a long shell command all look
 * wrong from the event stream and right here.
 *
 * The registry does not replace the hooks. It has no subagents, no skills and no
 * work summary, and `status` is absent on older versions (and, observed on
 * 2.1.220, on sessions whose `entrypoint` is not a local one). Everything it does
 * not know is left exactly as the hook state files described it.
 */

/** One live session as the registry describes it. */
export interface RegistrySession {
  sessionId: string;
  /** Pid of the Claude process; also the file's name. */
  pid: number;
  /** Working directory the session was started in. */
  cwd: string;
  /** `status` mapped onto the panel's three states, when Claude recorded one. */
  status?: AgentStatus;
  /** Claude's own explanation of a `waiting` status, when it gave one. */
  waitingFor?: string;
  /** Claude's session name, when it has derived one. */
  name?: string;
  /** Epoch ms the session started. */
  startedAt: number;
  /** Epoch ms the registry file was last written, i.e. the last transition. */
  lastActivity: number;
}

/**
 * Claude's raw statuses, mapped onto the three the panel shows. `shell` is a
 * local bash command rather than an LLM turn, but it is work in progress as far
 * as the user is concerned, so it reads as active. An unrecognized status maps
 * to nothing at all rather than a guess: a new one Claude adds should leave the
 * hook-derived state alone until it is mapped here.
 */
export function mapStatus(raw: unknown): AgentStatus | undefined {
  switch (raw) {
    case "busy":
    case "shell":
      return "active";
    case "waiting":
      return "waiting";
    case "idle":
      return "idle";
    default:
      return undefined;
  }
}

/** Where Claude keeps the registry. `CLAUDE_CONFIG_DIR` moves the whole config
 *  tree, the registry with it. */
export function registryDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir()
): string {
  const configured = env.CLAUDE_CONFIG_DIR;
  const base = configured && configured.trim() ? configured : path.join(home, ".claude");
  return path.join(base, "sessions");
}

/** Shape of the registry file, before anything is trusted. */
interface RawEntry {
  pid?: unknown;
  sessionId?: unknown;
  cwd?: unknown;
  status?: unknown;
  waitingFor?: unknown;
  name?: unknown;
  startedAt?: unknown;
  kind?: unknown;
}

/**
 * Every live session in the registry.
 *
 * Claude removes a session's file when it exits, but a killed process leaves one
 * behind, so each is confirmed against its own pid. Unlike the hook state files
 * — whose pid is the hook's parent, which is why the sweep in liveness.ts will
 * not trust a missing one on Windows — this pid is the Claude process itself, so
 * its absence is proof on every platform.
 */
export async function readRegistry(
  dir: string,
  isAlive: (pid: number) => boolean = systemProbes.isAlive
): Promise<RegistrySession[]> {
  const files = await fs.promises.readdir(dir).catch(() => [] as string[]);
  const out: RegistrySession[] = [];
  for (const fn of files) {
    if (!fn.endsWith(".json")) continue;
    const full = path.join(dir, fn);
    try {
      const [raw, stat] = await Promise.all([
        fs.promises.readFile(full, "utf8"),
        fs.promises.stat(full),
      ]);
      const m = JSON.parse(raw) as RawEntry;
      const sessionId = typeof m?.sessionId === "string" ? m.sessionId : "";
      const cwd = typeof m?.cwd === "string" ? m.cwd : "";
      // The file is named for the pid, so a missing field is recoverable.
      const pid =
        typeof m?.pid === "number" ? m.pid : Number.parseInt(path.basename(fn, ".json"), 10);
      if (!sessionId || !cwd || !Number.isInteger(pid)) continue;
      // Headless (`-p`) runs and other non-interactive kinds are not agents
      // anyone is watching a card for. An older file with no `kind` predates the
      // field and is kept.
      if (typeof m.kind === "string" && m.kind !== "interactive") continue;
      if (!isAlive(pid)) continue;
      out.push({
        sessionId,
        pid,
        cwd,
        ...(mapStatus(m.status) ? { status: mapStatus(m.status) } : {}),
        ...(typeof m.waitingFor === "string" && m.waitingFor
          ? { waitingFor: m.waitingFor }
          : {}),
        ...(typeof m.name === "string" && m.name ? { name: m.name } : {}),
        startedAt: typeof m.startedAt === "number" ? m.startedAt : stat.mtimeMs,
        lastActivity: stat.mtimeMs,
      });
    } catch {
      /* partial write or garbage — ignore this poll */
    }
  }
  return out;
}

/** The worktree card a session belongs to: the longest known path that contains
 *  its cwd. Longest wins so a session inside a nested worktree lands on that
 *  worktree's card rather than the repo root's. */
function placeIn(cwd: string, keys: string[]): string | undefined {
  const target = normalize(cwd);
  let best: string | undefined;
  for (const key of keys) {
    if (target !== key && !target.startsWith(key + path.sep)) continue;
    if (!best || key.length > best.length) best = key;
  }
  return best;
}

/** Default labels are positional, so they have to be reassigned whenever the
 *  membership of a worktree's list changes. An agent with a summary keeps it. */
function relabel(list: AgentVM[], index: SessionIndex): void {
  list.sort((a, b) => a.startedAt - b.startedAt);
  list.forEach((agent, i) => {
    if (agent.summary) return;
    const label = `Claude ${i + 1}`;
    if (agent.label === label) return;
    agent.label = label;
    // The subagents rendered on other cards carry their parent's label with
    // them; leaving it stale would name the wrong agent.
    for (const subs of index.subagents.values()) {
      for (const sub of subs) {
        if (sub.parentSessionId === agent.sessionId) sub.parentLabel = label;
      }
    }
  });
}

/**
 * Fold the registry into the index the hook state files produced.
 *
 * A session in both is the common case: it keeps everything the emitter knows
 * (summary, skills, subagents) and takes its status from Claude, which is the
 * authority on what it is doing right now. A session only Claude knows about —
 * started before the hooks were installed, or resumed somewhere the emitter
 * never saw — becomes a row of its own, so the card shows the agent that is
 * really running there.
 *
 * `worktreePaths` are the cards that exist; a session working outside all of
 * them has nowhere to appear and is skipped.
 */
export function mergeRegistry(
  index: SessionIndex,
  registry: RegistrySession[],
  worktreePaths: string[]
): void {
  if (!registry.length) return;
  const keys = worktreePaths.map(normalize);
  const known = new Map<string, AgentVM>();
  for (const list of index.agents.values()) {
    for (const agent of list) known.set(agent.sessionId, agent);
  }

  const touched = new Set<string>();
  for (const session of registry) {
    const agent = known.get(session.sessionId);
    if (agent) {
      if (session.status) agent.status = session.status;
      continue;
    }
    const key = placeIn(session.cwd, keys);
    if (!key) continue;
    const list = index.agents.get(key) ?? [];
    list.push({
      sessionId: session.sessionId,
      // Claude's own session name is the closest thing the registry has to the
      // work summary the emitter records; relabel() fills in an ordinal when
      // there is none.
      label: session.name ?? "",
      ...(session.name ? { summary: session.name } : {}),
      skills: [],
      subagents: [],
      status: session.status ?? "idle",
      startedAt: session.startedAt,
      lastActivity: session.lastActivity,
    });
    index.agents.set(key, list);
    touched.add(key);
  }

  for (const key of touched) relabel(index.agents.get(key) ?? [], index);
}
