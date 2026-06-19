import * as vscode from "vscode";
import { WorktreeWebviewProvider } from "./worktreeWebview";

export function activate(context: vscode.ExtensionContext) {
  const provider = new WorktreeWebviewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      WorktreeWebviewProvider.viewType,
      provider
    ),

    vscode.commands.registerCommand("worktreeView.refresh", () =>
      provider.refresh()
    ),

    // Keep the panel in sync when folders change by any means.
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh())
  );
}

export function deactivate() {}
