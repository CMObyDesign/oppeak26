export interface FreeAssessmentQuestion {
  id: number;
  fieldKey: string;
  type: 'select' | 'text' | 'textarea';
  title: string;
  text: string;
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
        type: "text",
        title: "Industry/Vertical",
        text: "What industry or vertical best describes your business?",
        required: false
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
        title: "Active Debt Management",
        text: "Do you currently have any active judgments, tax liens, or corporate debt you are actively managing?",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
          { value: "not-sure", label: "Not sure" }
        ],
        required: true
      },
      {
        id: 5,
        fieldKey: "8sSKohKtQZZzJEtM2ju0",
        type: "select",
        title: "Decision Making Basis",
        text: "When you make business decisions, are you basing them on your actual numbers or on what is in your bank account?",
        options: [
          { value: "numbers", label: "I run on numbers I have clean financials" },
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
        required: false
      },
      {
        id: 7,
        fieldKey: "hV9yij5uFitztZzanSaa",
        type: "textarea",
        title: "Referral Language",
        text: "When a client refers you, what specific words or outcome do they use to describe what you did for them?",
        required: false
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
        required: false
      },
      {
        id: 9,
        fieldKey: "cvuAgfuL94eBahOrnTY0",
        type: "textarea",
        title: "Hidden Profit Opportunity",
        text: "What would change in your business if you had 20% more profit on the same revenue?",
        required: false
      }
    ]
  },
  {
    title: "Opportunities & Threats",
    questions: [
      {
        id: 10,
        fieldKey: "cdlV9zqJxztcxfXgD4J0",
        type: "textarea",
        title: "Market Opportunity",
        text: "Where do you see demand in your market that you are not yet positioned to capture?",
        required: false
      },
      {
        id: 11,
        fieldKey: "qKRvCyjprebbK75tC05h",
        type: "textarea",
        title: "Single Point of Failure",
        text: "What would happen to your business if your single largest client, revenue source, or referral channel disappeared in the next 90 days?",
        required: false
      }
    ]
  }
];

