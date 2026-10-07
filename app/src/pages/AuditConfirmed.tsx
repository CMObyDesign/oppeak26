import { useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ClipboardList, Calendar, ArrowRight } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { BOOKING_LINK_297 } from "@/lib/ghl-config";

// Post-$297 (BGA) purchase confirmation.
//
// Primary CTA routes to the dedicated /bga-intake page on
// success.cfobydesign.com (NOT /deeper-analysis — that URL is the
// pre-$150-payment Deep Dive interstitial; routing a paid customer there
// asks them to pay again. The wrapper for the new page lives in this
// repo at bga-intake-wrapper.html at the root, to be pasted into GHL's
// funnel builder as a one-time setup step).
//
// Verification note (follow-up, not shipped here): /bga-intake currently
// trusts whoever lands via ?contactId. The HL automation only emails this
// URL to swot_paid_297 contacts, so the normal path never leaks it. A
// follow-up PR should add a worker endpoint (e.g. GET
// /verify-bga-access?contactId=X) that checks the swot_paid_297 tag, and
// a small <script> block in bga-intake-wrapper.html that calls it on
// page load and swaps the intake UI for a "paid customers only" message
// on a non-200 response. The user said "where practical" when deciding
// Option A; we deferred this to keep the first ship small and purely
// additive.

const BGA_INTAKE_URL = "https://success.cfobydesign.com/bga-intake";

const AuditConfirmed = () => {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");
  // HL redirects to this page typically include contact_id. We forward it
  // onto both the intake URL and the booking widget so the intake survey
  // picks up the right contact and the BGA calendar prefills.
  const contactId =
    searchParams.get("contactId") || searchParams.get("contact_id") || "";
  const intakeUrl = contactId
    ? `${BGA_INTAKE_URL}?contactId=${encodeURIComponent(contactId)}`
    : BGA_INTAKE_URL;
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
    // Analytics: log purchase completion with the sessionId only. The
    // real amount comes from the verified payment webhook on the worker
    // side — this client-side event is attribution context, not revenue
    // of record. (Codex P2 on #78 — see /payment-status handler.)
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
            We received your purchase. Now we need the financial picture
            behind the diagnosis so the CFO By Design team can build your
            Growth Plan from the actual numbers.
          </p>
        </div>

        {/* Primary CTA — BGA intake. */}
        <div className="pt-2">
          <Button
            onClick={() => (window.location.href = intakeUrl)}
            className="w-full sm:w-auto h-14 px-10 text-base bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
          >
            <ClipboardList className="mr-2 h-5 w-5" />
            Complete My BGA Intake
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
          <p className="text-sm text-muted-foreground mt-3 leading-relaxed max-w-md mx-auto">
            About 10&ndash;15 focused minutes. You&apos;ll answer a deeper set
            of questions and upload the financials you have &mdash; P&amp;L,
            balance sheet, AR aging, and recent business tax returns.
          </p>
        </div>

        {/* Secondary — booking. The ideal order is intake first (so the
             strategist has the real numbers before the call), with booking
             scheduled afterward. The booking button is kept visible as a
             convenience for buyers who prefer to put a time on the
             calendar now and complete the intake separately. */}
        <div className="pt-4 border-t border-white/5 space-y-3">
          <p className="text-sm text-muted-foreground">
            Already completed your intake?
          </p>
          <Button
            variant="outline"
            onClick={() => (window.location.href = bookingUrl)}
            className="h-11 px-6 border-white/10"
          >
            <Calendar className="mr-2 h-4 w-4" />
            Book my 50-minute BGA session
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
