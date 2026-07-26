import { useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Calendar, Mail, ArrowRight } from "lucide-react";
import { useSearchParams } from "react-router-dom";

const AuditConfirmed = () => {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");

  useEffect(() => {
    const intent = localStorage.getItem("cfo_audit_intent");
    if (intent) {
      const data = JSON.parse(intent);
      localStorage.setItem("cfo_audit_intent", JSON.stringify({ ...data, status: "completed" }));
    }
    console.log("[Analytics] purchase_completed", { sessionId, amount: 297 });
  }, [sessionId]);

  const deliveryDate = new Date();
  deliveryDate.setHours(deliveryDate.getHours() + 48);
  
  const formattedDate = deliveryDate.toLocaleDateString();
  const formattedTime = deliveryDate.toLocaleTimeString();

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
          <h1 className="font-display text-4xl md:text-6xl font-bold">Your Audit Is in Motion.</h1>
          <p className="text-xl text-muted-foreground leading-relaxed">
            We've received your purchase. Your CFO By Design strategist is pulling your audit now.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 py-10">
          <div className="p-6 rounded-2xl bg-secondary/50 border border-white/5 text-left space-y-3">
            <Calendar className="h-6 w-6 text-primary" />
            <h4 className="font-bold">Expected Delivery</h4>
            <p className="text-sm text-muted-foreground">
              By {formattedDate} at {formattedTime}
            </p>
          </div>
          <div className="p-6 rounded-2xl bg-secondary/50 border border-white/5 text-left space-y-3">
            <Mail className="h-6 w-6 text-primary" />
            <h4 className="font-bold">Next Steps</h4>
            <p className="text-sm text-muted-foreground">
              Check your inbox for a confirmation email and your scheduling link.
            </p>
          </div>
        </div>

        <div className="space-y-4 pt-6 border-t border-white/5">
          <p className="text-xs text-muted-foreground uppercase tracking-widest font-mono">
            Order ID: {sessionId || "ORD-MOCK"}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button 
              variant="outline" 
              onClick={() => window.location.href = "/"}
              className="w-full sm:w-auto h-12 px-8 border-white/10"
            >
              Back to Home
            </Button>
            <Button 
              className="w-full sm:w-auto h-12 px-8 bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
              onClick={() => window.location.href = "mailto:support@cfobydesign.com"}
            >
              Contact Support <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default AuditConfirmed;

