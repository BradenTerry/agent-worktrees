import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";

/**
 * Is the process behind a session state file still running?
 *
 * A Claude session that exits cleanly fires SessionEnd and the emitter deletes
 * its state file. Nothing fires when the session dies with its terminal — the
 * window was closed, the terminal killed, the machine restarted — so the file
 * survives with whatever state it was last in. Since the state dir is shared by
 * every VS Code window, reopening a window then renders those agents as rows
 * (sometimes mid-work, with a spinner and an Activity Bar badge) even though no
 * process and no terminal exist for them.
 *
 * Two independent probes tell a dead session from a live-but-idle one, both
 * asking the OS rather than trusting the file:
 *
 *  - `isAlive(pid)`: the emitter stamps the pid of the Claude process that ran
 *    the hook. Free (no spawn) and exact, modulo pid reuse.
 *  - `commandLines()`: the running processes' command lines. Sessions the
 *    extension launched carry their id in Claude's argv (`--session-id <id>`),
 *    which survives an extension-host reload and does not depend on being able
 *    to read another process's parent.
 *
 * Injectable so pruneDeadSessions can be unit-tested without real processes.
 */
export interface LivenessProbes {
  /** Whether `pid` still exists on this machine. */
  isAlive(pid: number): boolean;
  /** Every running process's command line, newline-joined. Empty string means
   *  the scan could not run (no `ps`/PowerShell, a timeout) — which must never
   *  be read as "nothing is running". */
  commandLines(): Promise<string>;
  /** Whether a missing pid counts as proof the session is gone. False on
   *  Windows: the pid is the hook process's parent, and where a hook is run
   *  through a short-lived shell wrapper that parent exits immediately, which
   *  would look exactly like a dead agent. A pid that is still *alive* is
   *  trusted everywhere — it can only make the sweep more conservative. */
  pidIsProof: boolean;
}

/** A scan of the whole process table is a one-off diagnostic, not a hot path,
 *  but it must not wedge a refresh if the tool hangs. */
const SCAN_TIMEOUT_MS = 5_000;
/** A process table can be large (Windows command lines especially); truncating
 *  it would drop the very line we are looking for, so allow room. */
const SCAN_MAX_BUFFER = 16 * 1024 * 1024;

/** How long after its last hook event a session becomes eligible for the sweep.
 *  An agent that is working writes far more often than this, so the grace only
 *  covers the moments when the recorded pid is legitimately out of date: a
 *  session being resumed, or one that re-execs itself, before its next event
 *  re-stamps the pid that is really running it. */
const SESSION_DEAD_GRACE = 60_000;

/** True if `pid` exists. EPERM means it exists but belongs to another user, so
 *  it counts as alive; only ESRCH (and a nonsense pid) is proof of death. */
function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    // Signal 0 performs the permission/existence check without sending anything.
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

/** Run a command and resolve its stdout, or "" on any failure. */
function capture(cmd: string, args: string[]): Promise<string> {
  return new Promise<string>((resolve) => {
    try {
      cp.execFile(
        cmd,
        args,
        {
          timeout: SCAN_TIMEOUT_MS,
          maxBuffer: SCAN_MAX_BUFFER,
          windowsHide: true,
          encoding: "utf8",
        },
        (err, stdout) => resolve(err && !stdout ? "" : stdout || "")
      );
    } catch {
      resolve(""); // spawn itself failed (missing binary)
    }
  });
}

/**
 * Every running process's command line. `ps -Ao args=` works on macOS and Linux
 * alike and is not width-truncated when its output is a pipe. Windows has no
 * equivalent, so PowerShell's CIM query stands in — the same mechanism the
 * Windows stop path already uses to find a session by its command line.
 */
function commandLines(): Promise<string> {
  if (process.platform === "win32") {
    return capture("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }",
    ]);
  }
  return capture("ps", ["-Ao", "args="]);
}

/** The real probes, used in production. */
export const systemProbes: LivenessProbes = {
  isAlive,
  commandLines,
  pidIsProof: process.platform !== "win32",
};

/**
 * The needle that proves a launched session is still running: the id as it
 * appears in the argv the extension started Claude with. Matching the flag too
 * (not the bare id) keeps a process that merely mentions the id — a `grep`, our
 * own `pkill -f <id>` — from voting the session alive.
 */
function argvNeedle(sessionId: string): string {
  return `--session-id ${sessionId}`;
}

/** The part of a session state file this module reads. The emitter writes both
 *  markers; a file from an older emitter has neither. */
interface SessionLiveness {
  /** Pid of the Claude process that ran the hook that wrote this file. */
  pid?: number;
  /** True when the id was generated by the extension and passed to Claude as
   *  `--session-id`, so it can be looked for in a process's command line. */
  launched?: boolean;
  /** Epoch ms of the most recent hook event. */
  ts?: number;
}

/** One session file the sweep has to make a call on. */
interface Suspect {
  id: string;
  file: string;
  /** Recorded pid, already established as gone (0 when none was recorded). */
  pid: number;
  launched: boolean;
}

/** Outcome of one sweep. */
export interface SweepResult {
  /** Ids whose state files were deleted. */
  dead: string[];
  /** ms until the earliest file held back only by the grace period becomes
   *  eligible, or 0 when none is. The caller uses it to come back on its own:
   *  a state file nothing will write to again produces no watcher event, so a
   *  window reopened seconds after its agents died would otherwise keep showing
   *  them until some unrelated signal happened to trigger a refresh. */
  recheckIn: number;
}

/**
 * Delete the state files of sessions whose Claude process is gone.
 *
 * A session that exits cleanly removes its own file (SessionEnd). One that dies
 * with its terminal — closing the VS Code window being the common way — never
 * gets the chance, so its file lingers and the next window to open shows it as a
 * live agent it has no terminal for. This is what retires those rows.
 *
 * Pruning requires positive evidence of death, never merely the absence of
 * evidence of life, since a false prune hides a live agent:
 *
 *  - a recorded pid that no longer exists (where `pidIsProof`), or
 *  - a launched session whose id is absent from a process scan that actually ran.
 *
 * A file the sweep cannot judge — no pid and no launch marker, i.e. written by an
 * emitter predating both — is left to the reader's SESSION_MAX_AGE backstop.
 *
 * A wrong prune self-heals: the file is rewritten by the session's very next hook
 * event, so a live agent that was pruned reappears as soon as it does anything.
 */
export async function pruneDeadSessions(
  dir: string,
  probes: LivenessProbes = systemProbes,
  now = Date.now()
): Promise<SweepResult> {
  const files = await fs.promises.readdir(dir).catch(() => [] as string[]);
  const suspects: Suspect[] = [];
  let recheckIn = 0;

  for (const fn of files) {
    if (!fn.endsWith(".json")) continue;
    const full = path.join(dir, fn);
    let m: SessionLiveness;
    try {
      m = JSON.parse(await fs.promises.readFile(full, "utf8")) as SessionLiveness;
    } catch {
      continue; // partial write or garbage; the next sweep sees it whole
    }
    if (typeof m?.ts !== "number") continue;
    const pid = typeof m.pid === "number" ? m.pid : 0;
    if (pid && probes.isAlive(pid)) continue; // its process is still there
    const launched = m.launched === true;
    if (!launched && !(pid > 0 && probes.pidIsProof)) continue; // nothing to check
    // Clamped: a state file stamped in the future (a clock adjustment mid
    // session) must not defer the sweep by more than the grace period.
    const age = Math.max(0, now - m.ts);
    if (age < SESSION_DEAD_GRACE) {
      // Judgeable, but too recent to trust the probes; come back for it.
      const wait = SESSION_DEAD_GRACE - age;
      recheckIn = recheckIn ? Math.min(recheckIn, wait) : wait;
      continue;
    }
    suspects.push({ id: path.basename(fn, ".json"), file: full, pid, launched });
  }

  if (!suspects.length) return { dead: [], recheckIn };
  // One scan for the whole batch, and only when a launched session needs it — in
  // the steady state (every recorded pid alive) there is no suspect and no scan.
  const blob = suspects.some((s) => s.launched)
    ? await probes.commandLines()
    : "";
  const scanned = blob.length > 0;

  const dead: string[] = [];
  for (const s of suspects) {
    if (scanned && blob.includes(argvNeedle(s.id))) continue; // still running
    const proven = (s.pid > 0 && probes.pidIsProof) || (s.launched && scanned);
    if (!proven) continue;
    try {
      await fs.promises.unlink(s.file);
    } catch {
      continue; // already gone, or not ours to delete
    }
    dead.push(s.id);
  }
  return { dead, recheckIn };
}
