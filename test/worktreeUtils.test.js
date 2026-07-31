"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const {
  countWaitingAgents,
  normalizePath,
  repoSettingsKey,
  supportsAgentCliTitle,
  worktreeDirFor,
} = require("../out/worktreeUtils.js");

test("worktreeDirFor nests under the primary's .claude/worktrees", () => {
  const primary = path.join(path.sep, "home", "me", "repo");
  assert.strictEqual(
    worktreeDirFor(primary, "feature/my-change"),
    path.join(primary, ".claude", "worktrees", "feature-my-change")
  );
});

test("worktreeDirFor sanitizes path-hostile branch names", () => {
  const primary = path.join(path.sep, "repo");
  const base = path.join(primary, ".claude", "worktrees");
  assert.strictEqual(
    worktreeDirFor(primary, "  fix/v1.2 (hot) "),
    path.join(base, "fix-v1.2-hot-")
  );
  assert.strictEqual(
    worktreeDirFor(primary, "a\\b:c"),
    path.join(base, "a-b-c")
  );
});

test("normalizePath strips trailing slashes", () => {
  // Assert the behavior (trailing separators removed, idempotent) without
  // hardcoding a POSIX result: path.resolve is platform-specific, so on Windows
  // "/a/b" canonicalizes to a drive-rooted, backslash path.
  const canonical = normalizePath("/a/b");
  assert.strictEqual(normalizePath("/a/b/"), canonical);
  assert.strictEqual(normalizePath("/a/b///"), canonical);
  assert.strictEqual(normalizePath(canonical + path.sep), canonical);
  assert.ok(!/[\\/]$/.test(canonical), "no trailing separator remains");
  assert.strictEqual(normalizePath(canonical), canonical, "idempotent");
});

test("countWaitingAgents sums waiting agents across worktrees", () => {
  const wt = (...statuses) => ({ agents: statuses.map((status) => ({ status })) });
  assert.strictEqual(countWaitingAgents([]), 0);
  assert.strictEqual(countWaitingAgents([wt(), wt("active", "idle")]), 0);
  assert.strictEqual(
    countWaitingAgents([wt("waiting", "active"), wt(), wt("waiting", "waiting")]),
    3
  );
});

// Windows-only: git emits an uppercase drive letter ("C:\\repo") while VS Code's
// Uri.fsPath lowercases it ("c:\\repo"). normalizePath must canonicalize the
// drive so the two compare equal, otherwise the Source Control scope button
// never matches (won't highlight, won't reduce to the single worktree).
test("normalizePath lowercases the drive letter (Windows)", { skip: process.platform !== "win32" }, () => {
  assert.strictEqual(normalizePath("C:\\repo\\feature"), "c:\\repo\\feature");
  assert.strictEqual(normalizePath("C:\\repo"), normalizePath("c:\\repo"));
});

// Whether an agent terminal is left unnamed (so Claude Code's own OSC title
// names the tab) or named by us and renamed. The cutoff is VS Code 1.117, where
// the terminal label computer began switching the title template to
// ${sequence} for a detected agent CLI. Same rule on every OS: the escape
// sequence is the only cross-platform signal VS Code has, since every agent CLI
// runs as `node`.
test("supportsAgentCliTitle gates on VS Code 1.117 and the opt-out", () => {
  assert.strictEqual(supportsAgentCliTitle("1.117.0", true), true);
  assert.strictEqual(supportsAgentCliTitle("1.130.2", true), true);
  assert.strictEqual(supportsAgentCliTitle("2.0.0", true), true);
  // Below the cutoff the template stays ${process} and an unnamed tab would
  // read "node", so the extension has to name the terminal itself.
  assert.strictEqual(supportsAgentCliTitle("1.116.4", true), false);
  assert.strictEqual(supportsAgentCliTitle("1.90.0", true), false);
  assert.strictEqual(supportsAgentCliTitle("0.999.0", true), false);
  // terminal.integrated.tabs.allowAgentCliTitle turned off: VS Code ignores the
  // sequence, so we name the tab even on a new host.
  assert.strictEqual(supportsAgentCliTitle("1.130.2", false), false);
});

test("supportsAgentCliTitle handles insider and malformed versions", () => {
  // vscode.version carries a suffix on Insiders builds.
  assert.strictEqual(supportsAgentCliTitle("1.117.0-insider", true), true);
  assert.strictEqual(supportsAgentCliTitle("1.116.0-insider", true), false);
  // Anything unparseable falls back to naming the terminal ourselves, which
  // works on every version.
  assert.strictEqual(supportsAgentCliTitle("", true), false);
  assert.strictEqual(supportsAgentCliTitle("nonsense", true), false);
  assert.strictEqual(supportsAgentCliTitle("1", true), false);
});

// Per-repo settings (the linked-files list) are stored under the primary
// worktree's path. In a window with a linked worktree open, the repo root is
// that worktree, so keying by it would read an entry nothing ever wrote and the
// panel would show an empty list for a repo that has files configured.
test("repoSettingsKey keys off the primary worktree, not the open folder", () => {
  const primary = path.join(path.sep, "repo");
  const linked = path.join(primary, ".claude", "worktrees", "feature");
  const worktrees = [
    { path: linked, isPrimary: false },
    { path: primary, isPrimary: true },
  ];
  // Panel opened in the linked worktree: repoRoot is the worktree itself.
  assert.strictEqual(repoSettingsKey(linked, worktrees), primary);
  // Panel opened in the primary worktree: same key, so both windows agree.
  assert.strictEqual(repoSettingsKey(primary, worktrees), primary);
});

test("repoSettingsKey falls back to the repo root without a primary", () => {
  const root = path.join(path.sep, "repo");
  // `git worktree list` failed, so the gather has no worktrees to name a
  // primary from; the open folder's root is the best (and, for a plain
  // single-worktree repo, correct) key.
  assert.strictEqual(repoSettingsKey(root, []), root);
  assert.strictEqual(
    repoSettingsKey(root, [{ path: root, isPrimary: false }]),
    root
  );
  assert.strictEqual(repoSettingsKey(undefined, []), undefined);
});
