import { motion } from "framer-motion";
import { Check, Info } from "lucide-react";
import { FreeAssessmentQuestion } from "@/data/freeAssessmentQuestions";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { useState } from "react";

interface QuestionCardProps {
  question: FreeAssessmentQuestion;
  selectedOption: number | string | null;
  onSelect: (value: number | string) => void;
}

// Filler-rejection set for narrative questions (Q6-Q11 per the FREE HEALTH
// CHECK COMPLETENESS CONTRACT). Normalized compare: trimmed + lowercased.
// Truthful uncertainty like "not sure yet" is NOT in this set — those are
// valid customer answers per the contract and must be passed to the worker
// as stated.
const FILLER_RESPONSES = new Set([
  "idk", "n/a", "na", "n.a.", "n/a.", "none", "nothing",
  "-", "--", "?", "??", ".", "..",
  "test", "testing", "asdf", "qwer", "qwerty", "xxx", "xxxx",
]);

// Narrative-answer validator. Returns an error string when the response
// should be rejected; empty string when the response is acceptable. The
// rule set comes from the customer directive (2026-10-17): no blank, no
// obvious filler, no single generic word that does not actually answer
// the question. Allows truthful uncertainty by rejecting only on the
// filler list above, not on sentence length.
function validateNarrativeAnswer(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "Please share a short response, even if it's just a sentence.";
  const normalized = trimmed.toLowerCase();
  if (FILLER_RESPONSES.has(normalized)) {
    return "Please give an actual answer. If you're not sure, say that honestly — \"Not sure yet\" or \"We don't have one\" are valid responses.";
  }
  // Single-word rejection, but only when the single word is a filler-adjacent
  // non-answer. Legitimate one-word answers (a specific client name, a
  // specific channel, a dollar figure) are fine; the ban is specifically on
  // generic non-answers that happen to be one word.
  const words = trimmed.split(/\s+/);
  if (words.length === 1 && normalized.length < 4) {
    return "A one-word answer isn't quite enough here. Give one specific example, or if there isn't one, say so.";
  }
  return "";
}

export const QuestionCard = ({ question, selectedOption, onSelect }: QuestionCardProps) => {
  const [openText, setOpenText] = useState("");
  const [textError, setTextError] = useState<string>("");

  const handleTextSubmit = () => {
    if (question.type === "textarea" || question.type === "text") {
      const err = validateNarrativeAnswer(openText);
      if (err) {
        setTextError(err);
        return;
      }
    }
    setTextError("");
    onSelect(openText);
  };

  return (
    <div className="space-y-8 p-8 md:p-12 glass-card rounded-2xl border border-white/5 bg-card/40 backdrop-blur-xl shadow-card transition-all duration-200">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">
            {question.id}
          </span>
          <h3 className="font-display text-3xl md:text-4xl text-foreground font-bold leading-tight">
            {question.title}
          </h3>
        </div>
        <p className="text-muted-foreground text-lg mt-2">
          {question.text}
        </p>
      </div>

      <div className="grid gap-4">
        {question.type === "textarea" && (
          <div className="space-y-6">
            <Textarea
              placeholder={question.placeholder || "Type your response here..."}
              className={`min-h-[160px] bg-secondary/40 border-border focus:border-primary focus:ring-primary/20 text-foreground resize-none rounded-xl p-6 text-lg ${
                textError ? "border-destructive focus:border-destructive focus:ring-destructive/20" : ""
              }`}
              value={openText}
              onChange={(e) => { setOpenText(e.target.value); if (textError) setTextError(""); }}
              aria-invalid={!!textError}
              aria-describedby={textError ? `q${question.id}-err` : undefined}
            />
            {textError && (
              <p id={`q${question.id}-err`} className="text-sm text-destructive font-medium" role="alert">
                {textError}
              </p>
            )}
            <Button
              onClick={handleTextSubmit}
              className="w-full h-16 bg-primary text-primary-foreground font-bold text-lg rounded-xl shadow-glow-gold hover:scale-[1.01] transition-transform"
            >
              Continue →
            </Button>
          </div>
        )}

        {question.type === "text" && (
          <div className="space-y-6">
            <Input
              placeholder={question.placeholder || "Type your response here..."}
              className={`h-14 bg-secondary/40 border-border focus:border-primary focus:ring-primary/20 text-foreground rounded-xl px-6 text-lg ${
                textError ? "border-destructive focus:border-destructive focus:ring-destructive/20" : ""
              }`}
              value={openText}
              onChange={(e) => { setOpenText(e.target.value); if (textError) setTextError(""); }}
              aria-invalid={!!textError}
              aria-describedby={textError ? `q${question.id}-err` : undefined}
            />
            {textError && (
              <p id={`q${question.id}-err`} className="text-sm text-destructive font-medium" role="alert">
                {textError}
              </p>
            )}
            <Button
              onClick={handleTextSubmit}
              className="w-full h-16 bg-primary text-primary-foreground font-bold text-lg rounded-xl shadow-glow-gold hover:scale-[1.01] transition-transform"
            >
              Continue →
            </Button>
          </div>
        )}

        {question.type === "select" && question.options && (
          question.options.map((option, idx) => (
            <motion.button
              key={idx}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => onSelect(option.value)}
              className={`w-full p-6 text-left rounded-xl border transition-all flex items-center justify-between group relative overflow-hidden ${
                selectedOption === option.value
                  ? "bg-primary/10 border-primary border-l-[3px]"
                  : "bg-secondary/40 border-border hover:border-primary/50 hover:bg-primary/5"
              }`}
            >
              <span className={`text-lg transition-colors ${
                selectedOption === option.value ? "text-foreground font-medium" : "text-muted-foreground group-hover:text-foreground"
              }`}>
                {option.label}
              </span>
              <div className={`h-6 w-6 rounded-full border flex items-center justify-center transition-colors ${
                selectedOption === option.value ? "border-primary bg-primary" : "border-white/10 group-hover:border-primary/50"
              }`}>
                {selectedOption === option.value && <Check className="h-4 w-4 text-primary-foreground" />}
              </div>
            </motion.button>
          ))
        )}
      </div>

      {question.id <= 3 && (
        <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground uppercase tracking-widest pt-4">
          <Info className="h-3 w-3" />
          <span>Your answer is anonymous until you choose to share it.</span>
        </div>
      )}
    </div>
  );
};

