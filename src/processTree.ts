import * as cp from "child_process";

/**
 * Reading the OS process tree, so a panel row can find the terminal it is
 * running in even when no id links them.
 *
 * Why this exists: the extension launches an agent with a session id it
 * generates, and keys the terminal by it. That is not necessarily the id the
 * agent reports to Claude's session registry, and the registry is where every
 * row comes from. Observed on a live 2.1.220 session:
 *
 *   registry:  { sessionId: "9cb50d5b-...", pid: 63074 }
 *   argv:      claude --session-id c19e3fe7-...          <- the id we launched
 *   ancestry:  63074 -> claude 62919 -> /bin/zsh 47236 -> Code Helper
 *
 * The registered process is a *child* of the one we started, and it carries a
 * different id. So "which terminal is this row?" cannot be answered by id at
 * all, and answering it wrong is what made Reveal say "this agent's terminal
 * isn't in this window" about a terminal the user was looking at, and made Stop
 * kill nothing (`pkill -f <session id>` matches an argv that does not contain
 * it).
 *
 * What does answer it: a terminal's shell pid is an ancestor of every process
 * running in that terminal, and of nothing else. That is also inherently
 * per-window, which is exactly the question being asked.
 *
 * This is read at most once per session: on the click that needs it (Reveal,
 * Stop), or on the refresh that first shows the row, which links it ahead of the
 * click so the click itself costs nothing (see warmTerminalLinks). Either way it
 * is one read per session and never one per refresh, which is why it takes a
 * whole snapshot rather than walking parent by parent.
 */

/** Child pid -> parent pid, for every process the user can see. */
export type ParentMap = Map<number, number>;

/**
 * Whether a command line belongs to Claude.
 *
 * The gate on every kill and every terminal match, because a pid alone is not
 * proof of identity. A session that died without removing its registry file (a
 * SIGKILL, a crash, the power going out) leaves an entry whose pid the OS is free
 * to hand to something else, and the liveness probe is a bare existence check
 * that cannot tell the difference. Acting on that pid would mean killing an
 * innocent process tree on a Stop click.
 *
 * Matches the path as well as the argv0, since Claude ships as a versioned binary
 * (`~/.local/share/claude/versions/2.1.220 --session-id ...`) and as `node
 * .../claude/cli.js`; both carry `claude` in the path even when the process name
 * is `node`.
 *
 * What it deliberately does NOT do is search the whole command line. `claude`
 * appears in the arguments of plenty of processes that are not Claude - every
 * editor, pager and `tail` pointed at something in `~/.claude`, this extension's
 * own tests included - and a recycled pid running `vim ~/.claude/settings.json`
 * matched, which is exactly the process a Stop click would then have killed.
 * Only the program being run is considered: argv0, plus the script argument when
 * argv0 is a JS runtime, which is the one case where the identifying path is not
 * argv0 at all.
 */
export function namesClaude(commandLine: string): boolean {
  const tokens = commandLine.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  if (isClaudeProgram(tokens[0])) return true;
  // `node .../claude/cli.js`, and the Windows reading, which prefixes the
  // command line with the process name (`node.exe node.exe ...\cli.js`). Only a
  // script path counts here, never a data file: `~/.claude/settings.json` is an
  // argument to something else, not Claude being run.
  return tokens.slice(1).some(isClaudeScript);
}

/** Path segments of a token, separator-agnostic (a Windows path reaches this
 *  with backslashes, a POSIX one with slashes). */
function segmentsOf(token: string): string[] {
  return token.split(/[/\\]/).filter(Boolean);
}

/** Whether a program path is Claude: named `claude`, or living in a directory
 *  named `claude` (the versioned binary is named for its version, so its
 *  directory is the only thing that identifies it). */
function isClaudeProgram(token: string): boolean {
  const segments = segmentsOf(token);
  if (!segments.length) return false;
  const base = segments[segments.length - 1].toLowerCase();
  if (/^claude(\.(exe|cmd|bat))?$/.test(base)) return true;
  return segments
    .slice(0, -1)
    .some((s) => s.toLowerCase() === "claude" || s.toLowerCase() === ".claude");
}

/** Whether an argument is Claude's own entry script rather than a file handed
 *  to some other program. */
function isClaudeScript(token: string): boolean {
  const segments = segmentsOf(token);
  if (!segments.length) return false;
  const base = segments[segments.length - 1].toLowerCase();
  if (/^claude(\.(exe|cmd|bat))?$/.test(base)) return true;
  if (!/\.(js|mjs|cjs)$/.test(base)) return false;
  return segments.some((s) => s.toLowerCase() === "claude" || s.toLowerCase() === ".claude");
}

/**
 * Parse `ps -Ao pid=,ppid=` output (macOS, Linux).
 *
 * Both columns are right-aligned and space-padded, and the header is suppressed
 * by the trailing `=` on each format spec. Anything that is not two integers is
 * skipped rather than guessed at.
 */
export function parsePsTree(stdout: string): ParentMap {
  const map: ParentMap = new Map();
  for (const line of stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!m) continue;
    map.set(Number(m[1]), Number(m[2]));
  }
  return map;
}

/**
 * Parse the Windows process list as emitted by the PowerShell one-liner below:
 * `<pid>,<ppid>`, one process per line.
 *
 * The order is fixed by the command that produced it, so it is not inferred:
 * pid first, parent second. CRLF, blank lines and any non-numeric line (a
 * header, a PowerShell warning) are skipped rather than guessed at. Deliberately
 * not `wmic`, whose CSV puts the columns the other way round - it is deprecated
 * and removed from Windows 11 24H2, so it is not a fallback worth carrying.
 */
export function parseWindowsTree(stdout: string): ParentMap {
  const map: ParentMap = new Map();
  for (const raw of stdout.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(raw);
    if (!m) continue;
    map.set(Number(m[1]), Number(m[2]));
  }
  return map;
}

/** Command used to read the process table on this platform. */
function treeCommand(): { file: string; args: string[]; windows: boolean } {
  if (process.platform === "win32") {
    return {
      file: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        // Get-CimInstance rather than the deprecated (and, from Windows 11 24H2,
        // removed) wmic. One line per process, `pid,ppid`, no table formatting to
        // re-parse.
        //
        // Single quotes and string concatenation on purpose: Node wraps this
        // argument in double quotes for the Windows command line and escapes any
        // double quote inside it, so a `"$($_.ProcessId)"` interpolation arrives
        // at PowerShell mangled. Nothing here needs a double quote or a
        // subexpression, so nothing here has one.
        "Get-CimInstance Win32_Process | ForEach-Object { $_.ProcessId.ToString() + ',' + $_.ParentProcessId.ToString() }",
      ],
      windows: true,
    };
  }
  return { file: "ps", args: ["-Ao", "pid=,ppid="], windows: false };
}

/**
 * The process table as a child -> parent map, or an empty map when it cannot be
 * read. Never throws and never rejects: every caller has a fallback that is
 * merely less capable, and a failed process listing must not break a click.
 */
/**
 * The last listing and when it was taken, so a burst of callers shares one.
 *
 * Removing a worktree stops every agent in it at once, and a Reveal on a row
 * whose terminal is genuinely in another window never caches anything, so
 * without this a single click could launch several process-table reads - which on
 * Windows means several PowerShell cold starts. One second is long enough to
 * collapse a burst and far too short for a process to be born, do something and
 * die inside it.
 */
let snapshot: { at: number; map: Promise<ParentMap> } | undefined;
const SNAPSHOT_TTL_MS = 1_000;

/** `readParentMap`, sharing one listing across a burst of callers. */
export function parentMapSnapshot(now: number = Date.now()): Promise<ParentMap> {
  if (snapshot && now - snapshot.at < SNAPSHOT_TTL_MS) return snapshot.map;
  const map = readParentMap();
  snapshot = { at: now, map };
  return map;
}

/** Drop the shared listing (tests, and anything that must not see a stale one). */
export function clearParentMapSnapshot(): void {
  snapshot = undefined;
}

export function readParentMap(
  exec: typeof cp.execFile = cp.execFile
): Promise<ParentMap> {
  const { file, args, windows } = treeCommand();
  return new Promise<ParentMap>((resolve) => {
    try {
      exec(
        file,
        args,
        { windowsHide: true, timeout: 5_000, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout) => {
          if (err && !stdout) return resolve(new Map());
          const text = typeof stdout === "string" ? stdout : String(stdout ?? "");
          resolve(windows ? parseWindowsTree(text) : parsePsTree(text));
        }
      );
    } catch {
      resolve(new Map()); // no ps / no powershell on PATH
    }
  });
}

/**
 * The command line of one pid, or "" when it cannot be read (already gone, or
 * owned by another user). Never throws.
 *
 * One process, not a table: this answers "is the pid on this row still the Claude
 * it claims to be", and it is asked only when something destructive or cached is
 * about to happen. On Windows `CommandLine` is null for processes another user
 * owns, so the name is included too - a process we cannot read the command line
 * of is one we are not going to kill anyway.
 */
export function readCommandLine(
  pid: number,
  exec: typeof cp.execFile = cp.execFile
): Promise<string> {
  const win = process.platform === "win32";
  const file = win ? "powershell.exe" : "ps";
  const args = win
    ? [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        // Single quotes only, for the same Windows arg-escaping reason as
        // treeCommand(). -Filter keeps this to one process rather than a sweep.
        `Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | ForEach-Object { $_.Name + ' ' + $_.CommandLine }`,
      ]
    : ["-p", String(pid), "-o", "command="];
  return new Promise<string>((resolve) => {
    try {
      exec(
        file,
        args,
        { windowsHide: true, timeout: 5_000, maxBuffer: 1024 * 1024 },
        (_err, stdout) => resolve(typeof stdout === "string" ? stdout.trim() : "")
      );
    } catch {
      resolve("");
    }
  });
}

/**
 * Every ancestor of `pid`, nearest first, excluding `pid` itself.
 *
 * Cycle-safe (a malformed table must not hang a click) and bounded: a process
 * tree deeper than 64 is not a tree we need to walk further up.
 */
export function ancestorsOf(pid: number, parents: ParentMap): number[] {
  const out: number[] = [];
  const seen = new Set<number>([pid]);
  let cur = parents.get(pid);
  while (cur !== undefined && cur > 0 && !seen.has(cur) && out.length < 64) {
    out.push(cur);
    seen.add(cur);
    cur = parents.get(cur);
  }
  return out;
}

/**
 * Whether `pid` is `ancestor` or runs somewhere beneath it.
 *
 * This is the question "is this session running in that terminal?": a terminal's
 * shell pid is an ancestor of everything started in it. Note that the shell need
 * not be the direct parent - `claude -w` puts one more claude process in
 * between - which is the whole reason this is an ancestor test and not a
 * parent test.
 */
export function isDescendantOf(
  pid: number,
  ancestor: number,
  parents: ParentMap
): boolean {
  if (pid === ancestor) return true;
  return ancestorsOf(pid, parents).includes(ancestor);
}
