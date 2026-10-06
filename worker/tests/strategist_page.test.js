// Phase 3B: strategist review UI.
//
// Two surfaces to pin:
//
//   1. GET /strategist renders the HTML page with the FEEDBACK_TYPES
//      vocabulary baked in, so the dropdown and the server's accepted
//      set can't drift. If a new category is added to db.js, the UI
//      follows automatically.
//
//   2. GET /strategist/report/{reportId} returns {report, feedback} as
//      JSON, is password-gated, and 404s on a missing report. The UI
//      page's only read path depends on this contract.
//
// Covers reachability + auth + no-D1 degradation on the lookup, and
// a shape smoke-test on the page.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import worker from "../src/index.js";
import { renderStrategistPage } from "../src/strategist_page.js";
import { FEEDBACK_TYPES } from "../src/db.js";

const PW = "test-password";
const envBase = { CONSOLE_PASSWORD: PW };

function get(path, { password = PW, env = envBase } = {}) {
  const headers = password ? { "x-console-password": password } : {};
  return worker.fetch(
    new Request("https://example.com" + path, { method: "GET", headers }),
    env,
    {},
  );
}

// --- GET /strategist (the HTML page) ----------------------------------

describe("GET /strategist — review page", () => {
  it("serves HTML to any browser (no password required on the page itself)", async () => {
    // The page is harmless static HTML; the API calls it makes carry
    // x-console-password. Serving the shell publicly matches the
    // /asksolomon pattern.
    const res = await get("/strategist", { password: null });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/html/i);
    const body = await res.text();
    assert.match(body, /<title>Strategist review/);
  });

  it("bakes in the server-enforced FEEDBACK_TYPES vocabulary", async () => {
    const res = await get("/strategist", { password: null });
    const body = await res.text();
    // Every type appears in the embedded JSON. If db.js adds a 17th
    // category and the strategist page falls out of sync, this fails.
    for (const t of FEEDBACK_TYPES) {
      assert.ok(body.includes(JSON.stringify(t)), "missing " + t + " in page");
    }
    assert.ok(!body.includes("{{FEEDBACK_TYPES_JSON}}"), "placeholder not substituted");
  });

  it("renderStrategistPage: HTML-escaped vocab substitution is JSON-safe", () => {
    const html = renderStrategistPage(["a</script>bad", "ok"]);
    // JSON.stringify escapes the </script> sequence into </script> as
    // text; make sure the raw </script> tag isn't present so a
    // malicious type name can't terminate the page's script block.
    assert.ok(!html.includes('"a</script>bad"'));
    assert.ok(html.includes('"a<\\/script>bad"') || html.includes('a<\\/script>bad'));
  });
});

// --- GET /strategist/report/{reportId} (the JSON lookup) --------------

describe("GET /strategist/report/{reportId}", () => {
  it("401s without the console password", async () => {
    const res = await get("/strategist/report/rep_1", { password: null });
    assert.equal(res.status, 401);
  });

  it("returns 503 when D1 isn't wired (hard dependency — no fallback)", async () => {
    // Unlike /feedback, this endpoint can't return anything useful
    // without D1 — the report row IS the data. 503 is honest.
    const res = await get("/strategist/report/rep_1");
    assert.equal(res.status, 503);
  });

  it("returns 404 for an unknown report_id", async () => {
    const env = {
      CONSOLE_PASSWORD: PW,
      SOLOMON_DB: makeDbReturning({ reportRow: null }),
    };
    const res = await get("/strategist/report/rep_missing", { env });
    assert.equal(res.status, 404);
  });

  it("returns {report, feedback} JSON for a known report", async () => {
    const reportRow = {
      id: "rep_abc",
      submission_id: "sub_1",
      contact_id: "c1",
      tier: "free",
      report_version: 1,
      classification: "needs-attention",
      diagnostic_json: JSON.stringify({
        structured_findings: [
          { finding_id: "ar-aging-001", text: "AR aging looks aggressive.", severity: "medium" },
        ],
      }),
      strategist_brief_json: null,
      prompt_version: "p2.0",
      rubric_version: "r2.0",
      model_version: null,
      code_version: null,
      r2_html_key: null,
      r2_html_bytes: null,
      r2_html_sha256: null,
      created_at: 1700000000000,
      is_successful: 1,
    };
    const feedbackRows = [{
      id: "fb_1",
      report_id: "rep_abc",
      submission_id: "sub_1",
      contact_id: "c1",
      finding_id: "ar-aging-001",
      feedback_type: "causal_overreach",
      original_output: "orig",
      strategist_revision: "rev",
      reason: "r",
      candidate_rule: null,
      approved_for_learning: 0,
      approved_by: null,
      approved_at: null,
      created_by: "liz",
      created_at: 1700000001000,
    }];
    const env = {
      CONSOLE_PASSWORD: PW,
      SOLOMON_DB: makeDbReturning({ reportRow, feedbackRows }),
    };
    const res = await get("/strategist/report/rep_abc", { env });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.report.id, "rep_abc");
    assert.equal(body.report.classification, "needs-attention");
    // structured_findings is hydrated inside diagnostic.
    assert.equal(body.report.diagnostic.structured_findings[0].finding_id, "ar-aging-001");
    assert.equal(body.feedback.length, 1);
    assert.equal(body.feedback[0].approved_for_learning, false, "hydrated to boolean");
  });
});

// A tiny D1 mock that differentiates by SQL text — matches the pattern
// used elsewhere in the suite.
function makeDbReturning({ reportRow = null, feedbackRows = [] } = {}) {
  return {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          if (/FROM report_versions/i.test(sql)) return reportRow;
          return null;
        },
        async all() {
          if (/FROM strategist_feedback/i.test(sql)) return { results: feedbackRows };
          return { results: [] };
        },
        async run() { return { success: true }; },
      };
    },
  };
}
