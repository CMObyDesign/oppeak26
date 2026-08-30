import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Mail, ArrowRight } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { PAYMENT_LINK_47 } from "@/lib/ghl-config";

const Thanks = () => {
  const [searchParams] = useSearchParams();
  const contactId = searchParams.get("contactId") || "";
  const upgradeHref = contactId
    ? `${PAYMENT_LINK_47}?contact_id=${encodeURIComponent(contactId)}`
    : PAYMENT_LINK_47;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-2xl w-full space-y-8"
      >
        <div className="flex justify-center">
          <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center">
            <CheckCircle2 className="h-12 w-12 text-primary animate-in zoom-in duration-500" />
          </div>
        </div>

        <div className="space-y-4">
          <h1 className="font-display text-4xl md:text-6xl font-bold">
            Analysis in progress.
          </h1>
          <p className="text-xl text-muted-foreground leading-relaxed">
            Your Business Health Check results are being prepared and will land
            in your inbox in the next 1–2 minutes.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-secondary/50 border border-white/5 text-left space-y-3 flex items-start gap-4">
          <Mail className="h-6 w-6 text-primary shrink-0 mt-1" />
          <div>
            <h4 className="font-bold">Check your inbox</h4>
            <p className="text-sm text-muted-foreground">
              We'll email you a full report with your diagnostic path,
              opportunity flags, and next steps. If it doesn't arrive within
              five minutes, check spam or promotions.
            </p>
          </div>
        </div>

        <div className="pt-8 border-t border-white/5 space-y-4">
          <p className="text-xs uppercase tracking-[0.3em] font-mono text-primary">
            Ready to go deeper?
          </p>
          <p className="text-lg text-muted-foreground">
            Unlock the full deep-dive analysis and a 1:1 strategy call.
          </p>
          <Button asChild size="lg" className="w-full md:w-auto">
            <a href={upgradeHref}>
              Unlock Full Analysis — $47
              <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </Button>
        </div>
      </motion.div>
    </div>
  );
};

export default Thanks;
