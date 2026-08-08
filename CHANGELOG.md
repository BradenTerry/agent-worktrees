# Changelog

All notable changes to the Agent Worktrees extension are documented here.

## 4.4.0

### Features

- **An agents view: every agent in the repository in one list.** A switch beside
  the agent summary swaps the worktree cards for a flat list of every agent,
  whatever worktree it is in, so "what is running, and what needs me" is one
  glance instead of opening four cards. The rows are the cards' own agent rows -
  click to reveal a terminal, stop one, read its subagent and skill counts - plus
  the one thing a flat list has to add: the branch each agent is working on, with
  the worktree path in its tooltip, a house for the primary worktree and the
  detached glyph where there is no branch.
- **Subagents hang under the agent that spawned them.** On a card, a subagent
  given a worktree of its own sits on that worktree's card, next to the code it is
  touching; in the agents view there are no cards, so it sits under its parent and
  names its worktree instead. One whose parent session is not itself listed still
  gets a row rather than disappearing with the cards.
- **The status order is yours.** Rows are grouped by status, waiting first out of
  the box, and a new **Settings → Preferences** tab moves the three statuses up
  and down: someone watching a fan-out wants active on top, someone triaging wants
  waiting. Stored as `agentWorktrees.agentStatusOrder`, so it can be edited in
  `settings.json` and syncs like any other setting. Within a group the rows keep
  the order the cards are in, so an agent moves only when its own status changes.
- **Switching views costs nothing.** Both views render from the same payload the
  panel already has, so the switch is a re-render with no round trip to the
  extension, no git and no GitHub. Which view you were in is remembered.

### Changes

- **Expand/collapse all moved to the agent summary line**, next to the view
  switch: both are about how the list below is shown, where the repository name's
  row is the actions that create and open things. It is disabled rather than
  hidden in the agents view, whose rows are the leaves, so the switch beside it
  never moves out from under the pointer that just used it.

### Fixes

- **A hand-edited status order cannot hide agents.** The setting is completed
  rather than rejected on every read: statuses in the order given, each counted
  once, then any the value left out appended. A list naming two of the three would
  otherwise decide the third's agents are not drawn at all.

## 4.2.0

### Features

- **Worktree cards are built to be scanned.** Every card is two lines at rest and
  four worktrees fit in the height one used to take, with nothing dropped: the
  branch, the agent and subagent counts, the status dots and the git totals all
  still there. The PR rollup stays one framed block, with reviews and checks on a
  shared line split by a rule so the two sets of checkmarks never blur together.
  The panel used to ship a second, roomier density behind a toolbar toggle; it was
  removed rather than maintained twice.
- **A card's name stays put while you scroll.** The header pins itself above its
  own agent rows, so the row you are about to click always has the name of its
  worktree directly above it - no more revealing a terminal from the card below
  the one you meant.
- **Clicking the name opens a card, not the whole line.** A vertical rule marks
  where the toggle stops, and the buttons past it are their own targets, so a
  click that lands between them no longer folds the card you were reaching into.
  The hover highlight shows exactly what the click will hit, and a horizontal rule
  draws where the fold is.
- **Hover marks what is clickable, and nothing else.** Cards no longer light up
  as a whole when the pointer is over them, which made all of a card look like a
  click target when only parts of it are. The name, an agent row and a button each
  still highlight on their own.
- **The name line stays a name line.** Past that rule sit the Source Control scope
  pill and a caret menu holding everything a worktree can do: switch branch,
  refresh, search it, find a file in it, run or debug it, open it in a new window,
  view the branch on GitHub, delete it. Branch names get the width back instead of
  a row of icons, and long ones wrap instead of being clipped.
- **The outlined card is the one you are typing into**, rather than the one that
  happens to be your open folder - so with several agents running, the card your
  terminal belongs to is findable at a glance, collapsed or not.
- **A repo-wide agent summary under the repository name**: how many agents, how
  many live subagents, and how many are active, waiting or idle across every
  worktree, so "is anything waiting on me" is one glance instead of a scroll.
- **The agent list scrolls instead of folding**, so a worktree running a dozen
  agents no longer pushes every card below it off screen.
- **Glyphs instead of pills** for the states most worktrees are not in: your
  primary working directory gets a house beside its name, and a locked or detached
  worktree gets a padlock or a broken chain beside its agent counts. The row those
  words needed is gone.
- **The worktree's own directory, labelled, inside the card.** Cards are titled by
  their branch, which is what you scan for; the folder it lives in is a `Worktree`
  line in the body with the full path on hover.

### Bug fixes

- **A debug row is named after its configuration, not the worktree it repeats.**
  The worktree suffix is still on the session itself, where VS Code's Call Stack
  and session list need it to tell several worktrees' runs apart, but on a card
  the row sat under the name it was restating.
- **No GitHub link for a branch that was never pushed.** A branch with no upstream
  has no tree page, so the entry offered a link that could only 404.

### Documentation

- **The Marketplace listing is a list you would read**, cut by roughly a third,
  with the same features and screenshots as short entries rather than paragraphs
  about each one.
- **The listing's screenshots are pinned to the release they ship with.** They
  were absolute URLs pointing at `main`, so a published listing kept resolving
  against whatever main became: landing a UI change without cutting a release
  would advertise a panel nobody could install yet. The release now rewrites them
  to its own tag on the way into the package.

## 4.0.3

### Performance

- **The Remove Worktree confirmation opens when you click it.** Everything the
  dialog discloses - the branch on the worktree, uncommitted changes, unpushed
  commits, the agents working in there - was read one git call after another, so
  on Windows, where each of those costs real time, the button looked like it had
  not worked. Those reads now run together, and the dialog no longer waits on
  line counts it never shows.

## 4.0.2

### Features

- **Debug a launch configuration that asks you something.** A config using
  `${input:...}` now prompts from the worktree's own `inputs` - a text box, a list
  to pick from, or a command that supplies the value - instead of failing or
  asking with your main checkout's definition. A compound asks once for an input
  its configurations share, a `preLaunchTask` gets its own inputs too, and nothing
  you type is written to the log.
- **Open a branch on GitHub from its card.** The GitHub mark beside the worktree
  name opens that branch in the browser. No token and no setup beyond having a
  GitHub remote.
- **Worktree cards are easier to tell apart** - a wider gutter, a stronger edge
  and a tint on every card, so where one worktree ends and the next begins reads
  at a glance in light and dark themes.
- **Linked files reach every worktree**, not just the two the panel creates
  itself: the ones `claude -w` makes, a subagent's isolated worktree, and any
  `git worktree add` you run in a terminal.

### Bug fixes

- **Settings -> Linked Files lists the paths you configured.** With a linked
  worktree as the open folder it read the list under a key nothing writes, so the
  tab looked empty for a repo that had files set up.

## 4.0.1

### Bug fixes

- **A worktree created by `claude -w` gets its own card**, instead of the agent's
  row appearing on the card one level up until you clicked Refresh.
- **A card's change count keeps moving while its agent works** - a long turn
  writes to the session file rarely, so the panel now re-checks any card with an
  active agent, and picks up your own edits from saves, file creates, deletes and
  renames, and the Git extension's own repository events.
- **Reveal and Stop find a `claude -w` agent's terminal** - that session runs
  under an id its command line never mentions, so Reveal claimed the terminal was
  in another window and Stop killed nothing. Both now work from the pid in
  Claude's registry.
- **Stop will not kill a process that is no longer Claude** - a session that died
  without cleaning up leaves a pid the system is free to hand to something else.
  The pid is checked before anything is killed or cached against it.

### Performance

- **The panel polls only the worktrees nothing else is watching.** A worktree
  whose repository the Git extension has open now refreshes on that repository's
  own events, with a 30 second backstop; the rest keep a timer, now configurable
  under Settings -> Performance -> Recheck every (2 to 60 seconds, default 10).
  A repository changing also re-checks just that worktree rather than every card
  on the panel.

## 4.0.0

### Features

- **Search a worktree without opening a second window** - two buttons per card:
  search its contents, or open one of its files by name. Your workspace is
  untouched and your agents stay where they are.
- **No more hooks** - agent status now comes from Claude Code's own session files,
  so nothing is installed in your `~/.claude` and the consent page is gone. One
  catch: an agent you `/resume` keeps its row, but the panel can no longer reveal
  or stop its terminal.
- **Settings -> Performance** - turn git's own `status` speedups
  (`core.untrackedCache`, `core.fsmonitor`) on or off for this repository. Rows
  git will not accept say why.
- **A pre-release channel** - odd minor versions (`3.9.x`) are pre-releases, even
  ones (`4.0.0`) are regular releases, since the Marketplace rejects `-pre.1`
  suffixes. Opt in from the Marketplace to get builds early.

### Bug fixes

- **The Source Control pill moves the moment you click it**, instead of catching
  up a few seconds later.

### Performance

- **Far less work per refresh** - PR and CI badges no longer trigger git, a busy
  agent's worktree is re-checked at most every two seconds, `launch.json` is read
  once per edit, finished subagents are skipped, unfocused windows stop polling,
  and the per-agent skills scan no longer delays the first paint.
- **Stopping an agent on Windows is instant** - a direct `taskkill` on the pid
  from Claude's registry, instead of a PowerShell sweep of every process.

## 3.8.1

- **The consent page scrolls** - the page asking you to accept the agent-status
  hooks was a plain block inside a full-height, overflow-hidden column, so on a
  short panel the hook list and the **Accept** button were clipped with no way
  to reach them, and agent status could not be turned on at all. It now owns its
  own scroll region, the same way the worktree list and the settings body do.

## 3.8.0

- **Run and debug a worktree from its card** - VS Code's Run and Debug view
  always launches out of your main folder, and no extension can retarget it: its
  dropdown is built from the workspace folders' launch configurations and the
  selection belongs to the user. Debugging a change made in a worktree therefore
  meant opening that worktree in its own window first. Cards whose worktree has
  launch configurations of its own now carry a **Debug** button, sharing the row
  with New agent so it costs the card no space. It lists that worktree's
  `.vscode/launch.json` targets, including compounds, and starts one with the
  debugger, or without it via the play icon on the row. The program really does
  run in the worktree: `${workspaceFolder}`, `${workspaceRoot}` and
  `${workspaceFolderBasename}` are rewritten to that checkout throughout the
  configuration, including inside nested `args` and `env` values, and the working
  directory defaults to it unless the configuration sets one. Every other
  `${...}` variable is still resolved by VS Code. A configuration's
  `preLaunchTask` runs in the worktree too, which is what makes the session
  reflect the change you just made rather than whatever your main checkout last
  built: the label is resolved against the worktree's own `tasks.json` (or its
  package.json for an auto-detected `npm: <script>`), run with the worktree as
  its working directory, and a failing build stops the launch instead of debugging
  output it never produced. A task type that cannot be reproduced faithfully, a
  background watch task, and `postDebugTask` are each reported rather than
  silently skipped. Because these sessions start outside the debug view, the card
  also carries the way out: each running session gets a row naming its
  configuration and worktree, with a stop button that is always visible, so with
  several worktrees running something you stop the right one. Only sessions the
  panel started are listed, never one you launched yourself, and the sessions
  keep running if the extension host reloads.

## 3.7.2

- **A subagent working in its own worktree is now shown on that worktree's
  card** - agents increasingly fan work out one subagent per ticket, each in a
  git worktree of its own so their concurrent edits cannot collide. Every one of
  those subagents was listed under the session that spawned them, stacked on the
  card for a worktree none of them were touching, while the cards for the
  worktrees where the work was actually happening sat empty. Each subagent's row
  now sits on the card for the worktree it was given, naming the agent that sent
  it there, and a worktree with no agent of its own shows those rows instead of
  "No agents yet". The agent driving the fan-out keeps a count chip of everything
  it has in flight, so a session whose subagents have all moved elsewhere does
  not read as idle. Clicking any subagent row reveals its agent's terminal, which
  is the only terminal there is - a subagent does not have one.
  A subagent's worktree comes from the `cwd` on the events it fires itself, and
  is recorded on the subagent rather than on the session: the parent's own row
  must not move to another card. It is resolved once and cached against that cwd,
  so this costs one `git` call per subagent, not one per tool call. Subagents
  Claude Code's in-flight registry adopts (which fire no events of their own) and
  ones working outside this repository stay listed under their parent.

## 3.7.1

- **Agents that are no longer running are retired instead of lingering** - a
  session that exits cleanly fires `SessionEnd` and removes its own row, but one
  that dies with its terminal never gets the chance: closing the VS Code window,
  killing the terminal or restarting the machine all leave the session's state
  file behind with whatever status it last had. Since that state lives in storage
  shared by every window, reopening a window showed those agents as live rows -
  frequently mid-work, with a spinner and an Activity Bar badge - with no process
  and no terminal anywhere behind them, and only a 24 hour age cutoff to clear
  them. The panel now checks whether each session's process is actually there and
  drops the ones that are gone. Two markers make that possible: Claude Code runs
  a hook as a direct child of the session process, so the emitter records its
  parent pid (checked with a signal-0 probe, no process spawn), and sessions the
  extension launched are also matched by the `--session-id` it passed on Claude's
  own argv, which is how a session resumed into a different process is recognised
  as still alive. A retirement needs positive evidence of death, never just the
  absence of evidence of life, so an agent running in another window or in a
  terminal outside VS Code stays listed, and a wrong call self-heals on the
  session's next hook event. A dead pid is deliberately not treated as proof on
  Windows, where a hook run through a short-lived shell wrapper would look exactly
  like a dead agent; the argv check covers Windows instead.
- **A merged PR no longer lingers after the worktree changes branch** - a card
  could keep showing the pull request of the branch its worktree had left, and it
  never cleared, because a merged PR is terminal and the quiet path never
  refetched it. Two things kept it there. The PR poller wrote its results back
  keyed only by worktree path, so a poll already in flight when an agent ran
  `git checkout` restored the old branch's PR moments after the switch had pruned
  it, and the refresh the switch asked for was dropped outright because one was
  already running. Cache entries now carry the branch they were fetched for, a
  value from another branch reads as not-known, the write-back is skipped when
  the branch moved mid-fetch, and a refresh requested during an in-flight one is
  queued instead of dropped. Separately, the hook-driven agent refresh patches
  the cached payload rather than re-gathering, so an agent's checkout never
  re-targeted the PR service at all; it now falls back to a full refresh when
  `git status` reports a different branch, read from the status output already
  being collected so the check costs no extra process. Switching branches from
  the panel usually won that race, which is why this mostly showed up after an
  agent switched branches.

## 3.7.0

- **Subagents are now shown live, under the agent running them** - the panel
  used to carry a robot chip counting every subagent a session had ever spawned.
  That number only went up: a session that fanned out to five subagents an hour
  ago still advertised five long after they had all finished, so the count said
  nothing about what was actually running. Each running subagent is now a row
  indented under its parent, labelled with its agent type and the work it was
  given, with how long it has been going; the row disappears the moment it
  finishes. The Agents bar carries the live count so it stays visible when the
  agent list is collapsed. Tracking uses Claude Code's `SubagentStart` /
  `SubagentStop` hooks, which bracket foreground and background subagents alike
  and both carry the subagent's id - `SubagentStart` is a new managed hook and
  is added to `~/.claude/settings.json` automatically for anyone who already
  consented. A subagent that hands work to a background command stops its turn
  but stays in flight, so a stop is not treated as an end: it marks the row
  paused (listed, without the working pulse) and Claude Code's own in-flight
  registry, stamped on every stop as `background_tasks`, decides whether the
  subagent is really gone. The registry is also the only thing that catches a
  subagent you stop from Claude Code's agent manager - that fires no hook at
  all, since the agent's turn never ends - and it picks up subagents that were
  already running before the hooks were installed. When an agent needs you, the
  subagent behind the prompt is marked too: Claude Code's "needs you"
  notification never says which subagent raised it, and the hook that names the
  asker also fires for calls auto mode allows silently, so the panel pairs the
  two and only flags a subagent while the session itself is waiting.
  `PermissionRequest` is the second new managed hook and is likewise added
  automatically; it is used for that identification only and never reports a
  status of its own. Elapsed times tick in the panel itself, so they keep
  counting while a subagent works quietly and the extension has nothing new to
  post.
- **A subagent working in an isolated worktree no longer moves its parent's
  row** - hooks fired by a subagent report *its* working directory, which the
  emitter treated as the session's, so a subagent running in its own worktree
  re-keyed the parent and jumped that agent onto a different card until the next
  event moved it back. Subagent events now always keep the parent's worktree.

## 3.6.0

- **A clearer Marketplace listing** - the listing had grown to a 261-line body
  that buried what the extension actually does: four thumbnails too small to
  read, a twenty-bullet highlights wall with wildly uneven entries, and a
  Branches deep-dive longer than every other feature combined. It now opens with
  a six-bullet summary under the main screenshot, then covers agents, pull
  requests, branches and linked files in turn, each with its screenshot inline at
  a readable size. Adds a Linked Files screenshot, the one major feature that had
  none. Listing and documentation only; no change to how the extension behaves.
- **A background agent no longer yanks the terminal view away from the one
  you're reading** - when Claude generated or updated a session's title, the
  panel renamed that agent's terminal to match, and the only rename VS Code
  offers acts on the *active* terminal, so the rename had to reveal it first.
  While you were jumping between agents, whichever one answered next stole the
  selected terminal tab. Agent terminals are now left unnamed at launch, which
  keeps VS Code's escape-sequence title handling alive so Claude Code titles
  its own tab - live, background tabs included, with nothing to reveal. As a
  bonus the tab now tracks the session's current topic instead of the title
  that happened to exist when the last rename ran. On VS Code older than 1.117
  (or with `terminal.integrated.tabs.allowAgentCliTitle` turned off) the
  extension still names the tab itself, but only ever renames the terminal you
  are already in; the rest stay queued until you switch back to them.

## 3.5.1

- **Easier to find on the Marketplace** - the listing carried no search
  keywords at all, so it was effectively undiscoverable for the terms people
  actually search. Adds `claude`, `claude code`, `worktree`, `ai` and `git`,
  and lists the extension under the **AI** category alongside **SCM
  Providers**. Listing metadata only; no change to how the extension behaves.

## 3.5.0

- **Linked files: gitignored local config now reaches your worktrees** - a new
  worktree only gets the files git tracks, so the gitignored config a build or
  integration test depends on (an `appsettings.Development.json`, a `.env`, a
  certs folder) was simply absent and those tests failed there. A new
  **Settings -> Linked Files** tab holds a per-repository list of paths that are
  symlinked into every worktree the panel creates, pointing back at your main
  worktree's copy so editing the file once updates it everywhere. Finding them
  is one click: **Add from .gitignore** lists everything git ignores and you
  tick what you want, with wholly-ignored folders like `node_modules` collapsed
  to a single row so the list stays short. You can also browse with the normal
  file picker or type a path. New worktrees are linked automatically, and
  **Link existing worktrees** applies the list to the ones you already have.
  Removing a path unlinks it again. A file a worktree genuinely owns is never
  overwritten, and unlinking never touches the data the link pointed at.
  Works on Windows without Developer Mode or running as administrator: folders
  are linked with a junction and files fall back to a hard link, so you are
  never asked to elevate anything.

## 3.4.7

- **Status hooks can no longer surface errors in your Claude session** - when
  the emitter's state directory couldn't be created (deleted extension
  storage, a synced `~/.claude/settings.json` pointing at another machine's
  path), the emitter crashed and Claude Code printed a
  `PreToolUse:<tool> hook error ... failed with non-blocking status code`
  warning on every tool call. The emitter now swallows every failure and
  always exits 0 silently - a status update that can't land is dropped instead
  of erroring the session - and the hook command runs `node --no-warnings` so
  node's own startup warnings can't be reported as hook errors either. The
  repaired command is written to `settings.json` automatically on the next
  activation.

## 3.4.6

- **A new session's summary now appears during its first turn** - the first
  session title lands a few seconds after the first prompt, mid-turn, but the
  emitter only read the transcript at turn boundaries, so a busy new session
  showed its default "Claude N" label until the whole first turn ended. While
  a session has no title yet, tool events now also read the transcript tail,
  throttled to once per 5 seconds; once a title is known the per-tool-call hot
  path stays read-free as before.

## 3.4.5

- **A finished agent no longer counts as waiting forever** - Claude Code fires
  an idle nudge about a minute after any turn ends with no user input; the
  emitter treated it as "the agent needs you" and flagged every done session as
  waiting until its next prompt, keeping a permanent count on the Activity Bar
  badge. The idle nudge now preserves the prior state: an unanswered permission
  prompt stays waiting, a finished turn stays idle.
- **The Activity Bar badge now clears when no agent is waiting** - VS Code
  ignores clearing a view badge by setting it to `undefined` once a number has
  been shown (microsoft/vscode#162900 still reproduces for webview views), so
  the badge stuck at its last nonzero count even after every agent resumed or
  finished. The panel now clears it with a zero-value badge, which VS Code
  honors.

## 3.4.4

- **An agent delegating to background subagents no longer shows as waiting on
  you** - when a session's turn ended with background subagents still running,
  Claude Code's idle nudge a minute later flipped it to "waiting" (and lit the
  Activity Bar badge) even though it needed nothing from you. The emitter now
  reads the notification's machine-readable type and the transcript's pending
  background agent count: an idle nudge while subagents are still working, or
  a "subagent finished" notification, keeps the agent active. Permission
  prompts and questions still mark waiting, as does anything from an older
  Claude Code that sends no notification type.
- **Subagent counts work again on current Claude Code** - the robot chip
  counted spawns of the Task tool, which Claude Code renamed to Agent in
  2.1.63, so newer versions always showed no subagents. Both names now count.
- **SubagentStop hook installed** - a finishing subagent immediately marks its
  parent active (it is about to pick the result up). Existing installs pick
  the new hook up automatically on activation, without re-showing the consent
  page.

## 3.4.3

- **Waiting badge now clears when an agent resumes working** - the PostToolUse
  hook was never installed, so after you approved a permission prompt or
  answered an agent's question nothing marked the session active again until
  its next tool call started: the agent (and the Activity Bar count) stayed
  "waiting" while it was visibly working. The emitter always mapped
  PostToolUse to active; it is now actually installed, flipping the status
  back the moment the approved tool finishes. Existing installs pick the new
  hook up automatically on activation (all hooks run the same consented
  emitter), without re-showing the consent page.

## 3.4.2

- **Hook events no longer sweep git across every worktree** - agent activity
  now refreshes only the agent rows plus git for the worktrees whose sessions
  actually fired, instead of spawning git status for all of them on every hook
  burst. Payloads that differ only by the never-rendered activity heartbeat are
  no longer re-posted, so the panel stops rebuilding its DOM on every tool
  call.
- **Faster tool calls while the panel watches** - the status emitter no longer
  reads the session transcript on the tool-blocking PreToolUse/PostToolUse
  events (titles land at turn boundaries, which the other events cover), and
  its per-event directory create is now lazy.
- **Far fewer GitHub requests** - PR polling starts with one bulk open-PR list
  per repo instead of one list call per worktree, and a PR that is provably
  unchanged (same updated time and head commit) is reused with no follow-up
  requests. Checks still refresh while pending, and a periodic detail pass
  catches the out-of-date flag and check re-runs. Merged and closed PRs stop
  being refetched and no longer hold the poll at its fast cadence. The token
  is read once, not per call.
- **Stale badge fix** - overlapping refreshes could finish out of order and
  briefly show the Activity Bar badge for a waiting agent that had already
  resumed; the newest state now always wins.
- **Less background work** - repo root, primary worktree path, origin remote
  and hook-install state are cached instead of re-derived every refresh; a
  hidden panel skips its GitHub work until shown; the pulsing status dots no
  longer force continuous repaints.

## 3.4.1

- **A badge when an agent needs you** - the Activity Bar icon now shows a count
  of the agents waiting on a permission prompt or question, so a blocked agent
  is visible even while the panel is hidden behind another view. The badge
  clears when no agent is waiting, and appears once the panel has been opened
  in the window.

## 3.4.0

- **Deleting a worktree is one confirmation instead of up to five** - the
  dialog gathers everything upfront (agents that will be stopped, uncommitted
  changes, unpushed commits on the branch) and offers Remove or Remove and
  Delete Branch. Because the consequences are disclosed, there are no
  follow-up prompts: dirty or locked worktrees force-remove, and the branch
  delete forces past "not fully merged" when the unpushed commits were already
  shown.
- **Know which agent you are talking to** - the agent whose terminal is
  currently open is highlighted with a blue outline and terminal glyph, and
  its worktree's Agents bar is marked so collapsed cards still show it.
  Switching terminals updates the highlight instantly.
- **Location filter in the Branches view** - a multi-select alongside Updated
  by that narrows the list to Local only, Local + remote, or Remote only
  branches, matching the tag on each row.
- **Explicitly titled sessions show their title** - Claude Code records
  manually set session titles as custom-title transcript entries, which the
  status hook ignored; such agents fell back to "Claude 1" style rows. Both
  title kinds are read now, latest wins.
- **Source Control scope is readable at a glance** - the scope button is a
  labeled "Source Control" pill on every worktree with identical geometry
  active or not, so toggling never shifts the layout; the scoped worktree
  fills blue.
- **Destructive buttons are set apart** - the card-header delete and the
  branches-view Delete gone sit behind a divider with a red-tinted hover, and
  Delete gone moved to the end of the toolbar instead of between the fetch
  buttons.
- **Quieter git stats** - zero-value counters (`+/- 0`, up/down 0) are hidden,
  a fully quiet worktree shows a green Clean segment, and the Agents bar drops
  zero-count statuses (a single agent shows just its status dot).
- **Status is shape-coded** - active agents are a filled circle, waiting a
  filled diamond, idle a hollow ring, so state never relies on color alone.
- **Smaller polish** - the branches-view create button is secondary until
  hovered so the list is not a wall of blue; the settings token form collapses
  behind Replace token once connected, with Disconnect beside it; the
  add-agent button is labeled New agent; the switch-branch pencil and Delete
  gone use the panel's fast tooltip; Replace token and Disconnect are spaced
  apart.

## 3.3.5

- **Stale claude session locks are cleared automatically** - `claude -w` locks
  the worktree it creates and unlocks on exit, but a crashed or killed session
  left the lock behind: a `locked` badge on a worktree with no agents, and a
  worktree that refused to be deleted. On refresh (and before a delete) the
  panel now unlocks any worktree whose lock reason names a claude pid that is
  no longer running. Locks with any other reason, or a live pid, are never
  touched.
- **Force Remove now works on locked worktrees** - git requires the force flag
  twice to remove a locked worktree, and the panel only passed it once, so the
  Force Remove prompt always failed with "cannot remove a locked working
  tree". Deleting still asks for confirmation first, exactly as before.

## 3.3.4

- **Stopping a Windows agent no longer leaves its worktree locked** - closing an
  agent from the panel disposed its terminal before killing the process, so the
  `claude -w` child (which drops the launch session id from its own argv) could
  be orphaned and keep running, holding the worktree directory open and blocking
  removal. The kill now runs first, by session id, while the id-bearing parent
  is still alive so the tree kill reaches that child; the terminal is disposed
  only afterward. Removing a worktree likewise waits for every agent's process
  to be gone before git touches the directory.

## 3.3.3

- **Worktrees are created under `.claude/worktrees/`** - the New Worktree
  command and the Branches view's Create worktree action now place worktrees
  inside the repo at `.claude/worktrees/<branch>` (where `claude -w` puts
  them) instead of the repo's parent directory. The extension does not touch
  your ignore rules; add `/.claude/worktrees/` to `.git/info/exclude` or
  `.gitignore` yourself if you don't want the folder listed as untracked.
- **Hooks no longer slow down every tool call on Windows** - the status
  emitter caches the session's worktree/branch in its state file and skips the
  two `git rev-parse` spawns on follow-up events. `PreToolUse` blocks each
  tool call until the hook exits, so on Windows (where process spawns are
  expensive) this removes a per-tool-call lag.
- **Agent rows no longer flicker during bursts of activity** - the emitter
  writes its state file atomically (tmp + rename), so the panel's watcher can
  never read a half-written file and briefly drop the agent's row.
- **A hidden Branches tab no longer drives background git work** - refreshes
  skip the branch listing while the tab is hidden behind another editor and
  catch up when it becomes visible again, sparing a burst of git processes per
  agent event on many-branch repos.
- **Refreshes bound their git process burst** - per-worktree `git status`
  calls now run at most 4 at a time, keeping refreshes smooth on repos with
  many worktrees (most noticeable on Windows).

## 3.3.2

- **Reviewer filter scoped to you** - the Branches filter bar's **Review
  requested** option now keeps only branches whose pull request has a review
  requested from the signed-in user, i.e. the pull requests you still have to
  review, instead of any pull request with an outstanding reviewer.

## 3.3.1

- **Reviewer filter** - the Branches filter bar gains a **Reviewer** single-select
  beside **PR Status** that narrows the list to branches whose pull request has a
  review requested from one or more person: **All** (no filter) or **Review
  requested**. Shown only once a GitHub token is connected, and reset by Clear
  Filters.

## 3.3.0

- **Switch a worktree's branch from the panel** - an edit button beside the
  branch name checks out a different branch in that worktree, or creates a new
  one, without leaving the panel.
- **PR Status filter** - the Branches filter bar's one-click **Open PRs** toggle
  is now a **PR Status** single-select with **All** (no filter), **Open**, and
  **Draft**, so you can narrow the list to just open or just draft pull requests.
- **Clear Filters button** - a one-click reset for the Branches view's author and
  PR Status filters, enabled only while a filter is active. Sort is left as you
  set it.
- **The Branches view paints instantly** - the branch list now renders right away
  from local git instead of waiting on the GitHub token probe; PR and CI status
  fill in afterward in the background.
- **A merged PR no longer lingers after switching branches** - when a worktree
  switches off the branch a merged pull request was tied to, the PR badge clears
  instead of staying on the card until the next poll.
- **New Debug tab in Settings** - the panel's Settings view gains a Debug tab
  surfacing diagnostic details for troubleshooting.

## 3.2.0

- **The Branches view now fetches only open PRs** - it previously listed every
  PR in the repo (open, merged and closed), which paged through up to ~1000
  historical PRs on a repo with a long history to surface a handful of open ones.
  Since the view only ever shows open and draft PRs, it now requests just those,
  so the fetch is typically a single call. The header button is renamed from
  **Refresh GitHub** to **Fetch Open PRs** to match.
- **New Open PRs filter** - a one-click toggle in the Branches filter bar (shown
  only when a GitHub token is connected) narrows the list to branches with an
  open pull request.
- **Alternating row backgrounds** - adjacent worktree cards and branch rows now
  alternate their background shade so they are easier to tell apart.

## 3.1.1

- **The Branches view PR status now works with fine-grained tokens** - it
  previously fetched PRs through GitHub's GraphQL API, which a fine-grained
  personal access token can be denied even when it works for the worktree cards
  (the "Resource not accessible by personal access token" error). The view now
  pulls every PR for the repo in a single REST call that only needs
  **Pull requests: Read**. The tradeoff: the bulk call carries no CI-check or
  review-approval detail, so the Branches view shows a PR's title, state, author,
  assignees and whether you are a requested reviewer, but not its checks/reviews
  rollup - that is still on the worktree card.
- **Fewer redundant git calls on refresh** - the repo's default branch
  (`origin/HEAD`) was looked up several times per refresh, spawning duplicate
  `git symbolic-ref` processes (most noticeable on Windows). It is now resolved
  once and reused.

## 3.1.0

- **The Branches view is now git-first** - branches always list, sort, and
  filter from local git, with no GitHub needed. Each row shows when the branch
  was last updated (the relative time of its latest commit) and who made that
  commit. A new **Updated by** filter narrows the list to the people who last
  touched each branch, and **Sort** orders by most or least recently updated, or
  by name. The old PR-based filters (Author, Reviews, Open PR / Auto merge) are
  gone in favor of these.
- **A branch's pull request is shown as a hint** - when the GitHub integration
  is connected, a branch that has an open (or draft) PR still shows its status
  inline on the row. Merged and closed PRs are no longer displayed. A dedicated
  PR view may come later.
- **The "@" next to review counts is now a proper icon** - the requested
  reviewers ("review pending") count rendered a bare "@" character that looked
  like a glyph that failed to load next to the other icons. It is now an eye
  icon, matching GitHub's "review requested" convention.
- **Easier to diagnose missing PR status** - when the Branches view can fetch no
  PRs even though the worktree cards show them, the reason (the GraphQL call's
  error, or a "fetched N PRs, matched M branches" tally) is logged to the "Agent
  Worktrees" output channel. The cards use a different GitHub API path than the
  Branches view, so a token granted one but not the other now surfaces clearly.

## 3.0.0

- **No more runaway refresh loop** - the panel watched the whole workspace for
  file changes, but its own `git status` opportunistically rewrites
  `.git/index`, so each refresh fed straight back into another refresh - a
  self-sustaining loop that respawned git for every worktree several times a
  second even while the editor sat idle. The workspace-wide watcher is gone; the
  panel now refreshes on discrete signals (load, the Refresh button, Claude
  agent activity, window focus, source-control scope changes). Read-only git
  also runs with `GIT_OPTIONAL_LOCKS=0` so it never churns your index.
- **Stop agent works on Windows** - stopping an agent (and removing a worktree
  with a running agent) had no effect on Windows: the kill paths were
  Unix-only, so the panel row vanished while the Claude process kept running and
  could hold the worktree directory open, blocking removal. Stopping now
  tree-kills the agent by its session id via `taskkill /T`, which also reaches
  the `claude -w` child process.
- **Per-worktree refresh button** - each worktree card now has a refresh button
  that re-reads just that worktree's git status and, when the GitHub integration
  is on, re-fetches that one worktree's PR/CI status. It does not run a `git
  fetch` (that stays the toolbar Refresh), so it's a quick, targeted update of a
  single card instead of refreshing everything.

## 2.7.7

- **Branches view no longer shows a +/- line diff** - computing it required one
  `git diff` process per branch (git has no batch form), which was the main
  remaining cost when listing branches on a large repo. The branch rows now show
  just the commit ahead/behind (the more useful signal), which is already
  computed in a single batched call. Listing a repo's branches now costs a
  handful of git processes total instead of one diff per branch. The worktree
  cards still show their +/- line totals.

## 2.7.6

- **Faster worktree loading** - loading the panel ran `git status` AND
  `git diff --numstat HEAD` for every worktree on every refresh. The diff is
  empty for a clean worktree, so it is now skipped unless the worktree has
  tracked changes. A clean worktree costs one git spawn instead of two, which
  noticeably cuts the "Loading worktrees" time (and the non-stop
  `git diff --numstat HEAD` calls) on Windows, where each process spawn is
  expensive. The worktree-load time is also logged when debug tracing is on.

## 2.7.5

- **Debug tracing for external calls** - a new `Agent Worktrees: Trace` setting
  (off by default) logs every external call to the "Agent Worktrees" output
  channel: each git command and each GitHub API request, with its duration and
  result. Turn it on to see exactly what the panel runs on your machine (handy
  for diagnosing slow or failing git/GitHub activity on Windows or Mac). Toggle
  it from Settings or the "Agent Worktrees: Toggle Debug Tracing" command;
  "Agent Worktrees: Show Log" reveals the channel. Request headers (which carry
  your token) are never logged.

## 2.7.4

- **Panel is much less of a CPU hog on Windows** - the sidebar refreshes when
  files change, when an agent fires a hook, and when the window regains focus,
  and each refresh spawns `git status` + `git diff` for every worktree. The
  session-state watcher used to refresh on every single hook event with no
  batching, so an active agent (which fires many hooks a second) triggered a
  storm of git processes - and process spawning plus file watching are both far
  more expensive on Windows than on macOS, which is what made the panel feel
  sluggish. All three signals now funnel through a debouncing coalescer: a burst
  of events collapses into one refresh, a continuous stream (a build writing
  files, an agent streaming tool output) still flushes at a bounded rate instead
  of either spamming or stalling, and an in-flight refresh never overlaps itself.
  The behavior is unchanged - the panel shows the same up-to-date state - it just
  does the expensive work far less often.

## 2.7.3

- **Branches view is much faster on big repos** - ahead/behind for every branch
  is now computed in a single `git for-each-ref` call (using the
  `%(ahead-behind:)` atom on git 2.41+) instead of one `git rev-list` per branch.
  Combined with the existing "diff only branches that are ahead", a repo with
  dozens of branches now spawns a handful of git processes on load instead of one
  or two per branch, which is what pegged the CPU and stalled the view on
  Windows. On older git (pre-2.41) it falls back to the per-branch calls.
- **Branches view surfaces failures instead of a blank list** - when listing
  branches fails (git missing, hung, or timed out) the view now shows the error
  and points to the new "Agent Worktrees" output channel, rather than a
  misleading "No branches found". This is aimed at the Windows reports where the
  view never loaded and there was nothing to diagnose: git activity, per-load
  timing (branch count and how many ahead/behind and diff calls ran), and any
  failure are now logged to View -> Output -> "Agent Worktrees".
- **Git calls no longer hang the view forever** - every git invocation now has a
  timeout, so a wedged call (auth prompt, stalled network) surfaces as an error
  instead of an endless "Loading branches" spinner.

## 2.7.2

- **Branches view loads fast on Windows** - listing branches enriches each one
  with ahead/behind and a line diff, and every git call used to run through a
  shell (`child_process.exec`), which on Windows spawns a `cmd.exe` per call. On
  a repo with many branches that meant hundreds of `cmd.exe` + `git.exe` spawns
  per load, pegging the CPU and leaving the view stuck on "Loading branches".
  Two fixes: all git calls now run via `execFile` with argument arrays (no
  shell), which roughly halves the process count, speeds each spawn, suppresses
  the console window flashes, and removes the fragile `--format='...'` quoting
  that differed between cmd.exe and POSIX shells; and the per-branch line diff
  now runs only for branches that are actually ahead of their base (a merged or
  in-sync branch's diff is always empty), so a repo full of merged branches no
  longer runs a tree diff per branch.
- **Source Control scope button now works on Windows** - the button matched
  worktree paths by exact string, but git reports an uppercase drive letter
  ("C:\\repo") while VS Code reports it lowercased ("c:\\repo"), so the paths
  never compared equal. The button now neither failed to highlight nor failed to
  reduce Source Control to the single worktree. Paths are now canonicalized
  (drive letter lowercased) so scoping applies and the active button highlights.
- **Switching tabs no longer reloads the panel** - the worktree view now retains
  its state while hidden, so leaving for Source Control (or any other view) and
  coming back no longer tears down and rebuilds the panel, which had made the
  list flash and reload, most visibly on Windows.

## 2.7.1

- **Clicking an agent from another window no longer does nothing** - the agent
  list is shared across every VS Code window, but a terminal can only be revealed
  by the window that started it. Clicking an agent whose terminal lives in another
  window (or was started outside the extension) now shows a short message saying
  so, instead of silently failing. Revealing an agent from the window that owns it
  is unchanged.

## 2.7.0

- **Branches view refreshes GitHub on open** - opening the tab paints your local
  branches instantly, then automatically re-polls PR and CI status in the
  background, with the **Refresh GitHub** button spinning until it lands. The git
  Fetch stays a manual action, so opening the view never runs a git fetch.
- **Branches button no longer hangs with a spinner** - the sidebar **Branches**
  button just opens the view now (it makes no calls), so it no longer spins until
  a timeout while the editor tab loads.

## 2.6.0

- **Branches view no longer calls GitHub on open** - opening the tab reads your
  local branches instantly and never hits the GitHub API. PR and CI status is
  fetched only when you click **Refresh GitHub**; every other action (open, git
  Fetch, background refreshes, creating a worktree) reuses the cached data.
- **Last refreshed time** - a **Last refreshed** label sits under the Refresh
  GitHub button, reading **Never** until your first refresh and then the time of
  the most recent one, so it is clear when the PR view was last updated.
- **Header layout tidy-up** - the **Prune** checkbox now sits under **Fetch** and
  the Last refreshed time under Refresh GitHub, and the open-PR filter chip reads
  **Open PRs**.
- **Active and waiting agent dots pulse** - the green (active) and yellow
  (waiting) status dots now visibly pulse in the agent rows and the Agents bar,
  so in-progress and needs-attention agents read at a glance.

## 2.5.0

- **Default branch is never deletable** - the repo's default branch (from
  origin/HEAD) shows no Delete action and is refused server-side, so main/master
  cannot be removed by accident.
- **Branch delete is local-only** - the row action is now **Delete Local** and
  only branches that exist on your machine show it; it removes the local branch
  and never touches the branch on the remote. Remote-only branches show no delete.
- **Delete is worktree-aware** - deleting a branch checked out in your main window
  is blocked (switch away first); one checked out in another worktree is allowed
  after a confirm, which leaves that worktree on a detached snapshot (files intact)
  before removing the branch.
- **Delete gone branches in one click** - a header **Delete gone** button deletes
  every local branch whose upstream is gone (merged or deleted on the remote). It
  skips the default branch and any branch checked out in a worktree, confirms once,
  and force-deletes squash-merged leftovers only after a second confirm that names
  them. Pair it with Prune so a just-deleted remote branch is recognized.
- **Remove a worktree, drop its branch too** - removing a worktree now offers to
  delete the branch it was on (never the default), with an extra confirmation when
  that would lose unpushed or uncommitted work.
- **Refresh GitHub, separate from Fetch** - PR and CI status has its own **Refresh
  GitHub** button (shown when a token is stored) that re-queries the API without a
  git fetch, so you can refresh the PR view and your local branch state
  independently.
- **Buttons show progress** - actions that do real work (start agent, create
  worktree, open window, fetch, refresh) swap their icon for a spinner while they
  run, and in-progress CI checks and active agents pulse so they read at a glance.
- **No more delete flicker** - deleting a branch no longer briefly re-adds it
  before removing it again; a stale background refresh can no longer clobber the
  fresh list.

## 2.4.0

- **Branches view filter bar reworked, nothing selected by default** - the
  **Mine + to review** scope and the **Your PRs** / **Awaiting your review** /
  **Assigned to you** preset chips are gone. The view now lists every branch
  until you pick a filter.
- **Author select** - a multi-select populated from the authors found across the
  fetched PRs (you pinned to the top), to narrow the list to one or more authors.
- **Reviews select** - a single-select of the GitHub review statuses (No reviews,
  Review required, Approved, Changes requested, Reviewed by you, Not reviewed by
  you, Awaiting review from you); pick **Any** to clear it.
- **Open PR and Auto merge chips** - toggle chips to show only branches whose PR
  is open, or whose PR has auto-merge enabled.

## 2.3.0

- **Branches view defaults to your branches** - a new **Mine + to review** scope
  (on by default) narrows the Branches view to branches you created (any local
  branch, or a remote-only branch whose PR you authored) plus any whose review
  involved you (review was requested from you at some point, or you already
  reviewed it). Clear the chip to see every branch again. Without the GitHub
  integration connected it falls back to your local branches. The choice persists
  across reopens like the other filters.
- **Delete local branches** - the **Delete** action now appears on any local
  branch, not just branches whose PR you authored (a local branch is yours by
  virtue of living on this machine). Remote-only branches still require that you
  authored their PR.
- **Unpushed-work warning on delete** - deleting a local branch with commits not
  on its upstream (or, with no upstream, not on the default branch) now shows the
  count in the confirm dialog and force-deletes on confirm, so nothing is lost
  silently.
- **Merged branches delete without the scary prompt** - when a branch's PR is
  merged, deleting it no longer hits git's "not fully merged" refusal (a
  squash-merge leaves the commits unreachable even though the work is in the
  base); it force-deletes after the normal confirm.
- **Commit and diff summary on each branch row** - rows now show ahead/behind
  (↑/↓) and the +/- line diff against the branch's compare base (its upstream, or
  the default branch when it has none), mirroring the worktree cards.
- **Explicit Fetch button with a Prune toggle** - the Branches header has a
  **Fetch** button and a **Prune** checkbox (on by default). Fetching refreshes
  ahead/behind, diffs and PR merge state; with Prune on it also drops tracking
  refs for branches deleted on the remote.

## 2.2.1

- **Branches view prunes deleted remote branches** - fetches now run with
  `--prune`, and opening the Branches view fetches and prunes automatically, so
  branches deleted on the remote stop showing as **remote only** / **local +
  remote**. The refresh button does the same on demand.
- **Deleting a branch tolerates an already-deleted remote** - removing a branch
  whose remote was already gone no longer errors with "remote ref does not
  exist"; the stale remote-tracking ref is pruned instead.
- **"Show only this worktree" in Source Control now reliably switches** - scoping
  closes the other open repositories so the Source Control view shows just the
  selected worktree, even when more than one repo was open, and closes them via a
  more reliable call so the view actually changes (not only the button
  highlight).

## 2.2.0

- **Delete branches you authored** - branches whose pull request you authored
  now show a **Delete** action in the Branches view. When the branch exists both
  locally and on the remote you choose what to remove (local, remote, or both);
  otherwise it deletes whichever side exists after a single confirm. An unmerged
  local branch prompts before force-deleting so nothing is lost by accident.
  Deletion is offered only for branches you authored, since git records no branch
  owner and PR authorship is what identifies yours.
- **Jump to GitHub from a branch** - each branch name links to that branch on
  GitHub, and a **Branches on GitHub** link in the header opens the repository's
  full branches page.
- **Refresh button** - the Branches view header has a refresh control that
  fetches the latest remote branches, ahead/behind counts, and PR status.
- **Paged branch list** - long branch lists are paginated (25 per page) so they
  stay easy to scan.
- **Steadier Branches view** - the view only rebuilds when its data actually
  changed and now preserves your scroll position, so a background refresh no
  longer jumps you back to the top.
- **Fix: phantom "origin" branch** - the remote default-branch alias
  (`origin/HEAD`) was being listed as a branch named `origin`; it is now filtered
  out.

## 2.1.0

- **Merge-readiness pills on the PR view** - the PR summary now flags two
  states beside the header badge: **Out of date** when the branch is behind its
  base branch (GitHub's "This branch is out-of-date with the base branch") and
  **Auto-merge** when auto-merge is enabled, so a green-but-unmerged PR is no
  longer ambiguous.

## 2.0.0

- **Branches view** - a new full-screen editor tab, opened from the panel
  toolbar, lists every branch in the repository: your local branches plus
  branches that exist only on `origin`. Each row is tagged by where it lives -
  **local only**, **local + remote**, or **remote only** - and, when it tracks a
  remote, shows how far ahead or behind upstream it is (up to push, down to
  pull).
- **Per-branch PR status, filtered and sorted** - when GitHub is connected, each
  branch row shows its PR (open, merged or closed) with the same state, checks,
  reviews and comments rollup as the worktree cards, fetched in one batched
  GraphQL query. A filter and sort bar slices the list client-side: filter by
  author or review state, sort by recency or comment count, and one-click preset
  chips for **Your PRs**, **Awaiting your review**, and **Assigned to you**.
- **Create a worktree or start an agent from any branch** - a branch with no
  worktree gets a **Create worktree & start agent** action (remote-only branches
  are checked out as a new local tracking branch); a branch that already has a
  worktree shows a **Worktree exists** marker plus a **Start agent** action that
  launches a Claude agent in that worktree.

## 1.2.0

- **Terminal tab icon is legible on dark themes** - agent terminal tabs now use
  a theme-specific glyph (light on dark themes, dark on light) instead of a
  single `currentColor` SVG that rendered black and vanished on dark backgrounds.
- **Refreshed panel contrast** - the New Agent button moves to its own
  right-aligned row and uses the Agent Worktrees glyph instead of a generic
  sparkle, with assorted contrast/readability tweaks across the panel.
- **Agents are named by their work summary** - rows and terminals follow
  Claude's generated session title; the per-row manual rename button was removed.
- **Docs** - dropped the standalone "New Worktree" action from the README (the
  panel creates worktrees through the New Agent & Worktree flow).

## 1.1.0

- **PR status reads as two labeled rows** - the PR summary now shows a header
  (state + link), a **Reviews** row, and a **Checks** row, so CI checks and
  review decisions no longer read as one ambiguous run of checkmarks. Reviews
  shows approvals (green), changes requested (red, with count), reviewers still
  pending (gray), and comments; Checks shows passing / failing / running.
- **Accurate, faster CI updates after a push** - a PR whose commit has no legacy
  commit statuses no longer shows a phantom pending check, and when a push lands
  the panel polls quickly for a short window so the fresh pending checks appear
  in seconds instead of up to a minute.
- **Source Control scope shows its state** - the per-worktree scope button
  highlights the worktree whose repository is currently shown in Source Control,
  and that state now populates on window load, not only after a manual refresh.
- **Quieter agent rows** - dropped the elapsed-time / status text from each agent
  row; the status dot color already conveys active / waiting / idle.

## 1.0.0

- **Source Control scoping per worktree** - an opt-in button on each worktree
  (Settings -> Integrations) scopes the built-in Source Control view to that
  worktree. With one repository open it swaps the view to the selected worktree;
  with several open it leaves the others. The button highlights the worktree
  whose repository is currently shown, so you can tell at a glance which scope is
  set. It no longer switches you to the Source Control view.
- **Real agent summaries** - the agent row and its terminal now show Claude's
  own generated session title (read from the transcript) instead of your last
  prompt, falling back to the prompt only until a title exists.
- **Snappier summary tooltip** - hovering an agent summary shows the full text
  after 200ms via a themed tooltip, instead of the slow native one.
- **Terminal icon matches the extension** - agent terminals use the Agent
  Worktrees glyph instead of the generic sparkle.
- **Accurate CI rollup** - a PR whose commit has no legacy commit statuses no
  longer shows a phantom pending check. The "Commit statuses" PAT permission is
  now optional, and a token missing an optional permission stops being retried
  for the life of the token.
- **Predictable ordering** - worktrees are sorted with the primary pinned to the
  top and the rest by name (attention-based reordering was removed).

## 0.3.0

- **Cheaper GitHub polling with conditional requests** - PR status fetches now
  send `If-None-Match` with the ETag from the previous response. GitHub answers
  unchanged resources with a `304 Not Modified` that does not count against the
  API rate limit, so the adaptive poll stays well within limits even while CI is
  running and it polls every 15 seconds. Stored ETags are cleared whenever the
  token changes.

## 0.2.0

- **Settings is now a full page** - the gear opens a full-window settings view
  with a vertical tab rail (GitHub for now) and a Close button, instead of a
  modal overlay. "Show PR status on worktrees" is a sliding toggle.
- **CI checks on the PR row** - the PR line shows a counted segment per check
  state (passing, failing, running) with "N of M" tooltips, instead of a single
  countless glyph. The open-on-GitHub affordance uses an external-link icon.
- **Refresh is now a full sync** - the refresh action runs a `git fetch` so the
  behind ("commits to pull") count is accurate, and forces a fresh GitHub PR/CI
  fetch instead of reading the cache. Background refreshes stay lightweight.
- **Clearer git status line** - always shows the diff totals (a gray `+/- 0`
  when clean, `+N` / `-N` when changed) and up/down arrows for commits to push
  and pull.
- **Readability pass** - bumped the smallest text up a step and raised contrast
  on the git line, PR line, agent meta, Agents bar, and badges. PR state badges
  use saturated fills so their text stays legible.
- **Tidier toolbar** - the Agent & Worktree button uses the extension's icon;
  the redundant in-panel refresh and the "New Worktree" title-bar button were
  removed (the New Worktree command is still in the Command Palette).
- The full agent summary now shows on hover of the agent label itself (the
  separate info icon was removed).

## 0.1.0

- **GitHub PR status per worktree** — an optional integration shows each
  worktree branch's open PR right on its card: state and number, CI check
  rollup, review decision, and comment count, with the row linking out to the
  PR. It is fully opt-in and gated on a personal access token you provide (no
  token means no GitHub calls at all), and any GitHub error degrades quietly
  without affecting the worktree or agent display.
- **Settings modal** — a new gear in the panel title bar opens a settings modal
  that manages the GitHub connection: paste a token (kept in VS Code Secret
  Storage), toggle PR status on or off, and use the pre-filled links to create a
  fine-grained or classic token with exactly the read-only permissions needed.
- PR status refreshes on an adaptive timer and is nudged by Claude Code hook
  activity, so a PR an agent opens with `gh pr create` surfaces quickly.

## 0.0.3

- **Full summary on hover** — agent rows now show an info icon after the name;
  hover it to read the complete work summary when the row text is truncated.
- **Session data moved out of `~/.claude`** — the emitter and its per-session
  state files now live in the extension's global storage instead of
  `~/.claude/agent-worktrees/`. Installed hooks migrate automatically on the
  next launch, and the old directory is cleaned up.

## 0.0.2

- **Open in new window** — each worktree card has a button to open that worktree
  in its own VS Code window. When a window for the worktree is already open, it
  is focused instead of duplicated (focus behavior uses the `code` CLI when it is
  on `PATH`; otherwise a new window is always opened).

## 0.0.1

Initial release.

- **Worktrees panel** listing every worktree (primary + linked) with branch name
  and `Primary` / `detached` / `locked` badges.
- **Per-worktree git status** — changed-file count, `+`/`−` line totals, and
  ahead/behind from the upstream branch, refreshed as files change.
- **Agent** — start one or more Claude CLI sessions in a worktree, each in its
  own terminal; reveal, rename, or stop them from the panel.
- **Agent & Worktree** — create a worktree with `claude -w` and start an agent in
  it in one step.
- **New Worktree** / **Delete Worktree** — `git worktree add` / `remove`
  (with a force option, and stopping any agents in the worktree first).
- **Live agent status from Claude Code hooks** — agents show as active, waiting,
  or idle; consent-gated, with status flowing through local state files only.
- **Attention routing** — worktrees with a waiting or active agent float to the
  top of the list.
- **Skills used** — each agent row shows the count of Claude skills it invoked,
  with a click-through list.
</content>
