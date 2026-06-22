"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { parseLocalBranchRefs, parseOriginNames } = require("../out/git.js");

// The local for-each-ref format is
//   %(refname:short)%00%(worktreepath)%00%(upstream:track,nobracket)%00%(upstream:short)
// Build a record the way git emits it (NUL between the four fields).
function localLine(name, worktreePath, track, upstream) {
  return [name, worktreePath || "", track || "", upstream || ""].join("\0");
}

test("parseLocalBranchRefs: plain local branch, no worktree, no upstream", () => {
  const { branches, upstreamOf } = parseLocalBranchRefs(localLine("feature"));
  assert.strictEqual(branches.length, 1);
  const b = branches[0];
  assert.strictEqual(b.name, "feature");
  assert.strictEqual(b.hasWorktree, false);
  assert.strictEqual(b.worktreePath, undefined);
  assert.strictEqual(b.ahead, 0);
  assert.strictEqual(b.behind, 0);
  assert.strictEqual(upstreamOf.has("feature"), false);
});

test("parseLocalBranchRefs: worktree, upstream, and ahead/behind from track", () => {
  const out = [
    localLine("main", "/repo", "", "origin/main"),
    localLine("feat", "/repo/.wt/feat", "ahead 2, behind 1", "origin/feat"),
  ].join("\n");
  const { branches, upstreamOf } = parseLocalBranchRefs(out);
  const byName = Object.fromEntries(branches.map((b) => [b.name, b]));

  assert.strictEqual(byName.main.hasWorktree, true);
  assert.strictEqual(byName.main.worktreePath, "/repo");
  assert.strictEqual(upstreamOf.get("main"), "origin/main");

  assert.strictEqual(byName.feat.ahead, 2);
  assert.strictEqual(byName.feat.behind, 1);
  assert.strictEqual(upstreamOf.get("feat"), "origin/feat");
});

test("parseLocalBranchRefs: tolerates CRLF line endings (Windows)", () => {
  // git emits LF, but a stray \r (autocrlf, a wrapper) must not cling to the
  // last field or break the trailing-newline handling.
  const out =
    localLine("main", "", "", "origin/main") +
    "\r\n" +
    localLine("topic", "", "ahead 1", "") +
    "\r\n";
  const { branches, upstreamOf } = parseLocalBranchRefs(out);
  const byName = Object.fromEntries(branches.map((b) => [b.name, b]));
  assert.deepStrictEqual(
    branches.map((b) => b.name).sort(),
    ["main", "topic"]
  );
  // The \r must not survive on the last field.
  assert.strictEqual(upstreamOf.get("main"), "origin/main");
  assert.strictEqual(byName.topic.ahead, 1);
});

test("parseLocalBranchRefs: blank and empty input yield no branches", () => {
  assert.deepStrictEqual(parseLocalBranchRefs("").branches, []);
  assert.deepStrictEqual(parseLocalBranchRefs("\n\n").branches, []);
  assert.deepStrictEqual(parseLocalBranchRefs("\r\n").branches, []);
});

test("parseLocalBranchRefs: branch name with a slash is preserved", () => {
  const { branches } = parseLocalBranchRefs(
    localLine("feature/login", "", "", "")
  );
  assert.strictEqual(branches[0].name, "feature/login");
});

test("parseOriginNames: full refnames to short names, excluding HEAD", () => {
  const out = [
    "refs/remotes/origin/main",
    "refs/remotes/origin/feature/x",
    "refs/remotes/origin/HEAD", // symbolic alias, must be excluded
  ].join("\n");
  const names = parseOriginNames(out);
  assert.ok(names.has("main"));
  assert.ok(names.has("feature/x"));
  assert.ok(!names.has("HEAD"));
  assert.strictEqual(names.size, 2);
});

test("parseOriginNames: tolerates CRLF and blank lines", () => {
  const names = parseOriginNames(
    "refs/remotes/origin/main\r\n\r\nrefs/remotes/origin/dev\r\n"
  );
  assert.deepStrictEqual([...names].sort(), ["dev", "main"]);
});
