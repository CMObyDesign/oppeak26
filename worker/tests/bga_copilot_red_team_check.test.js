// BGA Copilot — red_team_check tests (PR 12; spec §4.8 + §5.3).
//
// Covers:
//   - The 6 blockers and 4 warnings from §5.3 (positive + negative
//     cases).
//   - Input-hash computation (6 inputs; §5.3) is deterministic.
//   - The handler writes swot_bga_red_team_report with the right
//     shape and routes through the version-history wrapper (one
//     audit entry per call).
//   - Password gate (§9 guardrail 3).
//   - §9 guardrail 10: red_team_check never writes swot_growth_plan
//     and never applies swot_growth_plan_ready.
//   - handleAcknowledgeWarning appends warning ids and rejects
//     unknown ones.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  runRedTeamRules,
  handleRedTeamCheck,
  handleAcknowledgeWarning,
  computeInputHashes,
  canonicalizeIntakeBundle,
  checkInternalTerminology,
  checkPersonalPronouns,
  checkMissing90DaySection,
  checkMissingProvenanceFinancial,
  checkMissingProvenanceServiceMatch,
  checkServiceElevationWithoutDecision,
  checkTwelveMonthCertainty,
  checkSixMonthUnderdeveloped,
  checkDisqualifiedServiceStillRecommended,
  RED_TEAM_FIELD_KEY,
} from "../src/bga_copilot/red_team_check.js";
import { DRAFT_BANNER, parseDraftSections } from "../src/bga_copilot/roadmap.js";
import {
  _setCatalogForTests,
  _effectiveCatalog,
} from "../src/bga_copilot/services_catalog.js";
import { _resetCatalogCacheForTests } from "../src/ghl_catalog.js";

const FIXTURE_CATALOG = [
  {
    service_id: "fractional_cfo_core",
    name: "Fractional CFO — Core",
    problem_solved: "Owner has no forward cash visibility.",
    signals_relevant: ["low_margin_visibility"],
    when_not_to_recommend: ["active_tax_default"],
    dependencies: [],
    pricing: null,
  },
];

beforeEach(() => {
  _resetCatalogCacheForTests();
  _setCatalogForTests(FIXTURE_CATALOG);
});

function makeEnv() {
  return {
    GHL_API_KEY: "test-ghl",
    GHL_LOCATION_ID: "test-loc",
    CONSOLE_PASSWORD: "test-password",
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
    calls.push({ url: String(url), method: init?.method || "GET", body: init?.body });
    return responder(url, init);
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

function sampleCleanDraft() {
  // Minimal 8-section draft; every section has a body; no banned
  // terms, no bare financial claims.
  return `${DRAFT_BANNER}

## Section 1 — Where You Are Now

The business is in a stabilization phase.

## Section 2 — Verified Financial Position

Cash position is modest [VERIFIED FACT: cash_on_hand = $12,000 as of 2026-09, source: bank_statement].

## Section 3 — Priority Issues

- Margin visibility is thin [CS: owner statement].

## Section 4 — 90-Day Commitments

- Install a 13-week cash forecast.
- Close the books by day 7.

## Section 5 — 6-Month Direction

Build on the 90-day work. Reassess the pricing model. Expand on the plan to tighten operating cadence over the next two quarters so that monthly review becomes a lightweight check rather than a scramble. Review AR aging monthly and plan collection cadence. Set a target to recover one additional week of cash visibility.

## Section 6 — 12-Month Goals / Reassessment

- Goal: reassess the fractional CFO engagement cadence.

## Section 7 — Service Recommendations

- [SM: fractional_cfo_core, signal=low_margin_visibility] Fractional CFO engagement.

## Section 8 — Open Questions / Decisions

- Internal: confirm with Miguel which track to run.
`;
}

function ghlContactRes({ tags = ["swot_paid_297"], customFields = [] } = {}) {
  return new Response(
    JSON.stringify({ contact: { id: "c1", tags, customFields } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
function emptyCatalogRes() {
  return new Response(JSON.stringify({ customFields: [] }), { status: 200 });
}

describe("red_team_check — individual rules (§5.3)", () => {
  it("blocker 4: missing 90-day section fires when section 4 is empty", () => {
    const draft = sampleCleanDraft().replace(
      "- Install a 13-week cash forecast.\n- Close the books by day 7.",
      "",
    );
    const parsed = parseDraftSections(draft);
    const out = checkMissing90DaySection({ parsed_sections: parsed });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "missing_90_day_section");
  });

  it("blocker 4: does NOT fire when section 4 has content", () => {
    const parsed = parseDraftSections(sampleCleanDraft());
    const out = checkMissing90DaySection({ parsed_sections: parsed });
    assert.deepEqual(out, []);
  });

  it("blocker 5: banned internal terms fire in customer-visible copy", () => {
    const out = checkInternalTerminology({
      customer_visible: "This SWOT analysis is based on the paid_297 cohort.",
    });
    // Both SWOT and paid_297 should be flagged.
    const ids = out.map((o) => o.detail);
    assert.ok(ids.some((d) => d.includes('"SWOT"')));
    assert.ok(ids.some((d) => d.includes('"paid_297"')));
  });

  it("blocker 5: tolerates SWOT inside a word boundary (not as a standalone)", () => {
    const out = checkInternalTerminology({
      customer_visible: "A fully normal paragraph about growth planning.",
    });
    assert.deepEqual(out, []);
  });

  it("blocker 5: catches 'Deep Dive' (brand-banned)", () => {
    const out = checkInternalTerminology({
      customer_visible: "Welcome to your Deep Dive report.",
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "internal_terminology_in_customer_copy");
  });

  it("blocker 6: personal pronoun 'I will' fires", () => {
    const out = checkPersonalPronouns({
      customer_visible: "I will walk you through the plan on the call.",
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "miguel_personal_pronoun");
  });

  it("blocker 6: 'we will' is NOT a Miguel-personal pronoun", () => {
    const out = checkPersonalPronouns({
      customer_visible: "We will revisit this at the 90-day mark.",
    });
    assert.deepEqual(out, []);
  });

  it("blocker 2: bare financial claim with no provenance fires", () => {
    const out = checkMissingProvenanceFinancial({
      customer_visible: "Your gross margin should land at 38%.",
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "missing_provenance_financial");
  });

  it("blocker 2: financial claim with VERIFIED FACT tag passes", () => {
    const out = checkMissingProvenanceFinancial({
      customer_visible: "Cash is $12,000 [VERIFIED FACT: cash_on_hand].",
    });
    assert.deepEqual(out, []);
  });

  it("blocker 2: financial claim with CLIENT-STATED tag passes", () => {
    const out = checkMissingProvenanceFinancial({
      customer_visible: "Owner reports 45% gross margin [CLIENT-STATED].",
    });
    assert.deepEqual(out, []);
  });

  it("blocker 3: service recommendation without SM tag fires", () => {
    const draft = sampleCleanDraft().replace(
      "- [SM: fractional_cfo_core, signal=low_margin_visibility] Fractional CFO engagement.",
      "- Fractional CFO engagement.",
    );
    const parsed = parseDraftSections(draft);
    const out = checkMissingProvenanceServiceMatch({ parsed_sections: parsed });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "missing_provenance_service_match");
  });

  it("blocker 3: with SM tag passes", () => {
    const parsed = parseDraftSections(sampleCleanDraft());
    const out = checkMissingProvenanceServiceMatch({ parsed_sections: parsed });
    assert.deepEqual(out, []);
  });

  it("blocker 1: service_elevation_without_decision — selected but no SM tag and no decision", () => {
    const out = checkServiceElevationWithoutDecision({
      draft: sampleCleanDraft().replace("[SM: fractional_cfo_core, signal=low_margin_visibility]", "noop"),
      decisions: JSON.stringify([]),
      selections: JSON.stringify([
        { service_id: "fractional_cfo_core", status: "selected", reason: "" },
      ]),
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "service_elevation_without_decision");
  });

  it("blocker 1: selected service with SM tag in draft passes", () => {
    const out = checkServiceElevationWithoutDecision({
      draft: sampleCleanDraft(),
      decisions: JSON.stringify([]),
      selections: JSON.stringify([
        { service_id: "fractional_cfo_core", status: "selected", reason: "" },
      ]),
    });
    assert.deepEqual(out, []);
  });

  it("blocker 1: selected service with decision log entry passes", () => {
    const out = checkServiceElevationWithoutDecision({
      draft: "no SM tags here",
      decisions: JSON.stringify([
        { at: "2026-10-10T00:00:00Z", category: "priorities_confirmed",
          text: "Confirmed fractional_cfo_core engagement after discussion." },
      ]),
      selections: JSON.stringify([
        { service_id: "fractional_cfo_core", status: "selected", reason: "" },
      ]),
    });
    assert.deepEqual(out, []);
  });

  it("warning 1: 12-month framed as certainty fires", () => {
    const draft = sampleCleanDraft().replace(
      "- Goal: reassess the fractional CFO engagement cadence.",
      "- We will reach $2M in revenue.",
    );
    const parsed = parseDraftSections(draft);
    const out = checkTwelveMonthCertainty({ parsed_sections: parsed });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "twelve_month_as_certainty");
  });

  it("warning 1: goal-framed 12-month passes", () => {
    const parsed = parseDraftSections(sampleCleanDraft());
    const out = checkTwelveMonthCertainty({ parsed_sections: parsed });
    assert.deepEqual(out, []);
  });

  it("warning 2: 6-month much shorter than 90-day fires", () => {
    const long90Day = "- A ".repeat(120) + "\n";
    const draft = sampleCleanDraft().replace(
      "- Install a 13-week cash forecast.\n- Close the books by day 7.",
      long90Day,
    ).replace(
      /## Section 5 — 6-Month Direction\n[\s\S]*?## Section 6/,
      "## Section 5 — 6-Month Direction\n- Short.\n\n## Section 6",
    );
    const parsed = parseDraftSections(draft);
    const out = checkSixMonthUnderdeveloped({ parsed_sections: parsed });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "six_month_underdeveloped");
  });

  it("warning 4: disqualified service still recommended fires", () => {
    const out = checkDisqualifiedServiceStillRecommended({
      draft: "- [SM: fractional_cfo_core, signal=low_margin_visibility] fractional CFO.",
      active_disqualifiers: ["active_tax_default"],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "service_disqualified_still_recommended");
  });

  it("warning 4: no active disqualifier → no warning", () => {
    const out = checkDisqualifiedServiceStillRecommended({
      draft: "- [SM: fractional_cfo_core, signal=low_margin_visibility] fractional CFO.",
      active_disqualifiers: [],
    });
    assert.deepEqual(out, []);
  });
});

describe("runRedTeamRules — happy path (0 blockers, 0 warnings)", () => {
  it("clean draft yields empty blockers + warnings", () => {
    const draft = sampleCleanDraft();
    const parsed = parseDraftSections(draft);
    const customer_visible = parsed.sections
      .filter((s) => s.n <= 7)
      .map((s) => `## Section ${s.n} — ${s.title}\n${s.body || ""}`)
      .join("\n\n");
    const { blockers, warnings } = runRedTeamRules({
      draft, parsed_sections: parsed, customer_visible,
      decisions: JSON.stringify([]),
      selections: JSON.stringify([
        { service_id: "fractional_cfo_core", status: "selected", reason: "" },
      ]),
      verified_financials: "",
      intake_answers: [],
      active_signals: [], active_disqualifiers: [],
    });
    assert.deepEqual(blockers, []);
    assert.deepEqual(warnings, []);
  });
});

describe("computeInputHashes — determinism", () => {
  it("produces identical hashes for identical inputs", async () => {
    const inputs = {
      draft: "DRAFT",
      decisions: '[{"a":1}]',
      selections: '[]',
      verifiedFinancialsRaw: '[]',
      intakeAnswers: [{ question: "q", answer: "a", field: "f" }],
      catalogRef: "abc123def456",
    };
    const a = await computeInputHashes(inputs);
    const b = await computeInputHashes(inputs);
    assert.deepEqual(a, b);
    for (const k of Object.keys(a)) {
      if (k === "catalog_ref") assert.equal(a[k], "abc123def456");
      else assert.match(a[k], /^sha256:[0-9a-f]{64}$/);
    }
  });

  it("different content produces different hashes", async () => {
    const a = await computeInputHashes({ draft: "A", decisions: "", selections: "", verifiedFinancialsRaw: "", intakeAnswers: [], catalogRef: "x" });
    const b = await computeInputHashes({ draft: "B", decisions: "", selections: "", verifiedFinancialsRaw: "", intakeAnswers: [], catalogRef: "x" });
    assert.notEqual(a.draft_hash, b.draft_hash);
  });

  it("canonicalizeIntakeBundle is order-insensitive", () => {
    const a = canonicalizeIntakeBundle([
      { field: "f2", question: "q2", answer: "a2" },
      { field: "f1", question: "q1", answer: "a1" },
    ]);
    const b = canonicalizeIntakeBundle([
      { field: "f1", question: "q1", answer: "a1" },
      { field: "f2", question: "q2", answer: "a2" },
    ]);
    assert.equal(a, b);
  });
});

describe("POST /asksolomon/case/red-team-check — handler", () => {
  it("401 without x-console-password", async () => {
    const res = await handleRedTeamCheck(
      post({ contactId: "c1" }, {}),
      makeEnv(),
      { checkPassword },
    );
    assert.equal(res.status, 401);
  });

  it("400 without contactId", async () => {
    const res = await handleRedTeamCheck(post({}), makeEnv(), { checkPassword });
    assert.equal(res.status, 400);
  });

  it("400 when contact is not paid_297", async () => {
    const cap = stubFetch((url) => {
      if (String(url).includes("/customFields")) return emptyCatalogRes();
      return ghlContactRes({ tags: ["swot_free"] });
    });
    try {
      const res = await handleRedTeamCheck(
        post({ contactId: "c1" }), makeEnv(), { checkPassword },
      );
      assert.equal(res.status, 400);
    } finally { cap.restore(); }
  });

  it("400 when no draft present", async () => {
    const cap = stubFetch((url) => {
      if (String(url).includes("/customFields")) return emptyCatalogRes();
      return ghlContactRes();
    });
    try {
      const res = await handleRedTeamCheck(
        post({ contactId: "c1" }), makeEnv(), { checkPassword },
      );
      assert.equal(res.status, 400);
    } finally { cap.restore(); }
  });

  it("happy path: writes swot_bga_red_team_report + swot_bga_version_history and NO other field", async () => {
    let putBody = null;
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      if (u.includes("/contacts/") && init?.method === "PUT") {
        putBody = JSON.parse(init.body);
        return new Response("", { status: 200 });
      }
      return ghlContactRes({
        customFields: [
          { fieldKey: "contact.swot_growth_plan_draft", value: sampleCleanDraft() },
        ],
      });
    });
    try {
      const res = await handleRedTeamCheck(
        post({ contactId: "c1" }), makeEnv(), { checkPassword },
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.ok(body.report);
      assert.deepEqual(body.report.blockers, []);
      assert.deepEqual(body.report.acknowledged_warnings, []);
      // Keys written in one PUT: red-team report + version history. Nothing else.
      const keys = putBody.customFields.map((f) => f.key).sort();
      assert.deepEqual(keys, [RED_TEAM_FIELD_KEY, "swot_bga_version_history"]);
    } finally { cap.restore(); }
  });

  it("§9 guardrail 10: red_team_check NEVER writes swot_growth_plan or applies swot_growth_plan_ready", async () => {
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      if (u.includes("/contacts/") && init?.method === "PUT") {
        const b = JSON.parse(init.body);
        const keys = (b.customFields || []).map((f) => f.key);
        assert.ok(!keys.includes("swot_growth_plan"), "swot_growth_plan must not appear");
        return new Response("", { status: 200 });
      }
      if (u.endsWith("/tags")) {
        const b = JSON.parse(init.body);
        assert.ok(!(b.tags || []).includes("swot_growth_plan_ready"), "ready tag must not fire");
      }
      return ghlContactRes({
        customFields: [
          { fieldKey: "contact.swot_growth_plan_draft", value: sampleCleanDraft() },
        ],
      });
    });
    try {
      const res = await handleRedTeamCheck(
        post({ contactId: "c1" }), makeEnv(), { checkPassword },
      );
      assert.equal(res.status, 200);
      for (const c of cap.calls) {
        if (c.url.endsWith("/tags")) {
          assert.fail("red_team_check must not apply any tag");
        }
      }
    } finally { cap.restore(); }
  });
});

describe("POST /asksolomon/case/acknowledge-warning — handler", () => {
  it("401 without password", async () => {
    const res = await handleAcknowledgeWarning(
      post({ contactId: "c1", warning_id: "x" }, {}),
      makeEnv(), { checkPassword },
    );
    assert.equal(res.status, 401);
  });

  it("400 when warning_id not in the latest report", async () => {
    const report = {
      run_at: "2026-10-10T00:00:00Z",
      blockers: [],
      warnings: [{ id: "known_warning", where: "x", detail: "x" }],
      acknowledged_warnings: [],
      inputs_checked: {},
    };
    const cap = stubFetch((url) => {
      if (String(url).includes("/customFields") && !String(url).includes("/contacts/")) return emptyCatalogRes();
      return ghlContactRes({
        customFields: [{ fieldKey: `contact.${RED_TEAM_FIELD_KEY}`, value: JSON.stringify(report) }],
      });
    });
    try {
      const res = await handleAcknowledgeWarning(
        post({ contactId: "c1", warning_id: "unknown" }),
        makeEnv(), { checkPassword },
      );
      assert.equal(res.status, 400);
    } finally { cap.restore(); }
  });

  it("200 appends warning_id and persists", async () => {
    const report = {
      run_at: "2026-10-10T00:00:00Z",
      blockers: [],
      warnings: [{ id: "twelve_month_as_certainty", where: "s6", detail: "" }],
      acknowledged_warnings: [],
      inputs_checked: {},
    };
    let putBody = null;
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("/customFields") && !u.includes("/contacts/")) return emptyCatalogRes();
      if (u.includes("/contacts/") && init?.method === "PUT") {
        putBody = JSON.parse(init.body);
        return new Response("", { status: 200 });
      }
      return ghlContactRes({
        customFields: [{ fieldKey: `contact.${RED_TEAM_FIELD_KEY}`, value: JSON.stringify(report) }],
      });
    });
    try {
      const res = await handleAcknowledgeWarning(
        post({ contactId: "c1", warning_id: "twelve_month_as_certainty" }),
        makeEnv(), { checkPassword },
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body.acknowledged_warnings, ["twelve_month_as_certainty"]);
      const written = JSON.parse(
        putBody.customFields.find((f) => f.key === RED_TEAM_FIELD_KEY).field_value,
      );
      assert.deepEqual(written.acknowledged_warnings, ["twelve_month_as_certainty"]);
    } finally { cap.restore(); }
  });
});
