// BGA Copilot — case load endpoint tests (PR 4 of the build).
//
// Pins:
//   - Password gating.
//   - 400 on missing / malformed input.
//   - 503 on GHL failure modes.
//   - Refuses to load non-swot_paid_297 contacts (strategist should
//     never see a non-paid contact's data under the paid_297 case view).
//   - Bundle shape: §2.1 fields present, classification rule, missing
//     metrics populated, case-state counts.
//   - Read-only: never issues a PUT to GHL (second fetch call never fires).
//
// Spec references:
//   docs/BGA_COPILOT_SPEC.md §2.1 (case bundle shape)
//   docs/BGA_COPILOT_SPEC.md §11 row 4 (PR 4 scope)

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { handleCaseLoad, assembleCaseBundle } from "../src/bga_copilot/case_load.js";
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

function ghlContact({ tags = ["swot_paid_297"], customFields = [], extra = {} } = {}) {
  return new Response(
    JSON.stringify({
      contact: {
        id: "c1",
        companyName: "Acme Widgets Inc",
        dateAdded: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        tags,
        customFields,
        ...extra,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/**
 * Default catalog with the id/fieldKey pairs the case load path reads
 * from. Covers the four known IDs (business_playbook, swot_full_report,
 * swot_strategist_brief, swot_verified_financials) so id-only payloads
 * resolve correctly in tests after Codex P1 on #93.
 */
function catalogResponse(entries) {
  const list = entries || [
    { id: "id-playbook",  fieldKey: "contact.business_playbook",       dataType: "LARGE_TEXT", name: "Business Playbook" },
    { id: "id-brief",     fieldKey: "contact.swot_strategist_brief",   dataType: "LARGE_TEXT", name: "Strategist Brief" },
    { id: "id-fullrep",   fieldKey: "contact.swot_full_report",        dataType: "LARGE_TEXT", name: "Full Report" },
    { id: "id-vf",        fieldKey: "contact.swot_verified_financials",dataType: "LARGE_TEXT", name: "Verified Financials" },
    { id: "id-decisions", fieldKey: "contact.swot_bga_decisions",      dataType: "LARGE_TEXT", name: "Decisions" },
    { id: "id-services",  fieldKey: "contact.swot_bga_services_selected", dataType: "LARGE_TEXT", name: "Services Selected" },
    { id: "id-prep",      fieldKey: "contact.swot_bga_prep_brief",     dataType: "LARGE_TEXT", name: "Prep Brief" },
    { id: "id-redteam",   fieldKey: "contact.swot_bga_red_team_report",dataType: "LARGE_TEXT", name: "Red Team" },
    { id: "id-freq",      fieldKey: "contact.swot_financials_request_list", dataType: "LARGE_TEXT", name: "Financials Request" },
    { id: "id-plan",      fieldKey: "contact.swot_growth_plan_draft",  dataType: "LARGE_TEXT", name: "Growth Plan Draft" },
    { id: "id-rehab",     fieldKey: "contact.swot_rehab_flag",         dataType: "TEXT",       name: "Rehab Flag" },
  ];
  return new Response(JSON.stringify({ customFields: list }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Dispatches to either the contact response or the catalog response
 * based on the request URL. Each handler issues one of each, so this
 * saves every test from writing its own routing.
 */
function routedResponder({ contact, catalog }) {
  return (url) => {
    const u = String(url);
    if (u.includes("/customFields")) return catalog || catalogResponse();
    return contact || ghlContact();
  };
}

beforeEach(() => {
  // Catalog cache is a module singleton; without a reset the second
  // test gets whatever the first test's responder returned.
  _resetCatalogCacheForTests();
});

describe("POST /asksolomon/case/load — handleCaseLoad", () => {
  it("401 without x-console-password", async () => {
    const req = post({ contactId: "c1" }, {});
    const res = await handleCaseLoad(req, makeEnv(), { checkPassword });
    assert.equal(res.status, 401);
  });

  it("400 without contactId", async () => {
    const res = await handleCaseLoad(post({}), makeEnv(), { checkPassword });
    assert.equal(res.status, 400);
  });

  it("400 on invalid JSON", async () => {
    const res = await handleCaseLoad(post("not json"), makeEnv(), { checkPassword });
    assert.equal(res.status, 400);
  });

  it("503 when GHL_API_KEY missing", async () => {
    const env = makeEnv();
    delete env.GHL_API_KEY;
    const res = await handleCaseLoad(post({ contactId: "c1" }), env, { checkPassword });
    assert.equal(res.status, 503);
  });

  it("503 when GHL contact fetch returns 404", async () => {
    const { restore } = stubFetch((url) => {
      if (String(url).includes("/customFields")) return catalogResponse();
      return new Response("", { status: 404 });
    });
    try {
      const res = await handleCaseLoad(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.success, false);
    } finally { restore(); }
  });

  it("503 when GHL contact fetch is non-ok", async () => {
    const { restore } = stubFetch((url) => {
      if (String(url).includes("/customFields")) return catalogResponse();
      return new Response("", { status: 500 });
    });
    try {
      const res = await handleCaseLoad(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 503);
    } finally { restore(); }
  });

  it("503 when GHL contact fetch throws", async () => {
    const { restore } = stubFetch((url) => {
      if (String(url).includes("/customFields")) return catalogResponse();
      throw new Error("network");
    });
    try {
      const res = await handleCaseLoad(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 503);
    } finally { restore(); }
  });

  it("400 when contact lacks swot_paid_297 tag", async () => {
    const { restore } = stubFetch(routedResponder({
      contact: ghlContact({ tags: ["swot_paid_47"] }),
    }));
    try {
      const res = await handleCaseLoad(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.match(body.error, /swot_paid_297/);
    } finally { restore(); }
  });

  it("200 happy path: returns full bundle shape (fieldKey-stubbed contact)", async () => {
    const customFields = [
      { fieldKey: "contact.business_playbook", value: "## Playbook content" },
      { fieldKey: "contact.swot_strategist_brief", value: "## Brief content" },
      { fieldKey: "contact.swot_full_report", value: "" },
      { fieldKey: "contact.swot_verified_financials", value: JSON.stringify([
        { metric_id: "cash_on_hand", value: 100 },
      ])},
    ];
    const { restore, calls } = stubFetch(routedResponder({
      contact: ghlContact({ customFields }),
    }));
    try {
      const res = await handleCaseLoad(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.contactId, "c1");
      assert.equal(body.business_name, "Acme Widgets Inc");
      assert.equal(body.classification, "growth");
      assert.equal(body.rehab_flag, false);
      assert.deepEqual(body.opportunity_flags, []);
      assert.equal(body.intake.business_playbook, "## Playbook content");
      assert.equal(body.intake.strategist_brief, "## Brief content");
      assert.equal(body.intake.full_diagnostic, "");
      assert.equal(body.verified_financials.entries_count, 1);
      assert.ok(body.verified_financials.present_metric_ids.includes("cash_on_hand"));
      assert.ok(body.verified_financials.missing_metric_ids.length > 0);
      assert.ok(body.canonical_metrics.cash_on_hand);
      assert.equal(body.case_state.financial_request_list_drafted, false);
      assert.equal(body.case_state.decisions_count, 0);
      // Two fetch calls: /customFields catalog + /contacts/{id}. No PUT.
      const methods = calls.map((c) => c.method);
      assert.ok(!methods.includes("PUT"));
      assert.ok(!methods.includes("POST"));
      assert.ok(calls.some((c) => c.url.includes("/customFields")));
      assert.ok(calls.some((c) => c.url.includes("/contacts/c1")));
    } finally { restore(); }
  });

  it("200 happy path (Codex P1 on #93): resolves id-only customFields via catalog", async () => {
    // GHL's real /contacts/{id} returns customFields as bare {id, value}
    // with no fieldKey. Before the fix, every read came back empty.
    // Now the catalog-backed idMap resolves them.
    const customFields = [
      { id: "id-playbook", value: "## From-id playbook content" },
      { id: "id-vf",       value: JSON.stringify([
        { metric_id: "revenue_ttm", value: 1800000 },
      ])},
    ];
    const { restore } = stubFetch(routedResponder({
      contact: ghlContact({ customFields }),
    }));
    try {
      const res = await handleCaseLoad(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.intake.business_playbook, "## From-id playbook content");
      assert.equal(body.verified_financials.entries_count, 1);
      assert.ok(body.verified_financials.present_metric_ids.includes("revenue_ttm"));
    } finally { restore(); }
  });

  it("read-only: never issues a PUT even with full bundle content", async () => {
    const { restore, calls } = stubFetch(routedResponder({
      contact: ghlContact({
        customFields: [
          { fieldKey: "contact.business_playbook", value: "x" },
        ],
      }),
    }));
    try {
      await handleCaseLoad(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      for (const c of calls) {
        assert.notEqual(c.method, "PUT");
        assert.notEqual(c.method, "POST");
      }
    } finally { restore(); }
  });

  it("classification=rehab when swot_rehab tag present", async () => {
    const { restore } = stubFetch(routedResponder({
      contact: ghlContact({ tags: ["swot_paid_297", "swot_rehab"] }),
    }));
    try {
      const res = await handleCaseLoad(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      const body = await res.json();
      assert.equal(body.classification, "rehab");
      assert.equal(body.rehab_flag, true);
    } finally { restore(); }
  });

  it("classification=needs-attention when opportunity flag present (no rehab)", async () => {
    const { restore } = stubFetch(routedResponder({
      contact: ghlContact({ tags: ["swot_paid_297", "ar_aging_opp"] }),
    }));
    try {
      const res = await handleCaseLoad(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      const body = await res.json();
      assert.equal(body.classification, "needs-attention");
      assert.deepEqual(body.opportunity_flags, ["ar_aging_opp"]);
    } finally { restore(); }
  });

  it("response sets Cache-Control: no-store", async () => {
    const { restore } = stubFetch(routedResponder({}));
    try {
      const res = await handleCaseLoad(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.headers.get("Cache-Control"), "no-store");
    } finally { restore(); }
  });

  it("falls through to fieldKey match when catalog fetch fails (survives GHL /customFields outage)", async () => {
    const { restore } = stubFetch((url) => {
      if (String(url).includes("/customFields")) return new Response("", { status: 500 });
      return ghlContact({
        customFields: [
          { fieldKey: "contact.business_playbook", value: "survives" },
        ],
      });
    });
    try {
      const res = await handleCaseLoad(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 200);
      const body = await res.json();
      // Catalog failed, so idMap is empty; readCustomField's fieldKey
      // fallback still finds the stubbed value.
      assert.equal(body.intake.business_playbook, "survives");
    } finally { restore(); }
  });
});

describe("assembleCaseBundle — pure assembly (no network)", () => {
  // No catalog in these tests — fieldKey fallback is what resolves fields.
  const idMap = {};

  it("counts a decisions JSON array correctly", () => {
    const contact = {
      tags: ["swot_paid_297"],
      companyName: "Co",
      customFields: [
        { fieldKey: "contact.swot_bga_decisions", value: JSON.stringify([
          { decision: "a" }, { decision: "b" }, { decision: "c" },
        ])},
      ],
    };
    const b = assembleCaseBundle(contact, idMap, { contactId: "c1" });
    assert.equal(b.case_state.decisions_count, 3);
  });

  it("counts 0 for malformed decisions JSON", () => {
    const contact = {
      tags: ["swot_paid_297"],
      customFields: [{ fieldKey: "contact.swot_bga_decisions", value: "}not json{" }],
    };
    const b = assembleCaseBundle(contact, idMap, { contactId: "c1" });
    assert.equal(b.case_state.decisions_count, 0);
  });

  it("parses services_selected as a flat id array", () => {
    const contact = {
      tags: ["swot_paid_297"],
      customFields: [{
        fieldKey: "contact.swot_bga_services_selected",
        value: JSON.stringify(["svc-a", { id: "svc-b" }, { not_id: "x" }]),
      }],
    };
    const b = assembleCaseBundle(contact, idMap, { contactId: "c1" });
    assert.deepEqual(b.case_state.services_selected, ["svc-a", "svc-b"]);
  });

  it("flags presence of prep_brief and red_team_report when non-empty", () => {
    const contact = {
      tags: ["swot_paid_297"],
      customFields: [
        { fieldKey: "contact.swot_bga_prep_brief", value: "prep content" },
        { fieldKey: "contact.swot_bga_red_team_report", value: "report content" },
      ],
    };
    const b = assembleCaseBundle(contact, idMap, { contactId: "c1" });
    assert.equal(b.case_state.prep_brief_present, true);
    assert.equal(b.case_state.red_team_report_present, true);
  });

  it("business_name falls back through candidates", () => {
    const b = assembleCaseBundle(
      { tags: ["swot_paid_297"], firstName: "Fallback LLC" },
      idMap, { contactId: "c1" },
    );
    assert.equal(b.business_name, "Fallback LLC");
  });

  it("business_name is empty when no candidate is present", () => {
    const b = assembleCaseBundle({ tags: ["swot_paid_297"] }, idMap, { contactId: "c1" });
    assert.equal(b.business_name, "");
  });

  it("day_since_paid_297 is null when no stamp present", () => {
    const b = assembleCaseBundle({ tags: ["swot_paid_297"] }, idMap, { contactId: "c1" });
    assert.equal(b.status.day_since_paid_297, null);
  });

  it("day_since_paid_297 clamps to 0 when stamp is in the future", () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const b = assembleCaseBundle(
      { tags: ["swot_paid_297"], dateAdded: future },
      idMap, { contactId: "c1" },
    );
    assert.equal(b.status.day_since_paid_297, 0);
  });

  it("canonical_metrics echo includes all ten metric ids", () => {
    const b = assembleCaseBundle({ tags: ["swot_paid_297"] }, idMap, { contactId: "c1" });
    const ids = Object.keys(b.canonical_metrics);
    assert.ok(ids.includes("cash_on_hand"));
    assert.ok(ids.includes("debt_terms"));
    assert.ok(ids.includes("tax_status"));
    assert.equal(ids.length, 10);
  });

  it("resolves id-only payloads when given a populated idMap (Codex P1 on #93)", () => {
    const contact = {
      tags: ["swot_paid_297"],
      customFields: [
        { id: "id-playbook",  value: "resolved via idMap" },
        { id: "id-brief",     value: "brief via idMap" },
      ],
    };
    const map = {
      business_playbook:     "id-playbook",
      swot_strategist_brief: "id-brief",
    };
    const b = assembleCaseBundle(contact, map, { contactId: "c1" });
    assert.equal(b.intake.business_playbook, "resolved via idMap");
    assert.equal(b.intake.strategist_brief, "brief via idMap");
  });
});
