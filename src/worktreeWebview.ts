import * as vscode from "vscode";
import {
  gatherWorktrees,
  folderIndex,
  normalize,
  AgentVM,
} from "./worktreeData";

/** Messages sent from the webview to the extension. */
interface ActionMessage {
  type: "action";
  action: "open" | "remove" | "refresh" | "agent";
  path?: string;
}

export class WorktreeWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "worktreeView.panel";

  private view?: vscode.WebviewView;

  /** Agents created per worktree, keyed by normalized path. */
  private agents = new Map<string, AgentVM[]>();
  private nextAgentId = 1;

  constructor(private readonly extensionUri: vscode.Uri) {}

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
    const data = await gatherWorktrees(this.agents);
    void this.view.webview.postMessage({ type: "update", data });
  }

  private async onMessage(msg: ActionMessage): Promise<void> {
    if (msg.type !== "action") return;
    switch (msg.action) {
      case "refresh":
        return void this.refresh();
      case "open":
        return this.open(msg.path);
      case "remove":
        return this.remove(msg.path);
      case "agent":
        return this.agent(msg.path);
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

  private async remove(fsPath?: string): Promise<void> {
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

  /**
   * Spin up a Claude CLI session in the given worktree. Each click gets its
   * own terminal so multiple agents can run side by side across worktrees,
   * and is tracked as a row under the worktree's section.
   */
  private async agent(fsPath?: string): Promise<void> {
    if (!fsPath) return;

    const key = normalize(fsPath);
    const list = this.agents.get(key) ?? [];
    const id = this.nextAgentId++;
    const ordinal = list.length + 1;
    const label = `Claude ${ordinal}`;
    // A freshly created agent starts idle until it begins working.
    list.push({ id, label, status: "idle" });
    this.agents.set(key, list);

    const terminal = vscode.window.createTerminal({
      name: `${label} · ${nameOf(fsPath)}`,
      cwd: fsPath,
      iconPath: new vscode.ThemeIcon("sparkle"),
    });
    terminal.show();
    terminal.sendText("claude");

    await this.refresh();
  }

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
