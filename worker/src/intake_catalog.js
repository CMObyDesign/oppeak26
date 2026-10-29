// Shared intake catalog — the Lab's Guided mode source of truth.
//
// Replaces the hand-maintained FREE_QUESTIONS / PAID_47_ADDITIONAL /
// PAID_297_ADDITIONAL arrays that used to live in console_page.js and
// drifted from the real production intake over time. The arrays below
// mirror the production TypeScript question definitions byte-for-byte;
// a regression test (worker/tests/intake_catalog.test.js) reads the
// TS source and fails loudly if any text here drifts from the real
// question wording the customer sees.
//
// Shape per entry:
//   { key: "Q4", text: "...", hint?: "..." }
// - key:  stable identifier used by Guided mode for labels + answer keys
// - text: the exact question text the customer sees in production
// - hint: optional short hint shown below the textarea (for selects, we
//         pack the option labels; for free text, we leave undefined)

export const INTAKE_CATALOG = Object.freeze({
  // ─── FREE HEALTH CHECK (Q1–Q11) ──────────────────────────────
  // Mirrors app/src/data/freeAssessmentQuestions.ts.
  free: Object.freeze([
    { key: "Q1",  text: "What best describes your business type?",
      hint: "Service-based / Product-based / Hybrid" },
    { key: "Q2",  text: "How do you primarily reach your customers?",
      hint: "Local presence / Statewide / Regional / National / E-commerce" },
    { key: "Q3",  text: "What industry or vertical best describes your business?",
      hint: "HVAC/Trades / Construction / Professional services / E-commerce / Other" },
    // Q4 moved from the six-state set to the 2026-10-29 eight-state
    // set — see DEBT / TAX / LEGAL STATUS MAPPING in index.js
    // ASSESSMENT_RUBRIC. Text + hints must stay in verbatim lockstep
    // with app/src/data/freeAssessmentQuestions.ts Q4.
    { key: "Q4",  text: "Which best describes your business's current debt, tax, and legal status?",
      hint: "No active debt/liens/judgments / Managed debt / Managed debt stretched / Tax lien or judgment / Both debt + lien / Unfiled returns / Outstanding tax balance / Not sure" },
    { key: "Q5",  text: "When you make business decisions, are you basing them on your actual numbers or on what is in your bank account?",
      hint: "Clean numbers / Bank balance / In between / Not sure" },
    { key: "Q6",  text: "What does your business consistently deliver that your clients say they cannot get anywhere else?" },
    { key: "Q7",  text: "When a client refers you, what specific words or outcome do they use to describe what you did for them?" },
    { key: "Q8",  text: "Where does revenue most often leak in your business?" },
    { key: "Q9",  text: "What would change in your business if you had 20% more profit on the same revenue?" },
    { key: "Q10", text: "Where do you see demand in your market that you are not yet positioned to capture?" },
    { key: "Q11", text: "What would happen to your business if your single largest client, revenue source, or referral channel disappeared in the next 90 days?" },
  ]),

  // ─── $47 FULL DIAGNOSTIC (Q12–Q28, additive to free) ─────────
  // Mirrors app/src/data/paidTier47Questions.ts. The business-info
  // fields (organization/website/industry/city/state/country +
  // annual_revenue) are collected on a separate first-page form in
  // the production intake; Guided mode's job is to feed the Worker
  // narrative question answers, so we only list the Q12-Q28 set here.
  paid_47: Object.freeze([
    { key: "Q12", text: "What is the total balance of your current corporate debt — across all loans, lines of credit, and outstanding obligations?",
      hint: "Approximate dollar amount" },
    { key: "Q13", text: "How much do you pay every month servicing your corporate debt?",
      hint: "Approximate monthly amount" },
    { key: "Q14", text: "How do you typically make major financial decisions in your business?",
      hint: "Documented framework / Advisor input / Gut + numbers / Bank balance" },
    { key: "Q15", text: "How would you describe your current banking relationship?",
      hint: "Named banker / Branch-level / Transactional / Multiple banks" },
    { key: "Q16", text: "What is your business's recent history with accessing credit or financing?",
      hint: "Approved / Mixed / Declined recently / Never applied" },
    { key: "Q17", text: "How predictable is your monthly cash flow?",
      hint: "Very / Mostly / Frequently surprised / Always reactive" },
    { key: "Q18", text: "How do you currently manage accounts receivable and collections?",
      hint: "Tracked active / Tracked passive / Occasional / Not tracked" },
    // Q19 and Q23 were replaced — see paidTier47Questions.ts for the
    // ASSESSMENT_RUBRIC Q19/Q23 discipline block that explains why
    // legacy historical values must never be reinterpreted as the
    // new concepts.
    { key: "Q19", text: "How consistently do you close your books every month — meaning your P&L, balance sheet, and cash figures are reconciled and finalized?",
      hint: "Monthly timely / Monthly slow / Quarterly or tax / No close" },
    { key: "Q20", text: "Can you state your monthly break-even number right now?",
      hint: "Yes monitored / Yes rough / No / Confused" },
    { key: "Q21", text: "Do you know your profit margins by product, service, or client segment?",
      hint: "By segment / Overall / Rough / No" },
    { key: "Q22", text: "Do you have the capital you'd need to fund the next 12 months of growth as you'd plan it?",
      hint: "Fully / Partially / Need funding / No plan" },
    { key: "Q23", text: "If revenue stopped tomorrow, how many months of operating expenses could you cover from cash on hand (not including a line of credit)?",
      hint: "6+ / 3-6 / 1-3 / <1 / Not sure" },
    { key: "Q24", text: "When did you last review your major vendor and supplier costs for value and competitiveness?",
      hint: "6 months / 12 months / 1-3 years / Never" },
    { key: "Q25", text: "What is the status of your business tax returns for the last two years — are they filed and current?",
      hint: "Filed current / Filed with balance / Not filed / Working with accountant" },
    { key: "Q26", text: "Who do you currently lean on for financial strategy?",
      hint: "Fractional CFO / CPA strategic / CPA tax only / Just me" },
    { key: "Q27", text: "How often do you review your business's financial reports (P&L, balance sheet, cash flow)?",
      hint: "Weekly / Monthly / Quarterly / Annually / Rarely" },
    { key: "Q28", text: "What are the financial objectives you most want to hit in the next 12 months? Be specific — revenue, profit, debt, hiring, exit, anything." },
  ]),

  // ─── $297 BGA INTAKE (Q_A–Q_O, additive to free + paid_47) ───
  // Mirrors app/src/data/paidTier297Questions.ts. Order follows the
  // production survey (Q_A..Q_L, Q_N, Q_M, Q_O) — Q_M and Q_O are
  // "The Bridge Question" section in the real UI, which runs AFTER
  // Growth & Threats (Q_N comes before Q_M in file order). Guided
  // mode preserves that ordering so the strategist's test runs match
  // what the customer actually filled.
  paid_297: Object.freeze([
    { key: "Q_A", text: "Walk through your top 3 client engagements or revenue wins in the last 12 months — what was the revenue, the margin, and what made each one work?" },
    { key: "Q_B", text: "What are your gross and net margins by product, service line, or client segment? Which is your most profitable, and which is costing you the most to deliver?" },
    { key: "Q_C", text: "Which unit economics do you actually track for your business today — e.g. CAC, LTV, payback period, gross margin per client — and what are the numbers?",
      hint: "Or answer 'Not tracked' — treated as a visibility gap, not a weakness." },
    { key: "Q_D", text: "What is your current cash position and runway — and how would three consecutive months of below-average revenue impact the business?" },
    { key: "Q_E", text: "Walk us through your current debt stack: total corporate debt, monthly debt service, and how comfortable you are with that level of leverage right now." },
    { key: "Q_F", text: "What does your accounts receivable aging look like in detail — total AR, amount 30+ days overdue, and amount 60+ days overdue?" },
    { key: "Q_G", text: "If you run a staged sales process, roughly what share of leads turn into qualified prospects, proposals, and closed clients — and where do you lose the most?",
      hint: "Optional. Or answer 'Not applicable' — not a weakness, just a different acquisition model." },
    { key: "Q_H", text: "What is the single biggest \"we should have fixed this years ago\" problem still on your list — and what has kept it there?" },
    { key: "Q_I", text: "If you had to cut 20% of your services, clients, or overhead tomorrow, what would go first — and why hasn't it gone already?" },
    { key: "Q_J", text: "If you track revenue by client, what share of total revenue comes from your top handful — and what would your business look like if the single largest left in the next 6 months?",
      hint: "Optional. Or answer 'Not applicable' if client-level revenue isn't meaningful." },
    { key: "Q_K", text: "What regulatory, tax, compliance, or technology changes on the horizon could materially impact how your business operates or gets paid?" },
    { key: "Q_L", text: "What geographic or vertical expansion has the lowest barrier to entry based on what you already do today — and what would it take to move on it?" },
    { key: "Q_N", text: "Who are your top 2–3 competitors right now, and what are they doing that you'd rather they weren't?" },
    { key: "Q_M", text: "What does success look like for your business three years from now — and what is the single biggest financial or operational obstacle standing between you and that picture today?" },
    { key: "Q_O", text: "What are the specific decisions you need to be able to make better after our BGA session? (Pricing, hiring, debt, growth bet, exit timing — anything you need the numbers to help you decide.)",
      hint: "Required in production — the single most important input for Miguel's call." },
  ]),
});

/**
 * Collect the tier-appropriate Guided question list. Returns a
 * flat array in display order:
 *   - free: INTAKE_CATALOG.free
 *   - paid_47: INTAKE_CATALOG.free + INTAKE_CATALOG.paid_47
 *   - paid_297: INTAKE_CATALOG.free + INTAKE_CATALOG.paid_47 + INTAKE_CATALOG.paid_297
 */
export function questionsForTier(tier) {
  if (tier === "paid_297") {
    return [...INTAKE_CATALOG.free, ...INTAKE_CATALOG.paid_47, ...INTAKE_CATALOG.paid_297];
  }
  if (tier === "paid_47") {
    return [...INTAKE_CATALOG.free, ...INTAKE_CATALOG.paid_47];
  }
  return [...INTAKE_CATALOG.free];
}
