import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Optional diagnostics sink. The extension host wires this to an output channel
 * (see `setGitLogger`) so a user can see what git is doing — which is the only
 * window we have into Windows-only "the Branches view never loads" reports,
 * where errors are otherwise swallowed. Defaults to a no-op so git.ts keeps no
 * dependency on the vscode API and unit tests need no setup.
 */
let logSink: (msg: string) => void = () => {};

/** Route git diagnostics to `fn` (e.g. an output channel). */
export function setGitLogger(fn: (msg: string) => void): void {
  logSink = fn;
}

/** Emit a diagnostics line; never throws (logging must not break git). */
function log(msg: string): void {
  try {
    logSink(msg);
  } catch {
    /* a broken logger must never take git down */
  }
}

/**
 * Optional per-call tracer. When tracing is enabled the extension host sets this
 * (see `setGitTracer`) so every git invocation is logged with its command,
 * duration, and result. Null when tracing is off, which lets `git()` skip
 * building trace strings entirely. Kept vscode-free via injection like logSink.
 */
let traceSink: ((msg: string) => void) | null = null;

/** Enable/disable per-call git tracing (pass null to disable). */
export function setGitTracer(fn: ((msg: string) => void) | null): void {
  traceSink = fn;
}

/**
 * Told once, the first time a `git status` here is slow enough that git's own
 * caches would fix it (see SLOW_STATUS_MS). The panel uses it to point at
 * Settings → Performance, since a hint logged to an output channel is a hint
 * nobody reads. Injected, like the sinks above, to keep this file vscode-free.
 */
let slowStatusHinted: (() => void) | null = null;

/** Be told when a status was slow enough to recommend git's caches. */
export function setSlowStatusHandler(fn: (() => void) | null): void {
  slowStatusHinted = fn;
}

function emitTrace(msg: string): void {
  try {
    traceSink?.(msg);
  } catch {
    /* a broken tracer must never take git down */
  }
}

/** Default per-call timeout. Long enough for a slow `for-each-ref` on a big
 *  repo, short enough that a wedged git (auth prompt, network stall) surfaces as
 *  an error instead of an infinite "Loading branches" spinner. */
const GIT_TIMEOUT_MS = 60_000;

/**
 * Run git with an argument array and no shell.
 *
 * Using execFile instead of a shell `exec` avoids spawning a cmd.exe/sh wrapper
 * per call. On Windows that roughly halves the process count when the Branches
 * view enriches each branch (one git per call instead of a cmd.exe + git pair),
 * which is the difference between the view loading promptly and pegging the CPU
 * on a repo with many branches. It also passes arguments literally, so there is
 * no shell quoting and no Windows-vs-POSIX quoting differences (the reason the
 * old `--format='...'` strings needed per-line single-quote stripping).
 *
 * `windowsHide` suppresses the console window flash each git spawn would
 * otherwise cause on Windows; `maxBuffer` is raised so a large `for-each-ref`
 * or diff output never truncates; `timeout` keeps a wedged call from hanging the
 * view forever.
 */
function git(
  args: string[],
  opts: { cwd?: string; timeout?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  const run = execFileAsync("git", args, {
    timeout: GIT_TIMEOUT_MS,
    ...opts,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    // GIT_OPTIONAL_LOCKS=0 stops read-only commands (notably `git status`) from
    // opportunistically rewriting the user's `.git/index` to refresh its stat
    // cache. As a polling tool we must not churn the index: it fights the user's
    // own git and, if anything ever watches `.git`, an index write would loop
    // straight back into another status spawn.
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  // When tracing is off, traceSink is null and we add zero overhead.
  if (!traceSink) return run;
  const started = Date.now();
  const where = opts.cwd ? ` (${opts.cwd})` : "";
  return run.then(
    (r) => {
      emitTrace(`git ${args.join(" ")} -> ok ${Date.now() - started}ms${where}`);
      return r;
    },
    (err: unknown) => {
      const first = (err instanceof Error ? err.message : String(err)).split(
        "\n"
      )[0];
      emitTrace(
        `git ${args.join(" ")} -> ERROR ${Date.now() - started}ms${where}: ${first}`
      );
      throw err;
    }
  );
}

export interface Worktree {
  /** Absolute path to the worktree directory. */
  path: string;
  /** Short branch name (e.g. "main"), or undefined when detached. */
  branch?: string;
  /** Commit SHA the worktree is checked out at. */
  head?: string;
  /** True for the main (primary) worktree of the repository. */
  isPrimary: boolean;
  /** True when the worktree is in detached-HEAD state. */
  detached: boolean;
  /** True when the worktree is locked. */
  locked: boolean;
  /** The lock reason, when locked with one (e.g. Claude Code locks the
   *  worktrees it creates with "claude session <name> (pid <p> start <s>)"). */
  lockReason?: string;
}

/**
 * Resolve the top level of the git repository that `cwd` belongs to.
 * Returns undefined when `cwd` is not inside a git repository.
 */
export async function findRepoRoot(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await git(["rev-parse", "--show-toplevel"], { cwd });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Working-tree state of a single worktree, relative to its upstream. */
export interface GitStatus {
  /** Number of changed/untracked entries (0 means clean). */
  dirty: number;
  /** Lines added across tracked changes vs HEAD. */
  insertions: number;
  /** Lines removed across tracked changes vs HEAD. */
  deletions: number;
  /** Commits ahead of the upstream branch. */
  ahead: number;
  /** Commits behind the upstream branch. */
  behind: number;
  /** Short branch name HEAD points at, or undefined when detached. Read from
   *  the `# branch.head` header the status call already emits, so callers that
   *  only re-run status (the agent-only refresh) can still spot a worktree that
   *  changed branches without re-listing every worktree. */
  branch?: string;
}

/**
 * Update remote-tracking refs so ahead/behind counts reflect the remote. All
 * worktrees of a repo share one object store, so a single fetch at any worktree
 * refreshes every worktree's behind/ahead distance. Never throws — offline or a
 * missing remote simply leaves the refs (and counts) as they were.
 *
 * `--prune` (on by default) drops `refs/remotes/origin/*` refs for branches
 * deleted on the remote, so the Branches view stops showing phantom "remote
 * only" / "local + remote" branches that no longer exist (and that a remote
 * delete would fail on). Pass `prune: false` to keep stale tracking refs.
 */
export async function fetchRemotes(
  cwd: string,
  opts: { prune?: boolean } = {}
): Promise<void> {
  const prune = opts.prune !== false;
  try {
    await git(["fetch", "--all", ...(prune ? ["--prune"] : []), "--quiet"], {
      cwd,
      timeout: 15_000,
    });
  } catch {
    /* offline / no remote / timeout: keep stale refs */
  }
}

/** A status slower than this (per worktree, after process spawn) is git doing
 *  real work — on Windows almost always the untracked-file traversal. Enabling
 *  git's own caches fixes that at the source, but they live in the user's repo
 *  config, which this extension does not edit without being asked; the hint
 *  points at Settings → Performance, which asks and then does it. */
const SLOW_STATUS_MS = 2_000;
let hintedSlowStatus = false;

/**
 * Git's two opt-in `status` accelerators, as they stand in one repository.
 *
 * Both address the same cost: `status` has to report untracked files, and to do
 * that it walks every directory in the working tree. That walk is the bulk of a
 * slow status, and this panel runs status per worktree, repeatedly.
 *
 *  - `core.untrackedCache` stores each directory's untracked-file result in
 *    `.git/index` alongside its stat data, so a directory whose mtime has not
 *    moved is not re-read at all.
 *  - `core.fsmonitor` goes further: git runs a per-repo daemon subscribed to the
 *    OS's change notifications (FSEvents, ReadDirectoryChangesW) and asks it what
 *    changed instead of looking. Built into git since 2.37.
 */
export interface GitPerfConfig {
  /** `core.untrackedCache` is set to true. */
  untrackedCache: boolean;
  /** `core.fsmonitor` is on. `builtin` when it is git's own daemon (`true`),
   *  `hook` when the user has pointed it at their own program (a path, e.g.
   *  Watchman), which we must not overwrite. */
  fsmonitor: false | "builtin" | "hook";
}

/** Parse `git config --get-regexp`'s `key value` lines. Pure, so the value
 *  handling (git's booleans are case-insensitive, and `keep`/a hook path are
 *  neither true nor false) is unit-tested without a repo.
 *
 *  A key set in more than one scope appears once per scope, in increasing
 *  precedence order (system, global, local), so the **last** line for a key is
 *  the effective one — which is why each match overwrites rather than breaks. */
export function parsePerfConfig(stdout: string): GitPerfConfig {
  const out: GitPerfConfig = { untrackedCache: false, fsmonitor: false };
  for (const line of stdout.split("\n")) {
    const at = line.indexOf(" ");
    if (at === -1) continue;
    const key = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    const lower = value.toLowerCase();
    if (key === "core.untrackedcache") {
      // `keep` means "use a cache that is already there but do not extend it",
      // which is not the state we are offering to put the repo in.
      out.untrackedCache = lower === "true";
    } else if (key === "core.fsmonitor") {
      out.fsmonitor =
        lower === "true" ? "builtin" : lower === "false" || !value ? false : "hook";
    }
  }
  return out;
}

/** How `git config` reports the two settings we manage. A repo with neither set
 *  exits non-zero with no output, which is not an error here. */
export async function readPerfConfig(repoRoot: string): Promise<GitPerfConfig> {
  try {
    const { stdout } = await git(
      ["config", "--get-regexp", "^core\\.(untrackedcache|fsmonitor)$"],
      { cwd: repoRoot }
    );
    return parsePerfConfig(stdout);
  } catch {
    return { untrackedCache: false, fsmonitor: false };
  }
}

/** `git --version`'s major/minor, or undefined if it cannot be read. Pure half,
 *  so the parsing of the platform suffixes git appends (`2.39.3 (Apple Git-146)`,
 *  `2.45.1.windows.1`) is unit-tested. */
export function parseGitVersion(stdout: string): [number, number] | undefined {
  const m = /(\d+)\.(\d+)/.exec(stdout);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

/** Why git's built-in filesystem monitor is or is not on the table here. */
export type FsmonitorSupport =
  /** Offerable. */
  | "yes"
  /** `core.fsmonitor=true` only means "use the daemon" from git 2.37. Before
   *  that the key held the path of an fsmonitor hook, so writing `true` would
   *  configure a hook named "true" and break every index refresh. */
  | "old-git"
  /** This git has the daemon but not for this platform. It shipped for macOS and
   *  Windows; where it is missing, enabling it makes `git status` fail outright,
   *  so this is the difference between a speedup and a broken repo. */
  | "platform";

/** Whether the daemon reports itself unavailable *here*, as opposed to merely not
 *  running. Git says "not supported" on a platform it has no backend for, and
 *  "not watching"/"not running" when it simply has not started - both non-zero,
 *  so the message is what tells them apart. Pure, so both shapes are tested. */
export function saysUnsupported(text: string): boolean {
  return /not supported/i.test(text);
}

/**
 * Whether the built-in monitor can be turned on for this repository.
 *
 * Asks git rather than mapping platforms ourselves: the set of supported
 * platforms is git's, it grows between releases, and `fsmonitor--daemon status`
 * answers it without starting anything. Memoized for the window - neither the
 * git binary nor the platform changes under us.
 */
let fsmonitorSupport: Promise<FsmonitorSupport> | undefined;
export function gitFsmonitorSupport(cwd: string): Promise<FsmonitorSupport> {
  fsmonitorSupport ??= (async () => {
    let version: [number, number] | undefined;
    try {
      version = parseGitVersion((await git(["--version"])).stdout);
    } catch {
      return "old-git";
    }
    if (!version || version[0] < 2 || (version[0] === 2 && version[1] < 37)) {
      return "old-git";
    }
    try {
      // Exits non-zero whenever no daemon is running, which is the normal case,
      // so only the message matters here.
      await git(["fsmonitor--daemon", "status"], { cwd, timeout: 10_000 });
      return "yes";
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      const said = `${e.stdout ?? ""}\n${e.stderr ?? ""}\n${e.message ?? ""}`;
      return saysUnsupported(said) ? "platform" : "yes";
    }
  })();
  return fsmonitorSupport;
}

/**
 * Whether this working tree's filesystem reports directory mtimes the way the
 * untracked cache needs. Git ships the check (`--test-untracked-cache`), and it
 * is worth running rather than assuming: the cache is only correct if a directory
 * whose contents changed comes back with a new mtime, which not every filesystem
 * or network mount guarantees.
 */
const untrackedCacheOk = new Map<string, Promise<boolean>>();
export function untrackedCacheSupported(cwd: string): Promise<boolean> {
  // Memoized per repo for the window. The test creates and removes files in the
  // working tree to watch what the filesystem reports, so re-running it every
  // time the tab is opened would be the opposite of the point, and the answer is
  // a property of the filesystem rather than of the repo's state. A window reload
  // re-asks, which is enough for the case of a repo that has moved.
  let hit = untrackedCacheOk.get(cwd);
  if (!hit) {
    hit = (async () => {
      try {
        // Exits non-zero (and says so) when the filesystem is unsuitable.
        await git(["update-index", "--test-untracked-cache"], {
          cwd,
          timeout: 30_000,
        });
        return true;
      } catch {
        return false;
      }
    })();
    untrackedCacheOk.set(cwd, hit);
  }
  return hit;
}

/** The two settings, by the name the panel and the config both use. */
export type PerfKey = "untrackedCache" | "fsmonitor";

const PERF_CONFIG_KEY: Record<PerfKey, string> = {
  untrackedCache: "core.untrackedCache",
  fsmonitor: "core.fsmonitor",
};

/**
 * Turn one accelerator on or off in the repository's own config.
 *
 * Written at the repo root, so one call covers every worktree: linked worktrees
 * share `.git/config` (absent `extensions.worktreeConfig`, which we neither set
 * nor need).
 *
 * Turning **off** is not simply unsetting, and the two keys differ, because git's
 * defaults differ:
 *
 *  - `core.untrackedCache` unset means **keep**: an untracked cache already in
 *    the index stays there and stays in use. Only `false` removes it. So off is
 *    always written as `false` - unsetting would look like it worked and change
 *    nothing.
 *  - `core.fsmonitor` unset means no monitor, so off unsets it, which leaves the
 *    config as clean as we found it. But an inherited value (a `--global`
 *    `core.fsmonitor=true`) would survive that, so the effective value is re-read
 *    and `false` written locally if it is still on. Off has to mean off.
 *
 * One case that write cannot beat: a local config whose `[include]` sets the key
 * *after* the section we write into, since git resolves an include where it
 * appears rather than by scope. Rewriting someone's include structure is not this
 * feature's business, so the toggle reports what it reads back and the user is
 * looking at the truth either way.
 *
 * Throws with git's stderr if a write fails, so the caller can say which.
 */
export async function setPerfSetting(
  repoRoot: string,
  key: PerfKey,
  on: boolean
): Promise<void> {
  const configKey = PERF_CONFIG_KEY[key];
  const write = async (value: string) => {
    try {
      await git(["config", configKey, value], { cwd: repoRoot });
    } catch (err) {
      const msg = String((err as { stderr?: string }).stderr ?? err).trim();
      throw new Error(`Could not set ${configKey}: ${msg}`);
    }
  };

  if (on) {
    await write("true");
    log(`setPerfSetting: ${configKey}=true in ${repoRoot}`);
    return;
  }

  if (key === "untrackedCache") {
    await write("false");
    log(`setPerfSetting: ${configKey}=false in ${repoRoot} (unset would keep it)`);
    return;
  }

  try {
    await git(["config", "--unset-all", configKey], { cwd: repoRoot });
  } catch {
    /* exit 5 = it was not set locally; either way, check what is left */
  }
  const still = (await readPerfConfig(repoRoot)).fsmonitor !== false;
  if (still) {
    await write("false");
    log(`setPerfSetting: ${configKey}=false in ${repoRoot} (inherited value)`);
  } else {
    log(`setPerfSetting: unset ${configKey} in ${repoRoot}`);
  }
}

/**
 * Summarize the working-tree state of a worktree using
 * `git status --porcelain=v2 --branch`: a count of changed entries plus the
 * ahead/behind distance from the upstream branch. Note ahead/behind is read
 * from local refs; call `fetchRemotes` first for an up-to-date behind count.
 *
 * `--no-renames` skips rename detection, which is similarity matching the
 * panel's counts never use — a renamed file counts as its add+delete pair,
 * which is close enough for a dirty count and saves the CPU on large diffs.
 */
export async function getStatus(cwd: string): Promise<GitStatus> {
  let dirty = 0;
  let tracked = 0;
  let ahead = 0;
  let behind = 0;
  let branch: string | undefined;
  try {
    const startedAt = Date.now();
    const { stdout } = await git(
      ["status", "--porcelain=v2", "--branch", "--no-renames"],
      { cwd }
    );
    const took = Date.now() - startedAt;
    if (took >= SLOW_STATUS_MS && !hintedSlowStatus) {
      hintedSlowStatus = true;
      log(
        `getStatus: ${took}ms in ${cwd}. Git's own caches usually fix this: ` +
          `open Settings -> Performance in the Agent Worktrees panel to turn ` +
          `on core.untrackedCache and core.fsmonitor for this repository (see ` +
          `https://git-scm.com/docs/git-update-index#_untracked_cache and ` +
          `git-fsmonitor--daemon).`
      );
      slowStatusHinted?.();
    }
    for (const raw of stdout.split("\n")) {
      const line = raw.trimEnd();
      if (line === "") continue;
      if (line.startsWith("# branch.ab ")) {
        // e.g. "# branch.ab +2 -1"
        const m = line.match(/\+(\d+)\s+-(\d+)/);
        if (m) {
          ahead = Number(m[1]);
          behind = Number(m[2]);
        }
      } else if (line.startsWith("# branch.head ")) {
        // e.g. "# branch.head main", or "(detached)" with no branch.
        const name = line.slice("# branch.head ".length).trim();
        if (name && name !== "(detached)") branch = name;
      } else if (!line.startsWith("#")) {
        // 1/2 = changed tracked, u = unmerged, ? = untracked, ! = ignored.
        if (line[0] !== "!") dirty++;
        // Only changed/unmerged tracked entries appear in `git diff HEAD`.
        if (line[0] === "1" || line[0] === "2" || line[0] === "u") tracked++;
      }
    }
  } catch {
    /* leave zeros on error */
  }
  // `git diff --numstat HEAD` is empty unless there are tracked changes, so skip
  // that second git process per worktree when there are none. A clean worktree
  // (the common case) then costs one git spawn instead of two — the difference
  // that makes loading many worktrees on Windows noticeably faster.
  const { insertions, deletions } =
    tracked > 0 ? await getDiffStat(cwd) : { insertions: 0, deletions: 0 };
  return { dirty, insertions, deletions, ahead, behind, branch };
}

/**
 * Total lines added/removed across tracked changes (staged and unstaged) vs
 * HEAD, via `git diff --numstat HEAD`. Binary files (reported as "-\t-") and
 * untracked files are not counted.
 */
async function getDiffStat(
  cwd: string
): Promise<{ insertions: number; deletions: number }> {
  let insertions = 0;
  let deletions = 0;
  try {
    const { stdout } = await git(["diff", "--numstat", "HEAD"], { cwd });
    for (const line of stdout.split("\n")) {
      const m = line.match(/^(\d+)\t(\d+)\t/);
      if (m) {
        insertions += Number(m[1]);
        deletions += Number(m[2]);
      }
    }
  } catch {
    /* no HEAD yet, or not a repo: leave zeros */
  }
  return { insertions, deletions };
}

/**
 * Create a new worktree at `dir`. When `branch` does not already exist it is
 * created from `base` (default HEAD); otherwise the existing branch is checked
 * out. Returns nothing on success and throws with git's stderr on failure.
 */
export async function addWorktree(
  repoRoot: string,
  dir: string,
  branch: string,
  base = "HEAD"
): Promise<void> {
  try {
    await git(["worktree", "add", "-b", branch, dir, base], { cwd: repoRoot });
  } catch (err) {
    // Branch may already exist; fall back to checking it out into the worktree.
    const msg = String((err as { stderr?: string }).stderr ?? err);
    if (/already exists/i.test(msg)) {
      await git(["worktree", "add", dir, branch], { cwd: repoRoot });
    } else {
      throw new Error(msg.trim());
    }
  }
}

/** Cap on the file list behind "Find file in worktree". Sized so the quick pick
 *  stays responsive on a large repo; the picker states the cap rather than
 *  silently truncating (same rule as the linked-files ignore picker). */
export const WORKTREE_FILE_CAP = 20_000;

/**
 * Parse `git ls-files -z` output into a deduplicated, sorted path list.
 *
 * Pure and exported so the NUL splitting, the dedupe and the cap are unit-tested
 * without spawning git. Deduping is not cosmetic: `--cached` lists an unmerged
 * path once per stage, so a conflicted file would otherwise appear three times
 * in the picker.
 */
export function parseWorktreeFiles(
  stdout: string,
  cap = WORKTREE_FILE_CAP
): { files: string[]; truncated: boolean } {
  const seen = new Set<string>();
  for (const raw of stdout.split("\0")) {
    if (!raw) continue;
    seen.add(raw.replace(/\\/g, "/"));
  }
  // Case-insensitive, with the exact path as tie-break. Deliberately not
  // localeCompare: the order would then depend on the runner's locale, and CI
  // spans three OSes. toLowerCase is locale-independent in JS, so this sorts the
  // same everywhere.
  const all = [...seen].sort((a, b) => {
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    if (la !== lb) return la < lb ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return { files: all.slice(0, cap), truncated: all.length > cap };
}

/**
 * Every file in a worktree that git knows about, as worktree-relative paths, for
 * the panel's file picker.
 *
 * `--cached --others --exclude-standard` is the set VS Code's own Quick Open
 * shows: tracked files plus untracked ones, minus anything gitignored. Asking
 * git rather than walking the tree ourselves is what keeps `node_modules` and
 * build output out of the list without us maintaining an exclusion list.
 */
export async function listWorktreeFiles(
  worktreePath: string
): Promise<{ files: string[]; truncated: boolean }> {
  const { stdout } = await git(
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: worktreePath }
  );
  return parseWorktreeFiles(stdout);
}

/** One path git currently ignores, offered as a candidate for linking. */
export interface IgnoredEntry {
  /** Repo-relative path, forward slashes, no trailing slash. */
  path: string;
  /** True when git collapsed a wholly-ignored directory into this one entry
   *  (so `node_modules` is one row, not fifty thousand). */
  isDir: boolean;
}

/**
 * Parse `git ls-files -z --others --ignored ... --directory` output. Pure and
 * exported so the NUL splitting, the trailing-slash directory marker and the
 * exclusions below are unit-tested without spawning git.
 *
 * Two things are never offered:
 *  - anything under `.git`, which is git's own storage, and
 *  - the panel's own worktree storage (`.claude/worktrees`), plus a collapsed
 *    `.claude` directory entry that would contain it. Linking a worktree into a
 *    worktree makes a recursive link. Individual files under `.claude` (a
 *    `settings.local.json`, say) are still offered, since those are ordinary
 *    local config.
 */
export function parseIgnoredPaths(stdout: string): IgnoredEntry[] {
  const out: IgnoredEntry[] = [];
  for (const raw of stdout.split("\0")) {
    if (!raw) continue;
    const isDir = raw.endsWith("/");
    const p = (isDir ? raw.slice(0, -1) : raw).replace(/\\/g, "/");
    if (!p) continue;
    if (p === ".git" || p.startsWith(".git/")) continue;
    if (p === ".claude/worktrees" || p.startsWith(".claude/worktrees/")) continue;
    if (p === ".claude" && isDir) continue;
    out.push({ path: p, isDir });
  }
  return out;
}

/**
 * Every path git ignores in `repoRoot`, as candidates for the linked-files list.
 *
 * `--directory --no-empty-directory` collapses a wholly-ignored directory into a
 * single entry, which is what keeps `node_modules` or `bin`/`obj` from expanding
 * into tens of thousands of rows. `--full-name` keeps paths repo-relative
 * regardless of cwd, and `-z` means a filename with odd characters can't break
 * the parse.
 */
export async function listIgnoredPaths(
  repoRoot: string
): Promise<IgnoredEntry[]> {
  const { stdout } = await git(
    [
      "ls-files",
      "-z",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
      "--no-empty-directory",
      "--full-name",
    ],
    { cwd: repoRoot }
  );
  return parseIgnoredPaths(stdout);
}

/** A branch of the repository, annotated with its worktree association. */
export interface BranchInfo {
  /** Short branch name, e.g. "feature/x". */
  name: string;
  /** Exists only as origin/<name> (no local ref). */
  remoteOnly: boolean;
  /** A matching origin/<name> exists. Always true when remoteOnly; for a local
   *  branch it distinguishes "local + remote" from "local only". */
  hasRemote: boolean;
  /** A worktree currently has this branch checked out. */
  hasWorktree: boolean;
  /** That worktree's path, when hasWorktree. */
  worktreePath?: string;
  /** Commits ahead of the compare base (upstream, or the default branch when the
   *  branch has no upstream). */
  ahead: number;
  /** Commits behind the compare base. */
  behind: number;
  /** The repo's default branch (origin/HEAD, e.g. "main"). Never deletable. */
  isDefault: boolean;
  /** Tip commit's committer date (ISO 8601), i.e. when the branch was last
   *  updated. Used to sort the branches view most-recently-updated first. */
  updatedAt?: string;
  /** Tip commit's committer name — "who last updated this branch". Drives the
   *  git-native author filter (no GitHub needed). */
  lastUser?: string;
  /** Tip commit's committer email, kept for stable de-duplication of users who
   *  commit under more than one display name. */
  lastEmail?: string;
}

/**
 * List local branches plus remote-only origin branches (origin/<name> with no
 * local counterpart), each annotated with worktree association. Excludes
 * origin/HEAD. Never returns the same short name twice (local wins).
 *
 * Local branches come from `git for-each-ref refs/heads` with `%(worktreepath)`
 * (empty unless a worktree holds the ref), `%(upstream:track)` for the
 * ahead/behind distance, and `%(upstream:short)` for the compare base. A second
 * pass over refs/remotes/origin supplies the origin name set (so a local branch
 * can be flagged "local + remote") and adds the remote-only names.
 *
 * Each branch is then enriched with ahead/behind and a +/- line diff against its
 * compare base: its upstream when it has one, otherwise the repo's default branch
 * (origin/HEAD). Counts are read from local refs, so they reflect the last fetch.
 * Genuine git failures propagate the way `listWorktrees` does.
 */
/**
 * Field separator (NUL) and our local-branch for-each-ref format. NUL between
 * fields and newline between records so a branch name with odd characters never
 * confuses the parse.
 */
const LOCAL_REF_FORMAT =
  "%(refname:short)%00%(worktreepath)%00%(upstream:track,nobracket)%00%(upstream:short)%00%(committerdate:iso8601-strict)%00%(committername)%00%(committeremail)";

/**
 * Remote ref format (refs/remotes/origin). Full refname (so origin/HEAD can be
 * filtered — see parseRemoteBranchRefs) plus the tip commit's committer date and
 * committer so a remote-only branch carries the same "last updated" + "last user"
 * the local refs do.
 */
const REMOTE_REF_FORMAT =
  "%(refname)%00%(committerdate:iso8601-strict)%00%(committername)%00%(committeremail)";

/**
 * Parse `git for-each-ref refs/heads` output (LOCAL_REF_FORMAT) into branch
 * seeds plus the upstream map. Pure and exported so the exact parse — NUL field
 * splitting, CRLF tolerance, empty/optional fields — is unit-tested without
 * spawning git. Ahead/behind here come from %(upstream:track); divergence vs the
 * base is filled in later by listBranches.
 */
export function parseLocalBranchRefs(stdout: string): {
  branches: BranchInfo[];
  upstreamOf: Map<string, string>;
} {
  const branches: BranchInfo[] = [];
  // Configured upstream short-ref per local branch (e.g. "origin/feature"), used
  // as the diff/ahead-behind base. Empty when the branch tracks nothing.
  const upstreamOf = new Map<string, string>();
  // Tolerate CRLF: git emits LF, but a misconfigured core.autocrlf or a wrapper
  // can introduce \r, which would otherwise cling to the last field.
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line === "") continue;
    const [name, worktreePath, track, upstream, committerdate, committername, committeremail] =
      line.split("\0");
    if (!name) continue;
    const { ahead, behind } = parseTrack(track || "");
    if (upstream) upstreamOf.set(name, upstream);
    branches.push({
      name,
      remoteOnly: false,
      hasRemote: false, // set later once origin names are known
      hasWorktree: !!worktreePath,
      worktreePath: worktreePath || undefined,
      ahead,
      behind,
      isDefault: false,
      updatedAt: committerdate || undefined,
      lastUser: committername || undefined,
      lastEmail: committeremail || undefined,
    });
  }
  return { branches, upstreamOf };
}

/** Tip-commit metadata for a remote branch: when it was last updated and by whom. */
export interface RemoteRefMeta {
  updatedAt?: string;
  lastUser?: string;
  lastEmail?: string;
}

/**
 * Parse `git for-each-ref refs/remotes/origin` (REMOTE_REF_FORMAT) into the set
 * of origin branch short-names plus a per-branch tip-commit metadata map,
 * excluding the origin/HEAD symbolic alias. Pure and exported for unit tests.
 * Uses the FULL refname because `refname:short` collapses
 * `refs/remotes/origin/HEAD` to the bare "origin", which would slip past a guard
 * and surface a phantom "origin" branch.
 */
export function parseRemoteBranchRefs(stdout: string): {
  names: Set<string>;
  meta: Map<string, RemoteRefMeta>;
} {
  const names = new Set<string>();
  const meta = new Map<string, RemoteRefMeta>();
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line === "") continue;
    const [ref, committerdate, committername, committeremail] = line.split("\0");
    const name = (ref ?? "").replace(/^refs\/remotes\/origin\//, "");
    if (!name || name === "HEAD") continue;
    names.add(name);
    meta.set(name, {
      updatedAt: committerdate || undefined,
      lastUser: committername || undefined,
      lastEmail: committeremail || undefined,
    });
  }
  return { names, meta };
}

export async function listBranches(cwd: string): Promise<BranchInfo[]> {
  const startedAt = Date.now();

  const { stdout: localOut } = await git(
    ["for-each-ref", `--format=${LOCAL_REF_FORMAT}`, "refs/heads"],
    { cwd }
  );
  const { branches, upstreamOf } = parseLocalBranchRefs(localOut);

  const { stdout: remoteOut } = await git(
    ["for-each-ref", `--format=${REMOTE_REF_FORMAT}`, "refs/remotes/origin"],
    { cwd }
  );
  const { names: originNames, meta: remoteMeta } =
    parseRemoteBranchRefs(remoteOut);

  const localNames = new Set(branches.map((b) => b.name));
  for (const b of branches) b.hasRemote = originNames.has(b.name);
  for (const name of originNames) {
    if (localNames.has(name)) continue;
    const m = remoteMeta.get(name);
    branches.push({
      name,
      remoteOnly: true,
      hasRemote: true,
      hasWorktree: false,
      ahead: 0,
      behind: 0,
      isDefault: false,
      updatedAt: m?.updatedAt,
      lastUser: m?.lastUser,
      lastEmail: m?.lastEmail,
    });
  }

  // Enrich each branch with ahead/behind vs its compare base. Bounded
  // concurrency keeps a many-branch repo from spawning a git process per branch
  // all at once. Any per-branch failure leaves that branch's counts at zero.
  const defaultRef = await resolveDefaultBranchRef(cwd);
  // Flag the default branch so the UI can protect it from deletion. This is
  // authoritative (origin/HEAD only, no guessing) — distinct from defaultRef,
  // which is just a reasonable base to diff against.
  const defaultName = await defaultBranchName(cwd);
  if (defaultName) {
    for (const b of branches) if (b.name === defaultName) b.isDefault = true;
  }
  // Batch ahead/behind vs the default branch for every ref in ONE call, instead
  // of a `rev-list` per branch. This is the big reduction in git processes on a
  // many-branch repo (the Windows "CPU screaming / never loads" case). It only
  // covers branches whose base IS the default ref; a branch that compares to its
  // own origin/<name> has a per-branch base that cannot be expressed against a
  // single committish, so it still falls back to a `rev-list`. Returns undefined
  // on git < 2.41 (the %(ahead-behind) atom errors), so we degrade gracefully.
  const abByRef = defaultRef
    ? await aheadBehindByRef(cwd, defaultRef)
    : undefined;

  // Count the remaining per-branch git calls so the diagnostics summary shows how
  // much work a big repo actually drove (the "branch list size vs Windows"
  // question).
  let aheadBehindCalls = 0;
  await mapLimit(branches, 8, async (b) => {
    const tip = b.remoteOnly ? `origin/${b.name}` : b.name;
    const base = b.remoteOnly
      ? defaultRef
      : upstreamOf.get(b.name) || (b.hasRemote ? `origin/${b.name}` : defaultRef);
    if (!base || base === tip) return;
    // A configured upstream already gave authoritative ahead/behind via
    // %(upstream:track); everything else (no upstream, or remote-only) is counted
    // against the base. Prefer the batched %(ahead-behind) result; fall back to a
    // per-branch rev-list when the base is not the default ref or git is too old.
    if (!upstreamOf.has(b.name)) {
      const fullRef = b.remoteOnly
        ? `refs/remotes/origin/${b.name}`
        : `refs/heads/${b.name}`;
      const batched =
        base === defaultRef ? abByRef?.get(fullRef) : undefined;
      if (batched) {
        b.ahead = batched.ahead;
        b.behind = batched.behind;
      } else {
        aheadBehindCalls++;
        const ab = await aheadBehind(cwd, base, tip);
        b.ahead = ab.ahead;
        b.behind = ab.behind;
      }
    }
  });
  log(
    `listBranches: ${branches.length} branches in ${
      Date.now() - startedAt
    }ms (${aheadBehindCalls} ahead/behind calls${
      abByRef ? ", ahead/behind batched" : ""
    })`
  );
  return branches;
}

/**
 * Ahead/behind of every local and origin ref vs a single base, in ONE
 * `for-each-ref` call using the %(ahead-behind:) atom (git 2.41+). Returns a map
 * keyed by full refname (e.g. "refs/heads/feature"). Resolves to undefined when
 * git does not support the atom — older git errors on the unknown field, which
 * we catch — so the caller falls back to a per-branch `rev-list`.
 */
async function aheadBehindByRef(
  cwd: string,
  base: string
): Promise<Map<string, { ahead: number; behind: number }> | undefined> {
  try {
    const { stdout } = await git(
      [
        "for-each-ref",
        `--format=%(refname)%00%(ahead-behind:${base})`,
        "refs/heads",
        "refs/remotes/origin",
      ],
      { cwd }
    );
    return parseAheadBehindByRef(stdout);
  } catch {
    // git < 2.41 (unknown atom) or an unresolvable base: degrade to per-branch.
    return undefined;
  }
}

/**
 * Parse `%(refname)%00%(ahead-behind:base)` records into a map from full refname
 * to counts. The atom prints "<ahead> <behind>"; a ref with no common ancestor
 * prints nothing, so such lines are skipped (left to the per-branch fallback).
 * Pure and exported for unit tests.
 */
export function parseAheadBehindByRef(
  stdout: string
): Map<string, { ahead: number; behind: number }> {
  const map = new Map<string, { ahead: number; behind: number }>();
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line) continue;
    const [ref, ab] = line.split("\0");
    if (!ref) continue;
    const m = (ab || "").match(/(\d+)\s+(\d+)/);
    if (m) map.set(ref, { ahead: Number(m[1]), behind: Number(m[2]) });
  }
  return map;
}

/**
 * Local branches whose configured upstream is gone — the remote branch was
 * deleted (typically after the PR merged). These are what `git branch -vv` marks
 * "[gone]". Reads local refs only, so the result reflects the last fetch/prune;
 * run a `git fetch --prune` first to make a recently-deleted remote register.
 */
export async function goneBranches(cwd: string): Promise<string[]> {
  const { stdout } = await git(
    [
      "for-each-ref",
      "--format=%(refname:short)%00%(upstream:track,nobracket)",
      "refs/heads",
    ],
    { cwd }
  );
  const gone: string[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trimEnd();
    if (!line) continue;
    const [name, track] = line.split("\0");
    if (name && /\bgone\b/.test(track || "")) gone.push(name);
  }
  return gone;
}

/**
 * Short-lived per-repo cache of the raw `origin/HEAD` lookup. origin/HEAD
 * effectively never changes during a session, yet every Branches refresh
 * resolved it twice (`defaultBranchName` + `resolveDefaultBranchRef`) and again
 * from several webview paths — a burst of identical `git symbolic-ref` spawns,
 * most visible on Windows where each spawn is a fresh process. Caching the
 * in-flight promise collapses that burst to one call; the TTL (not a permanent
 * cache) lets a `git remote set-head` register within a refresh or two.
 */
const ORIGIN_HEAD_TTL_MS = 5_000;
const originHeadCache = new Map<
  string,
  { at: number; p: Promise<string | undefined> }
>();

/**
 * The `origin/HEAD` short ref (e.g. "origin/main"), or undefined when
 * origin/HEAD is unset. Memoized per cwd for ORIGIN_HEAD_TTL_MS so a refresh
 * storm does not respawn `git symbolic-ref` once per caller. Caches the promise
 * so concurrent callers within one refresh share a single git process.
 */
function originHead(cwd: string): Promise<string | undefined> {
  const cached = originHeadCache.get(cwd);
  if (cached && Date.now() - cached.at < ORIGIN_HEAD_TTL_MS) return cached.p;
  const p = (async () => {
    try {
      const { stdout } = await git(
        ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
        { cwd }
      );
      return stdout.trim().replace(/^refs\/remotes\//, "") || undefined;
    } catch {
      return undefined;
    }
  })();
  originHeadCache.set(cwd, { at: Date.now(), p });
  return p;
}

/**
 * The repo's default branch short name from origin/HEAD (e.g. "main", "master",
 * "trunk" — whatever git reports), or undefined when origin/HEAD is not set.
 * Authoritative and used to protect the default branch from deletion, so it
 * trusts git rather than guessing at a name.
 */
export async function defaultBranchName(
  cwd: string
): Promise<string | undefined> {
  const ref = await originHead(cwd);
  return ref ? ref.replace(/^origin\//, "") : undefined;
}

/**
 * A reasonable base to diff a branch against when it has no upstream: the
 * default branch ref (e.g. "origin/main"), resolved from origin/HEAD, falling
 * back to the first of origin/main, origin/master, main, master that exists, or
 * undefined when none do. This is a display heuristic for ahead/behind and the
 * line diff, not the authoritative default-branch identity (see
 * `defaultBranchName`).
 */
async function resolveDefaultBranchRef(
  cwd: string
): Promise<string | undefined> {
  const head = await originHead(cwd);
  if (head) return head;
  for (const cand of ["origin/main", "origin/master", "main", "master"]) {
    try {
      await git(["rev-parse", "--verify", "--quiet", cand], { cwd });
      return cand;
    } catch {
      /* not this one */
    }
  }
  return undefined;
}

/** Commits `tip` is ahead/behind `base` (`git rev-list --left-right --count
 *  base...tip` => "<behind>\t<ahead>"). Zero on error. */
async function aheadBehind(
  cwd: string,
  base: string,
  tip: string
): Promise<{ ahead: number; behind: number }> {
  try {
    const { stdout } = await git(
      ["rev-list", "--left-right", "--count", `${base}...${tip}`],
      { cwd }
    );
    const m = stdout.trim().match(/(\d+)\s+(\d+)/);
    if (m) return { behind: Number(m[1]), ahead: Number(m[2]) };
  } catch {
    /* missing ref / unrelated histories */
  }
  return { ahead: 0, behind: 0 };
}

/**
 * Count of a local branch's commits that are not on its push target: its
 * upstream when configured, otherwise the repo's default branch. Used to warn
 * before deleting a branch whose work would be lost. Zero on error or when the
 * branch is fully contained in its base.
 */
export async function unpushedCommitCount(
  repoRoot: string,
  name: string
): Promise<number> {
  let base: string | undefined;
  try {
    const { stdout } = await git(
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${name}@{upstream}`],
      { cwd: repoRoot }
    );
    base = stdout.trim() || undefined;
  } catch {
    base = await resolveDefaultBranchRef(repoRoot);
  }
  if (!base) return 0;
  try {
    const { stdout } = await git(
      ["rev-list", "--count", `${base}..${name}`],
      { cwd: repoRoot }
    );
    return Number(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

/** Run `fn` over `items` with at most `limit` in flight at once, preserving
 *  result order. Exported so other spawn-heavy fan-outs (e.g. per-worktree
 *  `git status`) can bound their process bursts the same way. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let i = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await fn(items[idx]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

/** Parse `%(upstream:track,nobracket)` (e.g. "ahead 2, behind 1") into counts. */
function parseTrack(track: string): { ahead: number; behind: number } {
  const am = track.match(/ahead (\d+)/);
  const bm = track.match(/behind (\d+)/);
  return { ahead: am ? Number(am[1]) : 0, behind: bm ? Number(bm[1]) : 0 };
}

/**
 * Create a worktree at `dir` for an EXISTING branch.
 *  - local branch:  git worktree add <dir> <branch>
 *  - remoteOnly:    git worktree add --track -b <branch> <dir> origin/<branch>
 * Throws with git's trimmed stderr on failure.
 */
export async function addBranchWorktree(
  repoRoot: string,
  dir: string,
  branch: string,
  remoteOnly: boolean
): Promise<void> {
  try {
    if (remoteOnly) {
      await git(
        ["worktree", "add", "--track", "-b", branch, dir, `origin/${branch}`],
        { cwd: repoRoot }
      );
    } else {
      await git(["worktree", "add", dir, branch], { cwd: repoRoot });
    }
  } catch (err) {
    const msg = String((err as { stderr?: string }).stderr ?? err);
    throw new Error(msg.trim());
  }
}

/**
 * Switch the branch checked out in an existing worktree. With `create`, makes a
 * new branch off the worktree's current HEAD (`git switch -c`); otherwise checks
 * out an existing local branch (`git switch`). Runs in the worktree's own
 * directory so only that worktree moves. Uncommitted changes are carried over by
 * git; a real conflict (or a branch already checked out in another worktree)
 * surfaces as the thrown, trimmed git stderr.
 */
export async function switchWorktreeBranch(
  worktreePath: string,
  branch: string,
  opts: { create?: boolean } = {}
): Promise<void> {
  const args = opts.create
    ? ["switch", "-c", branch]
    : ["switch", branch];
  try {
    await git(args, { cwd: worktreePath });
  } catch (err) {
    const msg = String((err as { stderr?: string }).stderr ?? err);
    throw new Error(msg.trim());
  }
}

/** Owner/repo of a GitHub remote, parsed from its URL. */
export interface RemoteInfo {
  owner: string;
  repo: string;
}

/**
 * Resolve the `origin` remote of `cwd` to its GitHub owner/repo, or undefined
 * when there is no origin, it is not a github.com remote, or git fails. Only
 * github.com is supported (the REST client targets api.github.com). Never
 * throws — a missing remote simply yields undefined so PR lookup is skipped.
 */
export async function getRemoteInfo(
  cwd: string
): Promise<RemoteInfo | undefined> {
  let url: string;
  try {
    const { stdout } = await git(["remote", "get-url", "origin"], { cwd });
    url = stdout.trim();
  } catch {
    return undefined;
  }
  return parseGitHubRemote(url);
}

/**
 * Parse a GitHub remote URL into {owner, repo}. Handles the SSH, scp-like and
 * HTTPS forms and strips a trailing `.git`. Returns undefined for non-github.com
 * hosts or anything unrecognized.
 */
export function parseGitHubRemote(url: string): RemoteInfo | undefined {
  // git@github.com:owner/repo.git  |  ssh://git@github.com/owner/repo.git
  // https://github.com/owner/repo(.git)  |  https://user@github.com/owner/repo
  const m = url.match(
    /github\.com[/:]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/i
  );
  if (!m) return undefined;
  const owner = m[1];
  const repo = m[2];
  if (!owner || !repo) return undefined;
  return { owner, repo };
}

/**
 * Delete a branch locally and/or on origin. `force` uses `git branch -D`
 * (instead of -d) so an unmerged local branch is still removed. The local
 * deletion runs before the remote push; each step throws with git's trimmed
 * stderr on failure.
 *
 * Remote deletion is tolerant of a stale tracking ref: if origin/<name> no
 * longer exists on the remote (the push fails with "remote ref does not
 * exist"), the goal is already met, so instead of failing we prune the local
 * `refs/remotes/origin/<name>` so the branch stops showing as remote.
 */
export async function deleteBranch(
  repoRoot: string,
  name: string,
  opts: { local?: boolean; remote?: boolean; force?: boolean }
): Promise<void> {
  const run = async (args: string[]) => {
    try {
      await git(args, { cwd: repoRoot });
    } catch (err) {
      const msg = String((err as { stderr?: string }).stderr ?? err);
      throw new Error(msg.trim());
    }
  };
  if (opts.local) {
    await run(["branch", opts.force ? "-D" : "-d", name]);
  }
  if (opts.remote) {
    try {
      await run(["push", "origin", "--delete", name]);
    } catch (err) {
      // Already gone on the remote (stale tracking ref): drop the local mirror
      // so the UI updates, and treat the delete as done rather than erroring.
      if (/remote ref does not exist/i.test((err as Error).message)) {
        await run(["branch", "-dr", `origin/${name}`]).catch(() => {});
      } else {
        throw err;
      }
    }
  }
}

/**
 * Remove a worktree. Passes `--force` only when explicitly requested. Force is
 * given twice because that is what git requires to remove a *locked* worktree
 * ("use 'remove -f -f' to override or unlock first"); a single --force only
 * covers dirty/unclean trees. Doubling it is harmless when the tree is merely
 * dirty, so one force flag serves both prompts.
 */
export async function removeWorktree(
  repoRoot: string,
  dir: string,
  force = false
): Promise<void> {
  try {
    await git(
      ["worktree", "remove", ...(force ? ["--force", "--force"] : []), dir],
      { cwd: repoRoot }
    );
  } catch (err) {
    const msg = String((err as { stderr?: string }).stderr ?? err);
    throw new Error(msg.trim());
  }
}

/** Unlock a locked worktree (`git worktree unlock`). */
export async function unlockWorktree(
  repoRoot: string,
  dir: string
): Promise<void> {
  try {
    await git(["worktree", "unlock", dir], { cwd: repoRoot });
  } catch (err) {
    const msg = String((err as { stderr?: string }).stderr ?? err);
    throw new Error(msg.trim());
  }
}

/**
 * Extract the pid from a Claude Code worktree lock reason. `claude -w` locks
 * the worktree it creates for the lifetime of the session, with a reason of the
 * form "claude session <name> (pid <pid> start <starttime>)". Returns the pid,
 * or undefined when the reason is not a Claude session lock (a lock the user or
 * another tool placed deliberately, which we must never touch).
 */
export function claudeSessionLockPid(
  reason: string | undefined
): number | undefined {
  if (!reason) return undefined;
  const m = /^claude session .+\(pid (\d+) start \d+\)\s*$/.exec(reason.trim());
  if (!m) return undefined;
  const pid = Number(m[1]);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

/** True when a process with this pid exists (signal 0 probe; EPERM = alive). */
function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Unlock worktrees whose lock is a stale Claude session lock: the reason names
 * a `claude` session pid that is no longer running, so the session died (crash,
 * kill, reboot) without unlocking on exit. Such a lock only gets in the way --
 * the panel shows a LOCKED badge on a worktree with no agents, and
 * `git worktree remove` refuses to touch it. Locks with any other reason, or
 * whose pid is still alive, are left strictly alone; if the pid was recycled by
 * an unrelated process the lock survives too, which errs on the safe side.
 *
 * Mutates `locked`/`lockReason` on the entries it unlocks and returns the paths
 * that were unlocked. Unlock failures are swallowed: this is opportunistic
 * cleanup, and the worst case is the badge staying until the next pass.
 */
export async function releaseStaleClaudeLocks(
  repoRoot: string,
  worktrees: Worktree[],
  isAlive: (pid: number) => boolean = pidIsAlive
): Promise<string[]> {
  const released: string[] = [];
  for (const wt of worktrees) {
    if (!wt.locked) continue;
    const pid = claudeSessionLockPid(wt.lockReason);
    if (pid === undefined || isAlive(pid)) continue;
    try {
      await unlockWorktree(repoRoot, wt.path);
      wt.locked = false;
      wt.lockReason = undefined;
      released.push(wt.path);
    } catch {
      /* opportunistic; retried on the next refresh */
    }
  }
  return released;
}

/**
 * Detach a worktree's HEAD (point it at its current commit, off any branch).
 * Used to free the branch a linked worktree is on so the branch can be deleted;
 * the worktree's files and commit are left in place.
 */
export async function detachWorktreeHead(worktreePath: string): Promise<void> {
  try {
    await git(["checkout", "--detach"], { cwd: worktreePath });
  } catch (err) {
    const msg = String((err as { stderr?: string }).stderr ?? err);
    throw new Error(msg.trim());
  }
}

/**
 * Undo git's C-style quoting of a porcelain value (used for lock reasons that
 * contain control characters or non-ASCII bytes): strip the wrapping double
 * quotes and decode backslash escapes. Unquoted values pass through unchanged.
 */
function unquotePorcelain(value: string): string {
  if (!(value.startsWith('"') && value.endsWith('"') && value.length >= 2)) {
    return value;
  }
  const escapes: Record<string, string> = {
    a: "\x07", b: "\b", f: "\f", n: "\n",
    r: "\r", t: "\t", v: "\v", '"': '"', "\\": "\\",
  };
  return value
    .slice(1, -1)
    .replace(/\\([0-7]{3}|.)/g, (_, esc: string) =>
      /^[0-7]{3}$/.test(esc)
        ? String.fromCharCode(parseInt(esc, 8))
        : escapes[esc] ?? esc
    );
}

/**
 * List the worktrees of the repository containing `cwd`, parsed from
 * `git worktree list --porcelain`. The first entry is the primary worktree.
 */
export async function listWorktrees(cwd: string): Promise<Worktree[]> {
  const { stdout } = await git(["worktree", "list", "--porcelain"], { cwd });
  const worktrees: Worktree[] = [];
  let current: Partial<Worktree> | undefined;

  const flush = () => {
    if (current?.path) {
      worktrees.push({
        path: current.path,
        branch: current.branch,
        head: current.head,
        detached: current.detached ?? false,
        locked: current.locked ?? false,
        lockReason: current.lockReason,
        isPrimary: false,
      });
    }
    current = undefined;
  };

  for (const raw of stdout.split("\n")) {
    const line = raw.trimEnd();
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      flush();
      current = { path: line.slice("worktree ".length) };
    } else if (!current) {
      continue;
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      // e.g. "branch refs/heads/main" -> "main"
      current.branch = line
        .slice("branch ".length)
        .replace(/^refs\/heads\//, "");
    } else if (line === "detached") {
      current.detached = true;
    } else if (line === "locked" || line.startsWith("locked ")) {
      current.locked = true;
      if (line.startsWith("locked ")) {
        current.lockReason = unquotePorcelain(line.slice("locked ".length));
      }
    }
  }
  flush();

  if (worktrees.length > 0) {
    worktrees[0].isPrimary = true;
  }
  return worktrees;
}
