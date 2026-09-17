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

| File | Workflow | Trigger tag | Body merge field |
|---|---|---|---|
| `01_free_report_delivery.html` | 02. SWOT Free Report | `swot_report_ready_free` | `{{contact.swot_free_report}}` |
| `02_partial_swot_delivery.html` | 03b. SWOT $47 Report Delivery | `swot_report_ready_paid_47` | `{{contact.swot_full_report}}` |
| `03_deep_dive_part1.html` | 04b. SWOT $297 Part 1 Delivery | `swot_report_ready_paid_297` | `{{contact.business_playbook}}` |
| `04_deep_dive_part2.html` | 04c. SWOT $297 Part 2 Delivery | `swot_growth_plan_ready` (manual) | `{{contact.swot_growth_plan}}` |
| `05_marketing_audit.html` | 04d. SWOT $297 Marketing Audit Delivery | `swot_marketing_audit_ready` (manual) | `{{contact.swot_marketing_audit}}` |
| `06_financials_upload_received.html` | 06. Financial Upload Received | `swot_financials_uploaded` | (no report body — holding email) |
| `07_payment_failed_retry.html` | 08. SWOT Payment Failed Retry | `swot_payment_failed_47` OR `swot_payment_failed_297` | (no report body — retry email) |

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

- **First-name fallback:** every greeting uses `{{contact.first_name | fallback:"there"}}` so
  contacts without a first name don't render "Hi ," or leave the merge token visible.
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
