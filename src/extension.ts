import * as vscode from "vscode";
import { WorktreeWebviewProvider } from "./worktreeWebview";
import { syncHooks } from "./hooks";

export function activate(context: vscode.ExtensionContext) {
  // Refresh/repair already-accepted hooks; never installs without consent.
  void syncHooks(context);

  const provider = new WorktreeWebviewProvider(context);

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

    // Keep the panel in sync when folders change by any means.
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh())
  );
}

export function deactivate() {}
