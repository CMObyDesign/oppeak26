
const WORKER_URL = "https://swot-engine.cfobydesign.workers.dev";

export type AssessmentTier = "free" | "paid_47" | "paid_297";

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
export interface AgentReport {
  success: boolean;
  tier: string;
  path: "rehab" | "urgent" | "growth" | "strong";
  badge: string;
  headline: string;
  opener: string;
  context: string;
  gaps: AgentGap[];
  opportunities: AgentOpportunity[];
  nextStepHeadline: string;
  nextStepBody: string;
  opportunityFlags: string[];
  bookingLink: string | null;
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
 *  question/answer pairs the worker expects. Looks up labels for select options. */
export function formatAnswersForAgent(
  answers: Record<number | string, any>,
  questions: { id?: number; fieldKey?: string; text: string; options?: { value: string | number; label: string }[] }[]
): { question: string; answer: string }[] {
  return Object.entries(answers)
    .map(([key, raw]) => {
      const isNumericId = !isNaN(Number(key));
      const q = questions.find((x) => 
        isNumericId ? x.id === Number(key) : x.fieldKey === key
      );
      if (!q) return null;
      
      const answerText = getReadableAnswer(raw, q.options);
      if (!answerText) return null;
      
      return { question: q.text, answer: answerText };
    })
    .filter((x): x is { question: string; answer: string } => x !== null);
}

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
  };
}): Promise<AgentReport> {
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tier: params.tier ?? "free",
      contact: params.contact ?? {},
      businessProfile: params.businessProfile ?? {},
      answers: params.answers,
    }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Assessment failed");
  return data as AgentReport;
}

/** Verify a contact has paid for the given tier (by GHL tag check via worker). */
export async function verifyPayment(
  contactId: string,
  tier: AssessmentTier,
): Promise<{
  verified: boolean;
  contact: { contactId: string; name: string; email: string } | null;
  error?: string;
}> {
  if (!contactId) return { verified: false, contact: null, error: "Missing contactId" };
  try {
    const res = await fetch(`${WORKER_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId, tier }),
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

