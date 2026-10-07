import { useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Calendar, Mail, ArrowRight } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { BOOKING_LINK_297 } from "@/lib/ghl-config";

// Post-$297 (BGA) purchase confirmation.
//
// Codex P1 on #78 flagged that an earlier version of this page sent the
// buyer to https://success.cfobydesign.com/deeper-analysis as the primary
// intake CTA. That page is in fact the PRE-$150-payment Deep Dive
// interstitial (see deep-dive-preview-wrapper.html at the repo root, which
// describes the flow as "Full Diagnostic $47 report -> click $150 Deep
// Dive -> /deeper-analysis -> user submits the survey -> GHL post-submit
// redirect lands on /deep-dive-preview -> payment"). Routing a buyer who
// just paid $297 there would ask them to pay another $150.
//
// Follow-up work this exposes (NOT addressed in this file):
//   - The three BGA intake-pickup emails (09_, 10_, 11_) also point at
//     the same /deeper-analysis URL and have the same defect.
//   - The /deeper-analysis + /deep-dive-preview wrappers themselves still
//     reference the retired $150 Deep Dive price, not the current $297
//     BGA. They need to be updated or replaced on success.cfobydesign.com
//     before any paid-flow surface can safely route to them.
//
// Interim behavior: this page offers the two reliable post-paid actions
// that don't route into the trap:
//   - Booking the 50-minute BGA session (BOOKING_LINK_297 — stable HL
//     widget, unaffected by the sibling-repo issue).
//   - "Check your inbox" messaging that defers to the HL automation to
//     deliver the correct intake instructions once the sibling repo is
//     fixed.
//
// Analytics event logs amount: null (verified payment webhook on the
// worker owns revenue of record; the $150 immediate-action rate and the
// standard $297 BGA both flow through this same route).
const AuditConfirmed = () => {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");
  // HL redirects to this page typically include contact_id. We forward it
  // onto the booking widget so the BGA calendar prefills the right contact.
  const contactId =
    searchParams.get("contactId") || searchParams.get("contact_id") || "";
  const bookingUrl = contactId
    ? `${BOOKING_LINK_297}?contact_id=${encodeURIComponent(contactId)}`
    : BOOKING_LINK_297;

  useEffect(() => {
    const intent = localStorage.getItem("cfo_audit_intent");
    if (intent) {
      try {
        const data = JSON.parse(intent);
        localStorage.setItem(
          "cfo_audit_intent",
          JSON.stringify({ ...data, status: "completed" }),
        );
      } catch {
        // localStorage can be unparseable / disabled; the UX below works
        // either way.
      }
    }
    console.log("[Analytics] purchase_completed", {
      sessionId,
      product: "paid_297",
      amount: null,
    });
  }, [sessionId]);

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
            Your Business Growth Analysis is started.
          </h1>
          <p className="text-xl text-muted-foreground leading-relaxed">
            We received your purchase. The CFO By Design team is lined up to
            build your Business Growth Plan from your actual financials.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 py-6 text-left">
          <div className="p-6 rounded-2xl bg-secondary/50 border border-white/5 space-y-3">
            <Mail className="h-6 w-6 text-primary" />
            <h4 className="font-bold">Check your inbox</h4>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your BGA intake link and financial-upload instructions are on
              the way. The team cannot build Part 2 until the financials are
              received, so complete the intake as soon as you can.
            </p>
          </div>
          <div className="p-6 rounded-2xl bg-secondary/50 border border-white/5 space-y-3">
            <Calendar className="h-6 w-6 text-primary" />
            <h4 className="font-bold">Lock in your 50-minute session</h4>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Put the strategy session on the calendar now so the slot is
              held. We&apos;ll walk through your Growth Plan together.
            </p>
          </div>
        </div>

        <div className="pt-2">
          <Button
            onClick={() => (window.location.href = bookingUrl)}
            className="h-12 px-10 bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
          >
            Book my 50-minute BGA session <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed max-w-xl mx-auto">
          Once your financials are received, your Business Growth Plan is
          typically prepared within 48 hours.
        </p>

        <div className="pt-6 border-t border-white/5">
          <p className="text-xs text-muted-foreground uppercase tracking-widest font-mono">
            Order ID: {sessionId || "ORD-MOCK"}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Need help?{" "}
            <a
              href="mailto:consulting@cfobydesign.com"
              className="underline hover:text-foreground"
            >
              consulting@cfobydesign.com
            </a>
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default AuditConfirmed;
