/**
 * Which blocked agents deserve a toast, and when.
 *
 * The panel's existing attention signals - the pulsing dot, the row outline,
 * the collapsed-group badge, the Activity Bar count - all terminate inside the
 * panel or the Activity Bar. None of them reach you once VS Code is behind
 * another application, which is exactly when an agent sitting on a permission
 * prompt costs the most. A notification is the only channel that does.
 *
 * It is also the only one that can become noise, so the rules here are
 * deliberately conservative: one toast per *entry* into waiting, never a repeat
 * while the agent stays there, and nothing at all for the agents that were
 * already waiting when the window opened.
 */

/** An agent that needs the user, reduced to what a toast has to say. */
export interface WaitingAgent {
  sessionId: string;
  /** The agent's row label: Claude's work summary, or its ordinal fallback. */
  label: string;
  /** The worktree it is working in, so a stack of toasts can be told apart. */
  where: string;
}

/** When to interrupt with a toast. */
export type NotifyWaitingMode = "off" | "unfocused" | "always";

/** Config key for the mode. */
export const NOTIFY_WAITING_SETTING = "agentWorktrees.notifyWaiting";

const MODES: readonly NotifyWaitingMode[] = ["off", "unfocused", "always"];

/**
 * The setting, made safe to act on. It is hand-editable like any other, and a
 * value this does not recognize must not be guessed at in the direction of
 * interrupting the user - so anything unknown reads as the default rather than
 * as "always".
 */
export function notifyMode(raw: unknown): NotifyWaitingMode {
  return MODES.includes(raw as NotifyWaitingMode)
    ? (raw as NotifyWaitingMode)
    : "unfocused";
}

/** Whether a toast should be raised at all, given the mode and window focus. */
export function shouldNotify(mode: NotifyWaitingMode, focused: boolean): boolean {
  if (mode === "off") return false;
  if (mode === "always") return true;
  return !focused;
}

/** Shape of the payload this module reads. Structural, so the real
 *  `WorktreeVM`/`AgentVM` satisfy it without this module importing them. */
interface WorktreeLike {
  name: string;
  agents: ReadonlyArray<{
    sessionId: string;
    label: string;
    status: string;
  }>;
}

/** Every agent currently in the waiting status, in payload order. */
export function waitingAgents(
  worktrees: ReadonlyArray<WorktreeLike>
): WaitingAgent[] {
  const out: WaitingAgent[] = [];
  for (const wt of worktrees) {
    for (const a of wt.agents) {
      if (a.status !== "waiting") continue;
      out.push({ sessionId: a.sessionId, label: a.label, where: wt.name });
    }
  }
  return out;
}

/**
 * Reconcile what is waiting now against what has already been announced, and
 * return the agents that just entered waiting.
 *
 * `announced` is updated in place: newly waiting sessions are added, and a
 * session that has left waiting is dropped so that blocking *again* later
 * announces again. Dropping on exit rather than on the session ending is what
 * makes the second permission prompt of a long session reach you; keeping it
 * keyed by session id is what stops the same prompt announcing on every one of
 * the panel's 1s polls.
 *
 * `seed` covers the two moments when everything looks new but nothing just
 * happened - the first payload after a window opens, and the first after an
 * extension-host reload. Both would otherwise fire a toast per agent that was
 * already sitting there, which is a burst of notifications about nothing the
 * user did not already know.
 */
export function newlyWaiting(
  waiting: ReadonlyArray<WaitingAgent>,
  announced: Set<string>,
  seed = false
): WaitingAgent[] {
  const live = new Set(waiting.map((a) => a.sessionId));
  for (const id of announced) if (!live.has(id)) announced.delete(id);
  const fresh: WaitingAgent[] = [];
  for (const a of waiting) {
    if (announced.has(a.sessionId)) continue;
    announced.add(a.sessionId);
    if (!seed) fresh.push(a);
  }
  return fresh;
}

/**
 * What one toast says. The label alone is not enough once two agents block at
 * the same time and their toasts stack: two rows reading "needs you" with
 * different summaries are hard to tell apart at a glance, and the worktree is
 * the thing that says which piece of work it is.
 */
export function noticeText(a: WaitingAgent): string {
  const label = a.label || "An agent";
  return a.where ? `${label} needs you in ${a.where}` : `${label} needs you`;
}
