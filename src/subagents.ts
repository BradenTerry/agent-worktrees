import * as fs from "fs";
import * as path from "path";
import { SubagentVM } from "./worktreeData";

/**
 * Subagents, read from the files Claude Code writes for them.
 *
 * A subagent has no process and no registry entry of its own - it runs inside
 * its parent's session - which is why the panel used to learn about them from
 * the SubagentStart/SubagentStop hooks. It does not need to. Claude gives every
 * subagent a directory of its own beside the parent's transcript:
 *
 *   ~/.claude/projects/<project>/<parentSessionId>/subagents/
 *       agent-<agentId>.jsonl       the subagent's transcript (isSidechain: true)
 *       agent-<agentId>.meta.json   { agentType, description, toolUseId,
 *                                     spawnDepth, model }
 *
 * That is a row's whole contents: the type and the task from the meta file, the
 * id from its name, the start time from the transcript's first record, and the
 * worktree it was given from that record's `cwd`. Discovery is a readdir and a
 * few small reads - it never parses the parent's (potentially megabytes)
 * transcript.
 *
 * Verified against Claude Code 2.1.220.
 */

/** What the meta file holds, before anything is trusted. */
interface RawMeta {
  agentType?: unknown;
  description?: unknown;
  toolUseId?: unknown;
  model?: unknown;
}

/** A subagent found on disk, plus what is needed to decide it is still running. */
export interface FoundSubagent extends SubagentVM {
  /** It has issued a tool call whose result has not landed: it is either running
   *  that tool or blocked on a permission decision for it. Which of the two
   *  cannot be told from here - only the parent session's status says whether
   *  anyone is being asked (see indexRegistry). */
  outstanding: boolean;
  /** The parent's `Agent` tool-use this subagent belongs to. Its presence in the
   *  parent's results is what says the subagent has finished. */
  toolUseId?: string;
  /** Epoch ms its transcript was last written, for the staleness backstop. */
  lastActivity: number;
}

/** Only the tail of a subagent's transcript is scanned for an unanswered call:
 *  an outstanding one is by definition the most recent thing in it. */
const TAIL_BYTES = 32768;

const META_SUFFIX = ".meta.json";
const AGENT_PREFIX = "agent-";

/** Where a session's subagents live. */
export function subagentsDir(projectsDir: string, project: string, sessionId: string): string {
  return path.join(projectsDir, project, sessionId, "subagents");
}

/**
 * The first record's `cwd` and timestamp, from the head of a subagent's
 * transcript. Both are written on the first line, so this reads a small prefix
 * rather than the file - a subagent that has been working for a while has a
 * transcript as large as any other.
 */
function readHead(file: string): { cwd?: string; startedAt?: number } {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(8192);
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    if (!read) return {};
    const line = buf.toString("utf8", 0, read).split("\n")[0];
    const rec = JSON.parse(line);
    const ts = Date.parse(rec?.timestamp);
    return {
      cwd: typeof rec?.cwd === "string" ? rec.cwd : undefined,
      startedAt: Number.isFinite(ts) ? ts : undefined,
    };
  } catch {
    return {}; // not written yet, truncated first line, unreadable
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}

/**
 * Whether the subagent has a tool call out that has not come back.
 *
 * Its transcript pairs them plainly: an assistant record carries the `tool_use`,
 * and the `user` record after it carries the `tool_result`. A call with no
 * result is the signature of a subagent that is blocked - on a slow tool, or on
 * a permission prompt nobody has answered.
 */
function hasOutstandingCall(file: string): boolean {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const { size } = fs.fstatSync(fd);
    const want = Math.min(size, TAIL_BYTES);
    if (want <= 0) return false;
    const buf = Buffer.alloc(want);
    fs.readSync(fd, buf, 0, want, size - want);
    const issued = new Set<string>();
    const answered = new Set<string>();
    for (const line of buf.toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      // Cheap reject: most records are plain messages.
      if (line.indexOf("tool_use") === -1 && line.indexOf("tool_result") === -1) {
        continue;
      }
      let rec: { message?: { content?: unknown } };
      try {
        rec = JSON.parse(line);
      } catch {
        continue; // the first line is usually a fragment
      }
      const content = rec.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const b = block as { type?: string; id?: string; tool_use_id?: string };
        if (b?.type === "tool_use" && b.id) issued.add(b.id);
        if (b?.type === "tool_result" && b.tool_use_id) answered.add(b.tool_use_id);
      }
    }
    for (const id of issued) {
      if (!answered.has(id)) return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}

/**
 * Every subagent Claude has recorded for a session, running or finished.
 *
 * Deciding which are still running is the caller's job (see liveSubagents): it
 * needs the parent's tool results, which come from the same transcript tail the
 * work summary is read from.
 */
export async function readSubagents(dir: string): Promise<FoundSubagent[]> {
  const files = await fs.promises.readdir(dir).catch(() => [] as string[]);
  const out: FoundSubagent[] = [];
  for (const fn of files) {
    if (!fn.startsWith(AGENT_PREFIX) || !fn.endsWith(META_SUFFIX)) continue;
    const id = fn.slice(AGENT_PREFIX.length, -META_SUFFIX.length);
    if (!id) continue;
    try {
      const meta = JSON.parse(
        await fs.promises.readFile(path.join(dir, fn), "utf8")
      ) as RawMeta;
      const transcript = path.join(dir, `${AGENT_PREFIX}${id}.jsonl`);
      const head = readHead(transcript);
      // The transcript is written to as the subagent works, so its mtime is the
      // last sign of life. Fall back to the meta file for a subagent that has
      // not managed a first record yet.
      const stat = await fs.promises
        .stat(transcript)
        .catch(() => fs.promises.stat(path.join(dir, fn)));
      const outstanding = hasOutstandingCall(transcript);
      out.push({
        id,
        outstanding,
        // Nothing out and not finished: it has stopped its turn but is still in
        // flight - parked on a background command that will wake it.
        ...(outstanding ? {} : { paused: true }),
        ...(typeof meta.agentType === "string" && meta.agentType
          ? { type: meta.agentType }
          : {}),
        ...(typeof meta.description === "string" && meta.description
          ? { task: meta.description }
          : {}),
        ...(typeof meta.toolUseId === "string" && meta.toolUseId
          ? { toolUseId: meta.toolUseId }
          : {}),
        ...(head.cwd ? { worktree: head.cwd } : {}),
        startedAt: head.startedAt ?? stat.mtimeMs,
        lastActivity: stat.mtimeMs,
      });
    } catch {
      /* half-written meta, or removed between readdir and read */
    }
  }
  return out;
}

/** How long a subagent may go unwritten before it is treated as finished even
 *  though no result for it was seen. The backstop only matters for subagents
 *  that finished while no window was watching, whose result has since scrolled
 *  out of the parent transcript's tail; a working subagent writes far more
 *  often than this. */
const SILENT_FOR_FINISHED = 10 * 60_000;

/**
 * The subagents still running, oldest first.
 *
 * `finished` is every id the parent's transcript has said is done, which arrives
 * in one of two shapes depending on how the subagent was launched:
 *
 *  - backgrounded (the default): a `<task-notification>` naming the subagent's
 *    own **id**. The `Agent` call itself was answered at launch, so its tool
 *    result says nothing about whether the work is over;
 *  - synchronous: a tool result for the `Agent` call, i.e. its **toolUseId**.
 *
 * Either retires the row, so both are looked up. The signal lands at the end of
 * the transcript as it happens, so a window that is open sees every one, and
 * `finished` accumulates across refreshes so one seen once is never forgotten
 * when it later falls out of the tail being read.
 *
 * The mtime backstop covers the remaining case: a window opened long after a
 * subagent finished, whose result was never in any tail this window read. Shown
 * as running for at most SILENT_FOR_FINISHED, which is wrong for that long
 * rather than forever.
 */
export function liveSubagents(
  found: FoundSubagent[],
  finished: ReadonlySet<string>,
  now = Date.now()
): FoundSubagent[] {
  return found
    .filter((s) => {
      if (finished.has(s.id)) return false;
      if (s.toolUseId && finished.has(s.toolUseId)) return false;
      return now - s.lastActivity < SILENT_FOR_FINISHED;
    })
    .sort((a, b) => a.startedAt - b.startedAt);
}
