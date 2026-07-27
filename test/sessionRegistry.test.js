"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  mapStatus,
  registryDir,
  readRegistry,
  mergeRegistry,
} = require("../out/sessionRegistry.js");
const { normalizePath: normalize } = require("../out/worktreeUtils.js");

/**
 * Claude Code's own session registry as a status source.
 *
 * Every case fakes the liveness probe, so nothing here depends on real
 * processes: `alive` is the set of pids that exist.
 */

const REPO = normalize(path.join(os.tmpdir(), "awt-repo"));
const FEATURE = path.join(REPO, "wt", "feature");
const ALIVE = () => true;

/** A registry dir seeded with the given files (name -> object or string). */
function seed(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "awt-registry-"));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(
      path.join(dir, name),
      typeof body === "string" ? body : JSON.stringify(body)
    );
  }
  return dir;
}

/** The shape Claude writes, verified against a real 2.1.220 session file. */
function entry(over = {}) {
  return {
    pid: 567,
    sessionId: "s1",
    cwd: REPO,
    startedAt: 1785193745550,
    version: "2.1.220",
    kind: "interactive",
    entrypoint: "cli",
    ...over,
  };
}

function agent(over = {}) {
  return {
    sessionId: "s1",
    label: "Claude 1",
    skills: [],
    subagents: [],
    status: "idle",
    startedAt: 1000,
    lastActivity: 1000,
    ...over,
  };
}

function index(agents = new Map(), subagents = new Map()) {
  return { agents, subagents };
}

test("mapStatus turns Claude's statuses into the panel's three", () => {
  assert.strictEqual(mapStatus("busy"), "active");
  // A local bash command is not an LLM turn, but it is work in progress.
  assert.strictEqual(mapStatus("shell"), "active");
  assert.strictEqual(mapStatus("waiting"), "waiting");
  assert.strictEqual(mapStatus("idle"), "idle");
});

test("mapStatus refuses to guess at anything it does not know", () => {
  // A status Claude adds later must leave the hook-derived state alone rather
  // than collapsing to a default.
  for (const raw of ["compacting", "", null, undefined, 3, {}]) {
    assert.strictEqual(mapStatus(raw), undefined, JSON.stringify(raw));
  }
});

test("registryDir follows CLAUDE_CONFIG_DIR, else ~/.claude", () => {
  assert.strictEqual(
    registryDir({ CLAUDE_CONFIG_DIR: "/cfg" }, "/home/u"),
    path.join("/cfg", "sessions")
  );
  assert.strictEqual(
    registryDir({}, "/home/u"),
    path.join("/home/u", ".claude", "sessions")
  );
  // An empty value is not a config dir; fall back rather than read "/sessions".
  assert.strictEqual(
    registryDir({ CLAUDE_CONFIG_DIR: "  " }, "/home/u"),
    path.join("/home/u", ".claude", "sessions")
  );
});

test("readRegistry reads a live session, status and all", async () => {
  const dir = seed({ "567.json": entry({ status: "waiting", waitingFor: "permission", name: "fix-tests" }) });
  const [s] = await readRegistry(dir, ALIVE);
  assert.strictEqual(s.sessionId, "s1");
  assert.strictEqual(s.pid, 567);
  assert.strictEqual(s.status, "waiting");
  assert.strictEqual(s.waitingFor, "permission");
  assert.strictEqual(s.name, "fix-tests");
  assert.strictEqual(s.startedAt, 1785193745550);
  assert.ok(s.lastActivity > 0, "last write time is carried");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("readRegistry keeps a session whose file carries no status", async () => {
  // Observed on 2.1.220 for a session whose entrypoint is not a local one: the
  // row still belongs on the card, it just has nothing to say about status.
  const dir = seed({ "567.json": entry() });
  const [s] = await readRegistry(dir, ALIVE);
  assert.strictEqual(s.sessionId, "s1");
  assert.strictEqual(s.status, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("readRegistry drops sessions whose process is gone", async () => {
  // Claude deletes the file on exit; one that was killed leaves it behind. This
  // pid is Claude's own, so its absence is proof on every platform.
  const dir = seed({
    "1.json": entry({ pid: 1, sessionId: "dead" }),
    "2.json": entry({ pid: 2, sessionId: "live" }),
  });
  const out = await readRegistry(dir, (pid) => pid === 2);
  assert.deepStrictEqual(
    out.map((s) => s.sessionId),
    ["live"]
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("readRegistry ignores non-interactive sessions and garbage", async () => {
  const dir = seed({
    "1.json": entry({ pid: 1, sessionId: "headless", kind: "print" }),
    "2.json": "{ not json",
    "3.json": entry({ pid: 3, sessionId: "", cwd: REPO }),
    "4.json": entry({ pid: 4, sessionId: "nocwd", cwd: "" }),
    "notes.txt": "ignored",
    "5.json": entry({ pid: 5, sessionId: "keep" }),
  });
  const out = await readRegistry(dir, ALIVE);
  assert.deepStrictEqual(
    out.map((s) => s.sessionId),
    ["keep"]
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("readRegistry recovers the pid from the file name", async () => {
  // The file is named for the pid, so a missing field is not fatal.
  const raw = entry({ sessionId: "s9" });
  delete raw.pid;
  const dir = seed({ "4242.json": raw });
  const [s] = await readRegistry(dir, (pid) => pid === 4242);
  assert.strictEqual(s.pid, 4242);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a session in both sources takes its status from Claude", () => {
  // The event stream said idle; the process says it is working. Claude wins.
  const a = agent({ status: "idle", summary: "refactor git.ts" });
  const idx = index(new Map([[REPO, [a]]]));
  mergeRegistry(idx, [{ sessionId: "s1", pid: 1, cwd: REPO, status: "active", startedAt: 1, lastActivity: 2 }], [REPO]);
  assert.strictEqual(a.status, "active");
  // Everything the registry knows nothing about is left alone.
  assert.strictEqual(a.summary, "refactor git.ts");
  assert.strictEqual(idx.agents.get(REPO).length, 1, "no duplicate row");
});

test("a corrected status reaches the subagents rendered on other cards", () => {
  // A subagent given its own worktree renders on that card with a cue for
  // "the agent that owns me is blocked on you", from the copy it carries. A
  // status the registry corrects has to reach that copy or the cue lies.
  const parent = agent({ sessionId: "s1", status: "active", summary: "port tests" });
  const sub = {
    id: "sub1",
    startedAt: 10,
    parentSessionId: "s1",
    parentLabel: "port tests",
    parentStatus: "active",
  };
  const idx = index(new Map([[REPO, [parent]]]), new Map([[FEATURE, [sub]]]));
  mergeRegistry(
    idx,
    [{ sessionId: "s1", pid: 1, cwd: REPO, status: "waiting", startedAt: 1, lastActivity: 2 }],
    [REPO]
  );
  assert.strictEqual(parent.status, "waiting");
  assert.strictEqual(sub.parentStatus, "waiting");
});

test("a status Claude did not record leaves the hook state alone", () => {
  const a = agent({ status: "waiting" });
  const idx = index(new Map([[REPO, [a]]]));
  mergeRegistry(idx, [{ sessionId: "s1", pid: 1, cwd: REPO, startedAt: 1, lastActivity: 2 }], [REPO]);
  assert.strictEqual(a.status, "waiting");
});

test("a session only Claude knows about becomes a row", () => {
  // Started before the hooks were installed, or resumed where the emitter never
  // saw it: the card should still show the agent that is really running there.
  const idx = index();
  mergeRegistry(
    idx,
    [{ sessionId: "s2", pid: 2, cwd: REPO, status: "active", name: "ship it", startedAt: 5, lastActivity: 6 }],
    [REPO]
  );
  const [row] = idx.agents.get(REPO);
  assert.strictEqual(row.sessionId, "s2");
  assert.strictEqual(row.status, "active");
  assert.strictEqual(row.label, "ship it");
  assert.strictEqual(row.summary, "ship it");
  assert.deepStrictEqual(row.subagents, [], "the registry knows of no subagents");
});

test("an unnamed registry session gets an ordinal, in start order", () => {
  const first = agent({ sessionId: "s1", startedAt: 100 });
  const idx = index(new Map([[REPO, [first]]]));
  mergeRegistry(
    idx,
    [{ sessionId: "s2", pid: 2, cwd: REPO, startedAt: 50, lastActivity: 60 }],
    [REPO]
  );
  const list = idx.agents.get(REPO);
  assert.deepStrictEqual(
    list.map((a) => [a.sessionId, a.label]),
    [
      ["s2", "Claude 1"],
      ["s1", "Claude 2"],
    ]
  );
});

test("relabelling follows through to subagents on other cards", () => {
  // A subagent rendered on another worktree's card names its parent; an ordinal
  // that shifts must not leave it pointing at a label nobody has.
  const parent = agent({ sessionId: "s1", startedAt: 100 });
  const sub = {
    id: "sub1",
    startedAt: 10,
    parentSessionId: "s1",
    parentLabel: "Claude 1",
    parentStatus: "active",
  };
  const idx = index(new Map([[REPO, [parent]]]), new Map([[FEATURE, [sub]]]));
  mergeRegistry(
    idx,
    [{ sessionId: "s2", pid: 2, cwd: REPO, startedAt: 50, lastActivity: 60 }],
    [REPO]
  );
  assert.strictEqual(parent.label, "Claude 2");
  assert.strictEqual(sub.parentLabel, "Claude 2");
});

test("a session working under a nested worktree lands on that card", () => {
  // Longest match wins, or every nested worktree's agents would pile onto the
  // repo root's card.
  const idx = index();
  mergeRegistry(
    idx,
    [{ sessionId: "s3", pid: 3, cwd: path.join(FEATURE, "src"), status: "active", startedAt: 1, lastActivity: 1 }],
    [REPO, FEATURE]
  );
  assert.strictEqual(idx.agents.has(REPO), false);
  assert.strictEqual(idx.agents.get(normalize(FEATURE))[0].sessionId, "s3");
});

test("a session outside every worktree has no card and is skipped", () => {
  const idx = index();
  mergeRegistry(
    idx,
    [{ sessionId: "s4", pid: 4, cwd: path.join(os.tmpdir(), "elsewhere"), status: "active", startedAt: 1, lastActivity: 1 }],
    [REPO]
  );
  assert.strictEqual(idx.agents.size, 0);
});

test("an empty registry changes nothing", () => {
  const a = agent({ status: "waiting" });
  const idx = index(new Map([[REPO, [a]]]));
  mergeRegistry(idx, [], [REPO]);
  assert.strictEqual(a.status, "waiting");
  assert.strictEqual(idx.agents.get(REPO).length, 1);
});
