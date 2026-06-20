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
  /** Reviewers requested but who haven't submitted a review yet. */
  reviewsPending: number;
  /** Issue + review-thread comments. */
  comments: number;
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
    const res = await fetch(url, { headers });
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
    updatedAt: raw.updated_at,
    headSha: sha,
  };
}

// --- branches overlay: all PRs in one GraphQL request -----------------------

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
}

/** The single GraphQL query: all open PRs with their rollups + filter fields. */
const PRS_BY_BRANCH_QUERY = `query($owner:String!,$name:String!){
  viewer { login }
  repository(owner:$owner, name:$name){
    pullRequests(states:[OPEN], first:100, orderBy:{field:UPDATED_AT, direction:DESC}){
      nodes{
        number title url isDraft state createdAt updatedAt headRefName
        author { login }
        assignees(first:20){ nodes { login } }
        comments { totalCount }
        reviews(first:100){ nodes { author { login } state submittedAt } }
        reviewRequests(first:50){ nodes { requestedReviewer { __typename ... on User { login } } } }
        commits(last:1){ nodes { commit {
          statusCheckRollup {
            contexts(first:100){ nodes {
              __typename
              ... on CheckRun { status conclusion }
              ... on StatusContext { state }
            } }
          }
        } } }
      }
    }
  }
}`;

/** GraphQL node shapes, narrowed to the fields the query selects. */
interface GqlLogin {
  login?: string;
}
interface GqlReview {
  author?: GqlLogin;
  state?: string;
  submittedAt?: string;
}
interface GqlReviewRequest {
  requestedReviewer?: { __typename?: string; login?: string };
}
interface GqlCheckContext {
  __typename?: string;
  status?: string;
  conclusion?: string | null;
  state?: string;
}
interface GqlPr {
  number: number;
  title: string;
  url: string;
  isDraft?: boolean;
  state?: string; // OPEN | CLOSED | MERGED
  createdAt?: string;
  updatedAt?: string;
  headRefName: string;
  author?: GqlLogin;
  assignees?: { nodes?: GqlLogin[] };
  comments?: { totalCount?: number };
  reviews?: { nodes?: GqlReview[] };
  reviewRequests?: { nodes?: GqlReviewRequest[] };
  commits?: {
    nodes?: {
      commit?: {
        statusCheckRollup?: { contexts?: { nodes?: GqlCheckContext[] } } | null;
      };
    }[];
  };
}
interface GqlResponse {
  data?: {
    viewer?: GqlLogin;
    repository?: { pullRequests?: { nodes?: GqlPr[] } };
  };
  errors?: unknown[];
}

/** PR lifecycle from the GraphQL enums: merged wins, then closed, then draft. */
function prStateFromGql(pr: GqlPr): BranchPrInfo["state"] {
  if (pr.state === "MERGED") return "merged";
  if (pr.state === "CLOSED") return "closed";
  if (pr.isDraft) return "draft";
  return "open";
}

/**
 * Adapt the statusCheckRollup contexts to the `{status, conclusion}` shape
 * `rollupChecks` consumes. CheckRun carries Actions status/conclusion (GraphQL
 * enums are UPPERCASE, so normalize to the REST lowercase the helper expects);
 * a legacy StatusContext carries a single `state` we map to a synthetic
 * conclusion so it flows through the same pass/fail/pending logic.
 */
function checksFromRollup(
  contexts?: GqlCheckContext[]
): { state: BranchPrInfo["checks"]; pass: number; fail: number; pending: number } {
  const runs: { status?: string; conclusion?: string | null }[] = [];
  for (const c of contexts ?? []) {
    if (c.__typename === "CheckRun") {
      runs.push({
        status: c.status ? c.status.toLowerCase() : undefined,
        conclusion: c.conclusion ? c.conclusion.toLowerCase() : c.conclusion,
      });
    } else {
      // StatusContext: SUCCESS / PENDING / FAILURE / ERROR / EXPECTED.
      const s = (c.state ?? "").toUpperCase();
      if (s === "SUCCESS") runs.push({ status: "completed", conclusion: "success" });
      else if (s === "FAILURE" || s === "ERROR")
        runs.push({ status: "completed", conclusion: "failure" });
      else runs.push({ status: "queued" }); // PENDING / EXPECTED / unknown -> pending
    }
  }
  // Reuse the REST rollup so branch and worktree-card semantics stay identical.
  return rollupChecks(runs);
}

/**
 * Fetch the repo's OPEN PRs with rollups + filter fields in one
 * POST /graphql, mapped by head ref name. Any failure (transport, non-2xx,
 * GraphQL errors) resolves to an empty map — never throws. Separate code path
 * from the REST `fetchPr` the worktree cards use.
 */
export async function fetchPrsByBranch(
  token: string,
  repo: RemoteInfo
): Promise<{ prs: Map<string, BranchPrInfo>; viewerLogin?: string }> {
  const prs = new Map<string, BranchPrInfo>();
  let body: GqlResponse | undefined;
  try {
    const res = await fetch(`${API}/graphql`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        query: PRS_BY_BRANCH_QUERY,
        variables: { owner: repo.owner, name: repo.repo },
      }),
    });
    if (!res.ok) return { prs };
    body = (await res.json()) as GqlResponse;
  } catch {
    return { prs };
  }
  // A GraphQL error body still comes back 200; treat it as failure.
  if (!body || (body.errors && body.errors.length)) return { prs };

  const viewerLogin = body.data?.viewer?.login;
  const nodes = body.data?.repository?.pullRequests?.nodes ?? [];

  for (const pr of nodes) {
    if (!pr || !pr.headRefName) continue;

    const checks = checksFromRollup(
      pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes
    );

    const reviewNodes = pr.reviews?.nodes ?? [];
    const requestedReviewers = (pr.reviewRequests?.nodes ?? [])
      .map((r) => r.requestedReviewer?.login)
      .filter((l): l is string => !!l);
    const requested = pr.reviewRequests?.nodes?.length ?? 0;
    const rev = reviewSummary(
      reviewNodes.map((r) => ({
        user: { login: r.author?.login },
        state: r.state,
        submitted_at: r.submittedAt,
      })),
      requested
    );

    const reviewedByViewer =
      !!viewerLogin && reviewNodes.some((r) => r.author?.login === viewerLogin);
    const reviewRequestedFromViewer =
      !!viewerLogin && requestedReviewers.includes(viewerLogin);

    const info: BranchPrInfo = {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      state: prStateFromGql(pr),
      checks: checks.state,
      checksPass: checks.pass,
      checksFail: checks.fail,
      checksPending: checks.pending,
      review: rev.review,
      approvals: rev.approvals,
      changesRequested: rev.changesRequested,
      reviewsPending: requested,
      comments: pr.comments?.totalCount ?? 0,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      author: pr.author?.login,
      assignees: (pr.assignees?.nodes ?? [])
        .map((a) => a.login)
        .filter((l): l is string => !!l),
      reviewedByViewer,
      reviewRequestedFromViewer,
    };

    // Key by head ref; if two open PRs share one, keep the most recently
    // updated. Nodes arrive UPDATED_AT desc, so the first seen wins.
    const existing = prs.get(pr.headRefName);
    if (!existing || (info.updatedAt ?? "") > (existing.updatedAt ?? "")) {
      prs.set(pr.headRefName, info);
    }
  }

  return { prs, viewerLogin };
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
