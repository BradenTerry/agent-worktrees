import * as vscode from "vscode";
import * as path from "path";
import { findRepoRoot, listWorktrees, getStatus, GitStatus } from "./git";

/**
 * Lifecycle status of an agent session, derived from Claude Code hooks.
 * - active:  doing work (a prompt is being processed or a tool is running)
 * - waiting: needs user interaction (a permission prompt or a question)
 * - idle:    completed its task, or freshly created
 */
export type AgentStatus = "active" | "waiting" | "idle";

/** A single agent session created within a worktree. */
export interface AgentVM {
  id: number;
  label: string;
  status: AgentStatus;
  /** Epoch ms when the session was created. */
  startedAt: number;
  /** Epoch ms of the most recent hook event. */
  lastActivity: number;
}

/** View-model for a single worktree row sent to the webview. */
export interface WorktreeVM {
  path: string;
  name: string;
  branch?: string;
  isPrimary: boolean;
  detached: boolean;
  locked: boolean;
  inWorkspace: boolean;
  git?: GitStatus;
  agents: AgentVM[];
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

/** Highest-priority agent status on a worktree, for attention sorting. */
function attentionRank(wt: WorktreeVM): number {
  if (wt.agents.some((a) => a.status === "waiting")) return 0;
  if (wt.agents.some((a) => a.status === "active")) return 1;
  return 2;
}

/** Gather worktrees of the repo containing the first workspace folder. */
export async function gatherWorktrees(
  agentsByPath?: Map<string, AgentVM[]>
): Promise<WorktreeData> {
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

  // Fetch git status for every worktree concurrently.
  const statuses = await Promise.all(worktrees.map((wt) => getStatus(wt.path)));

  const vms: WorktreeVM[] = worktrees.map((wt, i) => ({
    path: wt.path,
    name: wt.branch ?? path.basename(wt.path),
    branch: wt.branch,
    isPrimary: wt.isPrimary,
    detached: wt.detached,
    locked: wt.locked,
    inWorkspace: openPaths.has(normalize(wt.path)),
    git: statuses[i],
    agents: agentsByPath?.get(normalize(wt.path)) ?? [],
  }));

  // Primary stays pinned to the top; the rest float by attention so worktrees
  // with a waiting/active agent surface first.
  vms.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return attentionRank(a) - attentionRank(b);
  });

  return { repoRoot, repoName: path.basename(repoRoot), worktrees: vms };
}
