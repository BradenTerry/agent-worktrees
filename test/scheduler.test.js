"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { Coalescer } = require("../out/scheduler.js");

/**
 * Deterministic virtual clock. Timers fire synchronously when `tick` advances
 * past their due time, so a whole burst-then-settle scenario runs in zero real
 * time and the test asserts exact run counts rather than racing wall-clock
 * timers.
 */
function makeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
    /** Advance virtual time by `ms`, firing due timers in chronological order. */
    tick(ms) {
      const target = now + ms;
      for (;;) {
        let next;
        for (const [id, timer] of timers) {
          if (timer.at <= target && (!next || timer.at < next.timer.at)) {
            next = { id, timer };
          }
        }
        if (!next) break;
        now = next.timer.at;
        timers.delete(next.id);
        next.timer.fn();
      }
      now = target;
    },
  };
}

/** Let queued microtasks (the async run's finally block) settle. */
const flush = () => new Promise((r) => setImmediate(r));

test("a burst of triggers within the debounce collapses to one run", () => {
  const clock = makeClock();
  let runs = 0;
  const c = new Coalescer(() => runs++, 500, 5000, clock);

  // 50 events arriving 5ms apart - the kind of storm a Windows file watcher or
  // a streaming agent produces. None individually waits out the quiet period.
  for (let i = 0; i < 50; i++) {
    c.trigger();
    clock.tick(5);
  }
  assert.strictEqual(runs, 0, "must not run while events keep arriving");

  clock.tick(500);
  assert.strictEqual(runs, 1, "the whole burst yields a single refresh");
});

test("triggers spaced beyond the debounce each run once", async () => {
  const clock = makeClock();
  let runs = 0;
  const c = new Coalescer(() => runs++, 500, 5000, clock);

  // flush() between cycles lets the async run settle, as real event-loop turns
  // would between genuinely-spaced user/file events.
  for (let i = 0; i < 3; i++) {
    c.trigger();
    clock.tick(500);
    await flush();
  }
  assert.strictEqual(runs, 3);
});

test("maxDelay caps deferral so a continuous stream still flushes", () => {
  const clock = makeClock();
  let runs = 0;
  // delay 500ms, cap 2000ms.
  const c = new Coalescer(() => runs++, 500, 2000, clock);

  // Events every 100ms forever would starve a plain debounce. Drive 25 of them
  // (2.5s of continuous activity) and confirm the cap forced a flush.
  for (let i = 0; i < 25; i++) {
    c.trigger();
    clock.tick(100);
  }
  assert.ok(runs >= 1, "the maxDelay cap must force a flush under load");
  assert.ok(runs <= 2, "but deferral must still coalesce, not run per event");
});

test("triggers during an in-flight run collapse to one follow-up", async () => {
  const clock = makeClock();
  let runs = 0;
  let release;
  const c = new Coalescer(
    () => {
      runs++;
      return new Promise((r) => {
        release = r;
      });
    },
    500,
    5000,
    clock
  );

  c.trigger();
  clock.tick(500); // first run starts and is now awaiting `release`
  assert.strictEqual(runs, 1);

  // A flurry of events while the refresh is still running.
  for (let i = 0; i < 10; i++) c.trigger();
  assert.strictEqual(runs, 1, "no overlapping run while one is in flight");

  release(); // finish the first run
  await flush();
  clock.tick(500);
  assert.strictEqual(runs, 2, "exactly one coalesced follow-up, not ten");
});

test("cancel drops a pending run", () => {
  const clock = makeClock();
  let runs = 0;
  const c = new Coalescer(() => runs++, 500, 5000, clock);

  c.trigger();
  c.cancel();
  clock.tick(1000);
  assert.strictEqual(runs, 0);
  assert.strictEqual(c.pending, false);
});

test("flush runs immediately without waiting out the debounce", () => {
  const clock = makeClock();
  let runs = 0;
  const c = new Coalescer(() => runs++, 500, 5000, clock);

  c.trigger();
  c.flush();
  assert.strictEqual(runs, 1, "flush bypasses the quiet period");
  clock.tick(500);
  assert.strictEqual(runs, 1, "the pending timer was consumed, not left to fire");
});
