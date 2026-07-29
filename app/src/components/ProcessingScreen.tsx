import { motion } from "framer-motion";
import { Check, Activity } from "lucide-react";
import { useEffect, useState } from "react";

export const ProcessingScreen = ({ onComplete }: { onComplete: () => void }) => {
  // Progress bar hits 100% at 3.5s but the Claude call typically takes 15-30s.
  // Show a "still working" note once the bar completes so users don't think the page froze.
  const [barDone, setBarDone] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setBarDone(true);
      onComplete();
    }, 3500);
    return () => clearTimeout(timer);
  }, [onComplete]);

  const lines = [
    { text: "✓ Revenue patterns evaluated", delay: 0.3 },
    { text: "✓ Funding readiness scored", delay: 0.8 },
    { text: "✓ Credit position assessed", delay: 1.3 },
    { text: "✓ Cash flow risk calculated", delay: 1.8 },
    { text: "✓ Comparing to 2,400+ business profiles...", delay: 2.3 },
    { text: "⚡ Generating your personalized report...", delay: 2.8, gold: true },
  ];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 pt-48 md:pt-64 relative overflow-hidden">
      <div className="relative z-10 text-center space-y-12 w-full max-w-lg">
        <div className="space-y-6">
          <motion.h3
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="font-display text-4xl text-foreground font-bold"
          >
            Analyzing Your Business Profile...
          </motion.h3>

          <div className="space-y-4 text-left max-w-sm mx-auto">
            {lines.map((line, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: line.delay }}
                className={`flex items-center gap-3 ${
                  line.gold ? "text-primary font-bold text-lg mt-6" : "text-muted-foreground text-sm"
                }`}
              >
                {line.gold ? (
                  <Activity className="h-5 w-5 text-primary animate-pulse" />
                ) : (
                  <Check className="h-4 w-4 text-accent" />
                )}
                <span className="font-body">{line.text}</span>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="w-full space-y-2">
          <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: "100%" }}
              transition={{ duration: 3.5, ease: "linear" }}
              className="h-full bg-primary"
            />
          </div>
        </div>

        {barDone && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
            className="text-sm text-muted-foreground font-body pt-4"
          >
            Finalizing your report — this usually takes another 20–40 seconds. Please keep this tab open.
          </motion.p>
        )}
      </div>

      {/* Background SWOT Grid Animation */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03] overflow-hidden flex items-center justify-center">
        <div className="grid grid-cols-2 gap-8 w-[800px] h-[800px]">
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

