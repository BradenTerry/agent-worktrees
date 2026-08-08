# The worktree card

How `card()` in `media/panel.js` lays out one worktree, and why it is shaped the
way it is. There is one layout: the panel used to ship two densities with a
toolbar toggle, and the roomier one was removed - keeping it meant every change
here had to be made twice and verified twice, for a layout nobody chose once the
tighter one existed.

## Why it is dense

The original card gave each subsystem its own labelled block: header row,
separator, git summary, action row, debug rows, PR rollup, Agents bar, agent
rows. That is legible in isolation and it does not scale. At roughly seven rows
per worktree, a repo with four or five of them does not fit in a sidebar, and two
failures follow from the scrolling that causes:

- The panel's whole value is the at-a-glance read across worktrees. If half of
  them are off screen, there is no glance.
- An agent row can be a screenful below the name of the worktree it belongs to,
  and every card ends in a stack of similar-looking rows. Clicking the right
  agent on the wrong worktree is easy, and reveals the wrong terminal.

## The shape

**Two lines at rest, plus the PR block.** The header carries the branch name. One meta line underneath carries two unrelated readings of the worktree at
opposite ends of it: what is running in it on the left - agent count, live
subagents, per-status dots - and what its working tree looks like on the right.

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

**The name half of the header is the toggle, and the header sticks.** `.head-toggle`
- the chevron and the name - carries `data-toggle` and expands the card; the
actions at the right end are outside it, divided off by a vertical rule. The whole
row used to be the toggle, so a click that missed one of the buttons folded the
card you were reaching into. The rule is there because the two halves are
otherwise one undifferentiated strip: the boundary should be something you can
see, not something you learn by mis-clicking. The hover tint is on the toggle
alone and fills the header's full height up to the rule, so what lights up is
exactly what the click will hit. The header is
`position: sticky` inside the cards scroll region, so while a card's agent rows
scroll past, the name of the worktree they belong to stays pinned directly above
them. This is the part that addresses the misclick: a row is never separated
from its worktree's name. The header repaints the card's own background tint
(it needs to be opaque, since rows pass under it) and the card's expanded body
carries a vertical rail back up to it.

**The body opens on a horizontal rule**, so where the fold is is drawn rather
than remembered: above it is what the card shows at rest, below it is what
expanding got you. It sits on `.card-body` rather than on the Worktree line,
which is the body's usual first row but is dropped on the primary worktree - the
rule has to mark the boundary on every card, not on most of them. The rail starts
at it and hangs off it, so the two read as one bracket around the body instead of
two unrelated hairlines.

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

One button doing both, because the two are never both useful: with anything open
the only thing left to ask for is closing them, and with everything shut, opening
them.

It sits on the agent-summary line rather than in the row of tools beside the
repository name, immediately left of the [agents-view](agents-view.md) switch:
both are about how the list below is shown, where the name's row is the actions
that create and open things. In the agents view it is **disabled rather than
dropped**: that view's rows are the leaves, so there is nothing to fold, but a
control that vanishes and comes back would move the switch beside it out from
under the pointer that just used it.

Off via a class and `aria-disabled`, not the `disabled` attribute. A disabled
button dispatches no mouse events, which would make the tooltip saying why it is
off ("Disabled in the agents view: nothing to fold") the one thing you could not
hover to read. The click handler re-checks the class, and that is what actually
stops the action. It names the action it will perform
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

The card has no badge line. Everything that used to be on one is said
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
pulse active as well, but a count is not a row. A
panel with agents working would have a green dot ticking on every card and again
at the top, which is motion that says nothing you did not already know. Waiting is
the one that wants you to look, and it is what the Activity Bar badge counts.

The dot fades while a pseudo-element ring expands, both animating only transform
and opacity, so an infinite pulse stays on the compositor rather than repainting
each frame.

### The worktree name

The card is titled by the branch - `worktreeData` sends `name` as the branch when
there is one - which is the right thing to scan a column of cards for. Which
*directory* the card is was then not answerable from it at all, so the card body
carries a labelled `Worktree` line, derived in the webview from `wt.path` rather
than added to the payload.

Labelled, and in the body, rather than a bare second name beside the branch: two
names side by side in a header is a guessing game about which is which, and the
directory is not what the card is scanned for. The label takes the muted colour
and the name takes the foreground - a directory name is something you might be
reading off to type somewhere, not decoration. The full path is the tooltip, since
the name alone does not say which repo's worktree directory it sits in.

### Which card is outlined

The card outline marks the worktree whose agent owns **the terminal you are typing
into**, and it is set on the card rather than only on its header, so it is
findable when the card is collapsed and the header is all there is. The terminal
glyph that says the same thing closes the meta line's left group, after the agent
counts and the state flags. Beside the branch name it competed with the name for
the first line and pushed a long one to wrap sooner; in a column of its own ahead
of the counts it held 12px open on every card to say something true of one of
them. At the end of the run it costs width only on the card it applies to, and
the counts keep a left edge that does not move between cards.

It used to mark the worktree that happened to be the open workspace folder
(`inWorkspace`). That is one card, forever, and not something you need the panel
to tell you - where the terminal is changes as you work, and it is the thing you
can act on by mistake.

One thing has to move with it: `applyActiveTerminal` re-tints in place on a
terminal switch, without a re-render, so the card has to be in the set of elements
it toggles - left out, the row highlighted immediately and the outline caught up
only on the next data push.

Nothing else touches a card's border now. There used to be a hover rule that
brightened it, carrying `:not(.terminal-open)` so hovering the outlined card would
not overwrite the one border on the panel that means something. That rule is gone.
It was answering a real question - which card the pointer is in, since the
near-miss this density prevents is clicking the right-looking agent on the wrong
worktree - but answering it card-wide made a whole card look like a click target
when only parts of it are, and it fired alongside the control-level hover on every
single hover. The larger, louder of the two was the one you could not act on.
Hover now marks what is clickable and nothing else: `.head-toggle`, an agent row,
a button.


The GitHub link is framed like the buttons around it. It was unframed back when
it sat in a header row that got its shape from the name and badges, but leading a
row of framed icons an unframed one reads as a different kind of control. It is an `<a>`
rather than a `<button>`, so it takes `.act.ghost`'s border and sizing explicitly
instead of wearing the class.

Every icon-only control carries `data-tip`, the panel's own tooltip, rather than
`title`. The native tooltip's delay is long enough that an unlabelled button
feels unlabelled; `aria-label` goes on alongside it so the name is there for a
screen reader either way. `TIP_DELAY` is 400ms - shorter than the native one, and
longer than the 200ms it started at. A card is a dense run of small glyphs and
the pointer crosses several on the way to the one you want; at 200ms they fired
in passing, so crossing a card set off a sequence of tips for things you were not
asking about.

**New agent** is icon-only, inline beside the Agents heading, so the control that
starts an agent sits against the list of the ones already running. It keeps both
glyphs, the plus and the agent mark, which together are what say "another one of
these".

It wears `.act.ghost`, the same frame as every other icon button on the card. It
was filled first - the single saturated block on a card otherwise made of quiet
outlines - and then outlined in the accent, which still left it the one
differently-coloured control in the panel and read as a different *kind* of thing
from the buttons around it. The accent is now spent on one meaning only: the
worktree you are typing into.

It is sized to that run as well: the same 13px glyph and 2px/5px padding, so it
comes out the same 19px box as the Source Control scope pill and the actions
caret. It is a card-level control like those, and matching them is what makes the
icon buttons down a card read as one set rather than as several. The only trim is
the plus, 14px to 12px, so it sits beside the glyph instead of over it.

The Agents bar carries no count. The meta line above already has the agent total
beside the live subagents and the per-status dots, where it can be read against
them; repeated on the bar it was the same number twice on one card.

### The header line, when the name is long

The name is inline content and wraps; nothing else in the header wraps with it.
The chevron and the column of controls both hold the name's **first** line at
every width, so they occupy one place on the card no matter how many lines the
name takes. Neither `.head-toggle` nor `.head-main` inside it has a `min-width`
floor - given one they would push the controls past the card's right edge instead
of letting the name yield - and `.card-head` is `nowrap`. Below 240px the header
wraps instead, and there `.head-toggle` takes the floor, so the toggle and the
actions land on separate rows rather than sharing a one-character column.

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

The summary is sized with the rest of the card, at `--row-font`. Left to
inherit the body size it came out at 13px - the largest text on a card whose
branch name is 12px and whose git line is 11px, in a layout whose whole point is
that nothing is bigger than it needs to be. The size and the line box those
offsets are computed from are declared together on `.agent-row`, so changing one
cannot silently un-centre the other.

**New agent** lost its filled treatment on the way here. Filled it was the single
saturated block on a card otherwise made of quiet outlines - 104px against 25px
neighbours, about a third of the action row, and the loudest thing on a card whose
status colours are the part meant to catch the eye. It went to an accent outline
first and then to the plain ghost frame; see above for why the accent went too.

Net effect on the screenshot fixture (four worktrees, everything expanded): about
1300 device pixels tall, against 2280 for the layout this replaced. Collapsed, the
four cards take roughly a third of that again.

## Implementation notes

- `card()` in `media/panel.js` builds the whole card from a set of
  button/segment builders. There is no density flag: the one place a shape is
  still chosen is `prLine`, whose `stacked` argument gives the branches view its
  two labelled rows while a card gets the side-by-side rollup.
- `data-toggle` is what the click and keydown handlers look for. It sits on
  `.head-toggle`, not on the header, so the header's action buttons are outside
  it by structure rather than by exclusion. Both handlers still ignore events
  from a `button`/`a` within the toggle - the primary mark and the name are not
  the only things that can end up there, and a control inside it would otherwise
  fold the card on its way out. `toggle()` reaches the card with `closest(".card")`
  rather than `parentElement`, since the toggle is now two levels down.
- `applyActiveTerminal` re-tints in place on a terminal switch, without a
  re-render, and toggles `terminal-open` on both the card (which carries the
  outline) and its header (the tint). Leaving the card out of that set is what
  made the outline lag a terminal switch by a data push.
- Under 340px of panel width a media query drops the agent-count chip from the
  header: the branch name is what tells two cards apart, and the status dots
  beside the chip already break the count down.

## Screenshots

`npm run screenshots` renders the panel from the fixture in
`screenshots/fixtures.js` - `images/overview.png` expanded and
`images/collapsed.png` with every card shut, both from the same data. The
collapsed shot clicks the toolbar's collapse control rather than setting the
class, so it shows what the real path produces.
