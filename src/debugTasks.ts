/**
 * preLaunchTask resolution, isolated from the VS Code API so it can be
 * unit-tested.
 *
 * A configuration's `preLaunchTask` is a *label*, resolved by VS Code against the
 * workspace folder's tasks.json and run with that folder as its cwd. Passing the
 * label through therefore builds the primary worktree and then debugs the
 * worktree's output, which nothing rebuilt: the program runs, but the change you
 * made in the worktree is not in it.
 *
 * So the task is resolved here instead, against the worktree's own tasks.json,
 * and run with the worktree as cwd before the session starts.
 */

import { InputDef, parseInputs } from "./debugInputs";
import { parseJsonc } from "./jsonc";

/** A tasks.json entry, as far as this feature reads it. */
export interface RawTask {
  label?: string;
  type?: string;
  /** npm tasks: the package.json script. */
  script?: string;
  /** npm tasks: a subfolder holding the package.json. */
  path?: string;
  command?: string;
  args?: unknown[];
  isBackground?: boolean;
  options?: { cwd?: string };
  /** Platform overrides, merged over the base when present. */
  windows?: Partial<RawTask>;
  linux?: Partial<RawTask>;
  osx?: Partial<RawTask>;
  [key: string]: unknown;
}

/** A resolved command to run before launching. */
export interface TaskSpec {
  label: string;
  command: string;
  args: string[];
  /** Absolute working directory: the worktree, or a subfolder of it. */
  cwd: string;
  /** A watch task. VS Code waits for a problem matcher's end pattern, which
   *  cannot be replicated here, so these are started and not waited on. */
  isBackground: boolean;
}

export type Platform = "windows" | "linux" | "osx";

/** Parse a tasks.json body. Never throws; an unreadable file yields no tasks. */
export function parseTasksJson(text: string): RawTask[] {
  const parsed = parseJsonc(text);
  if (!parsed || typeof parsed !== "object") return [];
  const tasks = (parsed as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return [];
  return tasks.filter(
    (t): t is RawTask => !!t && typeof t === "object" && !Array.isArray(t)
  );
}

/**
 * The `inputs` a tasks.json declares. A task's `${input:...}` references its own
 * file's inputs, not launch.json's, so the two are resolved from separate lists
 * even when an id appears in both.
 */
export function parseTaskInputs(text: string): InputDef[] {
  return parseInputs(parseJsonc(text));
}

/**
 * The label VS Code shows for a task. An explicit `label` wins; an npm task
 * without one is `npm: <script>`, which is how launch.json usually names it.
 */
export function taskLabel(task: RawTask): string | undefined {
  if (typeof task.label === "string" && task.label) return task.label;
  if (task.type === "npm" && typeof task.script === "string" && task.script) {
    return `npm: ${task.script}`;
  }
  return undefined;
}

/** Find a task by the label a preLaunchTask refers to. */
export function findTask(
  tasks: RawTask[],
  label: string
): RawTask | undefined {
  return tasks.find((t) => taskLabel(t) === label);
}

/** Merge the platform-specific block over the base definition. */
function forPlatform(task: RawTask, platform: Platform): RawTask {
  const override = task[platform] as Partial<RawTask> | undefined;
  return override && typeof override === "object"
    ? { ...task, ...override }
    : task;
}

/** tasks.json args may be strings or `{ value }` objects with quoting hints. */
function argStrings(args: unknown): string[] {
  if (!Array.isArray(args)) return [];
  const out: string[] = [];
  for (const a of args) {
    if (typeof a === "string") out.push(a);
    else if (a && typeof a === "object" && typeof (a as { value?: unknown }).value === "string") {
      out.push((a as { value: string }).value);
    }
  }
  return out;
}

/** Replace the folder variables in a task string with the worktree. */
function sub(value: string, dir: string, base: string): string {
  return value
    .replace(/\$\{(workspaceFolder|workspaceRoot)\}/g, dir)
    .replace(/\$\{workspaceFolderBasename\}/g, base);
}

/** Join a possibly-relative cwd onto the worktree, POSIX-style or absolute. */
function resolveCwd(
  raw: string | undefined,
  worktreePath: string,
  basename: string,
  sep: string
): string {
  if (!raw) return worktreePath;
  const value = sub(raw, worktreePath, basename);
  const isAbsolute = value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value);
  if (isAbsolute) return value;
  return worktreePath + sep + value;
}

/**
 * Turn a tasks.json entry into a command to run in the worktree, or undefined
 * when its type cannot be reproduced faithfully (a custom task provider, a
 * `typescript`/`gulp`/`dotnet` provider task). Returning undefined is what makes
 * the caller warn and skip rather than silently build the wrong tree.
 */
export function taskSpec(
  task: RawTask,
  worktreePath: string,
  options: { platform?: Platform; sep?: string; basename?: string } = {}
): TaskSpec | undefined {
  const platform = options.platform ?? "linux";
  const sep = options.sep ?? "/";
  const basename = options.basename ?? "";
  const t = forPlatform(task, platform);
  const label = taskLabel(task) ?? "preLaunchTask";
  const isBackground = t.isBackground === true;

  if (t.type === "npm") {
    if (typeof t.script !== "string" || !t.script) return undefined;
    // An npm task's `path` is the folder holding package.json, relative to the
    // workspace folder; `options.cwd` wins when both are set.
    const cwd = t.options?.cwd
      ? resolveCwd(t.options.cwd, worktreePath, basename, sep)
      : t.path
      ? worktreePath + sep + String(t.path).replace(/[\\/]+$/, "")
      : worktreePath;
    return {
      label,
      command: "npm",
      args: ["run", t.script],
      cwd,
      isBackground,
    };
  }

  if (t.type === "shell" || t.type === "process") {
    if (typeof t.command !== "string" || !t.command) return undefined;
    return {
      label,
      command: sub(t.command, worktreePath, basename),
      args: argStrings(t.args).map((a) => sub(a, worktreePath, basename)),
      cwd: resolveCwd(t.options?.cwd, worktreePath, basename, sep),
      isBackground,
    };
  }

  return undefined;
}

/**
 * Fall back to an npm script when there is no tasks.json entry. VS Code
 * auto-detects `npm: <script>` from package.json, so a launch.json can name a
 * task that exists nowhere in tasks.json.
 */
export function npmScriptSpec(
  label: string,
  packageJsonText: string,
  worktreePath: string
): TaskSpec | undefined {
  const match = /^npm:\s*(.+)$/.exec(label.trim());
  if (!match) return undefined;
  const script = match[1].trim();
  const parsed = parseJsonc(packageJsonText);
  const scripts =
    parsed && typeof parsed === "object"
      ? (parsed as { scripts?: unknown }).scripts
      : undefined;
  if (!scripts || typeof scripts !== "object") return undefined;
  if (typeof (scripts as Record<string, unknown>)[script] !== "string") {
    return undefined;
  }
  return {
    label,
    command: "npm",
    args: ["run", script],
    cwd: worktreePath,
    isBackground: false,
  };
}
