import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as cp from "child_process";
import { randomUUID } from "crypto";
import {
  gatherWorktrees,
  gatherBranches,
  normalize,
  AgentVM,
  SessionIndex,
  SubagentVM,
  WorktreeData,
  WorktreeVM,
  BranchData,
  GitPerfVM,
} from "./worktreeData";
import {
  countWaitingAgents,
  repoSettingsKey,
  supportsAgentCliTitle,
  worktreeDirFor,
} from "./worktreeUtils";
import {
  linkPathsIntoWorktree,
  unlinkPathFromWorktree,
  linkFailures,
  LinkOutcome,
} from "./links";
import {
  addWorktree,
  addBranchWorktree,
  switchWorktreeBranch,
  listBranches,
  BranchInfo,
  removeWorktree,
  releaseStaleClaudeLocks,
  deleteBranch,
  detachWorktreeHead,
  goneBranches,
  defaultBranchName,
  unpushedCommitCount,
  getStatus,
  fetchRemotes,
  listWorktrees,
  mapLimit,
  getRemoteInfo,
  RemoteInfo,
  listIgnoredPaths,
  listWorktreeFiles,
  WORKTREE_FILE_CAP,
  readPerfConfig,
  setPerfSetting,
  PerfKey,
  gitFsmonitorSupport,
  untrackedCacheSupported,
  setSlowStatusHandler,
} from "./git";
import {
  indexRegistry,
  projectsDir,
  readRegistry,
  RegistryCache,
  registryDir,
  RegistrySession,
} from "./sessionRegistry";
import { systemProbes } from "./liveness";
import {
  isDescendantOf,
  namesClaude,
  parentMapSnapshot,
  readCommandLine,
} from "./processTree";
import { TranscriptReader } from "./transcript";
import { applyScopeScm, isScmActive, ScmModel } from "./scmScope";
import { DEFAULT_POLL_SECONDS, dueForStatus, pollIntervalMs } from "./statusPoll";
import {
  DebugSessionTracker,
  hasDebugTargets,
  startWorktreeDebug,
} from "./debugRun";
import {
  initGithub,
  connection,
  setToken,
  clearToken,
  fetchPrsByBranch,
  getToken,
  BranchPrInfo,
  GithubConnection,
} from "./github";
import { PrService, PrTarget } from "./prs";
import { Coalescer } from "./scheduler";
import { diag } from "./diagnostics";

/** Quiet period (ms) before a burst of file/session events triggers a refresh.
 *  Refreshing spawns git per worktree, so coalescing keeps a flood of watcher
 *  events (heaviest on Windows) down to one refresh. */
const REFRESH_DEBOUNCE_MS = 500;

/** How often the panel re-reads agent state while agents are on screen.
 *
 *  Everything else the panel shows changes on a signal it can watch: the session
 *  registry is rewritten on every status transition, so the watcher covers
 *  agent rows. Subagents are not in the registry (see subagents.ts) and they
 *  come and go entirely inside one of those statuses - a session stays `busy`
 *  from before it spawns one until after it collects the result, and writes its
 *  registry file exactly once for that whole span. With the watcher as the only
 *  signal, a subagent's row would appear only if some unrelated event happened
 *  to fire while it ran, which is why they looked like they never appeared at
 *  all. A subagent's own files (`subagents/agent-*.jsonl`) are the only place it
 *  is visible, so a poll is what makes the row show up.
 *
 *  It goes down the agent-only path with no pending pids: no git spawns, a
 *  readdir of the registry and of each session's subagents dir, and postData
 *  drops the post entirely unless something actually changed. It runs only
 *  while the view is visible AND at least one agent is on a card - an idle
 *  window, or one behind another view, polls nothing.
 *
 *  One second, because subagents are routinely short-lived: an agent handed a
 *  backgrounded job spawns, delegates and returns inside 3-5 seconds, and a
 *  slower cadence simply never sees it. A cycle measures ~1ms against a couple
 *  of live sessions (a readdir plus a handful of stats), so the interval is
 *  bounded by how often a row is worth repainting, not by what it costs. It
 *  still goes through the same 500ms coalescer as the watcher, so a burst of
 *  registry writes and a poll tick collapse into one refresh. */
const AGENT_POLL_MS = 1_000;

/** How long a card that has its own change event reuses its git status.
 *
 *  A worktree whose repository the Git extension has open re-stats when that
 *  repository's state moves (see onRepoStateChange), not on a timer, so this is
 *  only a backstop. It exists because "the Git extension will tell us" is an
 *  assumption the user can switch off underneath us (`git.autorefresh`), and a
 *  card that freezes forever is a worse failure than one that costs a status
 *  every half minute. See statusPoll.ts for the split.
 *
 *  Why a timer at all was ever needed: Claude writes its session file on status
 *  *transitions*, and one long turn is one status - measured at 39 seconds
 *  between writes on a session that was editing files throughout. Keying the
 *  re-stat purely off registry writes is what froze a card's counts mid-turn.
 *
 *  The card's refresh button and the global Refresh bypass this entirely, since
 *  they gather from scratch. */
const WATCHED_STATUS_TTL_MS = 30_000;

/** Setting holding the poll rate, in seconds, for a card with no change event of
 *  its own. Bounds and default live in statusPoll.ts, which is also what
 *  defends against a value settings.json should not contain. */
const POLL_SECONDS_SETTING = "agentWorktrees.statusPollSeconds";

/**
 * How many full gathers one un-carded working directory may trigger.
 *
 * A worktree an agent creates for itself is `git worktree add`-ed, chdir'd into
 * and registered by that agent within a few hundred ms, and a gather reads the
 * session registry before it spawns its git, so the first gather can land with
 * the worktree listed but its session not yet registered, or the other way
 * round. Giving up after exactly one (which is what a plain "already gathered"
 * set does) is what left a new card sitting there with no agent on it. A few
 * tries covers the race; a bound is still needed, because a cwd that can never
 * be a card (an agent in an unrelated repo) must not re-gather every second
 * for as long as it runs.
 *
 * Approximate on purpose: a try is counted when a gather *lands*, so while
 * gathers are slower than the 1s poll a stuck path can start a few more than
 * this before the count catches up. Bounding the burst is the point, not the
 * exact number - and counting on launch instead is what made a single lost race
 * permanent.
 */
const REGATHER_TRIES = 3;

/** globalState key for the opt-in Source Control scope button. */
const SCM_SCOPE_KEY = "agentWorktrees.scmScopeEnabled";
/** globalState key for the worktree the user last scoped Source Control to, so
 *  the panel highlights a single active scope independently of which repos the
 *  Git extension happens to keep open. */
const SCM_SCOPED_PATH_KEY = "agentWorktrees.scmScopedPath";

/** Config key for the debug-tracing toggle, surfaced in Settings → Debug. */
const TRACE_SETTING = "agentWorktrees.trace";

/** globalState key for the per-repo lists of files symlinked into new worktrees
 *  (Settings → Linked Files). Value is a map of repo root → relative paths; a
 *  map (not a single array) keeps each repo's list separate while living in the
 *  extension's own storage rather than the repo's .vscode/settings.json. */
const LINKED_PATHS_KEY = "agentWorktrees.linkedPaths";

/** Messages sent from the webview to the extension. */
interface ActionMessage {
  type: "action";
  action:
    | "refresh"
    | "refreshWorktree"
    | "agent"
    | "agentWorktree"
    | "focusAgent"
    | "stopAgent"
    | "newWorktree"
    | "removeWorktree"
    | "changeBranch"
    | "openWindow"
    | "searchWorktree"
    | "findWorktreeFile"
    | "openSettings"
    | "setGithubToken"
    | "clearGithubToken"
    | "togglePr"
    | "toggleScm"
    | "toggleTrace"
    | "loadGitPerf"
    | "setGitPerf"
    | "setPollSeconds"
    | "addLinkedPath"
    | "browseLinkedPath"
    | "pickIgnoredPaths"
    | "removeLinkedPath"
    | "relinkWorktrees"
    | "showLog"
    | "scopeScm"
    | "openBranches"
    | "loadBranches"
    | "fetchBranches"
    | "refreshGithub"
    | "worktreeFromBranch"
    | "deleteBranch"
    | "deleteGoneBranches"
    | "debugWorktree"
    | "stopDebug";
  path?: string;
  sessionId?: string;
  /** Debug session id, for stopDebug. */
  debugId?: string;
  /** GitHub PAT, for setGithubToken. */
  token?: string;
  /** New on/off state, for togglePr and setGitPerf; or the Prune choice for
   *  fetchBranches. */
  value?: boolean;
  /** Which git accelerator setGitPerf is flipping. */
  perfKey?: PerfKey;
  /** New poll rate in seconds, for setPollSeconds. */
  seconds?: number;
  /** Branch name, for worktreeFromBranch / deleteBranch. */
  branch?: string;
  /** Repo-relative file path, for addLinkedPath / removeLinkedPath. */
  linkPath?: string;
  /** Whether the branch is remote-only, for worktreeFromBranch. */
  remoteOnly?: boolean;
  /** Whether the branch's PR is merged, for deleteBranch (skips the unmerged
   *  force prompt that squash-merges would otherwise trigger). */
  merged?: boolean;
}

export class WorktreeWebviewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  public static readonly viewType = "worktreeView.panel";

  private view?: vscode.WebviewView;

  /** The branches overlay editor tab, when open (singleton). */
  private branchesPanel?: vscode.WebviewPanel;
  /** Last batched PR fetch for the branches panel, reused on cheap refreshes so
   *  worktree add/remove re-renders the rows without re-hitting the GitHub API. */
  private branchPrs?: { prs: Map<string, BranchPrInfo>; viewerLogin?: string };
  /** Epoch ms of the last successful branch PR fetch, surfaced as the "Last
   *  refreshed" time in the branches view. Undefined until the user hits Refresh
   *  GitHub for the first time, which the view shows as "Never". */
  private branchPrsAt?: number;

  /** Last payload posted, to skip redundant re-renders. */
  private lastPosted = "";
  /** The last fully gathered payload. The agent-only refresh path (session
   *  watcher events) swaps fresh agent VMs into this instead of re-running git
   *  for every worktree; a full gather replaces it. */
  private lastData?: WorktreeData;
  /** Session ids whose state files changed since the last agent refresh, so
   *  that refresh re-reads git only for the worktrees those sessions live in. */
  private readonly pendingPids = new Set<number>();
    /** Monotonic token claimed by every refresh before it reads the session
   *  files; postData only accepts the newest claim. Full and agent-only
   *  refreshes overlap (separate coalescers), and a slow full refresh that
   *  read its session snapshot before a faster agent refresh must not land
   *  after it — that stale post is what left the Activity Bar badge showing a
   *  waiting agent that had already gone active. */
  private updateSeq = 0;
  /** Monotonic token for branch posts. A refresh fires its gatherBranches before
   *  awaiting; a slow one started before a delete could otherwise resolve late
   *  and re-post the deleted branch. Each post claims the latest token and only
   *  the most recently started post is allowed to reach the webview, so stale
   *  results can't clobber a newer one (the "branch flickers back then gone"). */
  private branchPostSeq = 0;
  /** Watches the session-state dir so status changes refresh the panel without
   *  a polling loop. */
  private watcher?: vscode.FileSystemWatcher;
  /** Coalesces bursts of file/session/focus events into one refresh. Created in
   *  the constructor so the clock can be injected; see REFRESH_DEBOUNCE_MS. */
  private readonly refreshDebounce: Coalescer;
  /** Coalesces session-state writes into one (already throttled) PR nudge, so an
   *  agent streaming hook events doesn't poke the GitHub poller on every event. */
  private readonly prNudge: Coalescer;
  /** Coalesces session-state writes into one agent-only refresh (no full git
   *  sweep); see refreshAgents. */
  private readonly agentsDebounce: Coalescer;
  /** Coalesces Git-extension repo-state events into one targeted re-stat. The
   *  extension fires this per repository and can fire several in a burst (a
   *  stage, a commit, a checkout), and each one is only worth the worktree it
   *  names; see onRepoStateChange. */
  private readonly reposDebounce: Coalescer;
  /** Normalized roots whose repository reported a state change and have not been
   *  re-stat'd yet. */
  private readonly repoDirty = new Set<string>();
  /** Running while agents are on screen, so subagents (which the registry
   *  watcher cannot see) appear and disappear; see AGENT_POLL_MS. */
  private agentPoll?: ReturnType<typeof setInterval>;
  /** Working directories a gather has been run for and still could not turn into
   *  a card, so a cwd that never becomes one (an agent in an unrelated repo, a
   *  subdirectory of a worktree) costs a bounded number of re-gathers rather than
   *  one per poll. Counted, not remembered once: the first gather can lose the
   *  race with the process that is creating the worktree, and giving up after it
   *  is what left a card with no agent on it. See REGATHER_TRIES. */
  private readonly regathered = new Map<string, number>();
  /** Paths the in-flight gather was started for, judged once it lands. */
  private pendingRegather?: Set<string>;
  /** Epoch ms each worktree's git status was last read, so a burst of agent
   *  transitions doesn't re-spawn git for the same worktree; see statusPoll.ts. */
  private readonly statusAt = new Map<string, number>();
  /** Subagent rows in the last agent refresh. Only a change is traced: the poll
   *  runs every second, and a row's whole life can be three of those, so a line
   *  per tick would bury the transitions that matter. */
  private lastSubagentCount = 0;
  /** Terminals we launched, keyed by the session id we started Claude with. */
  private terminals = new Map<string, vscode.Terminal>();
  /** Env var stamped on each agent terminal carrying its session id. VS Code
   *  preserves a terminal's creationOptions (env included) across an
   *  extension-host reload, so this is what lets us re-link a restored terminal
   *  to its session after our in-memory handle is gone. */
  private static readonly SID_ENV = "AGENT_WORKTREES_SID";
  /** Last name we applied to each session's terminal, so we only rename on a
   *  real change and an idle session never churns. */
  private appliedTerminalNames = new Map<string, string>();
  /** Names waiting to be applied, for sessions whose terminal is not the one
   *  the user is currently looking at; see flushTerminalNames. */
  private desiredTerminalNames = new Map<string, string>();
  /** Claude's session registry: the directory it keeps one file per live
   *  session in, and the source of every agent row. */
  private readonly registryDir: string;
  /** Work summaries, read from each session's transcript and cached. */
  private readonly reader: TranscriptReader;
  /** Background PR-status fetcher; only does work when a token is stored. */
  private readonly prService: PrService;
  /** Resolved GitHub origin per worktree path (null = no github remote). */
  private readonly remotes = new Map<string, RemoteInfo | null>();
  /** True once we've subscribed to the Git extension's repo open/close events,
   *  so the panel re-renders when the Source Control scope changes. */
  private scmWatchSet = false;
  /** Working-tree subscriptions, one per repository the Git extension has open,
   *  keyed by normalized root; see ensureRepoStateWatch. */
  private readonly repoStateWatch = new Map<string, vscode.Disposable>();
  /** True once the open/close side of that wiring is in place. */
  private repoWatchSet = false;
  /** Debug sessions the panel started, so a card can stop what it launched. */
  private readonly debugSessions = new DebugSessionTracker();

  constructor(private readonly context: vscode.ExtensionContext) {
    initGithub(context);
    this.prService = new PrService(context);
    // A session starting or ending only changes the debug rows, so patch the
    // cached payload rather than re-running the git gather for every worktree.
    this.debugSessions.onDidChange(() => this.postDebugState());
    this.refreshDebounce = new Coalescer(
      () => this.refresh(),
      REFRESH_DEBOUNCE_MS
    );
    this.prNudge = new Coalescer(
      () => this.prService.refresh(false),
      REFRESH_DEBOUNCE_MS
    );
    this.agentsDebounce = new Coalescer(
      () => this.refreshAgents(),
      REFRESH_DEBOUNCE_MS
    );
    this.reposDebounce = new Coalescer(
      () => this.refreshRepos(),
      REFRESH_DEBOUNCE_MS
    );
    this.registryDir = registryDir();
    this.reader = new TranscriptReader(projectsDir());
    // Ensure the directory exists so the watcher attaches even before Claude
    // has registered its first session.
    try {
      fs.mkdirSync(this.registryDir, { recursive: true });
    } catch {
      /* best effort */
    }
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(this.registryDir), "*.json")
    );
    // Claude rewrites a session's registry file on every status transition, and
    // adds or removes one as a session starts or exits, so this directory is the
    // signal that an agent did something. It goes down the agent-only refresh
    // path: agent VMs are re-read and git is re-run only for the worktrees whose
    // sessions changed, not every worktree (see refreshAgents). It also nudges
    // the PR service, since this is the signal that an agent may have just run
    // `gh pr create`/merge, so PR status is worth a (throttled) refresh without
    // waiting for the poll timer. A working agent transitions often, so both are
    // coalesced rather than run per event.
    const onChange = (uri: vscode.Uri) => {
      // The file is named for the session's pid, which is how the agent-only
      // path knows which cards to re-stat.
      const pid = Number.parseInt(path.basename(uri.fsPath, ".json"), 10);
      if (Number.isInteger(pid)) this.pendingPids.add(pid);
      this.agentsDebounce.trigger();
      this.prNudge.trigger();
    };
    this.watcher.onDidCreate(onChange);
    this.watcher.onDidChange(onChange);
    this.watcher.onDidDelete(onChange);

    // Still no workspace-wide `**/*` file watcher: what made that untenable was
    // git's own `.git/index` writes coming back as file events, a perpetual loop
    // that spawned git for every worktree several times a second. The panel
    // instead updates on discrete signals, each of which names something that
    // actually happened: extension load, the manual Refresh button, Claude
    // activity (the session-state watcher above, which also catches an agent
    // creating a new worktree), window focus, the Git extension's repo state,
    // and the document/file events below for hand edits. None of them fires for
    // our own reads, so none of them can feed itself.

    // A slow status is the one thing that turns Settings → Performance from a
    // detail into a recommendation, and git is where it is measured.
    setSlowStatusHandler(() => {
      this.statusWasSlow = true;
      if (this.gitPerf) this.repostSettings();
    });

    // Re-link any agent terminals VS Code restored from before this host
    // started (e.g. an extension update or window reload), and keep claiming
    // ones that surface afterward, so focus/stop reach them again.
    vscode.window.terminals.forEach((t) => this.reclaimTerminal(t));

    context.subscriptions.push(
      this.prService,
      // Re-render whenever fresh PR status lands. PR data is the only thing that
      // moved, so patch the cached payload rather than re-running the whole
      // gather: a PR with pending checks polls every 15s (7s just after a push),
      // and a full refresh per poll spawned git for every worktree to learn
      // nothing about any of them.
      this.prService.onChange(() => this.postPrState()),
      // Re-link a terminal restored after activation to its session.
      vscode.window.onDidOpenTerminal((t) => this.reclaimTerminal(t)),
      // Clean up our terminal handle when its terminal is closed by any means.
      vscode.window.onDidCloseTerminal((t) => this.forgetTerminal(t)),
      // Highlight the agent whose terminal the user is looking at. A
      // lightweight message (not a full refresh) so switching terminals
      // repaints instantly without re-running git. Switching is also when a
      // rename we deferred (to avoid stealing the terminal the user was in)
      // becomes safe to apply.
      vscode.window.onDidChangeActiveTerminal(() => {
        this.postActiveTerminal();
        void this.flushTerminalNames();
      }),
      // Catch external/agent edits and commits when the window regains focus,
      // and start/stop the subagent poll with focus (see syncAgentPoll).
      vscode.window.onDidChangeWindowState((s) => {
        this.syncAgentPoll();
        if (s.focused) this.scheduleRefresh();
      }),
      // The user editing a file by hand. This is the one source of change no
      // other signal sees: the agent poll only re-stats cards with a working
      // agent, and the Git extension's repo-state event only fires for the
      // repositories it has open - which is the workspace's own repo, not
      // usually a linked worktree. So a hand edit to a worktree file (the
      // panel's own "open a worktree file here" button lands them in this
      // window) left that card's counts frozen until the next deliberate
      // refresh.
      //
      // A save, not a keystroke: git only sees what is on disk, so an unsaved
      // buffer has nothing to report anyway. That also makes this naturally
      // sparse - one event per save, coalesced with everything else - which is
      // why it needs no watcher and does not revive the `**\/*` problem.
      vscode.workspace.onDidSaveTextDocument((doc) => this.onFilesChanged([doc.uri])),
      // The same for changes made through the explorer rather than an editor:
      // a new file, a delete, a rename all move a dirty count.
      vscode.workspace.onDidCreateFiles((e) => this.onFilesChanged(e.files)),
      vscode.workspace.onDidDeleteFiles((e) => this.onFilesChanged(e.files)),
      vscode.workspace.onDidRenameFiles((e) =>
        this.onFilesChanged(e.files.flatMap((f) => [f.oldUri, f.newUri]))
      )
    );
  }

  dispose(): void {
    setSlowStatusHandler(null);
    this.watcher?.dispose();
    this.branchesPanel?.dispose();
    this.refreshDebounce.cancel();
    this.prNudge.cancel();
    this.agentsDebounce.cancel();
    this.reposDebounce.cancel();
    clearInterval(this.agentPoll);
    this.agentPoll = undefined;
    for (const sub of this.repoStateWatch.values()) sub.dispose();
    this.repoStateWatch.clear();
    this.repoWatchSet = false;
    // Only stops tracking: the sessions themselves belong to VS Code and keep
    // running, exactly as they would if they had been started from the debug view.
    this.debugSessions.dispose();
  }

  /** Coalesce bursts of discrete events (window focus, SCM scope changes) into a
   *  single refresh. */
  private scheduleRefresh(): void {
    this.refreshDebounce.trigger();
  }

  /**
   * A file changed on disk through the editor or the explorer. Refresh only if it
   * belongs to a worktree the panel is showing.
   *
   * The scope check is what keeps this cheap enough to be a trigger at all. With
   * autosave on, an editing session emits a save every pause, and a full gather is
   * a `git status` per worktree - so a file in an unrelated folder (a scratch
   * file, another repo in a multi-root workspace) must not pay for one. Compared
   * against the cards themselves rather than the workspace folder, since a card
   * can be a linked worktree the user opened a file from without opening its
   * folder, which is exactly the case the hand-edit signal exists for.
   *
   * Before the first gather there are no cards to compare against, and no payload
   * to patch either, so a refresh is the right answer regardless.
   */
  private onFilesChanged(uris: readonly vscode.Uri[]): void {
    const cards = this.lastData?.worktrees;
    const relevant =
      !cards?.length ||
      uris.some((uri) => {
        if (uri.scheme !== "file") return false;
        const p = normalize(uri.fsPath);
        return cards.some((wt) => {
          const root = normalize(wt.path);
          return p === root || p.startsWith(root + path.sep);
        });
      });
    if (relevant) this.scheduleRefresh();
  }

  /**
   * Start or stop the agent poll to match what is on screen (see AGENT_POLL_MS).
   *
   * Called whenever any input can have changed: a payload landing (agents
   * appeared or went away), the view being shown or hidden, and the window
   * gaining or losing focus.
   *
   * Focus counts because the poll exists only to make short-lived subagent rows
   * appear, which is on-screen detail nobody is reading in a background window.
   * Everything a hidden or unfocused window still owes the user comes from the
   * registry watcher instead - notably the Activity Bar waiting-agent badge - so
   * pausing this costs nothing while several windows are open.
   */
  private syncAgentPoll(): void {
    const wanted =
      !!this.view?.visible &&
      vscode.window.state.focused &&
      !!this.lastData?.worktrees.some(
        (wt) => wt.agents.length > 0 || (wt.subagents?.length ?? 0) > 0
      );
    if (wanted === !!this.agentPoll) return;
    diag(`agent poll ${wanted ? "started" : "stopped"}`);
    if (!wanted) {
      clearInterval(this.agentPoll);
      this.agentPoll = undefined;
      return;
    }
    this.agentPoll = setInterval(() => this.agentsDebounce.trigger(), AGENT_POLL_MS);
  }

  private get extensionUri(): vscode.Uri {
    return this.context.extensionUri;
  }

  /** The extension's own worktree glyph, used as each agent terminal's tab icon
   *  so it matches the Activity Bar icon instead of the generic sparkle. A
   *  terminal `iconPath` SVG is rendered as-is (VS Code does not recolor it the
   *  way it masks Activity Bar icons), so `currentColor` would fall back to
   *  black and vanish on dark themes. Supply theme-specific glyphs instead: the
   *  `dark` variant is light-colored, the `light` variant is dark-colored. */
  private get terminalIcon(): { light: vscode.Uri; dark: vscode.Uri } {
    return {
      light: vscode.Uri.joinPath(this.extensionUri, "media", "worktree-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "media", "worktree-dark.svg"),
    };
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.html(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg: ActionMessage) =>
      this.onMessage(msg)
    );
    webviewView.onDidChangeVisibility(() => {
      this.prService.setVisible(webviewView.visible);
      this.syncAgentPoll();
      // The webview cannot see this for itself: its iframe is display:none while
      // hidden, but an iframe's document.hidden follows the window, not its own
      // CSS. It uses this to stop its elapsed-time tick.
      void webviewView.webview.postMessage({
        type: "visibility",
        visible: webviewView.visible,
      });
      if (webviewView.visible) {
        this.lastPosted = ""; // a re-shown view needs a fresh push
        void this.refresh();
      }
    });

    this.lastPosted = "";
    void this.ensureRepoStateWatch();
    void this.refresh();
  }

  /**
   * Recompute worktree data and push it to the webview (only when it changed).
   * When `force` is set (the user clicked Refresh) this also runs a `git fetch`
   * so the behind/ahead counts are current and forces a fresh GitHub PR fetch.
   */
  async refresh(force = false): Promise<void> {
    if (!this.view) return;
    const seq = ++this.updateSeq;
    // Claimed before any await, so a gather that throws on its way through
    // cannot leave the field set and stop the retry from ever being judged.
    const pending = this.pendingRegather;
    this.pendingRegather = undefined;
    // Every agent on a card comes from Claude's own session registry; a session
    // that is gone has no file, so there is nothing to sweep or expire.
    const registry = await this.readAgents();
    const data = await gatherWorktrees(force, registry, this.reader);
    // A full gather just read every worktree's status, so the agent path has
    // nothing to re-read for a moment (see statusPoll.ts). Worktrees that are
    // gone drop out, so the map tracks the cards rather than every path this
    // window has ever seen.
    const gatheredAt = Date.now();
    const live = new Set(data.worktrees.map((wt) => normalize(wt.path)));
    for (const key of this.statusAt.keys()) {
      if (!live.has(key)) this.statusAt.delete(key);
    }
    for (const key of live) this.statusAt.set(key, gatheredAt);
    this.judgeRegather(data, live, pending);
    data.scmEnabled = this.isScmEnabled();
    if (data.scmEnabled) await this.annotateScmActive(data);
    await this.annotateDebug(data);
    data.traceEnabled = vscode.workspace
      .getConfiguration()
      .get<boolean>(TRACE_SETTING, false);
    data.statusPollSeconds = this.pollMs() / 1_000;
    // Keyed by the primary worktree, not by data.repoRoot: in a window with a
    // linked worktree open the repo root *is* that worktree, so reading by it
    // would miss the list every writer stored under the primary's path.
    const linkKey = repoSettingsKey(data.repoRoot, data.worktrees);
    if (linkKey) data.linkedPaths = this.getLinkedPaths(linkKey);
    // Whatever Settings → Performance last learned. Never read here: it is git
    // calls for a tab that is usually closed, so it is fetched on demand
    // (loadGitPerf) and carried on every payload after that.
    if (this.gitPerf) data.gitPerf = this.withSlowFlag(this.gitPerf);
    data.activeSessionId = this.activeSessionId();
    if (this.view.visible) {
      await this.attachPrStatus(data, force);
    } else {
      // Hidden view: the PR badges are not rendered and the poller is paused
      // (setVisible), so skip the token/remote/target work. The git gather
      // above still ran for the Activity Bar badge, and onDidChangeVisibility
      // forces a full refresh on re-show.
      data.prEnabled = this.prService.isEnabled();
    }
    // Keep the branches editor tab (if open) in sync with the same signals that
    // refresh the sidebar, so a worktree add/remove updates its rows. Never hit
    // the GitHub API here — branch PR data is fetched only by the explicit
    // Refresh GitHub button — so reuse whatever PR data is already cached.
    // Only while the tab is actually visible: a hidden tab (retained behind
    // another editor) would otherwise drive a full listBranches — dozens of git
    // spawns on a many-branch repo — on every agent-activity refresh; it
    // catches up via onDidChangeViewState when re-shown.
    if (this.branchesPanel?.visible) void this.postBranches(false);
    await this.postGather(data, seq);
  }

  /**
   * Shared tail of the full and agent-only refreshes: remember the payload for
   * the agent-only path, update the Activity Bar badge, and post to the webview
   * unless nothing render-relevant changed. `seq` is the claim the caller took
   * before reading session state; anything but the newest claim is dropped so a
   * slow refresh can never overwrite newer agent state (and badge) with its
   * stale snapshot.
   */
  private postData(data: WorktreeData, seq: number): void {
    if (!this.view || seq !== this.updateSeq) return;
    this.lastData = data;
    // Before the unchanged-payload early return below: the poll follows what is
    // on the cards, which is now this payload whether or not it is re-posted.
    this.syncAgentPoll();
    // Waiting agents surface as a number badge on the Activity Bar icon, so a
    // blocked agent is visible even while the panel is hidden behind another
    // view. Set before the unchanged-payload early return: a freshly resolved
    // view starts with no badge regardless of what was last posted.
    // Clear with a zero-value badge, never `undefined`: once a number badge
    // has been shown, VS Code ignores `badge = undefined` and the stale count
    // stays on the icon forever (microsoft/vscode#162900; still reproduces
    // for webview views). A `{value: 0}` badge applies and renders as none.
    const waiting = countWaitingAgents(data.worktrees);
    this.view.badge = {
      value: waiting,
      tooltip:
        waiting === 1
          ? "1 agent waiting for you"
          : `${waiting} agents waiting for you`,
    };
    // lastActivity is a per-hook-event heartbeat the panel never renders;
    // including it in the signature would defeat this guard on every tool call
    // and rebuild the webview DOM for a byte-identical render.
    const json = JSON.stringify(data, (k, v) =>
      k === "lastActivity" ? undefined : v
    );
    if (json === this.lastPosted) return;
    this.lastPosted = json;
    void this.view.webview.postMessage({ type: "update", data });
  }

  /**
   * Agent-only refresh for session-watcher events. A hook firing means agent
   * state changed and files may have changed in that agent's worktree — but
   * not in the others. So: re-read the session files, swap the agent VMs into
   * the last gathered payload, and re-run git status only for the worktrees
   * whose sessions actually fired, instead of spawning git for every worktree
   * on every hook burst. Falls back to a full refresh when there is no cached
   * payload yet, or when a session appeared in a worktree the cache does not
   * know (an agent just created one with `claude -w`).
   */
  private async refreshAgents(): Promise<void> {
    const data = this.lastData;
    if (!this.view || !data) {
      this.pendingPids.clear();
      return this.refresh();
    }
    const seq = ++this.updateSeq;
    const pids = new Set(this.pendingPids);
    this.pendingPids.clear();
    const registry = await this.readAgents();
    // A pid with no file left is a session that just ended, which changes what
    // a card lists rather than what one of its rows says. Nothing to patch.
    if ([...pids].some((pid) => !registry.some((s) => s.pid === pid))) {
      return this.refresh();
    }
    const changed = new Set(
      registry.filter((s) => pids.has(s.pid)).map((s) => s.sessionId)
    );
    const sessions = await this.indexAgents(
      registry,
      data.worktrees.map((wt) => wt.path)
    );
    let subs = 0;
    for (const rows of sessions.agents.values()) {
      for (const a of rows) subs += a.subagents?.length ?? 0;
    }
    // A subagent finishing takes its isolated worktree with it, and only a full
    // gather re-lists worktrees, so a card for one that has just been removed
    // would otherwise sit there until something else forced a refresh.
    const fewer = subs < this.lastSubagentCount;
    if (subs !== this.lastSubagentCount) {
      diag(`subagents: ${subs} running across ${registry.length} session(s)`);
      this.lastSubagentCount = subs;
    }
    this.syncTerminalNames(sessions.agents);
    const known = new Set(data.worktrees.map((wt) => normalize(wt.path)));
    // A worktree the cache has never heard of needs a full gather to get a card
    // at all (an agent just created one with `claude -w`).
    for (const key of sessions.agents.keys()) {
      if (!known.has(key)) return this.refresh();
    }
    // Same for a worktree an agent just created for itself (`claude -w`) or to
    // isolate a subagent. Neither is covered by the last full gather, and neither
    // trips the check above: both live inside the repo, so the row lands on the
    // repo root's card - which the cache does know - and the new worktree has no
    // card at all until something re-lists them.
    //
    // Which of those paths are worth another gather is decided *after* it lands,
    // not here (see judgeRegather): a path that now has a card cannot be unplaced
    // again, so it needs no bookkeeping, and a path that still has none gets a
    // bounded number of further tries. Deciding up front, by marking every path
    // as gathered-for before the gather had run, is what made the race with an
    // agent registering itself permanent instead of momentary.
    const retry = sessions.unplaced.filter(
      (p) => (this.regathered.get(normalize(p)) ?? 0) < REGATHER_TRIES
    );
    if (retry.length) {
      this.pendingRegather = new Set(retry.map(normalize));
      return this.refresh();
    }
    if (fewer) return this.refresh();
    const now = Date.now();
    // Which cards are worth a `git status` on this pass. Two reasons to re-stat,
    // and the second one is not optional:
    //
    //  - a session on this card just wrote its registry file (`changed`), so
    //    something happened in its worktree;
    //  - a session on this card is `active`, whether or not it said anything.
    //    Claude rewrites that file on status *transitions* only, and a single
    //    long turn is one status: measured on a real session, the file went 39
    //    seconds without a write while the agent edited four files. Keying the
    //    re-stat purely off transitions is what froze a card's change count
    //    while its agent worked, and left the panel disagreeing with the Source
    //    Control view for the length of a turn.
    //
    // `active` specifically, not "not idle". Neither an idle nor a *waiting*
    // session is editing: waiting means Claude is blocked on the user, and both
    // entering and leaving it are transitions, so the last write before the pause
    // is caught by `changed` above and the resumption announces itself. Treating
    // waiting as work would put a card parked on a permission prompt on a
    // two-second git treadmill for as long as the user takes to read it, which is
    // the steady-state spawn cost this whole path exists to avoid.
    const working = (wt: WorktreeVM): boolean => {
      const key = normalize(wt.path);
      const rows = sessions.agents.get(key) ?? [];
      if (rows.some((a: AgentVM) => changed.has(a.sessionId))) return true;
      // A waiting parent whose subagents are still running is the one exception:
      // the parent is blocked on the user, but its fan-out keeps editing.
      if (
        rows.some(
          (a: AgentVM) => a.status === "active" || (a.subagents?.length ?? 0) > 0
        )
      ) {
        return true;
      }
      // A subagent working here for a parent session on another card: the row is
      // owned by this card, and its parent is mid-turn by definition.
      return (sessions.subagents.get(key) ?? []).length > 0;
    };
    // Only the cards the poll still owns. A worktree whose repository the Git
    // extension has open re-stats on that repository's own change event instead
    // (see onRepoStateChange), so the poll leaves it alone but for a backstop.
    const due = new Set(
      dueForStatus({
        cards: data.worktrees.map((wt) => ({
          path: normalize(wt.path),
          working: working(wt),
        })),
        watched: new Set(this.repoStateWatch.keys()),
        statusAt: this.statusAt,
        now,
        pollMs: this.pollMs(),
        watchedMs: WATCHED_STATUS_TTL_MS,
      })
    );
    const touched = data.worktrees.filter((wt) => due.has(normalize(wt.path)));
    if (await this.statWorktrees(touched, now)) return this.refresh();
    this.applyAgents(data, sessions);
    this.postData(data, seq);
  }

  /**
   * Re-run `git status` for these cards and write the results onto them.
   *
   * Returns true when the caller should fall back to a full refresh instead of
   * posting: an agent that ran `git checkout` (typically back to main once its
   * PR merged) changed more than a cached payload can patch - the card's branch
   * name, and the PR status keyed off it. The status call already reports the
   * checked-out branch, so a mismatch means the cache is stale in ways only a
   * full gather can fix, including re-targeting the PR service, which otherwise
   * keeps polling (and showing) the old branch's PR.
   *
   * Only a positively reported, different branch counts: a status that failed
   * (or a detached HEAD) reports none, and treating that as a switch would fall
   * back to a full refresh on every transition.
   */
  private async statWorktrees(
    touched: WorktreeVM[],
    now: number
  ): Promise<boolean> {
    if (!touched.length) return false;
    const statuses = await mapLimit(touched, 4, (wt) => getStatus(wt.path));
    for (const wt of touched) this.statusAt.set(normalize(wt.path), now);
    const switched = touched.some(
      (wt, i) => !!statuses[i].branch && statuses[i].branch !== wt.branch
    );
    if (switched) return true;
    touched.forEach((wt, i) => (wt.git = statuses[i]));
    return false;
  }

  /**
   * A repository the Git extension has open reported a state change.
   *
   * This is the panel's free working-tree signal: the Git extension is already
   * watching that repository and already debounces its own status runs, so we
   * neither add a watcher nor guess when to look. What it is *not* is a reason to
   * re-read every other worktree, which is what routing it through the full
   * gather used to mean: one repository moving spawned git for every card on the
   * panel, on the signal that fires most often. Re-stat the card it names.
   *
   * Falling back to a full refresh when nothing matches is deliberate. The root
   * can be a repository with no card at all (another folder in a multi-root
   * workspace), and it can be one that *should* have a card and does not yet,
   * which only a re-list can fix.
   */
  private onRepoStateChange(root: string): void {
    this.repoDirty.add(root);
    this.reposDebounce.trigger();
  }

  /** Re-stat the worktrees whose repositories reported a change, then repost. */
  private async refreshRepos(): Promise<void> {
    const dirty = new Set(this.repoDirty);
    this.repoDirty.clear();
    // A hidden panel is gathered from scratch the moment it is shown again
    // (onDidChangeVisibility), so spending git on counts nobody can see is pure
    // waste and dropping these events loses nothing. Unlike the full gather this
    // replaced, none of it is owed to the Activity Bar badge, which counts
    // waiting agents from the registry watcher and never reads a working tree.
    if (!this.view?.visible || !dirty.size) return;
    const data = this.lastData;
    if (!data) return this.refresh();
    const touched = data.worktrees.filter((wt) => dirty.has(normalize(wt.path)));
    // A root that names no card is a repository this panel does not show, or one
    // whose card has yet to be listed. Only the second is worth a gather, and the
    // two are indistinguishable from here, so gather: the first costs one sweep
    // for a repository whose state rarely moves.
    if (touched.length !== dirty.size) return this.refresh();
    const seq = ++this.updateSeq;
    if (await this.statWorktrees(touched, Date.now())) return this.refresh();
    this.postData(data, seq);
  }

  /** Poll rate for a card with no change event of its own; see statusPoll.ts. */
  private pollMs(): number {
    return pollIntervalMs(
      vscode.workspace
        .getConfiguration()
        .get<number>(POLL_SECONDS_SETTING, DEFAULT_POLL_SECONDS)
    );
  }

  /**
   * Decide what the gather that just ran proved about the working directories it
   * was run for, and say so in the diagnostics.
   *
   * A path that now has a card is settled: it cannot come back as `unplaced`, so
   * nothing needs remembering. A path that still has none gets its try counted,
   * and the reason is worth a line either way - "the card arrived" and "this cwd
   * is not a worktree of this repo at all" look identical from the panel (an
   * agent that never appears), and only the second one is a path-matching
   * problem rather than a timing one.
   */
  private judgeRegather(
    data: WorktreeData,
    cards: Set<string>,
    pending?: Set<string>
  ): void {
    if (!pending?.size) return;
    for (const p of pending) {
      if (cards.has(p)) {
        diag(`regather: ${p} now has a card`);
        this.regathered.delete(p);
        continue;
      }
      const tries = (this.regathered.get(p) ?? 0) + 1;
      this.regathered.set(p, tries);
      const placed = data.worktrees.some(
        (wt) => p === normalize(wt.path) || p.startsWith(normalize(wt.path) + path.sep)
      );
      diag(
        `regather: ${p} is still not a card after ${tries} ` +
          `${tries === 1 ? "gather" : "gathers"} (${
            placed ? "it is inside another card, so its row lands there" : "no card contains it"
          })${tries >= REGATHER_TRIES ? "; not gathering for it again" : ""}`
      );
    }
  }

  /** Swap a session index's rows onto a payload's cards. Shared by the
   *  agent-only refresh and the salvage in postGather. */
  private applyAgents(data: WorktreeData, sessions: SessionIndex): void {
    for (const wt of data.worktrees) {
      const key = normalize(wt.path);
      wt.agents = sessions.agents.get(key) ?? [];
      // The subagents a session elsewhere handed this worktree. They belong to
      // the card, not to any row on it, so patching only `agents` left a
      // fanned-out subagent's row stuck on whatever the last full gather saw.
      const foreign = sessions.subagents.get(key) ?? [];
      if (foreign.length) wt.subagents = foreign;
      else delete wt.subagents;
    }
    data.activeSessionId = this.activeSessionId();
  }

  /**
   * Post a full gather's payload, re-reading agent state first if a faster
   * agent-only refresh claimed a newer token while the git was in flight.
   *
   * The token guard in postData exists to stop a slow refresh's stale *agent*
   * snapshot from overwriting newer rows, but dropping the post threw away the
   * fresh *git* work with it, and the agent poll claims a token every second, so
   * any gather slower than that (a `git fetch`, a PR fetch, a many-worktree
   * status sweep) was routinely discarded. That is what left a worktree an agent
   * had just created missing from the panel, and a card's change counts behind
   * the Source Control view, until the user clicked Refresh and won the race.
   *
   * Re-indexing is cheap (the registry read is mtime-cached, the transcript
   * titles too), so the agents it posts are current as of the post. Its git is
   * not necessarily the newest git: a slow forced refresh (fetch + PR work) can
   * land after a fast one and re-post the older statuses it read at the start.
   * That self-heals on the next signal and is strictly better than the old
   * behavior, which discarded the slow gather's payload entirely and left
   * `lastData` on a cache that predated it.
   */
  private async postGather(data: WorktreeData, seq: number): Promise<void> {
    if (!this.view) return;
    if (seq === this.updateSeq) return this.postData(data, seq);
    const registry = await this.readAgents();
    const sessions = await this.indexAgents(
      registry,
      data.worktrees.map((wt) => wt.path)
    );
    this.applyAgents(data, sessions);
    this.postData(data, ++this.updateSeq);
  }

  /** Registry files already parsed, keyed by path+mtime, so the 1s agent poll
   *  re-reads a session's file only when Claude has rewritten it. */
  private readonly registryCache: RegistryCache = new Map();

  /** Claude's live sessions, and the titles for them dropped from the cache. */
  private async readAgents(): Promise<RegistrySession[]> {
    const registry = await readRegistry(
      this.registryDir,
      systemProbes.isAlive,
      this.registryCache
    );
    this.reader.retain(new Set(registry.map((s) => s.sessionId)));
    return registry;
  }

  /** The registry as agent rows, with each session's work summary read from its
   *  transcript (cached, so a settled title costs a stat). */
  private async indexAgents(
    registry: RegistrySession[],
    worktreePaths: string[]
  ): Promise<SessionIndex> {
    const titles = new Map<string, string>();
    const subagents = new Map<string, SubagentVM[]>();
    const skills = new Map<string, string[]>();
    await Promise.all(
      registry.map(async (session) => {
        const [title, subs, used] = await Promise.all([
          this.reader.titleFor(session.sessionId),
          this.reader.subagentsFor(session.sessionId),
          this.reader.skillsFor(session.sessionId),
        ]);
        if (title) titles.set(session.sessionId, title);
        if (subs.length) subagents.set(session.sessionId, subs);
        if (used.length) skills.set(session.sessionId, used);
      })
    );
    return indexRegistry(registry, worktreePaths, titles, subagents, skills);
  }

  /**
   * On-demand refresh for a single worktree's card (the per-card refresh button):
   * re-read its git working-tree state and, when the PR integration is on, make a
   * fresh GitHub call for just that worktree's branch. Unlike the global Refresh
   * it does not run a `git fetch` (that is the global button's job) — it picks up
   * local working-tree changes and the latest PR/CI for the one card the user
   * asked about. The whole payload is re-posted (git status is cheap and local),
   * so other cards simply reflect their current state.
   */
  private async refreshWorktree(fsPath?: string): Promise<void> {
    if (!fsPath || !this.view) return;
    if (this.prService.isEnabled()) {
      const github = await connection();
      if (github.hasToken) await this.prService.refreshOne(normalize(fsPath));
    }
    // Force the re-post even if nothing else changed, so the user sees the click
    // take effect.
    this.lastPosted = "";
    await this.refresh(false);
  }

  /**
   * Attach GitHub connection + per-worktree PR status onto the payload. This is
   * the only place PR work is kicked off, and it is fully optional: with no
   * token (or the integration toggled off) it sets an empty target list, does no
   * network work, and leaves every `pr` undefined. Resolving remotes and reading
   * the cache never throws, so a GitHub hiccup can't break the worktree render.
   */
  private async attachPrStatus(
    data: WorktreeData,
    force = false
  ): Promise<void> {
    const enabled = this.prService.isEnabled();
    const github = await connection();
    data.github = github;
    data.prEnabled = enabled;

    const targets: PrTarget[] = [];
    if (enabled && github.hasToken && data.repoRoot) {
      // Every worktree of a repo shares its origin, so resolve it once at the
      // repo root instead of spawning `git remote get-url` per worktree.
      const repo = await this.remoteFor(data.repoRoot);
      if (repo) {
        for (const wt of data.worktrees) {
          if (!wt.branch || wt.detached) continue;
          targets.push({ key: normalize(wt.path), branch: wt.branch, repo });
        }
      }
    }
    this.prService.setTargets(targets);
    // On an explicit refresh, refetch PR/CI status now so this payload carries
    // the latest instead of waiting for the next background poll.
    if (force && enabled && github.hasToken) {
      await this.prService.refresh(true);
    }

    for (const wt of data.worktrees) {
      if (!wt.branch) continue;
      // Branch-matched: a value cached for a branch this worktree no longer has
      // checked out reads as unknown, so a merged PR never outlives the branch
      // it belonged to.
      const pr = this.prService.get(normalize(wt.path), wt.branch);
      if (pr !== undefined) wt.pr = pr;
    }
  }

  /** Resolve (and cache) a worktree's GitHub origin. Never throws. */
  private async remoteFor(fsPath: string): Promise<RemoteInfo | undefined> {
    const key = normalize(fsPath);
    const cached = this.remotes.get(key);
    if (cached !== undefined) return cached ?? undefined;
    let info: RemoteInfo | undefined;
    try {
      info = await getRemoteInfo(fsPath);
    } catch {
      info = undefined;
    }
    this.remotes.set(key, info ?? null);
    return info;
  }

  // --- Webview messages ------------------------------------------------------

  private async onMessage(msg: ActionMessage): Promise<void> {
    if (msg.type !== "action") return;
    switch (msg.action) {
      case "refresh":
        return void this.refresh(true);
      case "refreshWorktree":
        return this.refreshWorktree(msg.path);
      case "agent":
        return this.agent(msg.path);
      case "agentWorktree":
        return this.agentWorktree();
      case "focusAgent":
        return this.focusAgent(msg.sessionId);
      case "stopAgent":
        return this.stopAgent(msg.sessionId);
      case "newWorktree":
        return this.newWorktree();
      case "removeWorktree":
        return this.removeWorktreeAction(msg.path);
      case "changeBranch":
        return this.changeBranchAction(msg.path);
      case "openWindow":
        return this.openWindow(msg.path);
      case "searchWorktree":
        return this.searchWorktree(msg.path);
      case "findWorktreeFile":
        return this.findWorktreeFile(msg.path);
      case "setGithubToken":
        return this.setGithubToken(msg.token);
      case "clearGithubToken":
        return this.clearGithubToken();
      case "togglePr":
        return this.togglePr(msg.value);
      case "toggleScm":
        return this.toggleScm(msg.value);
      case "toggleTrace":
        return this.toggleTrace(msg.value);
      case "loadGitPerf":
        return this.loadGitPerf();
      case "setGitPerf":
        return this.setGitPerf(msg.perfKey, msg.value);
      case "setPollSeconds":
        return this.setPollSeconds(msg.seconds);
      case "addLinkedPath":
        return this.addLinkedPath(msg.linkPath);
      case "browseLinkedPath":
        return this.browseLinkedPath();
      case "pickIgnoredPaths":
        return this.pickIgnoredPaths();
      case "removeLinkedPath":
        return this.removeLinkedPath(msg.linkPath);
      case "relinkWorktrees":
        return this.relinkWorktrees();
      case "showLog":
        return void vscode.commands.executeCommand("worktreeView.showLog");
      case "scopeScm":
        return this.scopeScm(msg.path);
      case "debugWorktree":
        return this.debugWorktree(msg.path);
      case "stopDebug":
        return this.stopDebug(msg.debugId);
      case "openBranches":
        return this.openBranchesPanel();
    }
  }

  // --- Run and Debug ---------------------------------------------------------

  /**
   * Start a debug session in a worktree. The target quick pick lives in
   * debugRun.ts; this only resolves which card was clicked and re-renders, since
   * a started session adds a row (the tracker's onDidChange also fires, so this
   * post is only for the case where nothing started).
   */
  private async debugWorktree(fsPath?: string): Promise<void> {
    if (!fsPath) return;
    const wt = this.lastData?.worktrees.find(
      (w) => normalize(w.path) === normalize(fsPath)
    );
    await startWorktreeDebug(fsPath, wt?.name ?? path.basename(fsPath));
  }

  /** Stop one debug session the panel started. */
  private async stopDebug(id?: string): Promise<void> {
    if (!id) return;
    await this.debugSessions.stop(id);
  }

  /**
   * Record which worktrees can be debugged and which have sessions running.
   * The launch.json read is one file read per worktree, on the full refresh
   * only, so adding a launch.json shows up on the next one rather than instantly.
   */
  private async annotateDebug(data: WorktreeData): Promise<void> {
    await Promise.all(
      data.worktrees.map(async (wt) => {
        wt.canDebug = await hasDebugTargets(wt.path);
        const sessions = this.debugSessions.forWorktree(wt.path);
        if (sessions.length) wt.debugSessions = sessions;
      })
    );
  }

  /**
   * Re-post with fresh debug-session rows. Called when a session starts or ends:
   * the sessions are the only thing that changed, so this patches the cached
   * payload instead of re-running the git gather (the same trick refreshAgents
   * uses for hook events).
   */
  private postDebugState(): void {
    const data = this.lastData;
    if (!this.view || !data) return;
    for (const wt of data.worktrees) {
      const sessions = this.debugSessions.forWorktree(wt.path);
      if (sessions.length) wt.debugSessions = sessions;
      else delete wt.debugSessions;
    }
    this.postData(data, ++this.updateSeq);
  }

  /**
   * Re-post with fresh PR badges. The counterpart of postDebugState for the PR
   * poller: `pr` is read off the (already fetched) service cache and swapped into
   * the cached payload, so a checks-still-running poll costs no git at all.
   *
   * A worktree with no cached value for the branch it currently has checked out
   * loses its badge rather than keeping the last one: that is what a cleared
   * cache (token removed) and a branch switch both look like from here. Falls
   * back to a full refresh before the first gather has landed.
   *
   * Posts under the *current* claim instead of taking a new one. The PR poller
   * fires on a timer, so it regularly lands mid-refresh, and claiming here would
   * invalidate that refresh — throwing away the git it had just finished
   * spawning, to show the same cards with a badge on them. Not claiming means
   * both post, newest last, and any genuinely newer claim still supersedes this.
   */
  private postPrState(): void {
    const data = this.lastData;
    if (!this.view || !data) {
      void this.refresh();
      return;
    }
    for (const wt of data.worktrees) {
      const pr = wt.branch
        ? this.prService.get(normalize(wt.path), wt.branch)
        : undefined;
      if (pr !== undefined) wt.pr = pr;
      else delete wt.pr;
    }
    this.postData(data, this.updateSeq);
  }

  // --- Git performance (Settings → Performance) -------------------------------

  /** What the Performance tab last learned about this repo, so the section
   *  renders from the payload like everything else instead of re-running git on
   *  every refresh. Re-read (never patched) after we write a setting, so what the
   *  switches show is always what git just told us. */
  private gitPerf?: GitPerfVM;
  /** A status in this window was slow enough for git's caches to be worth it
   *  (see setSlowStatusHandler). Sticky: it says "this repo is big", which does
   *  not stop being true. */
  private statusWasSlow = false;

  private withSlowFlag(perf: GitPerfVM): GitPerfVM {
    return this.statusWasSlow ? { ...perf, statusWasSlow: true } : perf;
  }

  /**
   * Read the state of git's `status` accelerators and post it.
   *
   * Fired when the Performance tab is opened, not on every refresh: it is a few
   * git calls, one of which (`--test-untracked-cache`) walks the working tree, so
   * it has no business on the refresh path. The filesystem test is skipped once
   * the cache is already on - the answer cannot change what we would offer.
   */
  private async loadGitPerf(): Promise<void> {
    const repoRoot = this.lastData?.repoRoot;
    if (!repoRoot) return;
    const [config, fsmonitorSupport] = await Promise.all([
      readPerfConfig(repoRoot),
      gitFsmonitorSupport(repoRoot),
    ]);
    const perf: GitPerfVM = { ...config, fsmonitorSupport };
    if (!config.untrackedCache) {
      perf.untrackedCacheOk = await untrackedCacheSupported(repoRoot);
    }
    this.gitPerf = perf;
    diag(
      `gitPerf: untrackedCache=${perf.untrackedCache} fsmonitor=${perf.fsmonitor} ` +
        `fsmonitorSupport=${fsmonitorSupport} ` +
        `untrackedCacheOk=${perf.untrackedCacheOk ?? "n/a"}`
    );
    this.repostSettings();
  }

  /**
   * Turn one accelerator on or off, from its toggle in Settings → Performance.
   *
   * The toggle is the consent: it is labelled with what it writes, sitting under
   * a paragraph naming the two config keys, and it goes both ways - so there is
   * no modal here. What there is instead is a refusal to act on a toggle the view
   * should not have offered (an unsupported platform, a filesystem that failed
   * git's check, a `core.fsmonitor` that is the user's own hook program), since a
   * stale payload must not be able to talk us into writing one of those.
   */
  private async setGitPerf(key?: PerfKey, on?: boolean): Promise<void> {
    const repoRoot = this.lastData?.repoRoot;
    const perf = this.gitPerf;
    if (!repoRoot || !perf || (key !== "untrackedCache" && key !== "fsmonitor")) {
      return;
    }
    const want = on === true;
    const refuse =
      key === "untrackedCache"
        ? want && perf.untrackedCacheOk === false
        : perf.fsmonitor === "hook" ||
          (want && perf.fsmonitorSupport !== "yes");
    if (refuse) {
      diag(`gitPerf: refused ${key}=${want} (not offerable in this repo)`);
      // The switch has already moved in the DOM. Re-post so it springs back to
      // what the repo actually says, rather than sitting on a state we declined
      // to write.
      this.repostSettings();
      return;
    }

    try {
      await setPerfSetting(repoRoot, key, want);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      diag(`gitPerf: ${msg}`);
      void vscode.window.showErrorMessage(msg);
    }
    // Re-read either way: a failed write must be reported as it actually stands,
    // not as either of us intended, and the toggle springs back on its own.
    await this.loadGitPerf();
  }

  /**
   * Set the poll rate from its control in Settings → Performance.
   *
   * Written to the same `agentWorktrees.statusPollSeconds` setting the Settings
   * UI edits, and clamped here rather than trusted: the control offers a fixed
   * list, but a stale payload must not be able to talk us into a rate that means
   * a git spawn per tick. Nothing needs restarting - the rate is read per tick.
   */
  private async setPollSeconds(seconds?: number): Promise<void> {
    const ms = pollIntervalMs(seconds);
    await vscode.workspace
      .getConfiguration()
      .update(POLL_SECONDS_SETTING, ms / 1_000, vscode.ConfigurationTarget.Global);
    diag(`statusPoll: unwatched worktrees re-stat every ${ms / 1_000}s`);
    this.repostSettings();
  }

  /** Push a payload for the settings view alone: no git, no PR work, just the
   *  cached data with the fields the settings tabs read. */
  private repostSettings(): void {
    const data = this.lastData;
    if (!this.view || !data) return;
    if (this.gitPerf) data.gitPerf = this.withSlowFlag(this.gitPerf);
    data.statusPollSeconds = this.pollMs() / 1_000;
    this.lastPosted = ""; // the user clicked; always show the result
    this.postData(data, this.updateSeq);
  }

  // --- Source Control --------------------------------------------------------

  /** Whether the Source Control scope button is enabled (default on). */
  private isScmEnabled(): boolean {
    return this.context.globalState.get<boolean>(SCM_SCOPE_KEY, true);
  }

  /** Turn the Source Control scope button on/off and re-render. */
  private async toggleScm(value?: boolean): Promise<void> {
    await this.context.globalState.update(SCM_SCOPE_KEY, !!value);
    this.lastPosted = "";
    await this.refresh();
  }

  /**
   * Turn debug tracing on/off from the Settings → Debug tab. Writes the same
   * `agentWorktrees.trace` config the toggleTrace command flips, so the host's
   * onDidChangeConfiguration handler re-wires git/GitHub tracing. Re-renders so
   * the toggle reflects the new state.
   */
  private async toggleTrace(value?: boolean): Promise<void> {
    await vscode.workspace
      .getConfiguration()
      .update(TRACE_SETTING, !!value, vscode.ConfigurationTarget.Global);
    this.lastPosted = "";
    await this.refresh();
  }

  // --- Linked files ----------------------------------------------------------

  /** The whole per-repo linked-paths map from globalState (repo root → paths). */
  private linkedPathsMap(): Record<string, string[]> {
    return this.context.globalState.get<Record<string, string[]>>(
      LINKED_PATHS_KEY,
      {}
    );
  }

  /** The configured relative paths symlinked into `repoRoot`'s worktrees. */
  private getLinkedPaths(repoRoot: string): string[] {
    return this.linkedPathsMap()[normalize(repoRoot)] ?? [];
  }

  /** Persist `paths` for `repoRoot`, dropping the entry entirely when empty so
   *  the stored map doesn't accumulate blanks for repos that opt back out. */
  private async setLinkedPaths(
    repoRoot: string,
    paths: string[]
  ): Promise<void> {
    const key = normalize(repoRoot);
    const map = { ...this.linkedPathsMap() };
    if (paths.length) map[key] = paths;
    else delete map[key];
    await this.context.globalState.update(LINKED_PATHS_KEY, map);
    this.lastPosted = "";
    await this.refresh();
  }

  /** Canonical form of a typed/picked entry: forward slashes, no leading "./"
   *  or "/" and no trailing slash, so the same file entered two ways is one
   *  entry. */
  private static normalizeLinkRel(raw: string): string {
    return raw
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.?\//, "")
      .replace(/\/+$/, "");
  }

  /**
   * Convert a typed or picked path into the stored repo-relative form, or
   * undefined when it lands outside the repository (which has no such form).
   *
   * Absolute input is accepted and made relative: pasting a full path is a
   * natural thing to do, and on Windows `C:\repo\...` would otherwise be stored
   * verbatim and then resolve to a target outside the worktree. Drive-letter and
   * UNC prefixes are detected explicitly because `path.isAbsolute` only
   * recognizes them when the host itself is Windows.
   */
  private toRepoRelative(primary: string, input: string): string | undefined {
    const cleaned = input.trim().replace(/\\/g, "/");
    if (!cleaned) return undefined;
    const isAbs =
      path.isAbsolute(cleaned) ||
      /^[a-zA-Z]:\//.test(cleaned) ||
      cleaned.startsWith("//");
    if (!isAbs) return WorktreeWebviewProvider.normalizeLinkRel(cleaned);
    // Canonicalize both sides so a drive-letter case or trailing-slash
    // difference can't make an in-repo path look external.
    const rel = path.relative(normalize(primary), normalize(cleaned));
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
    return WorktreeWebviewProvider.normalizeLinkRel(rel);
  }

  /** Add one repo-relative path to the linked-files list (deduped, blanks
   *  ignored) and link it into every existing worktree right away. */
  private async addLinkedPath(raw?: string): Promise<void> {
    const primary = await this.primaryWorktree();
    if (!primary) return;
    const typed = (raw ?? "").trim();
    if (!typed) return;
    const rel = this.toRepoRelative(primary, typed);
    if (!rel) {
      vscode.window.showWarningMessage(
        `"${typed}" is outside the repository. Linked files must live inside it.`
      );
      return;
    }
    await this.addLinkedPathsFor(primary, [rel]);
  }

  /**
   * Persist any of `rels` not already listed, then link the whole set into the
   * worktrees that already exist (the "existing" half of the setting) so a path
   * is usable the moment it is added.
   */
  private async addLinkedPathsFor(
    primary: string,
    rels: string[]
  ): Promise<void> {
    if (!rels.length) return;
    const current = this.getLinkedPaths(primary);
    const added = rels.filter((r) => !current.includes(r));
    if (added.length) {
      await this.setLinkedPaths(primary, [...current, ...added]);
    }
    await this.linkInExistingWorktrees(primary, rels);
  }

  /**
   * Pick files (or folders, where the platform's dialog allows both) with VS
   * Code's native open dialog instead of typing a path, rooted at the repo. A
   * selection outside the repository is rejected: a link must be expressible as
   * a repo-relative path for it to mean the same thing in every worktree.
   */
  private async browseLinkedPath(): Promise<void> {
    const primary = await this.primaryWorktree();
    if (!primary) {
      vscode.window.showErrorMessage("No git repository in this window.");
      return;
    }
    const picked = await vscode.window.showOpenDialog({
      defaultUri: vscode.Uri.file(primary),
      canSelectFiles: true,
      canSelectFolders: true,
      canSelectMany: true,
      openLabel: "Link",
      title: "Choose files to link into every worktree",
    });
    if (!picked?.length) return;

    const rels: string[] = [];
    const outside: string[] = [];
    for (const uri of picked) {
      const rel = this.toRepoRelative(primary, uri.fsPath);
      if (!rel) {
        outside.push(uri.fsPath);
        continue;
      }
      rels.push(rel);
    }

    if (outside.length) {
      vscode.window.showWarningMessage(
        `Linked files must live inside the repository. Skipped: ${outside.join(", ")}`
      );
    }
    await this.addLinkedPathsFor(primary, rels);
  }

  /** Upper bound on the ignored paths offered at once. `--directory` already
   *  collapses whole ignored trees, so hitting this means a repo with a genuinely
   *  huge spread of ignored files; the quick pick stays responsive and the user
   *  is told the list was cut rather than silently shown a partial view. */
  private static readonly MAX_IGNORED_CHOICES = 2000;

  /**
   * Offer everything git ignores as a multi-select quick pick, so the files that
   * need linking (which are gitignored almost by definition — that is exactly
   * why `git worktree add` doesn't bring them along) can be ticked instead of
   * typed. Paths already on the list are filtered out.
   */
  private async pickIgnoredPaths(): Promise<void> {
    const primary = await this.primaryWorktree();
    if (!primary) {
      vscode.window.showErrorMessage("No git repository in this window.");
      return;
    }

    let ignored;
    try {
      ignored = await listIgnoredPaths(primary);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Could not read ignored files: ${(err as Error).message}`
      );
      return;
    }

    const already = new Set(this.getLinkedPaths(primary));
    let candidates = ignored.filter((e) => !already.has(e.path));
    if (!candidates.length) {
      vscode.window.showInformationMessage(
        ignored.length
          ? "Every ignored file is already linked."
          : "This repository has no ignored files to link."
      );
      return;
    }

    // Files first, then whole ignored directories (which are usually build
    // output the user does not want), each alphabetical — so the config files
    // this feature exists for are at the top.
    candidates.sort((a, b) =>
      a.isDir !== b.isDir
        ? a.isDir
          ? 1
          : -1
        : a.path.localeCompare(b.path)
    );
    const total = candidates.length;
    const capped = total > WorktreeWebviewProvider.MAX_IGNORED_CHOICES;
    if (capped) {
      candidates = candidates.slice(
        0,
        WorktreeWebviewProvider.MAX_IGNORED_CHOICES
      );
    }

    const picked = await vscode.window.showQuickPick(
      candidates.map((e) => ({
        label: e.path,
        description: e.isDir ? "folder" : undefined,
        entry: e,
      })),
      {
        canPickMany: true,
        matchOnDescription: true,
        title: capped
          ? `Ignored files (showing first ${candidates.length} of ${total})`
          : "Ignored files",
        placeHolder:
          "Pick the ignored files to symlink into every worktree (type to filter)",
      }
    );
    if (!picked?.length) return;

    await this.addLinkedPathsFor(
      primary,
      picked.map((p) => p.entry.path)
    );
  }

  /**
   * Remove a path from the list and clean up the symlinks it created. Only a
   * symlink pointing at this repo's copy of that path is unlinked (see
   * unlinkPathFromWorktree) — a real file a worktree owns is never touched, and
   * removing a symlink never affects the file it pointed at.
   */
  private async removeLinkedPath(raw?: string): Promise<void> {
    const primary = await this.primaryWorktree();
    if (!primary) return;
    const rel = (raw ?? "").trim();
    if (!rel) return;
    const next = this.getLinkedPaths(primary).filter((p) => p !== rel);
    await this.setLinkedPaths(primary, next);
    try {
      for (const w of await listWorktrees(primary)) {
        if (normalize(w.path) === normalize(primary)) continue;
        await unlinkPathFromWorktree(primary, w.path, rel);
      }
    } catch {
      // Best effort: the entry is already gone from the list either way.
    }
  }

  /** Re-apply the whole linked-files list to every existing worktree (the
   *  "Link existing worktrees" button), then report what happened. */
  private async relinkWorktrees(): Promise<void> {
    const primary = await this.primaryWorktree();
    if (!primary) return;
    const paths = this.getLinkedPaths(primary);
    if (!paths.length) {
      vscode.window.showInformationMessage(
        "No linked files configured yet. Add a path first."
      );
      return;
    }
    await this.linkInExistingWorktrees(primary, paths, true);
  }

  /**
   * Symlink `paths` into every worktree except the primary one (which already
   * holds the real files). `announceEmpty` makes the "nothing to do, all good"
   * case say so out loud — used by the explicit button but not by the quiet
   * add-a-path path. Link failures are always surfaced.
   */
  private async linkInExistingWorktrees(
    primary: string,
    paths: string[],
    announceEmpty = false
  ): Promise<void> {
    let worktrees;
    try {
      worktrees = await listWorktrees(primary);
    } catch {
      return;
    }
    const others = worktrees.filter((w) => normalize(w.path) !== normalize(primary));
    if (!others.length) {
      if (announceEmpty) {
        vscode.window.showInformationMessage(
          "No other worktrees to link into yet. New worktrees get these files automatically."
        );
      }
      return;
    }
    const failures: LinkOutcome[] = [];
    for (const w of others) {
      const outcomes = await linkPathsIntoWorktree(primary, w.path, paths);
      failures.push(...linkFailures(outcomes));
    }
    this.reportLinkFailures(failures);
    if (!failures.length && announceEmpty) {
      vscode.window.showInformationMessage(
        `Linked ${paths.length} file${paths.length === 1 ? "" : "s"} into ${others.length} worktree${others.length === 1 ? "" : "s"}.`
      );
    }
    await this.refresh();
  }

  /**
   * Apply the repo's linked-files list to a single freshly created worktree.
   * Called from the worktree-creation paths so a new worktree can build/test
   * against the same local config as the primary. Never throws — a link problem
   * warns but must not fail the worktree creation.
   */
  private async applyLinksToNewWorktree(
    primary: string,
    worktreeDir: string
  ): Promise<void> {
    const paths = this.getLinkedPaths(primary);
    if (!paths.length) return;
    try {
      const outcomes = await linkPathsIntoWorktree(primary, worktreeDir, paths);
      this.reportLinkFailures(linkFailures(outcomes));
    } catch {
      // linkPathsIntoWorktree is already non-throwing per path; this is a belt.
    }
  }

  /** Surface link problems as one warning, listing the paths that didn't link
   *  and why. A "real file already exists" or "source missing" is worth telling
   *  the user; a clean run stays silent. */
  private reportLinkFailures(failures: readonly LinkOutcome[]): void {
    if (!failures.length) return;
    const lines = failures.map((f) => `${f.path}: ${f.message ?? f.status}`);
    vscode.window.showWarningMessage(
      `Some linked files could not be symlinked. ${lines.join(" ")}`
    );
  }

  /** The built-in Git extension's API, activating it first if needed. */
  private async gitApi(): Promise<GitApi | undefined> {
    const ext = vscode.extensions.getExtension<GitExtensionExports>("vscode.git");
    if (!ext) return undefined;
    try {
      const exports = ext.isActive ? ext.exports : await ext.activate();
      return exports.getAPI(1);
    } catch {
      return undefined;
    }
  }

  /**
   * Follow the Git extension's own working-tree signal.
   *
   * The panel runs no file watcher of its own, deliberately (see
   * [refresh coalescing](../docs/refresh-coalescing.md)), which left one visible
   * gap: with no agent on any card, nothing triggers a refresh at all. A change
   * the user staged, made or discarded in the Source Control view sitting right
   * above the panel kept its old count until they clicked Refresh: the panel
   * disagreeing with the view directly above it.
   *
   * The built-in Git extension is already watching every repository it has open
   * and already debounces its own status runs, so `Repository.state.onDidChange`
   * is that signal for free: no second watcher, and it fires for exactly the
   * repositories the Source Control view is showing counts for. Each event
   * re-stats the worktree it names (see onRepoStateChange), coalesced the same
   * 500ms as every other discrete trigger.
   *
   * The map this builds is also what splits the poll's two tiers: a card in here
   * has a change event of its own and does not need polling, a card that is not
   * does. Deriving the tier from the live subscriptions rather than a second
   * record is what makes the Source Control scope button work without knowing
   * about any of this - scoping closes every other repository (see
   * applyScopeScm), those entries come out via onDidCloseRepository, and their
   * cards fall back onto the poll on their own.
   *
   * This is safe from the feedback loop that made a `**\/*` watcher untenable:
   * our git runs are read-only and set `GIT_OPTIONAL_LOCKS=0`, so they never
   * rewrite `.git/index` and cannot be what the extension is reporting.
   */
  private async ensureRepoStateWatch(): Promise<void> {
    const api = await this.gitApi();
    if (!api) return;
    const watch = (repo: GitApiRepository) => {
      const key = normalize(repo.rootUri.fsPath);
      if (this.repoStateWatch.has(key)) return;
      const event = repo.state?.onDidChange;
      if (!event) return;
      this.repoStateWatch.set(
        key,
        event(() => this.onRepoStateChange(key))
      );
    };
    // Repositories already open, plus every one discovered later. On a fresh
    // window the extension is often still scanning, so this loop finds nothing
    // and the open event does the work; when we resolve after the scan it is the
    // other way round.
    for (const repo of api.repositories) watch(repo);
    if (this.repoWatchSet) return;
    this.repoWatchSet = true;
    this.context.subscriptions.push(
      api.onDidOpenRepository((repo) => watch(repo)),
      api.onDidCloseRepository((repo) => {
        const key = normalize(repo.rootUri.fsPath);
        this.repoStateWatch.get(key)?.dispose();
        this.repoStateWatch.delete(key);
      })
    );
  }

  /** Subscribe (once) to repo open/close so the panel re-renders when the
   *  Source Control scope changes underneath us. */
  private async ensureScmWatch(): Promise<void> {
    if (this.scmWatchSet) return;
    const api = await this.gitApi();
    if (!api) return;
    this.scmWatchSet = true;
    // A repo opening or closing moves only the blue scope pill; nothing about
    // the worktrees' own git state changed. Patch the highlight on the cached
    // payload instead of scheduling a full refresh: the Git extension often
    // registers a newly-scoped worktree AFTER scopeScm's bounded settle gave
    // up, and recovering via the debounced full gather (a git status per
    // worktree) left the pill trailing the Source Control view by seconds on
    // Windows with many worktrees.
    const onScm = () => void this.refreshScmHighlight();
    this.context.subscriptions.push(
      api.onDidOpenRepository(onScm),
      api.onDidCloseRepository(onScm)
    );
    // On a fresh window the Git extension may still be discovering repositories
    // when we first read them, leaving the active scope un-highlighted. Refresh
    // once it finishes initializing so the state populates on load.
    if (api.onDidChangeState) {
      this.context.subscriptions.push(api.onDidChangeState(onScm));
    }
  }

  /** Re-annotate the Source Control highlight on the cached payload and
   *  repost, without any git spawns — the cheap counterpart of a full refresh
   *  for events that can only move the scope pill. postData's unchanged-payload
   *  guard swallows the repost when the highlight did not actually move. */
  private async refreshScmHighlight(): Promise<void> {
    const data = this.lastData;
    if (!this.view || !data || !data.scmEnabled) return;
    const seq = ++this.updateSeq;
    await this.annotateScmActive(data);
    this.postData(data, seq);
  }

  /** Mark the single worktree that is the current Source Control scope as
   *  scmActive. Driven by the user's last explicit scope (not raw open-state),
   *  so exactly one button highlights even when the Git extension keeps several
   *  repositories open. */
  private async annotateScmActive(data: WorktreeData): Promise<void> {
    await this.ensureScmWatch();
    const api = await this.gitApi();
    const openPaths: string[] = [];
    if (api)
      for (const r of api.repositories) openPaths.push(normalize(r.rootUri.fsPath));
    const scoped =
      this.context.globalState.get<string>(SCM_SCOPED_PATH_KEY) ?? null;
    for (const wt of data.worktrees) {
      wt.scmActive = isScmActive(normalize(wt.path), openPaths, scoped);
    }
  }

  /**
   * Scope the Source Control view to the selected worktree: open its repository
   * if needed, then close every other open repo so only this worktree's diffs
   * remain (the button is "show only this worktree"). Does not switch the user
   * to the Source Control view.
   */
  private async scopeScm(fsPath?: string): Promise<void> {
    if (!fsPath || !this.isScmEnabled()) return;
    const api = await this.gitApi();
    if (!api) {
      vscode.window.showErrorMessage(
        "The built-in Git extension is not available."
      );
      return;
    }

    const target = normalize(fsPath);
    const uri = vscode.Uri.file(fsPath);
    // Confirm a repo exists at the target before mutating the current scope.
    const repo =
      api.getRepository(uri) ?? (await api.openRepository(uri).catch(() => null));
    if (!repo) {
      vscode.window.showErrorMessage(`No git repository at ${fsPath}.`);
      return;
    }

    // Drive the (testable) scope algorithm against the live Git model. It opens
    // the target, swaps out a lone previous scope, self-heals if that close
    // drops the worktree, and waits for the model to settle.
    const model: ScmModel = {
      list: () => api.repositories.map((r) => normalize(r.rootUri.fsPath)),
      open: async (p) => {
        await api.openRepository(vscode.Uri.file(p)).catch(() => {});
      },
      close: async (p) => {
        // Pass the Repository object, not a Uri: `git.close` resolves a repo
        // reliably, whereas a bare Uri can silently no-op and leave the previous
        // scope open (the "color changes but the view doesn't switch" bug).
        const repo = api.repositories.find(
          (r) => normalize(r.rootUri.fsPath) === p
        );
        await vscode.commands
          .executeCommand("git.close", repo ?? vscode.Uri.file(p))
          .then(undefined, () => {});
      },
    };
    // Remember the choice BEFORE driving the swap: the open/close events the
    // swap fires trigger highlight reposts, and one that ran before this write
    // used to paint the OLD scope mid-swap (corrected only by the final full
    // refresh, seconds later on a many-worktree Windows setup).
    await this.context.globalState.update(SCM_SCOPED_PATH_KEY, target);

    await applyScopeScm(model, target);

    // Reflect the new scope on the buttons without switching to the view. The
    // swap changes which repos are open, never the worktrees' git state, so
    // patching the highlight is enough — no full gather. Only when the Git
    // model already lists the target, though: if it is still registering the
    // repo (it regularly outlives applyScopeScm's bounded settle on Windows
    // with many worktrees), an eager repost would paint "no scope anywhere"
    // over the webview's optimistic highlight. Leave that window to the
    // onDidOpenRepository watcher, which patches the moment the repo lands.
    if (model.list().includes(target)) {
      await this.refreshScmHighlight();
    }
  }

  // --- GitHub settings -------------------------------------------------------

  /** Open the settings modal in the webview (from the title-bar command). */
  openSettings(): void {
    void this.view?.webview.postMessage({ type: "openSettings" });
  }

  /** Store a pasted PAT, re-probe, and refresh PR status. */
  private async setGithubToken(token?: string): Promise<void> {
    const t = token?.trim();
    if (!t) return;
    try {
      await setToken(t);
    } catch (e) {
      vscode.window.showErrorMessage(
        `Could not save GitHub token: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }
    this.prService.reauth();
    this.branchPrs = undefined; // credential changed: drop the cached branch PRs
    this.branchPrsAt = undefined;
    this.lastPosted = "";
    await this.refresh();
  }

  /** Forget the stored token; PR badges disappear on the next render. */
  private async clearGithubToken(): Promise<void> {
    try {
      await clearToken();
    } catch {
      /* best effort */
    }
    this.prService.reauth();
    this.branchPrs = undefined; // credential changed: drop the cached branch PRs
    this.branchPrsAt = undefined;
    this.lastPosted = "";
    await this.refresh();
  }

  /** Turn the PR integration on/off without discarding the stored token. */
  private async togglePr(value?: boolean): Promise<void> {
    await this.prService.setEnabled(!!value);
    this.branchPrs = undefined; // integration toggled: refetch (or clear) branch PRs
    this.branchPrsAt = undefined;
    this.lastPosted = "";
    await this.refresh();
  }

  /** The folder the panel operates on (the opened repo/worktree). */
  private repoCwd(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  /** Path of the repository's primary (main) worktree, listed from any folder. */
  private async primaryWorktree(): Promise<string | undefined> {
    const cwd = this.repoCwd();
    if (!cwd) return undefined;
    try {
      const wts = await listWorktrees(cwd);
      return wts.find((w) => w.isPrimary)?.path;
    } catch {
      return undefined;
    }
  }

  // --- Agents ----------------------------------------------------------------

  /**
   * Spin up a Claude CLI session in the given worktree. We launch Claude with a
   * session id we generate so the panel row, its state file, and its terminal
   * all share one id — that link is what lets focus and stop reach the right
   * terminal. Each click gets its own terminal so agents can run side by side
   * across worktrees.
   */
  private async agent(fsPath?: string): Promise<void> {
    if (!fsPath) return;
    const sessionId = randomUUID();
    const terminal = vscode.window.createTerminal({
      ...this.launchName(`Claude · ${nameOf(fsPath)}`),
      cwd: fsPath,
      iconPath: this.terminalIcon,
      env: { [WorktreeWebviewProvider.SID_ENV]: sessionId },
    });
    this.terminals.set(sessionId, terminal);
    terminal.show();
    terminal.sendText(`claude --session-id ${sessionId}`);
    await this.refresh();
  }

  /**
   * Create a new worktree AND start an agent in it in one step, delegating the
   * worktree creation and naming to Claude via `claude -w`. We still pass our
   * own session id so the new agent links to its panel row, and remember the
   * launch dir so the next refresh can auto-mount the worktree Claude creates
   * (no window reload) once its state file reveals the new path.
   */
  private async agentWorktree(): Promise<void> {
    const cwd = this.repoCwd() ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
      vscode.window.showErrorMessage("No git repository in this window.");
      return;
    }
    const sessionId = randomUUID();
    const terminal = vscode.window.createTerminal({
      ...this.launchName("Claude · new worktree"),
      cwd,
      iconPath: this.terminalIcon,
      env: { [WorktreeWebviewProvider.SID_ENV]: sessionId },
    });
    this.terminals.set(sessionId, terminal);
    terminal.show();
    terminal.sendText(`claude --session-id ${sessionId} -w`);
    await this.refresh();
  }

  /**
   * The terminal an agent is running in, or undefined when it is not in this
   * window.
   *
   * The id we launched Claude with is only a hint. It is what the terminal's env
   * marker and this map are keyed by, but the row comes from the session
   * registry, and a session can report an id that is not the one in its argv:
   * `claude -w` registers a *child* process under a fresh id (measured on
   * 2.1.220 - see processTree.ts). For those rows the id lookup can only miss,
   * which is what made Reveal claim the terminal was in another window while the
   * user was looking at it, and made Stop kill nothing at all.
   *
   * So when the id misses, ask the OS instead: the session's registry pid runs
   * somewhere beneath exactly one terminal's shell, and only in this window.
   * The answer is cached under the registry's id, so the process listing is paid
   * once per session rather than once per click.
   */
  private async resolveTerminal(
    sessionId: string
  ): Promise<vscode.Terminal | undefined> {
    const known = this.terminals.get(sessionId);
    if (known) return known;
    const pid = await this.claudePidFor(sessionId);
    if (pid === undefined) return undefined;
    const parents = await parentMapSnapshot();
    if (!parents.size) return undefined; // no process listing: id lookup is all we have
    for (const terminal of vscode.window.terminals) {
      const shell = await terminal.processId;
      if (shell === undefined) continue;
      if (!isDescendantOf(pid, shell, parents)) continue;
      diag(`terminal for session ${sessionId} resolved by pid ${pid} under shell ${shell}`);
      // One id per terminal, and it is the registry's. The launch id this
      // terminal was first filed under matches no row (that is what made the
      // lookup miss), and leaving both in would keep activeSessionId returning
      // the one nothing is keyed by, so the row for the terminal the user is
      // looking at would still never highlight.
      for (const [id, term] of this.terminals) {
        if (term !== terminal) continue;
        this.terminals.delete(id);
        // The name caches are keyed the same way, and forgetTerminal only reaches
        // ids still in this map, so they go now or they never do.
        this.appliedTerminalNames.delete(id);
        this.desiredTerminalNames.delete(id);
      }
      this.terminals.set(sessionId, terminal);
      return terminal;
    }
    return undefined;
  }

  /**
   * The pid behind a row, once confirmed to still be the Claude it claims to be.
   *
   * The registry's pid is only as good as the file it came from, and a session
   * that died without cleaning up (SIGKILL, crash, power loss) leaves one the OS
   * is free to reuse. The liveness probe is a bare existence check, so a recycled
   * pid reads as a live agent. Everything downstream of this either kills the
   * process or caches a terminal against it, so both need the identity, not just
   * the number. This is the guard `killClaudeInDir` has always applied before
   * killing by cwd; the pid paths were the ones missing it.
   */
  private async claudePidFor(sessionId: string): Promise<number | undefined> {
    const pid = (await this.readAgents()).find(
      (s) => s.sessionId === sessionId
    )?.pid;
    if (pid === undefined) return undefined;
    const cmd = await readCommandLine(pid);
    if (namesClaude(cmd)) return pid;
    diag(
      `session ${sessionId}: pid ${pid} is not a claude process (${
        cmd || "no command line"
      }); leaving it alone`
    );
    return undefined;
  }

  /** Reveal the terminal backing an agent (if this window launched it). */
  private async focusAgent(sessionId?: string): Promise<void> {
    if (!sessionId) return;
    const terminal = await this.resolveTerminal(sessionId);
    if (terminal) {
      terminal.show();
      return;
    }
    // The agent list comes from global storage shared across every VS Code
    // window, but terminal handles are per-window. A terminal started in another
    // window (or manually, outside the extension) can't be revealed from here.
    void vscode.window.showInformationMessage(
      "This agent's terminal isn't in this window — it was started in another window or outside Agent Worktrees, so it can't be revealed here."
    );
  }

  /** Stop an agent and remove its row. */
  private async stopAgent(sessionId?: string): Promise<void> {
    if (!sessionId) return;
    await this.stopSession(sessionId);
    void this.refresh();
  }

  /**
   * Stop a session by every means we have, so it dies even if our in-memory
   * terminal handle was lost (an extension-host reload since launch) and even if
   * its id is not the one we launched it with (a `claude -w` child).
   *
   * The registry pid is the primary handle on every platform now. It is written
   * by the Claude process about itself, so it names the exact process behind the
   * row - which `pkill -f <session id>` does not, since a `-w` child's argv
   * carries the id we passed to its *parent*, not its own. Killing by that id
   * silently matched nothing, which is what made the Stop button appear dead.
   *
   * Order matters: tree-kill the pid first, then dispose the terminal, so the
   * teardown cannot race the kill. Disposing also SIGHUPs the pty's foreground
   * process group on POSIX, which reaches the parent `claude -w` process the
   * registry knows nothing about. The registry's liveness probe retires the row
   * once the pid is gone.
   */
  private async stopSession(sessionId: string): Promise<void> {
    if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) return;
    // Resolve before killing: resolution reads the registry for this session's
    // pid, and a dead session has no file left to read it from.
    const terminal = await this.resolveTerminal(sessionId);
    // Confirmed to still be Claude, so a registry file left behind by a crashed
    // session cannot aim a force-kill at whatever now owns that pid.
    const pid = await this.claudePidFor(sessionId);
    if (pid !== undefined) await this.killTreeByPid(pid);
    terminal?.dispose();
    if (pid === undefined && process.platform !== "win32") {
      // Nothing in the registry to kill (it exited between the row being
      // rendered and this click, or its file is unreadable): fall back to the id
      // match, which still reaches an agent we launched ourselves.
      cp.execFile("pkill", ["-f", sessionId], () => {
        /* no match / pkill missing -> nothing to kill */
      });
    }
  }

  /**
   * Kill every Claude process whose working directory is this worktree (or
   * nested under it). This is the reliable stop for `claude -w` agents: Claude
   * runs in the worktree it created, and an interactive `-w` session forks a
   * child whose argv no longer carries our --session-id, so killing by cwd is
   * what actually reaches it. Only safe when removing a whole worktree — never
   * for a shared dir like the main repo, which would also kill unrelated agents.
   */
  private killClaudeInDir(dir: string): void {
    // Windows: there is no portable way to read another process's cwd, but it
    // does not need one. stopSession already tree-kills each tracked agent by
    // its registry pid (taskkill /T), which reaches the `claude -w` child this
    // method exists to catch on Unix. So the worktree's agents are already gone
    // by the time this runs on Windows.
    if (process.platform === "win32") return;
    const norm = normalize(dir);
    let out = "";
    try {
      out = cp.execSync("lsof -a -d cwd -Fpn 2>/dev/null || true", {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      });
    } catch {
      return; // lsof missing -> nothing we can do here
    }
    let pid = 0;
    const victims = new Set<number>();
    for (const line of out.split("\n")) {
      const tag = line[0];
      if (tag === "p") pid = Number(line.slice(1));
      else if (tag === "n" && pid) {
        const cwd = line.slice(1);
        if (cwd === norm || cwd.startsWith(norm + path.sep)) victims.add(pid);
      }
    }
    for (const p of victims) {
      try {
        const cmd = cp.execSync(`ps -p ${p} -o command=`, { encoding: "utf8" });
        if (/claude/i.test(cmd)) process.kill(p);
      } catch {
        /* already gone, or not killable */
      }
    }
  }

  /**
   * Kill the process behind a row, and its children, by pid.
   *
   * Windows uses `taskkill /PID <pid> /T /F`: the pid comes from Claude's session
   * registry, so no process-table scan is needed — this replaces a PowerShell
   * `Get-CimInstance Win32_Process` sweep that enumerated every process and
   * paid PowerShell's multi-second cold start on each stop.
   *
   * POSIX sends SIGTERM to the pid itself - one process, not a group, with the
   * terminal dispose that follows doing the rest via SIGHUP - letting Claude shut
   * down and remove its own registry file. This used to be a no-op here, on the assumption that
   * disposing the terminal was enough; it is not for a row whose terminal we
   * could not identify, which was every `claude -w` agent (see stopSession).
   * SIGTERM rather than SIGKILL: the process being asked to stop is one that
   * cleans up after itself (a worktree lock, its registry entry), and the caller
   * disposes the terminal straight after, which SIGHUPs anything still standing.
   *
   * Callers must pass a pid confirmed to be Claude (see claudePidFor): this will
   * force-kill a whole tree on Windows, and a recycled pid from a stale registry
   * file would otherwise take an unrelated process with it.
   *
   * Best-effort throughout: an already-dead pid or a missing taskkill is a no-op.
   * Resolves once the kill has run (or failed) so callers can order a terminal
   * dispose after it.
   */
  private killTreeByPid(pid: number): Promise<void> {
    if (process.platform !== "win32") {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already gone, or not ours to kill */
      }
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      try {
        cp.execFile(
          "taskkill",
          ["/PID", String(pid), "/T", "/F"],
          { windowsHide: true },
          () => resolve() /* already gone / access denied -> best effort */
        );
      } catch {
        resolve(); /* spawn failed -> nothing we can do */
      }
    });
  }

  // --- Windows ---------------------------------------------------------------

  /**
   * Open a worktree in its own VS Code window. We prefer the `code` CLI because
   * VS Code dedupes folders across windows: if a window for this worktree is
   * already open the CLI focuses it (so re-clicking switches to it) instead of
   * opening a duplicate, and otherwise opens a fresh window. The extension API
   * can neither enumerate nor focus other windows, so when the CLI is not on
   * PATH we fall back to vscode.openFolder, which always opens a new window.
   */
  private async openWindow(fsPath?: string): Promise<void> {
    if (!fsPath) return;
    if (await this.openViaCodeCli(fsPath)) return;
    await vscode.commands.executeCommand(
      "vscode.openFolder",
      vscode.Uri.file(fsPath),
      { forceNewWindow: true }
    );
  }

  /**
   * Launch the `code` (or `code-insiders`) CLI on a folder. Resolves true once
   * the process has spawned, false if the binary is not found so the caller can
   * fall back to the API path.
   */
  private openViaCodeCli(fsPath: string): Promise<boolean> {
    const bin = vscode.env.appName.includes("Insiders")
      ? "code-insiders"
      : "code";
    const isWin = process.platform === "win32";
    return new Promise<boolean>((resolve) => {
      try {
        // On Windows go through a shell so the `code.cmd` shim resolves via
        // PATHEXT, and quote the path since the shell re-parses the argument.
        const child = isWin
          ? cp.spawn(bin, [`"${fsPath}"`], {
              shell: true,
              detached: true,
              stdio: "ignore",
              windowsHide: true,
            })
          : cp.spawn(bin, [fsPath], { detached: true, stdio: "ignore" });
        child.once("error", () => resolve(false));
        child.once("spawn", () => {
          child.unref();
          resolve(true);
        });
      } catch {
        resolve(false);
      }
    });
  }

  // --- Finding files in a worktree -------------------------------------------

  /**
   * Open Find in Files scoped to one worktree.
   *
   * A worktree is a sibling directory, not a workspace folder, so the search
   * view's default scope (this window's folders) never covers it: today reaching
   * a worktree's contents means opening it in its own window, which is exactly
   * what splits the agents across windows. VS Code's search does honour an
   * absolute path in "files to include" even when it lies outside the workspace,
   * so pre-filling the include box scopes the search to the worktree without
   * mutating the workspace or reloading the window.
   *
   * The query is left empty (the user types it) and the includes/excludes row is
   * expanded, so the scope the search is running under is visible rather than
   * silently applied.
   */
  private async searchWorktree(fsPath?: string): Promise<void> {
    if (!fsPath) return;
    await vscode.commands.executeCommand("workbench.action.findInFiles", {
      filesToInclude: fsPath,
      triggerSearch: false,
      showIncludesExcludes: true,
    });
  }

  /**
   * Quick Open for one worktree: pick a file by name and open it in this window.
   *
   * `Ctrl/Cmd+P` only indexes the workspace folders, so it cannot reach a
   * worktree either. The list comes from git (`--cached --others
   * --exclude-standard`), which is the same set Quick Open would show and keeps
   * gitignored build output out without us maintaining an exclusion list.
   *
   * The item list is handed to showQuickPick as a promise so the picker paints
   * immediately with its own loading state instead of the sidebar button
   * appearing dead while git runs. Files open through `vscode.open` rather than
   * showTextDocument so a non-text pick (an image, a PDF) lands in the editor
   * that can render it instead of failing.
   */
  private async findWorktreeFile(fsPath?: string): Promise<void> {
    if (!fsPath) return;
    const name = nameOf(fsPath);
    const listing = listWorktreeFiles(fsPath).catch((err: unknown) => {
      const first = (err instanceof Error ? err.message : String(err)).split(
        "\n"
      )[0];
      void vscode.window.showErrorMessage(
        `Could not list files in ${name}: ${first}`
      );
      return { files: [] as string[], truncated: false };
    });
    // label/description split mirrors Quick Open: file name first, its directory
    // as the dimmed remainder. matchOnDescription then makes typing part of the
    // path narrow the list, as it would there.
    const items = listing.then(({ files }) =>
      files.map((rel) => {
        const dir = path.dirname(rel);
        return {
          label: path.basename(rel),
          description: dir === "." ? "" : dir,
          rel,
        };
      })
    );
    // A hit cap is stated, never silent: a truncated list would otherwise make a
    // missing file read as "not in the worktree". Fired as the listing resolves
    // (not after the pick) so the caveat arrives while the picker is still open;
    // a notification does not close it or take its focus.
    void listing.then(({ truncated }) => {
      if (!truncated) return;
      const cap = WORKTREE_FILE_CAP.toLocaleString();
      void vscode.window.showWarningMessage(
        `${name} has more than ${cap} files; the picker lists the first ${cap}.`
      );
    });
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: `Find file in ${name}`,
      matchOnDescription: true,
    });
    if (!pick) return;
    await vscode.commands.executeCommand(
      "vscode.open",
      vscode.Uri.file(path.join(fsPath, pick.rel))
    );
  }

  /**
   * Re-link a terminal to its session by the session id we stamped in its
   * creation env. VS Code restores agent terminals across an extension-host
   * reload but our in-memory handle map is rebuilt empty, leaving focus/stop
   * unable to find them; reading the marker back rebuilds the link.
   * Seeds the applied-name cache from the live tab name so the next refresh
   * doesn't needlessly rename (and reveal) an already correctly named terminal.
   */
  private reclaimTerminal(terminal: vscode.Terminal): void {
    const opts = terminal.creationOptions as vscode.TerminalOptions;
    const sessionId = opts?.env?.[WorktreeWebviewProvider.SID_ENV];
    if (!sessionId || this.terminals.get(sessionId) === terminal) return;
    this.terminals.set(sessionId, terminal);
    this.appliedTerminalNames.set(sessionId, terminal.name);
  }

  /** Drop our handle to a terminal that has closed. */
  private forgetTerminal(terminal: vscode.Terminal): void {
    for (const [id, term] of this.terminals) {
      if (term === terminal) {
        this.terminals.delete(id);
        this.appliedTerminalNames.delete(id);
        this.desiredTerminalNames.delete(id);
      }
    }
  }

  /** Session id of the agent owning the currently active terminal, or "". */
  private activeSessionId(): string {
    const active = vscode.window.activeTerminal;
    if (!active) return "";
    for (const [id, term] of this.terminals) {
      if (term === active) return id;
    }
    return "";
  }

  /** Tell the sidebar which agent's terminal is active so it can highlight the
   *  row. Sent on every active-terminal change; "" clears the highlight. */
  private postActiveTerminal(): void {
    void this.view?.webview.postMessage({
      type: "activeTerminal",
      sessionId: this.activeSessionId(),
    });
  }

  /**
   * The `name` half of an agent terminal's creation options — present only when
   * we have to name the tab ourselves.
   *
   * Passing `name` to `createTerminal` is not free: VS Code treats it as a
   * static API title, which permanently disposes the listener that would
   * otherwise apply the OSC title escape sequences the process emits
   * (`TitleEventSource.Api` beats `Sequence`, and it cannot be re-enabled
   * afterwards). Claude Code emits exactly such a sequence, continuously,
   * carrying the same generated topic the panel shows — and since 1.117 VS Code
   * recognises an agent CLI from that sequence and switches the tab title
   * template to `${sequence}` on its own (`terminal.integrated.tabs.
   * allowAgentCliTitle`, on by default). So on a new enough host the best thing
   * we can do for the tab title is stay out of the way: Claude renames its own
   * tab, live, including while the terminal sits in the background, which no
   * extension API can do (`Terminal.name` is read-only and the rename command
   * only ever targets the active terminal).
   *
   * On older hosts, or when the user has turned that setting off, the template
   * stays `${process}` and an unnamed tab would just read "node", so we keep
   * naming it ourselves and fall back to renaming via syncTerminalNames.
   */
  private launchName(name: string): { name?: string } {
    return this.agentCliTitleSupported() ? {} : { name };
  }

  /** Whether this host resolves agent terminal titles from the CLI's own title
   *  escape sequence (VS Code >= 1.117, and the user has not opted out). */
  private agentCliTitleSupported(): boolean {
    return supportsAgentCliTitle(
      vscode.version,
      vscode.workspace
        .getConfiguration()
        .get<boolean>("terminal.integrated.tabs.allowAgentCliTitle", true) !==
        false
    );
  }

  /**
   * Queue each agent's terminal to be named like its panel row: the work
   * summary (Claude's generated title). Until that exists the terminal keeps
   * its launch name ("Claude · <worktree>"); we never name it after the raw
   * prompt. Queued, not applied: see flushTerminalNames for why.
   *
   * Only for terminals we named at launch — where the host resolves the title
   * from Claude's own escape sequence there is nothing to do; see launchName.
   */
  private syncTerminalNames(byPath: Map<string, AgentVM[]>): void {
    if (this.agentCliTitleSupported()) return;
    for (const list of byPath.values()) {
      for (const a of list) {
        if (!this.terminals.has(a.sessionId)) continue;
        const desired = a.summary;
        if (!desired) continue; // nothing meaningful yet; keep the launch name
        if (this.appliedTerminalNames.get(a.sessionId) === desired) continue;
        this.desiredTerminalNames.set(a.sessionId, desired);
      }
    }
    void this.flushTerminalNames();
  }

  /**
   * Apply a queued rename, but only to the terminal the user is already looking
   * at.
   *
   * The only rename VS Code exposes is the
   * `workbench.action.terminal.renameWithArg` command, which acts on the
   * *active* terminal — there is no per-terminal rename API and `Terminal.name`
   * is read-only. Revealing a background terminal to rename it is what used to
   * yank the terminal view onto whichever agent had just answered while the
   * user was reading another one (`show(true)` preserves keyboard focus, but
   * not the selected tab).
   *
   * So we never reveal anything: a rename is applied only when its terminal is
   * already active, in which case the command needs no `show()` at all and
   * cannot disturb the selection or pop open a hidden panel. Everything else
   * stays queued and lands the moment the user switches back to that terminal
   * (onDidChangeActiveTerminal flushes). Only one terminal is ever active, so
   * at most one rename runs per flush. A terminal the user never returns to
   * simply keeps its launch name; its panel row still shows the summary.
   */
  private async flushTerminalNames(): Promise<void> {
    if (!this.desiredTerminalNames.size) return;
    const active = vscode.window.activeTerminal;
    if (!active) return;
    for (const [sessionId, name] of this.desiredTerminalNames) {
      if (this.terminals.get(sessionId) !== active) continue;
      this.desiredTerminalNames.delete(sessionId);
      this.appliedTerminalNames.set(sessionId, name);
      await vscode.commands.executeCommand(
        "workbench.action.terminal.renameWithArg",
        { name }
      );
      return;
    }
  }

  // --- Worktree git operations -----------------------------------------------

  /**
   * Pre-flight for creating a nested worktree at `dir`: make sure the parent
   * directory exists for `git worktree add`. We deliberately do NOT touch the
   * repo's ignore rules: whether `.claude/worktrees/` is excluded from `git
   * status` is the user's call (one line in `.git/info/exclude` or .gitignore),
   * the same as when `claude -w` creates worktrees there.
   */
  private async prepareWorktreeDir(dir: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(dir), { recursive: true });
  }

  /** Prompt for a branch name and create a worktree for it. */
  async newWorktree(): Promise<void> {
    const primary = await this.primaryWorktree();
    if (!primary) {
      vscode.window.showErrorMessage("No git repository in this window.");
      return;
    }

    const branch = await vscode.window.showInputBox({
      title: "New Worktree",
      prompt: "Branch name for the new worktree",
      placeHolder: "feature/my-change",
      validateInput: (v) => (v.trim() ? undefined : "Enter a branch name."),
    });
    if (!branch) return;

    const dir = worktreeDirFor(primary, branch);

    try {
      await this.prepareWorktreeDir(dir);
      await addWorktree(primary, dir, branch.trim());
    } catch (err) {
      vscode.window.showErrorMessage(
        `Could not create worktree: ${(err as Error).message}`
      );
      return;
    }
    await this.applyLinksToNewWorktree(primary, dir);
    await this.refresh();
  }

  /**
   * Switch the branch a worktree has checked out. Offers a quick pick of the
   * branches that can be checked out here (every local/remote branch except the
   * one already checked out and any held by another worktree, since git allows a
   * branch in only one worktree) plus a "Create new branch" entry that prompts
   * for a name and branches off the worktree's current HEAD. On success both
   * views refresh so the card's branch name and the branches panel update.
   */
  private async changeBranchAction(fsPath?: string): Promise<void> {
    if (!fsPath) return;
    const primary = await this.primaryWorktree();
    if (!primary) {
      vscode.window.showErrorMessage("No git repository in this window.");
      return;
    }
    const target = normalize(fsPath);
    const worktree = (await listWorktrees(primary)).find(
      (w) => normalize(w.path) === target
    );
    if (!worktree) {
      vscode.window.showErrorMessage("That worktree no longer exists.");
      return;
    }
    const current = worktree.detached ? undefined : worktree.branch;

    let branches: BranchInfo[];
    try {
      branches = await listBranches(primary);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Could not list branches: ${(err as Error).message}`
      );
      return;
    }

    const CREATE = "$(add) Create new branch...";
    // Branches you can switch onto: not the one already here, and not held by
    // another worktree (git refuses a second checkout of the same branch).
    const switchable = branches.filter(
      (b) => b.name !== current && !b.hasWorktree
    );
    const items: vscode.QuickPickItem[] = [
      { label: CREATE },
      ...(switchable.length
        ? [
            {
              label: "",
              kind: vscode.QuickPickItemKind.Separator,
            } as vscode.QuickPickItem,
          ]
        : []),
      ...switchable.map((b) => ({
        label: b.name,
        description: b.remoteOnly ? "remote only" : undefined,
      })),
    ];

    const picked = await vscode.window.showQuickPick(items, {
      title: current ? `Switch branch (currently on ${current})` : "Switch branch",
      placeHolder: "Choose a branch to check out, or create a new one",
    });
    if (!picked) return;

    let name: string;
    let create = false;
    if (picked.label === CREATE) {
      const existing = new Set(branches.map((b) => b.name));
      const input = await vscode.window.showInputBox({
        title: "New branch name",
        prompt: `Branch off ${
          current ?? "the current commit"
        } and switch this worktree to it`,
        validateInput: (v) => {
          const t = v.trim();
          if (!t) return "Enter a branch name.";
          if (/\s/.test(t)) return "Branch names cannot contain spaces.";
          if (existing.has(t)) return "A branch with that name already exists.";
          return undefined;
        },
      });
      if (!input) return;
      name = input.trim();
      create = true;
    } else {
      name = picked.label;
    }

    try {
      await switchWorktreeBranch(fsPath, name, { create });
    } catch (err) {
      vscode.window.showErrorMessage(
        `Could not switch branch: ${(err as Error).message}`
      );
      return;
    }
    await this.refresh();
    await this.postBranches();
  }

  /**
   * Remove a worktree from disk behind a single confirmation. Everything the
   * removal touches — running agents, uncommitted changes, the branch and its
   * unpushed commits — is gathered while the directory still exists and
   * disclosed in one modal, whose buttons decide the whole operation (remove,
   * or remove and delete the branch). No follow-up prompts: a dirty or locked
   * worktree is force-removed because the modal already said the directory and
   * any uncommitted changes go away, and the branch delete forces past "not
   * fully merged" when the modal already disclosed the unpushed commits.
   */
  private async removeWorktreeAction(fsPath?: string): Promise<void> {
    if (!fsPath) return;
    const primary = await this.primaryWorktree();
    if (!primary) return;

    const target = normalize(fsPath);
    const worktree = (await listWorktrees(primary)).find(
      (w) => normalize(w.path) === target
    );
    const branch =
      worktree && !worktree.detached ? worktree.branch : undefined;
    let dirty = false;
    if (branch) {
      try {
        dirty = (await getStatus(fsPath)).dirty > 0;
      } catch {
        /* directory unreadable: treat as clean */
      }
    }
    // The default branch is never offered for deletion.
    const deletableBranch =
      branch && branch !== (await defaultBranchName(primary))
        ? branch
        : undefined;
    const unpushed = deletableBranch
      ? await unpushedCommitCount(primary, deletableBranch)
      : 0;

    // Every agent whose worktree is this path, or nested under it.
    const inScope = (key: string) =>
      key === target || key.startsWith(target + path.sep);
    const sessions = await this.indexAgents(await this.readAgents(), [target]);
    const agents: AgentVM[] = [];
    for (const [key, list] of sessions.agents) {
      if (inScope(key)) agents.push(...list);
    }
    let subagents = 0;
    for (const [key, list] of sessions.subagents) {
      if (inScope(key)) subagents += list.length;
    }

    const consequences = [`Deletes ${fsPath}`];
    if (agents.length) {
      consequences.push(
        `Stops ${agents.length} running agent${agents.length === 1 ? "" : "s"}`
      );
    }
    if (subagents) {
      consequences.push(
        `Breaks ${subagents} subagent${
          subagents === 1 ? "" : "s"
        } working in it (owned by a session in another worktree)`
      );
    }
    if (dirty) consequences.push("Discards uncommitted changes");
    if (deletableBranch) {
      consequences.push(
        unpushed > 0
          ? `"Remove and Delete Branch" also deletes "${deletableBranch}", losing ${
              unpushed === 1 ? "1 commit" : `${unpushed} commits`
            } not pushed to its upstream`
          : `"Remove and Delete Branch" also deletes "${deletableBranch}" (fully pushed, nothing lost)`
      );
    }

    const buttons = deletableBranch
      ? ["Remove", "Remove and Delete Branch"]
      : ["Remove"];
    const choice = await vscode.window.showWarningMessage(
      `Remove the worktree${branch ? ` for "${branch}"` : ""}?`,
      { modal: true, detail: consequences.join("\n") },
      ...buttons
    );
    if (!choice) return;

    // Stop the worktree's agents first so no Claude process holds the directory
    // open while git removes it (and they vanish from the panel). stopSession
    // cleans up the ones we track; killClaudeInDir catches any Claude running in
    // the worktree by cwd (notably `claude -w` children that drop our id). Await
    // the stops so every process is gone before git touches the directory --
    // otherwise a still-live Claude (Windows) keeps the worktree locked.
    await Promise.all(agents.map((a) => this.stopSession(a.sessionId)));
    this.killClaudeInDir(fsPath);

    // `claude -w` sessions lock their worktree; now that the session is dead
    // (just killed above, or long gone) the lock is stale and would make the
    // plain remove below fail. Release it so removal doesn't need the Force
    // prompt. Locks with a non-claude reason or a live pid are left alone.
    if (worktree?.locked) {
      await releaseStaleClaudeLocks(primary, [worktree]);
    }

    try {
      await removeWorktree(primary, fsPath);
    } catch {
      // Dirty or locked; the modal already covered everything a force discards.
      try {
        await removeWorktree(primary, fsPath, true);
      } catch (err) {
        vscode.window.showErrorMessage(
          `Could not remove worktree: ${(err as Error).message}`
        );
        return;
      }
    }

    if (choice === "Remove and Delete Branch" && deletableBranch) {
      await this.deleteOrphanedBranch(primary, deletableBranch, unpushed);
    }
    await this.refresh();
    await this.postBranches();
  }

  /**
   * Delete the branch left behind by a worktree removal the user already
   * confirmed. Forces when the confirmation disclosed unpushed commits. When it
   * promised nothing would be lost but git still refuses (the upstream count
   * missed something, e.g. a gone upstream), re-confirm before forcing — the
   * one case a second prompt is warranted.
   */
  private async deleteOrphanedBranch(
    repoRoot: string,
    branch: string,
    unpushed: number
  ): Promise<void> {
    try {
      await deleteBranch(repoRoot, branch, { local: true, force: unpushed > 0 });
    } catch (err) {
      const msg = (err as Error).message;
      if (unpushed === 0 && /not fully merged/i.test(msg)) {
        const retry = await vscode.window.showWarningMessage(
          `Local branch "${branch}" is not fully merged. Force delete it?`,
          { modal: true },
          "Force Delete"
        );
        if (retry !== "Force Delete") return;
        try {
          await deleteBranch(repoRoot, branch, { local: true, force: true });
        } catch (err2) {
          vscode.window.showErrorMessage(
            `Could not delete branch: ${(err2 as Error).message}`
          );
        }
      } else {
        vscode.window.showErrorMessage(`Could not delete branch: ${msg}`);
      }
    }
  }

  // --- HTML ------------------------------------------------------------------

  private html(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const uri = (...p: string[]) =>
      webview.asWebviewUri(
        vscode.Uri.joinPath(this.extensionUri, "media", ...p)
      );
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${uri("panel.css")}" rel="stylesheet" />
  <title>Worktrees</title>
</head>
<body>
  <div id="root">
    <div class="empty">Loading worktrees…</div>
  </div>
  <script nonce="${nonce}" src="${uri("panel.js")}"></script>
</body>
</html>`;
  }

  // --- Branches overlay ------------------------------------------------------

  /**
   * Open (or reveal, if already open) the branches overlay as an editor tab in
   * the active column. The panel is a singleton: re-opening reveals the
   * existing one rather than spawning a duplicate. It reuses the same
   * panel.js / panel.css, switched into branches mode by a view flag in its
   * HTML, and carries its own message channel (separate from the sidebar's).
   */
  private openBranchesPanel(): void {
    if (this.branchesPanel) {
      this.branchesPanel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "worktreeView.branches",
      "Branches",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "media"),
        ],
        retainContextWhenHidden: true,
      }
    );
    panel.iconPath = this.terminalIcon;
    panel.webview.html = this.branchesHtml(panel.webview);
    panel.webview.onDidReceiveMessage((msg: ActionMessage) =>
      this.onBranchesMessage(msg)
    );
    // Refreshes skip the panel while it is hidden (see refresh()), so re-post
    // when it comes back into view to catch up on anything missed. PR data is
    // reused from cache — becoming visible never hits the GitHub API.
    panel.onDidChangeViewState(({ webviewPanel }) => {
      if (webviewPanel.visible) void this.postBranches(false);
    });
    panel.onDidDispose(() => {
      this.branchesPanel = undefined;
    });
    this.branchesPanel = panel;
  }

  /**
   * HTML for the branches editor panel. Mirrors `html()` but injects a nonce'd
   * inline script setting `window.AWT_VIEW = "branches"` before panel.js loads,
   * so the shared panel script renders the branches view instead of the
   * sidebar. The CSP already permits the nonce'd inline script.
   */
  private branchesHtml(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const uri = (...p: string[]) =>
      webview.asWebviewUri(
        vscode.Uri.joinPath(this.extensionUri, "media", ...p)
      );
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${uri("panel.css")}" rel="stylesheet" />
  <title>Branches</title>
  <script nonce="${nonce}">window.AWT_VIEW = "branches";</script>
</head>
<body>
  <div id="root">
    <div class="empty">Loading branches…</div>
  </div>
  <script nonce="${nonce}" src="${uri("panel.js")}"></script>
</body>
</html>`;
  }

  /** Messages from the branches panel (its own channel, not the sidebar's). */
  private async onBranchesMessage(msg: ActionMessage): Promise<void> {
    if (msg.type !== "action") return;
    switch (msg.action) {
      case "loadBranches": {
        // Opening the tab paints the fast local (git-only) branch list right
        // away, WITHOUT waiting on the GitHub token probe (connection()) — that
        // probe is a network round trip and used to gate the first paint, so the
        // list would not appear until GitHub responded. The connection probe and
        // PR/CI fetch run in the background below, each re-posting as it lands.
        // getToken() is local (no network), so synthesize a hasToken connection
        // for the immediate paint to keep the Fetch Open PRs button visible (in
        // its busy state) while the real probe is in flight.
        const token = await getToken();
        const auto = this.prService.isEnabled() && !!token;
        await this.postBranches(false, {
          githubRefreshing: auto,
          github: { hasToken: !!token, connected: false },
        });
        // Background: the real probe, then (when a token is connected) the PR/CI
        // fetch — the Refresh GitHub button spins until the data lands. No git
        // fetch on open: that stays a manual action. Posts are awaited in order
        // (not raced) so the slow GitHub post isn't dropped by the branchPostSeq
        // staleness guard; the background sidebar refresh runs last. Not awaited
        // here so the message handler returns and the list stays interactive.
        void (async () => {
          await this.postBranches(false, { githubRefreshing: auto });
          if (auto) await this.postBranches(true);
          void this.refresh(false);
        })();
        return;
      }
      case "fetchBranches":
        // The explicit Fetch button (git only). `value` carries the Prune
        // checkbox; fetch remotes then re-post so ahead/behind, diffs and merge
        // state are current. PR data is left untouched (Refresh GitHub owns that).
        return this.fetchBranchesAction(msg.value !== false);
      case "refreshGithub":
        // The explicit Refresh GitHub button. Re-hit the GitHub API for fresh PR
        // and CI status without running a git fetch.
        return this.refreshGithubAction();
      case "worktreeFromBranch":
        return this.worktreeFromBranch(msg.branch, msg.remoteOnly);
      case "deleteBranch":
        return this.deleteBranchAction(msg.branch, msg.merged);
      case "deleteGoneBranches":
        return this.deleteGoneBranchesAction();
      case "agent":
        // Start a Claude agent in an existing worktree (its path is on the row).
        return this.agent(msg.path);
    }
  }

  /**
   * Compute the branch list (git-only) and attach GitHub connection + per-branch
   * PR rollups, then post it to the branches panel. The PR rollups come from one
   * batched GraphQL call (separate from the worktree cards' REST path).
   *
   * `refetchPrs` gates the GitHub API: only the explicit Refresh GitHub button
   * passes true. Every other path (opening the tab, watcher-driven refreshes,
   * git Fetch, worktree/branch mutations) passes false and reuses the cached PR
   * map, so the rows still update (hasWorktree, ahead/behind) without hitting
   * GitHub. With no cache yet, false means no PR data and a "Never" refresh time.
   * Any PR failure leaves branches with `pr` null and still posts — never throws.
   */
  private async postBranches(
    refetchPrs = false,
    flags: { githubRefreshing?: boolean; github?: GithubConnection } = {}
  ): Promise<void> {
    if (!this.branchesPanel) return;
    // Claim this post's place in line. Anything that started earlier and resolves
    // after a newer post must not overwrite it (see branchPostSeq).
    const seq = ++this.branchPostSeq;
    const data = await gatherBranches();
    // A caller can supply a pre-resolved connection (the immediate on-open paint
    // passes a synthesized one) to avoid the network probe gating the post.
    const github = flags.github ?? (await connection());
    data.github = github;
    data.prEnabled = this.prService.isEnabled();

    // Resolve the github.com origin once for both the web links and PR fetch.
    // Branches themselves come from local git (gatherBranches -> listBranches),
    // so the list is always scoped to this repo, never the user's other repos.
    const repo = data.repoRoot
      ? await this.remoteFor(data.repoRoot)
      : undefined;
    if (repo) data.repoUrl = `https://github.com/${repo.owner}/${repo.repo}`;

    if (data.prEnabled && github.hasToken && data.repoRoot) {
      try {
        if (repo) {
          const token = await getToken();
          if (token) {
            if (refetchPrs) {
              const fetched = await fetchPrsByBranch(token, repo, github.login);
              this.branchPrs = fetched;
              this.branchPrsAt = Date.now();
              // Surface why the branches view may show no PRs even though the
              // worktree cards (REST path) do. A GraphQL-only failure (e.g. a
              // fine-grained token denied GraphQL) lands here, not on the cards.
              if (fetched.error) {
                diag(`postBranches: PR fetch failed: ${fetched.error}`);
              } else {
                const matched = data.branches.filter((b) =>
                  fetched.prs.has(b.name)
                ).length;
                diag(
                  `postBranches: fetched ${fetched.prs.size} PR(s), matched ${matched}/${data.branches.length} branches`
                );
              }
            }
            if (this.branchPrs) {
              const { prs, viewerLogin } = this.branchPrs;
              data.viewerLogin = viewerLogin ?? github.login;
              for (const b of data.branches) {
                b.pr = prs.get(b.name) ?? null;
              }
            }
          }
        }
      } catch {
        // Degrade to "no PR data": rows still render, never throw.
        for (const b of data.branches) {
          if (b.pr === undefined) b.pr = null;
        }
      }
    }

    data.lastGithubRefresh = this.branchPrsAt;
    if (flags.githubRefreshing) data.githubRefreshing = true;

    // A newer post superseded this one while we awaited git/GitHub; drop this
    // stale result rather than letting it overwrite the fresher render. (The
    // panel may also have closed in the meantime.)
    if (seq !== this.branchPostSeq || !this.branchesPanel) return;
    void this.branchesPanel.webview.postMessage({ type: "branches", data });
  }

  /**
   * Create a worktree for an existing branch (local or remote-only) in the
   * current window, start a Claude agent in it, and refresh both views so the
   * sidebar gains the worktree and the branch row flips to "Worktree exists".
   */
  private async worktreeFromBranch(
    branch?: string,
    remoteOnly?: boolean
  ): Promise<void> {
    const name = branch?.trim();
    if (!name) return;
    const primary = await this.primaryWorktree();
    if (!primary) {
      vscode.window.showErrorMessage("No git repository in this window.");
      return;
    }
    const dir = worktreeDirFor(primary, name);
    try {
      await this.prepareWorktreeDir(dir);
      await addBranchWorktree(primary, dir, name, !!remoteOnly);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Could not create worktree: ${(err as Error).message}`
      );
      return;
    }
    await this.applyLinksToNewWorktree(primary, dir);
    await this.agent(dir);
    await this.refresh();
    await this.postBranches();
  }

  /**
   * Fetch from the remote (the explicit Fetch button), optionally pruning stale
   * remote-tracking refs, then re-read both views so ahead/behind, diffs and
   * merge state are current. This is git only: it reuses cached PR data and never
   * hits the GitHub API (the separate Refresh GitHub button owns that). Pruning
   * matters for the delete flow: a branch whose PR was merged and remote deleted
   * otherwise lingers as a phantom origin ref.
   */
  private async fetchBranchesAction(prune: boolean): Promise<void> {
    const repoRoot = await this.primaryWorktree();
    if (!repoRoot) {
      vscode.window.showErrorMessage("No git repository in this window.");
      return;
    }
    await fetchRemotes(repoRoot, { prune });
    // We already fetched, so re-read without a second fetch; reuse cached PR data
    // (refetchPrs=false) to keep the git fetch decoupled from the GitHub API.
    await this.refresh();
    await this.postBranches(false);
  }

  /**
   * Re-hit the GitHub API for fresh per-branch PR/CI status (the explicit Refresh
   * GitHub button), without running a git fetch. Only meaningful when a token is
   * stored, which is also the only state in which the button is shown.
   */
  private async refreshGithubAction(): Promise<void> {
    await this.postBranches(true);
  }

  /**
   * Delete a branch the user owns, locally and/or on origin. When both a local
   * ref and an origin/<branch> exist the user picks the scope (local, remote, or
   * both); otherwise it deletes whichever side exists after a single confirm.
   *
   * Local deletes guard against losing work: a branch with commits not on its
   * upstream surfaces the count in the prompt and force-deletes on confirm. A
   * branch whose PR is merged force-deletes without the "not fully merged" prompt
   * (a squash-merge leaves the commits unreachable, so git's `-d` would refuse
   * even though the work is safely in the base). Both views refresh after.
   */
  private async deleteBranchAction(
    branch?: string,
    merged?: boolean
  ): Promise<void> {
    const name = branch?.trim();
    if (!name) return;
    const repoRoot = await this.primaryWorktree();
    if (!repoRoot) {
      vscode.window.showErrorMessage("No git repository in this window.");
      return;
    }
    // Never delete the repo's default branch (e.g. main), even if a message asks.
    if (name === (await defaultBranchName(repoRoot))) {
      vscode.window.showWarningMessage(
        `"${name}" is the default branch and cannot be deleted.`
      );
      return;
    }
    // Git refuses to delete a branch that is checked out in a worktree, and
    // force does not help. If the primary worktree (this repo dir) is on it,
    // block outright. A linked worktree can be detached first, so deletion is
    // allowed there after an explicit confirmation.
    const inUse = (await listWorktrees(repoRoot)).find(
      (w) => !w.detached && w.branch === name
    );
    if (inUse?.isPrimary) {
      vscode.window.showWarningMessage(
        `"${name}" is checked out in this repository. Switch to another branch ` +
          `first, then delete it.`
      );
      return;
    }

    // Unpushed-work check, only when the PR is not merged (a merged squash leaves
    // commits that look unpushed but are not lost).
    let unpushed = 0;
    if (!merged) unpushed = await unpushedCommitCount(repoRoot, name);
    const unpushedNote =
      unpushed > 0
        ? `\n\nThis branch has ${
            unpushed === 1 ? "1 commit" : `${unpushed} commits`
          } not pushed to its upstream; deleting it loses ${
            unpushed === 1 ? "that commit" : "those commits"
          }.`
        : "";

    if (inUse) {
      // A linked worktree is on this branch: confirm the delete (it detaches that
      // worktree's HEAD), then confirm again when there is unpushed work to lose.
      const ok = await vscode.window.showWarningMessage(
        `"${name}" is checked out in the worktree at ${inUse.path}. Deleting the ` +
          `local branch leaves that worktree on a detached HEAD (its files stay) ` +
          `and the remote branch is left untouched. Delete anyway?`,
        { modal: true },
        "Delete"
      );
      if (ok !== "Delete") return;
      if (unpushedNote) {
        const confirm = await vscode.window.showWarningMessage(
          `Delete "${name}" anyway?${unpushedNote}`,
          { modal: true },
          "Delete"
        );
        if (confirm !== "Delete") return;
      }
    } else {
      const ok = await vscode.window.showWarningMessage(
        `Delete local branch "${name}"? The remote branch is left untouched.${unpushedNote}`,
        { modal: true },
        "Delete"
      );
      if (ok !== "Delete") return;
    }

    // A merged or unpushed branch is force-deleted (git's `-d` refuses an
    // unmerged ref). The linked-worktree path is already double-confirmed and
    // about to be detached, so force there too rather than re-prompting.
    const force = !!merged || unpushed > 0 || !!inUse;

    if (inUse) {
      try {
        await detachWorktreeHead(inUse.path);
      } catch (err) {
        vscode.window.showErrorMessage(
          `Could not free the worktree at ${inUse.path}: ${(err as Error).message}`
        );
        return;
      }
    }

    try {
      await deleteBranch(repoRoot, name, { local: true, force });
    } catch (err) {
      const msg = (err as Error).message;
      // git -d still refused as unmerged (e.g. the unpushed count failed and the
      // PR is not flagged merged): confirm once more, then force.
      if (!force && /not fully merged/i.test(msg)) {
        const confirm = await vscode.window.showWarningMessage(
          `Local branch "${name}" is not fully merged. Force delete it?`,
          { modal: true },
          "Force Delete"
        );
        if (confirm !== "Force Delete") return;
        try {
          await deleteBranch(repoRoot, name, { local: true, force: true });
        } catch (err2) {
          vscode.window.showErrorMessage(
            `Could not delete branch: ${(err2 as Error).message}`
          );
          return;
        }
      } else {
        vscode.window.showErrorMessage(`Could not delete branch: ${msg}`);
        return;
      }
    }
    await this.refresh();
    await this.postBranches();
  }

  /**
   * Bulk-delete every local branch whose upstream is gone (the remote branch was
   * merged or deleted). Branches checked out in a worktree are skipped (we never
   * bulk-detach), as is the default branch. Merged branches delete with `-d`;
   * any that refuse as "not fully merged" (e.g. squash-merges) are collected and
   * force-deleted only after a second, explicit confirmation.
   */
  private async deleteGoneBranchesAction(): Promise<void> {
    const repoRoot = await this.primaryWorktree();
    if (!repoRoot) {
      vscode.window.showErrorMessage("No git repository in this window.");
      return;
    }
    const def = await defaultBranchName(repoRoot);
    const candidates = (await goneBranches(repoRoot)).filter((n) => n !== def);
    if (!candidates.length) {
      vscode.window.showInformationMessage(
        "No local branches have a gone upstream. Fetch with Prune first if a branch was just deleted on the remote."
      );
      return;
    }

    // Never bulk-detach worktrees: skip any branch a worktree is on, and tell
    // the user which were left so the count is honest.
    const inUse = new Set(
      (await listWorktrees(repoRoot))
        .filter((w) => !w.detached && w.branch)
        .map((w) => w.branch as string)
    );
    const deletable = candidates.filter((n) => !inUse.has(n));
    const skipped = candidates.filter((n) => inUse.has(n));
    if (!deletable.length) {
      vscode.window.showWarningMessage(
        `All ${candidates.length} branch(es) with a gone upstream are checked out in a worktree. Free them first.`
      );
      return;
    }

    const list = deletable.map((n) => `  • ${n}`).join("\n");
    const skipNote = skipped.length
      ? `\n\n${skipped.length} checked out in a worktree will be skipped.`
      : "";
    const ok = await vscode.window.showWarningMessage(
      `Delete ${deletable.length} local branch${
        deletable.length === 1 ? "" : "es"
      } whose upstream is gone (merged or deleted on the remote)? The remote is left untouched.\n\n${list}${skipNote}`,
      { modal: true },
      "Delete"
    );
    if (ok !== "Delete") return;

    const unmerged: string[] = [];
    const failed: string[] = [];
    for (const name of deletable) {
      try {
        await deleteBranch(repoRoot, name, { local: true });
      } catch (err) {
        const msg = (err as Error).message;
        if (/not fully merged/i.test(msg)) unmerged.push(name);
        else failed.push(name);
      }
    }

    // The squash-merge case: commits are unreachable from HEAD, so `-d` refuses.
    // Force only after naming them and getting a second confirmation.
    if (unmerged.length) {
      const list2 = unmerged.map((n) => `  • ${n}`).join("\n");
      const force = await vscode.window.showWarningMessage(
        `${unmerged.length} branch${
          unmerged.length === 1 ? " has" : "es have"
        } commits not merged into HEAD (e.g. a squash-merge) that will be lost. Force delete?\n\n${list2}`,
        { modal: true },
        "Force Delete"
      );
      if (force === "Force Delete") {
        for (const name of unmerged) {
          try {
            await deleteBranch(repoRoot, name, { local: true, force: true });
          } catch {
            failed.push(name);
          }
        }
      }
    }

    if (failed.length) {
      vscode.window.showErrorMessage(
        `Could not delete: ${failed.join(", ")}`
      );
    }
    await this.refresh();
    await this.postBranches();
  }
}

/** Minimal slice of the built-in Git extension API we depend on. */
interface GitApiRepository {
  readonly rootUri: vscode.Uri;
  /** Fires when the repository's working tree, index or HEAD moves. The
   *  extension's own watcher, which is why the panel needs none. */
  readonly state?: { readonly onDidChange?: vscode.Event<unknown> };
}
interface GitApi {
  readonly repositories: GitApiRepository[];
  getRepository(uri: vscode.Uri): GitApiRepository | null;
  openRepository(uri: vscode.Uri): Promise<GitApiRepository | null>;
  readonly onDidOpenRepository: vscode.Event<GitApiRepository>;
  readonly onDidCloseRepository: vscode.Event<GitApiRepository>;
  /** "uninitialized" until the extension finishes its first repository scan. */
  readonly state?: "uninitialized" | "initialized";
  readonly onDidChangeState?: vscode.Event<unknown>;
}
interface GitExtensionExports {
  getAPI(version: 1): GitApi;
}

function nameOf(fsPath: string): string {
  return normalize(fsPath).split(/[\\/]/).filter(Boolean).pop() ?? fsPath;
}

function makeNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
