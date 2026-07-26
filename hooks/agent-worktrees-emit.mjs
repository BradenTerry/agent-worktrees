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
 *       pendingSubagents, model, startedAt, titleCheckTs, ts }
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
  SubagentStart: "active",
  SubagentStop: "active",
  Notification: "waiting",
  Stop: "idle",
};

/** Most live subagents tracked per session; a runaway fan-out is truncated
 *  rather than growing the state file without bound. */
const SUB_MAX = 12;
/** A tracked subagent with no hook event of its own for this long is treated as
 *  gone. Only a backstop for a subagent that died without firing SubagentStop
 *  (a crash, a killed process): the normal path retires it on SubagentStop, and
 *  a pruned-but-alive subagent re-registers on its next event. */
const SUB_STALE_MS = 3_600_000;
/** How long an Agent tool call's description waits to be claimed by the
 *  SubagentStart it belongs to. */
const SUB_PENDING_MS = 120_000;

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
 * The subagents in the payload's `background_tasks` — Claude Code's registry of
 * in-flight background work, stamped on Stop and SubagentStop. Entries are
 * `{ id, type, status, description, agent_type }`, already filtered by Claude
 * Code to running/pending work, with `type: "subagent"` for an agent (the raw
 * internal name, `local_agent`, is accepted too in case the mapping changes).
 *
 * Returns null when the payload carries no registry at all — an older Claude
 * Code, or an event that does not stamp one — which must not be confused with
 * an empty registry meaning "nothing is in flight".
 */
function registrySubagents(payload) {
  const raw = payload.background_tasks;
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    if (t.type !== "subagent" && t.type !== "local_agent") continue;
    const id = safeId(t.id);
    if (!id) continue;
    out.push({
      id,
      type: oneLine(t.agent_type, 40),
      task: oneLine(t.description, 80),
    });
  }
  return out;
}

/** Collapse free text to a single line short enough for a narrow panel row. */
function oneLine(raw, max) {
  if (typeof raw !== "string") return "";
  const t = raw.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : "";
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

  // Hooks fired BY a running subagent carry that subagent's `agent_id`. They
  // are still the parent session's events (same session_id, same state file),
  // but a subagent can run somewhere else entirely — an isolated worktree gives
  // it its own cwd — so they must never re-key the row's worktree.
  const subagentId = safeId(payload.agent_id);

  /** Resolve the worktree root + branch from git. Two process spawns, so hot
   *  paths avoid this via the prior-state cache below. */
  const resolveGit = (dir) => ({
    top: git(dir, ["rev-parse", "--show-toplevel"]) || dir,
    branch: git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]) || "HEAD",
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
    resolved = resolveGit(cwd);
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
  // A subagent's own cwd is not the session's: keep the parent's, so an
  // isolated-worktree subagent cannot move its parent's row to another card.
  const baseCwd =
    subagentId && typeof prior.cwd === "string" && prior.cwd ? prior.cwd : cwd;
  if (
    !resolved &&
    event !== "SessionStart" &&
    prior.cwd === baseCwd &&
    typeof prior.worktree === "string" &&
    prior.worktree
  ) {
    resolved = {
      top: prior.worktree,
      branch:
        typeof prior.branch === "string" && prior.branch ? prior.branch : "HEAD",
    };
  }
  if (!resolved) resolved = resolveGit(baseCwd);
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

  // Track the subagents that are live RIGHT NOW — the panel shows them as rows
  // under their parent and drops them when they finish, so a session that
  // spawned twenty subagents yesterday shows nothing today.
  //
  // Claude Code brackets every subagent (foreground and background alike) with
  // SubagentStart / SubagentStop, and both payloads carry that subagent's
  // `agent_id`. But a *stop is not an end*: an async subagent that hands work
  // to a background command stops its turn, stays resumable, and is woken when
  // the command lands — Claude Code's own notification spells it out ("fires
  // each time this agent stops with no live background children of its own …
  // the same task-id may notify more than once"). Retiring on SubagentStop
  // therefore made a subagent vanish the moment it started a background task.
  //
  // So the authority on what is still alive is Claude Code's in-flight
  // registry, which it stamps on every Stop / SubagentStop payload as
  // `background_tasks` ("running/pending + backgrounded … lets hooks
  // distinguish 'session is done' from 'session is paused waiting for
  // background work'"). A stop only marks the subagent paused; the next
  // registry snapshot — from that same payload, or the parent's next turn end —
  // decides whether it is gone.
  //
  // SubagentStart knows only the agent TYPE ("Explore", "general-purpose"),
  // never what it was asked to do — the useful label is the Agent tool's
  // `description`, which arrives one event earlier on PreToolUse. Descriptions
  // are therefore parked in `pendingSubagents` and claimed by the next start of
  // the same type. An unclaimed park (a denied tool call, an older Claude Code
  // that never fires SubagentStart) expires instead of mislabelling a later
  // subagent. Registry entries carry both, so they need no pairing.
  let subagents = Array.isArray(prior.subagents)
    ? prior.subagents.filter(
        (s) => s && typeof s === "object" && typeof s.id === "string"
      )
    : [];
  let pendingSubs = Array.isArray(prior.pendingSubagents)
    ? prior.pendingSubagents.filter(
        (p) => p && typeof p === "object" && typeof p.ts === "number"
      )
    : [];

  // The Agent tool was named Task before Claude Code 2.1.63; both launch one
  // subagent per call.
  if (
    event === "PreToolUse" &&
    (payload.tool_name === "Agent" || payload.tool_name === "Task")
  ) {
    const input = payload.tool_input || {};
    pendingSubs.push({
      type: oneLine(input.subagent_type, 40),
      task: oneLine(input.description, 80),
      ts: now,
    });
  }
  pendingSubs = pendingSubs
    .filter((p) => now - p.ts <= SUB_PENDING_MS)
    .slice(-SUB_MAX);

  // Claude Code's in-flight registry, when this event carries one. `null`
  // means "this payload says nothing", which is different from an empty list
  // ("nothing is in flight").
  const inFlight = registrySubagents(payload);

  if (event === "SubagentStop" && !inFlight) {
    // No registry on the payload (an older Claude Code): fall back to treating
    // the stop as the end, which at least never leaves a ghost row. No agent_id
    // either means it does not stamp one — retire the oldest tracked subagent.
    subagents = subagentId
      ? subagents.filter((s) => s.id !== subagentId)
      : subagents.slice(1);
  } else if (event === "SubagentStop") {
    // The subagent's turn ended. It may be finished, or it may be parked
    // waiting on a background command it started; the registry sweep below
    // tells the two apart.
    const stopped = subagentId
      ? subagents.find((s) => s.id === subagentId)
      : subagents[0];
    if (stopped) {
      stopped.paused = true;
      stopped.ts = now;
    }
  } else if (subagentId || event === "SubagentStart") {
    // SubagentStart registers the subagent. Any OTHER event carrying an
    // agent_id was fired by a subagent mid-run: it proves that subagent is
    // still alive, and re-registers it if we never saw its start (hooks
    // installed while it was already running, or a stale-pruned entry).
    const id = subagentId || "subagent";
    const type = oneLine(payload.agent_type, 40);
    const known = subagents.find((s) => s.id === id);
    if (known) {
      known.ts = now;
      // It is producing events again: whatever it was parked on has landed,
      // and any permission decision it was in has been resolved.
      delete known.paused;
      delete known.awaitingPermission;
      if (!known.type && type) known.type = type;
    } else {
      let i = type ? pendingSubs.findIndex((p) => p.type === type) : -1;
      // With exactly one Agent call in flight the pairing is unambiguous even
      // when the types don't line up (`subagent_type` is optional, and Claude
      // Code resolves the default to a concrete type).
      if (i === -1 && pendingSubs.length === 1) i = 0;
      const claimed = i === -1 ? null : pendingSubs.splice(i, 1)[0];
      const label = type || (claimed && claimed.type) || "";
      subagents.push({
        id,
        startedAt: now,
        ts: now,
        ...(label ? { type: label } : {}),
        ...(claimed && claimed.task ? { task: claimed.task } : {}),
      });
    }
  }
  // A permission decision for one of this session's subagents. PermissionRequest
  // is the only event that names the subagent behind a prompt — Notification,
  // the actual "needs you" signal, is built without the agent context and never
  // carries an agent_id. But it fires for EVERY decision, including the ones an
  // allowlist or auto mode settles silently, so on its own it does not mean the
  // user is being asked. It is recorded as a raw fact here; the panel shows it
  // as waiting only while the session itself is waiting, which is the reliable
  // half of the pair. Cleared by the subagent's next event of any kind (above),
  // i.e. as soon as the tool runs.
  if (event === "PermissionRequest" && subagentId) {
    const asked = subagents.find((s) => s.id === subagentId);
    if (asked) asked.awaitingPermission = true;
  }

  if (inFlight) {
    // Reconcile against Claude Code's own registry. It knows every backgrounded
    // subagent, including ones started before these hooks were installed, and
    // it labels them properly (agent type + the Agent tool's description).
    const live = new Set(inFlight.map((t) => t.id));
    for (const t of inFlight) {
      const known = subagents.find((s) => s.id === t.id);
      if (known) {
        known.ts = now;
        // Seen in the registry: from here on the registry decides when this
        // subagent goes away, so it cannot outlive one that is killed rather
        // than stopped (no hook fires when you stop an agent from Claude's
        // agent manager, and its next turn never ends).
        known.bg = true;
        if (!known.type && t.type) known.type = t.type;
        if (!known.task && t.task) known.task = t.task;
      } else {
        subagents.push({
          id: t.id,
          startedAt: now,
          ts: now,
          bg: true,
          ...(t.type ? { type: t.type } : {}),
          ...(t.task ? { task: t.task } : {}),
        });
      }
    }
    // Drop anything the registry no longer vouches for: a backgrounded subagent
    // that has left it (finished, stopped, killed), and any subagent that has
    // stopped its turn without being parked on background work. A foreground
    // subagent that never stopped is left alone — it runs inside its parent's
    // Agent tool call and is not background work at all, so the registry never
    // lists it and its absence proves nothing.
    subagents = subagents.filter(
      (s) => (!s.paused && !s.bg) || live.has(s.id)
    );
  }
  subagents = subagents
    .filter((s) => typeof s.ts !== "number" || now - s.ts <= SUB_STALE_MS)
    .slice(-SUB_MAX);

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
      : // PermissionRequest runs in the decision path, ahead of any prompt, and
        // fires for silently allowed calls too — so it says nothing about the
        // agent's status. It must not report "active" either: with several
        // subagents in flight, one of their decisions landing while the user is
        // answering a prompt would clear the waiting state (and the Activity
        // Bar badge) out from under them. Keep whatever the last event decided.
        event === "PermissionRequest"
        ? prior.state || "active"
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
  // Every SessionStart except a compaction means the conversation restarted
  // (startup, /resume, /clear) and took its subagents with it. Compaction is
  // the one case where the same process keeps running them.
  if (event === "SessionStart" && payload.source !== "compact") {
    subagents = [];
    pendingSubs = [];
  }

  const ev = {
    sessionId: id,
    worktree: top,
    branch,
    // The cwd this worktree/branch was resolved for; the cache key that lets
    // the next event skip the git spawns.
    cwd: baseCwd,
    state,
    model: payload.model || "claude",
    startedAt,
    ts: now,
    ...(titleCheckTs ? { titleCheckTs } : {}),
    ...(task ? { task } : {}),
    ...(skills.length ? { skills } : {}),
    ...(subagents.length ? { subagents } : {}),
    ...(pendingSubs.length ? { pendingSubagents: pendingSubs } : {}),
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
