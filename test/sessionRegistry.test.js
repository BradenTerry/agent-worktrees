"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  mapStatus,
  registryDir,
  projectsDir,
  readRegistry,
  indexRegistry,
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

test("mapStatus turns Claude's statuses into the panel's three", () => {
  assert.strictEqual(mapStatus("busy"), "active");
  // A local bash command is not an LLM turn, but it is work in progress.
  assert.strictEqual(mapStatus("shell"), "active");
  assert.strictEqual(mapStatus("waiting"), "waiting");
  assert.strictEqual(mapStatus("idle"), "idle");
});

test("mapStatus refuses to guess at anything it does not know", () => {
  // A status Claude adds later must read as "nothing recorded" rather than
  // collapsing to a default that asserts something untrue.
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

test("indexRegistry groups live sessions onto their worktree cards", () => {
  const idx = indexRegistry(
    [
      { sessionId: "s1", pid: 1, cwd: REPO, status: "active", startedAt: 10, lastActivity: 11 },
      { sessionId: "s2", pid: 2, cwd: path.join(FEATURE, "src"), status: "waiting", startedAt: 20, lastActivity: 21 },
    ],
    [REPO, FEATURE]
  );
  assert.deepStrictEqual(
    idx.agents.get(REPO).map((a) => [a.sessionId, a.status]),
    [["s1", "active"]]
  );
  // Longest match wins, or every nested worktree's agents would pile onto the
  // repo root's card.
  assert.deepStrictEqual(
    idx.agents.get(normalize(FEATURE)).map((a) => [a.sessionId, a.status]),
    [["s2", "waiting"]]
  );
});

test("a session Claude recorded no status for reads idle", () => {
  const idx = indexRegistry(
    [{ sessionId: "s1", pid: 1, cwd: REPO, startedAt: 1, lastActivity: 2 }],
    [REPO]
  );
  assert.strictEqual(idx.agents.get(REPO)[0].status, "idle");
});

test("rows are labelled with the work summary, in start order", () => {
  const idx = indexRegistry(
    [
      { sessionId: "s1", pid: 1, cwd: REPO, startedAt: 200, lastActivity: 1 },
      { sessionId: "s2", pid: 2, cwd: REPO, startedAt: 100, lastActivity: 1 },
    ],
    [REPO],
    new Map([["s1", "  port the git tests  "]])
  );
  // Oldest first; the titled session keeps its summary, the other falls back to
  // an ordinal that counts rows on the card, not sessions overall.
  assert.deepStrictEqual(
    idx.agents.get(REPO).map((a) => [a.sessionId, a.label, a.summary]),
    [
      ["s2", "Claude 1", undefined],
      ["s1", "port the git tests", "port the git tests"],
    ]
  );
});

test("a session outside every worktree has no card and is skipped", () => {
  const idx = indexRegistry(
    [
      {
        sessionId: "s4",
        pid: 4,
        cwd: path.join(os.tmpdir(), "elsewhere"),
        status: "active",
        startedAt: 1,
        lastActivity: 1,
      },
    ],
    [REPO]
  );
  assert.strictEqual(idx.agents.size, 0);
});

test("indexRegistry reports no subagents, since the registry has none", () => {
  // They run inside the parent's process, so they have no file of their own.
  const idx = indexRegistry(
    [{ sessionId: "s1", pid: 1, cwd: REPO, startedAt: 1, lastActivity: 1 }],
    [REPO]
  );
  assert.strictEqual(idx.subagents.size, 0);
  assert.deepStrictEqual(idx.agents.get(REPO)[0].subagents, []);
});

test("an empty registry produces no cards' worth of agents", () => {
  assert.strictEqual(indexRegistry([], [REPO]).agents.size, 0);
});

test("projectsDir sits beside the registry in Claude's config tree", () => {
  assert.strictEqual(
    projectsDir({ CLAUDE_CONFIG_DIR: "/cfg" }, "/home/u"),
    path.join("/cfg", "projects")
  );
});

/**
 * Naming the subagent behind a permission prompt. The signal is split: the
 * subagent's files say it has a call out, the parent's status says someone is
 * being asked.
 */

const busy = (over = {}) => ({ id: "s", startedAt: 1, outstanding: true, ...over });

test("a waiting session names its one subagent mid-call as the one asking", () => {
  const subs = [busy({ id: "blocked" })];
  const idx = indexRegistry(
    [{ sessionId: "s1", pid: 1, cwd: REPO, status: "waiting", startedAt: 1, lastActivity: 2 }],
    [REPO],
    new Map(),
    new Map([["s1", subs]])
  );
  assert.strictEqual(idx.agents.get(REPO)[0].subagents[0].awaitingPermission, true);
});

test("an active session's mid-call subagent is just running a tool", () => {
  // Same file state; only the parent's status differs, and it is what decides.
  const subs = [busy({ id: "working" })];
  indexRegistry(
    [{ sessionId: "s1", pid: 1, cwd: REPO, status: "active", startedAt: 1, lastActivity: 2 }],
    [REPO],
    new Map(),
    new Map([["s1", subs]])
  );
  assert.strictEqual(subs[0].awaitingPermission, undefined);
});

test("several subagents mid-call stay unattributed rather than guessing", () => {
  // The row only earns its place if it names the right one.
  const subs = [busy({ id: "a" }), busy({ id: "b" })];
  indexRegistry(
    [{ sessionId: "s1", pid: 1, cwd: REPO, status: "waiting", startedAt: 1, lastActivity: 2 }],
    [REPO],
    new Map(),
    new Map([["s1", subs]])
  );
  assert.deepStrictEqual(
    subs.map((s) => s.awaitingPermission),
    [undefined, undefined]
  );
});

test("attribution clears once the session stops waiting", () => {
  const subs = [busy({ id: "blocked", awaitingPermission: true })];
  indexRegistry(
    [{ sessionId: "s1", pid: 1, cwd: REPO, status: "active", startedAt: 1, lastActivity: 2 }],
    [REPO],
    new Map(),
    new Map([["s1", subs]])
  );
  assert.strictEqual(subs[0].awaitingPermission, undefined, "a stale prompt cue is worse than none");
});

test("a subagent worktree with no card is reported, not silently swallowed", () => {
  // `isolation: "worktree"` creates a real worktree mid-turn, long after the
  // panel last ran `git worktree list`. With no card to land on the row falls
  // back to its parent, which is what made fanned-out subagents look like they
  // were all working in the parent's checkout. Reporting the path is how the
  // agent-only refresh knows to re-gather and get the card.
  const isolated = path.join(REPO, ".claude", "worktrees", "agent-a1");
  const subs = [busy({ id: "a1", worktree: isolated })];
  const idx = indexRegistry(
    [{ sessionId: "s1", pid: 1, cwd: REPO, status: "active", startedAt: 1, lastActivity: 2 }],
    [REPO],
    new Map(),
    new Map([["s1", subs]])
  );
  assert.deepStrictEqual(idx.unplaced, [isolated]);
  assert.strictEqual(idx.subagents.size, 0, "nowhere to put it yet");
  assert.strictEqual(subs[0].worktree, undefined, "so it renders under its parent");
});

test("once the card exists the subagent moves onto it", () => {
  const isolated = path.join(REPO, ".claude", "worktrees", "agent-a1");
  const subs = [busy({ id: "a1", worktree: isolated })];
  const idx = indexRegistry(
    [{ sessionId: "s1", pid: 1, cwd: REPO, status: "active", startedAt: 1, lastActivity: 2 }],
    [REPO, isolated],
    new Map(),
    new Map([["s1", subs]])
  );
  assert.deepStrictEqual(idx.unplaced, []);
  assert.deepStrictEqual(
    idx.subagents.get(normalize(isolated)).map((s) => s.id),
    ["a1"]
  );
  assert.strictEqual(
    idx.agents.get(REPO)[0].subagents.length,
    1,
    "and still counts on the parent row"
  );
});
