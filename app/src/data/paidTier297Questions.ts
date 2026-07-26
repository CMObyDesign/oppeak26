export interface QuestionOption { value: string; label: string; }

export interface PaidTier297Question {
  id: string;
  qNumber: string;
  section: string;
  title: string;
  text: string;
  type: "text" | "textarea" | "file";
  placeholder?: string;
  options?: QuestionOption[];
  required?: boolean;
  acceptFileTypes?: string;
  multipleFiles?: boolean;
}

export const PAID_TIER_297_QUESTIONS: PaidTier297Question[] = [
  // ─── BUSINESS CONTEXT ─────────────────────────────────────
  {
    id: "annual_revenue", qNumber: "—", section: "Business Context",
    title: "Annual Revenue",
    text: "What is your business's current annual revenue?",
    type: "text", placeholder: "e.g. $1.8M, or your exact figure", required: true,
  },

  // ─── FINANCIAL PERFORMANCE — DEEP DIVE ────────────────────
  {
    id: "qa_top_engagements", qNumber: "Q_A",
    section: "Financial Performance — Deep Dive",
    title: "Top 3 Client Engagements (Last 12 Months)",
    text: "Walk through your top 3 client engagements or revenue wins in the last 12 months — what was the revenue, the margin, and what made each one work?",
    type: "textarea",
  },
  {
    id: "qb_margins_by_segment", qNumber: "Q_B",
    section: "Financial Performance — Deep Dive",
    title: "Margins by Product / Service Line / Segment",
    text: "What are your gross and net margins by product, service line, or client segment? Which is your most profitable, and which is costing you the most to deliver?",
    type: "textarea",
  },
  {
    id: "qc_unit_economics", qNumber: "Q_C",
    section: "Financial Performance — Deep Dive",
    title: "Unit Economics vs. Industry Benchmark",
    text: "How do your unit economics compare to what you believe is the benchmark for your industry — CAC, LTV, payback period, gross margin?",
    type: "textarea",
  },

  // ─── CASH & DEBT — DEEP DIVE ──────────────────────────────
  {
    id: "qd_cash_position", qNumber: "Q_D",
    section: "Cash & Debt — Deep Dive",
    title: "Cash Position & Runway",
    text: "What is your current cash position and runway — and how would three consecutive months of below-average revenue impact the business?",
    type: "textarea",
  },
  {
    id: "qe_debt_stack", qNumber: "Q_E",
    section: "Cash & Debt — Deep Dive",
    title: "Current Debt Stack",
    text: "Walk us through your current debt stack: total corporate debt, monthly debt service, and how comfortable you are with that level of leverage right now.",
    type: "textarea",
  },
  {
    id: "qf_ar_aging_detail", qNumber: "Q_F",
    section: "Cash & Debt — Deep Dive",
    title: "AR Aging in Detail",
    text: "What does your accounts receivable aging look like in detail — total AR, amount 30+ days overdue, and amount 60+ days overdue?",
    type: "textarea",
  },

  // ─── OPERATIONS & WEAKNESSES — DEEP DIVE ──────────────────
  {
    id: "qg_close_rate_by_stage", qNumber: "Q_G",
    section: "Operations & Weaknesses — Deep Dive",
    title: "Close Rate by Funnel Stage",
    text: "What is your close rate at each stage of your sales process — lead to qualified, qualified to proposal, proposal to closed — and where does it leak the most?",
    type: "textarea",
  },
  {
    id: "qh_biggest_unfixed_problem", qNumber: "Q_H",
    section: "Operations & Weaknesses — Deep Dive",
    title: "Biggest 'Should-Have-Fixed-Years-Ago' Problem",
    text: "What is the single biggest \"we should have fixed this years ago\" problem still on your list — and what has kept it there?",
    type: "textarea",
  },
  {
    id: "qi_cut_20_percent", qNumber: "Q_I",
    section: "Operations & Weaknesses — Deep Dive",
    title: "If You Cut 20% Tomorrow",
    text: "If you had to cut 20% of your services, clients, or overhead tomorrow, what would go first — and why hasn't it gone already?",
    type: "textarea",
  },

  // ─── GROWTH & THREATS — DEEP DIVE ─────────────────────────
  {
    id: "qj_top_10_concentration", qNumber: "Q_J",
    section: "Growth & Threats — Deep Dive",
    title: "Top 10% Client Concentration",
    text: "What percentage of your revenue comes from your top 10% of clients — and what is your realistic exposure if any of them left in the next 6 months?",
    type: "textarea",
  },
  {
    id: "qk_regulatory_changes", qNumber: "Q_K",
    section: "Growth & Threats — Deep Dive",
    title: "Regulatory / Tax / Compliance / Tech Changes",
    text: "What regulatory, tax, compliance, or technology changes on the horizon could materially impact how your business operates or gets paid?",
    type: "textarea",
  },
  {
    id: "ql_expansion_opportunities", qNumber: "Q_L",
    section: "Growth & Threats — Deep Dive",
    title: "Lowest-Barrier Expansion Opportunity",
    text: "What geographic or vertical expansion has the lowest barrier to entry based on what you already do today — and what would it take to move on it?",
    type: "textarea",
  },
  {
    id: "qn_top_competitors", qNumber: "Q_N",
    section: "Growth & Threats — Deep Dive",
    title: "Top 2–3 Competitors",
    text: "Who are your top 2–3 competitors right now, and what are they doing that you'd rather they weren't?",
    type: "textarea",
  },

  // ─── THE BRIDGE QUESTION ──────────────────────────────────
  {
    id: "qm_three_year_vision", qNumber: "Q_M",
    section: "The Bridge Question",
    title: "Three-Year Success Vision",
    text: "What does success look like for your business three years from now — and what is the single biggest financial or operational obstacle standing between you and that picture today?",
    type: "textarea",
  },
  {
    id: "qo_focus_areas", qNumber: "Q_O",
    section: "The Bridge Question",
    title: "Focus Areas for the Call",
    text: "Anything you'd like to focus on on our call or our research?",
    type: "textarea",
  },

  // ─── SUPPORTING DOCUMENTS (OPTIONAL) ──────────────────────
  {
    id: "supporting_documents", qNumber: "",
    section: "Supporting Documents (Optional)",
    title: "P&L and Balance Sheet (Optional)",
    text: "Upload your most recent P&L and/or balance sheet. These help us prepare a sharper Part 2 growth plan. Skip if you'd rather discuss them on the call.",
    type: "file",
    acceptFileTypes: ".pdf,.xls,.xlsx,.csv,.png,.jpg,.jpeg",
    multipleFiles: true,
  },
];

export function getPaid297Sections() {
  const sections: { name: string; questions: PaidTier297Question[] }[] = [];
  for (const q of PAID_TIER_297_QUESTIONS) {
    let sec = sections.find(s => s.name === q.section);
    if (!sec) { sec = { name: q.section, questions: [] }; sections.push(sec); }
    sec.questions.push(q);
  }
  return sections;
}

