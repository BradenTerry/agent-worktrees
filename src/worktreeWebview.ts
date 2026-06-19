import * as vscode from "vscode";
import * as http from "http";
import * as path from "path";
import * as crypto from "crypto";
import {
  gatherWorktrees,
  folderIndex,
  normalize,
  AgentVM,
  AgentStatus,
} from "./worktreeData";
import { findRepoRoot, addWorktree, removeWorktree } from "./git";

/** A live agent session: its view-model plus the terminal backing it. */
interface AgentRecord extends AgentVM {
  /** Normalized worktree path this agent runs in. */
  key: string;
  terminal: vscode.Terminal;
}

/** Messages sent from the webview to the extension. */
interface ActionMessage {
  type: "action";
  action:
    | "open"
    | "unmount"
    | "refresh"
    | "agent"
    | "focusAgent"
    | "stopAgent"
    | "newWorktree"
    | "removeWorktree";
  path?: string;
  agentId?: number;
}

export class WorktreeWebviewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  public static readonly viewType = "worktreeView.panel";

  private view?: vscode.WebviewView;

  /** Agents created per worktree, keyed by normalized path. */
  private agents = new Map<string, AgentRecord[]>();
  private nextAgentId = 1;

  /** Localhost listener that receives status updates from agent hooks. */
  private server?: http.Server;
  private port = 0;
  private readonly token = crypto.randomBytes(16).toString("hex");

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly storageUri: vscode.Uri
  ) {
    this.startServer();
  }

  dispose(): void {
    this.server?.close();
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
      if (webviewView.visible) void this.refresh();
    });

    void this.refresh();
  }

  /** Recompute worktree data and push it to the webview. */
  async refresh(): Promise<void> {
    if (!this.view) return;
    // Project records down to plain, serializable view-models for the webview.
    const clean = new Map<string, AgentVM[]>();
    for (const [key, list] of this.agents) {
      clean.set(
        key,
        list.map(({ id, label, status, startedAt, lastActivity }) => ({
          id,
          label,
          status,
          startedAt,
          lastActivity,
        }))
      );
    }
    const data = await gatherWorktrees(clean);
    void this.view.webview.postMessage({ type: "update", data });
  }

  // --- Status listener -------------------------------------------------------

  /** Start a localhost-only HTTP listener for agent status reports. */
  private startServer(): void {
    this.server = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/status") {
        res.writeHead(404).end();
        return;
      }
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const { id, status, token } = JSON.parse(body) as {
            id: number;
            status: AgentStatus;
            token: string;
          };
          if (token === this.token) this.applyStatus(id, status);
        } catch {
          /* ignore malformed reports */
        }
        res.writeHead(200).end();
      });
    });
    // Ephemeral port, loopback only.
    this.server.listen(0, "127.0.0.1", () => {
      const addr = this.server?.address();
      if (addr && typeof addr === "object") this.port = addr.port;
    });
  }

  /** Update the status of a known agent and refresh the panel. */
  private applyStatus(id: number, status: AgentStatus): void {
    for (const list of this.agents.values()) {
      const agent = list.find((a) => a.id === id);
      if (agent) {
        agent.status = status;
        agent.lastActivity = Date.now();
        void this.refresh();
        return;
      }
    }
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
      case "focusAgent":
        return this.focusAgent(msg.agentId);
      case "stopAgent":
        return this.stopAgent(msg.agentId);
      case "newWorktree":
        return this.newWorktree();
      case "removeWorktree":
        return this.removeWorktreeAction(msg.path);
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
   * Spin up a Claude CLI session in the given worktree. Each click gets its own
   * terminal so multiple agents can run side by side across worktrees. The
   * session is launched with a generated settings file whose hooks report the
   * agent's lifecycle status back to this extension.
   */
  private async agent(fsPath?: string): Promise<void> {
    if (!fsPath) return;

    const key = normalize(fsPath);
    const list = this.agents.get(key) ?? [];
    const id = this.nextAgentId++;
    const ordinal = list.length + 1;
    const label = `Claude ${ordinal}`;
    const now = Date.now();

    const settingsPath = await this.writeHookSettings();

    const terminal = vscode.window.createTerminal({
      name: `${label} · ${nameOf(fsPath)}`,
      cwd: fsPath,
      iconPath: new vscode.ThemeIcon("sparkle"),
      env: {
        WT_AGENT_ID: String(id),
        WT_AGENT_PORT: String(this.port),
        WT_AGENT_TOKEN: this.token,
      },
    });

    const record: AgentRecord = {
      id,
      label,
      status: "idle",
      startedAt: now,
      lastActivity: now,
      key,
      terminal,
    };
    list.push(record);
    this.agents.set(key, list);

    terminal.show();
    terminal.sendText(`claude --settings "${settingsPath}"`);

    await this.refresh();
  }

  /** Reveal the terminal backing an agent. */
  private focusAgent(agentId?: number): void {
    const agent = this.findAgent(agentId);
    agent?.terminal.show();
  }

  /** Stop an agent by disposing its terminal; cleanup runs via onDidClose. */
  private stopAgent(agentId?: number): void {
    this.findAgent(agentId)?.terminal.dispose();
  }

  private findAgent(agentId?: number): AgentRecord | undefined {
    if (agentId == null) return undefined;
    for (const list of this.agents.values()) {
      const agent = list.find((a) => a.id === agentId);
      if (agent) return agent;
    }
    return undefined;
  }

  /** Drop an agent whose terminal has closed and refresh the panel. */
  forgetTerminal(terminal: vscode.Terminal): void {
    let changed = false;
    for (const [key, list] of this.agents) {
      const next = list.filter((a) => a.terminal !== terminal);
      if (next.length !== list.length) {
        changed = true;
        if (next.length) this.agents.set(key, next);
        else this.agents.delete(key);
      }
    }
    if (changed) void this.refresh();
  }

  /**
   * Write (idempotently) a settings file whose hooks report agent status. The
   * file is shared by every agent; identity is carried in each terminal's env.
   */
  private async writeHookSettings(): Promise<string> {
    await vscode.workspace.fs.createDirectory(this.storageUri);
    const fileUri = vscode.Uri.joinPath(this.storageUri, "agent-hooks.json");
    const hookScript = vscode.Uri.joinPath(
      this.extensionUri,
      "media",
      "agent-hook.js"
    ).fsPath;
    const cmd = (status: AgentStatus) => ({
      hooks: [
        { type: "command", command: `node "${hookScript}" ${status}` },
      ],
    });
    const settings = {
      hooks: {
        SessionStart: [cmd("idle")],
        UserPromptSubmit: [cmd("active")],
        PreToolUse: [{ matcher: "*", ...cmd("active") }],
        PostToolUse: [{ matcher: "*", ...cmd("active") }],
        Notification: [cmd("waiting")],
        Stop: [cmd("idle")],
      },
    };
    await vscode.workspace.fs.writeFile(
      fileUri,
      Buffer.from(JSON.stringify(settings, null, 2), "utf8")
    );
    return fileUri.fsPath;
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
      validateInput: (v) =>
        v.trim() ? undefined : "Enter a branch name.",
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

    const choice = await vscode.window.showWarningMessage(
      `Remove the worktree at ${fsPath}? This deletes the working directory.`,
      { modal: true },
      "Remove"
    );
    if (choice !== "Remove") return;

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
