import * as fs from "fs";
import * as path from "path";

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

/**
 * The most recent title in a transcript, or "" when it has none yet (a session
 * that has not been summarized), the file is unreadable, or it is empty.
 *
 * Scans the tail backwards for the newest record of either kind. The first line
 * read is usually partial, since the read starts mid-file; `JSON.parse` throws
 * on it and the scan moves on.
 */
export function readTitle(file: string): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const { size } = fs.fstatSync(fd);
    const want = Math.min(size, TAIL_BYTES);
    if (want <= 0) return "";
    const buf = Buffer.alloc(want);
    fs.readSync(fd, buf, 0, want, size - want);
    const lines = buf.toString("utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      // Cheap reject before parsing: most lines are messages, not titles.
      if (line.indexOf("ai-title") === -1 && line.indexOf("custom-title") === -1) {
        continue;
      }
      try {
        const o = JSON.parse(line);
        const raw =
          o?.type === "ai-title" && typeof o.aiTitle === "string"
            ? o.aiTitle
            : o?.type === "custom-title" && typeof o.customTitle === "string"
            ? o.customTitle
            : "";
        const title = raw.replace(/\s+/g, " ").trim();
        if (title) return title.slice(0, MAX_TITLE);
      } catch {
        /* partial or non-JSON line: keep scanning */
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
  return "";
}

/** A title lookup that remembers where each session's transcript lives and what
 *  it last said.
 *
 *  Titles are read on every refresh, so the directory scan is cached per session
 *  (a transcript does not move) and the title itself is re-read only when the
 *  file has been written since the last read. In the steady state a session with
 *  a settled title costs one stat. */
export class TitleReader {
  private readonly located = new Map<string, string | undefined>();
  private readonly cache = new Map<string, { mtimeMs: number; title: string }>();

  constructor(private readonly projectsDir: string) {}

  async titleFor(sessionId: string): Promise<string> {
    if (!this.located.has(sessionId)) {
      this.located.set(
        sessionId,
        await findTranscript(this.projectsDir, sessionId)
      );
    }
    const file = this.located.get(sessionId);
    if (!file) return "";
    let mtimeMs: number;
    try {
      mtimeMs = (await fs.promises.stat(file)).mtimeMs;
    } catch {
      // Gone (a deleted session): forget it, so a new transcript for the same
      // id would be found again rather than serving a stale title forever.
      this.located.delete(sessionId);
      this.cache.delete(sessionId);
      return "";
    }
    const hit = this.cache.get(sessionId);
    if (hit && hit.mtimeMs === mtimeMs) return hit.title;
    const title = readTitle(file);
    this.cache.set(sessionId, { mtimeMs, title });
    return title;
  }

  /** Drop sessions that are no longer live, so neither map grows without
   *  bound in a long-lived window. */
  retain(sessionIds: Set<string>): void {
    for (const id of [...this.located.keys()]) {
      if (!sessionIds.has(id)) this.located.delete(id);
    }
    for (const id of [...this.cache.keys()]) {
      if (!sessionIds.has(id)) this.cache.delete(id);
    }
  }
}
