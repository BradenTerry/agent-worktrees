import * as path from "path";

/**
 * Pure helpers with no VS Code dependency, so they can be unit-tested directly.
 */

/**
 * Directory for a worktree the extension creates for `branch`: nested in the
 * primary worktree under `.claude/worktrees/`, matching where Claude Code's own
 * `claude -w` puts its worktrees, so every creation path lands in one place
 * (instead of littering the repo's parent directory). Named after the branch
 * with path-hostile characters collapsed to "-".
 */
export function worktreeDirFor(primary: string, branch: string): string {
  return path.join(
    primary,
    ".claude",
    "worktrees",
    branch.trim().replace(/[^\w.-]+/g, "-")
  );
}

/**
 * Count of agents that need the user (status "waiting") across all worktrees.
 * Drives the number badge on the panel's Activity Bar icon.
 */
export function countWaitingAgents(
  worktrees: ReadonlyArray<{ agents: ReadonlyArray<{ status: string }> }>
): number {
  let n = 0;
  for (const wt of worktrees) {
    for (const a of wt.agents) if (a.status === "waiting") n++;
  }
  return n;
}

/**
 * Whether this host titles agent terminals from the CLI's own OSC title escape
 * sequence, which is what lets Claude Code name its tab (background tabs
 * included) instead of the extension renaming it.
 *
 * VS Code 1.117 is where the terminal label computer started recognising an
 * agent CLI from that sequence and swapping the tab title template to
 * `${sequence}`; `terminal.integrated.tabs.allowAgentCliTitle` (default true)
 * turns it off. Below that, or opted out, the template stays `${process}` and an
 * unnamed agent tab would just read "node", so the extension names it instead.
 *
 * Platform-independent: the sequence is the same on Windows, macOS and Linux
 * (VS Code notes it as the only cross-platform signal, since agent CLIs all run
 * as `node`). Split by hand rather than semver-parsed because `vscode.version`
 * can carry a suffix (e.g. "1.117.0-insider").
 */
export function supportsAgentCliTitle(
  version: string,
  allowAgentCliTitle: boolean
): boolean {
  if (!allowAgentCliTitle) return false;
  const [major, minor] = version
    .split(".")
    .map((part) => parseInt(part, 10));
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  return major > 1 || (major === 1 && minor >= 117);
}

/**
 * The path a repository's per-repo settings are stored under: its primary
 * worktree.
 *
 * `git rev-parse --show-toplevel` reports the *open* folder's top level, which
 * in a linked worktree is that worktree, not the repository's primary one. So
 * the repo root is a per-window value, and keying settings by it gives one
 * window's list a different key from the next. Every writer of the linked-files
 * list already keys by the primary worktree (`git worktree list`), so readers
 * must do the same or a worktree window reads an entry that was never written.
 *
 * Falls back to `repoRoot` when the worktree list is unavailable (a failed
 * `git worktree list` leaves it empty), which is the primary worktree's own
 * path whenever the open folder is the primary one.
 */
export function repoSettingsKey(
  repoRoot: string | undefined,
  worktrees: ReadonlyArray<{ path: string; isPrimary: boolean }>
): string | undefined {
  return worktrees.find((wt) => wt.isPrimary)?.path ?? repoRoot;
}

/**
 * The worktrees a linked-files sweep still has to visit: everything except the
 * primary (which holds the real files the links point at) and the ones this
 * window has already linked.
 *
 * Deliberately not "the ones the panel created": a worktree can arrive from
 * `claude -w`, from a subagent isolating itself, or from `git worktree add` in a
 * terminal, and those are exactly the ones that used to be left without the
 * files. Membership is by canonical path, so `git worktree list` and a stored
 * key compare equal on Windows too.
 */
export function worktreesNeedingLinks(
  primary: string,
  worktreePaths: readonly string[],
  linked: ReadonlySet<string>
): string[] {
  const primaryKey = pathKey(primary);
  return worktreePaths.filter((p) => {
    const key = pathKey(p);
    return key !== primaryKey && !linked.has(key);
  });
}

/**
 * Comparison key for a path, for the places two paths from *different sources*
 * have to be recognized as the same worktree.
 *
 * `normalizePath` cannot do this itself: its result is also used as a real path
 * (a linked file's relative entry is derived from it, and that entry is stored
 * and displayed), so it has to preserve case. This does not - it is only ever a
 * key - so it can fold case on the platforms whose filesystems do.
 *
 * The mismatch is not hypothetical. The panel compares paths that arrive from
 * `git worktree list` (the case on disk), from Claude's session registry (the
 * case the user typed to `cd` there), and from the Git extension's `rootUri`
 * (the workspace folder's case). On Windows and macOS those routinely differ in
 * case for the same directory, and every difference was a silent miss: an agent
 * whose row landed on no card, a Source Control button that never highlighted,
 * a worktree the poll re-stat'd because it looked unwatched.
 *
 * Case only. Symlinks (`/tmp` vs `/private/tmp`) still compare unequal; that
 * needs a `realpath` per path, which is I/O, and this is called on hot paths.
 */
export function pathKey(p: string): string {
  const normalized = normalizePath(p);
  return CASE_INSENSITIVE_FS ? normalized.toLowerCase() : normalized;
}

/** Windows always, macOS by default (APFS can be formatted case-sensitive, but
 *  case-folding a key there costs a missed match only for two worktrees whose
 *  paths differ solely in case, which is not a thing anyone has). */
const CASE_INSENSITIVE_FS =
  process.platform === "win32" || process.platform === "darwin";

/** Whether two paths name the same location, for the sources above. */
export function samePathKey(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

/** Canonical absolute path: resolved, with any trailing slash removed. */
export function normalizePath(p: string): string {
  const resolved = path.resolve(p).replace(/[\\/]+$/, "");
  // On Windows, VS Code's Uri.fsPath lowercases the drive letter (e.g.
  // "c:\\repo") while `git worktree list` emits it uppercase ("C:\\repo").
  // The filesystem is case-insensitive, so canonicalize the drive letter to
  // lowercase; otherwise the same worktree compares unequal between the two
  // sources and the Source Control scope button neither highlights nor applies.
  return resolved.replace(/^([a-zA-Z]):/, (_m, d) => d.toLowerCase() + ":");
}
