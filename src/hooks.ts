import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { pruneOurHooks, Settings } from "./hookCleanup";

/**
 * Removing the hooks this extension used to install.
 *
 * Agent status came from Claude Code hooks: an emitter script wired to ten
 * events, writing a state file per session. Claude Code now records what each
 * session is doing itself, in its own registry (see sessionRegistry), so none of
 * that is needed - and everything about it was a cost the user paid. It edited
 * their global settings.json, which is why it needed a consent page; it spawned
 * a process per event, on the tool-call hot path; and it needed an interpreter
 * to spawn.
 *
 * All that is left is taking it back out. This runs on activation, is
 * idempotent, and touches nothing it did not put there: hook entries whose
 * command names our emitter, the copies of the emitter and its launcher in
 * global storage, and the state files they wrote.
 */

const HOME = os.homedir();
const SETTINGS_PATH = path.join(HOME, ".claude", "settings.json");
/** Where the emitter and session data lived before they moved into global
 *  storage. Older installs wrote here. */
const LEGACY_DIR = path.join(HOME, ".claude", "agent-worktrees");

/** Global-storage directories the hooks used: the emitter plus its launcher,
 *  and the per-session state files they wrote. */
function ourDirs(context: vscode.ExtensionContext): string[] {
  const base = context.globalStorageUri.fsPath;
  return [path.join(base, "hooks"), path.join(base, "sessions")];
}

/**
 * Whether this host may write the user's global ~/.claude/settings.json.
 *
 * False in the extension-host test runner. `@vscode/test-cli` boots VS Code with
 * a throwaway `--user-data-dir`, but settings.json is NOT sandboxed with it: it
 * is the real user's file, shared by every Claude session on the machine. A test
 * run must not edit it, in either direction - removing hooks from a developer's
 * real settings as a side effect of `npm run test:integration` would be exactly
 * as unwelcome as adding them once was.
 */
export function managesUserSettings(mode: vscode.ExtensionMode): boolean {
  return mode !== vscode.ExtensionMode.Test;
}

async function readSettings(): Promise<Settings | undefined> {
  try {
    const raw = await fs.promises.readFile(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Settings) : undefined;
  } catch {
    return undefined; // missing or unreadable: nothing of ours to remove
  }
}

async function writeSettings(settings: Settings): Promise<void> {
  // pid-suffixed so two VS Code windows activating at once never interleave
  // writes/renames on the same tmp file.
  const tmp = `${SETTINGS_PATH}.agent-worktrees.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(settings, null, 2) + "\n");
  await fs.promises.rename(tmp, SETTINGS_PATH);
}

/**
 * Take out everything the hook-based status pipeline left behind: our entries in
 * the user's global settings.json, the emitter and launcher in global storage,
 * the state files they wrote, and the pre-global-storage directory.
 *
 * Best effort throughout. A failure here costs nothing at runtime - the panel
 * reads Claude's registry either way - so it must never block activation. An
 * emitter left on disk with no hook entry pointing at it is inert.
 */
export async function removeManagedHooks(
  context: vscode.ExtensionContext
): Promise<void> {
  try {
    if (managesUserSettings(context.extensionMode)) {
      const settings = await readSettings();
      if (settings && pruneOurHooks(settings)) await writeSettings(settings);
    }
    for (const dir of [...ourDirs(context), LEGACY_DIR]) {
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  } catch {
    /* best effort: leftovers are inert, and this must not block activation */
  }
}
