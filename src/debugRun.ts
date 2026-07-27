/**
 * Running and stopping debug sessions in a worktree.
 *
 * The Run and Debug view cannot be retargeted by an extension: its dropdown is
 * built from the workspace folders' launch configs and its selection belongs to
 * the user. `debug.startDebugging(folder, config)` is the one debug API that
 * takes a target, so the panel drives that directly with a configuration read
 * from the worktree's own `.vscode/launch.json` (see ./debugTargets for the
 * parsing and path rewriting).
 *
 * Because the sessions are started outside the debug view, the panel also has to
 * offer the way back: `DebugSessionTracker` follows the sessions this extension
 * started and the card renders a stop button per session.
 */

import * as vscode from "vscode";
import { promises as fs } from "fs";
import * as path from "path";
import { diag, trace } from "./diagnostics";
import { normalizePath } from "./worktreeUtils";
import {
  DebugConfigLike,
  DebugTarget,
  LaunchFile,
  debugTargets,
  launchTasksOf,
  parseLaunchJson,
  prepareConfig,
  resolveTarget,
  taggedNoDebug,
  taggedWorktree,
} from "./debugTargets";
import {
  TaskSpec,
  findTask,
  npmScriptSpec,
  parseTasksJson,
  taskSpec,
} from "./debugTasks";

/** Where a worktree's launch configurations live. */
export const LAUNCH_REL = path.join(".vscode", "launch.json");
/** Where its task definitions live. */
export const TASKS_REL = path.join(".vscode", "tasks.json");

/** A running debug session, as rendered on a worktree card. */
export interface DebugSessionVM {
  id: string;
  label: string;
  /** Started with "Run without debugging". */
  noDebug: boolean;
}

/** Read and parse a worktree's launch.json. Missing or unreadable is not an
 *  error: it simply means this worktree has nothing to debug. */
export async function readLaunchFile(
  worktreePath: string
): Promise<LaunchFile | undefined> {
  const file = path.join(worktreePath, LAUNCH_REL);
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return undefined;
  }
  const parsed = parseLaunchJson(text);
  if (!parsed.configurations.length) {
    diag(`debug: ${file} has no usable configurations`);
    return undefined;
  }
  return parsed;
}

/** Whether the Debug button should render for this worktree. */
export async function hasDebugTargets(worktreePath: string): Promise<boolean> {
  return !!(await readLaunchFile(worktreePath));
}

/**
 * Pick a launch target for a worktree. Accepting an item starts it with
 * debugging; the play button on a row starts it without. One quick pick rather
 * than two steps, and the button carries a tooltip so the alternative is
 * discoverable.
 */
async function pickTarget(
  targets: DebugTarget[],
  worktreeName: string
): Promise<{ target: DebugTarget; noDebug: boolean } | undefined> {
  type Item = vscode.QuickPickItem & { target: DebugTarget };
  const runButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon("run"),
    tooltip: "Start without debugging",
  };
  const qp = vscode.window.createQuickPick<Item>();
  qp.title = `Debug in ${worktreeName}`;
  qp.placeholder =
    "Pick a launch configuration, or its play icon to start without debugging";
  qp.matchOnDescription = true;
  qp.items = targets.map((t) => ({
    label: t.name,
    description:
      t.kind === "compound"
        ? `compound · ${t.count} configuration${t.count === 1 ? "" : "s"}`
        : t.type,
    buttons: [runButton],
    target: t,
  }));

  return new Promise((resolve) => {
    let settled = false;
    const finish = (
      result: { target: DebugTarget; noDebug: boolean } | undefined
    ): void => {
      if (settled) return;
      settled = true;
      resolve(result);
      qp.hide();
    };
    qp.onDidAccept(() => {
      const item = qp.selectedItems[0];
      finish(item ? { target: item.target, noDebug: false } : undefined);
    });
    qp.onDidTriggerItemButton((e) =>
      finish({ target: e.item.target, noDebug: true })
    );
    qp.onDidHide(() => {
      finish(undefined);
      qp.dispose();
    });
    qp.show();
  });
}

/**
 * The folder passed to startDebugging. The worktree itself is usually not a
 * workspace folder, and the folder-relative variables have already been
 * rewritten to the worktree, so this only decides where the *remaining*
 * variables (`${config:...}`, `${env:...}`) resolve. Prefer the workspace folder
 * that is the worktree when there is one, else the first folder.
 */
function folderFor(worktreePath: string): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const target = normalizePath(worktreePath);
  return (
    folders.find((f) => normalizePath(f.uri.fsPath) === target) ?? folders[0]
  );
}

/**
 * Resolve a `preLaunchTask` label against the worktree's own tasks.json, falling
 * back to an npm script when the label is `npm: <script>` and no tasks.json
 * defines it (VS Code auto-detects those from package.json).
 */
async function resolveLaunchTask(
  worktreePath: string,
  label: string
): Promise<TaskSpec | undefined> {
  let tasksText = "";
  try {
    tasksText = await fs.readFile(path.join(worktreePath, TASKS_REL), "utf8");
  } catch {
    /* no tasks.json: the npm fallback below may still resolve it */
  }
  const platform =
    process.platform === "win32"
      ? "windows"
      : process.platform === "darwin"
      ? "osx"
      : "linux";
  const found = tasksText ? findTask(parseTasksJson(tasksText), label) : undefined;
  if (found) {
    const spec = taskSpec(found, worktreePath, {
      platform,
      sep: path.sep,
      basename: path.basename(worktreePath),
    });
    if (spec) return spec;
    // Found, but its type is a provider task we cannot reproduce.
    diag(`debug: preLaunchTask "${label}" has unsupported type ${found.type}`);
    return undefined;
  }
  try {
    const pkg = await fs.readFile(
      path.join(worktreePath, "package.json"),
      "utf8"
    );
    return npmScriptSpec(label, pkg, worktreePath);
  } catch {
    return undefined;
  }
}

/**
 * Run the pre-launch task in the worktree and wait for it. Returns false when it
 * failed, which aborts the launch: debugging output that a failed build did not
 * produce is exactly the confusion this whole path exists to avoid.
 */
async function runLaunchTask(spec: TaskSpec): Promise<boolean> {
  const task = new vscode.Task(
    { type: "agentWorktrees", label: spec.label },
    vscode.TaskScope.Workspace,
    `${spec.label} (worktree)`,
    "Agent Worktrees",
    new vscode.ShellExecution(spec.command, spec.args, { cwd: spec.cwd })
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Silent,
    panel: vscode.TaskPanelKind.Dedicated,
    clear: true,
  };
  trace(`debug: preLaunchTask ${spec.command} ${spec.args.join(" ")} in ${spec.cwd}`);

  let execution: vscode.TaskExecution;
  try {
    execution = await vscode.tasks.executeTask(task);
  } catch (e) {
    diag(`debug: preLaunchTask "${spec.label}" could not start: ${String(e)}`);
    vscode.window.showWarningMessage(
      `Could not run "${spec.label}" in the worktree.`
    );
    return false;
  }

  // A watch task never "ends": VS Code waits for its problem matcher's end
  // pattern, which an extension cannot observe. Start it and carry on.
  if (spec.isBackground) return true;

  const exitCode = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Running ${spec.label} in ${path.basename(spec.cwd)}`,
      cancellable: true,
    },
    (_progress, token) =>
      new Promise<number | undefined>((resolve) => {
        const ended = vscode.tasks.onDidEndTaskProcess((e) => {
          if (e.execution !== execution) return;
          ended.dispose();
          resolve(e.exitCode);
        });
        token.onCancellationRequested(() => {
          ended.dispose();
          execution.terminate();
          resolve(undefined);
        });
      })
  );

  if (exitCode === undefined) return false; // cancelled
  if (exitCode !== 0) {
    diag(`debug: preLaunchTask "${spec.label}" exited ${exitCode}`);
    vscode.window.showErrorMessage(
      `"${spec.label}" failed with exit code ${exitCode}. Not launching.`
    );
    return false;
  }
  return true;
}

/**
 * Handle a configuration's task labels before launching: run the pre-launch task
 * in the worktree, and say so when a task had to be skipped. Returns false when
 * the launch should be abandoned.
 *
 * prepareConfig strips both labels from what we hand VS Code, because VS Code
 * would resolve them against the *workspace folder* and build the primary
 * worktree instead of this one.
 */
async function runPreLaunch(
  config: DebugConfigLike,
  worktreePath: string
): Promise<boolean> {
  const { preLaunchTask, postDebugTask } = launchTasksOf(config);
  if (postDebugTask) {
    // Running it would mean holding state until the session ends and resolving
    // it the same way; not worth it until someone needs it. Say so rather than
    // silently dropping it.
    diag(`debug: skipping postDebugTask "${postDebugTask}" (not supported)`);
    vscode.window.showWarningMessage(
      `Skipped postDebugTask "${postDebugTask}": the panel does not run it in a worktree.`
    );
  }
  if (!preLaunchTask) return true;

  const spec = await resolveLaunchTask(worktreePath, preLaunchTask);
  if (!spec) {
    // Better to launch with a warning than to refuse: the user may have built
    // the worktree already, and refusing would make the button useless for any
    // task type we cannot reproduce.
    vscode.window.showWarningMessage(
      `Could not run "${preLaunchTask}" in this worktree, so it was skipped. ` +
        `Build the worktree yourself, or the session may run stale output.`
    );
    return true;
  }
  return runLaunchTask(spec);
}

/**
 * Ask which target to run in `worktreePath`, then start it. A compound starts
 * its members in order, as VS Code does. Returns the number of sessions started.
 */
export async function startWorktreeDebug(
  worktreePath: string,
  worktreeName: string
): Promise<number> {
  const file = await readLaunchFile(worktreePath);
  if (!file) {
    vscode.window.showInformationMessage(
      `No launch configurations in ${worktreeName} (${LAUNCH_REL}).`
    );
    return 0;
  }
  const targets = debugTargets(file);
  if (!targets.length) return 0;

  const choice = await pickTarget(targets, worktreeName);
  if (!choice) return 0;

  const configs = resolveTarget(file, choice.target);
  const folder = folderFor(worktreePath);
  const basename = path.basename(worktreePath);
  let started = 0;
  for (const config of configs) {
    // Build the worktree, not the primary, before the session starts.
    if (!(await runPreLaunch(config, worktreePath))) break;
    const prepared = prepareConfig(
      config,
      worktreePath,
      worktreeName,
      basename,
      choice.noDebug
    );
    trace(
      `debug: start ${prepared.name} in ${worktreePath}` +
        (choice.noDebug ? " (no debug)" : "")
    );
    let ok = false;
    try {
      ok = await vscode.debug.startDebugging(folder, prepared, {
        noDebug: choice.noDebug,
      });
    } catch (e) {
      diag(`debug: startDebugging threw for ${prepared.name}: ${String(e)}`);
    }
    if (ok) {
      started++;
    } else {
      // startDebugging resolves false when the adapter refuses (a missing
      // program, an uninstalled debug extension). VS Code has already shown its
      // own error, so only say which configuration it was.
      diag(`debug: ${prepared.name} did not start`);
      vscode.window.showWarningMessage(
        `Could not start "${config.name}" in ${worktreeName}.`
      );
      // A compound whose first member fails would otherwise start the rest
      // against a half-built setup.
      break;
    }
  }
  return started;
}

/**
 * The debug sessions this extension started, grouped by worktree.
 *
 * A session is claimed by reading the worktree back off its own configuration,
 * so a session started from the Run and Debug view (or by another extension) is
 * never listed: the panel only offers to stop what it started.
 */
export class DebugSessionTracker implements vscode.Disposable {
  private readonly live = new Map<
    string,
    { session: vscode.DebugSession; worktree: string; vm: DebugSessionVM }
  >();
  private readonly emitter = new vscode.EventEmitter<void>();
  /** Fires when a tracked session starts or ends, so the panel can re-render. */
  readonly onDidChange = this.emitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      vscode.debug.onDidStartDebugSession((session) => {
        const worktree = taggedWorktree(session.configuration);
        if (!worktree) return;
        this.live.set(session.id, {
          session,
          worktree: normalizePath(worktree),
          vm: {
            id: session.id,
            label: session.name,
            noDebug: taggedNoDebug(session.configuration),
          },
        });
        this.emitter.fire();
      }),
      vscode.debug.onDidTerminateDebugSession((session) => {
        if (this.live.delete(session.id)) this.emitter.fire();
      })
    );
  }

  /** Sessions running in this worktree, in start order. */
  forWorktree(worktreePath: string): DebugSessionVM[] {
    const key = normalizePath(worktreePath);
    const out: DebugSessionVM[] = [];
    for (const entry of this.live.values()) {
      if (entry.worktree === key) out.push(entry.vm);
    }
    return out;
  }

  /** Whether any tracked session is running (cheap check for the button state). */
  get size(): number {
    return this.live.size;
  }

  /**
   * Stop one session. The row is removed by the terminate event rather than
   * here, so a session that refuses to die keeps its row (and its stop button).
   */
  async stop(id: string): Promise<void> {
    const entry = this.live.get(id);
    if (!entry) return;
    trace(`debug: stop ${entry.vm.label}`);
    await vscode.debug.stopDebugging(entry.session);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.live.clear();
    this.emitter.dispose();
  }
}
