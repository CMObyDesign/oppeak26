import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, FileText, Users, Calendar, ClipboardCheck } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { PAYMENT_LINK_297, BOOKING_LINK_47 } from "@/lib/ghl-config";
import { navigateExternal } from "@/lib/navigate-external";

// Post-$47 one-time-offer page.
//
// This page is shown IMMEDIATELY after the $47 Full Diagnostic purchase —
// before the report email has even landed in the buyer's inbox. So the
// hero reads as a next-step offer, not a diagnosis they've already seen:
// "You've unlocked the Full Diagnostic. Want us to turn the findings
// into a 90-day plan?"
//
// Classic OTO structure: one offer, one yes, one no. The yes goes to the
// $297 payment link (payment-first — booking happens downstream from the
// BGA intake). The no is a prominent decline affordance that keeps the
// buyer in their $47 fulfillment path — they already paid for that
// product and must never feel like the OTO is required to access it.
//
// Price anchor: this page shows $297 only. The $150 immediate-action rate
// (if ever offered) is contextual on the post-$47 strategist call, not
// here; showing both would destroy the $297 anchor.

const WORKER_REPORT_BASE = "https://swot-engine.cfobydesign.workers.dev/report";

const Upsell = () => {
  const [searchParams] = useSearchParams();
  // HL redirects to this page typically include contact_id in some form.
  // If present we can take a declining buyer straight to their Full
  // Diagnostic report; otherwise we route them to the included 30-min
  // strategist review (BOOKING_LINK_47), which is the next concrete
  // step in the $47 fulfillment flow and reads cleanly as "continue to
  // my Full Diagnostic".
  const contactId =
    searchParams.get("contactId") || searchParams.get("contact_id") || "";
  const declineUrl = contactId
    ? `${WORKER_REPORT_BASE}/${encodeURIComponent(contactId)}`
    : BOOKING_LINK_47;

  const buyBga = () => navigateExternal(PAYMENT_LINK_297);
  const decline = () => navigateExternal(declineUrl);

  return (
    <div className="min-h-screen bg-background selection:bg-primary/30 font-body">
      {/* Minimal header — this is a post-purchase OTO, not a public sales page. */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="container flex h-16 items-center px-4 md:px-6">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-primary rounded-md flex items-center justify-center font-display font-bold text-primary-foreground">
              C
            </div>
            <span className="font-display text-lg font-bold tracking-tight uppercase">CFO BY DESIGN</span>
          </div>
        </div>
      </header>

      <main className="pb-24">
        {/* Hero — carries the full ask (CTA + decline). */}
        <section className="py-16 bg-secondary/10">
          <div className="container px-4 md:px-6 text-center space-y-7 max-w-3xl mx-auto">
            <div className="inline-block rounded-full bg-accent/10 border border-accent/20 px-4 py-1.5 text-sm font-mono text-accent">
              $297 BUSINESS GROWTH ANALYSIS
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight leading-[1.1]">
              You&rsquo;ve unlocked the Full Diagnostic.
              <br />
              <span className="text-primary italic">Want us to turn the findings into a 90-day plan?</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground leading-relaxed">
              Your Full Diagnostic will show what deserves attention. The Business Growth
              Analysis takes the next step by reviewing the real financials behind those
              findings, connecting the numbers, and turning the priorities into a written
              plan for the next 90 days.
            </p>

            <div className="pt-2 space-y-3">
              <Button
                onClick={buyBga}
                className="h-14 px-10 text-base bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-glow-gold group"
              >
                YES, BUILD MY 90-DAY GROWTH PLAN
                <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
              <p className="text-sm text-muted-foreground">
                Business Growth Analysis &middot; $297 one time &middot; No subscription
              </p>
              <button
                type="button"
                onClick={decline}
                className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors"
              >
                No thanks, continue to my Full Diagnostic &rarr;
              </button>
            </div>
          </div>
        </section>

        {/* Deliverables */}
        <section className="py-14 container px-4 md:px-6">
          <div className="max-w-4xl mx-auto space-y-6">
            <h2 className="font-display text-2xl font-bold border-l-4 border-primary pl-5">
              What you get
            </h2>

            <div className="grid sm:grid-cols-2 gap-5">
              <Card className="bg-secondary/10 border-border/50">
                <CardContent className="pt-6 space-y-3">
                  <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="text-lg font-bold">Team review</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    A CFO By Design team review of your diagnostic, narrative answers,
                    and financial documents. We connect the patterns across cash flow,
                    debt, profitability, receivables, and growth capacity.
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-secondary/10 border-border/50">
                <CardContent className="pt-6 space-y-3">
                  <div className="w-11 h-11 rounded-lg bg-accent/10 flex items-center justify-center">
                    <FileText className="h-5 w-5 text-accent" />
                  </div>
                  <h3 className="text-lg font-bold">Written Business Growth Plan</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Organized around your next 90 days, 6 months, and 12 months, with
                    the first 90 days prioritized so you know what deserves action now
                    and what can wait.
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-secondary/10 border-border/50">
                <CardContent className="pt-6 space-y-3">
                  <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center">
                    <ClipboardCheck className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="text-lg font-bold">Financial-document review</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    P&amp;L, balance sheet, AR aging, current debt obligations, and
                    available tax-return information. We look at the connected financial
                    picture, not just what is sitting in the bank account today.
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-secondary/10 border-border/50">
                <CardContent className="pt-6 space-y-3">
                  <div className="w-11 h-11 rounded-lg bg-accent/10 flex items-center justify-center">
                    <Calendar className="h-5 w-5 text-accent" />
                  </div>
                  <h3 className="text-lg font-bold">50-minute strategy session</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    A live working session with a CFO By Design strategist to walk
                    through the plan, pressure-test assumptions, prioritize the next
                    moves, and answer the &quot;but how?&quot; questions.
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Friction-reducer — only accurate because the HL contact and worker
                 pass contactId forward into the BGA intake survey; the deeper
                 intake renders the existing contact's answers and does not ask
                 them again. */}
            <div className="mt-8 p-5 rounded-lg bg-secondary/20 border border-border/40 text-center">
              <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                <strong className="text-foreground">You&rsquo;re not starting over.</strong>{" "}
                We carry forward what you&rsquo;ve already told us. The BGA simply goes
                deeper by adding the financials and the planning layer.
              </p>
            </div>

            <p className="pt-2 text-sm text-muted-foreground leading-relaxed text-center">
              Built on Miguel Hernandez&rsquo;s financial framework. Delivered by the
              CFO By Design team.
            </p>
          </div>
        </section>

        {/* How it works */}
        <section className="py-14 bg-secondary/10">
          <div className="container px-4 md:px-6 max-w-3xl mx-auto">
            <h2 className="font-display text-2xl font-bold text-center mb-10">How it works</h2>
            <ol className="space-y-5">
              {[
                "Get the Business Growth Analysis for $297.",
                "Complete the BGA intake and upload the financials you have.",
                "The CFO By Design team reviews the business through Miguel Hernandez's financial framework.",
                "Your Business Growth Plan is prepared from the actual numbers.",
                "Meet with your CFO By Design strategist for a 50-minute working session.",
              ].map((text, i) => (
                <li key={i} className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm shrink-0 mt-0.5">
                    {i + 1}
                  </div>
                  <p className="text-base leading-relaxed pt-1">{text}</p>
                </li>
              ))}
            </ol>
            <p className="text-sm text-muted-foreground italic text-center mt-8 leading-relaxed">
              Don&apos;t have every document perfectly organized? Upload what you have.
              Missing financial visibility is useful information too.
            </p>
          </div>
        </section>
      </main>

      {/* Sticky mobile CTA */}
      <div className="fixed bottom-0 left-0 w-full p-3 bg-background/90 backdrop-blur-md border-t border-border/50 lg:hidden">
        <Button
          onClick={buyBga}
          className="w-full h-12 bg-primary text-primary-foreground font-bold"
        >
          YES, BUILD MY 90-DAY GROWTH PLAN &rarr;
        </Button>
      </div>
    </div>
  );
};

export default Upsell;
