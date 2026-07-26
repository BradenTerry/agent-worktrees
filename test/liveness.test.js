"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pruneDeadSessions } = require("../out/liveness.js");

/**
 * The sweep that retires agents whose Claude process is gone — the rows a
 * reopened VS Code window would otherwise show with no terminal behind them.
 *
 * Every case fakes the OS probes, so nothing here depends on real processes:
 * `alive` is the set of pids that exist, `cmdline` is the process table the argv
 * check searches, and `pidIsProof` mirrors the platform rule (false on Windows).
 */

const NOW = 1_700_000_000_000;
/** Older than the sweep's 60s grace, so the file is eligible. */
const OLD = NOW - 5 * 60_000;

let dir;

function probes({ alive = [], cmdline = "", pidIsProof = true } = {}) {
  const live = new Set(alive);
  return {
    isAlive: (pid) => live.has(pid),
    commandLines: async () => cmdline,
    pidIsProof,
  };
}

function write(id, state) {
  fs.writeFileSync(path.join(dir, id + ".json"), JSON.stringify(state));
}

function ids() {
  return fs.readdirSync(dir).sort();
}

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-liveness-"));
});
test.afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test("retires a launched session whose process is gone", async () => {
  write("gone", { ts: OLD, pid: 4242, launched: true, state: "active" });
  const { dead } = await pruneDeadSessions(
    dir,
    probes({ cmdline: "claude --session-id other\n/bin/zsh -il\n" }),
    NOW
  );
  assert.deepStrictEqual(dead, ["gone"]);
  assert.deepStrictEqual(ids(), []);
});

test("keeps a session whose recorded pid is still running", async () => {
  write("live", { ts: OLD, pid: 4242, launched: true, state: "idle" });
  const { dead } = await pruneDeadSessions(dir, probes({ alive: [4242] }), NOW);
  assert.deepStrictEqual(dead, []);
  assert.deepStrictEqual(ids(), ["live.json"]);
});

test("keeps a session Claude still carries on its argv, even with a stale pid", async () => {
  // The resume case: the session was restarted into another process, so the
  // recorded pid is gone, but the id is still on a live Claude's command line.
  write("resumed", { ts: OLD, pid: 4242, launched: true, state: "idle" });
  const { dead } = await pruneDeadSessions(
    dir,
    probes({ cmdline: "claude --session-id resumed -w\n" }),
    NOW
  );
  assert.deepStrictEqual(dead, []);
  assert.deepStrictEqual(ids(), ["resumed.json"]);
});

test("a bare mention of the id does not count as alive", async () => {
  // Our own `pkill -f <id>`, or the user grepping for it, must not vote.
  write("gone", { ts: OLD, pid: 4242, launched: true, state: "idle" });
  const { dead } = await pruneDeadSessions(
    dir,
    probes({ cmdline: "pkill -f gone\ngrep -r gone .\n" }),
    NOW
  );
  assert.deepStrictEqual(dead, ["gone"]);
});

test("leaves a session whose last event is within the grace period", async () => {
  write("fresh", { ts: NOW - 5_000, pid: 4242, launched: true, state: "active" });
  const { dead, recheckIn } = await pruneDeadSessions(dir, probes(), NOW);
  assert.deepStrictEqual(dead, []);
  assert.deepStrictEqual(ids(), ["fresh.json"]);
  // Its file will never be written again, so the caller is told when to look
  // again rather than waiting for a watcher event that never comes.
  assert.strictEqual(recheckIn, 55_000);
});

test("asks for a recheck at the earliest deadline, and only when one is due", async () => {
  write("soon", { ts: NOW - 50_000, pid: 11, launched: true, state: "idle" });
  write("later", { ts: NOW - 10_000, pid: 12, launched: true, state: "idle" });
  write("running", { ts: NOW - 1_000, pid: 13, launched: true, state: "active" });
  let r = await pruneDeadSessions(dir, probes({ alive: [13] }), NOW);
  assert.strictEqual(r.recheckIn, 10_000);

  // Nothing judgeable left pending: a live pid needs no recheck.
  fs.rmSync(path.join(dir, "soon.json"));
  fs.rmSync(path.join(dir, "later.json"));
  r = await pruneDeadSessions(dir, probes({ alive: [13] }), NOW);
  assert.strictEqual(r.recheckIn, 0);
});

test("retires a session started outside the extension by its dead pid", async () => {
  // No launch marker (a bare `claude` in some terminal), so the pid is all we
  // have — and on POSIX its absence is proof. No process scan is needed.
  let scans = 0;
  const p = probes();
  p.commandLines = async () => {
    scans++;
    return "";
  };
  write("bare", { ts: OLD, pid: 4242, state: "idle" });
  const { dead } = await pruneDeadSessions(dir, p, NOW);
  assert.deepStrictEqual(dead, ["bare"]);
  assert.strictEqual(scans, 0, "no process scan for a pid-only verdict");
});

test("keeps a pid-only session where the pid is not proof (Windows)", async () => {
  write("bare", { ts: OLD, pid: 4242, state: "idle" });
  const { dead } = await pruneDeadSessions(dir, probes({ pidIsProof: false }), NOW);
  assert.deepStrictEqual(dead, []);
  assert.deepStrictEqual(ids(), ["bare.json"]);
});

test("still retires a launched session where the pid is not proof (Windows)", async () => {
  write("gone", { ts: OLD, pid: 4242, launched: true, state: "active" });
  const { dead } = await pruneDeadSessions(
    dir,
    probes({ pidIsProof: false, cmdline: "claude --session-id other\n" }),
    NOW
  );
  assert.deepStrictEqual(dead, ["gone"]);
});

test("keeps everything when the process scan could not run", async () => {
  // An empty scan means "we could not look", not "nothing is running".
  write("gone", { ts: OLD, launched: true, state: "active" });
  const { dead } = await pruneDeadSessions(
    dir,
    probes({ pidIsProof: false, cmdline: "" }),
    NOW
  );
  assert.deepStrictEqual(dead, []);
  assert.deepStrictEqual(ids(), ["gone.json"]);
});

test("leaves a file from an emitter that records neither marker", async () => {
  write("legacy", { ts: OLD, state: "idle" });
  const { dead } = await pruneDeadSessions(dir, probes(), NOW);
  assert.deepStrictEqual(dead, []);
  assert.deepStrictEqual(ids(), ["legacy.json"]);
});

test("ignores unparseable files and non-json entries", async () => {
  fs.writeFileSync(path.join(dir, "partial.json"), "{not json");
  fs.writeFileSync(path.join(dir, "note.txt"), "ignored");
  const { dead } = await pruneDeadSessions(dir, probes(), NOW);
  assert.deepStrictEqual(dead, []);
  assert.deepStrictEqual(ids(), ["note.txt", "partial.json"]);
});

test("scans the process table once for a batch of suspects", async () => {
  let scans = 0;
  const p = probes();
  p.commandLines = async () => {
    scans++;
    return "claude --session-id b\n";
  };
  write("a", { ts: OLD, pid: 11, launched: true, state: "idle" });
  write("b", { ts: OLD, pid: 12, launched: true, state: "active" });
  write("c", { ts: OLD, pid: 13, launched: true, state: "idle" });
  const { dead } = await pruneDeadSessions(dir, p, NOW);
  assert.deepStrictEqual(dead.sort(), ["a", "c"]);
  assert.strictEqual(scans, 1);
  assert.deepStrictEqual(ids(), ["b.json"]);
});

test("a missing sessions dir is not an error", async () => {
  const { dead } = await pruneDeadSessions(
    path.join(dir, "nope"),
    probes(),
    NOW
  );
  assert.deepStrictEqual(dead, []);
});
