import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FREE_ASSESSMENT_SECTIONS, FreeAssessmentQuestion } from "@/data/freeAssessmentQuestions";
import { getReadableAnswer } from "@/lib/assessment";
import { GHL_SURVEY_SUBMIT_URL } from "@/lib/ghl-config";
import { QuestionCard } from "./QuestionCard";
import { ProgressBar } from "./ProgressBar";
import { SaveForLater } from "./SaveForLater";
import { TierEyebrow } from "./TieredQuestionCard";
import { ArrowLeft } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const FREE_PROGRESS_KEY = "swot_free_assessment_progress";

interface AssessmentScreenProps {
  onComplete: (answers: Record<number, any>, leadData?: { name: string; email: string; businessName?: string; contactId?: string }) => void;
}

// Shape of a public business email that we'll accept at the gate. Rejects
// bare words and obviously-not-email strings, which the HTML5 `required`
// attribute passes through. Server-side validation is a separate, stricter
// pass; this one just stops the obvious typos ("name", "name@") and the
// "I pasted my business name instead of my email" case from creating a
// contact + report flow at all.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const AssessmentScreen = ({ onComplete }: AssessmentScreenProps) => {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, any>>({});
  const [selectedOption, setSelectedOption] = useState<number | string | null>(null);
  const [showLeadCapture, setShowLeadCapture] = useState(false);
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasCapturedLead, setHasCapturedLead] = useState(false);
  const [contactId, setContactId] = useState<string | undefined>(undefined);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<Record<string, any> | null>(null);

  // Per-field validation. Empty string = clean; non-empty string = the
  // message to render inline under the field. Cleared on edit so the
  // customer gets immediate feedback that the fix was accepted.
  const [errName, setErrName] = useState("");
  const [errBusinessName, setErrBusinessName] = useState("");
  const [errEmail, setErrEmail] = useState("");

  // Mid-flow email edit (shown after the contact gate — "Report email: X · Edit").
  // Solves the "wrong email, trapped by Back" problem the Codex review called
  // out: a customer who typo'd their email during the gate can fix it without
  // walking back through every answered question. Edits only update local
  // state; the next survey submit re-POSTs with the corrected address and
  // HL's upsert handles reconciliation.
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");

  // Flatten questions and inject section titles
  const questions = FREE_ASSESSMENT_SECTIONS.flatMap(section => 
    section.questions.map(q => ({ ...q, sectionTitle: section.title }))
  );

  const currentQuestion = questions[currentIdx];

  const handleSelect = (value: number | string) => {
    setSelectedOption(value);
    
    // Auto-advance logic
    setTimeout(() => {
      const newAnswers = { ...answers, [currentQuestion.id]: value };
      setAnswers(newAnswers);
      setSelectedOption(null);
      
      // Trigger email gate after Q3 (Intake Profile is Q1-Q3)
      if (currentQuestion.id === 3 && !hasCapturedLead) {
        setShowLeadCapture(true);
        return;
      }

      if (currentIdx < questions.length - 1) {
        setCurrentIdx(currentIdx + 1);
      } else {
        // Complete the assessment
        handleSubmitFinal(newAnswers);
      }
    }, currentQuestion.type === "select" ? 400 : 0); // Only delay for select to show visual feedback
  };

  const handleBack = () => {
    if (showLeadCapture) {
      // Cannot go back from lead capture easily without losing flow, but we can allow it
      setShowLeadCapture(false);
      return;
    }
    if (currentIdx > 0) {
      setCurrentIdx(currentIdx - 1);
      setSelectedOption(null);
    }
  };

  const handleSubmitLead = async (e: React.FormEvent) => {
    e.preventDefault();

    // Field-by-field validation with inline error messages. The wording is
    // locked by product (Codex #133 directive 2026-10-17): kept verbatim.
    const trimmedName = name.trim();
    const trimmedBiz  = businessName.trim();
    const trimmedEmail = email.trim();
    let hasError = false;
    if (!trimmedName) {
      setErrName("Please enter your name.");
      hasError = true;
    } else { setErrName(""); }
    if (!trimmedBiz) {
      setErrBusinessName("Please enter your business name.");
      hasError = true;
    } else { setErrBusinessName(""); }
    if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
      setErrEmail("Please enter a valid email address, like name@company.com.");
      hasError = true;
    } else { setErrEmail(""); }
    if (hasError) return;

    setIsSubmitting(true);
    
    try {
      const formData = new FormData();
      formData.append("first_name", name.split(" ")[0]);
      formData.append("last_name", name.split(" ").slice(1).join(" "));
      formData.append("email", email);
      formData.append("company", businessName);
      
      // Add answers to formData up to this point
      Object.entries(answers).forEach(([qId, val]) => {
        const q = questions.find(x => x.id === Number(qId));
        if (q && q.fieldKey) {
          const readableVal = getReadableAnswer(val, q.options);
          formData.append(q.fieldKey, readableVal);
        }
      });

      const response = await fetch(GHL_SURVEY_SUBMIT_URL, {
        method: "POST",
        body: formData,
      });
      
      const data = await response.json();
      if (data.contactId) {
        setContactId(data.contactId);
      }
    } catch (error) {
      console.error("Error submitting to HighLevel:", error);
    } finally {
      setIsSubmitting(false);
      setHasCapturedLead(true);
      setShowLeadCapture(false);
      setCurrentIdx(currentIdx + 1); // Move to Q4
    }
  };

  const handleSubmitFinal = async (finalAnswers: Record<number, any>) => {
    try {
      const formData = new FormData();
      formData.append("first_name", name.split(" ")[0]);
      formData.append("last_name", name.split(" ").slice(1).join(" "));
      formData.append("email", email);
      formData.append("company", businessName);
      
      // Add all answers to formData
      Object.entries(finalAnswers).forEach(([qId, val]) => {
        const q = questions.find(x => x.id === Number(qId));
        if (q && q.fieldKey) {
          const readableVal = getReadableAnswer(val, q.options);
          formData.append(q.fieldKey, readableVal);
        }
      });

      const response = await fetch(GHL_SURVEY_SUBMIT_URL, {
        method: "POST",
        body: formData,
      });
      
      const data = await response.json();
      if (data.contactId) {
        setContactId(data.contactId);
      }
    } catch (error) {
      console.error("Error submitting final to HighLevel:", error);
    } finally {
      // Completed — clear the saved draft so a fresh visit starts clean.
      try { localStorage.removeItem(FREE_PROGRESS_KEY); } catch { /* ignore */ }
      onComplete(finalAnswers, { name, email, businessName, contactId });
    }
  };

  // On mount, look for a saved draft — but DON'T silently restore it. On a
  // shared browser, silent restore would hand the next visitor the previous
  // person's name/email/contactId (and could submit their answers under the
  // prior lead's identity, corrupting that CRM record). Instead offer an
  // explicit Resume / Start-fresh choice, and expire stale drafts.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FREE_PROGRESS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
      if (!s || typeof s !== "object" || typeof s.ts !== "number" || Date.now() - s.ts > TTL_MS) {
        localStorage.removeItem(FREE_PROGRESS_KEY);
        return;
      }
      setPendingDraft(s);
      setShowResumePrompt(true);
    } catch { localStorage.removeItem(FREE_PROGRESS_KEY); /* bad JSON — start fresh */ }
  }, []);

  const resumeDraft = () => {
    const s = pendingDraft;
    if (s) {
      if (s.answers && typeof s.answers === "object") setAnswers(s.answers);
      if (typeof s.currentIdx === "number") setCurrentIdx(s.currentIdx);
      if (s.name) setName(s.name);
      if (s.businessName) setBusinessName(s.businessName);
      if (s.email) setEmail(s.email);
      if (s.hasCapturedLead) setHasCapturedLead(true);
      if (s.contactId) setContactId(s.contactId);
    }
    setShowResumePrompt(false);
    setPendingDraft(null);
  };

  const startFresh = () => {
    try { localStorage.removeItem(FREE_PROGRESS_KEY); } catch { /* ignore */ }
    setShowResumePrompt(false);
    setPendingDraft(null);
  };

  // Persist progress with a timestamp (for expiry). Paused while the resume
  // prompt is open so we don't clobber the draft we're offering to restore.
  useEffect(() => {
    if (showResumePrompt) return;
    try {
      localStorage.setItem(FREE_PROGRESS_KEY, JSON.stringify({
        currentIdx, answers, name, businessName, email, hasCapturedLead, contactId, ts: Date.now(),
      }));
    } catch { /* localStorage disabled — skip, non-fatal */ }
  }, [showResumePrompt, currentIdx, answers, name, businessName, email, hasCapturedLead, contactId]);

  // Exit prevention logic
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 pt-48 md:pt-64">
      {showResumePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-4">
          <div className="w-full max-w-md bg-card border border-border rounded-2xl p-6 text-center shadow-xl">
            <h3 className="font-display text-xl font-bold text-foreground mb-2">Welcome back</h3>
            <p className="text-sm text-muted-foreground mb-5">We saved your progress on this device. Resume where you left off, or start a new assessment.</p>
            <div className="flex gap-3 justify-center">
              <button onClick={resumeDraft} className="h-11 px-5 rounded-lg bg-primary text-primary-foreground font-bold">Resume</button>
              <button onClick={startFresh} className="h-11 px-5 rounded-lg bg-secondary/40 border border-border text-foreground font-medium">Start fresh</button>
            </div>
          </div>
        </div>
      )}
      <ProgressBar current={showLeadCapture ? 4 : currentIdx + 1} total={questions.length} />
      
      <div className="w-full max-w-[640px] space-y-8">
        <div className="flex items-center justify-between">
          <button
            onClick={handleBack}
            className={`flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm font-medium ${
              currentIdx === 0 && !showLeadCapture ? "invisible" : ""
            }`}
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          {!showLeadCapture && (
            <TierEyebrow
              tier="free"
              progress={`${currentIdx + 1}/${questions.length}`}
            />
          )}
        </div>

        {/* Persistent "Report email" affordance — shown after the contact gate
            so a buyer who typo'd their address can fix it without walking back
            through every answered question (Codex #133 directive 2026-10-17).
            Only renders in the quiz view, not during the lead-capture form or
            while editing (the gate form is already an editable surface). */}
        {hasCapturedLead && !showLeadCapture && email && (
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            {editingEmail ? (
              <form
                className="flex items-stretch gap-2 w-full max-w-md"
                onSubmit={(e) => {
                  e.preventDefault();
                  const trimmed = emailDraft.trim();
                  if (!EMAIL_RE.test(trimmed)) {
                    setErrEmail("Please enter a valid email address, like name@company.com.");
                    return;
                  }
                  setEmail(trimmed);
                  setEditingEmail(false);
                  setErrEmail("");
                }}
              >
                <Input
                  type="email"
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  placeholder="name@company.com"
                  className="h-9 flex-1 bg-background text-sm"
                  autoFocus
                />
                <Button type="submit" size="sm" className="h-9 px-3">Save</Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 px-3"
                  onClick={() => { setEditingEmail(false); setErrEmail(""); }}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <>
                <span>Report email: <span className="text-foreground font-medium">{email}</span></span>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  onClick={() => { setEmailDraft(email); setEditingEmail(true); }}
                  className="text-primary hover:underline font-medium"
                >
                  Edit
                </button>
              </>
            )}
          </div>
        )}
        {hasCapturedLead && !showLeadCapture && errEmail && !editingEmail && (
          <p className="text-xs text-destructive text-center">{errEmail}</p>
        )}

        <AnimatePresence mode="wait">
          {showLeadCapture ? (
            <motion.div
              key="lead-capture"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-card border border-border rounded-2xl p-8 md:p-12 shadow-xl"
            >
              <div className="text-center space-y-4 mb-8">
                <h2 className="font-display text-3xl font-bold text-foreground">Where should we send your Business Health Check?</h2>
                <p className="text-muted-foreground">Enter your information below and we'll email you a copy of your results.</p>
              </div>

              <form onSubmit={handleSubmitLead} className="space-y-6" noValidate>
                <div className="space-y-2">
                  <Label htmlFor="name">First and Last Name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => { setName(e.target.value); if (errName) setErrName(""); }}
                    placeholder="John Doe"
                    className="h-14 bg-background"
                    aria-invalid={!!errName}
                    aria-describedby={errName ? "err-name" : undefined}
                  />
                  {errName && (
                    <p id="err-name" className="text-sm text-destructive">{errName}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="businessName">Business Name</Label>
                  <Input
                    id="businessName"
                    value={businessName}
                    onChange={(e) => { setBusinessName(e.target.value); if (errBusinessName) setErrBusinessName(""); }}
                    placeholder="Acme Corp"
                    className="h-14 bg-background"
                    aria-invalid={!!errBusinessName}
                    aria-describedby={errBusinessName ? "err-business" : undefined}
                  />
                  {errBusinessName && (
                    <p id="err-business" className="text-sm text-destructive">{errBusinessName}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); if (errEmail) setErrEmail(""); }}
                    placeholder="john@company.com"
                    className="h-14 bg-background"
                    aria-invalid={!!errEmail}
                    aria-describedby={errEmail ? "err-email" : "email-helper"}
                  />
                  {errEmail ? (
                    <p id="err-email" className="text-sm text-destructive">{errEmail}</p>
                  ) : (
                    <p id="email-helper" className="text-xs text-muted-foreground">
                      We'll use this email to send your results and related follow-up from CFO By Design.
                    </p>
                  )}
                </div>
                <Button
                  type="submit"
                  className="w-full h-14 text-lg font-bold bg-primary hover:bg-primary/90 text-primary-foreground"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Processing..." : "Continue Analysis →"}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Your information is secure and will never be shared.
                </p>
              </form>
            </motion.div>
          ) : (
            <motion.div
              key={currentIdx}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              <QuestionCard
                question={currentQuestion}
                selectedOption={selectedOption}
                onSelect={handleSelect}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <SaveForLater />
      </div>
    </div>
  );
};

