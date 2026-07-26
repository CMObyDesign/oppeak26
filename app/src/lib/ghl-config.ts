// Central source of truth for every HighLevel (GHL) identifier and link the
// funnel talks to. Every value here is a placeholder — set the real one as a
// Vite env var (VITE_*) in .env, or as a Cloudflare Pages build environment
// variable, before deploying. See app/README.md and app/.env.example.
const env = import.meta.env;

export const GHL_LOCATION_ID = env.VITE_GHL_LOCATION_ID || "REPLACE_WITH_GHL_LOCATION_ID";
export const GHL_CALENDAR_ID = env.VITE_GHL_CALENDAR_ID || "REPLACE_WITH_GHL_CALENDAR_ID";
export const GHL_TRACKING_ID = env.VITE_GHL_TRACKING_ID || "REPLACE_WITH_GHL_TRACKING_ID";

export const GHL_SURVEY_SUBMIT_URL =
  env.VITE_GHL_SURVEY_SUBMIT_URL || "https://services.leadconnectorhq.com/surveys/submit/REPLACE_WITH_SURVEY_ID";

// The endpoint BookingCalendar.tsx posts bookings to. In the original Vibe
// export this was `https://backend.leadconnectorhq.com/vibe-ai`, which may be
// a Vibe-specific passthrough rather than a documented public GHL API —
// confirm the real value before relying on it outside Vibe hosting.
export const GHL_BOOKING_API_BASE =
  env.VITE_GHL_BOOKING_API_BASE || "https://backend.leadconnectorhq.com/REPLACE_WITH_BOOKING_API_PATH";

// GHL custom field IDs written on booking submit.
export const GHL_CUSTOM_FIELD_REVENUE_ID = env.VITE_GHL_CF_REVENUE_ID || "REPLACE_WITH_REVENUE_FIELD_ID";
export const GHL_CUSTOM_FIELD_GOAL_ID = env.VITE_GHL_CF_GOAL_ID || "REPLACE_WITH_GOAL_FIELD_ID";
export const GHL_CUSTOM_FIELD_SCORE_ID = env.VITE_GHL_CF_SCORE_ID || "REPLACE_WITH_SCORE_FIELD_ID";
export const GHL_CUSTOM_FIELD_REPORT_PATH_ID = env.VITE_GHL_CF_REPORT_PATH_ID || "REPLACE_WITH_REPORT_PATH_FIELD_ID";

// Payment / booking widget links.
export const PAYMENT_LINK_47 = env.VITE_PAYMENT_LINK_47 || "https://REPLACE_WITH_YOUR_DOMAIN/payment-link/REPLACE_WITH_47_LINK_ID";
export const PAYMENT_LINK_297 = env.VITE_PAYMENT_LINK_297 || "https://REPLACE_WITH_YOUR_DOMAIN/payment-link/REPLACE_WITH_297_LINK_ID";
export const BOOKING_LINK_297 = env.VITE_BOOKING_LINK_297 || "https://REPLACE_WITH_YOUR_DOMAIN/widget/booking/REPLACE_WITH_297_CALENDAR_ID";

// Brand/marketing images previously hosted on Vibe's asset CDN
// (vibe.filesafe.space). Default to local placeholder graphics until real
// URLs (or files dropped into public/images/) are provided.
export const IMAGE_LOGO = env.VITE_IMAGE_LOGO || "/images/placeholder-logo.svg";
export const IMAGE_STRATEGIST_BG = env.VITE_IMAGE_STRATEGIST_BG || "/images/placeholder-strategist-bg.svg";
