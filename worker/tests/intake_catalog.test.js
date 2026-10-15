// Intake catalog + question-contract tests — Question Contract PR.
//
// Pins every behavioural guarantee the PR brief listed:
//   - New Q4 values round-trip correctly through the normalizer.
//   - Legacy Q4 values still normalize safely (bare "yes" NEVER
//     interpreted as proof of tax distress or debt-service pressure).
//   - $47 generation works with and without annual_revenue.
//   - New Q19 / Q23 fields appear in the report prompt.
//   - Old q19_audit_history / q23_risk_management values are NEVER
//     misread as the new monthly-close / operating-runway concepts.
//   - Q_C "Not tracked" / Q_G "Not applicable" / Q_J "Not applicable"
//     rubric guidance is present verbatim in the system prompt so the
//     model has it in context.
//   - Lab Guided mode's catalog matches the production TypeScript
//     question definitions byte-for-byte.
//   - Q_O is required in the shared catalog + its hint reflects that.
//
// All assertions are mechanical (string / shape) so this file stays
// cheap to run and never flakes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { normalizeContactFields } from "../src/normalize.js";
import { INTAKE_CATALOG, questionsForTier } from "../src/intake_catalog.js";
import { CONSOLE_PAGE } from "../src/console_page.js";
import worker from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_SRC = resolve(HERE, "..", "..", "app", "src");

function readApp(path) {
  return readFileSync(resolve(APP_SRC, path), "utf8");
}

/**
 * Strip common TypeScript-source string-escape sequences so an
 * `includes()` check against the raw file matches regardless of how
 * the quote was escaped in the source. The TS file writes
 * `"...\"we should...\"..."` for an embedded double-quote; our
 * catalog's JS literal parses it the same way, but the raw bytes
 * differ. Dropping the escape backslashes before compare keeps the
 * drift-detection check honest without duplicating every escaping
 * decision.
 */
function stripBackslashEscapes(src) {
  return src.replace(/\\"/g, '"').replace(/\\'/g, "'");
}

// Build a fake GHL contact that normalize.js's normalizeContactFields
// can read. Field id drives which normalizer runs. We only need Q4
// (OyQjw4nGNHJYADsq5ggg) for the debt-summary pins.
function contactWithQ4(value) {
  return {
    customFields: [{ id: "OyQjw4nGNHJYADsq5ggg", value }],
  };
}

describe("Q4 — new six-state slug set normalizes authoritatively", () => {
  const CATALOG = {
    catalog: {
      OyQjw4nGNHJYADsq5ggg: { name: "Q4", fieldKey: "contact.active_debt", dataType: "SINGLE_OPTIONS" },
    },
  };
  function normQ4(value) {
    const n = normalizeContactFields(contactWithQ4(value), CATALOG);
    const q4 = n.find((e) => e.source_field_id === "OyQjw4nGNHJYADsq5ggg");
    return q4 && q4.normalized_value;
  }

  it("none → clean denial (no subtypes, judgments_or_liens: false)", () => {
    assert.deepEqual(normQ4("none"), { subtypes: [], judgments_or_liens: false });
  });
  it("managed_debt → debt present but not a rehab trigger", () => {
    const n = normQ4("managed_debt");
    assert.deepEqual(n.subtypes, ["managed_debt"]);
    assert.equal(n.judgments_or_liens, false);
  });
  it("tax_balance → tax_debt subtype, not an active lien", () => {
    const n = normQ4("tax_balance");
    assert.ok(n.subtypes.includes("tax_debt"));
    assert.equal(n.judgments_or_liens, false);
  });
  // Codex P1 on #128: previous mapping overclaimed. unfiled_taxes
  // adding a tax_debt subtype can turn into a "tax balance" claim
  // the customer never made (they may file and owe nothing when they
  // catch up). Pin that we keep ONLY unfiled_taxes.
  it("unfiled_taxes → unfiled_taxes subtype only (no inferred tax_debt)", () => {
    const n = normQ4("unfiled_taxes");
    assert.deepEqual(n.subtypes, ["unfiled_taxes"]);
    assert.ok(!n.subtypes.includes("tax_debt"),
      "unfiled_taxes must NOT be classified as tax_debt — see Codex P1 on #128");
    assert.equal(n.judgments_or_liens, false);
  });
  // Same discipline for lien_or_judgment: the slug encompasses tax
  // lien / civil judgment / other legal action. We keep only the
  // compound judgments_or_liens signal; the specific subtype is for
  // the paid-tier debt detail to disambiguate.
  it("lien_or_judgment → compound signal only, no specific subtype claimed", () => {
    const n = normQ4("lien_or_judgment");
    assert.deepEqual(n.subtypes, []);
    assert.equal(n.judgments_or_liens, true);
    assert.ok(!n.subtypes.includes("tax_debt"),
      "lien_or_judgment must NOT be classified as tax_debt — the slug covers civil judgments too");
    assert.ok(!n.subtypes.includes("judgment"),
      "lien_or_judgment must NOT be classified as a court judgment — the slug covers tax liens too");
  });
  it("not_sure → unknown subtype (never a positive rehab trigger)", () => {
    assert.deepEqual(normQ4("not_sure"), { subtypes: [], judgments_or_liens: "unknown" });
  });
});

describe("Q4 — legacy three-value slugs still normalize safely", () => {
  const CATALOG = {
    catalog: {
      OyQjw4nGNHJYADsq5ggg: { name: "Q4", fieldKey: "contact.active_debt", dataType: "SINGLE_OPTIONS" },
    },
  };
  function normQ4(value) {
    const n = normalizeContactFields(contactWithQ4(value), CATALOG);
    const q4 = n.find((e) => e.source_field_id === "OyQjw4nGNHJYADsq5ggg");
    return q4 && q4.normalized_value;
  }

  it("legacy 'no' → clean denial", () => {
    assert.deepEqual(normQ4("no"), { subtypes: [], judgments_or_liens: false });
    assert.deepEqual(normQ4("No"), { subtypes: [], judgments_or_liens: false });
  });

  // The headline guarantee: bare legacy "yes" MUST stay as unknown
  // subtype — if this test ever starts coming back with
  // judgments_or_liens: true, somebody has silently promoted a vague
  // affirmative answer into a legal-distress red flag.
  it("legacy 'yes' → unknown subtype, NEVER proof of tax distress", () => {
    const n = normQ4("yes");
    assert.deepEqual(n.subtypes, []);
    assert.equal(n.judgments_or_liens, "unknown");
    assert.notEqual(n.judgments_or_liens, true, "bare legacy yes must never resolve to true");
    assert.ok(!n.subtypes.includes("tax_debt"), "bare legacy yes must never add tax_debt");
    assert.ok(!n.subtypes.includes("judgment"), "bare legacy yes must never add judgment");
  });

  it("legacy 'not-sure' → unknown subtype", () => {
    assert.deepEqual(normQ4("not-sure"), { subtypes: [], judgments_or_liens: "unknown" });
    assert.deepEqual(normQ4("not sure"), { subtypes: [], judgments_or_liens: "unknown" });
  });
});

describe("Q4 — the label text classifies safely too (no false legal-action match)", () => {
  const CATALOG = {
    catalog: {
      OyQjw4nGNHJYADsq5ggg: { name: "Q4", fieldKey: "contact.active_debt", dataType: "SINGLE_OPTIONS" },
    },
  };
  function normQ4(value) {
    const n = normalizeContactFields(contactWithQ4(value), CATALOG);
    const q4 = n.find((e) => e.source_field_id === "OyQjw4nGNHJYADsq5ggg");
    return q4 && q4.normalized_value;
  }

  it("the 'none' LABEL text contains 'legal actions' but must NOT add a judgment", () => {
    // If HL ever stores the option label verbatim (instead of the slug)
    // this would hit the heuristic text matcher. The known-labels
    // short-circuit catches it before the "legal action" keyword can
    // wrongly flip judgments_or_liens true.
    const label = "No business debt, taxes current, no legal actions against the business";
    const n = normQ4(label);
    assert.ok(n, "label must still normalize");
    assert.ok(!n.subtypes.includes("judgment"), "must not add judgment for a denial sentence");
  });
});

describe("$47 — annual_revenue is now an optional business-info field", () => {
  const paid47Src = readApp("data/paidTier47Questions.ts");

  it("annual_revenue is in PAID_TIER_47_BUSINESS_INFO", () => {
    assert.match(paid47Src, /id:\s*"annual_revenue"/);
  });
  it("annual_revenue uses the Trailing 12-Month Revenue customer-facing label", () => {
    assert.match(paid47Src, /Trailing 12-Month Revenue/);
  });
  it("annual_revenue is NOT marked required (so $47 can still generate when the buyer skips it)", () => {
    const m = /\{\s*id:\s*"annual_revenue"[^}]*\}/.exec(paid47Src);
    assert.ok(m, "annual_revenue entry present");
    assert.ok(!/required:\s*true/.test(m[0]), "annual_revenue must not be required: true");
  });
});

describe("$47 — Q19 and Q23 are replaced, legacy keys are gone from the production survey", () => {
  const paid47Src = readApp("data/paidTier47Questions.ts");

  it("q19_monthly_close_status is the new Q19", () => {
    assert.match(paid47Src, /id:\s*"q19_monthly_close_status"/);
    assert.match(paid47Src, /Monthly Close Status/);
  });
  it("q19_audit_history is NOT in the active production survey (but kept conceptually elsewhere)", () => {
    assert.doesNotMatch(paid47Src, /id:\s*"q19_audit_history"/);
  });
  it("q23_operating_runway is the new Q23", () => {
    assert.match(paid47Src, /id:\s*"q23_operating_runway"/);
    assert.match(paid47Src, /Operating Runway/);
  });
  it("q23_risk_management is NOT in the active production survey", () => {
    assert.doesNotMatch(paid47Src, /id:\s*"q23_risk_management"/);
  });
});

describe("Rubric — new Q19/Q23 appear + legacy keys explicitly isolated", () => {
  const indexSrc = readFileSync(resolve(HERE, "..", "src", "index.js"), "utf8");

  it("new q19_monthly_close_status is explained in the prompt", () => {
    assert.match(indexSrc, /q19_monthly_close_status/);
    assert.match(indexSrc, /monthly-timely/);
    assert.match(indexSrc, /no-close/);
  });
  it("new q23_operating_runway is explained in the prompt", () => {
    assert.match(indexSrc, /q23_operating_runway/);
    assert.match(indexSrc, /six-plus-months/);
    assert.match(indexSrc, /less-than-one/);
  });
  it("legacy q19_audit_history is explicitly flagged as a DIFFERENT concept", () => {
    assert.match(indexSrc, /q19_audit_history/);
    assert.match(
      indexSrc,
      /NEVER re-interpret these values as\s+monthly-close/i,
      "the rubric must warn Solomon not to confuse the two Q19s",
    );
  });
  it("legacy q23_risk_management is explicitly flagged as a DIFFERENT concept", () => {
    assert.match(indexSrc, /q23_risk_management/);
    assert.match(
      indexSrc,
      /NEVER re-interpret these values as\s+operating runway/i,
      "the rubric must warn Solomon not to confuse the two Q23s",
    );
  });
});

describe("BGA — Q_C 'Not tracked' and Q_G/Q_J 'Not applicable' discipline", () => {
  const indexSrc = readFileSync(resolve(HERE, "..", "src", "index.js"), "utf8");

  it("Q_C 'Not tracked' is defined as a visibility gap, NOT invented weakness", () => {
    assert.match(indexSrc, /qc_unit_economics/);
    assert.match(indexSrc, /VISIBILITY GAP/);
    assert.match(indexSrc, /do NOT invent benchmark/i);
  });
  it("Q_G 'Not applicable' must NOT fire a sales-pipeline finding", () => {
    assert.match(indexSrc, /qg_close_rate_by_stage/);
    assert.match(indexSrc, /Do NOT fire a sales-pipeline finding/);
    assert.match(indexSrc, /qg_close_rate_by_stage[\s\S]{0,2000}Not applicable/);
  });
  it("Q_J 'Not applicable' must NOT fire a concentration-risk finding", () => {
    assert.match(indexSrc, /qj_top_10_concentration/);
    assert.match(indexSrc, /Do NOT fire a concentration-risk finding/);
    assert.match(indexSrc, /qj_top_10_concentration[\s\S]{0,2000}Not applicable/);
  });
});

describe("BGA — Q_O is required in the production survey (blocks intake submission)", () => {
  const bgaSrc = readApp("data/paidTier297Questions.ts");
  const surveySrc = readApp("components/PaidTier297Survey.tsx");

  it("Q_O carries required: true", () => {
    const m = /\{\s*id:\s*"qo_focus_areas"[\s\S]*?\n\s{0,4}\}/.exec(bgaSrc);
    assert.ok(m, "qo_focus_areas definition present");
    assert.match(m[0], /required:\s*true/);
  });
  it("Q_O has the Decisions-to-Work-Through-on-Your-BGA-Call title", () => {
    assert.match(bgaSrc, /Decisions to Work Through on Your BGA Call/);
  });
  it("PaidTier297Survey enforces required answers before onComplete fires", () => {
    assert.match(surveySrc, /missingRequired\(/);
    assert.match(surveySrc, /missing\.q\.title/);
    // The error UI slot must render requiredError.
    assert.match(surveySrc, /\{requiredError &&/);
  });
});

describe("BGA — 'Deep Dive' no longer in customer-facing section names", () => {
  const bgaSrc = readApp("data/paidTier297Questions.ts");
  it("no section still carries '— Deep Dive'", () => {
    assert.doesNotMatch(bgaSrc, /Deep Dive/);
  });
});

describe("Lab Guided catalog mirrors the production TypeScript definitions", () => {
  it("every free-tier catalog question's text appears verbatim in freeAssessmentQuestions.ts", () => {
    const src = stripBackslashEscapes(readApp("data/freeAssessmentQuestions.ts"));
    for (const q of INTAKE_CATALOG.free) {
      assert.ok(src.includes(q.text),
        `free Q (${q.key}) text drift: ${JSON.stringify(q.text)} not found in freeAssessmentQuestions.ts`);
    }
  });
  it("every paid_47 catalog question's text appears verbatim in paidTier47Questions.ts", () => {
    const src = stripBackslashEscapes(readApp("data/paidTier47Questions.ts"));
    for (const q of INTAKE_CATALOG.paid_47) {
      assert.ok(src.includes(q.text),
        `paid_47 Q (${q.key}) text drift: ${JSON.stringify(q.text)} not found in paidTier47Questions.ts`);
    }
  });
  it("every paid_297 catalog question's text appears verbatim in paidTier297Questions.ts", () => {
    const src = stripBackslashEscapes(readApp("data/paidTier297Questions.ts"));
    for (const q of INTAKE_CATALOG.paid_297) {
      assert.ok(src.includes(q.text),
        `paid_297 Q (${q.key}) text drift: ${JSON.stringify(q.text)} not found in paidTier297Questions.ts`);
    }
  });
  it("the catalog is injected into the Ask Solomon console page so Guided mode reads it", () => {
    assert.match(CONSOLE_PAGE, /const INTAKE_CATALOG = \{/);
    // And the three legacy hard-coded arrays are gone from the page.
    // (Catalog-defined constants with the same names are allowed; the
    // regression here is that the OLD hand-maintained text should no
    // longer appear.)
    assert.ok(!CONSOLE_PAGE.includes("What proprietary process, methodology, or capability do you have"),
      "stale PAID_47_ADDITIONAL text found — Guided mode is reading from the legacy hard-coded array, not the catalog");
  });
  it("questionsForTier returns correct cumulative counts per tier", () => {
    assert.equal(questionsForTier("free").length, INTAKE_CATALOG.free.length);
    assert.equal(
      questionsForTier("paid_47").length,
      INTAKE_CATALOG.free.length + INTAKE_CATALOG.paid_47.length,
    );
    assert.equal(
      questionsForTier("paid_297").length,
      INTAKE_CATALOG.free.length + INTAKE_CATALOG.paid_47.length + INTAKE_CATALOG.paid_297.length,
    );
  });
});

describe("Guided-mode answer storage is versioned (Codex P1 on #128)", () => {
  it("uses the v2 storage key, not the legacy one", () => {
    assert.match(CONSOLE_PAGE, /asksolomon_guided_answers_v2/);
  });
  it("removes the legacy asksolomon_guided_answers key on load", () => {
    // The one-time migration deletes the pre-rename localStorage key
    // so stale drafts (keyed to old meanings like old Q1 = debt
    // question) don't get restored and silently submitted against the
    // new catalog where Q1 is business type.
    assert.match(
      CONSOLE_PAGE,
      /localStorage\.removeItem\("asksolomon_guided_answers"\)/,
    );
  });
});

describe("annual_revenue is actually forwarded to the worker (Codex P2 on #128)", () => {
  it("the paid_47 handler puts annual_revenue into businessProfile.annualRevenue", () => {
    const paid47Src = readApp("pages/PaidTier47.tsx");
    assert.match(paid47Src, /annualRevenue:\s*finalAnswers\["annual_revenue"\]/);
  });
  it("the assessment.ts businessProfile type allows annualRevenue", () => {
    const libSrc = readApp("lib/assessment.ts");
    assert.match(libSrc, /annualRevenue\?:\s*string/);
  });
  it("the worker's BUSINESS PROFILE block emits annualRevenue when present", () => {
    const workerIndex = readFileSync(resolve(HERE, "..", "src", "index.js"), "utf8");
    assert.match(workerIndex, /businessProfile\.annualRevenue\s*&&\s*`Trailing 12-month revenue/);
  });
  it("the paid_47 → paid_297 localStorage stash includes annualRevenue so it isn't collected twice", () => {
    const paid47Src = readApp("pages/PaidTier47.tsx");
    assert.match(paid47Src, /annualRevenue:\s*answers\["annual_revenue"\]/);
  });
});

describe("$47 → $297 handoff actually prefills annual_revenue (Codex P2 on #129)", () => {
  it("PaidTier297.tsx businessProfile type allows annualRevenue", () => {
    const src = readApp("pages/PaidTier297.tsx");
    assert.match(src, /annualRevenue\?:\s*string/);
  });
  it("PaidTier297.tsx hydrates annualRevenue from the stash on verifyPayment", () => {
    const src = readApp("pages/PaidTier297.tsx");
    // params.get("annualRevenue") || stored.annualRevenue || ""
    assert.match(
      src,
      /annualRevenue:\s*params\.get\("annualRevenue"\)[\s\S]{0,80}stored\.annualRevenue/,
      "verifyPayment path must read annualRevenue from URL param + localStorage stash",
    );
  });
  it("PaidTier297.tsx hands initialAnswers.annual_revenue to the Survey component", () => {
    const src = readApp("pages/PaidTier297.tsx");
    assert.match(src, /initialAnswers=/);
    assert.match(src, /annual_revenue:\s*businessProfile\.annualRevenue/);
  });
  it("PaidTier297Survey.tsx accepts initialAnswers prop and seeds its state from it", () => {
    const src = readApp("components/PaidTier297Survey.tsx");
    assert.match(src, /initialAnswers\?:\s*Record<string,\s*any>/);
    // Must destructure the prop and use it to seed the useState initializer.
    assert.match(src, /PaidTier297Survey\s*=\s*\(\{[\s\S]{0,200}initialAnswers\s*\}:/);
    assert.match(src, /useState<Record<string,\s*any>>\(\(\)\s*=>\s*\(\{\s*\.\.\.\(initialAnswers\s*\|\|\s*\{\}\)/);
  });
  it("PaidTier297Survey resume merge treats seed values as a floor, not an override — mid-survey draft wins", () => {
    const src = readApp("components/PaidTier297Survey.tsx");
    // The resume effect must NOT blindly setAnswers(s.answers) because
    // that would drop the initialAnswers seed. It must merge and only
    // let non-empty stored values overwrite the seed.
    assert.doesNotMatch(src, /setAnswers\(s\.answers\)/,
      "a bare setAnswers(s.answers) would wipe the initialAnswers seed — merge instead");
    assert.match(src, /if \(v !== undefined && v !== null && v !== ""\) merged\[k\] = v/);
  });
});

describe("Served console page actually loads", () => {
  it("GET /asksolomon returns 200 HTML containing the catalog", async () => {
    const res = await worker.fetch(
      new Request("https://example.com/asksolomon"),
      { CONSOLE_PASSWORD: "x" },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /const INTAKE_CATALOG = \{/);
    assert.match(body, /Which best describes your business's current debt/);
  });
});
