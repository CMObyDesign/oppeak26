import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, FileText, Users, Calendar, ClipboardCheck } from "lucide-react";
import { PAYMENT_LINK_297 } from "@/lib/ghl-config";
import { navigateExternal } from "@/lib/navigate-external";

// Post-$47 one-time-offer page.
//
// Context: this page is shown AFTER the $47 Full Diagnostic purchase, so the
// hero does not re-introduce the brand or re-explain who CFO By Design is;
// it picks up where the Full Diagnostic left off. The whole page is a single
// offer with a single CTA that routes to the $297 payment link first — the
// 50-minute strategist session is scheduled downstream, after purchase, from
// the BGA intake flow. Routing the primary CTA at the booking widget would
// let someone grab a slot without paying.
const Upsell = () => {
  const buyBga = () => navigateExternal(PAYMENT_LINK_297);

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
        {/* Hero */}
        <section className="py-16 bg-secondary/10">
          <div className="container px-4 md:px-6 text-center space-y-6 max-w-3xl mx-auto">
            <div className="inline-block rounded-full bg-accent/10 border border-accent/20 px-4 py-1.5 text-sm font-mono text-accent">
              $297 BUSINESS GROWTH ANALYSIS
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight leading-[1.1]">
              You have the diagnosis.
              <br />
              <span className="text-primary italic">Want us to turn it into a plan?</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground leading-relaxed">
              Your Full Diagnostic showed what deserves attention. The Business Growth Analysis
              puts the real numbers behind those findings, gives the CFO By Design team a
              deeper look at the business, and turns them into a written 90-day plan.
            </p>
          </div>
        </section>

        {/* Offer stack */}
        <section className="py-16 container px-4 md:px-6">
          <div className="grid lg:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Deliverables */}
            <div className="lg:col-span-2 space-y-6">
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
                      A CFO By Design review of your diagnostic, narrative answers, and
                      financial documents. We look for the connections the first report
                      cannot prove on its own.
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
                      Organized around the next 90 days, the next 6 months, and the next
                      12 months. The first 90 days get the most weight — that is where the
                      business needs focus.
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
                      P&amp;L, balance sheet, AR aging, debt service, tax status. Not
                      a bank-balance check — we look at the connected money system.
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
                      through the plan, challenge assumptions, and answer the
                      &quot;but how?&quot; questions.
                    </p>
                  </CardContent>
                </Card>
              </div>

              <div className="pt-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  Built on Miguel Hernandez&apos;s financial framework. Delivered by the
                  CFO By Design team.
                </p>
              </div>
            </div>

            {/* Pricing card */}
            <div className="lg:col-span-1">
              <Card className="sticky top-24 border-2 border-primary bg-card overflow-hidden">
                <div className="bg-primary text-primary-foreground px-6 py-3 text-center font-bold text-sm tracking-widest uppercase">
                  One-time payment
                </div>
                <CardContent className="pt-6 space-y-5">
                  <div className="text-center space-y-1">
                    <div className="font-display text-xl">Business Growth Analysis</div>
                    <div className="text-4xl font-bold font-mono text-primary">$297</div>
                    <p className="text-xs text-muted-foreground">
                      No subscription · No long-term contract
                    </p>
                  </div>

                  <Button
                    onClick={buyBga}
                    className="w-full h-14 text-base font-bold bg-primary hover:bg-primary/90 text-primary-foreground group"
                  >
                    GET MY BUSINESS GROWTH ANALYSIS
                    <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                  </Button>
                  <p className="text-[11px] text-center text-muted-foreground leading-relaxed">
                    After payment, you&apos;ll complete the BGA intake, upload your
                    financials, and schedule your 50-minute session.
                  </p>
                </CardContent>
              </Card>
            </div>
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
          GET MY BGA — $297
        </Button>
      </div>
    </div>
  );
};

export default Upsell;
