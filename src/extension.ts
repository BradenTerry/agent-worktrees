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
      provider,
      // Keep the webview alive while it is hidden so switching to another view
      // (e.g. Source Control) and back does not tear down and rebuild the panel,
      // which made the worktree list flash and reload. The view keeps its
      // rendered state; we still refresh on re-show to pick up changes.
      { webviewOptions: { retainContextWhenHidden: true } }
    ),

    vscode.commands.registerCommand("worktreeView.refresh", () =>
      provider.refresh(true)
    ),

    vscode.commands.registerCommand("worktreeView.newWorktree", () =>
      provider.newWorktree()
    ),

    vscode.commands.registerCommand("worktreeView.settings", () =>
      provider.openSettings()
    ),

    // Keep the panel in sync when folders change by any means.
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh())
  );
}

export function deactivate() {}
