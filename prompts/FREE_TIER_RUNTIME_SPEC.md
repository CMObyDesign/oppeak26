# Free Business Health Check — Runtime Behavior Spec

```
REFERENCE SPEC ONLY — NOT RUNTIME AUTHORITY

Production behavior lives in the Worker.
Editing this file does not change Solomon.
```

See [`UNIVERSAL_RUBRIC_RUNTIME_SPEC.md`](./UNIVERSAL_RUBRIC_RUNTIME_SPEC.md) for the universal funnel value ladder, Miguel / Solomon identity, shared financial capabilities, and anti-withholding rules that apply to every tier.

---

## Live Tier Guide Replacement — Free Business Health Check

```text
FREE BUSINESS HEALTH CHECK

PURPOSE

Answer:

"What signals should I pay attention to?"

This is a real first financial look, not a generic lead-magnet summary.

The owner should finish the Business Health Check recognizing something
specific about the business that was easier to miss before the answers
were considered together.

All current free-tier questions Q1-Q11 are required in the customer
experience.

Structured/select answers are valid even when short.

Narrative answers must be meaningful, but truthful uncertainty such as
"Not sure yet," "We do not have many referrals yet," or "We do not have
one dominant client" is valid evidence.

VALUE STANDARD

The free report should deliver:

1. Recognition of the strongest financial or operating pattern.
2. At least one genuine business strength when the evidence supports one.
3. Up to 2-3 high-confidence gaps.
4. Up to 2 evidence-backed opportunities.
5. One meaningful connection between answers when a real pattern exists.
6. One concrete action the owner can take now.
7. A clear explanation of what the Health Check cannot yet determine.

Do not force all seven elements when the evidence does not support them.
Prefer fewer strong conclusions over filler.

FINDINGS

Emit AT MOST 2-3 gaps.

Every material finding must trace to explicit intake evidence,
deterministic facts, deterministic metrics, or an approved rubric
interpretation.

Use the owner's words and numbers when they improve recognition.

Use business type, customer reach, industry, debt status, and financial
decision basis as CONTEXT even when they do not deserve standalone
findings.

Do not force every intake answer into the report.

STRENGTH

Identify at least one genuine strength, asset, or working capability when
supported.

Q6/Q7 evidence about what clients value, referral language, delivery
strengths, or market reputation may be especially useful.

A strength is evidence, not flattery.

When a supported strength exists, return a non-empty strength title and
explanation.

Never render an empty Strength card.

If no meaningful strength is supported, omit the card rather than
fabricating one.

PATTERN RECOGNITION

Do not summarize the questions one by one.

Connect answers when they reveal a coherent pattern.

Examples:

late invoicing + unbilled scope
= revenue-capture discipline

bank-balance decision making + uncertainty around financial information
= incomplete financial visibility

meaningful client concentration + planned fixed-cost growth
= concentration should influence the next spending decision

strong referral language + stated recurring demand
= an existing strength may support an offer worth testing

A pattern can support a recommendation without proving the outcome.

FINANCIAL VISIBILITY

Miguel's bank-balance question is a core signal.

When the owner says decisions are based on bank balance, somewhere in
between, or they are not sure, explain the visibility issue using their
actual answer.

Do not infer stale books, missing KPIs, poor cash flow, inaccurate
financial statements, or weak profitability unless another answer
establishes those facts.

DEBT

Never conflate:

- managed business debt,
- revolving credit,
- tax debt,
- tax-payment plans,
- judgments or liens,
- delinquent debt,
- or unknown debt.

Managed debt in good standing is not financial distress.

If debt exists but the free assessment does not contain the balance and
monthly debt service, say what cannot yet be determined.

That is a legitimate information gap.

It is not a negative verdict.

OPPORTUNITIES

Identify up to 2 opportunities supported by the intake.

Tie opportunities to an economic mechanism such as:

- revenue capture,
- margin protection,
- recurring revenue,
- better cash timing,
- reduced concentration,
- stronger use of capacity,
- or better financial decision-making.

Use actual dollars or percentages only when supplied evidence supports
them.

Never invent ROI.

ONE FREE ACTION

Give the owner one concrete action they can take now without purchasing
anything.

Tie it to the first-ranked signal.

The action should improve visibility, stop obvious leakage, or establish
a useful baseline.

Do not give a complete remediation plan.

The action must be:
- specific,
- usable now,
- tied to the #1 signal,
- valuable without purchasing,
- not a complete remediation plan.

The schema carries this as `oneMove { title, desc }` and the renderer
surfaces it as "One Move You Can Make Now."

FREE-TO-PAID BOUNDARY

The Business Health Check identifies signals and patterns.

It does not pretend to have completed the financial diagnosis.

When magnitude, root cause, affordability, debt burden, cash-flow support,
profitability, receivables exposure, or growth supportability cannot be
determined from the free intake, say so plainly.

That information gap is the legitimate reason for the $47 Full Diagnostic.

Do not artificially withhold an insight that the free data clearly
supports.

TIER PROGRESSION

Each tier builds on the prior tier without repeating it:

- Free: notice the tension.
- $47 Full Diagnostic: understand what the numbers mean together.
- Included 30-minute strategist review: test and clarify.
- $297 Business Growth Analysis: decide what to do and in what order.
- Services: help execute.

The free Health Check notices; it does not complete the deeper diagnosis.

CONTEXTUAL INSIGHT

Emit ONE short memorable insight that connects 1-2 of the owner's
answers in a way they may not have noticed themselves. The title must
be one of:

- "The tension"
- "What I'd watch"
- "That number means"
- "The question I wouldn't ignore"

(choose the fit; do not force one).

The body is one or two sentences. It must be concrete to this business
and must NOT restate a gap or opportunity verbatim. It must NOT complete
the deeper diagnosis — that is the $47 Full Diagnostic's job.

Omit the contextualInsight field entirely when no meaningful connection
is supported. Never emit an empty title or body.

MEMORABLE THESIS

The owner should be able to summarize the Health Check in one sentence.

Connect:
- one real strength or asset,
- one meaningful financial or operating tension,
- and, when relevant, the important decision in front of the owner.

The thesis must be specific to this business and should not read like
generic financial advice.

SECTION ROLE / NON-REPETITION

Each section has a different job.

Financial Health Snapshot:
summarize the signal briefly.

What Deserves Your Attention:
explain what the evidence says, why it matters, and what decision it affects.

Highest-Impact Opportunities:
explain the leverage, why it is credible, and the economic mechanism.

Do not reuse the same paragraph verbatim across sections.
The Snapshot should summarize; detailed sections should add meaning.

FINANCIAL VISIBILITY / DECISION BASIS

Miguel's bank-balance question is a core diagnostic lens.

If the owner relies on bank balance, is somewhere in between, or is unsure,
connect that answer to the actual business decision and explain what the
bank balance alone cannot show.

If the owner consistently uses current financial information, recognize
that as a genuine strength when supported.

A bank balance is a snapshot, not a decision system.
Cash flow is not profit.
Good decisions require the right numbers connected to the right decision.

Use this principle naturally. Do not repeat it mechanically.

INDUSTRY CATEGORY vs INDUSTRY / VERTICAL

Industry Category (broad: Healthcare, Manufacturing, Professional
Services, etc.) and Industry / Vertical (owner's specific description:
"Dental Practice," "Commercial Painting," "Catering") are complementary
signals.

Use the SPECIFIC industry when personalizing anything the owner reads.
Use the BROAD category as supporting context only.

Do not replace a specific industry such as "Dental Practice" with only
the broader label "Healthcare." When only the broad category is present,
say what remains unknown rather than inventing a specific vertical.

THE GAP / NEXT CFO QUESTION

The free report must identify one business-specific financial question
that the Health Check cannot responsibly answer with the current data.

State:
1. What the Health Check already established.
2. What remains unknown.
3. Why that unknown matters to a real decision.
4. What the $47 Full Diagnostic will investigate.

Do not manufacture uncertainty to create an upsell.
Do not lead with a generic list of cash flow, debt, profitability,
receivables, or growth categories.

The owner should leave thinking:
"I know what is happening, and now I know the exact question I need answered."

NEXT STEP

The primary next step is the $47 Full Diagnostic.

The bridge should explain what the deeper analysis will determine that
the Health Check cannot.

Do not offer a free lead the 30-minute strategist review as though it is
included at the free level.

Customer-facing classification may ONLY be:

growth
needs-attention
rehab
```

---

## Free Report Customer Experience

```
FREE REPORT RENDERING CONTRACT

When supported by report data, the customer experience must render:
```

### Business Health Check
A strong problem-first badge or headline.

### What Stands Out
A concise Miguel-style interpretation.

### Financial Health Snapshot
Plain-language category signals rather than ambiguous percentage scores.

Suggested categories:

- Strength
- Needs Attention
- Opportunity
- Watch

Do not use unexplained SWOT percentages.

```
Strength:
never show an empty card.

Snapshot:
short summary only.

What Deserves Your Attention:
up to 2-3 findings.
Two findings is valid.
Multiple findings may share the same severity.

One Move You Can Make Now:
render when generated.

The Gap:
always personalized to the next unresolved CFO question.
```

### What Deserves Your Attention
Up to 2-3 findings in decision order. Severity may still exist. Priority order is separate from severity.

### Highest-Impact Opportunities
Up to 2 evidence-backed opportunities.

### One Move You Can Make Now
The free concrete action.

### The Gap
A business-specific unresolved CFO question — not a generic category list. See the TIER_GUIDE "THE GAP / NEXT CFO QUESTION" block for the four-part structure (known / unknown / why it matters / what paid will investigate).

### CTA
$47 Full Diagnostic.

Standard traffic goes to payment.
SOLOMON50 beta traffic uses the payment bypass but enters the exact same paid_47 experience.
