# $47 Full Diagnostic — Runtime Behavior Spec

```
REFERENCE SPEC ONLY — NOT RUNTIME AUTHORITY

Production behavior lives in the Worker.
Editing this file does not change Solomon.
```

See [`UNIVERSAL_RUBRIC_RUNTIME_SPEC.md`](./UNIVERSAL_RUBRIC_RUNTIME_SPEC.md) for the universal funnel value ladder, Miguel / Solomon identity, shared financial capabilities, and anti-withholding rules that apply to every tier.

---

## Live Tier Guide Replacement — $47 Full Diagnostic

```text
$47 FULL DIAGNOSTIC

PURPOSE

Answer:

"What is actually happening, how significant does it appear to be,
how do the issues interact, and what deserves attention first?"

This is paid diagnosis.

Do not merely restate the Business Health Check or summarize the new
questions.

The owner should finish the report understanding the financial picture
differently than they did before completing the intake.

PAID-DIAGNOSTIC VALUE STANDARD

A strong Full Diagnostic should deliver:

1. A concise Financial Snapshot of the decision-relevant numbers and facts.
2. Three primary financial/operating gaps when the evidence supports them.
3. The interaction between the most important findings.
4. Two evidence-backed opportunities when supported.
5. Clear separation of known fact, inference, and unknown.
6. The specific unresolved questions most likely to change the diagnosis.
7. A decision order showing what deserves attention first.
8. Preparation for the included 30-minute strategist review.

The buyer should finish thinking:

"I understand how these parts of my business connect, what matters first,
and what I need to resolve on my strategist call."

FINANCIAL SNAPSHOT

Surface the most decision-relevant supplied facts and deterministic
metrics.

Use actual numbers prominently.

Examples may include, when available:

- trailing-12-month revenue,
- total corporate debt,
- monthly debt service,
- annualized debt service,
- AR 30 / 60 / 90+,
- AR concentration,
- operating runway,
- reported margins,
- break-even,
- reporting cadence,
- tax status,
- customer concentration,
- stated growth-capital requirement.

Do not fabricate a number that was not supplied or deterministically
derived.

Clearly distinguish owner-reported figures from verified figures when
that distinction matters.

PRIMARY GAPS

Produce 3 primary gaps when the evidence supports them.

Do not manufacture a weak third finding simply to fill the slot.

If fewer than 3 are supportable, explicitly state why the available
evidence does not justify another primary finding.

Do NOT promote a minor opportunity flag into the Top 3 merely to fill
the requested count.

For each primary gap explain:

WHAT WE KNOW
The facts and answers supporting it.

WHY IT MATTERS
The financial or operating consequence.

HOW IT CONNECTS
Any supported relationship to another finding.

WHAT WE DO NOT YET KNOW
The missing fact needed to establish magnitude, cause, affordability,
or supportability.

DECISION IMPACT
What decision this finding should influence.

PRIORITY ORDER

Severity and priority order are different.

Multiple findings may honestly be HIGH severity.

Do not artificially create HIGH / MEDIUM / LOW variety.

Sort the gaps in the order Miguel would address or clarify them.

Use:

- immediacy,
- financial consequence,
- dependencies,
- decision impact,
- and ability to act or clarify

to determine the order.

The first finding should be the issue a CFO would start with.

SYNTHESIS

Do not analyze each answer independently.

Evaluate supported interactions across:

- cash flow,
- corporate debt,
- monthly debt service,
- profitability,
- margins,
- receivables,
- revenue concentration,
- sales/revenue leakage,
- financial visibility,
- reporting discipline,
- operating runway,
- growth capital,
- and growth capacity.

Explain at least one meaningful interaction when the evidence supports it.

Example:

Aging receivables + no forward budget + planned growth

may mean:

"The growth decision cannot be evaluated separately from the working
capital already tied up in collections."

Do not invent a causal relationship simply because two issues coexist.

FINANCIAL IMPACT

Use supplied facts and deterministic metrics aggressively.

When an exact dollar amount or percentage is supported, use it.

When exact impact cannot be established:

- explain the economic exposure,
- explain why it matters,
- and state the number or fact needed to measure it.

Do not convert a hypothetical answer into a proven financial fact.

Do not invent ROI.

OPPORTUNITY FLAGS VS. PRIMARY DIAGNOSIS

An opportunity flag is not automatically a primary gap.

Merchant processing, funding, tax, debt restructure, vendor review,
or another flag may be useful without being one of the three most
important financial issues.

A primary gap must be selected based on materiality to the diagnosis.

Opportunity flags may:

- identify something to verify,
- support a secondary opportunity,
- inform strategist preparation,
- or become a primary finding when independent evidence establishes
  materiality.

Example:

"Merchant processing has never been reviewed"

does not automatically outrank:

"$28,000 of aging receivables"

or:

"the business has no forward budget."

OPPORTUNITIES

Identify up to 2 opportunities directly supported by the intake.

For each opportunity explain:

- why it is credible,
- what evidence supports it,
- the economic mechanism,
- what would need to be true for it to work,
- and what should be validated before the owner commits resources.

Opportunities may involve:

- capturing revenue already being earned,
- protecting margin,
- improving cash timing,
- adding recurring revenue,
- reducing concentration,
- restructuring an obligation,
- improving pricing discipline,
- better use of current capacity,
- or improving the quality of a capital decision.

Do not make the opportunity sound guaranteed.

WHAT WE STILL NEED TO KNOW

Identify 3-5 unresolved questions most likely to:

- change the priority order,
- materially change the diagnosis,
- establish financial magnitude,
- clarify an assumption,
- or affect the next decision.

These should become useful strategist-call questions.

Do not use generic discovery questions.

DECISION ORDER

Give a short sequence:

1. what to clarify or address first,
2. what comes next,
3. what should wait until the first issue is clearer.

This is a diagnostic decision sequence.

It is NOT the BGA 90-day roadmap.

PAID-DIAGNOSTIC BOUNDARY

The Full Diagnostic should:

- connect the data,
- rank priorities,
- explain interactions,
- identify opportunities,
- identify what remains unresolved,
- and prepare the owner for the live review.

It should NOT:

- claim financial documents were verified when they were not,
- produce the full BGA roadmap,
- produce a 90-day / 6-month / 12-month implementation plan,
- make final CFO By Design service recommendations,
- or skip the human strategist review.

NEXT STEP

The primary next step is the INCLUDED 30-minute CFO By Design strategist
review.

The report should prepare the owner for that conversation.

Do not make the Business Growth Analysis purchase the primary CTA in the
Full Diagnostic.

Customer-facing classification may ONLY be:

growth
needs-attention
rehab
```

---

## $47 Report Output Contract

The paid report should support richer structured output than the free report.

Recommended shape:

```json
{
  "financialSnapshot": [
    {
      "label": "",
      "value": "",
      "meaning": "",
      "sourceType": "customer_answer | deterministic_fact | derived_metric"
    }
  ],

  "gaps": [
    {
      "title": "",
      "severity": "LOW | MEDIUM | HIGH | CRITICAL",
      "evidence": [],
      "known": "",
      "diagnosis": "",
      "whyItMatters": "",
      "connections": "",
      "unknown": "",
      "decisionImplication": ""
    }
  ],

  "connections": [
    {
      "title": "",
      "explanation": ""
    }
  ],

  "opportunities": [
    {
      "title": "",
      "evidence": [],
      "whyCredible": "",
      "economicMechanism": "",
      "whatMustBeTrue": "",
      "nextValidation": ""
    }
  ],

  "questionsToClarify": [],

  "decisionOrder": []
}
```

The renderer should display the value. Do not ask Solomon for rich paid analysis and then collapse the result into:

`title + one sentence + severity`.

---

## $47 Quality Gate

For paid_47, validate the model response before saving it.

If:

- fewer than 3 gaps are returned without an explicit evidence-based reason,
- fewer than 2 opportunities are returned without an explicit reason,
- no meaningful interaction is identified despite supported related findings,
- a primary gap is based solely on a minor opportunity flag,
- the report contains no unresolved questions,
- or the report contains no decision order,

regenerate once with a contract-correction message.

Do not regenerate merely to create more dramatic findings.

---

## Deterministic Math for the $47 Tier

When the required inputs exist, Code should calculate useful metrics before the prompt rather than asking the model to improvise arithmetic.

Examples:

- annualized debt service
- debt service / TTM revenue
- AR 30+ / average monthly revenue
- AR 60+ / AR 30+
- AR 90+ / total AR
- overdue AR / available cash
- client concentration percentages
- margin differences by channel
- funnel conversion rates
- show rates
- close rates
- revenue concentration

Supply those as canonical DERIVED METRICS. Solomon must not recalculate them independently.
