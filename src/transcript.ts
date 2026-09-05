import * as fs from "fs";
import * as path from "path";
import { StringDecoder } from "string_decoder";
import { SubagentVM } from "./worktreeData";
import {
  liveSubagents,
  newSubagentDirCache,
  readSubagents,
  rememberRetired,
  SubagentDirCache,
} from "./subagents";

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

/** Only the tail is read on a refresh, so the cost stays bounded no matter how
 *  large a transcript grows. Anything older than this window (a title written
 *  once, early) comes from the one-time full scan instead; see scanTranscript. */
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
 * Reduce a Skill tool's `skill` input to its bare name: `plugin:foo` and
 * `path/to/foo` both normalize to `foo`, so the panel dedupes either form.
 * Ported from the emitter, which read the same value off the PreToolUse payload.
 */
export function normalizeSkill(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.split(/[/:\\]/).filter(Boolean).pop();
  return name && /^[a-z0-9][a-z0-9._-]*$/i.test(name) ? name : undefined;
}

/** The title a parsed record carries, normalized, or "" when it is not a title
 *  record. Both kinds are read the same way, so the tail read and the full scan
 *  agree on what counts as a title. */
function titleIn(rec: Record<string, unknown>): string {
  const o = rec as { type?: string; aiTitle?: string; customTitle?: string };
  const raw =
    o.type === "ai-title" && typeof o.aiTitle === "string"
      ? o.aiTitle
      : o.type === "custom-title" && typeof o.customTitle === "string"
      ? o.customTitle
      : "";
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
}

/** Every skill invoked in a line of transcript, if any. A Skill tool call is a
 *  `tool_use` block like the rest, so the name is `input.skill`. */
function skillsInLine(rec: Record<string, unknown>): string[] {
  const content = (rec.message as { content?: unknown })?.content;
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const block of content) {
    const b = block as { type?: string; name?: string; input?: { skill?: unknown } };
    if (b?.type !== "tool_use" || b.name !== "Skill") continue;
    const skill = normalizeSkill(b.input?.skill);
    if (skill) out.push(skill);
  }
  return out;
}

/** Wraps the id of a subagent that has just finished. Cheap reject first, then
 *  the id itself: `<task-id>aa339f147faafaf68</task-id>`. */
const TASK_MARK = "<task-notification>";
const TASK_ID = /<task-id>([A-Za-z0-9_-]+)<\/task-id>/g;

/** The opening words of the result an `Agent` call gets the moment it launches
 *  a background subagent. */
const ASYNC_LAUNCH = "Async agent launched successfully";

/**
 * Whether a tool result is the receipt for launching a background subagent
 * rather than the outcome of one.
 *
 * Subagents run in the background by default, and a backgrounded `Agent` call is
 * answered immediately: the parent gets a result saying the agent is now working
 * and that a notification will follow. Treating that as the call's outcome is
 * what retired every subagent within a second or two of it starting - the row
 * existed, it was simply never alive by the time anything rendered. A subagent
 * launched synchronously still gets its real result here, so the two are told
 * apart by the receipt's text rather than by ignoring results altogether.
 */
function isAsyncLaunch(content: unknown): boolean {
  if (typeof content === "string") return content.startsWith(ASYNC_LAUNCH);
  if (!Array.isArray(content)) return false;
  return content.some((b) => {
    const text = (b as { type?: string; text?: unknown })?.text;
    return typeof text === "string" && text.startsWith(ASYNC_LAUNCH);
  });
}

/** What one pass over a transcript's tail yields. */
export interface TranscriptTail {
  /** Newest title, or "" when the session has not been summarized yet. */
  title: string;
  /** Ids seen in the tail that retire a subagent: the `<task-id>` of every
   *  completion notification, plus the `tool_use_id` of every genuine tool
   *  result. Matched against both a subagent's id and its `toolUseId`, since
   *  which one arrives depends on how it was launched (see subagents.ts). */
  finished: string[];
  /** Skills invoked in the tail, bare names, in first-use order. */
  skills: string[];
}

/**
 * Read the tail of a transcript once, for everything the panel needs from it.
 *
 * Scans backwards so the newest title wins. The first line read is usually
 * partial, since the read starts mid-file; `JSON.parse` throws on it and the
 * scan moves on. Finished ids are collected across the whole tail rather than
 * stopping at the first, since several subagents can finish in one window.
 */
export function readTail(file: string): TranscriptTail {
  const out: TranscriptTail = { title: "", finished: [], skills: [] };
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
      const maybeSkill = line.indexOf(SKILL_MARK) !== -1;
      // A completion notification is XML inside a record's text, and it is
      // written twice (queued, then delivered), so it is read off the raw line
      // and deduped by the caller's set rather than parsed out of either shape.
      if (line.indexOf(TASK_MARK) !== -1) {
        for (const m of line.matchAll(TASK_ID)) out.finished.push(m[1]);
      }
      if (!maybeTitle && !maybeResult && !maybeSkill) continue;
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(line);
      } catch {
        continue; // partial or non-JSON line
      }
      if (maybeTitle) {
        const title = titleIn(rec);
        if (title) out.title = title;
      }
      if (maybeSkill) out.skills.unshift(...skillsInLine(rec));
      if (!maybeResult) continue;
      const content = (rec.message as { content?: unknown })?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const b = block as { type?: string; tool_use_id?: string; content?: unknown };
        if (b?.type !== "tool_result" || typeof b.tool_use_id !== "string") continue;
        if (isAsyncLaunch(b.content)) continue;
        out.finished.push(b.tool_use_id);
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

/** Chunk size for the one-time full scan. Big enough that a long transcript is
 *  a handful of reads, small enough that none of this lands in memory twice. */
const SCAN_CHUNK = 256 * 1024;
/** What the scan is looking for, so it can reject a whole chunk with one search
 *  rather than splitting it into records first. Both title kinds end the same
 *  way, so one mark finds either. */
const SKILL_MARK = '"Skill"';
const TITLE_MARK = '-title"';

/** What one pass over a whole transcript yields. */
export interface TranscriptScan {
  /** Every skill invoked in the file, bare names in first-use order. */
  skills: string[];
  /** The newest title anywhere in the file, or "" when it has none. */
  title: string;
}

/**
 * Everything in a transcript that the tail alone cannot be trusted for.
 *
 * Skills accumulate over a whole session, so a session that used a skill an hour
 * ago has it far behind. The title has the same problem for a different reason:
 * it is written when Claude summarizes the work, not on every turn, and a
 * session titled once (the app titling it, or a rename) leaves that record
 * hundreds of kilobytes back by the time the session has run a while - at which
 * point a tail read finds nothing and the row falls back to "Claude 1". So the
 * whole file is walked once per session - the tail read on every refresh after
 * that keeps both current - and the cost is paid when a window first sees a
 * session, not repeatedly.
 */
export async function scanTranscript(file: string): Promise<TranscriptScan> {
  const out: TranscriptScan = { skills: [], title: "" };
  const seen = new Set<string>();
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(file, "r");
    const buf = Buffer.alloc(SCAN_CHUNK);
    // A chunk boundary can fall inside a multi-byte character; the decoder
    // holds those bytes back rather than handing out a replacement char.
    const decoder = new StringDecoder("utf8");
    let rest = "";
    const take = (line: string): void => {
      const skill = line.indexOf(SKILL_MARK) !== -1;
      const title = line.indexOf(TITLE_MARK) !== -1;
      if (!skill && !title) return;
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(line);
      } catch {
        return; // not a whole record
      }
      if (title) {
        const found = titleIn(rec);
        if (found) out.title = found;
      }
      if (!skill) return;
      for (const name of skillsInLine(rec)) {
        if (seen.has(name)) continue;
        seen.add(name);
        out.skills.push(name);
      }
    };
    for (;;) {
      const { bytesRead } = await handle.read(buf, 0, SCAN_CHUNK, null);
      if (!bytesRead) break;
      const text = rest + decoder.write(buf.subarray(0, bytesRead));
      // Splitting megabytes into lines is the expensive part, and almost no
      // chunk carries either mark. Two indexOf over the chunk decide whether it
      // is worth doing; when it is not, only the trailing partial record is
      // carried forward.
      if (text.indexOf(SKILL_MARK) === -1 && text.indexOf(TITLE_MARK) === -1) {
        const nl = text.lastIndexOf("\n");
        rest = nl === -1 ? text : text.slice(nl + 1);
        continue;
      }
      const lines = text.split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) take(line);
    }
    // A transcript being written right now often ends without its newline, and
    // that last record is the likeliest place for the newest title.
    take(rest + decoder.end());
  } catch {
    /* no transcript, unreadable, gone mid-scan */
  } finally {
    await handle?.close().catch(() => {});
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
  /** Only sessions whose transcript has been found; see transcript(). */
  private readonly located = new Map<string, string>();
  private readonly cache = new Map<string, { mtimeMs: number; tail: TranscriptTail }>();
  /** Skills this session has invoked, seeded from the tail and completed by one
   *  background scan (see fillFromScan), then topped up from every tail read. */
  private readonly skills = new Map<string, string[]>();
  /** The newest title seen for this session, remembered rather than re-derived.
   *  Claude writes a title when it summarizes the work, not on every turn, so a
   *  title that was in the tail an hour ago has scrolled out of it since - and
   *  re-deriving from each tail read would drop a row back to "Claude 1" while
   *  the session is still called something in Claude itself. A tail with no
   *  title says nothing new, so it leaves the remembered one alone. */
  private readonly titles = new Map<string, string>();
  /** Sessions whose one-time full scan is in flight, so the poll cannot pile up
   *  a scan of the same transcript on every tick. */
  private readonly scanning = new Set<string>();
  /** Tool calls seen to have finished, per session. Accumulated across refreshes
   *  because a result scrolls out of the tail as the session goes on, and a
   *  subagent that finished must not come back to life when it does. */
  private readonly finished = new Map<string, Set<string>>();
  /** Per-session cache of what the subagents dir already said (immutable metas,
   *  mtime-keyed transcript state), so the 1s agent poll re-reads a subagent's
   *  files only when they have actually been written. */
  private readonly subagentDirs = new Map<string, SubagentDirCache>();

  constructor(private readonly projectsDir: string) {}

  /**
   * The session's transcript path, located once it exists.
   *
   * A miss is deliberately NOT remembered. Claude registers a session several
   * seconds before it writes the session's first transcript record (measured at
   * ~9s), and the registry file appearing is exactly what wakes the panel - so
   * the first lookup for a session that starts while a window is open always
   * comes up empty. Caching that emptiness left the session with no work
   * summary, no skills and, once subagents came from these same files, no
   * subagent rows either, for as long as the window stayed open. Only a hit is
   * cached; a miss costs one readdir until the file shows up.
   */
  private async transcript(sessionId: string): Promise<string | undefined> {
    const hit = this.located.get(sessionId);
    if (hit) return hit;
    const found = await findTranscript(this.projectsDir, sessionId);
    if (found) this.located.set(sessionId, found);
    return found;
  }

  /** The tail, re-read only when the transcript has been written since. */
  private async tailFor(sessionId: string): Promise<TranscriptTail> {
    const file = await this.transcript(sessionId);
    if (!file) return { title: "", finished: [], skills: [] };
    let mtimeMs: number;
    try {
      mtimeMs = (await fs.promises.stat(file)).mtimeMs;
    } catch {
      // Gone (a deleted session): forget it, so a new transcript for the same
      // id would be found again rather than serving a stale read forever.
      this.located.delete(sessionId);
      this.cache.delete(sessionId);
      this.titles.delete(sessionId);
      return { title: "", finished: [], skills: [] };
    }
    const hit = this.cache.get(sessionId);
    if (hit && hit.mtimeMs === mtimeMs) return hit.tail;
    const tail = readTail(file);
    this.cache.set(sessionId, { mtimeMs, tail });
    const seen = this.finished.get(sessionId) ?? new Set<string>();
    for (const id of tail.finished) seen.add(id);
    this.finished.set(sessionId, seen);
    // Skills are the one thing here that needs a pass over the whole transcript
    // (see scanTranscript), and a long session's is megabytes: awaiting it put a
    // multi-megabyte read per live session on the path to the panel's first
    // render, which is the slowest thing a freshly opened window did. So seed
    // from the tail and let the scan land on a later refresh. A row shows the
    // skills its tail mentions in the meantime rather than none, and the poll
    // reposts within a second of the scan finishing.
    if (tail.title) this.titles.set(sessionId, tail.title);
    const known = this.skills.get(sessionId);
    const skills = known ?? [];
    for (const skill of tail.skills) {
      if (!skills.includes(skill)) skills.push(skill);
    }
    this.skills.set(sessionId, skills);
    if (!known) void this.fillFromScan(sessionId, file);
    return tail;
  }

  /**
   * Fill in what happened before the tail, off the refresh path.
   *
   * Once per session, and never twice at once: the 1s poll would otherwise start
   * a fresh scan of the same file every tick until the first one finished. The
   * result is merged rather than assigned, since tail reads keep adding to the
   * list while the scan runs, and dropped entirely if the session was retired
   * meanwhile. The title is only filled IN, never over: a window opening onto a
   * session titled long ago gets its title from here, but anything the tail has
   * since produced is newer than anything the scan can find.
   */
  private async fillFromScan(sessionId: string, file: string): Promise<void> {
    if (this.scanning.has(sessionId)) return;
    this.scanning.add(sessionId);
    try {
      const scanned = await scanTranscript(file);
      const seeded = this.skills.get(sessionId);
      if (!seeded) return; // retained away mid-scan: nothing to fill in
      if (scanned.title && !this.titles.get(sessionId)) {
        this.titles.set(sessionId, scanned.title);
      }
      // Scan order first (it is first-use order over the whole file), then
      // anything only the tail has seen, which is by definition newer.
      const merged = [...scanned.skills];
      for (const skill of seeded) {
        if (!merged.includes(skill)) merged.push(skill);
      }
      this.skills.set(sessionId, merged);
    } catch {
      /* unreadable or gone: the tail-seeded list stands */
    } finally {
      this.scanning.delete(sessionId);
    }
  }

  /** Claude's generated work summary for this session, or "". */
  async titleFor(sessionId: string): Promise<string> {
    await this.tailFor(sessionId);
    return this.titles.get(sessionId) ?? "";
  }

  /** The skills this session has invoked, deduped, in first-use order. */
  async skillsFor(sessionId: string): Promise<string[]> {
    await this.tailFor(sessionId);
    return this.skills.get(sessionId) ?? [];
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
    let cache = this.subagentDirs.get(sessionId);
    if (!cache) {
      cache = newSubagentDirCache();
      this.subagentDirs.set(sessionId, cache);
    }
    const finished = this.finished.get(sessionId) ?? new Set<string>();
    const found = await readSubagents(dir, { cache, finished });
    if (!found.length) return [];
    const live = liveSubagents(found, finished);
    // Anything dropped for silence is skipped by later polls, so a session that
    // has run dozens of subagents stops re-stating all of them every second.
    rememberRetired(cache, found, live);
    // `toolUseId` and `lastActivity` are how a row is judged, not part of it.
    return live.map(({ toolUseId, lastActivity, ...row }) => row);
  }

  /** Drop sessions that are no longer live, so nothing grows without bound in a
   *  long-lived window. */
  retain(sessionIds: Set<string>): void {
    const maps: Map<string, unknown>[] = [
      this.located,
      this.cache,
      this.finished,
      this.skills,
      this.titles,
      this.subagentDirs,
    ];
    for (const map of maps) {
      for (const id of [...map.keys()]) {
        if (!sessionIds.has(id)) map.delete(id);
      }
    }
  }
}
