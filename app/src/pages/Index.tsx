import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LandingScreen } from "@/components/LandingScreen";
import { AssessmentScreen } from "@/components/AssessmentScreen";
import { ProcessingScreen } from "@/components/ProcessingScreen";
import { ResultsScreen } from "@/components/ResultsScreen";
import { PurchaseGateScreen } from "@/components/PurchaseGateScreen";
import { RehabScreen } from "@/components/RehabScreen";
import { FREE_ASSESSMENT_SECTIONS } from "@/data/freeAssessmentQuestions";
import { formatAnswersForAgent, getReadableAnswer, runAssessment, AgentReport } from "@/lib/assessment";
import { setAssessmentTimestamp } from "@/lib/offerTiming";
import { IMAGE_LOGO } from "@/lib/ghl-config";

type ScreenState = "landing" | "assessment" | "analyzing" | "results" | "purchase" | "rehab";

const Index = () => {
  const [screen, setScreen] = useState<ScreenState>("landing");
  const [answers, setAnswers] = useState<Record<number, any>>({});
  const [leadData, setLeadData] = useState<{ name: string; email: string; businessName?: string; contactId?: string } | null>(null);
  const [report, setReport] = useState<AgentReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [timerDone, setTimerDone] = useState(false);

  const trackEvent = (name: string, properties?: any) => {
    // eslint-disable-next-line no-console
    console.log(`[Analytics] ${name}`, properties);
  };

  // Nurture intent localStorage (kept from previous behavior)
  useEffect(() => {
    if (screen === "purchase" && report) {
      localStorage.setItem(
        "cfo_audit_intent",
        JSON.stringify({ path: report.path, timestamp: Date.now(), status: "pending" })
      );
      trackEvent("purchase_gate_viewed", { path: report.path });
    }
  }, [screen, report]);

  // Transition to results when BOTH the agent is done AND the animation has played
  useEffect(() => {
    if (screen === "analyzing" && timerDone && (report || reportError)) {
      if (report?.path === "rehab") {
        trackEvent("rehab_path_shown", { path: report.path });
      }
      trackEvent("report_viewed", { path: report?.path, error: reportError });
      setScreen("results");
    }
  }, [screen, timerDone, report, reportError]);

  const handleStart = () => {
    trackEvent("funnel_started");
    setScreen("assessment");
  };

  const handleAssessmentComplete = async (
    finalAnswers: Record<number, any>,
    leadData?: { name: string; email: string; businessName?: string; contactId?: string }
  ) => {
    setAssessmentTimestamp();
    setLeadData(leadData || null);
    setAnswers(finalAnswers);
    setReport(null);
    setReportError(null);
    setTimerDone(false);
    setScreen("analyzing");
    trackEvent("assessment_completed", { leadData });

    try {
      const allQuestions = FREE_ASSESSMENT_SECTIONS.flatMap(s => s.questions);
      const formatted = formatAnswersForAgent(finalAnswers, allQuestions);
      
      const q3 = allQuestions.find(q => q.id === 3);
      const industry = getReadableAnswer(finalAnswers[3], q3?.options);
      const result = await runAssessment({
        tier: "free",
        answers: formatted,
        contact: { name: leadData?.name, email: leadData?.email, contactId: leadData?.contactId },
        businessProfile: {
          businessName: leadData?.businessName || "",
          industry,
        }
      });
      setReport(result);
    } catch (err: any) {
      setReportError(err?.message || "Could not generate report");
    }
  };

  const handleAnalysisTimerDone = () => setTimerDone(true);

  const handleCtaClick = () => {
    trackEvent("cta_clicked", { path: report?.path });
    if (report?.path === "rehab") setScreen("rehab");
    else setScreen("purchase");
  };

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);

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
          {screen === "landing" && (
            <motion.div key="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
              <LandingScreen onStart={handleStart} />
            </motion.div>
          )}
          {screen === "assessment" && (
            <motion.div key="assessment" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
              <AssessmentScreen onComplete={handleAssessmentComplete} />
            </motion.div>
          )}
          {screen === "analyzing" && (
            <motion.div key="analyzing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
              <ProcessingScreen onComplete={handleAnalysisTimerDone} />
            </motion.div>
          )}
          {screen === "results" && (
            <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
              <ResultsScreen
                report={report}
                error={reportError}
                answers={answers}
                leadData={leadData}
                onCtaClick={handleCtaClick}
              />
            </motion.div>
          )}
          {screen === "purchase" && (
            <motion.div key="purchase" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
              <PurchaseGateScreen
                score={0}
                path={(report?.path as any) ?? "growth"}
                onBack={() => setScreen("results")}
              />
            </motion.div>
          )}
          {screen === "rehab" && (
            <motion.div key="rehab" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
              <RehabScreen score={0} onBack={() => setScreen("results")} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="w-full p-8 flex flex-col md:flex-row justify-between items-center gap-6 opacity-60 mt-auto z-40 border-t border-white/5 bg-background/50 backdrop-blur-sm">
        <div className="flex flex-col md:flex-row items-center gap-4 md:gap-6">
          <img
            src={IMAGE_LOGO}
            alt="CFO By Design"
            className="h-10 md:h-12 object-contain brightness-150 shrink-0"
          />
          <div className="text-center md:text-left space-y-2">
            <div className="text-xs uppercase tracking-[0.3em] font-mono text-foreground">
              CFO By Design |{" "}
              <a
                href="https://www.cfobydesign.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-primary transition-colors"
              >
                cfobydesign.com
              </a>{" "}
              | Confidential
            </div>
            <div className="text-[10px] md:text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">Your Business Finances. Professionally Managed.</div>
          </div>
        </div>
        <div className="flex gap-8">
          <a
            href="https://www.cfobydesign.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs uppercase tracking-widest font-mono hover:text-primary transition-colors text-foreground"
          >
            Privacy
          </a>
          <a
            href="https://www.cfobydesign.com/tos"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs uppercase tracking-widest font-mono hover:text-primary transition-colors text-foreground"
          >
            Terms
          </a>
        </div>
      </footer>
    </div>
  );
};

export default Index;

