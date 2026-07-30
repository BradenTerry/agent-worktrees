"use strict";
const test = require("node:test");
const assert = require("node:assert");
const {
  dueForStatus,
  pollIntervalMs,
  DEFAULT_POLL_SECONDS,
  MIN_POLL_SECONDS,
  MAX_POLL_SECONDS,
} = require("../out/statusPoll.js");

const POLL = 10_000;
const WATCHED = 30_000;

/** dueForStatus with the two intervals fixed, so each test states only what it
 *  is about: which cards exist, which have their own change event, and when
 *  each was last read. */
function due({ cards, watched = [], statusAt = {}, now = 1_000_000 }) {
  return dueForStatus({
    cards,
    watched: new Set(watched),
    statusAt: new Map(Object.entries(statusAt)),
    now,
    pollMs: POLL,
    watchedMs: WATCHED,
  });
}

const working = (path) => ({ path, working: true });
const idle = (path) => ({ path, working: false });

test("a card with no working agent is never polled", () => {
  assert.deepStrictEqual(due({ cards: [idle("/a")] }), []);
  // Not even once: an idle card has nothing moving, and the discrete signals
  // (a save, window focus, Refresh) are what cover it.
  assert.deepStrictEqual(
    due({ cards: [idle("/a")], statusAt: { "/a": 0 }, now: 10 ** 9 }),
    []
  );
});

test("an unwatched working card is polled at the poll rate", () => {
  const now = 1_000_000;
  assert.deepStrictEqual(
    due({ cards: [working("/a")], statusAt: { "/a": now - POLL + 1 } }),
    [],
    "not yet due"
  );
  assert.deepStrictEqual(
    due({ cards: [working("/a")], statusAt: { "/a": now - POLL } }),
    ["/a"],
    "due exactly on the interval"
  );
});

test("a watched working card waits for the backstop, not the poll rate", () => {
  const now = 1_000_000;
  // Well past the poll rate, and still left alone: its repository's own change
  // event is what re-stats it.
  assert.deepStrictEqual(
    due({
      cards: [working("/a")],
      watched: ["/a"],
      statusAt: { "/a": now - POLL * 2 },
    }),
    []
  );
  assert.deepStrictEqual(
    due({
      cards: [working("/a")],
      watched: ["/a"],
      statusAt: { "/a": now - WATCHED },
    }),
    ["/a"],
    "the backstop still fires, so a card cannot freeze forever"
  );
});

test("the tiers are independent, card by card", () => {
  const now = 1_000_000;
  const result = due({
    cards: [working("/watched"), working("/unwatched"), idle("/quiet")],
    watched: ["/watched"],
    statusAt: {
      "/watched": now - POLL * 2,
      "/unwatched": now - POLL * 2,
      "/quiet": now - POLL * 2,
    },
  });
  assert.deepStrictEqual(result, ["/unwatched"]);
});

test("a card the panel has never stat'd is due immediately", () => {
  assert.deepStrictEqual(due({ cards: [working("/a")] }), ["/a"]);
  assert.deepStrictEqual(due({ cards: [working("/a")], watched: ["/a"] }), ["/a"]);
});

test("a repository closing puts its card back on the poll", () => {
  const now = 1_000_000;
  const cards = [working("/a")];
  const statusAt = { "/a": now - POLL };
  // Scoping Source Control elsewhere closes this repository, so it drops out of
  // `watched` and the poll picks it up again on the very next tick.
  assert.deepStrictEqual(due({ cards, watched: ["/a"], statusAt }), []);
  assert.deepStrictEqual(due({ cards, watched: [], statusAt }), ["/a"]);
});

test("pollIntervalMs clamps whatever settings.json actually contains", () => {
  assert.strictEqual(pollIntervalMs(10), 10_000);
  assert.strictEqual(pollIntervalMs(MIN_POLL_SECONDS), MIN_POLL_SECONDS * 1_000);
  assert.strictEqual(pollIntervalMs(MAX_POLL_SECONDS), MAX_POLL_SECONDS * 1_000);
  // A zero would mean a git spawn per tick; a negative, the same.
  assert.strictEqual(pollIntervalMs(0), MIN_POLL_SECONDS * 1_000);
  assert.strictEqual(pollIntervalMs(-5), MIN_POLL_SECONDS * 1_000);
  assert.strictEqual(pollIntervalMs(9_999), MAX_POLL_SECONDS * 1_000);
  assert.strictEqual(pollIntervalMs(7.4), 7_000, "rounded, not truncated to 0");
});

test("pollIntervalMs falls back to the default on a non-number", () => {
  const fallback = DEFAULT_POLL_SECONDS * 1_000;
  for (const bad of [undefined, null, "10", NaN, Infinity, {}, []]) {
    assert.strictEqual(pollIntervalMs(bad), fallback, String(bad));
  }
});
