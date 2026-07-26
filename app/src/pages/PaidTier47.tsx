import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { PaidTier47Survey } from "@/components/PaidTier47Survey";
import { PaymentRequiredScreen } from "@/components/PaymentRequiredScreen";
import { ProcessingScreen } from "@/components/ProcessingScreen";
import { ResultsScreen } from "@/components/ResultsScreen";
import {
  PAID_TIER_47_QUESTIONS,
  PAID_TIER_47_BUSINESS_INFO,
} from "@/data/paidTier47Questions";
import {
  formatAnswersForAgent,
  runAssessment,
  verifyPayment,
  AgentReport,
} from "@/lib/assessment";
import { PAYMENT_LINK_47, IMAGE_LOGO } from "@/lib/ghl-config";

type ScreenState = "verifying" | "not-paid" | "survey" | "analyzing" | "results";

const PaidTier47 = () => {
  const navigate = useNavigate();
  const [screen, setScreen] = useState<ScreenState>("verifying");

  // Single state object keyed by question id (and business-info field id).
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [contact, setContact] = useState<{ name: string; email: string; contactId?: string }>({
    name: "",
    email: "",
  });

  const [report, setReport] = useState<AgentReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [timerDone, setTimerDone] = useState(false);

  // Pre-flight: verify payment on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const contactId = params.get("contactId") || "";
    if (!contactId) { setScreen("not-paid"); return; }

    verifyPayment(contactId, "paid_47").then((r) => {
      if (r.verified && r.contact) {
        setContact({
          name:  r.contact.name  || params.get("name")  || "",
          email: r.contact.email || params.get("email") || "",
          contactId,
        });
        setScreen("survey");
      } else {
        setScreen("not-paid");
      }
    });
  }, []);

  // Transition to results when BOTH the worker is done AND the animation has played.
  useEffect(() => {
    if (screen === "analyzing" && timerDone && (report || reportError)) {
      setScreen("results");
    }
  }, [screen, timerDone, report, reportError]);
  // When results land, stash business info so /paid-297 can pick it up.
  useEffect(() => {
    if (screen === "results" && report) {
      const businessInfo = {
        businessName: answers["organization"] || "",
        website:      answers["website"]      || "",
        industry:     answers["industry"]     || "",
        city:         answers["city"]         || "",
        state:        answers["state"]        || "",
        country:      answers["country"]      || "",
      };
      try {
        localStorage.setItem("swot_business_info", JSON.stringify(businessInfo));
      } catch { /* localStorage disabled — fall back to URL params */ }
    }
  }, [screen, report, answers]);

  const handleSurveyComplete = async (finalAnswers: Record<string, any>) => {
    setAnswers(finalAnswers);
    setReport(null);
    setReportError(null);
    setTimerDone(false);
    setScreen("analyzing");

    try {
      // Split business-info fields out of `answers` and into `businessProfile`.
      const businessInfoIds = new Set(PAID_TIER_47_BUSINESS_INFO.map(b => b.id));
      const businessProfile = {
        businessName: finalAnswers["organization"] || "",
        website:      finalAnswers["website"]      || "",
        industry:     finalAnswers["industry"]     || "",
        city:         finalAnswers["city"]         || "",
        state:        finalAnswers["state"]        || "",
        country:      finalAnswers["country"]      || "",
      };

      // Everything that isn't business info is a question answer.
      const diagnosticAnswers: Record<string, any> = {};
      for (const [k, v] of Object.entries(finalAnswers)) {
        if (!businessInfoIds.has(k)) diagnosticAnswers[k] = v;
      }

      // Map each id → its question definition so formatAnswersForAgent
      // can look up question text + translate select values to labels.
      const formatted = formatAnswersForAgent(
        diagnosticAnswers,
        PAID_TIER_47_QUESTIONS.map(q => ({
          fieldKey: q.id,
          text: q.text,
          options: q.options,
        })),
      );

      const result = await runAssessment({
        tier: "paid_47",
        contact,
        businessProfile,
        answers: formatted,
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
              <PaymentRequiredScreen tier="paid_47" paymentUrl={PAYMENT_LINK_47} />
            </motion.div>
          )}
          {screen === "survey" && (
            <motion.div key="survey" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
              <PaidTier47Survey
                contact={contact}
                onContactChange={setContact}
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
                leadData={{ name: contact.name, email: contact.email, businessName: answers["organization"] }}
                onCtaClick={() => navigate("/paid-297")}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
};

export default PaidTier47;

