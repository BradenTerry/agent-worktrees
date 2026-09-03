"use strict";
const test = require("node:test");
const assert = require("node:assert");
const {
  newlyWaiting,
  noticeText,
  notifyMode,
  shouldNotify,
  waitingAgents,
} = require("../out/waitingNotices.js");

const wt = (name, agents) => ({ name, agents });
const agent = (sessionId, status, label) => ({
  sessionId,
  status,
  label: label || sessionId,
});

test("waitingAgents picks only waiting rows, with their worktree", () => {
  const trees = [
    wt("main", [agent("a", "active"), agent("b", "waiting", "Fix the race")]),
    wt("feat/x", [agent("c", "idle"), agent("d", "waiting", "Port tests")]),
  ];
  assert.deepStrictEqual(waitingAgents(trees), [
    { sessionId: "b", label: "Fix the race", where: "main" },
    { sessionId: "d", label: "Port tests", where: "feat/x" },
  ]);
});

test("waitingAgents is empty when nothing is blocked", () => {
  assert.deepStrictEqual(
    waitingAgents([wt("main", [agent("a", "active"), agent("b", "idle")])]),
    []
  );
});

test("newlyWaiting returns each agent once and remembers it", () => {
  const announced = new Set();
  const waiting = [
    { sessionId: "a", label: "A", where: "main" },
    { sessionId: "b", label: "B", where: "x" },
  ];
  assert.deepStrictEqual(
    newlyWaiting(waiting, announced).map((a) => a.sessionId),
    ["a", "b"],
    "both are new the first time"
  );
  assert.deepStrictEqual(
    newlyWaiting(waiting, announced),
    [],
    "the 1s poll re-posting the same state announces nothing"
  );
});

test("newlyWaiting reports two agents blocking at once together", () => {
  const announced = new Set();
  newlyWaiting([{ sessionId: "a", label: "A", where: "main" }], announced);
  const fresh = newlyWaiting(
    [
      { sessionId: "a", label: "A", where: "main" },
      { sessionId: "b", label: "B", where: "x" },
      { sessionId: "c", label: "C", where: "y" },
    ],
    announced
  );
  assert.deepStrictEqual(
    fresh.map((a) => a.sessionId),
    ["b", "c"],
    "the one already announced is not repeated; both new ones come back"
  );
});

test("newlyWaiting announces again after an agent stops waiting", () => {
  const announced = new Set();
  const a = [{ sessionId: "a", label: "A", where: "main" }];
  newlyWaiting(a, announced);
  assert.deepStrictEqual(newlyWaiting([], announced), [], "went active");
  assert.strictEqual(announced.size, 0, "and was forgotten");
  assert.deepStrictEqual(
    newlyWaiting(a, announced).map((x) => x.sessionId),
    ["a"],
    "a second prompt in the same session announces again"
  );
});

test("newlyWaiting seeds without announcing", () => {
  const announced = new Set();
  const waiting = [
    { sessionId: "a", label: "A", where: "main" },
    { sessionId: "b", label: "B", where: "x" },
  ];
  assert.deepStrictEqual(
    newlyWaiting(waiting, announced, true),
    [],
    "a window opening onto blocked agents toasts nothing"
  );
  assert.strictEqual(announced.size, 2, "but they are remembered");
  assert.deepStrictEqual(newlyWaiting(waiting, announced), []);
});

test("notifyMode keeps known values and defaults anything else", () => {
  assert.strictEqual(notifyMode("off"), "off");
  assert.strictEqual(notifyMode("always"), "always");
  assert.strictEqual(notifyMode("unfocused"), "unfocused");
  // A hand-edited settings.json must never be guessed at in the direction of
  // interrupting more often than the user asked for.
  for (const bad of [undefined, null, "", "ALWAYS", true, 1, {}]) {
    assert.strictEqual(notifyMode(bad), "unfocused", `bad value: ${bad}`);
  }
});

test("shouldNotify honours the mode and window focus", () => {
  assert.strictEqual(shouldNotify("off", false), false);
  assert.strictEqual(shouldNotify("off", true), false);
  assert.strictEqual(shouldNotify("always", true), true);
  assert.strictEqual(shouldNotify("always", false), true);
  assert.strictEqual(shouldNotify("unfocused", true), false);
  assert.strictEqual(shouldNotify("unfocused", false), true);
});

test("noticeText names the worktree so stacked toasts differ", () => {
  assert.strictEqual(
    noticeText({ sessionId: "a", label: "Rework cart summary", where: "feat/x" }),
    "Rework cart summary needs you in feat/x"
  );
  assert.strictEqual(
    noticeText({ sessionId: "a", label: "Claude 1", where: "" }),
    "Claude 1 needs you"
  );
  assert.strictEqual(
    noticeText({ sessionId: "a", label: "", where: "main" }),
    "An agent needs you in main"
  );
});
