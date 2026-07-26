import { useEffect, useState } from "react";
import { getRemainingTime, formatCountdown } from "@/lib/offerTiming";
import { Timer } from "lucide-react";

interface CountdownTimerProps {
  durationHours: number;
  label: string;
  onExpire?: () => void;
  className?: string;
}

export const CountdownTimer = ({ durationHours, label, onExpire, className }: CountdownTimerProps) => {
  const [timeLeft, setTimeLeft] = useState(getRemainingTime(durationHours));

  useEffect(() => {
    const timer = setInterval(() => {
      const remaining = getRemainingTime(durationHours);
      setTimeLeft(remaining);
      if (remaining.isExpired) {
        clearInterval(timer);
        onExpire?.();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [durationHours, onExpire]);

  if (timeLeft.isExpired) return null;

  return (
    <div className={`flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-full ${className}`}>
      <Timer className="h-4 w-4 text-amber-500 animate-pulse" />
      <span className="text-xs font-mono font-bold text-amber-500 uppercase tracking-wider">
        {label}: {formatCountdown(timeLeft.hours, timeLeft.minutes, timeLeft.seconds)}
      </span>
    </div>
  );
};

