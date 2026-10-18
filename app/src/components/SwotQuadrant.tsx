import { Card } from "@/components/ui/card";

// Label-only Financial Health Snapshot card. Replaces the previous SWOT
// percentage quadrant (Codex #133 copy directive 2026-10-17) — the old
// numbers (60/90/75/80) came from a path-score threshold rather than any
// documented formula, so showing them to the owner was pseudo-precision.
// The locked customer-facing product is "Business Health Check," so no
// "SWOT" wording appears in the public UI.
//
// Each slot renders a short category label (locked by product) and a
// one-liner narrative drawn from the report. The caller passes an
// `items` map with the four slot narratives; a sensible fallback is used
// when the report hasn't produced one.

// Codex P2 on #135: the four slots now carry report-specific
// headings + bodies drawn from the live report, not fixed
// placeholders. ResultsScreen derives one SnapshotSlot per key
// (undefined for keys the report doesn't support — e.g. no
// strength field — in which case the slot's generic fallback copy
// renders).
export interface SnapshotSlot {
  heading?: string;
  body?: string;
}
export interface SnapshotItems {
  strength?:       SnapshotSlot;
  needsAttention?: SnapshotSlot;
  opportunity?:    SnapshotSlot;
  watch?:          SnapshotSlot;
}

interface Props {
  // Kept for backwards compatibility with the ResultsScreen call site;
  // ignored by the new card (which carries no numeric scoring).
  categoryScores?: Record<string, number>;
  score?: number;
  items?: SnapshotItems;
}

const SLOTS = [
  {
    label: "STRENGTH",
    heading: "What's already working",
    key: "strength" as const,
    tone: "text-primary border-primary/20 bg-primary/5",
    chip: "bg-primary/10 text-primary",
    fallback: "Signals in your answers that are already working for you.",
  },
  {
    label: "NEEDS ATTENTION",
    heading: "What deserves a closer look",
    key: "needsAttention" as const,
    tone: "text-accent border-accent/20 bg-accent/5",
    chip: "bg-accent/10 text-accent",
    fallback: "A friction point worth a closer look before you push harder on growth.",
  },
  {
    label: "OPPORTUNITY",
    heading: "Where to push next",
    key: "opportunity" as const,
    tone: "text-foreground border-white/10 bg-secondary/20",
    chip: "bg-foreground/5 text-foreground",
    fallback: "A direction your answers hint at that could compound over time.",
  },
  {
    label: "WATCH",
    heading: "What to monitor",
    key: "watch" as const,
    tone: "text-destructive border-destructive/20 bg-destructive/5",
    chip: "bg-destructive/10 text-destructive",
    fallback: "Something to monitor so it doesn't become a bigger problem later.",
  },
];

export const SwotQuadrant = ({ items }: Props) => {
  return (
    <div className="space-y-6">
      <h3 className="font-display text-2xl md:text-3xl font-bold text-center text-foreground">
        Your Financial Health Snapshot
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {SLOTS.map((slot) => {
          const slotItem = items?.[slot.key];
          const heading  = (slotItem && slotItem.heading) || slot.heading;
          const body     = (slotItem && slotItem.body)    || slot.fallback;
          return (
            <Card
              key={slot.key}
              className={`p-6 glass-card border space-y-3 ${slot.tone}`}
            >
              <span
                className={`inline-block px-3 py-1 rounded-full font-mono text-[10px] font-bold tracking-[0.18em] uppercase ${slot.chip}`}
              >
                {slot.label}
              </span>
              <p className="font-display text-lg md:text-xl font-bold leading-tight">
                {heading}
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {body}
              </p>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
