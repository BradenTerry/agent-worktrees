"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readSubagents, liveSubagents } = require("../out/subagents.js");

/**
 * Subagent rows, read from the files Claude writes for them.
 *
 * The fixtures mirror a real 2.1.220 subagent verbatim: a meta file of
 * { agentType, description, toolUseId, spawnDepth, model } beside a transcript
 * whose first record carries the cwd and timestamp.
 */

const NOW = 1785200000000;
const AGO = (ms) => new Date(NOW - ms).toISOString();

/** A subagents dir holding the given agents. */
function seed(agents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "awt-subagents-"));
  for (const [id, { meta, records = null, mtimeMs }] of Object.entries(agents)) {
    fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify(meta));
    if (records === null) continue;
    const file = path.join(dir, `agent-${id}.jsonl`);
    fs.writeFileSync(
      file,
      records.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n"
    );
    if (mtimeMs) fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
  }
  return dir;
}

const meta = (over = {}) => ({
  agentType: "Explore",
  description: "Cache the settings read",
  toolUseId: "toolu_01Rp7dJ3Bd",
  spawnDepth: 1,
  model: "haiku",
  ...over,
});

const firstRecord = (over = {}) => ({
  type: "user",
  isSidechain: true,
  agentId: "a27b872a921e5d1c2",
  sessionId: "parent-session",
  cwd: "/repo",
  timestamp: AGO(9 * 60_000),
  message: { role: "user", content: "..." },
  ...over,
});

test("readSubagents reads a subagent the way Claude writes it", async () => {
  const dir = seed({ a1: { meta: meta(), records: [firstRecord()] } });
  const [s] = await readSubagents(dir);
  assert.strictEqual(s.id, "a1");
  assert.strictEqual(s.type, "Explore");
  assert.strictEqual(s.task, "Cache the settings read");
  assert.strictEqual(s.toolUseId, "toolu_01Rp7dJ3Bd");
  // The cwd is what puts a fanned-out subagent on another worktree's card.
  assert.strictEqual(s.worktree, "/repo");
  assert.strictEqual(s.startedAt, NOW - 9 * 60_000);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("readSubagents survives a subagent with no transcript yet", async () => {
  // The meta file lands first; a subagent that has not written a record still
  // deserves a row, dated from the meta file itself.
  const dir = seed({ a1: { meta: meta(), records: null } });
  const [s] = await readSubagents(dir);
  assert.strictEqual(s.id, "a1");
  assert.strictEqual(s.worktree, undefined);
  assert.ok(s.startedAt > 0, "falls back to the meta file's mtime");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("readSubagents ignores half-written and unrelated files", async () => {
  const dir = seed({ good: { meta: meta(), records: [firstRecord()] } });
  fs.writeFileSync(path.join(dir, "agent-broken.meta.json"), "{ not json");
  fs.writeFileSync(path.join(dir, "notes.txt"), "ignored");
  fs.writeFileSync(path.join(dir, "agent-.meta.json"), JSON.stringify(meta()));
  const out = await readSubagents(dir);
  assert.deepStrictEqual(
    out.map((s) => s.id),
    ["good"]
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("readSubagents tolerates a truncated first record", async () => {
  // The transcript is being written as we read it.
  const dir = seed({ a1: { meta: meta(), records: ['{"type":"user","cw'] } });
  const [s] = await readSubagents(dir);
  assert.strictEqual(s.id, "a1");
  assert.strictEqual(s.worktree, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("readSubagents returns nothing when the session has none", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "awt-empty-"));
  assert.deepStrictEqual(await readSubagents(dir), []);
  assert.deepStrictEqual(await readSubagents(path.join(dir, "nope")), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

const sub = (over = {}) => ({
  id: "a1",
  toolUseId: "toolu_1",
  startedAt: NOW - 60_000,
  lastActivity: NOW - 1000,
  ...over,
});

test("liveSubagents retires one whose result reached the parent", () => {
  // The parent transcript carrying a tool result for the Agent call that
  // started it is the authoritative "finished".
  const found = [sub({ id: "done", toolUseId: "toolu_done" }), sub({ id: "running" })];
  const live = liveSubagents(found, new Set(["toolu_done"]), NOW);
  assert.deepStrictEqual(
    live.map((s) => s.id),
    ["running"]
  );
});

test("liveSubagents keeps one with no result yet", () => {
  const live = liveSubagents([sub()], new Set(), NOW);
  assert.strictEqual(live.length, 1);
});

test("liveSubagents drops one that has gone silent", () => {
  // The backstop for a subagent that finished while no window was watching, so
  // its result never appeared in any tail this window read. Wrong for ten
  // minutes rather than forever.
  const stale = sub({ id: "stale", lastActivity: NOW - 20 * 60_000 });
  const fresh = sub({ id: "fresh", lastActivity: NOW - 60_000 });
  const live = liveSubagents([stale, fresh], new Set(), NOW);
  assert.deepStrictEqual(
    live.map((s) => s.id),
    ["fresh"]
  );
});

test("liveSubagents orders by start time, oldest first", () => {
  const live = liveSubagents(
    [
      sub({ id: "b", startedAt: NOW - 10_000 }),
      sub({ id: "a", startedAt: NOW - 90_000 }),
    ],
    new Set(),
    NOW
  );
  assert.deepStrictEqual(
    live.map((s) => s.id),
    ["a", "b"]
  );
});
