import { motion } from "framer-motion";
import { Button } from "./ui/button";
import { ArrowLeft, ShieldAlert, Phone, Calendar, ClipboardCheck } from "lucide-react";
import { Badge } from "./ui/badge";
import { CountdownTimer } from "./CountdownTimer";
import { OFFERS, getRemainingTime } from "@/lib/offerTiming";

interface RehabScreenProps {
  score: number;
  onBack: () => void;
}

export const RehabScreen = ({ score, onBack }: RehabScreenProps) => {
  return (
    <div className="min-h-screen pt-48 md:pt-64 pb-20 flex flex-col items-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-3xl space-y-12 text-center"
      >
        <div className="space-y-4">
          <Badge className="px-4 py-1 rounded-full text-[10px] tracking-[0.2em] font-mono border bg-destructive/20 text-destructive border-destructive/20">
            REHABILITATION BRANCH
          </Badge>
          <h2 className="text-4xl md:text-5xl font-display font-bold text-foreground">
            Clear the Path to <span className="text-destructive">Fundability</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            Your active judgments or liens are the primary blocker. We need to stabilize your foundation before growth strategy is even possible.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 text-left">
          <div className="p-8 rounded-2xl bg-secondary/50 border border-border space-y-4">
            <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <ShieldAlert className="h-6 w-6 text-destructive" />
            </div>
            <h4 className="text-xl font-bold text-foreground">Rescue Strategy Session</h4>
            <p className="text-sm text-muted-foreground leading-relaxed">
              A specialized consult focused purely on lien negotiation, judgment settlement, and credit restoration timelines.
            </p>
            <ul className="space-y-2 pt-2">
              {[
                "Lien settlement negotiation tactics",
                "Judgment removal roadmap",
                "Restoring lender trust",
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ClipboardCheck className="h-3 w-3 text-destructive" /> {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="p-8 rounded-2xl bg-card border border-border flex flex-col justify-between">
            <div className="space-y-4">
              <h4 className="text-xl font-bold text-foreground">Book Your Rescue Call</h4>
              <p className="text-sm text-muted-foreground">
                Our strategists have helped hundreds of business owners navigate active financial encumbrances.
              </p>
            </div>
            
            <div className="space-y-4 pt-8">
              <div className="flex justify-center mb-2">
                <CountdownTimer 
                  durationHours={OFFERS.REHAB_CREDIT_250.durationHours} 
                  label={OFFERS.REHAB_CREDIT_250.label} 
                />
              </div>
              {!getRemainingTime(OFFERS.REHAB_CREDIT_250.durationHours).isExpired ? (
                <div className="space-y-4">
                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-center">
                    <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">
                      Special Action Taker Offer
                    </p>
                    <p className="text-sm font-bold text-foreground">
                      $250 Credit Applied to Your $1,500 Rescue Plan
                    </p>
                  </div>
                  <Button 
                    onClick={() => window.open("https://calendly.com/cfobydesign/rehab-rescue", "_blank")}
                    className="w-full h-14 bg-destructive hover:bg-destructive/90 text-white font-bold rounded-xl shadow-lg"
                  >
                    <Phone className="mr-2 h-4 w-4" /> Schedule Rescue Session
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-3 bg-muted border border-border rounded-lg text-center opacity-60">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                      Offer Expired
                    </p>
                    <p className="text-sm font-bold text-muted-foreground">
                      The $250 credit is no longer available.
                    </p>
                  </div>
                  <Button 
                    onClick={() => window.open("https://calendly.com/cfobydesign/rehab-rescue", "_blank")}
                    className="w-full h-14 bg-secondary hover:bg-secondary/90 text-foreground font-bold rounded-xl shadow-lg"
                  >
                    <Phone className="mr-2 h-4 w-4" /> Schedule Rescue Session
                  </Button>
                </div>
              )}
              <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground uppercase tracking-widest">
                <Calendar className="h-3 w-3" /> Next Available: Tomorrow
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={onBack}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm font-medium mx-auto"
        >
          <ArrowLeft className="h-4 w-4" /> Return to my SWOT Report
        </button>
      </motion.div>
    </div>
  );
};

