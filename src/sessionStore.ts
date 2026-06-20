import * as fs from "fs";
import * as path from "path";
import { AgentVM, AgentStatus, normalize } from "./worktreeData";

/** Raw per-session state written by the emitter hook. */
interface SessionState {
  sessionId: string;
  worktree: string;
  branch?: string;
  state: AgentStatus;
  task?: string;
  /** User-given name (pencil button or /rename). */
  name?: string;
  /** Bare names of skills this session has invoked (deduped, in first-use order). */
  skills?: string[];
  /** Epoch ms when the session was first seen. */
  startedAt?: number;
  /** Epoch ms of the most recent hook event. */
  ts: number;
}

// A session whose state file is older than this is treated as gone: a terminal
// closed without /exit never fires SessionEnd, so its last (usually idle) file
// would otherwise linger forever.
const SESSION_MAX_AGE = 24 * 3_600_000;

const VALID: AgentStatus[] = ["active", "waiting", "idle"];

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
        const name = s.name && s.name.trim() ? s.name.trim() : undefined;
        const skills = Array.isArray(s.skills)
          ? s.skills.filter((x) => typeof x === "string")
          : [];
        return {
          sessionId: s.sessionId,
          // User-given name wins, then the work summary, then an ordinal before
          // the first prompt.
          label: name || summary || `Claude ${i + 1}`,
          name,
          summary,
          skills,
          status: s.state,
          startedAt: s.startedAt ?? s.ts,
          lastActivity: s.ts,
        };
      })
    );
  }
  return out;
}
