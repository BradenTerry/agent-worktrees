import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as cp from "child_process";
import { randomUUID } from "crypto";
import { gatherWorktrees, folderIndex, normalize, AgentVM } from "./worktreeData";
import { findRepoRoot, addWorktree, removeWorktree } from "./git";
import { hooksInstalled, installHooks, SESSIONS_DIR, HOOKS } from "./hooks";
import { readSessionsByWorktree } from "./sessionStore";

/** Messages sent from the webview to the extension. */
interface ActionMessage {
  type: "action";
  action:
    | "open"
    | "unmount"
    | "refresh"
    | "agent"
    | "agentWorktree"
    | "focusAgent"
    | "stopAgent"
    | "newWorktree"
    | "removeWorktree"
    | "acceptHooks"
    | "rename";
  path?: string;
  sessionId?: string;
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
  /** Terminals we launched, keyed by the session id we started Claude with. */
  private terminals = new Map<string, vscode.Terminal>();
  /** Last name we applied to each session's terminal, so we only rename on a
   *  real change (renaming reveals the terminal, so doing it every event churns). */
  private appliedTerminalNames = new Map<string, string>();
  /** Sessions started via `claude -w`, mapped to the dir we launched them from,
   *  so a later refresh can auto-mount the worktree Claude creates once its
   *  state file reveals the new path. */
  private pendingMount = new Map<string, string>();

  constructor(private readonly context: vscode.ExtensionContext) {
    // Ensure the sessions dir exists so the watcher attaches even before the
    // first hook fires.
    try {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    } catch {
      /* best effort */
    }
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(SESSIONS_DIR), "*.json")
    );
    const onChange = () => void this.refresh();
    this.watcher.onDidCreate(onChange);
    this.watcher.onDidChange(onChange);
    this.watcher.onDidDelete(onChange);

    context.subscriptions.push(
      // Clean up our terminal handle when its terminal is closed by any means.
      vscode.window.onDidCloseTerminal((t) => this.forgetTerminal(t))
    );
  }

  dispose(): void {
    this.watcher?.dispose();
  }

  private get extensionUri(): vscode.Uri {
    return this.context.extensionUri;
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
      if (webviewView.visible) {
        this.lastPosted = ""; // a re-shown view needs a fresh push
        void this.refresh();
      }
    });

    this.lastPosted = "";
    void this.refresh();
  }

  /** Recompute worktree data and push it to the webview (only when it changed). */
  async refresh(): Promise<void> {
    if (!this.view) return;
    const installed = await hooksInstalled();
    const agents = installed
      ? await readSessionsByWorktree(SESSIONS_DIR)
      : undefined;
    if (agents) {
      await this.syncTerminalNames(agents);
      if (this.pendingMount.size) this.autoMountPending(agents);
    }
    const data = await gatherWorktrees(agents, installed);
    if (!installed) {
      data.hooks = HOOKS.map((h) => ({
        label: h.label,
        description: h.description,
      }));
    }
    const json = JSON.stringify(data);
    if (json === this.lastPosted) return;
    this.lastPosted = json;
    void this.view.webview.postMessage({ type: "update", data });
  }

  // --- Webview messages ------------------------------------------------------

  private async onMessage(msg: ActionMessage): Promise<void> {
    if (msg.type !== "action") return;
    switch (msg.action) {
      case "refresh":
        return void this.refresh();
      case "open":
        return this.open(msg.path);
      case "unmount":
        return this.unmount(msg.path);
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
      case "acceptHooks":
        return this.acceptHooks();
      case "rename":
        return this.rename(msg.sessionId);
    }
  }

  /**
   * Mount a worktree as an extra workspace folder. Appending at index >= 1
   * keeps folder 0 stable, so VS Code does not reload the window.
   */
  private async open(fsPath?: string): Promise<void> {
    if (!fsPath) return;
    if (folderIndex(fsPath) !== -1) {
      vscode.window.showInformationMessage("Already open in the workspace.");
      return;
    }
    const uri = vscode.Uri.file(fsPath);
    const start = vscode.workspace.workspaceFolders?.length ?? 0;
    const ok = vscode.workspace.updateWorkspaceFolders(start, 0, {
      uri,
      name: nameOf(fsPath),
    });
    if (!ok) {
      vscode.window.showErrorMessage("Could not add worktree to workspace.");
    }
    await this.refresh();
  }

  private async unmount(fsPath?: string): Promise<void> {
    if (!fsPath) return;
    const idx = folderIndex(fsPath);
    if (idx <= 0) {
      vscode.window.showWarningMessage(
        "Cannot remove the primary folder without reloading."
      );
      return;
    }
    vscode.workspace.updateWorkspaceFolders(idx, 1);
    await this.refresh();
  }

  // --- Agents ----------------------------------------------------------------

  /**
   * Spin up a Claude CLI session in the given worktree. We launch Claude with a
   * session id we generate so the panel row, its state file, and its terminal
   * all share one id — that link is what lets a rename reach the terminal. Each
   * click gets its own terminal so agents can run side by side across worktrees.
   */
  private async agent(fsPath?: string): Promise<void> {
    if (!fsPath) return;
    const sessionId = randomUUID();
    const terminal = vscode.window.createTerminal({
      name: `Claude · ${nameOf(fsPath)}`,
      cwd: fsPath,
      iconPath: new vscode.ThemeIcon("sparkle"),
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
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
      vscode.window.showErrorMessage("No git repository in this window.");
      return;
    }
    const sessionId = randomUUID();
    const terminal = vscode.window.createTerminal({
      name: "Claude · new worktree",
      cwd,
      iconPath: new vscode.ThemeIcon("sparkle"),
    });
    this.terminals.set(sessionId, terminal);
    this.pendingMount.set(sessionId, normalize(cwd));
    terminal.show();
    terminal.sendText(`claude --session-id ${sessionId} -w`);
    await this.refresh();
  }

  /**
   * Mount the worktrees that `claude -w` sessions have created. A pending
   * session is mounted once its state file reports a worktree path different
   * from where we launched it (i.e. Claude has actually created the worktree).
   */
  private autoMountPending(byPath: Map<string, AgentVM[]>): void {
    for (const [key, list] of byPath) {
      for (const a of list) {
        const launchDir = this.pendingMount.get(a.sessionId);
        if (launchDir === undefined || key === launchDir) continue;
        this.pendingMount.delete(a.sessionId);
        if (folderIndex(key) === -1) void this.open(key);
      }
    }
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
      fs.rmSync(path.join(SESSIONS_DIR, sessionId + ".json"), { force: true });
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

  /** Drop our handle to a terminal that has closed. */
  private forgetTerminal(terminal: vscode.Terminal): void {
    for (const [id, term] of this.terminals) {
      if (term === terminal) {
        this.terminals.delete(id);
        this.appliedTerminalNames.delete(id);
        this.pendingMount.delete(id);
      }
    }
  }

  /**
   * Keep each agent's terminal named like its panel row: user-given name, else
   * the work summary. Only renames on a real change (renaming reveals the
   * terminal, so doing it every event would churn), and reveals with focus
   * preserved so a background refresh never steals the cursor.
   */
  private async syncTerminalNames(
    byPath: Map<string, AgentVM[]>
  ): Promise<void> {
    for (const list of byPath.values()) {
      for (const a of list) {
        const terminal = this.terminals.get(a.sessionId);
        if (!terminal) continue;
        const desired = a.name || a.summary;
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

  /** Path of the state file backing a session, or undefined for an unsafe id. */
  private sessionFile(sessionId: string): string | undefined {
    return /^[A-Za-z0-9._-]+$/.test(sessionId)
      ? path.join(SESSIONS_DIR, sessionId + ".json")
      : undefined;
  }

  /**
   * Rename a session via the panel's edit button. The name is written into the
   * session's state file — the same field `/rename` writes — so both paths share
   * one source of truth; the watcher then re-renders the row and terminal.
   */
  private async rename(sessionId?: string): Promise<void> {
    if (!sessionId) return;
    const file = this.sessionFile(sessionId);
    if (!file) return;
    let state: Record<string, unknown>;
    try {
      state = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      vscode.window.showWarningMessage(
        "This agent has no active session to rename."
      );
      return;
    }
    const current = typeof state.name === "string" ? state.name : "";
    const value = await vscode.window.showInputBox({
      title: "Rename agent",
      prompt: "Name for this agent session (used in the panel and its terminal)",
      value: current,
      placeHolder: "e.g. Refactor auth",
    });
    if (value === undefined) return; // cancelled
    const name = value.trim();
    if (name) state.name = name;
    else delete state.name; // cleared -> fall back to the work summary
    try {
      fs.writeFileSync(file, JSON.stringify(state) + "\n");
    } catch (e) {
      vscode.window.showErrorMessage(
        `Could not rename: ${e instanceof Error ? e.message : String(e)}`
      );
      return;
    }
    this.lastPosted = "";
    await this.refresh();
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

  /** Prompt for a branch name and create a worktree for it, then mount it. */
  async newWorktree(): Promise<void> {
    const repoRoot = await this.repoRoot();
    if (!repoRoot) {
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
      path.dirname(repoRoot),
      branch.trim().replace(/[^\w.-]+/g, "-")
    );

    try {
      await addWorktree(repoRoot, dir, branch.trim());
    } catch (err) {
      vscode.window.showErrorMessage(
        `Could not create worktree: ${(err as Error).message}`
      );
      return;
    }
    await this.open(dir);
  }

  /** Confirm and remove a worktree from disk (offering --force when dirty). */
  private async removeWorktreeAction(fsPath?: string): Promise<void> {
    if (!fsPath) return;
    const repoRoot = await this.repoRoot();
    if (!repoRoot) return;

    // Every agent whose worktree is this path (or nested under it).
    const target = normalize(fsPath);
    const byPath = await readSessionsByWorktree(SESSIONS_DIR);
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

    if (folderIndex(fsPath) > 0) await this.unmount(fsPath);

    try {
      await removeWorktree(repoRoot, fsPath);
    } catch {
      const force = await vscode.window.showWarningMessage(
        "Worktree has changes or is locked. Force remove?",
        { modal: true },
        "Force Remove"
      );
      if (force !== "Force Remove") return;
      try {
        await removeWorktree(repoRoot, fsPath, true);
      } catch (err) {
        vscode.window.showErrorMessage(
          `Could not remove worktree: ${(err as Error).message}`
        );
        return;
      }
    }
    await this.refresh();
  }

  private async repoRoot(): Promise<string | undefined> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return cwd ? findRepoRoot(cwd) : undefined;
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
