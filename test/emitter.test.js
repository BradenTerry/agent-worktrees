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
  // Hermetic env: the emitter keys its state file by AGENT_WORKTREES_SID when
  // set, which would otherwise override every payload's session_id and collapse
  // all writes onto one file. The extension stamps that var into its terminals,
  // so a test run launched from inside such a session would inherit it and fail.
  // Strip it (and any inherited AGENT_WORKTREES_DIR) so the test drives the
  // payload-keyed path it is asserting on.
  const env = { ...process.env, AGENT_WORKTREES_DIR: sessions };
  delete env.AGENT_WORKTREES_SID;
  return spawnSync("node", [EMITTER], {
    input: JSON.stringify(payload),
    cwd: repo,
    encoding: "utf8",
    env,
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

test("reads a custom-title from the transcript, latest of either kind wins", () => {
  const sid = "session-customtitle";
  const transcript = path.join(dir, sid + ".jsonl");
  fs.writeFileSync(
    transcript,
    [
      JSON.stringify({ type: "ai-title", aiTitle: "Auto title", sessionId: sid }),
      JSON.stringify({ type: "assistant", sessionId: sid }),
      JSON.stringify({
        type: "custom-title",
        customTitle: "Worktree UX improvements",
        sessionId: sid,
      }),
    ].join("\n") + "\n"
  );
  const r = run({
    hook_event_name: "UserPromptSubmit",
    session_id: sid,
    cwd: repo,
    prompt: "next task",
    transcript_path: transcript,
  });
  assert.strictEqual(r.status, 0);
  // The custom title was written last, so it wins over the earlier ai-title.
  assert.strictEqual(stateOf(sid).task, "Worktree UX improvements");
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

test("PreToolUse/PostToolUse skip the transcript read; turn boundaries pick the title up", () => {
  // The tool-blocking events must not pay the transcript tail read, so a title
  // that lands mid-turn is ignored until the next non-hot event. The prior task
  // is still carried forward.
  const sid = "session-hotpath";
  const transcript = path.join(dir, sid + ".jsonl");
  fs.writeFileSync(
    transcript,
    JSON.stringify({ type: "ai-title", aiTitle: "First title", sessionId: sid }) +
      "\n"
  );
  const base = { session_id: sid, cwd: repo, transcript_path: transcript };
  run({ hook_event_name: "UserPromptSubmit", ...base });
  assert.strictEqual(stateOf(sid).task, "First title");

  fs.appendFileSync(
    transcript,
    JSON.stringify({ type: "ai-title", aiTitle: "Newer title", sessionId: sid }) +
      "\n"
  );
  run({ hook_event_name: "PreToolUse", tool_name: "Bash", ...base });
  assert.strictEqual(stateOf(sid).task, "First title", "PreToolUse keeps the prior title");
  run({ hook_event_name: "PostToolUse", tool_name: "Bash", ...base });
  assert.strictEqual(stateOf(sid).task, "First title", "PostToolUse keeps the prior title");
  run({ hook_event_name: "Stop", ...base });
  assert.strictEqual(stateOf(sid).task, "Newer title", "Stop reads the latest title");
});

test("PostToolUse flips a waiting agent back to active", () => {
  // The badge regression: Notification (permission prompt / question) marks
  // waiting, and the approved tool finishing is the first event afterwards.
  // Without it the agent stays "waiting" while it is visibly working.
  const sid = "session-approve";
  const base = { session_id: sid, cwd: repo };
  run({ hook_event_name: "PreToolUse", tool_name: "Bash", ...base });
  run({ hook_event_name: "Notification", ...base });
  assert.strictEqual(stateOf(sid).state, "waiting");
  run({ hook_event_name: "PostToolUse", tool_name: "Bash", ...base });
  assert.strictEqual(stateOf(sid).state, "active");
});

test("Stop marks idle", () => {
  run({ hook_event_name: "Stop", session_id: SID, cwd: repo });
  const s = stateOf(SID);
  assert.strictEqual(s.state, "idle");
});

test("counts each Agent/Task tool call as a subagent and carries the tally forward", () => {
  const sid = "session-subagents";
  // No subagents yet: a plain prompt leaves the count off the state file.
  run({ hook_event_name: "UserPromptSubmit", session_id: sid, cwd: repo });
  assert.strictEqual(stateOf(sid).subagents, undefined);

  // One Agent spawn (the tool's current name) and one Task spawn (its name
  // before Claude Code 2.1.63) -> two subagents, accumulated across events.
  run({
    hook_event_name: "PreToolUse",
    session_id: sid,
    cwd: repo,
    tool_name: "Agent",
  });
  run({
    hook_event_name: "PreToolUse",
    session_id: sid,
    cwd: repo,
    tool_name: "Task",
  });
  assert.strictEqual(stateOf(sid).subagents, 2);

  // A non-subagent tool does not bump the count, but keeps the carried tally.
  run({
    hook_event_name: "PreToolUse",
    session_id: sid,
    cwd: repo,
    tool_name: "Bash",
  });
  assert.strictEqual(stateOf(sid).subagents, 2);
});

test("SubagentStop marks active", () => {
  const sid = "session-substop";
  run({ hook_event_name: "Stop", session_id: sid, cwd: repo });
  assert.strictEqual(stateOf(sid).state, "idle");
  run({ hook_event_name: "SubagentStop", session_id: sid, cwd: repo });
  assert.strictEqual(stateOf(sid).state, "active");
});

// A turn that ends with background subagents still running writes a
// turn_duration record with their count; the idle nudge that follows must not
// flag the agent as waiting on the user.
test("idle_prompt notification stays active while background subagents run", () => {
  const sid = "session-delegating";
  const transcript = path.join(dir, sid + ".jsonl");
  fs.writeFileSync(
    transcript,
    [
      JSON.stringify({ type: "system", subtype: "stop_hook_summary" }),
      JSON.stringify({
        type: "system",
        subtype: "turn_duration",
        pendingBackgroundAgentCount: 2,
      }),
    ].join("\n") + "\n"
  );
  const base = { session_id: sid, cwd: repo, transcript_path: transcript };
  run({ hook_event_name: "Stop", ...base });
  assert.strictEqual(stateOf(sid).state, "idle");
  run({
    hook_event_name: "Notification",
    notification_type: "idle_prompt",
    ...base,
  });
  assert.strictEqual(stateOf(sid).state, "active");

  // A permission prompt genuinely needs the user, subagents or not.
  run({
    hook_event_name: "Notification",
    notification_type: "permission_prompt",
    ...base,
  });
  assert.strictEqual(stateOf(sid).state, "waiting");

  // A background subagent finishing re-invokes the parent: active, not waiting.
  run({
    hook_event_name: "Notification",
    notification_type: "agent_completed",
    ...base,
  });
  assert.strictEqual(stateOf(sid).state, "active");
});

test("idle_prompt notification marks waiting when nothing is pending", () => {
  const sid = "session-idle-nudge";
  const transcript = path.join(dir, sid + ".jsonl");
  fs.writeFileSync(
    transcript,
    JSON.stringify({
      type: "system",
      subtype: "turn_duration",
      pendingBackgroundAgentCount: 0,
    }) + "\n"
  );
  const base = { session_id: sid, cwd: repo, transcript_path: transcript };
  run({
    hook_event_name: "Notification",
    notification_type: "idle_prompt",
    ...base,
  });
  assert.strictEqual(stateOf(sid).state, "waiting");

  // No transcript at all (or an old Claude Code with no notification_type):
  // default to waiting, the pre-existing behavior.
  run({ hook_event_name: "Notification", session_id: sid, cwd: repo });
  assert.strictEqual(stateOf(sid).state, "waiting");
});

test("reuses the cached worktree from the prior state when cwd is unchanged", () => {
  const sid = "session-cache";
  run({ hook_event_name: "SessionStart", session_id: sid, cwd: repo });
  const first = stateOf(sid);
  assert.strictEqual(first.cwd, repo, "the cwd cache key is persisted");

  // Seed a fake worktree into the state file. If the next event re-ran git it
  // would overwrite it with the real path; the cache must reuse it instead.
  fs.writeFileSync(
    path.join(sessions, sid + ".json"),
    JSON.stringify({ ...first, worktree: "/cached/worktree" }) + "\n"
  );
  run({
    hook_event_name: "PreToolUse",
    session_id: sid,
    cwd: repo,
    tool_name: "Bash",
  });
  assert.strictEqual(stateOf(sid).worktree, "/cached/worktree");
});

test("re-resolves the worktree when cwd changes or on SessionStart", () => {
  const sid = "session-cache-miss";
  run({ hook_event_name: "SessionStart", session_id: sid, cwd: repo });
  const seed = (worktree) =>
    fs.writeFileSync(
      path.join(sessions, sid + ".json"),
      JSON.stringify({ ...stateOf(sid), worktree }) + "\n"
    );

  // A different cwd misses the cache and resolves the real worktree again.
  seed("/cached/worktree");
  const other = path.join(repo, "sub");
  fs.mkdirSync(other, { recursive: true });
  run({
    hook_event_name: "PreToolUse",
    session_id: sid,
    cwd: other,
    tool_name: "Bash",
  });
  assert.match(stateOf(sid).worktree, /repo$/);

  // SessionStart always re-resolves, even with a matching cwd.
  seed("/cached/worktree");
  run({ hook_event_name: "SessionStart", session_id: sid, cwd: other });
  assert.match(stateOf(sid).worktree, /repo$/);
});

test("SessionEnd removes the state file", () => {
  const r = run({ hook_event_name: "SessionEnd", session_id: SID, cwd: repo });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(fs.existsSync(path.join(sessions, SID + ".json")), false);
});
