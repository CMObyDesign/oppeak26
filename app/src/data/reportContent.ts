export interface ReportContentVariant {
  badge: string;
  headline: string;
  subheadline: string;
  opener: string;
  context: (score: number) => string;
  gaps: { title: string; impact: string; priority: string }[];
  opportunities: { title: string; desc: string; impact: string }[];
  nextStepHeadline: string;
  nextStepBody: string;
  cta: string;
  ctaSubline?: string;
  urgency?: string;
  isRehab?: boolean;
}

export type ReportPath = "urgent" | "growth" | "strong" | "rehab";

export const reportContent: Record<ReportPath, ReportContentVariant> = {
  urgent: {
    badge: "CRITICAL EXPOSURE",
    headline: "Your Business Is Operating Under Significant Financial Pressure",
    subheadline: "The patterns we identified are symptoms of a larger structural problem.",
    opener: "Your analysis reveals a business operating under significant financial pressure. The patterns we identified are symptoms of a larger structural problem — and each month without intervention compounds the risk.",
    context: (score: number) => `Your score of ${score}/30 places you in the bottom 34% of businesses we've analyzed. Without intervention, these gaps will prevent qualification for any meaningful funding.`,
    gaps: [
      { title: "Accounting Structure Risk", impact: "Estimated 12% profit leakage due to poor tracking.", priority: "CRITICAL" },
      { title: "Zero Cash Reserve Strategy", impact: "Operating at 100% risk; ineligible for tier-1 funding.", priority: "CRITICAL" },
      { title: "Credit Position Fragility", impact: "High risk of personal liability and funding denial.", priority: "HIGH" },
    ],
    opportunities: [
      { title: "Credit Decoupling", desc: "Unlock $50K–$150K in funding by separating personal credit.", impact: "High Impact" },
      { title: "Entity Restructuring", desc: "Immediate protection of personal assets from business debt.", impact: "Urgent" },
    ],
    nextStepHeadline: "You Need a CFO Strategy Session",
    nextStepBody: "Based on your profile, our team can identify the fastest path from where you are to where you need to be. This call is free. The cost of not having it isn't.",
    cta: "Get My Deep Dive Audit — $297 →",
    ctaSubline: "Delivered within 48 hours. Full refund if it doesn't show you something you didn't know.",
    urgency: "⚡ 3 strategy sessions available this week",
  },
  growth: {
    badge: "HIDDEN LIABILITY",
    headline: "You Have Real Momentum — And Liabilities You Can't See Yet",
    subheadline: "You're closer than you think. The right moves in the next 60–90 days could unlock your next funding milestone.",
    opener: "Your business has real assets and momentum — but our analysis identified liabilities that aren't visible on the surface. Left unaddressed, they will cap your funding access and slow your growth ceiling.",
    context: (score: number) => `Your score of ${score}/30 places you in the top 45% of businesses we've analyzed. You have real momentum — but these specific gaps are the ceiling on your growth.`,
    gaps: [
      { title: "Inefficient Tax Structure", impact: "Potential $25k+ annual overpayment in self-employment taxes.", priority: "HIGH" },
      { title: "Under-leveraged Credit Lines", impact: "Missing out on $150k+ in available capital capacity.", priority: "HIGH" },
      { title: "Reactive vs. Proactive Reporting", impact: "Decisions based on history, not future projections.", priority: "MEDIUM" },
    ],
    opportunities: [
      { title: "Institutional Funding Access", desc: "Qualify for $250K+ in tier-1 credit lines within 6 months.", impact: "Unlock $250K+" },
      { title: "Tax Strategy Optimization", desc: "Recover $15K–$40K in annual tax overpayments.", impact: "High ROI" },
    ],
    nextStepHeadline: "Here's Your 60-Day Action Plan",
    nextStepBody: "Our team specializes in exactly your situation — solid businesses that need precise strategy to break through to the next level. A 30-minute call will show you the exact path forward.",
    cta: "Get My Deep Dive Audit — $297 →",
    ctaSubline: "48-hour turnaround. We surface what your books don't.",
  },
  strong: {
    badge: "UNTAPPED CAPACITY",
    headline: "Your Foundation Is Solid — But You're Leaving Capital on the Table",
    subheadline: "You have the foundation most business owners spend years trying to build. Now let's maximize it.",
    opener: "Your business is positioned better than most. But our analysis shows you're leaving significant funding capacity and profit optimization on the table — capacity that your current structure isn't capturing.",
    context: (score: number) => `Your score of ${score}/30 places you in the top 18% of businesses we've analyzed. You're not here to fix problems — you're here to optimize and scale.`,
    gaps: [
      { title: "Capital Cost Optimization", impact: "Current debt service is 2-3% higher than market rates.", priority: "MEDIUM" },
      { title: "Advanced Entity Optimization", impact: "Opportunity to shield assets with multi-entity structure.", priority: "MEDIUM" },
      { title: "Strategic M&A Readiness", impact: "Balance sheet is strong but needs 'exit-ready' polish.", priority: "MEDIUM" },
    ],
    opportunities: [
      { title: "Acquisition Strategy", desc: "Use your strong balance sheet to acquire horizontal competitors.", impact: "Scale 2-3x" },
      { title: "Capital Cost Reduction", desc: "Refinance existing debt to save $2K–$5K in monthly interest.", impact: "Improve Margin" },
    ],
    nextStepHeadline: "You're Ready for CFO-Level Strategy",
    nextStepBody: "At your level, the difference between good and exceptional is execution precision. Our team can show you exactly where the highest-ROI opportunities are in your specific financial profile.",
    cta: "Get My Deep Dive Audit — $297 →",
    ctaSubline: "We show you exactly where the unclaimed capital lives.",
  },
  rehab: {
    badge: "REHAB TRACK",
    headline: "Before Funding, There's a Rebuild — And That's the Right Order",
    subheadline: "Judgments and liens are the single biggest barrier to institutional funding. We need to clear the path first.",
    opener: "You're carrying obligations — judgments, liens, or defaulted accounts — that block the funding path most lenders require. The good news: this is a specific, solvable sequence. Trying to skip it costs more time than walking through it does.",
    context: (score: number) => `Your score of ${score}/30 reflects the high-risk nature of active legal or tax encumbrances. Standard growth strategies won't work until these are addressed.`,
    gaps: [
      { title: "Active Judgment/Lien Friction", impact: "Automatic denial from 98% of traditional lenders.", priority: "CRITICAL" },
      { title: "Asset Exposure Risk", impact: "Business and personal assets remain vulnerable to seizure.", priority: "CRITICAL" },
      { title: "Credit Score Suppression", impact: "Forced to use high-interest 'predatory' capital sources.", priority: "HIGH" },
    ],
    opportunities: [
      { title: "Lien Settlement Strategy", desc: "Negotiate and settle active encumbrances for cents on the dollar.", impact: "Immediate Relief" },
      { title: "Credit Restoration Phase 1", desc: "Begin the 90-day clock to restore fundability status.", impact: "Path to $100K+" },
    ],
    nextStepHeadline: "Start Your Financial Recovery Plan",
    nextStepBody: "You don't need a growth plan yet—you need a rescue plan. Our experts specialize in navigating judgments and liens to get your business back on the path to fundability.",
    cta: "See How the Rehab Track Works →",
    isRehab: true,
  },
};

