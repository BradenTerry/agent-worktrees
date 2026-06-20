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
