import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as cp from "child_process";
import { randomUUID } from "crypto";
import {
  gatherWorktrees,
  normalize,
  AgentVM,
  WorktreeData,
} from "./worktreeData";
import {
  addWorktree,
  removeWorktree,
  listWorktrees,
  getRemoteInfo,
  RemoteInfo,
} from "./git";
import { hooksInstalled, installHooks, sessionsDir, HOOKS } from "./hooks";
import { readSessionsByWorktree } from "./sessionStore";
import { applyScopeScm, ScmModel } from "./scmScope";
import {
  initGithub,
  connection,
  setToken,
  clearToken,
} from "./github";
import { PrService, PrTarget } from "./prs";

/** globalState key for the opt-in Source Control scope button. */
const SCM_SCOPE_KEY = "agentWorktrees.scmScopeEnabled";

/** Messages sent from the webview to the extension. */
interface ActionMessage {
  type: "action";
  action:
    | "refresh"
    | "agent"
    | "agentWorktree"
    | "focusAgent"
    | "stopAgent"
    | "newWorktree"
    | "removeWorktree"
    | "openWindow"
    | "acceptHooks"
    | "openSettings"
    | "setGithubToken"
    | "clearGithubToken"
    | "togglePr"
    | "toggleScm"
    | "scopeScm";
  path?: string;
  sessionId?: string;
  /** GitHub PAT, for setGithubToken. */
  token?: string;
  /** New on/off state, for togglePr. */
  value?: boolean;
}

export class WorktreeWebviewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  public static readonly viewType = "worktreeView.panel";

  private view?: vscode.WebviewView;

  /** Last payload posted, to skip redundant re-renders. */
  private lastPosted = "";
  /** Watches the session-state dir so status changes refresh the panel without
   *  a polling loop. */
  private watcher?: vscode.FileSystemWatcher;
  /** Watches workspace files so git status (dirty/ahead/behind) tracks edits. */
  private fileWatcher?: vscode.FileSystemWatcher;
  /** Debounce timer coalescing bursts of file changes into one refresh. */
  private refreshTimer?: ReturnType<typeof setTimeout>;
  /** Terminals we launched, keyed by the session id we started Claude with. */
  private terminals = new Map<string, vscode.Terminal>();
  /** Env var stamped on each agent terminal carrying its session id. VS Code
   *  preserves a terminal's creationOptions (env included) across an
   *  extension-host reload, so this is what lets us re-link a restored terminal
   *  to its session after our in-memory handle is gone. */
  private static readonly SID_ENV = "AGENT_WORKTREES_SID";
  /** Last name we applied to each session's terminal, so we only rename on a
   *  real change (renaming reveals the terminal, so doing it every event churns). */
  private appliedTerminalNames = new Map<string, string>();
  /** Where the emitter writes per-session state, under the extension's global
   *  storage (so nothing of ours lives in ~/.claude). Derived from the context. */
  private readonly sessionsDir: string;
  /** Background PR-status fetcher; only does work when a token is stored. */
  private readonly prService: PrService;
  /** Resolved GitHub origin per worktree path (null = no github remote). */
  private readonly remotes = new Map<string, RemoteInfo | null>();
  /** True once we've subscribed to the Git extension's repo open/close events,
   *  so the panel re-renders when the Source Control scope changes. */
  private scmWatchSet = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    initGithub(context);
    this.prService = new PrService(context);
    this.sessionsDir = sessionsDir(context);
    // Ensure the sessions dir exists so the watcher attaches even before the
    // first hook fires.
    try {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    } catch {
      /* best effort */
    }
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(this.sessionsDir), "*.json")
    );
    // A session-state file changing is a Claude hook firing (a prompt, a tool
    // run, a stop). Besides re-rendering, nudge the PR service: this is the
    // signal that an agent may have just run `gh pr create`/merge, so PR status
    // is worth a (throttled) refresh without waiting for the poll timer.
    const onChange = () => {
      void this.refresh();
      void this.prService.refresh(false);
    };
    this.watcher.onDidCreate(onChange);
    this.watcher.onDidChange(onChange);
    this.watcher.onDidDelete(onChange);

    // Track working-tree edits so the git dirty/ahead/behind line stays current.
    // Respects the user's files.watcherExclude (node_modules, etc.); debounced
    // so a burst of saves triggers one refresh.
    this.fileWatcher = vscode.workspace.createFileSystemWatcher("**/*");
    const onFile = () => this.scheduleRefresh();
    this.fileWatcher.onDidCreate(onFile);
    this.fileWatcher.onDidChange(onFile);
    this.fileWatcher.onDidDelete(onFile);

    // Re-link any agent terminals VS Code restored from before this host
    // started (e.g. an extension update or window reload), and keep claiming
    // ones that surface afterward, so focus/stop reach them again.
    vscode.window.terminals.forEach((t) => this.reclaimTerminal(t));

    context.subscriptions.push(
      this.prService,
      // Re-render whenever fresh PR status lands.
      this.prService.onChange(() => void this.refresh()),
      // Re-link a terminal restored after activation to its session.
      vscode.window.onDidOpenTerminal((t) => this.reclaimTerminal(t)),
      // Clean up our terminal handle when its terminal is closed by any means.
      vscode.window.onDidCloseTerminal((t) => this.forgetTerminal(t)),
      // Catch external/agent edits and commits when the window regains focus.
      vscode.window.onDidChangeWindowState((s) => {
        if (s.focused) this.scheduleRefresh();
      })
    );
  }

  dispose(): void {
    this.watcher?.dispose();
    this.fileWatcher?.dispose();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }

  /** Coalesce frequent file-change events into a single refresh. */
  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 500);
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
      if (webviewView.visible) {
        this.lastPosted = ""; // a re-shown view needs a fresh push
        void this.refresh();
      }
    });

    this.lastPosted = "";
    void this.refresh();
  }

  /**
   * Recompute worktree data and push it to the webview (only when it changed).
   * When `force` is set (the user clicked Refresh) this also runs a `git fetch`
   * so the behind/ahead counts are current and forces a fresh GitHub PR fetch.
   */
  async refresh(force = false): Promise<void> {
    if (!this.view) return;
    const installed = await hooksInstalled();
    const agents = installed
      ? await readSessionsByWorktree(this.sessionsDir)
      : undefined;
    if (agents) {
      await this.syncTerminalNames(agents);
    }
    const data = await gatherWorktrees(agents, installed, force);
    data.scmEnabled = this.isScmEnabled();
    if (data.scmEnabled) await this.annotateScmActive(data);
    if (!installed) {
      data.hooks = HOOKS.map((h) => ({
        label: h.label,
        description: h.description,
      }));
    }
    await this.attachPrStatus(data, force);
    const json = JSON.stringify(data);
    if (json === this.lastPosted) return;
    this.lastPosted = json;
    void this.view.webview.postMessage({ type: "update", data });
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
    if (enabled && github.hasToken) {
      for (const wt of data.worktrees) {
        if (!wt.branch || wt.detached) continue;
        const repo = await this.remoteFor(wt.path);
        if (!repo) continue;
        targets.push({ key: normalize(wt.path), branch: wt.branch, repo });
      }
    }
    this.prService.setTargets(targets);
    // On an explicit refresh, refetch PR/CI status now so this payload carries
    // the latest instead of waiting for the next background poll.
    if (force && enabled && github.hasToken) {
      await this.prService.refresh(true);
    }

    for (const wt of data.worktrees) {
      const pr = this.prService.get(normalize(wt.path));
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
      case "openWindow":
        return this.openWindow(msg.path);
      case "acceptHooks":
        return this.acceptHooks();
      case "setGithubToken":
        return this.setGithubToken(msg.token);
      case "clearGithubToken":
        return this.clearGithubToken();
      case "togglePr":
        return this.togglePr(msg.value);
      case "toggleScm":
        return this.toggleScm(msg.value);
      case "scopeScm":
        return this.scopeScm(msg.path);
    }
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

  /** Subscribe (once) to repo open/close so the panel re-renders when the
   *  Source Control scope changes underneath us. */
  private async ensureScmWatch(): Promise<void> {
    if (this.scmWatchSet) return;
    const api = await this.gitApi();
    if (!api) return;
    this.scmWatchSet = true;
    const onScm = () => this.scheduleRefresh();
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

  /** Mark each worktree whose repository is currently open in Source Control as
   *  scmActive, so the panel can show whether the scope is already set. */
  private async annotateScmActive(data: WorktreeData): Promise<void> {
    await this.ensureScmWatch();
    const api = await this.gitApi();
    const open = new Set<string>();
    if (api) for (const r of api.repositories) open.add(normalize(r.rootUri.fsPath));
    for (const wt of data.worktrees) {
      wt.scmActive = open.has(normalize(wt.path));
    }
  }

  /**
   * Scope the Source Control view to the selected worktree by opening its
   * repository if needed, then: when more than one repo is currently listed,
   * leave the others (non-destructive); when a single repo is listed, swap it
   * out (close the previous one) so only this worktree's diffs remain. Does not
   * switch the user to the Source Control view.
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
        await vscode.commands.executeCommand("git.close", vscode.Uri.file(p));
      },
    };
    await applyScopeScm(model, target);

    // Reflect the new scope on the buttons without switching to the view.
    await this.refresh();
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
    this.lastPosted = "";
    await this.refresh();
  }

  /** Turn the PR integration on/off without discarding the stored token. */
  private async togglePr(value?: boolean): Promise<void> {
    await this.prService.setEnabled(!!value);
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
   * all share one id — that link is what lets the work summary reach the
   * terminal name. Each click gets its own terminal so agents can run side by
   * side across worktrees.
   */
  private async agent(fsPath?: string): Promise<void> {
    if (!fsPath) return;
    const sessionId = randomUUID();
    const terminal = vscode.window.createTerminal({
      name: `Claude · ${nameOf(fsPath)}`,
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
      name: "Claude · new worktree",
      cwd,
      iconPath: this.terminalIcon,
      env: { [WorktreeWebviewProvider.SID_ENV]: sessionId },
    });
    this.terminals.set(sessionId, terminal);
    terminal.show();
    terminal.sendText(`claude --session-id ${sessionId} -w`);
    await this.refresh();
  }

  /** Reveal the terminal backing an agent (if we launched it). */
  private focusAgent(sessionId?: string): void {
    if (!sessionId) return;
    this.terminals.get(sessionId)?.show();
  }

  /** Stop an agent and remove its row. */
  private stopAgent(sessionId?: string): void {
    if (!sessionId) return;
    this.stopSession(sessionId);
    void this.refresh();
  }

  /**
   * Stop a session by every means we have, so it dies even if our in-memory
   * terminal handle was lost (e.g. the extension host reloaded since launch):
   *  - dispose the terminal we launched it in, if we still hold it;
   *  - kill the Claude process by the session id we passed in its argv
   *    (`claude --session-id <id>`), which is reload-proof and works for idle
   *    agents that were never sent a prompt;
   *  - delete its state file so the row disappears immediately.
   */
  private stopSession(sessionId: string): void {
    if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) return;
    this.terminals.get(sessionId)?.dispose();
    if (process.platform !== "win32") {
      // pkill -f matches the session id in the process's full command line.
      cp.execFile("pkill", ["-f", sessionId], () => {
        /* no match / pkill missing -> nothing to kill */
      });
    }
    try {
      fs.rmSync(path.join(this.sessionsDir, sessionId + ".json"), {
        force: true,
      });
    } catch {
      /* best effort */
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
      }
    }
  }

  /**
   * Keep each agent's terminal named like its panel row: the work summary
   * (Claude's generated title). Until that exists the terminal keeps its launch
   * name ("Claude · <worktree>"); we never name it after the raw prompt. Only
   * renames on a real change (renaming reveals the terminal, so doing it every
   * event would churn), and reveals with focus preserved so a background refresh
   * never steals the cursor.
   */
  private async syncTerminalNames(
    byPath: Map<string, AgentVM[]>
  ): Promise<void> {
    for (const list of byPath.values()) {
      for (const a of list) {
        const terminal = this.terminals.get(a.sessionId);
        if (!terminal) continue;
        const desired = a.summary;
        if (!desired) continue; // nothing meaningful yet; keep the launch name
        if (this.appliedTerminalNames.get(a.sessionId) === desired) continue;
        this.appliedTerminalNames.set(a.sessionId, desired);
        terminal.show(true);
        await vscode.commands.executeCommand(
          "workbench.action.terminal.renameWithArg",
          { name: desired }
        );
      }
    }
  }

  /** Install the agent-status hooks after the user accepts them in the panel. */
  private async acceptHooks(): Promise<void> {
    try {
      await installHooks(this.context);
      vscode.window.showInformationMessage(
        "Agent Worktrees hooks installed in ~/.claude/settings.json."
      );
    } catch (e) {
      vscode.window.showErrorMessage(
        `Could not install hooks: ${e instanceof Error ? e.message : String(e)}`
      );
    }
    this.lastPosted = "";
    await this.refresh();
  }

  // --- Worktree git operations -----------------------------------------------

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

    const dir = path.join(
      path.dirname(primary),
      branch.trim().replace(/[^\w.-]+/g, "-")
    );

    try {
      await addWorktree(primary, dir, branch.trim());
    } catch (err) {
      vscode.window.showErrorMessage(
        `Could not create worktree: ${(err as Error).message}`
      );
      return;
    }
    await this.refresh();
  }

  /** Confirm and remove a worktree from disk (offering --force when dirty). */
  private async removeWorktreeAction(fsPath?: string): Promise<void> {
    if (!fsPath) return;
    const primary = await this.primaryWorktree();
    if (!primary) return;

    // Every agent whose worktree is this path (or nested under it).
    const target = normalize(fsPath);
    const byPath = await readSessionsByWorktree(this.sessionsDir);
    const agents: AgentVM[] = [];
    for (const [key, list] of byPath) {
      if (key === target || key.startsWith(target + path.sep)) {
        agents.push(...list);
      }
    }
    const note = agents.length
      ? ` This also stops ${agents.length} running agent${
          agents.length === 1 ? "" : "s"
        } in it.`
      : "";
    const choice = await vscode.window.showWarningMessage(
      `Remove the worktree at ${fsPath}? This deletes the working directory.${note}`,
      { modal: true },
      "Remove"
    );
    if (choice !== "Remove") return;

    // Stop the worktree's agents first so no Claude process holds the directory
    // open while git removes it (and they vanish from the panel). stopSession
    // cleans up the ones we track; killClaudeInDir catches any Claude running in
    // the worktree by cwd (notably `claude -w` children that drop our id).
    for (const a of agents) this.stopSession(a.sessionId);
    this.killClaudeInDir(fsPath);

    try {
      await removeWorktree(primary, fsPath);
    } catch {
      const force = await vscode.window.showWarningMessage(
        "Worktree has changes or is locked. Force remove?",
        { modal: true },
        "Force Remove"
      );
      if (force !== "Force Remove") return;
      try {
        await removeWorktree(primary, fsPath, true);
      } catch (err) {
        vscode.window.showErrorMessage(
          `Could not remove worktree: ${(err as Error).message}`
        );
        return;
      }
    }
    await this.refresh();
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
}

/** Minimal slice of the built-in Git extension API we depend on. */
interface GitApiRepository {
  readonly rootUri: vscode.Uri;
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
