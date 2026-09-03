"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const {
  countWaitingAgents,
  normalizePath,
  pathKey,
  repoSettingsKey,
  samePathKey,
  supportsAgentCliTitle,
  worktreeDirFor,
  worktreesNeedingLinks,
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

// The panel compares paths that arrive from three different places: `git
// worktree list` (the case on disk), Claude's session registry (the case the
// user typed to cd there) and the Git extension's rootUri (the workspace
// folder's case). On a case-insensitive filesystem those are the same
// directory, and comparing them as plain strings was a silent miss every time
// they differed - an agent landing on no card, a Source Control button that
// never lit up.
const CASE_FOLDING = process.platform === "win32" || process.platform === "darwin";

test(
  "pathKey folds case where the filesystem does",
  { skip: !CASE_FOLDING },
  () => {
    assert.strictEqual(
      pathKey("/Repo/Feature-Work"),
      pathKey("/repo/feature-work"),
      "the same directory reached by two spellings is one key"
    );
    assert.ok(samePathKey("/Users/B/Code/Repo", "/users/b/code/repo"));
  }
);

test(
  "pathKey does not fold case where the filesystem does not",
  { skip: CASE_FOLDING },
  () => {
    // On Linux these really are two different directories, and treating them
    // as one would put an agent on the wrong card.
    assert.notStrictEqual(pathKey("/repo/Feature"), pathKey("/repo/feature"));
  }
);

test("pathKey still canonicalizes what normalizePath does", () => {
  assert.strictEqual(pathKey("/repo/feature/"), pathKey("/repo/feature"));
});

test("normalizePath keeps case, because its result is used as a real path", () => {
  // pathKey exists as a separate function precisely so this stays true: a
  // linked file's stored relative entry is derived from normalizePath, and
  // lowercasing it would break on a case-sensitive volume and read wrong in
  // the settings list.
  const p = path.join(path.sep, "Repo", "AppSettings.Development.json");
  assert.ok(normalizePath(p).includes("AppSettings.Development.json"));
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

// The linked-files sweep. A worktree can appear without the panel having made
// it - New Agent & Worktree hands creation to `claude -w`, a subagent isolates
// itself in one, `git worktree add` runs in a terminal - and those are exactly
// the ones that used to be left without the files.
test("worktreesNeedingLinks picks up worktrees the panel did not create", () => {
  const primary = path.join(path.sep, "repo");
  const base = path.join(primary, ".claude", "worktrees");
  const fromPanel = path.join(base, "feature");
  const fromClaude = path.join(base, "claude-made");
  const todo = worktreesNeedingLinks(
    primary,
    [primary, fromPanel, fromClaude],
    new Set([normalizePath(fromPanel)])
  );
  // The primary holds the real files, and fromPanel was linked at creation.
  assert.deepStrictEqual(todo, [fromClaude]);
});

test("worktreesNeedingLinks compares paths canonically", () => {
  const primary = path.join(path.sep, "repo");
  const wt = path.join(primary, ".claude", "worktrees", "feature");
  // A trailing separator (or any other non-canonical spelling) must not make
  // the primary look like a worktree needing links, nor hide an already-linked
  // one and link it a second time.
  assert.deepStrictEqual(
    worktreesNeedingLinks(primary + path.sep, [primary, wt], new Set()),
    [wt]
  );
  assert.deepStrictEqual(
    worktreesNeedingLinks(primary, [wt + path.sep], new Set([normalizePath(wt)])),
    []
  );
});

test("worktreesNeedingLinks is empty for a repo with only its primary", () => {
  const primary = path.join(path.sep, "repo");
  assert.deepStrictEqual(worktreesNeedingLinks(primary, [primary], new Set()), []);
  assert.deepStrictEqual(worktreesNeedingLinks(primary, [], new Set()), []);
});
