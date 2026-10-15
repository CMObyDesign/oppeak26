// BGA Copilot — case search endpoint tests (PR 125).
//
// Pins:
//   - Password gating on POST /asksolomon/case/search.
//   - 503 when GHL catalog is unavailable.
//   - 503 when GHL /contacts/search is unreachable or non-ok.
//   - Only swot_paid_297 contacts leak through (defensive filter even
//     when the tag filter is in the request body).
//   - Badge computation covers the five states:
//       sent → ready-to-finalize → ready-for-call → needs-roadmap →
//       needs-financials (default).
//   - Free-text match (q) is case-insensitive and spans name, company,
//     and email.
//   - limit is bounded 1..100.
//
// Spec references:
//   docs/BGA_COPILOT_SPEC.md §2.1 ("loading a case" — the picker that
//     feeds this endpoint).

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { handleCaseSearch, computeBadges } from "../src/bga_copilot/case_search.js";
import { _resetCatalogCacheForTests } from "../src/ghl_catalog.js";

function makeEnv() {
  return {
    GHL_API_KEY: "test-ghl-key",
    GHL_LOCATION_ID: "test-loc",
    CONSOLE_PASSWORD: "test-password",
  };
}

const PASS_HEADER = { "x-console-password": "test-password" };

function post(body, headers = PASS_HEADER) {
  return new Request("https://example.com/asksolomon/case/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function checkPassword(request, env) {
  const p = request.headers.get("x-console-password");
  return p && env.CONSOLE_PASSWORD && p === env.CONSOLE_PASSWORD;
}

function stubFetch(responder) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || "GET", body: init?.body });
    return responder(url, init);
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

const DEFAULT_CATALOG = [
  { id: "id-vf",      fieldKey: "contact.swot_verified_financials",  dataType: "LARGE_TEXT" },
  { id: "id-draft",   fieldKey: "contact.swot_growth_plan_draft",    dataType: "LARGE_TEXT" },
  { id: "id-prep",    fieldKey: "contact.swot_bga_prep_brief",       dataType: "LARGE_TEXT" },
  { id: "id-redteam", fieldKey: "contact.swot_bga_red_team_report",  dataType: "LARGE_TEXT" },
];

function catalogResponse(entries) {
  return new Response(JSON.stringify({ customFields: entries || DEFAULT_CATALOG }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function searchResponse(contacts) {
  return new Response(JSON.stringify({ contacts }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Routes catalog vs search by URL and returns the configured responses.
 */
function routedResponder({ catalog, search }) {
  return (url, init) => {
    const u = String(url);
    if (u.includes("/customFields")) return (catalog || catalogResponse)(url, init);
    if (u.includes("/contacts/search")) return search(url, init);
    throw new Error(`unexpected fetch ${u}`);
  };
}

function makeContact({ id, firstName = "", lastName = "", email = "", companyName = "", tags = ["swot_paid_297"], customFields = [], dateUpdated = "2026-10-14T00:00:00.000Z" } = {}) {
  return {
    id,
    firstName,
    lastName,
    email,
    companyName,
    tags,
    customFields,
    dateUpdated,
    dateAdded: dateUpdated,
  };
}

beforeEach(() => _resetCatalogCacheForTests());

describe("POST /asksolomon/case/search — password gate", () => {
  it("returns 401 without a password", async () => {
    const { restore } = stubFetch(() => catalogResponse());
    try {
      const res = await handleCaseSearch(post({ q: "" }, {}), makeEnv(), { checkPassword });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.success, false);
    } finally { restore(); }
  });

  it("returns 401 on wrong password", async () => {
    const { restore } = stubFetch(() => catalogResponse());
    try {
      const res = await handleCaseSearch(
        post({ q: "" }, { "x-console-password": "nope" }),
        makeEnv(),
        { checkPassword },
      );
      assert.equal(res.status, 401);
    } finally { restore(); }
  });
});

describe("POST /asksolomon/case/search — error paths", () => {
  it("returns 503 when the catalog is unavailable", async () => {
    const { restore } = stubFetch((url) => {
      if (String(url).includes("/customFields")) return new Response("fail", { status: 500 });
      return searchResponse([]);
    });
    try {
      const res = await handleCaseSearch(post({ q: "" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 503);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.match(data.error, /catalog unavailable/i);
    } finally { restore(); }
  });

  it("returns 503 when GHL /contacts/search is non-ok", async () => {
    const { restore } = stubFetch(routedResponder({
      search: () => new Response("rate limited", { status: 429 }),
    }));
    try {
      const res = await handleCaseSearch(post({ q: "" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 503);
      const data = await res.json();
      assert.match(data.error, /GHL search 429/);
    } finally { restore(); }
  });

  it("returns 400 on invalid JSON body", async () => {
    const { restore } = stubFetch(() => catalogResponse());
    try {
      const req = new Request("https://example.com/asksolomon/case/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...PASS_HEADER },
        body: "{not json",
      });
      const res = await handleCaseSearch(req, makeEnv(), { checkPassword });
      assert.equal(res.status, 400);
    } finally { restore(); }
  });
});

describe("POST /asksolomon/case/search — tag filter is enforced", () => {
  it("defensive filter drops any non-swot_paid_297 contact even if GHL returned it", async () => {
    // We deliberately make the fake GHL return a non-BGA contact in
    // the response. The defensive filter in the handler must still
    // keep it out of the strategist's results.
    const bgaContact = makeContact({ id: "bga", firstName: "Alice", email: "a@x.com" });
    const stray = makeContact({ id: "stray", firstName: "Bob", email: "b@x.com", tags: ["random_tag"] });
    const { restore } = stubFetch(routedResponder({
      search: () => searchResponse([bgaContact, stray]),
    }));
    try {
      const res = await handleCaseSearch(post({ q: "" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.contacts.length, 1);
      assert.equal(data.contacts[0].contactId, "bga");
    } finally { restore(); }
  });
});

describe("POST /asksolomon/case/search — free-text filter", () => {
  const CONTACTS = [
    makeContact({ id: "a", firstName: "Alice", lastName: "Anderson", email: "alice@acme.com", companyName: "Acme Plumbing" }),
    makeContact({ id: "b", firstName: "Bob",   lastName: "Baker",    email: "bob@smithmfg.com", companyName: "Smith Manufacturing" }),
    makeContact({ id: "c", firstName: "Carol", lastName: "Chen",     email: "carol@jones.com", companyName: "Jones Dental Group" }),
  ];

  function run(q) {
    const { restore } = stubFetch(routedResponder({ search: () => searchResponse(CONTACTS) }));
    return handleCaseSearch(post({ q }), makeEnv(), { checkPassword })
      .finally(() => restore());
  }

  it("matches on company (case-insensitive)", async () => {
    const res = await run("plumb");
    const data = await res.json();
    assert.equal(data.contacts.length, 1);
    assert.equal(data.contacts[0].contactId, "a");
  });
  it("matches on email", async () => {
    const res = await run("jones.com");
    const data = await res.json();
    assert.equal(data.contacts.length, 1);
    assert.equal(data.contacts[0].contactId, "c");
  });
  it("matches on first name", async () => {
    const res = await run("Alice");
    const data = await res.json();
    assert.equal(data.contacts.length, 1);
    assert.equal(data.contacts[0].contactId, "a");
  });
  it("returns all for empty q", async () => {
    const res = await run("");
    const data = await res.json();
    assert.equal(data.contacts.length, 3);
    assert.equal(data.total, 3);
  });
  it("returns zero cleanly on no match", async () => {
    const res = await run("nothing");
    const data = await res.json();
    assert.equal(data.contacts.length, 0);
    assert.equal(data.total, 0);
  });
});

describe("POST /asksolomon/case/search — limit", () => {
  it("defaults to 25, caps at 100, floors at 1", async () => {
    const many = Array.from({ length: 60 }, (_, i) => makeContact({ id: `c${i}`, firstName: `User${i}` }));
    const { restore } = stubFetch(routedResponder({ search: () => searchResponse(many) }));
    try {
      let res = await handleCaseSearch(post({ q: "" }), makeEnv(), { checkPassword });
      let data = await res.json();
      assert.equal(data.contacts.length, 25);           // default
      assert.equal(data.total, 60);                     // pre-limit total

      res = await handleCaseSearch(post({ q: "", limit: 500 }), makeEnv(), { checkPassword });
      data = await res.json();
      assert.equal(data.contacts.length, 60);           // bounded to total (<100 cap)

      res = await handleCaseSearch(post({ q: "", limit: 0 }), makeEnv(), { checkPassword });
      data = await res.json();
      assert.equal(data.contacts.length, 1);            // floored to 1

      res = await handleCaseSearch(post({ q: "", limit: "garbage" }), makeEnv(), { checkPassword });
      data = await res.json();
      assert.equal(data.contacts.length, 25);           // garbage → default
    } finally { restore(); }
  });
});

// --- Badge computation ----------------------------------------------
// computeBadges is the deterministic state-bucket logic. We test it
// directly (no HTTP) so the rules stay honest independent of the
// HTTP wiring above.

describe("computeBadges — workflow-state buckets", () => {
  const idMap = {
    swot_verified_financials: "id-vf",
    swot_growth_plan_draft:   "id-draft",
    swot_bga_prep_brief:      "id-prep",
    swot_bga_red_team_report: "id-redteam",
  };
  function cf(id, value) { return { id, value }; }

  it("sent — swot_growth_plan_ready wins over everything else", () => {
    const c = {
      tags: ["swot_paid_297", "swot_growth_plan_ready"],
      customFields: [
        cf("id-vf", "x"), cf("id-draft", "x"),
        cf("id-prep", "x"), cf("id-redteam", "x"),
      ],
    };
    const { status } = computeBadges(c, idMap);
    assert.equal(status, "sent");
  });

  it("ready-to-finalize — vf + draft + red-team report present, not sent", () => {
    const c = {
      tags: ["swot_paid_297"],
      customFields: [
        cf("id-vf", "x"), cf("id-draft", "x"), cf("id-redteam", "x"),
      ],
    };
    assert.equal(computeBadges(c, idMap).status, "ready-to-finalize");
  });

  it("ready-for-call — vf + draft + prep brief, no red-team yet", () => {
    const c = {
      tags: ["swot_paid_297"],
      customFields: [
        cf("id-vf", "x"), cf("id-draft", "x"), cf("id-prep", "x"),
      ],
    };
    assert.equal(computeBadges(c, idMap).status, "ready-for-call");
  });

  it("needs-roadmap — vf present, draft empty", () => {
    const c = {
      tags: ["swot_paid_297"],
      customFields: [cf("id-vf", "x")],
    };
    assert.equal(computeBadges(c, idMap).status, "needs-roadmap");
  });

  it("needs-financials — default for fresh BGA buyer", () => {
    const c = {
      tags: ["swot_paid_297"],
      customFields: [],
    };
    assert.equal(computeBadges(c, idMap).status, "needs-financials");
  });

  it("whitespace-only VF counts as empty — needs-financials, not needs-roadmap", () => {
    const c = {
      tags: ["swot_paid_297"],
      customFields: [cf("id-vf", "   \n   ")],
    };
    assert.equal(computeBadges(c, idMap).status, "needs-financials");
  });
});
