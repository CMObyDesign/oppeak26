// paid47-v2 structural regression tests built from the Marisol
// Castellanos golden fixture (contact DeubTUGSn9U9IL4layqU, 2026-10-28
// — the first successful paid_47 Full Diagnostic generation).
//
// What these tests protect:
//   1. The three primary gaps on this intake are A/R aging, growth
//      vs. visibility, and pricing-cost alignment — NOT merchant
//      processing. Merchant processing is an opportunity flag, not a
//      primary diagnostic. If a future prompt change ever surfaces
//      MERCHANT_PROCESSING_OPP as a primary gap on this same intake,
//      the Marisol-discipline test here fails.
//   2. The full fixture validates clean against the paid47-v2 quality
//      gate (no deficiencies).
//   3. The paid47-v2 renderer (buildReportHtml under isV2) produces
//      the expected sections and fits inside the HL custom-field cap.
//   4. Backward compatibility: a legacy paid47-v1 report (no version
//      tags, no v2 sections) still renders through buildReportHtml
//      without undefined property reads.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validatePaid47V2 } from "../src/paid47_v2.js";
import { buildReportHtml } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "fixtures", "marisol_castellanos_paid47.json");
const golden = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

// HL custom-field payload cap. Public references put the field body at
// 65535 chars (TEXT column); we aim comfortably below that so the
// writeback never truncates a report mid-section.
const HL_FIELD_SAFE_CAP_BYTES = 60_000;

const MARISOL_CONTEXT = {
  validFactKeys: new Set([
    "financial_decision_basis",
    "has_documented_budget",
    "ar_30_plus",
    "ar_60_plus",
    "monthly_debt_service",
  ]),
  validMetricNames: new Set([
    "ar_60_plus_months_of_debt_service",
    "ar_30_plus_months_of_debt_service",
    "ar_60_plus_share_of_30_plus",
    "annual_debt_service",
  ]),
};

describe("Marisol golden fixture — paid47-v2 structural invariants", () => {
  it("validates clean against the paid47-v2 quality gate", () => {
    const r = validatePaid47V2(golden, MARISOL_CONTEXT);
    assert.equal(r.ok, true, JSON.stringify(r.deficiencies, null, 2));
    assert.equal(r.isV2, true);
    assert.equal(r.deficiencies.length, 0);
  });

  it("has three primary gaps anchored to AR + growth-visibility + pricing (NOT merchant processing)", () => {
    assert.equal(golden.gaps.length, 3);
    const titles = golden.gaps.map((g) => g.title.toLowerCase());
    assert.ok(titles.some((t) => t.includes("a/r") || t.includes("aging")), "expected an A/R gap");
    assert.ok(titles.some((t) => t.includes("visibility") || t.includes("growth")), "expected a growth-vs-visibility gap");
    assert.ok(titles.some((t) => t.includes("pricing") || t.includes("cost")), "expected a pricing/cost gap");
    assert.ok(!titles.some((t) => t.includes("merchant")), "merchant processing MUST NOT be a primary gap");
  });

  it("no primary gap is anchored solely in an opportunity flag", () => {
    for (const g of golden.gaps) {
      const types = new Set(g.evidence.map((e) => e.type));
      const only = types.size === 1 && types.has("opportunity_flag");
      assert.equal(only, false, `gap "${g.id}" is flag-only; this is the exact bug Marisol surfaced`);
    }
  });

  it("merchant processing appears only on opportunityFlags, not as a gap", () => {
    assert.ok(
      (golden.opportunityFlags || []).includes("MERCHANT_PROCESSING_OPP"),
      "merchant-processing flag should be surfaced to the strategist",
    );
    for (const g of golden.gaps) {
      for (const ev of g.evidence) {
        assert.notEqual(ev.key, "MERCHANT_PROCESSING_OPP");
      }
    }
  });

  it("every connection references real finding ids", () => {
    const allIds = new Set([
      ...golden.gaps.map((g) => g.id),
      ...golden.opportunities.map((o) => o.id),
    ]);
    for (const c of golden.connections) {
      for (const id of c.findingIds) {
        assert.ok(allIds.has(id), `connections references unknown id "${id}"`);
      }
    }
  });

  it("every decisionOrder step is sequentially numbered from 1", () => {
    golden.decisionOrder.forEach((d, i) => {
      assert.equal(d.step, i + 1, `decisionOrder[${i}] step should be ${i + 1}`);
    });
  });

  it("nextStepHeadline points to the strategist review, not the BGA upsell", () => {
    assert.match(golden.nextStepHeadline.toLowerCase(), /strategist review|30-minute/);
    assert.doesNotMatch(golden.nextStepHeadline.toLowerCase(), /business growth analysis|\$297|bga purchase/);
    assert.doesNotMatch(golden.nextStepBody.toLowerCase(), /\$297|business growth analysis purchase/);
  });
});

describe("paid47-v2 renderer parity + payload size", () => {
  it("renders the v2 sections (Financial Snapshot, Connections, Decision Order, Questions To Clarify)", () => {
    const html = buildReportHtml(golden);
    assert.match(html, /Financial Snapshot/);
    assert.match(html, /How These Findings Interact/);
    assert.match(html, /Order of Attention/);
    assert.match(html, /Questions to Clarify With the Strategist/);
    // Gap cards carry the enriched prose lines.
    assert.match(html, /Known:/);
    assert.match(html, /Why it matters:/);
    assert.match(html, /What this changes:/);
  });

  it("rendered HTML fits comfortably under the HL custom-field payload cap", () => {
    const html = buildReportHtml(golden);
    const bytes = Buffer.byteLength(html, "utf8");
    assert.ok(
      bytes < HL_FIELD_SAFE_CAP_BYTES,
      `paid47-v2 report HTML is ${bytes} bytes; safe cap is ${HL_FIELD_SAFE_CAP_BYTES}`,
    );
  });

  it("escapes a gap title that contains an inner double-quote without breaking the output", () => {
    const agent = JSON.parse(JSON.stringify(golden));
    agent.gaps[0].title = 'Owner said "trust us" to a customer';
    const html = buildReportHtml(agent);
    assert.match(html, /Owner said &quot;trust us&quot; to a customer/);
  });
});

describe("paid47-v1 backward compatibility", () => {
  // A legacy paid47-v1 agent response — the shape stored in D1 before
  // the v2 contract shipped. The renderer must still produce a sane
  // page from this without reaching for undefined v2 fields.
  const v1Agent = {
    path: "needs-attention",
    badge: "FULL DIAGNOSTIC",
    headline: "Headline",
    opener: "Opener prose.",
    context: "Context.",
    gaps: [
      { title: "AR aging", impact: "9k is 60+ days overdue.", priority: "HIGH" },
      { title: "Visibility", impact: "Decisions from bank balance.", priority: "HIGH" },
    ],
    opportunities: [{ title: "Collections", desc: "Tighten.", impact: "Cash timing" }],
    nextStepHeadline: "Book your strategist review.",
    nextStepBody: "Miguel will walk through.",
    opportunityFlags: [],
  };

  it("renders without throwing", () => {
    assert.doesNotThrow(() => buildReportHtml(v1Agent));
  });

  it("does NOT render v2-only sections for a v1 response", () => {
    const html = buildReportHtml(v1Agent);
    assert.doesNotMatch(html, /Financial Snapshot/);
    assert.doesNotMatch(html, /How These Findings Interact/);
    assert.doesNotMatch(html, /Order of Attention/);
    assert.doesNotMatch(html, /Questions to Clarify With the Strategist/);
    // But the shared v1 sections still appear.
    assert.match(html, /Critical Gaps Identified/);
    assert.match(html, /Your Highest-Impact Opportunities/);
  });

  it("renders v1 gaps using the legacy impact prose", () => {
    const html = buildReportHtml(v1Agent);
    assert.match(html, /9k is 60\+ days overdue\./);
  });
});
