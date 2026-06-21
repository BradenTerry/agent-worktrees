"use strict";
const test = require("node:test");
const assert = require("node:assert");
const {
  getJson,
  resetGithubCache,
  fetchPrsByBranch,
} = require("../out/github.js");

// Replace global fetch with a scripted stub for the duration of `fn`.
async function withFetch(handler, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, headers: (init && init.headers) || {} });
    return handler(url, init, calls.length);
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(status, body, etag) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (h.toLowerCase() === "etag" ? etag : null) },
    json: async () => body,
  };
}

test("getJson: stores the ETag and sends If-None-Match on the next call", async () => {
  resetGithubCache();
  await withFetch(
    (url, init, n) =>
      n === 1
        ? jsonResponse(200, { v: 1 }, '"abc"')
        : jsonResponse(304, undefined, '"abc"'),
    async (calls) => {
      const first = await getJson("/x", "tok");
      assert.deepStrictEqual(first, { v: 1 });
      assert.strictEqual(calls[0].headers["If-None-Match"], undefined);

      const second = await getJson("/x", "tok");
      // 304 reuses the cached body.
      assert.deepStrictEqual(second, { v: 1 });
      assert.strictEqual(calls[1].headers["If-None-Match"], '"abc"');
    }
  );
});

test("getJson: a 200 with a new ETag refreshes the cached body", async () => {
  resetGithubCache();
  await withFetch(
    (url, init, n) =>
      n === 1
        ? jsonResponse(200, { v: 1 }, '"e1"')
        : jsonResponse(200, { v: 2 }, '"e2"'),
    async (calls) => {
      assert.deepStrictEqual(await getJson("/x", "tok"), { v: 1 });
      assert.deepStrictEqual(await getJson("/x", "tok"), { v: 2 });
      assert.strictEqual(calls[1].headers["If-None-Match"], '"e1"');
    }
  );
});

test("getJson: resetGithubCache forgets stored ETags", async () => {
  resetGithubCache();
  await withFetch(
    () => jsonResponse(200, { v: 1 }, '"e1"'),
    async (calls) => {
      await getJson("/x", "tok");
      resetGithubCache();
      await getJson("/x", "tok");
      // After a reset the second call must not send a conditional header.
      assert.strictEqual(calls[1].headers["If-None-Match"], undefined);
    }
  );
});

test("getJson: a different token does not reuse another token's ETag", async () => {
  resetGithubCache();
  await withFetch(
    () => jsonResponse(200, { v: 1 }, '"e1"'),
    async (calls) => {
      await getJson("/x", "tokA");
      await getJson("/x", "tokB");
      assert.strictEqual(calls[1].headers["If-None-Match"], undefined);
    }
  );
});

test("getJson: non-2xx (and no cache) returns undefined", async () => {
  resetGithubCache();
  await withFetch(
    () => jsonResponse(404, undefined, null),
    async () => {
      assert.strictEqual(await getJson("/missing", "tok"), undefined);
    }
  );
});

// A 403 carrying rate-limit headers with room left = the token lacks the
// permission, not throttling.
function forbidden(remaining) {
  return {
    ok: false,
    status: 403,
    headers: {
      get: (h) =>
        h.toLowerCase() === "x-ratelimit-remaining" ? remaining : null,
    },
    json: async () => ({}),
  };
}

test("getJson: a permission 403 is cached so the capability is not retried", async () => {
  resetGithubCache();
  await withFetch(
    () => forbidden("4999"),
    async (calls) => {
      assert.strictEqual(await getJson("/a/status", "tok", "statuses"), undefined);
      assert.strictEqual(await getJson("/b/status", "tok", "statuses"), undefined);
      // The second call is short-circuited: no network for a denied capability.
      assert.strictEqual(calls.length, 1);
    }
  );
});

test("getJson: a rate-limit 403 is NOT cached (retried later)", async () => {
  resetGithubCache();
  await withFetch(
    () => forbidden("0"),
    async (calls) => {
      await getJson("/a/status", "tok", "statuses");
      await getJson("/b/status", "tok", "statuses");
      // Exhausted rate limit is transient, so both calls go out.
      assert.strictEqual(calls.length, 2);
    }
  );
});

test("getJson: a denied capability does not block a different token", async () => {
  resetGithubCache();
  await withFetch(
    () => forbidden("4999"),
    async (calls) => {
      await getJson("/x/status", "tokA", "statuses");
      await getJson("/x/status", "tokB", "statuses");
      assert.strictEqual(calls.length, 2);
    }
  );
});

test("getJson: resetGithubCache forgets denied capabilities", async () => {
  resetGithubCache();
  await withFetch(
    () => forbidden("4999"),
    async (calls) => {
      await getJson("/x/status", "tok", "statuses");
      resetGithubCache();
      await getJson("/x/status", "tok", "statuses");
      assert.strictEqual(calls.length, 2);
    }
  );
});

test("getJson: an untagged 403 is not cached", async () => {
  resetGithubCache();
  await withFetch(
    () => forbidden("4999"),
    async (calls) => {
      await getJson("/x", "tok");
      await getJson("/x", "tok");
      assert.strictEqual(calls.length, 2);
    }
  );
});

// --- fetchPrsByBranch (GraphQL) ---------------------------------------------

const REPO = { owner: "acme", repo: "widgets" };

// A scripted GraphQL "data" body wrapped in a 200 response.
function gqlResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

// One open PR by user "alice" on "feat-a": 1 approval, a failing check, a
// passing check, a pending Actions run, viewer "you" requested + reviewed.
function samplePrBody() {
  return {
    data: {
      viewer: { login: "you" },
      repository: {
        pullRequests: {
          nodes: [
            {
              number: 7,
              title: "Add feature A",
              url: "https://github.com/acme/widgets/pull/7",
              isDraft: false,
              state: "OPEN",
              createdAt: "2026-06-01T00:00:00Z",
              updatedAt: "2026-06-10T00:00:00Z",
              headRefName: "feat-a",
              autoMergeRequest: { enabledAt: "2026-06-07T00:00:00Z" },
              author: { login: "alice" },
              assignees: { nodes: [{ login: "bob" }, { login: "you" }] },
              comments: { totalCount: 3 },
              reviews: {
                nodes: [
                  { author: { login: "carol" }, state: "APPROVED", submittedAt: "2026-06-05T00:00:00Z" },
                  { author: { login: "you" }, state: "COMMENTED", submittedAt: "2026-06-06T00:00:00Z" },
                ],
              },
              reviewRequests: {
                nodes: [
                  { requestedReviewer: { __typename: "User", login: "you" } },
                ],
              },
              commits: {
                nodes: [
                  {
                    commit: {
                      statusCheckRollup: {
                        contexts: {
                          nodes: [
                            { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
                            { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" },
                            { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: null },
                            { __typename: "StatusContext", state: "SUCCESS" },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    },
  };
}

test("fetchPrsByBranch: maps a PR (state, checks, reviews, viewer, author, assignees)", async () => {
  await withFetch(
    () => gqlResponse(200, samplePrBody()),
    async (calls) => {
      const { prs, viewerLogin } = await fetchPrsByBranch("tok", REPO);
      // One POST to /graphql, no per-branch REST calls.
      assert.strictEqual(calls.length, 1);
      assert.match(calls[0].url, /\/graphql$/);

      assert.strictEqual(viewerLogin, "you");
      const pr = prs.get("feat-a");
      assert.ok(pr, "PR keyed by head ref name");

      assert.strictEqual(pr.number, 7);
      assert.strictEqual(pr.state, "open");
      assert.strictEqual(pr.author, "alice");
      assert.deepStrictEqual(pr.assignees, ["bob", "you"]);
      assert.strictEqual(pr.comments, 3);
      assert.strictEqual(pr.createdAt, "2026-06-01T00:00:00Z");
      assert.strictEqual(pr.updatedAt, "2026-06-10T00:00:00Z");

      // 1 success CheckRun + 1 success StatusContext = 2 pass, 1 fail, 1 pending.
      assert.strictEqual(pr.checks, "fail"); // any fail wins
      assert.strictEqual(pr.checksPass, 2);
      assert.strictEqual(pr.checksFail, 1);
      assert.strictEqual(pr.checksPending, 1);

      // carol approved; "you" only commented; one reviewer ("you") still requested.
      assert.strictEqual(pr.approvals, 1);
      assert.strictEqual(pr.changesRequested, 0);
      assert.strictEqual(pr.reviewsPending, 1);
      assert.strictEqual(pr.review, "required"); // approval but a request still open

      assert.strictEqual(pr.reviewedByViewer, true); // "you" submitted a review
      assert.strictEqual(pr.reviewRequestedFromViewer, true); // "you" is requested
      assert.strictEqual(pr.autoMerge, true); // autoMergeRequest present
    }
  );
});

// A minimal PR node with sane defaults; override per test. Empty rollups so the
// mapping has nothing to choke on.
function prNode(over) {
  return Object.assign(
    {
      number: 1,
      title: "PR",
      url: "https://github.com/acme/widgets/pull/1",
      isDraft: false,
      state: "OPEN",
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
      headRefName: "feat-a",
      author: { login: "alice" },
      assignees: { nodes: [] },
      comments: { totalCount: 0 },
      reviews: { nodes: [] },
      reviewRequests: { nodes: [] },
      commits: { nodes: [] },
    },
    over
  );
}

function gqlNodes(nodes) {
  return { data: { viewer: { login: "you" }, repository: { pullRequests: { nodes } } } };
}

test("fetchPrsByBranch: includes a merged PR (state=merged)", async () => {
  await withFetch(
    () => gqlResponse(200, gqlNodes([prNode({ number: 9, state: "MERGED", headRefName: "feat-done" })])),
    async () => {
      const { prs } = await fetchPrsByBranch("tok", REPO);
      const pr = prs.get("feat-done");
      assert.ok(pr, "merged PR is mapped");
      assert.strictEqual(pr.state, "merged");
      assert.strictEqual(pr.number, 9);
    }
  );
});

test("fetchPrsByBranch: autoMerge is false when no autoMergeRequest is set", async () => {
  await withFetch(
    () => gqlResponse(200, gqlNodes([prNode({ headRefName: "feat-a" })])),
    async () => {
      const { prs } = await fetchPrsByBranch("tok", REPO);
      assert.strictEqual(prs.get("feat-a").autoMerge, false);
    }
  );
});

test("fetchPrsByBranch: prefers an open PR over a merged one on the same branch", async () => {
  // Merged PR is newer (arrives first under UPDATED_AT desc); the open one is
  // older. We should still surface the open PR for the branch.
  const merged = prNode({ number: 2, state: "MERGED", updatedAt: "2026-06-10T00:00:00Z" });
  const open = prNode({ number: 1, state: "OPEN", updatedAt: "2026-06-02T00:00:00Z" });
  await withFetch(
    () => gqlResponse(200, gqlNodes([merged, open])),
    async () => {
      const { prs } = await fetchPrsByBranch("tok", REPO);
      const pr = prs.get("feat-a");
      assert.strictEqual(pr.state, "open");
      assert.strictEqual(pr.number, 1);
    }
  );
});

test("fetchPrsByBranch: pages through until hasNextPage is false", async () => {
  const page = (hasNext, endCursor, nodes) => ({
    data: {
      viewer: { login: "you" },
      repository: { pullRequests: { pageInfo: { hasNextPage: hasNext, endCursor }, nodes } },
    },
  });
  await withFetch(
    (_url, init) => {
      const vars = JSON.parse(init.body).variables;
      return vars.after
        ? gqlResponse(200, page(false, null, [prNode({ number: 2, headRefName: "feat-2" })]))
        : gqlResponse(200, page(true, "CUR1", [prNode({ number: 1, headRefName: "feat-1" })]));
    },
    async (calls) => {
      const { prs } = await fetchPrsByBranch("tok", REPO);
      assert.strictEqual(calls.length, 2, "fetched a second page");
      assert.ok(prs.get("feat-1"));
      assert.ok(prs.get("feat-2"));
    }
  );
});

test("fetchPrsByBranch: a GraphQL errors body resolves to an empty map", async () => {
  await withFetch(
    () => gqlResponse(200, { errors: [{ message: "Bad credentials" }] }),
    async () => {
      const { prs, viewerLogin } = await fetchPrsByBranch("tok", REPO);
      assert.strictEqual(prs.size, 0);
      assert.strictEqual(viewerLogin, undefined);
    }
  );
});

test("fetchPrsByBranch: a non-2xx resolves to an empty map", async () => {
  await withFetch(
    () => gqlResponse(401, undefined),
    async () => {
      const { prs } = await fetchPrsByBranch("tok", REPO);
      assert.strictEqual(prs.size, 0);
    }
  );
});

test("fetchPrsByBranch: a transport error resolves to an empty map", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  try {
    const { prs } = await fetchPrsByBranch("tok", REPO);
    assert.strictEqual(prs.size, 0);
  } finally {
    globalThis.fetch = original;
  }
});
