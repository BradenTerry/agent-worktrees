import * as path from "path";

/**
 * Pure helpers with no VS Code dependency, so they can be unit-tested directly.
 */

/** Canonical absolute path: resolved, with any trailing slash removed. */
export function normalizePath(p: string): string {
  return path.resolve(p).replace(/[\\/]+$/, "");
}
