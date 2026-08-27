/**
 * User-named groups of worktrees: the sections the cards list is divided into,
 * isolated from the VS Code API so it can be unit-tested and read by both ends
 * without either importing the other (see agentOrder.ts, same shape).
 *
 * The panel's problem is that a worktree kept open until its PR merges is
 * indistinguishable from the one being typed into right now. Groups let the user
 * file the first kind somewhere collapsible. Membership is *manual* here: the
 * rules that would file a worktree automatically are a later phase, and this
 * layer is what they will assign into.
 *
 * Two invariants everything below preserves:
 *
 * - **General always exists.** It is where an unassigned worktree lives, where a
 *   deleted group's members fall to, and what an unrecognized id resolves to. A
 *   worktree can therefore never be filed somewhere that is not rendered, which
 *   is the one failure a grouping feature must not have: a card you cannot find.
 * - **Membership is keyed by worktree path, not branch.** `switchWorktreeBranch`
 *   means a worktree can change branch under you, and the group is a statement
 *   about the working copy you parked, not about what is checked out in it.
 *
 * The state is stored per repository in globalState, which is a JSON blob that
 * survives version changes and can be hand-edited, so `normalizeGroups`
 * normalizes rather than validates: whatever goes in, what comes out is
 * renderable.
 *
 * Path keys are opaque here. Callers pass paths already canonicalized
 * (`normalizePath`), so the same worktree compares equal across platforms.
 */

/** The one group that cannot be deleted, and the fallback for everything. */
export const GENERAL_GROUP_ID = "general";

/** Its name, which is fixed. General is not a group the user made: it is the
 *  bucket everything else falls into, and the panel and this module both name it
 *  in prose ("moves to General"). A renamed one would make those sentences lie,
 *  and would leave no stable word for where an unfiled worktree lives. */
export const GENERAL_GROUP_NAME = "General";

/** Long enough for "Waiting on review", short enough to fit a sidebar header. */
export const MAX_GROUP_NAME_LENGTH = 40;

/** A ceiling on stored groups. Not a UX limit anyone should reach - it exists so
 *  a corrupt or scripted blob cannot render thousands of headers. */
export const MAX_GROUPS = 24;

export interface GroupState {
  /** Group ids in display order. Always contains GENERAL_GROUP_ID. */
  order: string[];
  /** Group id -> display name. Exactly the ids in `order`. */
  names: Record<string, string>;
  /** Worktree path -> group id. An absent path is in General, so the map holds
   *  only real assignments and stays empty for the default arrangement. */
  of: Record<string, string>;
}

/** One group as the webview renders it. */
export interface WorktreeGroupVM {
  id: string;
  name: string;
}

/** The state of a repo that has never been grouped: General alone, nothing filed. */
export function emptyGroupState(): GroupState {
  return {
    order: [GENERAL_GROUP_ID],
    names: { [GENERAL_GROUP_ID]: GENERAL_GROUP_NAME },
    of: {},
  };
}

/**
 * A typed or stored name made safe to render: one line, single-spaced, capped.
 * Returns "" for anything with no visible characters, which every caller treats
 * as "no name given" rather than storing a blank header.
 */
export function cleanGroupName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_GROUP_NAME_LENGTH).trim();
}

/**
 * A stored blob made safe to render with: known ids in the order given, each
 * kept the first time it appears and only if it has a usable name, General
 * guaranteed present, and every membership pointing at a group that survived.
 *
 * A group dropped here takes no worktree with it: its members simply lose their
 * `of` entry and fall to General.
 */
export function normalizeGroups(value: unknown): GroupState {
  const raw = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const rawOrder = Array.isArray(raw.order) ? raw.order : [];
  const rawNames =
    raw.names && typeof raw.names === "object"
      ? (raw.names as Record<string, unknown>)
      : {};
  const rawOf =
    raw.of && typeof raw.of === "object"
      ? (raw.of as Record<string, unknown>)
      : {};

  const order: string[] = [];
  const names: Record<string, string> = {};
  for (const id of rawOrder) {
    if (typeof id !== "string" || !id || order.includes(id)) continue;
    if (order.length >= MAX_GROUPS) break;
    // General's name is not stored data - it is fixed, and a blob carrying
    // something else (hand-edited, or written by a version that let it be
    // renamed) is corrected here rather than honoured. Any other group with no
    // name is not a group, it is debris.
    const name =
      id === GENERAL_GROUP_ID
        ? GENERAL_GROUP_NAME
        : cleanGroupName(rawNames[id]);
    if (!name) continue;
    order.push(id);
    names[id] = name;
  }
  if (!order.includes(GENERAL_GROUP_ID)) {
    // Absent entirely means a blob that predates it or was hand-edited badly.
    // First, not last: a user who moved it has an entry, so this only fires when
    // there is no preference to honour.
    order.unshift(GENERAL_GROUP_ID);
    names[GENERAL_GROUP_ID] = GENERAL_GROUP_NAME;
    if (order.length > MAX_GROUPS) {
      const dropped = order.splice(MAX_GROUPS);
      for (const id of dropped) delete names[id];
    }
  }

  const of: Record<string, string> = {};
  for (const [path, id] of Object.entries(rawOf)) {
    if (!path || typeof id !== "string") continue;
    // General is the absence of an entry, so storing one would be a second way
    // to say the same thing and would survive the group being renamed away.
    if (id === GENERAL_GROUP_ID || !order.includes(id)) continue;
    of[path] = id;
  }
  return { order, names, of };
}

/** The groups in display order, as the payload carries them. */
export function groupList(state: GroupState): WorktreeGroupVM[] {
  return state.order.map((id) => ({ id, name: state.names[id] }));
}

/** Which group a worktree is in. Anything unfiled or unrecognized is General. */
export function groupIdFor(state: GroupState, path: string): string {
  const id = state.of[path];
  return id && state.order.includes(id) ? id : GENERAL_GROUP_ID;
}

/**
 * The next free id. Derived from the ids in use rather than from a clock or a
 * random source, so the same sequence of operations always produces the same
 * state and the tests can assert on it.
 */
function nextGroupId(state: GroupState): string {
  let max = 0;
  for (const id of state.order) {
    const m = /^g(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return "g" + (max + 1);
}

/**
 * `name`, suffixed until no other group answers to it. Two headers reading "In
 * review" would make the move-to menu a coin flip, and the user cannot see the
 * ids that tell them apart.
 */
function uniqueName(state: GroupState, name: string, exceptId?: string): string {
  const taken = new Set(
    state.order
      .filter((id) => id !== exceptId)
      .map((id) => state.names[id].toLowerCase())
  );
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; n < 100; n++) {
    const suffix = " " + n;
    const candidate =
      name.slice(0, MAX_GROUP_NAME_LENGTH - suffix.length).trim() + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return name;
}

function clone(state: GroupState): GroupState {
  return {
    order: state.order.slice(),
    names: { ...state.names },
    of: { ...state.of },
  };
}

/**
 * Add a group, optionally filing one worktree into it at the same time (the
 * "New group from here" path, which is how most groups get made).
 *
 * New groups append at the end. Order is precedence once rules exist, and a new
 * empty group silently outranking established ones would be a surprise; the
 * bottom is also where an unfamiliar section is least in the way.
 *
 * `id` comes back empty when nothing was added (no usable name, or the ceiling
 * is reached), so the caller can say so rather than silently doing nothing.
 */
export function addGroup(
  state: GroupState,
  name: unknown,
  path?: string
): { state: GroupState; id: string } {
  const base = normalizeGroups(state);
  const clean = cleanGroupName(name);
  if (!clean || base.order.length >= MAX_GROUPS) return { state: base, id: "" };
  const next = clone(base);
  const id = nextGroupId(next);
  // Named before it joins the order: uniqueName reads every group's name, and
  // an id in the list with no name yet is not one.
  const unique = uniqueName(next, clean);
  next.order.push(id);
  next.names[id] = unique;
  if (path) next.of[path] = id;
  return { state: next, id };
}

/** Rename a group. A blank name, an unknown target, or General - whose name is
 *  fixed - is a no-op. */
export function renameGroup(
  state: GroupState,
  id: string,
  name: unknown
): GroupState {
  const base = normalizeGroups(state);
  const clean = cleanGroupName(name);
  if (!clean || id === GENERAL_GROUP_ID || !base.order.includes(id)) return base;
  const next = clone(base);
  next.names[id] = uniqueName(next, clean, id);
  return next;
}

/**
 * Delete a group. Its members fall to General rather than being deleted with it:
 * a group is a view of worktrees, never a container that owns them. General
 * itself cannot go.
 */
export function deleteGroup(state: GroupState, id: string): GroupState {
  const base = normalizeGroups(state);
  if (id === GENERAL_GROUP_ID || !base.order.includes(id)) return base;
  const next = clone(base);
  next.order.splice(next.order.indexOf(id), 1);
  delete next.names[id];
  for (const [path, gid] of Object.entries(next.of)) {
    if (gid === id) delete next.of[path];
  }
  return next;
}

/** Move a group one place up (-1) or down (+1). Out of range moves are no-ops,
 *  so the ends of the list need no special casing at the call site. */
export function moveGroup(
  state: GroupState,
  id: string,
  delta: number
): GroupState {
  const base = normalizeGroups(state);
  const from = base.order.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= base.order.length) return base;
  const next = clone(base);
  next.order.splice(to, 0, next.order.splice(from, 1)[0]);
  return next;
}

/** File a worktree into a group. General, or any id that is not a group, clears
 *  the assignment instead of storing one that would have to be resolved later. */
export function assignWorktree(
  state: GroupState,
  path: string,
  groupId: string
): GroupState {
  const base = normalizeGroups(state);
  if (!path) return base;
  const next = clone(base);
  if (groupId === GENERAL_GROUP_ID || !next.order.includes(groupId)) {
    delete next.of[path];
  } else {
    next.of[path] = groupId;
  }
  return next;
}

/**
 * Drop memberships that no longer belong to anything, so a deleted worktree
 * cannot keep a group non-empty and a path reused later does not inherit a stale
 * filing. The groups themselves stay: an empty group is a place the user made to
 * put things in, not litter.
 *
 * `filable` is what may be in a group, which is not quite what exists: the
 * primary worktree is deliberately excluded by the caller, since it sits above
 * the groups and cannot be filed into one. Passing it as unfilable is what
 * cleans up a membership stored before that rule existed.
 *
 * `changed` lets the caller skip a globalState write on the overwhelmingly
 * common refresh where nothing has been removed.
 */
export function pruneGroups(
  state: GroupState,
  filable: readonly string[]
): { state: GroupState; changed: boolean } {
  const base = normalizeGroups(state);
  const live = new Set(filable);
  const stale = Object.keys(base.of).filter((p) => !live.has(p));
  if (!stale.length) return { state: base, changed: false };
  const next = clone(base);
  for (const p of stale) delete next.of[p];
  return { state: next, changed: true };
}
