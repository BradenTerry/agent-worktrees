import * as fs from "fs";
import * as path from "path";
import { SubagentVM } from "./worktreeData";
import { liveSubagents, readSubagents } from "./subagents";

/**
 * The work summary shown on an agent row, read from Claude's transcript.
 *
 * Claude Code writes `{ "type": "ai-title", "aiTitle": "..." }` into a session's
 * JSONL as it summarizes the work, and `{ "type": "custom-title",
 * "customTitle": "..." }` when the title is set explicitly (a rename, or the app
 * titling the session). Whichever was written last wins. That title is what a
 * row is labelled with; without it every agent in a worktree is just
 * "Claude 1", "Claude 2".
 *
 * The emitter hook used to read this and write it into its state file. Nothing
 * about it needed a hook: the transcript is a file, and the extension can read
 * the same bytes. This is that read, ported, and it is the last thing the hooks
 * were carrying that the session registry does not.
 */

/** Only the tail is read: the latest title record sits near the end, so the
 *  cost stays bounded no matter how large a transcript grows. */
const TAIL_BYTES = 65536;
/** Long enough to be a summary, short enough for a row. */
const MAX_TITLE = 120;

/** Claude keeps one directory of transcripts per project, named for the cwd,
 *  and one `<sessionId>.jsonl` inside it. The directory encoding is Claude's,
 *  so rather than reproduce it, look for the session's own file: the registry
 *  gives us the id, and there are only ever a handful of project directories. */
export async function findTranscript(
  projectsDir: string,
  sessionId: string
): Promise<string | undefined> {
  if (!sessionId) return undefined;
  const dirs = await fs.promises.readdir(projectsDir).catch(() => [] as string[]);
  for (const dir of dirs) {
    const file = path.join(projectsDir, dir, `${sessionId}.jsonl`);
    try {
      await fs.promises.access(file);
      return file;
    } catch {
      /* not this project */
    }
  }
  return undefined;
}

/** What one pass over a transcript's tail yields. */
export interface TranscriptTail {
  /** Newest title, or "" when the session has not been summarized yet. */
  title: string;
  /** Ids of the tool calls whose results appear in the tail. A subagent's
   *  `Agent` call landing here is what says it has finished (see subagents.ts). */
  toolResults: string[];
}

/**
 * Read the tail of a transcript once, for everything the panel needs from it.
 *
 * Scans backwards so the newest title wins. The first line read is usually
 * partial, since the read starts mid-file; `JSON.parse` throws on it and the
 * scan moves on. Tool results are collected across the whole tail rather than
 * stopping at the first, since several subagents can finish in one window.
 */
export function readTail(file: string): TranscriptTail {
  const out: TranscriptTail = { title: "", toolResults: [] };
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const { size } = fs.fstatSync(fd);
    const want = Math.min(size, TAIL_BYTES);
    if (want <= 0) return out;
    const buf = Buffer.alloc(want);
    fs.readSync(fd, buf, 0, want, size - want);
    const lines = buf.toString("utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      const maybeTitle =
        !out.title &&
        (line.indexOf("ai-title") !== -1 || line.indexOf("custom-title") !== -1);
      const maybeResult = line.indexOf("tool_result") !== -1;
      if (!maybeTitle && !maybeResult) continue;
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(line);
      } catch {
        continue; // partial or non-JSON line
      }
      if (maybeTitle) {
        const o = rec as { type?: string; aiTitle?: string; customTitle?: string };
        const raw =
          o.type === "ai-title" && typeof o.aiTitle === "string"
            ? o.aiTitle
            : o.type === "custom-title" && typeof o.customTitle === "string"
            ? o.customTitle
            : "";
        const title = raw.replace(/\s+/g, " ").trim();
        if (title) out.title = title.slice(0, MAX_TITLE);
      }
      if (!maybeResult) continue;
      const content = (rec.message as { content?: unknown })?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const b = block as { type?: string; tool_use_id?: string };
        if (b?.type === "tool_result" && typeof b.tool_use_id === "string") {
          out.toolResults.push(b.tool_use_id);
        }
      }
    }
  } catch {
    /* no transcript, unreadable, gone mid-read */
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
  return out;
}

/**
 * The most recent title in a transcript, or "" when it has none yet (a session
 * that has not been summarized), the file is unreadable, or it is empty.
 */
export function readTitle(file: string): string {
  return readTail(file).title;
}

/**
 * Per-session reads of Claude's own files, cached.
 *
 * Both the work summary and the subagent rows come from the same session's
 * files, so one object owns the lookups and their caches. The transcript's tail
 * is re-read only when the file has been written since the last read, so a
 * session sitting idle costs one stat per refresh.
 */
export class TranscriptReader {
  private readonly located = new Map<string, string | undefined>();
  private readonly cache = new Map<string, { mtimeMs: number; tail: TranscriptTail }>();
  /** Tool calls seen to have finished, per session. Accumulated across refreshes
   *  because a result scrolls out of the tail as the session goes on, and a
   *  subagent that finished must not come back to life when it does. */
  private readonly finished = new Map<string, Set<string>>();

  constructor(private readonly projectsDir: string) {}

  /** The session's transcript path, located once. */
  private async transcript(sessionId: string): Promise<string | undefined> {
    if (!this.located.has(sessionId)) {
      this.located.set(sessionId, await findTranscript(this.projectsDir, sessionId));
    }
    return this.located.get(sessionId);
  }

  /** The tail, re-read only when the transcript has been written since. */
  private async tailFor(sessionId: string): Promise<TranscriptTail> {
    const file = await this.transcript(sessionId);
    if (!file) return { title: "", toolResults: [] };
    let mtimeMs: number;
    try {
      mtimeMs = (await fs.promises.stat(file)).mtimeMs;
    } catch {
      // Gone (a deleted session): forget it, so a new transcript for the same
      // id would be found again rather than serving a stale read forever.
      this.located.delete(sessionId);
      this.cache.delete(sessionId);
      return { title: "", toolResults: [] };
    }
    const hit = this.cache.get(sessionId);
    if (hit && hit.mtimeMs === mtimeMs) return hit.tail;
    const tail = readTail(file);
    this.cache.set(sessionId, { mtimeMs, tail });
    const seen = this.finished.get(sessionId) ?? new Set<string>();
    for (const id of tail.toolResults) seen.add(id);
    this.finished.set(sessionId, seen);
    return tail;
  }

  /** Claude's generated work summary for this session, or "". */
  async titleFor(sessionId: string): Promise<string> {
    return (await this.tailFor(sessionId)).title;
  }

  /**
   * The subagents running under this session right now, oldest first.
   *
   * The tail is read first so a subagent that finished in this window is known
   * to have finished before its row is considered.
   */
  async subagentsFor(sessionId: string): Promise<SubagentVM[]> {
    const file = await this.transcript(sessionId);
    if (!file) return [];
    await this.tailFor(sessionId);
    const dir = path.join(path.dirname(file), sessionId, "subagents");
    const found = await readSubagents(dir);
    if (!found.length) return [];
    const live = liveSubagents(found, this.finished.get(sessionId) ?? new Set());
    // `toolUseId` and `lastActivity` are how a row is judged, not part of it.
    return live.map(({ toolUseId, lastActivity, ...row }) => row);
  }

  /** Drop sessions that are no longer live, so nothing grows without bound in a
   *  long-lived window. */
  retain(sessionIds: Set<string>): void {
    for (const map of [this.located, this.cache, this.finished]) {
      for (const id of [...map.keys()]) {
        if (!sessionIds.has(id)) map.delete(id);
      }
    }
  }
}
