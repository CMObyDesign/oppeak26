# CFO By Design — Funnel Frontend

React + TypeScript + Vite + Tailwind + shadcn/ui frontend for the CFO By Design
tiered SWOT assessment funnel. This was originally generated and hosted inside
HighLevel's Vibe AI website builder; this directory is the unpacked, plain
Vite source so it can be built and deployed independently through GitHub +
Cloudflare Pages, with HighLevel kept only as the CRM/forms/booking backend.

See `../README.md` for how this fits together with `../worker/` (the
Cloudflare Worker that scores assessments and writes back to GHL) and
`../docs/SWOT_Engine_Operations_Reference.md` for the full GHL contract.

## Requirements

- Node.js 18+ (LTS recommended)
- npm

## Getting started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

## Available scripts

- `npm run dev` - start Vite in development mode
- `npm run build` - create a production build (outputs to `dist/`)
- `npm run build:dev` - create a development-mode build
- `npm run preview` - preview the production build locally
- `npm run lint` - run ESLint checks
- `npm run test` - run Vitest tests once
- `npm run test:watch` - run Vitest in watch mode

## Verification commands

Use these to verify repository health:

```bash
npm run lint
npm run test
npm run build
npx tsc --noEmit
```

`npm run build` and `npx tsc --noEmit` are clean. `npm run lint` currently
reports ~30 pre-existing `@typescript-eslint/no-explicit-any` errors that
were already present in the Vibe export (mostly on form-event handlers) —
they don't block the build and weren't introduced by this migration, but
they're worth cleaning up separately.

## Deploying with Cloudflare Pages

1. In the Cloudflare dashboard, create a Pages project connected to this
   GitHub repo (`CMObyDesign/oppeak26`).
2. Set **Root directory** to `app`.
3. Build command: `npm run build`
4. Build output directory: `dist`
5. Framework preset: Vite (or leave as None with the settings above — both
   work).

Every push to `main` will then auto-deploy, the same way the existing
`worker/` Cloudflare Worker already does.

## HighLevel coupling — read before you deploy

This app talks directly to HighLevel from the browser (no API keys are
exposed — these are all public form/widget endpoints tied to location
`oLIENQCtGnt9U6gfLhE5`):

- `src/components/AssessmentScreen.tsx` posts lead-capture answers to a GHL
  **survey submit** endpoint (`services.leadconnectorhq.com/surveys/submit/...`).
  This is a standard public GHL embed endpoint — hosting location doesn't
  matter, it will keep working from Cloudflare Pages.
- `src/components/BookingCalendar.tsx` (used on `/upsell`) fetches free
  calendar slots from `backend.leadconnectorhq.com/calendars/{id}/free-slots`
  — also a generic public GHL API, fine to keep.
- **`src/components/BookingCalendar.tsx`'s `VIBE_API_URL` constant
  (`backend.leadconnectorhq.com/vibe-ai/booking/submit`) is the one item to
  verify after deploy.** It's the path Vibe's generated code uses to submit
  the actual booking, and it's not documented as a general-purpose public
  HighLevel API the way the survey/calendar endpoints are — it may be an
  internal service tied to the Vibe product rather than the location itself.
  **Test the full `/upsell` booking flow once this is live on Cloudflare
  Pages.** If bookings stop landing in GHL, the fix is to either call GHL's
  documented appointment-booking API directly, or add a `/booking/submit`
  proxy route to the existing `../worker/` (which already owns the
  GHL-writeback logic for the rest of the funnel) and point this constant at
  that instead.
- Image assets on `vibe.filesafe.space` (Index, Upsell, PaidTier47,
  PaidTier297 pages) are hosted on HighLevel's general media CDN tied to
  this location/account, not the Vibe builder specifically — these should
  keep resolving as long as the GHL account exists. Down the line you may
  want to move them into `public/` for a self-hosted app with no runtime
  dependency on that CDN.

## HighLevel config placeholders

Every hardcoded HighLevel/GHL identifier and link (location ID, calendar ID,
tracking ID, survey submit URL, booking API base, custom field IDs, payment
and booking widget links, and the two brand images previously hosted on
Vibe's asset CDN) has been centralized in `src/lib/ghl-config.ts`, reading
from `VITE_*` env vars with obvious placeholder fallbacks. Copy
`.env.example` to `.env` and fill in the real values, or set them as
Cloudflare Pages build environment variables (which take precedence). See
the comments in `ghl-config.ts` for what each one does. `og:image`,
`twitter:image`, and the favicon in `index.html` are static tags pointing
at local files under `public/images/` / `public/favicon.svg` instead —
replace those files directly (or edit the tags) once you have real assets.

## shadcn/ui components

`src/components/ui/*` matches the project's `components.json` (`style:
"default"`, Tailwind v3) — the canonical pre-v4 shadcn output. If you add a
component that needs another primitive, regenerate with:

```bash
npx shadcn@latest add <component>
```

(Note: `ui.shadcn.com` may be blocked by restrictive network/proxy setups —
if `npx shadcn add` fails to reach the registry, run it from an
unrestricted network instead.)

## Lockfile policy

This repository does not track `package-lock.json`.
