import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format, addMonths, startOfMonth, endOfMonth, isBefore, isAfter, startOfDay } from "date-fns";
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight, Check, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const CALENDAR_ID = "0tH7HRpY6xqJyiDEpg2z";
const LOCATION_ID = "oLIENQCtGnt9U6gfLhE5";
const TRACKING_ID = "tk_4c1e49d2891c4a949b946b1158c534f6";
const VIBE_API_URL = "https://backend.leadconnectorhq.com/vibe-ai";

interface BookingCalendarProps {
  totalScore: number;
  reportPath: string;
}

export const BookingCalendar = ({ totalScore, reportPath }: BookingCalendarProps) => {
  const [step, setStep] = useState<"calendar" | "form" | "success">("calendar");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [slots, setSlots] = useState<Record<string, { slots: string[] }>>({});
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showPhone, setShowPhone] = useState(false);

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    revenue: "",
    goal: "",
  });

  useEffect(() => {
    fetchSlots();
  }, [currentMonth]);

  const fetchSlots = async () => {
    setLoadingSlots(true);
    try {
      const startDate = startOfMonth(currentMonth).getTime();
      const endDate = endOfMonth(addMonths(currentMonth, 1)).getTime();
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      const response = await fetch(
        `https://backend.leadconnectorhq.com/calendars/${CALENDAR_ID}/free-slots?startDate=${startDate}&endDate=${endDate}&timezone=${timezone}`
      );
      const data = await response.json();
      setSlots(data);
    } catch (error) {
      console.error("Failed to fetch slots:", error);
      toast.error("Failed to load available times.");
    } finally {
      setLoadingSlots(false);
    }
  };

  const handleBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    const sessionId = crypto.randomUUID();

    const bookingPayload = {
      locationId: LOCATION_ID,
      calendarId: CALENDAR_ID,
      firstName: formData.firstName,
      lastName: formData.lastName,
      email: formData.email,
      phone: formData.phone,
      selectedSlot,
      selectedTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      sessionId,
      customFields: [
        { id: "GkK5Uh9SoD1Y9PAiYIuS", key: "contact.annual_business_revenue", field_value: formData.revenue },
        { id: "EEsulhhHaCnY3Vv8k1hk", key: "contact.primary_goal", field_value: formData.goal },
        { id: "erYYBz6vG9TbqEuqLxeb", key: "contact.swot_total_score", field_value: totalScore.toString() },
        { id: "2tOTD1ifIR1G9ayA0Y8t", key: "contact.swot_report_path", field_value: reportPath },
      ],
    };

    const trackingPayload = {
      type: "external_form_submission",
      timestamp: Date.now(),
      formId: "SWOT Lead Form",
      formData: {
        first_name: formData.firstName,
        last_name: formData.lastName,
        email: formData.email,
        phone: formData.phone,
        "contact.annual_business_revenue": formData.revenue,
        "contact.primary_goal": formData.goal,
        "contact.swot_total_score": totalScore.toString(),
        "contact.swot_report_path": reportPath,
      },
      formLabels: {
        first_name: "First Name",
        last_name: "Last Name",
        email: "Email",
        phone: "Phone",
        "contact.annual_business_revenue": "Annual Business Revenue",
        "contact.primary_goal": "Primary Goal",
        "contact.swot_total_score": "SWOT Total Score",
        "contact.swot_report_path": "SWOT Report Path",
      },
      url: window.location.href,
      title: document.title,
      path: window.location.pathname,
      userAgent: navigator.userAgent,
      trackingId: TRACKING_ID,
      locationId: LOCATION_ID,
      sessionId,
      properties: {
        deviceType: /Mobile|Android|iPhone/i.test(navigator.userAgent) ? "mobile" : "desktop",
      },
    };

    try {
      // 1. Submit Booking
      const bookingResponse = await fetch(`${VIBE_API_URL}/booking/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bookingPayload),
      });

      if (!bookingResponse.ok) throw new Error("Booking failed");

      // 2. Fire Tracking (async)
      fetch("https://backend.leadconnectorhq.com/external-tracking/events", {
        method: "POST",
        headers: { "Content-Type": "application/json", version: "2021-07-28" },
        body: JSON.stringify(trackingPayload),
      }).catch(console.error);

      setStep("success");
      toast.success("Strategy session booked successfully!");
    } catch (error) {
      console.error("Booking error:", error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const daysInMonth = () => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    const days = [];
    let current = start;
    while (isBefore(current, end) || format(current, "yyyy-MM-dd") === format(end, "yyyy-MM-dd")) {
      days.push(new Date(current));
      current = new Date(current.setDate(current.getDate() + 1));
    }
    return days;
  };

  if (step === "success") {
    return (
      <div className="p-12 text-center space-y-8">
        <div className="flex justify-center">
          <div className="h-20 w-20 rounded-full bg-accent/20 flex items-center justify-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", damping: 12 }}
            >
              <Check className="h-10 w-10 text-accent" />
            </motion.div>
          </div>
        </div>
        <div className="space-y-2">
          <h3 className="font-display text-3xl font-bold">You're Confirmed.</h3>
          <p className="text-muted-foreground">
            Check your email for confirmation and calendar details. A CFO strategist will reach out within 1 business day.
          </p>
        </div>
        <div className="p-6 bg-white/5 rounded-xl border border-white/5 inline-block">
          <div className="flex items-center gap-3 text-sm">
            <CalendarIcon className="h-4 w-4 text-primary" />
            <span className="font-bold">{selectedSlot ? format(new Date(selectedSlot), "MMMM d, yyyy 'at' h:mm a") : ""}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-[1.2fr,0.8fr] h-full min-h-[600px]">
      {/* Calendar/Form Side */}
      <div className="p-8 border-r border-white/5">
        {step === "calendar" ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h4 className="font-display text-xl font-bold">Select Date</h4>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, -1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="font-mono text-sm font-bold min-w-[120px] text-center">
                  {format(currentMonth, "MMMM yyyy")}
                </span>
                <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-2">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-widest py-2">
                  {d}
                </div>
              ))}
              {Array.from({ length: startOfMonth(currentMonth).getDay() }).map((_, i) => (
                <div key={`empty-${i}`} />
              ))}
              {daysInMonth().map((date) => {
                const dateStr = format(date, "yyyy-MM-dd");
                const hasSlots = slots[dateStr]?.slots?.length > 0;
                const isPast = isBefore(date, startOfDay(new Date()));
                const isSelected = selectedDate && format(selectedDate, "yyyy-MM-dd") === dateStr;

                return (
                  <button
                    key={dateStr}
                    disabled={!hasSlots || isPast}
                    onClick={() => setSelectedDate(date)}
                    className={`aspect-square rounded-lg flex items-center justify-center text-sm transition-all relative ${
                      isSelected ? "bg-primary text-primary-foreground font-bold shadow-glow-gold" :
                      hasSlots && !isPast ? "hover:bg-primary/20 text-foreground" : "text-muted-foreground/30 cursor-not-allowed"
                    }`}
                  >
                    {format(date, "d")}
                    {hasSlots && !isPast && !isSelected && (
                      <div className="absolute bottom-1.5 h-1 w-1 rounded-full bg-primary/40" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <form onSubmit={handleBooking} className="space-y-6">
            <div className="flex items-center gap-4 mb-8">
              <Button variant="ghost" size="sm" onClick={() => setStep("calendar")} className="text-muted-foreground">
                <ChevronLeft className="h-4 w-4 mr-2" /> Back to Calendar
              </Button>
            </div>
            
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-widest font-bold">First Name</Label>
                <Input 
                  required 
                  className="bg-tertiary border-white/10 focus:border-primary" 
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-widest font-bold">Last Name</Label>
                <Input 
                  required 
                  className="bg-tertiary border-white/10 focus:border-primary" 
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-widest font-bold">Business Email</Label>
              <Input 
                required 
                type="email" 
                className="bg-tertiary border-white/10 focus:border-primary" 
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground uppercase tracking-widest font-bold">Phone Number</Label>
                {!showPhone && (
                  <button 
                    type="button" 
                    onClick={() => setShowPhone(true)}
                    className="text-[10px] text-accent font-bold uppercase tracking-widest hover:underline"
                  >
                    Add for faster response +
                  </button>
                )}
              </div>
              <AnimatePresence>
                {(showPhone || window.innerWidth > 768) && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <Input 
                      type="tel" 
                      placeholder="+1 (555) 000-0000"
                      className="bg-tertiary border-white/10 focus:border-primary" 
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-widest font-bold">Annual Revenue</Label>
                <Select required onValueChange={(val) => setFormData({ ...formData, revenue: val })}>
                  <SelectTrigger className="bg-tertiary border-white/10">
                    <SelectValue placeholder="Select revenue" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Under $250K">Under $250K</SelectItem>
                    <SelectItem value="$250K–$500K">$250K–$500K</SelectItem>
                    <SelectItem value="$500K–$1M">$500K–$1M</SelectItem>
                    <SelectItem value="$1M–$5M">$1M–$5M</SelectItem>
                    <SelectItem value="$5M–$10M">$5M–$10M</SelectItem>
                    <SelectItem value="Over $10M">Over $10M</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-widest font-bold">Primary Goal</Label>
                <Select required onValueChange={(val) => setFormData({ ...formData, goal: val })}>
                  <SelectTrigger className="bg-tertiary border-white/10">
                    <SelectValue placeholder="Select goal" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Qualify for business funding">Qualify for business funding</SelectItem>
                    <SelectItem value="Improve business credit">Improve business credit</SelectItem>
                    <SelectItem value="Reduce tax liability">Reduce tax liability</SelectItem>
                    <SelectItem value="Get organized financially">Get organized financially</SelectItem>
                    <SelectItem value="Scale to the next level">Scale to the next level</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button 
              type="submit" 
              disabled={submitting}
              className="w-full h-14 bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-glow-gold"
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Complete My Booking →"}
            </Button>
          </form>
        )}
      </div>

      {/* Slots Side */}
      <div className="bg-card/40 p-8">
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span className="text-sm font-medium">Available Times</span>
          </div>

          {loadingSlots ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
            </div>
          ) : selectedDate ? (
            <div className="grid gap-2">
              {slots[format(selectedDate, "yyyy-MM-dd")]?.slots?.map((slot) => {
                const isSelected = selectedSlot === slot;
                return (
                  <button
                    key={slot}
                    onClick={() => {
                      setSelectedSlot(slot);
                      setStep("form");
                    }}
                    className={`p-4 rounded-lg border text-sm font-mono transition-all text-center ${
                      isSelected ? "bg-primary border-primary text-primary-foreground font-bold" : "bg-white/5 border-white/5 hover:border-primary/40 text-foreground"
                    }`}
                  >
                    {format(new Date(slot), "h:mm a")}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="py-20 text-center space-y-4">
              <CalendarIcon className="h-12 w-12 text-muted-foreground/20 mx-auto" />
              <p className="text-sm text-muted-foreground">Select a date to view available strategy sessions.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

