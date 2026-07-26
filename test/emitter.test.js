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

test("tracks only the subagents that are running right now", () => {
  const sid = "session-subagents";
  // Nothing running: a plain prompt leaves the field off the state file.
  run({ hook_event_name: "UserPromptSubmit", session_id: sid, cwd: repo });
  assert.strictEqual(stateOf(sid).subagents, undefined);

  // The Agent tool call parks its description; the SubagentStart that follows
  // claims it, so the row is labelled with the work, not just the agent type.
  run({
    hook_event_name: "PreToolUse",
    session_id: sid,
    cwd: repo,
    tool_name: "Agent",
    tool_input: { subagent_type: "Explore", description: "Map the callers" },
  });
  assert.strictEqual(stateOf(sid).subagents, undefined);
  run({
    hook_event_name: "SubagentStart",
    session_id: sid,
    cwd: repo,
    agent_id: "sub-1",
    agent_type: "Explore",
  });
  const started = stateOf(sid);
  assert.strictEqual(started.state, "active");
  assert.deepStrictEqual(
    started.subagents.map((s) => [s.id, s.type, s.task]),
    [["sub-1", "Explore", "Map the callers"]]
  );
  // The parked description was consumed, not left to mislabel a later start.
  assert.strictEqual(started.pendingSubagents, undefined);

  // A second, concurrent subagent. `Task` is the Agent tool's name before
  // Claude Code 2.1.63 and parks a description the same way.
  run({
    hook_event_name: "PreToolUse",
    session_id: sid,
    cwd: repo,
    tool_name: "Task",
    tool_input: { subagent_type: "nocturne", description: "Port the tests" },
  });
  run({
    hook_event_name: "SubagentStart",
    session_id: sid,
    cwd: repo,
    agent_id: "sub-2",
    agent_type: "nocturne",
  });
  assert.deepStrictEqual(
    stateOf(sid).subagents.map((s) => s.id),
    ["sub-1", "sub-2"]
  );

  // Finishing one retires exactly that one. The stop carries Claude Code's
  // in-flight registry, which no longer lists it: it is done for good.
  run({
    hook_event_name: "SubagentStop",
    session_id: sid,
    cwd: repo,
    agent_id: "sub-1",
    background_tasks: [
      { id: "sub-2", type: "subagent", status: "running", agent_type: "nocturne" },
    ],
  });
  assert.deepStrictEqual(
    stateOf(sid).subagents.map((s) => s.id),
    ["sub-2"]
  );

  // When the last one finishes the field disappears entirely: the panel shows
  // nothing rather than a tally of everything the session ever ran.
  run({
    hook_event_name: "SubagentStop",
    session_id: sid,
    cwd: repo,
    agent_id: "sub-2",
    background_tasks: [],
  });
  assert.strictEqual(stateOf(sid).subagents, undefined);
});

// A subagent that hands work to a background command stops its turn and waits
// to be woken. Claude Code still lists it as in flight, and retiring it there
// made the row vanish while the subagent was very much still around.
test("a subagent parked on background work stays listed", () => {
  const sid = "session-sub-parked";
  const base = { session_id: sid, cwd: repo };
  run({ hook_event_name: "SessionStart", ...base, source: "startup" });
  run({
    hook_event_name: "PreToolUse",
    ...base,
    tool_name: "Agent",
    tool_input: { subagent_type: "general-purpose", description: "Idle test agent" },
  });
  run({
    hook_event_name: "SubagentStart",
    ...base,
    agent_id: "sub-bg",
    agent_type: "general-purpose",
  });

  // It starts a background sleep and its turn ends. The registry on the stop
  // still lists it, so it stays — flagged paused rather than dropped.
  run({
    hook_event_name: "SubagentStop",
    ...base,
    agent_id: "sub-bg",
    background_tasks: [
      { id: "sub-bg", type: "subagent", status: "running", agent_type: "general-purpose" },
      { id: "task-sleep", type: "shell", status: "running", command: "sleep 60" },
    ],
  });
  let s = stateOf(sid).subagents;
  assert.deepStrictEqual(
    s.map((x) => [x.id, x.task, x.paused]),
    [["sub-bg", "Idle test agent", true]]
  );

  // The parent's own turn ends while the subagent is still parked: still there.
  run({
    hook_event_name: "Stop",
    ...base,
    background_tasks: [
      { id: "sub-bg", type: "subagent", status: "running", agent_type: "general-purpose" },
    ],
  });
  assert.strictEqual(stateOf(sid).subagents.length, 1);

  // The sleep lands and the subagent picks up where it left off: no longer
  // paused, and its start time is not reset.
  const startedAt = stateOf(sid).subagents[0].startedAt;
  run({
    hook_event_name: "PostToolUse",
    ...base,
    agent_id: "sub-bg",
    agent_type: "general-purpose",
    tool_name: "Bash",
  });
  s = stateOf(sid).subagents;
  assert.strictEqual(s[0].paused, undefined);
  assert.strictEqual(s[0].startedAt, startedAt);

  // It finishes for real: the stop's registry no longer lists it.
  run({
    hook_event_name: "SubagentStop",
    ...base,
    agent_id: "sub-bg",
    background_tasks: [],
  });
  assert.strictEqual(stateOf(sid).subagents, undefined);
});

// Notification, the real "needs you" signal, never says which subagent it came
// from. PermissionRequest does, so the two together identify the subagent
// holding a prompt — but PermissionRequest alone must not touch the status.
test("PermissionRequest flags the asking subagent and leaves the status alone", () => {
  const sid = "session-sub-permission";
  const base = { session_id: sid, cwd: repo };
  run({ hook_event_name: "SessionStart", ...base, source: "startup" });
  run({
    hook_event_name: "SubagentStart",
    ...base,
    agent_id: "sub-ask",
    agent_type: "general-purpose",
  });
  run({
    hook_event_name: "SubagentStart",
    ...base,
    agent_id: "sub-quiet",
    agent_type: "Explore",
  });

  // A decision for one of them: flagged, and the state is untouched. Reporting
  // "active" here would clear a waiting state (and the badge) while the user is
  // still answering another prompt.
  run({ hook_event_name: "Notification", ...base, notification_type: "permission_prompt" });
  assert.strictEqual(stateOf(sid).state, "waiting");
  run({
    hook_event_name: "PermissionRequest",
    ...base,
    agent_id: "sub-ask",
    agent_type: "general-purpose",
    tool_name: "Bash",
    tool_input: { command: "rm -rf build" },
  });
  let s = stateOf(sid);
  assert.strictEqual(s.state, "waiting");
  assert.deepStrictEqual(
    s.subagents.map((x) => [x.id, x.awaitingPermission]),
    [
      ["sub-ask", true],
      ["sub-quiet", undefined],
    ]
  );

  // Answering it lets the tool run, and the subagent's own event clears the flag.
  run({
    hook_event_name: "PostToolUse",
    ...base,
    agent_id: "sub-ask",
    agent_type: "general-purpose",
    tool_name: "Bash",
  });
  s = stateOf(sid);
  assert.strictEqual(s.state, "active");
  assert.strictEqual(s.subagents[0].awaitingPermission, undefined);
});

// Stopping an agent from Claude Code's agent manager fires no hook at all: its
// turn never ends, so nothing marks it paused. The registry is what retires it.
test("a backgrounded subagent that is killed leaves the list", () => {
  const sid = "session-sub-killed";
  const base = { session_id: sid, cwd: repo };
  const task = (id) => ({
    id,
    type: "subagent",
    status: "running",
    agent_type: "Explore",
    description: "Long-running UI test agent",
  });
  run({ hook_event_name: "SessionStart", ...base, source: "startup" });
  run({
    hook_event_name: "Stop",
    ...base,
    background_tasks: [task("sub-a"), task("sub-b")],
  });
  assert.strictEqual(stateOf(sid).subagents.length, 2);

  // The user stops the first one. The next turn end is the first payload that
  // can say so, and it does: only the survivor is still in flight.
  run({ hook_event_name: "Stop", ...base, background_tasks: [task("sub-b")] });
  assert.deepStrictEqual(
    stateOf(sid).subagents.map((s) => s.id),
    ["sub-b"]
  );
});

// Claude Code's registry is authoritative, so it also recovers subagents this
// session never saw start — hooks installed while one was already running.
test("the in-flight registry adopts subagents we never saw start", () => {
  const sid = "session-sub-adopt";
  const base = { session_id: sid, cwd: repo };
  run({ hook_event_name: "SessionStart", ...base, source: "startup" });
  run({
    hook_event_name: "Stop",
    ...base,
    background_tasks: [
      {
        id: "sub-orphan",
        type: "subagent",
        status: "running",
        agent_type: "Explore",
        description: "Map the callers",
      },
      { id: "cron-1", type: "monitor", status: "running" },
    ],
  });
  assert.deepStrictEqual(
    stateOf(sid).subagents.map((s) => [s.id, s.type, s.task]),
    [["sub-orphan", "Explore", "Map the callers"]]
  );
});

test("a subagent's own events re-register it and never move its parent's row", () => {
  const sid = "session-sub-events";
  const other = path.join(dir, "other-worktree");
  fs.mkdirSync(other, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: other, stdio: "ignore" });

  run({ hook_event_name: "SessionStart", session_id: sid, cwd: repo, source: "startup" });
  const home = stateOf(sid).worktree;

  // A subagent running in an isolated worktree fires tool events with ITS cwd.
  // Those are still the parent's events, so the parent's card must not move —
  // and the subagent registers even though we never saw its SubagentStart.
  run({
    hook_event_name: "PreToolUse",
    session_id: sid,
    cwd: other,
    agent_id: "sub-iso",
    agent_type: "general-purpose",
    tool_name: "Bash",
  });
  const s = stateOf(sid);
  assert.strictEqual(s.worktree, home);
  assert.deepStrictEqual(
    s.subagents.map((x) => [x.id, x.type]),
    [["sub-iso", "general-purpose"]]
  );

  // Restarting the session clears them: subagents do not survive the process.
  run({ hook_event_name: "SessionStart", session_id: sid, cwd: repo, source: "resume" });
  assert.strictEqual(stateOf(sid).subagents, undefined);
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

test("idle_prompt notification keeps the prior state when nothing is pending", () => {
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

  // A finished turn stays idle: the idle nudge fires a minute after every
  // turn ends, so mapping it to waiting flagged every done agent as waiting
  // on the user forever (a permanent Activity Bar badge).
  run({ hook_event_name: "Stop", ...base });
  assert.strictEqual(stateOf(sid).state, "idle");
  run({
    hook_event_name: "Notification",
    notification_type: "idle_prompt",
    ...base,
  });
  assert.strictEqual(stateOf(sid).state, "idle");

  // An unanswered permission prompt sitting there stays waiting through the
  // idle nudge.
  run({
    hook_event_name: "Notification",
    notification_type: "permission_prompt",
    ...base,
  });
  assert.strictEqual(stateOf(sid).state, "waiting");
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

test("a state write that cannot land never fails the hook", () => {
  // Claude Code prints a "PreToolUse:<tool> hook error ... failed with
  // non-blocking status code" warning for any nonzero exit or stderr output —
  // on PreToolUse, once per tool call. When the sessions dir cannot exist
  // (deleted global storage, a synced settings.json pointing at another
  // machine's path), the emitter must drop the update silently.
  const blocker = path.join(dir, "blocker");
  fs.writeFileSync(blocker, ""); // a FILE where the dir path needs a directory
  const env = {
    ...process.env,
    AGENT_WORKTREES_DIR: path.join(blocker, "sessions"),
  };
  delete env.AGENT_WORKTREES_SID;
  const r = spawnSync("node", [EMITTER], {
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      session_id: "session-unwritable",
      cwd: repo,
    }),
    cwd: repo,
    encoding: "utf8",
    env,
  });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stderr, "");
  assert.strictEqual(r.stdout, "");
});

test("records the pid of the process that ran the hook", () => {
  // Claude Code runs a hook as a direct child of the session process, so the
  // emitter's parent IS the agent — here, this test process. That pid is what
  // lets the panel retire a session that died without firing SessionEnd.
  const sid = "session-pid";
  const r = run({ hook_event_name: "SessionStart", session_id: sid, cwd: repo });
  assert.strictEqual(r.status, 0);
  const s = stateOf(sid);
  assert.strictEqual(s.pid, process.pid);
  assert.ok(!s.launched, "no launch marker without AGENT_WORKTREES_SID");
});

test("marks a session the extension launched", () => {
  // The launch id is also on the live process's argv (`claude --session-id`),
  // so the panel can check that session's liveness without reading parents.
  const sid = "session-launched";
  const env = {
    ...process.env,
    AGENT_WORKTREES_DIR: sessions,
    AGENT_WORKTREES_SID: sid,
  };
  const r = spawnSync("node", [EMITTER], {
    input: JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "some-other-live-id",
      cwd: repo,
    }),
    cwd: repo,
    encoding: "utf8",
    env,
  });
  assert.strictEqual(r.status, 0);
  const s = stateOf(sid);
  assert.strictEqual(s.launched, true);
  assert.strictEqual(s.sessionId, sid);
});

test("a subagent's event does not re-stamp the session's pid", () => {
  // Subagent-fired hooks may come from a shorter-lived process whose exit says
  // nothing about the session, so the pid recorded for the session is kept.
  const sid = "session-subpid";
  run({ hook_event_name: "SessionStart", session_id: sid, cwd: repo });
  const file = path.join(sessions, sid + ".json");
  const seeded = { ...JSON.parse(fs.readFileSync(file, "utf8")), pid: 4242 };
  fs.writeFileSync(file, JSON.stringify(seeded));
  run({
    hook_event_name: "PostToolUse",
    tool_name: "Read",
    session_id: sid,
    agent_id: "sub-1",
    cwd: repo,
  });
  assert.strictEqual(stateOf(sid).pid, 4242);
});

test("SessionEnd removes the state file", () => {
  const r = run({ hook_event_name: "SessionEnd", session_id: SID, cwd: repo });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(fs.existsSync(path.join(sessions, SID + ".json")), false);
});
