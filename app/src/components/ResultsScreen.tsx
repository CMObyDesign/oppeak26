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

// Styling per customer-facing classification. Rubric v3 narrowed the
// enum to {rehab, needs-attention, growth}; the legacy "urgent" and
// "strong" keys are retained so pre-v3 reports stored in D1 still
// render correctly. "needs-attention" uses the accent token (amber on
// this palette) — distinct from destructive (red) for rehab and
// primary (green) for growth, and visually consistent with the
// SEVERITY IS NOT TONE discipline (a non-legal stress bucket should
// not look like an emergency).
const PATH_STYLE: Record<string, { score: string; badge: string }> = {
  rehab:             { score: "text-destructive", badge: "bg-destructive/10 border-destructive/20 text-destructive" },
  "needs-attention": { score: "text-accent",      badge: "bg-accent/10 border-accent/20 text-accent" },
  growth:            { score: "text-primary",     badge: "bg-primary/10 border-primary/20 text-primary" },
  // Legacy — pre-v3 historical reports stored in D1.
  urgent:            { score: "text-destructive", badge: "bg-destructive/10 border-destructive/20 text-destructive" },
  strong:            { score: "text-primary",     badge: "bg-primary/10 border-primary/20 text-primary" },
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
    // Confirm the tag write BEFORE navigating. The paid survey webhook rejects
    // (403) any submission whose contact lacks swot_solomon50_applied, so
    // sending the user forward on a failed tag write would leave them able to
    // fill out the survey only to have report generation blocked. Fail loudly
    // instead: show "invalid" state and let them retry. The worker accepts
    // either contactId (preferred) or email (upserts by email so the tag
    // write works even when the React lead-capture POST didn't create a GHL
    // contact upstream — the common case when VITE_GHL_SURVEY_SUBMIT_URL
    // isn't set on Cloudflare Pages). We capture the returned contactId so
    // the mid-analysis redirect carries it and downstream tier gates work.
    let resolvedContactId: string | undefined = leadData?.contactId;
    let ok = false;
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
      if (res.ok && data?.success) {
        ok = true;
        if (data?.contactId) resolvedContactId = data.contactId;
      }
    } catch {
      // Network error — fall through to failure branch.
    }
    if (!ok) {
      setCouponStatus("invalid");
      return;
    }
    setCouponStatus("applied");
    const target = resolvedContactId
      ? `${BETA_MID_ANALYSIS_URL}?contact_id=${encodeURIComponent(resolvedContactId)}`
      : BETA_MID_ANALYSIS_URL;
    navigateExternal(target);
  };
  if (error || !report) {
    return (
      <div className="w-full max-w-2xl mx-auto pt-48 md:pt-64 pb-32 px-4 text-center space-y-8">
        <div className="space-y-3">
          <p className="text-xs md:text-sm font-bold text-accent uppercase tracking-[0.3em]">
            ◆ WE HIT A SNAG
          </p>
          <h2 className="font-display text-3xl md:text-4xl text-foreground font-bold leading-tight">
            Your responses came through — the report didn't.
          </h2>
        </div>
        <div className="p-6 md:p-8 rounded-2xl bg-secondary/30 border border-white/5 text-left space-y-4">
          <p className="text-foreground leading-relaxed">
            Solomon couldn't finish generating your analysis just now. This is on us, not on you.
          </p>
          <p className="text-foreground leading-relaxed">
            <strong>What happens next:</strong> Miguel's team has been alerted with your submission. Someone will personally reach out within one business day to walk you through your results — no need to re-take the assessment.
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            If you'd like to retry now, refresh this page. If you have questions in the meantime, reply to any email from us or write to{" "}
            <a className="underline hover:text-primary" href="mailto:support@cfobydesign.com">support@cfobydesign.com</a>.
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="text-xs uppercase tracking-widest font-mono text-muted-foreground hover:text-primary transition-colors border border-white/10 rounded-full px-5 py-2"
        >
          ↻ Try again
        </button>
        {error && (
          <details className="text-left">
            <summary className="text-xs uppercase tracking-widest font-mono text-muted-foreground cursor-pointer hover:text-primary">
              Technical details
            </summary>
            <pre className="mt-3 text-xs text-left text-muted-foreground bg-secondary/30 p-4 rounded-xl overflow-x-auto">{error}</pre>
          </details>
        )}
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
            Your Business Health Check identified the signals. The Full Diagnostic goes deeper into the numbers behind them, including cash flow, debt, profitability, receivables, financial visibility, and growth capacity.
          </p>
          <p className="text-base text-foreground font-medium italic leading-relaxed">
            The goal is not more information. It is knowing what deserves attention first and why.
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
              So they built something. They took the questions the team asks, the patterns they look for, and the financial framework Miguel has refined over years of working with business owners, and built those principles into Solomon. It runs your full diagnostic in minutes using the exact logic the team uses with their highest-value clients. That is what powers your report.
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
        <SwotQuadrant categoryScores={{}} score={report.path === "growth" ? 18 : report.path === "needs-attention" ? 10 : 5} />
      </div>

      {/* Gaps Section — generic alarm language removed; the per-card
          severity/priority already communicates how serious each item is.
          Severity is not tone (brand rule). */}
      <div className="space-y-8 py-12 border-t border-white/5">
        <h3 className="font-display text-3xl font-bold text-center">What Deserves Your Attention</h3>
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

      {/* What You Get Section — components sold plainly, no invented
          dollar values. The old "$150 / $197 / $39 / $59 / was $484"
          framing read like an internet-marketing bundle, which the brand
          doc says not to do unless each item is independently sold at
          those prices. Standardized 30-minute strategist review (not
          20-minute) across the whole funnel. */}
      {report.tier === "free" && (
        <div className="max-w-4xl mx-auto space-y-12 py-16 border-y border-white/5">
          <div className="text-center space-y-4">
            <h3 className="font-display text-4xl font-bold">What You Get</h3>
            <p className="text-muted-foreground uppercase tracking-widest text-sm">The $47 Full Diagnostic</p>
          </div>

          <div className="grid gap-4">
            {[
              { title: "Full Financial Diagnostic across cash flow, debt, profitability, receivables, financial visibility, and growth capacity", icon: BarChart3 },
              { title: "Prioritized findings — what deserves attention first, and why", icon: Target },
              { title: "Break-Even Calculator — the one number most owners cannot name", icon: Calculator },
              { title: "12-Month Cash-Flow Forecast — so low-cash months never surprise you", icon: Calendar },
              { title: "KPI Dashboard tools — three dashboards that put your whole business on one screen", icon: Activity },
              { title: "30-minute live strategist review with a CFO By Design strategist to walk the findings", icon: Users },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-4 p-6 rounded-2xl bg-secondary/20 border border-white/5 group hover:border-primary/30 transition-all">
                <div className="p-3 rounded-xl bg-primary/10 text-primary shrink-0">
                  <item.icon className="h-6 w-6" />
                </div>
                <span className="text-lg font-medium">{item.title}</span>
              </div>
            ))}
          </div>

          <div className="text-center pt-8">
            <div className="inline-flex flex-col items-center">
              <span className="text-5xl font-display font-bold text-foreground">$47 one time</span>
              <span className="text-xs text-muted-foreground uppercase tracking-widest mt-2 font-mono">No subscription · Includes your live strategist review</span>
            </div>
          </div>
        </div>
      )}

      {/* Proof Section — removed the "2,400+ businesses analyzed" and
          "$50M+ funding secured" numbers. The brand doc prohibits
          invented or unverified counts, and neither number has public
          documentation we could cite. "Fifteen years" is kept because
          Miguel's background supports it. */}
      <div className="max-w-4xl mx-auto py-12">
        <div className="grid md:grid-cols-3 gap-8 text-center">
          {[
            { label: "Fifteen years", sub: "Miguel's experience" },
            { label: "Integrated", sub: "Cash flow, debt, margins, growth" },
            { label: "Expertise", sub: "CFO strategy, M&A, debt, capital" },
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
                  We couldn't apply that code. Check the spelling, or try again in a moment.
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
          {/* No ghost Deep Dive upsell on the free results page. The
              $297 Business Growth Analysis is the OTO AFTER the $47
              purchase (served by /upsell), not a parallel CTA on the
              free results. Showing both here undermines the $47 ask. */}
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
              Explore the Business Growth Analysis — $297 →
            </Button>
          )}
        </div>
      )}

      <footer className="mt-20 py-12 border-t border-border/50 text-center">
        <p className="text-xs text-muted-foreground uppercase tracking-[0.4em]">Built on Miguel Hernandez&apos;s financial framework · CFO By Design</p>
      </footer>
    </div>
  );
};

