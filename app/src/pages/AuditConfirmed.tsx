import { useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ClipboardList, Calendar, ArrowRight } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { BOOKING_LINK_297 } from "@/lib/ghl-config";

// Post-$297 (BGA) purchase confirmation.
//
// Hierarchy: completing the BGA intake is the next step, not booking the
// 50-minute session. The team cannot build Part 2 until the financials are
// in, so putting booking first would schedule sessions ahead of the
// information the session needs. The intake survey is the one HL survey
// that collects the deeper narrative AND the financial-document upload
// (the same URL referenced by the deep-dive intake-pickup emails); its
// completion is what unlocks fulfillment, so it is the only primary CTA
// here. Booking stays visible as the "already done your intake?" affordance.
//
// Two prior defects fixed in this version:
//   - The old copy promised "delivery in 48 hours" calculated from
//     purchase time. BGA fulfillment cannot start from purchase alone —
//     Part 2 is built from the uploaded financials — so the timeline
//     promise was wrong whenever intake was slow.
//   - The analytics event hardcoded `amount: 297`. This same route sells
//     the $150 immediate-action rate too; the hardcode mis-attributed
//     revenue. localStorage is not trusted either (client-side,
//     mutable). amount is now null and the verified payment webhook on
//     the worker side is the authoritative revenue source.
const BGA_INTAKE_URL = "https://success.cfobydesign.com/deeper-analysis";

const AuditConfirmed = () => {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");
  // HL redirects to this page typically include contact_id in some form.
  // Pass it through to the intake survey so the deeper-analysis form picks
  // up the same contact rather than starting a new one.
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
    // Analytics: log purchase completion with the sessionId only. The real
    // amount comes from the verified payment webhook on the worker side —
    // this client-side event is attribution context, not revenue of record.
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
            We received your purchase. Now we need the financial picture behind
            the diagnosis so the CFO By Design team can build your Growth Plan
            from the actual numbers.
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

        {/* Secondary — booking, subordinated. */}
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
