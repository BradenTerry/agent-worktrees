import * as assert from "assert";
import * as vscode from "vscode";

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
});
