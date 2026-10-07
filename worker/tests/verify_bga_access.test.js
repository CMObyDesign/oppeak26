// GET /verify-bga-access — BGA intake access gate.
//
// Server-side authorization for the /bga-intake wrapper on
// success.cfobydesign.com. The wrapper is a static HL funnel page; we
// never want it to reveal the intake survey unless the viewer actually
// purchased the Business Growth Analysis. Without this check, the only
// barrier is HL only emailing the URL to paid contacts — fine for the
// common path, defeated by a shared/guessed id.
//
// Pins the four behaviors the hardening ticket named, plus three
// safety ones:
//   1. paid_297 contact + valid contactId          → 200 authorized
//   2. contact without swot_paid_297 + known id   → 403 rejected
//   3. missing contactId                          → 400 rejected
//   4. GHL lookup / network error                 → 503 fail closed
//   + GHL returns 404 (unknown contact)           → 403 (no existence leak)
//   + no GHL_API_KEY in env                       → 503 fail closed
//   + every response carries Cache-Control: no-store

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import worker from "../src/index.js";
import { captureFetch } from "./helpers.js";

function get(path) {
  return new Request("https://example.com" + path, { method: "GET" });
}

function makeEnv(overrides = {}) {
  return {
    GHL_API_KEY: "test-ghl-key",
    GHL_LOCATION_ID: "test-loc",
    ...overrides,
  };
}

describe("GET /verify-bga-access — the four pinned cases", () => {
  it("paid_297 contact + valid contactId → 200 { authorized: true }", async () => {
    const cap = captureFetch((url) => {
      if (url.includes("/contacts/paid-1")) {
        return new Response(
          JSON.stringify({
            contact: { id: "paid-1", tags: ["swot_paid_297", "some_other_tag"] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("", { status: 500 });
    });
    try {
      const res = await worker.fetch(
        get("/verify-bga-access?contactId=paid-1"),
        makeEnv(),
        {},
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.authorized, true);
      assert.equal(
        res.headers.get("Cache-Control"),
        "no-store",
        "authorized responses must not be cacheable",
      );
    } finally {
      cap.restore();
    }
  });

  it("contact without swot_paid_297 → 403 { authorized: false } (don't leak which tag was missing)", async () => {
    const cap = captureFetch(() =>
      new Response(
        JSON.stringify({
          contact: { id: "free-1", tags: ["swot_free_lead", "swot_paid_47"] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    try {
      const res = await worker.fetch(
        get("/verify-bga-access?contactId=free-1"),
        makeEnv(),
        {},
      );
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.equal(body.authorized, false);
      // Body must not say WHY — "contact exists but unpaid" vs. "no such
      // contact" collapse to the same shape so a probe can't tell them
      // apart.
      assert.ok(
        !("tag" in body) && !("reason" in body) && !("error" in body),
        `403 body must be minimal, got: ${JSON.stringify(body)}`,
      );
    } finally {
      cap.restore();
    }
  });

  it("missing contactId → 400 { authorized: false }", async () => {
    const res = await worker.fetch(
      get("/verify-bga-access"),
      makeEnv(),
      {},
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.authorized, false);
    assert.ok(body.error, "400 may name the shape error since no probe happened");
  });

  it("GHL responds 500 (lookup failure) → 503 fail closed", async () => {
    const cap = captureFetch(() => new Response("boom", { status: 500 }));
    try {
      const res = await worker.fetch(
        get("/verify-bga-access?contactId=any"),
        makeEnv(),
        {},
      );
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.authorized, false);
    } finally {
      cap.restore();
    }
  });
});

describe("GET /verify-bga-access — safety cases", () => {
  it("GHL returns 404 (unknown contact) → 403 (does NOT leak existence)", async () => {
    const cap = captureFetch(() => new Response("", { status: 404 }));
    try {
      const res = await worker.fetch(
        get("/verify-bga-access?contactId=nope"),
        makeEnv(),
        {},
      );
      // 404 from GHL maps to 403 here. If we returned 404, an attacker
      // enumerating ids would get a yes/no existence oracle for free.
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.equal(body.authorized, false);
    } finally {
      cap.restore();
    }
  });

  it("GHL fetch throws (network error / timeout) → 503 fail closed", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("network down");
    };
    try {
      const res = await worker.fetch(
        get("/verify-bga-access?contactId=any"),
        makeEnv(),
        {},
      );
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.authorized, false);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("no GHL_API_KEY configured → 503 fail closed (never authorize blind)", async () => {
    // Pass a request-level fetch stub so a missing key doesn't fall
    // through to a real network call if someone changes the handler.
    const cap = captureFetch(() => {
      throw new Error("should not call GHL without a key");
    });
    try {
      const res = await worker.fetch(
        get("/verify-bga-access?contactId=any"),
        makeEnv({ GHL_API_KEY: "" }),
        {},
      );
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.authorized, false);
    } finally {
      cap.restore();
    }
  });

  it("every response carries Cache-Control: no-store", async () => {
    // Pin the header on all code paths — authorized, unauthorized, bad
    // input, and fail-closed. Browser caches and corporate proxies
    // should never reuse a verification response.
    const paths = [
      ["200", "paid", 200, (u) =>
        new Response(
          JSON.stringify({ contact: { id: "paid", tags: ["swot_paid_297"] } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ],
      ["403", "free", 403, () =>
        new Response(
          JSON.stringify({ contact: { id: "free", tags: [] } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ],
      ["503", "boom", 503, () => new Response("", { status: 500 })],
    ];
    for (const [label, cid, expected, responder] of paths) {
      const cap = captureFetch(responder);
      try {
        const res = await worker.fetch(
          get(`/verify-bga-access?contactId=${cid}`),
          makeEnv(),
          {},
        );
        assert.equal(res.status, expected, `${label} path status`);
        assert.equal(
          res.headers.get("Cache-Control"),
          "no-store",
          `${label} path must set Cache-Control: no-store`,
        );
      } finally {
        cap.restore();
      }
    }

    // And the 400 path too (no fetch call).
    const res = await worker.fetch(
      get("/verify-bga-access"),
      makeEnv(),
      {},
    );
    assert.equal(res.status, 400);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
  });

  it("CORS Access-Control-Allow-Origin matches BGA_INTAKE_ORIGIN env (fallback: success.cfobydesign.com)", async () => {
    // Default fallback.
    {
      const cap = captureFetch(() =>
        new Response(
          JSON.stringify({ contact: { id: "p", tags: ["swot_paid_297"] } }),
          { status: 200 },
        ),
      );
      try {
        const res = await worker.fetch(
          get("/verify-bga-access?contactId=p"),
          makeEnv(),
          {},
        );
        assert.equal(
          res.headers.get("Access-Control-Allow-Origin"),
          "https://success.cfobydesign.com",
          "default origin must narrow to success.cfobydesign.com, not *",
        );
      } finally {
        cap.restore();
      }
    }

    // Env override.
    {
      const cap = captureFetch(() =>
        new Response(
          JSON.stringify({ contact: { id: "p", tags: ["swot_paid_297"] } }),
          { status: 200 },
        ),
      );
      try {
        const res = await worker.fetch(
          get("/verify-bga-access?contactId=p"),
          makeEnv({ BGA_INTAKE_ORIGIN: "https://staging.cfobydesign.com" }),
          {},
        );
        assert.equal(
          res.headers.get("Access-Control-Allow-Origin"),
          "https://staging.cfobydesign.com",
        );
      } finally {
        cap.restore();
      }
    }
  });
});
