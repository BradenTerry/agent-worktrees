"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { parseWorktreeFiles, WORKTREE_FILE_CAP } = require("../out/git.js");

/** Build the NUL-terminated form `git ls-files -z` emits. */
const z = (...entries) => entries.map((e) => e + "\0").join("");

test("parseWorktreeFiles reads NUL-separated entries, sorted", () => {
  const out = parseWorktreeFiles(z("src/git.ts", "README.md", "media/panel.js"));
  assert.deepStrictEqual(out, {
    files: ["media/panel.js", "README.md", "src/git.ts"],
    truncated: false,
  });
});

test("parseWorktreeFiles sorts case-insensitively, exact path breaking ties", () => {
  const out = parseWorktreeFiles(z("b.md", "Apple.md", "apple.md", "A.md"));
  assert.deepStrictEqual(out.files, ["A.md", "Apple.md", "apple.md", "b.md"]);
});

test("parseWorktreeFiles dedupes an unmerged path listed once per stage", () => {
  // `ls-files --cached` emits a conflicted path up to three times; the picker
  // must show it once.
  const out = parseWorktreeFiles(z("src/git.ts", "src/git.ts", "src/git.ts"));
  assert.deepStrictEqual(out.files, ["src/git.ts"]);
});

test("parseWorktreeFiles normalises backslashes to forward slashes", () => {
  const out = parseWorktreeFiles(z("src\\test\\integration\\smoke.test.ts"));
  assert.deepStrictEqual(out.files, ["src/test/integration/smoke.test.ts"]);
});

test("parseWorktreeFiles keeps a filename containing spaces intact", () => {
  const out = parseWorktreeFiles(z("docs/my design notes.md"));
  assert.deepStrictEqual(out.files, ["docs/my design notes.md"]);
});

test("parseWorktreeFiles tolerates empty output and stray separators", () => {
  assert.deepStrictEqual(parseWorktreeFiles(""), {
    files: [],
    truncated: false,
  });
  assert.deepStrictEqual(parseWorktreeFiles("\0\0"), {
    files: [],
    truncated: false,
  });
});

test("parseWorktreeFiles caps the list and reports the truncation", () => {
  const many = z(...Array.from({ length: 12 }, (_, i) => `f${i}.txt`));
  const out = parseWorktreeFiles(many, 5);
  assert.strictEqual(out.files.length, 5);
  assert.strictEqual(out.truncated, true);
});

test("parseWorktreeFiles reports no truncation exactly at the cap", () => {
  const exact = z(...Array.from({ length: 5 }, (_, i) => `f${i}.txt`));
  const out = parseWorktreeFiles(exact, 5);
  assert.strictEqual(out.files.length, 5);
  assert.strictEqual(out.truncated, false);
});

test("parseWorktreeFiles defaults to the shipped cap", () => {
  assert.strictEqual(WORKTREE_FILE_CAP, 20000);
  const out = parseWorktreeFiles(z("a.txt"));
  assert.strictEqual(out.truncated, false);
});
