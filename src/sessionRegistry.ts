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
import { normalizePath as normalize, pathKey } from "./worktreeUtils";

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

/** A registry file's parsed contents, valid while its mtime is unchanged.
 *  `null` records a file that parsed to nothing usable (garbage, a partial
 *  write, a non-interactive kind) so it is not re-parsed every poll; a
 *  completed write moves the mtime and retries it. Liveness is deliberately
 *  NOT part of the cached value: a process can die without its file changing,
 *  so the pid is re-probed on every read. */
export type RegistryCache = Map<
  string,
  { mtimeMs: number; entry: Omit<RegistrySession, "lastActivity"> | null }
>;

/**
 * Every live session in the registry.
 *
 * Claude removes a session's file when it exits, but a killed process leaves one
 * behind, so each is confirmed against its own pid. This pid is the Claude
 * process itself, so its absence is proof on every platform - which is what
 * retires a row whose terminal was closed without /exit.
 *
 * With a `cache` (owned by the caller, one per registry dir), a file is opened
 * and parsed only when its mtime has moved since the last read. Claude rewrites
 * a session's file on status transitions only, so between transitions a poll
 * costs one stat per session instead of an open+read — the difference that
 * matters on Windows, where every file open pays for filter drivers.
 */
export async function readRegistry(
  dir: string,
  isAlive: (pid: number) => boolean = systemProbes.isAlive,
  cache?: RegistryCache
): Promise<RegistrySession[]> {
  const files = await fs.promises.readdir(dir).catch(() => [] as string[]);
  const out: RegistrySession[] = [];
  const seen = new Set<string>();
  for (const fn of files) {
    if (!fn.endsWith(".json")) continue;
    const full = path.join(dir, fn);
    seen.add(full);
    try {
      const stat = await fs.promises.stat(full);
      const hit = cache?.get(full);
      let entry: Omit<RegistrySession, "lastActivity"> | null;
      if (hit && hit.mtimeMs === stat.mtimeMs) {
        entry = hit.entry;
      } else {
        entry = parseRegistryFile(
          await fs.promises.readFile(full, "utf8"),
          fn,
          stat.mtimeMs
        );
        cache?.set(full, { mtimeMs: stat.mtimeMs, entry });
      }
      if (!entry) continue;
      if (!isAlive(entry.pid)) continue;
      out.push({ ...entry, lastActivity: stat.mtimeMs });
    } catch {
      /* partial write or gone mid-read — ignore this poll */
    }
  }
  // Files that are gone took their sessions with them; drop their cache slots.
  if (cache) {
    for (const key of [...cache.keys()]) {
      if (!seen.has(key)) cache.delete(key);
    }
  }
  return out;
}

/** Parse one registry file into a session (minus the mtime-derived
 *  lastActivity), or null when it holds nothing the panel shows. */
function parseRegistryFile(
  raw: string,
  fn: string,
  mtimeMs: number
): Omit<RegistrySession, "lastActivity"> | null {
  let m: RawEntry;
  try {
    m = JSON.parse(raw) as RawEntry;
  } catch {
    return null; // garbage or a partial write; a finished write moves the mtime
  }
  const sessionId = typeof m?.sessionId === "string" ? m.sessionId : "";
  const cwd = typeof m?.cwd === "string" ? m.cwd : "";
  // The file is named for the pid, so a missing field is recoverable.
  const pid =
    typeof m?.pid === "number" ? m.pid : Number.parseInt(path.basename(fn, ".json"), 10);
  if (!sessionId || !cwd || !Number.isInteger(pid)) return null;
  // Headless (`-p`) runs and other non-interactive kinds are not agents
  // anyone is watching a card for. An older file with no `kind` predates the
  // field and is kept.
  if (typeof m.kind === "string" && m.kind !== "interactive") return null;
  return {
    sessionId,
    pid,
    cwd,
    ...(mapStatus(m.status) ? { status: mapStatus(m.status) } : {}),
    ...(typeof m.waitingFor === "string" && m.waitingFor
      ? { waitingFor: m.waitingFor }
      : {}),
    ...(typeof m.name === "string" && m.name ? { name: m.name } : {}),
    startedAt: typeof m.startedAt === "number" ? m.startedAt : mtimeMs,
  };
}

/** The worktree card a session belongs to: the longest known path that contains
 *  its cwd. Longest wins so a session inside a nested worktree lands on that
 *  worktree's card rather than the repo root's. */
function placeIn(cwd: string, keys: string[]): string | undefined {
  // Compared by key, returned by key-of-the-caller. The two sides come from
  // different places - the cwd is whatever Claude recorded (the case the user
  // typed), the keys are what `git worktree list` printed (the case on disk) -
  // and on Windows and macOS those differ often enough that a straight string
  // compare left agents sitting on no card at all. The value returned is still
  // one of `keys`, so nothing downstream sees a different key space.
  const target = pathKey(cwd);
  let best: string | undefined;
  for (const key of keys) {
    const k = pathKey(key);
    if (target !== k && !target.startsWith(k + path.sep)) continue;
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
  const unplaced: string[] = [];
  for (const session of registry) {
    const key = placeIn(session.cwd, keys);
    // A `claude -w` session runs in a worktree it created itself, inside the
    // repo, after the panel last listed worktrees - so it looks exactly like an
    // isolated subagent's worktree does, and needs the same cue. "No card
    // matched" is NOT that cue: the new worktree lives under the repo root, so
    // it matches the root's card, one level too far up. That is what put a
    // `claude -w` agent's row on the main worktree's card and left its own card
    // missing until the user clicked refresh. Report any cwd that is not itself
    // a card and let one re-gather decide (see refreshAgents); a cwd that is
    // merely a subdirectory of a card, or in another repo entirely, costs one
    // re-gather and then settles.
    if (!key || pathKey(key) !== pathKey(session.cwd)) unplaced.push(session.cwd);
    if (!key) continue;
    const list = byPath.get(key) ?? [];
    list.push(session);
    byPath.set(key, list);
  }

  const agents = new Map<string, AgentVM[]>();
  const elsewhere = new Map<string, WorktreeSubagentVM[]>();
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
          const target = pathKey(sub.worktree);
          const home = placeIn(sub.worktree, keys);
          // The card it lands on is the longest path containing its cwd, which
          // is the parent's own card whenever no nearer one is known - and an
          // isolated subagent's worktree is created INSIDE the repo, after the
          // panel last listed worktrees. So "its cwd is not itself a card" is
          // the signal that the card list may be stale, not "no card matched":
          // the stale case still matches, just too far up the tree. Report it
          // either way and let one re-gather decide (see refreshAgents); a cwd
          // that is merely a subdirectory of a card settles as itself.
          if (!home || pathKey(home) !== target) unplaced.push(sub.worktree);
          // Not, via a symlinked path, the card it is already listed under.
          // Clearing the field keeps one invariant for everything downstream:
          // `worktree` set means "rendered on another card".
          if (!home || pathKey(home) === pathKey(key)) {
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
