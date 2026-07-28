/**
 * Removing this extension's hook entries from Claude's settings.json.
 *
 * Split out of hooks.ts so the pure test suite can require it without the
 * extension host. The pruning has to be exact in both directions - every entry
 * we added goes, nothing else is touched - because that file is the user's, is
 * shared with every Claude session on their machine, and they never asked us to
 * edit anyone else's hooks.
 */

/** Names the emitter script and the launcher that ran it, so an entry is
 *  recognized as ours whichever of the two its command invoked. */
export const EMITTER_STEM = "agent-worktrees-emit";

export type HookEntry = {
  matcher?: string;
  hooks?: { type?: string; command?: string }[];
};
export type Settings = {
  hooks?: Record<string, HookEntry[]>;
  [k: string]: unknown;
};

/** Ours if the command runs the emitter, or the launcher that ran it. */
function isOurs(hook: { command?: string }): boolean {
  return typeof hook.command === "string" && hook.command.includes(EMITTER_STEM);
}

/**
 * Strip our hooks from a settings object, reporting whether anything changed.
 * Mutates in place; the caller writes the file only when this returns true.
 */
export function pruneOurHooks(settings: Settings): boolean {
  const events = settings.hooks;
  if (!events || typeof events !== "object") return false;
  let changed = false;
  for (const [event, entries] of Object.entries(events)) {
    if (!Array.isArray(entries)) continue;
    const kept: HookEntry[] = [];
    let touched = false;
    for (const entry of entries) {
      const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
      const survivors = hooks.filter((h) => !isOurs(h));
      if (survivors.length === hooks.length) {
        kept.push(entry);
        continue;
      }
      touched = true;
      // One matcher entry can hold several commands. Keep it, minus ours; drop
      // it entirely only when we were all it had.
      if (survivors.length) kept.push({ ...entry, hooks: survivors });
    }
    if (!touched) continue;
    changed = true;
    if (kept.length) events[event] = kept;
    else delete events[event];
  }
  // An empty `hooks: {}` is meaningful to nobody, and we are the reason it is
  // empty - but only remove it if we are what emptied it.
  if (changed && !Object.keys(events).length) delete settings.hooks;
  return changed;
}
