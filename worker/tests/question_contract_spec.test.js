// Question Contract — approved-spec wording + values.
//
// Pins the final approved option sets for free Q4, $47 Q19 / Q23,
// the $47 Annual Revenue field, the BGA Q_C / Q_G / Q_J / Q_O copy,
// the customer-facing BGA section names, and the Q_O agenda block in
// the prep brief. Interim values from #128 and legacy values stay
// readable; see intake_catalog.test.js for those pins.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { normalizeContactFields } from "../src/normalize.js";
import { INTAKE_CATALOG } from "../src/intake_catalog.js";
import { buildPrepBriefUserPrompt, buildPrepBriefSystemPrompt, findCallAgendaAnswer } from "../src/bga_copilot/prep_brief.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_SRC = resolve(HERE, "..", "..", "app", "src");
const readApp = (p) => readFileSync(resolve(APP_SRC, p), "utf8");
const indexSrc = readFileSync(resolve(HERE, "..", "src", "index.js"), "utf8");

const Q4_ID = "OyQjw4nGNHJYADsq5ggg";
function normQ4(value) {
  const n = normalizeContactFields(
    { customFields: [{ id: Q4_ID, value }] },
    { catalog: { [Q4_ID]: { name: "Q4", fieldKey: "contact.active_debt", dataType: "SINGLE_OPTIONS" } } },
  );
  return n.find((e) => e.source_field_id === Q4_ID)?.normalized_value;
}

describe("Free Q4 — approved six-state set", () => {
  const src = readApp("data/freeAssessmentQuestions.ts");
  const OPTIONS = [
    ["none", "No active business debt, tax liens, or judgments"],
    ["debt_current_manageable", "Business debt only — current and manageable"],
    ["debt_stretched_or_reworking", "Business debt only — stretched or actively being reworked"],
    ["active_tax_lien_or_judgment", "Active tax lien or judgment"],
    ["debt_plus_tax_lien_or_judgment", "Both business debt and an active tax lien or judgment"],
    ["not_sure", "Not sure"],
  ];

  it("TS carries the approved title, question and six value/label pairs", () => {
    assert.match(src, /title: "Debt \/ Tax Lien \/ Judgment Status"/);
    assert.match(src, /Which best describes your current situation with business debt, tax liens, or judgments\?/);
    for (const [v, l] of OPTIONS) {
      assert.ok(src.includes(`value: "${v}"`), `missing value ${v}`);
      assert.ok(src.includes(`label: "${l}"`), `missing label ${l}`);
    }
  });

  it("each slug and its label classify identically (round-trip)", () => {
    for (const [v, l] of OPTIONS) {
      assert.deepEqual(normQ4(l), normQ4(v), `label/slug mismatch for ${v}`);
    }
  });

  it("none label is a clean denial despite mentioning liens/judgments", () => {
    assert.deepEqual(normQ4("No active business debt, tax liens, or judgments"),
      { subtypes: [], judgments_or_liens: false });
  });

  it("debt-only states never imply tax or legal distress", () => {
    for (const v of ["debt_current_manageable", "debt_stretched_or_reworking"]) {
      const n = normQ4(v);
      assert.equal(n.judgments_or_liens, false);
      assert.ok(!n.subtypes.includes("tax_debt") && !n.subtypes.includes("judgment"));
    }
    assert.deepEqual(normQ4("debt_stretched_or_reworking").subtypes, ["stretched_debt"]);
  });

  it("lien/judgment states set the compound flag without claiming which one", () => {
    for (const v of ["active_tax_lien_or_judgment", "debt_plus_tax_lien_or_judgment"]) {
      const n = normQ4(v);
      assert.equal(n.judgments_or_liens, true);
      assert.ok(!n.subtypes.includes("tax_debt") && !n.subtypes.includes("judgment"));
    }
  });

  it("legacy yes/no/not-sure stay safe", () => {
    assert.deepEqual(normQ4("no"), normQ4("none"));
    assert.deepEqual(normQ4("not-sure"), normQ4("not_sure"));
    const yes = normQ4("yes");
    assert.equal(yes.judgments_or_liens, "unknown");
    assert.deepEqual(yes.subtypes, []);
  });

  it("rubric documents all six slugs and the legacy mapping", () => {
    for (const [v] of OPTIONS) assert.ok(indexSrc.includes(`\\\`${v}\\\``), `rubric missing ${v}`);
    assert.match(indexSrc, /legacy broad signal only/);
  });
});

describe("$47 — Annual Revenue, Q19, Q23", () => {
  const src = readApp("data/paidTier47Questions.ts");

  it("annual_revenue is optional, labelled, with the approved helper", () => {
    const line = src.split("\n").find((l) => l.includes('id: "annual_revenue"'));
    assert.ok(line && line.includes("Trailing 12-Month Revenue"));
    assert.ok(!line.includes("required: true"));
    assert.match(src, /Approximately how much revenue did your business generate over the last 12 months\?/);
    assert.match(src, /If the business is newer than 12 months, enter revenue to date\./);
  });

  it("rubric treats missing revenue as unknown, never invented", () => {
    assert.match(indexSrc, /revenue is UNKNOWN: do NOT invent a revenue figure/);
  });

  it("Q19 carries the approved title, question and six values", () => {
    assert.match(src, /title: "Monthly Close \/ Book Reconciliation Status"/);
    assert.match(src, /How current and reconciled are your books today\?/);
    for (const v of ["current_reconciled_monthly", "current_reconciliation_unclear", "one_month_behind",
      "two_three_months_behind", "more_than_three_months_behind", "not_sure"]) {
      assert.ok(src.includes(`value: "${v}"`), v);
      assert.ok(indexSrc.includes(v), `rubric missing ${v}`);
    }
  });

  it("Q23 carries the approved title, question and five values", () => {
    assert.match(src, /title: "Operating Cash Runway"/);
    assert.match(src, /cover payroll and fixed operating obligations if revenue or collections slowed materially — without taking on new debt\?/);
    for (const v of ["under_30_days", "one_two_months", "three_six_months", "over_six_months"]) {
      assert.ok(src.includes(`value: "${v}"`), v);
      assert.ok(indexSrc.includes(v), `rubric missing ${v}`);
    }
  });

  it("no customer-facing audit / deep-dive wording remains in Q19", () => {
    assert.doesNotMatch(src, /formal financial audit/);
    assert.doesNotMatch(src, /deep dive conducted/i);
  });
});

describe("BGA — approved copy", () => {
  const src = readApp("data/paidTier297Questions.ts");

  it("section names drop Deep Dive and use the approved names", () => {
    assert.doesNotMatch(src, /section: "[^"]*Deep Dive/);
    for (const n of ["Financial Performance", "Cash & Debt", "Operations & Constraints", "Growth & Risk"]) {
      assert.ok(src.includes(`section: "${n}"`), n);
    }
    assert.doesNotMatch(src, /Operations & Weaknesses|Growth & Threats/);
  });

  it("Q_C / Q_G / Q_J / Q_O titles and questions", () => {
    assert.match(src, /title: "Unit Economics You Track"/);
    assert.match(src, /contribution margin, or others — and what are the current numbers\?/);
    assert.match(src, /Do not guess\./);
    assert.match(src, /title: "Close Rate by Sales Stage"/);
    assert.match(src, /lead → qualified → proposal → closed/);
    assert.match(src, /title: "Customer Concentration"/);
    assert.match(src, /your largest client and from your top three clients combined\?/);
    assert.match(src, /title: "Decisions to Work Through on Your BGA Call"/);
    assert.match(src, /What are the 2–3 financial or growth decisions you most want clarity on during your 50-minute Business Growth Analysis session\?/);
  });

  it("technical keys are unchanged", () => {
    for (const k of ["qc_unit_economics", "qg_close_rate_by_stage", "qj_top_10_concentration", "qo_focus_areas"]) {
      assert.ok(src.includes(`id: "${k}"`), k);
    }
  });

  it("Q_J 'Not applicable' is explicit — not 0%, not missing", () => {
    assert.match(indexSrc, /NOT the same as 0% concentration and NOT missing data/);
  });

  it("Lab catalog mirrors the new BGA + $47 question text", () => {
    const strip = (s) => s.replace(/\\"/g, '"');
    const all = strip(src) + strip(readApp("data/paidTier47Questions.ts")) + strip(readApp("data/freeAssessmentQuestions.ts"));
    for (const tier of ["free", "paid_47", "paid_297"]) {
      for (const q of INTAKE_CATALOG[tier]) assert.ok(all.includes(q.text), `${tier} ${q.key} drifted`);
    }
  });
});

describe("Prep Me For The Call — Q_O agenda surfaced first", () => {
  const draft = "## Section 1\nx";
  it("finds Q_O by the legacy HL fieldKey and puts it before the draft", () => {
    const answers = [
      { fieldKey: "other", label: "Other", value: "noise" },
      { fieldKey: "anything_youd_like_to_focus_on_on_our_call_or_our_research",
        label: "Decisions to Work Through on Your BGA Call", value: "Hire a controller? Refinance the LOC?" },
    ];
    const u = buildPrepBriefUserPrompt({ contactId: "c", intake: { paid_297_answers: answers } }, { draft });
    const agendaAt = u.indexOf("CLIENT'S DECLARED CALL AGENDA");
    assert.ok(agendaAt >= 0);
    assert.ok(agendaAt < u.indexOf("Current Draft Roadmap"));
    assert.ok(u.indexOf("Refinance the LOC") < u.indexOf("Current Draft Roadmap"));
  });
  it("matches by renamed label too, and says so when absent", () => {
    assert.ok(findCallAgendaAnswer([{ fieldKey: "x", label: "Decisions to Work Through on Your BGA Call", value: "a" }]));
    const u = buildPrepBriefUserPrompt({ contactId: "c", intake: { paid_297_answers: [] } }, { draft });
    assert.match(u, /no call agenda provided/);
  });
  it("system prompt makes Section 9 address the declared agenda", () => {
    assert.match(buildPrepBriefSystemPrompt(), /Section 9 \("Decisions the call needs to produce"\) MUST address each declared decision/);
  });
});
