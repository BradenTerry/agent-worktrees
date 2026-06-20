/**
 * Source Control scope algorithm, isolated from the VS Code API so it can be
 * unit-tested against a fake Git model.
 *
 * "Scoping" means making a worktree's repository the one shown in the Source
 * Control view. When a single repo is currently open we swap it out (close the
 * others) so only the target remains; when several are open we leave them
 * (non-destructive) and just ensure the target is among them.
 *
 * The tricky case is a git worktree whose main repository is already open. Some
 * Git models refuse to register the worktree while the main repo is open (they
 * dedupe by the shared git dir), so closing the previous scope can leave the
 * panel with NO active scope: the main repo is gone and the worktree never took.
 * That is the "had to click twice" bug. We defend against it by re-opening the
 * target after the close if it dropped out.
 */

/** The slice of a Git model this algorithm drives. Paths are normalized roots. */
export interface ScmModel {
  /** Normalized root paths of the currently-open repositories. */
  list(): string[];
  /** Open the repository at this normalized root path (idempotent). */
  open(path: string): Promise<void>;
  /** Close the repository at this normalized root path. */
  close(path: string): Promise<void>;
}

const SETTLE_TRIES = 24;
const SETTLE_DELAY_MS = 25;

/**
 * Scope Source Control to `target`. Opens it, swaps out a lone previous repo,
 * self-heals if that close drops the target, and waits for the Git model to
 * reflect the result before returning.
 */
export async function applyScopeScm(
  model: ScmModel,
  target: string,
  opts: { sleep?: (ms: number) => Promise<void> } = {}
): Promise<void> {
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  // Decide swap-vs-keep from the scope *before* we touch anything.
  const wasMultiple = model.list().length > 1;

  await model.open(target);
  // Let the open register before we close the old scope, so the close loop sees
  // the target and we never tear down the only repo prematurely.
  await settle(model, target, false, sleep);

  if (!wasMultiple) {
    for (const root of model.list()) {
      if (root !== target) await model.close(root);
    }
    // If closing the previous single repo dropped the target (worktree-vs-main
    // dedupe), re-open it now that the conflicting repo is gone. This is the fix
    // for the "select again to make it stick" bug.
    if (!model.list().includes(target)) {
      await model.open(target);
    }
  }

  // Wait for the model to reflect the final scope: target present, and the only
  // one when we swapped a single repo.
  await settle(model, target, !wasMultiple, sleep);
}

/**
 * Poll the model (briefly, bounded) until it reflects the wanted scope: the
 * target is present and, when `sole`, it is the only repo. Returns early once
 * settled, or after the timeout regardless.
 */
async function settle(
  model: ScmModel,
  target: string,
  sole: boolean,
  sleep: (ms: number) => Promise<void>
): Promise<void> {
  for (let i = 0; i < SETTLE_TRIES; i++) {
    const paths = model.list();
    const present = paths.includes(target);
    const done = present && (!sole || paths.every((p) => p === target));
    if (done) return;
    await sleep(SETTLE_DELAY_MS);
  }
}
