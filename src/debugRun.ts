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
  FROM_INPUT_KEY,
  LaunchFile,
  debugTargets,
  launchTasksOf,
  parseLaunchJson,
  prepareConfig,
  resolveTarget,
  substituteFolderVars,
  taggedFromInput,
  taggedNoDebug,
  taggedWorktree,
} from "./debugTargets";
import { InputDef, applyInputValues, inputRefs } from "./debugInputs";
import {
  TaskSpec,
  findTask,
  npmScriptSpec,
  parseTaskInputs,
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

/** Whether each worktree has anything to debug, valid while its launch.json
 *  mtime is unchanged. Only the answer is cached, not the parsed file: starting
 *  a session re-reads it, so a config edit can never be launched from a stale
 *  copy. */
const debuggableCache = new Map<string, { mtimeMs: number; has: boolean }>();

/**
 * Whether the Debug button should render for this worktree.
 *
 * Called for every worktree on every full refresh (window focus, an agent
 * transition, a worktree added), so it must not read and parse a file per
 * worktree per refresh. A missing launch.json is the common case and costs one
 * failed stat; a present one is parsed once and re-parsed only when it is
 * edited.
 */
export async function hasDebugTargets(worktreePath: string): Promise<boolean> {
  const file = path.join(worktreePath, LAUNCH_REL);
  let mtimeMs: number;
  try {
    mtimeMs = (await fs.stat(file)).mtimeMs;
  } catch {
    // No launch.json (or unreadable): nothing to debug, and nothing to cache -
    // one that appears later must be picked up, and a failed stat is already as
    // cheap as this gets.
    debuggableCache.delete(file);
    return false;
  }
  const hit = debuggableCache.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.has;
  const has = !!(await readLaunchFile(worktreePath));
  debuggableCache.set(file, { mtimeMs, has });
  return has;
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
 * Ask for a `pickString` input. `createQuickPick` rather than `showQuickPick`
 * because the declaration's `default` has to come up selected without reordering
 * the options the author listed.
 */
async function pickInputOption(
  def: InputDef,
  title: string
): Promise<string | undefined> {
  type Item = vscode.QuickPickItem & { value: string };
  const items: Item[] = (def.options ?? []).map((o) => ({
    label: o.label,
    // A `{ label, value }` option hides its value, which is what actually goes
    // into the configuration, so show it alongside.
    ...(o.label === o.value ? {} : { description: o.value }),
    value: o.value,
  }));

  const qp = vscode.window.createQuickPick<Item>();
  qp.title = title;
  qp.placeholder = def.description || `Value for \${input:${def.id}}`;
  qp.ignoreFocusOut = true;
  qp.items = items;
  const preset = items.find((i) => i.value === def.default);
  if (preset) qp.activeItems = [preset];

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | undefined): void => {
      if (settled) return;
      settled = true;
      resolve(value);
      qp.hide();
    };
    qp.onDidAccept(() => finish(qp.selectedItems[0]?.value));
    qp.onDidHide(() => {
      finish(undefined);
      qp.dispose();
    });
    qp.show();
  });
}

/**
 * Run a `command` input and take its result as the value. This is the input type
 * that exists to feed a configuration something no prompt can produce (a process
 * id, a device, a test name), and its `args` are the inputs to that command - by
 * the time it runs here they have been rewritten to the worktree, so a command
 * that lists candidates lists the worktree's.
 */
async function runCommandInput(def: InputDef): Promise<string | undefined> {
  const command = def.command ?? "";
  try {
    const result =
      def.args === undefined
        ? await vscode.commands.executeCommand(command)
        : await vscode.commands.executeCommand(command, def.args);
    if (typeof result === "string") return result;
    if (typeof result === "number" || typeof result === "boolean") {
      return String(result);
    }
    // A command that returns nothing is how its own picker reports a cancel, so
    // this is a dismissed prompt rather than an error.
    diag(`debug: input "${def.id}": ${command} returned no string`);
    return undefined;
  } catch (e) {
    diag(`debug: input "${def.id}": ${command} threw: ${String(e)}`);
    vscode.window.showWarningMessage(
      `The command "${command}" for \${input:${def.id}} failed, so nothing was launched.`
    );
    return undefined;
  }
}

/** Ask for one input's value, by declared type. */
async function promptInput(
  def: InputDef,
  title: string
): Promise<string | undefined> {
  if (def.type === "pickString") return pickInputOption(def, title);
  if (def.type === "command") return runCommandInput(def);
  return vscode.window.showInputBox({
    title,
    prompt: def.description || `Value for \${input:${def.id}}`,
    value: def.default,
    password: def.password === true,
    // The prompt is the only thing between a click and a launch; losing it to a
    // stray focus change would look like the button did nothing.
    ignoreFocusOut: true,
  });
}

/**
 * Resolve the `${input:...}` ids a target refers to, in the order they appear.
 *
 * Returns undefined when the launch should be abandoned: a prompt was dismissed,
 * or the id is not declared in the file that used it. Substituting nothing for an
 * undeclared id would launch a command with a hole in it, which is worse than not
 * launching.
 */
async function resolveInputValues(
  refs: string[],
  defs: InputDef[],
  worktreePath: string,
  worktreeName: string,
  source: string
): Promise<Record<string, string> | undefined> {
  const values: Record<string, string> = {};
  const basename = path.basename(worktreePath);
  for (const id of refs) {
    const declared = defs.find((d) => d.id === id);
    if (!declared) {
      diag(`debug: ${source} has no inputs entry for "${id}"`);
      vscode.window.showWarningMessage(
        `${source} in ${worktreeName} uses \${input:${id}} but declares no ` +
          `"inputs" entry for it, so nothing was launched.`
      );
      return undefined;
    }
    // The declaration's own paths mean the worktree too.
    const def = substituteFolderVars(declared, worktreePath, basename) as InputDef;
    const value = await promptInput(def, `Debug in ${worktreeName}`);
    if (value === undefined) return undefined;
    values[id] = value;
  }
  return values;
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

/** A pre-launch task whose input prompt was dismissed: abandon the launch. */
const CANCELLED = "cancelled" as const;

/**
 * A task to run, and whether an `${input:...}` fed it.
 *
 * Nothing the user answered a prompt with is written to the diagnostics log: that
 * log gets pasted into bug reports, and a `password` input exists precisely
 * because its value should not be lying around. A task whose command line holds
 * an answer is therefore not traced.
 */
type ResolvedTask = TaskSpec & { fromInput?: boolean };

/**
 * Resolve a `preLaunchTask` label against the worktree's own tasks.json, falling
 * back to an npm script when the label is `npm: <script>` and no tasks.json
 * defines it (VS Code auto-detects those from package.json).
 *
 * Returns CANCELLED when the task's own `${input:...}` could not be resolved. The
 * task is run here rather than by VS Code, so an unsubstituted `${input:...}` in
 * it would reach a shell verbatim.
 */
async function resolveLaunchTask(
  worktreePath: string,
  worktreeName: string,
  label: string
): Promise<ResolvedTask | typeof CANCELLED | undefined> {
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
    if (spec) {
      return withTaskInputs(spec, tasksText, worktreePath, worktreeName);
    }
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

/** Resolve the `${input:...}` a task's command, args or cwd carries, against the
 *  worktree's own tasks.json declarations. */
async function withTaskInputs(
  spec: TaskSpec,
  tasksText: string,
  worktreePath: string,
  worktreeName: string
): Promise<ResolvedTask | typeof CANCELLED> {
  const refs = inputRefs([spec.command, spec.args, spec.cwd]);
  if (!refs.length) return spec;
  const values = await resolveInputValues(
    refs,
    parseTaskInputs(tasksText),
    worktreePath,
    worktreeName,
    TASKS_REL
  );
  if (!values) return CANCELLED;
  return { ...(applyInputValues(spec, values) as TaskSpec), fromInput: true };
}

/**
 * Run the pre-launch task in the worktree and wait for it. Returns false when it
 * failed, which aborts the launch: debugging output that a failed build did not
 * produce is exactly the confusion this whole path exists to avoid.
 */
async function runLaunchTask(spec: ResolvedTask): Promise<boolean> {
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
  // Not traced when an input fed it: the command line holds what was typed.
  if (!spec.fromInput) {
    trace(
      `debug: preLaunchTask ${spec.command} ${spec.args.join(" ")} in ${spec.cwd}`
    );
  }

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
  worktreePath: string,
  worktreeName: string
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

  const spec = await resolveLaunchTask(worktreePath, worktreeName, preLaunchTask);
  // A dismissed input prompt is a deliberate "not now": abandon the launch
  // without a warning of its own, as VS Code does.
  if (spec === CANCELLED) return false;
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

  // Ask for the target's `${input:...}` values before anything runs: a compound
  // that uses one input twice asks once, and a dismissed prompt costs nothing
  // because no pre-launch task has started yet.
  const refs = inputRefs(configs);
  let values: Record<string, string> = {};
  if (refs.length) {
    const resolved = await resolveInputValues(
      refs,
      file.inputs,
      worktreePath,
      worktreeName,
      LAUNCH_REL
    );
    if (!resolved) return 0;
    values = resolved;
  }

  const folder = folderFor(worktreePath);
  const basename = path.basename(worktreePath);
  let started = 0;
  for (const raw of configs) {
    const config = applyInputValues(raw, values) as DebugConfigLike;
    // Build the worktree, not the primary, before the session starts.
    if (!(await runPreLaunch(config, worktreePath, worktreeName))) break;
    const prepared = prepareConfig(
      config,
      worktreePath,
      worktreeName,
      basename,
      choice.noDebug
    );
    // A configuration filled in from a prompt stays out of the log entirely: its
    // name, program and arguments hold what the user typed. The tag travels with
    // the session so stopping it is not logged either.
    const fromInput = inputRefs(raw).length > 0;
    if (fromInput) {
      prepared[FROM_INPUT_KEY] = true;
    } else {
      trace(
        `debug: start ${prepared.name} in ${worktreePath}` +
          (choice.noDebug ? " (no debug)" : "")
      );
    }
    let ok = false;
    try {
      ok = await vscode.debug.startDebugging(folder, prepared, {
        noDebug: choice.noDebug,
      });
    } catch (e) {
      if (!fromInput) {
        diag(`debug: startDebugging threw for ${prepared.name}: ${String(e)}`);
      }
    }
    if (ok) {
      started++;
    } else {
      // startDebugging resolves false when the adapter refuses (a missing
      // program, an uninstalled debug extension). VS Code has already shown its
      // own error, so only say which configuration it was.
      if (!fromInput) diag(`debug: ${prepared.name} did not start`);
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
    {
      session: vscode.DebugSession;
      worktree: string;
      vm: DebugSessionVM;
      /** Configured from an input answer, so it is never named in the log. */
      fromInput: boolean;
    }
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
          fromInput: taggedFromInput(session.configuration),
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
    if (!entry.fromInput) trace(`debug: stop ${entry.vm.label}`);
    await vscode.debug.stopDebugging(entry.session);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.live.clear();
    this.emitter.dispose();
  }
}
