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

/**
 * Whether verbose tracing of external calls (git + GitHub) is on. Off by
 * default; toggled from the `agentWorktrees.trace` setting. Kept as a cheap
 * boolean so hot paths can skip building trace strings when it is off.
 */
let tracing = false;

/** Turn external-call tracing on/off. When turning on, reveal the channel so
 *  the user sees the stream they just enabled. */
export function setTracing(on: boolean): void {
  if (on === tracing) return;
  tracing = on;
  diag(on ? "debug tracing enabled" : "debug tracing disabled");
  if (on) {
    try {
      ensure().show(true);
    } catch {
      /* ignore */
    }
  }
}

/** Whether tracing is currently enabled (lets callers avoid building strings). */
export function isTracing(): boolean {
  return tracing;
}

/** Append a trace line, but only while tracing is enabled. Never throws. */
export function trace(msg: string): void {
  if (!tracing) return;
  diag(msg);
}

/** Reveal the output channel (the "Show Log" command). */
export function showDiagnostics(): void {
  try {
    ensure().show(true);
  } catch {
    /* ignore */
  }
}

/** Dispose the channel (extension deactivate). */
export function disposeDiagnostics(): void {
  channel?.dispose();
  channel = undefined;
}
