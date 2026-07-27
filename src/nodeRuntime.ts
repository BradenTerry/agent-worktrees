import { execFile } from "child_process";

/**
 * Picking the Node that runs the hook emitter.
 *
 * The emitter (hooks/agent-worktrees-emit.mjs) runs as a hook command Claude
 * Code spawns through the user's shell, so the extension has to name an
 * interpreter for it in settings.json. It used to name a bare `node`, which made
 * a Node install a hard requirement of the extension: Claude Code ships as a
 * native binary now, so `claude` on PATH no longer implies `node` on PATH, and
 * a missing one turns into a "hook error" per event rather than a quiet
 * degrade.
 *
 * VS Code carries its own Node, so there is always one to fall back on. Setting
 * ELECTRON_RUN_AS_NODE=1 makes the VS Code binary behave as a plain Node
 * interpreter, which needs an env var and therefore a launcher script - see
 * launcherScript. A real `node` on PATH is still preferred (smaller, warmer,
 * and it keeps working if VS Code is uninstalled while sessions run), and needs
 * no launcher because it can be invoked by absolute path.
 */

/** The interpreter the hook command should run the emitter with. */
export interface NodeRuntime {
  /** Absolute path to the executable. */
  exec: string;
  /** True when `exec` is VS Code's binary and needs ELECTRON_RUN_AS_NODE=1. */
  viaElectron: boolean;
  /** Extra argv the Electron build needs, passed *after* the emitter path. */
  enableArgs: string[];
}

/**
 * Microsoft's VS Code builds ship Electron with the `runAsNode` fuse disabled,
 * so ELECTRON_RUN_AS_NODE alone is ignored unless
 * `--ms-enable-electron-run-as-node` is also passed. Only their builds know
 * that flag, hence the `microsoft-build` check - and it goes *after* the script
 * path, which is where VS Code puts it in its own askpass/shell-env spawns so a
 * build that does not know it treats it as a script argument instead of dying
 * on an unknown option. The emitter ignores argv it does not recognize.
 */
export function electronEnableArgs(
  versions: Partial<Record<string, string>>
): string[] {
  return versions.electron && versions["microsoft-build"]
    ? ["--ms-enable-electron-run-as-node"]
    : [];
}

/** Oldest Node the emitter is expected to run on. Below this we prefer VS
 *  Code's own (modern) runtime over whatever is on PATH. */
const MIN_NODE_MAJOR = 18;

/** What the probe below asks a PATH `node` to print: where it lives and what
 *  version it is, in one spawn. */
const PROBE = "process.execPath + '|' + process.versions.node";

/**
 * Parse the probe output into a usable interpreter path, or undefined when the
 * output is unusable (empty, malformed, or a Node too old for the emitter).
 */
export function usableNodePath(stdout: string): string | undefined {
  const [exec, version] = stdout.trim().split("|");
  if (!exec || !version) return undefined;
  const major = Number.parseInt(version, 10);
  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) return undefined;
  return exec;
}

/** Absolute path of a usable `node` on PATH, or undefined if there is none.
 *  Resolved to an absolute path on purpose: the hook runs in Claude Code's
 *  shell, whose PATH may not be the extension host's. */
function probePathNode(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "node",
      ["-p", PROBE],
      { timeout: 3000, windowsHide: true },
      (err, stdout) => {
        resolve(err ? undefined : usableNodePath(stdout));
      }
    );
  });
}

/**
 * The interpreter to run the emitter with: a usable `node` from PATH when there
 * is one, else the host's own executable. On a remote/server host that
 * executable is already a plain Node; on the desktop it is Electron and needs
 * the launcher.
 */
export async function resolveNodeRuntime(): Promise<NodeRuntime> {
  const onPath = await probePathNode();
  if (onPath) return { exec: onPath, viaElectron: false, enableArgs: [] };
  return {
    exec: process.execPath,
    viaElectron: !!process.versions.electron,
    enableArgs: electronEnableArgs(process.versions),
  };
}

/** Memoized across the session: the answer only changes if the user installs
 *  Node or moves VS Code, and both are handled on the next window. */
let cached: Promise<NodeRuntime> | undefined;
export function nodeRuntime(): Promise<NodeRuntime> {
  return (cached ??= resolveNodeRuntime());
}

/** Launcher file name for a platform. `.cmd` so cmd.exe will run it. */
export function launcherName(platform: NodeJS.Platform): string {
  return platform === "win32"
    ? "agent-worktrees-emit.cmd"
    : "agent-worktrees-emit.sh";
}

/** Escape a path for a double-quoted string in a POSIX shell. */
function shQuote(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

/** Escape a path for a double-quoted argument inside a batch file, where a bare
 *  `%` would start an env-var expansion and `%%` is the literal. */
function cmdQuote(value: string): string {
  return `"${value.replace(/%/g, "%%")}"`;
}

/**
 * The launcher that runs the emitter on VS Code's Node. It exists only to set
 * ELECTRON_RUN_AS_NODE: an env-var prefix cannot be written once for both
 * cmd.exe and POSIX shells, and the hook command in settings.json is a single
 * string that Claude Code hands to whichever shell the user has.
 *
 * `--no-warnings` matches the direct command: Claude Code reports any stderr as
 * a hook error, and Node's startup warnings would land there before the emitter
 * gets control.
 */
export function launcherScript(
  platform: NodeJS.Platform,
  runtime: NodeRuntime,
  emitter: string
): string {
  const extra = runtime.enableArgs.map((a) => ` ${a}`).join("");
  if (platform === "win32") {
    return [
      "@echo off",
      "rem Generated by the Agent Worktrees extension. Do not edit; it is",
      "rem rewritten whenever the extension starts.",
      "setlocal",
      'set "ELECTRON_RUN_AS_NODE=1"',
      `${cmdQuote(runtime.exec)} --no-warnings ${cmdQuote(
        emitter
      )}${extra} %*`,
      "",
    ].join("\r\n");
  }
  return [
    "#!/bin/sh",
    "# Generated by the Agent Worktrees extension. Do not edit; it is",
    "# rewritten whenever the extension starts.",
    `ELECTRON_RUN_AS_NODE=1 exec ${shQuote(runtime.exec)} --no-warnings ` +
      `${shQuote(emitter)}${extra} "$@"`,
    "",
  ].join("\n");
}

/**
 * The command written into settings.json. Two shapes: the launcher (which
 * already carries the interpreter and emitter) or the interpreter invoked
 * directly. Both take `--dir`, since the emitter runs as a separate process
 * that cannot read the extension's context.
 *
 * `--no-warnings`: Claude Code surfaces ANY stderr output as a per-event "hook
 * error", and Node's startup warnings (deprecation/experimental, varying by
 * version) hit stderr before the emitter runs a single line, so they can only
 * be silenced from the command line.
 */
export function hookCommandFor(
  runtime: NodeRuntime,
  paths: { emitter: string; launcher: string; sessions: string }
): string {
  const dir = ` --dir "${paths.sessions}"`;
  if (runtime.viaElectron) return `"${paths.launcher}"${dir}`;
  return `"${runtime.exec}" --no-warnings "${paths.emitter}"${dir}`;
}
