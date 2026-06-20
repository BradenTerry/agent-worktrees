import * as vscode from "vscode";
import * as path from "path";
import {
  findRepoRoot,
  listWorktrees,
  listBranches,
  getStatus,
  fetchRemotes,
  GitStatus,
} from "./git";
import { normalizePath } from "./worktreeUtils";
import { GithubConnection, PrInfo, BranchPrInfo } from "./github";

/**
 * Lifecycle status of an agent session, derived from Claude Code hooks.
 * - active:  doing work (a prompt is being processed or a tool is running)
 * - waiting: needs user interaction (a permission prompt or a question)
 * - idle:    completed its task, or freshly created
 */
export type AgentStatus = "active" | "waiting" | "idle";

/** A single agent session created within a worktree. */
export interface AgentVM {
  /** Claude session id; ties the panel row to its terminal and state file. */
  sessionId: string;
  /** Display name: work summary, else a default. */
  label: string;
  /** The work summary (Claude's generated title), when known. */
  summary?: string;
  /** Bare names of skills this session has invoked (deduped, in first-use order). */
  skills?: string[];
  /** Count of subagents this session has spawned via the Task tool. */
  subagents?: number;
  status: AgentStatus;
  /** Epoch ms when the session was first seen. */
  startedAt: number;
  /** Epoch ms of the most recent hook event. */
  lastActivity: number;
}

/** A hook shown on the consent page (name + why it is needed). */
export interface HookInfoVM {
  label: string;
  description: string;
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
  /** GitHub PR status for this worktree's branch (when the integration is on
   *  and a PR exists). null = looked up, no PR; undefined = not looked up. */
  pr?: PrInfo | null;
  /** True when this worktree's repository is currently open in the Source
   *  Control view (i.e. the scope is "set"). Only set when the SCM integration
   *  is enabled. */
  scmActive?: boolean;
}

export interface WorktreeData {
  repoRoot?: string;
  repoName?: string;
  worktrees: WorktreeVM[];
  /** False until the user has accepted the agent-status hooks. */
  hooksInstalled: boolean;
  /** The hooks the consent page lists when they are not yet installed. */
  hooks?: HookInfoVM[];
  /** GitHub connection summary for the settings modal. */
  github?: GithubConnection;
  /** Whether the PR integration is toggled on. */
  prEnabled?: boolean;
  /** Whether the Source Control scope button is enabled on worktrees. */
  scmEnabled?: boolean;
}

export function normalize(p: string): string {
  return normalizePath(p);
}

/**
 * First workspace folder that lives in a git repository, with its repo root.
 */
async function findRepo(): Promise<
  { cwd: string; repoRoot: string } | undefined
> {
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    const root = await findRepoRoot(f.uri.fsPath);
    if (root) return { cwd: f.uri.fsPath, repoRoot: root };
  }
  return undefined;
}

/** Index of a path within the current workspace folders, or -1. */
export function folderIndex(fsPath: string): number {
  const target = normalize(fsPath);
  const folders = vscode.workspace.workspaceFolders ?? [];
  return folders.findIndex((f) => normalize(f.uri.fsPath) === target);
}

/** Gather worktrees of the repo containing the first workspace folder. */
export async function gatherWorktrees(
  agentsByPath?: Map<string, AgentVM[]>,
  hooksInstalled = false,
  fetch = false
): Promise<WorktreeData> {
  const repo = await findRepo();
  if (!repo) return { worktrees: [], hooksInstalled };
  const { repoRoot } = repo;

  // One fetch updates remote-tracking refs for every linked worktree, so the
  // behind ("commits to pull") count is current. Only on an explicit refresh.
  if (fetch) await fetchRemotes(repoRoot);

  let worktrees;
  try {
    worktrees = await listWorktrees(repoRoot);
  } catch {
    return {
      repoRoot,
      repoName: path.basename(repoRoot),
      worktrees: [],
      hooksInstalled,
    };
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

  // Primary worktree pinned to the top; the rest sorted by name.
  vms.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  // Name the repo after its primary worktree so the header is stable even when
  // the open folder is a linked worktree.
  const primary = worktrees.find((wt) => wt.isPrimary);
  return {
    repoRoot,
    repoName: path.basename(primary?.path ?? repoRoot),
    worktrees: vms,
    hooksInstalled,
  };
}

/** View-model for a single branch row in the branches overlay. */
export interface BranchVM {
  name: string;
  /** Exists only as origin/<name> (no local ref). */
  remoteOnly: boolean;
  /** A matching origin/<name> exists (distinguishes local + remote from local
   *  only; always true when remoteOnly). */
  hasRemote: boolean;
  /** A worktree currently has this branch checked out. */
  hasWorktree: boolean;
  /** That worktree's path, when hasWorktree. */
  worktreePath?: string;
  /** Commits ahead of / behind upstream (0 when no upstream or not local). */
  ahead: number;
  behind: number;
  /** PR rollup attached by the webview; null = looked up, no PR;
   *  undefined = not looked up (integration off or no token). */
  pr?: BranchPrInfo | null;
}

export interface BranchData {
  repoRoot?: string;
  repoName?: string;
  branches: BranchVM[];
  /** GitHub connection summary, attached by the webview. */
  github?: GithubConnection;
  /** Whether the PR integration is toggled on, attached by the webview. */
  prEnabled?: boolean;
  /** Authenticated login, attached by the webview so the "you" filters work. */
  viewerLogin?: string;
}

/**
 * Git-only branch list (no network). PR data + github fields are attached by
 * the webview, mirroring how gatherWorktrees + attachPrStatus split work.
 */
export async function gatherBranches(): Promise<BranchData> {
  const repo = await findRepo();
  if (!repo) return { branches: [] };
  const { repoRoot } = repo;

  let branches;
  try {
    branches = await listBranches(repoRoot);
  } catch {
    return { repoRoot, repoName: path.basename(repoRoot), branches: [] };
  }

  const vms: BranchVM[] = branches.map((b) => ({
    name: b.name,
    remoteOnly: b.remoteOnly,
    hasRemote: b.hasRemote,
    hasWorktree: b.hasWorktree,
    worktreePath: b.worktreePath,
    ahead: b.ahead,
    behind: b.behind,
  }));

  vms.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );

  // Name the repo after its primary worktree so the header matches the sidebar
  // even when the open folder is a linked worktree.
  let primaryPath: string | undefined;
  try {
    const wts = await listWorktrees(repoRoot);
    primaryPath = wts.find((wt) => wt.isPrimary)?.path;
  } catch {
    /* fall back to repoRoot basename */
  }
  return {
    repoRoot,
    repoName: path.basename(primaryPath ?? repoRoot),
    branches: vms,
  };
}
