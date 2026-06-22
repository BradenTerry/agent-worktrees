import * as vscode from "vscode";
import { WorktreeWebviewProvider } from "./worktreeWebview";
import { syncHooks } from "./hooks";
import { setGitLogger, setGitTracer } from "./git";
import { setGithubTracer } from "./github";
import {
  diag,
  trace,
  setTracing,
  showDiagnostics,
  disposeDiagnostics,
} from "./diagnostics";

const TRACE_SETTING = "agentWorktrees.trace";

/** Read the trace setting and wire git + GitHub tracing to match it. */
function applyTraceSetting(): void {
  const on = vscode.workspace
    .getConfiguration()
    .get<boolean>(TRACE_SETTING, false);
  setTracing(on); // reveals the channel and gates trace()
  setGitTracer(on ? trace : null); // per-call git tracing
  setGithubTracer(on ? trace : null); // per-request GitHub tracing
}

export function activate(context: vscode.ExtensionContext) {
  // Route git diagnostics to the "Agent Worktrees" output channel so a user can
  // see why a view fails (the Windows "Branches never loads" reports otherwise
  // leave no trace, since the panel swallows errors to stay resilient).
  setGitLogger(diag);
  // Apply the saved debug-tracing preference, and keep it in sync if changed.
  applyTraceSetting();

  // Refresh/repair already-accepted hooks; never installs without consent.
  void syncHooks(context);

  const provider = new WorktreeWebviewProvider(context);

  context.subscriptions.push(
    { dispose: disposeDiagnostics },
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

    // Flip the trace setting and reveal the log, so tracing is one click away.
    vscode.commands.registerCommand("worktreeView.toggleTrace", async () => {
      const cfg = vscode.workspace.getConfiguration();
      const next = !cfg.get<boolean>(TRACE_SETTING, false);
      await cfg.update(TRACE_SETTING, next, vscode.ConfigurationTarget.Global);
      // applyTraceSetting runs via onDidChangeConfiguration below.
      vscode.window.showInformationMessage(
        `Agent Worktrees debug tracing ${next ? "enabled" : "disabled"}.`
      );
    }),

    vscode.commands.registerCommand("worktreeView.showLog", () =>
      showDiagnostics()
    ),

    // React to the trace setting being toggled (from the command or Settings UI).
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(TRACE_SETTING)) applyTraceSetting();
    }),

    // Keep the panel in sync when folders change by any means.
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh())
  );
}

export function deactivate() {}
