/**
 * `${input:...}` variables, isolated from the VS Code API so they can be
 * unit-tested.
 *
 * A launch.json (or tasks.json) may parameterize a configuration with input
 * variables, declared in the file's own top-level `inputs` array and referenced
 * as `${input:<id>}`. VS Code resolves those against the **workspace folder's**
 * file: it prompts from the primary checkout's `inputs`, so a worktree's own
 * declarations are invisible. A configuration referring to an id the primary
 * folder does not declare fails to start at all, and one whose id happens to
 * exist there is prompted with the wrong definition.
 *
 * Since the panel already reads the worktree's launch.json itself (see
 * ./debugTargets), it resolves the references itself too, and hands
 * startDebugging a configuration with no `${input:...}` left in it.
 */

/** The input types launch.json and tasks.json declare. */
export type InputKind = "promptString" | "pickString" | "command";

/** One choice offered by a `pickString` input. */
export interface PickOption {
  label: string;
  value: string;
}

/**
 * An `inputs` entry, as far as this feature reads it. Fields are per-type:
 * `password` is promptString's, `options` pickString's, `command`/`args`
 * command's.
 */
export interface InputDef {
  id: string;
  type: InputKind;
  description?: string;
  default?: string;
  password?: boolean;
  options?: PickOption[];
  command?: string;
  args?: unknown;
}

/** `${input:some-id}`. Built per use: a shared global regex keeps `lastIndex`. */
const inputRef = (): RegExp => /\$\{input:([^}\s]+)\}/g;

/** One `pickString` option: a bare string, or a `{ label, value }` pair. */
function pickOption(raw: unknown): PickOption | undefined {
  if (typeof raw === "string") return { label: raw, value: raw };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as { label?: unknown; value?: unknown };
  if (typeof r.value !== "string") return undefined;
  const label = typeof r.label === "string" && r.label ? r.label : r.value;
  return { label, value: r.value };
}

/**
 * The usable `inputs` entries of an already-parsed launch.json or tasks.json.
 *
 * An entry that could not be prompted for is dropped rather than half-kept: a
 * `pickString` with no options, or a `command` input with no command, has nothing
 * to resolve to. A configuration referencing a dropped entry then reads as
 * "undeclared", which is what the caller reports and refuses to launch on -
 * better than prompting for something meaningless.
 */
export function parseInputs(parsed: unknown): InputDef[] {
  if (!parsed || typeof parsed !== "object") return [];
  const raw = (parsed as { inputs?: unknown }).inputs;
  if (!Array.isArray(raw)) return [];

  const out: InputDef[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const r = entry as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id) continue;
    if (
      r.type !== "promptString" &&
      r.type !== "pickString" &&
      r.type !== "command"
    ) {
      continue;
    }
    const def: InputDef = { id: r.id, type: r.type };
    if (typeof r.description === "string") def.description = r.description;
    if (typeof r.default === "string") def.default = r.default;

    if (r.type === "promptString") {
      if (r.password === true) def.password = true;
    } else if (r.type === "pickString") {
      const options = Array.isArray(r.options)
        ? r.options
            .map(pickOption)
            .filter((o): o is PickOption => !!o)
        : [];
      if (!options.length) continue;
      def.options = options;
    } else {
      if (typeof r.command !== "string" || !r.command) continue;
      def.command = r.command;
      if (r.args !== undefined) def.args = r.args;
    }
    // A later duplicate id is ignored, as the first declaration is the one
    // VS Code's own schema means.
    if (out.some((d) => d.id === def.id)) continue;
    out.push(def);
  }
  return out;
}

/**
 * Every input id a value refers to, in first-appearance order, walking nested
 * objects and arrays. Order is what decides the order of the prompts, so it
 * follows the configuration as written.
 */
export function inputRefs(value: unknown): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      for (const m of v.matchAll(inputRef())) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        found.push(m[1]);
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    if (v && typeof v === "object") {
      for (const item of Object.values(v as Record<string, unknown>)) walk(item);
    }
  };
  walk(value);
  return found;
}

/**
 * Deep-replace `${input:<id>}` with the resolved values, returning a copy.
 *
 * A reference with no value is left verbatim rather than emptied: the caller
 * refuses to launch on an undeclared id, and an untouched `${input:...}` in a
 * diagnostic reads as the mistake it is.
 */
export function applyInputValues(
  value: unknown,
  values: Record<string, string>
): unknown {
  if (typeof value === "string") {
    return value.replace(inputRef(), (whole, id: string) =>
      Object.prototype.hasOwnProperty.call(values, id) ? values[id] : whole
    );
  }
  if (Array.isArray(value)) {
    return value.map((v) => applyInputValues(v, values));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = applyInputValues(v, values);
    }
    return out;
  }
  return value;
}
