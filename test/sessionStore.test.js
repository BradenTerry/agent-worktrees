"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readSessionsByWorktree } = require("../out/sessionStore.js");
const { normalizePath } = require("../out/worktreeUtils.js");

/**
 * Reading the emitter's state files into the panel's view models. The case that
 * matters here is a session that fans out: it hands each subagent a worktree of
 * its own so their edits cannot collide, and the panel shows each subagent on
 * the card for the worktree it is actually touching rather than stacking them
 * all under the one session that spawned them.
 */

const ROOT = path.join(os.tmpdir(), "wt-store-test-root");
const MAIN = path.join(ROOT, "repo");
const T3 = path.join(ROOT, "ticket-3");
const T4 = path.join(ROOT, "ticket-4");

let dir;

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-store-"));
});
test.afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Write one session state file, as the emitter would. */
function write(state) {
  fs.writeFileSync(
    path.join(dir, state.sessionId + ".json"),
    JSON.stringify({ ts: Date.now(), state: "active", ...state })
  );
}

const sub = (id, extra) => ({
  id,
  type: "nocturne",
  task: id + " work",
  startedAt: 1000,
  ...extra,
});

test("a subagent given its own worktree is indexed under that worktree", async () => {
  write({
    sessionId: "board",
    worktree: MAIN,
    task: "Ship the backlog",
    subagents: [sub("s3", { worktree: T3 }), sub("s4", { worktree: T4 })],
  });

  const { agents, subagents } = await readSessionsByWorktree(dir);

  // The parent keeps its own card, in its own worktree, and still lists both —
  // that list is what the count on its row is drawn from.
  const board = agents.get(normalizePath(MAIN));
  assert.strictEqual(board.length, 1);
  assert.deepStrictEqual(
    board[0].subagents.map((s) => s.id),
    ["s3", "s4"]
  );
  assert.strictEqual(agents.get(normalizePath(T3)), undefined);

  // And each subagent is also indexed under the worktree it is working in,
  // carrying who to talk to (a subagent has no terminal of its own).
  const t3 = subagents.get(normalizePath(T3));
  assert.strictEqual(t3.length, 1);
  assert.strictEqual(t3[0].id, "s3");
  assert.strictEqual(t3[0].parentSessionId, "board");
  assert.strictEqual(t3[0].parentLabel, "Ship the backlog");
  assert.strictEqual(t3[0].parentStatus, "active");
  assert.deepStrictEqual(
    subagents.get(normalizePath(T4)).map((s) => s.id),
    ["s4"]
  );
});

// `worktree` set means "rendered on another card", so the parent's own rows can
// be exactly the subagents without it. A file naming the parent's own worktree
// (a stale write, or a path that normalizes to the same place) must not leave
// the field set, or that subagent would be filtered off every card.
test("a subagent whose worktree IS its parent's is left with the parent", async () => {
  write({
    sessionId: "solo",
    worktree: MAIN,
    subagents: [sub("s1", { worktree: MAIN + path.sep }), sub("s2")],
  });

  const { agents, subagents } = await readSessionsByWorktree(dir);
  assert.strictEqual(subagents.size, 0);
  const list = agents.get(normalizePath(MAIN))[0].subagents;
  assert.deepStrictEqual(
    list.map((s) => [s.id, s.worktree]),
    [
      ["s1", undefined],
      ["s2", undefined],
    ]
  );
});

// The relocated entry is the SAME object the parent lists, so clearing the
// worktree later (gatherWorktrees does, for a path with no card) puts the row
// back under its parent instead of dropping it from the panel entirely.
test("a relocated subagent is shared with its parent's list, not copied", async () => {
  write({
    sessionId: "board",
    worktree: MAIN,
    subagents: [sub("s3", { worktree: T3 })],
  });

  const { agents, subagents } = await readSessionsByWorktree(dir);
  const mine = agents.get(normalizePath(MAIN))[0].subagents[0];
  assert.strictEqual(subagents.get(normalizePath(T3))[0], mine);
  delete subagents.get(normalizePath(T3))[0].worktree;
  assert.strictEqual(mine.worktree, undefined);
});

test("subagents sent to the same worktree by different sessions are ordered oldest first", async () => {
  write({
    sessionId: "one",
    worktree: MAIN,
    startedAt: 10,
    subagents: [sub("late", { worktree: T3, startedAt: 3000 })],
  });
  write({
    sessionId: "two",
    worktree: T4,
    startedAt: 20,
    subagents: [sub("early", { worktree: T3, startedAt: 500 })],
  });

  const { subagents } = await readSessionsByWorktree(dir);
  assert.deepStrictEqual(
    subagents.get(normalizePath(T3)).map((s) => [s.id, s.parentSessionId]),
    [
      ["early", "two"],
      ["late", "one"],
    ]
  );
});

test("a session with no subagents indexes nothing extra", async () => {
  write({ sessionId: "plain", worktree: MAIN, state: "idle" });
  const { agents, subagents } = await readSessionsByWorktree(dir);
  assert.strictEqual(subagents.size, 0);
  assert.deepStrictEqual(agents.get(normalizePath(MAIN))[0].subagents, []);
});
