import * as path from "path";

/**
 * Pure helpers with no VS Code dependency, so they can be unit-tested directly.
 */

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
