import { AlertCircle, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";

interface GapCardProps {
  title: string;
  impact: string;
  priority: string;
}

export const GapCard = ({ title, impact, priority }: GapCardProps) => {
  const priorityStyles = 
    priority === "CRITICAL" ? "bg-destructive/10 border-destructive/20 text-destructive" :
    priority === "HIGH" ? "bg-orange-500/10 border-orange-500/20 text-orange-500" :
    "bg-primary/10 border-primary/20 text-primary";

  return (
    <Card className="p-6 glass-card border-white/5 flex items-start gap-6 hover:bg-white/[0.04] hover:shadow-lg transition-all duration-300 group">
      <div className="mt-1 h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
        <AlertCircle className="h-5 w-5 text-destructive" />
      </div>
      <div className="flex-1 space-y-1">
        <div className="flex items-center justify-between">
          <h4 className="font-display text-xl font-bold group-hover:text-primary transition-colors">{title}</h4>
          <span className={`text-[10px] font-bold px-3 py-1 rounded border tracking-widest ${priorityStyles}`}>
            {priority}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-muted-foreground">{impact}</p>
          <ArrowRight className="h-4 w-4 text-primary opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" />
        </div>
      </div>
    </Card>
  );
};

