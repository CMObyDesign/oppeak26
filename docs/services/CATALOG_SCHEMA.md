# CFO By Design Services Catalog — Schema

> **STATUS:** Authoritative schema for `worker/data/service_catalog.json`.
> Spec companion: `docs/BGA_COPILOT_SPEC.md` §7 (structured services
> catalog). This file governs the shape of every entry; the catalog
> file governs the content.
>
> **CONTENT OWNERSHIP**: content changes to
> `worker/data/service_catalog.json` are Miguel's PRs (per-service
> entries filled in from his actual catalog). Schema changes
> (this file + the JSON Schema below + `match_services` + `red_team_check`
> in `worker/src/index.js`) are Spark's PRs and must land together.
>
> **VERSIONING**: the catalog is versioned by git commit SHA. The
> `swot_bga_services_catalog_ref` custom field on each contact
> records which SHA a given case was built against (spec §8.1).

---

## 1. Location

```
worker/data/service_catalog.json
```

A single JSON array of service objects. The Worker reads this file at
cold-start, keeps the parsed catalog in memory for the isolate's
lifetime, and re-reads it on next deploy. There is no live-reload
path; a catalog content change requires a deploy, which is the same
auditable process as every other code change.

---

## 2. JSON Schema

Each catalog entry must validate against this schema (JSON Schema
2020-12). The repo CI will run this validation on every PR that
touches `worker/data/service_catalog.json`.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "CFO By Design Service Catalog",
  "type": "array",
  "items": {
    "type": "object",
    "required": [
      "service_id",
      "name",
      "problem_solved",
      "signals_relevant",
      "when_not_to_recommend",
      "deliverables",
      "client_responsibility",
      "cfobd_responsibility",
      "pricing",
      "bundle_eligibility",
      "dependencies",
      "talking_points"
    ],
    "additionalProperties": false,
    "properties": {
      "service_id": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9_]*$",
        "description": "Stable snake_case identifier. Never renamed once a service has shipped — rename = new ID + migration."
      },
      "name": {
        "type": "string",
        "minLength": 1,
        "description": "Customer-facing display name. Matches CFO By Design brand language."
      },
      "problem_solved": {
        "type": "string",
        "minLength": 10,
        "description": "One-to-two sentence description of what business problem this service solves, in the client's language, not internal jargon."
      },
      "signals_relevant": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/CanonicalSignal"
        },
        "minItems": 1,
        "description": "Canonical signal slugs (see §4.1). `match_services` scores each service's signals against the current case's verified facts + intake answers. Only signals in the enumerated vocabulary validate — a misspelled or made-up signal fails CI."
      },
      "when_not_to_recommend": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/CanonicalDisqualifier"
        },
        "description": "Canonical disqualifier slugs (see §4.2). If any disqualifier currently applies to the case, `match_services` excludes this service even if signals match. Only disqualifiers in the enumerated vocabulary validate; signals and disqualifiers are strictly separate — placing a disqualifier in `signals_relevant` (or vice versa) fails CI."
      },
      "deliverables": {
        "type": "array",
        "items": { "type": "string", "minLength": 1 },
        "minItems": 1,
        "description": "Specific outputs or activities included in the engagement. Each item is one concrete deliverable (not a description of the service as a whole)."
      },
      "client_responsibility": {
        "type": "array",
        "items": { "type": "string", "minLength": 1 },
        "description": "What the client must do for the engagement to succeed. Example: 'Bookkeeper closes books by day 7 of each month.'"
      },
      "cfobd_responsibility": {
        "type": "array",
        "items": { "type": "string", "minLength": 1 },
        "description": "What CFO By Design will do. Example: 'Review and interpret monthly financials.'"
      },
      "pricing": {
        "type": "object",
        "required": ["model"],
        "additionalProperties": false,
        "properties": {
          "model": {
            "type": "string",
            "enum": [
              "monthly_retainer",
              "project_fee",
              "hourly",
              "percentage_of_savings",
              "included_in_bundle",
              "custom"
            ],
            "description": "Pricing model class. `custom` means Miguel sets per-engagement; `included_in_bundle` means never priced standalone."
          },
          "amount_usd": {
            "type": "number",
            "minimum": 0,
            "description": "Dollar amount matching the model (monthly retainer, one-time fee, hourly rate). Set to 0 when model is `custom` or `included_in_bundle`."
          },
          "min_term_months": {
            "type": "integer",
            "minimum": 0,
            "description": "Minimum commitment term, in months. 0 for ad-hoc or no-term services."
          },
          "note": {
            "type": "string",
            "description": "Optional pricing qualifier (e.g. 'pricing TBD by Miguel', 'first month half-off', 'includes setup fee')."
          }
        }
      },
      "bundle_eligibility": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "included_in_bundles": {
            "type": "array",
            "items": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
            "description": "Bundle IDs this service is part of. The Premium CFO Bundle Service is typically `premium_cfo_bundle`."
          },
          "pairs_well_with": {
            "type": "array",
            "items": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
            "description": "Other `service_id`s that complement this one. Informational only; `match_services` does not auto-recommend based on this."
          },
          "replaces": {
            "type": "array",
            "items": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
            "description": "Other `service_id`s this service supersedes. If a client selects this, the replaced ones should NOT also be recommended."
          }
        }
      },
      "dependencies": {
        "type": "array",
        "items": { "type": "string", "minLength": 1 },
        "description": "Prerequisites for this service to work. Free text today; a future revision may add structured dependency types."
      },
      "talking_points": {
        "type": "array",
        "items": { "type": "string", "minLength": 1 },
        "description": "Strategist-facing talking points — things Miguel can say during the BGA call about this service. These become part of the `SERVICE MATCH` provenance context."
      }
    }
  },
  "$defs": {
    "CanonicalSignal": {
      "type": "string",
      "enum": [
        "low_margin_visibility",
        "ar_concentration_risk",
        "ar_aging_90_plus_present",
        "no_13_week_cash_forecast",
        "monthly_close_absent_or_late",
        "debt_service_pressure",
        "bookkeeping_cleanup_needed",
        "hiring_plan_not_supportable",
        "pricing_review_opportunity",
        "tax_filings_current_but_strategy_absent",
        "growth_capital_question"
      ],
      "description": "The canonical signal vocabulary from §4.1. Append-only: new signals require a schema PR that adds the enum entry AND lands a `match_services` detector AND a regression test in the same diff."
    },
    "CanonicalDisqualifier": {
      "type": "string",
      "enum": [
        "active_tax_default",
        "legal_distress",
        "revenue_band_below_500k",
        "revenue_band_above_10m",
        "books_not_closable",
        "owner_not_decision_maker"
      ],
      "description": "The canonical disqualifier vocabulary from §4.2. Append-only under the same rules as signals. Disqualifiers and signals are strictly separate: a disqualifier may not appear in `signals_relevant`, and a signal may not appear in `when_not_to_recommend`."
    }
  }
}
```

(Codex P2 on #91: previously these items used only
`pattern: "^[a-z][a-z0-9_]*$"`, which validates any snake_case
string and silently accepted misspelled or made-up signals that
`match_services` could never recognize. The enum restriction makes
such entries CI failures.)

---

## 3. Field glossary (how each is used by Solomon)

| Field | Where it's read |
|-------|-----------------|
| `service_id` | Written into `swot_bga_services_selected` after the call; appears in `SERVICE MATCH` provenance tags. |
| `name` | Appears in customer-facing Email 04 service-selections block. |
| `problem_solved` | Shown in the Draft Roadmap §7 (Service Recommendations) as the reason the service was matched. |
| `signals_relevant` | `match_services` scores these against the case's verified facts + intake answers. The matched signal is embedded in the `SERVICE MATCH` tag so the strategist can see which case fact triggered the recommendation. |
| `when_not_to_recommend` | `match_services` excludes any service with a current disqualifier. `red_team_check` warns if a service with a disqualifier is still in the recommendations list (§5.3 warning 4). |
| `deliverables` | Shown in the strategist's Pre-Call Brief and in the customer-facing Email 04 service-selections block. |
| `client_responsibility` | Shown in the Pre-Call Brief so Miguel can set expectations on the call. Appears in Email 04 under "What's expected on your side." |
| `cfobd_responsibility` | Shown in Email 04 under "What CFO By Design will do." |
| `pricing` | Shown to Miguel in the Draft Roadmap; MAY be included in Email 04 depending on the strategist's call decisions. `included_in_bundle` services are not priced standalone. |
| `bundle_eligibility` | Informational for Miguel. `pairs_well_with` surfaces as suggestions; `replaces` prevents duplicate recommendations. |
| `dependencies` | Shown in the Draft Roadmap and Pre-Call Brief so Miguel can call out prerequisites during the session. |
| `talking_points` | Appear in the Pre-Call Brief under "Services worth discussing — talking points." Not customer-facing. |

---

## 4. Canonical vocabulary

Signals and disqualifiers are drawn from a shared vocabulary so
services written at different times still match the same case facts.
Both lists are append-only; adding a new slug requires a schema PR
that extends the matching `$defs` enum in §2, lands a detector in
`match_services`, and adds a regression test.

**Signals and disqualifiers are disjoint sets.** A slug lives in one
or the other, never both. Validators enforce this: a disqualifier
slug in `signals_relevant` fails CI with "unknown signal," and vice
versa.

### 4.1 Signals (used in `signals_relevant`)

| Slug | Meaning |
|------|---------|
| `low_margin_visibility` | Client cannot answer gross/net margin by segment with confidence. |
| `ar_concentration_risk` | Top-3 clients account for ≥35% of revenue (verified from P&L by client). |
| `ar_aging_90_plus_present` | Verified AR >90 days balance exceeds a material share of revenue. |
| `no_13_week_cash_forecast` | Client is not maintaining a rolling 13-week cash forecast. |
| `monthly_close_absent_or_late` | Books close >14 days after month end OR not reliably closed at all. |
| `debt_service_pressure` | Monthly debt service verified ≥20% of trailing-12 cash flow. |
| `bookkeeping_cleanup_needed` | Books are >30 days behind OR obvious miscategorization. |
| `hiring_plan_not_supportable` | Client wants to hire but verified cash and revenue cannot support the plan. |
| `pricing_review_opportunity` | Trailing-12 gross margin is a materially different number than intake-stated. |
| `tax_filings_current_but_strategy_absent` | Taxes current but no proactive tax strategy or planning. |
| `growth_capital_question` | Owner is weighing financing options (debt, equity, SBA) without a decision framework. |

### 4.2 Disqualifiers (used in `when_not_to_recommend`)

| Slug | Meaning |
|------|---------|
| `active_tax_default` | Open federal or state tax default, lien, or payment plan in bad standing. |
| `legal_distress` | Active judgment, bankruptcy filing, or regulatory proceeding. |
| `revenue_band_below_500k` | Trailing-12 revenue below $500K (service doesn't fit at this scale). |
| `revenue_band_above_10m` | Trailing-12 revenue above $10M (service doesn't fit at this scale). |
| `books_not_closable` | Bookkeeping is so disorganized that the first engagement must be `bookkeeping_cleanup`. |
| `owner_not_decision_maker` | Primary intake respondent is not the person who can authorize financial changes. |

Adding a slug: open a PR that (a) updates this section, (b) updates
`match_services` to detect the condition from case data, and (c) adds
a regression test. Content-only PRs that use an existing slug skip
(b) and (c).

---

## 5. Validation

A CI check (TBD, part of PR 2 follow-up when the Worker scaffolding
lands) will validate `worker/data/service_catalog.json` against the
JSON Schema in §2 on every PR that touches the file. Fails are
blocking.

For now, the file carries 1-2 placeholder entries that validate
correctly — see `worker/data/service_catalog.json`. Miguel's content
PRs replace the placeholders with real services; each new service
must also validate.

---

## 6. Change control

- **Schema changes (this file + the JSON Schema in §2)**: Spark PR
  that lands schema + `match_services` + `red_team_check` + tests
  together. Miguel reviews for substance; Codex / Claude reviews for
  correctness.
- **Signal / disqualifier slug additions**: schema PR as above.
  Never add a slug without a corresponding detector in
  `match_services`.
- **Catalog content changes (`service_catalog.json`)**: Miguel's PR,
  Spark reviews for schema conformance (CI check gates this). No
  code review needed if validation passes and no new slugs are
  introduced.
- **Service deprecation**: never delete a `service_id` that has
  shipped to any contact. Instead add a `deprecated: true` field (a
  future schema revision will add this) or move the service to a
  `deprecated_at_sha` section. The `swot_bga_services_catalog_ref`
  audit trail depends on the historical catalog resolving.
