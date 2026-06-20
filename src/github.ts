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
  /** Issue + review-thread comments. */
  comments: number;
  updatedAt?: string;
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
    const res = await fetch(`${API}/user`, { headers: authHeaders(token) });
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

/** Drop the conditional-request cache (on token change, so we never reuse an
 *  ETag across credentials). */
export function resetGithubCache(): void {
  condCache.clear();
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
  token: string
): Promise<T | undefined> {
  const url = `${API}${path}`;
  const key = `${token}\n${url}`;
  const cached = condCache.get(key);
  const headers = authHeaders(token);
  if (cached) headers["If-None-Match"] = cached.etag;
  try {
    const res = await fetch(url, { headers });
    // Unchanged since last fetch: reuse the cached body (free of rate limit).
    if (res.status === 304 && cached) return cached.value as T;
    if (!res.ok) return undefined;
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
  updated_at?: string;
  head?: { sha?: string };
  requested_reviewers?: unknown[];
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
          token
        )
      : Promise.resolve(undefined),
    sha
      ? getJson<RawCombined>(
          `/repos/${owner}/${name}/commits/${sha}/status`,
          token
        )
      : Promise.resolve(undefined),
  ]);

  const checks = rollupChecks(checkRuns?.check_runs, combined?.state);
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
    comments,
    updatedAt: raw.updated_at,
  };
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
 */
export function rollupChecks(
  runs?: { status?: string; conclusion?: string | null }[],
  combinedState?: string
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
  // Fold in the legacy combined commit-status state as one extra signal.
  if (combinedState === "failure") fail++;
  else if (combinedState === "pending") pending++;
  else if (combinedState === "success") pass++;

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
