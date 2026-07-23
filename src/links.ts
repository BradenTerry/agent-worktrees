import * as fs from "fs";
import * as path from "path";

/**
 * Symlinking repo files into worktrees. A fresh `git worktree add` only checks
 * out tracked content, so gitignored local files a build/test needs (e.g.
 * `appsettings.Development.json`, a `.env`, a local certs dir) are absent in the
 * new worktree. The user configures a per-repo list of such paths; this module
 * links each one from the worktree back at the primary worktree's copy, so every
 * worktree shares one source of truth.
 *
 * Kept free of any VS Code dependency so the link logic is unit-tested directly
 * against a temp directory.
 *
 * ## Windows
 *
 * Creating a *file* symlink on Windows needs Developer Mode or an elevated
 * process; most users have neither, so a plain `symlink()` would hand them
 * EPERM and nothing else. Two fallbacks make the feature work unelevated:
 *
 *  - **directories** use a junction, which never needs elevation, and
 *  - **files** fall back to a hard link, which also never needs elevation.
 *
 * A hard link is a second directory entry for the same file data, so reads and
 * in-place writes are shared exactly like a symlink. It has two limits worth
 * knowing: both entries must be on one volume (always true here, since the
 * panel nests worktrees inside the repo at `.claude/worktrees/`), and an editor
 * that "saves" by writing a temp file and renaming over the original replaces
 * the directory entry rather than the data, which breaks the pairing. Symlinks
 * are therefore always preferred and the hard link is only a fallback.
 */

const IS_WIN = process.platform === "win32";

/** What happened when we tried to link one configured path. */
export interface LinkOutcome {
  /** The repo-relative path from the configured list. */
  path: string;
  status:
    | "linked" // link created (or an existing stale link re-pointed)
    | "unchanged" // a correct link was already there
    | "missing-source" // nothing at that path in the primary worktree
    | "skipped-real" // a real (unrelated) file already sits at the target
    | "invalid" // path escapes the repo / worktree (e.g. contains "..")
    | "error";
  /** How the link was made, when one was. Surfaced mainly so the Windows
   *  hard-link fallback is visible when diagnosing. */
  method?: "symlink" | "junction" | "hardlink";
  /** Human-readable reason, set for every non-success status. */
  message?: string;
}

/**
 * Windows `readlink` reports junctions (and often symlinks) as extended-length
 * paths - `\\?\C:\repo\certs`. Comparing that raw against a normal absolute path
 * never matches, which would make every run think the link was stale: it would
 * be torn down and rebuilt each refresh, and unlink would refuse to remove it as
 * "not ours". Strip the prefix before comparing.
 */
export function stripExtendedPrefix(p: string): string {
  return p.replace(/^\\\\\?\\/, "");
}

/** Compare two absolute paths the way the host filesystem does. Windows (and a
 *  default macOS volume) are case-insensitive, so an exact string compare would
 *  wrongly call `C:\Repo\a.json` and `c:\repo\a.json` different files. */
function samePath(a: string, b: string): boolean {
  const na = path.resolve(stripExtendedPrefix(a));
  const nb = path.resolve(stripExtendedPrefix(b));
  return IS_WIN ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

/**
 * Whether `child` is `parent` itself or lies beneath it, so a configured path
 * can never point outside the repo (or land outside the worktree). `path.relative`
 * is already case-insensitive on win32, matching the filesystem.
 */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** What currently occupies the target path. */
type TargetState =
  | { kind: "none" }
  | { kind: "ours"; isDirLink: boolean } // our link, already pointing at source
  | { kind: "foreign-link"; isDirLink: boolean } // a link pointing elsewhere
  | { kind: "real" }; // a genuine file/dir we must never touch

/**
 * Classify whatever sits at `target` relative to `source`.
 *
 * Symlinks and junctions are identified by resolving the link. Hard links (the
 * Windows fallback) are indistinguishable from a regular file by `lstat`, so
 * they are identified by identity instead: same device + same inode means the
 * two entries are literally the same file. `ino` can be 0 on filesystems that
 * do not report one, so that case is treated as a real file - refusing to touch
 * something we cannot prove is ours is the safe direction to fail.
 */
async function classifyTarget(
  source: string,
  target: string,
  srcStat: fs.Stats
): Promise<TargetState> {
  let existing: fs.Stats;
  try {
    existing = await fs.promises.lstat(target);
  } catch {
    return { kind: "none" };
  }

  if (existing.isSymbolicLink()) {
    // A junction reports as a symbolic link on Node, so this covers both.
    // Whether it needs rmdir depends on what the *link* resolves to, not on the
    // source; a broken link falls back to the source's type as a best guess.
    let isDirLink = srcStat.isDirectory();
    try {
      isDirLink = (await fs.promises.stat(target)).isDirectory();
    } catch {
      /* broken link: keep the guess */
    }
    try {
      const current = await fs.promises.readlink(target);
      // A relative link resolves against the link's own directory.
      const resolved = path.resolve(
        path.dirname(target),
        stripExtendedPrefix(current)
      );
      return samePath(resolved, source)
        ? { kind: "ours", isDirLink }
        : { kind: "foreign-link", isDirLink };
    } catch {
      return { kind: "foreign-link", isDirLink };
    }
  }

  // Not a link. It may still be a hard link we created on Windows.
  if (
    existing.isFile() &&
    srcStat.isFile() &&
    existing.ino !== 0 &&
    existing.ino === srcStat.ino &&
    existing.dev === srcStat.dev
  ) {
    return { kind: "ours", isDirLink: false };
  }

  return { kind: "real" };
}

/**
 * Delete a link we created. On Windows a *directory* junction/symlink must be
 * removed with `rmdir`; `unlink` fails on it with EPERM. Removing either kind of
 * link never touches the data it points at.
 */
async function removeLink(target: string, isDirLink: boolean): Promise<void> {
  // Windows needs rmdir for a directory junction/symlink (unlink rejects it);
  // POSIX needs unlink for a directory symlink (rmdir fails with ENOTDIR). Try
  // the platform's preferred call first and the other as a fallback, so neither
  // a junction nor a POSIX dir symlink can be left behind.
  const rmdir = () => fs.promises.rmdir(target);
  const unlink = () => fs.promises.unlink(target);
  const [first, second] =
    isDirLink && IS_WIN ? [rmdir, unlink] : [unlink, rmdir];
  try {
    await first();
  } catch (err) {
    try {
      await second();
    } catch {
      throw err; // report the platform-appropriate failure, not the fallback's
    }
  }
}

/**
 * Create the actual link. Directories use a junction on Windows (`dir` symlink
 * elsewhere). Files prefer a real symlink and fall back to a hard link when the
 * platform refuses - which on Windows is the unelevated, Developer-Mode-off
 * default, i.e. the common case.
 */
async function createLink(
  source: string,
  target: string,
  srcStat: fs.Stats
): Promise<{ method: LinkOutcome["method"] }> {
  if (srcStat.isDirectory()) {
    await fs.promises.symlink(source, target, IS_WIN ? "junction" : "dir");
    return { method: IS_WIN ? "junction" : "symlink" };
  }
  try {
    await fs.promises.symlink(source, target, "file");
    return { method: "symlink" };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // EPERM/EACCES: no symlink privilege (Windows without Developer Mode).
    // UNKNOWN: what some Windows configurations report for the same thing.
    if (code !== "EPERM" && code !== "EACCES" && code !== "UNKNOWN") throw err;
    await fs.promises.link(source, target);
    return { method: "hardlink" };
  }
}

/**
 * Link `<repoRoot>/<rel>` into `<worktreeDir>/<rel>`.
 *
 * Safe by construction: it never replaces a real file (only a link of our own,
 * or one pointing at a stale location, is rebuilt), skips paths that would
 * escape the repo or the worktree, and skips paths absent from the primary
 * worktree.
 */
async function linkOne(
  repoRoot: string,
  worktreeDir: string,
  rel: string
): Promise<LinkOutcome> {
  const source = path.resolve(repoRoot, rel);
  const target = path.resolve(worktreeDir, rel);
  if (!isInside(repoRoot, source) || !isInside(worktreeDir, target)) {
    return {
      path: rel,
      status: "invalid",
      message: `"${rel}" resolves outside the repository.`,
    };
  }

  let srcStat: fs.Stats;
  try {
    srcStat = await fs.promises.stat(source);
  } catch {
    return {
      path: rel,
      status: "missing-source",
      message: `Nothing to link: "${rel}" does not exist in the repository.`,
    };
  }

  const state = await classifyTarget(source, target, srcStat);
  if (state.kind === "ours") return { path: rel, status: "unchanged" };
  if (state.kind === "real") {
    return {
      path: rel,
      status: "skipped-real",
      message: `A real file already exists at "${rel}" in the worktree; left untouched.`,
    };
  }

  try {
    if (state.kind === "foreign-link") {
      await removeLink(target, state.isDirLink);
    }
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const { method } = await createLink(source, target, srcStat);
    return { path: rel, status: "linked", method };
  } catch (err) {
    return { path: rel, status: "error", message: describeLinkError(err) };
  }
}

/** Turn a raw filesystem error into something a user can act on. The Windows
 *  privilege case is the one worth naming explicitly. */
function describeLinkError(err: unknown): string {
  const e = err as NodeJS.ErrnoException;
  if (IS_WIN && (e.code === "EPERM" || e.code === "EACCES")) {
    return (
      "Windows refused to create the link. Turn on Developer Mode " +
      "(Settings > System > For developers) or run VS Code as administrator."
    );
  }
  if (e.code === "EXDEV") {
    return "The worktree is on a different drive, so the file could not be hard linked.";
  }
  return e.message ?? String(err);
}

/**
 * Link every configured path into `worktreeDir`, in order, collecting an outcome
 * per path. Blank entries are ignored. Never throws: a per-path failure is
 * reported in its outcome so one bad entry can't abort the rest (or the worktree
 * creation that calls this).
 */
export async function linkPathsIntoWorktree(
  repoRoot: string,
  worktreeDir: string,
  relPaths: readonly string[]
): Promise<LinkOutcome[]> {
  const out: LinkOutcome[] = [];
  for (const raw of relPaths) {
    const rel = normalizeRel(raw);
    if (!rel) continue;
    out.push(await linkOne(repoRoot, worktreeDir, rel));
  }
  return out;
}

/**
 * Canonicalize a configured entry. The stored contract is a repo-relative path
 * with forward slashes (what git emits and what the settings UI writes), so a
 * backslash is folded to a forward slash and any trailing separator dropped -
 * "certs\" and "certs/" and "certs" are one path.
 *
 * Doing this here, rather than trusting the caller, is what makes a
 * Windows-style path resolve identically on both platforms: `path.resolve` on
 * POSIX would otherwise treat the backslash in "cfg\a.json" as part of the
 * filename and look for a file that does not exist. The tradeoff - a POSIX file
 * whose name genuinely contains a backslash cannot be linked - is not reachable
 * through the UI, which never stores one.
 */
function normalizeRel(raw: string): string {
  return raw.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Statuses that mean the user should be told (not silently fine). */
export function linkFailures(outcomes: readonly LinkOutcome[]): LinkOutcome[] {
  return outcomes.filter(
    (o) => o.status !== "linked" && o.status !== "unchanged"
  );
}

/**
 * Remove the link this module created for `rel` in `worktreeDir`, so dropping a
 * path from the configured list actually stops linking it instead of leaving a
 * stale link behind.
 *
 * Deliberately narrow: it removes only a link proven to be ours - a symlink or
 * junction resolving to `<repoRoot>/<rel>`, or a hard link sharing that file's
 * identity. A real file, or a link the user pointed somewhere else, is left
 * exactly as it is, so this can never destroy content. Removing a link never
 * touches the data it points at.
 *
 * Returns true when a link was removed. Never throws.
 */
export async function unlinkPathFromWorktree(
  repoRoot: string,
  worktreeDir: string,
  rel: string
): Promise<boolean> {
  const clean = normalizeRel(rel);
  if (!clean) return false;
  const source = path.resolve(repoRoot, clean);
  const target = path.resolve(worktreeDir, clean);
  if (!isInside(repoRoot, source) || !isInside(worktreeDir, target)) {
    return false;
  }
  try {
    const srcStat = await fs.promises.stat(source);
    const state = await classifyTarget(source, target, srcStat);
    if (state.kind !== "ours") return false;
    await removeLink(target, state.isDirLink);
    return true;
  } catch {
    return false;
  }
}
