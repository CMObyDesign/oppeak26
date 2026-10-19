# HL Automation Spec — paste-ready steps

Six workflows to fix or create in HighLevel. Each one is paste-ready: the
trigger, filters, and actions are spelled out exactly, with the actual
tag names, field keys, headers, and JSON bodies the worker expects.

Worker base URL (production): `https://swot-engine.cfobydesign.workers.dev`
Worker survey endpoint:        `POST /from-ghl-survey`
Webhook auth header:           `Authorization: Bearer {{WEBHOOK_SECRET}}`
  (`WEBHOOK_SECRET` is set as a Worker secret — ask Liz for the value.)

Tag names the worker owns (don't rename):
- `swot_paid_47`              — $47 payment or beta entitlement, paid_47 tier
- `swot_paid_297`             — $150/$297 payment, paid_297 tier
- `swot_solomon50_applied`    — SOLOMON50 beta code redeemed (= paid_47 entitlement)
- `swot_report_ready_paid_47` — Full Diagnostic HTML has been written back
- `swot_report_ready_paid_297`— BGA Growth Playbook has been written back
- `swot|deliveryfailed`       — a Claude run or writeback failed; needs human eyes

Custom fields the worker reads/writes:
- `swot_free_report`     — free Business Health Check HTML (id `Ys28pMUc82cURfnsbQzY`)
- `swot_full_report`     — paid_47 Full Diagnostic HTML   (id `pa6VF4GsufGuTAjlFVnf`)
- `business_playbook`    — paid_297 Growth Analysis HTML
- `swot_report_path`     — fully-qualified `/report/{contact.id}` URL (set by worker)
- `swot_deep_dive_booked`— flipped `true` by the worker for paid_297

---

## 1. Paid_47 Full Diagnostic — survey webhook ✱ BLOCKER

Fires after a paid_47 customer submits the Full Diagnostic survey.
Right now this is missing or wired to the free path, so the Claude
Full Diagnostic never runs and the customer sees stale free content
at `/report/{contact.id}` (the bug fixed in #146 kept them on the
right "analyzing" state while this workflow is unhooked).

**Trigger:** `Form Submitted` → form: *Full Diagnostic Intake (paid_47)*

**Filters (must ALL match):**
- `Contact Tag` contains `swot_paid_47` OR `swot_solomon50_applied`
- `Contact Tag` does NOT contain `swot|deliveryfailed`

**Actions, in order:**

1. **Wait** → `30 seconds`
   *(gives HL time to write the survey answers to the contact's custom
   fields before the worker reads them)*

2. **Webhook** → *POST*
   - URL: `https://swot-engine.cfobydesign.workers.dev/from-ghl-survey`
   - Headers:
     ```
     Content-Type: application/json
     Authorization: Bearer {{WEBHOOK_SECRET}}
     ```
   - Body (JSON):
     ```json
     {
       "contactId": "{{contact.id}}",
       "tier": "paid_47"
     }
     ```
   - Expected 2xx. On 403 → gate check failed (missing payment tag). On
     502 → GHL catalog unavailable; retry.

3. **Add Tag** → `swot_full_diagnostic_dispatched`
   *(so a retry doesn't re-fire the webhook; the worker is idempotent
   but this gives us a visible breadcrumb in HL.)*

**Do NOT:** apply `swot_paid_47` from this workflow — payment / beta
redemption workflows already do that, and the worker uses it as the
pre-check gate.

---

## 2. Paid_297 Business Growth Analysis — survey webhook ✱ BLOCKER

Mirror of #1 for the Deep Dive flow. Note the paid_297 gate is
sell-first: the customer hits the survey *before* the $150 payment,
so the worker accepts the webhook when either `swot_paid_47` or
`swot_solomon50_applied` is present (someone Solomon has already
vetted at paid_47).

**Trigger:** `Form Submitted` → form: *Business Growth Analysis Intake (paid_297)*

**Filters:**
- `Contact Tag` contains `swot_paid_47` OR `swot_paid_297` OR `swot_solomon50_applied`
- `Contact Tag` does NOT contain `swot|deliveryfailed`

**Actions:**

1. **Wait** → `30 seconds`

2. **Webhook** → *POST*
   - URL: `https://swot-engine.cfobydesign.workers.dev/from-ghl-survey`
   - Headers: as #1
   - Body:
     ```json
     {
       "contactId": "{{contact.id}}",
       "tier": "paid_297"
     }
     ```

3. **Add Tag** → `swot_bga_dispatched`

---

## 3. `swot|deliveryfailed` alert workflow ✱ BLOCKER

The worker writes this tag whenever a Claude run or writeback fails
on an otherwise-paid contact. Right now no one gets notified — the
contact just sits there with stale content. This workflow pages Liz.

**Trigger:** `Contact Tag Added` → tag: `swot|deliveryfailed`

**Actions:**

1. **Internal Notification** → *Email*
   - To: `liz@cfobydesign.com` (and anyone else on the ops list)
   - Subject: `[SWOT] Delivery failed — {{contact.first_name}} {{contact.last_name}}`
   - Body:
     ```
     Contact: {{contact.first_name}} {{contact.last_name}} ({{contact.email}})
     Contact ID: {{contact.id}}
     Tags: {{contact.tags}}
     Report URL: {{custom_values.swot_report_path}}

     Open the report URL to see current state; check Worker logs
     (Cloudflare → Workers → swot-engine → Logs) around
     this contact's submission time.
     ```

2. **Internal Notification** → *SMS* (if the ops phone is set up)
   - To: Liz's cell
   - Message: `SWOT delivery failed for {{contact.first_name}} — check email.`

3. **Wait** → `until manually removed` (adds `swot_delivery_investigating`)
   *(prevents re-notification on every retry.)*

---

## 4. Lead-source overwrite on payment

**Problem:** when a free lead pays for the $47 Full Diagnostic, the
payment workflow is overwriting `Lead Source` from the original
attribution ("Facebook Ad X", "Organic Search", etc.) to `Payment Link`,
destroying the attribution we need for ad spend reporting.

**Fix:** in the existing *$47 Payment Received* workflow, locate the
`Update Contact Field → Lead Source` action and either:

- **Delete it entirely** (preferred — payment is not a lead source), OR
- Wrap it in a filter: `Lead Source` *is empty* (so it only populates
  when attribution never arrived — e.g., manual contact creation).

Do the same audit on the *$150 Deep Dive Payment Received* workflow.

---

## 5. Contact Type `affiliate` cleanup

Several contacts have `Contact Type = affiliate` set wrongly (likely
from a mis-selected dropdown during a bulk import). The automation
work here is defensive: stop whatever is setting it, then clean up.

**Audit step:** search all workflows for actions that set
`Contact Type → affiliate`. The most likely culprits:
- A referral-partner workflow that applies to all incoming contacts
  instead of only partners.
- A legacy webhook from an affiliate signup form that mis-tagged
  regular leads.

**Fix the setter**, then run a **one-shot bulk workflow:**

**Trigger:** `Contact Workflow Trigger` (manual run from the UI)

**Filters:**
- `Contact Type` is `affiliate`
- `Contact Tag` does NOT contain `partner`, `affiliate_signup`, or
  whatever tag actually marks a real affiliate.

**Actions:**
1. **Update Contact Field** → `Contact Type` → `Lead`
2. **Add Tag** → `contact_type_corrected_{{current_date}}`
   *(audit breadcrumb so we can review the sweep)*

Run it once with a tight filter preview before executing on the full
list. Keep the tagging action so a mis-correction is reversible.

---

## 6. Emails 01–04 — verify report link

The four onboarding/delivery emails must link to the hosted report at
`/report/{{contact.id}}` on the worker domain, NOT any legacy preview
URL. Content changes in the worker auto-rebuild the HTML the link
serves, so a single stable link survives every content update.

**For each of Email 01, 02, 03, 04:**

1. Open the email template in HL (`Email Marketing → Templates`).
2. Find every "View your report" / "Read your diagnostic" / "Open
   results" CTA button or inline link.
3. Confirm the URL is literally:
   ```
   {{custom_values.swot_report_path}}
   ```
   OR if the custom-value merge isn't available in that template:
   ```
   https://swot-engine.cfobydesign.workers.dev/report/{{contact.id}}
   ```
4. Reject any URL that:
   - points at `my.cfobydesign.com/*/report/*` (that's the HL preview
     path — not the hosted report)
   - contains a reportId as a query string (`?r=...`) — the worker
     routes by contact id only
   - points at an HL funnel page URL instead of the worker

5. For Email 04 specifically, paste the updated template body
   from `docs/email-04-template.md` (task #52 in the backlog is
   this paste).

---

## Rollout order

Blockers first — paying customers are currently affected by #1, #2, #3:

1. #1 Paid_47 webhook (unblocks every $47 and SOLOMON50 beta customer)
2. #2 Paid_297 webhook (unblocks every $150 Deep Dive customer)
3. #3 `swot|deliveryfailed` alert (lights up what's silently failing)
4. #6 Emails 01–04 (verify + paste Email 04)
5. #4 Lead-source overwrite (restores attribution going forward)
6. #5 Contact Type cleanup (one-shot sweep, do last)

After #1 + #2 are live, re-run the Liz Test / Cool Air HVAC scenario
end-to-end: free intake → paid_47 (or SOLOMON50) survey → confirm the
Full Diagnostic HTML lands in `swot_full_report`, the hosted
`/report/{contact.id}` serves the paid tier, and no
`swot|deliveryfailed` tag appears.
