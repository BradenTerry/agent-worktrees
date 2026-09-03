# Accessibility and narrow widths

What the panel owes a keyboard, a screen reader, a high-contrast theme and a
240px sidebar, and where each of those is handled. All of it lives in
`media/panel.js` and `media/panel.css`; none of it needs the extension host.

## Keyboard

**Menus.** The card and group menus carried `role="menu"` and focused their
first item, and that was the whole of it: no arrow keys, and Tab walked straight
out of a body-mounted element into whatever came next in the document, leaving
the menu open behind it. `onMenuKey` supplies the rest of the pattern.

| Key | Does |
| --- | --- |
| Up / Down | Move between items, wrapping at both ends |
| Home / End | First / last item |
| Escape | Close, focus back on the caret |
| Tab | Close, focus back on the caret |

Tab is deliberately "leave", not "move within". A menu is a dead end for
sequential navigation, and the alternative (trapping Tab inside it) leaves no way
out that does not involve knowing about Escape.

`closeCardMenu(restoreFocus)` is what returns focus, and it only does so when
focus was actually inside the menu. A menu closed by a click somewhere else has
its own focus target, and one closed by a repaint is about to be handled by
`restoreAfterPaint`.

**Dialogs.** The skills dialog had `aria-modal="true"` and nothing else, which
tells assistive technology the rest of the page is inert but does nothing about
Tab, so focus walked out behind a backdrop that still covered everything.
`onModalKey` wraps Tab at both ends and handles Escape; opening focuses the
close button, and `closeModal` hands focus back to the chip that opened it.

**Agent rows** stay activatable with Enter and Space. That handler matches on
class rather than on role, which is what made the role change below safe.

## Screen readers

**Agent rows are `role="group"`, not `role="button"`.** A row contains real
buttons (stop, pin, Source Control scope), and ARIA forbids interactive
descendants of a button: screen readers flatten them, so those controls were not
reachable at all. The row is a group of controls that also responds to Enter, and
its `aria-label` says so, since without the button role nothing else would.

The label is the **full** work summary, not the truncated text on screen. That
summary previously lived only in a `title` attribute, which was also duplicating
the panel's own tooltip on the label inside it, so hovering produced two
tooltips at two different delays and keyboard users got the summary from
neither.

**A live region announces agents that need you.** The panel's whole reason for
existing is "something is blocked on you", and that was carried by a colour, a
pulse and a number badge on an activity-bar icon: none of which reach a screen
reader, and the badge is not even in this document. `#awt-live` is a visually
hidden `aria-live="polite"` region, mounted once outside `#root` (a live region
that is removed and rebuilt is a *new* region, and its contents are not
announced).

It speaks only when the waiting count **rises**. Announcing every payload would
talk over everything else while agents work, and announcing the fall as you
answer them is narration of work you just did.

**Icon-only controls carry `aria-label`.** The panel's own `data-tip` is a
positioned `div`, which no assistive technology reads, so the two toolbar
buttons had no accessible name of any kind.

**Tooltips open on focus**, not only on hover, and without the hover delay:
focus is deliberate. Several of these tips are the only place a reading exists
at all, including a worktree's full path and which subagents are running where.

## High contrast and reduced motion

`@media (forced-colors: active)` gives cards, menus, dialogs and the tooltip real
`CanvasText` borders, drops the alternate-row tint (which cannot survive forced
colours anyway) and outlines the status dots, whose meaning is otherwise carried
entirely by a fill that forced colours replaces. Focus rings become `Highlight`.

The three animations that carry meaning already opted out of
`prefers-reduced-motion` individually. A catch-all block now covers the rest:
chevron rotations, the settings toggle knob, the nav fold, and the hover fades on
row actions.

Hairline fallbacks are neutral grey rather than translucent white. The white ones
only ever looked right on a dark theme, and `--vscode-widget-border` is unset in
plenty of themes, so on a light one the borders simply vanished.

## Narrow widths

The sidebar goes down to 240px, and two things did not.

**Settings** put a ~140px label rail beside the body, leaving a ~75px column: the
PR toggle clipped off the right edge, "FINE-GRAINED TOKEN" broke into five lines
inside its own pill, and the fold control that would have fixed it sat at the
bottom of the rail, past the content that was unreadable. Below 340px the rail
now folds to icons on its own. It is a media query rather than the existing
`collapsed` class deliberately, so it never writes over the user's own choice:
widen the panel and their labels come back. The fold control hides with it, since
at that width it is an offer with no effect.

**The agents view's branch chip** could take the whole meta line and push the
subagent and skill counts onto a line below the row's clip, so a
`feature/JIRA-12345-...` branch made those counts vanish entirely. The line is
`nowrap` now, the counters never shrink, and the branch truncates with its full
path still in the tooltip. Making the ellipsis actually engage needed
`min-width: 0` at all three levels between the row and the text, since a flex
item's default `min-width: auto` is its min-content width.

Long setting ids in Settings wrap rather than clip (`overflow-wrap: anywhere`).
`agentWorktrees.statusPollSeconds` is one unbroken token, and the whole point of
printing it is that it can be read.

## Two empty states

**A repository with only its primary worktree** drew a `Worktrees` divider, a
`General 0` header and an empty-section line inviting the user to move a worktree
in from a menu that would not offer it (the primary cannot be filed): three rows
of chrome about a feature that had not been used and could not yet do anything.
The sections are skipped while General is still the only group. Once the user
makes a group of their own, their structure is shown whether or not anything is
in it.

**Empty-state copy names what is on screen.** It read `Use "New Agent" to start
one`, and there is no text anywhere in the panel reading "New Agent" - the
control is an icon-only button. Both empty lines now point at position.

## The bounded agent list

A card's agent list is capped at 190px and scrolls, and its height is a whole
number of rows plus part of one, so a list that continues visibly does. That
partial row was being read as a row that had failed to draw rather than as a
list with more in it, and no scrollbar corrects the impression: on macOS the
platform scrollbar is an overlay one, so it occupies no width and stays invisible
until something scrolls, and nothing scrolls until you already believe it can.

The last 22px are masked to transparent while anything is below the fold, so the
partial row dissolves instead of being cut. `markScrollableLists` sets the
`data-more` attribute that drives it, measured after every paint and on every
scroll of the region, so the fade is present only while something is actually
hidden and goes when you reach the end.
