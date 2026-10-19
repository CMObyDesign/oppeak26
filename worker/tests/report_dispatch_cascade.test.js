// Regression: report-dispatch cascade must put paid-tier INTENT
// (tag) ahead of the free-content fallback.
//
// Live beta reproducer (2026-10-18, Liz Test / Cool Air HVAC):
// A paid_47 customer who finished the extended intake but whose
// Full Diagnostic Claude run had not fired yet (or had failed —
// swot|deliveryfailed on the contact) was being served their OLD
// free report at /report/{contactId}, including its "$47 Full
// Diagnostic" upsell block at the bottom. The free-tier gate in
// ResultsScreen was correct for the content it was handed; the
// bug was that the content was the wrong tier for the customer.
//
// Pre-fix cascade:
//   paid_297 + content → paid_297
//   paid_47  + content → paid_47
//   HAS free content   → free                 ← trap
//   paid_297 tag only  → paid_297 "analyzing"
//   paid_47 tag only   → paid_47 "analyzing"
//   else               → free "analyzing"
//
// Post-fix cascade (paid intent beats free fallback):
//   paid_297 + content → paid_297
//   paid_297 tag only  → paid_297 "analyzing"
//   paid_47  + content → paid_47
//   paid_47 tag only   → paid_47 "analyzing"
//   HAS free content   → free
//   else               → free "analyzing"
//
// This class of bug has recurred (SOLOMON50 beta earlier, this time
// paid_47 Full Diagnostic). The test pins the invariant so a future
// refactor can't quietly reorder the cascade and silently fall back
// to free for a paid customer again.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { handleReportStatus } from "../src/index.js";

// Field ids come from CONFIG.REPORT_FIELD_IDS in worker/src/index.js.
// Mirror them here so the fake GHL contact payload matches what the
// cascade looks up by id.
const FIELD_ID_FREE   = "Ys28pMUc82cURfnsbQzY";
const FIELD_ID_FULL   = "pa6VF4GsufGuTAjlFVnf";
const FIELD_ID_PLAYBOOK = "business_playbook"; // CONFIG uses the key fallback here

function makeContact({ tags = [], fields = {} }) {
  // fields keys: "swot_free_report", "swot_full_report", "business_playbook"
  const customFields = [];
  if (fields.swot_free_report !== undefined) {
    customFields.push({ id: FIELD_ID_FREE, fieldKey: "contact.swot_free_report", value: fields.swot_free_report });
  }
  if (fields.swot_full_report !== undefined) {
    customFields.push({ id: FIELD_ID_FULL, fieldKey: "contact.swot_full_report", value: fields.swot_full_report });
  }
  if (fields.business_playbook !== undefined) {
    customFields.push({ fieldKey: "contact.business_playbook", value: fields.business_playbook });
  }
  return { id: "c_test", tags, customFields };
}

function installGhlStub(contact) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (/\/contacts\/c_test$/.test(u)) {
      return new Response(JSON.stringify({ contact }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("unexpected", { status: 418 });
  };
  return () => { globalThis.fetch = original; };
}

async function readJson(resp) {
  const t = await resp.text();
  try { return JSON.parse(t); } catch { return { __raw: t }; }
}

const ENV = { GHL_API_KEY: "k" };

describe("report-dispatch cascade — paid intent beats free fallback (regression)", () => {
  let restore;
  afterEach(() => { if (restore) restore(); restore = null; });

  it("Pre-fix repro: paid_47 tag + stale free content → MUST serve paid_47 analyzing, NOT free", async () => {
    restore = installGhlStub(makeContact({
      tags: ["swot_paid_47"],
      fields: {
        swot_free_report: "<p>old free report HTML</p>", // the trap: free content present
        // swot_full_report intentionally empty — Claude hasn't run yet
      },
    }));
    const resp = await handleReportStatus("c_test", ENV);
    const body = await readJson(resp);
    assert.equal(body.tier, "paid_47", "paid intent must win over free content fallback");
    assert.equal(body.ready, false, "ready=false because swot_full_report is empty");
  });

  it("SOLOMON50 beta tag behaves identically to paid_47 tag", async () => {
    restore = installGhlStub(makeContact({
      tags: ["swot_solomon50_applied"],
      fields: { swot_free_report: "<p>stale</p>" },
    }));
    const body = await readJson(await handleReportStatus("c_test", ENV));
    assert.equal(body.tier, "paid_47");
    assert.equal(body.ready, false);
  });

  it("paid_297 tag + stale free content → MUST serve paid_297 analyzing, NOT free", async () => {
    restore = installGhlStub(makeContact({
      tags: ["swot_paid_297"],
      fields: { swot_free_report: "<p>stale</p>" },
    }));
    const body = await readJson(await handleReportStatus("c_test", ENV));
    assert.equal(body.tier, "paid_297");
    assert.equal(body.ready, false);
  });

  it("paid_47 tag + paid_47 content → serves paid_47 ready", async () => {
    restore = installGhlStub(makeContact({
      tags: ["swot_paid_47"],
      fields: {
        swot_free_report: "<p>old free</p>",
        swot_full_report: "<p>paid full diagnostic</p>",
      },
    }));
    const body = await readJson(await handleReportStatus("c_test", ENV));
    assert.equal(body.tier, "paid_47");
    assert.equal(body.ready, true);
  });

  it("paid_297 tag + playbook content → serves paid_297 ready (highest tier wins)", async () => {
    restore = installGhlStub(makeContact({
      tags: ["swot_paid_297", "swot_paid_47"],
      fields: {
        swot_free_report: "<p>free</p>",
        swot_full_report: "<p>full</p>",
        business_playbook: "<p>growth plan</p>",
      },
    }));
    const body = await readJson(await handleReportStatus("c_test", ENV));
    assert.equal(body.tier, "paid_297");
    assert.equal(body.ready, true);
  });

  it("Free-only contact with free content → serves free ready", async () => {
    restore = installGhlStub(makeContact({
      tags: [],
      fields: { swot_free_report: "<p>free report</p>" },
    }));
    const body = await readJson(await handleReportStatus("c_test", ENV));
    assert.equal(body.tier, "free");
    assert.equal(body.ready, true);
  });

  it("Free-only contact without any content → serves free analyzing", async () => {
    restore = installGhlStub(makeContact({ tags: [], fields: {} }));
    const body = await readJson(await handleReportStatus("c_test", ENV));
    assert.equal(body.tier, "free");
    assert.equal(body.ready, false);
  });
});
