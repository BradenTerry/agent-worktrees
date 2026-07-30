/**
 * Which worktrees are worth a `git status` on a poll tick, isolated from the
 * VS Code API so it can be unit-tested.
 *
 * The panel has two ways to learn that a worktree's working tree moved, and they
 * cost very different amounts:
 *
 *  - The built-in Git extension is already watching every repository it has open
 *    and already debounces its own status runs, so `Repository.state.onDidChange`
 *    is a change signal we get for free (see ensureRepoStateWatch). A worktree
 *    with an open repository needs no poll at all: something else is paying for
 *    the watcher, and it tells us when to look.
 *  - A worktree with no open repository has no such signal. Nothing sees a file
 *    an agent writes there, so the only way to keep its counts current is to ask
 *    git on a timer.
 *
 * So the poll is for the second group only, and it can afford to be slow: a card
 * the Source Control view is not showing cannot contradict the Source Control
 * view, which is the standard the old flat 2s rate was set against. The first
 * group keeps a much longer interval purely as a backstop, because "the Git
 * extension will tell us" is an assumption a user can switch off underneath us
 * (`git.autorefresh`), and a card that silently freezes forever is worse than one
 * that costs a status every half minute.
 *
 * This is deliberately a pure function over a snapshot rather than per-card
 * timers: the caller already runs one tick for the agent rows, and deciding the
 * whole set at once is what keeps "how often does this spawn git" answerable.
 */

/** A card the poll could stat. */
export interface PollCard {
  /** Normalized worktree root. */
  path: string;
  /**
   * An agent is working in this worktree, so its numbers are moving. Cards
   * without one are not polled at all: nothing is changing that the next
   * discrete signal (a save, a focus, the Refresh button) will not catch.
   */
  working: boolean;
}

export interface PollInput {
  cards: readonly PollCard[];
  /**
   * Normalized roots of the repositories the Git extension has open, i.e. the
   * cards that have their own change event. Derived from the live subscription
   * map rather than remembered separately, so a repository closing (the Source
   * Control scope button closes every other one) moves that card back onto the
   * poll on its own.
   */
  watched: ReadonlySet<string>;
  /** Epoch ms each worktree's status was last read. */
  statusAt: ReadonlyMap<string, number>;
  now: number;
  /** Interval for a card with no change event of its own. */
  pollMs: number;
  /** Backstop interval for a card that has one. */
  watchedMs: number;
}

/** Normalized roots to run `git status` for on this tick. */
export function dueForStatus(input: PollInput): string[] {
  const { cards, watched, statusAt, now, pollMs, watchedMs } = input;
  const due: string[] = [];
  for (const card of cards) {
    if (!card.working) continue;
    const every = watched.has(card.path) ? watchedMs : pollMs;
    if (now - (statusAt.get(card.path) ?? 0) >= every) due.push(card.path);
  }
  return due;
}

/** Lowest poll rate the setting accepts, in seconds. Below this the tier exists
 *  in name only: a status on a large repository can itself take seconds, so a
 *  faster rate just means git is always running. */
export const MIN_POLL_SECONDS = 2;
/** Highest the setting accepts. Past this a card with a working agent reads as
 *  broken rather than slow. */
export const MAX_POLL_SECONDS = 60;
/** Default rate for a card with no change event of its own. */
export const DEFAULT_POLL_SECONDS = 10;

/**
 * The configured poll rate as milliseconds, defended against whatever is
 * actually in settings.json. A user (or a bad merge) can put a string, a
 * negative, or nothing there; `package.json` bounds only what the settings UI
 * offers, not what the file may contain, and a zero here would mean a git spawn
 * per tick.
 */
export function pollIntervalMs(seconds: unknown): number {
  const n = typeof seconds === "number" && Number.isFinite(seconds) ? seconds : NaN;
  if (Number.isNaN(n)) return DEFAULT_POLL_SECONDS * 1_000;
  return Math.min(MAX_POLL_SECONDS, Math.max(MIN_POLL_SECONDS, Math.round(n))) * 1_000;
}
