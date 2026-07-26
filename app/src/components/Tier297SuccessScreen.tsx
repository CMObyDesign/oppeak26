import { motion } from "framer-motion";
import { CheckCircle2, FileText, Zap, Map, ArrowRight } from "lucide-react";

export const Tier297SuccessScreen = () => {
  return (
    <div className="w-full max-w-4xl mx-auto pt-32 pb-32 px-4 space-y-16">
      <div className="text-center space-y-6">
        <div className="inline-flex items-center justify-center h-20 w-20 rounded-full bg-primary/10 text-primary mb-4">
          <CheckCircle2 className="h-10 w-10" />
        </div>
        <h2 className="font-display text-4xl md:text-5xl font-bold text-foreground">
          Book Your 50-Minute Senior Strategy Session
        </h2>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          Your analyst will review everything before your call so you get analysis, not intake.
        </p>
      </div>

      <div className="glass-card p-4 md:p-8 rounded-3xl border border-white/5">
        <iframe
          src="https://my.cfobydesign.com/widget/booking/VGdN6KoFBtbdnSvHKHTh"
          className="w-full h-[700px] rounded-2xl border border-white/10"
          scrolling="no"
          id="VGdN6KoFBtbdnSvHKHTh_calendar"
        />
      </div>

      <div className="space-y-8 max-w-3xl mx-auto">
        <h3 className="font-display text-2xl font-bold text-center">What to expect on the call</h3>
        <div className="grid md:grid-cols-2 gap-6">
          {[
            { title: "Review of your full diagnostic profile", icon: FileText },
            { title: "Quick wins you can implement in 30 days", icon: Zap },
            { title: "Long-term roadmap recommendations", icon: Map },
            { title: "Clear next steps if fractional CFO services are the right fit", icon: ArrowRight },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-4 p-6 rounded-2xl bg-secondary/20 border border-white/5">
              <div className="p-3 rounded-xl bg-primary/10 text-primary shrink-0">
                <item.icon className="h-5 w-5" />
              </div>
              <p className="font-medium text-foreground leading-relaxed pt-2">{item.title}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

