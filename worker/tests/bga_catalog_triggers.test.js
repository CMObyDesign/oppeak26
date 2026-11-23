// New triggers, catalog v1 entries, and the 90-day plan link in Section 7 (Nov 22, 2026).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CANONICAL_SIGNALS, CANONICAL_DISQUALIFIERS, intakeToSignals, verifiedFinancialsToSignals } from "../src/bga_copilot/signals.js";
import { matchServices, formatSection7Body, planLineFor, SERVICE_PLAN_WORDS } from "../src/bga_copilot/match_services.js";

const catalog = JSON.parse(readFileSync(new URL("../data/service_catalog.json", import.meta.url), "utf8"));
const ans = (value) => [{ label: "Answer", value }];

describe("service catalog v1", () => {
  it("validates: canonical signals only, no blockers, deliverables, no prices, ids are HL Service Line keys", () => {
    const HL = new Set(["accounting_tax", "credit_repair", "debt_management", "consulting_planning", "risk_management", "marketing", "nonprofit_services", "merchant_services", "capital", "coaching"]);
    for (const c of catalog) {
      assert.ok(HL.has(c.service_id), c.service_id);
      assert.ok(c.signals_relevant.length && c.signals_relevant.every((x) => CANONICAL_SIGNALS.includes(x)), c.service_id);
      assert.deepEqual(c.when_not_to_recommend, [], c.service_id);
      assert.ok(c.deliverables.length, c.service_id);
      assert.equal(c.pricing.amount_usd, 0);
      assert.ok(!/\$\d/.test(JSON.stringify(c)), `no dollar amounts in ${c.service_id}`);
      assert.ok(!CANONICAL_DISQUALIFIERS.some((d) => c.signals_relevant.includes(d)));
    }
    assert.ok(SERVICE_PLAN_WORDS && catalog.every((c) => SERVICE_PLAN_WORDS[c.service_id]), "every service has plan words");
  });

  it("every service can now be recommended by some signal", () => {
    for (const c of catalog) {
      const m = matchServices({ activeSignals: [c.signals_relevant[0]], activeDisqualifiers: [], catalog });
      assert.ok(m.included.some((x) => x.service_id === c.service_id), c.service_id);
    }
  });
});

describe("new trigger detectors", () => {
  it("fire on clear intake answers", () => {
    const cases = [
      ["Both partners have poor credit and the bank turned us down.", "personal_credit_blocks_funding"],
      ["We don't have business credit yet.", "business_credit_absent"],
      ["We have multiple merchant cash advance payments every day.", "stacked_short_term_debt"],
      ["Two years of tax returns are unfiled.", "unfiled_or_owed_tax_years"],
      ["We accept credit card payments and the fees are high.", "takes_electronic_payments"],
      ["No website, everything is word of mouth marketing.", "weak_online_presence"],
      ["Our 501(c)(3) status lapsed and we need grants.", "nonprofit_status_or_grant_need"],
      ["Not sure our insurance coverage fits anymore.", "coverage_review_due"],
    ];
    for (const [text, slug] of cases) assert.ok(intakeToSignals(ans(text)).signals.includes(slug), `${slug} from "${text}"`);
  });

  it("stay quiet on healthy or unrelated answers", () => {
    const quiet = ["Our credit is excellent.", "We process orders the same day.", "Taxes are filed and current.", "Product returns are low.", "We lowered costs."];
    for (const text of quiet) {
      const got = intakeToSignals(ans(text)).signals.filter((x) => ["personal_credit_blocks_funding", "takes_electronic_payments", "unfiled_or_owed_tax_years"].includes(x));
      assert.deepEqual(got, [], text);
    }
  });

  it("tax status behind means catch-up tax", () => {
    assert.ok(verifiedFinancialsToSignals([{ metric_id: "tax_status", value: "behind" }]).signals.includes("unfiled_or_owed_tax_years"));
    assert.ok(!verifiedFinancialsToSignals([{ metric_id: "tax_status", value: "current" }]).signals.includes("unfiled_or_owed_tax_years"));
  });
});

describe("Section 7 points each service at the plan", () => {
  const plan = {
    4: "- Close the bridge loan and set up the line of credit [VF: cash = 1, period=x, source=y]\n- Set up per project budgets in the books\n- Stop the daily cash advance payments",
    5: "- Hire a project manager once margins hold",
    6: "- Reach the revenue goal",
  };
  it("finds the 90-day step first, then the goal, with tags removed", () => {
    assert.deepEqual(planLineFor("capital", plan), { where: "90-day plan", line: "Close the bridge loan and set up the line of credit" });
    assert.equal(planLineFor("accounting_tax", plan).line, "Set up per project budgets in the books");
    assert.deepEqual(planLineFor("coaching", plan), { where: "6-month direction", line: "Hire a project manager once margins hold" });
    assert.equal(planLineFor("nonprofit_services", plan), null);
  });

  it("writes a Supports line, or says it isn't tied yet", () => {
    const m = matchServices({ activeSignals: ["growth_capital_question", "nonprofit_status_or_grant_need"], activeDisqualifiers: [], catalog });
    const body = formatSection7Body(m, { planSections: plan });
    assert.match(body, /Supports the 90-day plan: Close the bridge loan/);
    assert.match(body, /Not yet tied to a 90-day step or goal/);
    assert.doesNotMatch(formatSection7Body(m, {}), /Supports the/);
  });
});
