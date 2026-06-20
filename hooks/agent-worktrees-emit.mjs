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
 * State dir resolution (first that is set wins):
 *   --dir <path> arg  (how the VS Code extension points us at its global storage)
 *   $AGENT_WORKTREES_DIR
 *   ~/.claude/agent-worktrees/sessions  (legacy fallback)
 *
 * Per-session file: <dir>/<session_id>.json
 *   = { sessionId, worktree, branch, state, task, model, startedAt, ts }
 * SessionEnd removes the file so the agent disappears when its session exits.
 */
import { execFileSync } from "node:child_process";
import {
  writeFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  openSync,
  fstatSync,
  readSync,
  closeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

/** `--dir <path>` from the hook command, when present. */
function argDir() {
  const i = process.argv.indexOf("--dir");
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const SESSIONS_DIR =
  argDir() ||
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

/**
 * Claude's own generated session title, read from the transcript. Claude Code
 * writes `{ "type": "ai-title", "aiTitle": "…" }` lines into the session JSONL
 * as it summarizes the work, updating it as the conversation evolves. That title
 * is a far better "what is this agent doing" summary than the raw last prompt,
 * so we use it when present.
 *
 * Reads only the tail of the file (the latest title sits near the end) so the
 * cost stays bounded no matter how large the transcript grows. Returns "" when
 * there is no transcript or no title yet.
 */
function readAiTitle(transcriptPath) {
  if (typeof transcriptPath !== "string" || !transcriptPath) return "";
  let fd;
  try {
    fd = openSync(transcriptPath, "r");
    const { size } = fstatSync(fd);
    const want = Math.min(size, 65536);
    if (want <= 0) return "";
    const buf = Buffer.alloc(want);
    readSync(fd, buf, 0, want, size - want);
    const lines = buf.toString("utf8").split("\n");
    // Scan from the end for the most recent ai-title. The first line may be a
    // partial record (we started mid-file); JSON.parse just skips it.
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line || line.indexOf("ai-title") === -1) continue;
      try {
        const o = JSON.parse(line);
        if (o && o.type === "ai-title" && typeof o.aiTitle === "string") {
          const t = o.aiTitle.replace(/\s+/g, " ").trim();
          if (t) return t.slice(0, 120);
        }
      } catch {
        /* partial / non-JSON line — keep scanning */
      }
    }
  } catch {
    /* no transcript, unreadable, etc. */
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
  return "";
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

  // argv may carry `--dir <path>`; only treat a non-flag positional as an event.
  const argEvent =
    process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
  const event = payload.hook_event_name || argEvent || "Notification";
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

  // Carry fields forward across events: the work summary (Claude's generated
  // title) and the first-seen timestamp, so the panel keeps showing what the
  // agent is working on rather than resetting on every event.
  let prior = {};
  try {
    prior = JSON.parse(readFileSync(target, "utf8"));
  } catch {
    /* first event for this session, or unreadable */
  }
  const now = Date.now();

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

  const state = EVENT_STATE[event] || "active";

  // The summary: Claude's own generated title from the transcript, which tracks
  // what the agent is actually working on. We deliberately do NOT fall back to
  // the user's raw prompt: the title lands shortly after the first prompt, so
  // until then the panel row and terminal keep their default "Claude N" /
  // "Claude · <worktree>" label rather than echoing the prompt text.
  let task = typeof prior.task === "string" ? prior.task : "";
  const aiTitle = readAiTitle(payload.transcript_path);
  if (aiTitle) {
    task = aiTitle;
  }

  let startedAt = typeof prior.startedAt === "number" ? prior.startedAt : now;
  // A genuinely new session (startup, not resume) clears any stale summary and
  // restarts the clock. (A fresh startup has no transcript title yet.)
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
    ...(skills.length ? { skills } : {}),
  };

  writeFileSync(target, JSON.stringify(ev) + "\n");
}

main();
