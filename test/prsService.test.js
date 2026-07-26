"use strict";
/**
 * PrService cache behaviour around a worktree changing branches.
 *
 * PrService imports `vscode` and the GitHub client, neither of which exists
 * outside the extension host, so both are stubbed in the require cache before
 * `out/prs.js` is loaded: a minimal EventEmitter for vscode, and a scripted
 * GitHub whose bulk-list call can be delayed to hold a poll in flight.
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const Module = require("module");

const OUT = path.join(__dirname, "..", "out");

// --- stub "vscode" (resolve it to a bare id, then seed the cache) ------------
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "vscode") return "vscode";
  return origResolve.call(this, request, ...rest);
};
require.cache["vscode"] = {
  id: "vscode",
  filename: "vscode",
  loaded: true,
  exports: {
    EventEmitter: class {
      constructor() {
        this.handlers = [];
        this.event = (h) => {
          this.handlers.push(h);
          return { dispose() {} };
        };
      }
      fire(v) {
        this.handlers.forEach((h) => h(v));
      }
      dispose() {}
    },
  },
};

// --- stub the GitHub client -------------------------------------------------
const ghPath = path.join(OUT, "github.js");
const realGithub = require(ghPath);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MERGED_PR = {
  number: 7,
  title: "Merged work",
  url: "https://example.invalid/pr/7",
  state: "merged",
  checks: "pass",
  checksPass: 1,
  checksFail: 0,
  checksPending: 0,
  review: "approved",
  approvals: 1,
  changesRequested: 0,
  reviewsPending: 0,
  comments: 0,
  headSha: "abc",
};

const gh = {
  /** ms to hold the bulk open-PR list, to keep a poll in flight. */
  bulkDelay: 0,
  calls: [],
};

require.cache[ghPath].exports = {
  ...realGithub,
  getToken: async () => "token",
  // No open PRs: the feature branch's PR has been merged.
  fetchOpenPrsByHead: async () => {
    gh.calls.push("bulk");
    if (gh.bulkDelay) await sleep(gh.bulkDelay);
    return new Map();
  },
  // `?head=owner:<branch>&state=all`: the merged PR for the feature branch,
  // nothing for the default branch.
  fetchPr: async (_token, _repo, branch) => {
    gh.calls.push("fetchPr:" + branch);
    return branch === "feat" ? MERGED_PR : null;
  },
};

const { PrService } = require(path.join(OUT, "prs.js"));

const repo = { owner: "o", repo: "r" };
const context = { globalState: { get: (_k, d) => d, update: async () => {} } };
const KEY = "/wt";

test("PrService: a merged PR does not survive the worktree switching branches", async () => {
  const svc = new PrService(context);
  try {
    svc.setTargets([{ key: KEY, branch: "feat", repo }]);
    await sleep(30);
    assert.strictEqual(svc.get(KEY, "feat")?.state, "merged");

    // The agent checks the default branch back out.
    svc.setTargets([{ key: KEY, branch: "main", repo }]);
    assert.strictEqual(svc.get(KEY, "main"), undefined, "stale PR cleared");
    await sleep(50);
    assert.strictEqual(svc.get(KEY, "main"), null, "refetched for main");
  } finally {
    svc.dispose();
  }
});

test("PrService: a poll in flight during a branch switch cannot restore the old branch's PR", async () => {
  const svc = new PrService(context);
  try {
    svc.setTargets([{ key: KEY, branch: "feat", repo }]);
    await sleep(30);
    assert.strictEqual(svc.get(KEY, "feat")?.state, "merged");

    // A poll starts against "feat" and stalls on the bulk list...
    gh.bulkDelay = 60;
    void svc.refresh(true);
    await sleep(10);
    gh.bulkDelay = 0;
    // ...and the worktree switches branches while it is in flight. Its result
    // must not be written back under the new branch.
    svc.setTargets([{ key: KEY, branch: "main", repo }]);
    await sleep(200);
    assert.strictEqual(svc.get(KEY, "main"), null, "no write-back of the old branch's PR");

    // And it stays clear: a merged PR is otherwise a zero-request quiet state,
    // so a value pinned here would never be re-checked.
    await svc.refresh(true);
    assert.strictEqual(svc.get(KEY, "main"), null);
  } finally {
    svc.dispose();
  }
});

test("PrService: get() ignores a value cached for a different branch", async () => {
  const svc = new PrService(context);
  try {
    svc.setTargets([{ key: KEY, branch: "feat", repo }]);
    await sleep(30);
    assert.strictEqual(svc.get(KEY, "feat")?.state, "merged");
    assert.strictEqual(svc.get(KEY, "main"), undefined);
  } finally {
    svc.dispose();
  }
});
