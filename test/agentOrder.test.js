"use strict";
const test = require("node:test");
const assert = require("node:assert");
const {
  normalizeAgentStatusOrder,
  moveAgentStatus,
  DEFAULT_AGENT_STATUS_ORDER,
} = require("../out/agentOrder.js");

test("the default is waiting, active, idle", () => {
  assert.deepStrictEqual(DEFAULT_AGENT_STATUS_ORDER, [
    "waiting",
    "active",
    "idle",
  ]);
});

test("a full custom order is kept as given", () => {
  assert.deepStrictEqual(normalizeAgentStatusOrder(["idle", "waiting", "active"]), [
    "idle",
    "waiting",
    "active",
  ]);
});

test("a partial order keeps its statuses first and appends the rest", () => {
  assert.deepStrictEqual(normalizeAgentStatusOrder(["idle"]), [
    "idle",
    "waiting",
    "active",
  ]);
});

test("unknown entries are dropped, not rendered", () => {
  assert.deepStrictEqual(normalizeAgentStatusOrder(["idle", "asleep", 3, null]), [
    "idle",
    "waiting",
    "active",
  ]);
});

test("a duplicate counts only the first time it appears", () => {
  assert.deepStrictEqual(
    normalizeAgentStatusOrder(["active", "active", "idle"]),
    ["active", "idle", "waiting"]
  );
});

test("junk of any shape falls back to the default", () => {
  for (const v of [undefined, null, "waiting", {}, [], 7, [[]]]) {
    assert.deepStrictEqual(
      normalizeAgentStatusOrder(v),
      DEFAULT_AGENT_STATUS_ORDER,
      `for ${JSON.stringify(v)}`
    );
  }
});

test("every status survives normalization exactly once", () => {
  const out = normalizeAgentStatusOrder(["idle", "idle"]);
  assert.strictEqual(out.length, 3);
  assert.strictEqual(new Set(out).size, 3);
});

test("moving a status up swaps it with the one above", () => {
  assert.deepStrictEqual(
    moveAgentStatus(["waiting", "active", "idle"], "idle", -1),
    ["waiting", "idle", "active"]
  );
});

test("moving a status down swaps it with the one below", () => {
  assert.deepStrictEqual(
    moveAgentStatus(["waiting", "active", "idle"], "waiting", 1),
    ["active", "waiting", "idle"]
  );
});

test("a move off either end is a no-op", () => {
  const order = ["waiting", "active", "idle"];
  assert.deepStrictEqual(moveAgentStatus(order, "waiting", -1), order);
  assert.deepStrictEqual(moveAgentStatus(order, "idle", 1), order);
});

test("a move normalizes a stored order it was handed", () => {
  assert.deepStrictEqual(moveAgentStatus(["idle"], "waiting", -1), [
    "waiting",
    "idle",
    "active",
  ]);
});

test("moving does not mutate the array it was given", () => {
  const order = ["waiting", "active", "idle"];
  moveAgentStatus(order, "idle", -1);
  assert.deepStrictEqual(order, ["waiting", "active", "idle"]);
});
