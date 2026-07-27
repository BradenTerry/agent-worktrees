import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { spawnSync } from "child_process";
import { supportsAgentCliTitle } from "../../worktreeUtils";
import { managesUserSettings } from "../../hooks";
import {
  electronEnableArgs,
  launcherName,
  launcherScript,
} from "../../nodeRuntime";

/**
 * Extension-host smoke tests. These run inside a real VS Code (via
 * @vscode/test-electron) on the actual OS, so on the CI matrix they execute on
 * Windows, macOS, and Linux. They catch the class of failures that never show up
 * in the plain `node --test` suite: activation errors, a missing `require` at
 * load time, command-registration regressions, and the built-in Git extension
 * API being unavailable — i.e. the things that made the panel silently fail on
 * Windows.
 */
suite("Agent Worktrees extension host", () => {
  test("activates without throwing", async () => {
    const ext = vscode.extensions.getExtension(
      "bradenterry.agent-worktrees"
    );
    assert.ok(ext, "the extension is installed in the test host");
    await ext.activate();
    assert.strictEqual(ext.isActive, true, "the extension activated");
  });

  test("activating in a test host leaves global settings.json alone", async () => {
    // The test host runs with a throwaway --user-data-dir, so its globalStorage
    // (and the emitter's --dir) live under it. ~/.claude/settings.json is NOT
    // sandboxed with it: it is the real user's file, shared by every Claude
    // session on the machine. If activation repaired the hook command from
    // here, every session would write its state into this run's scratch dir and
    // the installed extension's panel would stop seeing agents entirely.
    assert.strictEqual(
      managesUserSettings(vscode.ExtensionMode.Test),
      false,
      "a test host must not write the user's global settings"
    );
    assert.strictEqual(
      managesUserSettings(vscode.ExtensionMode.Production),
      true,
      "a real install still installs and repairs its hooks"
    );

    // And prove it end to end: this suite activated the extension above, so if
    // the guard were missing settings.json would already name this host's
    // scratch storage.
    const ext = vscode.extensions.getExtension("bradenterry.agent-worktrees");
    await ext?.activate();
    const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
    let raw: string;
    try {
      raw = await fs.promises.readFile(settingsPath, "utf8");
    } catch {
      return; // no global settings on this machine (CI): nothing to clobber
    }
    assert.ok(
      !raw.includes(".vscode-test"),
      `${settingsPath} points a hook into the test host's user-data dir`
    );
  });

  test("the hook launcher runs a script on this host's own Node", () => {
    // The fallback that makes `node` optional rests on two things the unit
    // suite cannot check: that this host's executable behaves as Node under
    // ELECTRON_RUN_AS_NODE, and that the generated launcher is runnable by the
    // shell Claude Code spawns hooks with (cmd.exe on Windows, sh elsewhere).
    // Here process.execPath is the real VS Code binary, on the real OS.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "awt-launcher-"));
    try {
      const probe = path.join(dir, "probe.mjs");
      fs.writeFileSync(probe, "console.log(JSON.stringify(process.argv.slice(2)));\n");
      const file = path.join(dir, launcherName(process.platform));
      const enableArgs = electronEnableArgs(process.versions);
      fs.writeFileSync(
        file,
        launcherScript(
          process.platform,
          { exec: process.execPath, viaElectron: true, enableArgs },
          probe
        ),
        { mode: 0o755 }
      );

      const stateDir = path.join(dir, "session state");
      const win = process.platform === "win32";
      const quote = (v: string) => (win ? `"${v}"` : v);
      const res = spawnSync(quote(file), ["--dir", quote(stateDir)], {
        encoding: "utf8",
        shell: win, // node refuses to spawn a .cmd without a shell
      });

      assert.strictEqual(res.status, 0, `launcher failed: ${res.stderr}`);
      // Claude Code reports any hook stderr as an error in the session, so the
      // fallback interpreter has to start silently.
      assert.strictEqual(res.stderr, "", "the launcher wrote to stderr");
      assert.deepStrictEqual(JSON.parse(res.stdout), [
        ...enableArgs,
        "--dir",
        stateDir,
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("registers its commands", async () => {
    const ext = vscode.extensions.getExtension(
      "bradenterry.agent-worktrees"
    );
    await ext?.activate();
    const cmds = await vscode.commands.getCommands(true);
    for (const id of [
      "worktreeView.refresh",
      "worktreeView.newWorktree",
      "worktreeView.settings",
      "worktreeView.toggleTrace",
      "worktreeView.showLog",
    ]) {
      assert.ok(cmds.includes(id), `command not registered: ${id}`);
    }
  });

  test("can obtain the built-in Git extension API", async () => {
    // The panel reads worktree status and drives the Source Control scope through
    // this API; if it is unavailable the panel degrades, so assert it is here.
    const git = vscode.extensions.getExtension("vscode.git");
    assert.ok(git, "the built-in Git extension is present");
    const exports = git.isActive ? git.exports : await git.activate();
    const api = exports.getAPI(1);
    assert.ok(api, "obtained Git API v1");
    assert.ok(Array.isArray(api.repositories), "repositories is an array");
  });

  test("the agent-CLI terminal title setting matches our version cutoff", () => {
    // Agent terminals are left unnamed so Claude Code's own OSC title names the
    // tab; that only works from VS Code 1.117, where the terminal label computer
    // began honouring an agent CLI's title sequence, gated on
    // terminal.integrated.tabs.allowAgentCliTitle. supportsAgentCliTitle encodes
    // that cutoff, and a wrong cutoff is invisible in the unit suite because it
    // only compares strings. Assert against the *real* host on every OS in the
    // matrix: the setting exists exactly when we claim the behavior does.
    const declared = supportsAgentCliTitle(vscode.version, true);
    const setting = vscode.workspace
      .getConfiguration()
      .inspect<boolean>("terminal.integrated.tabs.allowAgentCliTitle");
    assert.strictEqual(
      setting?.defaultValue !== undefined,
      declared,
      `VS Code ${vscode.version}: supportsAgentCliTitle says ${declared}, but ` +
        `terminal.integrated.tabs.allowAgentCliTitle is ` +
        `${setting?.defaultValue === undefined ? "absent" : "present"}`
    );
    if (declared) {
      assert.strictEqual(
        setting?.defaultValue,
        true,
        "the setting still defaults to on, so agent terminals get their title " +
          "from the sequence without the user configuring anything"
      );
    }
  });

  test("an unnamed agent terminal keeps the launch env we key sessions by", () => {
    // The rename path is gone, so the session id stamped in the creation env is
    // the only link left between a panel row and its terminal (reclaimTerminal
    // re-links restored terminals through it). Windows env vars are
    // case-insensitive, so assert the round-trip on the real host rather than
    // assuming the key survives verbatim.
    const terminal = vscode.window.createTerminal({
      cwd: __dirname,
      env: { AGENT_WORKTREES_SID: "smoke-test-session" },
    });
    try {
      const opts = terminal.creationOptions as vscode.TerminalOptions;
      assert.strictEqual(opts.name, undefined, "no static API title is set");
      assert.strictEqual(opts.env?.AGENT_WORKTREES_SID, "smoke-test-session");
    } finally {
      terminal.dispose();
    }
  });
});
