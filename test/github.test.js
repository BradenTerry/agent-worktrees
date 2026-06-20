"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { getJson, resetGithubCache } = require("../out/github.js");

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
