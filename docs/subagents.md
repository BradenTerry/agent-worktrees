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

## What retires a row

A subagent is finished when the parent's transcript carries a **tool result for
the `Agent` call that started it** — matched by the `toolUseId` in its meta file.
That result lands at the end of the parent's transcript as it happens, so an open
window sees every one in the tail it already reads. Results are accumulated
across refreshes (`TranscriptReader`), because a result scrolls out of the tail
as the session goes on and a subagent that finished must not come back to life
when it does.

That leaves one case: a window opened long after a subagent finished, whose
result was never in any tail this window read. The backstop is silence — a
subagent whose transcript has not been written to for **10 minutes** is treated
as finished. The threshold has to clear the longest plausible single tool call,
since a subagent blocked on a slow build writes nothing while it waits; the cost
of it being generous is that such a row can linger for up to that long, rather
than forever.

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
