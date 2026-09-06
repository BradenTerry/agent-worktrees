"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { mergedText, newlyMerged } = require("../out/mergeNotices.js");

const pr = (number, state, autoMerge, title) => ({
  number,
  title: title || "PR " + number,
  url: "https://github.com/o/r/pull/" + number,
  state,
  autoMerge: !!autoMerge,
});
const wt = (path, p) => ({ path, name: path.split("/").pop(), pr: p });

test("an open auto-merge PR arms, and its merge announces once", () => {
  const armed = new Map();
  assert.deepStrictEqual(
    newlyMerged([wt("/w/feat", pr(7, "open", true))], armed),
    []
  );
  assert.strictEqual(armed.get("/w/feat"), 7);
  assert.deepStrictEqual(
    newlyMerged([wt("/w/feat", pr(7, "merged"))], armed),
    [{ number: 7, title: "PR 7", url: "https://github.com/o/r/pull/7", where: "feat" }]
  );
  // The poll keeps reporting it merged; nothing more is announced.
  assert.deepStrictEqual(
    newlyMerged([wt("/w/feat", pr(7, "merged"))], armed),
    []
  );
  assert.strictEqual(armed.size, 0);
});

test("a PR that is already merged on the first payload is silent", () => {
  const armed = new Map();
  assert.deepStrictEqual(
    newlyMerged([wt("/w/feat", pr(7, "merged"))], armed),
    []
  );
});

test("a PR merged without auto-merge is silent", () => {
  const armed = new Map();
  newlyMerged([wt("/w/feat", pr(7, "open", false))], armed);
  assert.strictEqual(armed.size, 0);
  assert.deepStrictEqual(
    newlyMerged([wt("/w/feat", pr(7, "merged"))], armed),
    []
  );
});

test("turning auto-merge off before the merge disarms", () => {
  const armed = new Map();
  newlyMerged([wt("/w/feat", pr(7, "open", true))], armed);
  newlyMerged([wt("/w/feat", pr(7, "open", false))], armed);
  assert.strictEqual(armed.size, 0);
  assert.deepStrictEqual(
    newlyMerged([wt("/w/feat", pr(7, "merged"))], armed),
    []
  );
});

test("closing without merging disarms silently", () => {
  const armed = new Map();
  newlyMerged([wt("/w/feat", pr(7, "open", true))], armed);
  assert.deepStrictEqual(
    newlyMerged([wt("/w/feat", pr(7, "closed"))], armed),
    []
  );
  assert.strictEqual(armed.size, 0);
});

test("a worktree that switches onto a different merged PR is silent", () => {
  const armed = new Map();
  newlyMerged([wt("/w/feat", pr(7, "open", true))], armed);
  assert.deepStrictEqual(
    newlyMerged([wt("/w/feat", pr(9, "merged"))], armed),
    []
  );
  assert.strictEqual(armed.size, 0);
});

test("losing the PR (or the worktree) drops the arming", () => {
  const armed = new Map();
  newlyMerged(
    [wt("/w/a", pr(1, "open", true)), wt("/w/b", pr(2, "open", true))],
    armed
  );
  newlyMerged([wt("/w/a", null)], armed);
  assert.strictEqual(armed.size, 0);
});

test("a draft with auto-merge on arms like an open PR", () => {
  const armed = new Map();
  newlyMerged([wt("/w/feat", pr(7, "draft", true))], armed);
  assert.strictEqual(armed.get("/w/feat"), 7);
});

test("two PRs landing on the same poll both announce", () => {
  const armed = new Map();
  newlyMerged(
    [wt("/w/a", pr(1, "open", true)), wt("/w/b", pr(2, "open", true))],
    armed
  );
  const fresh = newlyMerged(
    [wt("/w/a", pr(1, "merged")), wt("/w/b", pr(2, "merged"))],
    armed
  );
  assert.deepStrictEqual(
    fresh.map((p) => p.number),
    [1, 2]
  );
});

test("mergedText names the number, the worktree and the title", () => {
  assert.strictEqual(
    mergedText({ number: 7, title: "Fix the race", url: "", where: "feat" }),
    "#7 auto-merged in feat: Fix the race"
  );
  assert.strictEqual(
    mergedText({ number: 7, title: "", url: "", where: "" }),
    "#7 auto-merged"
  );
});
