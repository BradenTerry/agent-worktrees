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

/** Working-tree state of a single worktree, relative to its upstream. */
export interface GitStatus {
  /** Number of changed/untracked entries (0 means clean). */
  dirty: number;
  /** Commits ahead of the upstream branch. */
  ahead: number;
  /** Commits behind the upstream branch. */
  behind: number;
}

/**
 * Summarize the working-tree state of a worktree using
 * `git status --porcelain=v2 --branch`: a count of changed entries plus the
 * ahead/behind distance from the upstream branch.
 */
export async function getStatus(cwd: string): Promise<GitStatus> {
  let dirty = 0;
  let ahead = 0;
  let behind = 0;
  try {
    const { stdout } = await execAsync("git status --porcelain=v2 --branch", {
      cwd,
    });
    for (const raw of stdout.split("\n")) {
      const line = raw.trimEnd();
      if (line === "") continue;
      if (line.startsWith("# branch.ab ")) {
        // e.g. "# branch.ab +2 -1"
        const m = line.match(/\+(\d+)\s+-(\d+)/);
        if (m) {
          ahead = Number(m[1]);
          behind = Number(m[2]);
        }
      } else if (!line.startsWith("#")) {
        // 1/2/u = tracked changes, ? = untracked, ! = ignored (excluded below).
        if (line[0] !== "!") dirty++;
      }
    }
  } catch {
    /* leave zeros on error */
  }
  return { dirty, ahead, behind };
}

/**
 * Create a new worktree at `dir`. When `branch` does not already exist it is
 * created from `base` (default HEAD); otherwise the existing branch is checked
 * out. Returns nothing on success and throws with git's stderr on failure.
 */
export async function addWorktree(
  repoRoot: string,
  dir: string,
  branch: string,
  base = "HEAD"
): Promise<void> {
  const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
  try {
    await execAsync(
      `git worktree add -b ${q(branch)} ${q(dir)} ${q(base)}`,
      { cwd: repoRoot }
    );
  } catch (err) {
    // Branch may already exist; fall back to checking it out into the worktree.
    const msg = String((err as { stderr?: string }).stderr ?? err);
    if (/already exists/i.test(msg)) {
      await execAsync(`git worktree add ${q(dir)} ${q(branch)}`, {
        cwd: repoRoot,
      });
    } else {
      throw new Error(msg.trim());
    }
  }
}

/** Remove a worktree. Passes `--force` only when explicitly requested. */
export async function removeWorktree(
  repoRoot: string,
  dir: string,
  force = false
): Promise<void> {
  const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
  try {
    await execAsync(
      `git worktree remove ${force ? "--force " : ""}${q(dir)}`,
      { cwd: repoRoot }
    );
  } catch (err) {
    const msg = String((err as { stderr?: string }).stderr ?? err);
    throw new Error(msg.trim());
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
