import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft } from "lucide-react";
import {
  PAID_TIER_47_BUSINESS_INFO,
  PAID_TIER_47_QUESTIONS,
  PaidTier47Question,
  getPaid47Sections,
} from "@/data/paidTier47Questions";
import { SaveForLater } from "@/components/SaveForLater";
import { TieredQuestionCard, TierEyebrow } from "@/components/TieredQuestionCard";
import { requestParentScrollToTop } from "@/lib/iframe-resize";

interface Props {
  contact: { name: string; email: string; contactId?: string };
  onContactChange: (c: { name: string; email: string; contactId?: string }) => void;
  onComplete: (answers: Record<string, any>) => void;
}

// Legacy-cursor migration (Codex P2 on #133). The pre-refactor survey
// stored sectionIdx against a section list that put business-info at
// index 0 and the diagnostic question sections at 1..N. The new survey
// stores stepIdx against the flat list [bizInfo, Q12, Q13, …, Q28].
// Map each old section back to the first question step that section
// owned so a resuming customer lands close to where they stopped.
function migrateLegacySectionIdx47(sectionIdx: number): number {
  if (sectionIdx <= 0) return 0; // business info
  const sections = getPaid47Sections();
  if (sectionIdx > sections.length) return 1;
  let offset = 1; // step 0 = business info
  for (let i = 0; i < sectionIdx - 1; i++) {
    offset += sections[i].questions.length;
  }
  return offset;
}

// One-question-per-screen flow matching the free tier's visual language.
// Index 0 = batched business-info step (name/email + Business Info fields —
// kept batched because typing a form is faster than four clicks). Indices
// 1..N = Q12..Q28 diagnostic questions, one per screen.
export const PaidTier47Survey = ({ contact, onContactChange, onComplete }: Props) => {
  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  // Separate draft state for free-form questions so the typed value survives
  // until the user clicks Continue. Mirrors the free-tier QuestionCard pattern.
  const [draft, setDraft] = useState<string>("");

  // Per-browser resume. Also handles the pre-deploy `sectionIdx` cursor by
  // mapping each legacy section back to the first question step it owned,
  // so a paid customer who dropped mid-survey before the one-per-screen
  // refactor still picks back up near where they stopped — not booted
  // back to the business-info screen. Codex P2 on #133.
  const PROGRESS_KEY = `swot_paid47_progress_${contact.contactId || "anon"}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s && typeof s === "object") {
        if (s.answers && typeof s.answers === "object") setAnswers(s.answers);
        if (typeof s.stepIdx === "number") {
          setStepIdx(s.stepIdx);
        } else if (typeof s.sectionIdx === "number") {
          setStepIdx(migrateLegacySectionIdx47(s.sectionIdx));
        }
      }
    } catch { /* private mode or bad JSON — start fresh */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [PROGRESS_KEY]);
  useEffect(() => {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify({ answers, stepIdx }));
    } catch { /* localStorage disabled — skip */ }
  }, [PROGRESS_KEY, answers, stepIdx]);

  const totalSteps = 1 + PAID_TIER_47_QUESTIONS.length;
  const isBusinessInfoStep = stepIdx === 0;
  const currentQ: PaidTier47Question | null = isBusinessInfoStep
    ? null
    : PAID_TIER_47_QUESTIONS[stepIdx - 1];
  const isLast = stepIdx === totalSteps - 1;
  const isFirst = stepIdx === 0;

  // Load draft text from stored answer whenever the question changes so a
  // buyer who navigates back sees their earlier text.
  useEffect(() => {
    if (currentQ) {
      setDraft(answers[currentQ.id] || "");
    }
  }, [stepIdx, currentQ, answers]);

  // Scroll bridge (standalone + HL iframe) on every step change.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    requestParentScrollToTop();
  }, [stepIdx]);

  const setAnswer = (id: string, value: any) =>
    setAnswers(prev => ({ ...prev, [id]: value }));

  // Finish/advance helper that takes the authoritative answers object
  // directly rather than reading from state. Fixes Codex P1 on #133:
  // the previous shape called setAnswer() (async) then onComplete(answers)
  // (sync) on the final question, which handed the worker a stale object
  // missing the last answer — every $47 diagnostic was shipping without
  // q28_twelve_month_objectives. Callers now build nextAnswers inline and
  // pass it here, so onComplete sees the committed final value.
  const finishOrAdvance = (nextAnswers: Record<string, any>) => {
    setAnswers(nextAnswers);
    if (isLast) {
      try { localStorage.removeItem(PROGRESS_KEY); } catch { /* ignore */ }
      onComplete(nextAnswers);
      return;
    }
    setStepIdx(i => i + 1);
  };

  // Business-info step uses the current answers object as-is (buyer edits
  // multiple fields in-place; nothing further to commit at step-change).
  const advanceFromBizInfo = () => {
    if (isLast) {
      try { localStorage.removeItem(PROGRESS_KEY); } catch { /* ignore */ }
      onComplete(answers);
      return;
    }
    setStepIdx(i => i + 1);
  };

  const handleBack = () => {
    if (!isFirst) setStepIdx(i => i - 1);
  };

  // For free-form questions, write the draft to answers on Continue so a
  // typo-fix mid-sentence doesn't rewrite history on every keystroke.
  const handleContinueText = () => {
    if (!currentQ) return;
    const trimmed = draft.trim();
    if (currentQ.required && !trimmed) return;
    const nextAnswers = { ...answers, [currentQ.id]: draft };
    finishOrAdvance(nextAnswers);
  };

  // Select questions auto-advance (same as the free tier).
  const handleSelect = (value: string) => {
    if (!currentQ) return;
    const nextAnswers = { ...answers, [currentQ.id]: value };
    finishOrAdvance(nextAnswers);
  };

  const progress = `${stepIdx + 1}/${totalSteps}`;

  return (
    <div className="w-full max-w-[720px] mx-auto pt-48 md:pt-64 pb-32 px-4 space-y-8">
      <div className="flex items-center justify-between">
        <button
          onClick={handleBack}
          className={`flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm font-medium ${
            isFirst ? "invisible" : ""
          }`}
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <TierEyebrow tier="paid_47" progress={progress} />
      </div>

      <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${((stepIdx + 1) / totalSteps) * 100}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>

      <AnimatePresence mode="wait">
        {isBusinessInfoStep ? (
          <motion.div
            key="biz-info"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="space-y-8 p-8 md:p-12 glass-card rounded-2xl border border-white/5 bg-card/40 backdrop-blur-xl shadow-card"
          >
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="flex h-7 min-w-[1.75rem] px-1.5 items-center justify-center rounded-full bg-primary/20 text-[11px] font-bold text-primary font-mono">
                  0
                </span>
                <h3 className="font-display text-3xl md:text-4xl text-foreground font-bold leading-tight">
                  Business Information
                </h3>
              </div>
              <p className="text-muted-foreground text-lg mt-2">
                A few quick details so we can anchor your diagnostic in the right context.
              </p>
            </div>

            <div className="space-y-6">
              <div className="space-y-4">
                <h4 className="font-display text-lg font-bold text-foreground">Contact</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="contact-name">Your Name</Label>
                    <Input
                      id="contact-name"
                      value={contact.name}
                      onChange={(e) => onContactChange({ ...contact, name: e.target.value })}
                      className="h-12 bg-secondary/40 mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="contact-email">Email</Label>
                    <Input
                      id="contact-email"
                      type="email"
                      value={contact.email}
                      onChange={(e) => onContactChange({ ...contact, email: e.target.value })}
                      className="h-12 bg-secondary/40 mt-1"
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <h4 className="font-display text-lg font-bold text-foreground">Business</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {PAID_TIER_47_BUSINESS_INFO.map((f) => {
                    const wide = f.id === "organization" || f.id === "website" || f.id === "industry";
                    return (
                      <div key={f.id} className={wide ? "md:col-span-2" : ""}>
                        <Label htmlFor={f.id}>{f.label}{f.required && " *"}</Label>
                        <Input
                          id={f.id}
                          value={answers[f.id] || ""}
                          onChange={(e) => setAnswer(f.id, e.target.value)}
                          placeholder={f.placeholder}
                          className="h-12 bg-secondary/40 mt-1"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <Button
              onClick={advanceFromBizInfo}
              className="w-full h-16 bg-primary text-primary-foreground font-bold text-lg rounded-xl shadow-glow-gold hover:scale-[1.01] transition-transform"
            >
              Continue →
            </Button>
          </motion.div>
        ) : currentQ ? (
          <motion.div
            key={currentQ.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <TieredQuestionCard
              badgeNumber={currentQ.qNumber.replace(/^Q/i, "")}
              title={currentQ.title}
              text={currentQ.text}
              type={
                currentQ.type === "dollar" ? "dollar" :
                currentQ.type === "select" ? "select" :
                "textarea"
              }
              value={draft}
              onChange={setDraft}
              onContinue={handleContinueText}
              onSelect={handleSelect}
              selectedValue={answers[currentQ.id]}
              placeholder={currentQ.placeholder}
              options={currentQ.options}
              continueLabel={isLast ? "Generate My Diagnostic →" : "Continue →"}
              continueDisabled={currentQ.required && !draft.trim()}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <SaveForLater emailHint />
    </div>
  );
};
