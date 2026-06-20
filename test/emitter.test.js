"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const EMITTER = path.join(__dirname, "..", "hooks", "agent-worktrees-emit.mjs");

let dir;
let sessions;
let repo;

function run(payload) {
  return spawnSync("node", [EMITTER], {
    input: JSON.stringify(payload),
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, AGENT_WORKTREES_DIR: sessions },
  });
}

function stateOf(sid) {
  return JSON.parse(fs.readFileSync(path.join(sessions, sid + ".json"), "utf8"));
}

test.before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-emit-test-"));
  sessions = path.join(dir, "sessions");
  repo = path.join(dir, "repo");
  fs.mkdirSync(repo);
  execFileSync("git", ["init", "-b", "main"], { cwd: repo, stdio: "ignore" });
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const SID = "session-a";

test("SessionStart writes an idle state with the worktree", () => {
  const r = run({
    hook_event_name: "SessionStart",
    session_id: SID,
    cwd: repo,
    source: "startup",
  });
  assert.strictEqual(r.status, 0);
  const s = stateOf(SID);
  assert.strictEqual(s.state, "idle");
  assert.strictEqual(s.sessionId, SID);
  assert.match(s.worktree, /repo$/);
});

test("UserPromptSubmit marks active and records the prompt as the task", () => {
  const r = run({
    hook_event_name: "UserPromptSubmit",
    session_id: SID,
    cwd: repo,
    prompt: "do the thing",
  });
  assert.strictEqual(r.status, 0);
  const s = stateOf(SID);
  assert.strictEqual(s.state, "active");
  assert.strictEqual(s.task, "do the thing");
});

test("/rename-agent sets the name and blocks the prompt (exit 2)", () => {
  const r = run({
    hook_event_name: "UserPromptSubmit",
    session_id: SID,
    cwd: repo,
    prompt: "/rename-agent My Cool Agent",
  });
  assert.strictEqual(r.status, 2, "exit 2 blocks the prompt");
  assert.match(r.stderr, /renamed/i);
  const s = stateOf(SID);
  assert.strictEqual(s.name, "My Cool Agent");
  assert.strictEqual(s.task, "do the thing", "the command is not stored as a task");
});

test("Stop marks idle and carries the name forward", () => {
  run({ hook_event_name: "Stop", session_id: SID, cwd: repo });
  const s = stateOf(SID);
  assert.strictEqual(s.state, "idle");
  assert.strictEqual(s.name, "My Cool Agent");
});

test("SessionEnd removes the state file", () => {
  const r = run({ hook_event_name: "SessionEnd", session_id: SID, cwd: repo });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(fs.existsSync(path.join(sessions, SID + ".json")), false);
});

test("a slash command with text before it is a normal prompt, not a rename", () => {
  const sid = "session-b";
  run({
    hook_event_name: "SessionStart",
    session_id: sid,
    cwd: repo,
    source: "startup",
  });
  const r = run({
    hook_event_name: "UserPromptSubmit",
    session_id: sid,
    cwd: repo,
    prompt: "please /rename-agent later",
  });
  assert.strictEqual(r.status, 0, "not blocked");
  const s = stateOf(sid);
  assert.strictEqual(s.state, "active");
  assert.ok(!s.name, "no name set");
});
