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


// --- fetchPrsByBranch (REST GET /pulls?state=open) --------------------------

const REPO = { owner: "acme", repo: "widgets" };

// A raw REST pull-list item with sane defaults; override per test.
function prItem(over) {
  return Object.assign(
    {
      number: 1,
      title: "PR",
      html_url: "https://github.com/acme/widgets/pull/1",
      state: "open",
      draft: false,
      merged_at: null,
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
      head: { ref: "feat-a", sha: "abc" },
      user: { login: "alice" },
      assignees: [],
      requested_reviewers: [],
      requested_teams: [],
      auto_merge: null,
    },
    over
  );
}

test("fetchPrsByBranch: maps a PR from the list (state, author, assignees, requested reviewer)", async () => {
  resetGithubCache();
  const item = prItem({
    number: 7,
    title: "Add feature A",
    html_url: "https://github.com/acme/widgets/pull/7",
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-10T00:00:00Z",
    head: { ref: "feat-a", sha: "deadbeef" },
    user: { login: "alice" },
    assignees: [{ login: "bob" }, { login: "you" }],
    requested_reviewers: [{ login: "you" }],
    auto_merge: { enabled_by: { login: "alice" } },
  });
  await withFetch(
    () => jsonResponse(200, [item]),
    async (calls) => {
      const { prs, viewerLogin } = await fetchPrsByBranch("tok", REPO, "you");
      // One GET to the pulls list, no per-PR follow-ups.
      assert.strictEqual(calls.length, 1);
      assert.match(calls[0].url, /\/repos\/acme\/widgets\/pulls\?state=open/);

      assert.strictEqual(viewerLogin, "you"); // echoed back
      const pr = prs.get("feat-a");
      assert.ok(pr, "PR keyed by head ref name");

      assert.strictEqual(pr.number, 7);
      assert.strictEqual(pr.state, "open");
      assert.strictEqual(pr.author, "alice");
      assert.deepStrictEqual(pr.assignees, ["bob", "you"]);
      assert.strictEqual(pr.createdAt, "2026-06-01T00:00:00Z");
      assert.strictEqual(pr.updatedAt, "2026-06-10T00:00:00Z");

      // The list endpoint has no check/review/comment data: all empty.
      assert.strictEqual(pr.checks, "none");
      assert.strictEqual(pr.checksPass, 0);
      assert.strictEqual(pr.review, "none");
      assert.strictEqual(pr.approvals, 0);
      assert.strictEqual(pr.changesRequested, 0);
      assert.strictEqual(pr.comments, 0);
      assert.strictEqual(pr.reviewedByViewer, false);

      // "you" is a still-pending requested reviewer.
      assert.strictEqual(pr.reviewsPending, 1);
      assert.strictEqual(pr.reviewRequestedFromViewer, true);
      assert.strictEqual(pr.autoMerge, true); // auto_merge object present
    }
  );
});

test("fetchPrsByBranch: derives merged state from merged_at", async () => {
  resetGithubCache();
  await withFetch(
    () =>
      jsonResponse(200, [
        prItem({
          number: 9,
          state: "closed",
          merged_at: "2026-06-09T00:00:00Z",
          head: { ref: "feat-done" },
        }),
      ]),
    async () => {
      const { prs } = await fetchPrsByBranch("tok", REPO, "you");
      const pr = prs.get("feat-done");
      assert.ok(pr, "merged PR is mapped");
      assert.strictEqual(pr.state, "merged");
      assert.strictEqual(pr.number, 9);
    }
  );
});

test("fetchPrsByBranch: draft state from the draft flag", async () => {
  resetGithubCache();
  await withFetch(
    () => jsonResponse(200, [prItem({ draft: true, head: { ref: "feat-a" } })]),
    async () => {
      const { prs } = await fetchPrsByBranch("tok", REPO, "you");
      assert.strictEqual(prs.get("feat-a").state, "draft");
    }
  );
});

test("fetchPrsByBranch: autoMerge is false when auto_merge is null", async () => {
  resetGithubCache();
  await withFetch(
    () =>
      jsonResponse(200, [prItem({ head: { ref: "feat-a" }, auto_merge: null })]),
    async () => {
      const { prs } = await fetchPrsByBranch("tok", REPO, "you");
      assert.strictEqual(prs.get("feat-a").autoMerge, false);
    }
  );
});

test("fetchPrsByBranch: prefers an open PR over a merged one on the same branch", async () => {
  resetGithubCache();
  // Merged PR is newer (arrives first under updated desc); the open one is
  // older. We should still surface the open PR for the branch.
  const merged = prItem({
    number: 2,
    state: "closed",
    merged_at: "2026-06-10T00:00:00Z",
    updated_at: "2026-06-10T00:00:00Z",
    head: { ref: "feat-a" },
  });
  const open = prItem({
    number: 1,
    state: "open",
    updated_at: "2026-06-02T00:00:00Z",
    head: { ref: "feat-a" },
  });
  await withFetch(
    () => jsonResponse(200, [merged, open]),
    async () => {
      const { prs } = await fetchPrsByBranch("tok", REPO, "you");
      const pr = prs.get("feat-a");
      assert.strictEqual(pr.state, "open");
      assert.strictEqual(pr.number, 1);
    }
  );
});

test("fetchPrsByBranch: pages through until a short page arrives", async () => {
  resetGithubCache();
  const fullPage = Array.from({ length: 100 }, (_, i) =>
    prItem({ number: i + 1, head: { ref: "feat-" + (i + 1) } })
  );
  await withFetch(
    (url) =>
      /page=2/.test(url)
        ? jsonResponse(200, [
            prItem({ number: 101, head: { ref: "feat-101" } }),
          ])
        : jsonResponse(200, fullPage),
    async (calls) => {
      const { prs } = await fetchPrsByBranch("tok", REPO, "you");
      assert.strictEqual(calls.length, 2, "fetched a second page");
      assert.ok(prs.get("feat-1"));
      assert.ok(prs.get("feat-101"));
    }
  );
});

test("fetchPrsByBranch: a non-2xx resolves to an empty map with an error", async () => {
  resetGithubCache();
  await withFetch(
    () => jsonResponse(403, undefined),
    async () => {
      const { prs, error } = await fetchPrsByBranch("tok", REPO, "you");
      assert.strictEqual(prs.size, 0);
      assert.ok(error, "error is surfaced for diagnostics");
    }
  );
});

test("fetchPrsByBranch: a transport error resolves to an empty map", async () => {
  resetGithubCache();
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  try {
    const { prs } = await fetchPrsByBranch("tok", REPO, "you");
    assert.strictEqual(prs.size, 0);
  } finally {
    globalThis.fetch = original;
  }
});

// --- completePrInfo / prUnchanged / fetchOpenPrsByHead -----------------------

const {
  completePrInfo,
  prUnchanged,
  fetchOpenPrsByHead,
} = require("../out/github.js");

const REPO2 = { owner: "o", repo: "r" };

function rawPr(over) {
  return {
    number: 7,
    title: "T",
    html_url: "https://github.com/o/r/pull/7",
    state: "open",
    updated_at: "2026-01-01T00:00:00Z",
    head: { sha: "sha1", ref: "feat" },
    requested_reviewers: [],
    ...over,
  };
}

function priorInfo(over) {
  return {
    number: 7,
    title: "T",
    url: "https://github.com/o/r/pull/7",
    state: "open",
    checks: "pass",
    checksPass: 3,
    checksFail: 0,
    checksPending: 0,
    review: "approved",
    approvals: 1,
    changesRequested: 0,
    reviewsPending: 0,
    comments: 4,
    mergeState: "clean",
    autoMerge: false,
    updatedAt: "2026-01-01T00:00:00Z",
    headSha: "sha1",
    ...over,
  };
}

test("prUnchanged: same number, updated_at and head sha", () => {
  assert.strictEqual(prUnchanged(priorInfo(), rawPr()), true);
  assert.strictEqual(
    prUnchanged(priorInfo(), rawPr({ updated_at: "2026-01-02T00:00:00Z" })),
    false
  );
  assert.strictEqual(
    prUnchanged(priorInfo(), rawPr({ head: { sha: "sha2", ref: "feat" } })),
    false
  );
  assert.strictEqual(prUnchanged(null, rawPr()), false);
  assert.strictEqual(prUnchanged(undefined, rawPr()), false);
});

test("completePrInfo: unchanged + settled + no aux makes zero requests", async () => {
  resetGithubCache();
  await withFetch(
    () => {
      throw new Error("no request expected");
    },
    async (calls) => {
      const info = await completePrInfo(
        "tok",
        REPO2,
        rawPr({ title: "fresher title" }),
        priorInfo(),
        false
      );
      assert.strictEqual(calls.length, 0);
      assert.strictEqual(info.title, "fresher title");
      assert.strictEqual(info.comments, 4);
      assert.strictEqual(info.checks, "pass");
    }
  );
});

test("completePrInfo: unchanged with pending checks refetches only checks + status", async () => {
  resetGithubCache();
  await withFetch(
    (url) => {
      if (url.includes("/check-runs")) {
        return jsonResponse(200, {
          check_runs: [{ status: "completed", conclusion: "success" }],
        });
      }
      if (url.includes("/status")) {
        return jsonResponse(200, { state: "success", total_count: 0 });
      }
      throw new Error("unexpected request: " + url);
    },
    async (calls) => {
      const info = await completePrInfo(
        "tok",
        REPO2,
        rawPr(),
        priorInfo({ checks: "pending", checksPending: 1, checksPass: 0 }),
        false
      );
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(info.checks, "pass");
      // Reviews and detail were reused from prior.
      assert.strictEqual(info.review, "approved");
      assert.strictEqual(info.comments, 4);
      assert.strictEqual(info.mergeState, "clean");
    }
  );
});

test("completePrInfo: aux refresh refetches detail + checks but not reviews", async () => {
  resetGithubCache();
  await withFetch(
    (url) => {
      if (url.endsWith("/pulls/7")) {
        return jsonResponse(200, {
          comments: 9,
          review_comments: 1,
          mergeable_state: "behind",
          auto_merge: null,
        });
      }
      if (url.includes("/check-runs")) {
        return jsonResponse(200, {
          check_runs: [{ status: "completed", conclusion: "success" }],
        });
      }
      if (url.includes("/status")) {
        return jsonResponse(200, { state: "success", total_count: 0 });
      }
      throw new Error("unexpected request: " + url);
    },
    async (calls) => {
      const info = await completePrInfo("tok", REPO2, rawPr(), priorInfo(), true);
      assert.strictEqual(calls.length, 3);
      assert.ok(!calls.some((c) => c.url.includes("/reviews")));
      // The base moved: the aux refresh catches the out-of-date flag.
      assert.strictEqual(info.mergeState, "behind");
      assert.strictEqual(info.comments, 10);
      assert.strictEqual(info.review, "approved");
    }
  );
});

test("completePrInfo: a changed PR refetches everything", async () => {
  resetGithubCache();
  await withFetch(
    (url) => {
      if (url.endsWith("/pulls/7")) {
        return jsonResponse(200, {
          comments: 1,
          review_comments: 0,
          mergeable_state: "clean",
        });
      }
      if (url.includes("/reviews")) return jsonResponse(200, []);
      if (url.includes("/check-runs")) return jsonResponse(200, { check_runs: [] });
      if (url.includes("/status")) return jsonResponse(200, { state: "pending", total_count: 0 });
      throw new Error("unexpected request: " + url);
    },
    async (calls) => {
      await completePrInfo(
        "tok",
        REPO2,
        rawPr({ updated_at: "2026-01-03T00:00:00Z" }),
        priorInfo(),
        false
      );
      assert.strictEqual(calls.length, 4);
    }
  );
});

test("fetchOpenPrsByHead: maps by head ref, undefined on first-page failure", async () => {
  resetGithubCache();
  await withFetch(
    () =>
      jsonResponse(200, [
        rawPr({ number: 1, head: { sha: "a", ref: "feat-a" } }),
        rawPr({ number: 2, head: { sha: "b", ref: "feat-b" } }),
        // Same head ref again (older, list is updated-desc): first one wins.
        rawPr({ number: 3, head: { sha: "c", ref: "feat-a" } }),
      ]),
    async () => {
      const map = await fetchOpenPrsByHead("tok", REPO2);
      assert.strictEqual(map.size, 2);
      assert.strictEqual(map.get("feat-a").number, 1);
      assert.strictEqual(map.get("feat-b").number, 2);
    }
  );
  resetGithubCache();
  await withFetch(
    () => jsonResponse(403, { message: "nope" }),
    async () => {
      assert.strictEqual(await fetchOpenPrsByHead("tok", REPO2), undefined);
    }
  );
});
