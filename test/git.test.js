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
} = require("../out/git.js");

function git(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
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

test("findRepoRoot resolves a worktree to a git top-level", async () => {
  const root = await findRepoRoot(repo);
  assert.ok(root);
  assert.ok(fs.existsSync(path.join(root, ".git")));
});
