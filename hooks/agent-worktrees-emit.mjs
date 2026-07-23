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
 * Per-session file: <dir>/<id>.json where <id> is the extension's launch id
 *   ($AGENT_WORKTREES_SID, stable across /resume) when present, else the live
 *   session_id.
 *   = { sessionId, worktree, branch, cwd, state, task, skills, subagents,
 *       model, startedAt, titleCheckTs, ts }
 * SessionEnd removes the file so the agent disappears when its session exits.
 */
import { execFileSync } from "node:child_process";
import {
  writeFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
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
// Notification is refined further in main(): not every notification means the
// agent needs the user (see notificationState).
const EVENT_STATE = {
  SessionStart: "idle",
  UserPromptSubmit: "active",
  PreToolUse: "active",
  PostToolUse: "active",
  SubagentStop: "active",
  Notification: "waiting",
  Stop: "idle",
};

/**
 * Status for a Notification event. Claude Code stamps a machine-readable
 * `notification_type` on the payload:
 *  - "agent_completed": a background subagent finished and the parent is about
 *    to be re-invoked with its result — the agent is working, not blocked.
 *  - "idle_prompt": fired after ~60s of no user input. This is NOT a signal
 *    that the agent needs the user — it also fires when a session simply
 *    finished its turn and is sitting idle, which flagged every done agent as
 *    "waiting" forever (a permanent badge on the Activity Bar icon). When
 *    background subagents are still running (`pendingAgents` > 0, read from
 *    the transcript) the parent is working on THEM: active. Otherwise keep the
 *    prior state: an unanswered permission prompt stays waiting, a finished
 *    turn stays idle.
 *  Everything else (permission_prompt, agent_needs_input, an older Claude Code
 *  that sends no type, ...) genuinely needs the user: waiting.
 */
function notificationState(payload, pendingAgents, prior) {
  const type = payload.notification_type;
  if (type === "agent_completed") return "active";
  if (type === "idle_prompt") {
    if (pendingAgents > 0) return "active";
    return prior === "waiting" ? "waiting" : "idle";
  }
  return "waiting";
}

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
 * Session facts read from the tail of the transcript, in one bounded read:
 *
 * - `title`: Claude Code writes `{ "type": "ai-title", "aiTitle": "…" }` lines
 *   into the session JSONL as it summarizes the work, and
 *   `{ "type": "custom-title", "customTitle": "…" }` when the title is set
 *   explicitly (a rename, or the app titling the session). Whichever kind was
 *   written last wins. That title is a far better "what is this agent doing"
 *   summary than the raw last prompt, so we use it when present.
 * - `pendingAgents`: every turn ends with a `turn_duration` system record
 *   carrying `pendingBackgroundAgentCount` — how many background subagents
 *   were still running when the turn ended. The latest record wins. Caveat:
 *   the record is appended AFTER the Stop hook has run, so during a Stop event
 *   this reflects the PREVIOUS turn — only Notification (which fires much
 *   later) may trust it.
 *
 * Reads only the tail of the file (the latest of both records sits near the
 * end) so the cost stays bounded no matter how large the transcript grows.
 */
function readTranscriptTail(transcriptPath) {
  const out = { title: "", pendingAgents: 0 };
  if (typeof transcriptPath !== "string" || !transcriptPath) return out;
  let fd;
  try {
    fd = openSync(transcriptPath, "r");
    const { size } = fstatSync(fd);
    const want = Math.min(size, 65536);
    if (want <= 0) return out;
    const buf = Buffer.alloc(want);
    readSync(fd, buf, 0, want, size - want);
    const lines = buf.toString("utf8").split("\n");
    let sawTitle = false;
    let sawPending = false;
    // Scan from the end for the most recent record of each kind. The first
    // line may be a partial record (we started mid-file); JSON.parse skips it.
    for (let i = lines.length - 1; i >= 0 && !(sawTitle && sawPending); i--) {
      const line = lines[i].trim();
      if (!line) continue;
      const isTitle =
        !sawTitle &&
        (line.indexOf("ai-title") !== -1 || line.indexOf("custom-title") !== -1);
      const isPending =
        !sawPending && line.indexOf("pendingBackgroundAgentCount") !== -1;
      if (!isTitle && !isPending) continue;
      try {
        const o = JSON.parse(line);
        if (isTitle) {
          const title =
            o && o.type === "ai-title" && typeof o.aiTitle === "string"
              ? o.aiTitle
              : o && o.type === "custom-title" && typeof o.customTitle === "string"
              ? o.customTitle
              : "";
          const t = title.replace(/\s+/g, " ").trim();
          if (t) {
            out.title = t.slice(0, 120);
            sawTitle = true;
          }
        }
        if (isPending && o && typeof o.pendingBackgroundAgentCount === "number") {
          out.pendingAgents = o.pendingBackgroundAgentCount;
          sawPending = true;
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
  return out;
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

  /** Resolve the worktree root + branch from git. Two process spawns, so hot
   *  paths avoid this via the prior-state cache below. */
  const resolveGit = () => ({
    top: git(cwd, ["rev-parse", "--show-toplevel"]) || cwd,
    branch: git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]) || "HEAD",
  });
  let resolved = null;

  // The file is keyed by a STABLE launch id so the panel row stays tied to its
  // terminal across `/resume`. The VS Code extension launches Claude with
  // `--session-id <uuid>` and stamps that same uuid into the terminal env as
  // AGENT_WORKTREES_SID, which the hook process inherits. Claude's own
  // `session_id` changes on `/resume`, but AGENT_WORKTREES_SID does not — and it
  // still matches the `--session-id` in the live process argv, so the
  // extension's terminal lookup, `pkill -f <id>`, and state-file path all keep
  // working after a resume. For sessions NOT launched by the extension (no env
  // marker) we key by the live session id, falling back to a sanitized worktree
  // name so a bare session that named no id still tracks.
  let id = safeId(process.env.AGENT_WORKTREES_SID) || safeId(payload.session_id);
  if (!id) {
    resolved = resolveGit();
    id =
      safeId(basename(resolved.top).replace(/[^A-Za-z0-9._-]/g, "_")) ||
      "session";
  }

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

  // Worktree + branch. A session's worktree never changes for a given cwd, so
  // reuse what a previous event resolved (keyed by cwd) instead of spawning git
  // twice per event. That matters because PreToolUse fires on EVERY tool call
  // and Claude Code blocks the tool until this hook exits: on Windows, node
  // startup plus two git.exe spawns per event is a visible per-tool-call lag.
  // SessionStart re-resolves so a fresh/resumed session starts accurate.
  // Caveat: `branch` is frozen with the cache, so a mid-session `git switch`
  // in the same cwd leaves it stale until the next SessionStart. Harmless
  // today — the panel groups agents by `worktree` only and never reads
  // `branch` — but bear it in mind before surfacing `branch` anywhere.
  if (
    !resolved &&
    event !== "SessionStart" &&
    prior.cwd === cwd &&
    typeof prior.worktree === "string" &&
    prior.worktree
  ) {
    resolved = {
      top: prior.worktree,
      branch:
        typeof prior.branch === "string" && prior.branch ? prior.branch : "HEAD",
    };
  }
  if (!resolved) resolved = resolveGit();
  const { top, branch } = resolved;

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

  // Count subagents this session has spawned. The Agent tool (named Task
  // before Claude Code 2.1.63) launches one subagent per call and PreToolUse
  // fires the moment it starts, so this is a running tally of "subagents
  // used". Carried forward across events.
  let subagents =
    typeof prior.subagents === "number" && prior.subagents >= 0
      ? prior.subagents
      : 0;
  if (
    event === "PreToolUse" &&
    (payload.tool_name === "Agent" || payload.tool_name === "Task")
  )
    subagents++;

  // The transcript tail read is kept off the tool-call hot path:
  // PreToolUse/PostToolUse fire on every tool call and Claude Code blocks the
  // tool until this hook exits, so a tail read + parse per tool call is real
  // latency on every agent. Boundary events (UserPromptSubmit, Stop,
  // Notification, SubagentStop, SessionStart) always read it. But the FIRST
  // title of a session lands a few seconds AFTER UserPromptSubmit, in the
  // middle of the first turn — with no read at all on tool events, a busy new
  // session showed its default "Claude N" label for the whole first turn. So
  // while the session has no title yet, tool events also read the tail, but
  // throttled (at most once per TITLE_RECHECK_MS via titleCheckTs) so a
  // session Claude never titles doesn't pay the read on every tool call.
  // Once a title exists it is carried forward and refreshed only at
  // boundaries, so the steady-state hot path stays read-free.
  let task = typeof prior.task === "string" ? prior.task : "";
  let titleCheckTs =
    typeof prior.titleCheckTs === "number" ? prior.titleCheckTs : 0;
  const isToolEvent = event === "PreToolUse" || event === "PostToolUse";
  const TITLE_RECHECK_MS = 5000;
  const readTail =
    !isToolEvent || (!task && now - titleCheckTs >= TITLE_RECHECK_MS);
  const tail = readTail
    ? readTranscriptTail(payload.transcript_path)
    : { title: "", pendingAgents: 0 };
  if (readTail) titleCheckTs = now;

  const state =
    event === "Notification"
      ? notificationState(payload, tail.pendingAgents, prior.state)
      : EVENT_STATE[event] || "active";

  // The summary: Claude's own generated title from the transcript, which tracks
  // what the agent is actually working on. We deliberately do NOT fall back to
  // the user's raw prompt: the title lands shortly after the first prompt, so
  // until then the panel row and terminal keep their default "Claude N" /
  // "Claude · <worktree>" label rather than echoing the prompt text. Until the
  // next read that finds one, the prior title is carried forward.
  if (tail.title) {
    task = tail.title;
  }

  let startedAt = typeof prior.startedAt === "number" ? prior.startedAt : now;
  // A genuinely new session (startup, not resume) clears any stale summary and
  // restarts the clock. (A fresh startup has no transcript title yet.)
  if (event === "SessionStart" && payload.source === "startup") {
    task = "";
    titleCheckTs = 0;
    startedAt = now;
  }

  const ev = {
    sessionId: id,
    worktree: top,
    branch,
    // The cwd this worktree/branch was resolved for; the cache key that lets
    // the next event skip the git spawns.
    cwd,
    state,
    model: payload.model || "claude",
    startedAt,
    ts: now,
    ...(titleCheckTs ? { titleCheckTs } : {}),
    ...(task ? { task } : {}),
    ...(skills.length ? { skills } : {}),
    ...(subagents ? { subagents } : {}),
  };

  // Write via tmp + rename so the extension's watcher never reads a
  // half-written file (a partial read makes that agent's row vanish for a
  // refresh). The tmp name doesn't match the watcher's *.json pattern, and
  // rename replaces an existing file on Windows too.
  const json = JSON.stringify(ev) + "\n";
  const tmp = target + "." + process.pid + ".tmp";
  const writeAtomic = () => {
    writeFileSync(tmp, json);
    renameSync(tmp, target);
  };
  try {
    writeAtomic();
  } catch {
    try {
      // The sessions dir may not exist yet (first event on this machine).
      // Created lazily here instead of unconditionally per event: PreToolUse
      // blocks every tool call, so the hot path skips the mkdir syscall.
      mkdirSync(SESSIONS_DIR, { recursive: true });
      writeAtomic();
    } catch {
      // Rename can fail while a reader holds the file open on Windows; fall
      // back to the in-place write rather than dropping the event. The write
      // comes first: cleaning up the tmp file can itself throw (`force` only
      // suppresses ENOENT, not a scanner holding it open), and the event must
      // land anyway.
      writeFileSync(target, json);
      try {
        rmSync(tmp, { force: true });
      } catch {
        /* tmp locked by a scanner: a leaked tmp file beats a dropped event */
      }
    }
  }
}

// The emitter is best-effort telemetry, but Claude Code treats any nonzero
// exit — and even bare stderr output — as a hook failure and prints a
// "PreToolUse:<tool> hook error ... failed with non-blocking status code"
// warning in the user's session; wired to PreToolUse that's a warning on
// every tool call. A state write that can't land (global storage deleted, a
// synced settings.json whose --dir path doesn't exist on this machine, a
// read-only or full disk) must degrade to "no status update", never to a
// visible hook error, so nothing escapes: swallow everything and exit 0.
try {
  main();
} catch {
  /* dropping one status update beats erroring the user's tool call */
}
process.exitCode = 0;
