# Agent status

How the panel learns what each Claude session is doing, and how it retires
sessions whose process is gone.

Claude Code keeps a registry of its live sessions and records what each one is
doing in it. The panel reads that. There is nothing to install, nothing to
consent to, and no process is spawned per event.

## The registry

One file per session, at `~/.claude/sessions/<pid>.json`
(`$CLAUDE_CONFIG_DIR/sessions` when that is set), rewritten by Claude on every
transition:

```json
{ "pid": 567, "sessionId": "ad71415e-...", "cwd": "/repo",
  "status": "busy", "startedAt": 1785193745550, "version": "2.1.220",
  "kind": "interactive", "name": "agent-worktrees-9f" }
```

`src/sessionRegistry.ts` reads it on every refresh — through an mtime-keyed
cache, so a file is opened and parsed only when Claude has rewritten it and an
unchanged session costs one stat. The pid is re-probed on every read regardless
(a killed process leaves its file behind, unchanged). The directory is also the
panel's refresh signal: a file appearing, changing or vanishing is a session
starting, transitioning or ending, which is exactly when a card needs redrawing.

| Claude's `status` | Panel   |
| ----------------- | ------- |
| `busy`            | active  |
| `shell`           | active  |
| `waiting`         | waiting |
| `idle`            | idle    |

- `shell` is a local bash command rather than an LLM turn, but it is work in
  progress as far as the user is concerned.
- A status this table does not list maps to **nothing**, and the row reads idle.
  A status Claude adds later should be added here rather than collapsing into a
  guess.
- `status` needs Claude Code **v2.1.119** or newer, and has been observed absent
  on a session whose `entrypoint` is not a local one. A session without it still
  gets a row - it is a real agent working in that worktree - it just reads idle
  until Claude says otherwise.
- `kind` filters the list: headless (`-p`) runs and other non-interactive kinds
  are not agents anyone is watching a card for. A file with no `kind` predates
  the field and is kept.

## Which card a session lands on

The registry gives a `cwd`. A session appears on the card whose worktree path
contains it, longest match first, so a session working in a nested worktree
lands on that worktree's card rather than the repo root's. A session working
outside every worktree of this repo has no card to appear on and is skipped.

## Work summaries come from the transcript

The registry's `name` is derived from the directory (`agent-worktrees-9f`), so it
is the same for every session in a worktree and useless as a row label. The
label the panel wants is Claude's generated title, which it writes into the
session's transcript:

```json
{ "type": "ai-title",     "aiTitle": "port the git tests" }
{ "type": "custom-title", "customTitle": "renamed by hand" }
```

The same tail read also collects the ids of tool calls whose results have landed,
which is what retires a finished subagent (see [Subagents](subagents.md)), and
any skills invoked in it — one pass over the bytes rather than three.

`src/transcript.ts` reads the newest of those from the tail of
`~/.claude/projects/<project>/<sessionId>.jsonl`, whichever kind wrote it. Only
the tail is read, so the cost does not grow with the transcript; the result is
cached per session and re-read only when the file's mtime moves, so a settled
title costs one stat per refresh. The project directory name is Claude's
encoding of the cwd, so rather than reproduce that encoding the reader looks for
the session's own `<sessionId>.jsonl`.

A session Claude has not summarized yet has no title, and its row falls back to
`Claude 1`, `Claude 2` - ordinals counted per card, oldest first.

### Skills

A Skill tool call is an ordinary `tool_use` block, so the chip on an agent row is
recoverable too: `input.skill`, reduced to its bare name so `plugin:foo` and
`path/to/foo` dedupe to `foo` (the same normalization the emitter did on the
`PreToolUse` payload).

Skills are the one thing that cannot come from the tail alone: they accumulate
over a whole session, so one used an hour ago is far behind the end of the file.
`scanSkills` walks the transcript once, the first time a window sees that
session, and every tail read after that tops the list up — anything new is by
definition at the end.

That one pass is **not** awaited. A long session's transcript runs to several
megabytes (5-12MB is ordinary), and awaiting it here put one such read per live
session in front of the panel's first render — the slowest thing a freshly opened
window did, and worse on Windows where reads of `~/.claude` pay for filter
drivers. So the list is seeded from the tail and the scan fills in the rest on a
later refresh, which the 1s poll delivers within a second. It runs once per
session (`scanning` guards against the poll starting a second one mid-scan) and
writes nothing back if the session was retired while it ran.

## Retiring agents that are no longer running

Claude removes a session's file when it exits, so a clean exit takes its row with
it. A session that dies with its terminal - the window closed, the terminal
killed, the machine restarted - never gets the chance, and the file survives
saying whatever it last said. Every entry is therefore confirmed against its
recorded pid before it becomes a row.

That pid is the Claude process itself, so its absence is proof on every platform
(`process.kill(pid, 0)`; `EPERM` means it exists but belongs to another user, so
it counts as alive). This replaced a sweep that had to reason about a hook
process's *parent* pid, could not trust a missing one on Windows, and needed a
grace period and a process-table scan to make up the difference.

## Which terminal a row belongs to

Reveal and Stop need the terminal behind a row, and **the id cannot be trusted to
find it**. The extension starts agents with `claude --session-id <uuid>` and
stamps that uuid into the terminal's environment, but the row comes from the
registry, and the id a session registers is not always the one in its argv.
Measured on a live 2.1.220 session started by the panel:

```
registry:  { sessionId: "9cb50d5b-...", pid: 63074 }
that pid:  claude --session-id c19e3fe7-...        <- the id we launched with
ancestry:  63074 -> claude 62919 -> /bin/zsh 47236 -> Code Helper
```

Two things are wrong with an id lookup here: the ids differ, and the registered
process is a **child** of the one the terminal started. `claude -w` is the common
way to get there (`/resume` is another), and it is not a corner case - it is what
the Agent & Worktree button does. The symptoms were a Reveal that insisted "this
agent's terminal isn't in this window" about a terminal the user was looking at,
and a Stop button that killed nothing, because `pkill -f <session id>` matched an
argv that does not contain that id.

So the link is resolved by **process ancestry** (`src/processTree.ts`): a
terminal's shell pid is an ancestor of every process running in it and of nothing
else, which also makes the test inherently per-window. The registry pid is what
makes this possible, since it names the exact process behind the row.

- The id map is still tried first, so a normally launched agent costs nothing.
- The process table is read only on a click, never on a refresh, and the answer is
  cached under the registry's id, so it is one listing per session per window.
  `ps -Ao pid=,ppid=` on macOS and Linux, `Get-CimInstance Win32_Process` on
  Windows (not `wmic`, which is removed in Windows 11 24H2).
- Stop kills the registry pid on **every** platform now (SIGTERM on POSIX,
  `taskkill /T /F` on Windows) and disposes the terminal after, rather than
  relying on an id match that a `-w` child never satisfies.

A side effect worth having: an agent started by hand in a VS Code terminal, which
the panel never had a handle for, is now revealable and stoppable too.

## What this does not cover

- **A terminal in another VS Code window.** Rows come from a registry shared
  across every window; terminal handles are per-window, and ancestry says the
  same thing (the session is not beneath any shell in *this* window). The panel
  says so rather than pretending.
- **A machine that will not report its process table.** Reveal falls back to the
  id lookup, so a panel-launched agent still works and a `-w` child does not.

## Removing the old hooks

Earlier versions installed an emitter script on ten Claude Code hooks, which
wrote a state file per session. `removeManagedHooks` takes all of it back out on
activation, and is idempotent:

- Hook entries in `~/.claude/settings.json` whose command names
  `agent-worktrees-emit` - the emitter or the launcher that ran it. A user's own
  hooks survive even when they share an event, or a matcher entry, with ours; an
  event we emptied is dropped, and `hooks` itself only if we are what emptied it
  (`src/hookCleanup.ts`, which is split out so this can be tested without an
  extension host).
- The emitter, its launcher, and the state files, all under the extension's
  global storage, plus the pre-global-storage `~/.claude/agent-worktrees`.

It is best effort and never blocks activation: an emitter left on disk with no
hook entry pointing at it is inert. In a test host it does nothing at all, since
`~/.claude/settings.json` is the real user's file rather than something the test
runner's throwaway `--user-data-dir` sandboxes.
