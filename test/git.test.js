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
  switchWorktreeBranch,
  setGitTracer,
  removeWorktree,
  claudeSessionLockPid,
  releaseStaleClaudeLocks,
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

test("switchWorktreeBranch checks out an existing branch in just that worktree", async () => {
  const r = path.join(dir, "switch-existing");
  fs.mkdirSync(r);
  git(r, ["init", "-b", "main"]);
  git(r, ["config", "user.email", "t@example.com"]);
  git(r, ["config", "user.name", "Tester"]);
  fs.writeFileSync(path.join(r, "a.txt"), "hi\n");
  git(r, ["add", "."]);
  git(r, ["commit", "-m", "init"]);
  git(r, ["branch", "other"]);
  const wt = path.join(r, "wt");
  git(r, ["worktree", "add", "-b", "work", wt]);

  await switchWorktreeBranch(wt, "other");

  assert.strictEqual(gitOut(wt, ["rev-parse", "--abbrev-ref", "HEAD"]), "other");
  // The primary worktree is untouched.
  assert.strictEqual(gitOut(r, ["rev-parse", "--abbrev-ref", "HEAD"]), "main");
});

test("switchWorktreeBranch with create makes a branch off HEAD and switches to it", async () => {
  const r = path.join(dir, "switch-create");
  fs.mkdirSync(r);
  git(r, ["init", "-b", "main"]);
  git(r, ["config", "user.email", "t@example.com"]);
  git(r, ["config", "user.name", "Tester"]);
  fs.writeFileSync(path.join(r, "a.txt"), "hi\n");
  git(r, ["add", "."]);
  git(r, ["commit", "-m", "init"]);
  const wt = path.join(r, "wt");
  git(r, ["worktree", "add", wt]);

  await switchWorktreeBranch(wt, "fresh-branch", { create: true });

  assert.strictEqual(
    gitOut(wt, ["rev-parse", "--abbrev-ref", "HEAD"]),
    "fresh-branch"
  );
});

test("switchWorktreeBranch throws git's message when the branch is held elsewhere", async () => {
  const r = path.join(dir, "switch-conflict");
  fs.mkdirSync(r);
  git(r, ["init", "-b", "main"]);
  git(r, ["config", "user.email", "t@example.com"]);
  git(r, ["config", "user.name", "Tester"]);
  fs.writeFileSync(path.join(r, "a.txt"), "hi\n");
  git(r, ["add", "."]);
  git(r, ["commit", "-m", "init"]);
  // "taken" is checked out in its own worktree, so a second checkout must fail.
  git(r, ["worktree", "add", "-b", "taken", path.join(r, "taken-wt")]);
  const wt = path.join(r, "wt");
  git(r, ["worktree", "add", wt]);

  await assert.rejects(
    () => switchWorktreeBranch(wt, "taken"),
    /already (used by|checked out)/i
  );
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

test("getStatus reports line diff for tracked changes, zero when clean", async () => {
  const r = path.join(dir, "status-diff");
  fs.mkdirSync(r);
  git(r, ["init", "-b", "main"]);
  git(r, ["config", "user.email", "t@example.com"]);
  git(r, ["config", "user.name", "Tester"]);
  fs.writeFileSync(path.join(r, "a.txt"), "one\n");
  git(r, ["add", "."]);
  git(r, ["commit", "-m", "init"]);

  // Clean: the per-worktree diff is skipped, so insertions/deletions are zero.
  let st = await getStatus(r);
  assert.strictEqual(st.dirty, 0);
  assert.strictEqual(st.insertions, 0);
  assert.strictEqual(st.deletions, 0);

  // A tracked modification: the diff runs and the added line is counted.
  fs.writeFileSync(path.join(r, "a.txt"), "one\ntwo\n");
  st = await getStatus(r);
  assert.ok(st.dirty >= 1, "tracked change counts as dirty");
  assert.strictEqual(st.insertions, 1, "one line added vs HEAD");
  assert.strictEqual(st.deletions, 0);

  // An untracked file alone must NOT trigger the diff (nothing tracked changed).
  git(r, ["checkout", "--", "a.txt"]); // revert the tracked change
  fs.writeFileSync(path.join(r, "b.txt"), "new\n");
  st = await getStatus(r);
  assert.ok(st.dirty >= 1, "untracked file is dirty");
  assert.strictEqual(st.insertions, 0, "untracked files are not in git diff HEAD");
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

test("listBranches reports ahead/behind vs the default branch", async () => {
  // A self-contained repo: main with one file, a topic branch ahead by one
  // commit. No remote, so the compare base falls back to the local default
  // branch (main).
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
  // main is its own base, so no divergence.
  assert.strictEqual(byName["main"].ahead, 0);
  // With no remote there is no origin/HEAD, so nothing is flagged as the
  // default branch (we trust git, not a guessed name).
  assert.strictEqual(byName["main"].isDefault, false);
  assert.strictEqual(topic.isDefault, false);
});

test("listBranches flags the default branch from origin/HEAD", async () => {
  // A bare "remote" plus a clone, so origin/HEAD actually points at the default
  // branch the way a real checkout does.
  const remote = path.join(dir, "origin.git");
  git(dir, ["init", "--bare", "-b", "trunk", remote]);

  const seed = path.join(dir, "seed");
  fs.mkdirSync(seed);
  git(seed, ["init", "-b", "trunk"]);
  git(seed, ["config", "user.email", "t@example.com"]);
  git(seed, ["config", "user.name", "Tester"]);
  fs.writeFileSync(path.join(seed, "a.txt"), "hi\n");
  git(seed, ["add", "."]);
  git(seed, ["commit", "-m", "init"]);
  git(seed, ["remote", "add", "origin", remote]);
  git(seed, ["push", "-u", "origin", "trunk"]);

  const clone = path.join(dir, "clone");
  git(dir, ["clone", remote, clone]); // clone sets refs/remotes/origin/HEAD
  git(clone, ["checkout", "-b", "side"]);

  const byName = Object.fromEntries(
    (await listBranches(clone)).map((b) => [b.name, b])
  );
  // The default branch is whatever origin/HEAD names ("trunk" here), not "main".
  assert.strictEqual(byName["trunk"].isDefault, true, "trunk is the default");
  assert.strictEqual(byName["side"].isDefault, false);
});

test("listBranches handles a many-branch repo and returns every branch", async () => {
  // The "branch list size" hypothesis: verify a repo with a large branch count
  // lists all of them (and completes). A mix of merged/in-sync branches (no
  // diff) and ahead branches (one extra commit) exercises both enrichment paths.
  const r = path.join(dir, "many");
  fs.mkdirSync(r);
  git(r, ["init", "-b", "main"]);
  git(r, ["config", "user.email", "t@example.com"]);
  git(r, ["config", "user.name", "Tester"]);
  fs.writeFileSync(path.join(r, "a.txt"), "hello\n");
  git(r, ["add", "."]);
  git(r, ["commit", "-m", "init"]);

  const N = 60;
  for (let i = 0; i < N; i++) {
    // Half are plain branches at main (in sync -> no diff), half are one commit
    // ahead (a diff is computed).
    if (i % 2 === 0) {
      git(r, ["branch", `sync-${i}`]);
    } else {
      git(r, ["checkout", "-b", `ahead-${i}`]);
      fs.writeFileSync(path.join(r, `f${i}.txt`), "x\n");
      git(r, ["add", "."]);
      git(r, ["commit", "-m", `c${i}`]);
      git(r, ["checkout", "main"]);
    }
  }

  const branches = await listBranches(r);
  // main + N created branches.
  assert.strictEqual(branches.length, N + 1, "every branch is listed");
  const byName = Object.fromEntries(branches.map((b) => [b.name, b]));
  // An "ahead" branch reports its one-commit divergence.
  assert.strictEqual(byName["ahead-1"].ahead, 1);
  // An "in sync" branch has no divergence.
  assert.strictEqual(byName["sync-0"].ahead, 0);
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

test("setGitTracer records each git call (command, result, timing)", async () => {
  const lines = [];
  setGitTracer((m) => lines.push(m));
  try {
    await listWorktrees(repo);
  } finally {
    setGitTracer(null); // disabling stops further tracing
  }

  // The worktree listing ran `git worktree list --porcelain`; the trace line
  // carries the command and an "ok <ms>ms" result.
  const wt = lines.find((l) => l.startsWith("git worktree list"));
  assert.ok(wt, `expected a traced 'git worktree list' call, got: ${lines.join(" | ")}`);
  assert.match(wt, /-> ok \d+ms/);

  // After setGitTracer(null), nothing more is recorded.
  const before = lines.length;
  await listWorktrees(repo);
  assert.strictEqual(lines.length, before, "tracer disabled -> no new lines");
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

// ---------------------------------------------------------------------------
// Locked worktrees: stale Claude session locks and force removal.
// ---------------------------------------------------------------------------

/** A fresh repo with one locked worktree; returns { r, wt }. */
function makeLockedWorktree(name, reason) {
  const r = path.join(dir, name);
  fs.mkdirSync(r);
  git(r, ["init", "-b", "main"]);
  git(r, ["config", "user.email", "t@example.com"]);
  git(r, ["config", "user.name", "Tester"]);
  fs.writeFileSync(path.join(r, "a.txt"), "hi\n");
  git(r, ["add", "."]);
  git(r, ["commit", "-m", "init"]);
  const wt = path.join(r, "wt");
  git(r, ["worktree", "add", "-b", "work", wt]);
  git(r, ["worktree", "lock", "--reason", reason, wt]);
  return { r, wt };
}

test("listWorktrees parses the lock reason", async () => {
  const { r } = makeLockedWorktree(
    "lock-reason",
    "claude session lovely-honking-blossom (pid 32656 start 6391918501785405900)"
  );
  const wt = (await listWorktrees(r)).find((w) => w.branch === "work");
  assert.ok(wt.locked, "worktree is locked");
  assert.strictEqual(
    wt.lockReason,
    "claude session lovely-honking-blossom (pid 32656 start 6391918501785405900)"
  );
});

test("claudeSessionLockPid extracts the pid from claude lock reasons only", () => {
  assert.strictEqual(
    claudeSessionLockPid(
      "claude session lovely-honking-blossom (pid 32656 start 6391918501785405900)"
    ),
    32656
  );
  assert.strictEqual(claudeSessionLockPid(undefined), undefined);
  assert.strictEqual(claudeSessionLockPid(""), undefined);
  assert.strictEqual(claudeSessionLockPid("on my USB drive"), undefined);
  assert.strictEqual(
    claudeSessionLockPid("session foo (pid 1 start 2)"),
    undefined,
    "reasons not starting with 'claude session' are not ours"
  );
});

test("releaseStaleClaudeLocks unlocks a claude lock whose pid is dead", async () => {
  const { r } = makeLockedWorktree(
    "stale-lock",
    "claude session gone-gone (pid 32656 start 123)"
  );
  const wts = await listWorktrees(r);
  const released = await releaseStaleClaudeLocks(r, wts, () => false);
  const wt = wts.find((w) => w.branch === "work");
  assert.deepStrictEqual(released, [wt.path]);
  assert.strictEqual(wt.locked, false, "the entry is updated in place");
  const fresh = (await listWorktrees(r)).find((w) => w.branch === "work");
  assert.strictEqual(fresh.locked, false, "the lock is gone from git");
});

test("releaseStaleClaudeLocks leaves live claude locks alone", async () => {
  const { r } = makeLockedWorktree(
    "live-lock",
    `claude session busy-bee (pid ${process.pid} start 123)`
  );
  const wts = await listWorktrees(r);
  const released = await releaseStaleClaudeLocks(r, wts);
  assert.deepStrictEqual(released, []);
  const fresh = (await listWorktrees(r)).find((w) => w.branch === "work");
  assert.strictEqual(fresh.locked, true, "still locked");
});

test("releaseStaleClaudeLocks never touches non-claude locks", async () => {
  const { r } = makeLockedWorktree("user-lock", "on my USB drive");
  const wts = await listWorktrees(r);
  const released = await releaseStaleClaudeLocks(r, wts, () => false);
  assert.deepStrictEqual(released, []);
  const fresh = (await listWorktrees(r)).find((w) => w.branch === "work");
  assert.strictEqual(fresh.locked, true, "still locked");
});

test("removeWorktree without force refuses a locked worktree", async () => {
  const { r, wt } = makeLockedWorktree("locked-remove", "claude session x (pid 1 start 2)");
  await assert.rejects(() => removeWorktree(r, wt), /locked/i);
  assert.ok(fs.existsSync(wt), "still on disk after refusal");
});

test("removeWorktree with force removes a locked worktree", async () => {
  // git demands the force flag twice for locked trees ("use 'remove -f -f' to
  // override or unlock first"); this is the regression test for passing it once.
  const { r, wt } = makeLockedWorktree("locked-force", "claude session x (pid 1 start 2)");
  await removeWorktree(r, wt, true);
  assert.ok(!fs.existsSync(wt), "worktree directory removed");
  assert.strictEqual((await listWorktrees(r)).length, 1, "only the primary remains");
});
