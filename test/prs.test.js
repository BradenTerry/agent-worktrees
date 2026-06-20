"use strict";
const test = require("node:test");
const assert = require("node:assert");
const {
  prState,
  rollupChecks,
  reviewSummary,
  mapMergeState,
} = require("../out/github.js");
const { parseGitHubRemote } = require("../out/git.js");

test("prState: merged wins over everything", () => {
  assert.strictEqual(
    prState({ state: "closed", merged_at: "2024-01-01", draft: true }),
    "merged"
  );
});

test("prState: closed without merge is closed", () => {
  assert.strictEqual(prState({ state: "closed", merged_at: null }), "closed");
});

test("prState: open draft is draft, else open", () => {
  assert.strictEqual(prState({ state: "open", draft: true }), "draft");
  assert.strictEqual(prState({ state: "open" }), "open");
});

test("mapMergeState: behind is the out-of-date flag", () => {
  assert.strictEqual(mapMergeState("BEHIND"), "behind");
  assert.strictEqual(mapMergeState("behind"), "behind");
});

test("mapMergeState: known states pass through lowercased", () => {
  assert.strictEqual(mapMergeState("BLOCKED"), "blocked");
  assert.strictEqual(mapMergeState("clean"), "clean");
  assert.strictEqual(mapMergeState("DIRTY"), "dirty");
});

test("mapMergeState: unknown/missing falls back to unknown", () => {
  assert.strictEqual(mapMergeState(undefined), "unknown");
  assert.strictEqual(mapMergeState(""), "unknown");
  assert.strictEqual(mapMergeState("something-new"), "unknown");
});

test("rollupChecks: empty is none", () => {
  const r = rollupChecks(undefined, undefined);
  assert.strictEqual(r.state, "none");
  assert.deepStrictEqual([r.pass, r.fail, r.pending], [0, 0, 0]);
});

test("rollupChecks: all successful conclusions pass", () => {
  const r = rollupChecks(
    [
      { status: "completed", conclusion: "success" },
      { status: "completed", conclusion: "skipped" },
      { status: "completed", conclusion: "neutral" },
    ],
    undefined
  );
  assert.strictEqual(r.state, "pass");
  assert.strictEqual(r.pass, 3);
});

test("rollupChecks: any failure makes the rollup fail", () => {
  const r = rollupChecks(
    [
      { status: "completed", conclusion: "success" },
      { status: "completed", conclusion: "failure" },
      { status: "in_progress", conclusion: null },
    ],
    undefined
  );
  assert.strictEqual(r.state, "fail");
  assert.strictEqual(r.fail, 1);
  assert.strictEqual(r.pending, 1);
  assert.strictEqual(r.pass, 1);
});

test("rollupChecks: running checks (no failure) are pending", () => {
  const r = rollupChecks(
    [{ status: "queued", conclusion: null }],
    undefined
  );
  assert.strictEqual(r.state, "pending");
  assert.strictEqual(r.pending, 1);
});

test("rollupChecks: folds in the legacy combined status when present", () => {
  assert.strictEqual(rollupChecks([], "failure", 1).state, "fail");
  assert.strictEqual(rollupChecks([], "pending", 2).state, "pending");
  assert.strictEqual(rollupChecks([], "success", 3).state, "pass");
});

test("rollupChecks: ignores the combined status when there are no statuses", () => {
  // GitHub reports the combined state as "pending" for a commit with zero
  // legacy statuses; folding that in would show a phantom pending check on
  // Actions-only PRs, so total_count 0 must be ignored.
  const r = rollupChecks(
    [
      { status: "completed", conclusion: "success" },
      { status: "completed", conclusion: "success" },
      { status: "completed", conclusion: "success" },
    ],
    "pending",
    0
  );
  assert.strictEqual(r.state, "pass");
  assert.deepStrictEqual([r.pass, r.fail, r.pending], [3, 0, 0]);
});

test("reviewSummary: keeps each reviewer's latest decision", () => {
  // 'a' flips changes->approved; counts once as an approval.
  const r = reviewSummary(
    [
      { user: { login: "a" }, state: "CHANGES_REQUESTED", submitted_at: "1" },
      { user: { login: "a" }, state: "APPROVED", submitted_at: "2" },
      { user: { login: "b" }, state: "COMMENTED", submitted_at: "3" },
    ],
    0
  );
  assert.strictEqual(r.approvals, 1);
  assert.strictEqual(r.changesRequested, 0);
  assert.strictEqual(r.review, "approved");
});

test("reviewSummary: changes requested dominates", () => {
  const r = reviewSummary(
    [
      { user: { login: "a" }, state: "APPROVED", submitted_at: "1" },
      { user: { login: "b" }, state: "CHANGES_REQUESTED", submitted_at: "2" },
    ],
    0
  );
  assert.strictEqual(r.review, "changes");
});

test("reviewSummary: approved but reviewers still pending => required", () => {
  const r = reviewSummary(
    [{ user: { login: "a" }, state: "APPROVED", submitted_at: "1" }],
    2
  );
  assert.strictEqual(r.approvals, 1);
  assert.strictEqual(r.review, "required");
});

test("reviewSummary: no reviews and no requests => none", () => {
  assert.strictEqual(reviewSummary([], 0).review, "none");
});

test("reviewSummary: a dismissed review drops that reviewer's decision", () => {
  const r = reviewSummary(
    [
      { user: { login: "a" }, state: "APPROVED", submitted_at: "1" },
      { user: { login: "a" }, state: "DISMISSED", submitted_at: "2" },
    ],
    0
  );
  assert.strictEqual(r.approvals, 0);
  assert.strictEqual(r.review, "none");
});

test("parseGitHubRemote: handles ssh, scp and https forms", () => {
  const expect = { owner: "octo", repo: "hello-world" };
  assert.deepStrictEqual(
    parseGitHubRemote("git@github.com:octo/hello-world.git"),
    expect
  );
  assert.deepStrictEqual(
    parseGitHubRemote("https://github.com/octo/hello-world.git"),
    expect
  );
  assert.deepStrictEqual(
    parseGitHubRemote("https://github.com/octo/hello-world"),
    expect
  );
  assert.deepStrictEqual(
    parseGitHubRemote("ssh://git@github.com/octo/hello-world.git"),
    expect
  );
});

test("parseGitHubRemote: rejects non-github hosts", () => {
  assert.strictEqual(
    parseGitHubRemote("git@gitlab.com:octo/hello-world.git"),
    undefined
  );
  assert.strictEqual(parseGitHubRemote("not a url"), undefined);
});
