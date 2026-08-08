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

**Two lines at rest, plus the PR block.** The card header carries the branch
name. One meta line underneath carries two unrelated readings of the worktree at
opposite ends of it: what is running in it on the left - agent count, live
subagents, per-status dots, the summary that used to live in the Agents bar - and
what its working tree looks like on the right.

The agents take the left because that is the reading the panel exists for, and
the left edge is where a column of cards is scanned; the git totals hold the
right edge against them. Neither is measured or breakpointed: the totals carry
`margin-left: auto`, which applies per flex line, so a card too narrow to hold
both wraps them to a row of their own and keeps them right-aligned there, at
whatever width that particular card runs out.

The PR rollup keeps its frame. It is one thing about the branch and the border is
what says so; unpacked into the meta line beside the git totals it reads as more
unrelated chips. Compact buys its rows back inside the block instead: tighter
padding, and the labelled "Reviews" and "Checks" rows merged onto one line as two
runs with a rule between them - so the CI checkmarks and the review checkmarks
still cannot be read as one ambiguous sequence, which is what the two labels
exist to prevent. Four rows become three.

**The header is the toggle, and it sticks.** There is no separate Agents bar to
click; the header carries `data-toggle` and expands the card. It is
`position: sticky` inside the cards scroll region, so while a card's agent rows
scroll past, the name of the worktree they belong to stays pinned directly above
them. This is the part that addresses the misclick: a row is never separated
from its worktree's name. The header repaints the card's own background tint
(it needs to be opaque, since rows pass under it) and the card's expanded body
carries a vertical rail back up to it.

**Two controls on the name line, and a menu.** The header holds the Source
Control scope button - the one control there that is also a *reading* - and a
caret. Behind the caret: switch branch, refresh, open in a new window, view the
branch on GitHub, and delete. Those are each reached rarely; you switch a branch
or delete a worktree roughly once in its life, and four or five buttons sitting on
the name line being *available* were costing every card the width. A menu spends
one extra click on the rare path and gives the name back on all of them.

The run is 51px now, on every card, where it was 108px and varied by whether the
worktree had a Delete button. Every branch name in the fixtures fits on one line
down to 260px.

The menu is grouped in three: what changes the worktree, where to open it, and the
one thing that destroys it. Delete is drawn in the error colour as well as set off
by a rule - in a list of plain rows a rule alone is easy to read past - and it is
absent entirely on the primary worktree, which cannot be removed. The GitHub entry
stays an `<a>`, since the webview opens http(s) links itself and routing it through
the extension host would be a round trip for nothing.

It is mounted on `document.body`, not inside the card. The cards are a scroll
region and the card header is `position: sticky`, so a menu inside a card is
clipped by the first and stacked under the second. That means it is positioned in
viewport coordinates, which in turn means it cannot follow the thing it points at:
a scroll, a resize or a re-render closes it rather than leaving it pointing at
nothing.

**The card body has a row of its own**: search, find file, Debug and **New agent**
- the ways *into* a worktree, which are the reasons to have opened the card. Debug
only exists on a worktree with launch configs, and here its absence costs the card
nothing, where in the header it made the run a different width per card and the
name column jumped between them.

### Expand all / collapse all

The toolbar's last control is one button doing both, because the two are never
both useful: with anything open the only thing left to ask for is closing them,
and with everything shut, opening them. It names the action it will perform
rather than the state it is in, and swaps glyph with it - two chevrons pointing
apart to expand, the same two turned to point at each other to collapse. They are
mirror images because the direction is the entire message.

Keeping it honest takes one extra step: `toggle` flips a class rather than
re-rendering, so shutting the last open card by hand would otherwise leave the
button still offering to collapse. `syncCollapseAllBtn` re-renders just that
button after a single-card toggle.

### The repo-wide agent summary

Under the repository name, in the glyphs a card uses for its own: how many
agents, how many live subagents, and the per-status breakdown across every
worktree. It answers "is anything waiting on me anywhere" without scanning down
the cards - the question the panel exists to answer, and the one that gets harder
with every worktree added.

It is built by handing every card's agents to the same `agentStats` a card calls,
so the total is the sum of what the cards show rather than a second number
derived a second way that can drift from them. The name, the toolbar and the
summary share one `.repo-bar`, so the rule under it separates the header from the
cards rather than the name from its own summary.

### No badges at all

The compact card has no badge line. Everything that used to be on one is said
another way, and the row it needed is gone.

**Primary** is a glyph on the left of the name. It is true of exactly one card and
never changes, so a worded pill spent a whole row restating something you learn
once; a mark on the name says it where the name is read. A house rather than a
star or a pin - it is the checkout you came from, not one you favoured - drawn in
`descriptionForeground`, since it is orientation rather than news and should not
compete with the name it sits against.

**locked** and **detached** are glyphs on the meta line, beside the agent counts,
in the warning colour. They are exceptions - most worktrees are neither - and a
row that exists only to carry one short word costs more than the word tells you.
On the meta line they sit with the other readings of the worktree. They follow the
agent counts rather than leading them, so the counts keep the left edge on every
card and stay a column you can scan down. Carrying no text, their `data-tip` is
the label: a padlock for a worktree git will refuse to remove, a broken chain for
a detached HEAD - broken because what is missing is the link to a branch, not the
commit, which is still there.

**Source Control scope** is only the scope button's pressed state. It had a
labelled pill of its own for a while, which said the same thing twice on the same
card.

### The pulse

The waiting dot pulses in both summaries: on a card's meta line and on the
repo-wide line under the repository name. Only waiting, though - the agent rows
and the comfortable Agents bar pulse active as well, but a count is not a row. A
panel with agents working would have a green dot ticking on every card and again
at the top, which is motion that says nothing you did not already know. Waiting is
the one that wants you to look, and it is what the Activity Bar badge counts.

The dot fades while a pseudo-element ring expands, both animating only transform
and opacity, so an infinite pulse stays on the compositor rather than repainting
each frame.

### Which card is outlined

The card outline marks the worktree whose agent owns **the terminal you are typing
into**, and it is set on the card rather than only on its header, so it is
findable when the card is collapsed and the header is all there is.

It used to mark the worktree that happened to be the open workspace folder
(`inWorkspace`). That is one card, forever, and not something you need the panel
to tell you - where the terminal is changes as you work, and it is the thing you
can act on by mistake.


The GitHub link is framed like the buttons around it. It was unframed back when
it sat in a header row that got its shape from the name and badges, but leading a
row of framed icons an unframed one reads as a different kind of control. It is an `<a>`
rather than a `<button>`, so it takes `.act.ghost`'s border and sizing explicitly
instead of wearing the class.

Every icon-only control carries `data-tip`, the panel's own tooltip, rather than
`title`. The native tooltip's delay is long enough that an unlabelled button
feels unlabelled; `aria-label` goes on alongside it so the name is there for a
screen reader either way.

**New agent** is icon-only here, at the far right of the body's tools row, so
the control that starts one sits against the list of what is already running. It
keeps both glyphs, the plus and the agent mark, which
together are what say "another one of these", and it is outlined in the accent
rather than filled: filled, it was the single saturated block on a card otherwise
made of quiet outlines. The comfortable card keeps the words and the fill, being
the only thing on its row that is not an icon.

The Agents bar carries no count. The meta line above already has the agent total
beside the live subagents and the per-status dots, where it can be read against
them; repeated on the bar it was the same number twice on one card.

### The header line, when the name is long

The name is inline content and wraps; nothing else in the header wraps with it.
The chevron and the column of controls both hold the name's **first** line at
every width, so they occupy one place on the card no matter how many lines the
name takes. `.head-main` therefore has no `min-width` floor - given one it would
push the controls past the card's right edge instead of letting the name yield -
and `.card-head` is `nowrap`.

Holding that first line takes a computed offset, because the header is
`align-items: flex-start` and flex-start aligns *tops*: an item ends up high by
half its difference from the line box. `--first-line` carries that line box, and
it is `calc(1.35 * var(--vscode-font-size))` rather than `1.35em` - a custom
property's `em` is re-resolved against whichever child reads it, and the icon
buttons are 11px, so an `em` silently centres each item on a different line box.
The same variable, defined the same way, does the agent row's dot and chips.


Below **240px** this inverts: held against the controls the name is squeezed into
a column a character wide, which is worse than moving them down, so a media query
at that width restores the wrap and the 9em floor. Above it - every width a
sidebar is realistically dragged to - the column stays pinned.

The threshold tracks what the header holds and has to move with it, though with
the run down to 51px - a constant, since both controls are on every card - there
is a lot of slack: the fixtures fit on one line at 260px, well under it. The body's
tools row is not part of this either, since it lays out on its own line and wraps.
Re-measure before putting a control back on the header.

### The agent rows

The agent list sits under a plain **Agents** heading inside the card body. The
heading is a label, not a control: the list used to fold away behind it, which is
one disclosure too many on a card that already has the header's own toggle. What
the fold was actually for - a worktree running a dozen agents pushing every card
below it off screen - is a bounded height, and the list scrolls inside it
instead. That costs no click and hides nothing already on screen. The bound is a
whole number of rows plus part of one, so a list that overflows visibly does; a
clean cut at the bottom edge would read as the end of the list.

A row's summary wraps rather than clipping, so the row can be taller than one
line, and the row is `align-items: flex-start` so the dot stays beside the words
it qualifies instead of drifting to the middle of a three-line block. Everything
fixed-height on the row - status dot, terminal chip, stop button - is then
centred on the summary's **first line box** with its own computed offset. The
offsets cannot be shared: the three are different heights, and the stop button is
taller than the line box, so it needs a negative one where the dot needs +4.8px.

The summary is sized with the rest of the density, at `--row-font`. Left to
inherit the body size it came out at 13px - the largest text on a card whose
branch name is 12px and whose git line is 11px, in a layout whose whole point is
that nothing is bigger than it needs to be. The size and the line box those
offsets are computed from are declared together on `.agent-row`, so changing one
cannot silently un-centre the other.

**New agent** keeps its label but not a filled treatment. Filled, it was the
single saturated block on a card otherwise made of quiet outlines - 104px against
25px neighbours, about a third of the action row, and the loudest thing on a card
whose status colours are the part meant to catch the eye. Outlined in the accent
with accent text, it still reads as the primary action and still says what it
does. The comfortable card keeps the filled button, where it anchors a row of its
own.

Net effect on the screenshot fixture (four worktrees, everything expanded): 1420
device pixels tall against 2280. Collapsed, the four cards take about a third of
the height of the comfortable ones.

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
  now contains the Delete button and a button fires its own click on
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
