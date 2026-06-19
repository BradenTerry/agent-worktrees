import * as vscode from "vscode";
import { WorktreeWebviewProvider } from "./worktreeWebview";

export function activate(context: vscode.ExtensionContext) {
  const provider = new WorktreeWebviewProvider(
    context.extensionUri,
    context.globalStorageUri
  );

  context.subscriptions.push(
    provider,

    vscode.window.registerWebviewViewProvider(
      WorktreeWebviewProvider.viewType,
      provider
    ),

    vscode.commands.registerCommand("worktreeView.refresh", () =>
      provider.refresh()
    ),

    vscode.commands.registerCommand("worktreeView.newWorktree", () =>
      provider.newWorktree()
    ),

    // Clean up an agent row when its terminal is closed by any means.
    vscode.window.onDidCloseTerminal((t) => provider.forgetTerminal(t)),

    // Keep the panel in sync when folders change by any means.
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh())
  );
}

export function deactivate() {}
