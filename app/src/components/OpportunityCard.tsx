import { Target, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";

interface OpportunityCardProps {
  title: string;
  desc: string;
  impact: string;
}

export const OpportunityCard = ({ title, desc, impact }: OpportunityCardProps) => {
  return (
    <Card className="p-8 glass-card border-white/5 space-y-6 hover:bg-white/[0.04] hover:shadow-[0_0_30px_rgba(201,168,76,0.15)] transition-all duration-300 group relative overflow-hidden">
      <div className="absolute -right-8 -top-8 opacity-0 group-hover:opacity-10 transition-opacity duration-500">
        <Target className="h-32 w-32 text-primary" />
      </div>
      <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center relative z-10 group-hover:scale-110 transition-transform">
        <Sparkles className="h-6 w-6 text-primary" />
      </div>
      <div className="space-y-3 relative z-10">
        <h4 className="font-display text-xl font-bold group-hover:text-primary transition-colors">{title}</h4>
        <p className="text-muted-foreground leading-relaxed">{desc}</p>
      </div>
      <div className="pt-4 border-t border-white/5 relative z-10">
        <span className="text-[11px] font-bold text-accent uppercase tracking-[0.2em]">{impact}</span>
      </div>
    </Card>
  );
};

