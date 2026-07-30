import * as vscode from "vscode";
import * as path from "path";
import {
  findRepoRoot,
  listWorktrees,
  listBranches,
  getStatus,
  fetchRemotes,
  mapLimit,
  releaseStaleClaudeLocks,
  GitStatus,
} from "./git";
import { normalizePath } from "./worktreeUtils";
import { indexRegistry, RegistrySession } from "./sessionRegistry";
import { TranscriptReader } from "./transcript";
import { DebugSessionVM } from "./debugRun";
import { GithubConnection, PrInfo, BranchPrInfo } from "./github";
import { diag } from "./diagnostics";

/**
 * Lifecycle status of an agent session, as Claude Code records it for that
 * session (see sessionRegistry). A session it says nothing about reads idle.
 * - active:  doing work (a prompt is being processed or a tool is running)
 * - waiting: needs user interaction (a permission prompt or a question)
 * - idle:    completed its task, or freshly created
 */
export type AgentStatus = "active" | "waiting" | "idle";

/** A subagent that is running right now under a parent session. */
export interface SubagentVM {
  /** Claude Code's id for the subagent; unique within its parent session. */
  id: string;
  /** Agent type, e.g. "Explore" or "general-purpose", when known. */
  type?: string;
  /** What the Agent tool was asked to do (its `description`), when known. */
  task?: string;
  /** True when the subagent has stopped its turn but is still in flight —
   *  parked on a background command that will wake it again. */
  paused?: boolean;
  /** True when a permission decision for one of this subagent's tool calls is
   *  outstanding. On its own this does not mean the user is being asked (auto
   *  mode and allowlists settle most of them); it identifies WHICH subagent is
   *  behind the prompt when the session as a whole is waiting. */
  awaitingPermission?: boolean;
  /** Epoch ms when the subagent started. */
  startedAt: number;
  /** Worktree the subagent is working in, when that is NOT its parent session's
   *  (an isolated worktree gives it a cwd of its own). Absent means it shares
   *  the parent's worktree, which is the common case. */
  worktree?: string;
}

/**
 * A subagent shown on a worktree card that is not its parent session's, because
 * it was given that worktree to work in. It is not an agent of its own — there
 * is no session or terminal behind it — so it carries who to talk to instead.
 */
export interface WorktreeSubagentVM extends SubagentVM {
  /** Session that spawned it; clicking the row reveals that session's terminal. */
  parentSessionId: string;
  /** That session's row label, so the row can say where it came from. */
  parentLabel: string;
  /** The parent session's status, which decides whether an outstanding
   *  permission decision means the user is actually being asked. */
  parentStatus: AgentStatus;
}

/** A single agent session created within a worktree. */
export interface AgentVM {
  /** Claude session id; ties the panel row to its terminal. */
  sessionId: string;
  /** Display name: work summary, else a default. */
  label: string;
  /** The work summary (Claude's generated title), when known. */
  summary?: string;
  /** Bare names of skills this session has invoked (deduped, in first-use order). */
  skills?: string[];
  /** Subagents currently running under this session, oldest first. Finished
   *  ones are dropped, so this is "what is running now", not a tally. */
  subagents?: SubagentVM[];
  status: AgentStatus;
  /** Epoch ms when the session started. */
  startedAt: number;
  /** Epoch ms of the session's last recorded transition. */
  lastActivity: number;
}

/**
 * The live agents, indexed by the worktree path each one is running in (keyed by
 * `normalize(path)`), plus the subagents that were handed a worktree of their
 * own, indexed under THAT worktree so they show on the card for the code they
 * are touching.
 */
export interface SessionIndex {
  agents: Map<string, AgentVM[]>;
  subagents: Map<string, WorktreeSubagentVM[]>;
  /** Session and subagent working directories that are not themselves one of the
   *  given paths, so the row landed on a card further up the tree (usually the
   *  repo root's) or on none at all. Both a `claude -w` session and a subagent
   *  handed a worktree of its own get a real worktree created inside the repo
   *  after the panel last listed worktrees, and it looks exactly like this until
   *  the list is refreshed - so this is the caller's cue to re-gather (see
   *  refreshAgents). */
  unplaced: string[];
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
  /** Subagents working in this worktree whose parent session lives in another
   *  one. Rendered as rows on this card, alongside (or instead of) its agents. */
  subagents?: WorktreeSubagentVM[];
  /** GitHub PR status for this worktree's branch (when the integration is on
   *  and a PR exists). null = looked up, no PR; undefined = not looked up. */
  pr?: PrInfo | null;
  /** True when this worktree's repository is currently open in the Source
   *  Control view (i.e. the scope is "set"). Only set when the SCM integration
   *  is enabled. */
  scmActive?: boolean;
  /** True when this worktree has launch configurations of its own, which is what
   *  puts the Debug button on the card. Re-read on each full refresh. */
  canDebug?: boolean;
  /** Debug sessions this extension started in this worktree, so the card can
   *  offer a stop button for each (the Run and Debug view cannot be retargeted,
   *  so the panel owns both ends). */
  debugSessions?: DebugSessionVM[];
}

/**
 * What Settings → Performance shows about this repository: whether git's two
 * `status` accelerators are on, and whether they can be. The panel runs `git
 * status` per worktree repeatedly, so these are the difference between a
 * near-instant refresh and a slow one on a large repo - but they live in the
 * user's own repo config, so the panel reports and offers rather than acting.
 */
export interface GitPerfVM {
  /** `core.untrackedCache` is on. */
  untrackedCache: boolean;
  /** `core.fsmonitor` is on: git's own daemon, or the user's own hook program
   *  (which we report and leave alone). */
  fsmonitor: false | "builtin" | "hook";
  /** Whether the built-in monitor can be turned on here, and if not, why: this
   *  git is too old for it, or git has no backend for this platform (where
   *  enabling it would break `git status` rather than speed it up). */
  fsmonitorSupport: "yes" | "old-git" | "platform";
  /** `git update-index --test-untracked-cache` passed, i.e. this filesystem
   *  reports directory mtimes the cache needs. Undefined until tested. */
  untrackedCacheOk?: boolean;
  /** A `git status` in this window was slow enough to be worth fixing, so the
   *  tab says so instead of presenting this as a micro-optimization. */
  statusWasSlow?: boolean;
}

export interface WorktreeData {
  repoRoot?: string;
  repoName?: string;
  worktrees: WorktreeVM[];
  /** GitHub connection summary for the settings modal. */
  github?: GithubConnection;
  /** Whether the PR integration is toggled on. */
  prEnabled?: boolean;
  /** Whether the Source Control scope button is enabled on worktrees. */
  scmEnabled?: boolean;
  /** Whether debug tracing (the diagnostics output channel) is enabled. */
  traceEnabled?: boolean;
  /** State of git's two `status` accelerators in this repo, for Settings →
   *  Performance. Attached only once that tab has asked for it: reading it is
   *  git calls, and no other view shows it. */
  gitPerf?: GitPerfVM;
  /** Repo-relative paths symlinked into every worktree the extension creates
   *  (Settings -> Linked Files), so gitignored local config reaches worktrees. */
  linkedPaths?: string[];
  /** Session id of the agent whose terminal is currently active in the
   *  terminal panel, so the webview can highlight who the user is talking to. */
  activeSessionId?: string;
}

export function normalize(p: string): string {
  return normalizePath(p);
}

/** Repo root per workspace folder. A folder's containing repository cannot
 *  change within a session, and this lookup is a git spawn that used to run on
 *  every refresh (twice with the branches tab open). Only hits are cached, so
 *  a folder that becomes a repo later (git init) is still discovered. */
const repoRootCache = new Map<string, string>();

/** Primary worktree path per repo root (invariant for the repo's lifetime).
 *  Populated by gatherWorktrees so gatherBranches can name the repo without
 *  its own `git worktree list` spawn. */
const primaryPathCache = new Map<string, string>();

/**
 * First workspace folder that lives in a git repository, with its repo root.
 */
async function findRepo(): Promise<
  { cwd: string; repoRoot: string } | undefined
> {
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    const key = f.uri.fsPath;
    let root = repoRootCache.get(key);
    if (!root) {
      root = (await findRepoRoot(key)) ?? undefined;
      if (root) repoRootCache.set(key, root);
    }
    if (root) return { cwd: key, repoRoot: root };
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
  fetch = false,
  registry: RegistrySession[] = [],
  reader?: TranscriptReader
): Promise<WorktreeData> {
  const repo = await findRepo();
  if (!repo) return { worktrees: [] };
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
    };
  }

  // Clear locks left behind by dead Claude sessions. `claude -w` locks the
  // worktree it creates and unlocks on exit, but a crashed or killed session
  // never gets there -- the panel would show a LOCKED badge on a worktree with
  // no agents, and removing it would fail. Only locks whose reason names a
  // claude pid that is no longer running are touched.
  try {
    const released = await releaseStaleClaudeLocks(repoRoot, worktrees);
    for (const p of released) diag(`gatherWorktrees: released stale claude lock on ${p}`);
  } catch {
    /* cleanup is best-effort; the badge just stays until the next refresh */
  }

  const openPaths = new Set(
    (vscode.workspace.workspaceFolders ?? []).map((f) =>
      normalize(f.uri.fsPath)
    )
  );

  // Fetch git status for every worktree concurrently, but bounded: each status
  // is 1-2 git spawns, and an unbounded burst over many worktrees is what makes
  // a refresh visibly expensive on Windows.
  const startedAt = Date.now();
  const statuses = await mapLimit(worktrees, 4, (wt) => getStatus(wt.path));
  diag(
    `gatherWorktrees: ${worktrees.length} worktrees in ${
      Date.now() - startedAt
    }ms`
  );

  // A subagent's worktree is whatever `git rev-parse` said about its cwd, which
  // is not guaranteed to be a worktree of THIS repo (a subagent can be pointed
  // anywhere). With no card to land on, its row would simply vanish, so drop the
  // relocation and let it render under its parent instead. The objects are
  // shared with the parent's own list, so clearing the field is all it takes.
  // Claude's live sessions become the agent rows, now that the cards they can
  // land on are known (see sessionRegistry). Each row's work summary is read
  // from that session's transcript.
  const summaries = new Map<string, string>();
  const subagents = new Map<string, SubagentVM[]>();
  const skills = new Map<string, string[]>();
  if (reader) {
    await Promise.all(
      registry.map(async (session) => {
        const [title, subs, used] = await Promise.all([
          reader.titleFor(session.sessionId),
          reader.subagentsFor(session.sessionId),
          reader.skillsFor(session.sessionId),
        ]);
        if (title) summaries.set(session.sessionId, title);
        if (subs.length) subagents.set(session.sessionId, subs);
        if (used.length) skills.set(session.sessionId, used);
      })
    );
  }
  const sessions = indexRegistry(
    registry,
    worktrees.map((wt) => wt.path),
    summaries,
    subagents,
    skills
  );

  const vms: WorktreeVM[] = worktrees.map((wt, i) => {
    const key = normalize(wt.path);
    const subagents = sessions.subagents.get(key) ?? [];
    return {
      path: wt.path,
      name: wt.branch ?? path.basename(wt.path),
      branch: wt.branch,
      isPrimary: wt.isPrimary,
      detached: wt.detached,
      locked: wt.locked,
      inWorkspace: openPaths.has(key),
      git: statuses[i],
      agents: sessions.agents.get(key) ?? [],
      ...(subagents.length ? { subagents } : {}),
    };
  });

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
  if (primary) primaryPathCache.set(repoRoot, primary.path);
  return {
    repoRoot,
    repoName: path.basename(primary?.path ?? repoRoot),
    worktrees: vms,
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
  /** Commits ahead of / behind the compare base (upstream, or the default
   *  branch when there is no upstream). */
  ahead: number;
  behind: number;
  /** The repo's default branch (e.g. main); never offered for deletion. */
  isDefault: boolean;
  /** Tip commit's committer date (ISO 8601): when the branch was last updated.
   *  The branches view sorts on this. */
  updatedAt?: string;
  /** Tip commit's committer name: "who last updated this branch". Drives the
   *  git-native user filter. */
  lastUser?: string;
  /** Tip commit's committer email, for stable user de-duplication. */
  lastEmail?: string;
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
  /** GitHub web base for this repo (https://github.com/owner/repo), attached by
   *  the webview when origin is a github.com remote. Used to link branch rows
   *  and the repo's branches page. */
  repoUrl?: string;
  /** Epoch ms of the last successful GitHub PR fetch for the branches view, or
   *  undefined if it has never been fetched ("Never"). */
  lastGithubRefresh?: number;
  /** True while an on-load GitHub refresh is in flight, so the view shows the
   *  Refresh GitHub button as busy until the follow-up post (with the fetched PR
   *  data) replaces it. */
  githubRefreshing?: boolean;
  /** Set when listing branches threw (e.g. git missing/hung/timed out). The view
   *  shows this instead of a misleading "No branches found", and it is logged to
   *  the "Agent Worktrees" output channel. */
  error?: string;
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
  } catch (err) {
    // Surface the failure instead of silently showing an empty list: log it to
    // the output channel and pass a message to the view. This is the breadcrumb
    // for "the Branches view never loads" reports we cannot reproduce locally.
    const msg = err instanceof Error ? err.message : String(err);
    diag(`gatherBranches: listBranches failed for ${repoRoot}: ${msg}`);
    return {
      repoRoot,
      repoName: path.basename(repoRoot),
      branches: [],
      error: msg,
    };
  }

  const vms: BranchVM[] = branches.map((b) => ({
    name: b.name,
    remoteOnly: b.remoteOnly,
    hasRemote: b.hasRemote,
    hasWorktree: b.hasWorktree,
    worktreePath: b.worktreePath,
    ahead: b.ahead,
    behind: b.behind,
    isDefault: b.isDefault,
    updatedAt: b.updatedAt,
    lastUser: b.lastUser,
    lastEmail: b.lastEmail,
  }));

  // Default to most-recently-updated first (the view re-sorts client-side, but
  // this keeps the order sensible for any consumer that doesn't). Branches with
  // no commit date fall to the end, then tie-break by name.
  vms.sort((a, b) => {
    const ta = a.updatedAt ? Date.parse(a.updatedAt) : NaN;
    const tb = b.updatedAt ? Date.parse(b.updatedAt) : NaN;
    const va = isNaN(ta) ? -Infinity : ta;
    const vb = isNaN(tb) ? -Infinity : tb;
    if (va !== vb) return vb - va;
    return a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  // Name the repo after its primary worktree so the header matches the sidebar
  // even when the open folder is a linked worktree. The path is invariant, so
  // reuse what gatherWorktrees already learned instead of a second
  // `git worktree list` in the same refresh; the spawn happens at most once,
  // when the branches tab loads before any sidebar gather.
  let primaryPath = primaryPathCache.get(repoRoot);
  if (!primaryPath) {
    try {
      const wts = await listWorktrees(repoRoot);
      primaryPath = wts.find((wt) => wt.isPrimary)?.path;
      if (primaryPath) primaryPathCache.set(repoRoot, primaryPath);
    } catch {
      /* fall back to repoRoot basename */
    }
  }
  return {
    repoRoot,
    repoName: path.basename(primaryPath ?? repoRoot),
    branches: vms,
  };
}
