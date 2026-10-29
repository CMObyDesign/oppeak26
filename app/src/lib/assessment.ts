
const WORKER_URL = "https://swot-engine.cfobydesign.workers.dev";

export type AssessmentTier = "free" | "paid_47" | "paid_297";

// --- Legacy paid47-v1 shapes (free tier still uses these too) --------------
export interface AgentGap {
  title: string;
  impact: string;
  priority: string;
}
export interface AgentOpportunity {
  title: string;
  desc: string;
  impact: string;
}

// --- paid47-v2 enriched shapes (optional; absent on v1 reports) ------------
//
// All fields on these shapes are optional from the application's
// perspective: an old paid47-v1 report (or any free-tier report) must
// still render under the enriched renderer without hitting undefined
// property reads. The renderer branches on `reportSchemaVersion` to
// decide whether to show enriched sections at all.
//
// `relatedFindingIds` on AgentGap + top-level `connections[]` carrying
// `findingIds` + `explanation` is the ID-based cross-finding model (gaps
// stay single-purpose; synthesis lives in `connections[]`), chosen over
// duplicating narrative in both places.
//
// `evidence[].type` is the deterministic provenance the quality gate
// inspects: a primary gap whose only evidence is `opportunity_flag` is
// rejected (that was the merchant-processing bug on Marisol's run).

export interface AgentEvidenceRef {
  type: "answer" | "derived_metric" | "opportunity_flag" | "deterministic_fact";
  key: string;
}
export interface AgentGapV2 {
  id: string;
  title: string;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | string;
  evidence?: AgentEvidenceRef[];
  known?: string;
  diagnosis?: string;        // internal; renderer may suppress
  whyItMatters?: string;
  unknown?: string;
  decisionImplication?: string;
  relatedFindingIds?: string[];
  // Legacy v1 fields the renderer still falls back to if an enriched
  // gap arrives without the richer prose fields. One intentional overlap
  // so a gap can be rendered under either path without a shape pivot.
  impact?: string;
}
export interface AgentOpportunityV2 {
  id?: string;
  title: string;
  evidence?: AgentEvidenceRef[];
  whyCredible?: string;
  economicMechanism?: string;
  whatMustBeTrue?: string;
  nextValidation?: string;
  // Legacy fallbacks:
  desc?: string;
  impact?: string;
}
export interface AgentFinancialSnapshotRow {
  label: string;
  value: string;
  meaning?: string;
  sourceType?: "customer_answer" | "deterministic_fact" | "derived_metric";
}
export interface AgentConnection {
  title: string;
  findingIds?: string[];
  explanation: string;
}
export interface AgentQuestionToClarify {
  question: string;
  whyItMatters?: string;
}
export interface AgentDecisionStep {
  step: number;
  action: string;
  whyNow?: string;
}
export interface AgentCoverage {
  gapsRequested?: number;
  gapsReturned?: number;
  gapsShortfallReason?: string | null;
  opportunitiesRequested?: number;
  opportunitiesReturned?: number;
  opportunitiesShortfallReason?: string | null;
  connectionStatus?: "identified" | "no_material_connection_supported" | string;
  noConnectionReason?: string | null;
}

export interface AgentReport {
  success: boolean;
  tier: string;
  // Customer-facing classification. Rubric v3 narrowed this from five
  // values ("rehab" | "urgent" | "needs-attention" | "growth" | "strong")
  // to three: "urgent" folds into "needs-attention," and "strong" folds
  // into "growth" (see docs/SOLOMON_ARCHITECTURE.md). The legacy strings
  // are kept in the union so a historical report rendered client-side
  // still parses — generators no longer emit them.
  path: "rehab" | "needs-attention" | "growth" | "urgent" | "strong";
  badge: string;
  headline: string;
  opener: string;
  context: string;
  // Pre-upgrade shape (free + legacy paid47-v1).
  gaps: AgentGap[] | AgentGapV2[];
  opportunities: AgentOpportunity[] | AgentOpportunityV2[];
  nextStepHeadline: string;
  nextStepBody: string;
  opportunityFlags: string[];
  bookingLink: string | null;

  // Free-tier "One Move You Can Make Now" — a single concrete action
  // tied to the first-ranked signal. Optional at the type level because
  // historical reports (and paid tiers that lean on decisionOrder[])
  // may omit it. The renderer surfaces it only when title is non-empty
  // so an empty object never produces an empty card.
  oneMove?: { title: string; desc?: string };

  // --- paid47-v2 additions (all optional; absent on free + v1) -----------
  // Version tags present only on reports generated under the enriched
  // contract. Renderers check `reportSchemaVersion === "paid47-v2"`
  // before showing the enriched sections.
  reportSchemaVersion?: string;        // e.g. "paid47-v2"
  tierGuideVersion?: string;           // e.g. "paid47-2.0"

  financialSnapshot?: AgentFinancialSnapshotRow[];
  connections?: AgentConnection[];
  questionsToClarify?: AgentQuestionToClarify[];
  decisionOrder?: AgentDecisionStep[];
  coverage?: AgentCoverage;
}

/** Helper to convert any raw answer value into a human-readable string using question options */
export function getReadableAnswer(
  raw: any,
  options?: { value: string | number; label: string }[]
): string {
  if (raw === null || raw === undefined) return "";
  
  if (Array.isArray(raw)) {
    return raw.map(val => {
      const opt = options?.find(o => o.value === val || String(o.value) === String(val));
      return opt?.label ?? String(val);
    }).join(", ");
  }
  
  if (typeof raw === "object" && raw !== null) {
    return Object.entries(raw)
      .filter(([_, checked]) => checked === true)
      .map(([val]) => {
        const opt = options?.find(o => o.value === val || String(o.value) === String(val));
        return opt?.label ?? val;
      }).join(", ");
  }
  
  if (options) {
    const opt = options.find(o => o.value === raw || String(o.value) === String(raw));
    return opt?.label ?? String(raw);
  }
  
  return typeof raw === "string" ? raw.trim() : String(raw);
}

/** Convert the form's numeric answers + Questions definitions into the labeled
 *  question/answer pairs the worker expects. Looks up labels for select options.
 *
 *  Emits EVERY question the assessment asked, including unanswered ones as
 *  \`Answer: [not provided]\`. The worker's rubric relies on seeing skipped
 *  questions in the prompt to compute the incomplete-intake fraction and to
 *  flag "Incomplete intake —" gaps by name. Filtering blanks here would hide
 *  what was skipped and make the completeness rule inoperable. */
export function formatAnswersForAgent(
  answers: Record<number | string, any>,
  questions: { id?: number; fieldKey?: string; text: string; options?: { value: string | number; label: string }[] }[]
): { question: string; answer: string }[] {
  return questions
    .filter(q => q.text)
    .map(q => {
      const raw = (q.id != null ? answers[q.id] : undefined) ??
                  (q.fieldKey ? answers[q.fieldKey] : undefined);
      const answerText = getReadableAnswer(raw, q.options);
      return {
        question: q.text,
        answer: answerText && answerText.trim() ? answerText.trim() : "[not provided]",
      };
    });
}

// 90s is well above a typical Solomon run (5-30s) but low enough that a
// hung request doesn't strand the user on the analyzing spinner forever.
// If we hit this, the caller shows the "we hit a snag" fallback and
// Miguel's team gets notified via the failure tag on the contact.
const RUN_ASSESSMENT_TIMEOUT_MS = 90_000;

export async function runAssessment(params: {
  tier?: AssessmentTier;
  answers: { question: string; answer: string }[];
  contact?: { name?: string; email?: string; contactId?: string };
  businessProfile?: {
    businessName?: string;
    industry?: string;
    website?: string;
    city?: string;
    state?: string;
    country?: string;
    // Collected in the paid_47 Business Info section as of PR #128,
    // forwarded here as of the follow-up Codex P2 fix. Worker emits
    // it in the BUSINESS PROFILE block of buildPrompt so Solomon can
    // anchor every ratio and report claim on a real number.
    annualRevenue?: string;
  };
}): Promise<AgentReport> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUN_ASSESSMENT_TIMEOUT_MS);
  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tier: params.tier ?? "free",
        contact: params.contact ?? {},
        businessProfile: params.businessProfile ?? {},
        answers: params.answers,
      }),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Assessment failed");
    return data as AgentReport;
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(
        "The report is taking longer than expected. Miguel's team has been alerted and will follow up with you shortly.",
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Verify a contact has paid for the given tier (by GHL tag check via worker). */
export async function verifyPayment(
  contactId: string | undefined,
  tier: AssessmentTier,
  email?: string,
): Promise<{
  verified: boolean;
  contact: { contactId: string; name: string; email: string } | null;
  error?: string;
}> {
  if (!contactId && !email) return { verified: false, contact: null, error: "Missing contactId or email" };
  try {
    const res = await fetch(`${WORKER_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId, tier, email }),
    });
    const data = await res.json();
    return {
      verified: !!data.verified,
      contact: data.contact ?? null,
      error: data.error,
    };
  } catch (e: any) {
    return { verified: false, contact: null, error: e?.message || "Network error" };
  }
}

/** Upload a file to the worker, which forwards to CRM Media Library. */
export async function uploadFile(
  file: File,
  contactId?: string,
): Promise<{ success: boolean; url: string | null; fileName: string; error?: string }> {
  const formData = new FormData();
  formData.append("file", file);
  if (contactId) formData.append("contactId", contactId);
  try {
    const res = await fetch(`${WORKER_URL}/upload`, {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    return {
      success: !!data.success,
      url: data.url ?? null,
      fileName: data.fileName ?? file.name,
      error: data.error,
    };
  } catch (e: any) {
    return { success: false, url: null, fileName: file.name, error: e?.message || "Network error" };
  }
}

