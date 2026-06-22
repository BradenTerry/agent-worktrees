import * as vscode from "vscode";

/**
 * A single lazily-created output channel ("Agent Worktrees") for diagnostics.
 *
 * The panel swallows most failures so a transient git/GitHub hiccup never breaks
 * the view, but that also means a real problem (notably the Windows-only "the
 * Branches view never loads" reports) leaves no trace. Routing the swallowed
 * errors and some timing here gives the user something to capture: View ->
 * Output -> "Agent Worktrees".
 */
let channel: vscode.OutputChannel | undefined;

function ensure(): vscode.OutputChannel {
  if (!channel) channel = vscode.window.createOutputChannel("Agent Worktrees");
  return channel;
}

/** Append a timestamped diagnostics line. Never throws. */
export function diag(msg: string): void {
  try {
    ensure().appendLine(`${new Date().toISOString()} ${msg}`);
  } catch {
    /* diagnostics must never break a feature */
  }
}

/** Dispose the channel (extension deactivate). */
export function disposeDiagnostics(): void {
  channel?.dispose();
  channel = undefined;
}
