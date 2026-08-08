# Agent Worktrees

**Run and monitor several Claude Code agents across your git worktrees, from one side panel.**

Each worktree is an isolated checkout, so parallel agents never step on each
other's files. This panel puts every worktree, its git state, its pull request
and its running agents in one view.

<img src="https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/overview.png" alt="The Agent Worktrees panel: three worktrees with branch names, git status, PR rollups and their running Claude agents" width="380">

- Every worktree at once: changed files, `+`/`-` lines, ahead/behind.
- Start a Claude agent in any worktree in one click, or create a worktree and an
  agent together.
- Live agent status: active, waiting, idle. Activity Bar badge when one is
  blocked on you.
- PR state, CI checks and reviews on the card. No browser tab.
- Run or debug a worktree's launch configuration without opening a second window.
- Search a worktree, or open a file from it, in your current window.
- A Branches tab for every branch in the repo.
- Four worktrees in the height one card used to take.

## Agents

- A Claude CLI session in any worktree, each in its own terminal.
- **Agent & Worktree** creates a worktree with `claude -w` and starts an agent in
  it in one step. The card appears with the agent already on it.
- Reveal or stop any session, including agents you started by hand in a terminal.
  Rows find their terminal by which one the process is actually in, so Reveal and
  Stop hit the right session. One in another VS Code window says so.
- The agent whose terminal is open is highlighted, so you never type to the wrong
  one.
- Terminal tabs are titled by Claude Code itself and track each session's current
  topic. Background tabs included, and the tab you are reading is never pulled
  away.
- Live subagents are listed under their agent with what each is doing and for how
  long, and clear themselves when they finish.
- Fan-out across worktrees: a subagent working in another worktree is listed on
  *that* worktree's card, naming the agent that sent it. Clicking it opens the
  parent's terminal.
- Skill chips show which Claude skills an agent has used.
- Dead sessions retire themselves, so reopening a window shows agents that are
  actually running.

### Status

| Status      | When                                                      |
| ----------- | --------------------------------------------------------- |
| **idle**    | started, or finished responding and awaiting you          |
| **active**  | processing a prompt, or running a tool or shell command   |
| **waiting** | needs you: a permission prompt or a question              |

Status comes from the session files Claude Code already keeps. Nothing to set up,
nothing to approve, **nothing sent over the network**, and nothing written to your
Claude settings. Hooks that earlier versions asked you to install are removed
automatically; hooks you added yourself are left alone.

The Activity Bar badge counts **waiting** agents only, so it always means an agent
needs you.

<img src="https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/skills.png" alt="The skills modal listing the Claude skills one agent has invoked" width="380">

## Pull requests

Every card links its branch to GitHub with no token and no setup. Connect a token
and the card grows a PR rollup:

- Title, state, CI checks, reviews, comment count.
- **Out of date** and **Auto-merge** pills.
- Refreshed as your agents work, plus a per-card refresh.
- Always the PR for the branch checked out right now, so a merged branch's PR
  clears instead of lingering.

| On the worktree card | Connecting a token |
| :--- | :--- |
| <img src="https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/pr-status.png" alt="A worktree card showing its PR state, auto-merge pill, review counts and CI check rollup" width="380"> | <img src="https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/settings.png" alt="Settings, GitHub tab: the PR status toggle and the connected token" width="380"> |

## Branches view

A full editor tab listing every branch in the repo, local and remote-only.

<img src="https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/branches.png" alt="The Branches editor tab: every branch with last-updated time and author, location tags, PR status and create-worktree actions" width="860">

- **Start agent** on branches with a worktree, **Create worktree & start agent**
  on the rest. A remote-only branch is checked out as a new local tracking branch.
- Last-updated time, author, location tag and ahead/behind, all from local git
  with no token.
- Filter and sort by updater, location, PR status, or review-requested-from-you.
  Your choices are remembered.
- **Fetch and prune** to refresh ahead/behind and drop dead refs.
- **Delete Local** never touches the remote. It warns about unpushed commits and
  handles squash-merged branches without asking you to force it.
- **Delete gone** clears every local branch whose remote is gone, in one
  confirmation.

New worktrees land in `.claude/worktrees/`, the same place `claude -w` puts them.

## Linked files

A new worktree only gets the files git tracks, so the gitignored local config your
build or tests need is missing and they fail.

<img src="https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/linked-files.png" alt="Settings, Linked Files tab: a list of gitignored paths symlinked into every worktree, with Add from .gitignore and Link existing worktrees buttons" width="380">

- List the paths once per repository; every worktree gets them symlinked in,
  including worktrees the panel did not create.
- The list belongs to the repository, so it reads the same from any worktree.
- **Add from .gitignore** lists what git ignores so you can tick what you need.
  Whole folders like `node_modules` collapse to one row.
- Links point at your main worktree's copy, so editing once updates everywhere.
- **Link existing worktrees** applies the list to the ones you already have.
- A file a worktree genuinely owns is never overwritten.
- Windows works without Developer Mode or admin rights (junctions, then hard
  links).

## Run and Debug a worktree

VS Code always launches out of your main folder. Each card gets a **Debug** button
instead, shown only on worktrees that have launch configurations.

- Any configuration from **that worktree's own** `launch.json`, so a branch that
  added one offers it.
- Run with the debugger, or click the play icon on a row to run without
  breakpoints. Compounds work too.
- `${input:...}` prompts work, from the worktree's own `inputs`, and a compound
  asks once for a shared input.
- `${workspaceFolder}`, the working directory and any `preLaunchTask` all point at
  the worktree, so you debug what you just changed. A failed build launches
  nothing.
- Stop it from the same card: each session gets a row on the worktree it runs in.

## Cards built to be scanned

Every card is two lines at rest, and one click shuts them all.

<img src="https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/collapsed.png" alt="Four worktrees with every card collapsed: one header line each with agent counts, git totals and the PR rollup" width="380">

- **Nothing is dropped at two lines**: branch, agent and subagent counts, status
  dots and git totals.
- **The PR stays one block**, with reviews and checks sharing a line, split by a
  rule so the two sets of checkmarks never blur together.
- **Names stay put while you scroll**: a card's header pins above its own agent
  rows, so you never reveal a terminal from the card below the one you meant.
- **Click the name to open a card, not the whole line.** A vertical rule marks
  where the toggle stops, and the hover highlight shows exactly what the click
  will hit.
- **The name line stays a name line.** Past that rule: the Source Control scope
  pill and a caret menu holding switch branch, refresh, search, find file, run or
  debug, open in a new window, view on GitHub and delete. **New agent** sits
  beside the Agents heading.
- **The worktree's own directory** is a labelled `Worktree` line in the body, with
  the full path on hover. Cards are titled by branch, which is what you scan for.
- **Glyphs instead of pills** for your primary working directory (a house) and for
  locked or detached worktrees.
- **The outlined card is the one you are typing into**, not the one that happens
  to be your open folder.
- **A repo-wide agent summary** under the repository name, so "is anything waiting
  on me" is one glance.
- **The agent list scrolls instead of folding**, so a busy worktree cannot push
  every card below it off screen.
- **One button opens or shuts every card** and says which it will do. Your open
  cards are remembered.

## Search and find files without leaving your window

A worktree is not part of your open workspace, so **Find in Files** and
`Ctrl/Cmd+P` never see it. Two buttons per card fix that.

- **Search this worktree** opens the search view already scoped to it.
- **Find file in this worktree** lists its files and opens the one you pick, right
  here.
- The list matches what `Ctrl/Cmd+P` would show: tracked and untracked, nothing
  gitignored.
- Your workspace is untouched: no Explorer entry, no reload, no agent disturbed.

## Also included

- **Open in a new window**, focusing an existing one rather than duplicating it.
- **Switch a worktree's branch**, or create a new one.
- **Delete a worktree** in one confirmation that says upfront what it touches
  (agents, uncommitted changes, unpushed commits) and can delete the branch too.
  Leftover folders git could not remove are cleaned up.
- **Stale lock cleanup** for dead sessions. Locks you placed are never touched.
- **Source Control scoping**, so the SCM view follows the worktree you pick.
- **A Performance tab**: git's `status` accelerators for this repo, with a switch
  for each, plus how often the panel rechecks worktrees.
- **Buttons that show their work**: slow actions swap their icon for a spinner.
- **A settings nav that folds to icons** on a narrow sidebar.

## Requirements

- The [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) (`claude`) on
  your `PATH`.
- `git` on your `PATH`.
- A workspace whose first folder is inside a git repository.

## Getting started

1. Install the extension and open a folder that is a git repository.
2. Open **Agent Worktrees** from the Activity Bar.
3. Click **Agent** on any worktree, or **Agent & Worktree** to create both at once.

## Troubleshooting

**Panel slow or empty?** Settings, **Debug** tab, turn on **Debug tracing**. Every
git command and GitHub request is logged with its duration and result to the
"Agent Worktrees" output channel. Off by default, and request headers, which carry
your token, are never logged.

**Slow on a big repository, especially on Windows?** Per-worktree `git status` is
usually the cost. Settings, **Performance** tab shows whether this repository has
git's untracked cache and filesystem monitor on, with a switch for each. Both make
`git status` skip work it has already done.

Each switch writes one of this repository's own git settings
(`core.untrackedCache`, `core.fsmonitor`). Nothing global, nothing committed, and
turning it off puts it back. A switch you cannot move says why on its own row: an
unsuitable filesystem, a git older than 2.37, an unsupported platform, or a
monitor you already run yourself.

The same tab has **Recheck every**, how often `git status` re-runs for a worktree
an agent is working in. It applies only to worktrees *not* open in the Source
Control view, which refresh on VS Code's own git events instead.

## Privacy

Runs entirely on your machine, collects no telemetry. It reads local git state and
the session files Claude Code keeps for itself, and writes nothing to your
`~/.claude` tree. The only network requests it makes are to the GitHub API, and
only once you connect a token.
