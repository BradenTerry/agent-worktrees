import * as fs from "fs";
import * as path from "path";
import { AgentVM, AgentStatus, SubagentVM, normalize } from "./worktreeData";

/** Raw per-session state written by the emitter hook. The liveness markers it
 *  also writes (`pid`, `launched`) are read by pruneDeadSessions in liveness.ts,
 *  which retires the files this reader would otherwise keep showing. */
interface SessionState {
  sessionId: string;
  worktree: string;
  branch?: string;
  state: AgentStatus;
  task?: string;
  /** Bare names of skills this session has invoked (deduped, in first-use order). */
  skills?: string[];
  /** Subagents the emitter currently believes are running. */
  subagents?: unknown;
  /** Epoch ms when the session was first seen. */
  startedAt?: number;
  /** Epoch ms of the most recent hook event. */
  ts: number;
}

// A session whose state file is older than this is treated as gone: a terminal
// closed without /exit never fires SessionEnd, so its last (usually idle) file
// would otherwise linger forever. Only the backstop for files the liveness sweep
// (pruneDeadSessions) cannot judge — written by an emitter too old to record
// either marker; a session whose process can be probed is retired as soon as it
// dies.
const SESSION_MAX_AGE = 24 * 3_600_000;

const VALID: AgentStatus[] = ["active", "waiting", "idle"];

/**
 * The live subagents of one session, sanitized for the webview. State files are
 * written by a separate process and may be from an older extension version, so
 * anything malformed (including the numeric tally this field used to hold) is
 * dropped rather than trusted.
 */
function readSubagents(raw: unknown, fallbackTs: number): SubagentVM[] {
  if (!Array.isArray(raw)) return [];
  const out: SubagentVM[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const { id, type, task, paused, awaitingPermission, startedAt } =
      s as Record<string, unknown>;
    if (typeof id !== "string" || !id) continue;
    out.push({
      id,
      ...(typeof type === "string" && type ? { type } : {}),
      ...(typeof task === "string" && task ? { task } : {}),
      ...(paused === true ? { paused: true } : {}),
      ...(awaitingPermission === true ? { awaitingPermission: true } : {}),
      startedAt: typeof startedAt === "number" ? startedAt : fallbackTs,
    });
  }
  return out;
}

/**
 * Read every session state file and group the agents by worktree path.
 * Within a worktree, agents are ordered by first-seen (ts ascending) and given
 * stable sequential labels. Stale files are pruned as they are encountered.
 */
export async function readSessionsByWorktree(
  dir: string
): Promise<Map<string, AgentVM[]>> {
  const files = await fs.promises.readdir(dir).catch(() => [] as string[]);
  const now = Date.now();
  const byPath = new Map<string, SessionState[]>();

  for (const fn of files) {
    if (!fn.endsWith(".json")) continue;
    const full = path.join(dir, fn);
    try {
      const raw = await fs.promises.readFile(full, "utf8");
      const m = JSON.parse(raw) as SessionState;
      if (
        typeof m?.ts !== "number" ||
        now - m.ts > SESSION_MAX_AGE ||
        !m.worktree
      ) {
        await fs.promises.unlink(full).catch(() => {});
        continue;
      }
      const status = VALID.includes(m.state) ? m.state : "idle";
      const key = normalize(m.worktree);
      const list = byPath.get(key) ?? [];
      list.push({ ...m, state: status });
      byPath.set(key, list);
    } catch {
      /* partial write or garbage — ignore this poll */
    }
  }

  const out = new Map<string, AgentVM[]>();
  for (const [key, sessions] of byPath) {
    sessions.sort((a, b) => (a.startedAt ?? a.ts) - (b.startedAt ?? b.ts));
    out.set(
      key,
      sessions.map((s, i) => {
        const summary = s.task && s.task.trim() ? s.task.trim() : undefined;
        const skills = Array.isArray(s.skills)
          ? s.skills.filter((x) => typeof x === "string")
          : [];
        const subagents = readSubagents(s.subagents, s.ts);
        return {
          sessionId: s.sessionId,
          // The work summary, then an ordinal until Claude generates a title.
          label: summary || `Claude ${i + 1}`,
          summary,
          skills,
          subagents,
          status: s.state,
          startedAt: s.startedAt ?? s.ts,
          lastActivity: s.ts,
        };
      })
    );
  }
  return out;
}
