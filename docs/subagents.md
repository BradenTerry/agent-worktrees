# Subagents

The subagents an agent has in flight *right now* appear as indented rows under
it, labelled with the agent type and the `Agent` tool's `description`, plus how
long each has been going.

## What registers and retires a row

- `SubagentStart` registers one.
- `SubagentStop` does **not** retire it. A stop is not an end: an async subagent
  that hands work to a background command stops its turn, stays resumable, and is
  woken when the command lands. Claude Code's own notification says as much, that
  it "fires each time this agent stops with no live background children of its
  own … the same task-id may notify more than once". Retiring on the stop made a
  subagent vanish the moment it backgrounded anything.
- The authority is instead Claude Code's in-flight registry, stamped on every
  `Stop` / `SubagentStop` payload as `background_tasks` ("running/pending +
  backgrounded"). A stop only marks the subagent **paused**: still listed, with
  the working pulse off. The next registry snapshot, from that same payload or the
  parent's next turn end, decides whether it is gone.
- Once a subagent has appeared in the registry, **the registry alone retires it**.
  Stopping an agent from Claude Code's own agent manager fires no hook (its turn
  never ends), so a killed one would otherwise sit in the panel forever.
- The registry also adopts subagents this extension never saw start, e.g. hooks
  installed while one was already running.
- Only `Stop` and `SubagentStop` carry it, so a kill shows up at the next turn end
  rather than instantly.

## Labels

- `SubagentStart` only knows the agent *type*, so the description is parked by the
  `Agent` tool's `PreToolUse` and claimed by the next start of that type. (The
  tool was named `Task` before Claude Code 2.1.63; both names count.)
- An unclaimed description expires rather than mislabelling a later subagent.
- Registry entries carry both fields and need no pairing.

## Which one is waiting on you

Neither available signal is enough alone:

- `Notification` is the only trustworthy "needs you" signal, but it is built
  without the agent context, so it never says which subagent raised it.
- `PermissionRequest` names the asker, but fires for silently-allowed calls too.

So the panel pairs them: the subagent with an outstanding permission decision is
drawn in the waiting yellow only while the session itself is in the waiting state.

## Rendering

- Elapsed times tick in the webview itself. The extension only re-posts when the
  payload changes, and a subagent quietly working changes nothing else, so a
  rendered age would otherwise freeze.
- The Agents bar carries the worktree-wide count, so subagents stay visible when
  the list is collapsed.
- Clicking a subagent row reveals its **parent's** terminal. A subagent has no
  terminal of its own, so its session is the thing to talk to.

## Subagents follow the worktree they were given

A fan-out (one subagent per ticket, each in its own worktree so concurrent edits
cannot collide) puts each subagent's row on the card for the worktree it is
actually touching, not under the session that spawned them.

- Only the events a subagent fires itself carry its `cwd`, so the emitter resolves
  it there and records it on the subagent when it differs from the session's own
  worktree. The resolution is cached against that cwd, so `PreToolUse` does not
  pay for a `git` spawn on every tool call.
- The parent's row keeps a count chip of everything it has in flight. Without it,
  the session driving a fan-out would look idle.
- The emitter records the worktree on the *subagent*, never on the session. The
  parent's row must not move to another card, which is what re-keying on a
  subagent's cwd used to do.
- Subagents adopted from the `background_tasks` registry fire no events of their
  own and so carry no cwd. They stay on the parent's card.
- So does one whose worktree belongs to no card in this repo: `gatherWorktrees`
  drops the relocation rather than let the row vanish, and remembers the path so
  the agent-only refresh does not mistake it for a worktree that just appeared.
