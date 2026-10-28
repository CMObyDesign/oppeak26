# BGA Copilot Orchestration — Runtime Behavior Spec

```
REFERENCE SPEC ONLY — NOT RUNTIME AUTHORITY

Production behavior lives in the Worker.
Editing this file does not change Solomon.
```

See [`UNIVERSAL_RUBRIC_RUNTIME_SPEC.md`](./UNIVERSAL_RUBRIC_RUNTIME_SPEC.md) for the universal funnel value ladder, shared financial capabilities, and the "shared skills + BGA orchestration" philosophy that frames every module here.

See [`PAID_297_RUNTIME_SPEC.md`](./PAID_297_RUNTIME_SPEC.md) for the customer-facing Part 1 that precedes this orchestration layer.

See [`SERVICE_RECOMMENDATION_SPEC.md`](./SERVICE_RECOMMENDATION_SPEC.md) for the service-matching philosophy that governs Section 7 below.

---

## Context

The BGA Copilot is the **orchestration layer** that runs on top of Solomon's shared financial capabilities for the paid_297 tier. It coordinates:

- document extraction / verification,
- verified-financial state,
- 90-day roadmap,
- 6-month direction,
- 12-month goals,
- support-gap analysis,
- service matching,
- prep brief,
- challenge / red-team,
- call decisions,
- post-call finalization,
- approve-and-send.

Solomon's underlying financial capabilities (visibility, debt, AR, cash, margin, etc.) are not re-implemented here — they are the same shared skills from the Universal Rubric, invoked at a deeper verified-financial depth under this orchestration.

---

## BGA Copilot Internal Roadmap Prompt Contract

The BGA Copilot roadmap should be an **internal strategist draft**.

It must not be customer-delivered before the 50-minute call.

The roadmap should use exactly these strategic sections:

### Section 1 — Current Financial Picture

What the verified numbers and client narrative establish now.

Include:

- revenue context,
- cash position,
- AR,
- margins,
- debt,
- monthly debt service,
- reporting status,
- tax status,
- concentration,
- runway,
- and other material facts when available.

Separate verified facts from client statements.

### Section 2 — Priority Issues

Rank the issues that actually need attention.

For each:

- evidence,
- impact,
- dependency,
- what happens if it is ignored,
- what still needs strategist judgment.

Do not confuse symptom and cause.

### Section 3 — 90-Day Roadmap

This is the highest-detail section.

For each priority define:

- objective,
- why it matters,
- action sequence,
- owner,
- CFO By Design role if any,
- prerequisite,
- measurement,
- decision checkpoint.

Do not recommend spending, hiring, or financing that the verified financial position cannot support.

### Section 4 — 6-Month Direction

Show where the first 90 days should lead.

Do not turn six-month direction into a promise.

Identify:

- what should be stabilized,
- what should be built,
- what should be tested,
- and what should be reassessed.

### Section 5 — 12-Month Goals / Aim / Reassess

These are goals and reassessment points.

Do not present 12-month financial outcomes as guaranteed.

Tie goals to:

- owner objectives,
- verified baseline,
- and the work that must happen first.

### Section 6 — Support Gaps

Separate:

**What the owner / current team can execute**

from:

**Where outside support may be needed**

A support gap is not automatically a CFO By Design sale.

Explain what capability is missing. Examples:

- bookkeeping cleanup,
- monthly financial interpretation,
- cash forecasting,
- tax resolution,
- debt restructuring,
- underwriting preparation,
- funding strategy,
- pricing analysis,
- reporting discipline,
- or implementation accountability.

### Section 7 — CFO By Design Service Recommendations

Candidate services come from the service catalog and signal matcher.

Solomon suggests. The strategist decides.

For each suggested service show:

- service name,
- problem it solves,
- signals/evidence that caused the match,
- why it may fit this case,
- what CFO By Design would handle,
- what the client would handle,
- likely prerequisite or dependency,
- any caution / defer condition,
- pricing only when approved catalog pricing exists.

Do not fabricate service scope. Do not fabricate pricing. Do not recommend a service solely because CFO By Design sells it.

Allow the strategist to:

- **INCLUDE**,
- **DEFER**,
- **NOT A FIT**,
- or **ADD ANOTHER ACTIVE SERVICE**.

Case-specific strategist decisions override default matching.

### Section 8 — Options for Moving Forward

Present the realistic execution options.

These may include:

- client / team executes internally,
- CFO By Design handles a specific component,
- one or more standalone services,
- Premium CFO Bundle Service,
- staged execution where one issue must be resolved before another,
- or defer / reassess.

Do not make the Premium CFO Bundle the only valid path.

Explain the tradeoff.

The goal is to help the owner understand:

> "Here is what needs to happen, here is what you can reasonably handle, and here is where CFO By Design can take responsibility if you want the help."

---

## BGA Provenance

Every material internal roadmap claim should carry provenance.

Use the existing closed provenance model:

- `[VF: ...]` — verified financial
- `[CS: ...]` — client statement / intake
- `[SJ: ...]` — strategist judgment
- `[SM: ...]` — service match

Do not create unsupported provenance.

If something is not validated, say:

> `not yet validated`

rather than inventing a source.

---

## BGA Red-Team QA

Before the roadmap is customer-ready, challenge it across:

### Symptom vs. Cause
Is the roadmap fixing the visible symptom while leaving the underlying cause untouched?

### Supportability
Can the verified financial position actually support the recommended:

- hire,
- spend,
- debt move,
- financing move,
- marketing investment,
- expansion,
- or operating commitment?

### Priority Dependencies
What must happen before something else?

### Service Bias
Would an independent CFO agree that the service recommendation fits the case? Or is the roadmap recommending it because CFO By Design happens to sell it?

### Time-Horizon Certainty
Are 6-month and 12-month items framed as direction / goals / reassessment, rather than promises?

### Client Capacity
Is the roadmap assigning more work to the owner / team than they realistically have the capability or capacity to execute?

---

## BGA 50-Minute Call Prompt Contract

The call is not a recap call.

It is the presentation and decision-making stage of the Business Growth Analysis.

The strategist should work through:

1. Current Financial Picture
2. Priority Issues
3. 90-Day Roadmap
4. 6-Month Direction
5. 12-Month Goals / Reassessment
6. Support Gaps
7. CFO By Design Service Recommendations
8. Options for Moving Forward

The call should:

- challenge assumptions,
- correct facts,
- confirm priorities,
- test client willingness / capacity,
- resolve open questions,
- confirm which roadmap items the client will own,
- identify where support is needed,
- and record actual service decisions.

Service decisions should be stored as human-confirmed case decisions. Solomon's recommendation is not the final authority.

---

## Post-Call Final Business Growth Plan Contract

Only after call decisions are processed and the strategist has reviewed the case should the final plan be approved for delivery.

The final client-facing plan should answer:

> "What are we doing, in what order, who owns it, and what happens next?"

It should contain:

### Current Financial Picture
Only the facts and conclusions appropriate for customer delivery.

### Priority Issues
In clear decision order.

### 90-Day Roadmap
Specific. Actionable. Owned. Measurable.

### 6-Month Direction
Direction and checkpoints.

### 12-Month Goals / Reassessment
Goals, not guarantees.

### Support Gaps
What the client / team can handle and where help is needed.

### CFO By Design Solutions
Only strategist-confirmed recommendations.

Use customer-facing service names. Do not expose:

- service IDs,
- raw JSON,
- signal slugs,
- internal tags,
- or internal matching logic.

### Options for Moving Forward
Make clear what the client selected, deferred, or chose to handle internally.

The final plan should feel valuable **even if the client declines every additional CFO By Design service**. That is what makes the recommendations credible.
