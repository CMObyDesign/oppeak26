# Product Naming & Classification — Locked Decisions

> **STATUS:** Authoritative. Changes to this file are architectural; update
> the referenced code paths and tests in the same PR.
>
> **OWNER:** CFO By Design (brand) · Spark Agency (engineering).

---

## Decision 1 — Customer-facing classification set

Solomon's customer-facing path classification is restricted to three
values:

- **`growth`** — functioning business with momentum and real fixable gaps,
  or a healthy business running on real numbers that is here to optimize
  and scale.
- **`needs-attention`** — debt or cash-flow pressure present but not
  legally distressed; financial visibility incomplete; revenue leaks or
  concentration; multiple non-legal stress signals stacked.
- **`rehab`** — active judgments / liens / tax defaults, OR unfiled or
  delinquent taxes, OR explicitly delinquent debt. Stabilize before
  growth.

### What this replaces

The pre-rubric-v3 taxonomy had five values: `rehab`, `urgent`,
`needs-attention`, `growth`, `strong`. Collapse rules:

- `urgent` → folds into `needs-attention`. "Urgent" without a legal
  trigger consistently over-dramatized findings and eroded trust.
- `strong` → folds into `growth`. Both are "upside to work on, not a
  problem to fix"; splitting them created a spurious hierarchy for the
  customer.

### GHL integration contract (dual-tag emission)

Live GHL workflows trigger on the pre-v3 tag set
(`swot_path_rehab`, `swot_path_urgent`, `swot_path_growth`,
`swot_path_strong`). To keep those automations firing while the new
classification lands analytics-side, the Worker emits BOTH tags for
`needs-attention`:

| Solomon classification | Canonical GHL tag | Legacy compat tag |
|---|---|---|
| `rehab` | `swot_path_rehab` | — |
| `needs-attention` | `swot_path_needs-attention` | `swot_path_urgent` |
| `growth` | `swot_path_growth` | — |

The dual tagging is **a one-way integration adapter**. Solomon's
reasoning logic does NOT know about legacy tags. The classification
set is only the three canonical values. See `pathTags()` in
`worker/src/index.js` and `worker/tests/ghl_path_tags.test.js`.

### Migration path

1. Update HL workflows one at a time to listen for the canonical tag.
2. When every relevant automation is migrated and tested, remove the
   legacy emission from `pathTags()` in a follow-up PR.
3. Do NOT remove legacy tags from existing contacts automatically unless
   there's a specific reason to do so.

### Rules that follow from Decision 1

- `ASSESSMENT_RUBRIC` describes exactly three paths in PATH SELECTION.
- `TIER_GUIDE` for every tier states "Customer-facing classification may
  ONLY be: growth, needs-attention, or rehab."
- `buildPrompt`'s JSON schema restricts `path` to the canonical three.
- The internal `strategistBrief` field MAY reference finer distinctions
  ("closer to strong than to growth-with-gaps") because it is the
  consultant's working document, not the customer's deliverable.

---

## Decision 2 — Public $297 product name

Customer-facing product name is **Business Growth Analysis**, approved
shorthand **BGA**.

### Full product ladder

| Tier | Public name | Short code |
|---|---|---|
| Free | **Business Health Check** | — |
| $47 | **Full Diagnostic** | — |
| $297 | **Business Growth Analysis** | BGA |
| Backend | **Premium CFO Bundle Service** | — |

### What this replaces

Prior customer-facing names for the $297 product that must NOT be used in
new copy:

- "Business Health Analysis" — pre-brand-doc live naming (still in older
  email templates + sales page until a copy update ships separately).
- "Deep Dive" — internal shorthand that leaked into customer copy
  ("$297 Deep Dive," "Deep Dive sales page").
- "deep-dive analysis" as a product name.

The internal tier identifier remains `paid_297`. Stable integration
identifiers are explicitly NOT renamed:

```
paid_297                     KEEP
swot_paid_297                KEEP
swot_paid_297_pending        KEEP
swot_report_ready_paid_297   KEEP
swot_playbook_written        KEEP
PAYMENT_LINK_297             KEEP
BOOKING_LINK_297             KEEP
UPGRADE_297_URL              KEEP
DEEP_DIVE_SALES_URL          KEEP (env var name only)
business_playbook            KEEP (GHL field key)
/deep-dive-sales/            KEEP (route; introduce new BGA URL + redirect if needed)
```

The principle: brand docs govern language and positioning; code and
rubric govern integration contracts. A sales page can be re-labeled
without renaming its route; a tier can be re-labeled without renaming
its tier id.

### $47 → $297 upgrade copy bridge

The strongest articulation of the ladder is:

> Your Full Diagnostic tells you what needs attention. The Business
> Growth Analysis turns those findings into a 90-day plan.

### Where "Business Growth Analysis" must appear

New customer-facing copy only. Non-exhaustive:

- `TIER_GUIDE.paid_297` in `worker/src/index.js`.
- Report CTAs rendered by `buildReportPage` (paid_297 page header,
  paid_47 secondary CTA linking to the $297 upsell).
- Email templates that promote the $297 product (deep-dive-part1,
  deep-dive-part2, intake pickup series 09/10/11).
- Deep-Dive sales page (`<title>`, meta description, OG tags, body
  copy).
- Strategist-facing promotion copy.
- Repo docs.

### Where the old names may still appear temporarily

- Historical reports stored in D1 that already carry the old product
  name in their diagnostic JSON. These are frozen — do not rewrite
  historical rows.
- Email templates and sales page HTML not yet rewritten (tracked
  separately; owner is updating customer copy directly).

---

## Change control

Updating this document requires:

1. A diff to the code paths it governs (TIER_GUIDE, buildPrompt schema,
   pathTags, PATH_STYLE, etc.).
2. Regression tests pinning the new content (see
   `worker/tests/rubric_v3.test.js`, `renderer_cta.test.js`,
   `ghl_path_tags.test.js`, `solomon50_invariants.test.js`).
3. A `RUBRIC_VERSION` bump if Decision 1's semantic changes.

Last reviewed: 2026-10-07.
