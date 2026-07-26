export interface Question {
  id: number;
  category: string;
  text: string;
  options: { label: string; value: number }[];
}

export const QUESTIONS: Question[] = [
  {
    id: 1,
    category: "REVENUE FOUNDATION",
    text: "What is your business's current annual revenue?",
    options: [
      { label: "$2M or more", value: 3 },
      { label: "$500K – $1.9M", value: 2 },
      { label: "Under $500K or pre-revenue", value: 1 },
    ],
  },
  {
    id: 2,
    category: "FUNDING READINESS",
    text: "Have you attempted to secure business funding or a loan in the past 2 years?",
    options: [
      { label: "Yes, and I was approved for what I needed", value: 3 },
      { label: "Yes, but I was declined or approved for less than needed", value: 2 },
      { label: "No, I haven't tried or didn't think I'd qualify", value: 1 },
    ],
  },
  {
    id: 3,
    category: "CREDIT POSITION",
    text: "What best describes your current personal credit profile? (Personal credit directly impacts business funding access.)",
    options: [
      { label: "670 or above — solid credit history", value: 3 },
      { label: "600–669 — some history but room to improve", value: 2 },
      { label: "Below 600 or I honestly don't know", value: 1 },
    ],
  },
  {
    id: 4,
    category: "ACCOUNTING STRUCTURE",
    text: "How is your business accounting currently handled?",
    options: [
      { label: "Professional bookkeeping or CPA, financials always current", value: 3 },
      { label: "Mix of professional and DIY, sometimes behind", value: 2 },
      { label: "Mostly self-managed, not always up to date", value: 1 },
    ],
  },
    {
    id: 5,
    category: "FINANCIAL CLARITY",
    text: "Do you know your business's monthly break-even number — the exact revenue required to cover all operating expenses?",
    options: [
      { label: "Yes — I know it and track it regularly", value: 3 },
      { label: "Roughly — I have a general sense but haven't calculated it", value: 2 },
      { label: "No — I've never calculated it or I'm not sure", value: 1 },
    ],
  },
  {
    id: 6,
    category: "CASH FLOW",
    text: "How do you currently manage cash flow and operating reserves?",
    options: [
      { label: "3+ months of operating expenses in reserve, tracked weekly", value: 3 },
      { label: "1–2 months reserve, monitored monthly", value: 2 },
      { label: "Running lean — little to no reserve, reactive to shortfalls", value: 1 },
    ],
  },
  {
    id: 7,
    category: "REHAB FLAG",
    text: "Are there any active judgments, tax liens, or significant credit issues currently affecting the business?",
    options: [
      { label: "None — our record is completely clean", value: 3 },
      { label: "Minor issues — mostly resolved or in progress", value: 2 },
      { label: "Active — we have current judgments or liens to address", value: 1 },
    ],
  },
  {
    id: 8,
    category: "FINANCIAL REPORTING",
    text: "When a bank or investor asks for your financials, how confident are you?",
    options: [
      { label: "Very confident — clean P&L, balance sheet, and bank statements ready", value: 3 },
      { label: "Somewhat — I can pull them together with notice", value: 2 },
      { label: "Not confident — I don't have organized financials to show", value: 1 },
    ],
  },
  {
    id: 9,
    category: "ADVISORY SUPPORT",
    text: "Do you currently have a CFO, financial advisor, or fractional CFO on your team?",
    options: [
      { label: "Yes — active advisor or fractional CFO reviewing our financials", value: 3 },
      { label: "Occasional — I consult an accountant but not ongoing strategy", value: 2 },
      { label: "No — I'm making financial decisions without professional guidance", value: 1 },
    ],
  },
  {
    id: 10,
    category: "ADDITIONAL CONTEXT",
    text: "What's the #1 financial challenge keeping your business from reaching its next level? (Optional — our strategists read every response.)",
    options: [],
  },
];

export const TIER_47_QUESTIONS: Question[] = [
  {
    id: 6,
    category: "CASH FLOW",
    text: "How do you currently manage cash flow and operating reserves?",
    options: [
      { label: "3+ months of operating expenses in reserve, tracked weekly", value: 3 },
      { label: "1–2 months reserve, monitored monthly", value: 2 },
      { label: "Running lean — little to no reserve, reactive to shortfalls", value: 1 },
    ],
  },
  {
    id: 7,
    category: "REHAB FLAG",
    text: "Are there any active judgments, tax liens, or significant credit issues currently affecting the business?",
    options: [
      { label: "None — our record is completely clean", value: 3 },
      { label: "Minor issues — mostly resolved or in progress", value: 2 },
      { label: "Active — we have current judgments or liens to address", value: 1 },
    ],
  },
  {
    id: 8,
    category: "FINANCIAL REPORTING",
    text: "When a bank or investor asks for your financials, how confident are you?",
    options: [
      { label: "Very confident — clean P&L, balance sheet, and bank statements ready", value: 3 },
      { label: "Somewhat — I can pull them together with notice", value: 2 },
      { label: "Not confident — I don't have organized financials to show", value: 1 },
    ],
  },
  {
    id: 9,
    category: "ADVISORY SUPPORT",
    text: "Do you currently have a CFO, financial advisor, or fractional CFO on your team?",
    options: [
      { label: "Yes — active advisor or fractional CFO reviewing our financials", value: 3 },
      { label: "Occasional — I consult an accountant but not ongoing strategy", value: 2 },
      { label: "No — I'm making financial decisions without professional guidance", value: 1 },
    ],
  },
  {
    id: 10,
    category: "ADDITIONAL CONTEXT",
    text: "What's the #1 financial challenge keeping your business from reaching its next level? (Optional — our strategists read every response.)",
    options: [],
  },
  {
    id: 11,
    category: "PROFITABILITY",
    text: "How would you describe your current profit margins?",
    options: [
      { label: "Strong and consistent", value: 3 },
      { label: "Fluctuating but generally profitable", value: 2 },
      { label: "Thin or currently operating at a loss", value: 1 },
    ]
  },
  {
    id: 12,
    category: "TAX STRATEGY",
    text: "Do you have a proactive tax strategy in place?",
    options: [
      { label: "Yes, reviewed quarterly with a professional", value: 3 },
      { label: "We do some tax planning at year-end", value: 2 },
      { label: "No, we just pay what we owe at tax time", value: 1 },
    ]
  },
  {
    id: 13,
    category: "BUSINESS VALUATION",
    text: "Do you know the current valuation of your business?",
    options: [
      { label: "Yes, we had a formal valuation done recently", value: 3 },
      { label: "I have a rough estimate based on industry multiples", value: 2 },
      { label: "No idea what it's worth", value: 1 },
    ]
  },
  {
    id: 14,
    category: "EXIT STRATEGY",
    text: "Do you have a documented exit strategy or succession plan?",
    options: [
      { label: "Yes, fully documented and regularly updated", value: 3 },
      { label: "I have some thoughts but nothing formal", value: 2 },
      { label: "No exit strategy planned yet", value: 1 },
    ]
  }
];

export const TIER_297_QUESTIONS: Question[] = [
  {
    id: 1,
    category: "TEAM SIZE",
    text: "How many employees or contractors does your business currently have?",
    options: [
      { label: "Just me", value: 1 },
      { label: "2–5", value: 2 },
      { label: "6–15", value: 3 },
      { label: "16–50", value: 4 },
      { label: "50+", value: 5 },
    ],
  },
  {
    id: 2,
    category: "REVENUE TYPE",
    text: "What percentage of your revenue is recurring vs one-time?",
    options: [
      { label: "All one-time", value: 1 },
      { label: "Mostly one-time", value: 2 },
      { label: "Mixed", value: 3 },
      { label: "Mostly recurring", value: 4 },
      { label: "All recurring", value: 5 },
    ],
  },
  {
    id: 3,
    category: "FINANCIAL PLANNING",
    text: "Do you have a documented budget or financial plan for this year?",
    options: [
      { label: "No plan", value: 1 },
      { label: "Informal mental plan", value: 2 },
      { label: "Spreadsheet I rarely update", value: 3 },
      { label: "Documented plan I review quarterly", value: 4 },
      { label: "Formal plan with monthly reviews", value: 5 },
    ],
  },
  {
    id: 4,
    category: "PRICING STRATEGY",
    text: "How do you currently price your products or services?",
    options: [
      { label: "Gut feel", value: 1 },
      { label: "Competitor comparison", value: 2 },
      { label: "Cost-plus markup", value: 3 },
      { label: "Value-based pricing", value: 4 },
      { label: "Dynamic or tiered pricing model", value: 5 },
    ],
  },
  {
    id: 5,
    category: "ACCOUNTS RECEIVABLE",
    text: "What does your accounts receivable situation look like?",
    options: [
      { label: "I get paid upfront always", value: 5 },
      { label: "Mostly on time", value: 4 },
      { label: "Some late payments", value: 3 },
      { label: "Significant overdue invoices", value: 2 },
      { label: "I don't track it formally", value: 1 },
    ],
  },
  {
    id: 6,
    category: "AUDIT HISTORY",
    text: "Have you ever had a formal financial audit or review done?",
    options: [
      { label: "Never", value: 1 },
      { label: "Once, years ago", value: 2 },
      { label: "Annually by a CPA", value: 3 },
      { label: "Regular internal reviews", value: 4 },
      { label: "Full annual audit", value: 5 },
    ],
  },
  {
    id: 7,
    category: "DEBT RELATIONSHIP",
    text: "What is your current relationship with business debt?",
    options: [
      { label: "No debt", value: 5 },
      { label: "Small manageable debt", value: 4 },
      { label: "Moderate debt with a plan", value: 3 },
      { label: "High debt that concerns me", value: 2 },
      { label: "Debt is a serious problem right now", value: 1 },
    ],
  },
  {
    id: 8,
    category: "FUTURE VISION",
    text: "What does success look like for your business in 3 years?",
    options: [], // Free text
  },
];

export const DEEP_DIVE_QUESTIONS = TIER_297_QUESTIONS;


