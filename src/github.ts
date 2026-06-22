import * as vscode from "vscode";
import { RemoteInfo } from "./git";

/**
 * GitHub integration: a thin, optional REST client used to show PR status per
 * worktree branch.
 *
 * It is entirely gated on a user-supplied Personal Access Token stored in VS
 * Code SecretStorage — no token means no network calls at all. Every request is
 * wrapped so a failure (bad token, offline, rate limit, missing PR) resolves to
 * a quiet null rather than throwing, so the panel never breaks because GitHub
 * was unreachable.
 */

const PAT_KEY = "agentWorktrees.githubPat";
const API = "https://api.github.com";
const UA = "agent-worktrees";

/**
 * Optional debug tracer, injected by the extension host (see `setGithubTracer`)
 * when the user enables tracing. Kept as injection — rather than importing the
 * diagnostics module — so github.ts stays free of any *runtime* vscode
 * dependency (its `vscode` import is type-only and elided), which is what lets
 * the unit tests load this module without a vscode stub. Null when tracing off.
 */
let traceSink: ((msg: string) => void) | null = null;

/** Enable/disable GitHub request tracing (pass null to disable). */
export function setGithubTracer(fn: ((msg: string) => void) | null): void {
  traceSink = fn;
}

/**
 * `fetch` wrapper that records each GitHub API call to the debug trace: method,
 * URL, response status, and duration. Request headers (which carry the token)
 * are never logged. Identical to `fetch` otherwise, and zero overhead when
 * tracing is off.
 */
async function tracedFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  if (!traceSink) return fetch(url, init);
  const method = init.method ?? "GET";
  const started = Date.now();
  try {
    const res = await fetch(url, init);
    traceSink(`github ${method} ${url} -> ${res.status} ${Date.now() - started}ms`);
    return res;
  } catch (e) {
    const first = (e instanceof Error ? e.message : String(e)).split("\n")[0];
    traceSink(`github ${method} ${url} -> ERROR ${Date.now() - started}ms: ${first}`);
    throw e;
  }
}

let ctx: vscode.ExtensionContext | undefined;
/** Cached /user probe, invalidated when the token changes. */
let probeCache: Promise<GithubConnection> | undefined;

/** Connection summary surfaced to the settings modal. */
export interface GithubConnection {
  /** True when a token is stored (regardless of whether it validated). */
  hasToken: boolean;
  /** True when the stored token authenticated against the API. */
  connected: boolean;
  /** Authenticated login, when connected. */
  login?: string;
  /** "classic" | "fine-grained" inferred from the X-OAuth-Scopes header. */
  tokenType?: "classic" | "fine-grained";
  /** Human-readable reason the token did not connect. */
  error?: string;
}

/** Rolled-up PR status for a single branch. */
export interface PrInfo {
  number: number;
  title: string;
  url: string;
  /** Lifecycle: open / draft / merged / closed(without merge). */
  state: "open" | "draft" | "merged" | "closed";
  /** CI rollup across check-runs and legacy commit statuses. */
  checks: "pass" | "fail" | "pending" | "none";
  checksPass: number;
  checksFail: number;
  checksPending: number;
  /** Review decision rolled up from the latest review per reviewer. */
  review: "approved" | "changes" | "required" | "none";
  approvals: number;
  changesRequested: number;
  /** Reviewers requested but who haven't submitted a review yet. */
  reviewsPending: number;
  /** Issue + review-thread comments. */
  comments: number;
  /** GitHub's mergeable_state, lowercased. The one users care about here is
   *  "behind": the branch is out of date with its base and must be updated
   *  before it can merge (GitHub's "This branch is out-of-date with the base
   *  branch"), even when every check is green. Others are
   *  blocked/clean/dirty/draft/has_hooks/unstable/unknown. */
  mergeState?:
    | "behind"
    | "blocked"
    | "clean"
    | "dirty"
    | "draft"
    | "has_hooks"
    | "unstable"
    | "unknown";
  /** Auto-merge is enabled: GitHub will merge this PR automatically once its
   *  required checks/reviews pass. */
  autoMerge?: boolean;
  updatedAt?: string;
  /** Head commit SHA. Used to detect a new push so polling can speed up while
   *  the fresh checks register; not displayed. */
  headSha?: string;
}

export function initGithub(context: vscode.ExtensionContext): void {
  ctx = context;
}

/** The stored token, or undefined when none is set. */
export async function getToken(): Promise<string | undefined> {
  return ctx?.secrets.get(PAT_KEY);
}

/** Store a token and re-probe; returns the fresh connection summary. */
export async function setToken(token: string): Promise<GithubConnection> {
  await ctx?.secrets.store(PAT_KEY, token);
  probeCache = undefined;
  resetGithubCache();
  return connection();
}

/** Forget the token; all PR calls become no-ops afterwards. */
export async function clearToken(): Promise<void> {
  await ctx?.secrets.delete(PAT_KEY);
  probeCache = undefined;
  resetGithubCache();
}

/** Probe the token (cached) and report whether/who it connects as. */
export async function connection(): Promise<GithubConnection> {
  const token = await getToken();
  if (!token) return { hasToken: false, connected: false };
  probeCache ??= probe(token);
  return probeCache;
}

async function probe(token: string): Promise<GithubConnection> {
  try {
    const res = await tracedFetch(`${API}/user`, { headers: authHeaders(token) });
    if (!res.ok) {
      const error =
        res.status === 401
          ? "Token rejected (invalid or expired)."
          : res.status === 403
          ? "Token lacks access or is rate limited."
          : `GitHub returned ${res.status}.`;
      return { hasToken: true, connected: false, error };
    }
    const body = (await res.json()) as { login?: string };
    // A classic PAT exposes its scopes in this header; a fine-grained one omits
    // it entirely.
    const scopeHeader = res.headers.get("x-oauth-scopes");
    return {
      hasToken: true,
      connected: true,
      login: body?.login,
      tokenType: scopeHeader === null ? "fine-grained" : "classic",
    };
  } catch (e) {
    return {
      hasToken: true,
      connected: false,
      error: `Could not reach GitHub: ${String(e).slice(0, 120)}`,
    };
  }
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": UA,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/**
 * Per-URL conditional-request cache: the last ETag we saw plus the parsed body
 * for it. Keyed by token + URL. A 304 "Not Modified" reply does not count
 * against GitHub's primary rate limit, so reusing ETags keeps the adaptive PR
 * poll cheap even while CI is running and we poll fast. Bounded so a long-lived
 * session can't grow it without limit.
 */
const condCache = new Map<string, { etag: string; value: unknown }>();
const COND_CACHE_MAX = 200;

/**
 * Capabilities (token + PAT-permission tag) we have seen denied with a 403 that
 * was not rate limiting. A fine-grained PAT can be missing a permission an
 * optional endpoint needs (e.g. "Commit statuses"); once we know it is denied
 * we skip that endpoint for the rest of the token's life instead of re-issuing
 * a call that can only keep failing. Keyed by token so a new credential never
 * inherits another's denials; also cleared wholesale on any token change.
 */
const deniedCaps = new Set<string>();

/** Drop the conditional-request and denied-capability caches (on token change,
 *  so we never reuse an ETag or a stale permission verdict across credentials). */
export function resetGithubCache(): void {
  condCache.clear();
  deniedCaps.clear();
}

/**
 * GET a JSON resource. Returns undefined on any non-2xx or transport error so
 * callers never have to try/catch — a failed call just means "no data".
 *
 * Sends `If-None-Match` when we have an ETag for this URL; a 304 reply returns
 * the cached body without re-downloading it (and without spending rate limit).
 */
export async function getJson<T>(
  path: string,
  token: string,
  capability?: string
): Promise<T | undefined> {
  // If this token already failed a permission check for this capability, skip
  // the request entirely — it can only 403 again for the token's whole life.
  if (capability && deniedCaps.has(`${token}\n${capability}`)) return undefined;
  const url = `${API}${path}`;
  const key = `${token}\n${url}`;
  const cached = condCache.get(key);
  const headers = authHeaders(token);
  if (cached) headers["If-None-Match"] = cached.etag;
  try {
    const res = await tracedFetch(url, { headers });
    // Unchanged since last fetch: reuse the cached body (free of rate limit).
    if (res.status === 304 && cached) return cached.value as T;
    if (!res.ok) {
      // A 403 that is not rate limiting (the limit still has room) means the
      // token lacks the permission this endpoint needs. Remember it so we stop
      // re-issuing a call that cannot succeed until the token is replaced.
      if (
        capability &&
        res.status === 403 &&
        res.headers.get("x-ratelimit-remaining") !== "0"
      ) {
        deniedCaps.add(`${token}\n${capability}`);
      }
      return undefined;
    }
    const value = (await res.json()) as T;
    const etag = res.headers.get("etag");
    if (etag) {
      // Refresh recency: delete + re-set so eviction below is roughly LRU.
      condCache.delete(key);
      condCache.set(key, { etag, value });
      if (condCache.size > COND_CACHE_MAX) {
        const oldest = condCache.keys().next().value;
        if (oldest !== undefined) condCache.delete(oldest);
      }
    }
    return value;
  } catch {
    return undefined;
  }
}

// --- PR fetch ---------------------------------------------------------------

interface RawPr {
  number: number;
  title: string;
  html_url: string;
  state: string; // "open" | "closed"
  draft?: boolean;
  merged_at?: string | null;
  created_at?: string;
  updated_at?: string;
  head?: { sha?: string; ref?: string };
  user?: { login?: string };
  assignees?: { login?: string }[];
  requested_reviewers?: { login?: string }[];
  requested_teams?: unknown[];
  /** null when off; an object describing the enabled auto-merge when on. */
  auto_merge?: unknown;
}

interface RawReview {
  user?: { login?: string };
  state?: string; // APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED | PENDING
  submitted_at?: string;
}

interface RawCheckRuns {
  check_runs?: { status?: string; conclusion?: string | null }[];
}

interface RawCombined {
  state?: string; // success | pending | failure
  total_count?: number;
}

interface RawPrDetail {
  comments?: number;
  review_comments?: number;
  requested_reviewers?: unknown[];
  /** Present only on the single-PR detail endpoint, not the list. */
  mergeable_state?: string;
  /** null when off; an object describing the enabled merge when on. */
  auto_merge?: unknown;
}

/**
 * Resolve the most relevant PR for `branch` in `repo`, with its CI, review and
 * comment rollups. Returns null when there is no PR or anything goes wrong.
 * Only ever called when a token is present (see PrService).
 */
export async function fetchPr(
  token: string,
  repo: RemoteInfo,
  branch: string
): Promise<PrInfo | null> {
  const { owner, repo: name } = repo;
  const head = encodeURIComponent(`${owner}:${branch}`);
  const list = await getJson<RawPr[]>(
    `/repos/${owner}/${name}/pulls?head=${head}&state=all&sort=updated&direction=desc&per_page=10`,
    token
  );
  if (!list || !list.length) return null;

  // Prefer an open PR; otherwise the most recently updated (list is already
  // sorted updated-desc).
  const raw = list.find((p) => p.state === "open") ?? list[0];
  const sha = raw.head?.sha;

  // Fetch the extras concurrently; each independently degrades to undefined.
  const [detail, reviews, checkRuns, combined] = await Promise.all([
    getJson<RawPrDetail>(
      `/repos/${owner}/${name}/pulls/${raw.number}`,
      token
    ),
    getJson<RawReview[]>(
      `/repos/${owner}/${name}/pulls/${raw.number}/reviews?per_page=100`,
      token
    ),
    sha
      ? getJson<RawCheckRuns>(
          `/repos/${owner}/${name}/commits/${sha}/check-runs?per_page=100`,
          token,
          "checks"
        )
      : Promise.resolve(undefined),
    sha
      ? getJson<RawCombined>(
          `/repos/${owner}/${name}/commits/${sha}/status`,
          token,
          "statuses"
        )
      : Promise.resolve(undefined),
  ]);

  const checks = rollupChecks(
    checkRuns?.check_runs,
    combined?.state,
    combined?.total_count
  );
  const requested =
    (detail?.requested_reviewers ?? raw.requested_reviewers ?? []).length;
  const rev = reviewSummary(reviews ?? [], requested);
  const comments = (detail?.comments ?? 0) + (detail?.review_comments ?? 0);

  return {
    number: raw.number,
    title: raw.title,
    url: raw.html_url,
    state: prState(raw),
    checks: checks.state,
    checksPass: checks.pass,
    checksFail: checks.fail,
    checksPending: checks.pending,
    review: rev.review,
    approvals: rev.approvals,
    changesRequested: rev.changesRequested,
    reviewsPending: requested,
    comments,
    mergeState: mapMergeState(detail?.mergeable_state),
    autoMerge: !!detail?.auto_merge,
    updatedAt: raw.updated_at,
    headSha: sha,
  };
}

// --- branches overlay: all PRs in one REST list call ------------------------

/**
 * Rolled-up PR status for a branch, plus the fields the branches-overlay
 * filters and sorts need. Produced from a single GraphQL query, keyed by head
 * ref. A superset of `PrInfo` semantics with the extra filter fields.
 */
export interface BranchPrInfo {
  number: number;
  title: string;
  url: string;
  state: "open" | "draft" | "merged" | "closed";
  checks: "pass" | "fail" | "pending" | "none";
  checksPass: number;
  checksFail: number;
  checksPending: number;
  review: "approved" | "changes" | "required" | "none";
  approvals: number;
  changesRequested: number;
  reviewsPending: number;
  comments: number;
  createdAt?: string;
  updatedAt?: string;
  /** PR author login. */
  author?: string;
  /** Assignee logins. */
  assignees: string[];
  /** Viewer submitted any review. */
  reviewedByViewer: boolean;
  /** Viewer is a requested reviewer. */
  reviewRequestedFromViewer: boolean;
  /** Auto-merge is enabled: GitHub will merge once required checks/reviews pass. */
  autoMerge: boolean;
}

/** Page cap for the PR fetch: up to ~1000 PRs (100/page, updated-desc). The loop
 *  stops early once a short page arrives, so small repos cost a single request;
 *  the cap only bounds pathologically large repos. */
const MAX_PR_PAGES = 10;

/**
 * Fetch the repo's PRs (open, merged, closed) via the REST `GET /pulls?state=all`
 * list, mapped by head ref name. One list call per page and no per-PR
 * follow-ups, so it works with a fine-grained PAT that has "Pull requests: Read"
 * but is denied GraphQL (the case the old GraphQL path failed on with "Resource
 * not accessible by personal access token"). The tradeoff: the list endpoint
 * carries no CI-check, review-decision, or comment data, so those fields are
 * left empty (checks/review "none", counts 0) — only what a single list call
 * provides is populated. Paged most-recently-updated first so a freshly merged
 * PR is covered; the cap bounds huge repos. A first-page failure resolves to an
 * empty map with `error` set; a later-page failure keeps the pages already
 * collected. Never throws.
 *
 * `viewerLogin` (the authenticated user, which the caller already resolves) is
 * echoed back and used to flag PRs where the viewer is a still-pending requested
 * reviewer. Passing it in keeps this a pure list fetch with no extra `/user`
 * call.
 */
export async function fetchPrsByBranch(
  token: string,
  repo: RemoteInfo,
  viewerLogin?: string
): Promise<{
  prs: Map<string, BranchPrInfo>;
  viewerLogin?: string;
  /** Set when the list fetch returned no data on the first page (non-2xx or
   *  transport error, both swallowed by getJson). Surfaced so the branches
   *  view's "no PRs" state can be diagnosed — typically the token lacking
   *  "Pull requests: Read". */
  error?: string;
}> {
  const { owner, repo: name } = repo;
  const prs = new Map<string, BranchPrInfo>();
  const raws: RawPr[] = [];
  let error: string | undefined;

  for (let page = 1; page <= MAX_PR_PAGES; page++) {
    const list = await getJson<RawPr[]>(
      `/repos/${owner}/${name}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`,
      token
    );
    if (!list) {
      // Only a first-page failure means "no data at all"; a later-page failure
      // keeps what we already collected.
      if (page === 1) {
        error =
          "GitHub returned no PR list (token may lack Pull requests: Read).";
      }
      break;
    }
    raws.push(...list);
    if (list.length < 100) break; // a short page is the last page
  }

  for (const raw of raws) {
    const headRef = raw.head?.ref;
    if (!headRef) continue;

    const requested = (raw.requested_reviewers ?? [])
      .map((r) => r.login)
      .filter((l): l is string => !!l);
    // A user drops out of requested_reviewers the moment they submit a review,
    // so this counts reviewers still pending (plus any requested teams).
    const reviewsPending = requested.length + (raw.requested_teams?.length ?? 0);

    const info: BranchPrInfo = {
      number: raw.number,
      title: raw.title,
      url: raw.html_url,
      state: prState(raw),
      // The list endpoint carries no CI-check, review-decision or comment data;
      // populating these would need a per-PR follow-up we deliberately skip.
      checks: "none",
      checksPass: 0,
      checksFail: 0,
      checksPending: 0,
      review: "none",
      approvals: 0,
      changesRequested: 0,
      reviewsPending,
      comments: 0,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      author: raw.user?.login,
      assignees: (raw.assignees ?? [])
        .map((a) => a.login)
        .filter((l): l is string => !!l),
      // No review data in the list, so we cannot know if the viewer reviewed.
      reviewedByViewer: false,
      reviewRequestedFromViewer:
        !!viewerLogin && requested.includes(viewerLogin),
      autoMerge: !!raw.auto_merge,
    };

    // Key by head ref. The list arrives updated-desc, so the first seen is the
    // most recent. Prefer an open/draft PR over a merged/closed one for the same
    // branch (mirrors the REST card path's `find(open) ?? latest`); otherwise
    // the newest already-stored one wins.
    const active = (s: BranchPrInfo["state"]) => s === "open" || s === "draft";
    const existing = prs.get(headRef);
    if (!existing || (active(info.state) && !active(existing.state))) {
      prs.set(headRef, info);
    }
  }

  return { prs, viewerLogin, error };
}

/**
 * Map GitHub's mergeable_state string onto our union. Anything unrecognised
 * (including the transient "unknown" GitHub returns while it recomputes
 * mergeability) becomes "unknown" so the panel shows no flag for it.
 */
export function mapMergeState(s: string | undefined): PrInfo["mergeState"] {
  switch ((s ?? "").toLowerCase()) {
    case "behind":
      return "behind";
    case "blocked":
      return "blocked";
    case "clean":
      return "clean";
    case "dirty":
      return "dirty";
    case "draft":
      return "draft";
    case "has_hooks":
      return "has_hooks";
    case "unstable":
      return "unstable";
    default:
      return "unknown";
  }
}

// --- pure mapping helpers (unit-tested) -------------------------------------

/** PR lifecycle from the raw fields: merged wins, then closed, then draft. */
export function prState(raw: {
  state: string;
  draft?: boolean;
  merged_at?: string | null;
}): PrInfo["state"] {
  if (raw.merged_at) return "merged";
  if (raw.state === "closed") return "closed";
  if (raw.draft) return "draft";
  return "open";
}

/**
 * Roll up CI across GitHub Actions check-runs and legacy commit statuses.
 * Any failure → fail; else anything still queued/in-progress/pending → pending;
 * else if there was any signal → pass; else none.
 *
 * `combinedTotal` is the commit-status endpoint's `total_count`: when it is 0
 * the commit has no legacy statuses and GitHub still reports the combined state
 * as "pending" by default, so we must skip folding it in or it shows a phantom
 * pending check on Actions-only PRs.
 */
export function rollupChecks(
  runs?: { status?: string; conclusion?: string | null }[],
  combinedState?: string,
  combinedTotal?: number
): { state: PrInfo["checks"]; pass: number; fail: number; pending: number } {
  let pass = 0;
  let fail = 0;
  let pending = 0;
  const FAIL = new Set([
    "failure",
    "timed_out",
    "cancelled",
    "action_required",
    "startup_failure",
    "stale",
  ]);
  for (const r of runs ?? []) {
    if (r.status && r.status !== "completed") {
      pending++;
      continue;
    }
    const c = (r.conclusion ?? "").toLowerCase();
    if (FAIL.has(c)) fail++;
    else if (c === "success" || c === "neutral" || c === "skipped") pass++;
    else pending++;
  }
  // Fold in the legacy combined commit-status state as one extra signal, but
  // only when there are actually legacy statuses. With none, GitHub reports the
  // combined state as "pending", which would otherwise add a phantom check.
  if ((combinedTotal ?? 0) > 0) {
    if (combinedState === "failure") fail++;
    else if (combinedState === "pending") pending++;
    else if (combinedState === "success") pass++;
  }

  let state: PrInfo["checks"];
  if (fail > 0) state = "fail";
  else if (pending > 0) state = "pending";
  else if (pass > 0) state = "pass";
  else state = "none";
  return { state, pass, fail, pending };
}

/**
 * Roll up the review decision from the latest review submitted by each reviewer
 * (COMMENTED/PENDING/DISMISSED do not count as a decision). `requested` is the
 * number of reviewers still asked but not yet responded.
 */
export function reviewSummary(
  reviews: { user?: { login?: string }; state?: string; submitted_at?: string }[],
  requested: number
): {
  review: PrInfo["review"];
  approvals: number;
  changesRequested: number;
} {
  const latest = new Map<string, string>();
  const ordered = [...reviews].sort((a, b) =>
    (a.submitted_at ?? "").localeCompare(b.submitted_at ?? "")
  );
  for (const r of ordered) {
    const login = r.user?.login;
    const state = (r.state ?? "").toUpperCase();
    if (!login) continue;
    if (state === "APPROVED" || state === "CHANGES_REQUESTED") {
      latest.set(login, state);
    } else if (state === "DISMISSED") {
      latest.delete(login);
    }
    // COMMENTED / PENDING: not a decision, leave the prior one in place.
  }
  let approvals = 0;
  let changesRequested = 0;
  for (const state of latest.values()) {
    if (state === "APPROVED") approvals++;
    else if (state === "CHANGES_REQUESTED") changesRequested++;
  }
  let review: PrInfo["review"];
  if (changesRequested > 0) review = "changes";
  else if (approvals > 0 && requested === 0) review = "approved";
  else if (requested > 0 || approvals > 0) review = "required";
  else review = "none";
  return { review, approvals, changesRequested };
}
