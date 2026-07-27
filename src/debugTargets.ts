/**
 * Launch-configuration parsing and preparation, isolated from the VS Code API so
 * it can be unit-tested.
 *
 * A worktree is not a workspace folder, so VS Code neither surfaces its
 * `.vscode/launch.json` in the Run and Debug view nor resolves
 * `${workspaceFolder}` against it: there is no API to retarget that view. We
 * therefore read the file ourselves and rewrite the folder variables to the
 * worktree before handing the configuration to `debug.startDebugging`, which is
 * the one debug entry point that does take a target.
 */

import { parseJsonc } from "./jsonc";

/**
 * A launch configuration, as it appears in launch.json. `name`, `type` and
 * `request` are required by VS Code's own schema, and parseLaunchJson drops
 * entries missing any of them: an entry VS Code could not start is not a target
 * worth offering.
 */
export interface DebugConfigLike {
  name: string;
  type: string;
  request: string;
  [key: string]: unknown;
}

/** A launch.json "compounds" entry: several configurations under one name. */
export interface Compound {
  name: string;
  configurations: string[];
}

/** The parts of a launch.json this feature uses. */
export interface LaunchFile {
  configurations: DebugConfigLike[];
  compounds: Compound[];
}

/** One entry in the panel's target quick pick. */
export interface DebugTarget {
  name: string;
  kind: "config" | "compound";
  /** Debug type ("node", "coreclr", ...) for a single configuration. */
  type?: string;
  /** How many configurations a compound starts. */
  count?: number;
}

/** Config key carrying the worktree a session was started for, so a session can
 *  be mapped back to its card. Read off `DebugSession.configuration`, which
 *  keeps unknown properties verbatim. */
export const WORKTREE_KEY = "agentWorktreesPath";
/** Config key marking a session started with "Run without debugging". */
export const NO_DEBUG_KEY = "agentWorktreesNoDebug";

const EMPTY: LaunchFile = { configurations: [], compounds: [] };

/**
 * Parse a launch.json body. Never throws: a malformed or unexpected file yields
 * no targets, which renders as "no Debug button" rather than an error the user
 * cannot act on.
 */
export function parseLaunchJson(text: string): LaunchFile {
  const parsed = parseJsonc(text);
  if (!parsed || typeof parsed !== "object") return EMPTY;
  const raw = parsed as { configurations?: unknown; compounds?: unknown };

  const isConfig = (c: unknown): c is DebugConfigLike => {
    if (!c || typeof c !== "object" || Array.isArray(c)) return false;
    const r = c as Record<string, unknown>;
    return (
      typeof r.name === "string" &&
      !!r.name &&
      typeof r.type === "string" &&
      !!r.type &&
      typeof r.request === "string" &&
      !!r.request
    );
  };
  const configurations: DebugConfigLike[] = Array.isArray(raw.configurations)
    ? raw.configurations.filter(isConfig)
    : [];

  const compounds: Compound[] = Array.isArray(raw.compounds)
    ? raw.compounds
        .filter(
          (c): c is { name: string; configurations: unknown[] } =>
            !!c &&
            typeof c === "object" &&
            typeof (c as Compound).name === "string" &&
            !!(c as Compound).name &&
            Array.isArray((c as { configurations?: unknown }).configurations)
        )
        // A compound's members may be objects ({folder, name}) in a multi-root
        // workspace; only the plain-string form maps onto a single worktree.
        .map((c) => ({
          name: c.name,
          configurations: c.configurations.filter(
            (n): n is string => typeof n === "string"
          ),
        }))
        .filter((c) => c.configurations.length > 0)
    : [];

  return { configurations, compounds };
}

/** Quick-pick entries for a parsed launch file: configurations, then compounds. */
export function debugTargets(file: LaunchFile): DebugTarget[] {
  const configs: DebugTarget[] = file.configurations.map((c) => ({
    name: c.name,
    kind: "config",
    type: c.type,
  }));
  const known = new Set(configs.map((c) => c.name));
  const compounds: DebugTarget[] = file.compounds
    // A compound whose members are all missing would start nothing.
    .filter((c) => c.configurations.some((n) => known.has(n)))
    .map((c) => ({
      name: c.name,
      kind: "compound",
      count: c.configurations.filter((n) => known.has(n)).length,
    }));
  return [...configs, ...compounds];
}

/**
 * The configurations a target starts, in order. A compound resolves to its
 * members (unknown names dropped, as VS Code does); a configuration to itself.
 */
export function resolveTarget(
  file: LaunchFile,
  target: DebugTarget
): DebugConfigLike[] {
  const byName = new Map(file.configurations.map((c) => [c.name, c]));
  if (target.kind === "config") {
    const found = byName.get(target.name);
    return found ? [found] : [];
  }
  const compound = file.compounds.find((c) => c.name === target.name);
  if (!compound) return [];
  return compound.configurations
    .map((n) => byName.get(n))
    .filter((c): c is DebugConfigLike => !!c);
}

/** The workspace-folder variables, which must point at the worktree. */
const FOLDER_VARS = /\$\{(workspaceFolder|workspaceRoot)\}/g;
const FOLDER_BASENAME_VARS = /\$\{workspaceFolderBasename\}/g;

/** Deep-replace the folder variables in every string of a config value. */
function substitute(value: unknown, dir: string, base: string): unknown {
  if (typeof value === "string") {
    return value
      .replace(FOLDER_VARS, dir)
      .replace(FOLDER_BASENAME_VARS, base);
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, dir, base));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substitute(v, dir, base);
    }
    return out;
  }
  return value;
}

/**
 * Rewrite a configuration to run in `worktreePath`.
 *
 * - `${workspaceFolder}` / `${workspaceRoot}` / `${workspaceFolderBasename}`
 *   point at the worktree instead of the primary folder. Every other `${...}`
 *   variable is left for VS Code to resolve as usual.
 * - `cwd` defaults to the worktree. Without this an adapter that defaults cwd to
 *   the workspace folder would run the worktree's program from the primary
 *   checkout. A config that sets `cwd` itself is left alone.
 * - The session is renamed `<config> (<worktree>)`, so the Run and Debug view's
 *   CALL STACK says which worktree a session belongs to.
 * - The worktree is recorded on the config, which is how a running session is
 *   mapped back to its card.
 * - `preLaunchTask` and `postDebugTask` are **removed**. They are labels VS Code
 *   resolves against the workspace folder and runs there, so leaving them in
 *   builds the primary worktree and then debugs the worktree's unrebuilt output.
 *   The caller runs the pre-launch task in the worktree instead; see
 *   ./debugTasks and launchTasksOf below.
 */
export function prepareConfig(
  config: DebugConfigLike,
  worktreePath: string,
  worktreeName: string,
  folderBasename: string,
  noDebug = false
): DebugConfigLike {
  const out = substitute(
    config,
    worktreePath,
    folderBasename
  ) as DebugConfigLike;
  if (out.cwd === undefined) out.cwd = worktreePath;
  out.name = `${config.name || "Launch"} (${worktreeName})`;
  out[WORKTREE_KEY] = worktreePath;
  if (noDebug) out[NO_DEBUG_KEY] = true;
  delete out.preLaunchTask;
  delete out.postDebugTask;
  return out;
}

/** The task labels a configuration carries, before prepareConfig strips them. */
export function launchTasksOf(config: DebugConfigLike): {
  preLaunchTask?: string;
  postDebugTask?: string;
} {
  const pre = config.preLaunchTask;
  const post = config.postDebugTask;
  return {
    ...(typeof pre === "string" && pre ? { preLaunchTask: pre } : {}),
    ...(typeof post === "string" && post ? { postDebugTask: post } : {}),
  };
}

/** The worktree a running session was started for, if this extension started it. */
export function taggedWorktree(config: unknown): string | undefined {
  if (!config || typeof config !== "object") return undefined;
  const value = (config as Record<string, unknown>)[WORKTREE_KEY];
  return typeof value === "string" && value ? value : undefined;
}

/** Whether a running session was started without debugging. */
export function taggedNoDebug(config: unknown): boolean {
  if (!config || typeof config !== "object") return false;
  return (config as Record<string, unknown>)[NO_DEBUG_KEY] === true;
}
