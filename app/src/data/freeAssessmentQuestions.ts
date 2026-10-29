export interface FreeAssessmentQuestion {
  id: number;
  fieldKey: string;
  type: 'select' | 'text' | 'textarea';
  title: string;
  text: string;
  // Optional guide/hint shown inside the input (textarea placeholder or
  // text input placeholder). Used to give owners who are stuck a nudge
  // toward a specific example or a legitimate "I don't know yet" answer.
  // Only set on textarea questions where the question is open-ended
  // enough that an owner might otherwise freeze. Must be a legitimate
  // allowed answer, not a leading one — see UNCERTAINTY IS VALID in the
  // worker rubric.
  placeholder?: string;
  options?: { value: string; label: string }[];
  required: boolean;
}

export interface AssessmentSection {
  title: string;
  questions: FreeAssessmentQuestion[];
}

export const FREE_ASSESSMENT_SECTIONS: AssessmentSection[] = [
  {
    title: "Intake Profile",
    questions: [
      {
        id: 1,
        fieldKey: "5VWVNRrQYcLqXhckh4f4",
        type: "select",
        title: "Business Type",
        text: "What best describes your business type?",
        options: [
          { value: "service-based", label: "Service-based" },
          { value: "product-based", label: "Product-based" },
          { value: "hybrid", label: "Hybrid" }
        ],
        required: true
      },
      {
        id: 2,
        fieldKey: "nCRqWH0x1sdJIgUPDr2E",
        type: "select",
        title: "Customer Reach",
        text: "How do you primarily reach your customers?",
        options: [
          { value: "local", label: "Local presence" },
          { value: "statewide", label: "Statewide" },
          { value: "regional", label: "Regional Multi-state" },
          { value: "national", label: "National" },
          { value: "ecommerce", label: "E-commerce / Online" }
        ],
        required: true
      },
      {
        id: 3,
        fieldKey: "nbPL6APmjrjr43J6urVb",
        type: "select",
        title: "Industry/Vertical",
        text: "What industry or vertical best describes your business?",
        options: [
          { value: "hvac", label: "HVAC / Trades" },
          { value: "construction", label: "Construction" },
          { value: "professional-services", label: "Professional services" },
          { value: "ecommerce", label: "E-commerce" },
          { value: "other", label: "Other" }
        ],
        required: true
      }
    ]
  },
  {
    title: "Financial Foundation",
    questions: [
      {
        id: 4,
        fieldKey: "OyQjw4nGNHJYADsq5ggg",
        type: "select",
        // Approved six-state option set — replaces the earlier
        // yes / no / not-sure trio that could not distinguish
        // "I'm managing a healthy SBA loan" from "I have an active
        // IRS judgment," two situations with opposite rubric
        // implications. The worker normalizer (normalize.js) still
        // accepts the legacy three values for historical submissions
        // and MUST never interpret a legacy bare "yes" as proof of
        // tax distress or debt-service pressure — see the big
        // DEBT SUBTYPE DISCIPLINE block in worker/src/index.js and
        // normDebtSummary() in normalize.js.
        title: "Debt / Tax / Legal Status",
        text: "Which best describes your business's current debt, tax, and legal status?",
        // Eight-state option set (2026-10-29 — Liz-approved). Distinguishes
        // managed vs stretched debt separately from tax-only, lien-only,
        // and the two overlapping states (debt + lien, unfiled vs
        // outstanding balance). The normalizer in worker/src/normalize.js
        // classifies each slug into subtypes + judgments_or_liens
        // signals; see DEBT / TAX / LEGAL STATUS MAPPING in
        // ASSESSMENT_RUBRIC for the per-slug Solomon directive.
        //
        // Legacy slugs (yes/no/not-sure + the previous six-state set)
        // remain accepted by the normalizer for historical submissions
        // but are no longer offered as new-form options.
        options: [
          { value: "none",                    label: "No active business debt, tax liens, or judgments" },
          { value: "managed_debt",            label: "Business debt only — current and manageable" },
          { value: "managed_debt_stretched",  label: "Business debt only — stretched or actively being reworked" },
          { value: "lien_or_judgment",        label: "Active tax lien or judgment" },
          { value: "debt_and_lien",           label: "Both business debt and an active tax lien or judgment" },
          { value: "unfiled_taxes",           label: "One or more business tax returns are currently unfiled" },
          { value: "tax_balance",             label: "Outstanding tax balance or payment plan, but no active lien or judgment" },
          { value: "not_sure",                label: "Not sure" },
        ],
        required: true,
      },
      {
        id: 5,
        fieldKey: "8sSKohKtQZZzJEtM2ju0",
        type: "select",
        title: "Decision Making Basis",
        text: "When you make business decisions, are you basing them on your actual numbers or on what is in your bank account?",
        options: [
          { value: "numbers", label: "I run on my numbers. I have clean financials." },
          { value: "bank-balance", label: "Mostly my bank balance" },
          { value: "in-between", label: "Somewhere in between" },
          { value: "not-sure", label: "Honestly not sure" }
        ],
        required: true
      }
    ]
  },
  {
    title: "Strengths",
    questions: [
      {
        id: 6,
        fieldKey: "deItnw0p1H7sO1okRjGS",
        type: "textarea",
        title: "Unique Value Proposition",
        text: "What does your business consistently deliver that your clients say they cannot get anywhere else?",
        required: true
      },
      {
        id: 7,
        fieldKey: "hV9yij5uFitztZzanSaa",
        type: "textarea",
        title: "Referral Language",
        text: "When a client refers you, what specific words or outcome do they use to describe what you did for them?",
        required: true
      }
    ]
  },
  {
    title: "Weaknesses",
    questions: [
      {
        id: 8,
        fieldKey: "ngBePHf4iKPhaHm2OtSv",
        type: "textarea",
        title: "Revenue Leaks",
        text: "Where does revenue most often leak in your business?",
        placeholder: "Give us one specific example. If you're not sure, tell us where you suspect it happens.",
        required: true
      }
    ]
  },
  {
    title: "Opportunities & Threats",
    questions: [
      {
        id: 9,
        fieldKey: "cvuAgfuL94eBahOrnTY0",
        type: "textarea",
        title: "Hidden Profit Opportunity",
        text: "What would change in your business if you had 20% more profit on the same revenue?",
        required: true
      },
      {
        id: 10,
        fieldKey: "cdlV9zqJxztcxfXgD4J0",
        type: "textarea",
        title: "Market Opportunity",
        text: "Where do you see demand in your market that you are not yet positioned to capture?",
        placeholder: "Be specific. If you don't see a clear opportunity right now, say that.",
        required: true
      },
      {
        id: 11,
        fieldKey: "qKRvCyjprebbK75tC05h",
        type: "textarea",
        title: "Single Point of Failure",
        text: "What would happen to your business if your single largest client, revenue source, or referral channel disappeared in the next 90 days?",
        placeholder: "If you don't depend heavily on any one source, tell us that.",
        required: true
      }
    ]
  }
];

