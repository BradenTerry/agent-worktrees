import * as vscode from "vscode";
import { RemoteInfo } from "./git";
import { PrInfo, fetchPr, getToken } from "./github";

/**
 * Background PR-status service.
 *
 * Holds a per-worktree cache of PR status and keeps it fresh on an adaptive
 * timer. Every fetch is gated on (a) the integration being enabled and (b) a
 * stored token — with neither, the service does no network work and reports no
 * PRs. Fetches never throw out (see github.fetchPr), and a failed refresh keeps
 * the previous data rather than blanking the panel.
 */

/** A branch we want PR status for, with the repo it lives in. */
export interface PrTarget {
  /** Normalized worktree path — the cache key the panel looks up by. */
  key: string;
  branch: string;
  repo: RemoteInfo;
}

const ENABLED_KEY = "agentWorktrees.prEnabled";
/** Poll cadence while CI is settled vs. while a check is still running. */
const IDLE_MS = 90_000;
const ACTIVE_MS = 15_000;
/** After a push (head SHA changed) poll quickly for a window so the new pending
 *  checks appear soon, even before any "pending" status exists to fetch. */
const PUSH_MS = 7_000;
const PUSH_WINDOW_MS = 90_000;
/** Refuse to refetch within this window unless forced. */
const THROTTLE_MS = 4_000;

export class PrService implements vscode.Disposable {
  private readonly _onChange = new vscode.EventEmitter<void>();
  /** Fires when the PR cache changes in a way the panel should re-render for. */
  readonly onChange = this._onChange.event;

  private targets: PrTarget[] = [];
  /** key -> PR status (null = looked up, no PR). Absent = not yet fetched. */
  private cache = new Map<string, PrInfo | null>();
  private enabled: boolean;
  private visible = true;
  private timer?: ReturnType<typeof setTimeout>;
  private lastFetch = 0;
  private inFlight = false;
  /** Last seen head SHA per target, to detect a push between fetches. */
  private headShas = new Map<string, string | undefined>();
  /** While now < this, poll on the fast push cadence. */
  private fastUntil = 0;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.enabled = context.globalState.get<boolean>(ENABLED_KEY, true);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this._onChange.dispose();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async setEnabled(on: boolean): Promise<void> {
    this.enabled = on;
    await this.context.globalState.update(ENABLED_KEY, on);
    if (!on) {
      // Drop everything so the panel stops showing PR badges immediately.
      this.stop();
      if (this.cache.size) {
        this.cache.clear();
        this._onChange.fire();
      }
    } else {
      void this.refresh(true);
    }
  }

  /** Cached PR status for a worktree, or undefined when not (yet) known. */
  get(key: string): PrInfo | null | undefined {
    return this.cache.get(key);
  }

  /** Replace the set of branches to track; kicks a refresh when it changed. */
  setTargets(targets: PrTarget[]): void {
    const sig = (t: PrTarget[]) =>
      t
        .map((x) => `${x.key}|${x.repo.owner}/${x.repo.repo}|${x.branch}`)
        .sort()
        .join("\n");
    const changed = sig(targets) !== sig(this.targets);
    this.targets = targets;
    // Forget cache entries for worktrees that are gone.
    const live = new Set(targets.map((t) => t.key));
    let pruned = false;
    for (const k of [...this.cache.keys()]) {
      if (!live.has(k)) {
        this.cache.delete(k);
        this.headShas.delete(k);
        pruned = true;
      }
    }
    if (pruned) this._onChange.fire();
    if (changed) void this.refresh(true);
    else this.ensureScheduled();
  }

  /** Pause polling while the panel is hidden; refresh on re-show. */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (visible) void this.refresh(false);
    else this.stop();
  }

  /** Clear the cache and force a fresh fetch (after a token change). */
  reauth(): void {
    this.cache.clear();
    this.headShas.clear();
    this.fastUntil = 0;
    this._onChange.fire();
    void this.refresh(true);
  }

  // --- internals -------------------------------------------------------------

  private stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private ensureScheduled(): void {
    if (!this.enabled || !this.visible || this.timer || !this.targets.length) {
      return;
    }
    const anyPending = [...this.cache.values()].some(
      (p) => p && p.checks === "pending"
    );
    const pushing = Date.now() < this.fastUntil;
    const delay = pushing ? PUSH_MS : anyPending ? ACTIVE_MS : IDLE_MS;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh(false);
    }, delay);
  }

  /**
   * Refresh every target's PR status. No-op without a token or when disabled.
   * Throttled unless `force`. Any single fetch failure is swallowed (the prior
   * value is kept), so one bad branch never wipes the board.
   */
  async refresh(force: boolean): Promise<void> {
    this.stop();
    if (!this.enabled || !this.visible) return;
    if (this.inFlight) return;
    const now = Date.now();
    if (!force && now - this.lastFetch < THROTTLE_MS) {
      this.ensureScheduled();
      return;
    }

    const token = await getToken();
    if (!token) {
      // No token: ensure no stale PR data lingers, then stay idle.
      if (this.cache.size) {
        this.cache.clear();
        this._onChange.fire();
      }
      return;
    }

    this.inFlight = true;
    this.lastFetch = now;
    let changed = false;
    try {
      const targets = this.targets;
      const results = await Promise.all(
        targets.map(async (t) => {
          try {
            return await fetchPr(token, t.repo, t.branch);
          } catch {
            // Hard failure on one branch — keep whatever we had for it.
            return this.cache.has(t.key)
              ? (this.cache.get(t.key) as PrInfo | null)
              : null;
          }
        })
      );
      targets.forEach((t, i) => {
        const next = results[i];
        if (sigOf(this.cache.get(t.key)) !== sigOf(next)) changed = true;
        this.cache.set(t.key, next);
        // A new head SHA means a push landed; the fresh checks may not exist
        // yet, so poll fast for a window instead of dropping back to idle.
        const prevSha = this.headShas.get(t.key);
        const nextSha = next?.headSha;
        if (prevSha && nextSha && prevSha !== nextSha) {
          this.fastUntil = now + PUSH_WINDOW_MS;
        }
        this.headShas.set(t.key, nextSha);
      });
    } finally {
      this.inFlight = false;
    }
    if (changed) this._onChange.fire();
    this.ensureScheduled();
  }
}

/** Stable fingerprint of the display-relevant PR fields. */
function sigOf(p: PrInfo | null | undefined): string {
  if (!p) return "none";
  return [
    p.number,
    p.state,
    p.checks,
    p.checksPass,
    p.checksFail,
    p.checksPending,
    p.review,
    p.approvals,
    p.changesRequested,
    p.reviewsPending,
    p.comments,
    p.mergeState ?? "",
    p.autoMerge ? 1 : 0,
  ].join(":");
}
