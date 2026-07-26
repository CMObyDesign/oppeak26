import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "./ui/button";
import { ArrowLeft, ShieldCheck, Zap, TrendingUp, CreditCard, CheckCircle2 } from "lucide-react";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Checkbox } from "./ui/checkbox";
import { ScrollArea } from "./ui/scroll-area";
import { CountdownTimer } from "./CountdownTimer";
import { OFFERS } from "@/lib/offerTiming";
import { PAYMENT_LINK_297 } from "@/lib/ghl-config";

interface PurchaseGateScreenProps {
  score: number;
  path: "urgent" | "growth" | "strong" | "rehab";
  onBack: () => void;
}

export const PurchaseGateScreen = ({ score, path, onBack }: PurchaseGateScreenProps) => {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    businessName: "",
    revenue: "",
    termsAccepted: false,
  });

  const getBadgeColor = () => {
    switch (path) {
      case "urgent": return "bg-destructive/20 text-destructive border-destructive/20";
      case "growth": return "bg-primary/20 text-primary border-primary/20";
      case "strong": return "bg-accent/20 text-accent border-accent/20";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getPathLabel = () => {
    switch (path) {
      case "urgent": return "CRITICAL EXPOSURE";
      case "growth": return "HIDDEN LIABILITY";
      case "strong": return "UNTAPPED CAPACITY";
      default: return "ANALYSIS COMPLETE";
    }
  };

  const getHeadline = () => {
    switch (path) {
      case "urgent": return "Claim Your Deep Dive Audit";
      case "growth": return "Get Your Deep Dive Audit";
      case "strong": return "Unlock Your Deep Dive Audit";
      default: return "Get Your Deep Dive Audit";
    }
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    // Simulate analytics and redirect
    console.log("[Analytics] checkout_initiated", { path, score, ...formData });
    
    // In a real app, you'd call your backend here:
    // const response = await fetch("/api/create-checkout-session", { ... });
    // const session = await response.json();
    // window.location.href = session.url;

    setTimeout(() => {
      window.open(PAYMENT_LINK_297, "_blank", "width=500,height=700");
      setLoading(false);
    }, 1500);
  };

  return (
    <div className="min-h-screen pt-48 md:pt-64 pb-20 flex flex-col items-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-xl space-y-10"
      >
        <div className="text-center space-y-4">
          <div className="flex justify-center mb-2">
            <CountdownTimer 
              durationHours={OFFERS.DIAGNOSTIC_47.durationHours} 
              label={OFFERS.DIAGNOSTIC_47.label} 
            />
          </div>
          <Badge className={`px-4 py-1 rounded-full text-[10px] tracking-[0.2em] font-mono border ${getBadgeColor()}`}>
            {getPathLabel()}
          </Badge>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-display font-bold text-foreground">
            {getHeadline()}
          </h2>
          
          <div className="py-6 space-y-2">
            <p className="text-muted-foreground line-through text-lg font-mono">$1,500 typical CFO audit engagement</p>
            <div className="flex items-center justify-center gap-3">
              <span className="text-4xl md:text-5xl font-display font-bold text-foreground">$297</span>
              <span className="text-muted-foreground text-xs md:text-sm font-medium">— Deep Dive Audit</span>
            </div>
            <p className="text-primary font-mono text-xs uppercase tracking-widest">Delivered within 48 hours</p>
          </div>
        </div>

        <div className="space-y-4">
          {[
            "Your exact monthly break-even number (revenue + active client count)",
            "A specific gap report with dollar-impact estimates",
            "The 3 highest-ROI moves for your specific profile",
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-3 p-4 rounded-xl bg-white/5 border border-white/5">
              <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <p className="text-sm text-foreground font-medium">{item}</p>
            </div>
          ))}
        </div>

        <div className="p-6 rounded-2xl border border-primary/30 bg-primary/5 text-center">
          <p className="text-sm text-foreground font-bold">
            "Full refund if the audit doesn't show you something you didn't already know."
          </p>
        </div>

        <form onSubmit={handleCheckout} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName" className="text-xs uppercase tracking-widest text-muted-foreground">First Name</Label>
              <Input 
                id="firstName" 
                required 
                className="bg-secondary/50 border-white/10" 
                value={formData.firstName}
                onChange={(e) => setFormData({...formData, firstName: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName" className="text-xs uppercase tracking-widest text-muted-foreground">Last Name</Label>
              <Input 
                id="lastName" 
                required 
                className="bg-secondary/50 border-white/10" 
                value={formData.lastName}
                onChange={(e) => setFormData({...formData, lastName: e.target.value})}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs uppercase tracking-widest text-muted-foreground">Business Email</Label>
              <Input 
                id="email" 
                type="email" 
                required 
                className="bg-secondary/50 border-white/10" 
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="text-xs uppercase tracking-widest text-muted-foreground">Phone Number</Label>
              <Input 
                id="phone" 
                type="tel" 
                required 
                placeholder="For audit delivery"
                className="bg-secondary/50 border-white/10" 
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="businessName" className="text-xs uppercase tracking-widest text-muted-foreground">Business Name</Label>
              <Input 
                id="businessName" 
                required 
                className="bg-secondary/50 border-white/10" 
                value={formData.businessName}
                onChange={(e) => setFormData({...formData, businessName: e.target.value})}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="revenue" className="text-xs uppercase tracking-widest text-muted-foreground">Annual Revenue</Label>
              <Select 
                required 
                onValueChange={(val) => setFormData({...formData, revenue: val})}
              >
                <SelectTrigger className="bg-secondary/50 border-white/10">
                  <SelectValue placeholder="Select revenue range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="under-500k">Under $500K</SelectItem>
                  <SelectItem value="500k-1m">$500K–$1M</SelectItem>
                  <SelectItem value="1m-2m">$1M–$2M</SelectItem>
                  <SelectItem value="2m-5m">$2M–$5M</SelectItem>
                  <SelectItem value="5m-10m">$5M–$10M</SelectItem>
                  <SelectItem value="over-10m">Over $10M</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground leading-relaxed pt-1">
            Our audit is calibrated for $2M+ revenue businesses with 1+ year of financial history. If you're below this threshold, we'll route you to resources better suited to your stage at no charge.
          </p>

          <div className="space-y-4 pt-4 border-t border-white/5">
            <div className="flex items-start space-x-3">
              <Checkbox 
                id="terms" 
                checked={formData.termsAccepted}
                onCheckedChange={(checked) => setFormData({...formData, termsAccepted: checked as boolean})}
                required
                className="mt-1 border-white/20 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
              />
              <div className="space-y-2 leading-none">
                <Label htmlFor="terms" className="text-sm font-medium text-foreground cursor-pointer">
                  Terms and Conditions *
                </Label>
                <div className="text-xs text-muted-foreground">
                  By checking this box, I fully understand and agree to all the provisions of the agreement.
                </div>
              </div>
            </div>
            
            <ScrollArea className="h-48 w-full rounded-md border border-white/10 bg-secondary/30 p-4 text-xs md:text-sm text-muted-foreground leading-relaxed">
              <p className="mb-4">
                Client appoints and authorizes Genesis Financial Associates to locate, obtain, and assist Client in finding bank lines of credit, cash advances, credit lines, loans, investments, private equity and any other forms of financial infusion based on financial data and information supplied by commercial client.
              </p>
              <p className="mb-4">
                Clients authorizes Consultant to obtain any financial and credit history information for all credit reporting agencies. Consultant will package the financial application information prepared and signed by the Client and provide the same to prospective Lenders. Consultant is keenly aware of those financial institutions aggressively seeking customers with specific credit profile: however, all information provided by Client shall be accurate and truthful to the best of Client's knowledge and belief.
              </p>
              <p className="font-bold text-foreground mb-2 text-sm md:text-base">ACTUAL FEE CHARGED BY THE CONSULTANT:</p>
              <p className="mb-4">
                The Client agrees to a success fee of 3% for real-estate funding transactions based on the gross loan amount originated by any associates of GFA Inc. A 6% for success fee will be assessed on all non real-estate funding transactions of the gross loan amount originated by any associates of GFA Inc. Any additional fees (i.e. points, closing cost, due diligence, etc.) that may be incurred by the lender/funding source are not included in the GFA fee success fee. An initial underwriting/packaging fee maybe assessed of a minimum 350.00 to 2,500.00 per principal/company. The underwriting/acceptance fees are non refundable under any circumstances. Other than underwriting fees, no brokerage fees of any kind will be charged, collected or accrued by the Consultant prior to official written approval. Thereafter, success fee shall be deemed due and owing on real-estate funding upon closing and due and owing on non real-estate funding upon approval of schedule funding. All defenses to payment thereof shall be deemed waived. Jurisdiction and venue for suit are stipulated to be in Miami-Dade County, Florida, with Trail by Jury waived and Attorney Fees to be awarded to Consultant if such action is brought for enforcement. No Statement or representations of Consultant may be relied upon unless made in writing. Client authorizes the fee to be charged to business account below within 72 hours from written approval for non real-estate transactions. Success fee must paid upon closing for real-estate transactions. If funds exceed allowed merchant limits, they must be wired to an agreed account. If fees are not paid in 72 hours from written approval non-real-estate transactions or at closing for real-estate transactions an additional processing fee will be assessed of 20% of gross amount of the success fee. Once written/verbal approval has been established and accepted by the client, all fees are due even if the client decides not to move forward with funding. All types of loans will be explored/resourced for funding unless otherwise stipulated within 24 hours of this agreement (i.e. venture capital, conventional, nonconventional, hedge fund, merchant advance, cash-flow, mezzanine, equipment lease, sba, conventional, non-conventional, factor, etc.) Client agrees that all fees due to GFA, Inc. will be personally guaranteed. Client agrees to not to circumvent any of GFA, Inc.'s funding sources/consultant relations/contacts/intellectual property or contacts of GFA's sources for any reason.
              </p>
              <p className="mb-4">
                Client understands and agrees there is no guarantee of success for this application or commitment. Consultant is not an employee of any financial institution and is not authorized to make any financial commitments on behalf of any lender or investor. Each of the parties has read this agreement prior to signing and has had the opportunity to review same with their attorney/s if any, and understands the content of the same. The undersigned Client hereby agrees to indemnify and hold harmless Genesis Financial Associates Inc. as well as, any lenders and /or funding sources introduced by Genesis Financial Associates Inc. against any and all demands, causes of actions in law or equity.
              </p>
              <p>
                Consultant will endeavor to obtain the lowest cost of financing available based on the Client's personal and credit history.
              </p>
            </ScrollArea>
          </div>

          <Button 
            type="submit"
            disabled={loading || !formData.termsAccepted}
            className="w-full h-16 text-lg bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-xl shadow-glow-gold transition-all hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100"
          >
            {loading ? "Securing your checkout..." : "Pay $297 & Start My Audit →"}
          </Button>

          <div className="flex flex-col items-center gap-4 pt-4 border-t border-white/5">
            <div className="flex flex-wrap items-center justify-center gap-6">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-widest">
                <ShieldCheck className="h-4 w-4 text-accent" /> Secure via Stripe
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-widest">
                <Zap className="h-4 w-4 text-accent" /> 48-hour delivery
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-widest">
                <CheckCircle2 className="h-4 w-4 text-accent" /> Refund Guarantee
              </div>
            </div>
          </div>
        </form>

        <button
          onClick={onBack}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm font-medium mx-auto pt-8"
        >
          <ArrowLeft className="h-4 w-4" /> Return to my SWOT Report
        </button>
      </motion.div>
    </div>
  );
};

