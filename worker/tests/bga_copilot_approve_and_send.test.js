// BGA Copilot — approve_and_send tests (PR 12; spec §4.9 + §5 + §9).
//
// Covers the §9 regression tests that pertain to the button:
//   3. 401 without x-console-password
//   4. 400 without reviewed=true
//   5. 409 no draft present
//   6. 403 without swot_paid_297
//   7. 409 if swot_growth_plan_ready already present
//   8. Concurrent approval serialization (D1 UNIQUE)
//   9. Writeback failure → tag NOT applied + lock DELETED
//   10. Grep: only approve_and_send writes swot_growth_plan /
//       applies swot_growth_plan_ready in the Worker source.
//   11. Blocker in red-team report refuses with 409
//   12. Unacknowledged warning refuses with 400
//   15. Version-history entry appends on every tool call
//   16. No finalize_and_send endpoint
//   17. Stale report refuses with 409 on each of 6 input hashes
//
// Also covers the handler's own happy path.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import {
  handleApproveAndSend,
  acquireSendLock,
  releaseSendLock,
  compareInputHashes,
  renderGrowthPlanFromDraft,
  renderNextStepsFromDecisions,
  renderServicesDisplay,
  READY_TAG,
  GROWTH_PLAN_FIELD_KEY,
  NEXT_STEPS_FIELD_KEY,
  SERVICES_SELECTED_DISPLAY_FIELD_KEY,
} from "../src/bga_copilot/approve_and_send.js";
import {
  RED_TEAM_FIELD_KEY,
  DRAFT_FIELD_KEY,
  DECISIONS_FIELD_KEY,
  SERVICES_SELECTED_FIELD_KEY,
  VF_FIELD_KEY,
  computeInputHashes,
} from "../src/bga_copilot/red_team_check.js";
import { DRAFT_BANNER } from "../src/bga_copilot/roadmap.js";
import {
  _setCatalogForTests,
  getServicesCatalogVersion,
  _effectiveCatalog,
} from "../src/bga_copilot/services_catalog.js";
import { _resetCatalogCacheForTests } from "../src/ghl_catalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

beforeEach(() => {
  _resetCatalogCacheForTests();
  _setCatalogForTests([
    {
      service_id: "fractional_cfo_core",
      name: "Fractional CFO — Core",
      problem_solved: "Owner has no forward cash visibility.",
      signals_relevant: ["low_margin_visibility"],
      when_not_to_recommend: ["active_tax_default"],
      dependencies: [],
      pricing: null,
    },
  ]);
});

function makeD1Stub() {
  const rows = new Map();
  return {
    rows,
    binding: {
      prepare(sql) {
        return {
          _sql: sql,
          _args: [],
          bind(...args) { this._args = args; return this; },
          async run() {
            if (/^INSERT INTO bga_send_locks/i.test(this._sql)) {
              const [contactId, acquiredAt] = this._args;
              if (rows.has(contactId)) {
                const e = new Error("UNIQUE constraint failed: bga_send_locks.contact_id");
                e.message = "D1_ERROR: UNIQUE constraint failed: bga_send_locks.contact_id";
                throw e;
              }
              rows.set(contactId, { acquired_at: acquiredAt });
              return { success: true };
            }
            if (/^DELETE FROM bga_send_locks/i.test(this._sql)) {
              rows.delete(this._args[0]);
              return { success: true };
            }
            throw new Error("unexpected SQL: " + this._sql);
          },
          async first() {
            if (/^SELECT acquired_at FROM bga_send_locks/i.test(this._sql)) {
              const row = rows.get(this._args[0]);
              return row ? { acquired_at: row.acquired_at } : null;
            }
            return null;
          },
        };
      },
    },
  };
}

function makeEnv(overrides = {}) {
  return {
    GHL_API_KEY: "test-ghl",
    GHL_LOCATION_ID: "test-loc",
    CONSOLE_PASSWORD: "test-password",
    ...overrides,
  };
}
const PASS = { "x-console-password": "test-password" };
function post(body, headers = PASS) {
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
    const call = { url: String(url), method: init?.method || "GET", body: init?.body };
    calls.push(call);
    return responder(url, init);
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

function sampleCleanDraft() {
  return `${DRAFT_BANNER}

## Section 1 — Where You Are Now

Current state read.

## Section 2 — Verified Financial Position

Cash position [VERIFIED FACT: cash_on_hand = $12,000].

## Section 3 — Priority Issues

- Margin visibility is thin [CS: owner statement].

## Section 4 — 90-Day Commitments

- Install a 13-week cash forecast.

## Section 5 — 6-Month Direction

Section 5 content follows the 90-day work.

## Section 6 — 12-Month Goals / Reassessment

- Goal: reassess fractional CFO cadence.

## Section 7 — Service Recommendations

- [SM: fractional_cfo_core, signal=low_margin_visibility] Fractional CFO.

## Section 8 — Open Questions / Decisions

- Internal: confirm with Miguel.
`;
}

function sampleDecisions() {
  return JSON.stringify([
    { at: "2026-10-10T00:00:00Z", category: "priorities_confirmed",
      text: "Confirmed 90-day plan." },
    { at: "2026-10-10T00:00:00Z", category: "ninety_day_commitments",
      text: "Install forecast." },
  ]);
}
function sampleSelections() {
  return JSON.stringify([
    { service_id: "fractional_cfo_core", status: "selected", reason: "" },
  ]);
}

async function sampleHashes(overrides = {}) {
  // The handler computes catalog_ref from the live catalog, so the
  // test fixture must do the same — otherwise the stored report's
  // catalog_ref never matches and every happy-path test falsely 409s
  // with "stale".
  //
  // Also match what the handler reads for VF: readCustomField returns
  // "" when the field is missing. We supply "[]" in the fixture, so
  // hash "[]". Intake: assembleCaseBundle for a contact with no
  // intake custom fields yields paid_297_answers: [], which
  // canonicalizes to "[]" — same as our test input.
  const catalogRef = await getServicesCatalogVersion();
  const base = {
    draft: sampleCleanDraft(),
    decisions: sampleDecisions(),
    selections: sampleSelections(),
    verifiedFinancialsRaw: "[]",
    intakeAnswers: [],
    catalogRef,
  };
  return computeInputHashes({ ...base, ...overrides });
}

async function sampleRedTeamReport(overrides = {}) {
  const inputs_checked = await sampleHashes(overrides.hashOverrides || {});
  return {
    run_at: "2026-10-10T00:00:00Z",
    blockers: overrides.blockers ?? [],
    warnings: overrides.warnings ?? [],
    acknowledged_warnings: overrides.acknowledged_warnings ?? [],
    inputs_checked,
  };
}

function contactWithFields(fieldMap, tags = ["swot_paid_297"]) {
  const customFields = Object.entries(fieldMap).map(([key, value], i) => ({
    // Synthesize a stable id so extractPaid297IntakeAnswers (which
    // requires f.id to count a field) picks up any paid_297 intake
    // fields the test added — needed by §9/17 intake_bundle_hash case.
    id: `test_fid_${i}`,
    fieldKey: `contact.${key}`,
    value,
  }));
  return new Response(
    JSON.stringify({ contact: { id: "c1", tags, customFields } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function emptyCatalogRes() {
  return new Response(JSON.stringify({ customFields: [] }), { status: 200 });
}

async function fullyPopulatedContact() {
  const report = await sampleRedTeamReport();
  return {
    [DRAFT_FIELD_KEY]: sampleCleanDraft(),
    [DECISIONS_FIELD_KEY]: sampleDecisions(),
    [SERVICES_SELECTED_FIELD_KEY]: sampleSelections(),
    [VF_FIELD_KEY]: "[]",
    [RED_TEAM_FIELD_KEY]: JSON.stringify(report),
  };
}

async function fullyPopulatedContactWithReport(reportOverrides) {
  const report = await sampleRedTeamReport(reportOverrides);
  return {
    [DRAFT_FIELD_KEY]: sampleCleanDraft(),
    [DECISIONS_FIELD_KEY]: sampleDecisions(),
    [SERVICES_SELECTED_FIELD_KEY]: sampleSelections(),
    [VF_FIELD_KEY]: "[]",
    [RED_TEAM_FIELD_KEY]: JSON.stringify(report),
  };
}

// ------- Pure helpers --------

describe("renderGrowthPlanFromDraft", () => {
  it("strips the DRAFT banner and Section 8", () => {
    const out = renderGrowthPlanFromDraft(sampleCleanDraft());
    assert.ok(!out.includes("DRAFT · INTERNAL"));
    assert.ok(!out.includes("Section 8"));
    assert.ok(out.includes("Section 1 — Where You Are Now"));
    assert.ok(out.includes("Section 7 — Service Recommendations"));
  });
});

describe("renderNextStepsFromDecisions", () => {
  it("renders a grouped HTML list from valid decisions array", () => {
    const html = renderNextStepsFromDecisions(sampleDecisions());
    assert.ok(html.includes("<ul>"));
    assert.ok(html.includes("90-day commitments") || html.includes("Your 90-day commitments"));
    assert.ok(html.includes("Install forecast"));
  });
  it("gracefully handles empty / missing input", () => {
    assert.ok(renderNextStepsFromDecisions("").startsWith("<p>"));
    assert.ok(renderNextStepsFromDecisions("not json").startsWith("<p>"));
  });
  it("escapes HTML in decision text (no XSS)", () => {
    const payload = JSON.stringify([
      { at: "t", category: "priorities_confirmed", text: "<script>alert(1)</script>" },
    ]);
    const html = renderNextStepsFromDecisions(payload);
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;script&gt;"));
  });
});

describe("renderServicesDisplay", () => {
  it("renders selected and declined/deferred buckets", () => {
    const payload = JSON.stringify([
      { service_id: "fractional_cfo_core", status: "selected", reason: "owner said yes" },
      { service_id: "bookkeeping_cleanup", status: "declined_or_deferred", reason: "" },
    ]);
    const html = renderServicesDisplay(payload);
    assert.ok(html.includes("Fractional Cfo Core"));
    assert.ok(html.includes("owner said yes"));
    assert.ok(html.includes("Deferred for a later conversation"));
    assert.ok(html.includes("Bookkeeping Cleanup"));
  });
});

describe("compareInputHashes", () => {
  it("stale=false when every field matches", async () => {
    const s = await sampleHashes();
    const c = await sampleHashes();
    assert.deepEqual(compareInputHashes(s, c), { stale: false, changed: [] });
  });
  it("stale=true naming the changed input", async () => {
    const s = await sampleHashes();
    const c = await sampleHashes({ draft: sampleCleanDraft() + "\nEDIT" });
    const out = compareInputHashes(s, c);
    assert.equal(out.stale, true);
    assert.deepEqual(out.changed, ["draft_hash"]);
  });
});

// ------- D1 lock behavior --------

describe("acquireSendLock / releaseSendLock", () => {
  it("acquires once, 409s on second insert for the same contact_id", async () => {
    const d1 = makeD1Stub();
    const env = makeEnv({ SOLOMON_DB: d1.binding });
    const a = await acquireSendLock("c1", env);
    assert.equal(a.acquired, true);
    const b = await acquireSendLock("c1", env);
    assert.equal(b.acquired, false);
    assert.ok(b.existing_acquired_at);
  });
  it("releaseSendLock deletes the row so a retry can acquire again", async () => {
    const d1 = makeD1Stub();
    const env = makeEnv({ SOLOMON_DB: d1.binding });
    await acquireSendLock("c1", env);
    await releaseSendLock("c1", env);
    const retry = await acquireSendLock("c1", env);
    assert.equal(retry.acquired, true);
  });
  it("returns error when SOLOMON_DB binding is missing", async () => {
    const r = await acquireSendLock("c1", makeEnv());
    assert.equal(r.acquired, false);
    assert.match(r.error, /SOLOMON_DB/);
  });
});

// ------- Handler §9 preconditions --------

describe("POST /asksolomon/case/approve-and-send — preconditions", () => {
  it("§9/3: 401 without x-console-password", async () => {
    const res = await handleApproveAndSend(
      post({ contactId: "c1", reviewed: true }, {}),
      makeEnv({ SOLOMON_DB: makeD1Stub().binding }),
      { checkPassword },
    );
    assert.equal(res.status, 401);
  });

  it("§9/4: 400 without reviewed=true", async () => {
    const res = await handleApproveAndSend(
      post({ contactId: "c1" }),
      makeEnv({ SOLOMON_DB: makeD1Stub().binding }),
      { checkPassword },
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /reviewed=true/);
  });

  it("§9/4: 400 when reviewed is not literal true (e.g. 'true')", async () => {
    const cap = stubFetch(() => emptyCatalogRes());
    try {
      const res = await handleApproveAndSend(
        post({ contactId: "c1", reviewed: "true" }),
        makeEnv({ SOLOMON_DB: makeD1Stub().binding }),
        { checkPassword },
      );
      assert.equal(res.status, 400);
    } finally { cap.restore(); }
  });

  it("§9/6: 403 without swot_paid_297", async () => {
    const cap = stubFetch((url) => {
      if (String(url).includes("/customFields") && !String(url).includes("/contacts/")) return emptyCatalogRes();
      return contactWithFields({}, ["swot_free"]);
    });
    try {
      const res = await handleApproveAndSend(
        post({ contactId: "c1", reviewed: true }),
        makeEnv({ SOLOMON_DB: makeD1Stub().binding }),
        { checkPassword },
      );
      assert.equal(res.status, 403);
    } finally { cap.restore(); }
  });

  it("§9/7: 409 when swot_growth_plan_ready already present", async () => {
    const cap = stubFetch((url) => {
      if (String(url).includes("/customFields") && !String(url).includes("/contacts/")) return emptyCatalogRes();
      return contactWithFields({}, ["swot_paid_297", READY_TAG]);
    });
    try {
      const res = await handleApproveAndSend(
        post({ contactId: "c1", reviewed: true }),
        makeEnv({ SOLOMON_DB: makeD1Stub().binding }),
        { checkPassword },
      );
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.match(body.error, /already sent/);
    } finally { cap.restore(); }
  });

  it("§9/5: 409 when no draft present", async () => {
    const cap = stubFetch((url) => {
      if (String(url).includes("/customFields") && !String(url).includes("/contacts/")) return emptyCatalogRes();
      return contactWithFields({}, ["swot_paid_297"]);
    });
    try {
      const res = await handleApproveAndSend(
        post({ contactId: "c1", reviewed: true }),
        makeEnv({ SOLOMON_DB: makeD1Stub().binding }),
        { checkPassword },
      );
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.match(body.error, /no draft/i);
    } finally { cap.restore(); }
  });

  it("§9/11: 409 when red-team report has blockers", async () => {
    const fields = await fullyPopulatedContactWithReport({
      blockers: [{ id: "missing_90_day_section", where: "section 4", detail: "x" }],
    });
    const cap = stubFetch((url) => {
      if (String(url).includes("/customFields") && !String(url).includes("/contacts/")) return emptyCatalogRes();
      return contactWithFields(fields);
    });
    try {
      const res = await handleApproveAndSend(
        post({ contactId: "c1", reviewed: true }),
        makeEnv({ SOLOMON_DB: makeD1Stub().binding }),
        { checkPassword },
      );
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.match(body.error, /red-team blockers present/);
    } finally { cap.restore(); }
  });

  it("§9/12: 400 when a warning is unacknowledged", async () => {
    const fields = await fullyPopulatedContactWithReport({
      warnings: [{ id: "twelve_month_as_certainty", where: "s6", detail: "x" }],
      acknowledged_warnings: [],
    });
    const cap = stubFetch((url) => {
      if (String(url).includes("/customFields") && !String(url).includes("/contacts/")) return emptyCatalogRes();
      return contactWithFields(fields);
    });
    try {
      const res = await handleApproveAndSend(
        post({ contactId: "c1", reviewed: true }),
        makeEnv({ SOLOMON_DB: makeD1Stub().binding }),
        { checkPassword },
      );
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.match(body.error, /unacknowledged warnings/);
    } finally { cap.restore(); }
  });

  it("409 when no red-team report present at all", async () => {
    const cap = stubFetch((url) => {
      if (String(url).includes("/customFields") && !String(url).includes("/contacts/")) return emptyCatalogRes();
      return contactWithFields({
        [DRAFT_FIELD_KEY]: sampleCleanDraft(),
      });
    });
    try {
      const res = await handleApproveAndSend(
        post({ contactId: "c1", reviewed: true }),
        makeEnv({ SOLOMON_DB: makeD1Stub().binding }),
        { checkPassword },
      );
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.match(body.error, /PRE-SEND QA/);
    } finally { cap.restore(); }
  });
});

// ------- §9/17: stale report refuses on each of 6 input hashes --------

describe("POST /asksolomon/case/approve-and-send — §9/17 stale report (6 inputs)", () => {
  const cases = [
    {
      name: "draft changed",
      changed: "draft_hash",
      overrideFields: { [DRAFT_FIELD_KEY]: sampleCleanDraft() + "\nEDIT" },
      // The report pins the untouched draft hash; the handler reads the
      // live field (the override) → mismatch.
    },
    {
      name: "decisions changed",
      changed: "decisions_hash",
      overrideFields: { [DECISIONS_FIELD_KEY]: JSON.stringify([{ at: "x", category: "y", text: "edited" }]) },
    },
    {
      name: "selections changed",
      changed: "selections_hash",
      overrideFields: { [SERVICES_SELECTED_FIELD_KEY]: JSON.stringify([{ service_id: "something_else", status: "selected", reason: "" }]) },
    },
    {
      name: "verified_financials changed",
      changed: "verified_financials_hash",
      overrideFields: { [VF_FIELD_KEY]: JSON.stringify([{ metric_id: "cash_on_hand", value: 1 }]) },
    },
  ];
  for (const c of cases) {
    it(`refuses with 409 when ${c.name} (${c.changed})`, async () => {
      const baseFields = await fullyPopulatedContact();
      const finalFields = { ...baseFields, ...c.overrideFields };
      const cap = stubFetch((url) => {
        if (String(url).includes("/customFields") && !String(url).includes("/contacts/")) return emptyCatalogRes();
        return contactWithFields(finalFields);
      });
      try {
        const res = await handleApproveAndSend(
          post({ contactId: "c1", reviewed: true }),
          makeEnv({ SOLOMON_DB: makeD1Stub().binding }),
          { checkPassword },
        );
        assert.equal(res.status, 409);
        const body = await res.json();
        assert.match(body.error, /stale/);
        assert.ok(Array.isArray(body.changed_inputs));
        assert.ok(body.changed_inputs.includes(c.changed), `expected changed_inputs to include ${c.changed}, got ${JSON.stringify(body.changed_inputs)}`);
      } finally { cap.restore(); }
    });
  }

  it("refuses with 409 when catalog_ref changed (catalog SHA bumped)", async () => {
    const fields = await fullyPopulatedContact();
    // Mutate the catalog AFTER the report was written → catalog_ref
    // shifts and the stored report's catalog_ref no longer matches.
    _setCatalogForTests([
      ...(_effectiveCatalog() || []),
      {
        service_id: "new_service_that_bumps_hash",
        name: "New",
        problem_solved: "x",
        signals_relevant: [],
        when_not_to_recommend: [],
        dependencies: [],
        pricing: null,
      },
    ]);
    const cap = stubFetch((url) => {
      if (String(url).includes("/customFields") && !String(url).includes("/contacts/")) return emptyCatalogRes();
      return contactWithFields(fields);
    });
    try {
      const res = await handleApproveAndSend(
        post({ contactId: "c1", reviewed: true }),
        makeEnv({ SOLOMON_DB: makeD1Stub().binding }),
        { checkPassword },
      );
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.match(body.error, /stale/);
      assert.ok(body.changed_inputs.includes("catalog_ref"));
    } finally { cap.restore(); }
  });

  it("refuses with 409 when intake_bundle_hash changed (intake answer edited)", async () => {
    // Build a report whose intake-bundle hash corresponds to NO intake
    // answers (what the empty-fixture contact yields). Then supply a
    // contact with intake fields present — the computed hash on read
    // will differ from the stored one.
    const baseFields = await fullyPopulatedContact();
    // The contact gets a paid_297 intake-answer custom field; the
    // bundle will surface it under intake.paid_297_answers; and
    // computeInputHashes against a non-empty array canonicalizes to
    // something other than "[]".
    const fieldsWithIntake = {
      ...baseFields,
      // A paid_297 intake field that assembleCaseBundle will pick up.
      // The specific field key doesn't matter — any paid_297_* field
      // that case_load extracts via extractPaid297IntakeAnswers.
      "paid_297_biggest_concern": "A concern that changes the intake bundle hash.",
    };
    const cap = stubFetch((url) => {
      if (String(url).includes("/customFields") && !String(url).includes("/contacts/")) return emptyCatalogRes();
      return contactWithFields(fieldsWithIntake);
    });
    try {
      const res = await handleApproveAndSend(
        post({ contactId: "c1", reviewed: true }),
        makeEnv({ SOLOMON_DB: makeD1Stub().binding }),
        { checkPassword },
      );
      // The stored report's intake_bundle_hash = sha256("[]"); the
      // live hash reflects the one intake answer → different →
      // staleness is detected (though it may surface as "intake_bundle_hash"
      // in changed_inputs or the sibling catalog_ref if the fixture
      // changes). The important invariant: approve is REFUSED.
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.match(body.error, /stale/);
    } finally { cap.restore(); }
  });
});

// ------- Happy path + concurrency + rollback --------

describe("POST /asksolomon/case/approve-and-send — happy path", () => {
  it("200: writes the 3 customer fields + version history in one PUT, applies the ready tag", async () => {
    const fields = await fullyPopulatedContact();
    let putBody = null;
    const tagCalls = [];
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      if (u.includes("/contacts/") && init?.method === "PUT") {
        putBody = JSON.parse(init.body);
        return new Response("", { status: 200 });
      }
      if (u.endsWith("/tags")) {
        tagCalls.push(JSON.parse(init.body));
        return new Response("", { status: 200 });
      }
      return contactWithFields(fields);
    });
    try {
      const res = await handleApproveAndSend(
        post({ contactId: "c1", reviewed: true }),
        makeEnv({ SOLOMON_DB: makeD1Stub().binding }),
        { checkPassword },
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      // PUT body carries exactly: swot_growth_plan, swot_bga_next_steps,
      // swot_bga_services_selected_display, swot_bga_version_history.
      const keys = putBody.customFields.map((f) => f.key).sort();
      assert.deepEqual(keys, [
        "swot_bga_next_steps",
        "swot_bga_services_selected_display",
        "swot_bga_version_history",
        "swot_growth_plan",
      ].sort());
      // Exactly one /tags call with swot_growth_plan_ready.
      assert.equal(tagCalls.length, 1);
      assert.deepEqual(tagCalls[0].tags, [READY_TAG]);
    } finally { cap.restore(); }
  });

  it("§9/15: happy path appends 3 version-history entries (one per data field)", async () => {
    const fields = await fullyPopulatedContact();
    let putBody = null;
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      if (u.includes("/contacts/") && init?.method === "PUT") {
        putBody = JSON.parse(init.body);
        return new Response("", { status: 200 });
      }
      if (u.endsWith("/tags")) return new Response("", { status: 200 });
      return contactWithFields(fields);
    });
    try {
      await handleApproveAndSend(
        post({ contactId: "c1", reviewed: true }),
        makeEnv({ SOLOMON_DB: makeD1Stub().binding }),
        { checkPassword },
      );
      const historyField = putBody.customFields.find((f) => f.key === "swot_bga_version_history");
      const entries = JSON.parse(historyField.field_value);
      // 3 affected fields → 3 entries, all tagged action: "approve_and_send".
      assert.equal(entries.length, 3);
      for (const e of entries) {
        assert.equal(e.action, "approve_and_send");
        assert.equal(e.actor, "console_session");
      }
      const fields_touched = entries.map((e) => e.affected_field).sort();
      assert.deepEqual(fields_touched, [
        GROWTH_PLAN_FIELD_KEY,
        NEXT_STEPS_FIELD_KEY,
        SERVICES_SELECTED_DISPLAY_FIELD_KEY,
      ].sort());
    } finally { cap.restore(); }
  });
});

describe("POST /asksolomon/case/approve-and-send — §9/8 concurrent serialization", () => {
  it("second concurrent request 409s on the D1 UNIQUE constraint and fires NO GHL call", async () => {
    const fields = await fullyPopulatedContact();
    const d1 = makeD1Stub();
    const env = makeEnv({ SOLOMON_DB: d1.binding });
    // Pre-populate the lock so the handler's INSERT fails. This simulates
    // the second-call-after-first-committed scenario without needing
    // real concurrency.
    d1.rows.set("c1", { acquired_at: "2026-10-10T00:00:00Z" });

    let putCount = 0;
    let tagCount = 0;
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      if (u.includes("/contacts/") && init?.method === "PUT") {
        putCount++;
        return new Response("", { status: 200 });
      }
      if (u.endsWith("/tags")) {
        tagCount++;
        return new Response("", { status: 200 });
      }
      return contactWithFields(fields);
    });
    try {
      const res = await handleApproveAndSend(
        post({ contactId: "c1", reviewed: true }), env, { checkPassword },
      );
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.match(body.error, /already sent/);
      assert.equal(putCount, 0, "no GHL writes should have fired");
      assert.equal(tagCount, 0, "no tag application should have fired");
    } finally { cap.restore(); }
  });
});

describe("POST /asksolomon/case/approve-and-send — §9/9 rollback on writeback failure", () => {
  it("GHL PUT fails → tag NOT applied + lock row DELETED (retry possible)", async () => {
    const fields = await fullyPopulatedContact();
    const d1 = makeD1Stub();
    const env = makeEnv({ SOLOMON_DB: d1.binding });

    let tagCount = 0;
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      if (u.includes("/contacts/") && init?.method === "PUT") {
        return new Response("", { status: 500 });
      }
      if (u.endsWith("/tags")) {
        tagCount++;
        return new Response("", { status: 200 });
      }
      return contactWithFields(fields);
    });
    try {
      const res = await handleApproveAndSend(
        post({ contactId: "c1", reviewed: true }), env, { checkPassword },
      );
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.match(body.error, /step 8/);
      assert.equal(tagCount, 0, "tag must not fire on writeback failure");
      assert.equal(d1.rows.size, 0, "lock row must be deleted on writeback failure");
    } finally { cap.restore(); }
  });

  it("tag application fails after writes succeed → 503 with manual-apply guidance + lock DELETED", async () => {
    const fields = await fullyPopulatedContact();
    const d1 = makeD1Stub();
    const env = makeEnv({ SOLOMON_DB: d1.binding });

    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      if (u.includes("/contacts/") && init?.method === "PUT") {
        return new Response("", { status: 200 });
      }
      if (u.endsWith("/tags")) {
        return new Response("", { status: 500 });
      }
      return contactWithFields(fields);
    });
    try {
      const res = await handleApproveAndSend(
        post({ contactId: "c1", reviewed: true }), env, { checkPassword },
      );
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.match(body.error, /step 9/);
      assert.match(body.error, /manually/i);
      // Lock deleted per §5.4 step 11
      assert.equal(d1.rows.size, 0);
    } finally { cap.restore(); }
  });
});

// ------- §9/10 and §9/16: grep-based guardrails over the source tree ----

function listJsFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      listJsFiles(p, acc);
    } else if (name.endsWith(".js")) {
      acc.push(p);
    }
  }
  return acc;
}

describe("§9/10 — only approve_and_send writes swot_growth_plan or applies swot_growth_plan_ready", () => {
  // All *.js files under worker/src/ that reference the quoted string
  // "swot_growth_plan" (not "_draft") must be the approve_and_send
  // module. Same for the "swot_growth_plan_ready" tag string.
  const workerSrc = resolve(repoRoot, "worker/src");
  const files = listJsFiles(workerSrc);

  it("no handler outside approve_and_send.js writes 'swot_growth_plan' (customer field)", () => {
    const re = /["']swot_growth_plan["']/g;
    const offenders = [];
    for (const f of files) {
      if (f.endsWith("approve_and_send.js")) continue;
      // approve_and_send tests may legitimately reference it — but we scan src/ not tests/.
      const text = readFileSync(f, "utf8");
      // Allow mentions in comments; strip single-line // and /* */ comments heuristically.
      const stripped = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((l) => l.replace(/\/\/.*$/, ""))
        .join("\n");
      if (re.test(stripped)) {
        offenders.push(f);
      }
      re.lastIndex = 0;
    }
    assert.deepEqual(offenders, [], `Found code outside approve_and_send.js referencing "swot_growth_plan": ${offenders.join(", ")}`);
  });

  it("no handler outside approve_and_send.js writes 'swot_growth_plan_ready' (ready tag)", () => {
    const re = /["']swot_growth_plan_ready["']/g;
    const offenders = [];
    for (const f of files) {
      if (f.endsWith("approve_and_send.js")) continue;
      const text = readFileSync(f, "utf8");
      const stripped = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((l) => l.replace(/\/\/.*$/, ""))
        .join("\n");
      if (re.test(stripped)) {
        offenders.push(f);
      }
      re.lastIndex = 0;
    }
    assert.deepEqual(offenders, [], `Found code outside approve_and_send.js referencing "swot_growth_plan_ready": ${offenders.join(", ")}`);
  });
});

describe("§9/16 — no finalize_and_send endpoint or handler exists in the Worker source", () => {
  const workerSrc = resolve(repoRoot, "worker/src");
  const files = listJsFiles(workerSrc);
  it("source tree does not define a finalize_and_send route or handler", () => {
    const bannedPatterns = [
      /\/case\/finalize-and-send/i,
      /\/case\/finalize_and_send/i,
      /\bhandleFinalizeAndSend\b/,
      /\bfinalize_and_send\b/,
    ];
    const offenders = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const re of bannedPatterns) {
        if (re.test(text)) offenders.push(`${f} :: ${re}`);
      }
    }
    assert.deepEqual(offenders, [], `Found banned finalize_and_send references: ${offenders.join("; ")}`);
  });
});
