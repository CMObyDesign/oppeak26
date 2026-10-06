# Solomon — Repository Architecture

Living record of the architectural contracts that bind HighLevel (CRM /
projection), Cloudflare D1 (canonical history, planned), R2 (report
artifacts, planned), and the Workers runtime (diagnostic engine).

New contracts should be appended here. Existing contracts should not be
changed without an approved migration plan — downstream GHL workflows,
emails, pipelines, and reporting depend on them.

---

## System layering (target state)

```
CLOUDFLARE (D1 + R2)
        ↓
canonical truth · immutable history

DIAGNOSTIC ENGINE (worker/src/index.js)
        ↓
versioned interpretation

HIGHLEVEL
        ↓
operational projection + automation
```

HighLevel is **not** the system of record for diagnostic data. It is the
projection layer that drives workflows, emails, and segmentation. The
canonical record of what Solomon generated — and the complete input used
to generate it — lives in Cloudflare.

The relationship below is **forbidden**:

```
HighLevel → random prompt → generated HTML → overwrite prior result
```

---

## HighLevel latest-state contract

Existing `swot_*` custom fields remain unchanged. HighLevel always contains
the **most recently successfully generated** customer-facing result required
by existing workflows.

Rationale: `swot_*` field names are integration contracts. GHL workflows,
automation builders, SMS templates, email templates, pipeline rules,
reporting dashboards, and strategist tooling reference them by name. A
rename is a breaking change to many downstream systems the repository does
not control.

Scope of "most recently successfully generated":

- Only successful generations update HighLevel. A failed or incomplete
  generation never overwrites the previous good result.
- Only one version is held in HighLevel at a time — the current one.
- Fields covered by this contract include at minimum:
  `swot_free_report`, `swot_full_report`, `business_playbook`,
  `swot_path`, `swot_rehab_flag`, `swot_strategist_brief`,
  `swot_email_blurb`, `swot_report_path`.

Non-goals:

- HighLevel does not store historical report versions.
- HighLevel does not store raw answers, normalized answers, derived
  metrics, or provenance.
- Renaming `swot_*` → `solomon_*` is explicitly out of scope.

---

## D1 historical contract

Every assessment generation is stored as a new immutable version in D1.
Prior submissions and reports are **never overwritten**.

Each record carries at minimum:

- `submission_id` — stable UUID per intake
- `report_id` — stable UUID per generation of that submission
- `report_version` — monotonically increasing integer within a submission
- `created_at`
- `tier` — `free` | `paid_47` | `paid_297`
- `assessment_version`, `rubric_version`, `prompt_version`, `model_version`,
  `code_version` (git SHA)
- `source_event_id` — the GHL webhook / request identifier that triggered
  the generation, when available
- `ghl_sync_state` — `pending` | `succeeded` | `failed`, with retry
  bookkeeping

A regeneration — whether triggered by a GHL retry, a strategist action,
a rubric change, or a manual re-run — creates a new row. The prior row
remains readable.

---

## Answer snapshot contract

Each submission stores the complete set of answers used for that
generation as a **whole snapshot**. A later regeneration does not mutate
the previous answer snapshot.

Each snapshot carries both the raw and the normalized form, plus
provenance back to the GHL field it came from:

```
{
  "source_field_id": "GGyFaucTwsIEsrXBHUsy",
  "question_key": "monthly_debt_service",
  "question_version": "v2",
  "raw_question": "How much do you pay every month on servicing your corporate debt...",
  "raw_answer": "1800",
  "normalized_value": 1800
}
```

Rationale: a report has to be re-explainable years later even if the GHL
custom field is renamed, replaced, or removed. Storing the raw question
text, the raw answer, the normalized value, and the original GHL field
ID together makes the diagnostic reproducible without reaching back into
GHL.

A customer or strategist correction creates a new submission (or new
snapshot) with its own provenance — the original snapshot is not edited
in place.

---

## Report read contract

`GET /report/{contactId}` reads from D1.

- With no version specified, returns the latest **successful** report for
  that contact. "Latest successful" matches what HighLevel is holding.
- With an explicit version/report identifier
  (`/report/{contactId}?v={report_version}` or
  `/report/{contactId}?report_id={uuid}`), returns the historical report
  at that version.
- Failed generations are not served to customers. They are retained in
  D1 for audit but are not addressable via the customer-facing URL
  without an explicit `?include=failed` query (reserved for internal
  diagnostic tooling).

Rationale: HighLevel and the customer-facing `/report/{contactId}` link
must agree on what "the current report" means. Both resolve to the same
latest-successful record.

---

## R2 artifact contract

Rendered HTML belongs in R2. D1 stores the report metadata and the R2
artifact reference, not the HTML body itself.

Each generated report row in D1 carries:

- `html_r2_key` — the R2 object key for that version's rendered HTML
- `html_bytes` — size of the artifact
- `html_sha256` — content hash, so a regeneration that produces an
  identical artifact can be detected and (optionally) deduplicated
- Optional future keys: `pdf_r2_key`, `strategist_brief_r2_key` for
  non-customer-facing variants

R2 object keys should encode enough context to be identified without a
D1 lookup, e.g.
`reports/{contact_id}/{report_id}/report.html`.

R2 artifacts are immutable. A corrected report is a new artifact in a new
R2 key, referenced by a new D1 row.

Rationale: HTML artifacts can be large; D1 is better at structured query
and metadata than at opaque blob storage. R2 is cheap, immutable, and
addressable.

---

## Interaction with the existing system

These contracts describe the target state. They are **additive** to the
current `worker/src/index.js` behavior and do not require ripping up what
is already shipping:

- The current GHL `swot_full_report` / `swot_free_report` HTML write
  continues; it just stops being the only copy once D1 + R2 are live.
- The current short-TTL `reserveIdempotency(contact.id_${tier})` stays
  as a secondary guard; durable uniqueness moves to
  `submission_id` / `source_event_id` once D1 is in place.
- The current PR #55 minimum-answers completeness gate stays in place
  until a structured `{status:"incomplete", missing_fields:[...]}`
  validation layer replaces it. Do not remove the count-gate during the
  migration.
- Historical GHL-only data does not need to be backfilled before the new
  architecture ships. New submissions become canonical immediately; old
  records remain reachable through their existing GHL fields.

---

## Non-goals (locked)

- Do not rename `swot_*` HighLevel fields.
- Do not introduce a 5-level classification scale. The three customer-facing
  classifications are `growth`, `needs-attention`, and `rehab`.
- Do not add Durable Objects without a demonstrated concurrency need D1
  cannot satisfy.
- Do not let the LLM perform deterministic financial math that application
  code can calculate reliably.
- Do not overwrite historical reports.
- Do not automatically train Solomon from its own generated output —
  learning is human-approved only.
- Do not optimize conversion at the expense of financial accuracy or
  invented facts.
