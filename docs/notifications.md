# Notifications for a blocked agent

A VS Code notification, with a button that reveals that agent's terminal, raised
when an agent starts **waiting**.

## Why the existing signals were not enough

Everything the panel said about a blocked agent terminated inside the panel or
the Activity Bar:

```mermaid
flowchart LR
  W["agent status = waiting"] --> D["pulsing dot<br/>row, card meta, repo summary"]
  W --> O["row outline (.attention)"]
  W --> G["collapsed-group badge"]
  W --> B["Activity Bar number badge"]
  W --> L["aria-live announcement"]
  W --> N["notification<br/>+ Open terminal"]

  D & O & G -.->|"needs the panel visible"| X1["not reached"]
  B -.->|"needs the Activity Bar visible"| X1
  X1 -.->|"and none of them<br/>reach another application"| X2["window not focused"]
  N ==>|"the only channel that does"| X2

  style X1 stroke-dasharray: 4 4
  style X2 stroke-dasharray: 4 4
  style N stroke:#89d185
```

The Activity Bar badge is the strongest of the old signals and it is still a bare
integer that disappears with the Activity Bar. Once VS Code is behind a browser
or a terminal, nothing at all reaches the user, which is exactly the situation
where an agent parked on a permission prompt costs the most: the whole point of
running several is that they work while you are doing something else.

## One notification per agent

Two agents can hit a permission prompt in the same second, and they are two
different pieces of work in two different worktrees. They get **two
notifications**, each naming its own agent and each with its own button.

The implementation detail that makes that true: `showInformationMessage` resolves
when its notification is *dismissed*. Awaiting one before raising the next would
have shown two simultaneously blocked agents one at a time, the second appearing
only once the first had been answered - precisely backwards for the case the
feature exists to serve. So every notification for a batch is created in the same
tick and each promise is handled on its own.

```mermaid
sequenceDiagram
  participant P as postData()
  participant N as notifyWaiting()
  participant V as VS Code
  participant U as User

  P->>N: payload (agents a, b both newly waiting)
  N->>V: showInformationMessage("a needs you in main", Open terminal)
  N->>V: showInformationMessage("b needs you in feat/x", Open terminal)
  Note over N,V: both created in one tick,<br/>neither awaited before the other
  V-->>U: two stacked notifications
  U->>V: clicks Open terminal on b
  V-->>N: resolves with "Open terminal"
  N->>P: focusAgent(b.sessionId)
```

Each closure captures the session id of the agent it is about, so the buttons
cannot be crossed however they are answered, in whatever order, or not at all.

## The button

**Open terminal** runs the same `focusAgent(sessionId)` the panel's own rows do,
so it inherits that path's behaviour whole - including its answer for a session
whose terminal belongs to another VS Code window, which it reports rather than
silently doing nothing.

## When it fires

Config: `agentWorktrees.notifyWaiting`.

| Value       | Behaviour                                                      |
| ----------- | -------------------------------------------------------------- |
| `off`       | Never. The dot, the group badge and the Activity Bar count only. |
| `unfocused` | **Default.** Only while the VS Code window is not focused.       |
| `always`    | Every time an agent starts waiting, focused or not.              |

`unfocused` is the default because it is the case nothing else covers. With the
window focused the user is already in VS Code and the pulse, the badge and the
repo-wide summary are all doing their job; interrupting them there is a second
copy of news they can already see. With it unfocused, none of those exist.

The setting is hand-editable like any other, so it is **normalized rather than
validated** on every read (`notifyMode`), and an unrecognized value falls back to
the default rather than to `always`: a typo in `settings.json` must not resolve
in the direction of interrupting the user more often than they asked for.

Focus is read **once per batch** (`vscode.window.state.focused`), not once per
notification. They are all being raised in response to a single refresh, so they
should agree about whether anyone was looking at the window when it landed.

## What stops it becoming noise

The panel polls once a second and `postData` runs on every refresh, so "there is
a waiting agent" is true hundreds of times for one prompt. The rule is one
notification per **entry** into the waiting status, held in
`announcedWaiting`, a set of session ids.

```mermaid
stateDiagram-v2
  [*] --> NotAnnounced
  NotAnnounced --> Announced: agent enters waiting<br/>→ raise one notification
  Announced --> Announced: still waiting on the next<br/>~200 polls → silence
  Announced --> NotAnnounced: agent leaves waiting<br/>→ forget it
  NotAnnounced --> Announced: blocks again later<br/>→ raise another
```

Dropping the id when the agent *stops* waiting, rather than when its session
ends, is what makes the second permission prompt of a long session reach you.
Keying it by session id rather than counting is what stops the first one
announcing on every poll.

### Seeding

The first payload after a window opens, or after an extension-host reload, would
otherwise look like every currently-blocked agent had just blocked, and fire a
burst of notifications about nothing that changed. That payload therefore
**seeds** the set without notifying (`newlyWaiting(..., seed = true)`).

Reconciliation runs before the mode is read, so the seeding and the bookkeeping
happen even while notifications are `off`. Turning the setting on mid-session
then announces the *next* agent to block, rather than everything already sitting
there.

## Where it hangs

Off `postData`, next to the Activity Bar badge, and before the
unchanged-payload early return for the same reason the badge is: both are
statements about the current state rather than about the DOM, and both must be
right on a refresh that re-posts nothing.

Consequence, shared with the badge: nothing fires until the panel's view has been
resolved at least once, because that is the extension's only refresh path.

## Testing

The decisions are all in `src/waitingNotices.ts`, which imports no `vscode` API
and holds no state of its own - the set is passed in. `test/waitingNotices.test.js`
covers the poll not repeating, two agents batching together, re-announcing after
an agent unblocks, seeding staying silent, the mode normalizer, the focus gate,
and the notification text.
