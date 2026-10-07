# CFO By Design — SWOT Delivery Email Templates

Source-of-truth HTML for every delivery email that fires off a `swot_report_ready_*`
or `swot_growth_plan_ready` / `swot_marketing_audit_ready` / `swot_financials_uploaded`
tag. Paste these into the corresponding HighLevel workflow's Email node.

## Preview in the browser

Every template is mirrored to `app/public/email-preview/` so Cloudflare Pages serves them:

- **Production:** https://oppeak26.pages.dev/email-preview/
- **Branch preview:** https://claude-beta-readiness-real-clients-5zc7at.oppeak26.pages.dev/email-preview/

The index page there lists all seven with per-template preview links. Merge fields render as literal `{{contact.first_name}}` in the browser — actual HL sends interpolate them from the contact record.

**When you edit a template in this folder**, mirror the change to `app/public/email-preview/` before pushing so the preview stays in sync — or run:
```
cp email-templates/*.html app/public/email-preview/
```

## Templates

Mapped to the funnel email numbering in
`docs/brand/PRODUCT_NAMING_AND_LADDER.md` and the copy master.

| File | Docx email | Workflow / trigger | Body merge field |
|---|---|---|---|
| `01_free_report_delivery.html` | **E1** · Health Check delivery | 02. SWOT Free Report — `swot_report_ready_free` | `{{contact.swot_free_report}}` |
| `08_health_check_followup_bank_balance.html` | **E2** · "Numbers or bank balance?" (24h follow-up) | Free follow-up #1 (fires 24h after E1 if `swot_paid_47` not applied) | — |
| `12_health_check_followup_signals.html` | **E3** · Signals vs. diagnosis (2–3 day follow-up) | Free follow-up #2 (fires 2–3 days after E2 if `swot_paid_47` not applied) | — |
| `07_payment_failed_retry.html` | **E4** · $47 payment failed (tier-generic) | 08. SWOT Payment Failed Retry — `swot_payment_failed_47` | — (retry URL: `{{contact.swot_retry_payment_url}}`) |
| `02_partial_swot_delivery.html` | **E5** · Full Diagnostic delivery | 03b. SWOT $47 Report Delivery — `swot_report_ready_paid_47` | `{{contact.swot_full_report}}` |
| `13_full_diagnostic_consult_not_booked.html` | **E6** · $47 consultation not booked | Fires 1 day after E5 if 30-min appt not booked; optional 2nd fire at 3 days | — |
| `03_deep_dive_part1.html` | **E7** · BGA Part 1 ready | 04b. SWOT $297 Part 1 Delivery — `swot_report_ready_paid_297` | `{{contact.business_playbook}}` |
| `14_bga_financials_missing.html` | **E8** · BGA financials missing | Fires 1 day after E7 if financials not uploaded; optional 2nd fire at 3 days | — |
| `06_financials_upload_received.html` | **E9** · Financials received | 06. Financial Upload Received — `swot_financials_uploaded` | — |
| `04_deep_dive_part2.html` | **E10** · Business Growth Plan delivery (Part 2) | 04c. SWOT $297 Part 2 Delivery — `swot_growth_plan_ready` (manual) | `{{contact.swot_growth_plan}}` |
| `15_bga_payment_failed.html` | **E11** · BGA payment failed | Fires on `swot_payment_failed_297` | — (retry URL: `{{contact.swot_retry_payment_url}}`) |
| `05_marketing_audit.html` | (addon) · Marketing Audit delivery | 04d. SWOT $297 Marketing Audit Delivery — `swot_marketing_audit_ready` (manual) | `{{contact.swot_marketing_audit}}` |
| `09_deep_dive_intake_pickup_1.html` | BGA intake pickup #1 (post-$297 purchase) | Fires after `swot_paid_297` if intake incomplete | — |
| `10_deep_dive_intake_pickup_2.html` | BGA intake pickup #2 | Follow-up to 09 | — |
| `11_deep_dive_intake_pickup_3.html` | BGA intake pickup #3 | Final pickup — offers 1:1 call to finish | — |

### Product-name conventions pinned

Per `docs/brand/PRODUCT_NAMING_AND_LADDER.md`, customer-facing copy uses:

- **Business Health Check** (free)
- **$47 Full Diagnostic** (paid $47)
- **Business Growth Analysis** / **BGA** (paid $297) — never "Deep Dive"
  or "Business Health Analysis" or "Business Playbook"
- **Premium CFO Bundle Service** (backend)

Stable integration identifiers (unchanged): `paid_297`, `swot_paid_297`,
`PAYMENT_LINK_297`, `BOOKING_LINK_297`, `business_playbook`,
`/deep-dive-sales/`.

## Related worker endpoint — `/payment-status`

The retry email in `07_payment_failed_retry.html` fires when the worker
applies the `swot_payment_failed_47` / `swot_payment_failed_297` tag,
which happens via a POST to `/payment-status` on the worker.

**LC Payments (or the payment workflow in HL) should fire this webhook on
every payment event — both success and failure.**

Endpoint: `POST https://swot-engine.cfobydesign.workers.dev/payment-status`
Auth: `Authorization: Bearer <WEBHOOK_SECRET>` (same secret as `/from-ghl-survey`)

Body:
```json
{
  "contactId": "...",
  "tier": "paid_47" | "paid_297",
  "status": "success" | "failed",
  "amount": 47,
  "productName": "Partial SWOT",
  "paymentId": "...",
  "email": "customer@example.com",
  "reason": "insufficient_funds"
}
```

On success: the worker safety-net-applies `swot_paid_{tier}` (idempotent
with LC Payments) and posts a "Payment received" contact note.

On failure: the worker applies `swot_payment_failed_{tier}` — this fires
the retry-email workflow — and posts a "Payment FAILED" contact note with
the reason.

Every payment event is written to R2 under `payments/{YYYY-MM-DD}/` for
audit/refund/dispute history.

## Conventions applied across all templates

- **First-name fallback (Handlebars, not Liquid):** every greeting uses
  `{{#if contact.first_name}}{{contact.first_name}}{{else}}there{{/if}}`
  so contacts without a first name don't render "Hi ," or leave the merge
  token visible. HighLevel's template parser rejects Liquid pipe filters
  (`{{contact.first_name | fallback:"there"}}` returns
  `BadRequestException: Parse error`) — do not reintroduce them. The same
  Handlebars conditional applies to any other fallback use, including
  the retry URL in `07_payment_failed_retry.html` and
  `15_bga_payment_failed.html`.
- **CTA link styles:** stripped the extra semicolons (`text-decoration:underline;;`) — one
  semicolon per declaration. Outlook `mso-style-textfill-fill-color` fallback kept.
- **Booking + payment links:** hardcoded to the current LC Payments and Calendar widget IDs
  (source of truth: `worker/src/index.js:25-33` and `wrangler.toml`). If a link rotates,
  update it here and in `worker/src/index.js` at the same time.
- **Footer:** identical across all six emails. Uses `{{unsubscribe_url}}` merge for the
  unsubscribe link.
- **Mobile safety net:** `@media (max-width: 600px)` overrides in the `<style>` block
  every template.
- **View report online CTA:** `{{contact.swot_report_path}}` — worker writes this to the
  contact on every successful run. Links to the standalone `/report/{contactId}` page.

## Fields these emails require to exist in HL

Confirm each of these exists in your HL Custom Fields catalog before enabling any of the
delivery workflows above:

| Field key | Type | Written by |
|---|---|---|
| `swot_free_report` | LARGE_TEXT | Worker on free-tier writeback |
| `swot_full_report` | LARGE_TEXT | Worker on paid_47 writeback |
| `business_playbook` | LARGE_TEXT | Worker on paid_297 writeback |
| `swot_growth_plan` | LARGE_TEXT | Miguel (manual) |
| `swot_marketing_audit` | LARGE_TEXT | Spark (manual) |
| `swot_email_blurb` | LARGE_TEXT | Worker on every run |
| `swot_report_path` | Single line | Worker on every run |
| `swot_strategist_brief` | LARGE_TEXT | Worker on every run (INTERNAL only — never merged into emails) |
