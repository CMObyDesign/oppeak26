import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import {
  PAID_TIER_297_QUESTIONS,
  PaidTier297Question,
  getPaid297Sections,
} from "@/data/paidTier297Questions";
import { uploadFile } from "@/lib/assessment";
import { SaveForLater } from "@/components/SaveForLater";
import { TieredQuestionCard, TierEyebrow } from "@/components/TieredQuestionCard";
import { requestParentScrollToTop } from "@/lib/iframe-resize";

interface Props {
  contact: { name: string; email: string; contactId?: string };
  onComplete: (answers: Record<string, any>) => void;
  // Prefill map, keyed by question id (same keys the survey uses in its
  // internal `answers` state). Today the only user is PaidTier297.tsx
  // seeding `annual_revenue` from the paid_47 → paid_297 handoff so
  // the buyer isn't asked for the same number twice (Codex P2 on #129).
  // Each key is applied ONCE on mount; the per-browser PROGRESS_KEY
  // resume (below) still wins if the buyer has a mid-survey draft
  // stored, so a re-mount with a different seed can never overwrite
  // their in-flight work.
  initialAnswers?: Record<string, any>;
}

interface UploadedFile { url: string; fileName: string; }

// Legacy-cursor migration (Codex P2 on #133). Pre-refactor $297 drafts
// stored sectionIdx against getPaid297Sections() — the first section
// held just annual_revenue, later sections held Q_A, Q_B, Q_C, etc. The
// new survey stores stepIdx against the flat PAID_TIER_297_QUESTIONS
// array, so a buyer who dropped mid-BGA before the refactor still lands
// close to where they stopped rather than being booted back to Q0.
function migrateLegacySectionIdx297(sectionIdx: number): number {
  if (sectionIdx <= 0) return 0;
  const sections = getPaid297Sections();
  if (sectionIdx >= sections.length) return PAID_TIER_297_QUESTIONS.length - 1;
  let offset = 0;
  for (let i = 0; i < sectionIdx; i++) {
    offset += sections[i].questions.length;
  }
  return Math.min(offset, PAID_TIER_297_QUESTIONS.length - 1);
}

// One-question-per-screen BGA intake using the shared TieredQuestionCard.
// Matches the free-tier visual language (gold numbered badge, Playfair
// headline, big card, trust footer, dot-progression eyebrow). The badge
// now carries Miguel's strategist-call letter codes (A, B, C, …, O), so
// a buyer and a strategist can refer to the same question by the same
// label on the call. The required-answer gate still blocks submission;
// jumping back to Q_O lands the user on the exact unanswered screen.
export const PaidTier297Survey = ({ contact, onComplete, initialAnswers }: Props) => {
  // Seed from initialAnswers on construction so the first paint reflects
  // the prefill. The PROGRESS_KEY resume below runs in an effect right
  // after mount and merges on top — if the buyer has a mid-survey draft,
  // its values win over the seed (Codex P2 on #130: explicit clears must
  // survive the reload, so the merge preserves present-but-empty values).
  const [answers, setAnswers] = useState<Record<string, any>>(() => ({ ...(initialAnswers || {}) }));
  const [stepIdx, setStepIdx] = useState(0);
  const [draft, setDraft] = useState<string>("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [requiredError, setRequiredError] = useState<string | null>(null);

  // Per-browser resume: a paid customer who drops mid-survey picks back up
  // (answers + uploaded-file references + where they were). The resume
  // merges ON TOP of initialAnswers: any KEY present in the stored draft
  // overwrites the seed (including a present-but-empty value — Codex P2
  // on #130: that is an explicit clear by the buyer and must survive the
  // reload). A KEY that was never typed into isn't in s.answers at all,
  // so the seed is preserved for it by the merge's inherent "missing key
  // means no overwrite" behavior.
  const PROGRESS_KEY = `swot_paid297_progress_${contact.contactId || "anon"}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s && typeof s === "object") {
        if (s.answers && typeof s.answers === "object") {
          setAnswers((prev) => ({ ...prev, ...s.answers }));
        }
        if (typeof s.stepIdx === "number") {
          setStepIdx(s.stepIdx);
        } else if (typeof s.sectionIdx === "number") {
          // Codex P2 on #133 — legacy cursor migration.
          setStepIdx(migrateLegacySectionIdx297(s.sectionIdx));
        }
        if (Array.isArray(s.uploadedFiles)) setUploadedFiles(s.uploadedFiles);
      }
    } catch { /* private mode or bad JSON — start fresh */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [PROGRESS_KEY]);
  useEffect(() => {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify({ answers, stepIdx, uploadedFiles }));
    } catch { /* localStorage disabled — skip */ }
  }, [PROGRESS_KEY, answers, stepIdx, uploadedFiles]);

  const totalSteps = PAID_TIER_297_QUESTIONS.length;
  const currentQ: PaidTier297Question = PAID_TIER_297_QUESTIONS[stepIdx];
  const isLast = stepIdx === totalSteps - 1;
  const isFirst = stepIdx === 0;

  // Hydrate the draft field whenever the question changes so a buyer who
  // navigates back sees their earlier text.
  useEffect(() => {
    setDraft(answers[currentQ.id] || "");
  }, [stepIdx, currentQ, answers]);

  // Scroll bridge (standalone + HL iframe) on every step change.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    requestParentScrollToTop();
  }, [stepIdx]);

  const setAnswer = (id: string, value: any) =>
    setAnswers(prev => ({ ...prev, [id]: value }));

  // Takes answers as a parameter so finishIntake can validate against the
  // final nextAnswers object (built inline from draft + answers) rather
  // than against the state closure that hasn't batched yet. Codex P1 on
  // #133 — otherwise the last BGA question's response is dropped before
  // the worker request.
  const missingRequired = (
    answersSrc: Record<string, any>,
  ): { q: PaidTier297Question; stepIdx: number } | null => {
    for (let i = 0; i < PAID_TIER_297_QUESTIONS.length; i++) {
      const q = PAID_TIER_297_QUESTIONS[i];
      if (!q.required) continue;
      const v = answersSrc[q.id];
      if (typeof v !== "string" || !v.trim()) return { q, stepIdx: i };
    }
    return null;
  };

  // finishIntake takes the authoritative answers object directly rather
  // than reading from state. Fixes Codex P1 on #133: the previous shape
  // called setAnswer() (async) then relied on a setTimeout(() => finishIntake())
  // one tick later to read the "updated" answers — but React batches state
  // updates and the closure still captured the stale object, so the last
  // BGA question's response was being dropped before the worker request.
  // Callers now build nextAnswers inline and pass it here.
  const finishIntake = (nextAnswers: Record<string, any>) => {
    const missing = missingRequired(nextAnswers);
    if (missing) {
      setAnswers(nextAnswers);
      setRequiredError(
        `Please answer "${missing.q.title}" before generating your report. This is the single most important input for your strategist call.`,
      );
      setStepIdx(missing.stepIdx);
      return;
    }
    setAnswers(nextAnswers);
    setRequiredError(null);
    try { localStorage.removeItem(PROGRESS_KEY); } catch { /* ignore */ }
    onComplete({
      ...nextAnswers,
      supporting_documents: uploadedFiles.map(f => f.url),
    });
  };

  const handleContinue = () => {
    const trimmed = draft.trim();
    if (currentQ.required && !trimmed) {
      setRequiredError(
        `Please answer "${currentQ.title}" before continuing. This is the single most important input for your strategist call.`,
      );
      return;
    }
    setRequiredError(null);
    const nextAnswers = { ...answers, [currentQ.id]: draft };
    if (isLast) {
      finishIntake(nextAnswers);
      return;
    }
    setAnswers(nextAnswers);
    setStepIdx(i => i + 1);
  };

  const handleFileContinue = () => {
    setRequiredError(null);
    if (isLast) {
      // File-upload questions don't write to `answers` — uploads live in
      // their own `uploadedFiles` state and are folded into the payload
      // by finishIntake. Pass the current answers through unchanged.
      finishIntake(answers);
      return;
    }
    setStepIdx(i => i + 1);
  };

  const handleBack = () => {
    if (!isFirst) {
      setRequiredError(null);
      setStepIdx(i => i - 1);
    }
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    const results = await Promise.all(
      Array.from(files).map(f => uploadFile(f, contact.contactId))
    );
    const successful = results
      .filter(r => r.success && r.url)
      .map(r => ({ url: r.url!, fileName: r.fileName }));
    const failed = results.filter(r => !r.success);

    if (failed.length > 0) {
      setUploadError(`${failed.length} file(s) failed: ${failed[0].error || "Unknown error"}`);
    }

    setUploadedFiles(prev => [...prev, ...successful]);
    setUploading(false);
  };

  const removeFile = (idx: number) =>
    setUploadedFiles(prev => prev.filter((_, i) => i !== idx));

  // Badge: strip the "Q_" prefix so "Q_A" → "A", "Q_O" → "O". For the
  // business-context revenue question (qNumber "—"), render a bullet.
  const badge = currentQ.qNumber === "—" ? "•" : currentQ.qNumber.replace(/^Q_?/i, "");
  const progress = `${stepIdx + 1}/${totalSteps}`;
  const continueLabel = isLast ? "Generate My Business Growth Analysis →" : "Continue →";

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
        <TierEyebrow tier="paid_297" progress={progress} />
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
        <motion.div
          key={currentQ.id}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          <TieredQuestionCard
            badgeNumber={badge}
            title={currentQ.title}
            text={currentQ.text}
            type={currentQ.type}
            value={draft}
            onChange={setDraft}
            onContinue={currentQ.type === "file" ? handleFileContinue : handleContinue}
            placeholder={currentQ.placeholder}
            continueLabel={continueLabel}
            continueDisabled={currentQ.required && currentQ.type !== "file" && !draft.trim()}
            // File-upload wiring
            uploadedFiles={uploadedFiles}
            uploading={uploading}
            uploadError={uploadError}
            acceptFileTypes={currentQ.acceptFileTypes}
            multipleFiles={currentQ.multipleFiles}
            onFileSelect={handleFileSelect}
            onFileRemove={removeFile}
            footerSlot={
              requiredError ? (
                <div className="text-sm text-destructive font-medium p-3 bg-destructive/10 rounded-lg border border-destructive/20">
                  {requiredError}
                </div>
              ) : null
            }
          />
        </motion.div>
      </AnimatePresence>

      <SaveForLater emailHint />
    </div>
  );
};
