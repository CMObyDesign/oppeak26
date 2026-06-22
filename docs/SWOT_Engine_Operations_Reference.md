# SWOT Engine — Operations Reference

> Single source of truth for the SWOT funnel: what's live, how it works, what GHL needs to know.
> Last updated: 2026-06-22

---

## What's live

| Thing | Value |
|---|---|
| Worker URL | `https://swot-engine.cfobydesign.workers.dev` |
| Repo | `https://github.com/CMObyDesign/oppeak26` *(auto-deploys on push to `main`)* |
| GHL Location ID | `oLIENQCtGnt9U6gfLhE5` |
| AI model | `claude-sonnet-4-6` |
| Worker secrets *(set in Cloudflare dashboard)* | `ANTHROPIC_API_KEY` ✅ · `GHL_API_KEY` ✅ |
| Worker vars *(override committed fallbacks as needed)* | `GHL_LOCATION_ID` · `BOOKING_LINK_47` · `BOOKING_LINK_297` · `PAYMENT_LINK_47` · `PAYMENT_LINK_297` |

---

## Worker contract

### Request
The front-end POSTs to the worker URL with:

```json
{
  "tier": "free | paid_47 | paid_297",
  "contact": {
    "name": "Jane Smith",
    "email": "jane@example.com"
  },
  "answers": [
    { "question": "The question text", "answer": "Their answer" }
  ]
}
```

If `contact.email` is provided but no GHL contact exists yet, the worker **creates** one with source `SWOT Funnel`.

### Response

```json
{
  "success": true,
  "tier": "free",
  "path": "rehab | urgent | growth | strong",
  "badge": "CRITICAL EXPOSURE",
  "headline": "...",
  "opener": "...",
  "context": "...",
  "gaps":            [{ "title": "...", "impact": "...", "priority": "CRITICAL | HIGH | MEDIUM" }],
  "opportunities":   [{ "title": "...", "desc":   "...", "impact":   "..." }],
  "nextStepHeadline": "...",
  "nextStepBody": "...",
  "opportunityFlags": ["DIGITAL_PRESENCE_OPP", "DEBT_RESTRUCTURE_OPP"],
  "bookingLink": "https://my.cfobydesign.com/widget/booking/..."
}
```

---

## GHL field writeback ⚠️ LOCKED — verified against worker code + live test contact 2026-06-22

After a successful run, the worker writes these custom fields on the contact. Each tier writes to its OWN report field — there is no mirror field for the report body.

### Tier-specific report bodies (one per run)

| Field key | Type | When | What it holds |
|---|---|---|---|
| `swot_free_report` | LARGE_TEXT | **tier=free ONLY** | full HTML-rendered report body |
| `swot_full_report` | LARGE_TEXT | **tier=paid_47 ONLY** | full HTML-rendered report body |
| `business_playbook` | LARGE_TEXT | **tier=paid_297 ONLY** | full deep-dive playbook (the $297 deliverable — NOT a mirror of other tiers) |

### Universal fields written on every successful run (all tiers)

| Field key | Type | What it holds |
|---|---|---|
| `swot_path` | TEXT | `rehab` / `urgent` / `growth` / `strong` |
| `swot_rehab_flag` | TEXT | `"true"` / `"false"` — convenience flag for rehab-specific workflows |
| `swot_email_blurb` | LARGE_TEXT | **NEW 2026-06-22.** Personalized 1-paragraph hook for delivery emails. Mirrors the LLM `opener` field. Used as `{{contact.swot_email_blurb}}` in the intro of every delivery email. |
| `swot_strategist_brief` | LARGE_TEXT | **REPURPOSED 2026-06-22.** Internal-only consultant brief — NEVER shown to client. 2-3 paragraphs covering: (1) why this lead got their path verdict, (2) top 2 upsell angles based on opportunity flags, (3) suggested opener question for the strategy call. Used by Miguel pre-call. |
| `swot_report_path` | TEXT | **NEW 2026-06-22.** URL to the hosted standalone HTML report at `https://swot-engine.cfobydesign.workers.dev/report/{contactId}`. Used as `{{contact.swot_report_path}}` in "View Report Online" email buttons. |

### Conditional fields

| Field key | Type | When | What it holds |
|---|---|---|---|
| `swot_deep_dive_booked` | TEXT | tier=paid_297 | `"true"` |

### Email template merge field cheat sheet

| Workflow | Tier-specific report body | Universal blurb | Online URL |
|---|---|---|---|
| `00 SWOT Free Report` | `{{contact.swot_free_report}}` | `{{contact.swot_email_blurb}}` | `{{contact.swot_report_path}}` |
| `01 SWOT $47 Purchase` | `{{contact.swot_full_report}}` | `{{contact.swot_email_blurb}}` | `{{contact.swot_report_path}}` |
| `02 SWOT $297 Purchase` | `{{contact.business_playbook}}` | `{{contact.swot_email_blurb}}` | `{{contact.swot_report_path}}` |

> ⚠️ Do NOT use `{{contact.business_playbook}}` in free or $47 emails — it will be empty and the lead will get a blank email body. The `swot_email_blurb` field is tier-agnostic and the personalized hook lives there.

### GHL custom fields that EXIST but are NOT written by the worker

| Field key | Status |
|---|---|
| `swot_internal_notes` | Manual editorial use; worker doesn't touch it. Keep. |
| `swot_297_score` | Scoring metadata field; worker doesn't currently populate it. Verify if anything else does. |
| 8 path-axis sub-score fields (folder A) — `revenue_foundation`, `cash_flow`, `funding_readiness`, `credit_position`, `financial_reporting`, `accounting_structure`, `entity__tax_strategy`, `advisory_support` | Scoring inputs from the front-end form. Worker doesn't write them. Keep. |
| `path`, `rehab_flag`, `report_path`, `score`, `business_health_score` (unprefixed, folder A) | V1 legacy duplicates of the `swot_*` prefixed versions. Verify nothing depends, then candidate for deletion. |
| Marketing-related fields (content/SEO intake in folder A) | Spark Agency partnership — used to deliver marketing analysis to $47 leads. Keep. |
| `how_often_do_you_normally_workout` | Template junk. Safe to delete. |

---

## GHL tag pattern

The worker auto-applies these tags on every successful run. **GHL workflows trigger off these.** Tags land **lowercased** per GHL convention — set workflow triggers to match.

### Tier tags (one per run)
| Tag | When |
|---|---|
| `swot_free_lead` | tier=free |
| `swot_paid_47` | tier=paid_47 |
| `swot_paid_297` | tier=paid_297 |

### Path tags (one per run, all four created in GHL 2026-06-22)
| Tag | When |
|---|---|
| `swot_path_rehab` | path=rehab — legal/tax blockers, foundation must stabilize first |
| `swot_path_urgent` | path=urgent — operating under real financial pressure |
| `swot_path_growth` | path=growth — momentum + real fixable gaps |
| `swot_path_strong` | path=strong — clean foundation, here to optimize |

### Opportunity tags (zero or more per run)
| Tag | Meaning | Suggested action in GHL |
|---|---|---|
| `digital_presence_opp` | Weak online visibility | Notify Liz — Spark services opportunity |
| `merchant_processing_opp` | Merchant cost / coverage unreviewed | Notify Miguel — Merchant Services pitch |
| `debt_restructure_opp` | Heavy / stretched debt | Notify Miguel — Debt Consolidation pitch (see Case Study 1) |
| `tax_resolution_opp` | Unfiled taxes / outstanding balance | Notify Miguel — Tax Resolution pitch |

---

## Booking links

| Link | URL |
|---|---|
| 30-Minute Strategy Session | `https://my.cfobydesign.com/widget/booking/D3yNZNFtqIYsChkOgQc9` |
| 50-Minute Deep Dive Session | `https://my.cfobydesign.com/widget/booking/VGdN6KoFBtbdnSvHKHTh` |

---

## Deploy

1. Push any change to `main` on the `oppeak26` repo.
2. Cloudflare auto-builds (1–2 minutes).
3. Verify by GETting the worker URL — should return `{"success":false,"error":"POST only"}` (that's the expected response for a non-POST request).

---

## Quick reference for GHL workflow triggers

When you're building automations, use these as triggers:

| Workflow | Trigger | Email body recipe |
|---|---|---|
| Free Report Delivery | Tag added → `swot_free_lead` | Lead with `{{contact.swot_email_blurb}}`; CTA button → `{{contact.swot_report_path}}`; inline body `{{contact.swot_free_report}}` |
| Free → $47 Nudge | 3 days after `swot_free_lead`, no purchase tags | Curiosity email referencing their `swot_email_blurb` themes; CTA to $47 |
| $47 Tier Purchased | Tag added → `swot_paid_47` | Lead with `{{contact.swot_email_blurb}}`; CTA → `{{contact.swot_report_path}}`; inline body `{{contact.swot_full_report}}` |
| $297 Deep Dive Purchased | Tag added → `swot_paid_297` | Lead with `{{contact.swot_email_blurb}}`; CTA → `{{contact.swot_report_path}}`; inline body `{{contact.business_playbook}}` |
| Nurture Weekly | Recurring, no purchase tags | Email Wk1–4 (case studies) |
| Abandonment Recovery | Survey submitted, wait 30min, NO `swot_free_lead` tag | Email recovery body |
| Digital Presence Opportunity | Tag added → `digital_presence_opp` | Notify Liz internally |
| Debt Restructure Opportunity | Tag added → `debt_restructure_opp` | Notify Miguel internally — surface `{{contact.swot_strategist_brief}}` in the notification |

---

## Status / open items

| Item | Owner | Status |
|---|---|---|
| Worker (assessment + GHL writeback + tag) | Built | ✅ live, end-to-end verified 2026-06-22 |
| Worker code hygiene (encoding, env vars, prompt caching) | Codex PR | ✅ shipped 2026-06-22 |
| Worker HTML report rendering | Built | ✅ verified in live test contact 2026-06-22 |
| GHL custom fields | All exist | ✅ confirmed via API 2026-06-22 |
| `swot_path_strong` tag | Built | ✅ created 2026-06-22 (last of the four path tags) |
| Email templates use tier-specific fields | Liz | ✅ Liz confirmed 2026-06-22 |
| 4 case-study nurture email bodies | Drafted | ⏳ next deliverable |
| Abandonment recovery email body | — | ⏳ to draft |
| 7 CFO skills (Phase 1 contracts) | Drafted | 🟡 in `Miguel H./skills/`; Codex PR ready to ship |
| Solomon consultant console UI | — | ⏳ scope-only next |
| Legacy field cleanup (`swot_strategist_brief`, `swot_report_path`, `swot_297_score`) | — | ⏳ verify nothing depends, then delete |

---

## Useful URLs

- Cloudflare: https://dash.cloudflare.com
- GHL sub-account: https://app.gohighlevel.com (location `oLIENQCtGnt9U6gfLhE5`)
- Repo: https://github.com/CMObyDesign/oppeak26
- Case studies reference: see `CFO_ByDesign_Case_Studies_Reference.md` (companion doc in the project folder)
- CFO skills (Phase 1 drafts): see `skills/` (companion subfolder in this project)
