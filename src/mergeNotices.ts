/**
 * Which pull requests deserve a toast for having auto-merged.
 *
 * A PR with auto-merge enabled lands without the user doing anything, which is
 * the one merge they were not watching for: they turned auto-merge on so they
 * could go and do something else. The card's PR pill flips to "merged" when
 * the poll notices, but the pill terminates inside the panel like every other
 * signal there. A notification is the channel that reaches them behind
 * another application, exactly as for a blocked agent (see waitingNotices).
 *
 * The rule is the same shape too: one toast per merge, decided by a transition
 * this module watched happen. A PR that is already merged when the window opens
 * is never announced, because it was never seen open with auto-merge on first.
 */

/** A PR that just auto-merged, reduced to what a toast has to say. */
export interface MergedPr {
  number: number;
  title: string;
  url: string;
  /** The worktree whose branch the PR was for. */
  where: string;
}

/** Config key for the mode. Same values as the waiting-agent setting. */
export const NOTIFY_PR_MERGED_SETTING = "agentWorktrees.notifyPrMerged";

/** Shape of the payload this module reads. Structural, so the real
 *  `WorktreeVM`/`PrInfo` satisfy it without this module importing them. */
interface WorktreeLike {
  path: string;
  name: string;
  pr?: {
    number: number;
    title: string;
    url: string;
    state: string;
    autoMerge?: boolean;
  } | null;
}

/**
 * Reconcile the PRs on this payload against the ones seen open with auto-merge
 * on, and return the ones that have just merged.
 *
 * `armed` is updated in place and maps a worktree path to the PR number it was
 * last seen auto-merging. A worktree whose PR is open with auto-merge enabled
 * is armed; one whose PR is then seen merged with that same number fires and is
 * disarmed; anything else (no PR, a different PR, auto-merge switched off,
 * closed without merging) disarms it silently. Keying by worktree and number
 * together is what stops a card that switches branches onto an already-merged
 * PR from announcing a merge nobody was waiting on.
 *
 * There is no seeding step, unlike newlyWaiting: firing needs an earlier
 * payload to have armed the entry, so the first payload after a window opens
 * can only arm, never announce.
 */
export function newlyMerged(
  worktrees: ReadonlyArray<WorktreeLike>,
  armed: Map<string, number>
): MergedPr[] {
  const live = new Set(worktrees.map((wt) => wt.path));
  for (const key of armed.keys()) if (!live.has(key)) armed.delete(key);
  const fresh: MergedPr[] = [];
  for (const wt of worktrees) {
    const pr = wt.pr;
    if (!pr) {
      armed.delete(wt.path);
      continue;
    }
    const open = pr.state === "open" || pr.state === "draft";
    if (open && pr.autoMerge) {
      armed.set(wt.path, pr.number);
      continue;
    }
    if (pr.state === "merged" && armed.get(wt.path) === pr.number) {
      fresh.push({
        number: pr.number,
        title: pr.title,
        url: pr.url,
        where: wt.name,
      });
    }
    armed.delete(wt.path);
  }
  return fresh;
}

/** What one toast says. The number is what the user knows the PR by; the
 *  worktree is what tells two toasts apart when several branches land at once. */
export function mergedText(pr: MergedPr): string {
  const head = `#${pr.number} auto-merged`;
  const title = pr.title ? `: ${pr.title}` : "";
  return pr.where ? `${head} in ${pr.where}${title}` : `${head}${title}`;
}
