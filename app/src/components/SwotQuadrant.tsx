import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";

interface SwotQuadrantProps {
  categoryScores: Record<string, number>;
  score: number;
}

export const SwotQuadrant = ({ categoryScores, score }: SwotQuadrantProps) => {
  // Simplified mapping for the quadrant visualization
  const quadrants = [
    { 
      label: "S", 
      title: "Strengths", 
      color: "text-primary", 
      bg: "bg-primary/5", 
      val: score > 20 ? 85 : 60 
    },
    { 
      label: "W", 
      title: "Weaknesses", 
      color: "text-destructive", 
      bg: "bg-destructive/5", 
      val: score < 15 ? 90 : 40 
    },
    { 
      label: "O", 
      title: "Opportunities", 
      color: "text-accent", 
      bg: "bg-accent/5", 
      val: 75 
    },
    { 
      label: "T", 
      title: "Threats", 
      color: "text-orange-500", 
      bg: "bg-orange-500/5", 
      val: score < 18 ? 80 : 30 
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {quadrants.map((item, i) => (
        <Card key={i} className={`p-8 glass-card border-white/5 ${item.bg} space-y-6 overflow-hidden relative group`}>
          <div className="flex items-center justify-between relative z-10">
            <div className="flex items-center gap-4">
              <span className={`font-display text-4xl font-bold ${item.color}`}>{item.label}</span>
              <span className="font-display font-bold uppercase tracking-[0.2em] text-sm opacity-70">{item.title}</span>
            </div>
          </div>
          <div className="space-y-3 relative z-10">
            <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                whileInView={{ width: `${item.val}%` }}
                viewport={{ once: true }}
                transition={{ delay: 0.5 + i * 0.15, duration: 1, ease: "easeOut" }}
                className={`h-full ${
                  item.label === "S" ? "bg-primary" : 
                  item.label === "W" ? "bg-destructive" : 
                  item.label === "O" ? "bg-accent" : 
                  "bg-orange-500"
                }`}
              />
            </div>
            <div className="flex justify-between font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
              <span>Analysis Level</span>
              <span>{item.val}%</span>
            </div>
          </div>
          {/* Decorative background letter */}
          <div className="absolute -right-4 -bottom-8 text-[120px] font-display font-bold opacity-[0.03] select-none group-hover:opacity-[0.06] transition-opacity">
            {item.label}
          </div>
        </Card>
      ))}
    </div>
  );
};

