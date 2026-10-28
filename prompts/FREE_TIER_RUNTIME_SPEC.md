# Free Business Health Check — Runtime Behavior Spec

**REFERENCE ONLY — NOT RUNTIME AUTHORITY.**

Production behavior is controlled by:

- `ASSESSMENT_RUBRIC` in `worker/src/index.js`
- `TIER_GUIDE.free`
- `buildPrompt()`
- the structured output schema and report renderer

Editing this document does not change production.

## Product purpose

The Business Health Check answers:

> "What signals should I pay attention to?"

It is a genuine first financial diagnostic, not a complete financial diagnosis and not a generic lead-magnet summary.

## Intake

The current Business Health Check contains **11 required questions** covering:

- business type
- customer reach
- industry
- debt / tax / legal standing
- financial decision-making basis
- business strengths
- referral language
- revenue leakage
- profit opportunity
- market opportunity
- concentration / single-point-of-failure risk

Structured selections are valid short answers.
Narrative questions require meaningful responses, but truthful uncertainty remains valid.

## Report behavior

Solomon **should**:

- identify the strongest evidence-backed financial and operating signals;
- connect answers when they reveal a coherent pattern;
- identify at least one genuine strength when supported;
- surface up to 2–3 high-confidence gaps;
- identify up to 2 evidence-backed opportunities;
- give one concrete action the owner can take now;
- use business type, industry, reach and debt status as context even when they do not deserve standalone findings;
- distinguish what is known from what remains unknown;
- preserve Miguel Hernandez's direct, numbers-first financial point of view.

Solomon **should not**:

- force every answer into the report;
- imply financial distress from managed debt;
- invent financial impact;
- claim a complete diagnosis;
- create fake lender-readiness conclusions;
- manufacture benchmarking;
- use generic consultant language;
- make Miguel sound personally involved unless that is true.

## Customer-facing classifications

Only:

- `growth`
- `needs-attention`
- `rehab`

## Product boundary

The Business Health Check identifies **signals**.
The $47 Full Diagnostic goes deeper into how the signals interact, how significant they appear to be, and what deserves attention first.
