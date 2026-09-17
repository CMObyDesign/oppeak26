# CFO By Design — SWOT Delivery Email Templates

Source-of-truth HTML for every delivery email that fires off a `swot_report_ready_*`
or `swot_growth_plan_ready` / `swot_marketing_audit_ready` / `swot_financials_uploaded`
tag. Paste these into the corresponding HighLevel workflow's Email node.

## Templates

| File | Workflow | Trigger tag | Body merge field |
|---|---|---|---|
| `01_free_report_delivery.html` | 02. SWOT Free Report | `swot_report_ready_free` | `{{contact.swot_free_report}}` |
| `02_partial_swot_delivery.html` | 03b. SWOT $47 Report Delivery | `swot_report_ready_paid_47` | `{{contact.swot_full_report}}` |
| `03_deep_dive_part1.html` | 04b. SWOT $297 Part 1 Delivery | `swot_report_ready_paid_297` | `{{contact.business_playbook}}` |
| `04_deep_dive_part2.html` | 04c. SWOT $297 Part 2 Delivery | `swot_growth_plan_ready` (manual) | `{{contact.swot_growth_plan}}` |
| `05_marketing_audit.html` | 04d. SWOT $297 Marketing Audit Delivery | `swot_marketing_audit_ready` (manual) | `{{contact.swot_marketing_audit}}` |
| `06_financials_upload_received.html` | 06. Financial Upload Received | `swot_financials_uploaded` | (no report body — holding email) |

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
</content>
