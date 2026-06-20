import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

/**
 * Hook-backed agent status detection.
 *
 * The panel cannot tell on its own whether a Claude session is working, waiting
 * on you, or idle. Claude Code's hooks fire exactly on those transitions, so we
 * install one emitter script (hooks/agent-worktrees-emit.mjs) wired to a handful
 * of events. The emitter writes a small state file per session that the panel
 * watches and groups by worktree.
 *
 * Installing the hooks edits the user's global ~/.claude/settings.json, so it is
 * always gated behind explicit consent in the panel — nothing is written until
 * the user accepts.
 */

const HOME = os.homedir();
/** Where the emitter writes per-session state files. */
export const SESSIONS_DIR = path.join(
  HOME,
  ".claude",
  "agent-worktrees",
  "sessions"
);
/** Stable home for the emitter script. The command we write into settings.json
 *  points HERE, not at the extension's versioned install dir, which VS Code
 *  deletes on every update — a running session keeps invoking the cached path. */
export const HOOKS_DIR = path.join(HOME, ".claude", "agent-worktrees", "hooks");
const SETTINGS_PATH = path.join(HOME, ".claude", "settings.json");
const EMITTER = "agent-worktrees-emit.mjs";

/** A Claude Code hook this extension manages. Every hook runs the same emitter;
 *  they differ only by the event (and an optional tool matcher). */
export interface HookSpec {
  event: string;
  /** human label shown on the consent page (= the Claude Code event name) */
  label: string;
  /** why the extension needs this event, shown on the consent page */
  description: string;
  /** optional tool matcher so the hook only fires for the tools it cares about */
  matcher?: string;
}

export const HOOKS: HookSpec[] = [
  {
    event: "SessionStart",
    label: "SessionStart",
    description:
      "Detects when a Claude session starts in a worktree so it shows up as an agent (idle).",
  },
  {
    event: "UserPromptSubmit",
    label: "UserPromptSubmit",
    description:
      "Marks an agent Active the moment you send it a prompt, without waiting for its first tool call.",
  },
  {
    event: "PreToolUse",
    matcher: "*",
    label: "PreToolUse",
    description:
      "Keeps an agent marked Active while it is running tools and doing work.",
  },
  {
    event: "Notification",
    label: "Notification",
    description:
      "Marks an agent Waiting the instant it needs you — a permission prompt or a question.",
  },
  {
    event: "Stop",
    label: "Stop",
    description:
      "Marks an agent Idle when it finishes responding and is awaiting your next instruction.",
  },
  {
    event: "SessionEnd",
    label: "SessionEnd",
    description: "Removes the agent from the panel when its session exits.",
  },
];

/** The `node "<HOOKS_DIR>/<emitter>"` command every managed hook runs. */
function hookCommand(): string {
  return `node "${path.join(HOOKS_DIR, EMITTER)}"`;
}

// --- settings.json plumbing -------------------------------------------------

type HookEntry = {
  matcher?: string;
  hooks?: { type?: string; command?: string }[];
};
type Settings = { hooks?: Record<string, HookEntry[]>; [k: string]: unknown };

async function readSettings(): Promise<Settings> {
  try {
    const raw = await fs.promises.readFile(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Settings) : {};
  } catch {
    return {}; // missing or unreadable -> start fresh (write creates it)
  }
}

async function writeSettings(settings: Settings): Promise<void> {
  await fs.promises.mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
  const tmp = SETTINGS_PATH + ".agent-worktrees.tmp";
  await fs.promises.writeFile(tmp, JSON.stringify(settings, null, 2) + "\n");
  await fs.promises.rename(tmp, SETTINGS_PATH);
}

/** Our hook in an event is the one whose command runs our emitter script. */
function findHook(
  settings: Settings,
  spec: HookSpec
): { command?: string } | undefined {
  const entries = settings.hooks?.[spec.event];
  if (!Array.isArray(entries)) return undefined;
  for (const entry of entries) {
    for (const h of entry.hooks ?? []) {
      if (typeof h.command === "string" && h.command.includes(EMITTER))
        return h;
    }
  }
  return undefined;
}

function addHook(settings: Settings, spec: HookSpec, command: string): void {
  settings.hooks ??= {};
  const entry: HookEntry = spec.matcher
    ? { matcher: spec.matcher, hooks: [{ type: "command", command }] }
    : { hooks: [{ type: "command", command }] };
  (settings.hooks[spec.event] ??= []).push(entry);
}

// --- public API -------------------------------------------------------------

/** True only when every managed hook is present in global settings.json. */
export async function hooksInstalled(): Promise<boolean> {
  const settings = await readSettings();
  return HOOKS.every((spec) => !!findHook(settings, spec));
}

/** Copy the bundled emitter into the stable HOOKS_DIR, overwriting in place so
 *  updates ship a new body to the path the command already points at. */
async function ensureEmitter(context: vscode.ExtensionContext): Promise<void> {
  await fs.promises.mkdir(HOOKS_DIR, { recursive: true });
  const src = path.join(context.extensionUri.fsPath, "hooks", EMITTER);
  await fs.promises.copyFile(src, path.join(HOOKS_DIR, EMITTER));
}

/**
 * Install every managed hook into global settings.json (and repair the command
 * path of any already present). Copies the emitter to its stable location
 * first. Call only after the user has consented in the panel.
 */
export async function installHooks(
  context: vscode.ExtensionContext
): Promise<void> {
  await ensureEmitter(context);
  const settings = await readSettings();
  const command = hookCommand();
  let changed = false;
  for (const spec of HOOKS) {
    const existing = findHook(settings, spec);
    if (!existing) {
      addHook(settings, spec, command);
      changed = true;
    } else if (existing.command !== command) {
      existing.command = command; // repair a stale path after an update
      changed = true;
    }
  }
  if (changed) await writeSettings(settings);
  await fs.promises.mkdir(SESSIONS_DIR, { recursive: true });
}

/**
 * On activation, if the hooks are already installed, refresh the stable emitter
 * copy and repair any command path drift from a prior extension version. Never
 * installs anything the user has not already accepted.
 */
export async function syncHooks(
  context: vscode.ExtensionContext
): Promise<void> {
  try {
    const settings = await readSettings();
    const anyInstalled = HOOKS.some((spec) => !!findHook(settings, spec));
    if (!anyInstalled) return;
    await ensureEmitter(context);
    const command = hookCommand();
    let changed = false;
    for (const spec of HOOKS) {
      const existing = findHook(settings, spec);
      if (existing && existing.command !== command) {
        existing.command = command;
        changed = true;
      }
    }
    if (changed) await writeSettings(settings);
  } catch {
    /* best effort: a repair failure shouldn't block activation */
  }
}
