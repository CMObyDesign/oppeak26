import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Lock, Check, ShieldCheck, Activity } from "lucide-react";
export const LandingScreen = ({ onStart }: { onStart: () => void }) => {
  const makeovers = [
    {
      name: "Marcus",
      type: "HVAC Services",
      before: "Books 6 months behind. No break-even mapped. $0 funding qualified.",
      after: "Books current. Break-even clearly mapped. $425K credit line approved."
    },
    {
      name: "Elena",
      type: "E-commerce",
      before: "High churn rate. $12K/mo burn. Unclear growth strategy.",
      after: "Profitable scaling. Strategy automated. $200K SBA loan secured."
    },
    {
      name: "David",
      type: "Consulting",
      before: "Tax liability unknown. Personal & business funds mixed. Low margin.",
      after: "Tax strategy optimized. Entities cleanly split. 40% margin target reached."
    }
  ];

  return (
    <div className="flex flex-col items-center justify-center text-center relative pt-40 md:pt-56 pb-24 min-h-screen">
      <div className="space-y-12 z-10 w-full max-w-3xl px-4">
        <div className="space-y-8">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-mono text-xs md:text-sm uppercase tracking-[0.4em] text-accent font-bold"
          >
            FREE BUSINESS HEALTH ANALYSIS
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="font-display text-4xl md:text-6xl lg:text-7xl leading-[1.1] text-foreground font-bold tracking-tight"
          >
            Is Your Business <br className="hidden md:block" />
            Leaving Money <br className="hidden md:block" />
            <span className="text-primary italic">on the Table?</span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed"
          >
            Answer 11 questions. Get a personalized report that reveals the exact financial gaps keeping your business from its next funding round or revenue breakthrough.
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="flex flex-col items-center gap-8 pt-4"
        >
          <div className="space-y-4">
            <Button
              onClick={onStart}
              className="h-16 px-12 bg-primary hover:bg-primary/90 text-primary-foreground text-lg font-bold rounded-lg shadow-glow-gold transition-all hover:-translate-y-1 active:translate-y-0"
            >
              Analyze My Business Now →
            </Button>
            <p className="text-xs md:text-sm text-muted-foreground font-medium">No signup required. Takes 5 minutes.</p>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground font-bold">
              <Lock className="h-4 w-4 text-accent" /> SSL Secured
            </div>
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground font-bold">
              <Check className="h-4 w-4 text-accent" /> No Spam
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="py-12 w-full max-w-5xl mx-auto mt-16"
        >
          <div className="flex items-center justify-center gap-3 mb-10">
            <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent to-white/10" />
            <p className="text-xs md:text-sm uppercase tracking-[0.3em] text-accent font-bold px-4">REAL FINANCIAL MAKEOVERS</p>
            <div className="h-[1px] flex-1 bg-gradient-to-l from-transparent to-white/10" />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {makeovers.map((makeover, i) => (
              <div key={i} className="glass-card bg-secondary/20 border border-white/5 rounded-2xl p-6 text-left space-y-6 relative overflow-hidden group hover:border-primary/30 transition-colors">
                <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                  <Activity className="w-32 h-32 text-primary translate-x-8 -translate-y-8" />
                </div>
                
                <div className="space-y-1 relative z-10">
                  <h4 className="font-display text-2xl font-bold text-foreground">{makeover.name}</h4>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">{makeover.type}</p>
                </div>

                <div className="space-y-4 relative z-10">
                  <div className="space-y-2 p-4 rounded-xl bg-destructive/5 border border-destructive/10">
                    <p className="text-[10px] text-destructive uppercase font-bold tracking-widest flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-destructive" /> Before
                    </p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{makeover.before}</p>
                  </div>
                  
                  <div className="space-y-2 p-4 rounded-xl bg-primary/5 border border-primary/20 shadow-[0_0_15px_rgba(201,168,76,0.05)]">
                    <p className="text-[10px] text-primary uppercase font-bold tracking-widest flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary" /> After Deep Dive Audit
                    </p>
                    <p className="text-sm text-foreground font-medium leading-relaxed">{makeover.after}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.8 }}
          className="pt-8 w-full max-w-2xl mx-auto hidden md:block"
        >
          <DashboardPreview />
        </motion.div>
      </div>
    </div>
  );
};

const DashboardPreview = () => (
  <div className="relative w-full h-[400px] flex items-center justify-center">
    <div className="w-[450px] h-[350px] glass-card rounded-2xl rotate-[-1deg] shadow-2xl p-6 overflow-hidden border border-white/5 bg-card/30 backdrop-blur-xl relative">
      <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
        <div className="rotate-[-12deg] border-2 border-destructive/30 text-destructive/30 px-4 py-1 font-mono font-bold text-xl uppercase tracking-[0.3em] backdrop-blur-[2px]">
          Confidential
        </div>
      </div>

      <div className="flex items-center justify-between mb-6 border-b border-white/10 pb-4 relative z-10">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Internal SWOT Audit</span>
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-3 h-[200px] relative z-10 blur-[0.5px] opacity-40">
        <div className="border border-white/5 bg-white/5 rounded-lg p-3 flex flex-col justify-between">
          <span className="font-display text-xs text-primary font-bold">Strengths</span>
          <div className="space-y-1.5">
            <div className="h-1 w-full bg-primary/20 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-primary" 
                animate={{ width: ["30%", "90%"] }} 
                transition={{ duration: 3, repeat: Infinity, repeatType: "reverse" }} 
              />
            </div>
            <div className="h-1 w-2/3 bg-primary/20 rounded-full" />
          </div>
        </div>
        <div className="border border-white/5 bg-white/5 rounded-lg p-3 flex flex-col justify-between">
          <span className="font-display text-xs text-destructive font-bold">Weaknesses</span>
          <div className="space-y-1.5">
            <div className="h-1 w-full bg-destructive/20 rounded-full" />
            <div className="h-1 w-1/2 bg-destructive/20 rounded-full" />
          </div>
        </div>
        <div className="border border-white/5 bg-white/5 rounded-lg p-3 flex flex-col justify-between">
          <span className="font-display text-xs text-accent font-bold">Opportunities</span>
          <div className="space-y-1.5">
            <div className="h-1 w-full bg-accent/20 rounded-full" />
            <div className="h-1 w-3/4 bg-accent/20 rounded-full" />
          </div>
        </div>
        <div className="border border-white/5 bg-white/5 rounded-lg p-3 flex flex-col justify-between">
          <span className="font-display text-xs text-orange-500 font-bold">Threats</span>
          <div className="space-y-1.5">
            <div className="h-1 w-full bg-orange-500/20 rounded-full" />
            <div className="h-1 w-1/4 bg-orange-500/20 rounded-full" />
          </div>
        </div>
      </div>

      <div className="absolute inset-0 bg-gradient-to-t from-card/80 to-transparent pointer-events-none z-30" />
    </div>
  </div>
);

