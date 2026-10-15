// Data definitions for the $47 Full Diagnostic tier.
// 6 business-info fields + 17 financial-diagnostic questions (Q12–Q28).
// Each question's `id` is an internal key (Vibe state). `text` is what goes
// to the worker. `options` are translated value→label by assessment.ts.

export interface QuestionOption {
  value: string;
  label: string;
}

export interface BusinessInfoField {
  id: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}

export interface PaidTier47Question {
  id: string;
  qNumber: string;
  section: string;
  title: string;
  text: string;
  type: "dollar" | "select" | "checkbox-group" | "textarea";
  placeholder?: string;
  options?: QuestionOption[];
  groupOptions?: QuestionOption[];
  required?: boolean;
}

export const PAID_TIER_47_BUSINESS_INFO: BusinessInfoField[] = [
  { id: "organization",    label: "Business Name",                placeholder: "Acme Marketing Inc.", required: true },
  { id: "website",         label: "Website",                      placeholder: "acmemarketing.com" },
  { id: "industry",        label: "Industry / Vertical",          placeholder: "Marketing Services" },
  { id: "city",            label: "City",                         placeholder: "Austin" },
  { id: "state",           label: "State",                        placeholder: "TX" },
  { id: "country",         label: "Country",                      placeholder: "US" },
  // Reuses the existing BGA Annual Revenue HL custom field
  // (contact.annual_revenue). The $47 diagnostic now anchors
  // every ratio on this number instead of leaving Solomon to
  // guess at scale from narrative. Backfilled on existing
  // contacts by the BGA intake; new paid_47 buyers populate it
  // here on first run.
  { id: "annual_revenue",  label: "Trailing 12-Month Revenue",    placeholder: "$2,400,000 (or your best estimate)" },
];

export const PAID_TIER_47_QUESTIONS: PaidTier47Question[] = [
  // ─── DEBT ANALYSIS ──────────────────────────────────────
  {
    id: "q12_total_corporate_debt",
    qNumber: "Q12",
    section: "Debt Analysis",
    title: "Total Corporate Debt Balance",
    text: "What is the total balance of your current corporate debt — across all loans, lines of credit, and outstanding obligations?",
    type: "dollar",
    placeholder: "$125,000 or 0",
  },
  {
    id: "q13_monthly_debt_service",
    qNumber: "Q13",
    section: "Debt Analysis",
    title: "Monthly Debt Service",
    text: "How much do you pay every month servicing your corporate debt?",
    type: "dollar",
    placeholder: "$3,500 or 0",
  },

  // ─── FINANCIAL FRAMEWORK ────────────────────────────────
  {
    id: "q14_decision_framework",
    qNumber: "Q14",
    section: "Financial Framework",
    title: "Financial Decision-Making Framework",
    text: "How do you typically make major financial decisions in your business?",
    type: "select",
    options: [
      { value: "documented",   label: "Documented framework — we measure against budget, forecast, and strategy" },
      { value: "advisor",      label: "With input from accountant or advisor on the bigger calls" },
      { value: "gut-numbers",  label: "Mix of gut and reviewing recent financials" },
      { value: "bank-balance", label: "Mostly based on what's in the bank account" },
    ],
  },
  {
    id: "q15_banking_relationship",
    qNumber: "Q15",
    section: "Financial Framework",
    title: "Banking Relationship Status",
    text: "How would you describe your current banking relationship?",
    type: "select",
    options: [
      { value: "named-banker",      label: "We have a named banker who knows the business" },
      { value: "branch-level",      label: "Branch-level relationship — no specific banker" },
      { value: "transactional",     label: "Purely transactional — we just use the accounts" },
      { value: "multiple-banks",    label: "Multiple banks, no single primary relationship" },
    ],
  },
  {
    id: "q16_credit_access_history",
    qNumber: "Q16",
    section: "Financial Framework",
    title: "Credit Access History",
    text: "What is your business's recent history with accessing credit or financing?",
    type: "select",
    options: [
      { value: "approved-needs",    label: "Approved for everything we've needed" },
      { value: "approved-some",     label: "Some approvals, some declines or smaller-than-asked-for amounts" },
      { value: "declined-recently", label: "Declined for credit in the last 12 months" },
      { value: "never-applied",     label: "We haven't applied for business credit" },
    ],
  },

  // ─── CASH FLOW + AR ─────────────────────────────────────
  {
    id: "q17_cash_flow_predictability",
    qNumber: "Q17",
    section: "Cash Flow",
    title: "Cash Flow Predictability",
    text: "How predictable is your monthly cash flow?",
    type: "select",
    options: [
      { value: "very-predictable",     label: "Very predictable — I know within 5% what will hit the account" },
      { value: "mostly-predictable",   label: "Mostly predictable but surprises happen" },
      { value: "frequently-surprised", label: "Frequently surprised by what's coming in or out" },
      { value: "always-reactive",      label: "I'm always reacting — there's no forecast" },
    ],
  },
  {
    id: "q18_ar_management",
    qNumber: "Q18",
    section: "Cash Flow",
    title: "Accounts Receivable Management",
    text: "How do you currently manage accounts receivable and collections?",
    type: "select",
    options: [
      { value: "tracked-active",  label: "Tracked weekly with an active collections process" },
      { value: "tracked-passive", label: "Tracked but no proactive collections" },
      { value: "occasional",      label: "I look when something feels off" },
      { value: "not-tracked",     label: "Not formally tracked" },
    ],
  },

  // ─── REPORTING + AUDIT ──────────────────────────────────
  {
    // Replaces q19_audit_history with a new concept: whether the owner
    // actually closes the books every month. This is a far better
    // discriminator of financial-visibility maturity than "have you
    // ever had an audit" (which almost nobody at this stage has had).
    //
    // The legacy q19_audit_history key is NOT deleted — historical
    // paid_47 submissions still carry that key and will continue to
    // render through the fallback path in the Worker prompt. See the
    // explicit guard in buildPrompt() around q19_* keys so an old
    // "within-2" value is never silently reinterpreted as the new
    // monthly-close vocabulary.
    id: "q19_monthly_close_status",
    qNumber: "Q19",
    section: "Reporting & Audit",
    title: "Monthly Close Status",
    text: "How consistently do you close your books every month — meaning your P&L, balance sheet, and cash figures are reconciled and finalized?",
    type: "select",
    options: [
      { value: "monthly-timely",    label: "Yes — closed every month, finalized within ~15 days of month-end" },
      { value: "monthly-slow",      label: "Yes — closed monthly but typically 30+ days behind" },
      { value: "quarterly-or-tax",  label: "No — books get closed quarterly, or only at tax time" },
      { value: "no-close",          label: "No — there's no formal month-end close process" },
    ],
  },
  {
    id: "q20_break_even",
    qNumber: "Q20",
    section: "Reporting & Audit",
    title: "Break-Even Analysis Capability",
    text: "Can you state your monthly break-even number right now?",
    type: "select",
    options: [
      { value: "yes-monitored",  label: "Yes — and I monitor it monthly" },
      { value: "yes-rough",      label: "Yes — roughly, but it's not tracked actively" },
      { value: "no-calculated",  label: "No — I've never calculated it" },
      { value: "no-confused",    label: "I'm not sure what that means in my business" },
    ],
  },
  {
    id: "q21_profit_margin_awareness",
    qNumber: "Q21",
    section: "Reporting & Audit",
    title: "Profit Margin Awareness",
    text: "Do you know your profit margins by product, service, or client segment?",
    type: "select",
    options: [
      { value: "by-segment",       label: "Yes — by segment, tracked regularly" },
      { value: "overall-only",     label: "Overall margin only, not broken down" },
      { value: "rough-sense",      label: "Rough sense — not formally calculated" },
      { value: "no-margin",        label: "No — I don't know my margins" },
    ],
  },

  // ─── GROWTH + RISK ──────────────────────────────────────
  {
    id: "q22_growth_capital",
    qNumber: "Q22",
    section: "Growth & Risk",
    title: "Growth Capital Assessment",
    text: "Do you have the capital you'd need to fund the next 12 months of growth as you'd plan it?",
    type: "select",
    options: [
      { value: "fully-funded",     label: "Yes — fully funded internally or via existing credit" },
      { value: "partially-funded", label: "Partially — would need additional capital for the full plan" },
      { value: "need-funding",     label: "No — growth depends on securing new capital" },
      { value: "no-plan",          label: "I don't have a defined 12-month growth plan" },
    ],
  },
  {
    // Replaces q23_risk_management with a new concept: how many months
    // of operating expenses the business could cover from cash on
    // hand. Operating runway is a direct, actionable number that
    // drives the whole rehab/needs-attention/growth classification
    // for a diagnostic buyer; "risk-management framework" was too
    // abstract and rarely moved the diagnosis one way or the other.
    //
    // The legacy q23_risk_management key is NOT deleted — historical
    // paid_47 submissions still carry it. The Worker prompt rubric
    // explicitly guards against mapping any old "comprehensive" /
    // "insurance-only" / "informal" / "none" value onto the new
    // runway vocabulary. See buildPrompt() in worker/src/index.js.
    id: "q23_operating_runway",
    qNumber: "Q23",
    section: "Growth & Risk",
    title: "Operating Runway",
    text: "If revenue stopped tomorrow, how many months of operating expenses could you cover from cash on hand (not including a line of credit)?",
    type: "select",
    options: [
      { value: "six-plus-months",   label: "6+ months of operating expenses covered" },
      { value: "three-to-six",      label: "3–6 months" },
      { value: "one-to-three",      label: "1–3 months" },
      { value: "less-than-one",     label: "Less than one month" },
      { value: "unknown",           label: "Not sure" },
    ],
  },

  // ─── VENDOR + TAX ───────────────────────────────────────
  {
    id: "q24_vendor_cost_analysis",
    qNumber: "Q24",
    section: "Vendor & Tax",
    title: "Vendor Cost Analysis",
    text: "When did you last review your major vendor and supplier costs for value and competitiveness?",
    type: "select",
    options: [
      { value: "last-6-months",  label: "Within the last 6 months" },
      { value: "last-12-months", label: "Within the last 12 months" },
      { value: "1-3-years",      label: "Between 1 and 3 years ago" },
      { value: "never",          label: "Never done formally" },
    ],
  },
  {
    id: "q25_tax_compliance",
    qNumber: "Q25",
    section: "Vendor & Tax",
    title: "Tax Compliance Status",
    text: "What is the status of your business tax returns for the last two years — are they filed and current?",
    type: "select",
    options: [
      { value: "filed-current",     label: "Filed and current — no issues" },
      { value: "filed-balance",     label: "Filed but there's an outstanding balance or payment plan" },
      { value: "not-filed",         label: "One or both years are not yet filed" },
      { value: "working-accountant",label: "Working through it with an accountant" },
    ],
  },

  // ─── ADVISORY + REPORTING ───────────────────────────────
  {
    id: "q26_advisory_support",
    qNumber: "Q26",
    section: "Advisory & Reporting",
    title: "Advisory Support Structure",
    text: "Who do you currently lean on for financial strategy?",
    type: "select",
    options: [
      { value: "cfo-fractional", label: "Fractional CFO or financial strategist on retainer" },
      { value: "cpa-strategic",  label: "CPA who advises beyond just tax prep" },
      { value: "cpa-tax-only",   label: "CPA for tax prep only" },
      { value: "self-only",      label: "Just me — no outside financial advisor" },
    ],
  },
  {
    id: "q27_reporting_frequency",
    qNumber: "Q27",
    section: "Advisory & Reporting",
    title: "Financial Reporting Frequency",
    text: "How often do you review your business's financial reports (P&L, balance sheet, cash flow)?",
    type: "select",
    options: [
      { value: "weekly",    label: "Weekly" },
      { value: "monthly",   label: "Monthly" },
      { value: "quarterly", label: "Quarterly" },
      { value: "annually",  label: "Annually or only at tax time" },
      { value: "rarely",    label: "Rarely or never" },
    ],
  },

  // ─── OBJECTIVES (free text) ─────────────────────────────
  {
    id: "q28_twelve_month_objectives",
    qNumber: "Q28",
    section: "Objectives",
    title: "12-Month Financial Objectives",
    text: "What are the financial objectives you most want to hit in the next 12 months? Be specific — revenue, profit, debt, hiring, exit, anything.",
    type: "textarea",
    placeholder: "Hit $2.5M revenue, pay down 50% of debt, hire a COO, build 90-day cash buffer…",
  },
];

/** Group questions by section for sectioned UI rendering. */
export function getPaid47Sections() {
  const sections: { name: string; questions: PaidTier47Question[] }[] = [];
  for (const q of PAID_TIER_47_QUESTIONS) {
    let sec = sections.find(s => s.name === q.section);
    if (!sec) { sec = { name: q.section, questions: [] }; sections.push(sec); }
    sec.questions.push(q);
  }
  return sections;
}

