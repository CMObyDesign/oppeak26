import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PaidTier297Survey } from "@/components/PaidTier297Survey";
import { PaymentRequiredScreen } from "@/components/PaymentRequiredScreen";
import { ProcessingScreen } from "@/components/ProcessingScreen";
import { ResultsScreen } from "@/components/ResultsScreen";
import { PAID_TIER_297_QUESTIONS } from "@/data/paidTier297Questions";
import {
  formatAnswersForAgent,
  runAssessment,
  verifyPayment,
  AgentReport,
} from "@/lib/assessment";
import { PAYMENT_LINK_297, IMAGE_LOGO } from "@/lib/ghl-config";

type ScreenState = "verifying" | "not-paid" | "survey" | "analyzing" | "results";

const PaidTier297 = () => {
  const [screen, setScreen] = useState<ScreenState>("verifying");

  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [contact, setContact] = useState<{ name: string; email: string; contactId?: string }>({
    name: "", email: "",
  });
  const [businessProfile, setBusinessProfile] = useState<{
    businessName?: string;
    website?: string;
    industry?: string;
    city?: string;
    state?: string;
    country?: string;
  }>({});

  const [report, setReport] = useState<AgentReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [timerDone, setTimerDone] = useState(false);

  // Pre-flight: verify payment on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const contactId = params.get("contactId") || "";
    if (!contactId) { setScreen("not-paid"); return; }

    verifyPayment(contactId, "paid_297").then((r) => {
      if (r.verified && r.contact) {
        setContact({
          name:  r.contact.name  || params.get("name")  || "",
          email: r.contact.email || params.get("email") || "",
          contactId,
        });

        // Build businessProfile — URL params win if present, else localStorage.
        let stored: any = {};
        try {
          const raw = localStorage.getItem("swot_business_info");
          if (raw) stored = JSON.parse(raw);
        } catch {}

        setBusinessProfile({
          businessName: params.get("businessName") || stored.businessName || "",
          website:      params.get("website")      || stored.website      || "",
          industry:     params.get("industry")     || stored.industry     || "",
          city:         params.get("city")         || stored.city         || "",
          state:        params.get("state")        || stored.state        || "",
          country:      params.get("country")      || stored.country      || "",
        });

        setScreen("survey");
      } else {
        setScreen("not-paid");
      }
    });
  }, []);

  // Transition to results when worker is done AND animation has played.
  useEffect(() => {
    if (screen === "analyzing" && timerDone && (report || reportError)) {
      setScreen("results");
    }
  }, [screen, timerDone, report, reportError]);

  const handleSurveyComplete = async (finalAnswers: Record<string, any>) => {
    setAnswers(finalAnswers);
    setReport(null);
    setReportError(null);
    setTimerDone(false);
    setScreen("analyzing");

    try {
      // Extract annual revenue + supporting docs separately.
      const annualRevenue   = finalAnswers["annual_revenue"]      || "";
      const supportingDocs  = finalAnswers["supporting_documents"] || [];

      // Diagnostic answers = everything else.
      const diagnosticAnswers: Record<string, any> = {};
      for (const [k, v] of Object.entries(finalAnswers)) {
        if (k !== "annual_revenue" && k !== "supporting_documents") {
          diagnosticAnswers[k] = v;
        }
      }

      const formatted = formatAnswersForAgent(
        diagnosticAnswers,
        PAID_TIER_297_QUESTIONS.map((q) => ({
          fieldKey: q.id, text: q.text, options: q.options,
        })),
      );

      const result = await runAssessment({
        tier: "paid_297",
        contact,
        businessProfile,
        // Lead with revenue so the agent uses it as primary context for everything else.
        answers: [
          { question: "Annual revenue", answer: String(annualRevenue) },
          ...formatted,
          // Supporting docs (if any) — mention them so agent knows they exist
          ...(supportingDocs.length > 0
            ? [{ question: "Supporting documents attached", answer: `${supportingDocs.length} file(s) uploaded for Miguel's review` }]
            : []),
        ],
      });
      setReport(result);
    } catch (err: any) {
      setReportError(err?.message || "Could not generate report");
    }
  };

  if (screen === "verifying") {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Verifying payment…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-body overflow-x-hidden selection:bg-primary/30 flex flex-col">
      <header className="absolute top-0 left-0 right-0 z-50">
        <div className="container mx-auto px-6 py-12 md:py-16 flex justify-center md:justify-start">
          <div className="flex flex-col items-center md:items-start pl-4 md:pl-8">
            <img
              src={IMAGE_LOGO}
              alt="CFO By Design"
              className="h-20 md:h-24 object-contain brightness-150"
            />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 flex-grow flex flex-col">
        <AnimatePresence mode="wait">
          {screen === "not-paid" && (
            <motion.div key="not-paid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
              <PaymentRequiredScreen tier="paid_297" paymentUrl={PAYMENT_LINK_297} />
            </motion.div>
          )}
          {screen === "survey" && (
            <motion.div key="survey" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
              <PaidTier297Survey 
                contact={contact} 
                onComplete={handleSurveyComplete} 
              />
            </motion.div>
          )}
          {screen === "analyzing" && (
            <motion.div key="analyzing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
              <ProcessingScreen onComplete={() => setTimerDone(true)} />
            </motion.div>
          )}
          {screen === "results" && (
            <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
              <ResultsScreen
                report={report}
                error={reportError}
                answers={answers}
                leadData={{ name: contact.name, email: contact.email }}
                onCtaClick={() => {}}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
};

export default PaidTier297;

