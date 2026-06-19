import * as vscode from "vscode";
import * as path from "path";
import { findRepoRoot, listWorktrees } from "./git";

/** View-model for a single worktree row sent to the webview. */
export interface WorktreeVM {
  path: string;
  name: string;
  branch?: string;
  isPrimary: boolean;
  detached: boolean;
  locked: boolean;
  inWorkspace: boolean;
}

export interface WorktreeData {
  repoRoot?: string;
  repoName?: string;
  worktrees: WorktreeVM[];
}

export function normalize(p: string): string {
  return path.resolve(p).replace(/[\\/]+$/, "");
}

/** fsPath of the first workspace folder, used to locate the repository. */
function primaryFolder(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** Index of a path within the current workspace folders, or -1. */
export function folderIndex(fsPath: string): number {
  const target = normalize(fsPath);
  const folders = vscode.workspace.workspaceFolders ?? [];
  return folders.findIndex((f) => normalize(f.uri.fsPath) === target);
}

/** Gather worktrees of the repo containing the first workspace folder. */
export async function gatherWorktrees(): Promise<WorktreeData> {
  const cwd = primaryFolder();
  if (!cwd) return { worktrees: [] };

  const repoRoot = await findRepoRoot(cwd);
  if (!repoRoot) return { worktrees: [] };

  let worktrees;
  try {
    worktrees = await listWorktrees(repoRoot);
  } catch {
    return { repoRoot, repoName: path.basename(repoRoot), worktrees: [] };
  }

  const openPaths = new Set(
    (vscode.workspace.workspaceFolders ?? []).map((f) =>
      normalize(f.uri.fsPath)
    )
  );

  return {
    repoRoot,
    repoName: path.basename(repoRoot),
    worktrees: worktrees.map((wt) => ({
      path: wt.path,
      name: wt.branch ?? path.basename(wt.path),
      branch: wt.branch,
      isPrimary: wt.isPrimary,
      detached: wt.detached,
      locked: wt.locked,
      inWorkspace: openPaths.has(normalize(wt.path)),
    })),
  };
}
