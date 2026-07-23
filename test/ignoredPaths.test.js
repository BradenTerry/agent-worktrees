"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { parseIgnoredPaths } = require("../out/git.js");

/** Build the NUL-terminated form `git ls-files -z` emits. */
const z = (...entries) => entries.map((e) => e + "\0").join("");

test("parseIgnoredPaths reads NUL-separated entries", () => {
  const out = parseIgnoredPaths(z("appsettings.local.json", ".env"));
  assert.deepStrictEqual(out, [
    { path: "appsettings.local.json", isDir: false },
    { path: ".env", isDir: false },
  ]);
});

test("parseIgnoredPaths flags a collapsed directory and drops its slash", () => {
  const out = parseIgnoredPaths(z("node_modules/", "bin/", "a.txt"));
  assert.deepStrictEqual(out, [
    { path: "node_modules", isDir: true },
    { path: "bin", isDir: true },
    { path: "a.txt", isDir: false },
  ]);
});

test("parseIgnoredPaths keeps nested paths repo-relative", () => {
  const out = parseIgnoredPaths(z("tests/IntegrationTests/appsettings.local.json"));
  assert.deepStrictEqual(out, [
    { path: "tests/IntegrationTests/appsettings.local.json", isDir: false },
  ]);
});

test("parseIgnoredPaths never offers the panel's own worktree storage", () => {
  // Linking a worktree into a worktree would make a recursive link.
  const out = parseIgnoredPaths(
    z(".claude/worktrees/", ".claude/worktrees/feature-x/", "keep.json")
  );
  assert.deepStrictEqual(out, [{ path: "keep.json", isDir: false }]);
});

test("parseIgnoredPaths drops a collapsed .claude dir but keeps files under it", () => {
  assert.deepStrictEqual(parseIgnoredPaths(z(".claude/")), []);
  assert.deepStrictEqual(parseIgnoredPaths(z(".claude/settings.local.json")), [
    { path: ".claude/settings.local.json", isDir: false },
  ]);
});

test("parseIgnoredPaths excludes git's own storage", () => {
  const out = parseIgnoredPaths(z(".git/", ".git/config", "keep"));
  assert.deepStrictEqual(out, [{ path: "keep", isDir: false }]);
});

test("parseIgnoredPaths tolerates empty output and stray separators", () => {
  assert.deepStrictEqual(parseIgnoredPaths(""), []);
  assert.deepStrictEqual(parseIgnoredPaths("\0\0"), []);
});

test("parseIgnoredPaths keeps a filename containing spaces intact", () => {
  const out = parseIgnoredPaths(z("config/my local settings.json"));
  assert.deepStrictEqual(out, [
    { path: "config/my local settings.json", isDir: false },
  ]);
});
