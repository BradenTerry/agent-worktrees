/**
 * Coalesces a burst of triggers into a single deferred run.
 *
 * The panel reacts to three chatty signals: workspace file changes (the global
 * file watcher), Claude session-state writes (one per hook event), window focus.
 * Each refresh spawns `git status` + `git diff` for every worktree, so reacting
 * to every raw event is wasteful — and markedly worse on Windows, where the file
 * watcher fires more events and every process spawn is far more expensive than
 * on macOS. A flood of events should collapse into one refresh.
 *
 * This is a trailing debounce with two extra guarantees that matter under a
 * sustained Windows event stream:
 *
 *  - A `maxDelay` cap: a plain debounce that resets on every event never fires
 *    while events keep arriving faster than `delay`. The cap forces a flush so
 *    the panel still updates at a bounded rate during continuous activity (e.g.
 *    a build writing files, or an agent streaming tool events).
 *  - In-flight coalescing: the run callback may be async (a refresh). Triggers
 *    that arrive while a run is in progress collapse into exactly one follow-up
 *    run after it settles, so refreshes never overlap and pile up spawns.
 *
 * The clock is injectable so the behaviour can be unit-tested deterministically
 * with virtual time rather than real timers.
 */

/** The timer surface the coalescer needs; injectable for tests. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

/** Real timers, used in production. */
export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

export class Coalescer {
  private handle?: ReturnType<typeof setTimeout>;
  /** When the current pending window opened, for the maxDelay cap. */
  private windowStart = 0;
  /** A run callback is currently executing. */
  private running = false;
  /** A trigger arrived during a run; do exactly one follow-up when it settles. */
  private queued = false;

  /**
   * @param run       Work to perform; may be sync or async.
   * @param delayMs   Quiet period after the last trigger before running.
   * @param maxDelayMs Upper bound on how long a continuous stream of triggers
   *                  can defer a run. Defaults to 10x `delayMs`.
   * @param clock     Timer source; defaults to real timers.
   */
  constructor(
    private readonly run: () => void | Promise<void>,
    private readonly delayMs: number,
    private readonly maxDelayMs: number = delayMs * 10,
    private readonly clock: Clock = realClock
  ) {}

  /** Request a run, coalescing with any already-pending or in-flight request. */
  trigger(): void {
    if (this.running) {
      // Don't interleave with an active run; fold into a single follow-up.
      this.queued = true;
      return;
    }
    const now = this.clock.now();
    if (this.handle === undefined) {
      this.windowStart = now;
    } else {
      this.clock.clearTimeout(this.handle);
      this.handle = undefined;
      // Sustained stream: once we've deferred as long as we're willing to,
      // flush now instead of resetting the debounce yet again.
      if (now - this.windowStart >= this.maxDelayMs) {
        void this.fire();
        return;
      }
    }
    this.handle = this.clock.setTimeout(() => {
      this.handle = undefined;
      void this.fire();
    }, this.delayMs);
  }

  /** Run immediately, cancelling any pending timer (coalescing if mid-run). */
  flush(): void {
    if (this.running) {
      this.queued = true;
      return;
    }
    if (this.handle !== undefined) {
      this.clock.clearTimeout(this.handle);
      this.handle = undefined;
    }
    void this.fire();
  }

  private async fire(): Promise<void> {
    this.running = true;
    this.queued = false;
    try {
      await this.run();
    } finally {
      this.running = false;
      if (this.queued) {
        this.queued = false;
        this.trigger();
      }
    }
  }

  /** Cancel any pending run. Does not interrupt one already executing. */
  cancel(): void {
    if (this.handle !== undefined) {
      this.clock.clearTimeout(this.handle);
      this.handle = undefined;
    }
    this.queued = false;
  }

  /** True while a run is scheduled or executing. */
  get pending(): boolean {
    return this.handle !== undefined || this.running;
  }
}
