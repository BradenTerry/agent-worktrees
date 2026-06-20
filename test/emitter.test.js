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

test("UserPromptSubmit marks active but does not store the prompt as the task", () => {
  const r = run({
    hook_event_name: "UserPromptSubmit",
    session_id: SID,
    cwd: repo,
    prompt: "do the thing",
  });
  assert.strictEqual(r.status, 0);
  const s = stateOf(SID);
  assert.strictEqual(s.state, "active");
  // No ai-title yet, so the summary stays empty rather than echoing the prompt.
  assert.ok(!s.task, "the raw prompt is not stored as the task");
});

test("prefers Claude's ai-title from the transcript over the raw prompt", () => {
  const sid = "session-title";
  const transcript = path.join(dir, sid + ".jsonl");
  fs.writeFileSync(
    transcript,
    [
      JSON.stringify({ type: "user", sessionId: sid }),
      JSON.stringify({ type: "ai-title", aiTitle: "Old title", sessionId: sid }),
      JSON.stringify({ type: "assistant", sessionId: sid }),
      JSON.stringify({
        type: "ai-title",
        aiTitle: "Refactor the auth flow",
        sessionId: sid,
      }),
    ].join("\n") + "\n"
  );
  const r = run({
    hook_event_name: "UserPromptSubmit",
    session_id: sid,
    cwd: repo,
    prompt: "fix this please",
    transcript_path: transcript,
  });
  assert.strictEqual(r.status, 0);
  const s = stateOf(sid);
  // The latest ai-title wins, not the prompt and not the earlier title.
  assert.strictEqual(s.task, "Refactor the auth flow");
});

test("leaves the task empty when the transcript has no ai-title", () => {
  const sid = "session-notitle";
  const transcript = path.join(dir, sid + ".jsonl");
  fs.writeFileSync(
    transcript,
    JSON.stringify({ type: "assistant", sessionId: sid }) + "\n"
  );
  const r = run({
    hook_event_name: "UserPromptSubmit",
    session_id: sid,
    cwd: repo,
    prompt: "do the other thing",
    transcript_path: transcript,
  });
  assert.strictEqual(r.status, 0);
  assert.ok(!stateOf(sid).task, "the prompt is never used as a fallback summary");
});

test("Stop marks idle", () => {
  run({ hook_event_name: "Stop", session_id: SID, cwd: repo });
  const s = stateOf(SID);
  assert.strictEqual(s.state, "idle");
});

test("counts each Task tool call as a subagent and carries the tally forward", () => {
  const sid = "session-subagents";
  // No subagents yet: a plain prompt leaves the count off the state file.
  run({ hook_event_name: "UserPromptSubmit", session_id: sid, cwd: repo });
  assert.strictEqual(stateOf(sid).subagents, undefined);

  // Two Task spawns -> two subagents, accumulated across events.
  run({
    hook_event_name: "PreToolUse",
    session_id: sid,
    cwd: repo,
    tool_name: "Task",
  });
  run({
    hook_event_name: "PreToolUse",
    session_id: sid,
    cwd: repo,
    tool_name: "Task",
  });
  assert.strictEqual(stateOf(sid).subagents, 2);

  // A non-Task tool does not bump the count, but keeps the carried tally.
  run({
    hook_event_name: "PreToolUse",
    session_id: sid,
    cwd: repo,
    tool_name: "Bash",
  });
  assert.strictEqual(stateOf(sid).subagents, 2);
});

test("SessionEnd removes the state file", () => {
  const r = run({ hook_event_name: "SessionEnd", session_id: SID, cwd: repo });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(fs.existsSync(path.join(sessions, SID + ".json")), false);
});
