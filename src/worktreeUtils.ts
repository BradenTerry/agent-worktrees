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
