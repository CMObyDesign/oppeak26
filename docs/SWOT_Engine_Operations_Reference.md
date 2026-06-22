# SWOT Engine — Operations Reference

> Single source of truth for the SWOT funnel: what's live, how it works, what GHL needs to know.
> Last updated: 2026-06-03

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

## GHL field writeback

After a successful run, the worker writes these custom fields on the contact:

| Field key | Type | When | What it holds |
|---|---|---|---|
| `swot_path` | TEXT | always | `rehab` / `urgent` / `growth` / `strong` |
| `swot_rehab_flag` | TEXT | always | `"true"` / `"false"` |
| `swot_free_report` | LARGE_TEXT | tier=free | full report body |
| `swot_full_report` | LARGE_TEXT | tier=paid_47 | full report body |
| `swot_strategist_brief` | LARGE_TEXT | tier=paid_297 | full report body (a.k.a. BGA / Business Growth Analysis) |
| `business_playbook` | LARGE_TEXT | always | mirror of report body — use this in email templates |
| `swot_deep_dive_booked` | TEXT | tier=paid_297 | `"true"` |

> Email templates should pull **`{{contact.business_playbook}}`** as the report body — it's filled for all tiers.

---

## GHL tag pattern

The worker auto-applies these tags on every successful run. **GHL workflows trigger off these.** Tags land **lowercased** per GHL convention — set workflow triggers to match.

### Tier tags (one per run)
| Tag | When |
|---|---|
| `swot_free_lead` | tier=free |
| `swot_paid_47` | tier=paid_47 |
| `swot_paid_297` | tier=paid_297 |

### Path tags (one per run)
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

| Workflow | Trigger | Action template |
|---|---|---|
| Free Report Delivery | Tag added → `swot_free_lead` | Email Email B with `{{contact.business_playbook}}` |
| Free → $47 Nudge | 3 days after `swot_free_lead`, no purchase tags | Email Email C |
| $47 Tier Purchased | Tag added → `swot_paid_47` | Email Email D |
| $297 Deep Dive Purchased | Tag added → `swot_paid_297` | Email Email E |
| Nurture Weekly | Recurring, no purchase tags | Email Wk1–4 (case studies) |
| Abandonment Recovery | Survey submitted, wait 30min, NO `swot_free_lead` tag | Email recovery body |
| Digital Presence Opportunity | Tag added → `digital_presence_opp` | Notify Liz internally |
| Debt Restructure Opportunity | Tag added → `debt_restructure_opp` | Notify Miguel internally |

---

## Status / open items

| Item | Owner | Status |
|---|---|---|
| Worker (assessment + GHL writeback + tag) | Built | ✅ live, end-to-end verified |
| Worker HTML report rendering | Built | 🟡 drafted, re-push pending (markdown works fine in templates meanwhile) |
| Email templates (B, C, D, E, F shell) | Drafted | 📋 ready to paste into GHL |
| 4 case-study nurture email bodies | Drafted | ⏳ next deliverable |
| Abandonment recovery email body | — | ⏳ to draft |
| GHL custom fields | All exist | ✅ confirmed via API |
| GHL workflows (the 8 in the table above) | — | ⏳ to build in GHL UI |
| Vibe front-end paste | User | 🟡 user said placed; awaiting end-to-end test |

---

## Useful URLs

- Cloudflare: https://dash.cloudflare.com
- GHL sub-account: https://app.gohighlevel.com (location `oLIENQCtGnt9U6gfLhE5`)
- Repo: https://github.com/CMObyDesign/oppeak26
- Case studies reference: see `CFO_ByDesign_Case_Studies_Reference.md` (companion doc in the project folder)
