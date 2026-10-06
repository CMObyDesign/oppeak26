// Phase 1c regression: /report/{contactId} read-path resolution.
//
// Default read (`/report/{contactId}`, no query params):
//   D1 latest successful → GHL fallback.
//
// Historical read (`?v=N` or `?report_id=<uuid>`):
//   D1-only. No GHL fallback — a historical URL must never silently
//   resolve to a different generation than its holder saw. Missing D1
//   or missing row → 404.
//
// HTML source for a resolved D1 row:
//   R2 artifact first (immutable); else re-render from diagnostic_json.
//
// Tests here exercise:
//   - tierLabelOf
//   - fetchArtifactHtml (R2 happy / missing / failure)
//   - resolveReportHtml (R2 → re-render → null fallbacks)
//   - handleReport query-param validation (reject both; invalid shapes)
//   - handleReport default: D1 latest preferred over GHL
//   - handleReport default: GHL fallback when D1 is empty / unwired
//   - handleReport history: D1-required, cross-contact leak prevention

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  tierLabelOf,
  fetchArtifactHtml,
  resolveReportHtml,
  handleReport,
} from "../src/index.js";
import { captureFetch } from "./helpers.js";

// --- helpers --------------------------------------------------------------

function makeMockDb(firstHandler) {
  const log = [];
  return {
    prepare(sql) {
      const entry = { sql, binds: [] };
      log.push(entry);
      return {
        bind(...args) { entry.binds = args; return this; },
        async run() { return { success: true }; },
        async first() {
          return typeof firstHandler === "function" ? firstHandler(entry) : (firstHandler ?? null);
        },
        async all() { return { results: [] }; },
      };
    },
    _log: log,
  };
}

function makeMockBucket({ objects = {}, throwOnGet = false } = {}) {
  const log = [];
  return {
    async get(key) {
      log.push({ op: "get", key });
      if (throwOnGet) throw new Error("R2 timeout");
      const bytes = objects[key];
      if (bytes === undefined) return null;
      return { async text() { return bytes; } };
    },
    _log: log,
  };
}

const AGENT_FIXTURE = {
  path: "needs-attention",
  badge: "NEEDS ATTENTION",
  headline: "...",
  opener: "Hello Liz.",
  context: "...",
  gaps: [{ title: "g1", impact: "high", priority: "immediate" }],
  opportunities: [{ title: "o1", impact: "revenue" }],
  opportunityFlags: [],
  strategistBrief: "internal",
};

const D1_REPORT_FIXTURE = {
  id: "rep_1",
  submission_id: "sub_1",
  contact_id: "contact_abc",
  tier: "paid_47",
  report_version: 1,
  classification: "needs-attention",
  diagnostic: AGENT_FIXTURE,
  strategist_brief: null,
  prompt_version: "p1.0",
  rubric_version: "r2.0",
  model_version: "claude-sonnet-4-6",
  code_version: null,
  r2_html_key: "reports/contact_abc/rep_1/report.html",
  r2_html_bytes: 128,
  r2_html_sha256: "deadbeef",
  created_at: 1700000000000,
  is_successful: true,
};

// --- tierLabelOf ---------------------------------------------------------

describe("tierLabelOf", () => {
  it("maps paid_297 to Business Playbook", () => {
    assert.equal(tierLabelOf("paid_297"), "Business Playbook");
  });
  it("maps paid_47 to Full Diagnostic", () => {
    assert.equal(tierLabelOf("paid_47"), "Full Diagnostic");
  });
  it("defaults everything else to SWOT Diagnostic", () => {
    assert.equal(tierLabelOf("free"), "SWOT Diagnostic");
    assert.equal(tierLabelOf(undefined), "SWOT Diagnostic");
    assert.equal(tierLabelOf(""), "SWOT Diagnostic");
    assert.equal(tierLabelOf("mystery"), "SWOT Diagnostic");
  });
});

// --- fetchArtifactHtml ---------------------------------------------------

describe("fetchArtifactHtml", () => {
  it("returns null when there is no SOLOMON_REPORTS binding", async () => {
    assert.equal(await fetchArtifactHtml({}, "reports/x/y/report.html"), null);
  });

  it("returns null when the key is empty", async () => {
    const bucket = makeMockBucket();
    assert.equal(await fetchArtifactHtml({ SOLOMON_REPORTS: bucket }, ""), null);
    assert.equal(bucket._log.length, 0, "empty key must not touch R2");
  });

  it("returns null when the object does not exist", async () => {
    const bucket = makeMockBucket({ objects: {} });
    assert.equal(await fetchArtifactHtml({ SOLOMON_REPORTS: bucket }, "reports/x/y/report.html"), null);
  });

  it("returns the object text on hit", async () => {
    const bucket = makeMockBucket({
      objects: { "reports/x/y/report.html": "<html>hit</html>" },
    });
    assert.equal(await fetchArtifactHtml({ SOLOMON_REPORTS: bucket }, "reports/x/y/report.html"),
      "<html>hit</html>");
  });

  it("returns null on R2 throw (non-fatal)", async () => {
    const bucket = makeMockBucket({ throwOnGet: true });
    assert.equal(await fetchArtifactHtml({ SOLOMON_REPORTS: bucket }, "reports/x/y/report.html"), null);
  });
});

// --- resolveReportHtml ---------------------------------------------------

describe("resolveReportHtml", () => {
  it("prefers the R2 artifact when present", async () => {
    const bucket = makeMockBucket({
      objects: { "reports/contact_abc/rep_1/report.html": "<html>from r2</html>" },
    });
    const html = await resolveReportHtml({ SOLOMON_REPORTS: bucket }, D1_REPORT_FIXTURE);
    assert.equal(html, "<html>from r2</html>");
  });

  it("re-renders from diagnostic_json when R2 artifact is missing", async () => {
    // No R2 object: fetchArtifactHtml returns null, resolveReportHtml falls
    // back to buildReportHtml(diagnostic). That output is not asserted to
    // exact bytes (it's a long styled block), but it must be a non-empty
    // string so the caller can render.
    const bucket = makeMockBucket({ objects: {} });
    const html = await resolveReportHtml({ SOLOMON_REPORTS: bucket }, D1_REPORT_FIXTURE);
    assert.ok(typeof html === "string" && html.length > 50,
      "re-rendered HTML should be a non-empty string");
  });

  it("re-renders when SOLOMON_REPORTS binding is missing", async () => {
    const html = await resolveReportHtml({}, D1_REPORT_FIXTURE);
    assert.ok(typeof html === "string" && html.length > 50);
  });

  it("returns null when both R2 and diagnostic are unusable", async () => {
    const html = await resolveReportHtml({}, { ...D1_REPORT_FIXTURE, diagnostic: null });
    assert.equal(html, null);
  });
});

// --- handleReport query-param validation --------------------------------

describe("handleReport — query-param validation", () => {
  it("rejects both ?v and ?report_id with 400", async () => {
    const url = new URL("https://host/report/c1?v=1&report_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const r = await handleReport("c1", { GHL_API_KEY: "k" }, url);
    assert.equal(r.status, 400);
  });

  it("rejects non-integer ?v with 400", async () => {
    const url = new URL("https://host/report/c1?v=abc");
    const r = await handleReport("c1", { GHL_API_KEY: "k" }, url);
    assert.equal(r.status, 400);
  });

  it("rejects a malformed ?report_id with 400", async () => {
    const url = new URL("https://host/report/c1?report_id=notauuid");
    const r = await handleReport("c1", { GHL_API_KEY: "k" }, url);
    assert.equal(r.status, 400);
  });

  it("requires contact id (empty is 400)", async () => {
    const r = await handleReport("", { GHL_API_KEY: "k" }, new URL("https://host/report/"));
    assert.equal(r.status, 400);
  });

  it("requires GHL config (missing API key is 500)", async () => {
    const r = await handleReport("c1", {}, new URL("https://host/report/c1"));
    assert.equal(r.status, 500);
  });
});

// --- handleReport default read ------------------------------------------

describe("handleReport — default read", () => {
  it("prefers the D1 latest successful report over the GHL custom field", async () => {
    const bucket = makeMockBucket({
      objects: { "reports/contact_abc/rep_1/report.html": "<x>D1 won</x>" },
    });

    // D1 mock: for latestSuccessfulReport the module runs a SELECT that
    // returns a row shaped like what the db-module hydrates. We return the
    // shape stringified-JSON would arrive in from a real D1 read.
    const row = {
      id: "rep_1", submission_id: "sub_1", contact_id: "contact_abc", tier: "paid_47",
      report_version: 1, classification: "needs-attention",
      diagnostic_json: JSON.stringify(AGENT_FIXTURE), strategist_brief_json: null,
      prompt_version: "p1.0", rubric_version: "r2.0",
      model_version: "claude-sonnet-4-6", code_version: null,
      r2_html_key: "reports/contact_abc/rep_1/report.html",
      r2_html_bytes: 128, r2_html_sha256: "deadbeef",
      created_at: 1700000000000, is_successful: 1,
    };
    const db = makeMockDb(row);

    // GHL fetch mock: returns a plausible contact with no useful content —
    // we must NOT read from here when D1 has a row.
    const fetchCapture = captureFetch((url) => {
      if (String(url).includes("/contacts/contact_abc")) {
        return new Response(JSON.stringify({
          contact: { id: "contact_abc", firstName: "Liz", email: "liz@example.com", customFields: [], tags: [] }
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    try {
      const env = { GHL_API_KEY: "k", SOLOMON_DB: db, SOLOMON_REPORTS: bucket };
      const r = await handleReport("contact_abc", env, new URL("https://host/report/contact_abc"));
      assert.equal(r.status, 200);
      const body = await r.text();
      assert.ok(body.includes("D1 won"), "D1-sourced body must be rendered");
    } finally {
      fetchCapture.restore();
    }
  });

  it("falls back to GHL custom-field read when D1 has no row for the contact", async () => {
    // D1 returns no row.
    const db = makeMockDb(null);
    const bucket = makeMockBucket();

    // GHL returns a contact with a swot_free_report custom field present —
    // the pre-Phase-1b behavior. Match by the real field id so findFieldFor
    // picks it up (not just a fieldKey).
    const fetchCapture = captureFetch((url) => {
      if (String(url).includes("/contacts/contact_abc")) {
        return new Response(JSON.stringify({
          contact: {
            id: "contact_abc", firstName: "Liz", email: "liz@example.com", tags: ["swot_free_lead"],
            customFields: [{ id: "Ys28pMUc82cURfnsbQzY", value: "<section>legacy GHL body</section>" }],
          }
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    try {
      const env = { GHL_API_KEY: "k", SOLOMON_DB: db, SOLOMON_REPORTS: bucket };
      const r = await handleReport("contact_abc", env, new URL("https://host/report/contact_abc"));
      assert.equal(r.status, 200);
      const body = await r.text();
      assert.ok(body.includes("legacy GHL body"), "fallback body must come from the GHL custom field");
    } finally {
      fetchCapture.restore();
    }
  });

  it("falls back to GHL when D1 binding is missing (no SOLOMON_DB env)", async () => {
    const fetchCapture = captureFetch((url) => {
      if (String(url).includes("/contacts/contact_abc")) {
        return new Response(JSON.stringify({
          contact: {
            id: "contact_abc", firstName: "Liz", tags: ["swot_free_lead"],
            customFields: [{ id: "Ys28pMUc82cURfnsbQzY", value: "<p>legacy</p>" }],
          }
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    try {
      const r = await handleReport("contact_abc", { GHL_API_KEY: "k" }, new URL("https://host/report/contact_abc"));
      assert.equal(r.status, 200);
      const body = await r.text();
      assert.ok(body.includes("<p>legacy</p>"));
    } finally {
      fetchCapture.restore();
    }
  });
});

// --- handleReport history read ------------------------------------------

describe("handleReport — history read", () => {
  it("?v=1 returns 404 when D1 binding is missing (history requires D1)", async () => {
    const fetchCapture = captureFetch(() =>
      new Response(JSON.stringify({ contact: { id: "contact_abc" } }), { status: 200 }));
    try {
      const r = await handleReport("contact_abc", { GHL_API_KEY: "k" }, new URL("https://host/report/contact_abc?v=1"));
      assert.equal(r.status, 404);
    } finally {
      fetchCapture.restore();
    }
  });

  it("?v=1 returns 200 with the R2 artifact body when the row exists", async () => {
    const bucket = makeMockBucket({
      objects: { "reports/contact_abc/rep_1/report.html": "<x>historical body</x>" },
    });
    const row = {
      id: "rep_1", submission_id: "sub_1", contact_id: "contact_abc", tier: "paid_47",
      report_version: 1, classification: "needs-attention",
      diagnostic_json: JSON.stringify(AGENT_FIXTURE), strategist_brief_json: null,
      prompt_version: null, rubric_version: null, model_version: null, code_version: null,
      r2_html_key: "reports/contact_abc/rep_1/report.html",
      r2_html_bytes: null, r2_html_sha256: null,
      created_at: 1700000000000, is_successful: 1,
    };
    const db = makeMockDb(row);
    const fetchCapture = captureFetch(() =>
      new Response(JSON.stringify({ contact: { id: "contact_abc", firstName: "Liz" } }), { status: 200 }));
    try {
      const env = { GHL_API_KEY: "k", SOLOMON_DB: db, SOLOMON_REPORTS: bucket };
      const r = await handleReport("contact_abc", env, new URL("https://host/report/contact_abc?v=1"));
      assert.equal(r.status, 200);
      const body = await r.text();
      assert.ok(body.includes("historical body"), "historical read must serve the R2 artifact");
    } finally {
      fetchCapture.restore();
    }
  });

  it("?v=5 returns 404 when the version row does not exist", async () => {
    const db = makeMockDb(null); // reportByVersion returns null
    const fetchCapture = captureFetch(() =>
      new Response(JSON.stringify({ contact: { id: "contact_abc" } }), { status: 200 }));
    try {
      const r = await handleReport("contact_abc", { GHL_API_KEY: "k", SOLOMON_DB: db }, new URL("https://host/report/contact_abc?v=5"));
      assert.equal(r.status, 404);
    } finally {
      fetchCapture.restore();
    }
  });

  it("?report_id=X returns 404 when the row belongs to a different contact", async () => {
    // Attacker-shaped URL: contact_abc in the path, but report_id points
    // at a row stored for contact_xyz. The handler MUST refuse to serve.
    const row = {
      id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      submission_id: "sub_1", contact_id: "contact_xyz", tier: "paid_47",
      report_version: 1, classification: "needs-attention",
      diagnostic_json: JSON.stringify(AGENT_FIXTURE), strategist_brief_json: null,
      prompt_version: null, rubric_version: null, model_version: null, code_version: null,
      r2_html_key: "reports/contact_xyz/aaa/report.html",
      r2_html_bytes: null, r2_html_sha256: null,
      created_at: 1700000000000, is_successful: 1,
    };
    const db = makeMockDb(row);
    const fetchCapture = captureFetch(() =>
      new Response(JSON.stringify({ contact: { id: "contact_abc" } }), { status: 200 }));
    try {
      const env = { GHL_API_KEY: "k", SOLOMON_DB: db };
      const r = await handleReport("contact_abc", env, new URL("https://host/report/contact_abc?report_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
      assert.equal(r.status, 404, "cross-contact report_id must not leak");
    } finally {
      fetchCapture.restore();
    }
  });

  it("history returns 410 when R2 artifact is missing AND diagnostic cannot re-render", async () => {
    // Simulate a row that has no R2 object and whose diagnostic is unusable.
    const row = {
      id: "rep_1", submission_id: "sub_1", contact_id: "contact_abc", tier: "paid_47",
      report_version: 2, classification: "needs-attention",
      diagnostic_json: "null", strategist_brief_json: null,
      prompt_version: null, rubric_version: null, model_version: null, code_version: null,
      r2_html_key: null, r2_html_bytes: null, r2_html_sha256: null,
      created_at: 1700000000000, is_successful: 1,
    };
    const db = makeMockDb(row);
    const fetchCapture = captureFetch(() =>
      new Response(JSON.stringify({ contact: { id: "contact_abc" } }), { status: 200 }));
    try {
      const env = { GHL_API_KEY: "k", SOLOMON_DB: db };
      const r = await handleReport("contact_abc", env, new URL("https://host/report/contact_abc?v=2"));
      assert.equal(r.status, 410, "a resolved row with no renderable HTML is Gone, not 404");
    } finally {
      fetchCapture.restore();
    }
  });
});
