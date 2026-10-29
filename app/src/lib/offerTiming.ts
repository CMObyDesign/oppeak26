export const ASSESSMENT_COMPLETED_KEY = "cfo_assessment_completed_at";

export const OFFERS = {
  DIAGNOSTIC_47: {
    durationHours: 48,
    label: "$47 Full Diagnostic",
  },
  ACTION_BONUS_50: {
    durationHours: 24,
    label: "$50 Action Taker Bonus",
  },
  REHAB_CREDIT_250: {
    durationHours: 168, // 7 days
    label: "$250 Rehab Credit",
  },
};

// Always resets to the current time — each new completion starts a
// fresh 48h / 24h / 168h countdown. The previous `if (!already set)`
// guard caused the "$47 offer has expired" dead-end on 2026-10-28:
// Liz's first SOLOMON50 test of the day set this key; every subsequent
// test (fresh contact, different email alias, different browser session
// via `window.localStorage` persisting) inherited that timestamp, so
// the 48h window was partially or fully elapsed by the time she
// re-tested — HIDING the real $47 pay button entirely and showing the
// "expired" message instead. One completion = one fresh countdown is
// the only semantic that matches the UX intent.
export function setAssessmentTimestamp() {
  localStorage.setItem(ASSESSMENT_COMPLETED_KEY, Date.now().toString());
}

export function getAssessmentTimestamp(): number | null {
  const ts = localStorage.getItem(ASSESSMENT_COMPLETED_KEY);
  return ts ? parseInt(ts, 10) : null;
}

export function getRemainingTime(durationHours: number): {
  totalSeconds: number;
  hours: number;
  minutes: number;
  seconds: number;
  isExpired: boolean;
} {
  const startTime = getAssessmentTimestamp();
  if (!startTime) {
    return { totalSeconds: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true };
  }

  const durationMs = durationHours * 60 * 60 * 1000;
  const endTime = startTime + durationMs;
  const now = Date.now();
  const diff = endTime - now;

  if (diff <= 0) {
    return { totalSeconds: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true };
  }

  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return { totalSeconds, hours, minutes, seconds, isExpired: false };
}

export function formatCountdown(hours: number, minutes: number, seconds: number): string {
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

