import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ArrowLeft } from "lucide-react";
import {
  PAID_TIER_47_BUSINESS_INFO,
  getPaid47Sections,
  PaidTier47Question,
} from "@/data/paidTier47Questions";

interface Props {
  contact: { name: string; email: string; contactId?: string };
  onContactChange: (c: { name: string; email: string; contactId?: string }) => void;
  onComplete: (answers: Record<string, any>) => void;
}

export const PaidTier47Survey = ({ contact, onContactChange, onComplete }: Props) => {
  const [sectionIdx, setSectionIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});

  const questionSections = getPaid47Sections();
  // Business info is the first section
  const allSections = [
    { name: "Business Information", questions: [], isBusinessInfo: true },
    ...questionSections.map(s => ({ ...s, isBusinessInfo: false })),
  ] as any[];

  const currentSection = allSections[sectionIdx];
  const isLast = sectionIdx === allSections.length - 1;
  const isFirst = sectionIdx === 0;

  const setAnswer = (id: string, value: any) =>
    setAnswers(prev => ({ ...prev, [id]: value }));

  const handleNext = () => {
    if (isLast) onComplete(answers);
    else {
      setSectionIdx(i => i + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleBack = () => {
    if (!isFirst) {
      setSectionIdx(i => i - 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const renderQuestion = (q: PaidTier47Question) => {
    const value = answers[q.id] || "";
    switch (q.type) {
      case "dollar":
        return (
          <Input
            type="text"
            value={value}
            onChange={(e) => setAnswer(q.id, e.target.value)}
            placeholder={q.placeholder}
            className="h-14 bg-secondary/40"
          />
        );
      case "textarea":
        return (
          <Textarea
            value={value}
            onChange={(e) => setAnswer(q.id, e.target.value)}
            placeholder={q.placeholder || "Type your response here"}
            className="min-h-[120px] bg-secondary/40"
          />
        );
      case "select":
        return (
          <div className="space-y-3">
            {q.options?.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setAnswer(q.id, opt.value)}
                className={`w-full text-left p-4 rounded-xl border transition-all ${
                  value === opt.value
                    ? "bg-primary/10 border-primary"
                    : "bg-secondary/40 border-border hover:border-primary/50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto pt-48 md:pt-64 pb-32 px-4 space-y-8">
      <div className="text-center space-y-2">
        <p className="text-xs font-bold text-accent uppercase tracking-[0.3em]">$47 FULL DIAGNOSTIC</p>
        <h2 className="font-display text-3xl md:text-4xl font-bold">{currentSection.name}</h2>
        <p className="text-sm text-muted-foreground">Section {sectionIdx + 1} of {allSections.length}</p>
      </div>

      <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${((sectionIdx + 1) / allSections.length) * 100}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={sectionIdx}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="space-y-8 bg-card/40 border border-white/5 rounded-2xl p-8"
        >
          {currentSection.isBusinessInfo ? (
            <>
              <div className="space-y-4">
                <h3 className="font-display text-lg font-bold">Contact</h3>
                <div className="space-y-3">
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
                <h3 className="font-display text-lg font-bold">Business</h3>
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
            </>
          ) : (
            currentSection.questions.map((q: PaidTier47Question) => (
              <div key={q.id} className="space-y-3">
                <div className="space-y-1">
                  <p className="text-xs text-accent font-mono uppercase tracking-widest">{q.qNumber} · {q.title}</p>
                  <p className="text-base text-foreground font-medium">{q.text}</p>
                </div>
                {renderQuestion(q)}
              </div>
            ))
          )}
        </motion.div>
      </AnimatePresence>

      <div className="flex justify-between items-center pt-4">
        {!isFirst ? (
          <Button onClick={handleBack} variant="ghost" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
        ) : <div />}
        <Button onClick={handleNext} className="h-14 px-8 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-xl">
          {isLast ? "Generate My Diagnostic →" : "Continue →"}
        </Button>
      </div>
    </div>
  );
};

