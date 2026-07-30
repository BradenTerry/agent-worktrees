# Subagents

What puts a subagent row under an agent, which card it lands on, and what
retires it.

A subagent has no process and no session registry entry of its own — it runs
inside its parent's session — so unlike an agent it cannot be discovered by
looking for a live pid. It does not need to be. Claude Code gives every subagent
a directory beside its parent's transcript:

```
~/.claude/projects/<project>/<parentSessionId>/subagents/
    agent-<agentId>.jsonl       the subagent's transcript (isSidechain: true)
    agent-<agentId>.meta.json   { agentType, description, toolUseId,
                                  spawnDepth, model }
```

`src/subagents.ts` reads those. Verified against Claude Code 2.1.220.

| Row shows | Comes from |
| --- | --- |
| id | the file name |
| type (`Explore`, `general-purpose`, ...) | `meta.agentType` |
| what it is doing | `meta.description` — the `description` passed to the Agent tool |
| how long it has been at it | the first record's `timestamp` |
| which worktree it is working in | that record's `cwd` |

Discovery is a `readdir` plus a few small reads. The subagent's transcript is
opened only far enough to get its first line, and the parent's is never parsed
beyond the tail already read for the work summary — a session with no subagents
costs one failed `readdir`.

## What makes a row appear

Nothing the panel watches fires when a subagent starts. The session registry is
the panel's signal that agent state changed, and Claude rewrites a session's
file on **status transitions** only — a session goes `busy` before it spawns a
subagent and stays `busy` until it has collected the result, writing that file
once for the whole span. A subagent that starts and finishes inside one status
therefore produces no event at all, and its row would show up only if some
unrelated refresh happened to land while it ran.

The other half is finding the files at all. Every read here starts by locating
the parent's transcript, and Claude registers a session **before** it writes that
transcript's first record (measured at ~9s). The registry file appearing is what
wakes the panel, so the first lookup for a session started while a window is open
always misses. `TranscriptReader` therefore caches only a hit: remembering the
miss left that session with no work summary, no skills and no subagent rows for
as long as the window stayed open, which is what "Claude 1" with nothing under it
meant.

So the panel polls (`AGENT_POLL_MS`, 1s) down the agent-only path, and only while
the view is **visible**, the window is **focused**, and at least one agent is on
a card. With no pending session ids that path spawns no git: it is a `readdir` of
the registry and of each live session's `subagents/` directory, and the
posted-payload dedupe drops the update entirely unless something changed. An idle
window, one behind another view, or one sitting in the background polls nothing —
these rows are on-screen detail, and the badge a background window still needs
comes from the watcher instead.

What keeps that tick cheap is a per-session cache (`SubagentDirCache`): a
subagent's files persist for the whole session, so without one a session that
had run dozens of subagents would re-open all of them every second to render
zero rows — a real cost on Windows, where each file open pays for filter
drivers. Finished subagents are skipped before any of their files are opened
(the meta stays cached so the finished-by-`toolUseId` skip is free), the meta —
written once at spawn, immutable after — is parsed once, and a transcript is
re-read only when its mtime has moved, which for a working subagent it does on
every append.

Subagents retired by the silence backstop below are the one group with no
finish signal to skip on, so they are remembered as retired and skipped too,
re-checked once a minute in case one revives. Without that, a session that had
run a hundred subagents paid a hundred stats per second to render the rows of
the two still running. A steady-state tick is now a readdir plus a stat per
running row.

## Subagents follow the worktree they were given

An agent that fans work out gives each subagent a worktree of its own, so their
edits cannot collide. Those subagents are indexed under **that** worktree rather
than their parent's, so the row appears on the card for the code it is actually
touching, naming the agent that sent it there. A worktree with no agent of its
own still shows what is happening inside it.

The row object is shared, not copied: it stays in the parent agent's own list
too, which is what the count on the parent row is drawn from, so a fanned-out
session says how many it has in flight rather than looking idle. A subagent whose
`cwd` resolves to its parent's own card, or to no card at all, keeps its row
under the parent.

### The card has to exist first

A card is placed by longest containing path, and an isolated worktree is created
**inside** the repo (`<repo>/.claude/worktrees/agent-<id>`) at the moment the
subagent starts - long after the last `git worktree list`. Until the panel lists
worktrees again there is no card for it, and the longest path that does contain
it is the repo's own card, so the row lands on its parent. That is not "no match
found", it is a match too far up the tree, and it is why fanned-out subagents all
appeared to be working in the parent's checkout.

`indexRegistry` therefore reports every subagent `cwd` that is not itself one of
the cards as `unplaced`, and the agent-only refresh re-gathers once per such
path. One gather settles it: a real worktree gets its card and the row moves onto
it, while a cwd that is merely a subdirectory of a card stays where it is and is
never gathered for again. The reverse case is handled by the same counter that
traces the rows - when the number of running subagents drops, the isolated
worktree that has just been removed with one of them needs a gather too, or its
card lingers.

## What retires a row

The parent's transcript says so, in one of two shapes depending on how the
subagent was launched:

| Launched | Says it is finished | Matched on |
| --- | --- | --- |
| backgrounded (the default) | `<task-notification><task-id>…` | the subagent's own id |
| synchronous (`run_in_background: false`) | a tool result for the `Agent` call | `meta.toolUseId` |

The distinction is the whole ballgame. A backgrounded `Agent` call is answered
**at launch**, with `Async agent launched successfully … you will be notified
when it completes`. Treating that receipt as the call's outcome retired every
subagent a second or two after it started, so rows were computed correctly and
then filtered out before anything could render them — the reason subagents
appeared never to work at all. `readTail` skips that receipt by its text and
collects the notification instead.

Either signal lands at the end of the parent's transcript as it happens, so an
open window sees every one in the tail it already reads. They are accumulated
across refreshes (`TranscriptReader`), because a signal scrolls out of the tail
as the session goes on and a subagent that finished must not come back to life
when it does.

That leaves one case: a window opened long after a subagent finished, whose
result was never in any tail this window read. The backstop is silence — a
subagent whose transcript has not been written to for **10 minutes** is treated
as finished. The threshold has to clear the longest plausible single tool call,
since a subagent blocked on a slow build writes nothing while it waits; the cost
of it being generous is that such a row can linger for up to that long, rather
than forever. A row retired this way stops being stat'd every tick (above), and
the minute-long re-check is what still lets it come back if the subagent was only
parked on something very slow.

The elapsed label on a row ticks in the webview rather than from a repost: the
extension posts nothing while a subagent quietly works, so an age rendered once
would sit frozen. That timer skips its DOM work entirely when the panel is hidden
(the webview is retained across hides) or when no row carries a label, which is
the usual state.

## What a row is doing, and who is asking you

A subagent's transcript pairs its tool calls plainly: an assistant record carries
the `tool_use`, and the `user` record after it carries the matching
`tool_result`. So a call with **no result** says the subagent is blocked on it -
either the tool is running, or a permission decision for it is outstanding. Only
the tail is scanned, since an unanswered call is by definition the most recent
thing in the file.

That much is a row's own state:

| Subagent's files | Row |
| --- | --- |
| a call issued, no result | mid-call: working, or blocked on a prompt |
| every call answered, not finished | parked - it stopped its turn and will be woken |

Which of the two a mid-call subagent is doing cannot be told from its own files.
The parent can tell you: a session reads **waiting** only when Claude needs the
user. So a waiting session with **exactly one** subagent mid-call identifies that
subagent as the one asking, which is what the `PermissionRequest` hook used to
say outright.

With several mid-call at once it stays unattributed rather than guessing. A row
that says "this one is asking you" is worth something only if it is right, and a
stale or wrong cue is worse than none - which is also why attribution is cleared
the moment the session stops waiting.
