// @ts-check
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById("root");

  // Which webview this is. The sidebar leaves it unset ("panel"); the dedicated
  // branches editor tab sets `window.AWT_VIEW = "branches"` in its HTML before
  // loading this script. The same panel.js + panel.css drive both surfaces; we
  // branch on VIEW so each ignores the other's messages and render path.
  const VIEW = window.AWT_VIEW || "panel";

  /** Inline codicon-ish SVGs so we stay dependency-free. */
  const icons = {
    add: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 3v10M3 8h10"/></svg>',
    remove:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 8h10"/></svg>',
    chevron:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 4l4 4-4 4"/></svg>',
    sparkle:
      '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1l1.3 3.7L13 6l-3.7 1.3L8 11 6.7 7.3 3 6l3.7-1.3z"/></svg>',
    // The extension's field-agent character (fedora + visor head), no worktree
    // backdrop — monochrome so it inherits currentColor in both themes.
    agentMark:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.2V2.1"/><path d="M4.7 5.3c0-2.3 6.6-2.3 6.6 0"/><path d="M3 5.5h10"/><rect x="4.7" y="6.1" width="6.6" height="7.2" rx="2.1"/><path d="M6.1 9.4h3.8"/></svg>',
    // Agent + worktree, with a plus badge in the free top-left corner: the glyph
    // alone says what the thing is, not that the button makes one, and this is
    // the only creating control in a toolbar of openers. Top-left because the
    // branch node already occupies bottom-right and the antenna the top-middle.
    agentWorktree:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><path d="M3.5 1.1v4.9M1.05 3.55h4.9" stroke-width="1.8"/><path d="M16 14.5c2.4 0 3 1.4 3 3.5" stroke-width="1.5"/><circle cx="20" cy="20" r="1.7" stroke-width="1.4"/><path d="M12 4.4V2.6" stroke-width="1.5"/><circle cx="12" cy="2.4" r="0.9" fill="currentColor"/><path d="M7.5 6.8c0-2.6 9-2.6 9 0" stroke-width="1.5"/><path d="M5 7.2h14" stroke-width="1.5"/><rect x="7" y="8.2" width="10" height="10.4" rx="3" stroke-width="1.5"/><path d="M9 12.4h6" stroke-width="2.2"/></svg>',
    focus:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M9 3h4v4M13 3l-5 5M7 13H3V9M3 13l5-5"/></svg>',
    stop: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    terminal:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M4.5 6l2.5 2-2.5 2M8.5 10.5H12"/></svg>',
    trash:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 4h10M6 4V3h4v1M5 4l.5 9h5L11 4"/></svg>',
    edit:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M10.5 2.5l3 3-7 7H3.5v-3z"/><path d="M9 4l3 3"/></svg>',
    refresh:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M13 8a5 5 0 1 1-1.5-3.5M13 3v2.5h-2.5"/></svg>',
    // The card's overflow menu trigger. Points down because the menu opens below
    // it, and keeps pointing down while it is open: the arrow says where the menu
    // is, not whether it is showing, and the menu itself is the state.
    caret:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 6.5 8 10l3.5-3.5"/></svg>',
    // The repository's primary working directory: the checkout the repo itself
    // lives in, as opposed to a worktree linked off it. A house rather than a
    // star or a pin - it is the one you came from, not the one you favoured.
    home:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M2.5 7L8 2.5 13.5 7"/><path d="M4 8.5v5h8v-5"/></svg>',
    // A worktree git will not let go of: `git worktree lock`, or a lock the panel
    // placed while an agent was working in it.
    lock:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M5 7.2V5.6a3 3 0 0 1 6 0v1.6"/><rect x="3.6" y="7.2" width="8.8" height="6.2" rx="1.2"/></svg>',
    // Detached HEAD: a checkout sitting on a commit rather than on a branch. A
    // broken chain, because what is missing is the link to a branch - not the
    // commit, which is still there.
    detached:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M6.6 9.4 4.9 11.1a2.4 2.4 0 0 1-3.4-3.4l1.7-1.7"/><path d="M9.4 6.6l1.7-1.7a2.4 2.4 0 0 1 3.4 3.4l-1.7 1.7"/></svg>',
    // The toolbar's expand/collapse control, which swaps between the two: two
    // chevrons pointing apart for "open these", the same two turned to point at
    // each other for "shut them". The direction is the whole message, so they
    // are mirror images rather than two unrelated glyphs.
    expandAll:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M5 6l3-3 3 3M5 10l3 3 3-3"/></svg>',
    // Shallower than its mirror, and pushed to the edges: pointed inward at the
    // same depth the tips land close enough together to read as an ✕, which in a
    // toolbar says "close", not "collapse".
    collapseAll:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M5 3l3 2 3-2M5 13l3-2 3 2"/></svg>',
    window:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="1.5" y="3" width="13" height="10" rx="1.2"/><path d="M1.5 6h13"/></svg>',
    // The worktrees view, in the view switch: the panel's own cards, stacked.
    // Two rounded bars rather than a folder or a branch glyph — what the switch
    // picks between is two shapes of list, not two kinds of thing.
    worktreeStack:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="2.6" width="12" height="4.4" rx="1.2"/><rect x="2" y="9" width="12" height="4.4" rx="1.2"/></svg>',
    // Find in Files, scoped to one worktree: VS Code's own magnifier shape so it
    // reads as "search" and not as a filter or a zoom control.
    search:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="6.8" cy="6.8" r="4.3"/><path d="M10 10l3.5 3.5"/></svg>',
    // Find file by name in one worktree: a document with a magnifier, pairing it
    // with the search icon above while reading as "a file, not its contents".
    fileSearch:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M9 1.8H4.2a1 1 0 0 0-1 1v10.4a1 1 0 0 0 1 1h3"/><path d="M9 1.8l3.3 3.3v2.4"/><circle cx="10.9" cy="10.9" r="2.6"/><path d="M12.8 12.8l1.7 1.7"/></svg>',
    skill:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M8 2l5 2.5L8 7 3 4.5 8 2zM3 8l5 2.5L13 8M3 11.5L8 14l5-2.5"/></svg>',
    // Run and Debug: VS Code's own play-with-bug shape, so the action reads as
    // "debug" rather than a generic play.
    debug:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M4 2.8l7 5.2-7 5.2z"/><circle cx="7.4" cy="8" r="1.5" fill="currentColor" stroke="none"/></svg>',
    // Start without debugging: the same triangle as `debug` with the bug taken
    // out of it, so the pair reads as one action with and without the debugger
    // rather than as two unrelated controls.
    play:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M4 2.8l7 5.2-7 5.2z"/></svg>',
    // A running debug session, mirroring VS Code's debug-stop square.
    debugStop:
      '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="4" width="8" height="8" rx="1"/></svg>',
    // A running subagent: an elbow connector down from the parent row into a
    // node, so a subagent reads as belonging to the agent above it.
    subagent:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M4 2.5v5.5a2.5 2.5 0 0 0 2.5 2.5H8.7"/><circle cx="11.4" cy="10.5" r="1.9"/></svg>',
    // Pin / unpin an agent in the agents view. A thumbtack, drawn head-on: the
    // outline is the offer, the filled one is the state, so a pinned row says so
    // with the same glyph in the same place rather than with a second marker.
    pin: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 1.9h4l-.6 3.3 2.1 2.1H4.5l2.1-2.1z"/><path d="M8 7.3v6.8"/></svg>',
    pinFilled:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 1.9h4l-.6 3.3 2.1 2.1H4.5l2.1-2.1z" fill="currentColor"/><path d="M8 7.3v6.8"/></svg>',
    // Reorder controls in Settings → Preferences. Plain arrows, not the card's
    // chevrons: these move a row one place, they do not open anything.
    arrowUp:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12.5v-9"/><path d="M4.5 7L8 3.5 11.5 7"/></svg>',
    arrowDown:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.5v9"/><path d="M4.5 9l3.5 3.5L11.5 9"/></svg>',
    gear: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5L3.4 3.4"/></svg>',
    pr: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="4" cy="3.5" r="1.6"/><circle cx="4" cy="12.5" r="1.6"/><circle cx="12" cy="12.5" r="1.6"/><path d="M4 5.1v5.8M12 11V7a2.5 2.5 0 0 0-2.5-2.5H7M9 2.5L7 4.5l2 2"/></svg>',
    branch:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="5" cy="3.5" r="1.5"/><circle cx="5" cy="12.5" r="1.5"/><circle cx="11" cy="5" r="1.5"/><path d="M5 5v6"/><path d="M11 6.5c0 3-3 2.7-6 2.7"/></svg>',
    check:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3.5 8.5l3 3 6-6.5"/></svg>',
    cross:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    dot: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="3.2"/></svg>',
    zap: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M9 1.5L3.5 9h4l-.5 5.5L12.5 7h-4z"/></svg>',
    comment:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>',
    // Requested-reviewer marker (review pending): an eye, GitHub's convention for
    // "review requested". Replaces a literal "@" that read as a broken glyph next
    // to the other SVG segment icons.
    eye: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.7"/></svg>',
    // GitHub's own mark, for a link out to github.com. Recognizable at 13px
    // where a generic external-link arrow only says "somewhere else".
    github:
      '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.06-.15-.36-.75.07-1.56 0 0 .67-.21 2.2.82a5.5 5.5 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.43.81.13 1.41.07 1.56.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>',
    external:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h4v4"/><path d="M13 3L7.5 8.5"/><path d="M11 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3"/></svg>',
    bug: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5.5" width="6" height="7" rx="3"/><path d="M6 4a2 2 0 0 1 4 0"/><path d="M5 8H2.5M11 8h2.5M5.2 5.7L3.5 4M10.8 5.7L12.5 4M5.2 11.5L3.5 13M10.8 11.5L12.5 13M8 6.5v5"/></svg>',
    link:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9.5l3-3"/><path d="M8.2 4.8l1-1a2.4 2.4 0 0 1 3.4 3.4l-1 1"/><path d="M7.8 11.2l-1 1a2.4 2.4 0 0 1-3.4-3.4l1-1"/></svg>',
    folderOpen:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12V4a1 1 0 0 1 1-1h3l1.4 1.6H12a1 1 0 0 1 1 1V7"/><path d="M2 12l2-4.6h10.5L12.4 12z"/></svg>',
    // A worktree group: a titled bar with rows under it. A section of the list,
    // not a folder - nothing is moved on disk when a worktree is filed into one.
    group:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="11" height="4" rx="1"/><path d="M3.5 9.5h9M5 12.5h6"/></svg>',
    // A file with a strike through it: the "git ignores this" candidates list.
    ignored:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 1.8H4.2a1 1 0 0 0-1 1v10.4a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V5.6z"/><path d="M9 1.8v3.8h3.8"/><path d="M3.6 13.6L12.4 2.4"/></svg>',
    behind:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v7M5 6.5l3 3 3-3"/><path d="M3.5 13.5h9"/></svg>',
    autoMerge:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="3.5" r="1.5"/><circle cx="4" cy="12.5" r="1.5"/><circle cx="12" cy="6" r="1.5"/><path d="M4 5v6"/><path d="M11.7 7.4C11 10 7 9.5 4 9.5"/></svg>',
    // In-progress spinner: a faint full ring with a brighter arc that the .spin
    // CSS animation rotates. Swapped in for a button's own icon while its action
    // is running (see markBusy).
    spinner:
      '<svg class="spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="5.5" stroke-opacity="0.25"/><path d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5"/></svg>',
  };

  // Worktree paths whose agent list is expanded, persisted so re-renders keep
  // the toggle state. Cards start collapsed: the Agents bar shows the counts and
  // reveals the rows on click.
  const expanded = new Set((vscode.getState() || {}).expanded || []);

  // Branches-overlay filter/sort selections, persisted alongside `expanded` so
  // reopening the overlay restores the last view. This view is git-first: `users`
  // is a list of committer names (the people who last updated each branch,
  // multi-select); `locations` is a multi-select of where a branch lives (local
  // only / local + remote / remote only, LOCATION_OPTIONS ids); `sort` is one of
  // the SORT_OPTIONS keys (all git-based, no GitHub needed). `prStatus` and `reviewer` are the PR-aware filters: each a
  // single-select (only shown when GitHub PR data is available). `prStatus`
  // narrows by PR state — "all" (no filter), "open" (open, non-draft PR), or
  // "draft" (draft PR); the PR fetch is open-only, so open and draft are the
  // only states it can match. `reviewer` narrows to branches whose PR has a
  // review requested from the signed-in user — "all" (no filter) or "requested".
  const savedState = vscode.getState() || {};

  // Independent of `expanded`: that says whether the card is open at all, this
  // says whether the rows inside it are, which is what a worktree running a
  // dozen agents needs when you still want its actions and its PR in reach.

  const branchFilters = {
    // Prune on fetch. On by default; persisted so the checkbox stays set.
    prune: savedState.branchPrune !== false,
    users: Array.isArray(savedState.branchUsers)
      ? savedState.branchUsers.slice()
      : [],
    // Location multi-select (local only / local + remote / remote only), empty
    // meaning no filter, mirroring `users`. Unknown persisted ids are dropped
    // so a stale selection can never hide every branch.
    locations: Array.isArray(savedState.branchLocations)
      ? savedState.branchLocations.filter((l) =>
          ["local", "both", "remote-only"].includes(l)
        )
      : [],
    sort:
      typeof savedState.branchSort === "string"
        ? savedState.branchSort
        : "recentlyUpdated",
    // "all" by default so the branch list is complete until the user narrows it.
    // Migrate the old boolean openPrsOnly toggle: true -> "open".
    prStatus:
      typeof savedState.branchPrStatus === "string"
        ? savedState.branchPrStatus
        : savedState.branchOpenPrsOnly === true
        ? "open"
        : "all",
    // "all" by default: no review-request filter until the user narrows it.
    reviewer:
      typeof savedState.branchReviewer === "string"
        ? savedState.branchReviewer
        : "all",
  };
  // Which list the sidebar is showing. "worktrees" is the panel's own view: one
  // card per worktree, its agents inside it. "agents" drops the cards and shows
  // every agent in the repo as one flat list, each row naming the branch it is
  // working on — the same rows, sorted by what they need from you rather than by
  // where they live. Persisted, so reopening the panel returns to the last view.
  let panelView = savedState.panelView === "agents" ? "agents" : "worktrees";

  // Session ids the user pinned to the top of the agents view. Webview state
  // alongside `expanded`, not a VS Code setting: unlike the status order (which
  // is a standing preference about how the list reads), a pin names one live
  // session. The id means nothing in another window and nothing at all once that
  // session is gone, so it belongs with the rest of this panel's view state.
  const pinned = new Set(
    (Array.isArray(savedState.pinnedAgents) ? savedState.pinnedAgents : []).filter(
      (id) => typeof id === "string" && id
    )
  );

  // Group ids the user folded shut. Webview state alongside `expanded`, and for
  // the same reason: which sections are open is how this panel is being looked
  // at right now, where the groups themselves (their names, order and members)
  // are structure the user built and live in the extension's storage.
  //
  // Collapsed is the point of the feature - a group is where you put the
  // worktrees you are no longer reading - so this survives a reload, and a
  // collapsed header carries a count of the agents waiting inside it so folding
  // one can never hide an agent that needs you.
  const collapsedGroups = new Set(
    (Array.isArray(savedState.collapsedGroups)
      ? savedState.collapsedGroups
      : []
    ).filter((id) => typeof id === "string" && id)
  );

  // The group whose name is being typed, if any. Renaming happens in the header
  // itself rather than in a VS Code input box: the box takes focus to the top of
  // the window to edit one word on a thing you are already looking at, and it
  // cannot show you the name in the place the name lives.
  //
  // Not persisted. A half-typed name is not a state to come back to, and the
  // group already has a name to fall back on.
  let editingGroup = "";

  function persist() {
    vscode.setState({
      expanded: Array.from(expanded),
      settingsNavCollapsed,
      panelView,
      pinnedAgents: Array.from(pinned),
      collapsedGroups: Array.from(collapsedGroups),
      branchPrune: branchFilters.prune,
      branchUsers: branchFilters.users.slice(),
      branchLocations: branchFilters.locations.slice(),
      branchSort: branchFilters.sort,
      branchPrStatus: branchFilters.prStatus,
      branchReviewer: branchFilters.reviewer,
    });
  }

  // Last data we rendered, so the relative-time tick can re-render in place.
  let lastData = null;

  // Session id of the agent whose terminal is currently active in the terminal
  // panel. Seeded from each full update; the extension also posts lightweight
  // {type:"activeTerminal"} messages on every terminal switch so the highlight
  // tracks instantly without a full re-render.
  let activeSessionId = "";

  const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ESC_MAP[c]);
  }

  function send(action, extra) {
    vscode.postMessage(Object.assign({ type: "action", action }, extra || {}));
  }

  // Actions that kick off real (often network/git) work the user waits on. Their
  // button gets an in-progress spinner on click; it clears when the next payload
  // re-renders the view (or via a safety timeout if no re-render follows).
  // Note: "openBranches" is intentionally absent. It opens the branches editor
  // tab (which paints instantly), but the sidebar never re-renders on that
  // action, so a spinner on its button would hang until the safety timeout. The
  // branches view shows its own load state instead. "searchWorktree" and
  // "findWorktreeFile" are absent for the same reason - they hand off to the
  // search view and to a quick pick, each of which shows its own load state.
  const BUSY_ACTIONS = new Set([
    "agent",
    "agentWorktree",
    "openWindow",
    "worktreeFromBranch",
    "fetchBranches",
    "refreshGithub",
  ]);

  // Swap a button's own icon for the spinner and disable it while its action
  // runs. The view rebuilds its DOM from data on the next render, which discards
  // this transient state; the timeout only restores the icon in the rare case
  // no re-render arrives (e.g. a fetch that returned identical data), so a
  // spinner never sticks forever.
  function markBusy(btn) {
    if (!btn || btn.classList.contains("busy")) return;
    const svg = btn.querySelector("svg");
    if (!svg) return;
    btn.classList.add("busy");
    btn.disabled = true;
    const original = svg.outerHTML;
    svg.outerHTML = icons.spinner;
    setTimeout(() => {
      if (!btn.isConnected || !btn.classList.contains("busy")) return;
      const cur = btn.querySelector("svg");
      if (cur) cur.outerHTML = original;
      btn.classList.remove("busy");
      btn.disabled = false;
    }, 15000);
  }

  // Status metadata. Colors come from VS Code chart variables in panel.css.
  const STATUS = {
    active: { label: "Active" },
    waiting: { label: "Waiting" },
    idle: { label: "Idle" },
  };

  function statusOf(a) {
    return STATUS[a && a.status] ? a.status : "idle";
  }

  // The order the agents view groups by, waiting first. Also the fallback the
  // normalizer below completes a partial setting with.
  const DEFAULT_STATUS_ORDER = ["waiting", "active", "idle"];

  /**
   * The user's group order for the agents view (Settings → Preferences), made
   * safe to render with. The extension sanitizes the setting too; this repeats it
   * because the panel must not depend on a payload being well formed to draw
   * every agent - a list naming two statuses would otherwise silently drop the
   * third's rows.
   */
  function statusOrder(data) {
    const raw = (data && data.agentStatusOrder) || [];
    const out = [];
    for (const s of raw) {
      if (DEFAULT_STATUS_ORDER.indexOf(s) !== -1 && out.indexOf(s) === -1)
        out.push(s);
    }
    for (const s of DEFAULT_STATUS_ORDER) {
      if (out.indexOf(s) === -1) out.push(s);
    }
    return out;
  }

  /** Compact "how long has this been running" ("18s", "4m", "2h"). */
  function shortAge(t) {
    const sec = Math.max(0, (Date.now() - (t || 0)) / 1000);
    if (sec < 60) return Math.round(sec) + "s";
    const min = sec / 60;
    if (min < 60) return Math.round(min) + "m";
    const hr = min / 60;
    if (hr < 24) return Math.round(hr) + "h";
    return Math.round(hr / 24) + "d";
  }

  /**
   * One running subagent as an indented row. Only live ones are tracked, so
   * these lists empty themselves — a row answers "what is running", not "what
   * has run". A paused one has stopped its turn but is still in flight, parked
   * on a background command that will wake it: shown, but without the working
   * pulse.
   *
   * `sessionWaiting` is the status of the session that owns it, and `via` names
   * that session when the row is on a card the session does not live on. The row
   * clicks through to the owning session's terminal either way: a subagent has
   * no terminal of its own, so the thing to talk to is always its parent.
   *
   * `where` names the worktree it was handed, for the agents view: there the row
   * sits under its own parent rather than on the card for the code it is
   * touching, so nothing else on it would say where its edits are landing.
   */
  function subagentRow(s, sessionWaiting, sessionId, via, where) {
    const type = s.type || "";
    const task = s.task || "";
    const name = task || type || "Subagent";
    // A pending permission decision only means the USER is being asked when the
    // session is waiting: PermissionRequest also fires for calls auto mode or an
    // allowlist settles silently, and Claude Code's "needs you" notification
    // never says which subagent it came from. Pairing the two is what makes the
    // waiting marker trustworthy.
    const asking = sessionWaiting && !!s.awaitingPermission;
    const state = asking
      ? "waiting for you"
      : s.paused
      ? "waiting on background work"
      : "running";
    return (
      '<div class="subagent-row' +
      (asking ? " asking" : s.paused ? " paused" : "") +
      '" data-action="focusAgent" data-session="' +
      esc(sessionId || "") +
      '" role="button" tabindex="0" data-tip="' +
      esc(
        (type ? type + ": " : "") +
          (task || "subagent") +
          ", " +
          state +
          (via ? ", spawned by " + via : "") +
          (where ? ", working in " + where : "") +
          ". Click to reveal " +
          (via ? "its agent's" : "the agent's") +
          " terminal."
      ) +
      '">' +
      '<span class="subagent-mark">' +
      icons.subagent +
      "</span>" +
      (task && type
        ? '<span class="subagent-type">' + esc(type) + "</span>"
        : "") +
      '<span class="subagent-label">' +
      esc(name) +
      "</span>" +
      (via ? '<span class="subagent-via">' + esc(via) + "</span>" : "") +
      (where
        ? '<span class="subagent-where">' + icons.branch + esc(where) + "</span>"
        : "") +
      '<span class="subagent-age" data-since="' +
      Number(s.startedAt || 0) +
      '">' +
      shortAge(s.startedAt) +
      "</span>" +
      "</div>"
    );
  }

  /** The subagents working in this agent's own worktree, as rows under it. The
   *  ones given a worktree of their own are rows on that worktree's card
   *  instead — the agent row just carries the count of them all. */
  function subagentRows(a) {
    const subs = (a && a.subagents) || [];
    const waiting = statusOf(a) === "waiting";
    return subs
      .filter((s) => !s.worktree)
      .map((s) => subagentRow(s, waiting, a.sessionId))
      .join("");
  }

  /** Subagents working in THIS worktree whose agent lives in another one — the
   *  usual shape of a fan-out, where one session hands each subagent a worktree
   *  so their edits cannot collide. */
  function foreignSubagentRows(subs) {
    return (subs || [])
      .map((s) =>
        subagentRow(
          s,
          s.parentStatus === "waiting",
          s.parentSessionId,
          s.parentLabel || "another agent"
        )
      )
      .join("");
  }

  // Whether the sidebar view is on screen, per the extension's visibility
  // messages. Assumed true until told otherwise: the first payload only arrives
  // when the view is being shown.
  let panelVisible = true;

  // Whether any row carries an elapsed label, from the data rather than the DOM.
  // Only subagent rows have one, and having none is the usual state.
  function anyAges() {
    const wts = (lastData && lastData.worktrees) || [];
    return wts.some(
      (wt) =>
        (wt.subagents && wt.subagents.length) ||
        (wt.agents || []).some((a) => a.subagents && a.subagents.length)
    );
  }

  // Elapsed labels have to tick on their own. The extension only re-posts when
  // the payload actually changes, and a subagent quietly working changes
  // nothing the panel renders — so an age rendered once would sit frozen at
  // whatever it read when the row first appeared. Rewrite just the text of the
  // labels that moved; no re-render, no DOM rebuild.
  //
  // Nothing to rewrite when no row has a label, or when nobody can see the panel
  // (it is retained across hides, so this timer outlives being hidden). Both are
  // checked before touching the DOM at all, since both are the common case.
  function tickAges() {
    if (document.hidden || !panelVisible || !anyAges()) return;
    root.querySelectorAll(".subagent-age[data-since]").forEach((el) => {
      const since = Number(el.getAttribute("data-since"));
      if (!since) return;
      const next = shortAge(since);
      if (el.textContent !== next) el.textContent = next;
    });
  }
  setInterval(tickAges, 1000);

  /** Last path segment, for naming a worktree by its directory on disk. */
  function baseName(p) {
    return (
      String(p || "")
        .split(/[\\/]/)
        .filter(Boolean)
        .pop() || ""
    );
  }

  /**
   * The counters that hang under an agent's summary: how many subagents it has
   * in flight (wherever they are working) and how many skills it has used. Built
   * here rather than inside a row so a card row and an agents-view row carry the
   * same two chips, counted the same way.
   */
  function agentChips(a) {
    const skills = a.skills || [];
    const skillChip = skills.length
      ? '<button class="skill-chip" data-action="showSkills" data-session="' +
        esc(a.sessionId) +
        '" title="' +
        skills.length +
        " skill" +
        (skills.length === 1 ? "" : "s") +
        ' used, click to view">' +
        icons.skill +
        skills.length +
        "</button>"
      : "";
    // How many subagents this agent has in flight, wherever they are working. The
    // ones in this worktree are rows directly underneath, but a fan-out sends
    // them to worktrees of their own — their rows are on those cards, and without
    // the count the session driving the whole thing would look idle.
    const subs = a.subagents || [];
    const away = subs.filter((x) => x.worktree).length;
    const subChip = subs.length
      ? '<span class="subagent-count" data-tip="' +
        esc(
          subs.length +
            " subagent" +
            (subs.length === 1 ? "" : "s") +
            " running" +
            (away
              ? ", " +
                away +
                " of them in " +
                (away === 1 ? "a worktree" : "worktrees") +
                " of their own"
              : "")
        ) +
        '">' +
        icons.subagent +
        subs.length +
        "</span>"
      : "";
    return subChip + skillChip;
  }

  /**
   * Pin/unpin one agent, on agents-view rows only: a pin decides where a row
   * sorts in that list, and on a card a row's place is already decided by the
   * worktree it belongs to, so the control would be an offer with no effect.
   *
   * Outside `.row-actions` deliberately. That group is hidden until the row is
   * hovered, and a pinned row has to explain why it is at the top when nothing
   * is pointing at it - so this one stays visible on its own terms (see the
   * `.pin-btn` rules in panel.css).
   */
  function pinAgentBtn(a) {
    const on = pinned.has(a.sessionId);
    return (
      '<button class="iconbtn pin-btn" data-action="togglePin" data-session="' +
      esc(a.sessionId) +
      '" data-tip="' +
      (on
        ? "Pinned to the top of this list. Click to unpin"
        : "Pin this agent to the top of this list") +
      '" aria-label="' +
      (on ? "Unpin this agent" : "Pin this agent") +
      '" aria-pressed="' +
      (on ? "true" : "false") +
      '">' +
      (on ? icons.pinFilled : icons.pin) +
      "</button>"
    );
  }

  /**
   * Show only this agent's worktree in Source Control, from an agents-view row.
   *
   * The cards carry the same control in their header, where it belongs to the
   * worktree. In this view there are no cards, so the agent you are reading is
   * the only thing naming a worktree - and "show me what this one is changing"
   * meant switching to the other tab, finding its card and clicking there.
   *
   * Deliberately the card's own `.scm-scope`, glyph and fill included, rather
   * than a second control that happens to do the same thing: it is driven by the
   * same `wt.scmActive`, so the two can never disagree about which worktree the
   * diff view is on, and one click lights every button naming that worktree.
   * Opt-in exactly as the card's is (Settings -> Integrations), which is what the
   * `scmEnabled` gate is.
   *
   * Outside `.row-actions` for the reason the pin is: that group is invisible
   * until the row is hovered, and the worktree Source Control is currently on has
   * to be readable when nothing is pointing at the row.
   */
  function agentScmBtn(wt) {
    if (!lastData || !lastData.scmEnabled || !wt || !wt.path) return "";
    const on = !!wt.scmActive;
    const where = wt.branch || wt.name || baseName(wt.path);
    return (
      '<button class="iconbtn scm-scope' +
      (on ? " active" : "") +
      '" data-action="scopeScm" data-path="' +
      esc(wt.path) +
      '" data-tip="' +
      esc(
        on
          ? "Source Control is showing " + where + ". Click to re-scope."
          : "Show only this agent's worktree (" + where + ") in Source Control"
      ) +
      '" aria-label="Show only this agent&#39;s worktree in Source Control"' +
      ' aria-pressed="' +
      (on ? "true" : "false") +
      '">' +
      icons.branch +
      "</button>"
    );
  }

  /**
   * The role, focusability and accessible name an agent row carries. Shared by
   * both views so the two cannot drift apart on it.
   *
   * `role="group"`, not `role="button"`. The row holds real buttons (stop, pin,
   * Source Control) and ARIA forbids interactive descendants of a button:
   * screen readers flatten them, so the controls on the row were not reachable.
   * The row is still activated with Enter or Space - that handler matches on
   * class, not on role - and the label says so, since without the button role
   * nothing else would.
   *
   * The name is the full summary rather than the truncated label, and it used to
   * be a native `title`. That was two bugs at once: it duplicated the panel's
   * own tooltip on the label inside (both appeared, at different delays), and
   * the summary was mouse-only, so the one reading that says what an agent is
   * doing never reached anybody navigating by keyboard.
   */
  function agentRowA11y(a, status) {
    const summary = a.summary || a.label || "Agent";
    const said =
      status === "waiting"
        ? "waiting for you"
        : status === "active"
        ? "working"
        : "idle";
    return (
      'role="group" tabindex="0" aria-label="' +
      esc(summary + ", " + said + ". Press Enter to reveal its terminal.") +
      '"'
    );
  }

  /** Stop one agent. Same button on a card row and an agents-view row. */
  function stopAgentBtn(a) {
    return (
      '<span class="row-actions">' +
      '<button class="iconbtn" data-action="stopAgent" data-session="' +
      esc(a.sessionId) +
      '" data-tip="Stop this agent" aria-label="Stop this agent">' +
      icons.stop +
      "</button>" +
      "</span>"
    );
  }

  function agentRows(agents, foreign) {
    const away = (foreign || []).length;
    if (!agents || !agents.length) {
      // A worktree can be busy without holding an agent of its own: a session
      // elsewhere handed it to a subagent. The rows say so; the empty line is
      // only for a worktree where nothing at all is happening.
      if (!away) {
        // Names what is on screen, not a label nothing wears: the control is the
        // icon-only button beside the Agents heading directly above this line,
        // and there is no text anywhere in the panel reading "New Agent".
        return '<div class="agents-empty">No agents yet. Use the + button above to start one.</div>';
      }
      return '<div class="agents">' + foreignSubagentRows(foreign) + "</div>";
    }
    return (
      '<div class="agents">' +
      agents
        .map((a) => {
          const s = statusOf(a);
          // Full, untruncated text for the hover tooltip: the work summary. The
          // label in the row is clipped with an ellipsis, so this is how you read
          // the whole thing.
          const fullInfo = a.summary || a.label;
          const chips = agentChips(a);
          return (
            '<div class="agent-row' +
            (s === "waiting" ? " attention" : "") +
            (a.sessionId === activeSessionId ? " terminal-open" : "") +
            '" data-action="focusAgent" data-session="' +
            esc(a.sessionId) +
            '" ' +
            agentRowA11y(a, s) +
            ">" +
            '<span class="status-dot ' +
            s +
            '"></span>' +
            '<span class="agent-label" data-tip="' +
            esc(fullInfo) +
            '">' +
            esc(a.label) +
            "</span>" +
            // Present on every row but shown (via CSS) only on .terminal-open,
            // so the live class toggle needs no structural DOM changes.
            '<span class="terminal-chip" data-tip="This agent\'s terminal is open. It is the one you are talking to">' +
            icons.terminal +
            "</span>" +
            // The counters go on a line of their own under the summary, which
            // needs the row's full width now that it wraps rather than clipping.
            (chips ? '<span class="agent-chips">' + chips + "</span>" : "") +
            stopAgentBtn(a) +
            "</div>" +
            subagentRows(a)
          );
        })
        .join("") +
      "</div>"
    );
  }

  /**
   * The at-a-glance summary of a card's agents: how many subagents are running
   * in the worktree, and the per-status breakdown. Zero-count statuses are
   * dropped rather than dimmed, and a single agent shows just its status dot —
   * the agent count next to it already says how many there are, so a "1"
   * breakdown adds nothing. Shared by a card's meta line and the repo-wide
   * summary, so the total and the per-card numbers are derived the same way.
   */
  function agentStats(agents, foreign) {
    const counts = { active: 0, waiting: 0, idle: 0 };
    // Subagents working in THIS worktree: the local agents' own, minus any they
    // sent to a worktree elsewhere, plus the ones another worktree's agent sent
    // here. It counts the rows on this card, not who spawned them.
    let subTotal = (foreign || []).length;
    for (const a of agents) {
      counts[statusOf(a)]++;
      subTotal += (a.subagents || []).filter((s) => !s.worktree).length;
    }

    // Live subagents across the worktree. The individual ones are rows in the
    // (collapsible) agent list, so this keeps them visible when it is closed.
    const subStat = subTotal
      ? '<span class="agents-bar-subagents" title="' +
        subTotal +
        " subagent" +
        (subTotal === 1 ? "" : "s") +
        ' running in this worktree">' +
        icons.subagent +
        subTotal +
        "</span>"
      : "";

    const stat = (key) =>
      counts[key]
        ? '<span class="stat ' +
          key +
          '" title="' +
          counts[key] +
          " " +
          STATUS[key].label.toLowerCase() +
          '"><span class="status-dot ' +
          key +
          '"></span>' +
          counts[key] +
          "</span>"
        : "";
    const single = statusOf(agents[0]);
    const stats =
      agents.length === 1
        ? '<span class="stat ' +
          single +
          '" title="' +
          STATUS[single].label +
          '"><span class="status-dot ' +
          single +
          '"></span></span>'
        : stat("active") + stat("waiting") + stat("idle");

    return { subTotal, subStat, stats };
  }


  /**
   * Scope the Source Control view to this worktree. Opt-in (Settings →
   * Integrations). The active state marks the worktree whose repo is currently
   * shown in Source Control (the scope is already set).
   * Labeled on every worktree (not just the active one) so toggling the
   * scope never shifts the layout; the active worktree's pill fills blue,
   * making which worktree the diff view is on readable at a glance. Icon-only:
   * it leads the header's run of icon buttons, where the width is worth more
   * than the word.
   */
  function scmScopeBtn(path, scmActive) {
    if (!lastData || !lastData.scmEnabled) return "";
    return (
      '<button class="iconbtn scm-scope' +
      (scmActive ? " active" : "") +
      '" data-action="scopeScm" data-path="' +
      esc(path) +
      '" data-tip="' +
      (scmActive
        ? "This worktree is shown in Source Control. Click to re-scope."
        : "Show only this worktree in Source Control") +
      '" aria-label="Show only this worktree in Source Control"' +
      // The fill is the only thing that says which worktree the diff view is on,
      // and a fill is not readable by a screen reader.
      ' aria-pressed="' +
      (scmActive ? "true" : "false") +
      '">' +
      icons.branch +
      "</button>"
    );
  }

  /**
   * The agent list inside an open card. The
   * card's own toggle governs everything in the body — the actions, the debug
   * rows and these — which is one control too few for a worktree running a dozen
   * agents: the only way to get the list out of the way was to close the card,
   * and that takes its actions and its PR with it.
   *
   * A slim bar of its own rather than a chevron bolted onto the count in the
   * meta line: it reads as a disclosure, it sits where the rows it governs
   * actually start, and it can be tabbed to. The per-status dots are not
   * repeated on it — the meta line carries them two rows above, and they stay
   * visible when this is shut.
   */
  function agentSection(path, agents, foreign, agentBtn) {
    return (
      '<div class="agent-list">' +
      // A label, not a control. The list used to fold away behind it, which is
      // one disclosure too many on a card that already has one: the card's own
      // toggle. What the fold was actually for - a worktree running a dozen
      // agents pushing every card below it off screen - is a bounded height,
      // and the list scrolls inside it instead (see .agent-list .agents).
      //
      // No count on it. The meta line above already carries the agent total
      // beside the live subagents and the per-status dots, where it can be read
      // against them; repeated here it was the same number twice on one card.
      // New agent sits beside the heading, so the control that starts one is next
      // to the list of what is already running rather than on a row of its own.
      // It is the only per-worktree button left outside the menu: everything else
      // is reached rarely enough that a menu entry is the right home, and this one
      // is the opposite.
      '<div class="agents-heading">' +
      '<span class="agents-heading-label">Agents</span>' +
      (agentBtn || "") +
      "</div>" +
      agentRows(agents, foreign) +
      "</div>"
    );
  }

  /**
   * Git working-tree summary line: diff totals and ahead/behind, with the change
   * count as a counted dot rather than "4 changes", so it fits on one line
   * beside the agent counts.
   */
  function gitLine(g) {
    if (!g) return "";
    const segs = [];
    if (g.dirty)
      segs.push(
        '<span class="seg dirty" title="' +
          g.dirty +
          (g.dirty === 1 ? " change" : " changes") +
          '"><span class="gdot"></span>' +
          g.dirty +
          "</span>"
      );
    // Zero-value segments are hidden: the nonzero counts are the signal, and a
    // row of zeros just buries them. A fully quiet worktree gets a single
    // "Clean" segment instead of an empty line.
    if (g.insertions || g.deletions) {
      segs.push('<span class="seg ins">+' + (g.insertions || 0) + "</span>");
      segs.push('<span class="seg del">−' + (g.deletions || 0) + "</span>");
    }
    if (g.ahead)
      segs.push(
        '<span class="seg ahead" title="Commits to push">↑' + g.ahead + "</span>"
      );
    if (g.behind)
      segs.push(
        '<span class="seg behind" title="Commits to pull">↓' +
          g.behind +
          "</span>"
      );
    if (!segs.length)
      segs.push(
        '<span class="seg clean" title="No local changes, in sync with upstream">' +
          icons.check +
          "Clean</span>"
      );
    return '<div class="gitline">' + segs.join("") + "</div>";
  }

  // PR-state badge labels and the CSS class that colors them.
  const PR_STATE = {
    open: { label: "Open", cls: "open" },
    draft: { label: "Draft", cls: "draft" },
    merged: { label: "Merged", cls: "merged" },
    closed: { label: "Closed", cls: "closed" },
  };

  /**
   * PR summary for a worktree branch, linking out to the PR. A header row with
   * the state badge, then separate "Checks" and "Reviews" rows so the CI rollup
   * and the review decision don't read as one ambiguous run of checkmarks.
   * Rendered only when PR data is present (the integration is on and a PR
   * exists).
   *
   * `stacked` keeps the two labelled rows one above the other, which is what the
   * branches view wants: its rows are full editor width and it is not fighting
   * for vertical space. A worktree card passes nothing and gets the side-by-side
   * rollup and the tighter padding that goes with it - a card is in a sidebar,
   * and the block is one thing about the branch either way.
   */
  function prLine(pr, stacked) {
    if (!pr) return "";
    const st = PR_STATE[pr.state] || PR_STATE.open;
    const plural = (n) => (n === 1 ? "" : "s");

    // CI checks: one colored, counted segment per non-zero state (passing,
    // failing, running) so the whole rollup is visible at a glance.
    const checkSegs = [];
    if (pr.checks && pr.checks !== "none") {
      const pass = pr.checksPass || 0;
      const fail = pr.checksFail || 0;
      const pending = pr.checksPending || 0;
      const total = pass + fail + pending;
      if (pass)
        checkSegs.push(
          '<span class="pr-seg pass" title="' +
            pass +
            " of " +
            total +
            " check" +
            plural(total) +
            ' passing">' +
            icons.check +
            pass +
            "</span>"
        );
      if (fail)
        checkSegs.push(
          '<span class="pr-seg fail" title="' +
            fail +
            " of " +
            total +
            " check" +
            plural(total) +
            ' failing">' +
            icons.cross +
            fail +
            "</span>"
        );
      if (pending)
        checkSegs.push(
          '<span class="pr-seg pending" title="' +
            pending +
            " of " +
            total +
            " check" +
            plural(total) +
            ' running">' +
            icons.dot +
            pending +
            "</span>"
        );
    }

    // Review decision + comments. Counted segments are additive so a mixed
    // state (e.g. some approvals with reviewers still pending) shows all of it.
    const reviewSegs = [];
    if (pr.approvals)
      reviewSegs.push(
        '<span class="pr-seg approved" title="' +
          pr.approvals +
          " approval" +
          plural(pr.approvals) +
          '">' +
          icons.check +
          pr.approvals +
          "</span>"
      );
    if (pr.changesRequested)
      reviewSegs.push(
        '<span class="pr-seg changes" title="' +
          pr.changesRequested +
          " change request" +
          plural(pr.changesRequested) +
          '">' +
          icons.cross +
          pr.changesRequested +
          "</span>"
      );
    if (pr.reviewsPending)
      reviewSegs.push(
        '<span class="pr-seg review-pending" title="' +
          pr.reviewsPending +
          " review" +
          plural(pr.reviewsPending) +
          ' pending">' +
          icons.eye +
          pr.reviewsPending +
          "</span>"
      );
    if (pr.comments)
      reviewSegs.push(
        '<span class="pr-seg comments" title="' +
          pr.comments +
          " comment" +
          plural(pr.comments) +
          '">' +
          icons.comment +
          pr.comments +
          "</span>"
      );

    // Merge-readiness flags shown beside the state badge. "Out of date" is
    // GitHub's "This branch is out-of-date with the base branch" (mergeState
    // "behind"); "Auto-merge" means GitHub will merge once requirements pass.
    // These keep their words in both densities: stripped to the glyph they are
    // two unlabelled colored pills, and the compact meta line wraps anyway.
    const flagSegs = [];
    if (pr.mergeState === "behind")
      flagSegs.push(
        '<span class="pr-flag behind" title="This branch is out-of-date with the base branch">' +
          icons.behind +
          "Out of date</span>"
      );
    if (pr.autoMerge)
      flagSegs.push(
        '<span class="pr-flag automerge" title="Auto-merge is enabled. GitHub will merge once requirements pass">' +
          icons.autoMerge +
          "Auto-merge</span>"
      );

    const rows = [];
    if (pr.title)
      rows.push(
        '<div class="pr-row pr-title">' + esc(pr.title) + "</div>"
      );
    rows.push(
      '<div class="pr-row pr-head">' +
        '<span class="pr-ico">' +
        icons.pr +
        "</span>" +
        '<span class="pr-state ' +
        st.cls +
        '">' +
        st.label +
        " #" +
        pr.number +
        "</span>" +
        flagSegs.join("") +
        '<span class="pr-open">' +
        icons.external +
        "</span>" +
        "</div>"
    );
    // A card buys a row by putting the review and check runs side by side instead
    // of one above the other. Both runs are mostly ticks and crosses, so each
    // keeps its label either way: without one there is nothing to say which
    // sequence is CI and which is the review decision.
    if (stacked) {
      if (reviewSegs.length)
        rows.push(
          '<div class="pr-row"><span class="pr-row-label">Reviews</span>' +
            reviewSegs.join("") +
            "</div>"
        );
      if (checkSegs.length)
        rows.push(
          '<div class="pr-row"><span class="pr-row-label">Checks</span>' +
            checkSegs.join("") +
            "</div>"
        );
    } else {
      const group = (label, segs) =>
        '<span class="pr-group"><span class="pr-group-label">' +
        label +
        "</span>" +
        segs.join("") +
        "</span>";
      if (reviewSegs.length || checkSegs.length)
        rows.push(
          '<div class="pr-row pr-rollup">' +
            (reviewSegs.length ? group("Reviews", reviewSegs) : "") +
            (checkSegs.length ? group("Checks", checkSegs) : "") +
            "</div>"
        );
    }

    return (
      '<a class="prline' +
      (stacked ? "" : " tight") +
      '" href="' +
      esc(pr.url) +
      '" title="' +
      esc(pr.title) +
      '. Open on GitHub">' +
      rows.join("") +
      "</a>"
    );
  }

  /**
   * A card's branch on GitHub, or "" when there is nothing to link: no
   * github.com origin, or a detached worktree. `branchUrl` is the branches
   * view's own builder, which encodes each path segment separately so a
   * `feature/x` branch keeps its slash.
   */
  /**
   * This worktree's branch page on GitHub, or "" when there is none to open:
   * a non-github.com origin, a detached worktree (no branch page), or a branch
   * that has never been pushed. The last is read off `git status`'s own
   * `# branch.upstream` header, which git omits when there is no upstream -
   * linking to a tree that does not exist yet is a 404 dressed as a feature.
   *
   * The one case this gets wrong is a branch pushed without `-u`: it is on the
   * remote but has no upstream, so the link is hidden. Cheap to be wrong about,
   * since the fix is one `git push -u`, and the alternative is asking GitHub
   * whether every branch exists.
   */
  function branchOnGitHub(wt) {
    if (!wt.branch || wt.detached) return "";
    if (!wt.git || !wt.git.upstream) return "";
    return branchUrl(lastData, wt.branch);
  }

  /**
   * The worktree's own directory name, as a labelled line in the card. The header
   * is titled by the branch - worktreeData sends `name` as the branch when there
   * is one - which is the right thing to scan a column of cards for; this answers
   * the other question, which directory on disk the card is, and it is labelled
   * rather than left as a bare second name sitting next to the first.
   *
   * The full path is the tooltip: the name alone does not say where among several
   * repos' worktree directories this one lives.
   */
  function worktreeNameRow(wt) {
    // Not the primary worktree: its directory is the repository itself, whose
    // name is already at the top of the panel, so the line would restate it on
    // the one card that never needed it.
    if (wt.isPrimary) return "";
    const base = baseName(wt.path);
    if (!base) return "";
    return (
      '<div class="worktree-name" data-tip="' +
      esc(wt.path) +
      '"><span class="worktree-name-label">Worktree</span>' +
      '<span class="worktree-name-value">' +
      esc(base) +
      "</span></div>"
    );
  }

  function card(wt) {
    const isCollapsed = !expanded.has(wt.path);
    // The repository's own working directory, marked beside the name rather than
    // labelled beside it. It is true of exactly one card and never changes, so a
    // worded pill spent a badge line - and the width of one - restating something
    // you learn once. A glyph on the name says it where the name is read, and it
    // leaves the badges to mean "something about this worktree is unusual".
    // locked and detached, as glyphs beside the agent counts rather than as worded
    // pills on a line of their own. They are exceptions - most worktrees are
    // neither - and a whole row that exists only to carry one short word costs
    // more than the word tells you. On the meta line they sit with the other
    // readings of the worktree, and the badge line goes away entirely.
    const stateFlags =
      (wt.detached
        ? '<span class="meta-flag warn" data-tip="Detached HEAD: this worktree is on a commit, not a branch" aria-label="Detached HEAD">' +
          icons.detached +
          "</span>"
        : "") +
      (wt.locked
        ? '<span class="meta-flag warn" data-tip="Locked: git will refuse to remove this worktree" aria-label="Locked">' +
          icons.lock +
          "</span>"
        : "");

    const primaryMark = wt.isPrimary
      ? '<span class="primary-mark" data-tip="The repository\'s primary working directory" aria-label="Primary working directory">' +
        icons.home +
        "</span>"
      : "";

    const agents = wt.agents || [];
    // Subagents another worktree's agent is running in this one.
    const foreign = wt.subagents || [];


    // Icon-only: it sits among controls that are all icons. The plus and the
    // agent mark together are what say "another one of these", so both survive
    // the label being dropped. Framed like every other icon button on the card
    // (`ghost iconact`) rather than in the accent: an outline of its own made it
    // the one differently-coloured control in the panel, and the accent already
    // means "this is the worktree you are typing into".
    const agentBtn =
      '<button class="act ghost iconact agent" data-action="agent" data-path="' +
      esc(wt.path) +
      '" data-tip="Start a Claude session in this worktree" aria-label="New agent">' +
      '<span class="agent-plus">+</span>' +
      icons.agentMark +
      "</button>";

    // Searching a worktree, finding a file in it and running its launch configs
    // are all menu entries now (see openCardMenu). The sessions this panel
    // started still get their own rows, so the list is still needed here.
    const debugSessions = wt.debugSessions || [];

    // Rows for the sessions this panel started. VS Code's debug toolbar can stop
    // them too, but it acts on the one session it considers active, so the card
    // carries a stop button per session: that is the only place a specific
    // worktree's session can be named and stopped.
    const debugRows = debugSessions.length
      ? '<div class="debug-rows">' +
        debugSessions
          .map(
            (s) =>
              '<div class="debug-row">' +
              '<span class="debug-ico">' +
              icons.debug +
              "</span>" +
              '<span class="debug-label" data-tip="' +
              esc(s.label) +
              '">' +
              esc(s.label) +
              "</span>" +
              (s.noDebug
                ? '<span class="debug-chip" data-tip="Started without debugging (no breakpoints)">no debug</span>'
                : "") +
              '<span class="row-actions">' +
              '<button class="iconbtn" data-action="stopDebug" data-debug="' +
              esc(s.id) +
              '" data-tip="Stop this debug session" aria-label="Stop this debug session">' +
              icons.debugStop +
              "</button>" +
              "</span>" +
              "</div>"
          )
          .join("") +
        "</div>"
      : "";

    // The worktree holding the terminal you are typing into. This is what the
    // card outline marks now: it changes as you work and it is the thing you can
    // act on by mistake, so it is worth finding at a glance. It replaced marking
    // the worktree that happens to be the open workspace folder - true of one
    // card, never changing, and not something you need the panel to tell you.
    const hasActiveTerminal =
      !!activeSessionId &&
      (wt.agents || []).some((a) => a.sessionId === activeSessionId);

    const shell = (inner) =>
      '<div class="card' +
      (hasActiveTerminal ? " terminal-open" : "") +
      (isCollapsed ? " collapsed" : "") +
      // Names the card for the two things that have to survive a repaint: the
      // scroll offset of its own agent list, and keyboard focus inside it.
      '" data-card-path="' +
      esc(wt.path) +
      '">' +
      inner +
      "</div>";

    // One sticky header line, one meta line, and the agents. The header is the
    // expand toggle, and it stays pinned while its own agent rows scroll under
    // it, so a row is never separated from the name of the worktree it belongs
    // to - no scrolling back up to check whose agent you are about to click.
    const { subTotal, subStat, stats } = agentStats(agents, foreign);
    const countStat =
      agents.length || subTotal
        ? '<span class="meta-count" title="' +
          agents.length +
          " agent" +
          (agents.length === 1 ? "" : "s") +
          ' in this worktree">' +
          icons.agentMark +
          agents.length +
          "</span>"
        : "";
    const git = gitLine(wt.git);

    // The meta line carries two unrelated readings of the same worktree - what
    // is running in it, and what its working tree looks like - so they sit as
    // two groups at opposite ends of the line rather than as one
    // undifferentiated run of glyphs. Either side can be absent (a clean
    // worktree with no agents, an agent working on a worktree with nothing to
    // report).
    //
    // The agents lead. They are the reading the panel exists for, and the left
    // edge is where a column of cards is scanned; the git totals hold the right
    // edge against them. Plain flex does the rest: an auto margin applies per
    // flex line, so when the panel is too narrow to hold both, the totals wrap
    // to a row of their own and stay right-aligned there.
    //
    // The terminal glyph closes the group. It is the one item here that is about
    // you rather than about the worktree - which of these cards you are typing
    // into - so it sits at the end of the run instead of leading it from a column
    // of its own, and the counts and flags keep a left edge that does not move
    // between cards.
    const terminalMark =
      '<span class="meta-terminal" data-tip="The open terminal belongs to an agent in this worktree">' +
      icons.terminal +
      "</span>";
    const agentGroup = countStat + subStat + stats;
    const leftGroup = agentGroup + stateFlags;
    const meta =
      (leftGroup
        ? '<span class="meta-stats">' + leftGroup + terminalMark + "</span>"
        : "") + git;


    return shell(
      '<div class="card-head' +
        (hasActiveTerminal ? " terminal-open" : "") +
        '">' +
        // Only the chevron and the name expand the card, not the whole header
        // row. The actions at the right end are their own targets, and a miss
        // between them used to fold the card you were reaching into; the divider
        // before them draws where the toggle stops so the boundary is something
        // you can see rather than something you learn by mis-clicking.
        //
        // No tooltip here. It carried the worktree's full path, which meant
        // hovering anywhere on the header - the whole width of the card's
        // primary click target - popped a tip over the card above it. The path
        // is on the Worktree line in the body, on the thing it describes.
        '<div class="head-toggle" data-toggle="' +
        esc(wt.path) +
        '" role="button" tabindex="0" aria-expanded="' +
        (isCollapsed ? "false" : "true") +
        '">' +
        '<span class="chevron">' +
        icons.chevron +
        "</span>" +
        // The name and the terminal glyph, as inline content rather than as
        // flex items: a branch name too long for the line wraps, and the glyph
        // follows the last word instead of floating beside a two-line block.
        '<span class="head-main">' +
        primaryMark +
        '<span class="branch">' +
        esc(wt.name) +
        "</span>" +
        "</span>" +
        "</div>" +
        // The actions pinned to the header, held against the right edge and
        // kept on the name's first line however far the name wraps. Three
        // buttons only: past about that
        // many identically framed icons the run stops having a shape, nothing
        // in it is findable faster than anything else, and the name — the one
        // thing you scan a card for — starts wrapping to pay for them. So this
        // holds the three that act on the worktree without going into it —
        // switch its branch, re-read it, delete it — and everything you would
        // open it to do lives in the body. Switch branch leads them, next to
        // the name it rewrites — destructive actions sit at the end of a run,
        // and the confirmation modal guards a near-miss.
        '<span class="head-actions">' +
        // Source Control scope leads the run: it is the one control here that
        // is also a reading, and the badge below says the same thing, so the
        // two line up down the card's left-to-right order rather than facing
        // each other across the name.
        scmScopeBtn(wt.path, wt.scmActive) +
        // Switch branch, refresh, open in a window and delete, behind one
        // caret. Four buttons that are each reached rarely - you switch a
        // branch or delete a worktree once in its life - were taking the whole
        // name line to sit there being available. A menu costs one extra click
        // on the rare path and gives the name back the width on every card.
        '<button class="act ghost iconact card-menu-btn" data-tool="cardMenu" data-path="' +
        esc(wt.path) +
        '" data-menu-key="card:' +
        esc(wt.path) +
        '" data-tip="More actions for this worktree" aria-label="More actions"' +
        ' aria-haspopup="menu" aria-expanded="false">' +
        icons.caret +
        "</button>" +
        "</span>" +
        "</div>" +
        // Indented to the branch name above it, like the Worktree line below, so
        // the card's facts share one left edge.
        (meta ? '<div class="card-meta">' + meta + "</div>" : "") +
        prLine(wt.pr) +
        '<div class="card-body">' +
        worktreeNameRow(wt) +
        debugRows +
        agentSection(wt.path, agents, foreign, agentBtn) +
        "</div>"
    );

  }

  // --- Agents view -----------------------------------------------------------
  // Every agent in the repository as one flat list, instead of one card per
  // worktree with its agents inside it. The cards answer "what is this worktree
  // doing"; this answers "what is running, and what does it need from me" — the
  // question you have when the count in the toolbar says four agents and finding
  // the one that is waiting means opening four cards.
  //
  // Nothing new is fetched for it: the rows are built from the same payload the
  // cards render, so switching views is a webview-local re-render with no round
  // trip to the extension.

  // The rows are grouped by status, in the order the user set in Settings →
  // Preferences (waiting, active, idle out of the box: the agent that needs you
  // is the reason to open the view). Sorting is stable, so within a status the
  // rows keep the worktree order the cards are in, and a row moves only when its
  // status actually changes.

  /** Paths compared for display purposes only: separators and trailing slashes
   *  normalized, case-insensitive (Windows and macOS both need that). */
  function samePath(a, b) {
    const norm = (p) =>
      String(p || "")
        .replace(/\\/g, "/")
        .replace(/\/+$/, "")
        .toLowerCase();
    return norm(a) === norm(b);
  }

  /** What to call a worktree in a row: its branch when it has one (that is what
   *  `name` carries), else its directory. */
  function worktreeLabel(data, path) {
    const wts = (data && data.worktrees) || [];
    const wt = wts.find((w) => samePath(w.path, path));
    return (wt && wt.name) || baseName(path);
  }

  /** Where an agent's work is landing, as a chip on its row: the branch, with
   *  the worktree path behind it. This is the whole reason a flat list works —
   *  without it two rows reading "Fix the flaky test" are indistinguishable. */
  function whereChip(wt) {
    const name = wt.name || baseName(wt.path);
    const tip =
      (wt.detached
        ? "Detached HEAD"
        : wt.branch
        ? "On branch " + wt.branch
        : "No branch") +
      ". " +
      wt.path;
    return (
      '<span class="agent-where' +
      (wt.detached ? " detached" : "") +
      '" data-tip="' +
      esc(tip) +
      '">' +
      (wt.detached ? icons.detached : icons.branch) +
      "<span>" +
      esc(name) +
      "</span>" +
      (wt.isPrimary
        ? '<span class="agent-where-primary" aria-label="Primary working directory">' +
          icons.home +
          "</span>"
        : "") +
      "</span>"
    );
  }

  /** One agent, plus every subagent it is running. On a card the subagents given
   *  a worktree of their own are rows on THAT card; here the parent is the row
   *  they hang off wherever they are working, so each carries the worktree it
   *  was handed instead. */
  function agentListRow(data, a, wt, boundary) {
    const s = statusOf(a);
    const chips = agentChips(a);
    const subs = (a.subagents || [])
      .map((sub) =>
        subagentRow(
          sub,
          s === "waiting",
          a.sessionId,
          "",
          sub.worktree ? worktreeLabel(data, sub.worktree) : ""
        )
      )
      .join("");
    return (
      '<div class="agent-row' +
      (s === "waiting" ? " attention" : "") +
      (pinned.has(a.sessionId) ? " pinned" : "") +
      (boundary ? " pin-boundary" : "") +
      (a.sessionId === activeSessionId ? " terminal-open" : "") +
      '" data-action="focusAgent" data-session="' +
      esc(a.sessionId) +
      '" ' +
      agentRowA11y(a, s) +
      ">" +
      '<span class="status-dot ' +
      s +
      '"></span>' +
      '<span class="agent-label" data-tip="' +
      esc(a.summary || a.label) +
      '">' +
      esc(a.label) +
      "</span>" +
      '<span class="terminal-chip" data-tip="This agent\'s terminal is open. It is the one you are talking to">' +
      icons.terminal +
      "</span>" +
      agentScmBtn(wt) +
      pinAgentBtn(a) +
      stopAgentBtn(a) +
      // The branch and the counters share the row's second line: the summary
      // above them gets the full width it needs, and the two readings of the row
      // that are not its title sit together under it.
      '<span class="agent-meta">' +
      whereChip(wt) +
      (chips ? '<span class="agent-chips">' + chips + "</span>" : "") +
      "</span>" +
      "</div>" +
      subs
    );
  }

  function agentsList(data) {
    const wts = (data && data.worktrees) || [];
    const entries = [];
    const sessions = new Set();
    for (const wt of wts) {
      for (const a of wt.agents || []) {
        entries.push({ a, wt });
        sessions.add(a.sessionId);
      }
    }
    const order = statusOrder(data);
    // Pinned agents first, whatever their status: a pin is the user overriding
    // the grouping for one row, so it has to outrank the group order rather than
    // sort inside it. Below that the status order applies as it always did, and
    // it still applies among the pinned rows themselves. Stable, so a row moves
    // only when it is pinned or its status actually changes.
    const rank = (e) => (pinned.has(e.a.sessionId) ? 0 : 1);
    entries.sort(
      (x, y) =>
        rank(x) - rank(y) ||
        order.indexOf(statusOf(x.a)) - order.indexOf(statusOf(y.a))
    );
    // Where the pinned run ends, so the list can draw a rule there. Only when
    // there is something on both sides of it: a boundary above the first row, or
    // below the last, separates nothing.
    const firstUnpinned = entries.findIndex((e) => rank(e) === 1);
    const boundaryAt = firstUnpinned > 0 ? firstUnpinned : -1;

    // A subagent whose parent session is not itself listed — its agent is
    // running somewhere this panel is not showing. On the cards it has a row of
    // its own; without this it would simply vanish when the view is switched.
    const orphans = [];
    for (const wt of wts) {
      for (const s of wt.subagents || []) {
        if (!sessions.has(s.parentSessionId)) orphans.push({ s, wt });
      }
    }

    if (!entries.length && !orphans.length) {
      return (
        // Same reason as the card's empty line: the toolbar control is
        // icon-only, so it is pointed at by position rather than by a name it
        // does not display.
        '<div class="empty">No agents running.<br/>' +
        "Start one from a worktree, or with the new-worktree button at the top " +
        "of the panel.</div>"
      );
    }
    return (
      '<div class="agents">' +
      entries
        .map((e, i) => agentListRow(data, e.a, e.wt, i === boundaryAt))
        .join("") +
      orphans
        .map((o) =>
          subagentRow(
            o.s,
            o.s.parentStatus === "waiting",
            o.s.parentSessionId,
            o.s.parentLabel || "another agent",
            o.wt.name || baseName(o.wt.path)
          )
        )
        .join("") +
      "</div>"
    );
  }

  /**
   * The two views, as a tab strip across the foot of the header: two labels
   * sitting on the rule that divides the header from the list, the current one
   * underlined.
   *
   * Tabs rather than a pair of buttons, because that is what this is - the list
   * below is the tab's contents, and pressing one changes the whole panel. As
   * two small controls parked at the end of a line of counters they read as two
   * more toolbar buttons, which undersold what they do. A strip on a rule says
   * which view you are in without being read, because the underline is attached
   * to the thing it names. The shape is VS Code's own panel-title tabs
   * (uppercase 11px, active underline in `panelTitle-activeBorder`), so it reads
   * as chrome around the list rather than as another row of panel content.
   *
   * Labelled in words, not glyphs. The agent mark is the panel's most repeated
   * glyph - it counts agents on the line above, in every card and on every agent
   * row - so spending it again on "the view listing agents" made the control
   * read as another counter.
   */
  function viewTabs(data) {
    const tab = (id, label, tip) =>
      '<button class="view-tab' +
      (panelView === id ? " active" : "") +
      '" role="tab" data-tool="view" data-view="' +
      id +
      '" data-tip="' +
      esc(tip) +
      '" aria-selected="' +
      (panelView === id ? "true" : "false") +
      '">' +
      esc(label) +
      "</button>";
    return (
      '<div class="view-tabs">' +
      '<div class="view-tablist" role="tablist" aria-label="Panel view">' +
      tab(
        "worktrees",
        "Worktrees",
        "Worktrees: one card per worktree, with its agents inside it"
      ) +
      tab(
        "agents",
        "Agents",
        "Agents: every agent in the repository in one list, waiting ones first"
      ) +
      "</div>" +
      // Held against the right end of the strip, the way a panel keeps its
      // actions beside its tabs: what it folds is the tab's contents, so it
      // belongs on the tab's line rather than up among the counters.
      '<span class="view-tab-actions">' +
      collapseAllBtn(data) +
      "</span>" +
      "</div>"
    );
  }

  /**
   * The whole repo's agents, in the glyphs a card uses for its own: how many
   * agents, how many live subagents, and the per-status breakdown. Read off the
   * top of the panel it answers "is anything waiting on me anywhere" without
   * scanning down the cards - which is the question the panel exists to answer,
   * and the one that gets harder with every worktree added.
   *
   * Built by handing every card's agents to the same `agentStats` a card calls,
   * so the total is the sum of what the cards show rather than a second number
   * derived a second way that can disagree with them. Subagents are counted
   * where the cards count them: an agent's own that stayed put, plus the ones
   * sent into a worktree, which that worktree's card carries as `subagents`.
   *
   * Returns the glyphs only. Their line is emitted by `toolbar`, which shares it
   * with the view switch, so a repo with nothing to summarize still gets the row.
   */
  function repoStats(data) {
    const wts = (data && data.worktrees) || [];
    if (!wts.length) return "";
    const agents = [];
    const foreign = [];
    for (const wt of wts) {
      if (wt.agents) agents.push.apply(agents, wt.agents);
      if (wt.subagents) foreign.push.apply(foreign, wt.subagents);
    }
    const { subStat, stats } = agentStats(agents, foreign);
    const withAgents = wts.filter((wt) => (wt.agents || []).length).length;
    const count =
      '<span class="meta-count" data-tip="' +
      agents.length +
      " agent" +
      (agents.length === 1 ? "" : "s") +
      " in " +
      withAgents +
      " of " +
      wts.length +
      " worktree" +
      (wts.length === 1 ? "" : "s") +
      '">' +
      icons.agentMark +
      agents.length +
      "</span>";
    return count + subStat + stats;
  }

  function toolbar(data) {
    const stats = repoStats(data);
    return (
      // Name, tools, the repo-wide agent summary and the view tabs as one block:
      // the summary is about the repository the name identifies, and the tabs
      // are what the block hands down to the list. The rule under it all is the
      // tab strip's own, so the tabs sit on it.
      '<div class="repo-bar">' +
      '<div class="repo-head">' +
      "<span>" +
      esc(data.repoName || "Repository") +
      "</span>" +
      '<span class="tools">' +
      // Ghost like the rest of the toolbar. It wore the filled treatment as the
      // primary action, which made it the one saturated block in a row of quiet
      // outlines - and the panel's accent now means "this is the worktree you are
      // typing into", which this button is not.
      // aria-label as well as data-tip on both: the tip is a div this script
      // positions on hover, which assistive technology never reads, so these two
      // were the only controls in the panel with no accessible name at all.
      '<button class="tbtn ghost icon" data-action="agentWorktree" aria-label="New agent and worktree" data-tip="New Agent &amp; Worktree: create a worktree with Claude (claude -w) and start an agent in it">' +
      icons.agentWorktree +
      "</button>" +
      '<button class="tbtn ghost" data-action="openBranches" aria-label="Branches" data-tip="Branches: list every branch and create a worktree from one">' +
      icons.branch +
      "</button>" +
      "</span>" +
      "</div>" +
      // The repo-wide agent summary, on its own line under the name. Dropped
      // entirely when there is nothing to summarize, rather than left as an
      // empty line: the tab strip below it is what has to be reachable in an
      // empty repository, and it no longer rides on this row.
      (stats ? '<div class="repo-stats">' + stats + "</div>" : "") +
      viewTabs(data) +
      "</div>"
    );
  }

  /**
   * The cards, divided into the user's groups.
   *
   * General is always drawn, even when it is the only group and a user has never
   * made one. It is where a new worktree lands, so it is the thing you drag out
   * of and the header you reach for New group on; a panel that only grew
   * sections once you already had two of them made the first one hard to find
   * and moved every card the moment you did.
   *
   * A card whose group is gone (deleted in another window between this payload
   * and the last) falls to General rather than vanishing, which is the same rule
   * the host applies when it reads the stored state - see src/groups.ts.
   */
  function cardsBody(data) {
    const wts = data.worktrees || [];
    if (!wts.length) return '<div class="empty">No worktrees found.</div>';
    const groups = (data.groups || []).filter((g) => g && g.id);
    // A group deleted (here or in another window) leaves its fold behind. Drop
    // it, so an id reused later cannot arrive already collapsed.
    if (groups.length) {
      let dropped = false;
      for (const id of collapsedGroups) {
        if (!groups.some((g) => g.id === id)) {
          collapsedGroups.delete(id);
          dropped = true;
        }
      }
      if (dropped) persist();
    }
    // No groups at all means a payload from before they were attached (a repo
    // with no settings key of its own). Everything else has at least General.
    if (!groups.length) return wts.map(card).join("");
    // The primary worktree is not in any group. It is the checkout the repo
    // itself lives in and every other worktree hangs off, so it is not one of
    // the things you file - it is what they are filed under. It leads the list,
    // above the sections, and a labelled rule separates the two.
    const primary = wts.filter((wt) => wt.isPrimary);
    const rest = wts.filter((wt) => !wt.isPrimary);
    // A repository with only its primary worktree has nothing to file, so the
    // sections are three rows of chrome about a feature that has not been used
    // and cannot yet do anything: a `Worktrees` divider, a `General 0` header,
    // and an empty-section line inviting a move from a menu that would not
    // offer it (the primary cannot be filed). Only when General is still the
    // only group - once the user has made one of their own, their structure is
    // shown whether or not anything is in it.
    const onlyGeneral = groups.length === 1 && groups[0].id === "general";
    if (!rest.length && onlyGeneral) return primary.map(card).join("");
    const members = new Map(groups.map((g) => [g.id, []]));
    for (const wt of rest) {
      const list = members.get(wt.group) || members.get("general");
      if (list) list.push(wt);
    }
    return (
      primary.map(card).join("") +
      (primary.length ? divider("Worktrees") : "") +
      groups.map((g) => groupSection(g, members.get(g.id) || [])).join("")
    );
  }

  /**
   * The rule between the primary worktree and the groups. A label rather than a
   * bare line: a hairline on its own says "these are apart" without saying why,
   * and what is below it is every other worktree in the repository, however the
   * user has since divided them up.
   */
  function divider(label) {
    return (
      '<div class="cards-divider"><span>' + esc(label) + "</span></div>"
    );
  }

  /**
   * One section: its header, and its cards under it.
   *
   * The header is a fold, a name, a count and a caret - deliberately quieter
   * than a card header, since it labels the list rather than being an item in
   * it. An empty group keeps its header: it is a place the user made to put
   * things in, and one that disappeared when the last card left it would look
   * like the panel had deleted it.
   *
   * Collapsed, it carries the number of agents waiting inside. That is what
   * stops a group from becoming somewhere work rots: the whole point of the
   * section is that you stop reading it, so folding one must not be able to
   * hide an agent that needs you. It reads the same status the Activity Bar
   * badge counts.
   */
  function groupSection(g, wts) {
    const collapsed = collapsedGroups.has(g.id);
    const editing = editingGroup === g.id;
    let waiting = 0;
    for (const wt of wts) {
      for (const a of wt.agents || []) if (statusOf(a) === "waiting") waiting++;
    }
    // Rendered whenever there is one to report, and hidden by CSS while the
    // group is open (where the rows themselves say it). That keeps folding a
    // class flip: a badge that only exists in the collapsed markup would need a
    // re-render to appear, and a re-render costs the list its scroll position.
    const alert =
      waiting
        ? '<span class="group-alert" data-tip="' +
          waiting +
          " agent" +
          (waiting === 1 ? "" : "s") +
          ' in this group need' +
          (waiting === 1 ? "s" : "") +
          ' you">' +
          icons.agentMark +
          waiting +
          "</span>"
        : "";
    return (
      '<div class="group' +
      (collapsed ? " collapsed" : "") +
      '">' +
      '<div class="group-head">' +
      '<div class="group-toggle' +
      (editing ? " editing" : "") +
      '" data-group-toggle="' +
      esc(g.id) +
      '" role="button" tabindex="0" aria-controls="group-cards-' +
      esc(g.id) +
      '" aria-expanded="' +
      (collapsed ? "false" : "true") +
      '">' +
      '<span class="chevron">' +
      icons.chevron +
      "</span>" +
      (editing
        ? // Rendered with the name as its value, selected on mount, so typing
          // replaces it and a click puts the caret where you clicked.
          '<input class="group-rename" type="text" data-group-rename="' +
          esc(g.id) +
          '" maxlength="40" spellcheck="false" aria-label="Group name" value="' +
          esc(g.name) +
          '">'
        : '<span class="group-name">' + esc(g.name) + "</span>") +
      '<span class="group-count">' +
      wts.length +
      "</span>" +
      alert +
      "</div>" +
      '<button class="act ghost iconact group-menu-btn" data-tool="groupMenu" data-group="' +
      esc(g.id) +
      '" data-menu-key="group:' +
      esc(g.id) +
      '" data-tip="Rename, reorder or delete this group" aria-label="Group actions"' +
      ' aria-haspopup="menu" aria-expanded="false">' +
      icons.caret +
      "</button>" +
      "</div>" +
      '<div class="group-cards" id="group-cards-' +
      esc(g.id) +
      '">' +
      (wts.length
        ? wts.map(card).join("")
        : '<div class="group-empty">Empty. Move a worktree here from its menu.</div>') +
      "</div>" +
      "</div>"
    );
  }

  /**
   * The expand/collapse control. One button doing both, because the two are
   * never both useful: with anything open the only thing left to ask for is
   * closing them, and with everything shut, opening them. It says which of the
   * two it will do rather than naming the state it is in.
   *
   * Disabled, not dropped, in the agents view: that view's rows are the leaves,
   * so there is nothing to fold - but a control that vanishes and comes back
   * moves the switch beside it out from under the pointer that just used it.
   */
  function collapseAllBtn(data) {
    const wts = (data && data.worktrees) || [];
    const anyExpanded = wts.some((w) => expanded.has(w.path));
    const off = panelView === "agents";
    const label = anyExpanded ? "Collapse all" : "Expand all";
    return (
      // Off via a class and aria-disabled, not the `disabled` attribute: a
      // disabled button dispatches no mouse events, so the tooltip saying WHY it
      // is off would be the one thing you could not hover to read. The click
      // handler re-checks the class, which is what actually stops the action.
      '<button class="tbtn ghost' +
      (off ? " disabled" : "") +
      '" data-tool="collapseAll" aria-disabled="' +
      (off ? "true" : "false") +
      '" data-tip="' +
      (off ? "Disabled in the agents view: nothing to fold" : label) +
      '" aria-label="' +
      label +
      '">' +
      (anyExpanded ? icons.collapseAll : icons.expandAll) +
      "</button>"
    );
  }

  /**
   * Bring that button back in step after a single card was toggled. `toggle`
   * flips a class rather than re-rendering, so nothing else would notice that
   * the last open card just shut.
   */
  function syncCollapseAllBtn() {
    const btn = root.querySelector("[data-tool='collapseAll']");
    if (!btn || !btn.parentElement) return;
    btn.outerHTML = collapseAllBtn(lastData);
  }

  function render(data) {
    const holding = (editingGroup || drag) && data !== lastData;
    lastData = data;
    hideTip(); // a re-render replaces the hovered node; drop any open tooltip
    // A routine payload must not wipe a name being typed, or pull the list out
    // from under a section being dragged - both would be lost to a refresh the
    // user did not ask for, and agents push these constantly. Same guard the
    // settings view uses for the token field, and the same shape: the data is
    // kept, the paint is not. endGroupRename and endDrag paint as soon as the
    // gesture is over, so the panel is at most one refresh stale and only while
    // a gesture is in flight. `data !== lastData` is what tells a push apart
    // from the internal re-render that ends one, which must still paint.
    if (holding) return;
    if (settingsOpen) {
      // Settings owns the whole window; routine data pushes must not wipe the
      // token field mid-type, so only re-render when GitHub state changed.
      maybeRefreshSettings(data);
      return;
    }
    if (!data || !data.repoRoot) {
      // Nothing the menu could act on survives this, and it is mounted on
      // <body>, so it would otherwise hang there over an empty panel.
      closeCardMenu();
      root.innerHTML =
        '<div class="empty">No git repository in this window.<br/>Open a folder that is a git repository to see its worktrees.</div>';
      return;
    }
    // What the paint below would otherwise throw away. Read back here, put back
    // after (see restoreAfterPaint): an agent going active must not close the
    // menu the user just opened, move their keyboard focus to nowhere, or
    // scroll a card's agent list back to the top.
    //
    // Preserving it, rather than skipping the paint, is the fix that was
    // available: the extension already drops a payload that would render
    // identically (see postData), so every render that reaches here is a real
    // change - an agent's status, a git count, a PR - and has to be drawn.
    const keep = captureBeforePaint();
    // Preserve the cards scroll offset across the innerHTML swap so a routine
    // refresh doesn't bounce the user back to the top (see renderBranches).
    const prevCards = root.querySelector(".cards");
    const y = prevCards ? prevCards.scrollTop : 0;
    // Both views scroll in the same `.cards` region, so the toolbar stays put and
    // the scroll restore above works for either.
    const body =
      panelView === "agents"
        ? '<div class="cards agents-list">' + agentsList(data) + "</div>"
        : '<div class="cards">' + cardsBody(data) + "</div>";
    root.innerHTML = toolbar(data) + body;
    const nextCards = root.querySelector(".cards");
    if (nextCards) nextCards.scrollTop = y;
    syncGroupHeadHeight();
    restoreAfterPaint(keep);
    openFlaggedRename(data);
  }

  /**
   * Read back the view state a paint would destroy.
   *
   * Three things, all of them state the user created and the payload knows
   * nothing about: which element has keyboard focus, which card menu is open,
   * and how far each card's own (bounded, independently scrolling) agent list
   * has been scrolled. Elements are identified by the data attributes they
   * already carry rather than by index, so they are found again after the
   * markup is rebuilt even if rows moved.
   */
  function captureBeforePaint() {
    const active = document.activeElement;
    const inRoot = active && active !== document.body && root.contains(active);
    const scrolls = [];
    root.querySelectorAll(".agent-list .agents").forEach((el) => {
      if (!el.scrollTop) return;
      const card = el.closest("[data-card-path]");
      if (card) scrolls.push([card.getAttribute("data-card-path"), el.scrollTop]);
    });
    // Focus inside the menu needs nothing: the menu is mounted on <body>, so
    // the paint below does not touch it. Only focus inside the panel is lost.
    return { focus: inRoot ? focusSelectorFor(active) : "", scrolls };
  }

  /** A selector that finds this element again after the markup is rebuilt. Only
   *  the attributes a row is already keyed by; anything else (an index, a
   *  position) would follow the wrong row once the list reorders. */
  function focusSelectorFor(el) {
    const action = el.getAttribute("data-action") || "";
    for (const attr of ["data-session", "data-card-path", "data-menu-key", "data-tool", "data-group"]) {
      const v = el.getAttribute(attr);
      if (!v) continue;
      return (
        "[" + attr + '="' + cssEscape(v) + '"]' +
        (action ? '[data-action="' + cssEscape(action) + '"]' : "")
      );
    }
    return action ? '[data-action="' + cssEscape(action) + '"]' : "";
  }

  function restoreAfterPaint(keep) {
    if (!keep) return;
    for (const [path, top] of keep.scrolls) {
      const card = root.querySelector(
        '[data-card-path="' + cssEscape(path) + '"]'
      );
      const list = card && card.querySelector(".agent-list .agents");
      if (list) list.scrollTop = top;
    }
    if (keep.focus) {
      const el = root.querySelector(keep.focus);
      // preventScroll: focus is being put back where it already was, so the
      // browser must not also scroll the list to "reveal" it.
      if (el && typeof el.focus === "function") el.focus({ preventScroll: true });
    }
    resyncOpenMenu();
    markScrollableLists();
  }

  /**
   * Flag each bounded agent list that still has rows below the fold, which is
   * what draws the fade at its bottom edge (see the `data-more` rule).
   *
   * Measured rather than assumed: the list's height is a fixed max, but whether
   * it overflows depends on how many agents a card has and how far each summary
   * wraps, and it changes as the user scrolls to the end.
   */
  function markScrollableLists(within) {
    const scope = within || root;
    const lists = within
      ? [within]
      : [...scope.querySelectorAll(".card .agent-list .agents")];
    for (const el of lists) {
      const more = el.scrollHeight - el.clientHeight - el.scrollTop > 1;
      if (more) el.setAttribute("data-more", "1");
      else el.removeAttribute("data-more");
    }
  }

  /**
   * Tell the stylesheet how tall a section header actually is, so the card
   * headers that pin under it land against it rather than 2px into or short of
   * it. Both are sticky in the same scroll region, and the offset is the only
   * thing that keeps them from being drawn on top of each other.
   *
   * Measured rather than written down: the header is one line of fixed-size text
   * beside an icon button, so it is stable, but "stable" is not "known", and a
   * theme or a font that changed it would leave a hairline gap that nothing in
   * the source explains. One read per render, and only when sections are drawn.
   */
  function syncGroupHeadHeight() {
    const head = root.querySelector(".group-head");
    if (!head) return;
    const h = Math.round(head.getBoundingClientRect().height);
    if (h > 0) root.style.setProperty("--group-head-h", h + "px");
  }

  /**
   * Put one group's header into edit mode: the name becomes a field in place,
   * with the current name selected so typing replaces it.
   *
   * A full re-render, because the header's markup changes. That is fine here -
   * it happens once per rename, on a deliberate click - and `render` is what
   * restores the list's scroll offset.
   */
  function startGroupRename(id) {
    if (!id || id === "general") return;
    closeCardMenu();
    editingGroup = id;
    render(lastData);
    const input = root.querySelector(
      '[data-group-rename="' + cssEscape(id) + '"]'
    );
    if (!input) {
      editingGroup = "";
      return;
    }
    // A group made from a card menu is appended at the end of the list, which
    // may be below the fold: there is no point opening a field nobody can see.
    input.scrollIntoView({ block: "nearest" });
    input.focus();
    input.select();
  }

  /**
   * A group the host has just created arrives flagged, and the panel opens its
   * header field: created and named are one gesture, so the placeholder name is
   * never what you are left with unless you walk away from it.
   *
   * Guarded by the last id acted on as well as by the host clearing the flag,
   * since the cached payload passes through several posters.
   */
  let lastEditFlag = "";
  function openFlaggedRename(data) {
    const id = data && data.editGroup;
    if (!id || id === lastEditFlag) return;
    lastEditFlag = id;
    startGroupRename(id);
  }

  /**
   * Leave edit mode. `commit` sends the typed name to the host; anything else
   * (Escape, an empty field) drops it and the group keeps the name it had.
   *
   * The host is the one that trims, caps and de-duplicates the name - the same
   * code path a stored blob goes through - so this sends what was typed and lets
   * the next payload say what it became.
   */
  function endGroupRename(commit) {
    const id = editingGroup;
    if (!id) return;
    const input = root.querySelector(
      '[data-group-rename="' + cssEscape(id) + '"]'
    );
    const name = input ? input.value.trim() : "";
    editingGroup = "";
    if (commit && name) send("renameGroup", { groupId: id, name });
    // Paint the payload that was held back while the field was open. When the
    // rename went through, the host's own update lands a moment later and
    // replaces this with the name it actually stored.
    render(lastData);
  }

  // --- Dragging a section to reorder ----------------------------------------
  //
  // Pointer events rather than HTML5 drag and drop: this needs a drop indicator,
  // autoscroll at the edges of a short sidebar, and a cancel key, and the native
  // API gives none of those while taking over the cursor and the drag image.
  //
  // The group being dragged stays where it is and dims; a line shows where it
  // would land. A group can be several screens tall with its cards open, so
  // carrying the whole block under the pointer, or swapping neighbours as their
  // midpoints pass, would both be motion sickness. The line is the whole answer:
  // it is the only thing the drop actually decides.
  let drag = null;
  // Set when a drag ends, and read once by the click that follows it: releasing
  // the pointer over a header fires a click, and that click must not fold the
  // section the user just moved.
  let dragSuppressedClick = false;

  function dragCards() {
    return root.querySelector(".cards");
  }

  /**
   * Where a drop at `y` would insert: an index into the group list, 0..n, being
   * the boundary the pointer is nearest. Measured off the `.group` elements and
   * not their headers, which are sticky and so are not where they say they are.
   */
  function dropIndexAt(y) {
    const els = drag.els;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i <= els.length; i++) {
      const r =
        i < els.length
          ? els[i].getBoundingClientRect().top
          : els[els.length - 1].getBoundingClientRect().bottom;
      const d = Math.abs(y - r);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  /** The index the dragged group would end up at, which is one less than the
   *  boundary when it is moving down past its own slot. */
  function dragTargetIndex() {
    return drag.insert > drag.from ? drag.insert - 1 : drag.insert;
  }

  function beginDrag() {
    const cards = dragCards();
    if (!cards) return;
    drag.els = Array.from(root.querySelectorAll(".group"));
    drag.from = drag.els.indexOf(drag.el);
    if (drag.from === -1 || drag.els.length < 2) {
      drag = null;
      return;
    }
    drag.moved = true;
    // Sticky headers are pinned somewhere other than where their group is, which
    // makes both the measuring and the picture wrong. Off for the duration.
    cards.classList.add("dragging");
    drag.el.classList.add("drag-source");
    drag.line = document.createElement("div");
    drag.line.className = "drop-line";
    cards.appendChild(drag.line);
    closeCardMenu();
  }

  function updateDrag(y) {
    const cards = dragCards();
    if (!cards || !drag.line) return;
    drag.insert = dropIndexAt(y);
    const els = drag.els;
    const i = drag.insert;
    const r =
      i < els.length
        ? els[i].getBoundingClientRect().top
        : els[els.length - 1].getBoundingClientRect().bottom;
    const box = cards.getBoundingClientRect();
    // Content coordinates: an absolutely positioned child of a scroll container
    // scrolls with its content, so the line has to be placed against the scroll
    // offset rather than against the viewport.
    drag.line.style.top = Math.round(r - box.top + cards.scrollTop) + "px";
    // Nothing to draw when the drop would put it back where it started.
    drag.line.classList.toggle("noop", dragTargetIndex() === drag.from);
    autoScroll(y, box, cards);
  }

  /**
   * Scroll the list while the pointer is held near either end of it. On a rAF
   * loop rather than on pointermove: a pointer held still at the edge is the
   * case that needs it most, and that fires no move events at all.
   */
  function autoScroll(y, box, cards) {
    const zone = 28;
    const speed =
      y < box.top + zone ? -8 : y > box.bottom - zone ? 8 : 0;
    drag.scrollBy = speed;
    if (speed && !drag.raf) {
      const step = () => {
        if (!drag || !drag.scrollBy) {
          if (drag) drag.raf = 0;
          return;
        }
        const before = cards.scrollTop;
        cards.scrollTop += drag.scrollBy;
        // The list moved under the pointer, so the drop target did too.
        if (cards.scrollTop !== before) updateDrag(drag.y);
        drag.raf = requestAnimationFrame(step);
      };
      drag.raf = requestAnimationFrame(step);
    }
  }

  /**
   * Finish. `commit` false is a cancel (Escape, or a pointer lost mid-drag) and
   * leaves the order alone.
   *
   * A committed move is sent as the delta `moveGroup` already takes, so dragging
   * and the menu's Move up and Move down are one action at the host - which
   * matters more than it looks: the ordering is what rule precedence will be
   * built on, and two ways to write it would be two things to keep in step.
   */
  function endDrag(commit) {
    if (!drag) return;
    const { el, line, raf, id, from, moved } = drag;
    if (raf) cancelAnimationFrame(raf);
    const target = moved ? dragTargetIndex() : from;
    drag = null;
    const cards = dragCards();
    if (cards) cards.classList.remove("dragging");
    if (el) el.classList.remove("drag-source");
    if (line) line.remove();
    if (!moved) return;
    dragSuppressedClick = true;
    if (commit && target !== from) {
      send("moveGroup", { groupId: id, delta: target - from });
    }
    // Paint whatever landed while the drag held the list still. A committed move
    // is replaced by the host's own payload a moment later; this is what covers
    // the cancel, and the refresh that arrived mid-drag either way.
    render(lastData);
  }

  root.addEventListener("pointerdown", (e) => {
    // Left button only, and never on the caret, a link, or the rename field.
    if (e.button !== 0 || drag) return;
    const head = e.target.closest(".group-head");
    if (!head || e.target.closest("button, a, input")) return;
    const toggle = head.querySelector("[data-group-toggle]");
    const id = toggle && toggle.getAttribute("data-group-toggle");
    if (!id) return;
    // Armed, not started. A press that never moves is a click, and clicking a
    // header folds it.
    drag = {
      id,
      el: head.closest(".group"),
      startY: e.clientY,
      y: e.clientY,
      moved: false,
      insert: 0,
      from: 0,
      raf: 0,
    };
  });

  document.addEventListener("pointermove", (e) => {
    if (!drag) return;
    drag.y = e.clientY;
    if (!drag.moved) {
      if (Math.abs(e.clientY - drag.startY) < 4) return;
      beginDrag();
      if (!drag) return;
    }
    // Held once a drag is real, so the list does not select text or fire hovers
    // under the pointer.
    e.preventDefault();
    updateDrag(e.clientY);
  });

  document.addEventListener("pointerup", () => endDrag(true));
  // A pointer that leaves the window, or is taken by something else, is a cancel
  // rather than a drop at wherever it was last seen.
  document.addEventListener("pointercancel", () => endDrag(false));

  /**
   * Fold or unfold one group. Same trick as `toggle` below: flip a class on the
   * section that is already there. Its cards are unchanged, only whether they
   * are shown, and a re-render would cost the list its scroll position on every
   * click - which matters more here, since folding a group is what you do to
   * get back to the top of the list.
   */
  function toggleGroup(id) {
    if (collapsedGroups.has(id)) collapsedGroups.delete(id);
    else collapsedGroups.add(id);
    persist();
    const head = root.querySelector(
      '[data-group-toggle="' + cssEscape(id) + '"]'
    );
    if (!head) return;
    const collapsed = collapsedGroups.has(id);
    head.setAttribute("aria-expanded", collapsed ? "false" : "true");
    const section = head.closest(".group");
    if (section) section.classList.toggle("collapsed", collapsed);
  }

  /**
   * Expand or collapse one card. Flips a class on the DOM it already has rather
   * than re-rendering: the rows are unchanged, only their visibility, and a
   * re-render would cost the panel its scroll position on every click.
   */
  function toggle(path) {
    if (expanded.has(path)) expanded.delete(path);
    else expanded.add(path);
    persist();
    const el = root.querySelector('[data-toggle="' + cssEscape(path) + '"]');
    // closest, not parentElement: the toggle is the name half of the header, so
    // the card it folds is two levels up.
    const card = el && el.closest(".card");
    if (card) card.classList.toggle("collapsed");
    // The header is the card's sole disclosure control, so it carries the state
    // for screen readers; the class toggle above never re-renders it.
    if (el && el.hasAttribute("aria-expanded"))
      el.setAttribute("aria-expanded", expanded.has(path) ? "true" : "false");
    syncCollapseAllBtn();
  }


  function collapseAll() {
    const wts = (lastData && lastData.worktrees) || [];
    const anyExpanded = wts.some((w) => expanded.has(w.path));
    if (anyExpanded) expanded.clear();
    else for (const w of wts) expanded.add(w.path);
    persist();
    if (lastData) render(lastData);
  }

  /**
   * Pin or unpin one agent in the agents view, then redraw the list it reorders.
   *
   * Pinning scrolls the list back to the top; unpinning does not. Pinning is a
   * request to keep that row in sight, and it has just moved somewhere the user
   * may not be looking - whereas unpinning from the top of the list is done
   * while looking straight at it, and would only lose their place.
   */
  function togglePin(sessionId) {
    if (!sessionId) return;
    const adding = !pinned.has(sessionId);
    if (adding) pinned.add(sessionId);
    else pinned.delete(sessionId);
    persist();
    if (!lastData) return;
    render(lastData);
    if (!adding) return;
    const list = root.querySelector(".cards");
    if (list) list.scrollTop = 0;
  }

  // Pinned ids whose session was missing from the last payload. A pin is only
  // dropped once its session has been absent from two payloads running: the
  // registry file a session is read from is rewritten in place on every status
  // transition, so a single gather can miss one that is still very much running,
  // and one unlucky read must not silently unpin it. Not persisted - a reload
  // starts the count again, which at worst delays a dead pin's cleanup by one
  // payload.
  let missingPins = new Set();

  /** Forget pins whose agent is gone, so the stored list cannot grow without
   *  bound as sessions come and go. */
  function prunePins(data) {
    if (!pinned.size) {
      if (missingPins.size) missingPins = new Set();
      return;
    }
    const live = new Set();
    for (const wt of (data && data.worktrees) || []) {
      for (const a of wt.agents || []) live.add(a.sessionId);
    }
    const stillMissing = new Set();
    let dropped = false;
    for (const id of Array.from(pinned)) {
      if (live.has(id)) continue;
      if (missingPins.has(id)) {
        pinned.delete(id);
        dropped = true;
      } else {
        stillMissing.add(id);
      }
    }
    missingPins = stillMissing;
    if (dropped) persist();
  }

  // Minimal attribute-selector escaping for paths in querySelector.
  function cssEscape(s) {
    return String(s).replace(/["\\]/g, "\\$&");
  }

  // --- Card overflow menu ----------------------------------------------------
  // The rarely-reached actions behind a caret: per worktree in a card header,
  // per group in a section header. Mounted on document.body rather than inside
  // the list: `.cards` is the scroll region and both headers are sticky, so a
  // menu positioned inside one is clipped by the first and stacked under the
  // second. On the body it is also untouched by a data re-render, which the
  // skills modal needs for the same reason.
  //
  // One element and one owner for both kinds of menu. Two of them would have
  // meant two of everything that shuts one - the outside click, the scroll, the
  // resize, Escape, a re-render - and the only thing that actually differs
  // between them is which items they hold. The owner is a key rather than a
  // path so the button to un-expand can be found either way.
  let cardMenuEl = null;
  let cardMenuKey = "";
  /** The panel control the open menu hangs off, which is the key itself except
   *  for a menu opened from another menu (see mountMenu). */
  let cardMenuAnchor = "";

  /**
   * Shut the open menu. `restoreFocus` hands focus back to the caret that
   * opened it, which is what a menu owes a keyboard user: the menu is mounted on
   * <body>, so removing it while focus is inside drops focus to <body> and the
   * next Tab starts again from the top of the panel. Not done when the paint
   * that closed it is about to move focus itself, or when the close is a click
   * somewhere else entirely (which has its own focus target).
   */
  function closeCardMenu(restoreFocus) {
    if (!cardMenuEl) return;
    const held = cardMenuEl.contains(document.activeElement);
    cardMenuEl.remove();
    cardMenuEl = null;
    const btn = root.querySelector(
      '[data-menu-key="' + cssEscape(cardMenuAnchor || cardMenuKey) + '"]'
    );
    if (btn) {
      btn.setAttribute("aria-expanded", "false");
      if (restoreFocus && held) btn.focus();
    }
    cardMenuKey = "";
    cardMenuAnchor = "";
  }

  /**
   * The keyboard model a `role="menu"` is supposed to come with.
   *
   * The menu had the role and the focus-on-open, and nothing else: no arrow
   * keys, and Tab walked straight out of a body-mounted element into whatever
   * followed it in the document, leaving the menu open behind. Up/Down wrap,
   * Home/End jump the ends, Tab is treated as "leave", and Escape is handled by
   * the panel-wide handler which now restores focus too.
   */
  function onMenuKey(e) {
    if (!cardMenuEl || !cardMenuEl.contains(e.target)) return;
    // The run buttons in the Run and Debug list are menu items too: they sit
    // beside a target's row rather than on their own line, but Down still has to
    // reach them or "start without debugging" would be pointer-only.
    const items = [
      ...cardMenuEl.querySelectorAll(".card-menu-item, .card-menu-run"),
    ];
    if (!items.length) return;
    const at = items.indexOf(document.activeElement);
    const go = (i) => {
      e.preventDefault();
      items[(i + items.length) % items.length].focus();
    };
    if (e.key === "ArrowDown") return go(at + 1);
    if (e.key === "ArrowUp") return go(at - 1);
    if (e.key === "Home") return go(0);
    if (e.key === "End") return go(items.length - 1);
    if (e.key === "Tab") {
      // A menu is a dead end for Tab: close it and put focus back on the caret,
      // so the next Tab continues from where the user actually is.
      e.preventDefault();
      closeCardMenu(true);
    }
  }
  document.addEventListener("keydown", onMenuKey);

  /**
   * Re-attach an open menu to the caret a repaint just rebuilt.
   *
   * A payload lands roughly every second while an agent is working, and each
   * one used to close whatever menu was open - so the menu holding Move to
   * group, Switch branch and Delete could vanish under the pointer within a
   * second of being opened, which on a busy repo made it unusable.
   *
   * The menu itself needs nothing: it is mounted on <body> at viewport
   * coordinates, so replacing the panel's markup underneath does not move it,
   * and focus inside it is untouched. Only two things have to be reconciled -
   * the new caret's `aria-expanded`, and the case where the thing the menu acts
   * on is no longer on screen at all (its worktree was removed while it was
   * open), where the menu is closed rather than left pointing at nothing.
   */
  function resyncOpenMenu() {
    if (!cardMenuEl || !cardMenuKey) return;
    const btn = root.querySelector(
      '[data-menu-key="' + cssEscape(cardMenuAnchor || cardMenuKey) + '"]'
    );
    if (!btn) return closeCardMenu();
    btn.setAttribute("aria-expanded", "true");
  }

  /**
   * One menu entry. Whatever the action needs back - the worktree path, the
   * group id, a direction - rides as a data attribute and is read off the item
   * on click, so the menu itself holds no state.
   *
   * `checked` (when given) makes the item a radio: that is what the move-to
   * list is, one of n and exactly one true.
   */
  function menuItem(action, glyph, label, opts) {
    const o = opts || {};
    const radio = typeof o.checked === "boolean";
    return (
      '<button class="card-menu-item' +
      (o.extra || "") +
      (o.checked ? " checked" : "") +
      '" role="' +
      (radio ? "menuitemradio" : "menuitem") +
      '"' +
      (radio ? ' aria-checked="' + (o.checked ? "true" : "false") + '"' : "") +
      ' data-action="' +
      action +
      '"' +
      (o.path ? ' data-path="' + esc(o.path) + '"' : "") +
      (o.group ? ' data-group="' + esc(o.group) + '"' : "") +
      (o.delta ? ' data-delta="' + o.delta + '"' : "") +
      '><span class="card-menu-ico">' +
      (glyph || "") +
      "</span>" +
      label +
      "</button>"
    );
  }

  /**
   * Put `items` on the body, anchored either to the caret that owns `key` or -
   * when `at` is given - to the pointer that right-clicked. Shuts the menu
   * instead when `key` is the one already showing: a menu button should toggle,
   * and a second right-click on the same thing means the same.
   *
   * The caret is found from `key` rather than passed in, so a right-click can
   * open the very same menu without having a button to hand.
   */
  function mountMenu(key, items, at, anchorKey) {
    const already = cardMenuKey === key && cardMenuEl;
    closeCardMenu();
    if (already) return;

    // Which control in the panel this menu belongs to, for aria-expanded, focus
    // restore and the repaint resync. Usually the caret that opened it, i.e. the
    // key itself - but a menu opened *from* another menu (Run and Debug's target
    // list) has no caret of its own and borrows the one its parent used, or a
    // payload landing a second later would find no button and shut it.
    cardMenuAnchor = anchorKey || key;
    const btn = root.querySelector(
      '[data-menu-key="' + cssEscape(cardMenuAnchor) + '"]'
    );
    cardMenuEl = document.createElement("div");
    cardMenuEl.className = "card-menu";
    cardMenuEl.setAttribute("role", "menu");
    cardMenuEl.innerHTML = items;
    document.body.appendChild(cardMenuEl);
    cardMenuKey = key;
    if (btn) btn.setAttribute("aria-expanded", "true");

    // Under the anchor, flipped above when there is not room below. Measured
    // after mounting, since the height depends on what is in the list (whether
    // Delete is there, how many groups exist).
    //
    // A pointer anchor is a zero-size box at the cursor, and opens to its right
    // the way a context menu should; a caret opens right-aligned under itself,
    // so the menu hangs inside the card rather than off its edge.
    const r = at
      ? { top: at.y, bottom: at.y, left: at.x, right: at.x, width: 0, height: 0 }
      : btn && btn.getBoundingClientRect();
    if (!r) return;
    const m = cardMenuEl.getBoundingClientRect();
    const gap = 4;
    const edge = 4;
    const roomBelow = window.innerHeight - r.bottom - gap - edge;
    const roomAbove = r.top - gap - edge;
    // The panel is often a short sidebar pane, so neither side has room for the
    // whole menu. Rather than let it run off the bottom with entries unreachable,
    // take the taller side and cap the menu to it - .card-menu scrolls.
    const flip = m.height > roomBelow && roomAbove > roomBelow;
    const room = Math.max(0, flip ? roomAbove : roomBelow);
    cardMenuEl.style.maxHeight = room + "px";
    const height = Math.min(m.height, room);
    cardMenuEl.style.top = (flip ? r.top - gap - height : r.bottom + gap) + "px";
    const left = at ? r.left : r.right - m.width;
    cardMenuEl.style.left =
      Math.max(edge, Math.min(left, window.innerWidth - m.width - edge)) + "px";
    const first = cardMenuEl.querySelector(".card-menu-item");
    if (first) first.focus();
  }

  function openCardMenu(path, at) {
    const wt = ((lastData && lastData.worktrees) || []).find(
      (w) => w.path === path
    );
    if (!wt) return;

    const item = (action, glyph, label, extra) =>
      menuItem(action, glyph, label, { path, extra });

    // The branch on GitHub stays an <a>: the webview opens http(s) links in the
    // browser itself, so routing it through the extension host would be a round
    // trip for nothing. Absent when there is no page to open - see
    // branchOnGitHub.
    const url = branchOnGitHub(wt);
    const ghItem = url
      ? '<a class="card-menu-item" role="menuitem" href="' +
        esc(url) +
        '" target="_blank" rel="noopener noreferrer"><span class="card-menu-ico">' +
        icons.github +
        "</span>View branch on GitHub</a>"
      : "";

    // Which section this card is in, and every other one it could go to. Inline
    // rather than behind a submenu or a quick pick: with a handful of groups it
    // is one click instead of three, and the menu already caps its height and
    // scrolls when there are more than fit.
    //
    // It leads the menu. Filing a worktree is the one action here you may do to
    // the same card repeatedly - everything below it you do to a worktree about
    // once in its life - so it takes the cheapest target in the list. With no
    // group but General there is nothing to choose between, and the entry
    // becomes the one that makes the first group.
    const groups = (lastData && lastData.groups) || [];
    const current = wt.group || "general";
    const groupItems = wt.isPrimary
      ? // The primary worktree is never filed, so there is nowhere to move it
        // to. It keeps the entry that makes a group, though: with no sections
        // drawn yet there is no section header to make one from, and a repo
        // whose only worktree is this one would otherwise have no way in.
        menuItem("createGroup", icons.group, "New group&hellip;", {})
      : groups.length > 1
      ? '<div class="card-menu-label">Move to group</div>' +
        groups
          .map((g) =>
            menuItem(
              "assignGroup",
              g.id === current ? icons.check : "",
              esc(g.name),
              { path, group: g.id, checked: g.id === current }
            )
          )
          .join("") +
        menuItem("createGroup", icons.add, "New group&hellip;", { path })
      : menuItem("createGroup", icons.group, "New group from here&hellip;", {
          path,
        });

    // Then four groups: what changes the worktree, what reaches into it, where
    // to open it, and the one thing that destroys it. Delete is also drawn in
    // the error colour - in a list of plain rows nothing else marks it out, and
    // the rule alone is easy to read past. The confirmation modal is still what
    // actually guards it.
    //
    // Debug is here only when the worktree has launch configurations, the same
    // condition its button carried; a menu entry that cannot do anything is
    // worse than an absent one, since you have to open the menu to find out.
    const items =
      groupItems +
      '<div class="card-menu-sep"></div>' +
      item("changeBranch", icons.edit, "Switch branch&hellip;") +
      item("refreshWorktree", icons.refresh, "Refresh") +
      '<div class="card-menu-sep"></div>' +
      item("searchWorktree", icons.search, "Search this worktree&hellip;") +
      item("findWorktreeFile", icons.fileSearch, "Find file&hellip;") +
      ((wt.debugTargets || []).length
        ? item("debugMenu", icons.debug, "Run and Debug&hellip;")
        : "") +
      '<div class="card-menu-sep"></div>' +
      item("openWindow", icons.window, "Open in new window") +
      ghItem +
      (wt.isPrimary
        ? ""
        : '<div class="card-menu-sep"></div>' +
          item("removeWorktree", icons.trash, "Delete worktree&hellip;", " danger"));

    mountMenu("card:" + path, items, at);
  }

  /**
   * The worktree's launch targets, as a menu in place of the quick pick.
   *
   * `showQuickPick` paints at the top centre of the *window*, which for a
   * control in a sidebar card is nowhere near where it was pressed: you click at
   * the bottom-left of the screen and the list you have to read appears at the
   * top-middle of it. Every other per-worktree action on this card is already a
   * menu at the pointer, so the picker was the one thing that threw the eye
   * across the window, and the list it showed was usually two or three entries.
   *
   * It opens over the menu it came from rather than beside it. A cascading
   * submenu needs somewhere to cascade *to*, and a sidebar is a narrow column
   * with no room on either side; replacing the parent keeps the whole thing
   * where the pointer already is. Escape shuts it, as it shuts any menu.
   *
   * Rows carry the target's **name**, not its index: the host re-reads
   * launch.json before it starts anything, so a file edited since this list was
   * drawn resolves to the right configuration or to none, never to whatever now
   * sits at that position.
   */
  function openDebugMenu(path, at) {
    const wt = ((lastData && lastData.worktrees) || []).find(
      (w) => w.path === path
    );
    const targets = (wt && wt.debugTargets) || [];
    if (!targets.length) return;

    const rows = targets
      .map((t) => {
        // A compound says how many sessions it starts; a single configuration
        // says its debug type. Both are the quick pick's own description, kept
        // so the two lists read the same to anyone who used the old one.
        const detail =
          t.kind === "compound"
            ? t.count + " config" + (t.count === 1 ? "" : "s")
            : t.type || "";
        return (
          '<div class="card-menu-row">' +
          '<button class="card-menu-item" role="menuitem" data-action="debugWorktree"' +
          ' data-path="' +
          esc(path) +
          '" data-debug-target="' +
          esc(t.name) +
          '" title="Start ' +
          esc(t.name) +
          ' with the debugger">' +
          // One glyph for every row: they are all launch targets, and the
          // detail on the right is what says a compound is one. A second glyph
          // here would be a distinction to learn for the one thing the text
          // already states.
          '<span class="card-menu-ico">' +
          icons.debug +
          "</span>" +
          '<span class="card-menu-name">' +
          esc(t.name) +
          "</span>" +
          (detail
            ? '<span class="card-menu-detail">' + esc(detail) + "</span>"
            : "") +
          "</button>" +
          // The quick pick carried this as a per-item button with the same
          // tooltip; it stays a separate control for the same reason it was one
          // there - it is a different way to start the same target, not a
          // different target.
          '<button class="card-menu-run" data-action="debugWorktree" data-path="' +
          esc(path) +
          '" data-debug-target="' +
          esc(t.name) +
          '" data-no-debug="1" aria-label="Start ' +
          esc(t.name) +
          // `title`, not `data-tip`: the panel's own tooltip is delegated from
          // `root` and this menu is mounted on <body>, so a data-tip here would
          // never fire.
          '" title="Start without debugging">' +
          icons.play +
          "</button>" +
          "</div>"
        );
      })
      .join("");

    mountMenu(
      "debug:" + path,
      '<div class="card-menu-label">Run and Debug</div>' + rows,
      at,
      "card:" + path
    );
  }

  /**
   * The actions on one section header. Move up and down are always here, even  /**
   * The actions on one section header. Move up and down are always here, even
   * on the first and last group where they do nothing: the host no-ops an out
   * of range move, and a menu whose entries shift position depending on which
   * group you opened it on is worse than one with a dead entry in it.
   *
   * Delete is absent on General, which cannot be removed - it is where an
   * unfiled worktree lives and where a deleted group's members land.
   */
  function openGroupMenu(groupId, at) {
    const groups = (lastData && lastData.groups) || [];
    if (!groups.some((g) => g.id === groupId)) return;
    const item = (action, glyph, label, opts) =>
      menuItem(action, glyph, label, Object.assign({ group: groupId }, opts));

    // General is the default, not a group the user made: it is where an unfiled
    // worktree lives and where a deleted group's members land, so it can be
    // moved but neither renamed nor removed. Both entries are absent rather than
    // disabled - there is nothing to explain, and a menu of two live entries
    // reads better than one of four with two dead.
    const fixed = groupId === "general";
    const items =
      (fixed ? "" : item("renameGroup", icons.edit, "Rename")) +
      item("moveGroup", icons.arrowUp, "Move up", { delta: -1 }) +
      item("moveGroup", icons.arrowDown, "Move down", { delta: 1 }) +
      '<div class="card-menu-sep"></div>' +
      menuItem("createGroup", icons.add, "New group&hellip;", {}) +
      (fixed
        ? ""
        : '<div class="card-menu-sep"></div>' +
          item("deleteGroup", icons.trash, "Delete group&hellip;", {
            extra: " danger",
          }));

    mountMenu("group:" + groupId, items, at);
  }

  // --- Skills modal ----------------------------------------------------------
  // Lives on document.body, not inside #root, so a data re-render never wipes it.
  let modalEl = null;

  function findAgent(sessionId) {
    const wts = (lastData && lastData.worktrees) || [];
    for (const w of wts) {
      for (const a of w.agents || []) {
        if (a.sessionId === sessionId) return a;
      }
    }
    return null;
  }

  /** What had focus before the modal opened, so it can be handed back. */
  let modalReturnFocus = null;

  function closeModal() {
    if (modalEl) {
      modalEl.remove();
      modalEl = null;
    }
    // Back to the chip that opened it. Without this, dismissing the dialog left
    // focus on <body> and a keyboard user restarted from the top of the panel.
    const back = modalReturnFocus;
    modalReturnFocus = null;
    if (back && back.isConnected && typeof back.focus === "function") {
      back.focus();
    }
  }

  /**
   * Hold Tab inside an open dialog.
   *
   * `aria-modal` tells assistive technology the rest is inert; it does nothing
   * about Tab, which happily walked out of the dialog and on through the panel
   * behind it while the backdrop still covered everything. Wraps at both ends,
   * and Escape closes (which the panel-wide handler also does, but a dialog
   * should not depend on that being reached first).
   */
  function onModalKey(e) {
    if (!modalEl) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      return closeModal();
    }
    if (e.key !== "Tab") return;
    const focusable = [
      ...modalEl.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ),
    ].filter((el) => !el.disabled && el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const on = document.activeElement;
    if (e.shiftKey && (on === first || !modalEl.contains(on))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (on === last || !modalEl.contains(on))) {
      e.preventDefault();
      first.focus();
    }
  }
  document.addEventListener("keydown", onModalKey, true);

  function openSkills(sessionId) {
    const a = findAgent(sessionId);
    if (!a) return;
    const skills = a.skills || [];
    const items = skills.length
      ? skills
          .map(
            (s) =>
              '<li class="skill-item"><span class="skill-bullet">' +
              icons.skill +
              "</span>" +
              esc(s) +
              "</li>"
          )
          .join("")
      : '<li class="skill-empty">No skills used yet.</li>';
    closeModal();
    // Captured before the dialog exists, so closeModal can hand focus back to
    // the skill chip that opened it.
    modalReturnFocus =
      document.activeElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    modalEl = document.createElement("div");
    modalEl.className = "modal-backdrop";
    modalEl.innerHTML =
      // aria-labelledby, so the dialog announces as "Skills, <agent>" rather
      // than as an unnamed dialog.
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="skills-title">' +
      '<div class="modal-head">' +
      '<span class="modal-title" id="skills-title">Skills · ' +
      esc(a.label) +
      "</span>" +
      // aria-label, not title: the glyph is an X and the accessible name was
      // coming from a tooltip attribute that screen readers treat as optional.
      '<button class="iconbtn modal-close" aria-label="Close" data-tip="Close">' +
      icons.stop +
      "</button>" +
      "</div>" +
      '<ul class="skill-list">' +
      items +
      "</ul>" +
      "</div>";
    modalEl.addEventListener("click", (ev) => {
      if (ev.target === modalEl || ev.target.closest(".modal-close")) {
        closeModal();
      }
    });
    document.body.appendChild(modalEl);
    // Into the dialog, so the next Tab is inside it and Escape is heard.
    const close = modalEl.querySelector(".modal-close");
    if (close) close.focus();
  }

  // --- Settings modal --------------------------------------------------------
  // Holds the GitHub PR-status integration controls. Like the skills modal it
  // lives on document.body so a data re-render never wipes it; it only re-renders
  // itself when the GitHub connection (not the worktree data) changes, so typing
  // a token is never interrupted by a routine refresh.
  let settingsOpen = false;
  let settingsTab = "github";
  // The tab rail, folded down to its icons. A sidebar is narrow enough that the
  // labelled rail can take a third of the width, and the settings bodies are
  // text; folding it gives that back without moving the tabs somewhere else.
  // Persisted like the expand state, so the choice survives a reload.
  let settingsNavCollapsed = savedState.settingsNavCollapsed === true;
  let lastGhSig = "";
  // Once a token is connected, the token input and its how-to text are hidden
  // behind a "Replace token" toggle; this tracks whether that form is open.
  let ghTokenFormOpen = false;

  function ghSig(data) {
    return JSON.stringify([
      (data && data.github) || null,
      (data && data.prEnabled) !== false,
      (data && data.scmEnabled) === true,
      (data && data.traceEnabled) === true,
      (data && data.linkedPaths) || [],
      // The Performance tab's state arrives after the tab asks for it, so it has
      // to be part of the signature or the section would sit on "Checking…".
      (data && data.gitPerf) || null,
      // Preferences: without this the confirming push after a reorder would be
      // dropped as unchanged, leaving the tab showing the optimistic order with
      // nothing to correct it if the write failed.
      statusOrder(data),
    ]);
  }

  // The settings tabs. Each renders its own body section; `settingsTab` tracks
  // which one is shown.
  const SETTINGS_TABS = [
    {
      id: "preferences",
      icon: "gear",
      label: "Preferences",
      section: preferencesSection,
    },
    { id: "github", icon: "pr", label: "GitHub", section: githubSection },
    {
      id: "integrations",
      icon: "branch",
      label: "Source Control",
      section: integrationsSection,
    },
    { id: "linked", icon: "link", label: "Linked Files", section: linkedSection },
    {
      id: "performance",
      icon: "zap",
      label: "Performance",
      section: performanceSection,
    },
    { id: "debug", icon: "bug", label: "Debug", section: debugSection },
  ];

  // What each status means, in the words the marketplace listing uses, so the
  // rows being reordered say what they are ordering rather than assuming the
  // three names are self-explanatory.
  const STATUS_DETAIL = {
    waiting: "Needs you: a permission prompt or a question",
    active: "Processing a prompt, or running a tool or shell command",
    idle: "Started, or finished responding and awaiting you",
  };

  /**
   * Settings → Preferences: how the panel presents what it already knows.
   *
   * Today that is one thing, the order the agents view groups its rows in. Up and
   * down buttons rather than drag and drop: there are three rows, the whole list
   * is on screen, and a keyboard can reach every move. The buttons at the ends
   * are disabled rather than hidden, so the column of controls does not change
   * shape as rows move through it.
   */
  function preferencesSection(data) {
    const order = statusOrder(data);
    const isDefault = order.join() === DEFAULT_STATUS_ORDER.join();
    const move = (status, delta, label, disabled) =>
      '<button class="iconbtn order-move" data-order-status="' +
      status +
      '" data-order-delta="' +
      delta +
      '"' +
      (disabled ? " disabled" : "") +
      ' aria-label="' +
      esc(label) +
      '" data-tip="' +
      esc(label) +
      '">' +
      (delta < 0 ? icons.arrowUp : icons.arrowDown) +
      "</button>";

    const rows = order
      .map((s, i) => {
        const label = STATUS[s].label;
        return (
          '<li class="order-row">' +
          '<span class="order-rank">' +
          (i + 1) +
          "</span>" +
          '<span class="order-main">' +
          '<span class="order-name"><span class="status-dot ' +
          s +
          '"></span>' +
          label +
          "</span>" +
          '<span class="order-detail dim">' +
          STATUS_DETAIL[s] +
          "</span>" +
          "</span>" +
          '<span class="order-moves">' +
          move(s, -1, "Move " + label + " up", i === 0) +
          move(s, 1, "Move " + label + " down", i === order.length - 1) +
          "</span>" +
          "</li>"
        );
      })
      .join("");

    return (
      '<section class="gh-section">' +
      '<h3 class="gh-h">' +
      icons.gear +
      " Preferences</h3>" +
      '<p class="gh-lead">The agents view lists every agent in the repository at ' +
      "once, grouped by status. This is the order those groups come in, so the " +
      "status you most want to see first is at the top.</p>" +
      '<ol class="order-list">' +
      rows +
      "</ol>" +
      '<div class="order-actions">' +
      '<button data-action="resetAgentStatusOrder"' +
      (isDefault ? " disabled" : "") +
      ">Reset to default</button>" +
      "</div>" +
      '<p class="gh-help dim">Within a group the rows keep the order the ' +
      "worktree cards are in, so an agent moves only when its own status " +
      "changes. An agent you pin in that view sits above the groups entirely. " +
      "Stored as <code>agentWorktrees.agentStatusOrder</code> and " +
      "applies to every repository; the worktree cards are unaffected, since " +
      "there each agent is already on the card for the code it is working on.</p>" +
      "</section>"
    );
  }

  function githubSection(data) {
    const gh = (data && data.github) || { hasToken: false, connected: false };
    const prEnabled = !data || data.prEnabled !== false;

    let status;
    if (!gh.hasToken) {
      status =
        '<div class="gh-status none">Not connected. Add a personal access token to show PR status per branch.</div>';
    } else if (gh.connected) {
      status =
        '<div class="gh-status ok"><span class="status-dot active"></span>Connected' +
        (gh.login ? " as <b>" + esc(gh.login) + "</b>" : "") +
        (gh.tokenType
          ? ' <span class="gh-type">' + esc(gh.tokenType) + " token</span>"
          : "") +
        "</div>";
    } else {
      status =
        '<div class="gh-status err"><span class="status-dot waiting"></span>' +
        esc(gh.error || "Token saved but not validated.") +
        "</div>";
    }

    // With a token stored, the entry form collapses behind "Replace token" and
    // the account actions sit right under the connection status they act on.
    const showForm = !gh.hasToken || ghTokenFormOpen;
    const accountActions = gh.hasToken
      ? '<div class="gh-actions">' +
        '<button data-gh="replaceToken">' +
        (showForm ? "Cancel" : "Replace token") +
        "</button>" +
        '<button class="gh-disconnect" data-gh="disconnect">Disconnect</button>' +
        "</div>"
      : "";

    const tokenField =
      '<div class="gh-field">' +
      '<input type="password" id="gh-token" placeholder="ghp_… or github_pat_…" autocomplete="off" spellcheck="false" />' +
      '<button class="primary" data-gh="save">Save</button>' +
      "</div>";

    // Fine-grained PAT template URL (GitHub supports prefilling the token name
    // and per-resource permissions via query params). We request read-only on
    // exactly what the PR rollups touch: pull requests + reviews, commit
    // statuses, check runs, and repo contents. (Metadata: read is mandatory and
    // added by GitHub automatically.)
    const fgUrl =
      "https://github.com/settings/personal-access-tokens/new" +
      "?name=Agent+Worktrees" +
      "&description=Read-only+PR+status+for+the+Agent+Worktrees+extension" +
      "&contents=read&pull_requests=read&statuses=read&checks=read";
    // Classic PAT: the `repo` scope covers PR/status/check reads on private repos.
    const classicUrl =
      "https://github.com/settings/tokens/new?scopes=repo&description=Agent+Worktrees";

    const links =
      '<p class="gh-help">Generate a read-only token (permissions pre-filled): ' +
      '<a href="' +
      fgUrl +
      '">Fine-grained</a> · ' +
      '<a href="' +
      classicUrl +
      '">Classic</a></p>' +
      '<div class="gh-perms">' +
      '<div class="gh-perms-h">Fine-grained, Repository permissions (Read):</div>' +
      "<ul>" +
      "<li>Pull requests</li>" +
      "<li>Checks</li>" +
      '<li>Commit statuses <span class="dim">optional, for legacy CI status</span></li>' +
      "<li>Contents</li>" +
      '<li>Metadata <span class="dim">required, added automatically</span></li>' +
      "</ul>" +
      '<div class="gh-perms-h">Classic, scope: <code>repo</code></div>' +
      "</div>" +
      '<p class="gh-help dim">Choose the repositories you want under “Repository access”. ' +
      "The token is kept in VS Code Secret Storage and is only ever sent to the GitHub API.</p>";

    const toggle =
      '<label class="gh-toggle">' +
      '<span class="gh-toggle-label">Show PR status on worktrees</span>' +
      '<input type="checkbox" id="gh-enable" class="switch-input"' +
      (prEnabled ? " checked" : "") +
      ' role="switch" aria-label="Show PR status on worktrees" />' +
      '<span class="switch" aria-hidden="true"></span>' +
      "</label>";

    return (
      '<section class="gh-section">' +
      '<h3 class="gh-h">' +
      icons.pr +
      " GitHub PR status</h3>" +
      '<p class="gh-lead">Tie GitHub into the panel to see each branch’s open PR: ' +
      "state, CI checks, review status and comments, refreshed as your agents work.</p>" +
      toggle +
      status +
      accountActions +
      (showForm ? tokenField + links : "") +
      "</section>"
    );
  }

  function integrationsSection(data) {
    const scmEnabled = !!(data && data.scmEnabled);
    const toggle =
      '<label class="gh-toggle">' +
      '<span class="gh-toggle-label">Source Control scope button</span>' +
      '<input type="checkbox" id="scm-enable" class="switch-input"' +
      (scmEnabled ? " checked" : "") +
      ' role="switch" aria-label="Show the Source Control scope button on worktrees" />' +
      '<span class="switch" aria-hidden="true"></span>' +
      "</label>";

    return (
      '<section class="gh-section">' +
      '<h3 class="gh-h">' +
      icons.branch +
      " Source Control</h3>" +
      '<p class="gh-lead">Add a button to each worktree that scopes the built-in ' +
      "Source Control view to that worktree, so you only see its diffs.</p>" +
      toggle +
      '<p class="gh-help dim">When a single repository is open, choosing a worktree ' +
      "swaps it into Source Control. The previous repo is removed from the view, " +
      "not from disk. When several are open, it reveals and focuses the selected one.</p>" +
      "</section>"
    );
  }

  function linkedSection(data) {
    const paths = (data && data.linkedPaths) || [];
    const list = paths.length
      ? '<ul class="linked-list">' +
        paths
          .map(
            (p) =>
              '<li class="linked-item">' +
              '<span class="linked-path" title="' +
              esc(p) +
              '">' +
              icons.link +
              "<code>" +
              esc(p) +
              "</code></span>" +
              '<button class="linked-remove" data-link-remove="' +
              esc(p) +
              '" title="Remove ' +
              esc(p) +
              '" aria-label="Remove ' +
              esc(p) +
              '">' +
              icons.cross +
              "</button>" +
              "</li>"
          )
          .join("") +
        "</ul>"
      : '<p class="gh-help dim linked-empty">No linked files yet. Add a repo-relative ' +
        "path below (for example <code>tests/appsettings.local.json</code>).</p>";

    // Browse opens the host's native file picker rooted at the repo; the text
    // field stays for typing a path directly (and is the way to add a folder on
    // platforms whose dialog can't offer files and folders at once).
    const field =
      '<div class="gh-field linked-field">' +
      '<input type="text" id="linked-input" placeholder="tests/appsettings.local.json" autocomplete="off" spellcheck="false" />' +
      '<button class="linked-browse" data-action="browseLinkedPath" title="Choose files to link" aria-label="Choose files to link">' +
      icons.folderOpen +
      "</button>" +
      '<button class="primary" data-link-add>Add</button>' +
      "</div>";

    // The files this feature exists for are gitignored almost by definition, so
    // offering the ignore list is usually the fastest way to find them.
    const fromIgnore =
      '<button data-action="pickIgnoredPaths">' +
      icons.ignored +
      "Add from .gitignore</button>";

    const relink = paths.length
      ? '<button data-action="relinkWorktrees">Link existing worktrees</button>'
      : "";

    const actions =
      '<div class="linked-actions">' + fromIgnore + relink + "</div>";

    return (
      '<section class="gh-section">' +
      '<h3 class="gh-h">' +
      icons.link +
      " Linked files</h3>" +
      '<p class="gh-lead">Symlink gitignored local files into every worktree this ' +
      "panel creates, so builds and integration tests that need them (an " +
      "<code>appsettings</code>, a <code>.env</code>, a certs folder) work in a " +
      "fresh worktree the same as in your main checkout.</p>" +
      list +
      field +
      actions +
      '<p class="gh-help dim">Add from .gitignore lists every file git ignores so ' +
      "you can tick the ones you need. You can also type a path or use the folder " +
      "button to pick files. Paths are relative to the repository root and point " +
      "back at your main worktree's copy, so edits stay in sync. A real file " +
      "already present in a worktree is never overwritten. New worktrees are " +
      'linked automatically; "Link existing worktrees" applies the list to the ' +
      "ones you already have.</p>" +
      "</section>"
    );
  }

  /**
   * One accelerator, as a switch with its state explained underneath.
   *
   * `locked` is a reason string when the switch cannot be moved (an old git, a
   * platform git has no monitor for, a filesystem that failed git's check, or a
   * monitor the user runs themselves). A locked switch is disabled rather than
   * hidden: "why is this off" is the question the row exists to answer.
   */
  function perfRow(key, label, on, detail, locked) {
    return (
      '<li class="perf-row' +
      (on ? " on" : "") +
      (locked ? " locked" : "") +
      '">' +
      '<label class="perf-toggle">' +
      '<span class="perf-name">' +
      label +
      "</span>" +
      '<input type="checkbox" class="switch-input" data-perf="' +
      key +
      '"' +
      (on ? " checked" : "") +
      (locked ? " disabled" : "") +
      ' role="switch" aria-label="' +
      esc(label) +
      '" />' +
      '<span class="switch" aria-hidden="true"></span>' +
      "</label>" +
      '<span class="perf-detail dim">' +
      (locked || detail) +
      "</span>" +
      "</li>"
    );
  }

  /**
   * The poll rate, as a row shaped like the accelerator rows above it.
   *
   * A fixed list rather than a free number: the useful range is small, and every
   * option here is a rate the extension will accept, so the control cannot ask
   * for one that gets clamped back underneath the user.
   */
  function pollRow(seconds) {
    const opts = [2, 5, 10, 30, 60]
      .map(
        (s) =>
          '<option value="' +
          s +
          '"' +
          (s === seconds ? " selected" : "") +
          ">" +
          (s === 60 ? "1 minute" : s + " seconds") +
          "</option>"
      )
      .join("");
    return (
      '<li class="perf-row">' +
      '<label class="perf-toggle">' +
      '<span class="perf-name">Recheck every</span>' +
      '<select id="poll-seconds" class="perf-select" aria-label="Status poll interval">' +
      opts +
      "</select>" +
      "</label>" +
      '<span class="perf-detail dim">' +
      "Applies to worktrees not open in Source Control; open ones refresh on " +
      "their own" +
      "</span>" +
      "</li>"
    );
  }

  function performanceSection(data) {
    const perf = data && data.gitPerf;
    if (!perf) {
      // The extension reads this on demand (it is git calls), so the first paint
      // of this tab is a loading line replaced by the payload that follows. With
      // no repository there is nothing to read and no payload will ever arrive,
      // so that must not read as "checking" forever.
      const noRepo = !(data && data.repoRoot);
      return (
        '<section class="gh-section">' +
        '<h3 class="gh-h">' +
        icons.zap +
        " Performance</h3>" +
        '<p class="gh-lead">' +
        (noRepo
          ? "These are per-repository git settings, and this workspace's first " +
            "folder is not in a git repository."
          : "Checking what this repository has enabled…") +
        "</p>" +
        "</section>"
      );
    }

    const cacheOn = perf.untrackedCache === true;
    const monitorOn = perf.fsmonitor !== false;
    const rows =
      '<ul class="perf-list">' +
      perfRow(
        "untrackedCache",
        "Untracked cache",
        cacheOn,
        cacheOn
          ? "git reuses each folder's result instead of re-reading it"
          : "git re-reads every folder to find new files",
        // Only blocked by the filesystem, and only for turning it ON: a cache
        // already in place can always be turned back off.
        !cacheOn && perf.untrackedCacheOk === false
          ? "Unavailable: this filesystem failed git's own check for it"
          : ""
      ) +
      perfRow(
        "fsmonitor",
        "Filesystem monitor",
        monitorOn,
        monitorOn
          ? "git asks its watcher what changed instead of looking"
          : "git walks the working tree on every status",
        perf.fsmonitor === "hook"
          ? "Your own monitor program is configured here, so the panel leaves " +
            "this alone"
          : monitorOn
          ? ""
          : perf.fsmonitorSupport === "old-git"
          ? "Unavailable: needs git 2.37 or newer"
          : perf.fsmonitorSupport === "platform"
          ? "Unavailable: git has no built-in monitor for this platform"
          : ""
      ) +
      pollRow(data.statusPollSeconds || 10) +
      "</ul>";

    const lead = perf.statusWasSlow
      ? "A <code>git status</code> in this window took over two seconds, which is " +
        "git walking your working tree. These two settings are its own fix."
      : "The panel runs <code>git status</code> to keep each card's counts current. " +
        "These two git settings let it skip work it has already done, which on a " +
        "large repository is the difference between an instant refresh and a slow one.";

    return (
      '<section class="gh-section">' +
      '<h3 class="gh-h">' +
      icons.zap +
      " Performance</h3>" +
      '<p class="gh-lead">' +
      lead +
      "</p>" +
      rows +
      '<p class="gh-help dim">The two switches write this repository\'s own git ' +
      "settings (<code>core.untrackedCache</code>, <code>core.fsmonitor</code>): " +
      "nothing global, nothing committed, and turning one off puts it back the way " +
      "it was. The same as <code>git config</code> in this repository, which is " +
      "still there if you prefer it. The interval is the panel's own setting " +
      "(<code>agentWorktrees.statusPollSeconds</code>) and applies to every " +
      "repository.</p>" +
      "</section>"
    );
  }

  function debugSection(data) {
    const traceEnabled = !!(data && data.traceEnabled);
    const toggle =
      '<label class="gh-toggle">' +
      '<span class="gh-toggle-label">Debug tracing</span>' +
      '<input type="checkbox" id="debug-trace" class="switch-input"' +
      (traceEnabled ? " checked" : "") +
      ' role="switch" aria-label="Enable debug tracing" />' +
      '<span class="switch" aria-hidden="true"></span>' +
      "</label>";

    return (
      '<section class="gh-section">' +
      '<h3 class="gh-h">' +
      icons.bug +
      " Debug</h3>" +
      '<p class="gh-lead">Trace git and GitHub activity to the “Agent Worktrees” ' +
      "output channel to diagnose why a view fails to load or a PR status is " +
      "missing.</p>" +
      toggle +
      '<p class="gh-help dim">When on, every git command and GitHub request is ' +
      "logged with timing. Leave it off for normal use.</p>" +
      '<button class="gh-disconnect" data-action="showLog">Open log</button>' +
      "</section>"
    );
  }

  function settingsContent(data) {
    const active = SETTINGS_TABS.find((t) => t.id === settingsTab)
      ? settingsTab
      : "github";
    const tabs = SETTINGS_TABS.map(
      (t) =>
        '<button class="settings-tab' +
        (t.id === active ? " active" : "") +
        '" role="tab" data-tab="' +
        t.id +
        '" aria-selected="' +
        (t.id === active) +
        // Folded to icons the label is gone, so the name has to be said
        // somewhere: data-tip is the panel's own tooltip, and aria-label keeps
        // the button named for a screen reader either way.
        '" aria-label="' +
        esc(t.label) +
        '"' +
        (settingsNavCollapsed ? ' data-tip="' + esc(t.label) + '"' : "") +
        ">" +
        icons[t.icon] +
        "<span>" +
        t.label +
        "</span></button>"
    ).join("");
    const body = (
      SETTINGS_TABS.find((t) => t.id === active) || SETTINGS_TABS[0]
    ).section(data);

    return (
      '<div class="settings-view">' +
      '<div class="settings-head">' +
      '<span class="settings-title">Settings</span>' +
      '<button class="tbtn ghost settings-close" data-action="closeSettings" title="Close settings">' +
      icons.cross +
      " Close</button>" +
      "</div>" +
      '<div class="settings-main">' +
      '<nav class="settings-tabs' +
      (settingsNavCollapsed ? " collapsed" : "") +
      '" role="tablist">' +
      tabs +
      // At the foot of the rail, away from the tabs it governs, so it is never
      // mistaken for one of them. It names what it will do, like the toolbar's
      // expand/collapse control, and the chevron turns to match.
      '<button class="settings-nav-fold" data-tool="settingsNav" data-tip="' +
      (settingsNavCollapsed ? "Show tab labels" : "Collapse to icons") +
      '" aria-label="' +
      (settingsNavCollapsed ? "Show tab labels" : "Collapse to icons") +
      '" aria-expanded="' +
      (settingsNavCollapsed ? "false" : "true") +
      '">' +
      icons.chevron +
      "<span>Collapse</span>" +
      "</button>" +
      "</nav>" +
      '<div class="settings-body">' +
      body +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function renderSettings() {
    if (!settingsOpen) return;
    root.innerHTML = settingsContent(lastData);
    lastGhSig = ghSig(lastData);
    const input = root.querySelector("#gh-token");
    if (input) {
      input.onkeydown = (e) => {
        if (e.key === "Enter") saveToken();
      };
    }
    const linkInput = root.querySelector("#linked-input");
    if (linkInput) {
      linkInput.onkeydown = (e) => {
        if (e.key === "Enter") addLinkedPath();
      };
    }
    // The Performance tab's state is git calls, so the extension reads it only
    // when asked. Requested here rather than on the tab click: `settingsTab`
    // survives closing Settings, so reopening straight onto this tab has to ask
    // too or the section sits on "Checking…" forever. The extension answers with
    // a payload, which re-renders this; if there is no repo to read it answers
    // nothing and no render follows, so this cannot spin.
    if (settingsTab === "performance" && !(lastData && lastData.gitPerf)) {
      send("loadGitPerf");
    }
  }

  /**
   * Move a status one place in the agents-view order and tell the extension,
   * which owns the setting.
   *
   * The row moves here first, on the cached payload, so the click lands
   * immediately rather than after a settings write round trip; the extension's
   * own push follows and is authoritative (it recomputes the move from the
   * stored value, so a failed write corrects this back).
   */
  function moveStatus(status, delta) {
    if (!lastData || (delta !== 1 && delta !== -1)) return;
    const order = statusOrder(lastData);
    const from = order.indexOf(status);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= order.length) return;
    order.splice(to, 0, order.splice(from, 1)[0]);
    lastData.agentStatusOrder = order;
    renderSettings();
    // The re-render replaced the button that was just pressed, which drops
    // focus to the body - so a keyboard user moving a row two places has to
    // tab back to it between presses. Put focus on the same control in the
    // rebuilt list, or on its opposite when the row landed at an end and the
    // one pressed is now disabled.
    const same =
      '[data-order-status="' + status + '"][data-order-delta="' + delta + '"]';
    const other =
      '[data-order-status="' + status + '"][data-order-delta="' + -delta + '"]';
    const btn = root.querySelector(same);
    const focus = btn && !btn.disabled ? btn : root.querySelector(other);
    if (focus) focus.focus();
    send("moveAgentStatus", { status, delta });
  }

  function addLinkedPath() {
    const input = root.querySelector("#linked-input");
    const value = input && input.value.trim();
    if (!value) return;
    send("addLinkedPath", { linkPath: value });
    input.value = "";
    input.focus();
  }

  function saveToken() {
    const input = root.querySelector("#gh-token");
    const token = input && input.value.trim();
    if (!token) return;
    send("setGithubToken", { token });
    ghTokenFormOpen = false;
    input.value = "";
    const btn = root.querySelector('[data-gh="save"]');
    if (btn) {
      btn.textContent = "Saving…";
      btn.disabled = true;
    }
  }

  function closeSettings() {
    if (!settingsOpen) return;
    settingsOpen = false;
    ghTokenFormOpen = false;
    render(lastData);
  }

  function openSettings() {
    closeModal(); // never stack a modal over the settings page
    settingsOpen = true;
    renderSettings();
  }

  /** Re-render the open settings page only when GitHub state changed. */
  function maybeRefreshSettings(data) {
    if (settingsOpen && ghSig(data) !== lastGhSig) renderSettings();
  }

  // --- Branches view ---------------------------------------------------------
  // Rendered only in the dedicated editor-tab webview (VIEW === "branches"),
  // where it fills the whole page. Lists every branch of the repo, its PR
  // rollup (via prLine), and a create-worktree action. All filtering/sorting is
  // client-side over the single BranchData payload the extension posts; no extra
  // network calls. The sidebar (VIEW === "panel") never renders this; its
  // "Branches" toolbar button just asks the extension to open this tab.
  let branchesLoading = false;
  let branchData = null;
  // Signature of the last branch payload we rendered, so an unchanged poll push
  // is dropped instead of rebuilding the DOM (and resetting scroll).
  let lastBranchSig = "";
  // Client-side pagination over the filtered branch list, so a repo with many
  // branches stays scannable. Reset to 0 whenever the filtered set changes.
  let branchPage = 0;
  const BRANCH_PAGE_SIZE = 25;
  // Tracks which filter/sort dropdown is open (webview-only UI state).
  let openMenu = "";

  // Single-select Sort. All git-based (branch tip-commit date / name), so they
  // work with or without a GitHub token — this is a git-first view.
  const SORT_OPTIONS = [
    { id: "recentlyUpdated", label: "Recently updated" },
    { id: "leastRecentlyUpdated", label: "Least recently updated" },
    { id: "name", label: "Name (A–Z)" },
  ];

  // Multi-select Location filter: where a branch lives. Ids match branchKind()
  // so a selection filters rows by the same tag they display. Empty = no filter.
  const LOCATION_OPTIONS = [
    { id: "local", label: "Local only" },
    { id: "both", label: "Local + remote" },
    { id: "remote-only", label: "Remote only" },
  ];

  // Single-select PR Status filter. The per-branch fetch is open-only, so the
  // only PR states a branch can carry are "open" and "draft"; "all" applies no
  // PR filter. Only shown when GitHub PR data is available (prAvailable).
  const PR_STATUS_OPTIONS = [
    { id: "all", label: "All" },
    { id: "open", label: "Open" },
    { id: "draft", label: "Draft" },
  ];

  // Single-select Reviewer filter. "all" applies no filter; "requested" keeps
  // only branches whose PR has a review requested from the signed-in user, i.e.
  // the PRs they still have to review. Only shown when GitHub PR data is
  // available.
  const REVIEWER_OPTIONS = [
    { id: "all", label: "All" },
    { id: "requested", label: "Review requested" },
  ];

  /** True when the GitHub integration is connected and PR display is enabled.
   *  Gates only whether a branch's open PR is shown, never the branch list. */
  function prAvailable(data) {
    const gh = data && data.github;
    return !!(gh && gh.connected && data.prEnabled !== false);
  }

  function timeVal(s) {
    const t = s ? Date.parse(s) : NaN;
    return isNaN(t) ? 0 : t;
  }

  // Compact relative time ("just now", "5m", "3h", "4d", "2w", "5mo", "1y") for a
  // branch's last-updated commit date. Empty string when the date is missing.
  function relTime(s) {
    const t = timeVal(s);
    if (!t) return "";
    const sec = Math.max(0, (Date.now() - t) / 1000);
    if (sec < 45) return "just now";
    const min = sec / 60;
    if (min < 60) return Math.round(min) + "m ago";
    const hr = min / 60;
    if (hr < 24) return Math.round(hr) + "h ago";
    const day = hr / 24;
    if (day < 7) return Math.round(day) + "d ago";
    if (day < 30) return Math.round(day / 7) + "w ago";
    if (day < 365) return Math.round(day / 30) + "mo ago";
    return Math.round(day / 365) + "y ago";
  }

  // "Last refreshed" label for the GitHub PR data. The branches view fetches on
  // open (when a token is connected) and on each Fetch Open PRs click; this reads
  // "Never" only until that first on-open fetch lands.
  function lastRefreshedText(data) {
    const t = data && data.lastGithubRefresh;
    if (!t) return "Never";
    return new Date(t).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  /** Whether a branch's PR matches the active PR Status filter. "all" matches
   *  everything; "open"/"draft" match a branch carrying a PR in that exact state.
   *  The fetch is open-only, so any attached PR is open or draft. */
  function matchesPrStatus(b, status) {
    if (status === "all") return true;
    return !!(b && b.pr && b.pr.state === status);
  }

  /** Whether a branch's PR matches the active Reviewer filter. "all" matches
   *  everything; "requested" matches a branch whose PR has a review requested
   *  from the signed-in user, i.e. the PRs they still have to review. */
  function matchesReviewer(b, sel) {
    if (sel === "all") return true;
    return !!(b && b.pr && b.pr.reviewRequestedFromViewer);
  }

  /** Apply the active user + PR-status filters and sort to the branch list,
   *  client-side. Sorting and the user filter are git-based; the PR-status filter
   *  is the only one that consults GitHub data and is gated by prAvailable. */
  function visibleBranches(data) {
    const all = (data && data.branches) || [];
    const sortOpt =
      SORT_OPTIONS.find((s) => s.id === branchFilters.sort) || SORT_OPTIONS[0];
    const userSet = new Set(branchFilters.users);

    let rows = all.slice();

    // Filter to branches last updated by the selected user(s). A branch with no
    // known committer is dropped only while a filter is active.
    if (userSet.size) {
      rows = rows.filter((b) => b.lastUser && userSet.has(b.lastUser));
    }

    // Location filter: keep branches whose locality tag (local only /
    // local + remote / remote only) is among the selected ones.
    const locSet = new Set(branchFilters.locations);
    if (locSet.size) {
      rows = rows.filter((b) => locSet.has(branchKind(b)));
    }

    // PR-status filter: only honored when PR data is actually available, so a
    // stale selection can never hide every branch when the integration is off.
    if (branchFilters.prStatus !== "all" && prAvailable(data)) {
      rows = rows.filter((b) => matchesPrStatus(b, branchFilters.prStatus));
    }

    // Reviewer filter: same gating as PR status — only consulted when PR data is
    // available, so a stale selection can never empty the list when GitHub is off.
    if (branchFilters.reviewer !== "all" && prAvailable(data)) {
      rows = rows.filter((b) => matchesReviewer(b, branchFilters.reviewer));
    }

    const byName = (a, b) =>
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    rows.sort((a, b) => {
      if (sortOpt.id === "name") return byName(a, b);
      const ta = timeVal(a.updatedAt);
      const tb = timeVal(b.updatedAt);
      // Branches with no date sort to the end, then tie-break by name.
      if (ta !== tb) {
        if (!ta) return 1;
        if (!tb) return -1;
        return sortOpt.id === "leastRecentlyUpdated" ? ta - tb : tb - ta;
      }
      return byName(a, b);
    });
    return rows;
  }

  /** Distinct branch committers ("who last updated it"), the current user pinned
   *  first when known, then alphabetical. Derived from git, not GitHub. */
  function userOptions(data) {
    const viewer = (data && data.viewerLogin) || "";
    const seen = new Set();
    const out = [];
    for (const b of (data && data.branches) || []) {
      const u = b.lastUser;
      if (u && !seen.has(u)) {
        seen.add(u);
        out.push(u);
      }
    }
    out.sort((a, b) => a.localeCompare(b));
    if (viewer && seen.has(viewer)) {
      return [viewer].concat(out.filter((u) => u !== viewer));
    }
    return out;
  }

  function menu(id, label, summary, items) {
    const open = openMenu === id;
    return (
      '<div class="bfilter' +
      (open ? " open" : "") +
      '" data-menu="' +
      id +
      '">' +
      '<button class="bfilter-btn" data-menu-toggle="' +
      id +
      '" aria-expanded="' +
      open +
      '"><span class="bfilter-label">' +
      esc(label) +
      "</span><span class=\"bfilter-summary\">" +
      esc(summary) +
      "</span>" +
      '<span class="bfilter-caret">' +
      icons.chevron +
      "</span></button>" +
      (open ? '<div class="bfilter-menu" role="menu">' + items + "</div>" : "") +
      "</div>"
    );
  }

  function filterBar(data) {
    const sortOpt =
      SORT_OPTIONS.find((s) => s.id === branchFilters.sort) || SORT_OPTIONS[0];

    const viewer = (data && data.viewerLogin) || "";
    const users = userOptions(data);
    const selected = new Set(branchFilters.users);
    const userItems = users.length
      ? users
          .map(
            (u) =>
              '<button class="bfilter-item" role="menuitemcheckbox" data-user="' +
              esc(u) +
              '" aria-checked="' +
              selected.has(u) +
              '"><span class="bcheck">' +
              (selected.has(u) ? icons.check : "") +
              "</span>" +
              esc(u) +
              (u === viewer ? ' <span class="bdim">(you)</span>' : "") +
              "</button>"
          )
          .join("")
      : '<div class="bfilter-empty">No branch authors</div>';
    const userSummary = branchFilters.users.length
      ? branchFilters.users.length + " selected"
      : "Anyone";
    const controls = menu("user", "Updated by", userSummary, userItems);

    // Location multi-select, mirroring Updated by: toggling an entry keeps the
    // menu open, empty selection means no filter.
    const locSelected = new Set(branchFilters.locations);
    const locItems = LOCATION_OPTIONS.map(
      (o) =>
        '<button class="bfilter-item" role="menuitemcheckbox" data-loc="' +
        o.id +
        '" aria-checked="' +
        locSelected.has(o.id) +
        '"><span class="bcheck">' +
        (locSelected.has(o.id) ? icons.check : "") +
        "</span>" +
        esc(o.label) +
        "</button>"
    ).join("");
    const locSummary =
      branchFilters.locations.length === 1
        ? LOCATION_OPTIONS.find((o) => o.id === branchFilters.locations[0])
            .label
        : branchFilters.locations.length
        ? branchFilters.locations.length + " selected"
        : "All";
    const locationMenu = menu("location", "Location", locSummary, locItems);

    const sortItems = SORT_OPTIONS.map(
      (s) =>
        '<button class="bfilter-item" role="menuitemradio" data-sort="' +
        s.id +
        '" aria-checked="' +
        (branchFilters.sort === s.id) +
        '"><span class="bcheck">' +
        (branchFilters.sort === s.id ? icons.check : "") +
        "</span>" +
        esc(s.label) +
        "</button>"
    ).join("");

    // PR Status single-select: only shown when GitHub PR data is available (no
    // point offering it when no PRs can be matched). Narrows the list by PR
    // state — All / Open / Draft.
    const prStatusOpt =
      PR_STATUS_OPTIONS.find((s) => s.id === branchFilters.prStatus) ||
      PR_STATUS_OPTIONS[0];
    const prStatusItems = PR_STATUS_OPTIONS.map(
      (s) =>
        '<button class="bfilter-item" role="menuitemradio" data-prstatus="' +
        s.id +
        '" aria-checked="' +
        (branchFilters.prStatus === s.id) +
        '"><span class="bcheck">' +
        (branchFilters.prStatus === s.id ? icons.check : "") +
        "</span>" +
        esc(s.label) +
        "</button>"
    ).join("");
    const prStatusMenu = prAvailable(data)
      ? menu("prStatus", "PR Status", prStatusOpt.label, prStatusItems)
      : "";

    // Reviewer single-select: same gating as PR Status (only shown with GitHub
    // PR data). Narrows to branches whose PR has a review requested — All /
    // Review requested.
    const reviewerOpt =
      REVIEWER_OPTIONS.find((s) => s.id === branchFilters.reviewer) ||
      REVIEWER_OPTIONS[0];
    const reviewerItems = REVIEWER_OPTIONS.map(
      (s) =>
        '<button class="bfilter-item" role="menuitemradio" data-reviewer="' +
        s.id +
        '" aria-checked="' +
        (branchFilters.reviewer === s.id) +
        '"><span class="bcheck">' +
        (branchFilters.reviewer === s.id ? icons.check : "") +
        "</span>" +
        esc(s.label) +
        "</button>"
    ).join("");
    const reviewerMenu = prAvailable(data)
      ? menu("reviewer", "Reviewer", reviewerOpt.label, reviewerItems)
      : "";

    // Clear Filters: resets the author + PR Status + Reviewer filters (Sort is an
    // ordering, not a filter, so it is left alone). Disabled when nothing is
    // filtering — the PR-aware parts only count when PR data is actually
    // available, mirroring visibleBranches so the button is live exactly when the
    // list is narrowed.
    const filterApplied =
      branchFilters.users.length > 0 ||
      branchFilters.locations.length > 0 ||
      (branchFilters.prStatus !== "all" && prAvailable(data)) ||
      (branchFilters.reviewer !== "all" && prAvailable(data));
    const clearButton =
      '<button class="bfilter-clear" data-action="clearFilters"' +
      (filterApplied ? "" : " disabled") +
      ' title="Clear the author, Location, PR Status and Reviewer filters">' +
      icons.cross +
      "<span>Clear Filters</span></button>";

    return (
      '<div class="bfilter-bar">' +
      controls +
      locationMenu +
      menu("sort", "Sort", sortOpt.label, sortItems) +
      prStatusMenu +
      reviewerMenu +
      clearButton +
      "</div>"
    );
  }

  // The three locality states a branch row tags itself with.
  const BRANCH_KINDS = {
    "remote-only": {
      label: "remote only",
      title: "Exists only on origin; no local branch",
    },
    both: {
      label: "local + remote",
      title: "Local branch that also exists on origin",
    },
    local: {
      label: "local only",
      title: "Local branch with no matching origin branch",
    },
  };

  function branchKind(b) {
    if (b.remoteOnly) return "remote-only";
    return b.hasRemote ? "both" : "local";
  }

  // GitHub web URL for a branch's tree. Branch names can contain slashes, which
  // GitHub keeps as path separators, so encode each segment but not the slashes.
  function branchUrl(data, name) {
    if (!data || !data.repoUrl) return "";
    const seg = String(name).split("/").map(encodeURIComponent).join("/");
    return data.repoUrl + "/tree/" + seg;
  }

  function branchRow(b, data) {
    // PR data is still used to detect a merged branch for the delete flow, but
    // only an OPEN (or draft) PR is shown on the row — this is a branches view,
    // with the PR as a hint, not a PR list.
    const prData = prAvailable(data) ? b.pr : null;
    const pr =
      prData && (prData.state === "open" || prData.state === "draft")
        ? prData
        : null;
    const kind = branchKind(b);
    const k = BRANCH_KINDS[kind];
    const tag =
      '<span class="btag ' +
      kind +
      '" title="' +
      k.title +
      '">' +
      esc(k.label) +
      "</span>";

    // Ahead/behind vs the compare base (upstream, or the default branch when the
    // branch has no upstream). Each piece shows only when non-zero so an in-sync
    // row stays uncluttered. (No +/- line diff here: it cost a git process per
    // branch and was dropped for speed; the commit ahead/behind is the signal.)
    const segs = [];
    if (b.ahead)
      segs.push(
        '<span class="bseg ahead" title="Commits ahead of its base (to push)">↑' +
          b.ahead +
          "</span>"
      );
    if (b.behind)
      segs.push(
        '<span class="bseg behind" title="Commits behind its base (to pull)">↓' +
          b.behind +
          "</span>"
      );
    const remoteMark =
      tag + (segs.length ? '<span class="bsync">' + segs.join("") + "</span>" : "");
    // A worktree already exists: show the marker, and (when we know its path)
    // still let the user start a Claude agent in that existing worktree.
    const control = b.hasWorktree
      ? '<span class="bworktree" title="' +
        (b.worktreePath ? esc(b.worktreePath) : "") +
        '">' +
        icons.check +
        "Worktree exists</span>" +
        (b.worktreePath
          ? '<button class="bagent" data-action="agent" data-path="' +
            esc(b.worktreePath) +
            '" title="Start a Claude agent in this worktree">' +
            icons.agentMark +
            "Start agent</button>"
          : "")
      : '<button class="bcreate" data-action="worktreeFromBranch" data-branch="' +
        esc(b.name) +
        '" data-remote="' +
        (b.remoteOnly ? "1" : "0") +
        '" title="Create a worktree for this branch and start a Claude agent in it">' +
        icons.agentMark +
        "Create worktree &amp; start agent</button>";

    // Delete is local-only: it removes the local branch and never touches the
    // remote. A remote-only branch has no local ref to delete, so the button is
    // shown only for branches that exist on this machine (and never for the
    // repo's default branch, e.g. main).
    const canDelete = !b.isDefault && !b.remoteOnly;
    const deleteBtn = canDelete
      ? '<button class="bdelete danger" data-action="deleteBranch" data-branch="' +
        esc(b.name) +
        '" data-merged="' +
        (prData && prData.state === "merged" ? "1" : "0") +
        '" title="Delete this local branch (the remote branch is left untouched)">' +
        icons.trash +
        "Delete Local</button>"
      : "";

    const url = branchUrl(data, b.name);
    const nameLink = url
      ? '<a class="brow-link" href="' +
        esc(url) +
        '" title="View this branch on GitHub" target="_blank" rel="noopener noreferrer">' +
        icons.external +
        "</a>"
      : "";

    // Git-native "last updated" line: when, and by whom. The signal this view
    // sorts and filters on, shown so the order is legible.
    const when = relTime(b.updatedAt);
    const meta =
      when || b.lastUser
        ? '<div class="brow-meta">' +
          (when ? '<span class="bmeta-when">' + esc(when) + "</span>" : "") +
          (b.lastUser
            ? '<span class="bmeta-user" title="Last commit by ' +
              esc(b.lastUser) +
              '">' +
              icons.agentMark +
              esc(b.lastUser) +
              "</span>"
            : "") +
          "</div>"
        : "";

    return (
      '<div class="brow">' +
      '<div class="brow-top">' +
      '<span class="brow-name">' +
      esc(b.name) +
      "</span>" +
      nameLink +
      remoteMark +
      '<span class="brow-control">' +
      control +
      deleteBtn +
      "</span>" +
      "</div>" +
      meta +
      (pr ? prLine(pr, true) : "") +
      "</div>"
    );
  }

  // Prev/Next pager under the branch list. Hidden when everything fits on one
  // page. Buttons are disabled (so their click never fires) at the ends.
  function branchPager(total, start, shown, pageCount) {
    if (total <= BRANCH_PAGE_SIZE) return "";
    const from = total ? start + 1 : 0;
    const to = start + shown;
    const prevDis = branchPage <= 0 ? " disabled" : "";
    const nextDis = branchPage >= pageCount - 1 ? " disabled" : "";
    return (
      '<div class="bpager">' +
      '<span class="bpager-info">' +
      from +
      "–" +
      to +
      " of " +
      total +
      "</span>" +
      '<button class="bpager-btn" data-page="prev"' +
      prevDis +
      ">Prev</button>" +
      '<span class="bpager-pos">Page ' +
      (branchPage + 1) +
      " / " +
      pageCount +
      "</span>" +
      '<button class="bpager-btn" data-page="next"' +
      nextDis +
      ">Next</button>" +
      "</div>"
    );
  }

  function branchesContent() {
    const data = branchData;
    let body;
    if (branchesLoading && !data) {
      body = '<div class="bloading">Loading branches…</div>';
    } else if (!data || !data.repoRoot) {
      body =
        '<div class="empty">No git repository in this window.<br/>Open a folder that is a git repository to list its branches.</div>';
    } else if (data.error) {
      // A git failure (missing/hung/timed out): show it rather than a misleading
      // "No branches found". Full detail is in the "Agent Worktrees" output.
      body =
        '<div class="empty">Could not list branches.<br/>' +
        esc(data.error) +
        '<br/><br/>See View &gt; Output &gt; "Agent Worktrees" for details.</div>';
    } else if (!data.branches || !data.branches.length) {
      body = '<div class="empty">No branches found in this repository.</div>';
    } else {
      const rows = visibleBranches(data);
      const total = rows.length;
      const pageCount = Math.max(1, Math.ceil(total / BRANCH_PAGE_SIZE));
      if (branchPage >= pageCount) branchPage = pageCount - 1;
      if (branchPage < 0) branchPage = 0;
      const start = branchPage * BRANCH_PAGE_SIZE;
      const pageRows = rows.slice(start, start + BRANCH_PAGE_SIZE);
      const list = pageRows.length
        ? pageRows.map((b) => branchRow(b, data)).join("")
        : '<div class="empty">No branches match the current filters.</div>';
      body =
        filterBar(data) +
        '<div class="brows">' +
        list +
        "</div>" +
        branchPager(total, start, pageRows.length, pageCount);
    }

    const repoName = (data && data.repoName) || "";
    const repoLink =
      data && data.repoUrl
        ? '<a class="branches-link" href="' +
          esc(data.repoUrl) +
          '/branches" title="View all branches for this repo on GitHub" target="_blank" rel="noopener noreferrer">' +
          icons.external +
          "Branches on GitHub</a>"
        : "";
    return (
      '<div class="settings-view branches-view">' +
      '<div class="settings-head">' +
      '<span class="settings-title">' +
      icons.branch +
      "Branches" +
      (repoName ? ' <span class="branches-repo">' + esc(repoName) + "</span>" : "") +
      "</span>" +
      '<div class="branches-head-actions">' +
      repoLink +
      // Fetch (git only) with its Prune checkbox stacked directly underneath.
      '<div class="branches-action-stack">' +
      '<button class="branches-refresh" data-action="fetchBranches" title="Fetch from the remote to refresh local branch state (ahead/behind, diffs)">' +
      icons.refresh +
      " Fetch</button>" +
      '<label class="branches-prune" title="Also remove remote-tracking refs for branches deleted on the remote">' +
      '<input type="checkbox" id="branches-prune"' +
      (branchFilters.prune ? " checked" : "") +
      " /> Prune</label>" +
      "</div>" +
      // Fetch Open PRs is the API-only counterpart to the git-only Fetch: it
      // re-polls open PR/CI status without a git fetch. Only useful (and only
      // shown) when a token is stored. PR/CI status is fetched on open and on
      // each click; it spins (data.githubRefreshing) while the on-open fetch is
      // in flight. The "Last refreshed" time sits directly below it.
      (data && data.github && data.github.hasToken
        ? '<div class="branches-action-stack">' +
          '<button class="branches-refresh' +
          (data.githubRefreshing ? " busy" : "") +
          '" data-action="refreshGithub"' +
          (data.githubRefreshing ? " disabled" : "") +
          ' title="Re-query the GitHub API to refresh open PR and CI status">' +
          (data.githubRefreshing ? icons.spinner : icons.pr) +
          " Fetch Open PRs</button>" +
          '<span class="branches-lastrefresh" title="When the open PR and CI status was last refreshed. Status is refreshed when the view opens and whenever you click Fetch Open PRs.">Last refreshed: ' +
          esc(lastRefreshedText(data)) +
          "</span>" +
          "</div>"
        : "") +
      // Bulk-delete local branches whose upstream is gone (merged or deleted on
      // the remote). Prompts before deleting; never touches the remote. Last in
      // the row, behind a divider, so the destructive action is not sandwiched
      // between the routine fetch buttons.
      '<button class="branches-refresh branches-danger" data-action="deleteGoneBranches" data-tip="Delete every local branch whose remote branch no longer exists (merged or deleted on the remote). The remote is never touched, and branches with unmerged work get an extra confirmation.">' +
      icons.trash +
      " Delete gone</button>" +
      "</div>" +
      "</div>" +
      '<div class="branches-body">' +
      body +
      "</div>" +
      "</div>"
    );
  }

  function renderBranches() {
    // The scroll region (.brows) is recreated by the innerHTML swap, so capture
    // its offset and restore it onto the fresh node — a background poll re-render
    // must not jerk the list back to the top while the user is scrolled down.
    const prev = root.querySelector(".brows");
    const y = prev ? prev.scrollTop : 0;
    root.innerHTML = branchesContent();
    const next = root.querySelector(".brows");
    if (next) next.scrollTop = y;
  }

  // Branches-tab mount: request the branch + PR payload, show the loading state
  // until it arrives. Called once when this webview is the branches editor tab.
  function mountBranches() {
    branchesLoading = !branchData;
    renderBranches();
    send("loadBranches");
  }

  root.addEventListener("click", (e) => {
    // GitHub settings controls (save token / disconnect).
    const gh = e.target.closest("[data-gh]");
    if (gh) {
      const kind = gh.getAttribute("data-gh");
      if (kind === "save") saveToken();
      else if (kind === "disconnect") {
        ghTokenFormOpen = false;
        send("clearGithubToken");
      } else if (kind === "replaceToken") {
        ghTokenFormOpen = !ghTokenFormOpen;
        renderSettings();
      }
      return;
    }
    // Preferences: move one agent status up or down the agents-view order.
    const orderBtn = e.target.closest("[data-order-status]");
    if (orderBtn) {
      moveStatus(
        orderBtn.getAttribute("data-order-status"),
        Number(orderBtn.getAttribute("data-order-delta"))
      );
      return;
    }
    // Linked Files controls (add a path / remove a path).
    const linkAdd = e.target.closest("[data-link-add]");
    if (linkAdd) {
      addLinkedPath();
      return;
    }
    const linkRemove = e.target.closest("[data-link-remove]");
    if (linkRemove) {
      send("removeLinkedPath", {
        linkPath: linkRemove.getAttribute("data-link-remove") || undefined,
      });
      return;
    }
    // Fold the tab rail down to its icons (webview-only, like the tab switch).
    const navFold = e.target.closest("[data-tool='settingsNav']");
    if (navFold && settingsOpen) {
      settingsNavCollapsed = !settingsNavCollapsed;
      persist();
      renderSettings();
      return;
    }
    // Settings tab switch (webview-only; no round trip. The Performance tab's
    // state is requested by renderSettings, which covers being switched to AND
    // being the tab Settings reopens on).
    const tab = e.target.closest("[data-tab]");
    if (tab && settingsOpen) {
      settingsTab = tab.getAttribute("data-tab") || "github";
      renderSettings();
      return;
    }
    const tool = e.target.closest("[data-tool='collapseAll']");
    if (tool) {
      // Off in the agents view, where there is nothing to fold. The button is
      // still a live one (so its tooltip can say so), which makes this check the
      // thing that stops the click from folding cards behind the other view.
      if (!tool.classList.contains("disabled")) collapseAll();
      return;
    }
    // Worktrees / agents. Webview-only: both views render from the payload the
    // panel already has, so switching costs a re-render and nothing else.
    const viewBtn = e.target.closest("[data-tool='view']");
    if (viewBtn) {
      const next =
        viewBtn.getAttribute("data-view") === "agents" ? "agents" : "worktrees";
      if (next !== panelView) {
        panelView = next;
        persist();
        closeCardMenu();
        render(lastData);
        // render restores the scroll offset of the list it replaced, which means
        // nothing in the list that replaced it: a new view starts at the top.
        const list = root.querySelector(".cards");
        if (list) list.scrollTop = 0;
      }
      return;
    }
    const cardMenuBtn = e.target.closest("[data-tool='cardMenu']");
    if (cardMenuBtn) {
      openCardMenu(cardMenuBtn.getAttribute("data-path") || "");
      return;
    }
    const groupMenuBtn = e.target.closest("[data-tool='groupMenu']");
    if (groupMenuBtn) {
      openGroupMenu(groupMenuBtn.getAttribute("data-group") || "");
      return;
    }
    // Fold a section. Before the card toggle below, and its own target: the
    // section header sits above the cards, not inside one.
    const groupToggle = e.target.closest("[data-group-toggle]");
    if (groupToggle && dragSuppressedClick) {
      dragSuppressedClick = false;
      return;
    }
    if (groupToggle && !e.target.closest("button, a, input")) {
      toggleGroup(groupToggle.getAttribute("data-group-toggle") || "");
      return;
    }
    // Branches view: filter/sort dropdowns and selections (webview-only).
    if (VIEW === "branches") {
      const pageBtn = e.target.closest("[data-page]");
      if (pageBtn) {
        const dir = pageBtn.getAttribute("data-page");
        branchPage = dir === "prev" ? branchPage - 1 : branchPage + 1;
        renderBranches(); // clamps the page; restores scroll, then jump to top
        const brows = root.querySelector(".brows");
        if (brows) brows.scrollTop = 0;
        return;
      }
      const menuToggle = e.target.closest("[data-menu-toggle]");
      if (menuToggle) {
        const id = menuToggle.getAttribute("data-menu-toggle");
        openMenu = openMenu === id ? "" : id;
        renderBranches();
        return;
      }
      const user = e.target.closest("[data-user]");
      if (user) {
        const name = user.getAttribute("data-user");
        const i = branchFilters.users.indexOf(name);
        if (i === -1) branchFilters.users.push(name);
        else branchFilters.users.splice(i, 1);
        branchPage = 0;
        persist();
        renderBranches();
        return;
      }
      // Location multi-select: toggle like Updated by (menu stays open).
      const loc = e.target.closest("[data-loc]");
      if (loc) {
        const id = loc.getAttribute("data-loc");
        const i = branchFilters.locations.indexOf(id);
        if (i === -1) branchFilters.locations.push(id);
        else branchFilters.locations.splice(i, 1);
        branchPage = 0;
        persist();
        renderBranches();
        return;
      }
      const sort = e.target.closest("[data-sort]");
      if (sort) {
        branchFilters.sort =
          sort.getAttribute("data-sort") || "recentlyUpdated";
        openMenu = "";
        branchPage = 0;
        persist();
        renderBranches();
        return;
      }
      // PR Status single-select: webview-only filter, no message to the extension.
      const prStatus = e.target.closest("[data-prstatus]");
      if (prStatus) {
        branchFilters.prStatus =
          prStatus.getAttribute("data-prstatus") || "all";
        openMenu = "";
        branchPage = 0;
        persist();
        renderBranches();
        return;
      }
      // Reviewer single-select: webview-only filter, no message to the extension.
      const reviewer = e.target.closest("[data-reviewer]");
      if (reviewer) {
        branchFilters.reviewer =
          reviewer.getAttribute("data-reviewer") || "all";
        openMenu = "";
        branchPage = 0;
        persist();
        renderBranches();
        return;
      }
      // Clear Filters: resets author + Location + PR Status + Reviewer (not
      // Sort). Webview-only; the disabled attribute is the rendered guard,
      // re-checked here so a stale click can't fire when nothing is filtering.
      const clearFilters = e.target.closest("[data-action='clearFilters']");
      if (clearFilters) {
        if (clearFilters.disabled) return;
        branchFilters.users = [];
        branchFilters.locations = [];
        branchFilters.prStatus = "all";
        branchFilters.reviewer = "all";
        openMenu = "";
        branchPage = 0;
        persist();
        renderBranches();
        return;
      }
      // Click outside any open menu closes it (but let real actions below run).
      if (openMenu && !e.target.closest(".bfilter")) {
        openMenu = "";
        renderBranches();
        // fall through so an action target still fires
      }
    }
    const btn = e.target.closest("[data-action]");
    if (btn) {
      e.stopPropagation();
      const action = btn.getAttribute("data-action");
      // Show an in-progress spinner for actions that do real work the user waits
      // on (git/network/window). Webview-only actions below return early before
      // this matters, so it is safe to mark here for any matching action.
      if (BUSY_ACTIONS.has(action)) markBusy(btn);
      // Skills modal is handled entirely in the webview: the list is already
      // in the data, so there is no round-trip to the extension.
      if (action === "showSkills") {
        openSkills(btn.getAttribute("data-session"));
        return;
      }
      // Pin/unpin an agents-view row. Webview-only, like the view switch: the
      // pin only decides how the payload the panel already has is ordered.
      if (action === "togglePin") {
        togglePin(btn.getAttribute("data-session") || "");
        return;
      }
      // Settings is a webview-only page — no round trip to the extension.
      if (action === "openSettings") {
        openSettings();
        return;
      }
      if (action === "closeSettings") {
        closeSettings();
        return;
      }
      // Sidebar "Branches" toolbar button: ask the extension to open (or reveal)
      // the dedicated branches editor tab. No in-sidebar overlay is rendered.
      if (action === "openBranches") {
        send("openBranches");
        return;
      }
      // Create a worktree from a branch row, carrying which branch and whether
      // it is remote-only so the extension knows to set up remote tracking.
      if (action === "worktreeFromBranch") {
        send("worktreeFromBranch", {
          branch: btn.getAttribute("data-branch") || undefined,
          remoteOnly: btn.getAttribute("data-remote") === "1",
        });
        return;
      }
      // Delete the local branch only (the remote ref is left untouched). Carry
      // whether the PR merged so the extension knows it can force-delete a branch
      // whose squash-merge left it looking unmerged.
      if (action === "deleteBranch") {
        send("deleteBranch", {
          branch: btn.getAttribute("data-branch") || undefined,
          merged: btn.getAttribute("data-merged") === "1",
        });
        return;
      }
      // Explicit Fetch button: carry the Prune checkbox state so the extension
      // fetches with (or without) --prune.
      if (action === "fetchBranches") {
        const prune = root.querySelector("#branches-prune");
        send("fetchBranches", { value: prune ? !!prune.checked : true });
        return;
      }
      // Fetch Open PRs: API-only re-poll of open PR/CI status, no git fetch.
      if (action === "refreshGithub") {
        send("refreshGithub");
        return;
      }
      // Reveal an agent's terminal. Marked here rather than when the extension
      // answers: see revealAgent.
      if (action === "focusAgent") {
        revealAgent(btn.getAttribute("data-session"));
        return;
      }
      // Scope button: move the blue pill immediately. The extension's
      // confirmation follows on a later post, but the Git extension can take
      // seconds to register the repo swap (Windows, many worktrees) and the
      // click must not look ignored while it does. The cached data is patched
      // too so a webview-local re-render keeps the optimistic state.
      if (action === "scopeScm") {
        const path = btn.getAttribute("data-path");
        // Every button naming this worktree, not only the one clicked: the
        // agents view draws one per agent row, so a worktree running three
        // agents has three of them and they all report the one scope.
        root.querySelectorAll(".scm-scope").forEach(function (b) {
          const on = b.getAttribute("data-path") === path;
          b.classList.toggle("active", on);
          b.setAttribute("aria-pressed", on ? "true" : "false");
        });
        if (lastData && lastData.worktrees) {
          lastData.worktrees.forEach(function (wt) {
            wt.scmActive = wt.path === path;
          });
        }
        send("scopeScm", { path: path || undefined });
        return;
      }
      // Stop one debug session by its VS Code session id. The row is removed by
      // the extension's terminate event, not here, so a session that refuses to
      // die keeps its stop button.
      if (action === "stopDebug") {
        send("stopDebug", {
          debugId: btn.getAttribute("data-debug") || undefined,
        });
        return;
      }
      send(action, {
        path: btn.getAttribute("data-path") || undefined,
        sessionId: btn.getAttribute("data-session") || undefined,
      });
      return;
    }
    // The expand toggle: the header's name half carries data-toggle, so the
    // actions beside it are outside it and no longer need excluding by their
    // own right. Controls inside it are still excluded — an anchor the webview
    // lets through to the browser never
    // reaches the data-action branch above and would otherwise toggle the card
    // on its way out.
    const bar = e.target.closest("[data-toggle]");
    if (bar && !e.target.closest("a, button"))
      toggle(bar.getAttribute("data-toggle"));
  });

  // The menu lives on the body, outside #root, so its clicks need their own
  // handler rather than the delegated one the cards use.
  document.addEventListener("click", (e) => {
    const item =
      cardMenuEl && e.target.closest(".card-menu-item, .card-menu-run");
    if (item) {
      const action = item.getAttribute("data-action");
      const path = item.getAttribute("data-path") || undefined;
      const groupId = item.getAttribute("data-group") || undefined;
      const delta = Number(item.getAttribute("data-delta")) || undefined;
      const debugTarget = item.getAttribute("data-debug-target") || undefined;
      const noDebug = item.hasAttribute("data-no-debug") || undefined;
      // Where the menu is now, so the one that replaces it lands in the same
      // place. Read before closing, since closing removes the element.
      const box = cardMenuEl.getBoundingClientRect();
      closeCardMenu();
      // Renaming is webview-only until the name is typed: the field opens in the
      // header, and only the finished name goes to the host.
      if (action === "renameGroup") {
        startGroupRename(groupId);
        return;
      }
      // The launch targets are already in the payload, so the list is another
      // menu rather than a round trip. `- 4` undoes the gap mountMenu adds below
      // an anchor, which puts the new menu's top edge where this one's was.
      if (action === "debugMenu") {
        openDebugMenu(path, { x: box.left, y: box.top - 4 });
        return;
      }
      // No action means the <a> among them, which navigates on its own.
      if (action) send(action, { path, groupId, delta, debugTarget, noDebug });
      return;
    }
    // Anywhere else, including a caret itself - which then re-opens through
    // root's handler only when it was not the click that shut this. Every caret
    // that owns a menu is exempted, not just a card's: this listener runs after
    // root's, so a caret it did not know about would have its menu opened and
    // then shut again by the same click.
    if (cardMenuEl && !e.target.closest("[data-menu-key]")) closeCardMenu();
  });

  // The rename field. Enter keeps the name, Escape drops it, and clicking away
  // keeps it too - the field holds a name that already exists, so leaving it is
  // not a reason to throw the edit away. On document, not root: the field can
  // lose focus to anything.
  document.addEventListener("keydown", (e) => {
    if (!editingGroup || !e.target.closest("[data-group-rename]")) return;
    if (e.key === "Enter") {
      e.preventDefault();
      endGroupRename(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      // Before the panel-wide Escape handler below, which would otherwise also
      // read this as "shut whatever is open".
      e.stopPropagation();
      endGroupRename(false);
    }
  });
  document.addEventListener(
    "focusout",
    (e) => {
      if (!editingGroup || !e.target.closest("[data-group-rename]")) return;
      endGroupRename(true);
    },
    true
  );

  // Right-click anywhere on a card, or on a section header, opens the same menu
  // its caret does - anchored at the pointer. The caret stays: this is the
  // shortcut for people who reach for it, not a replacement for a visible
  // control.
  root.addEventListener("contextmenu", (e) => {
    // Never over a text field: the native menu there is cut, copy and paste,
    // which is the useful one.
    if (e.target.closest("input, textarea, [contenteditable]")) return;
    const head = e.target.closest(".group-head");
    if (head) {
      const toggle = head.querySelector("[data-group-toggle]");
      const id = toggle && toggle.getAttribute("data-group-toggle");
      if (id) {
        e.preventDefault();
        openGroupMenu(id, { x: e.clientX, y: e.clientY });
      }
      return;
    }
    const card = e.target.closest(".card");
    if (!card) return;
    const btn = card.querySelector("[data-tool='cardMenu']");
    const path = btn && btn.getAttribute("data-path");
    if (!path) return;
    e.preventDefault();
    openCardMenu(path, { x: e.clientX, y: e.clientY });
  });

  // A menu positioned against a button cannot follow it: the cards scroll under
  // a sticky header, and the panel can be resized. Shut it instead of leaving it
  // pointing at nothing.
  window.addEventListener("resize", closeCardMenu);
  document.addEventListener(
    "scroll",
    (e) => {
      // Except the menu scrolling itself: in a short panel it is capped to the
      // room it has and scrolls internally, and that must not shut it.
      if (cardMenuEl && !(e.target && cardMenuEl.contains(e.target)))
        closeCardMenu();
    },
    true
  );

  root.addEventListener("change", (e) => {
    if (e.target && e.target.id === "gh-enable") {
      send("togglePr", { value: !!e.target.checked });
    } else if (e.target && e.target.id === "scm-enable") {
      send("toggleScm", { value: !!e.target.checked });
    } else if (e.target && e.target.id === "debug-trace") {
      send("toggleTrace", { value: !!e.target.checked });
    } else if (e.target && e.target.id === "poll-seconds") {
      send("setPollSeconds", { seconds: Number(e.target.value) });
    } else if (e.target && e.target.getAttribute("data-perf")) {
      // Each git accelerator has its own switch, so one can be turned off without
      // touching the other. The extension re-reads the repo's config and posts
      // the result, which is what re-renders these; a write that fails therefore
      // springs the switch back on its own.
      send("setGitPerf", {
        perfKey: e.target.getAttribute("data-perf"),
        value: !!e.target.checked,
      });
    } else if (e.target && e.target.id === "branches-prune") {
      // Remember the Prune choice for the next fetch; the value is read live when
      // Fetch is clicked, so no re-render is needed here.
      branchFilters.prune = !!e.target.checked;
      persist();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (VIEW === "branches") {
      // The branches tab is closed via the editor tab itself; Escape only
      // dismisses an open filter/sort menu.
      if (openMenu) {
        openMenu = "";
        renderBranches();
      }
      return;
    }
    if (drag) {
      endDrag(false);
      return;
    }
    if (editingGroup) {
      endGroupRename(false);
      return;
    }
    if (cardMenuEl) {
      // Escape from a menu returns you to the control you opened it from, not
      // to the top of the panel.
      closeCardMenu(true);
      return;
    }
    if (settingsOpen) {
      closeSettings();
      return;
    }
    if (modalEl) {
      closeModal();
      return;
    }
  });

  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    // Not when a control inside the header has focus: it holds the scope button
    // and the actions caret, which fire their own click on Enter/Space - and,
    // while a group is being renamed, a text field, where Space is a space and
    // Enter is "keep this name", not "fold the section under me".
    const section = e.target.closest("[data-group-toggle]");
    if (section && !e.target.closest("button, a, input")) {
      e.preventDefault();
      toggleGroup(section.getAttribute("data-group-toggle") || "");
      return;
    }
    const bar = e.target.closest("[data-toggle]");
    if (bar && !e.target.closest("button, a")) {
      e.preventDefault();
      toggle(bar.getAttribute("data-toggle"));
      return;
    }
    // Activate a focused agent (or subagent) row — both reveal a terminal, and
    // a subagent's is its parent's. Not when a child button has focus: buttons
    // fire their own click on Enter/Space.
    if (e.target.matches && e.target.matches(".agent-row, .subagent-row")) {
      e.preventDefault();
      revealAgent(e.target.getAttribute("data-session"));
    }
  });

  // F2 on a focused section header, which is what renames things everywhere else
  // in the editor.
  root.addEventListener("keydown", (e) => {
    if (e.key !== "F2" || editingGroup) return;
    const section = e.target.closest("[data-group-toggle]");
    if (!section) return;
    e.preventDefault();
    startGroupRename(section.getAttribute("data-group-toggle") || "");
  });

  /**
   * Reveal an agent's terminal, and mark the row now instead of when the
   * extension answers.
   *
   * Finding the terminal a session runs in is not always a lookup: the id we
   * launched Claude with is not the id its row carries, so the first reveal of
   * an agent reads the OS process table to match them (resolveTerminal in the
   * extension). The panel now links them ahead of the click, but the round trip
   * is still a round trip, and until it landed a click on a row did nothing
   * visible at all - which read as the click being missed rather than as work in
   * progress. So the row takes the highlight immediately and the extension's
   * activeTerminal push confirms it, the same trick the Source Control scope
   * pill uses. A reveal that finds nothing is corrected by that push, which
   * carries whichever agent actually owns the active terminal.
   */
  function revealAgent(sessionId) {
    if (!sessionId) return;
    activeSessionId = sessionId;
    applyActiveTerminal();
    send("focusAgent", { sessionId: sessionId });
  }

  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (!msg) return;
    if (VIEW === "branches") {
      // The branches editor tab only consumes its own payload. A stray
      // {type:"update"} (it should never arrive here) is ignored, not rendered.
      if (msg.type === "branches") {
        // Fresh branch + PR payload. The extension re-posts this on every poll
        // (worktree/git changes), so skip the re-render when nothing the view
        // depends on actually changed — only a real change is worth rebuilding
        // the DOM (mirrors the settings view's ghSig dedupe). This is what keeps
        // a background poll from disturbing the user's scroll position.
        const sig = JSON.stringify(msg.data);
        const changed = sig !== lastBranchSig;
        lastBranchSig = sig;
        branchData = msg.data;
        branchesLoading = false;
        // A changed payload rebuilds the DOM (restoring real icons over any
        // spinners). When it is unchanged (a no-op fetch/refresh) re-render only
        // if a spinner is pending, so the button drops its spinner without making
        // background polls churn the DOM; renderBranches preserves scroll.
        if (changed || root.querySelector(".busy")) renderBranches();
      }
      return;
    }
    // Sidebar. Ignore any {type:"branches"} meant for the branches tab.
    if (msg.type === "update") {
      activeSessionId = (msg.data && msg.data.activeSessionId) || "";
      // Only here, not in render: this is the one place a fresh payload lands,
      // and a re-render from the cached one (a view switch, a pin) says nothing
      // new about which sessions are still alive.
      prunePins(msg.data);
      render(msg.data);
      announceWaiting(msg.data);
      maybeRefreshSettings(msg.data);
    } else if (msg.type === "activeTerminal") {
      // Terminal switch: retint the rows in place — no full re-render, so an
      // open menu/modal or the scroll position is never disturbed.
      activeSessionId = msg.sessionId || "";
      applyActiveTerminal();
    } else if (msg.type === "openSettings") {
      openSettings();
    } else if (msg.type === "visibility") {
      // The extension tells us, because we cannot see it: the panel's iframe is
      // display:none when the view is hidden, and an iframe's document.hidden
      // follows the window rather than its own CSS, so it stays false. Only the
      // elapsed-time tick cares (see tickAges).
      panelVisible = msg.visible !== false;
    } else if (msg.type === "refreshError") {
      showRefreshError(msg.message || "");
    } else if (msg.type === "refreshing") {
      showRefreshProgress(!!msg.git, !!msg.github);
    }
  });

  /** Last announced waiting count, so the same number is not read out again on
   *  every payload. */
  let announcedWaiting = 0;

  /**
   * Say, once, when more agents start needing you.
   *
   * The whole point of the panel is "an agent is blocked on you", and it was
   * carried entirely by a colour, a pulse and a number badge on an icon. None of
   * those reach a screen reader, and the badge is not in this document at all.
   *
   * Only on a rise, and only the total: announcing every payload would talk over
   * everything else while agents work, and announcing a fall ("1 agent waiting")
   * as you answer them is noise about work you just did.
   */
  function announceWaiting(data) {
    const wts = (data && data.worktrees) || [];
    let waiting = 0;
    for (const wt of wts) {
      for (const a of wt.agents || []) if (statusOf(a) === "waiting") waiting++;
    }
    if (waiting > announcedWaiting) {
      const live = document.getElementById("awt-live");
      if (live) {
        live.textContent =
          waiting === 1
            ? "1 agent is waiting for you"
            : waiting + " agents are waiting for you";
      }
    }
    announcedWaiting = waiting;
  }

  /**
   * A banner over the cards when a refresh failed.
   *
   * Every refresh path is fire-and-forget on the host, so a gather that threw
   * used to leave the panel showing its last good payload with nothing to say
   * that it had stopped being updated - or, on a fresh window, sitting on
   * "Loading worktrees" for good.
   *
   * Deliberately a banner and not a replacement for the list: the worktrees
   * almost certainly still exist and their last known state is still the best
   * thing to show, so this says the panel is stale rather than blanking what it
   * has. Written into a slot outside `root` so a re-render neither clears it
   * nor is needed to draw it.
   */
  /**
   * The one announcement channel, created once and never re-rendered. Outside
   * `root` on purpose: a live region that is removed and rebuilt is a *new*
   * region, and its contents are not announced.
   */
  (function mountLiveRegion() {
    if (document.getElementById("awt-live")) return;
    const live = document.createElement("div");
    live.id = "awt-live";
    live.className = "visually-hidden";
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    live.setAttribute("aria-atomic", "true");
    (root.parentNode || document.body).insertBefore(live, root);
  })();

  /**
   * A progress line while the network half of a Refresh is still running.
   *
   * Refresh is a `view/title` command, so it is VS Code's button and the panel
   * cannot put a spinner on it. The panel now paints as soon as the local git
   * gather is done and lets the `git fetch` and the GitHub PR/CI poll land
   * afterwards, which is what stops the click from freezing the view - but it
   * also means the numbers those two produce arrive seconds after the repaint.
   * This says which of them is still going, so the wait is visible work rather
   * than a panel that stopped halfway.
   *
   * Written into the slot above `root`, like the error banner: it is toggled
   * several times per refresh and a re-render neither draws nor clears it, so it
   * never costs a rebuild of the card list.
   */
  function showRefreshProgress(git, github) {
    let bar = document.getElementById("refresh-progress");
    if (!git && !github) {
      if (bar) bar.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "refresh-progress";
      bar.className = "refresh-progress";
      bar.setAttribute("role", "progressbar");
      bar.innerHTML = '<span class="refresh-progress-track"></span>';
      root.parentNode.insertBefore(bar, root);
    }
    // Both legs run concurrently, so name whichever are still outstanding.
    const what =
      git && github
        ? "Fetching from the remote and loading GitHub status"
        : git
          ? "Fetching from the remote"
          : "Loading GitHub status";
    bar.setAttribute("aria-label", what);
    bar.title = what;
  }

  function showRefreshError(message) {
    let bar = document.getElementById("refresh-error");
    if (!message) {
      if (bar) bar.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "refresh-error";
      bar.className = "refresh-error";
      bar.setAttribute("role", "status");
      root.parentNode.insertBefore(bar, root);
    }
    bar.textContent = "Could not refresh: " + message;
  }

  /** Sync the .terminal-open classes to activeSessionId without re-rendering.
   *  The chips are always in the markup and CSS-gated, so this is pure class
   *  toggling on the existing DOM. */
  function applyActiveTerminal() {
    const rows = root.querySelectorAll(".agent-row[data-session]");
    let activeRow = null;
    rows.forEach((row) => {
      const on =
        !!activeSessionId &&
        row.getAttribute("data-session") === activeSessionId;
      row.classList.toggle("terminal-open", on);
      if (on) activeRow = row;
    });
    // Two markers move together: the card's own outline and the tinted card
    // header. The card is in this list because it is what
    // carries the outline; left out, the outline only caught up on the next full
    // render, which waits for a data push, so switching terminals highlighted
    // the row immediately and the card seconds later.
    root
      .querySelectorAll(".card.terminal-open, .card-head.terminal-open")
      .forEach((el) => el.classList.remove("terminal-open"));
    const card = activeRow && activeRow.closest(".card");
    if (card) card.classList.add("terminal-open");
    const head = card && card.querySelector(".card-head");
    if (head) head.classList.add("terminal-open");
  }

  // --- Custom hover tooltip --------------------------------------------------
  // Native `title` tooltips have a long, browser-fixed delay. For the agent
  // summary we want our own, so elements carry `data-tip` and we render it on
  // document.body (no clipping by card overflow) after a wait.
  //
  // 400ms, up from 200. A card is a dense run of small glyphs and the pointer
  // crosses several of them on the way to the one you want; at 200ms the tips
  // fired on the way past, so moving across a card set off a sequence of popups
  // for things you were not asking about. The longer wait still beats the native
  // delay and now takes a deliberate stop to trigger.
  const TIP_DELAY = 400;
  let tipEl = null;
  let tipTimer = null;

  function hideTip() {
    if (tipTimer) {
      clearTimeout(tipTimer);
      tipTimer = null;
    }
    if (tipEl) {
      tipEl.remove();
      tipEl = null;
    }
  }

  function showTip(target) {
    const text = target.getAttribute("data-tip");
    if (!text) return;
    if (tipEl) tipEl.remove();
    const el = document.createElement("div");
    el.className = "tip";
    el.textContent = text;
    document.body.appendChild(el);
    // Position above the element, centered, clamped to the viewport; flip below
    // when there isn't room above.
    const r = target.getBoundingClientRect();
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(4, Math.min(left, window.innerWidth - tw - 4));
    let top = r.top - th - 6;
    if (top < 4) top = r.bottom + 6;
    el.style.left = left + "px";
    el.style.top = top + "px";
    tipEl = el;
  }

  root.addEventListener("mouseover", (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t) return;
    if (tipTimer) clearTimeout(tipTimer);
    tipTimer = setTimeout(() => showTip(t), TIP_DELAY);
  });
  root.addEventListener("mouseout", (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t) return;
    // Ignore moves to a child of the same tipped element.
    if (e.relatedTarget && t.contains(e.relatedTarget)) return;
    hideTip();
  });
  // Keyboard focus shows the tip too. It was hover-only, so a keyboard user
  // tabbing through the panel got none of it - and some of these tips are the
  // only place a reading exists at all (an agent's full work summary, a
  // worktree's path, which subagents are running where). Same delay would be
  // wrong here: focus is deliberate, so it shows at once.
  root.addEventListener("focusin", (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t) return;
    if (tipTimer) clearTimeout(tipTimer);
    showTip(t);
  });
  root.addEventListener("focusout", (e) => {
    if (e.target.closest("[data-tip]")) hideTip();
  });
  // Scrolling moves the anchor out from under a fixed tooltip; just drop it.
  root.addEventListener("scroll", hideTip, true);
  // ...and reaching the end of an agent list takes its fade with it. Capture,
  // because these are inner regions and scroll does not bubble.
  root.addEventListener(
    "scroll",
    (e) => {
      const el = e.target;
      if (el && el.classList && el.classList.contains("agents")) {
        markScrollableLists(el);
      }
    },
    true
  );

  // Mount. The branches editor tab requests its own data; the sidebar asks for
  // a refresh in case it mounted after the first push.
  if (VIEW === "branches") {
    mountBranches();
  } else {
    send("refresh");
  }
})();
