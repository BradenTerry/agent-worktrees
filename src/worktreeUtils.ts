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
