import { motion } from "framer-motion";
import { Activity } from "lucide-react";
import { useEffect, useState } from "react";

// Rotating status lines shown one at a time while the Worker generates the
// Business Health Check. These are deliberately noncommittal — each one
// describes an actual pass the Worker makes against the submitted answers,
// not a specific calculation we may or may not have performed. Replaces
// the previous hard-coded checklist (which overstated what was measured
// with claims about "funding readiness scored" and "2,400+ business
// profiles" that no runtime source backed up).
const STATUS_LINES = [
  "Reviewing your business profile",
  "Checking financial decision-making and debt context",
  "Reviewing revenue leaks and business strengths",
  "Looking at growth and concentration signals",
  "Prioritizing the strongest findings",
  "Building your Business Health Check",
];

// Visual progress caps at 92% while we wait for the actual worker response.
// The remaining 8% is reserved for the parent's screen transition so the
// bar never sits at 100% while the user stares at a frozen page. Codex
// #133 copy directive 2026-10-17.
const PROGRESS_CAP = 92;

// Minimum visible duration before onComplete fires. The parent transitions
// to results when BOTH the worker response has landed AND this timer has
// fired — so this acts as a floor (don't flash past the loading screen on
// fast responses), not a ceiling. The customer never waits longer than
// the worker takes.
const MIN_VISIBLE_MS = 5000;

// Cadence for rotating status lines (ms per line). Six lines × 6s = 36s
// per full loop; we keep cycling if the worker takes longer than that
// since each line is still a plausible description of what's happening.
const LINE_ROTATE_MS = 6000;

// How long we animate from 0% → PROGRESS_CAP in the visual bar. Set wide
// so the bar typically doesn't reach the cap before the worker responds;
// if it does, it holds at 92% until the response arrives.
const BAR_FILL_MS = 60000;

export const ProcessingScreen = ({ onComplete, tier }: { onComplete: () => void; tier?: string }) => {
  const [lineIdx, setLineIdx] = useState(0);
  // 2026-10-29: paid generation runs 2-3+ minutes in practice
  // (streaming + larger prompt). Keep the free line as-is; soften
  // the paid line so the "about a minute" promise is not broken on
  // every paid run. Polling behavior is unchanged.
  const waitCopy =
    tier === "paid_47" || tier === "paid_297"
      ? "This may take a few minutes. Keep this page open while we finish your results."
      : "This may take about a minute. Keep this page open while we finish your results.";

  // Fire onComplete once the minimum visible window has elapsed so the
  // parent can transition the moment the worker response arrives.
  useEffect(() => {
    const t = setTimeout(() => onComplete(), MIN_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [onComplete]);

  // Cycle through STATUS_LINES one-at-a-time. Loops back to the first
  // once we've shown them all, so a slow response never leaves the screen
  // stuck on "Building your Business Health Check" for 90 seconds.
  useEffect(() => {
    const i = setInterval(() => {
      setLineIdx((prev) => (prev + 1) % STATUS_LINES.length);
    }, LINE_ROTATE_MS);
    return () => clearInterval(i);
  }, []);

  const currentLine = STATUS_LINES[lineIdx];

  return (
    // 2026-10-29 height fix: the previous `min-h-screen ... pt-48
    // md:pt-64` combined a tall minimum height with an additional 12-16
    // rem of top padding, pushing the content well below the fold and
    // forcing the page taller than the viewport. The parent layout
    // already handles outer padding; this screen just needs to center
    // its content inside a viewport-height box with a modest horizontal
    // pad. `min-h-[80vh]` keeps the content centered without reserving
    // extra scroll length on long viewports.
    <div className="min-h-[80vh] flex flex-col items-center justify-center px-4 py-16 relative overflow-hidden">
      <div className="relative z-10 text-center space-y-8 w-full max-w-xl">
        <div className="space-y-3">
          <motion.h3
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="font-display text-3xl md:text-4xl text-foreground font-bold"
          >
            Reviewing your Business Health Check
          </motion.h3>
          <p className="text-muted-foreground text-base leading-relaxed max-w-md mx-auto">
            We're reviewing your answers for the strongest financial and operating signals worth a closer look.
          </p>
        </div>

        {/* Single rotating status line. Fades between lines with
            AnimatePresence-style key-swapped motion. */}
        <div className="h-8 flex items-center justify-center">
          <motion.div
            key={lineIdx}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.4 }}
            className="flex items-center gap-3 text-primary font-medium"
          >
            <Activity className="h-4 w-4 animate-pulse" />
            <span className="font-body">{currentLine}</span>
          </motion.div>
        </div>

        <div className="w-full space-y-2">
          <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${PROGRESS_CAP}%` }}
              transition={{ duration: BAR_FILL_MS / 1000, ease: "linear" }}
              className="h-full bg-primary"
            />
          </div>
        </div>

        <p className="text-sm text-muted-foreground font-body max-w-sm mx-auto">
          {waitCopy}
        </p>
      </div>

      {/* Background SWOT Grid Animation — constrained to the viewport
          so the fixed 800x800 pattern can't force the page taller than
          its content on tall viewports. */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03] overflow-hidden flex items-center justify-center">
        <div className="grid grid-cols-2 gap-8 w-[min(800px,80vmin)] h-[min(800px,80vmin)]">
          <motion.div
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="border border-white flex items-center justify-center text-8xl font-display"
          >
            S
          </motion.div>
          <motion.div
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ delay: 0.5, duration: 2, repeat: Infinity }}
            className="border border-white flex items-center justify-center text-8xl font-display"
          >
            W
          </motion.div>
          <motion.div
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ delay: 1, duration: 2, repeat: Infinity }}
            className="border border-white flex items-center justify-center text-8xl font-display"
          >
            O
          </motion.div>
          <motion.div
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ delay: 1.5, duration: 2, repeat: Infinity }}
            className="border border-white flex items-center justify-center text-8xl font-display"
          >
            T
          </motion.div>
        </div>
      </div>
    </div>
  );
};
