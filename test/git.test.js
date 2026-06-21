"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  listWorktrees,
  getStatus,
  findRepoRoot,
  listBranches,
  deleteBranch,
  unpushedCommitCount,
} = require("../out/git.js");

function git(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function gitOut(cwd, args) {
  return execFileSync("git", args, { cwd }).toString().trim();
}

let dir;
let repo;

test.before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-git-test-"));
  repo = path.join(dir, "repo");
  fs.mkdirSync(repo);
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "t@example.com"]);
  git(repo, ["config", "user.name", "Tester"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "hello\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "init"]);
  // A worktree nested inside the repo, like `claude -w` creates.
  git(repo, [
    "worktree",
    "add",
    "-b",
    "feature",
    path.join(repo, ".claude", "worktrees", "feat"),
  ]);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("listWorktrees returns the primary and the nested worktree", async () => {
  const wts = await listWorktrees(repo);
  assert.strictEqual(wts.length, 2);

  const primary = wts.find((w) => w.isPrimary);
  assert.ok(primary, "a primary worktree exists");
  assert.strictEqual(primary.branch, "main");

  const feat = wts.find((w) => w.branch === "feature");
  assert.ok(feat, "the nested worktree is listed");
  assert.strictEqual(feat.isPrimary, false);
  assert.match(feat.path, /\.claude[/\\]worktrees[/\\]feat$/);
});

test("listWorktrees lists every worktree from a linked worktree too", async () => {
  const feat = path.join(repo, ".claude", "worktrees", "feat");
  const wts = await listWorktrees(feat);
  assert.strictEqual(wts.length, 2);
  assert.ok(wts.some((w) => w.branch === "main" && w.isPrimary));
});

test("getStatus reports clean then dirty", async () => {
  // Fresh repo so the nested worktree from before() doesn't count as dirty.
  const clean = path.join(dir, "clean");
  fs.mkdirSync(clean);
  git(clean, ["init", "-b", "main"]);
  git(clean, ["config", "user.email", "t@example.com"]);
  git(clean, ["config", "user.name", "Tester"]);
  fs.writeFileSync(path.join(clean, "a.txt"), "hello\n");
  git(clean, ["add", "."]);
  git(clean, ["commit", "-m", "init"]);

  let st = await getStatus(clean);
  assert.strictEqual(st.dirty, 0);

  fs.writeFileSync(path.join(clean, "untracked.txt"), "x\n");
  st = await getStatus(clean);
  assert.ok(st.dirty >= 1, "untracked file counts as dirty");
});

test("listBranches annotates worktree association and remote-only branches", async () => {
  // The repo has `main` (primary worktree) and `feature` (nested worktree).
  // Add a plain local branch with no worktree, and a remote-only ref by hand.
  git(repo, ["branch", "loose"]);
  // Fabricate origin/remote-feat with no local counterpart (no real remote).
  git(repo, [
    "update-ref",
    "refs/remotes/origin/remote-feat",
    "refs/heads/main",
  ]);

  const branches = await listBranches(repo);
  const byName = Object.fromEntries(branches.map((b) => [b.name, b]));

  const feature = byName["feature"];
  assert.ok(feature, "the feature branch is listed");
  assert.strictEqual(feature.remoteOnly, false);
  assert.strictEqual(feature.hasWorktree, true);
  assert.match(feature.worktreePath, /\.claude[/\\]worktrees[/\\]feat$/);

  const loose = byName["loose"];
  assert.ok(loose, "the worktree-less local branch is listed");
  assert.strictEqual(loose.hasWorktree, false);
  assert.strictEqual(loose.worktreePath, undefined);

  const remote = byName["remote-feat"];
  assert.ok(remote, "the remote-only branch is listed once by short name");
  assert.strictEqual(remote.remoteOnly, true);
  assert.strictEqual(remote.hasWorktree, false);

  // origin/HEAD is never surfaced as a branch.
  assert.ok(!branches.some((b) => b.name === "HEAD"));
});

test("listBranches never surfaces a phantom 'origin' from origin/HEAD", async () => {
  // origin/HEAD shortens to the bare name "origin" via %(refname:short); make
  // sure that symbolic alias does not leak in as a branch.
  git(repo, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);

  const branches = await listBranches(repo);
  assert.ok(
    !branches.some((b) => b.name === "origin"),
    "no phantom 'origin' branch"
  );
  assert.ok(!branches.some((b) => b.name === "HEAD"));
});

test("listBranches reports ahead/behind and diff vs the default branch", async () => {
  // A self-contained repo: main with one file, a topic branch ahead by one
  // commit that adds two lines. No remote, so the compare base falls back to the
  // local default branch (main).
  const r = path.join(dir, "enrich");
  fs.mkdirSync(r);
  git(r, ["init", "-b", "main"]);
  git(r, ["config", "user.email", "t@example.com"]);
  git(r, ["config", "user.name", "Tester"]);
  fs.writeFileSync(path.join(r, "a.txt"), "hello\n");
  git(r, ["add", "."]);
  git(r, ["commit", "-m", "init"]);
  git(r, ["branch", "topic"]);
  git(r, ["checkout", "topic"]);
  fs.writeFileSync(path.join(r, "a.txt"), "hello\nworld\nfoo\n");
  git(r, ["commit", "-am", "extend"]);
  git(r, ["checkout", "main"]);

  const byName = Object.fromEntries(
    (await listBranches(r)).map((b) => [b.name, b])
  );
  const topic = byName["topic"];
  assert.ok(topic, "topic is listed");
  assert.strictEqual(topic.ahead, 1, "one commit ahead of main");
  assert.strictEqual(topic.behind, 0);
  assert.strictEqual(topic.insertions, 2, "two lines added vs main");
  assert.strictEqual(topic.deletions, 0);
  // main is its own base, so no divergence and no diff.
  assert.strictEqual(byName["main"].ahead, 0);
  assert.strictEqual(byName["main"].insertions, 0);
  // The default branch is flagged so the UI can protect it from deletion.
  assert.strictEqual(byName["main"].isDefault, true, "main is the default branch");
  assert.strictEqual(topic.isDefault, false, "topic is not the default branch");
});

test("unpushedCommitCount counts commits not on the base branch", async () => {
  const r = path.join(dir, "unpushed");
  fs.mkdirSync(r);
  git(r, ["init", "-b", "main"]);
  git(r, ["config", "user.email", "t@example.com"]);
  git(r, ["config", "user.name", "Tester"]);
  fs.writeFileSync(path.join(r, "a.txt"), "hello\n");
  git(r, ["add", "."]);
  git(r, ["commit", "-m", "init"]);
  git(r, ["checkout", "-b", "work"]);
  fs.writeFileSync(path.join(r, "b.txt"), "one\n");
  git(r, ["add", "."]);
  git(r, ["commit", "-m", "c1"]);
  fs.writeFileSync(path.join(r, "c.txt"), "two\n");
  git(r, ["add", "."]);
  git(r, ["commit", "-m", "c2"]);
  git(r, ["checkout", "main"]);

  // No upstream configured, so it falls back to the default branch (main): two
  // commits on work are not reachable from main.
  assert.strictEqual(await unpushedCommitCount(r, "work"), 2);
  // main has nothing beyond itself.
  assert.strictEqual(await unpushedCommitCount(r, "main"), 0);
});

test("findRepoRoot resolves a worktree to a git top-level", async () => {
  const root = await findRepoRoot(repo);
  assert.ok(root);
  assert.ok(fs.existsSync(path.join(root, ".git")));
});

// A fresh clone with a real bare "origin" so remote deletion is exercised end
// to end, not faked with update-ref.
function makeCloneWithRemote(name) {
  const remote = path.join(dir, name + "-remote.git");
  const work = path.join(dir, name + "-work");
  git(dir, ["init", "--bare", "-b", "main", remote]);
  git(dir, ["clone", remote, work]);
  git(work, ["config", "user.email", "t@example.com"]);
  git(work, ["config", "user.name", "Tester"]);
  fs.writeFileSync(path.join(work, "a.txt"), "hi\n");
  git(work, ["add", "."]);
  git(work, ["commit", "-m", "init"]);
  git(work, ["push", "-u", "origin", "main"]);
  return work;
}

function localBranches(cwd) {
  return gitOut(cwd, ["branch", "--format=%(refname:short)"])
    .split("\n")
    .filter(Boolean);
}

function remoteBranches(cwd) {
  return gitOut(cwd, ["branch", "-r", "--format=%(refname:short)"])
    .split("\n")
    .filter(Boolean);
}

test("deleteBranch removes only the local ref when remote is not requested", async () => {
  const work = makeCloneWithRemote("del-local");
  git(work, ["push", "origin", "main:topic"]); // remote topic exists
  git(work, ["branch", "topic", "main"]); // local topic (merged into main)

  await deleteBranch(work, "topic", { local: true });

  assert.ok(!localBranches(work).includes("topic"), "local topic gone");
  assert.ok(
    remoteBranches(work).includes("origin/topic"),
    "remote topic untouched"
  );
});

test("deleteBranch removes the branch on origin when remote is requested", async () => {
  const work = makeCloneWithRemote("del-remote");
  git(work, ["push", "origin", "main:topic"]);
  git(work, ["fetch", "origin"]);
  assert.ok(remoteBranches(work).includes("origin/topic"));

  await deleteBranch(work, "topic", { remote: true });

  git(work, ["fetch", "origin", "--prune"]);
  assert.ok(
    !remoteBranches(work).includes("origin/topic"),
    "remote topic deleted"
  );
});

test("deleteBranch tolerates a stale remote ref (already gone on origin)", async () => {
  // Simulate the stale-tracking-ref case: origin/topic exists locally but the
  // branch was already deleted on the remote. A plain push --delete would fail
  // with "remote ref does not exist"; deleteBranch should instead prune the
  // local mirror and not throw.
  const work = makeCloneWithRemote("del-stale");
  git(work, ["push", "origin", "main:topic"]);
  git(work, ["fetch", "origin"]);
  // Delete on the remote behind our back, leaving our origin/topic stale.
  const remote = path.join(dir, "del-stale-remote.git");
  git(remote, ["branch", "-D", "topic"]);
  assert.ok(remoteBranches(work).includes("origin/topic"), "stale ref present");

  await assert.doesNotReject(() =>
    deleteBranch(work, "topic", { remote: true })
  );
  assert.ok(
    !remoteBranches(work).includes("origin/topic"),
    "stale remote-tracking ref pruned"
  );
});

test("deleteBranch local+remote in one call clears both sides", async () => {
  const work = makeCloneWithRemote("del-both");
  git(work, ["push", "origin", "main:topic"]);
  git(work, ["branch", "topic", "main"]);

  await deleteBranch(work, "topic", { local: true, remote: true });

  assert.ok(!localBranches(work).includes("topic"));
  git(work, ["fetch", "origin", "--prune"]);
  assert.ok(!remoteBranches(work).includes("origin/topic"));
});

test("deleteBranch refuses an unmerged local branch unless forced", async () => {
  const work = makeCloneWithRemote("del-unmerged");
  git(work, ["checkout", "-b", "topic"]);
  fs.writeFileSync(path.join(work, "b.txt"), "only here\n");
  git(work, ["add", "."]);
  git(work, ["commit", "-m", "unmerged work"]);
  git(work, ["checkout", "main"]);

  await assert.rejects(
    () => deleteBranch(work, "topic", { local: true }),
    /not fully merged/i
  );
  assert.ok(localBranches(work).includes("topic"), "still present after refusal");

  await deleteBranch(work, "topic", { local: true, force: true });
  assert.ok(!localBranches(work).includes("topic"), "force deletes it");
});
