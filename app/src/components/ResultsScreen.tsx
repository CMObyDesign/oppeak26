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

  // paid47-v2 detection — enriched sections (Financial Snapshot,
  // Connections, Order of Attention, Questions to Clarify) and the
  // v2 gap/opportunity shape only render when both version tags
  // match verbatim. A $47 report that didn't make it through the
  // quality gate was downgraded on the Worker (version tags stripped)
  // and falls back to the legacy v1 render path.
  const isPaid47V2 = Boolean(
    report?.tier === "paid_47" &&
      report?.reportSchemaVersion === "paid47-v2" &&
      report?.tierGuideVersion === "paid47-2.0",
  );
  const [couponCode, setCouponCode] = useState("");
  const [couponStatus, setCouponStatus] = useState<"idle" | "invalid" | "applying" | "applied">("idle");
  // Surfaces the real reason a coupon apply failed (rate limit, origin block,
  // missing identifier, GHL upsert error, network error). Without this,
  // every failure rendered the same generic "wrong code" message — which
  // left customers stuck on legitimate codes that failed for infrastructure
  // reasons they couldn't diagnose. The server's own `error` string is
  // trusted; a client-side friendly fallback covers wrong-code and
  // network-error paths that don't produce one.
  const [couponErrDetail, setCouponErrDetail] = useState<string | null>(null);

  const handleApplyCoupon = async () => {
    const code = couponCode.trim().toUpperCase();
    if (code !== "SOLOMON50") {
      setCouponStatus("invalid");
      setCouponErrDetail("That code isn't recognized. Beta codes are case-sensitive and come in the welcome email.");
      return;
    }
    setCouponStatus("applying");
    setCouponErrDetail(null);
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
    let serverErr: string | null = null;
    let httpStatus: number | null = null;
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
      httpStatus = res.status;
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        ok = true;
        if (data?.contactId) resolvedContactId = data.contactId;
      } else {
        // Grab the server's own error so the customer sees the real reason
        // (rate limit, origin block, missing identifier, upsert failure).
        serverErr = (data && typeof data.error === "string") ? data.error : null;
      }
    } catch (e: any) {
      serverErr = `Network error — ${e?.message || "could not reach the server"}. Check your connection or try again.`;
    }
    if (!ok) {
      setCouponStatus("invalid");
      // Build a human-readable detail that maps the common server responses
      // to actionable advice. Falls back to the raw server string when we
      // haven't seen the shape before.
      let detail = serverErr || "Something went wrong applying your code.";
      if (httpStatus === 429 || /too many attempts/i.test(serverErr || "")) {
        detail = "Too many attempts from this network — wait about an hour and try again, or switch networks.";
      } else if (httpStatus === 403 && /origin/i.test(serverErr || "")) {
        detail = `The page you're on isn't allowed to apply this code (origin block). Try the link in your welcome email instead, or send this to support: "${serverErr}".`;
      } else if (httpStatus === 400 && /need email or contactid/i.test(serverErr || "")) {
        detail = "We don't have an email or contact ID on this page — reload from the link in your welcome email so your contact info is attached.";
      } else if (httpStatus === 500) {
        detail = `Server error — ${serverErr || "something went wrong on our end"}. Please try again or email support@cfobydesign.com.`;
      }
      setCouponErrDetail(detail);
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
          YOUR BUSINESS HEALTH CHECK
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

      {/* 2026-10-29: removed the hardcoded generic Gap sales block
          that lived here. It opened with the exact "cash flow, debt,
          profitability, receivables, financial visibility, and growth
          capacity" category list the TIER_GUIDE forbids — AND it
          duplicated whatever Solomon writes into report.theGap below,
          creating the "double Gap" bug Liz flagged. The dynamic
          personalized theGap block (rendered later in this component)
          is the single source for the free-tier Gap section now. */}

      {/* The Story Section — locked founder-voice copy from Miguel (2026-10-17).
          This section is founder/high-trust content; it stays in first-person
          singular ("I") and does NOT get swapped for generic consultant framing.
          Any edit here needs product sign-off because the brand reference
          specifically names Health Check reports as a Miguel-voice surface. */}
      <div className="max-w-3xl mx-auto space-y-8 py-12">
        <div className="space-y-6">
          <h3 className="font-display text-3xl font-bold">The Story</h3>

          {/* Founder byline — ties Miguel's face to the first-person
              narrative that follows. Headshot URL mirrors the standalone
              /bga-upgrade sales page so we have one source of truth per
              asset host. The gold ring + subtle gradient on the circle
              matches the primary brand accent. */}
          <div className="flex items-center gap-4 pt-2">
            <img
              src="https://assets.cdn.filesafe.space/oLIENQCtGnt9U6gfLhE5/media/6a60f73581877afd27c4c4a6.webp"
              alt="Miguel Hernandez"
              width={80}
              height={80}
              loading="lazy"
              className="h-20 w-20 rounded-full object-cover ring-2 ring-primary/40 ring-offset-2 ring-offset-background flex-shrink-0"
            />
            <div className="min-w-0">
              <p className="font-display text-xl font-bold text-foreground leading-tight">Miguel Hernandez</p>
              <p className="text-xs text-muted-foreground uppercase tracking-[0.18em] mt-1">
                Founder &amp; CEO &middot; CFO By Design
              </p>
            </div>
          </div>

          <div className="space-y-4 text-muted-foreground leading-relaxed text-lg">
            <p>
              For more than fifteen years, I've sat across from business owners making six- and seven-figure decisions without a clear enough view of the numbers behind them.
            </p>
            <p>
              They usually didn't need another spreadsheet. They needed someone to connect what was happening with cash flow, debt, margins, receivables, taxes, and growth and tell them what actually mattered first.
            </p>
            <p>
              Over time, you start seeing the same patterns.
            </p>
            <p>
              The questions we ask. The answers that make us look twice. The numbers that tell us an owner has room to move and the ones that tell us to slow down before an expensive decision gets made.
            </p>
            <p className="text-foreground font-medium">
              That's why we built Solomon.
            </p>
            <p>
              We took the questions our team uses, the patterns we look for, and the financial framework I've refined through years of working with business owners and built them into the assessment process.
            </p>
            <p>
              Solomon helps us surface those signals faster. But a report is not a relationship.
            </p>
            <p className="text-foreground font-medium italic">
              The report shows you what we're seeing. The CFO By Design team helps you decide what to do with it.
            </p>
            {/* 2026-10-29: removed the duplicate "Built on Miguel
                Hernandez's financial framework. Delivered by the CFO
                By Design team." signature line. The byline above
                already attributes everything to Miguel; the
                first-person narration ("I've sat across from…")
                carries it through the Story block. The repeat
                signature was reading like a second slug. */}
          </div>
        </div>
      </div>

      {/* SWOT visualization — back as requested */}
      <div className="space-y-8 py-12 border-t border-white/5">
        <div className="flex items-center gap-3 justify-center">
          <Activity className="h-5 w-5 text-primary" />
          <h3 className="font-display text-2xl font-bold uppercase tracking-widest">Financial Health Breakdown</h3>
        </div>
        {/* Codex P2 on #135: derive snapshot slots from the actual
            report instead of letting all customers see the same
            generic fallback copy.
            2026-10-29: Strength now populated from the top-level
            `strength` field Solomon grew (free-tier rendering
            contract — never show an empty card; the slot falls back
            when the field is absent). Replaces the previous
            `report.context` misuse that put risk framing in the
            strength slot. */}
        <SwotQuadrant
          items={{
            strength: report.strength && report.strength.title
              ? { heading: report.strength.title, body: report.strength.desc || "" }
              : undefined,
            needsAttention: (() => {
              const top = (report.gaps as any[]).find((g) => g.priority === "CRITICAL")
                       || (report.gaps as any[]).find((g) => g.priority === "HIGH")
                       || report.gaps[0];
              return top ? { heading: top.title, body: top.impact } : undefined;
            })(),
            opportunity: report.opportunities[0]
              ? { heading: report.opportunities[0].title, body: (report.opportunities[0] as any).desc }
              : undefined,
            watch: (() => {
              const w = (report.gaps as any[]).find((g) => g.priority === "MEDIUM")
                     || report.gaps[1];
              return w ? { heading: w.title, body: w.impact } : undefined;
            })(),
          }}
        />
      </div>

      {/* paid47-v2 Financial Snapshot — only on $47 reports whose
          version tags match the enriched contract. v1 reports and the
          free tier skip this section entirely so the renderer parity
          with the Worker's /report page stays clean. */}
      {isPaid47V2 && Array.isArray(report.financialSnapshot) && report.financialSnapshot.length > 0 && (
        <div className="space-y-6 py-12 border-t border-white/5">
          <h3 className="font-display text-3xl font-bold text-center">Financial Snapshot</h3>
          <Card className="glass-card border-white/5 divide-y divide-white/5">
            {report.financialSnapshot!.map((row, i) => (
              <div key={i} className="p-4 flex items-center justify-between gap-6">
                <div className="min-w-0">
                  <div className="font-medium text-foreground">{row.label}</div>
                  {row.meaning && <div className="text-sm text-muted-foreground italic mt-1">{row.meaning}</div>}
                </div>
                <div className="font-display text-lg font-bold text-primary whitespace-nowrap">{row.value}</div>
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* Gaps Section — generic alarm language removed; the per-card
          severity/priority already communicates how serious each item is.
          Severity is not tone (brand rule). v2 gaps have no legacy
          `impact` field; the renderer joins the enriched prose fields
          so the existing GapCard keeps its single-line layout. */}
      <div className="space-y-8 py-12 border-t border-white/5">
        <h3 className="font-display text-3xl font-bold text-center">What Deserves Your Attention</h3>
        <div className="grid gap-4">
          {report.gaps.map((gap: any, i) => {
            const impact = isPaid47V2
              ? [gap.known, gap.whyItMatters, gap.decisionImplication].filter(Boolean).join(" · ")
              : gap.impact;
            return <GapCard key={i} title={gap.title} impact={impact || ""} priority={gap.priority} />;
          })}
        </div>
      </div>

      {/* Opportunities Section — v2 opportunities carry
          whyCredible/whatMustBeTrue/nextValidation; join them for the
          card's prose line and use the economicMechanism as the badge. */}
      <div className="space-y-8 py-12 border-t border-white/5">
        <h3 className="font-display text-3xl font-bold text-center">YOUR HIGHEST-IMPACT OPPORTUNITIES</h3>
        <div className="grid md:grid-cols-2 gap-6">
          {report.opportunities.map((opp: any, i) => {
            const desc = isPaid47V2
              ? [opp.whyCredible, opp.whatMustBeTrue && `Must be true: ${opp.whatMustBeTrue}`, opp.nextValidation && `Next: ${opp.nextValidation}`].filter(Boolean).join(" · ")
              : opp.desc;
            const impact = isPaid47V2 ? (opp.economicMechanism || "").toUpperCase() : opp.impact;
            return <OpportunityCard key={i} title={opp.title} desc={desc || ""} impact={impact || ""} />;
          })}
        </div>
      </div>

      {/* Contextual Insight — free-tier memorable connection the owner
          may not have made themselves. 2026-10-29 scope correction:
          the generic "Contextual Insight" heading is dropped; the
          signature label (The tension / What I'd watch / etc.) stands
          on its own as the eyebrow. Only renders when title AND body
          are both non-empty. Historical reports without the field
          still render through this component. */}
      {report.contextualInsight && report.contextualInsight.title && report.contextualInsight.body && (
        <div className="space-y-6 py-12 border-t border-white/5">
          <Card className="p-6 glass-card border-white/5 max-w-2xl mx-auto border-l-4 border-l-accent">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-accent mb-2">{report.contextualInsight.title}</div>
            <p className="text-foreground leading-relaxed">{report.contextualInsight.body}</p>
          </Card>
        </div>
      )}

      {/* One Move You Can Make Now — free-tier concrete action tied to
          the #1 signal. Only rendered when the model emits a non-empty
          title, so an empty object never produces an empty card. Paid
          tiers typically omit this (decisionOrder[] covers the same
          job). */}
      {report.oneMove && report.oneMove.title && (
        <div className="space-y-6 py-12 border-t border-white/5">
          <h3 className="font-display text-3xl font-bold text-center">One Move You Can Make Now</h3>
          <Card className="p-6 glass-card border-white/5 max-w-2xl mx-auto">
            <h4 className="font-display text-lg font-bold mb-2">{report.oneMove.title}</h4>
            {report.oneMove.desc && (
              <p className="text-muted-foreground leading-relaxed">{report.oneMove.desc}</p>
            )}
          </Card>
        </div>
      )}

      {/* paid47-v2 Connections — cross-finding synthesis. Keyed by
          finding ids on the Worker side; here we just render the
          strategist's prose explanation. */}
      {isPaid47V2 && Array.isArray(report.connections) && report.connections.length > 0 && (
        <div className="space-y-6 py-12 border-t border-white/5">
          <div className="text-center">
            <h3 className="font-display text-3xl font-bold">What the Numbers Are Telling Us</h3>
            <p className="text-sm text-muted-foreground italic mt-1">How these findings interact</p>
          </div>
          <div className="grid gap-4">
            {report.connections!.map((c, i) => (
              <Card key={i} className="p-6 glass-card border-white/5">
                <h4 className="font-display text-lg font-bold mb-2">{c.title}</h4>
                <p className="text-muted-foreground leading-relaxed">{c.explanation}</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* paid47-v2 Decision Order — the strategist's recommended first
          moves. Shown as a numbered action list; the step order is
          grounded in immediacy, consequence, and dependency. */}
      {isPaid47V2 && Array.isArray(report.decisionOrder) && report.decisionOrder.length > 0 && (
        <div className="space-y-6 py-12 border-t border-white/5">
          <h3 className="font-display text-3xl font-bold text-center">Order of Attention</h3>
          <div className="grid gap-3">
            {report.decisionOrder!.map((d, i) => (
              <Card key={i} className="p-5 glass-card border-white/5 flex items-start gap-4">
                <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-display font-bold shrink-0">
                  {d.step}
                </div>
                <div>
                  <div className="font-medium text-foreground">{d.action}</div>
                  {d.whyNow && <div className="text-sm text-muted-foreground italic mt-1">{d.whyNow}</div>}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* paid47-v2 Questions to Clarify — what to open the included
          30-minute strategist review with. Not generic discovery
          questions; the gate rejects those. */}
      {isPaid47V2 && Array.isArray(report.questionsToClarify) && report.questionsToClarify.length > 0 && (
        <div className="space-y-6 py-12 border-t border-white/5">
          <h3 className="font-display text-3xl font-bold text-center">Questions to Clarify With the Strategist</h3>
          <div className="grid gap-3">
            {report.questionsToClarify!.map((q, i) => (
              <Card key={i} className="p-5 glass-card border-white/5">
                <div className="font-medium text-foreground">{q.question}</div>
                {q.whyItMatters && <div className="text-sm text-muted-foreground italic mt-1">{q.whyItMatters}</div>}
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* The Gap — free-tier closing CFO question. 2026-10-29:
          the dynamic personalized block that replaces the hardcoded
          generic sales block removed above. Only renders on the
          free tier (paid_47 has Questions to Clarify + Order of
          Attention instead) and only when at least one of the
          four prose fields is non-empty, so a partial response
          never produces a blank card. Four-part structure mirrors
          the Worker /report page: known / unknown / why it
          matters / what the Full Diagnostic investigates. The
          question itself is the model's own prose at the top of
          the known field in TIER_GUIDE-shaped builds; here we
          surface the four fields plainly under one eyebrow. */}
      {report.tier === "free" && report.theGap && (
        report.theGap.known ||
        report.theGap.unknown ||
        report.theGap.whyItMatters ||
        report.theGap.whatPaidWillInvestigate
      ) && (
        <div className="space-y-6 py-12 border-t border-white/5">
          <h3 className="font-display text-3xl font-bold text-center">The Gap</h3>
          <Card className="p-6 glass-card border-white/5 max-w-2xl mx-auto border-l-4 border-l-primary space-y-3">
            {report.theGap.known && (
              <div className="text-foreground leading-relaxed">
                <span className="font-bold">What we know:</span>{" "}
                <span className="text-muted-foreground">{report.theGap.known}</span>
              </div>
            )}
            {report.theGap.unknown && (
              <div className="text-foreground leading-relaxed">
                <span className="font-bold">What's unknown:</span>{" "}
                <span className="text-muted-foreground">{report.theGap.unknown}</span>
              </div>
            )}
            {report.theGap.whyItMatters && (
              <div className="text-foreground leading-relaxed">
                <span className="font-bold">Why it matters:</span>{" "}
                <span className="text-muted-foreground">{report.theGap.whyItMatters}</span>
              </div>
            )}
            {report.theGap.whatPaidWillInvestigate && (
              <div className="text-foreground leading-relaxed">
                <span className="font-bold">What the Full Diagnostic investigates:</span>{" "}
                <span className="text-muted-foreground">{report.theGap.whatPaidWillInvestigate}</span>
              </div>
            )}
          </Card>
        </div>
      )}

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
          {/* Pre-confirmation wording — the HL automation POST was accepted
              but we have no email-provider delivery webhook back here, so
              we don't claim "sent" yet. Flipping to the past-tense version
              requires a real confirmation signal (Codex #133 copy directive
              2026-10-17). */}
          <div className="p-4 rounded-xl border border-white/5 bg-secondary/20 text-muted-foreground text-sm">
            We'll send a copy of your Business Health Check to <span className="font-medium text-foreground">{leadData?.email || "your email"}</span>.
          </div>
          {/* Payment CTA — shown on BOTH /beta and the regular free
              results page. Previously /beta hid the pay button and
              showed only the beta-code input, which (a) blocked real
              paying customers who happened to land on /beta from
              checking out, and (b) made the beta flow a dead-end for
              anyone without a code. 2026-10-28: pay path is the
              primary CTA; the beta code input (when isBeta) is a
              secondary redeem path below it. */}
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
                  <span>Get My Full Diagnostic + Strategist Review — $47</span>
                  {/* 2026-10-29: removed the "(24h only)" sublabel.
                      The countdown above runs 48h on the Diagnostic
                      offer; adding "24h only" here read as a direct
                      contradiction. The Action Taker Bonus is
                      included inside the $47 — we don't need two
                      competing clocks on the same card. */}
                  {!getRemainingTime(OFFERS.ACTION_BONUS_50.durationHours).isExpired && (
                    <span className="text-[10px] uppercase tracking-widest text-primary-foreground/80 mt-1 font-mono">
                      ⚡ Includes $50 Action Taker Bonus
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
          {isBeta && (
            /* Beta cohort redemption — secondary path. HL payment links
               require a card even on 100%-off coupons, which blocks
               SOLOMON50 beta users; this input calls /apply-solomon50
               to apply the tag and skip payment, then routes to the
               mid-analysis survey. Placeholder deliberately does NOT
               name the actual code (previous "e.g. SOLOMON50" leaked
               it to anyone on /beta). */
            <div className="space-y-4 text-left pt-4 border-t border-white/5">
              <div className="flex items-center gap-2 justify-center">
                <Sparkles className="h-4 w-4 text-primary" />
                <p className="text-xs uppercase tracking-[0.3em] font-mono text-primary text-center">
                  Have a beta code?
                </p>
              </div>
              <p className="text-center text-muted-foreground text-sm">
                Enter the code from your welcome email to unlock the full analysis at no cost.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 items-stretch">
                <Input
                  value={couponCode}
                  onChange={(e) => {
                    setCouponCode(e.target.value);
                    if (couponStatus === "invalid") setCouponStatus("idle");
                  }}
                  placeholder="Enter beta code"
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
                  variant="outline"
                  className="h-14"
                >
                  {couponStatus === "applying" ? "Applying…" : couponStatus === "applied" ? "Applied ✓" : "Redeem"}
                  {couponStatus === "idle" && <ArrowRight className="ml-2 h-4 w-4" />}
                </Button>
              </div>
              {couponStatus === "invalid" && (
                <p className="text-sm text-destructive font-mono text-center leading-relaxed">
                  {couponErrDetail || "We couldn't apply that code. Check the spelling, or try again in a moment."}
                </p>
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
            We'll send a copy to <span className="font-medium text-foreground">{leadData?.email || "your email"}</span>. Your full report is also saved to your account.
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
              Book my {report.tier === "paid_297" ? "50-minute Deep Dive Session" : "30-minute Strategist Review"} →
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
        <p className="text-xs text-muted-foreground uppercase tracking-[0.4em]">Your integrated money partner.</p>
      </footer>
    </div>
  );
};

