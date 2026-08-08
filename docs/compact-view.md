# Compact view

The worktree panel renders its cards at one of two densities, toggled from the
panel toolbar and persisted in the webview's state (`density`, alongside
`expanded`). `comfortable` is the original layout and the default; `compact` is
the subject of this note.

## Why

The comfortable card gives each subsystem its own labelled block: header row,
separator, git summary, action row, debug rows, PR rollup, Agents bar, agent
rows. It is legible in isolation and it does not scale. At roughly seven rows
per worktree, a repo with four or five of them does not fit in a sidebar, and
two failures follow from the scrolling that causes:

- The panel's whole value is the at-a-glance read across worktrees. If half of
  them are off screen, there is no glance.
- An agent row can be a screenful below the name of the worktree it belongs to,
  and every card ends in a stack of similar-looking rows. Clicking the right
  agent on the wrong worktree is easy, and reveals the wrong terminal.

## What compact changes

Same data, same actions, three structural changes.

**Two lines at rest.** The card header carries the branch name, its badges, and
the summary that used to live in the Agents bar (agent count, live subagents,
per-status dots). One meta line underneath carries the git summary and the whole
PR rollup - state badge, merge flags, reviews and CI - which the comfortable
layout spends a four-row bordered block on. A worktree with no git changes and
no PR is a single line.

**The header is the toggle, and it sticks.** There is no separate Agents bar to
click; the header carries `data-toggle` and expands the card. It is
`position: sticky` inside the cards scroll region, so while a card's agent rows
scroll past, the name of the worktree they belong to stays pinned directly above
them. This is the part that addresses the misclick: a row is never separated
from its worktree's name. The header repaints the card's own background tint
(it needs to be opaque, since rows pass under it) and the card's expanded body
carries a vertical rail back up to it.

**Per-worktree actions live inside the card.** Source-control scope, search,
find file, Debug, change branch, the GitHub link, refresh, open window and
delete are one icon row revealed by expanding the card, rather than two rows on
every card all the time. They are one click away rather than hover-only, so they
stay keyboard-reachable and discoverable. The exception is **New agent**, which
stays in the header as an icon button: it is the primary action, and it should
not cost an expand first.

Net effect on the screenshot fixture (four worktrees, everything expanded): 1186
device pixels tall against 2280. Collapsed, the four cards take about a quarter
of the height of the comfortable ones.

## Implementation notes

- Both densities are built by `card()` in `media/panel.js` from the same set of
  button/segment builders; only the assembly at the end differs. Anything that
  varies between them (the source-control pill's label, the PR rollup's shape)
  takes a `compact` flag rather than being rebuilt.
- All compact styling is scoped to `.card.compact` in `media/panel.css`, so the
  comfortable layout is untouched by construction.
- The two densities emit different markup, so `setDensity` re-renders rather
  than toggling a class. Expand state is independent of density and survives the
  switch.
- `data-toggle` is what the click and keydown handlers look for, so both the
  Agents bar and the compact header work through the same path. The keydown
  handler ignores events from a `button`/`a` inside the header, since the header
  now contains the New agent button and a button fires its own click on
  Enter/Space.
- `applyActiveTerminal` marks the card-level "this worktree holds the terminal
  you are talking to" glyph on whichever of `.agents-bar` / `.card-head` exists.
- Under 340px of panel width a media query drops the agent-count chip from the
  header: the branch name is what tells two cards apart, and the status dots
  beside the chip already break the count down.

## Screenshots

`npm run screenshots` renders both densities from the same fixture
(`images/overview.png` and `images/compact.png`), which is the comparison the
marketplace listing uses. The compact shot is driven by seeding
`state: { density: "compact" }` through the harness's stubbed `getState`, the
same channel the real webview restores it from.
