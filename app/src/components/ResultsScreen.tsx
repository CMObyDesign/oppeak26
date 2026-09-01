import { useState } from "react";
import { useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { SwotQuadrant } from "./SwotQuadrant";
import { GapCard } from "./GapCard";
import { OpportunityCard } from "./OpportunityCard";
import { Button } from "@/components/ui/button";
import { Input } from "./ui/input";
import { Activity, Target, CheckCircle2, ShieldCheck, Zap, Users, BarChart3, Calculator, Calendar, Sparkles, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { AgentReport } from "@/lib/assessment";
import { CountdownTimer } from "./CountdownTimer";
import { OFFERS, getRemainingTime } from "@/lib/offerTiming";
import { PAYMENT_LINK_47, PAYMENT_LINK_297 } from "@/lib/ghl-config";
import { navigateExternal } from "@/lib/navigate-external";

const BETA_MID_ANALYSIS_URL = "https://success.cfobydesign.com/mid-analysis";
const APPLY_SOLOMON50_URL = "https://swot-engine.cfobydesign.workers.dev/apply-solomon50";

interface ResultsScreenProps {
  report: AgentReport | null;
  error: string | null;
  answers: Record<number, any>;
  leadData: { name: string; email: string; businessName?: string; contactId?: string } | null;
  onCtaClick: () => void;
}

const PATH_STYLE: Record<string, { score: string; badge: string }> = {
  rehab:  { score: "text-destructive", badge: "bg-destructive/10 border-destructive/20 text-destructive" },
  urgent: { score: "text-destructive", badge: "bg-destructive/10 border-destructive/20 text-destructive" },
  growth: { score: "text-primary",     badge: "bg-primary/10 border-primary/20 text-primary" },
  strong: { score: "text-accent",      badge: "bg-accent/10 border-accent/20 text-accent" },
};

export const ResultsScreen = ({ report, error, answers, leadData, onCtaClick }: ResultsScreenProps) => {
  const location = useLocation();
  const isBeta = location.pathname.startsWith("/beta");
  const [couponCode, setCouponCode] = useState("");
  const [couponStatus, setCouponStatus] = useState<"idle" | "invalid" | "applying" | "applied">("idle");

  const handleApplyCoupon = async () => {
    const code = couponCode.trim().toUpperCase();
    if (code !== "SOLOMON50") {
      setCouponStatus("invalid");
      return;
    }
    setCouponStatus("applying");
    // Best-effort tag write to worker for beta cohort tracking. The worker
    // accepts either contactId (preferred) or email (upserts by email so the
    // tag write works even when the React lead-capture POST didn't create a
    // GHL contact upstream — the common case when VITE_GHL_SURVEY_SUBMIT_URL
    // isn't set on Cloudflare Pages). We capture the returned contactId so
    // the mid-analysis redirect carries it and downstream tier gates work.
    let resolvedContactId: string | undefined = leadData?.contactId;
    try {
      const res = await fetch(APPLY_SOLOMON50_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: leadData?.contactId,
          email: leadData?.email,
          name: leadData?.name,
          businessName: leadData?.businessName,
          code,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.contactId) resolvedContactId = data.contactId;
    } catch {
      // Non-blocking — proceed to redirect regardless.
    }
    const target = resolvedContactId
      ? `${BETA_MID_ANALYSIS_URL}?contact_id=${encodeURIComponent(resolvedContactId)}`
      : BETA_MID_ANALYSIS_URL;
    navigateExternal(target);
  };
  if (error || !report) {
    return (
      <div className="w-full max-w-2xl mx-auto pt-48 md:pt-64 pb-32 px-4 text-center space-y-6">
        <h2 className="font-display text-3xl font-bold text-destructive">Report unavailable</h2>
        <p className="text-muted-foreground">
          We could not generate your report just now. Please refresh and try again, or email{" "}
          <a className="underline" href="mailto:support@cfobydesign.com">support@cfobydesign.com</a>.
        </p>
        {error && <pre className="text-xs text-left text-muted-foreground bg-secondary/30 p-4 rounded-xl overflow-x-auto">{error}</pre>}
      </div>
    );
  }

  const style = PATH_STYLE[report.path] ?? PATH_STYLE.growth;

  return (
    <div className="w-full max-w-5xl mx-auto space-y-16 pt-48 md:pt-64 pb-32 px-4">
      {/* Header */}
      <div className="text-center space-y-6">
        <p className="text-xs md:text-sm font-bold text-accent uppercase tracking-[0.3em]">
          YOUR BUSINESS HEALTH REPORT
        </p>

        <div className="flex justify-center">
          <div className={`px-4 py-1.5 rounded-full font-bold text-xs tracking-[0.2em] uppercase border ${style.badge}`}>
            {report.badge}
          </div>
        </div>

        <div className="space-y-6 max-w-3xl mx-auto">
          <h2 className="font-display text-3xl md:text-5xl text-foreground font-bold leading-tight">
            {leadData?.name ? `${leadData.name.split(' ')[0]}, your` : "Your"} assessment is back.
          </h2>
          <div className="p-8 rounded-2xl bg-secondary/30 border border-white/5 text-left space-y-4">
            <p className="text-2xl text-foreground font-display font-bold leading-snug">
              {report.headline}
            </p>
            <p className="text-xl text-foreground font-medium leading-relaxed">{report.opener}</p>
            {report.context && <p className="text-sm font-medium text-muted-foreground italic">{report.context}</p>}
          </div>
        </div>
      </div>

      {/* The Gap Section */}
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="p-8 rounded-2xl border border-primary/20 bg-primary/5 space-y-6">
          <div className="flex items-center gap-3">
            <Activity className="h-6 w-6 text-primary" />
            <h3 className="font-display text-2xl font-bold uppercase tracking-wider">The Gap</h3>
          </div>
          <p className="text-lg text-muted-foreground leading-relaxed">
            Your free assessment was just the surface read. The full diagnostic goes seventeen questions deeper, across the categories that actually decide your funding: cash flow, debt load, credit access, profit margin, and whether anyone is in your corner on strategy. You cannot fix what you cannot see, and right now you are seeing a fraction of the board.
          </p>
        </div>
      </div>

      {/* The Story Section */}
      <div className="max-w-3xl mx-auto space-y-8 py-12">
        <div className="space-y-6">
          <h3 className="font-display text-3xl font-bold">The Story</h3>
          <div className="space-y-4 text-muted-foreground leading-relaxed text-lg">
            <p>
              For over fifteen years, Miguel Hernandez and his team sat across from business owners making million dollar decisions off their bank balance instead of their real numbers. Owners who needed more than a bookkeeper. People who needed someone who understood corporate finance, mergers and acquisitions, debt strategy, and how to actually get funded. The team could only help so many at a time, and that never sat right with them.
            </p>
            <p>
              So they built something. They took the way the team reads a business, the questions they ask, the patterns they watch for, refined across more than 2,400 companies, and put it into an assistant. It runs your full diagnostic in minutes using the exact logic the team uses with their highest-value clients. That is what powers your report.
            </p>
            <p className="text-foreground font-medium italic">
              A report is not a relationship. The assistant shows you what is happening. The team shows you what to do about it. That is why your $47 includes time with a real strategist, not just a download.
            </p>
          </div>
        </div>
      </div>

      {/* SWOT visualization — back as requested */}
      <div className="space-y-8 py-12 border-t border-white/5">
        <div className="flex items-center gap-3 justify-center">
          <Activity className="h-5 w-5 text-primary" />
          <h3 className="font-display text-2xl font-bold uppercase tracking-widest">Financial Health Breakdown</h3>
        </div>
        <SwotQuadrant categoryScores={{}} score={report.path === "strong" ? 25 : report.path === "growth" ? 18 : 10} />
      </div>

      {/* Gaps Section */}
      <div className="space-y-8 py-12 border-t border-white/5">
        <h3 className="font-display text-3xl font-bold text-center">CRITICAL GAPS IDENTIFIED</h3>
        <div className="grid gap-4">
          {report.gaps.map((gap, i) => (
            <GapCard key={i} title={gap.title} impact={gap.impact} priority={gap.priority} />
          ))}
        </div>
      </div>

      {/* Opportunities Section */}
      <div className="space-y-8 py-12 border-t border-white/5">
        <h3 className="font-display text-3xl font-bold text-center">YOUR HIGHEST-IMPACT OPPORTUNITIES</h3>
        <div className="grid md:grid-cols-2 gap-6">
          {report.opportunities.map((opp, i) => (
            <OpportunityCard key={i} title={opp.title} desc={opp.desc} impact={opp.impact} />
          ))}
        </div>
      </div>

      {/* What You Get Section */}
      {report.tier === "free" && (
        <div className="max-w-4xl mx-auto space-y-12 py-16 border-y border-white/5">
          <div className="text-center space-y-4">
            <h3 className="font-display text-4xl font-bold">What You Get</h3>
            <p className="text-muted-foreground uppercase tracking-widest text-sm">Everything you need to move from bank-balance guessing to CFO-level strategy</p>
          </div>

          <div className="grid gap-4">
            {[
              { title: "Full diagnostic report, scored across every category that decides your funding and growth", value: "$150", icon: BarChart3 },
              { title: "A 20-minute live call with a CFO by Design strategist to walk your results", value: "$197", icon: Users },
              { title: "Break-Even Calculator, the one number most owners cannot name", value: "$39", icon: Calculator },
              { title: "12-Month Cash Flow Forecast, so low-cash months never surprise you", value: "$39", icon: Calendar },
              { title: "KPI Dashboard Pack, three dashboards that put your whole business on one screen", value: "$59", icon: Activity },
            ].map((item, i) => (
              <div key={i} className="flex items-center justify-between p-6 rounded-2xl bg-secondary/20 border border-white/5 group hover:border-primary/30 transition-all">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-primary/10 text-primary">
                    <item.icon className="h-6 w-6" />
                  </div>
                  <span className="text-lg font-medium">{item.title}</span>
                </div>
                <span className="text-muted-foreground font-mono font-bold group-hover:text-primary transition-colors">{item.value}</span>
              </div>
            ))}
          </div>

          <div className="text-center pt-8">
            <div className="inline-flex flex-col items-center">
              <span className="text-muted-foreground line-through text-xl font-mono mb-2">Total value $484</span>
              <span className="text-5xl font-display font-bold text-foreground">Today, $47</span>
            </div>
          </div>
        </div>
      )}

      {/* Proof Section */}
      <div className="max-w-4xl mx-auto py-12">
        <div className="grid md:grid-cols-4 gap-8 text-center">
          {[
            { label: "Fifteen years", sub: "Deep experience" },
            { label: "2,400+", sub: "Businesses analyzed" },
            { label: "$50M+", sub: "Funding secured" },
            { label: "Expertise", sub: "M&A, Debt, Capital" },
          ].map((stat, i) => (
            <div key={i} className="space-y-2">
              <div className="text-2xl font-bold text-primary font-display">{stat.label}</div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">{stat.sub}</div>
            </div>
          ))}
        </div>
        <p className="mt-12 text-center text-muted-foreground text-sm italic max-w-2xl mx-auto">
          Expertise that spans finance, M&A, debt, and capital, not just bookkeeping.
        </p>
      </div>

      {/* CTAs — branched by tier + beta-vs-regular for the free tier */}
      {report.tier === "free" ? (
        <div className="text-center space-y-6 py-10 max-w-2xl mx-auto">
          <div className="p-4 rounded-xl border border-white/5 bg-secondary/20 text-muted-foreground text-sm">
            We've sent a copy to <span className="font-medium text-foreground">{leadData?.email || "your email"}</span> — check your inbox in the next minute.
          </div>
          {isBeta ? (
            /* Beta cohort: coupon input (SOLOMON50) that skips payment and
               routes to the mid-analysis survey. Beta users cannot use the
               regular payment link because HL requires a card even on 100%
               off coupons. */
            <div className="space-y-4 text-left">
              <div className="flex items-center gap-2 justify-center">
                <Sparkles className="h-4 w-4 text-primary" />
                <p className="text-xs uppercase tracking-[0.3em] font-mono text-primary text-center">
                  Beta Access — Complimentary Full Diagnostic
                </p>
              </div>
              <p className="text-center text-muted-foreground text-sm">
                Enter your beta code below to unlock the full analysis at no cost.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 items-stretch">
                <Input
                  value={couponCode}
                  onChange={(e) => {
                    setCouponCode(e.target.value);
                    if (couponStatus === "invalid") setCouponStatus("idle");
                  }}
                  placeholder="Enter code (e.g. SOLOMON50)"
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 h-14 text-base"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleApplyCoupon();
                    }
                  }}
                  disabled={couponStatus === "applying" || couponStatus === "applied"}
                />
                <Button
                  onClick={handleApplyCoupon}
                  disabled={couponStatus === "applying" || couponStatus === "applied" || !couponCode.trim()}
                  size="lg"
                  className="h-14"
                >
                  {couponStatus === "applying" ? "Applying…" : couponStatus === "applied" ? "Applied ✓" : "Apply"}
                  {couponStatus === "idle" && <ArrowRight className="ml-2 h-4 w-4" />}
                </Button>
              </div>
              {couponStatus === "invalid" && (
                <p className="text-sm text-destructive font-mono text-center">
                  That code isn't recognized. Double-check spelling.
                </p>
              )}
              <p className="text-xs text-muted-foreground text-center">
                Beta cohort · Skip payment, go straight to the intake.
              </p>
            </div>
          ) : (
            /* Regular cohort: paid $47 upgrade via GHL payment link. */
            <div className="space-y-4">
              <div className="flex justify-center">
                <CountdownTimer
                  durationHours={OFFERS.DIAGNOSTIC_47.durationHours}
                  label={OFFERS.DIAGNOSTIC_47.label}
                />
              </div>
              {!getRemainingTime(OFFERS.DIAGNOSTIC_47.durationHours).isExpired ? (
                <Button
                  onClick={() => {
                    console.log("[Analytics] SWOT_UPGRADE_CLICK");
                    navigateExternal(PAYMENT_LINK_47);
                  }}
                  className="w-full h-20 text-xl font-bold rounded-xl shadow-glow-gold transition-all hover:-translate-y-1 active:translate-y-0 bg-primary hover:bg-primary/90 text-primary-foreground relative overflow-hidden group"
                >
                  <div className="relative z-10 flex flex-col items-center">
                    <span>Get My Full Diagnosis + Strategy Session — $47</span>
                    {!getRemainingTime(OFFERS.ACTION_BONUS_50.durationHours).isExpired && (
                      <span className="text-[10px] uppercase tracking-widest text-primary-foreground/80 mt-1 font-mono">
                        ⚡ Includes $50 Action Taker Bonus (24h only)
                      </span>
                    )}
                  </div>
                </Button>
              ) : (
                <div className="p-6 rounded-xl border border-amber-500/20 bg-amber-500/5 text-amber-500 text-sm font-medium">
                  The limited-time $47 diagnostic offer has expired.
                </div>
              )}
            </div>
          )}
          {!isBeta && (
            <Button
              onClick={() => {
                console.log("[Analytics] SWOT_DEEP_DIVE_CLICK");
                navigateExternal(PAYMENT_LINK_297);
              }}
              variant="ghost"
              className="w-full text-sm text-muted-foreground hover:text-foreground mt-4"
            >
              Want a full manual audit with a senior strategist? Learn about the Deep Dive — $297
            </Button>
          )}
        </div>
      ) : (
        <div className="text-center space-y-6 py-10 max-w-2xl mx-auto">
          <div className="p-4 rounded-xl border border-white/5 bg-secondary/20 text-muted-foreground text-sm">
            We've sent a copy to <span className="font-medium text-foreground">{leadData?.email || "your email"}</span> — your full report is also saved to your account.
          </div>

          <div className="text-center max-w-2xl mx-auto space-y-3 pb-4">
            <h3 className="font-display text-2xl md:text-3xl font-bold">
              {report.nextStepHeadline}
            </h3>
            <p className="text-lg text-muted-foreground leading-relaxed">
              {report.nextStepBody}
            </p>
          </div>

          {report.bookingLink && (
            <Button
              onClick={() => {
                console.log("[Analytics] SWOT_BOOKING_CLICK", { tier: report.tier });
                window.open(report.bookingLink!, "_blank");
              }}
              className="w-full h-20 text-xl font-bold rounded-xl shadow-glow-gold transition-all hover:-translate-y-1 active:translate-y-0 bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              Book my {report.tier === "paid_297" ? "50-minute Deep Dive Session" : "30-minute Strategy Session"} →
            </Button>
          )}

          {report.tier === "paid_47" && (
            <Button
              onClick={() => {
                console.log("[Analytics] SWOT_UPSELL_297_CLICK");
                navigateExternal(PAYMENT_LINK_297);
              }}
              variant="ghost"
              className="w-full text-sm text-muted-foreground hover:text-foreground"
            >
              Want a full manual audit with a senior strategist? Learn about the Deep Dive — $297
            </Button>
          )}
        </div>
      )}

      <footer className="mt-20 py-12 border-t border-border/50 text-center">
        <p className="text-xs text-muted-foreground uppercase tracking-[0.4em]">2,400+ businesses analyzed — you're in good company</p>
      </footer>
    </div>
  );
};

