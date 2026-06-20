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
