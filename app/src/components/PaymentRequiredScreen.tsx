import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";

interface Props {
  tier: "paid_47" | "paid_297";
  paymentUrl: string;
}

export const PaymentRequiredScreen = ({ tier, paymentUrl }: Props) => {
  const tierLabel = tier === "paid_47" ? "Full Diagnostic" : "Deep Dive";
  const price = tier === "paid_47" ? "$47" : "$297";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 pt-32 pb-20 text-center">
      <div className="max-w-xl space-y-8">
        <div className="flex justify-center">
          <div className="p-4 rounded-full bg-secondary/40 border border-white/5">
            <Lock className="h-10 w-10 text-muted-foreground" />
          </div>
        </div>

        <div className="space-y-4">
          <h1 className="font-display text-4xl font-bold">
            Complete your {tierLabel} purchase to continue
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Looks like the payment hasn't completed yet — or this link was opened
            without going through checkout. Click below to pay and you'll be brought
            right back to your assessment.
          </p>
        </div>

        <Button
          onClick={() => { window.location.href = paymentUrl; }}
          className="h-16 px-12 text-lg font-bold rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          Complete {tierLabel} purchase — {price}
        </Button>

        <p className="text-xs text-muted-foreground">
          Already paid? Give it a few seconds, then refresh. If you still see this,
          email <a className="underline" href="mailto:hello@cfobydesign.com">hello@cfobydesign.com</a>.
        </p>
      </div>
    </div>
  );
};

