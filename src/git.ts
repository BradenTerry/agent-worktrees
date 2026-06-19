import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface Worktree {
  /** Absolute path to the worktree directory. */
  path: string;
  /** Short branch name (e.g. "main"), or undefined when detached. */
  branch?: string;
  /** Commit SHA the worktree is checked out at. */
  head?: string;
  /** True for the main (primary) worktree of the repository. */
  isPrimary: boolean;
  /** True when the worktree is in detached-HEAD state. */
  detached: boolean;
  /** True when the worktree is locked. */
  locked: boolean;
}

/**
 * Resolve the top level of the git repository that `cwd` belongs to.
 * Returns undefined when `cwd` is not inside a git repository.
 */
export async function findRepoRoot(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync("git rev-parse --show-toplevel", {
      cwd,
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * List the worktrees of the repository containing `cwd`, parsed from
 * `git worktree list --porcelain`. The first entry is the primary worktree.
 */
export async function listWorktrees(cwd: string): Promise<Worktree[]> {
  const { stdout } = await execAsync("git worktree list --porcelain", { cwd });
  const worktrees: Worktree[] = [];
  let current: Partial<Worktree> | undefined;

  const flush = () => {
    if (current?.path) {
      worktrees.push({
        path: current.path,
        branch: current.branch,
        head: current.head,
        detached: current.detached ?? false,
        locked: current.locked ?? false,
        isPrimary: false,
      });
    }
    current = undefined;
  };

  for (const raw of stdout.split("\n")) {
    const line = raw.trimEnd();
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      flush();
      current = { path: line.slice("worktree ".length) };
    } else if (!current) {
      continue;
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      // e.g. "branch refs/heads/main" -> "main"
      current.branch = line
        .slice("branch ".length)
        .replace(/^refs\/heads\//, "");
    } else if (line === "detached") {
      current.detached = true;
    } else if (line === "locked" || line.startsWith("locked ")) {
      current.locked = true;
    }
  }
  flush();

  if (worktrees.length > 0) {
    worktrees[0].isPrimary = true;
  }
  return worktrees;
}
