import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Mail, ArrowRight, Sparkles } from "lucide-react";
import { useSearchParams } from "react-router-dom";

const BETA_MID_ANALYSIS_URL =
  "https://success.cfobydesign.com/mid-analysis-page";

const BetaThanks = () => {
  const [searchParams] = useSearchParams();
  const contactId = searchParams.get("contactId") || "";
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "invalid" | "applying">("idle");

  const handleApply = async () => {
    const normalized = code.trim().toUpperCase();
    if (normalized !== "SOLOMON50") {
      setStatus("invalid");
      return;
    }
    setStatus("applying");
    if (contactId) {
      try {
        await fetch("https://swot-engine.cfobydesign.workers.dev/apply-solomon50", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactId, code: normalized }),
        });
      } catch {
        // Best-effort — the tag write shouldn't block the beta redirect.
      }
    }
    const target = contactId
      ? `${BETA_MID_ANALYSIS_URL}?contact_id=${encodeURIComponent(contactId)}`
      : BETA_MID_ANALYSIS_URL;
    window.location.href = target;
  };

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
              opportunity flags, and next steps.
            </p>
          </div>
        </div>

        <div className="pt-8 border-t border-white/5 space-y-4 text-left">
          <div className="flex items-center gap-2 justify-center">
            <Sparkles className="h-4 w-4 text-primary" />
            <p className="text-xs uppercase tracking-[0.3em] font-mono text-primary">
              Beta Access
            </p>
          </div>
          <p className="text-lg text-muted-foreground text-center">
            Enter your beta code to unlock the mid-tier analysis.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 items-stretch">
            <Input
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                if (status === "invalid") setStatus("idle");
              }}
              placeholder="Enter code (e.g. SOLOMON50)"
              autoComplete="off"
              spellCheck={false}
              className="flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleApply();
                }
              }}
              disabled={status === "applying"}
            />
            <Button
              onClick={handleApply}
              disabled={status === "applying" || !code.trim()}
              size="lg"
            >
              {status === "applying" ? "Applying…" : "Apply"}
              {status !== "applying" && <ArrowRight className="ml-2 h-4 w-4" />}
            </Button>
          </div>
          {status === "invalid" && (
            <p className="text-sm text-red-400 font-mono">
              That code isn't recognized. Double-check spelling.
            </p>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default BetaThanks;
