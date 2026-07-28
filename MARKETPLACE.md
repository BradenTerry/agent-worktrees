# Agent Worktrees

**Run and monitor several Claude Code agents across your git worktrees, from one side panel.**

Worktrees are the natural unit for running agents in parallel: each one is an
isolated checkout, so sessions never step on each other's files. This extension
puts every worktree, its git state, its pull request, and its running agents in a
single view.

<img src="https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/overview.png" alt="The Agent Worktrees panel: three worktrees with branch names, git status, PR rollups and their running Claude agents" width="380">

## The short version

- **See every worktree at once**, with changed files, `+`/`-` lines and
  ahead/behind counts.
- **Start a Claude agent in any worktree in one click**, or create a worktree and
  an agent together.
- **Watch each agent's status live**: active, waiting, or idle.
- **Get a badge on the Activity Bar** the moment an agent is blocked on you.
- **Read PR state, CI checks and reviews** on the worktree card, no browser tab.
- **Run or debug a worktree's launch configuration** without opening it in another
  window, and stop the session from the same card.
- **Work every branch in the repo** from a dedicated Branches tab.

## Agents

- Launch a Claude CLI session in any worktree, each in its own terminal.
- **Agent & Worktree** creates a fresh worktree with `claude -w` and starts an
  agent in it, in one step.
- Reveal or stop any session from the panel. Reveal works in the window that
  started the agent; another window can still see and stop it, and tells you when
  the terminal lives elsewhere.
- The agent whose terminal is open is highlighted, so switching between worktrees
  never leaves you typing to the wrong agent.
- Terminal tabs are titled by Claude Code itself, so each tab tracks that
  session's current topic, background tabs included, and the terminal you are
  reading is never pulled away when another agent answers.
- Subagents an agent is running right now are listed under it, with what each
  one is doing and how long it has been at it. They clear themselves when they
  finish, so the panel shows live work, not a running total. A subagent parked
  on a background command is dimmed rather than dropped, and when an agent needs
  you the row tells you which of its subagents is asking.
- When an agent fans work out across worktrees — one subagent per ticket, each
  in a worktree of its own so their edits cannot collide — each subagent is
  listed on the card for the worktree it is actually working in, naming the
  agent that sent it there. The card for a worktree with no agent of its own
  still shows what is happening inside it, and the agent driving the fan-out
  carries a count of everything it has in flight instead of looking idle.
  Clicking a subagent opens the terminal of the agent running it.
- Click an agent's skill chip to see which Claude skills it has used.
- Agents that are no longer running are retired on their own. An agent that dies
  with its terminal (you closed the window, killed the terminal, restarted the
  machine) never gets to report that it exited, so the panel checks whether each
  session's process is still there and drops the ones that are gone. A window you
  reopen shows the agents that are actually running, not yesterday's rows with no
  terminal behind them.

<img src="https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/skills.png" alt="The skills modal listing the Claude skills one agent has invoked" width="380">

### Status

Status comes from Claude Code's hooks, which the extension installs only with
your explicit consent. **Nothing is sent over the network.** State flows through
local files, and you can remove the hooks anytime by editing
`~/.claude/settings.json`.

| Status      | When                                                                       |
| ----------- | -------------------------------------------------------------------------- |
| **idle**    | started, or finished responding and awaiting you                           |
| **active**  | processing a prompt, running tools, or waiting on its own subagents         |
| **waiting** | needs you: a permission prompt or a question                               |

The Activity Bar badge counts only **waiting** agents, so it always means you
specifically, never an agent waiting on its own subagents.

## Pull requests

Connect a GitHub token and each worktree card grows a PR rollup.

- Title, state, CI checks, reviews and comment count.
- An **Out of date** pill when the branch is behind its base.
- An **Auto-merge** pill when auto-merge is enabled.
- Refreshed as your agents work, plus a per-card refresh button.
- Always the PR for the branch the worktree has checked out right now. Switch
  branches, or let an agent check the default branch back out once its PR
  merged, and the old branch's PR clears instead of lingering on the card.

| On the worktree card | Connecting a token |
| :--- | :--- |
| <img src="https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/pr-status.png" alt="A worktree card showing its PR state, auto-merge pill, review counts and CI check rollup" width="380"> | <img src="https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/settings.png" alt="Settings, GitHub tab: the PR status toggle and the connected token" width="380"> |

## Branches view

A full editor tab listing every branch in the repo, local and remote-only.

<img src="https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/branches.png" alt="The Branches editor tab: every branch with last-updated time and author, location tags, PR status and create-worktree actions" width="860">

- **Start work anywhere**: branches with a worktree get **Start agent**, the rest
  get **Create worktree & start agent**. Picking a remote-only branch checks it
  out as a new local tracking branch.
- **Git-first**: last-updated time, author, location tag (local only, local +
  remote, remote only) and ahead/behind, all from local git with no token needed.
- **Filter and sort**: by updater, location, PR status, or review-requested-from-
  you. Your choices are remembered.
- **Fetch and prune** to refresh ahead/behind and drop refs for branches deleted
  on the remote.
- **Delete Local** removes a local branch only, never the remote. It warns about
  unpushed commits and handles squash-merged branches cleanly.
- **Delete gone** clears out every local branch whose remote is gone, in one
  confirmation.

Worktrees created here live under `.claude/worktrees/` inside your repo, the same
place `claude -w` puts them.

## Linked files

A new worktree only gets the files git tracks, so the gitignored local config
your build or tests depend on is simply missing, and they fail.

<img src="https://raw.githubusercontent.com/BradenTerry/agent-worktrees/main/images/linked-files.png" alt="Settings, Linked Files tab: a list of gitignored paths symlinked into every worktree, with Add from .gitignore and Link existing worktrees buttons" width="380">

- List those paths once per repository; every worktree the panel creates gets
  them symlinked in.
- **Add from .gitignore** shows everything git ignores so you can tick what you
  need. Whole ignored folders like `node_modules` collapse to one row.
- Links point at your main worktree's copy, so editing once updates everywhere.
- **Link existing worktrees** applies the list to the worktrees you already have.
- A file a worktree genuinely owns is never overwritten.
- Works on Windows without Developer Mode or administrator rights: folders use a
  junction, files fall back to a hard link.

## Run and Debug a worktree

VS Code's Run and Debug view always launches out of your main folder, so debugging
the code in a worktree normally means opening that worktree in its own window
first. The panel adds a **Debug** button to each card instead.

- **Pick any launch configuration from that worktree's own `launch.json`**, so a
  branch that added or changed a configuration offers it.
- **Run with or without the debugger**: accept a configuration to debug it, or
  click the play icon on its row to run it without breakpoints.
- **Compounds work too**, starting their configurations in order.
- **The program runs in the worktree.** `${workspaceFolder}` and the working
  directory point at that checkout, not your main one.
- **The build runs there too.** A configuration's `preLaunchTask` is run against
  the worktree, so you debug the change you just made in it rather than whatever
  your main checkout last built. If the build fails, nothing launches.
- **Stop it from the same card.** Each running session gets a row with a stop
  button, named after the configuration and the worktree, so with several
  worktrees running you always stop the right one.

The button appears only on worktrees that have launch configurations, so a repo
with no debug setup gets no extra clutter.

## Also included

- **Open in a new window**, focusing an existing window instead of duplicating it.
- **Switch a worktree's branch**, or create a new one, from the panel.
- **Delete a worktree** in a single confirmation that tells you upfront what it
  touches (running agents, uncommitted changes, unpushed commits) and can delete
  the leftover branch in the same step.
- **Stale lock cleanup**: dead-session locks are cleared automatically, so a
  crashed agent no longer leaves a worktree stuck as `locked`. Locks you placed
  yourself are never touched.
- **Source Control scoping**, so VS Code's SCM view follows the worktree you pick.
- **Buttons that show their work**: slow actions show a spinner in place of their
  icon.

## Requirements

- The [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) (`claude`) on
  your `PATH`.
- `git` and `node` on your `PATH`.
- A workspace whose first folder is inside a git repository.

## Getting started

1. Install the extension and open a folder that is a git repository.
2. Open **Agent Worktrees** from the Activity Bar.
3. Accept the hook prompt for live agent status (optional, recommended).
4. Click **Agent** on any worktree, or **Agent & Worktree** to create both at once.

## Troubleshooting

Panel slow or empty? Open **Settings**, then the **Debug** tab, and turn on
**Debug tracing**. Every git command and GitHub request is then logged with its
duration and result to the "Agent Worktrees" output channel (**Open log** reveals
it). It is off by default, and request headers, which carry your GitHub token,
are never logged.

## Privacy

Agent Worktrees runs on your machine and collects no telemetry. It reads local
git state and Claude Code hook output from files in its own private storage.
Nothing of the extension's lives in your `~/.claude` tree apart from the hook
entries you consent to. The only network requests it makes are to the GitHub API,
and only once you connect a token. With no token, it makes none.
