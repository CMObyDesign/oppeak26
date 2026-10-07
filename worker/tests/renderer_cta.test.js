// Renderer CTA copy + funnel-order pinning.
//
// buildReportPage is the primary customer-facing surface where the
// product ladder either reads coherently or doesn't. These tests
// freeze the copy and the CTA order so a future refactor can't
// silently drop them.
//
// Covers:
//   - Free CTA: "FROM SIGNALS TO THE FULL PICTURE" framing + the
//     new button + microcopy ("Includes your live strategist review").
//     No more "shows what's wrong" / "build the intervention" /
//     "No follow-up sales calls" language.
//   - Paid_47 CTA: strategic reversal — the INCLUDED strategist
//     review (bookingLink47) is the PRIMARY button. The Business
//     Health Analysis link is subordinated below a divider as a
//     secondary. Headline uses "decide what deserves action first,"
//     not "build the intervention."
//   - Paid_297 CTA: still the terminal booking surface.
//   - Per-tier page header: three distinct eyebrows + hellos so the
//     product ladder reads intentionally.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildReportPage } from "../src/index.js";

const PAYMENT_LINK_47 = "https://example.com/pay-47";
const PAYMENT_LINK_297 = "https://example.com/pay-297";
const BOOKING_LINK_47 = "https://example.com/book-47";
const BOOKING_LINK_297 = "https://example.com/book-297";

const baseEnv = {
  PAYMENT_LINK_47, PAYMENT_LINK_297,
  BOOKING_LINK_47, BOOKING_LINK_297,
  // UPGRADE_47_URL left unset — exercises the production path, not
  // the beta-coupon bypass.
};

async function render(tier, opts = {}) {
  return await buildReportPage(
    "<div>report body</div>",
    tier === "free" ? "Free" : tier === "paid_47" ? "$47" : "$297",
    "Liz Smith",
    tier,
    baseEnv,
    "liz@example.com",
    "contact_123",
    opts,
  );
}

// --- Free-tier CTA --------------------------------------------------

describe("Free-tier CTA — new framing + copy", () => {
  it("uses 'FROM SIGNALS TO THE FULL PICTURE' eyebrow", async () => {
    const html = await render("free");
    assert.match(html, /FROM SIGNALS TO THE FULL PICTURE/);
  });

  it("headline anchors on 'what deserves attention / what's actually driving it'", async () => {
    const html = await render("free");
    assert.match(html, /You know what deserves attention/);
    assert.match(html, /Now find out what's actually driving it/);
  });

  it("does NOT use the adversarial 'shows what's wrong' framing", async () => {
    const html = await render("free");
    assert.doesNotMatch(html, /shows what's wrong/i);
    assert.doesNotMatch(html, /shows what to do about it/i);
  });

  it("value prop names synthesis axes + strategist review", async () => {
    const html = await render("free");
    assert.match(html, /cash flow, debt, profitability, receivables, financial visibility, and growth capacity/);
    assert.match(html, /live 30-minute strategist review/);
    // No volume-selling pages count.
    assert.doesNotMatch(html, /8[–\-]12 page/);
  });

  it("button says 'Get My Full Diagnostic + Strategy Review — $47'", async () => {
    const html = await render("free");
    assert.match(html, /Get My Full Diagnostic \+ Strategy Review/);
    assert.doesNotMatch(html, /Upgrade to Full Diagnostic/);
  });

  it("microcopy includes 'Includes your live strategist review' and drops defensive clause", async () => {
    const html = await render("free");
    assert.match(html, /One-time payment · No subscription · Includes your live strategist review/);
    assert.doesNotMatch(html, /No follow-up sales calls/);
  });

  it("button href still points at the payment link (not the booking)", async () => {
    const html = await render("free");
    assert.ok(html.includes(`href="${PAYMENT_LINK_47}"`), "primary button goes to payment");
  });
});

// --- Paid_47 CTA (strategic reversal) ----------------------------

describe("Paid_47 CTA — included review is PRIMARY, Business Health Analysis is SECONDARY", () => {
  it("eyebrow and headline frame the included review as the next step", async () => {
    const html = await render("paid_47");
    assert.match(html, /◆ YOUR NEXT STEP · INCLUDED/);
    assert.match(html, /LIVE STRATEGIST REVIEW/);
    assert.match(html, /You have the findings/);
    assert.match(html, /Now let's decide what deserves action first/);
  });

  it("replaces 'build the intervention' crisis language", async () => {
    const html = await render("paid_47");
    assert.doesNotMatch(html, /build the intervention/i);
  });

  it("the primary button books the included strategist review", async () => {
    const html = await render("paid_47");
    // The primary (btn-primary) must point at BOOKING_LINK_47, not the
    // $297 sales page — this is the whole point of the reversal.
    const primary = html.match(/<a[^>]*class="btn btn-primary"[^>]*>[\s\S]*?<\/a>/);
    assert.ok(primary, "paid_47 must have a primary button");
    assert.ok(primary[0].includes(`href="${BOOKING_LINK_47}"`),
      `paid_47 primary should link to BOOKING_LINK_47 (${BOOKING_LINK_47}), got: ${primary[0]}`);
    assert.match(primary[0], /Book My Included Strategy Review/);
  });

  it("the Business Growth Analysis link is a secondary, subordinated below a divider", async () => {
    const html = await render("paid_47");
    const secondary = html.match(/<a[^>]*class="btn btn-secondary"[^>]*>[\s\S]*?<\/a>/);
    assert.ok(secondary, "paid_47 must have a secondary button for the $297 upsell");
    assert.match(secondary[0], /Explore the Business Growth Analysis/);
    // The $297 product is "Business Growth Analysis" (BGA) per the brand
    // doc — not "Business Health Analysis," which was the pre-brand-doc
    // naming. If this string regresses, the public ladder breaks:
    //   Free: Business Health Check
    //   $47:  Full Diagnostic
    //   $297: Business Growth Analysis
    assert.doesNotMatch(secondary[0], /Business Health Analysis/);
    // The subordinated block carries a 'Ready for a deeper team review' lead-in.
    assert.match(html, /Ready for a deeper team review and written 90-day plan/);
  });

  it("the primary button is NOT the $297 sales page (prevents re-regression)", async () => {
    const html = await render("paid_47");
    const primary = html.match(/<a[^>]*class="btn btn-primary"[^>]*>[\s\S]*?<\/a>/);
    assert.ok(!primary[0].includes("Keep the momentum"),
      "primary CTA must not be the Deep Dive sales page redirect");
  });
});

// --- Paid_297 CTA (unchanged) -----------------------------------

describe("Paid_297 CTA — terminal booking surface", () => {
  it("still embeds the 297 booking calendar", async () => {
    const html = await render("paid_297");
    assert.match(html, /FINAL STEP · BOOK YOUR DEEP DIVE/);
    assert.ok(html.includes(BOOKING_LINK_297), "297 tier embeds the 297 booking link");
  });
});

// --- Per-tier page headers --------------------------------------

describe("Per-tier page header — product ladder reads intentionally", () => {
  it("free tier uses 'YOUR BUSINESS HEALTH REPORT · READY' / 'assessment is back'", async () => {
    const html = await render("free");
    assert.match(html, /◆ YOUR BUSINESS HEALTH REPORT · READY/);
    assert.match(html, /your <em>assessment<\/em> is back/);
    // Free tier is deliberately NOT called a "diagnostic" in the header.
    assert.doesNotMatch(html.match(/<section class="hello">[\s\S]*?<\/section>/)[0], /your <em>diagnostic<\/em>/);
  });

  it("paid_47 uses 'YOUR FULL DIAGNOSTIC · READY' / 'full financial picture'", async () => {
    const html = await render("paid_47");
    assert.match(html, /◆ YOUR FULL DIAGNOSTIC · READY/);
    assert.match(html, /your <em>full financial picture<\/em> is ready/);
  });

  it("paid_297 uses 'YOUR BUSINESS GROWTH ANALYSIS · READY' / 'analysis is ready for review'", async () => {
    const html = await render("paid_297");
    assert.match(html, /◆ YOUR BUSINESS GROWTH ANALYSIS · READY/);
    assert.match(html, /your <em>analysis<\/em> is ready for review/);
    // Pin the brand-doc canonical name.
    assert.doesNotMatch(html, /YOUR BUSINESS HEALTH ANALYSIS/);
  });

  it("pending state still shows the generating eyebrow regardless of tier", async () => {
    const html = await render("free", { isPending: true });
    assert.match(html, /SOLOMON IS DIAGNOSING · GENERATING YOUR REPORT/);
    assert.doesNotMatch(html, /BUSINESS HEALTH REPORT · READY/);
  });
});
