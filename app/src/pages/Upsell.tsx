import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CheckCircle2, TrendingUp, ShieldCheck, Target, ArrowRight, Star, Clock, Users, Zap, Award } from "lucide-react";
import { BookingCalendar } from "@/components/BookingCalendar";
import { IMAGE_STRATEGIST_BG } from "@/lib/ghl-config";

const Upsell = () => {
  const [isBookingOpen, setIsBookingOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background selection:bg-primary/30 font-body">
      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container flex h-20 items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-primary rounded-md flex items-center justify-center font-display font-bold text-primary-foreground text-xl">
              C
            </div>
            <span className="font-display text-xl font-bold tracking-tight uppercase">CFO BY DESIGN</span>
          </div>
          <div className="hidden sm:block">
            <span className="text-sm font-mono text-accent animate-pulse">LIMITED TIME OFFER: 80% OFF</span>
          </div>
        </div>
      </header>

      <main className="pb-24">
        {/* Sales Header */}
        <section className="py-20 bg-secondary/20 relative overflow-hidden">
          <div className="absolute inset-0 z-0">
            <img 
              src={IMAGE_STRATEGIST_BG}
              alt="Strategist" 
              className="w-full h-full object-cover opacity-20"
              style={{
                maskImage: 'linear-gradient(to bottom, black 0%, transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 100%)',
              }}
            />
          </div>
          
          <div className="container relative z-10 px-4 md:px-6 text-center space-y-6">
            <div className="inline-block rounded-full bg-accent/10 border border-accent/20 px-4 py-1.5 text-sm font-mono text-accent mb-4">
              STEP 2: THE GROWTH ARCHITECT PLAN
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl max-w-4xl mx-auto leading-[1.1] font-display">
              Turn Your SWOT Into A <span className="text-primary italic">Million-Dollar Roadmap.</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              You've identified the gaps. Now, let's bridge them. Get the full Strategic Growth Plan and a 1-on-1 session with a Senior Business Strategist.
            </p>
          </div>
        </section>

        {/* The Offer Details */}
        <section className="py-20 container px-4 md:px-6">
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-12">
              <div className="space-y-8">
                <h2 className="text-3xl font-bold font-display border-l-4 border-primary pl-6">What's Included in the Growth Plan?</h2>
                
                <div className="grid sm:grid-cols-2 gap-6">
                  <Card className="bg-secondary/10 border-border/50 hover:border-primary/20 transition-all">
                    <CardContent className="pt-6 space-y-4">
                      <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Target className="h-6 w-6 text-primary" />
                      </div>
                      <h3 className="text-xl font-bold">Comprehensive Growth Audit</h3>
                      <p className="text-sm text-muted-foreground">A 40-page deep dive into your financials, operations, and market positioning.</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-secondary/10 border-border/50 hover:border-primary/20 transition-all">
                    <CardContent className="pt-6 space-y-4">
                      <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center">
                        <Users className="h-6 w-6 text-accent" />
                      </div>
                      <h3 className="text-xl font-bold">1-on-1 Strategy Session</h3>
                      <p className="text-sm text-muted-foreground">60 minutes with a Senior Strategist to review your audit and set your Q3/Q4 goals.</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-secondary/10 border-border/50 hover:border-primary/20 transition-all">
                    <CardContent className="pt-6 space-y-4">
                      <div className="w-12 h-12 rounded-lg bg-destructive/10 flex items-center justify-center">
                        <ShieldCheck className="h-6 w-6 text-destructive" />
                      </div>
                      <h3 className="text-xl font-bold">Risk Mitigation Manual</h3>
                      <p className="text-sm text-muted-foreground">Detailed protocols to protect your business from market volatility and credit risks.</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-secondary/10 border-border/50 hover:border-primary/20 transition-all">
                    <CardContent className="pt-6 space-y-4">
                      <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Zap className="h-6 w-6 text-primary" />
                      </div>
                      <h3 className="text-xl font-bold">Funding Eligibility Report</h3>
                      <p className="text-sm text-muted-foreground">Know exactly which credit lines and loans you qualify for right now.</p>
                    </CardContent>
                  </Card>
                </div>
              </div>

              <div className="bg-primary/5 rounded-2xl p-8 border border-primary/20 space-y-6">
                <div className="flex items-center gap-3">
                  <Award className="h-8 w-8 text-primary" />
                  <h3 className="text-2xl font-bold font-display">The CFO By Design Guarantee</h3>
                </div>
                <p className="text-lg text-muted-foreground italic">
                  "If we don't identify at least $10,000 in potential savings or revenue opportunities during our session, we'll refund your $297 immediately. No questions asked."
                </p>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs">MH</div>
                  <span>Miguel Hernandez, Founder & Lead Strategist</span>
                </div>
              </div>
            </div>

            {/* Pricing Sidebar */}
            <div className="lg:col-span-1">
              <Card className="sticky top-28 border-2 border-primary shadow-glow-gold bg-card overflow-hidden">
                <div className="bg-primary text-primary-foreground px-6 py-3 text-center font-bold text-sm tracking-widest uppercase">
                  Exclusive One-Time Offer
                </div>
                <CardHeader className="space-y-4 pb-8">
                  <CardTitle className="text-3xl font-display text-center">Strategic Growth Plan</CardTitle>
                  <div className="text-center space-y-2">
                    <div className="text-muted-foreground line-through text-xl font-mono">$1,497.00</div>
                    <div className="text-5xl font-bold font-mono text-primary flex items-center justify-center gap-1">
                      <span className="text-2xl">$</span>297
                    </div>
                  </div>
                  <CardDescription className="text-center text-base">
                    Immediate access to the audit template + strategy session booking.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-3">
                    {[
                      "Custom 40-Page Audit",
                      "60-Min Expert Consultation",
                      "Funding Qualification Report",
                      "Margin Optimization Roadmap",
                      "Lifetime Access to Templates"
                    ].map((item, i) => (
                      <div key={i} className="flex items-center gap-3 text-sm">
                        <CheckCircle2 className="h-4 w-4 text-accent shrink-0" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>

                  <Dialog open={isBookingOpen} onOpenChange={setIsBookingOpen}>
                    <DialogTrigger asChild>
                      <Button className="w-full h-16 text-lg font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg transition-all group">
                        SECURE YOUR SPOT NOW
                        <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-4xl bg-card border-primary/20 max-h-[90vh] overflow-y-auto">
                      <DialogHeader className="pb-6 border-b border-border/50">
                        <DialogTitle className="text-3xl font-display">Book Your Strategy Session</DialogTitle>
                        <DialogDescription className="text-base">
                          Select a time for your 60-minute consultation with our senior strategist.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="py-6">
                        <BookingCalendar totalScore={0} reportPath="upsell" />
                      </div>
                    </DialogContent>
                  </Dialog>

                  <div className="flex items-center justify-center gap-4 pt-4 border-t border-border/50">
                    <div className="flex -space-x-2">
                      {[1, 2, 3, 4].map(i => (
                        <div key={i} className="w-8 h-8 rounded-full border-2 border-card bg-secondary flex items-center justify-center text-[10px] font-bold">
                          U{i}
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">
                      Joined by 12 others today
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Social Proof Section */}
        <section className="py-24 bg-secondary/10">
          <div className="container px-4 md:px-6">
            <div className="text-center mb-16 space-y-4">
              <h2 className="text-4xl font-bold font-display">Trusted by Industry Leaders</h2>
              <div className="flex justify-center gap-1">
                {[1, 2, 3, 4, 5].map(i => <Star key={i} className="h-5 w-5 fill-primary text-primary" />)}
              </div>
            </div>
            
            <div className="grid md:grid-cols-2 gap-8">
              <Card className="bg-card/50 border-border/50">
                <CardContent className="pt-8 space-y-6">
                  <p className="text-lg italic text-muted-foreground">
                    "The Growth Plan from CFO By Design was the turning point for our agency. We identified $45k in annual waste and secured a $250k line of credit within 3 weeks of our session."
                  </p>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary/20" />
                    <div>
                      <p className="font-bold">Sarah Jenkins</p>
                      <p className="text-sm text-muted-foreground">CEO, Jenkins Creative Group</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card/50 border-border/50">
                <CardContent className="pt-8 space-y-6">
                  <p className="text-lg italic text-muted-foreground">
                    "I thought I knew my numbers. The audit showed me I was losing 12% on fulfillment costs I hadn't even tracked. Miguel's strategy session is worth 10x the price."
                  </p>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-accent/20" />
                    <div>
                      <p className="font-bold">David Chen</p>
                      <p className="text-sm text-muted-foreground">Founder, Chen Logistics</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </main>

      {/* Sticky Footer for Mobile */}
      <div className="fixed bottom-0 left-0 w-full p-4 bg-background/80 backdrop-blur-md border-t border-border/50 z-50 lg:hidden">
        <Button className="w-full h-14 bg-primary text-primary-foreground font-bold shadow-lg" onClick={() => setIsBookingOpen(true)}>
          GET THE PLAN — $297
        </Button>
      </div>
    </div>
  );
};

export default Upsell;

