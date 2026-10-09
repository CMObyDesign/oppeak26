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

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { handleCaseLoad, assembleCaseBundle } from "../src/bga_copilot/case_load.js";

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

  it("503 when GHL returns 404", async () => {
    const { restore } = stubFetch(() => new Response("", { status: 404 }));
    try {
      const res = await handleCaseLoad(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.success, false);
    } finally { restore(); }
  });

  it("503 when GHL non-ok", async () => {
    const { restore } = stubFetch(() => new Response("", { status: 500 }));
    try {
      const res = await handleCaseLoad(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 503);
    } finally { restore(); }
  });

  it("503 when GHL fetch throws", async () => {
    const { restore } = stubFetch(() => { throw new Error("network"); });
    try {
      const res = await handleCaseLoad(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 503);
    } finally { restore(); }
  });

  it("400 when contact lacks swot_paid_297 tag", async () => {
    const { restore } = stubFetch(() => ghlContact({ tags: ["swot_paid_47"] }));
    try {
      const res = await handleCaseLoad(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.match(body.error, /swot_paid_297/);
    } finally { restore(); }
  });

  it("200 happy path: returns full bundle shape", async () => {
    const customFields = [
      { fieldKey: "contact.business_playbook", value: "## Playbook content" },
      { fieldKey: "contact.swot_strategist_brief", value: "## Brief content" },
      { fieldKey: "contact.swot_full_report", value: "" },
      { fieldKey: "contact.swot_verified_financials", value: JSON.stringify([
        { metric_id: "cash_on_hand", value: 100 },
      ])},
    ];
    const { restore, calls } = stubFetch(() => ghlContact({ customFields }));
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
      // One fetch call — read-only, no PUT.
      assert.equal(calls.length, 1);
      assert.equal(calls[0].method, "GET");
    } finally { restore(); }
  });

  it("read-only: never issues a PUT even with full bundle content", async () => {
    const { restore, calls } = stubFetch(() => ghlContact({
      customFields: [
        { fieldKey: "contact.business_playbook", value: "x" },
      ],
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
    const { restore } = stubFetch(() => ghlContact({ tags: ["swot_paid_297", "swot_rehab"] }));
    try {
      const res = await handleCaseLoad(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      const body = await res.json();
      assert.equal(body.classification, "rehab");
      assert.equal(body.rehab_flag, true);
    } finally { restore(); }
  });

  it("classification=needs-attention when opportunity flag present (no rehab)", async () => {
    const { restore } = stubFetch(() => ghlContact({
      tags: ["swot_paid_297", "ar_aging_opp"],
    }));
    try {
      const res = await handleCaseLoad(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      const body = await res.json();
      assert.equal(body.classification, "needs-attention");
      assert.deepEqual(body.opportunity_flags, ["ar_aging_opp"]);
    } finally { restore(); }
  });

  it("response sets Cache-Control: no-store", async () => {
    const { restore } = stubFetch(() => ghlContact());
    try {
      const res = await handleCaseLoad(post({ contactId: "c1" }), makeEnv(), { checkPassword });
      assert.equal(res.headers.get("Cache-Control"), "no-store");
    } finally { restore(); }
  });
});

describe("assembleCaseBundle — pure assembly (no network)", () => {
  const env = makeEnv();

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
    const b = assembleCaseBundle(contact, env, { contactId: "c1" });
    assert.equal(b.case_state.decisions_count, 3);
  });

  it("counts 0 for malformed decisions JSON", () => {
    const contact = {
      tags: ["swot_paid_297"],
      customFields: [{ fieldKey: "contact.swot_bga_decisions", value: "}not json{" }],
    };
    const b = assembleCaseBundle(contact, env, { contactId: "c1" });
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
    const b = assembleCaseBundle(contact, env, { contactId: "c1" });
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
    const b = assembleCaseBundle(contact, env, { contactId: "c1" });
    assert.equal(b.case_state.prep_brief_present, true);
    assert.equal(b.case_state.red_team_report_present, true);
  });

  it("business_name falls back through candidates", () => {
    const b = assembleCaseBundle(
      { tags: ["swot_paid_297"], firstName: "Fallback LLC" },
      env, { contactId: "c1" },
    );
    assert.equal(b.business_name, "Fallback LLC");
  });

  it("business_name is empty when no candidate is present", () => {
    const b = assembleCaseBundle({ tags: ["swot_paid_297"] }, env, { contactId: "c1" });
    assert.equal(b.business_name, "");
  });

  it("day_since_paid_297 is null when no stamp present", () => {
    const b = assembleCaseBundle({ tags: ["swot_paid_297"] }, env, { contactId: "c1" });
    assert.equal(b.status.day_since_paid_297, null);
  });

  it("day_since_paid_297 clamps to 0 when stamp is in the future", () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const b = assembleCaseBundle(
      { tags: ["swot_paid_297"], dateAdded: future },
      env, { contactId: "c1" },
    );
    assert.equal(b.status.day_since_paid_297, 0);
  });

  it("canonical_metrics echo includes all ten metric ids", () => {
    const b = assembleCaseBundle({ tags: ["swot_paid_297"] }, env, { contactId: "c1" });
    const ids = Object.keys(b.canonical_metrics);
    assert.ok(ids.includes("cash_on_hand"));
    assert.ok(ids.includes("debt_terms"));
    assert.ok(ids.includes("tax_status"));
    assert.equal(ids.length, 10);
  });
});
