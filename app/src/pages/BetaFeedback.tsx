import { motion } from "framer-motion";
import { CheckCircle2, MessageCircle } from "lucide-react";

const BetaFeedback = () => {
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
            Thank you.
          </h1>
          <p className="text-xl text-muted-foreground leading-relaxed">
            We've received your responses. Our team will reach out shortly to
            check in and gather your feedback on the beta experience.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-secondary/50 border border-white/5 text-left space-y-3 flex items-start gap-4">
          <MessageCircle className="h-6 w-6 text-primary shrink-0 mt-1" />
          <div>
            <h4 className="font-bold">What's next</h4>
            <p className="text-sm text-muted-foreground">
              A member of our team will contact you within 1–2 business days
              to walk through your results and ask a few short questions about
              your experience.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default BetaFeedback;
