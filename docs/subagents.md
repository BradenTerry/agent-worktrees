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

## What is not available

Which subagent is holding a pending permission prompt. That came from the
`PermissionRequest` hook, and nothing Claude writes to disk distinguishes "this
subagent is blocked on a permission decision" from "this subagent is working".
The parent agent still reads **waiting** when it needs you; the panel just cannot
say which of its subagents is the reason.
