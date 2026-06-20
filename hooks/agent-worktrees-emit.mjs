#!/usr/bin/env node
/**
 * Agent Worktrees state emitter for Claude Code hooks.
 *
 * Reads a hook payload (JSON) on stdin, derives the session's worktree from
 * git, maps the hook event to an agent status (active | waiting | idle), and
 * writes one state file per session that the VS Code panel watches.
 *
 * One script handles every event — it switches on `hook_event_name`.
 *
 * State dir resolution:
 *   $AGENT_WORKTREES_DIR (absolute), else  ~/.claude/agent-worktrees/sessions
 *
 * Per-session file: <dir>/<session_id>.json
 *   = { sessionId, worktree, branch, state, task, model, startedAt, ts }
 * SessionEnd removes the file so the agent disappears when its session exits.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

const SESSIONS_DIR =
  process.env.AGENT_WORKTREES_DIR ||
  join(homedir(), ".claude", "agent-worktrees", "sessions");

function readStdin() {
  try {
    // fd 0 = stdin; Claude Code pipes the hook payload here
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function git(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

// Hook event -> agent status. Anything not listed falls back to "active".
const EVENT_STATE = {
  SessionStart: "idle",
  UserPromptSubmit: "active",
  PreToolUse: "active",
  PostToolUse: "active",
  SubagentStop: "active",
  Notification: "waiting",
  Stop: "idle",
};

/** File-name safe ids only; anything else is rejected so we never write
 *  outside the sessions dir. */
function safeId(s) {
  return typeof s === "string" && /^[A-Za-z0-9._-]+$/.test(s) ? s : null;
}

/** Reduce a Skill tool's `skill` input to its bare name: `plugin:foo` and
 *  `path/to/foo` both normalize to `foo`, so the panel dedupes either form. */
function normalizeSkill(raw) {
  if (typeof raw !== "string") return null;
  const n = raw
    .split(/[/:\\]/)
    .filter(Boolean)
    .pop();
  return n && /^[a-z0-9][a-z0-9._-]*$/i.test(n) ? n : null;
}

function main() {
  let payload = {};
  const raw = readStdin();
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      /* tolerate non-JSON */
    }
  }

  const event = payload.hook_event_name || process.argv[2] || "Notification";
  const cwd = payload.cwd || process.cwd();

  const top = git(cwd, ["rev-parse", "--show-toplevel"]) || cwd;
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]) || "HEAD";

  // session id keys the file; fall back to a sanitized worktree name so a bare
  // session that named no id still tracks (one agent per worktree in that case).
  const id =
    safeId(payload.session_id) ||
    safeId(basename(top).replace(/[^A-Za-z0-9._-]/g, "_")) ||
    "session";

  mkdirSync(SESSIONS_DIR, { recursive: true });
  const target = join(SESSIONS_DIR, id + ".json");

  // A genuine exit retires the agent immediately.
  if (event === "SessionEnd") {
    rmSync(target, { force: true });
    return;
  }

  // Carry fields forward across events: the work summary (last prompt), the
  // user-given name, and the first-seen timestamp, so the panel keeps showing
  // what the agent is working on rather than resetting on every event.
  let prior = {};
  try {
    prior = JSON.parse(readFileSync(target, "utf8"));
  } catch {
    /* first event for this session, or unreadable */
  }
  const now = Date.now();
  let name = typeof prior.name === "string" ? prior.name : undefined;

  // Accumulate the skills this session has invoked. PreToolUse fires the moment
  // a Skill tool starts, so this captures skills the agent has "started to use".
  // Carried forward across events; deduped by bare name.
  const skills = Array.isArray(prior.skills)
    ? prior.skills.filter((s) => typeof s === "string")
    : [];
  if (event === "PreToolUse" && payload.tool_name === "Skill") {
    const skill = normalizeSkill(payload.tool_input && payload.tool_input.skill);
    if (skill && !skills.includes(skill)) skills.push(skill);
  }

  // Pseudo-command: `/rename-agent <name>` typed in the session (optional
  // leading whitespace, nothing else before the slash). `/rename` is a Claude
  // built-in handled client-side that never reaches a hook, so we use our own
  // name. Handled entirely here — set the agent's name and block the prompt
  // with exit 2 so Claude never processes it as a message.
  if (event === "UserPromptSubmit" && typeof payload.prompt === "string") {
    const m = payload.prompt.match(/^\s*\/rename-agent\s+(\S.*)$/);
    if (m) {
      name = m[1].replace(/\s+/g, " ").trim().slice(0, 80);
      writeFileSync(
        target,
        JSON.stringify({
          sessionId: id,
          worktree: top,
          branch,
          state: typeof prior.state === "string" ? prior.state : "idle",
          model: prior.model || payload.model || "claude",
          startedAt:
            typeof prior.startedAt === "number" ? prior.startedAt : now,
          ts: now,
          ...(prior.task ? { task: prior.task } : {}),
          ...(name ? { name } : {}),
          ...(skills.length ? { skills } : {}),
        }) + "\n"
      );
      process.stderr.write(`Agent Worktrees: renamed agent to "${name}"\n`);
      process.exit(2);
    }
  }

  const state = EVENT_STATE[event] || "active";

  let task = typeof prior.task === "string" ? prior.task : "";
  if (event === "UserPromptSubmit" && payload.prompt)
    task = String(payload.prompt).replace(/\s+/g, " ").trim().slice(0, 120);

  let startedAt = typeof prior.startedAt === "number" ? prior.startedAt : now;
  // A genuinely new session (startup, not resume) clears any stale summary and
  // restarts the clock.
  if (event === "SessionStart" && payload.source === "startup") {
    task = "";
    startedAt = now;
  }

  const ev = {
    sessionId: id,
    worktree: top,
    branch,
    state,
    model: payload.model || "claude",
    startedAt,
    ts: now,
    ...(task ? { task } : {}),
    ...(name ? { name } : {}),
    ...(skills.length ? { skills } : {}),
  };

  writeFileSync(target, JSON.stringify(ev) + "\n");
}

main();
