"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { applyScopeScm, isScmActive } = require("../out/scmScope.js");

const MAIN = "/repo";
const WT = "/repo-feature";

// No real waiting in tests: settle() polls but we resolve sleep immediately.
const opts = { sleep: async () => {} };

/**
 * Fake Git model. `dedupe` reproduces the real-world worktree bug: while the
 * main repo is open, opening a worktree that shares its git dir is a no-op (the
 * Git extension refuses the duplicate). Once main is closed, the worktree opens.
 */
function makeModel({ open = [], dedupe = false } = {}) {
  let repos = [...open];
  return {
    repos: () => repos,
    list: () => [...repos],
    open: async (p) => {
      if (repos.includes(p)) return;
      // With dedupe on, a worktree can't register while a *different* repo
      // (its main) is already open.
      if (dedupe && repos.length > 0) return;
      repos.push(p);
    },
    close: async (p) => {
      repos = repos.filter((r) => r !== p);
    },
  };
}

test("scoping main -> worktree leaves only the worktree (no dedupe)", async () => {
  const m = makeModel({ open: [MAIN] });
  await applyScopeScm(m, WT, opts);
  assert.deepStrictEqual(m.repos(), [WT]);
});

test("scoping worktree -> main leaves only main", async () => {
  const m = makeModel({ open: [WT] });
  await applyScopeScm(m, MAIN, opts);
  assert.deepStrictEqual(m.repos(), [MAIN]);
});

test("regression: main -> worktree sticks on the first click despite dedupe", async () => {
  // Before the fix this ended with [] (main closed, worktree never registered),
  // which is why the worktree needed a second click to select.
  const m = makeModel({ open: [MAIN], dedupe: true });
  await applyScopeScm(m, WT, opts);
  assert.deepStrictEqual(
    m.repos(),
    [WT],
    "worktree must be the active scope after a single click"
  );
});

test("multiple repos open: scoping is non-destructive (keeps the others)", async () => {
  const other = "/repo-other";
  const m = makeModel({ open: [MAIN, other] });
  await applyScopeScm(m, WT, opts);
  const repos = m.repos();
  assert.ok(repos.includes(WT), "target is opened");
  assert.ok(repos.includes(MAIN) && repos.includes(other), "others are kept");
});

test("re-scoping to the already-active sole repo is a no-op", async () => {
  const m = makeModel({ open: [WT] });
  await applyScopeScm(m, WT, opts);
  assert.deepStrictEqual(m.repos(), [WT]);
});

// --- isScmActive: single-selection highlight ---

test("regression: only the scoped worktree highlights when both repos stay open", () => {
  // The "both selected" bug: closing main did not stick, so main and the
  // worktree were both open. Highlight must still single out the scoped one.
  const open = [MAIN, WT];
  assert.strictEqual(isScmActive(WT, open, WT), true);
  assert.strictEqual(isScmActive(MAIN, open, WT), false);
});

test("a single open repo with no explicit scope highlights itself", () => {
  assert.strictEqual(isScmActive(MAIN, [MAIN], null), true);
});

test("no explicit scope and several repos open: highlight nothing (ambiguous)", () => {
  const open = [MAIN, WT];
  assert.strictEqual(isScmActive(MAIN, open, null), false);
  assert.strictEqual(isScmActive(WT, open, null), false);
});

test("a repo that is not open never highlights, even if it is the scope", () => {
  assert.strictEqual(isScmActive(WT, [MAIN], WT), false);
});

test("a stale scope (its repo not open) falls back to the lone open repo", () => {
  // Scoped to WT earlier, but this session only has main open.
  assert.strictEqual(isScmActive(MAIN, [MAIN], WT), true);
});
