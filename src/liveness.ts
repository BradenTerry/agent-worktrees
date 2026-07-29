/**
 * Is the process behind a session still running?
 *
 * Claude removes a session's registry file when it exits, but a session that
 * dies with its terminal - the window closed, the terminal killed, the machine
 * restarted - never gets the chance, and the file survives saying whatever it
 * last said. The registry is shared by every VS Code window, so a window opened
 * afterwards would otherwise render those as live agents it has no terminal for.
 *
 * The probe is the pid Claude recorded for itself: free (no spawn) and exact,
 * modulo pid reuse. It is proof on every platform, since the pid belongs to the
 * Claude process rather than to something spawned on its behalf.
 *
 * Injectable so the registry reader can be unit-tested without real processes.
 */
export interface LivenessProbes {
  /** Whether `pid` still exists on this machine. */
  isAlive(pid: number): boolean;
}

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

/** The real probes, used in production. */
export const systemProbes: LivenessProbes = { isAlive };
