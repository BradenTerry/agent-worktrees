"use strict";
const test = require("node:test");
const assert = require("node:assert");
const {
  parseLocalBranchRefs,
  parseRemoteBranchRefs,
  parseAheadBehindByRef,
} = require("../out/git.js");

// The local for-each-ref format is
//   %(refname:short)%00%(worktreepath)%00%(upstream:track,nobracket)%00%(upstream:short)%00%(committerdate:iso8601-strict)%00%(committername)%00%(committeremail)
// Build a record the way git emits it (NUL between the seven fields). The last
// three (date/name/email) are optional in these helpers since most cases don't
// assert on them.
function localLine(name, worktreePath, track, upstream, date, user, email) {
  return [
    name,
    worktreePath || "",
    track || "",
    upstream || "",
    date || "",
    user || "",
    email || "",
  ].join("\0");
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

test("parseLocalBranchRefs: captures tip committer date and user", () => {
  const { branches } = parseLocalBranchRefs(
    localLine(
      "feat",
      "",
      "",
      "origin/feat",
      "2026-06-20T10:00:00+00:00",
      "Braden Terry",
      "<bterry18@outlook.com>"
    )
  );
  assert.strictEqual(branches[0].updatedAt, "2026-06-20T10:00:00+00:00");
  assert.strictEqual(branches[0].lastUser, "Braden Terry");
  assert.strictEqual(branches[0].lastEmail, "<bterry18@outlook.com>");
});

// The remote for-each-ref format is
//   %(refname)%00%(committerdate:iso8601-strict)%00%(committername)%00%(committeremail)
function remoteLine(ref, date, user, email) {
  return [ref, date || "", user || "", email || ""].join("\0");
}

test("parseRemoteBranchRefs: full refnames to short names + meta, excluding HEAD", () => {
  const out = [
    remoteLine("refs/remotes/origin/main", "2026-06-21T09:00:00+00:00", "Lin H", "<lin@x>"),
    remoteLine("refs/remotes/origin/feature/x", "2026-06-19T09:00:00+00:00", "Okafor", "<ok@x>"),
    remoteLine("refs/remotes/origin/HEAD"), // symbolic alias, must be excluded
  ].join("\n");
  const { names, meta } = parseRemoteBranchRefs(out);
  assert.ok(names.has("main"));
  assert.ok(names.has("feature/x"));
  assert.ok(!names.has("HEAD"));
  assert.strictEqual(names.size, 2);
  assert.strictEqual(meta.get("main").lastUser, "Lin H");
  assert.strictEqual(meta.get("feature/x").updatedAt, "2026-06-19T09:00:00+00:00");
});

test("parseRemoteBranchRefs: tolerates CRLF and blank lines", () => {
  const { names } = parseRemoteBranchRefs(
    remoteLine("refs/remotes/origin/main") +
      "\r\n\r\n" +
      remoteLine("refs/remotes/origin/dev") +
      "\r\n"
  );
  assert.deepStrictEqual([...names].sort(), ["dev", "main"]);
});

// The batched ahead/behind format is %(refname)%00%(ahead-behind:base); the atom
// prints "<ahead> <behind>".
function abLine(ref, ahead, behind) {
  return ref + "\0" + ahead + " " + behind;
}

test("parseAheadBehindByRef: maps full refname to ahead/behind", () => {
  const out = [
    abLine("refs/heads/feature", 2, 1),
    abLine("refs/remotes/origin/topic", 0, 5),
  ].join("\n");
  const map = parseAheadBehindByRef(out);
  assert.deepStrictEqual(map.get("refs/heads/feature"), { ahead: 2, behind: 0 + 1 });
  assert.deepStrictEqual(map.get("refs/remotes/origin/topic"), {
    ahead: 0,
    behind: 5,
  });
});

test("parseAheadBehindByRef: skips refs with no counts (no common ancestor)", () => {
  // A ref unrelated to the base prints an empty ahead-behind field; such a line
  // must be skipped so the caller falls back to a per-branch rev-list.
  const out = [
    abLine("refs/heads/main", 0, 0),
    "refs/heads/orphan\0", // empty field
  ].join("\n");
  const map = parseAheadBehindByRef(out);
  assert.deepStrictEqual(map.get("refs/heads/main"), { ahead: 0, behind: 0 });
  assert.strictEqual(map.has("refs/heads/orphan"), false);
});

test("parseAheadBehindByRef: tolerates CRLF", () => {
  const map = parseAheadBehindByRef(
    abLine("refs/heads/a", 1, 2) + "\r\n" + abLine("refs/heads/b", 3, 4) + "\r\n"
  );
  assert.deepStrictEqual(map.get("refs/heads/a"), { ahead: 1, behind: 2 });
  assert.deepStrictEqual(map.get("refs/heads/b"), { ahead: 3, behind: 4 });
});
