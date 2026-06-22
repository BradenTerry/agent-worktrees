"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { normalizePath } = require("../out/worktreeUtils.js");

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

// Windows-only: git emits an uppercase drive letter ("C:\\repo") while VS Code's
// Uri.fsPath lowercases it ("c:\\repo"). normalizePath must canonicalize the
// drive so the two compare equal, otherwise the Source Control scope button
// never matches (won't highlight, won't reduce to the single worktree).
test("normalizePath lowercases the drive letter (Windows)", { skip: process.platform !== "win32" }, () => {
  assert.strictEqual(normalizePath("C:\\repo\\feature"), "c:\\repo\\feature");
  assert.strictEqual(normalizePath("C:\\repo"), normalizePath("c:\\repo"));
});
