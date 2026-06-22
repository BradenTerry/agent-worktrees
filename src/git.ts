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
  return execFileAsync("git", args, {
    timeout: GIT_TIMEOUT_MS,
    ...opts,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
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

/**
 * Summarize the working-tree state of a worktree using
 * `git status --porcelain=v2 --branch`: a count of changed entries plus the
 * ahead/behind distance from the upstream branch. Note ahead/behind is read
 * from local refs; call `fetchRemotes` first for an up-to-date behind count.
 */
export async function getStatus(cwd: string): Promise<GitStatus> {
  let dirty = 0;
  let ahead = 0;
  let behind = 0;
  try {
    const { stdout } = await git(
      ["status", "--porcelain=v2", "--branch"],
      { cwd }
    );
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
      } else if (!line.startsWith("#")) {
        // 1/2/u = tracked changes, ? = untracked, ! = ignored (excluded below).
        if (line[0] !== "!") dirty++;
      }
    }
  } catch {
    /* leave zeros on error */
  }
  const { insertions, deletions } = await getDiffStat(cwd);
  return { dirty, insertions, deletions, ahead, behind };
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
  /** Lines added vs the compare base across the branch's own commits. */
  insertions: number;
  /** Lines removed vs the compare base. */
  deletions: number;
  /** The repo's default branch (origin/HEAD, e.g. "main"). Never deletable. */
  isDefault: boolean;
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
  "%(refname:short)%00%(worktreepath)%00%(upstream:track,nobracket)%00%(upstream:short)";

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
    const [name, worktreePath, track, upstream] = line.split("\0");
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
      insertions: 0,
      deletions: 0,
      isDefault: false,
    });
  }
  return { branches, upstreamOf };
}

/**
 * Parse `git for-each-ref refs/remotes/origin` (full refnames) into the set of
 * origin branch short-names, excluding the origin/HEAD symbolic alias. Pure and
 * exported for unit tests. Uses the FULL refname because `refname:short`
 * collapses `refs/remotes/origin/HEAD` to the bare "origin", which would slip
 * past a guard and surface a phantom "origin" branch.
 */
export function parseOriginNames(stdout: string): Set<string> {
  const names = new Set<string>();
  for (const raw of stdout.split(/\r?\n/)) {
    const ref = raw.trimEnd();
    if (ref === "") continue;
    const name = ref.replace(/^refs\/remotes\/origin\//, "");
    if (name && name !== "HEAD") names.add(name);
  }
  return names;
}

export async function listBranches(cwd: string): Promise<BranchInfo[]> {
  const startedAt = Date.now();

  const { stdout: localOut } = await git(
    ["for-each-ref", `--format=${LOCAL_REF_FORMAT}`, "refs/heads"],
    { cwd }
  );
  const { branches, upstreamOf } = parseLocalBranchRefs(localOut);

  const { stdout: remoteOut } = await git(
    ["for-each-ref", "--format=%(refname)", "refs/remotes/origin"],
    { cwd }
  );
  const originNames = parseOriginNames(remoteOut);

  const localNames = new Set(branches.map((b) => b.name));
  for (const b of branches) b.hasRemote = originNames.has(b.name);
  for (const name of originNames) {
    if (localNames.has(name)) continue;
    branches.push({
      name,
      remoteOnly: true,
      hasRemote: true,
      hasWorktree: false,
      ahead: 0,
      behind: 0,
      insertions: 0,
      deletions: 0,
      isDefault: false,
    });
  }

  // Enrich each branch with ahead/behind and, only when it is actually ahead,
  // its +/- line diff vs the compare base. Bounded concurrency keeps a
  // many-branch repo from spawning a git process per branch all at once. Any
  // per-branch failure leaves that branch's counts at zero.
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
  let diffCalls = 0;
  await mapLimit(branches, 8, async (b) => {
    const tip = b.remoteOnly ? `origin/${b.name}` : b.name;
    const base = b.remoteOnly
      ? defaultRef
      : upstreamOf.get(b.name) || (b.hasRemote ? `origin/${b.name}` : defaultRef);
    if (!base || base === tip) return;
    // Resolve ahead/behind first. A configured upstream already gave
    // authoritative counts via %(upstream:track); everything else (no upstream,
    // or remote-only) is counted against the base.
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
    // The +/- line diff is `git diff --numstat base...tip` (three-dot): it shows
    // only the changes tip introduced since it diverged from base. When the
    // branch is not ahead, tip has no commits the base lacks, so that diff is
    // always empty (0/0). Skip it then — that is what keeps a repo full of
    // merged/in-sync branches from running an expensive tree diff per branch.
    if (b.ahead > 0) {
      diffCalls++;
      const diff = await diffStat(cwd, base, tip);
      b.insertions = diff.insertions;
      b.deletions = diff.deletions;
    }
  });
  log(
    `listBranches: ${branches.length} branches in ${
      Date.now() - startedAt
    }ms (${aheadBehindCalls} ahead/behind + ${diffCalls} diff calls${
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
 * The repo's default branch short name from origin/HEAD (e.g. "main", "master",
 * "trunk" — whatever git reports), or undefined when origin/HEAD is not set.
 * Authoritative and used to protect the default branch from deletion, so it
 * trusts git rather than guessing at a name.
 */
export async function defaultBranchName(
  cwd: string
): Promise<string | undefined> {
  try {
    const { stdout } = await git(
      ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
      { cwd }
    );
    const ref = stdout.trim().replace(/^refs\/remotes\/origin\//, "");
    return ref || undefined;
  } catch {
    return undefined;
  }
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
  try {
    const { stdout } = await git(
      ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
      { cwd }
    );
    const ref = stdout.trim().replace(/^refs\/remotes\//, "");
    if (ref) return ref;
  } catch {
    /* no origin/HEAD: fall through to the candidate list */
  }
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

/** Lines added/removed introduced by `tip` since it diverged from `base`
 *  (`git diff --numstat base...tip`). Binary files are skipped; zero on error. */
async function diffStat(
  cwd: string,
  base: string,
  tip: string
): Promise<{ insertions: number; deletions: number }> {
  let insertions = 0;
  let deletions = 0;
  try {
    const { stdout } = await git(
      ["diff", "--numstat", `${base}...${tip}`],
      { cwd }
    );
    for (const line of stdout.split("\n")) {
      const m = line.match(/^(\d+)\t(\d+)\t/);
      if (m) {
        insertions += Number(m[1]);
        deletions += Number(m[2]);
      }
    }
  } catch {
    /* missing ref / unrelated histories: leave zeros */
  }
  return { insertions, deletions };
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

/** Run `fn` over `items` with at most `limit` in flight at once. */
async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let i = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx]);
      }
    }
  );
  await Promise.all(workers);
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

/** Remove a worktree. Passes `--force` only when explicitly requested. */
export async function removeWorktree(
  repoRoot: string,
  dir: string,
  force = false
): Promise<void> {
  try {
    await git(
      ["worktree", "remove", ...(force ? ["--force"] : []), dir],
      { cwd: repoRoot }
    );
  } catch (err) {
    const msg = String((err as { stderr?: string }).stderr ?? err);
    throw new Error(msg.trim());
  }
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
    }
  }
  flush();

  if (worktrees.length > 0) {
    worktrees[0].isPrimary = true;
  }
  return worktrees;
}
