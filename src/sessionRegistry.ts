import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  AgentStatus,
  AgentVM,
  SessionIndex,
  SubagentVM,
  WorktreeSubagentVM,
} from "./worktreeData";
import { systemProbes } from "./liveness";
// The VS Code-free path key, so this module stays requirable (and unit-testable)
// outside the extension host.
import { normalizePath as normalize } from "./worktreeUtils";

/**
 * Claude Code's own session registry: where every agent on a card comes from.
 *
 * Since v2.1.119 Claude writes one file per session at
 * `~/.claude/sessions/<pid>.json` and records what that session is doing in a
 * `status` field, updating it on every transition:
 *
 *   { "pid": 567, "sessionId": "...", "cwd": "/repo", "status": "busy",
 *     "startedAt": 1785193745550, "version": "2.1.220", "kind": "interactive",
 *     "name": "agent-worktrees-9f" }
 *
 * This is the same question the extension used to answer by installing ten hooks
 * and watching their events go by, except it comes from the process itself: no
 * consent to edit the user's settings.json, no process spawned per event, no
 * interpreter to find. It is also more truthful, since an event stream can drift
 * from reality - a session resumed in another terminal, a notification that
 * fired while no window was open, a long shell command that looks exactly like a
 * finished turn - and a status the process wrote about itself cannot.
 *
 * What the registry does not have: subagents (they run inside the parent
 * process, so they have no file of their own), skills, and the work summary,
 * which is read from the transcript instead (see transcript.ts).
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
 * to nothing at all rather than a guess: a session whose status Claude does not
 * describe, or describes in a way this does not know, is shown idle rather than
 * asserted to be something it is not.
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

/** Claude's config tree. `CLAUDE_CONFIG_DIR` moves all of it. */
export function claudeDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir()
): string {
  const configured = env.CLAUDE_CONFIG_DIR;
  return configured && configured.trim() ? configured : path.join(home, ".claude");
}

/** Where Claude keeps the session registry. */
export function registryDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir()
): string {
  return path.join(claudeDir(env, home), "sessions");
}

/** Where Claude keeps transcripts, one directory per project. */
export function projectsDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir()
): string {
  return path.join(claudeDir(env, home), "projects");
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
 * behind, so each is confirmed against its own pid. This pid is the Claude
 * process itself, so its absence is proof on every platform - which is what
 * retires a row whose terminal was closed without /exit.
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

/**
 * Name the subagent behind a permission prompt, when it can be named.
 *
 * A subagent with a tool call out has either got a tool running or is blocked on
 * a permission decision for it; its own files cannot tell those apart. The
 * parent can: the session reads `waiting` only when Claude needs the user. So a
 * waiting session with exactly one subagent mid-call identifies that subagent as
 * the one asking - which is what the `PermissionRequest` hook used to say.
 *
 * With several mid-call at once it stays unattributed rather than guessing: the
 * row that says "this one is asking you" is only worth anything if it is right.
 */
function attributePrompt(subagents: SubagentVM[], status: AgentStatus): void {
  for (const sub of subagents) delete sub.awaitingPermission;
  if (status !== "waiting") return;
  const blocked = subagents.filter((s) => (s as { outstanding?: boolean }).outstanding);
  if (blocked.length === 1) blocked[0].awaitingPermission = true;
}

/**
 * Every live session, grouped by the worktree card it belongs to.
 *
 * `worktreePaths` are the cards that exist; a session working outside all of
 * them has nowhere to appear and is skipped. Within a card, agents are ordered
 * by start time and labelled with Claude's work summary, falling back to an
 * ordinal until it has generated one.
 *
 * `titles`, `subagents` and `skills` are keyed by session id; the caller reads
 * them (see TranscriptReader) because doing so touches the filesystem and this
 * stays pure.
 *
 * A subagent given a worktree of its own is indexed under THAT worktree rather
 * than its parent session's, so the panel can show it on the card for the code
 * it is actually touching. It stays in the parent agent's own list too - that is
 * what the count on the parent row is drawn from, so a fanned-out session still
 * says how many it has in flight.
 */
export function indexRegistry(
  registry: RegistrySession[],
  worktreePaths: string[],
  titles: Map<string, string> = new Map(),
  subagents: Map<string, SubagentVM[]> = new Map(),
  skills: Map<string, string[]> = new Map()
): SessionIndex {
  const keys = worktreePaths.map(normalize);
  const byPath = new Map<string, RegistrySession[]>();
  for (const session of registry) {
    const key = placeIn(session.cwd, keys);
    if (!key) continue;
    const list = byPath.get(key) ?? [];
    list.push(session);
    byPath.set(key, list);
  }

  const agents = new Map<string, AgentVM[]>();
  const elsewhere = new Map<string, WorktreeSubagentVM[]>();
  const unplaced: string[] = [];
  for (const [key, sessions] of byPath) {
    sessions.sort((a, b) => a.startedAt - b.startedAt);
    agents.set(
      key,
      sessions.map((session, i) => {
        const summary = titles.get(session.sessionId)?.trim() || undefined;
        const own = subagents.get(session.sessionId) ?? [];
        const status = session.status ?? "idle";
        const label = summary ?? `Claude ${i + 1}`;
        attributePrompt(own, status);
        for (const sub of own) {
          if (!sub.worktree) continue;
          const target = normalize(sub.worktree);
          const home = placeIn(sub.worktree, keys);
          // The card it lands on is the longest path containing its cwd, which
          // is the parent's own card whenever no nearer one is known - and an
          // isolated subagent's worktree is created INSIDE the repo, after the
          // panel last listed worktrees. So "its cwd is not itself a card" is
          // the signal that the card list may be stale, not "no card matched":
          // the stale case still matches, just too far up the tree. Report it
          // either way and let one re-gather decide (see refreshAgents); a cwd
          // that is merely a subdirectory of a card settles as itself.
          if (home !== target) unplaced.push(sub.worktree);
          // Not, via a symlinked path, the card it is already listed under.
          // Clearing the field keeps one invariant for everything downstream:
          // `worktree` set means "rendered on another card".
          if (!home || home === key) {
            delete sub.worktree;
            continue;
          }
          // The SAME object, not a copy, so a later edit reaches both lists.
          const placed = sub as WorktreeSubagentVM;
          placed.parentSessionId = session.sessionId;
          placed.parentLabel = label;
          placed.parentStatus = status;
          const list = elsewhere.get(home) ?? [];
          list.push(placed);
          elsewhere.set(home, list);
        }
        return {
          sessionId: session.sessionId,
          label,
          ...(summary ? { summary } : {}),
          skills: skills.get(session.sessionId) ?? [],
          subagents: own,
          status,
          startedAt: session.startedAt,
          lastActivity: session.lastActivity,
        };
      })
    );
  }
  // Oldest first, matching how subagents are ordered under their parent.
  for (const list of elsewhere.values()) {
    list.sort((a, b) => a.startedAt - b.startedAt);
  }
  return { agents, subagents: elsewhere, unplaced };
}
