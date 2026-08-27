"use strict";
const test = require("node:test");
const assert = require("node:assert");
const {
  GENERAL_GROUP_ID,
  GENERAL_GROUP_NAME,
  MAX_GROUPS,
  MAX_GROUP_NAME_LENGTH,
  addGroup,
  assignWorktree,
  cleanGroupName,
  deleteGroup,
  emptyGroupState,
  groupIdFor,
  groupList,
  moveGroup,
  normalizeGroups,
  pruneGroups,
  renameGroup,
} = require("../out/groups.js");

/** A state with General plus two groups, and one worktree filed in each. */
function seeded() {
  let s = emptyGroupState();
  s = addGroup(s, "In review").state;
  s = addGroup(s, "On ice").state;
  s = assignWorktree(s, "/wt/a", "g1");
  s = assignWorktree(s, "/wt/b", "g2");
  return s;
}

test("a fresh state is General alone with nothing filed", () => {
  const s = emptyGroupState();
  assert.deepStrictEqual(s.order, [GENERAL_GROUP_ID]);
  assert.strictEqual(s.names[GENERAL_GROUP_ID], GENERAL_GROUP_NAME);
  assert.deepStrictEqual(s.of, {});
});

test("General survives every kind of junk in the stored blob", () => {
  for (const junk of [undefined, null, 0, "", [], {}, { order: 5 }, { order: ["x"] }]) {
    const s = normalizeGroups(junk);
    assert.ok(s.order.includes(GENERAL_GROUP_ID), JSON.stringify(junk));
    assert.strictEqual(s.names[GENERAL_GROUP_ID], GENERAL_GROUP_NAME);
  }
});

test("a stored order is kept, duplicates and nameless ids dropped", () => {
  const s = normalizeGroups({
    order: [GENERAL_GROUP_ID, "g1", "g1", "g2", 7, ""],
    names: { [GENERAL_GROUP_ID]: "General", g1: "In review" },
  });
  // g2 has no name, so it is debris rather than a group.
  assert.deepStrictEqual(s.order, [GENERAL_GROUP_ID, "g1"]);
});

test("General's name is fixed, whatever the blob says", () => {
  for (const stored of ["   ", "Active", 7, undefined]) {
    const s = normalizeGroups({
      order: [GENERAL_GROUP_ID],
      names: { general: stored },
    });
    assert.strictEqual(s.names[GENERAL_GROUP_ID], GENERAL_GROUP_NAME);
  }
});

test("General keeps the position the user moved it to", () => {
  const s = normalizeGroups({
    order: ["g1", GENERAL_GROUP_ID],
    names: { g1: "In review", general: "General" },
  });
  assert.deepStrictEqual(s.order, ["g1", GENERAL_GROUP_ID]);
});

test("a membership pointing at a group that is gone falls to General", () => {
  const s = normalizeGroups({
    order: [GENERAL_GROUP_ID],
    names: { general: "General" },
    of: { "/wt/a": "g9" },
  });
  assert.deepStrictEqual(s.of, {});
  assert.strictEqual(groupIdFor(s, "/wt/a"), GENERAL_GROUP_ID);
});

test("General is never stored as a membership", () => {
  const s = normalizeGroups({
    order: [GENERAL_GROUP_ID],
    names: { general: "General" },
    of: { "/wt/a": GENERAL_GROUP_ID },
  });
  assert.deepStrictEqual(s.of, {});
});

test("names are trimmed, single-spaced and capped", () => {
  assert.strictEqual(cleanGroupName("  In   review \n"), "In review");
  assert.strictEqual(cleanGroupName("x".repeat(200)).length, MAX_GROUP_NAME_LENGTH);
  assert.strictEqual(cleanGroupName(42), "");
  assert.strictEqual(cleanGroupName("   "), "");
});

test("a new group appends at the end and gets the next free id", () => {
  const s = seeded();
  assert.deepStrictEqual(s.order, [GENERAL_GROUP_ID, "g1", "g2"]);
  const next = addGroup(s, "Later");
  assert.strictEqual(next.id, "g3");
  assert.deepStrictEqual(next.state.order, [GENERAL_GROUP_ID, "g1", "g2", "g3"]);
});

test("ids are not reused after a delete", () => {
  const s = deleteGroup(seeded(), "g2");
  assert.strictEqual(addGroup(s, "Later").id, "g2");
});

test("a group can be created with a worktree already in it", () => {
  const { state, id } = addGroup(emptyGroupState(), "In review", "/wt/a");
  assert.strictEqual(groupIdFor(state, "/wt/a"), id);
});

test("a nameless group is not created", () => {
  const { state, id } = addGroup(emptyGroupState(), "  ");
  assert.strictEqual(id, "");
  assert.deepStrictEqual(state.order, [GENERAL_GROUP_ID]);
});

test("a duplicate name is suffixed rather than shadowing the original", () => {
  let s = addGroup(emptyGroupState(), "In review").state;
  // Matched case-insensitively (two headers a glance cannot tell apart are the
  // problem), but the suffix keeps the casing the user typed.
  s = addGroup(s, "in review").state;
  s = addGroup(s, "In review").state;
  assert.deepStrictEqual(s.order.map((id) => s.names[id]), [
    "General",
    "In review",
    "in review 2",
    "In review 3",
  ]);
});

test("the group ceiling is enforced", () => {
  let s = emptyGroupState();
  for (let i = 0; i < MAX_GROUPS + 5; i++) s = addGroup(s, "g" + i).state;
  assert.strictEqual(s.order.length, MAX_GROUPS);
});

test("renaming keeps the group in place and does not fight its own name", () => {
  const s = renameGroup(seeded(), "g1", "Waiting on review");
  assert.deepStrictEqual(s.order, [GENERAL_GROUP_ID, "g1", "g2"]);
  assert.strictEqual(s.names.g1, "Waiting on review");
  assert.strictEqual(renameGroup(s, "g1", "Waiting on review").names.g1, "Waiting on review");
});

test("renaming to a blank, or an unknown group, is a no-op", () => {
  const s = seeded();
  assert.strictEqual(renameGroup(s, "g1", "   ").names.g1, "In review");
  assert.deepStrictEqual(renameGroup(s, "nope", "x").order, s.order);
});

test("General cannot be renamed", () => {
  const s = renameGroup(seeded(), GENERAL_GROUP_ID, "Working");
  assert.strictEqual(s.names[GENERAL_GROUP_ID], GENERAL_GROUP_NAME);
  assert.ok(s.order.includes(GENERAL_GROUP_ID));
});

test("General can still be moved", () => {
  const s = moveGroup(seeded(), GENERAL_GROUP_ID, 1);
  assert.deepStrictEqual(s.order, ["g1", GENERAL_GROUP_ID, "g2"]);
});

test("deleting a group moves its members to General, not out of the panel", () => {
  const s = deleteGroup(seeded(), "g1");
  assert.deepStrictEqual(s.order, [GENERAL_GROUP_ID, "g2"]);
  assert.strictEqual(groupIdFor(s, "/wt/a"), GENERAL_GROUP_ID);
  // The other group is untouched.
  assert.strictEqual(groupIdFor(s, "/wt/b"), "g2");
});

test("General cannot be deleted", () => {
  const s = deleteGroup(seeded(), GENERAL_GROUP_ID);
  assert.ok(s.order.includes(GENERAL_GROUP_ID));
});

test("a group moves any distance in one step, which is what a drag sends", () => {
  let s = seeded();
  s = addGroup(s, "Fourth").state; // general, g1, g2, g3
  assert.deepStrictEqual(moveGroup(s, GENERAL_GROUP_ID, 3).order, [
    "g1",
    "g2",
    "g3",
    GENERAL_GROUP_ID,
  ]);
  assert.deepStrictEqual(moveGroup(s, "g3", -3).order, [
    "g3",
    GENERAL_GROUP_ID,
    "g1",
    "g2",
  ]);
  // Past either end is a no-op, not a clamp: the webview computes the index it
  // wants, so an out of range one is a bug rather than an intention.
  assert.deepStrictEqual(moveGroup(s, "g1", 5).order, s.order);
  assert.deepStrictEqual(moveGroup(s, "g1", -5).order, s.order);
});

test("groups move one place, and the ends are no-ops", () => {
  const s = seeded();
  assert.deepStrictEqual(moveGroup(s, "g2", -1).order, [GENERAL_GROUP_ID, "g2", "g1"]);
  assert.deepStrictEqual(moveGroup(s, GENERAL_GROUP_ID, -1).order, s.order);
  assert.deepStrictEqual(moveGroup(s, "g2", 1).order, s.order);
  assert.deepStrictEqual(moveGroup(s, "nope", 1).order, s.order);
});

test("assigning to General or to nothing clears the membership", () => {
  const s = seeded();
  assert.deepStrictEqual(assignWorktree(s, "/wt/a", GENERAL_GROUP_ID).of, {
    "/wt/b": "g2",
  });
  assert.deepStrictEqual(assignWorktree(s, "/wt/a", "gone").of, { "/wt/b": "g2" });
});

test("assigning moves a worktree between groups", () => {
  const s = assignWorktree(seeded(), "/wt/a", "g2");
  assert.strictEqual(groupIdFor(s, "/wt/a"), "g2");
});

test("a worktree that cannot be filed loses its membership", () => {
  // What the primary worktree looks like from here: it exists, but it is not in
  // the set the caller says can be in a group.
  const pruned = pruneGroups(seeded(), ["/wt/b"]);
  assert.strictEqual(pruned.changed, true);
  assert.deepStrictEqual(pruned.state.of, { "/wt/b": "g2" });
});

test("pruning drops memberships for worktrees that are gone, and says so", () => {
  const s = seeded();
  const kept = pruneGroups(s, ["/wt/a", "/wt/b"]);
  assert.strictEqual(kept.changed, false);
  const pruned = pruneGroups(s, ["/wt/a"]);
  assert.strictEqual(pruned.changed, true);
  assert.deepStrictEqual(pruned.state.of, { "/wt/a": "g1" });
});

test("pruning never removes the groups themselves", () => {
  const pruned = pruneGroups(seeded(), []);
  assert.deepStrictEqual(pruned.state.order, [GENERAL_GROUP_ID, "g1", "g2"]);
});

test("the payload list is the groups in display order", () => {
  assert.deepStrictEqual(groupList(seeded()), [
    { id: GENERAL_GROUP_ID, name: "General" },
    { id: "g1", name: "In review" },
    { id: "g2", name: "On ice" },
  ]);
});

test("every editor leaves a state the next one can read", () => {
  let s = seeded();
  s = normalizeGroups(JSON.parse(JSON.stringify(s)));
  s = moveGroup(s, "g2", -1);
  s = deleteGroup(s, "g1");
  s = renameGroup(s, "g2", "Parked");
  s = assignWorktree(s, "/wt/c", "g2");
  assert.deepStrictEqual(s.order, [GENERAL_GROUP_ID, "g2"]);
  assert.strictEqual(s.names.g2, "Parked");
  assert.strictEqual(groupIdFor(s, "/wt/a"), GENERAL_GROUP_ID);
  assert.strictEqual(groupIdFor(s, "/wt/c"), "g2");
});
