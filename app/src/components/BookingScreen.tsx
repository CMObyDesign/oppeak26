import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookingCalendar } from "./BookingCalendar";
import { Lock, Check, ArrowLeft } from "lucide-react";

// Rubric v3 narrowed the customer-facing classification to {rehab,
// needs-attention, growth}. Legacy "urgent" and "strong" are kept in
// the union so pre-v3 historical reports still render — new reports
// never emit them.
type PathClassification =
  | "rehab"
  | "needs-attention"
  | "growth"
  | "urgent"
  | "strong";

interface BookingScreenProps {
  score: number;
  path: PathClassification;
  onBack: () => void;
}

export const BookingScreen = ({ score, path, onBack }: BookingScreenProps) => {
  const headlines: Record<PathClassification, string> = {
    rehab:             "Reserve Your Stabilization Session",
    "needs-attention": "Reserve Your Strategy Session",
    growth:            "Claim Your Free Action Plan",
    // Legacy — pre-v3 reports.
    urgent:            "Reserve Your Strategy Session",
    strong:            "Schedule Your CFO Strategy Call",
  };

  const badgeStyles =
    path === "rehab" || path === "urgent" ? "bg-destructive/10 border-destructive/20 text-destructive" :
    path === "needs-attention" ? "bg-accent/10 border-accent/20 text-accent" :
    "bg-primary/10 border-primary/20 text-primary";

  const badgeLabels: Record<PathClassification, string> = {
    rehab:             "STABILIZE BEFORE GROWTH",
    "needs-attention": "SIGNALS TO ADDRESS",
    growth:            "GROWTH STAGE",
    // Legacy — pre-v3 reports.
    urgent:            "IMMEDIATE ACTION REQUIRED",
    strong:            "HIGH PERFORMER",
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-12 py-20">
      <div className="text-center space-y-6">
        <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border font-mono text-[10px] uppercase tracking-widest ${badgeStyles}`}>
          {badgeLabels[path]}
        </div>
        <h2 className="font-display text-4xl md:text-6xl text-foreground font-bold leading-tight">
          {headlines[path]}
        </h2>
        <p className="text-muted-foreground text-xl max-w-2xl mx-auto leading-relaxed">
          Our team reviews every submission personally. You'll hear from a CFO strategist within 1 business day.
        </p>
      </div>

      <div className="glass-card rounded-3xl border border-white/5 overflow-hidden shadow-2xl">
        <BookingCalendar 
          totalScore={score} 
          reportPath={path}
        />
      </div>

      <div className="text-center space-y-8">
        <div className="flex flex-wrap justify-center gap-8">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">
            <Lock className="h-3 w-3 text-accent" /> SSL Secured & Encrypted
          </div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">
            <Check className="h-3 w-3 text-accent" /> No Spam. No Obligation.
          </div>
        </div>
        
        <button
          onClick={onBack}
          className="group flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors font-mono uppercase tracking-[0.3em] mx-auto"
        >
          <ArrowLeft className="h-3 w-3 transition-transform group-hover:-translate-x-1" /> 
          Back to Report
        </button>
      </div>
    </div>
  );
};

