// BGA Copilot — case handler endpoint tests.
//
// Pins the §9 guardrails that apply to PR 3:
//   - Both endpoints are password-gated (checkConsolePassword).
//   - audit_case_gaps is read-only: never writes any GHL field.
//   - verified_financials_panel writes only to swot_verified_financials,
//     NEVER to swot_growth_plan or any delivery-triggering tag.
//   - Metric vocabulary is enforced at the endpoint boundary.
//   - Audit output reports present/missing metrics accurately.
//
// Spec references:
//   docs/BGA_COPILOT_SPEC.md §4.1 (audit_case_gaps)
//   docs/BGA_COPILOT_SPEC.md §4.2 (verified_financials_panel)
//   docs/BGA_COPILOT_SPEC.md §9 guardrails (relevant subset for PR 3)

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  handleAuditCaseGaps,
  handleVerifiedFinancialsPanel,
} from "../src/bga_copilot/case_handlers.js";
import { _resetCatalogCacheForTests } from "../src/ghl_catalog.js";

beforeEach(() => {
  // Keep the catalog cache from leaking across tests, now that readCustomField
  // consults it (Codex P1 on #93).
  _resetCatalogCacheForTests();
});

function makeEnv() {
  return {
    GHL_API_KEY: "test-ghl-key",
    GHL_LOCATION_ID: "test-loc",
    CONSOLE_PASSWORD: "test-password",
  };
}

const PASS_HEADER = { "x-console-password": "test-password" };

function post(body, headers = PASS_HEADER) {
  return new Request("https://example.com/x", {
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

function ghlContactResponse(customFields = []) {
  return new Response(
    JSON.stringify({ contact: { id: "c1", customFields } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("POST /asksolomon/case/audit-gaps — handleAuditCaseGaps", () => {
  it("401 without x-console-password", async () => {
    const req = post({ contactId: "c1" }, {});
    const res = await handleAuditCaseGaps(req, makeEnv(), { checkPassword });
    assert.equal(res.status, 401);
  });

  it("400 without contactId", async () => {
    const req = post({});
    const res = await handleAuditCaseGaps(req, makeEnv(), { checkPassword });
    assert.equal(res.status, 400);
  });

  it("400 on invalid JSON body", async () => {
    const req = post("not json");
    const res = await handleAuditCaseGaps(req, makeEnv(), { checkPassword });
    assert.equal(res.status, 400);
  });

  it("503 when GHL contact fetch fails", async () => {
    const cap = stubFetch(() => new Response("", { status: 404 }));
    try {
      const res = await handleAuditCaseGaps(post({ contactId: "nope" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 503);
    } finally {
      cap.restore();
    }
  });

  it("reports all metrics as missing when swot_verified_financials is empty", async () => {
    const cap = stubFetch(() => ghlContactResponse([]));
    try {
      const res = await handleAuditCaseGaps(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.verified_financials.entries_count, 0);
      assert.equal(body.verified_financials.present_metric_ids.length, 0);
      // all 10 canonical metrics should be in the missing list
      assert.equal(body.verified_financials.missing_metric_ids.length, 10);
      assert.ok(body.canonical_metrics.cash_on_hand);
      assert.ok(body.canonical_metrics.debt_terms);
    } finally {
      cap.restore();
    }
  });

  it("Codex P1 on #93: resolves id-only customFields via GHL catalog", async () => {
    // Simulates production: GHL /contacts/{id} returns {id, value} with
    // no fieldKey; the catalog endpoint supplies the id → fieldKey map.
    const cap = stubFetch((url) => {
      if (String(url).includes("/customFields")) {
        return new Response(JSON.stringify({
          customFields: [
            { id: "id-playbook", fieldKey: "contact.business_playbook", dataType: "LARGE_TEXT" },
            { id: "id-vf", fieldKey: "contact.swot_verified_financials", dataType: "LARGE_TEXT" },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return ghlContactResponse([
        { id: "id-playbook", value: "intake populated via id" },
        { id: "id-vf", value: JSON.stringify([
          { metric_id: "cash_on_hand", value: 100 },
        ])},
      ]);
    });
    try {
      const res = await handleAuditCaseGaps(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      const body = await res.json();
      assert.equal(body.intake_present, true);
      assert.equal(body.verified_financials.entries_count, 1);
      assert.ok(body.verified_financials.present_metric_ids.includes("cash_on_hand"));
    } finally {
      cap.restore();
    }
  });

  it("reports present/missing accurately when swot_verified_financials has entries", async () => {
    const entries = [
      { metric_id: "cash_on_hand", value: 100 },
      { metric_id: "revenue_ttm", value: 1800000 },
    ];
    const cap = stubFetch(() =>
      ghlContactResponse([
        { fieldKey: "contact.swot_verified_financials", value: JSON.stringify(entries) },
      ]),
    );
    try {
      const res = await handleAuditCaseGaps(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      const body = await res.json();
      assert.equal(body.verified_financials.entries_count, 2);
      assert.deepEqual(
        [...body.verified_financials.present_metric_ids].sort(),
        ["cash_on_hand", "revenue_ttm"],
      );
      assert.ok(!body.verified_financials.missing_metric_ids.includes("cash_on_hand"));
      assert.ok(!body.verified_financials.missing_metric_ids.includes("revenue_ttm"));
      assert.ok(body.verified_financials.missing_metric_ids.includes("gross_margin_pct"));
    } finally {
      cap.restore();
    }
  });

  it("reports intake / brief / diagnostic presence from GHL custom fields", async () => {
    const cap = stubFetch(() =>
      ghlContactResponse([
        { fieldKey: "contact.business_playbook", value: "Part 1 content here" },
        { fieldKey: "contact.swot_strategist_brief", value: "Internal brief" },
        { fieldKey: "contact.swot_full_report", value: "" },
      ]),
    );
    try {
      const res = await handleAuditCaseGaps(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      const body = await res.json();
      assert.equal(body.intake_present, true);
      assert.equal(body.strategist_brief_present, true);
      assert.equal(body.full_diagnostic_present, false);
    } finally {
      cap.restore();
    }
  });

  it("is read-only: never issues a PUT to GHL", async () => {
    const cap = stubFetch(() => ghlContactResponse([]));
    try {
      await handleAuditCaseGaps(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      const puts = cap.calls.filter((c) => c.method === "PUT");
      assert.equal(puts.length, 0);
    } finally {
      cap.restore();
    }
  });

  it("response carries Cache-Control: no-store", async () => {
    const cap = stubFetch(() => ghlContactResponse([]));
    try {
      const res = await handleAuditCaseGaps(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.headers.get("Cache-Control"), "no-store");
    } finally {
      cap.restore();
    }
  });
});

describe("POST /asksolomon/case/verified-financials — handleVerifiedFinancialsPanel", () => {
  const validEntry = {
    metric_id: "cash_on_hand",
    value: 184221,
    period: "2026-09-30",
    source_doc: "balance_sheet_2026-09.pdf",
  };

  it("401 without x-console-password", async () => {
    const req = post({ contactId: "c1", entry: validEntry }, {});
    const res = await handleVerifiedFinancialsPanel(req, makeEnv(), { checkPassword });
    assert.equal(res.status, 401);
  });

  it("400 without contactId", async () => {
    const req = post({ entry: validEntry });
    const res = await handleVerifiedFinancialsPanel(req, makeEnv(), { checkPassword });
    assert.equal(res.status, 400);
  });

  it("400 without entry", async () => {
    const req = post({ contactId: "c1" });
    const res = await handleVerifiedFinancialsPanel(req, makeEnv(), { checkPassword });
    assert.equal(res.status, 400);
  });

  it("400 on unknown metric_id", async () => {
    const req = post({ contactId: "c1", entry: { ...validEntry, metric_id: "sales_pipeline" } });
    const res = await handleVerifiedFinancialsPanel(req, makeEnv(), { checkPassword });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /unknown metric_id/);
  });

  it("400 on wrong value shape (string for number metric)", async () => {
    const req = post({ contactId: "c1", entry: { ...validEntry, value: "184221" } });
    const res = await handleVerifiedFinancialsPanel(req, makeEnv(), { checkPassword });
    assert.equal(res.status, 400);
  });

  it("400 on missing period / source_doc", async () => {
    let res = await handleVerifiedFinancialsPanel(
      post({ contactId: "c1", entry: { ...validEntry, period: "" } }),
      makeEnv(),
      { checkPassword },
    );
    assert.equal(res.status, 400);
    res = await handleVerifiedFinancialsPanel(
      post({ contactId: "c1", entry: { ...validEntry, source_doc: "" } }),
      makeEnv(),
      { checkPassword },
    );
    assert.equal(res.status, 400);
  });

  it("writes a new entry when swot_verified_financials is empty, forces provenance=verified and stamps recorded_at", async () => {
    let writeBody;
    const cap = stubFetch((url, init) => {
      if (init?.method === "PUT") {
        writeBody = JSON.parse(init.body);
        return new Response("", { status: 200 });
      }
      return ghlContactResponse([]);
    });
    try {
      const res = await handleVerifiedFinancialsPanel(
        post({ contactId: "c1", entry: validEntry }),
        makeEnv(),
        { checkPassword },
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.added_or_updated, "cash_on_hand");
      assert.equal(body.entries.length, 1);
      const stored = body.entries[0];
      assert.equal(stored.provenance, "verified");
      assert.match(stored.recorded_at, /^\d{4}-\d{2}-\d{2}T/);

      // The PUT body must carry the swot_verified_financials field with the
      // JSON-string-serialized array.
      assert.ok(writeBody && writeBody.customFields);
      const field = writeBody.customFields.find((f) => f.key === "swot_verified_financials");
      assert.ok(field);
      const parsed = JSON.parse(field.field_value);
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].metric_id, "cash_on_hand");
    } finally {
      cap.restore();
    }
  });

  it("upserts: replaces an existing entry with the same metric_id instead of appending", async () => {
    const existing = [
      { metric_id: "cash_on_hand", value: 100, provenance: "verified" },
    ];
    const cap = stubFetch((url, init) => {
      if (init?.method === "PUT") return new Response("", { status: 200 });
      return ghlContactResponse([
        { fieldKey: "contact.swot_verified_financials", value: JSON.stringify(existing) },
      ]);
    });
    try {
      const res = await handleVerifiedFinancialsPanel(
        post({ contactId: "c1", entry: validEntry }),
        makeEnv(),
        { checkPassword },
      );
      const body = await res.json();
      assert.equal(body.entries.length, 1); // still 1 — upserted, not appended
      assert.equal(body.entries[0].value, 184221);
    } finally {
      cap.restore();
    }
  });

  it("NEVER writes swot_growth_plan or applies swot_growth_plan_ready", async () => {
    const cap = stubFetch((url, init) => {
      if (init?.method === "PUT") return new Response("", { status: 200 });
      return ghlContactResponse([]);
    });
    try {
      await handleVerifiedFinancialsPanel(
        post({ contactId: "c1", entry: validEntry }),
        makeEnv(),
        { checkPassword },
      );
      for (const call of cap.calls) {
        if (call.method === "PUT" && call.body) {
          const body = String(call.body);
          assert.ok(!body.includes("swot_growth_plan"), "endpoint must not touch swot_growth_plan");
          assert.ok(!body.includes("swot_growth_plan_ready"), "endpoint must not apply swot_growth_plan_ready");
        }
        assert.ok(!call.url.includes("/tags"), "endpoint must not POST to /tags");
      }
    } finally {
      cap.restore();
    }
  });

  it("503 when GHL writeback fails", async () => {
    const cap = stubFetch((url, init) => {
      if (init?.method === "PUT") return new Response("boom", { status: 500 });
      return ghlContactResponse([]);
    });
    try {
      const res = await handleVerifiedFinancialsPanel(
        post({ contactId: "c1", entry: validEntry }),
        makeEnv(),
        { checkPassword },
      );
      assert.equal(res.status, 503);
    } finally {
      cap.restore();
    }
  });

  it("accepts ar_30_60_90 structured value", async () => {
    const cap = stubFetch((url, init) => {
      if (init?.method === "PUT") return new Response("", { status: 200 });
      return ghlContactResponse([]);
    });
    try {
      const res = await handleVerifiedFinancialsPanel(
        post({
          contactId: "c1",
          entry: {
            metric_id: "ar_30_60_90",
            value: { d30: 50000, d60: 80000, d90_plus: 96800 },
            period: "2026-09-30",
            source_doc: "AR_aging.pdf",
          },
        }),
        makeEnv(),
        { checkPassword },
      );
      assert.equal(res.status, 200);
    } finally {
      cap.restore();
    }
  });

  it("accepts debt_terms text value", async () => {
    const cap = stubFetch((url, init) => {
      if (init?.method === "PUT") return new Response("", { status: 200 });
      return ghlContactResponse([]);
    });
    try {
      const res = await handleVerifiedFinancialsPanel(
        post({
          contactId: "c1",
          entry: {
            metric_id: "debt_terms",
            value: "SBA 7(a); 6.5% fixed; 10yr maturity; no prepay penalty; personal guarantee",
            period: "2026-09-30",
            source_doc: "loan_agreement.pdf",
          },
        }),
        makeEnv(),
        { checkPassword },
      );
      assert.equal(res.status, 200);
    } finally {
      cap.restore();
    }
  });
});
