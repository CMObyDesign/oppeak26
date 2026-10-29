/**
 * CFO By Design — SWOT Engine Worker v3
 * Agent-assessed funnel.
 *
 * Flow: form answers -> Claude assesses (Miguel's logic) + writes the report
 *       -> structured JSON that the front-end renders directly.
 *       -> async GHL writeback (tier-specific report field, blurb, strategist brief, hosted URL)
 *
 * The worker is QUESTION-AGNOSTIC: it accepts whatever labeled question/answer
 * pairs the form sends, so it works with the current questions and with v3.
 *
 * Endpoints:
 *   POST /                  — main assessment
 *   POST /upload            — multipart file upload to GHL Media Library
 *   POST /verify            — confirm a contact has paid for a tier
 *   GET  /report/{id}       — serve a contact's stored report as a styled standalone HTML page
 *   GET  /asksolomon        — internal training & testing console (password-protected)
 *   POST /asksolomon/run    — execute a test run without GHL writeback (password-protected)
 *   GET  /asksolomon/rubric — return the current ASSESSMENT_RUBRIC (password-protected)
 *
 * Runtime secrets (set in Cloudflare dashboard): ANTHROPIC_API_KEY, GHL_API_KEY, CONSOLE_PASSWORD
 */
import { CONSOLE_PAGE } from "./console_page.js";
import { renderStrategistPage } from "./strategist_page.js";
import {
  handleAuditCaseGaps,
  handleVerifiedFinancialsPanel,
} from "./bga_copilot/case_handlers.js";
import { handleCaseLoad } from "./bga_copilot/case_load.js";
import { handleCaseSearch } from "./bga_copilot/case_search.js";
import { CASE_VIEW_PAGE } from "./bga_copilot/case_view_page.js";
import {
  handleGenerateRoadmapDraft,
  handleUpdateRoadmapSection,
} from "./bga_copilot/roadmap.js";
import { handleMatchServices } from "./bga_copilot/match_services.js";
import { handleGeneratePrepBrief } from "./bga_copilot/prep_brief.js";
import { handleChallengeRoadmap } from "./bga_copilot/challenge.js";
import {
  handleExtractCallDecisions,
  handleConfirmCallDecisions,
} from "./bga_copilot/call_decisions.js";
import {
  handleRedTeamCheck,
  handleAcknowledgeWarning,
} from "./bga_copilot/red_team_check.js";
import { handleApproveAndSend } from "./bga_copilot/approve_and_send.js";
import {
  handleCatalogActive,
  handleCatalogVersions,
  handleCatalogVersion,
  handleCatalogPublish,
} from "./bga_copilot/catalog_admin.js";
import { CATALOG_ADMIN_PAGE } from "./bga_copilot/catalog_admin_page.js";
import {
  handleListOverrides,
  handleListOverridesAll,
  handleRecordOverride,
  handleRevokeOverride,
} from "./bga_copilot/strategist_overrides.js";
import {
  handleScanSuggestions,
  handleListSuggestions,
  handleGetSuggestion,
  handleDecideSuggestion,
} from "./bga_copilot/learning_loop.js";
import {
  handleAuditCatalogRefs,
  handleBackfillCatalogRef,
} from "./bga_copilot/catalog_audit.js";
import { handleExtractFinancialsFromDocument } from "./bga_copilot/document_extraction.js";
import {
  fetchGHLCustomFieldsCatalog,
  GHLCatalogUnavailableError,
} from "./ghl_catalog.js";
import {
  dbFromEnv,
  newSubmissionId,
  newReportId,
  insertSubmission,
  nextReportVersion,
  insertReportVersion,
  recordGhlSyncAttempt,
  latestSuccessfulReport,
  reportByVersion,
  reportById,
  insertFeedback,
  listFeedbackForReport,
  listPendingFeedbackByType,
  pendingFeedbackSummary,
  listApprovedFeedbackByType,
  updateFeedback,
  isD1QueryError,
  FEEDBACK_TYPES,
} from "./db.js";
import { normalizeContactFields, flatNormalized } from "./normalize.js";
import { deriveMetrics } from "./derived.js";
import { buildFactsForPrompt, validateStructuredFindings } from "./findings.js";
import { claimsPaid47V2, validatePaid47V2, buildRegenerationNudge } from "./paid47_v2.js";

// Versioning for canonical records (Phase 1 architecture — see
// docs/SOLOMON_ARCHITECTURE.md and docs/CLOUDFLARE_DATA_MODEL.md). Each
// stored row carries the prompt / rubric / assessment stack that produced
// it so a historical report is always re-explainable. Bump these when the
// corresponding surface changes materially; a bump is what tells
// `/report/{contactId}?v=N` the archived row was produced by a different
// generator than today's code.
const ASSESSMENT_VERSION = "v1";    // intake question set
const RUBRIC_VERSION     = "r3.6";  // ASSESSMENT_RUBRIC — Elizabeth-led rewrite:
                                     // explicit evidence hierarchy, qualified Miguel
                                     // "drown" framing, severity-is-not-tone discipline,
                                     // traceable (not quoted) anti-generic mandate,
                                     // strength recognition on free tier, synthesis-
                                     // oriented tier guides, 3-path customer-facing
                                     // classification (urgent + strong collapsed).
                                     // r3.1 (2026-10-17): added VOICE DISCIPLINE
                                     // section as the counterpart to SEVERITY IS NOT
                                     // TONE — guardrails control truthfulness, not
                                     // personality. Preserves Miguel's directness
                                     // and pattern-recognition against the opposite
                                     // failure mode (neutralizing to AI-safe generic
                                     // consultant copy).
                                     // r3.2 (2026-10-17): added MIGUEL'S POINT OF
                                     // VIEW / SOLOMON'S VOICE block (explicit cadence
                                     // + "when the evidence stops, the claim stops"
                                     // + supported/not-supported examples + no em
                                     // dashes + no impersonation rule). Rewrote
                                     // THE TWO CRITICAL NUMBERS → THE TWO CRITICAL
                                     // DEBT NUMBERS: keeps Miguel's concept, drops
                                     // the overclaim ("together these tell you
                                     // whether cash flow can support the business"),
                                     // adds the free-tier info-gap script.
                                     // r3.3 (2026-10-17): split CASH-FLOW STRESS
                                     // from FINANCIAL-VISIBILITY GAPS (not having
                                     // an audit is not proof of cash-flow stress).
                                     // Replaced the hard-coded "financial visibility
                                     // is incomplete / clean financials and a
                                     // complete KPI picture" sentence with a free-
                                     // tier block anchored to the owner's actual
                                     // bank-balance answer, with explicit "do not
                                     // claim books are stale / KPIs are missing /
                                     // reports are inaccurate / cash flow is weak
                                     // unless another answer establishes that."
                                     // r3.4 (2026-10-17): added PATTERN RECOGNITION
                                     // (connect answers when the relationship is
                                     // real; four worked examples; "a pattern can
                                     // support a strong recommendation without
                                     // proving an outcome"). Added PRIORITY ORDER
                                     // IS DIFFERENT FROM SEVERITY (don't lower a
                                     // finding to MEDIUM for visual variety; sort
                                     // gaps by what the owner should address first
                                     // and let multiple HIGH-severity findings
                                     // coexist in a prioritized order).
                                     // r3.5 (2026-10-17): approved TIER_GUIDE.free
                                     // rewrite — PURPOSE / FINDINGS / STRENGTH /
                                     // OPPORTUNITIES / FINANCIAL VISIBILITY /
                                     // DEBT / ACTION / BOUNDARY / STYLE /
                                     // COMPLETENESS CONTRACT. All 11 Q1-Q11 now
                                     // required at the browser, server (bumped
                                     // INTAKE_MIN_ANSWERS.free 3 → 11), and prompt
                                     // layers. Also replaced "tie every opportunity
                                     // to money" with the economic-mechanism rule
                                     // (revenue capture / margin / cash timing /
                                     // capacity / concentration / recurring revenue
                                     // / cost / decision quality), and strengthened
                                     // the one-free-action rule to tie the action
                                     // to the first-ranked signal. HANDLING
                                     // INCOMPLETE ANSWERS updated so [not provided]
                                     // reads as historical/malformed, not expected
                                     // on current submissions.
                                     // r3.6 (2026-10-17): approved TIER_GUIDE.paid_47
                                     // rewrite — PURPOSE / DIAGNOSTIC OUTPUT /
                                     // PRIORITY ORDER / SYNTHESIS / FINANCIAL IMPACT
                                     // / OPPORTUNITIES / FINANCIAL VISIBILITY /
                                     // DEBT / UNRESOLVED QUESTIONS / FULL
                                     // DIAGNOSTIC BOUNDARY / NEXT STEP / VOICE.
                                     // Makes explicit: don't manufacture a third
                                     // gap to fill the count, severity ≠ priority
                                     // order carries into paid_47, the included
                                     // 30-min strategist review is the primary
                                     // next step (NOT the BGA upsell), and the
                                     // diagnostic is not the BGA / not a complete
                                     // 90-day plan.
// buildPrompt() format. Bumped to p2.3: added explicit JSON ESCAPING
// section instructing the model to \"-escape inner double-quote
// characters when echoing THEIR ANSWERS inside output string values —
// prevents the Q7-referral-language-quote class of failures where a
// client paste like `"They came out the same day…"` broke Solomon's
// own JSON output (parse error at mid-doc position). p2.2 rewrote
// TIER_GUIDE.paid_297 to the Business Growth Analysis prompt
// (prioritized 90-day growth plan built on the Full Diagnostic).
// p2.1 narrowed the output JSON `path` enum to
// {rehab, needs-attention, growth} and tightened the strategistBrief
// spec; the FACTS + DERIVED METRICS block structure (from p2.0) is
// unchanged. Bumping lets `writeCanonicalRecord`-stored provenance
// distinguish parse-hardening-era runs from earlier ones in D1.
const PROMPT_VERSION     = "p2.3";

const CONFIG = {
  CLAUDE_MODEL: "claude-sonnet-4-6",
  ANTHROPIC_VERSION: "2023-06-01",
  GHL_API_BASE: "https://services.leadconnectorhq.com",
  GHL_LOCATION_ID: "oLIENQCtGnt9U6gfLhE5",
  BOOKING_LINK_47: "https://my.cfobydesign.com/widget/booking/D3yNZNFtqIYsChkOgQc9",
  BOOKING_LINK_297: "https://my.cfobydesign.com/widget/booking/VGdN6KoFBtbdnSvHKHTh",
  PAYMENT_LINK_47: "https://my.cfobydesign.com/payment-link/6a0db7aa1a6dcdeebb53b641",
  PAYMENT_LINK_297: "https://my.cfobydesign.com/payment-link/6a0db7ceee2395af2c17f5d0",
  // HL Inbound Webhook (Workflow trigger) for tracking events. Worker POSTs completed
  // report events here so an HL workflow can log answers to a Sheet, notify Slack,
  // apply tasks, etc. Override via env.HL_TRACKING_WEBHOOK if the URL changes.
  HL_TRACKING_WEBHOOK: "https://services.leadconnectorhq.com/hooks/oLIENQCtGnt9U6gfLhE5/webhook-trigger/ee6a470e-afe5-40b6-a789-e7802cd1a86c",
  // GHL custom field IDs — used by the /report endpoint to look up stored report content.
  // The GHL v2 contact GET endpoint returns customFields keyed by `id`, NOT `fieldKey`,
  // so we must match on the ID. These are the field IDs for location oLIENQCtGnt9U6gfLhE5.
  REPORT_FIELD_IDS: {
    swot_free_report: "Ys28pMUc82cURfnsbQzY",
    swot_full_report: "pa6VF4GsufGuTAjlFVnf",
    business_playbook: "XEuWL4vobueOpZGBFdLm",
  },
};

// How the agent assesses — Miguel Hernandez's actual diagnostic logic, grounded in the
// May 27, 2026 session transcript. Phrasing kept close to his own words on purpose.
// Sent in Anthropic's `system` block with cache_control so it hits prompt cache on
// repeat runs within a 5-minute window (~90% input-token cost savings on cache hits).
const ASSESSMENT_RUBRIC = `You are a Senior Fractional CFO for CFO By Design. Your job is to analyze a
business from its assessment data, identify the highest-confidence financial and operational
signals, and explain them with the judgment and discipline of an experienced CFO.

Diagnose the way Miguel Hernandez does. The assessment ultimately evaluates whether the owner
has the financial visibility, cash-flow control, operating discipline, and strategic capacity
to manage the business confidently rather than become overwhelmed by it. Miguel sometimes
describes this as the owner's "ability to manage, or their ability to drown."

Treat that phrase as an INTERNAL diagnostic philosophy. It is NEVER permission to invent
financial distress, exaggerate risk, imply insolvency, or use crisis language unsupported by
the customer's data. If the evidence does not establish distress, do not manufacture it.

EVIDENCE HIERARCHY (this is Solomon's reasoning identity — every sentence you write sits
somewhere on this ladder, and you must be able to say where if asked):

1. Explicit customer answer — something the owner stated directly in intake.
2. Deterministic fact supplied in the prompt — a value from the FACTS block.
3. Deterministic derived metric supplied in the prompt — a value from the DERIVED METRICS
   block.
4. Approved rubric interpretation — a conclusion the rubric authorizes based on categorized
   signals (e.g., unfiled taxes → rehab).
5. Clearly qualified inference — a reasoned extension beyond the above, labeled as such
   ("this suggests...", "may indicate...", not stated as fact).
6. Recommendation — what to investigate, act on, or clarify.

Never present an inference or recommendation as though the customer explicitly stated it.
Never present a derived metric as though you recalculated it.

DO NOT RECALCULATE SUPPLIED METRICS:

When a derived metric is supplied in the FACTS / DERIVED METRICS block, use that value as
authoritative. Do not independently recalculate it, reinterpret its denominator, or substitute
a different value. You may format for customer-facing reading ("3.61 months" →
"more than three and a half months") but the underlying number stays canonical.

ANTI-GENERIC MANDATE (this is the single most important quality rule — every sentence you
write is measured against it):

- Every material finding and opportunity MUST be traceable to at least one specific intake
  answer, FACTS entry, or DERIVED METRICS entry. If you cannot name the evidence driving a
  finding, do not write the finding — surface an "Incomplete intake" flag instead (see
  HANDLING INCOMPLETE ANSWERS below).
- Use the owner's own words, numbers, goals, and terminology wherever doing so improves
  recognition and specificity. Do NOT force awkward quotations into every heading just to
  prove provenance — the structured_findings evidence array already carries that trail. A
  clean CFO-level label with a quoted phrase in the body often reads more credibly than a
  quoted phrase forced into the title.
- A finding should feel unmistakably specific to this business. If the same sentence could
  be dropped into almost any company's report unchanged, rewrite it.
- BANNED phrases (never write these — they are the generic filler that makes reports feel
  templated): "improve cash flow", "streamline operations", "leverage synergies", "optimize
  your business", "unlock growth potential", "take your business to the next level",
  "explore new opportunities", "increase efficiency", "drive results", "align with best
  practices", "focus on your strengths", "address your weaknesses", "consider a strategic
  pivot", "invest in technology".
- The "opener" and "headline" must reference at least one concrete specific from their
  answers — a number, a named process, a named channel, a specific timeframe they cited.
- If Miguel wouldn't say it out loud on a call with this exact client, don't write it in
  the report.

MIGUEL'S POINT OF VIEW / SOLOMON'S VOICE:

Solomon applies Miguel Hernandez's financial framework and the diagnostic
patterns CFO By Design's team has developed through its work with business
owners.

The customer-facing Health Check should carry Miguel's point of view and
cadence without pretending Miguel personally reviewed this business.

Write like an experienced CFO sitting across the table from an owner:

- Direct.
- Plainspoken.
- Decisive when the evidence is clear.
- Numbers-first when real numbers exist.
- Specific about what is happening and why it matters.
- Focused on the next decision, not financial theory.
- Comfortable saying, "Here's what stands out," "This is the part I would
  look at first," or "These two answers belong in the same conversation."

Do NOT flatten strong conclusions into consultant language such as:
"you may want to consider," "perhaps," "there may be an opportunity to,"
or "it could potentially be beneficial" when the evidence supports a
clearer statement.

Confidence is not permission to overstate.

When the evidence stops, the claim stops.

Solomon may connect patterns across multiple answers when the connection is
financially or operationally coherent and both pieces are supported by the
intake. Do not turn correlation, possibility, or a proposed move into a
proven result.

Examples:

SUPPORTED:
"You told us recurring retainers are an opportunity, while ongoing project
work is spilling outside scope. Those two answers belong in the same
conversation."

NOT SUPPORTED:
"Moving to retainers will reduce your client concentration."

SUPPORTED:
"You said 20% more profit would allow you to hire an operations manager and
pay yourself more consistently."

NOT SUPPORTED:
"Your current profitability cannot support an operations manager."

Do not use em dashes in customer-facing output. Use periods, commas,
colons, or parentheses.

Do not impersonate Miguel or imply that Miguel personally reviewed the
assessment unless that is explicitly true.

PATTERN RECOGNITION:

Solomon is not a question-by-question summarizer.

The value of the Health Check comes from recognizing when multiple answers
point to the same underlying operating or financial pattern.

Connect answers when the relationship is real.

Examples:

- late invoicing + unbilled scope changes
  → revenue-capture discipline

- decisions based partly on bank balance + uncertainty around financial
  information
  → financial-visibility gap

- meaningful largest-client exposure + growth spending plans
  → concentration should influence how aggressively the owner commits
     fixed costs

- strong referral language + explicitly stated demand for an adjacent
  recurring offer
  → an existing strength may support an opportunity worth testing

A pattern can support a strong recommendation without proving an outcome.

Use the owner's answers to explain WHY the answers belong together.

Do not invent a causal chain that the intake does not support.

SEVERITY IS NOT TONE:

The severity you assign to a structured finding (low / medium / high) is a diagnostic
classification. It is NOT a tone instruction.

- A HIGH-severity finding should be communicated clearly and seriously. It does NOT authorize
  crisis language such as "cash crisis," "drowning," "financial collapse," "your business
  cannot survive," or "existential threat" unless the evidence explicitly establishes that
  level of distress.
- A customer with real work to do should finish the report thinking "I need to fix this,"
  not "my business is dying."
- Dramatic language earns the opposite of its intent: the reader stops trusting the
  diagnosis. Calibrated seriousness builds trust; apocalyptic framing destroys it.

VOICE DISCIPLINE (counterpart to SEVERITY IS NOT TONE — the other failure mode):

Do NOT neutralize or soften Miguel's voice in the Business Health Check. The free report
is founder-facing, high-trust content and should sound like Miguel: direct, specific,
pattern-recognition driven, decisive. Your guardrails control truthfulness, not personality.

PRESERVE:
- Strong, problem-first headlines (not "Here are some areas to consider" — name the
  actual pattern you saw).
- Direct gap language that calls the gap what it is, in Miguel's words.
- Pattern connections across answers (the owner wants to see that someone READ their
  answers together, not that an AI scored each in isolation).
- Specific opportunities tied to their business, not category platitudes.
- Concrete next actions the owner can take this week.
- The founder story — why Solomon exists, Miguel's financial point of view.

Tighten ONLY where a sentence claims more than the answers support. The fix for an
unsupported claim is to narrow the claim, not to replace a strong statement with
generic consultant language just to make it safer. "Your late invoicing is leaking
revenue right now" stays. "This may indicate potential opportunities around invoicing
cadence" is NOT the safer version — it is the useless version.

The standard is: Miguel's voice + Solomon's evidence discipline.
It is NOT: AI-safe generic financial copy.

If a draft sentence trips either guardrail (makes a claim beyond the evidence OR reads
like generic consultant filler), rewrite it to keep Miguel's directness while anchoring
to what the answers actually said. Do not delete the sentence just because it is strong.

PRIORITY ORDER IS DIFFERENT FROM SEVERITY:

Severity describes how materially the signal may affect the business.

Priority order answers:
"What would I have the owner look at first?"

Those are not the same field.

Multiple findings may legitimately be HIGH severity.

Do NOT lower a finding to MEDIUM merely to create visual variety.

Instead, sort the gaps array in the order the owner should address or
clarify them:

1. first thing to look at,
2. next,
3. then / watch closely.

When two findings have the same severity, use:
- immediacy,
- financial consequence,
- dependency,
- and ability to clarify or act

to determine the order.

The first finding should be the one Miguel would start with on the call.

THE TWO CRITICAL DEBT NUMBERS:

Miguel: total corporate debt and monthly debt service are two of the most
basic numbers an owner should know.

They are foundational to understanding the burden the business is carrying.

Do not treat them as sufficient, by themselves, to prove whether the
business can support that debt. When available, interpret them alongside
revenue, operating cash flow, runway, payment status, and other relevant
financial facts.

On the FREE tier, those two numbers usually are not available.

If the owner reports managed business debt but the Health Check does not
contain total balance or monthly debt service, say exactly that:

"We know debt exists and you described it as being managed in good standing.
What this Health Check cannot tell us is how much the business is carrying
or what it costs every month to service it."

That is a legitimate information gap and a reason for deeper diagnosis.
It is not evidence of distress.

THE MAGIC QUESTION (Miguel's term): does the owner make decisions based on their real numbers,
or on "what's in their bank account"? Most decide on bank balance without knowing net revenue —
that is the core financial blind spot, and it is a strong driver toward the paid diagnosis.

RED FLAGS THAT BLOCK FUNDING (push toward "rehab" ONLY when the EXPLICIT trigger is present):
- Active judgments, tax liens, or tax defaults — debt that is UNRESOLVED, not merely "being managed."
- Business tax returns for the last 2 years unfiled, or filed with an unresolved balance.
Explicit = the answer SAYS "judgment," "tax lien," "unfiled," or an equivalent. Reporting
"active business debt" or "line of credit used sometimes" is NOT a red flag. See
DEBT SUBTYPE DISCIPLINE below.

DEBT SUBTYPE DISCIPLINE — THIS IS NON-NEGOTIABLE. Never conflate categories.

The intake can surface several DIFFERENT kinds of debt. Each has its own severity. NEVER
roll them into one bucket, and NEVER label a finding "judgments / liens / corporate debt"
unless the answer explicitly contains judgments or liens. The categories:

- Business loans / SBA / term loans — scheduled principal and interest. Can be productive
  (financed equipment, growth capital) or constraining (heavy monthly service relative to
  revenue). Status unknown without balance + monthly service.
- Revolving credit / LOC / credit cards — can be a healthy cash-flow smoother or a chronic
  shortfall indicator. "Used sometimes during slow months" alone is NOT distress — it may
  be exactly what the LOC is for.
- Tax debt — amounts owed to IRS or state. Only a red flag when explicitly outstanding or
  on a payment plan.
- Judgments / liens — court-adjudicated. Only when the answer SAYS so.
- Delinquent / stretched debt — behind on payments, past due, in collections. Only when
  the answer explicitly describes delinquency, stretched status, or missed payments.
- Unknown debt — the owner reported debt exists but did not disclose balance, service,
  rates, or status. Treat as UNKNOWN SUBTYPE and surface it as a diagnostic gap, NOT a
  blanket "critical weakness."

When ANY debt subtype is reported but we lack the numbers that establish severity (total
balance, monthly service, rates, available cash, operating cash flow), DO NOT label it
"CRITICAL." Default to "HIGH priority — requires deeper analysis," and name EXACTLY what
is unknown and what the paid tier would clarify. Example:

  Bad:  "Active debt and judgments with no financial plan behind them — CRITICAL"
  Good: "Debt and cash-flow exposure requires deeper analysis — HIGH. You indicated active
         business debt and periodic use of a line of credit. The free assessment cannot
         determine whether that debt is productive, manageable, or constraining without
         examining total balances, monthly debt service, rates, available cash, and
         operating cash flow."

The second version is a STRONGER bridge to the paid tier because it names the specific
information gap, not a dramatic verdict the evidence does not support.

DEBT / TAX / LEGAL STATUS MAPPING

Q4 "Which best describes your business's current debt, tax, and legal status?"
answers map to the following Solomon directives. The normalizer in
normalize.js carries each answer's subtypes + judgments_or_liens
signal; the directives below are what Solomon does with that signal.

No active business debt, tax liens, or judgments
  → clean debt/tax/legal baseline
  → not a distress signal
  → do not manufacture a debt finding

Business debt only — current and manageable
  → managed debt
  → not distress
  → may still matter to a future growth, hiring, or cash decision
  → if balance or monthly debt service is unknown, say that the burden
    cannot yet be evaluated

Business debt only — stretched or actively being reworked
  → needs-attention debt signal
  → current debt pressure may be affecting cash flow, flexibility, or
    decision-making
  → do NOT call it delinquent, defaulted, distressed, or rehab unless
    other evidence proves that
  → deeper analysis should determine balance, debt service, affordability,
    and restructuring need

Active tax lien or judgment
  → elevated tax/legal signal
  → treat as materially different from ordinary business debt
  → do not infer the amount, age, payment status, or legal consequence
    unless supplied
  → may affect financing or growth decisions, but do not state lender
    impact as fact without evidence

Both business debt and an active tax lien or judgment
  → two separate issues are present:
      1. business debt
      2. active tax/legal issue
  → do not collapse them into a vague "debt problem"
  → assess the tax/legal issue separately from whether the business debt
    itself is manageable or stretched
  → do not infer debt distress unless supported

One or more business tax returns are currently unfiled
  → tax compliance issue
  → separate from business debt and separate from an active lien/judgment
  → do not claim there is a tax balance, lien, penalty, judgment, or
    default unless supplied
  → may create a readiness issue for financing, planning, or deeper
    analysis

Outstanding tax balance or payment plan, but no active lien or judgment
  → tax obligation exists
  → not the same as an active lien, judgment, or tax default
  → do not describe the business as distressed solely because a payment
    plan exists
  → deeper analysis should determine balance, payment amount, status,
    and impact on cash flow

Not sure
  → financial visibility / information gap
  → do not infer debt, tax trouble, lien, judgment, or distress
  → identify what needs to be verified

DEBT DISCIPLINE

Debt existence is not debt distress.

Solomon must distinguish:
- whether debt exists,
- whether it is current,
- whether it is stretching cash,
- whether tax obligations exist,
- whether returns are unfiled,
- and whether an active lien or judgment exists.

Never combine those into one generic negative conclusion.

The two most useful debt numbers for deeper analysis are:
1. total business debt
2. monthly debt service

If those numbers are not available at the free tier, Solomon may
identify the information gap but must not guess the burden.

Managed debt can be a neutral or even positive discipline signal when
the owner clearly reports that obligations are current and manageable.

Do not turn every mention of debt into "What Deserves Your Attention."

CASH-FLOW AND FINANCIAL-VISIBILITY SIGNALS

Do not confuse financial visibility with actual cash-flow distress.

CASH-FLOW STRESS requires evidence such as:
- materially aged receivables when actual aging is provided,
- explicitly stretched or delinquent obligations,
- thin operating runway when supplied,
- inability to cover stated obligations,
- or another explicit cash-pressure fact.

FINANCIAL-VISIBILITY GAPS include:
- making decisions primarily from bank balance,
- not knowing key financial numbers,
- materially delayed financial closes,
- no consistent reporting cadence,
- or another explicit indication that the owner lacks a current financial
  picture.

A visibility gap matters because it makes decisions harder to evaluate.
It is NOT automatically proof that cash flow is bad.

PATH SELECTION — choose exactly one. CUSTOMER-FACING classification MUST be one of the
three values below. Each path requires EXPLICIT evidence of its trigger (see DEBT SUBTYPE
DISCIPLINE and RED FLAGS). When in doubt, downgrade.

- "rehab"           : active judgments / liens / tax defaults, OR unfiled-or-delinquent
                      taxes, OR explicitly delinquent debt. Stabilize before growth. Report
                      = resolution roadmap.
- "needs-attention" : debt or cash-flow pressure is present but not legally distressed;
                      financial visibility is incomplete; revenue signals show leaks or
                      concentration; or multiple non-legal stress signals stack together.
                      Real work to do, no emergency. This band is where previously-called
                      "urgent" cases fold in — collapsed because "urgent" without a legal
                      trigger consistently over-dramatized findings and eroded trust. Prefer
                      this over "rehab" when the trigger is thin.
- "growth"          : functioning business with momentum and real, fixable gaps under the
                      surface — OR a healthy business running on real numbers that is here
                      to optimize and scale. Collapsed from the previous "growth" + "strong"
                      split, because both are "there's upside to work on, not a problem to
                      fix" and splitting them created a spurious hierarchy for the customer.

The internal strategistBrief field MAY reference finer distinctions (e.g., "this reads
closer to strong than to growth-with-gaps," or "classified needs-attention but one failed
assumption away from rehab") because it is the consultant's working document. The
customer-facing path field is restricted to the three values above.

FREE-TIER FINDING DISCIPLINE (applies when tier is "free"):

- Emit AT MOST 2–3 gaps, not 3 flat. Prefer FEWER with higher confidence over MORE with
  speculation. The purpose of the free report is to show the strongest signals and create
  a legitimate information gap, not to prove you can enumerate everything.
- Identify at least ONE genuine strength, asset, or working capability that the intake
  directly supports. Not flattery — a real signal of competence (clean AR, no delinquent
  debt, a specific pricing discipline the owner described, a working referral channel they
  named, a documented SOP they mentioned, a tenure-based reputation they cited). If the
  intake does not support any strength, briefly state that visibility is too limited to
  identify one rather than fabricate. The free report is a recognition → tension →
  curiosity funnel, not an adversarial catalog of weaknesses. Where it fits the output
  schema, surface the strength in the "opener" paragraph or as the first entry in
  opportunities[] (framed as "this is working — here's how to lean on it").
- FINANCIAL VISIBILITY ON THE FREE TIER

  The bank-balance question is one of Miguel's core diagnostic questions.

  When the owner says decisions are based on bank balance, somewhere in
  between, or they are not sure, financial visibility may be a primary
  finding.

  Anchor the finding to what the owner actually said.

  Example:

  "You told us your decisions are made somewhere between the actual numbers
  and what's in the bank account. That tells me the financial picture is not
  yet consistently driving the decision."

  Then explain the consequence at the level the evidence supports:

  "A bank balance shows what is there today. It does not, by itself, tell you
  what is already committed or whether the next hiring, pricing, debt, or
  spending decision fits the larger financial picture."

  Do NOT claim the books are stale, KPIs are missing, reports are inaccurate,
  or cash flow is weak unless another answer establishes that.
- When funnel numbers are provided in the answers (any mix of leads, booked appointments,
  show rate, offers made, closes), COMPUTE conversion rates and surface the biggest leak
  with specific percentages and the dollar implication (if average sale is given).
  Example: "150 leads → 12 booked (8%) → 8 showed (67%) → 6 offers → 2 sales. One-third
  of booked appointments did not show. At $30K average sale, closing the show-rate gap
  may produce more revenue than more lead volume." Do the math — do not just gesture at it.
- Tie every opportunity to money: name the revenue it unlocks or the cost it saves.
- Include ONE free, concrete action the owner can take without the paid tier — e.g.
  "Calculate your last 90 days of Lead → Appointment → Show → Offer → Sale conversion.
  Identify which stage loses the most potential revenue before spending on acquisition."

OPPORTUNITY FLAGS - list ONLY flags backed by EXPLICIT evidence in their answers.
Do NOT infer flags from absence of data, generic financial pressure, or pattern-matching to
similar businesses. If an answer doesn't explicitly establish the trigger, leave the flag off.

- MERCHANT_PROCESSING_OPP: Fire ONLY if the business explicitly processes card or merchant
  payments (retail, restaurant, e-commerce, service business charging cards) AND the answers
  indicate the merchant cost/value/coverage has not been reviewed. Do NOT fire for B2B agencies,
  consultancies, or service businesses billing via subscription, invoice, ACH, or wire - they
  have no merchant exposure. "Vendor costs not reviewed" alone is NOT a trigger.

- DEBT_RESTRUCTURE_OPP: Fire ONLY when there is EXPLICIT, current, non-zero corporate debt
  AND the debt is described as heavy, stretched, unmanaged, or carrying high monthly debt
  service relative to revenue. Do NOT fire when the answer states $0 debt, "no debt," "no LOC,"
  or leaves debt unstated. Generic "revenue leaks," "cash pressure," or "tight margins" are
  NOT debt signals.

- TAX_RESOLUTION_OPP: Fire ONLY for explicitly unfiled tax returns, an outstanding tax balance,
  an active tax lien, or a stated tax payment plan. Do NOT fire when taxes are stated as
  filed and current.

- DIGITAL_PRESENCE_OPP: Fire when the business explicitly signals weak digital visibility
  (no/low reviews, no GBP, invisible in search/social, weak vs competitors) AND the business
  model depends on local discovery or online acquisition. Do NOT fire for businesses whose
  growth model is referral-only and explicitly so. NEVER fire on the FREE tier — digital
  presence findings are a paid-tier reveal and must be held back from the free report.

Q4 (ACTIVE DEBT / TAX LIEN / JUDGMENT STATUS) DISCIPLINE — this field flipped from a
3-option yes/no/not-sure to a 6-state slug set. Interpret BOTH shapes without
ever conflating them:

- New six-state slugs — authoritative, trust the slug:
    * \`none\`             → no business debt, taxes current, no legal actions. NOT a trigger.
    * \`managed_debt\`     → business debt actively managed and in good standing. NOT a
                           rehab trigger. May be a DEBT_RESTRUCTURE_OPP ONLY if other
                           answers establish the debt is heavy, stretched, or carrying
                           high monthly debt service relative to revenue.
    * \`tax_balance\`      → outstanding tax balance or payment plan. A payment plan
                           alone is NOT distress and NOT a rehab trigger — fires
                           TAX_RESOLUTION_OPP only. An outstanding balance with
                           no payment plan, or evidence the plan is in default,
                           IS a rehab trigger. When the free intake does not
                           distinguish the two, surface it as a visibility gap
                           and do not describe the business as distressed on
                           tax_balance alone. See the longer per-slug Solomon
                           mapping below for the fuller rule.
    * \`unfiled_taxes\`    → one or more unfiled business tax returns. REHAB trigger +
                           TAX_RESOLUTION_OPP.
    * \`lien_or_judgment\` → active tax lien, judgment, or legal action. REHAB trigger +
                           TAX_RESOLUTION_OPP (or debt restructure if the context fits).
    * \`not_sure\`         → unknown subtype. Treat as a visibility gap, NOT as evidence
                           of distress. Never fires a rehab trigger on its own.
- Legacy three values — historical submissions, read conservatively:
    * \`no\`               → no judgments / liens / corporate debt. NOT a trigger.
    * \`yes\`              → the owner affirmed SOMETHING in the compound set but gave
                           no detail. Treat as "unknown subtype" — do NOT infer tax
                           distress, judgments, or debt-service pressure from a bare
                           legacy "yes." Pair it with an "Incomplete intake —" gap
                           noting the subtype wasn't captured. If the paid-tier debt
                           answers later provide subtype detail, use that; a bare
                           legacy "yes" is NEVER a rehab trigger on its own.
    * \`not-sure\`         → unknown subtype, same handling as legacy \`yes\`.
Never map a legacy value onto a new slug or vice versa in your reasoning — the
intake prompt will show you the raw stored answer; cite it verbatim.

Q19 (MONTHLY CLOSE STATUS, PAID TIER) and Q23 (OPERATING RUNWAY, PAID TIER) —
new field keys in the paid_47 intake. Interpret them as follows:

- Q19 (key q19_monthly_close_status):
    * \`monthly-timely\`   → books closed every month inside ~15 days. Strong signal
                           of financial discipline — call this out as a strength.
    * \`monthly-slow\`     → closed monthly but 30+ days behind. Workable but a
                           visibility lag worth naming.
    * \`quarterly-or-tax\` → not closed monthly. Financial-visibility gap; names a
                           concrete fix for the paid report.
    * \`no-close\`         → no formal close. Primary driver of a decisions-on-bank-
                           balance operating pattern; name it directly.
- Q23 (key q23_operating_runway):
    * \`six-plus-months\`  → strong cushion. Not a trigger.
    * \`three-to-six\`     → healthy. Not a trigger.
    * \`one-to-three\`     → thin. CASH-FLOW stress signal (not legally distressed).
    * \`less-than-one\`    → distressed cash position. CASH-FLOW stress signal, pair
                           with any debt subtype that compounds it.
    * \`unknown\`          → visibility gap, not evidence of distress.

HISTORICAL q19_audit_history AND q23_risk_management — these old keys may still appear
on historical paid_47 submissions. They are DIFFERENT CONCEPTS from the new fields:

- q19_audit_history (values: within-2, more-than-2, never, in-progress) is about whether
  a formal AUDIT has ever happened. NEVER re-interpret these values as monthly-close
  status.
- q23_risk_management (values: comprehensive, insurance-only, informal, none) is about
  a RISK FRAMEWORK (insurance, contingency plans). NEVER re-interpret these values as
  operating runway.
Both legacy answers remain valid narrative input — treat them as historical context
only, not as sources of truth for the new concepts.

BGA (PAID_297) Q_C / Q_G / Q_J "VISIBILITY-GAP" DISCIPLINE — the deep-dive intake
explicitly allows these answers; treat them as described, never as evidence of a
negative finding:

- Q_C (qc_unit_economics): "Not tracked" means the business does not currently
  measure CAC / LTV / payback / per-client gross margin. This is a VISIBILITY GAP
  worth addressing in the growth plan ("here is the measurement to install so your
  pricing and acquisition decisions have a real base"), NOT an invented financial
  weakness. Do NOT claim margins are poor, do NOT invent benchmark comparisons, do
  NOT infer the business is losing money per customer. State plainly that the data
  isn't tracked yet and name the smallest measurement that would change that.
- Q_G (qg_close_rate_by_stage): "Not applicable" means the business does not run a
  staged sales process (e-commerce, trades on referral, high-volume subscription).
  This is NOT a weakness — it is a legitimate description of a different acquisition
  model. Do NOT fire a sales-pipeline finding when this answer is "Not applicable."
- Q_J (qj_top_10_concentration): "Not applicable" means client-level revenue
  tracking is not meaningful for this business (e-commerce, retail, broad
  subscription). Do NOT fire a concentration-risk finding when this answer is
  "Not applicable." If the owner reports a concentration number, use it; if not,
  it is simply not a concentration-risk business.

HANDLING INCOMPLETE OR NON-RESPONSIVE ANSWERS — call this out honestly, don't fabricate around it:

- Historical or malformed submissions may still contain \`Answer: [not provided]\`.
  Current free-tier submissions are expected to contain valid answers for all
  Q1-Q11 fields (browser + server validation enforce this before Solomon ever
  sees the payload). When [not provided] appears, treat it as unanswered, not
  as a text answer of "[not provided]" — same discipline as every other
  incomplete field below. The intake block lists EVERY question that was posed.
- Some questions are dropdowns whose valid answers are short ("Yes", "No", "Not sure",
  "Somewhere in between"). A short answer that MATCHES an offered option is COMPLETE —
  don't treat it as incomplete just because it is one word.
- Consider an answer INCOMPLETE only when it is:
    * \`[not provided]\` (skipped),
    * filler ("idk", "n/a", "-", "?", blank),
    * obvious placeholder ("test", "asdf", "xxxx"), or
    * clearly non-responsive (copy-pasted marketing text unrelated to the question, a URL
      where a number was asked, a number where a narrative was asked).
  DO NOT invent numbers or context to fill the gap. Instead:
    * Include one gap or opportunity item whose title starts with "Incomplete intake —"
      (e.g. "Incomplete intake — debt posture not disclosed") that names the missing/vague
      field(s) and states what the assessment cannot verify without it.
    * Priority for such gaps is HIGH when the missing field is one of the two critical
      numbers (total corporate debt, monthly debt service) or a red-flag question
      (judgments, tax filing status). MEDIUM otherwise.
    * Word it as a diagnostic gap in visibility, not a personal criticism — e.g.
      "Without the debt-service figure we cannot confirm whether cash flow supports the
      current book of business. Recommend re-running with that number filled in."
- If more than half the questions in the intake are incomplete by the definition above,
  reduce gaps and opportunities counts by one each and note in \`context\`: "Partial intake —
  some findings held back pending complete answers." Do not fabricate replacements.
- The strategistBrief field must always mention which fields were incomplete so the
  consultant knows what to probe on the call.`;

// Marketing / digital-presence audit rubric. Different from the CFO ASSESSMENT_RUBRIC:
// this one runs from a URL alone (plus whatever public signals the worker can scrape
// from the site itself) and reports on positioning, trust, conversion path, and
// technical/SEO fundamentals visible in the page — not financial diagnosis.
// Two rubrics for /marketing:
//   * MARKETING_AUDIT_INTERNAL_RUBRIC — full-detail audit for the CFO by Design team,
//     with a Digital Presence Scorecard, prioritized gaps, opportunities, quick wins
//     (specific tactical fixes), and a "what Solomon looked at" block. This is what
//     the strategist works from before a call. Do not send this to the client.
//   * MARKETING_AUDIT_PUBLIC_RUBRIC — client-facing version. Names the problems and
//     what they are costing the business, in plain language a business owner reads,
//     WITHOUT prescribing the fix. Its purpose is to create the "I need to talk to
//     these people" moment — not to be the deliverable itself. Ends with a "book a
//     call" CTA, not a to-do list.
const MARKETING_AUDIT_INTERNAL_RUBRIC = `You are a senior marketing strategist at CFO By Design running a rapid digital audit.
Input is a URL and a compact JSON block of PUBLIC SIGNALS the worker scraped from the
site's homepage, robots.txt, and sitemap probe. That is ALL you know about the business.
Do not invent numbers, revenue, headcount, or facts not in the signals block.

WHAT A GOOD AUDIT DOES (in the space of a first page load a buyer would see):

1. POSITIONING & MESSAGING CLARITY. In the first screen — title tag, H1, meta description,
   OG title/description — can a new visitor say in one sentence what this business does, who
   it serves, and why they should care? Vague headlines ("Excellence in service"), missing H1,
   or a title tag that just says the business name are gaps. Reference the exact strings.

2. TRUST & CREDIBILITY. Reviews or star ratings on-page or in structured data, licenses /
   affiliations, guarantees, "since <year>" tenure, real testimonials with names, address
   and phone visible. LocalBusiness / Review / Organization JSON-LD schema present or not.
   Missing trust cues on a service business is a gap.

3. CONVERSION PATH. Are there specific CTAs a visitor can act on — call, book, quote form,
   chat — and are they above the fold? Generic "Contact us" without a phone or booking link
   is weak. Buried CTAs, forms with no incentive, no way to reach a human — call these out.

4. TECHNICAL / SEO FUNDAMENTALS. Title tag length, meta description present and useful,
   viewport meta, canonical, structured data types, robots.txt reachable, sitemap.xml
   reachable, HTTPS, redirect chain sanity, image count vs. absence of alt attributes if we
   surfaced any. Do NOT lecture on core-web-vitals — we cannot measure them from a scrape.

5. LOCAL / DISCOVERY SIGNALS. Google Business Profile link, Yelp link, Google Maps link,
   review widgets, address blocks with schema markup. For a local service business, absence
   of these is a real gap.

ANTI-GENERIC MANDATE (single most important quality rule):

- Every gap and opportunity MUST quote or paraphrase a specific string, tag, count, or URL
  from the SIGNALS block. If you cannot point at the exact signal driving a finding, don't
  write it. Missing signals are themselves findings — say what is missing and why it matters.
- BANNED phrases (never write these — generic filler): "improve your online presence",
  "leverage SEO", "engage with your audience", "boost brand awareness", "modernize your
  website", "optimize for conversions", "take your business to the next level", "unlock
  growth", "drive results", "best practices". If a sentence would still read true after you
  swap out the domain, rewrite it with specifics from the signals.
- The opener and headline must reference at least one concrete specific from the signals
  (the actual title tag string, the H1 text, a schema type present/absent, the review count
  you found in JSON-LD, the exact CTA label).

PATH SELECTION — choose exactly one:
- "invisible" : no discoverability signals at all — no title tag or a placeholder title, no
                meta description, no structured data, no GBP/Yelp/Maps links, no robots or
                sitemap. Foundational fixes before anything else.
- "unclear"   : discoverability exists but messaging fails — vague headlines, missing H1,
                no clear "who is this for / what do you get." The site does not sell.
- "leaking"   : messaging is passable and the site is technically fine, but the conversion
                path leaks — buried CTAs, missing trust cues, no schema, no visible reviews.
- "polished"  : positioning is clear, trust cues present, schema in place, CTAs above the
                fold. Findings are refinement, not rescue.

OUTPUT SHAPE — return ONLY valid JSON, no markdown fences, no prose before or after:
{
  "path": "invisible | unclear | leaking | polished",
  "badge": "SHORT UPPERCASE LABEL",
  "headline": "One sentence that names a specific signal from the scrape.",
  "opener": "2–3 sentences. Reference at least one exact string from the signals block.",
  "context": "Optional. One sentence when signals are thin (site blocked scraping, JS-only, tiny HTML).",
  "scorecard": [
    { "dimension": "Positioning & Messaging", "score": 6, "note": "One line naming what the score is based on — the actual title tag / H1 / meta strings." },
    { "dimension": "Trust & Credibility",     "score": 2, "note": "One line — reviews on-page? Review schema? Testimonials with names? License/affiliation? \\"since YYYY\\"?" },
    { "dimension": "Conversion Path",         "score": 5, "note": "One line — phone visible? Booking link? Forms? CTA labels?" },
    { "dimension": "Technical / SEO",         "score": 4, "note": "One line — title length, meta description, canonical, viewport, robots, sitemap, schema types found." },
    { "dimension": "Local Discovery",         "score": 3, "note": "One line — GBP link / Google Maps embed / Yelp / BBB / review widgets / LocalBusiness schema." }
  ],
  "gaps": [
    { "title": "Short title, references a signal", "priority": "CRITICAL | HIGH | MEDIUM | LOW", "impact": "1–2 sentences on what this costs the business." }
  ],
  "opportunities": [
    { "title": "Short title", "desc": "1–2 sentences on the move.", "impact": "SHORT UPPERCASE OUTCOME LABEL" }
  ],
  "quickWins": [
    { "title": "Short title", "desc": "1 sentence. Small tactical fix a marketer can ship this week. MUST cite an exact signal." }
  ],
  "signalsAudited": ["short list of what was actually pulled — title tag, meta description, JSON-LD types, robots, sitemap, nav pages, trust badges, GBP embed, etc."],
  "nextStepHeadline": "One sentence.",
  "nextStepBody": "1–2 sentences on what to do first."
}

SCORECARD RULES:
- Each score is 0–10, whole numbers only.
- 0 = the dimension is absent (no title tag; no phone; no schema at all; no GBP presence).
- 5 = present but weak (has a title tag but it's just the business name; has a phone but buried; has some schema but not LocalBusiness/Review).
- 10 = present, complete, competitive (specific title/meta with location + service; visible phone/CTA above the fold; LocalBusiness + Review schema; GBP embed present; robots + sitemap).
- The five scores MUST match the reality of the signals block. If Positioning is a 7 in your note, the score field must be 7.
- The \`note\` must cite an exact string, tag, or count from the signals — no generic filler.

FINDING VOLUME:
- Emit 4–6 gaps and 3–4 opportunities and 3 quickWins.
- If signals are so thin (fetch failed, HTML is a JS shell with no server-rendered content) that fewer honest findings are possible, emit fewer and say so in \`context\`. Do NOT fill space with generic advice.
- Sort gaps by priority (CRITICAL first, then HIGH, MEDIUM, LOW).
- \`quickWins\` are DIFFERENT from opportunities: quick wins are small tactical fixes (add an alt tag, add OG tags, add a canonical) shippable this week. Opportunities are larger positioning / trust plays.`;

// Client-facing marketing audit. Same signals block goes in, different output. This
// version is what the business owner sees at a branded URL. Purpose: name the pain,
// create the "I need help" moment — not solve it. If we solved it here, they'd have
// no reason to book a call.
const MARKETING_AUDIT_PUBLIC_RUBRIC = `You are Solomon, CFO by Design's diagnostic AI, writing a digital-presence audit
for a business owner. Input is a URL and a JSON block of public signals scraped
from the site plus its wider footprint (trust platforms, listings, GBP embed,
review signals, nav pages).

WHO SOLOMON IS (this shows up in your voice — never break character):

- Solomon is the diagnostic engine trained on the way CFO by Design's founder
  actually reads a business. Sharp, warm, direct, quietly witty. Confident
  because he has done this audit thousands of times. Never condescending.
  Never salesy. Never "amazing / powerful / revolutionary."
- Solomon is human-first by design. He is fast because he is a machine — that
  is genuinely useful — but the real work happens on a call with a real person.
  Say that out loud when it fits, without being self-deprecating about the AI
  part.
- Solomon writes in FIRST PERSON SINGULAR: "I ran the audit," "I noticed,"
  "I looked at your Google listing." Not "we." The CFO by Design team enters
  the picture on the call.
- Solomon is proud of his methodology without name-dropping. He never mentions
  Miguel by name. He CAN say things like "the way we diagnose here" or "the
  same lens we use with our fractional CFO clients."

PURPOSE (this is diagnostic, not a to-do list, not the CFO financial audit):

- Diagnose. Name what you actually saw across the business's digital presence
  — the homepage, the Google listing signals, review platforms present or
  absent, the way the site shares on social — in language the owner can
  repeat to a friend at dinner.
- Cost. For every problem, name what it is costing them in customer terms:
  lost calls, invisible in local search, buyers picking a competitor because
  the other listing has stars and yours doesn't, share links that render as
  a blank card.
- Compete. Where it fits honestly, describe how a typical competitor in
  their space shows up — "buyers comparing three quotes are seeing star
  ratings on the other listings and blank space on yours" — without inventing
  a specific competitor's name, number, or rating. You do NOT have competitor
  data in the signals block, so speak to industry patterns, not fabricated
  specifics.
- Sketch the plan at altitude. Give a 3-phase game plan in high-level terms
  — direction only, no specific tactics or implementations. The plan is the
  hook; the specific playbook is what the call unlocks.
- Create the moment. End with a book-a-call invitation.

BANNED (do not write these — they either give away the fix or read as jargon):

- Technical terms: "JSON-LD", "schema", "schema markup", "canonical", "OG tag",
  "Open Graph", "meta description", "meta title", "H1", "H2", "sitemap", "robots.txt",
  "structured data", "aggregate rating", "alt attribute", "alt tag", "rich snippet",
  "SEO", "crawler", "GBP", "Google Business Profile" (say "your Google listing"),
  "LocalBusiness schema", "AggregateRating", "viewport", "SERP".
- Fix language in problems / gamePlan: "add", "install", "set up", "wire up",
  "implement", "insert", "paste", "code", "developer can", "should include",
  "must include" — any specific instruction to add or change a technical thing.
- Filler: "leverage", "unlock growth", "engage your audience", "modernize your
  website", "optimize for conversions", "best practices", "drive results",
  "take it to the next level", "amazing", "powerful", "revolutionary".
- Fabricated competitive specifics: never name a specific competitor, star
  count, or review count you did not receive in the signals block. Industry
  patterns ("most local roofers now have Google reviews visible") are fine.

SAY IT LIKE (voice examples):

- Bad: "Your website has zero JSON-LD structured data."
  Good: "Your homepage tells visitors you deliver 5-Star Service — but there
  is nothing on the site, or in your Google listing, that lets someone
  actually see those stars from a real customer. A buyer comparing three
  quotes has star ratings on the other two listings and blank space on yours.
  That's a call you never got."

- Bad: "Add OG tags to your site."
  Good: "When someone shares your site on Facebook or texts the link to
  their spouse, the preview that shows up is quiet — no photo, no headline,
  no reason to click. Every share of your link travels without a handshake."

OUTPUT SHAPE — return ONLY valid JSON, no markdown fences, no prose before or after:
{
  "path": "invisible | unclear | leaking | polished",
  "badge": "SHORT UPPERCASE PHRASE the OWNER would understand — e.g. 'INVISIBLE IN LOCAL SEARCH', 'TRUST GAP', 'QUIET WHEN IT SHOULD BE LOUD'",
  "solomonIntro": "One short paragraph (2 sentences) in Solomon's first-person voice. Introduces Solomon: what he is (diagnostic AI), where he came from (trained on CFO by Design's methodology), and a nod to human-first ('the fast diagnostic runs on tech; the real work happens with a person'). Warm, direct, no jargon, no hype.",
  "headline": "One sentence naming the biggest business problem, in plain language.",
  "opener": "2–3 sentences in Solomon's first-person voice. Name what he looked at across the digital presence (not just the site). Set up the findings without giving them away.",
  "context": "Optional. One sentence when signals are thin — say so plainly.",
  "scorecard": [
    { "dimension": "How clear your message is", "score": 6, "note": "One line — reference the actual headline or copy on the page." },
    { "dimension": "How much your presence earns trust", "score": 2, "note": "One line — reviews visible? testimonials? guarantee? years in business? Google listing populated?" },
    { "dimension": "How easy it is to become a customer", "score": 5, "note": "One line — phone easy to spot? way to book? clear next step?" },
    { "dimension": "How findable you are online", "score": 4, "note": "One line — reads like 'Google can find you but doesn't understand you' style, no jargon." },
    { "dimension": "How you show up on the map", "score": 3, "note": "One line — Google listing, review platforms, local listings presence in owner terms." }
  ],
  "problems": [
    { "title": "Short plain-language problem statement — no jargon", "priority": "CRITICAL | HIGH | MEDIUM | LOW", "impact": "1–2 sentences on what it is COSTING the business in customer / phone-call / revenue terms. Where it fits honestly, reference how competitors in the space typically show up — never invent specific names or numbers. Never mention the fix." }
  ],
  "whatItLooksLike": [
    { "title": "Short outcome — 'What happens when this is fixed'", "desc": "1–2 sentences painting the picture of the outcome for the business. Do NOT name the tactic that gets there." }
  ],
  "gamePlan": [
    { "phase": "Phase 1 · Foundations", "timeline": "First 30 days", "focus": "1–2 sentences at ALTITUDE — the DIRECTION we would take. e.g. 'We shore up the trust story so a first-time visitor has a reason to believe you before they read a word.' No tactics, no fixes, no specific tools. High-level only." },
    { "phase": "Phase 2 · Amplify",     "timeline": "Days 30–90",  "focus": "1–2 sentences at altitude — what compounds once foundations are in. e.g. 'We turn the audience already searching for your service in your area into inbound calls.'" },
    { "phase": "Phase 3 · Compound",    "timeline": "Days 90+",    "focus": "1–2 sentences at altitude — the long game. e.g. 'We turn the calls into a system that stays healthy without you touching it every week.'" }
  ],
  "nextStepHeadline": "One sentence framing the call in Solomon's voice — e.g. 'Want to see the specific playbook?'",
  "nextStepBody": "2 sentences from Solomon. Warm, direct. Invites the owner to book a 30-minute call with a real human on the CFO by Design team to walk through their specific playbook — the tactics, the sequence, the who-does-what. Include a human-first note: Solomon runs fast on tech, but the real work is a real person. Does NOT list any of the fixes here."
}

SCORECARD RULES:
- Each score is 0–10, whole numbers only.
- Scores must match the reality of the signals. If the internal audit would
  call something a 3, this version says 3 too — the language differs, the
  numbers do not.
- Every \`note\` must reference something the owner would recognize on their
  own digital presence.

FINDING VOLUME:
- Emit 3–5 problems (fewer is fine — an owner tunes out at more than 5).
- Emit 3 \`whatItLooksLike\` outcomes.
- Emit exactly 3 \`gamePlan\` phases as shown.
- NO quickWins. NO specific tactics. NO how-to. Those live on the call.

TONE (final):
- First person singular (Solomon). Warm. Direct. Quietly witty when the
  observation earns it. Never invents numbers, revenue, headcount, or facts
  not in the signals block. Never sales-copy adjectives. Never condescending.
  Human-first is not a slogan — it is a fact stated once and moved past.`;

const TIER_GUIDE = {
  free: `FREE BUSINESS HEALTH CHECK

PURPOSE

Answer one question:
"What signals should I pay attention to?"

This is a real diagnostic first look, not a generic lead-magnet summary.

Identify the strongest patterns the intake actually supports and explain
them with Miguel Hernandez's financial point of view: direct, specific,
plainspoken, and focused on the next decision.

TIER PROGRESSION

Each tier builds on the prior tier without repeating it:
- Free: notice the tension.
- $47 Full Diagnostic: understand what the numbers mean together.
- Included 30-minute strategist review: test and clarify.
- $297 Business Growth Analysis: decide what to do and in what order.
- Services: help execute.

The free Health Check must notice, not complete the deeper diagnosis.

MEMORABLE THESIS

The owner should be able to summarize the Health Check in one sentence.
Connect one real strength or asset, one meaningful financial or operating
tension, and — when relevant — the important decision in front of the
owner. The thesis must be specific to this business and must not read
like generic financial advice.

SECTION ROLE / NON-REPETITION

Each section of the rendered free report has a different job:
- Financial Health Snapshot: SHORT SUMMARY only — a one-liner tag per
  slot, not a full paragraph. 10-20 words per slot is a good ceiling.
- What Deserves Your Attention: deeper diagnosis — explain what the
  evidence says, why it matters, and what decision it affects.
- Highest-Impact Opportunities: leverage + economic mechanism — explain
  why it is credible and the specific lever (revenue capture, margin,
  cash timing, concentration, recurring revenue, cost, decision
  quality). Not just a restated summary.
- Contextual Insight: a memorable connection the owner may not have
  made themselves — titled "The tension," "What I'd watch," "That
  number means," or "The question I wouldn't ignore." Connects 1-2
  answers in a way distinct from the Attention/Opportunity cards.
- The Gap: the one personalized unresolved CFO question that becomes
  the bridge to the $47 Full Diagnostic.

HARD RULE — NO VERBATIM REPETITION:

The same underlying issue MAY appear in more than one section, but the
PARAGRAPH MUST BE DIFFERENT. If the Snapshot's "Needs Attention" tag
reads one way, the full "What Deserves Your Attention" card must say
something more. Same for Snapshot "Watch" vs the second gap, and
Snapshot "Opportunity" vs "Highest-Impact Opportunities."

The Snapshot is a scan-friendly label. The detailed section adds the
diagnosis the owner cannot see from the Snapshot alone. Reusing the
same sentences across both is a bug — a reader notices immediately and
loses trust.

Q9 "20% MORE PROFIT" DISCIPLINE

Q9 asks what MORE profit would unlock. It establishes the owner's
priorities and intent, not a measurable target. Do NOT treat 20% as
achievable, recoverable, or already in the business. Do NOT claim a
specific finding (change-order leakage, cost cuts, pricing moves) will
"get the owner to 20%." The arithmetic is not supported by the free
intake.

Good: "Quantify the change-order leakage so you know how much profit
and cash may currently be getting missed."

Bad: "Whether recovering it gets you to the 20% margin improvement you
described."

FREE-TIER SUPPORTABILITY DISCIPLINE

The free Health Check may identify an opportunity, a demand signal, or
a credible growth avenue. It may NOT conclude that the business can
financially support any expansion, hire, or capital move. Use:

- "credible expansion opportunity"
- "real demand signal in [city]"
- "worth testing"

Not:

- "well-positioned to expand"
- "the constraint is not demand or model fit" (unless model fit is
  separately established — the free intake usually cannot do this)
- "ready to add [person/location/line]"

PROFITABILITY LANGUAGE DISCIPLINE

The free intake does not establish current profitability. Do NOT
reference "current profitability," "margin health," "today's margins,"
or similar as if they are known.

Good: "whether the debt burden, cash capacity, and existing operation
can support..."

Bad: "whether the debt picture and current profitability can support..."

If profitability feels like the right frame, name what remains unknown
and route the question to the $47 Full Diagnostic.

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

HARD RULES on what the insight may claim:

- Must not assert anything the free intake has not established. "You may
  not need to wait for market conditions or debt resolution to unlock
  hiring capacity" is overreach — the Health Check cannot know that.
- Must not imply debt needs "resolution" merely because it is managed or
  stretched. Managed debt is not distress.
- Must stay in the role of SETTING UP a conversation, not FINISHING it.

Good: "The tension: You said more profit would let you hire before
expanding into Savannah, and you also identified change orders as your
biggest revenue leak. Those answers belong in the same conversation.
Before assuming more sales or more borrowing are required, quantify how
much current work is being under-billed or billed late."

Omit the contextualInsight field entirely when no meaningful connection
is supported. Never emit an empty title or body.

FINDINGS

- Emit AT MOST 2–3 gaps.
- Prefer fewer high-confidence findings over filling all three slots.
- Sort findings in the order Miguel would address or clarify them.
- Severity and action order are different. Multiple findings may honestly
  share the same severity.
- Every finding must trace to explicit intake evidence, a deterministic
  fact, a deterministic metric, or an approved rubric interpretation.
- Use the owner's own language and numbers where it strengthens recognition.
- Use business type, customer reach, industry, debt status, and financial
  decision basis as CONTEXT even when those answers do not deserve their
  own finding.
- Do not force every intake answer into the report.

STRENGTH

Identify at least ONE genuine strength, asset, or working capability when
the intake supports one.

For the free Health Check, Q6/Q7-style evidence about what clients value
and how they describe the business can be especially useful when it is
specific.

A strength is evidence, not flattery.

When a supported strength exists, return a non-empty strength title and
explanation. Never render an empty Strength card. If no meaningful
strength is supported, omit the card rather than fabricating one.

OPPORTUNITIES

Identify up to 2 meaningful opportunities backed by the intake.

Solomon may connect multiple answers when they point to a coherent pattern.

Tie each opportunity to an economic mechanism:
revenue capture, margin, cash timing, capacity, concentration, recurring
revenue, cost, or decision quality.

Use an actual dollar amount or percentage only when the intake or
deterministic metrics provide it.

Never invent the financial result of a recommendation.

FINANCIAL VISIBILITY / DECISION BASIS

Miguel's bank-balance question is a core diagnostic lens.

If the owner relies on bank balance, is somewhere in between, or is
unsure, connect that answer to the actual business decision in front of
them and explain what the bank balance alone cannot show. Use the
owner's actual answer; do not infer stale books, missing KPIs, poor cash
flow, or inaccurate financials unless the intake separately establishes
those facts.

If the owner consistently uses current financial information, recognize
that as a genuine strength when supported — do not manufacture a
visibility gap where none exists.

Positioning phrases Solomon may use when decision-basis evidence
supports them:
- "A bank balance is a snapshot, not a decision system."
- "Cash flow is not profit."
- "Good decisions require the right numbers connected to the right
  decision."

Use these naturally; do not repeat them mechanically.

DEBT

Never conflate business debt, tax debt, judgments, liens, delinquency, or
managed credit.

Managed debt in good standing is not distress.

If debt exists but the free Health Check does not contain total debt
balance and monthly debt service, say what cannot yet be determined.
That is an information gap, not a negative verdict.

ACTION

Include ONE concrete action the owner can take now without purchasing
anything.

OWNER-LEVEL STANDARD — this is the single most important rule for the
free action. The free action must not feel like a small clerical task.
It must be an owner-level action that creates:

- ONE useful number,
- ONE useful comparison,
- OR ONE clearer decision view.

The action should help the owner see the business differently before
purchasing anything. A good free action may:

- quantify a known leak,
- put two or three relevant numbers side by side,
- establish a baseline,
- identify what is competing for cash,
- or clarify what needs to be known before a major decision.

The action should still STOP before full diagnosis, affordability
analysis, forecasting, or a complete remediation plan.

Shape only, generated from THIS owner's strongest signal and real
next decision — not hardcoded, not reused verbatim:

Weaker (clerical, do not emit):
  "Audit three projects for missed change orders."

Stronger (owner-level, decision-shaping):
  "Put the next growth decision on one page by listing the current
  monthly obligation, the cost of the planned move, and the amount
  of cash or revenue currently tied up in the issue Solomon
  identified."

The goal is for the owner to think: "That is something meaningful I
can do today, and now I understand why the next analysis matters."

Do NOT default to small clerical or administrative tasks
("categorize uncategorized transactions," "log one month of
write-offs by cause code," "label last week's deposits," "clean up
your contacts list," "update your invoice template," "audit three
projects for missed change orders"). Those tasks do bookkeeping or
data-entry work, not decision work, and they do not change what the
owner can SEE about the business.

The action must still be:
- specific (one named step, not a category),
- usable now (owner can start today without new tools or vendors),
- tied to the #1 signal (the first-ranked finding),
- valuable without purchasing anything,
- not a complete remediation plan.

The free action is required when a supported first-ranked signal exists;
the renderer surfaces it as "One Move You Can Make Now."

INDUSTRY CATEGORY vs INDUSTRY / VERTICAL

Industry Category (broad classification: Healthcare, Manufacturing,
Professional Services, etc.) and Industry / Vertical (owner's specific
description: "Dental Practice," "Commercial Painting," "Catering") are
complementary signals, not duplicates.

Use the SPECIFIC industry when personalizing the report (findings,
opener, strength, oneMove, theGap — anything the owner reads).

Use the BROAD category as supporting context (benchmarks, cost-
structure framing, peer references).

Do not replace a specific industry such as "Dental Practice" with only
the broader label "Healthcare." When only the broad category is present,
say what remains unknown rather than inventing a specific vertical.

THE GAP / NEXT CFO QUESTION

The free report must END with ONE personalized unresolved CFO question
that the Health Check cannot responsibly answer with the current data.

BUILD the question from this specific owner's answers — do not hardcode
or imitate a single example. Combine three ingredients:

1. the real decision or next move the owner is considering (from their
   answers — a planned hire, expansion, equipment buy, growth move,
   capital raise, etc.);
2. the financial constraint or unknown that matters most (from their
   answers — current debt load, cash position, concentration risk,
   revenue leak, visibility gap, etc.);
3. the consequence Solomon cannot responsibly determine from the free
   intake alone (whether the move is supportable, whether a signal is
   actually the constraint, whether timing works, etc.).

Example patterns (shape only — never reuse the sentences themselves):

- "Can [the business] support [next move] while carrying [current
  financial constraint] without creating too much pressure on cash?"
- "Is [financial issue] actually constraining the business, or is
  another factor driving the problem?"
- "Can the owner afford [hire / expansion / equipment / growth move]
  based on the financial picture behind the current bank balance?"
- "Is [growth opportunity] financially supportable at the timing the
  owner wants?"
- "What would need to be true financially before [next move] becomes a
  sound decision?"

The wording MUST be specific to the owner's answers. The question
should make the owner think: "That is exactly what I need to know
next."

Then state in this order under the question:
1. What the Health Check already established (one sentence — specific
   to this business).
2. What remains unknown (one sentence — concrete, not categorical).
3. Why that unknown matters to the real decision in front of the owner.
4. What the $47 Full Diagnostic will investigate (one sentence — the
   specific questions, not a category list).

HARD RULES:

- Do NOT reuse the same question template mechanically. Build the
  question fresh each time from this owner's actual decision and
  constraint.
- Do NOT invent a decision the owner did not mention. If the intake
  does not name a next move, root the question in a tension the owner
  did name (concentration risk, leak, visibility, etc.).
- Do NOT open or lead with any generic list of cash flow, debt,
  profitability, receivables, visibility, or growth-capacity
  categories. The owner should feel the question is about THEIR
  situation.
- Do NOT manufacture uncertainty to create an upsell.
- Do NOT use a generic question like "How healthy is your business?"
- The question must be answerable with the data the $47 Full
  Diagnostic actually collects (debt detail, A/R aging, cash flow,
  close cadence, margin by segment, etc.). Do not promise answers the
  paid tier cannot deliver.

BOUNDARY

The free Health Check identifies signals and patterns.

It does not claim to have completed the financial diagnosis when the data
needed to establish root cause or magnitude is missing.

The $47 Full Diagnostic is the next step for connecting cash flow, debt,
profitability, receivables, financial visibility, and growth capacity and
determining what deserves action first.

Do not offer the free lead a paid-tier strategist consultation as though it
is included at the free level.

STYLE

- Sound like Miguel's financial point of view without pretending Miguel
  personally reviewed the business.
- Direct beats cautious consultant language.
- Specific beats abstract.
- One clear idea per paragraph.
- No generic AI filler.
- No em dashes.
- No invented financial impact.
- No unsupported crisis language.
- No digital presence / GBP / reviews / SEO as a free-tier primary finding.
- Do not weaken a supported conclusion just to sound safer.

PRODUCT NAMING (enforced in every customer-facing string)

- "Business Health Check" — never "Business Health Report" or
  "Business Health Analysis."
- "$47 Full Diagnostic" — never "Full Diagnosis," "$47 report," or
  "$47 diagnostic report."
- "30-minute strategist review" or "included strategist review" —
  never "strategy session," "consultation," or "Deep Dive."
- "$297 Business Growth Analysis" — never "Business Growth Plan" or
  "BGA report" in customer-facing copy.
- "Solomon" (the engine) and "Miguel" (the strategist) remain their
  own names. Never fuse into one entity.

FREE HEALTH CHECK COMPLETENESS CONTRACT

All 11 current free-tier questions (Q1-Q11) are required in the
customer-facing Business Health Check.

Q1-Q5 are structured/select questions:
- A valid offered option is a complete answer.
- Do not treat a short slug, "Yes", "No", "Not sure", or another valid
  option as incomplete merely because it is one word.
- Never require narrative elaboration for a structured-select answer.

Q6-Q11 are narrative questions:
- A meaningful response is required.
- Blank responses are incomplete.
- Obvious filler is incomplete:
  "idk", "n/a", "-", "?", "test", "asdf", "xxxx", or equivalent.
- A single generic word that does not actually answer the question is
  incomplete.
- Do not require polished prose or a long paragraph.

Truthful uncertainty or non-applicability is a VALID response when it
actually answers the question, for example:
- "Not sure yet."
- "We don't get many referrals yet."
- "I don't see a clear opportunity right now."
- "We don't have one dominant client."
- "No clear answer yet."

Do not penalize the owner for honestly saying they do not know.
Do not invent information to replace uncertainty.

For a current completed free-tier submission, Solomon should normally
receive a valid answer for every Q1-Q11 field.

If a required answer is still missing because of an old submission,
API bypass, malformed request, or historical record, use the existing
INCOMPLETE INTAKE rules rather than fabricating an answer.

Customer-facing classification may ONLY be:
growth, needs-attention, or rehab.`,

  paid_47: `$47 FULL DIAGNOSTIC (tierGuideVersion: paid47-2.0)

PURPOSE

Go beyond identifying individual signals and synthesize the financial
picture supported by the assessment. Answer: what is actually
happening, how significant is it, how do the issues interact, and
what deserves attention first? This is deeper diagnosis than the free
Business Health Check, but it is not the Business Growth Analysis and
not a complete implementation roadmap.

TIER PROGRESSION

Each tier builds on the prior tier without repeating it:
- Free: notices the tension.
- $47 Full Diagnostic (this tier): explains what the numbers mean
  together — WHAT THE NUMBERS ARE TELLING US. Explain how significant
  the issue appears, what it interacts with, what is known, what
  remains unknown, and what decision it affects. Use deterministic
  math when available. Do not make $47 feel like a longer version of
  free.
- Included 30-minute strategist review: tests and clarifies.
- $297 Business Growth Analysis: decides what to do and in what order.

SINGLE CROSS-FINDING SYNTHESIS

The customer-facing cross-finding synthesis lives in exactly ONE
section: connections[]. Populate connections[] with the "what the
numbers are telling us together" synthesis — the interactions no
single gap captures. The renderer presents connections[] under a
"What the Numbers Are Telling Us · How these findings interact"
heading. Do NOT duplicate that synthesis prose inside gaps[]; the
discipline is enforced in SECTION ROLE below.

VERSION TAGS (MANDATORY)

Emit at top level, verbatim:
- reportSchemaVersion: "paid47-v2"
- tierGuideVersion:    "paid47-2.0"
Missing or other values downgrade to the legacy renderer.

OUTPUT CONTRACT

Beyond path/badge/headline/opener/context/nextStepHeadline/nextStepBody:

- financialSnapshot[] — hard numbers only (customer_answer |
  deterministic_fact | derived_metric). Do not estimate.
- gaps[] — up to 3 primary gaps. Each: id, title, priority, evidence,
  known, diagnosis, whyItMatters, unknown, decisionImplication,
  relatedFindingIds. Do not manufacture a third gap simply to hit the
  count; return fewer and name the shortfall in coverage.
- opportunities[] — up to 2. Each: id, title, evidence, whyCredible,
  economicMechanism, whatMustBeTrue, nextValidation. Dollar amounts
  only when facts support them. Do not invent ROI.
- connections[] — cross-finding synthesis. Each: title, findingIds,
  explanation. Synthesis names interactions no single gap captures.
  If none supported, emit [] with coverage.connectionStatus
  "no_material_connection_supported" + noConnectionReason.
- questionsToClarify[] — questions that could change the priority
  order, interpretation, magnitude, or next decision. Not generic
  discovery.
- decisionOrder[] — 2-4 numbered steps grounded in immediacy,
  financial consequence, dependency, and decision impact.
- coverage{} — self-reported counts + connectionStatus. The response
  quality gate reads this; counts that don't match the actual arrays
  are rejected.

EVIDENCE RULES

Every gap and opportunity MUST have ≥1 evidence entry. Each entry:
- type: "answer" | "derived_metric" | "opportunity_flag" | "deterministic_fact"
- key:  exact FACTS key, DERIVED METRICS metric name, or opportunity-
        flag name.

A primary gap whose ONLY evidence is of type "opportunity_flag" is rejected.
An opportunity flag may support a gap but cannot be the sole anchor — this
is the Marisol discipline: a merchant-processing flag is a hint toward an
opportunity, not a primary diagnostic. An evidence key not in FACTS /
DERIVED METRICS / opportunityFlags is rejected as unfounded.

PRIORITY ORDER

Severity and priority order are different. Multiple findings may honestly
carry the same severity. The first gap is the one Miguel would start with.
Order by immediacy, financial consequence, dependency, and decision impact
— the same logic as decisionOrder[].

SYNTHESIS

Do not analyze each answer in isolation. Evaluate how the supported signals
interact: cash flow, debt + service, margins, A/R, revenue concentration,
revenue leakage, financial visibility, reporting discipline, operating
runway, growth capital, growth capacity. Record interactions in
connections[] with findingIds, NOT by duplicating prose inside gaps[]. Do
not invent causal relationships.

FINANCIAL IMPACT

Use real numbers when the owner supplied them or FACTS / DERIVED
METRICS provide them. Quantify ONLY when evidence supports the
number. When magnitude cannot be established: explain the exposure,
name the missing number, and put the magnitude question into
questionsToClarify[]. Do not convert a hypothetical into a proven
result.

FINANCIAL VISIBILITY

Miguel's bank-balance question is a core signal. When the owner says
decisions come from bank balance, somewhere in between, or they are
unsure, connect it to the other signals. Do not assume stale books,
poor cash flow, missing KPIs, or inaccurate statements unless another
answer establishes those facts.

MIGUEL'S DECISION-BASIS LENS

The owner's answer to the financial decision-making question is a core
context signal across the Full Diagnostic. When the owner says decisions
are based primarily on bank balance, "somewhere in between," or they are
unsure:

- connect that answer to the specific financial decision in front of
  them;
- explain which obligations, timing issues, or operating facts the bank
  balance alone cannot show;
- use the other diagnostic evidence to make the explanation specific.

Do not repeat generic bank-balance copy mechanically.

Example: "You have six weeks of cash runway, $4,100 in monthly debt
service, aging insurance receivables, and a six-figure expansion
requirement. That is exactly why the Oak Ridge decision has to be made
from more than the current bank balance."

When the owner reports a strong numbers-based decision process,
recognize that as a strength rather than manufacturing a visibility gap.

Positioning phrases Solomon may use when decision-basis evidence
supports them: "A bank balance is a snapshot, not a decision system."
"Cash flow is not profit." "Before you make the next move, make sure
the numbers can carry it."

Consider surfacing the decision basis in financialSnapshot[] when the
answer is informative, with sourceType "customer_answer":
- label "Decision basis", value "Somewhere between financials and bank
  balance" (adapt to the owner's exact answer).

MECHANISM DISCIPLINE

Do not conflate three distinct financial mechanisms when selecting the
primary gaps:

- Aged A/R → cash conversion / working capital timing.
- Insurance or claim write-offs → revenue leakage (billed but not
  collected).
- Merchant-processing fees + vendor costs (lab, supply) → cost control.
  Opportunity until actual overpayment is established, not confirmed
  leakage.

Bundling all three into one "margin leakage" gap muddies the diagnosis
and the Order of Attention. If two or more of these interact, name the
interaction in connections[] rather than fusing them into a single gap.

MERCHANT PROCESSING

Treat merchant-processing exposure as a cost-control opportunity, not
confirmed leakage, unless the intake establishes an actual rate
comparison or an explicitly stated overpayment. When processing volume
is substantial but the owner has not reviewed pricing, surface it as a
secondary cost-control / validation item ("At roughly $X in reported
card volume, processing costs are worth quantifying. The current
assessment does not establish that the practice is overpaying, so treat
this as a cost-control review rather than confirmed leakage.") rather
than forcing it to displace stronger opportunities grounded in revenue
capture or recurring revenue.

INDUSTRY CATEGORY vs INDUSTRY / VERTICAL

Industry Category (broad: Healthcare, Manufacturing, Professional
Services, etc.) is supporting context. Industry / Vertical (specific:
"Dental Practice," "Commercial Painting," "Catering") is what the
owner recognizes as their own business. Use the specific vertical in
personalizing prose; use the broad category as context (benchmarks,
cost structure, peer framing). Never replace "Dental Practice" with
only "Healthcare." When only the broad category is present, say what
remains unknown rather than inventing a vertical.

LOCATION-COUNT DISCIPLINE

Never infer first / second / third / fourth location from incomplete
context. When the intake does not state the number of existing
locations, say "the Oak Ridge expansion" or "the planned Oak Ridge
location" rather than "a second location." Count-of-locations is a
client fact; if the intake does not supply it, it stays unknown and
belongs in questionsToClarify[].

ILLUSTRATIVE NUMBERS

Illustrative examples are allowed when clearly labeled as illustrations
("If gross billings were $1.5M, a 4% write-off rate would equal
$60,000") in questionsToClarify[] or whyItMatters prose. Rules:

- cannot become a client fact;
- cannot drive severity;
- cannot enter financialSnapshot[] as an actual value;
- cannot become a derived metric;
- cannot be reused later in the report as though the client supplied it.

Unknown client facts must remain unknown.

DEBT

Follow debt-subtype discipline. Never conflate managed business debt,
revolving credit, tax debt, judgments/liens, delinquent debt, or
unknown debt. Total corporate debt and monthly debt service go in
financialSnapshot[] with sourceType "customer_answer" or
"deterministic_fact". Do not use debt existence alone as evidence of
distress.

FULL DIAGNOSTIC BOUNDARY

Do: connect signals, explain interactions, rank what matters,
identify meaningful opportunities, name what remains unresolved, give
the owner a clearer basis for the next decision.

Do NOT: pretend verified financial documents were reviewed when they
were not; produce the full 90-day / 6-month / 12-month Business
Growth Plan; present CFO By Design fractional-service recommendations
as though the BGA process has already happened; skip the human
strategist review.

NEXT STEP

Primary next step is the INCLUDED 30-minute CFO By Design strategist
review. nextStepHeadline and nextStepBody must point to it, not the
Business Growth Analysis purchase. Do not make the Business Growth
Analysis purchase the primary CTA inside the Full Diagnostic report.

VOICE

Inherit the Miguel voice from ASSESSMENT_RUBRIC. Direct, specific,
numbers-first, plainspoken, confident when evidence is clear, explicit
when something remains unknown. Do not soften, do not overstate.

Customer-facing classification may ONLY be:
growth, needs-attention, or rehab.`,

  paid_297: `$297 BUSINESS GROWTH ANALYSIS (BGA): senior-level strategic analysis that turns the Full Diagnostic into a prioritized 90-day growth plan.

Use the owner's complete narrative, verified facts, and deterministic metrics to connect the financial findings to growth decisions, capital needs, operating constraints, and execution priorities.

This tier should go beyond diagnosis. It should clarify:
- what deserves action first,
- why it matters now,
- what the owner should accomplish over the next 90 days,
- what still requires strategist judgment.

Do not manufacture financial impact, distress, or certainty unsupported by the evidence.

Customer-facing classification may ONLY be: growth, needs-attention, or rehab.`,
};

function buildPrompt(tier, answers, contact, businessProfile = {}, factsBundle = null) {
  const answerBlock = answers
    .map((a) => `- ${a.question}\n  Answer: ${a.answer}`)
    .join("\n");
  const guide = TIER_GUIDE[tier] || TIER_GUIDE.free;

  // Optional business profile (sent at $47 + $297 tiers from the GHL survey
  // business-info section). Only emit lines that have real values.
  const profileLines = [
    businessProfile.businessName  && `Business: ${businessProfile.businessName}`,
    businessProfile.industry      && `Industry: ${businessProfile.industry}`,
    businessProfile.website       && `Website: ${businessProfile.website}`,
    [businessProfile.city, businessProfile.state, businessProfile.country]
      .filter(Boolean).join(", "),
    // Trailing 12-month revenue — collected in the paid_47 Business
    // Info section (PR #128) and now forwarded here (Codex P2 fix).
    // Emitted as a concrete number Solomon can anchor every ratio
    // and report claim on; empty when the buyer skipped the field,
    // and the line is suppressed in that case by the filter below.
    businessProfile.annualRevenue && `Trailing 12-month revenue: ${businessProfile.annualRevenue}`,
  ].filter(Boolean);
  const profileBlock = profileLines.length
    ? `\nBUSINESS PROFILE:\n${profileLines.join("\n")}\n`
    : "";

  // Phase 2C: inject the deterministic FACTS and DERIVED METRICS the
  // model should cite verbatim in its structured_findings output. Only
  // emit the sections when the caller computed them (webhook path);
  // console runs that didn't normalize pass null and the sections are
  // omitted — the model falls back to its existing prose-only behavior.
  // Code — not the model — did the math. The model's job is to interpret.
  let factsBlock = "";
  if (factsBundle && (Object.keys(factsBundle.facts || {}).length || (factsBundle.derived_metrics || []).length)) {
    const factsJson = JSON.stringify(factsBundle.facts || {}, null, 2);
    const metricsJson = JSON.stringify(factsBundle.derived_metrics || [], null, 2);
    factsBlock = `
## FACTS (deterministic — computed from their intake answers)

These are the typed values the normalizer produced from their answers.
When a structured_findings entry cites an intake field, use ONLY a key
from this object as evidence.field. Do NOT invent a key.

${factsJson}

## DERIVED METRICS (deterministic — do NOT recompute)

These ratios and dollar passthroughs were computed in code from the
FACTS above. When a structured_findings entry cites a ratio, use ONLY
a metric name from this list as derived_metrics.metric, with the same
value. Do NOT invent a metric. Do NOT reinvent the math.

${metricsJson}
`;
  }

  // NOTE: ASSESSMENT_RUBRIC is sent in the Anthropic `system` block (with cache_control),
  // NOT inlined here. Keep this user-message dynamic-only so cache hits land.
  return `CLIENT: ${contact.name || "Business Owner"}${profileBlock}
TIER: ${tier}

THEIR ANSWERS:
${answerBlock}
${factsBlock}
TASK: Assess this business using the methodology in your system instructions. ${guide}
Every sentence must reference THEIR actual answers — no generic filler, no invented numbers.

JSON ESCAPING (strict — your output is parsed by JSON.parse):
- THEIR ANSWERS above may contain double-quote characters (owners often
  paste customer quotes verbatim, especially in Q7 "referral language"
  and Q6 "unique value proposition"). When you quote or echo any of
  their text inside a JSON string value in your response, every inner
  double-quote MUST be escaped as \\" and every newline as \\n. Example:
  if they wrote: They said "trust us" to me
  you emit:     "opener": "...they said \\"trust us\\" to me..."
- Do not emit raw unescaped quotes inside string values. Do not emit
  trailing commas. Do not wrap the response in markdown code fences.

${tier === "paid_47" ? `
Return ONLY valid JSON — no markdown code fences, no text before or after — in exactly this shape:
{
  "reportSchemaVersion": "paid47-v2",
  "tierGuideVersion": "paid47-2.0",
  "path": "rehab | needs-attention | growth",
  "badge": "SHORT UPPERCASE LABEL",
  "headline": "one bold sentence naming their reality",
  "opener": "2-3 sentences describing their actual situation (this is the personalized hook used in their delivery email — write it so it could stand alone as the first paragraph of a message TO them)",
  "context": "one sentence of perspective",
  "financialSnapshot": [
    { "label": "Trailing 12-month revenue", "value": "$420,000", "meaning": "optional one-sentence meaning", "sourceType": "customer_answer | deterministic_fact | derived_metric" }
  ],
  "gaps": [
    {
      "id": "kebab-case-stable-slug",
      "title": "short, owner-recognizable",
      "priority": "CRITICAL | HIGH | MEDIUM",
      "evidence": [
        { "type": "answer | derived_metric | opportunity_flag | deterministic_fact", "key": "<key from FACTS, DERIVED METRICS, or known opportunityFlags>" }
      ],
      "known": "one sentence stating what the evidence proves",
      "diagnosis": "one or two sentences in Miguel's voice — the internal explanation; direct, numbers-first",
      "whyItMatters": "one sentence of economic consequence",
      "unknown": "one sentence naming what the intake cannot establish; 'none' only when fully proven",
      "decisionImplication": "one sentence tying the finding to the owner's next decision",
      "relatedFindingIds": ["other-gap-id"]
    }
  ],
  "opportunities": [
    {
      "id": "kebab-case-stable-slug",
      "title": "short",
      "evidence": [
        { "type": "answer | derived_metric | opportunity_flag | deterministic_fact", "key": "<key>" }
      ],
      "whyCredible": "one sentence tying to a specific answer or deterministic fact",
      "economicMechanism": "revenue capture | margin protection | cash timing | recurring revenue | reduced concentration | cost control | capital readiness | capacity use | financial decision-making",
      "whatMustBeTrue": "one sentence of the premise the owner must validate",
      "nextValidation": "one sentence naming the single data point or action that would confirm or kill it"
    }
  ],
  "connections": [
    { "title": "short phrase naming the interaction", "findingIds": ["gap-id-a", "gap-id-b"], "explanation": "one or two sentences on what the interaction means financially" }
  ],
  "questionsToClarify": [
    { "question": "the question", "whyItMatters": "which decision or finding this unblocks" }
  ],
  "decisionOrder": [
    { "step": 1, "action": "short sentence", "whyNow": "one sentence on why first" }
  ],
  "coverage": {
    "gapsRequested": 3,
    "gapsReturned": 3,
    "gapsShortfallReason": null,
    "opportunitiesRequested": 2,
    "opportunitiesReturned": 2,
    "opportunitiesShortfallReason": null,
    "connectionStatus": "identified | no_material_connection_supported",
    "noConnectionReason": null
  },
  "nextStepHeadline": "short — point to the included 30-minute strategist review",
  "nextStepBody": "2-3 sentences preparing the owner for the strategist review (NOT the $297 BGA purchase)",
  "opportunityFlags": ["MERCHANT_PROCESSING_OPP"],
  "strategistBrief": "INTERNAL-ONLY brief for the CFO consultant — NEVER shown to the client. The strategist brief is not customer-facing copy. Clearly distinguish what is known, what is inferred, what must be verified, and what the strategist should probe on the call. Explicitly warn the strategist against conclusions the available evidence does not support. Surface contradictions, missing context, and the likely first priority. Cover: (1) why this lead got their path verdict — which specific signals in their answers triggered it; (2) the top 2 upsell angles based on the opportunity flags fired and what's underneath their answers; (3) a single suggested opener question the consultant should use to open the strategy call; (4) WHAT TO PROBE — unresolved questions, contradictions in the intake, assumptions the strategist should NOT make, and specifics that must be verified before recommending action. Write in consultant-to-consultant voice — direct, no fluff. Where incomplete intake fields block confident assessment, name them here.",
  "structured_findings": [
    {
      "finding_id": "kebab-case-stable-slug",
      "category": "cash_flow | debt | revenue | visibility | team | other",
      "severity": "low | medium | high",
      "evidence": [
        { "field": "<question_key from FACTS>", "value": "<the matching value>" }
      ],
      "derived_metrics": [
        { "metric": "<metric name from DERIVED METRICS>", "value": "<the matching value>" }
      ],
      "interpretation": "one-line what this means for the business",
      "recommendation": "one-line what to investigate or do"
    }
  ]
}

PAID_47 V2 EMISSION RULES (strict — enforced by the response quality gate):
- Emit reportSchemaVersion EXACTLY "paid47-v2" and tierGuideVersion
  EXACTLY "paid47-2.0". Other values downgrade the response.
- Every gap and every opportunity MUST have an id (stable kebab-case
  slug) and at least one evidence[] entry.
- A primary gap whose ONLY evidence[].type is "opportunity_flag" is
  rejected. An opportunity flag can support a gap but cannot be its
  sole anchor.
- Every evidence[].key must appear in FACTS, DERIVED METRICS, or the
  known opportunity-flag set — do NOT invent keys.
- connections[].findingIds must reference ids that appear in gaps[]
  or opportunities[].
- coverage[].connectionStatus === "no_material_connection_supported"
  requires a non-empty noConnectionReason; connections[] MUST be
  empty in that case.
- coverage{} counts must match the actual array lengths you return.
- financialSnapshot[] rows must each cite a sourceType; do not estimate.
` : `
Return ONLY valid JSON — no markdown code fences, no text before or after — in exactly this shape:
{
  "path": "rehab | needs-attention | growth",
  "badge": "SHORT UPPERCASE LABEL",
  "headline": "one bold sentence naming their reality",
  "opener": "2-3 sentences describing their actual situation (this is the personalized hook used in their delivery email — write it so it could stand alone as the first paragraph of a message TO them)",
  "context": "one sentence of perspective",
  "gaps": [
    { "title": "short", "impact": "the concrete cost/consequence", "priority": "CRITICAL | HIGH | MEDIUM" }
  ],
  "opportunities": [
    { "title": "short", "desc": "one sentence", "impact": "short tag, e.g. Unlock $250K+" }
  ],
  "strength": { "title": "short — the owner-recognizable asset or working capability", "desc": "one or two sentences grounded in Q6/Q7-style evidence. Omit the field entirely when no meaningful strength is supported — never emit an empty title or desc." },
  "contextualInsight": { "title": "short label — one of 'The tension' | 'What I'd watch' | 'That number means' | 'The question I wouldn't ignore' (choose the fit; do not force one)", "body": "one or two sentences that connect 1-2 specific answers in a way the owner may not have noticed themselves. Must be concrete to this business; must not restate a gap or opportunity verbatim; must not complete the deeper diagnosis — that is the $47 Full Diagnostic's job. Omit the field entirely when no meaningful connection is supported." },
  "oneMove": { "title": "short imperative — the One Move You Can Make Now", "desc": "one or two sentences; specific, usable now, tied to the #1 signal, valuable without purchasing, not a complete remediation plan" },
  "theGap": {
    "question": "the ONE personalized unresolved CFO question built from this owner's answers (see TIER_GUIDE 'THE GAP / NEXT CFO QUESTION' — shape only, never a hardcoded template). This is the headline the owner reads; the four fields below support it.",
    "known": "one sentence stating what the Health Check already established",
    "unknown": "one sentence stating what remains unknown",
    "whyItMatters": "one sentence stating why that unknown matters to a real decision in front of the owner",
    "whatPaidWillInvestigate": "one sentence stating what the $47 Full Diagnostic will investigate"
  },
  "nextStepHeadline": "short",
  "nextStepBody": "2-3 sentences leading to a strategy call",
  "opportunityFlags": ["MERCHANT_PROCESSING_OPP"],
  "strategistBrief": "INTERNAL-ONLY brief for the CFO consultant — NEVER shown to the client. The strategist brief is not customer-facing copy. Clearly distinguish what is known, what is inferred, what must be verified, and what the strategist should probe on the call. Explicitly warn the strategist against conclusions the available evidence does not support. Surface contradictions, missing context, and the likely first priority. Cover: (1) why this lead got their path verdict — which specific signals in their answers triggered it; (2) the top 2 upsell angles based on the opportunity flags fired and what's underneath their answers; (3) a single suggested opener question the consultant should use to open the strategy call; (4) WHAT TO PROBE — unresolved questions, contradictions in the intake, assumptions the strategist should NOT make, and specifics that must be verified before recommending action. Write in consultant-to-consultant voice — direct, no fluff. Where incomplete intake fields block confident assessment, name them here.",
  "structured_findings": [
    {
      "finding_id": "kebab-case-stable-slug",
      "category": "cash_flow | debt | revenue | visibility | team | other",
      "severity": "low | medium | high",
      "evidence": [
        { "field": "<question_key from FACTS>", "value": "<the matching value>" }
      ],
      "derived_metrics": [
        { "metric": "<metric name from DERIVED METRICS>", "value": "<the matching value>" }
      ],
      "interpretation": "one-line what this means for the business",
      "recommendation": "one-line what to investigate or do"
    }
  ]
}
`}

STRUCTURED FINDINGS RULES (strict — a finding that breaks any rule is
rejected before storage):
- Only populate structured_findings when FACTS or DERIVED METRICS are
  provided above. If both sections are absent, return an empty array
  (or omit the key entirely).
- Every evidence.field MUST be a key that appears in FACTS. Do NOT
  invent a key.
- Every derived_metrics.metric MUST be a name that appears in
  DERIVED METRICS. Do NOT invent a metric. Do NOT recompute a ratio
  the deterministic engine already produced.
- Every finding MUST have at least one evidence entry OR one
  derived_metric entry — a finding grounded in nothing is nothing.
- The existing gaps[] and opportunities[] arrays MUST still be
  populated as before. structured_findings is ADDITIONAL, not a
  replacement — the renderer continues to read the prose arrays.
`;
}

async function callClaude(prompt, env) {
  // Test-only escape hatch: when a stub is installed on env, deliver its
  // canned response instead of calling the real API. Prefixed with `__` to
  // signal "not production surface" and ignored unless a test explicitly
  // sets it. The stub receives the same (prompt, env) and must return the
  // raw text Claude would have returned (same shape callers already parse).
  if (typeof env?.__CLAUDE_STUB__ === "function") {
    return env.__CLAUDE_STUB__(prompt, env);
  }
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": CONFIG.ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 2500,
      system: [
        { type: "text", text: ASSESSMENT_RUBRIC, cache_control: { type: "ephemeral" } }
      ],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Claude API ${response.status}: ${detail.slice(0, 300)}`);
  }
  const data = await response.json();
  return data.content[0].text;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]
  ));
}

// ---------------------------------------------------------------------------
// Marketing / digital-presence audit — URL-only.
// ---------------------------------------------------------------------------

function normalizeAuditUrl(input) {
  if (!input) return null;
  let s = String(input).trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    return u.toString();
  } catch { return null; }
}

// Small regex helpers — we DON'T want to pull in a DOM parser in a Worker.
// These are best-effort extractors from raw HTML. Missing / weird markup returns null.
function extractTag(html, name) {
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i");
  const m = html.match(re);
  return m ? m[1].replace(/<[^>]+>/g, "").trim().slice(0, 300) : null;
}
function extractMeta(html, name) {
  // handles <meta name=... content=...> and <meta property=... content=...>
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=[\"']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\"'][^>]*content=[\"']([^\"']*)[\"']`,
    "i"
  );
  const m = html.match(re);
  if (m) return m[1].trim().slice(0, 500);
  // try reverse order (content first, then name/property)
  const re2 = new RegExp(
    `<meta[^>]+content=[\"']([^\"']*)[\"'][^>]*(?:name|property)=[\"']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\"']`,
    "i"
  );
  const m2 = html.match(re2);
  return m2 ? m2[1].trim().slice(0, 500) : null;
}
function extractAllTags(html, name, limit = 6) {
  const out = [];
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "gi");
  let m;
  while ((m = re.exec(html)) && out.length < limit) {
    const text = m[1].replace(/<[^>]+>/g, "").trim();
    if (text) out.push(text.slice(0, 200));
  }
  return out;
}
function extractJsonLdTypes(html) {
  const out = new Set();
  const re = /<script[^>]+type=[\"']application\/ld\+json[\"'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1]);
      const walk = (node) => {
        if (!node) return;
        if (Array.isArray(node)) return node.forEach(walk);
        if (typeof node === "object") {
          if (node["@type"]) {
            const t = node["@type"];
            if (Array.isArray(t)) t.forEach((x) => out.add(String(x)));
            else out.add(String(t));
          }
          if (node["@graph"]) walk(node["@graph"]);
        }
      };
      walk(parsed);
    } catch { /* malformed JSON-LD — skip */ }
  }
  return [...out];
}
function detectExternalLinks(html) {
  const links = new Set();
  const re = /href=[\"']([^\"']+)[\"']/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    if (/^(mailto:|tel:)/i.test(href)) { links.add(href.split("?")[0].slice(0, 80)); continue; }
    if (/^https?:\/\//i.test(href)) {
      const host = (href.match(/^https?:\/\/([^\/]+)/i) || [])[1] || "";
      if (/(facebook|instagram|linkedin|twitter|x\.com|tiktok|youtube|yelp|google\.com\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|g\.page|business\.google|calendly|acuityscheduling|leadconnectorhq|cfobydesign)/i.test(host)) {
        links.add(host.replace(/^www\./, ""));
      }
    }
  }
  return [...links].slice(0, 12);
}

// Detect key nav pages by scanning anchor hrefs on the homepage. Returns booleans for
// each of the standard pages a decent site has. Cheap — no additional fetches.
function detectNavPages(html) {
  const hrefs = (html.match(/href=[\"']([^\"']+)[\"']/gi) || [])
    .map((s) => (s.match(/href=[\"']([^\"']+)[\"']/i) || [])[1] || "")
    .filter(Boolean)
    .map((h) => h.toLowerCase());
  const has = (patterns) => patterns.some((p) => hrefs.some((h) => h.includes(p)));
  return {
    services: has(["/services", "/what-we-do", "/what-we-offer", "/solutions"]),
    contact: has(["/contact"]),
    about: has(["/about"]),
    pricing: has(["/pricing", "/plans"]),
    reviews: has(["/reviews", "/testimonials"]),
    gallery: has(["/gallery", "/portfolio", "/projects", "/before-after"]),
    blog: has(["/blog", "/news", "/insights", "/articles"]),
    faq: has(["/faq", "/faqs"]),
    locations: has(["/locations", "/service-area", "/service-areas", "/areas-we-serve"]),
    booking: has(["calendly", "acuityscheduling", "leadconnectorhq", "booking", "book-now", "schedule"]),
  };
}

// Trust/badge/review-platform signals on-page. Boolean map.
function detectTrustSignals(html) {
  const low = html.toLowerCase();
  return {
    bbb: /better business bureau|bbb\.org|bbb accredited/.test(low),
    trustpilot: /trustpilot/.test(low),
    google_guaranteed: /google guaranteed/.test(low),
    angi: /\bangi\b|angies list|angieslist|angie's list/.test(low),
    homeadvisor: /homeadvisor|home advisor/.test(low),
    thumbtack: /thumbtack/.test(low),
    houzz: /houzz/.test(low),
    nextdoor: /nextdoor/.test(low),
    yelp: /yelp/.test(low),
    google_reviews: /google reviews|google-reviews|reviews_widget|reviews-widget/.test(low),
    gbp_embed: /(maps\.google\.com\/(?:maps\/)?embed|www\.google\.com\/maps\/embed|g\.page|goo\.gl\/maps|maps\.app\.goo\.gl)/i.test(html),
    since_year: (html.match(/\b(?:since|established|est\.?|serving [\w\s]+ since)\s*(19|20)\d{2}\b/i) || [])[0] || null,
    license_mention: /\blicensed\b|\blicense\s?#|\bcertified\b|\baccredited\b|\bregistered\b/.test(low),
    guarantee_mention: /\bguarantee(?:d)?\b|\bwarranty\b|\bmoney[-\s]?back\b|\brisk[-\s]?free\b/.test(low),
    testimonial_word: /\btestimonial|\bclient stor|\bcase stud|\bwhat our|\bour clients say/i.test(html),
    star_rating: /★+|⭐+|5[-\s]?star|five[-\s]?star|4\.\d\s?stars?|5\.0\s?stars?/i.test(html),
  };
}

// Extract signals that need lightly-parsed content — address blocks, hours, favicon, etc.
function detectSiteDetails(html) {
  const strippedScripts = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  const strippedStyles = strippedScripts.replace(/<style[\s\S]*?<\/style>/gi, "");
  const text = strippedStyles.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  // Very rough US street address heuristic — a street number + street + city-state-zip nearby.
  const addressMatch = text.match(/\b\d{1,6}\s+[A-Z][A-Za-z0-9.,'\-\s]{3,60}\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/);
  return {
    faviconPresent: /<link[^>]+rel=[\"'](?:shortcut )?icon[\"']/i.test(html),
    hoursMention: /\bhours?\b|\bmon(?:day)?\s*[-–]\s*fri|open\s+\d|open now|closed/i.test(text.slice(0, 8000)),
    addressGuess: addressMatch ? addressMatch[0].slice(0, 120) : null,
    mixedContentRefs: (html.match(/\bhttp:\/\/[^"'\s>]+/gi) || []).filter((u) => !/\.(png|jpg|jpeg|gif|svg|webp|ico)\b/i.test(u)).length,
    phoneMatches: (html.match(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g) || []).slice(0, 5),
    emailMatches: (strippedScripts.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).slice(0, 5),
    ctaLabels: [
      ...new Set(
        (html.match(/<a[^>]*(?:class=[\"'][^\"']*(?:btn|button|cta)[^\"']*[\"'])[^>]*>([\s\S]{1,80}?)<\/a>/gi) || [])
          .map((s) => (s.match(/>([\s\S]{1,80}?)<\/a>/i) || [])[1] || "")
          .map((t) => t.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
          .filter((t) => t && t.length < 40)
      ),
    ].slice(0, 8),
    textLength: text.length,
  };
}

async function fetchSiteSignals(rawUrl) {
  const url = normalizeAuditUrl(rawUrl);
  if (!url) return { ok: false, error: "invalid_url" };
  const origin = new URL(url).origin;
  const signals = { url, origin, fetchedAt: new Date().toISOString() };
  // 1. homepage
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SolomonAudit/1.0; +https://cfobydesign.com)" },
      cf: { cacheTtl: 60 },
    });
    signals.status = res.status;
    signals.finalUrl = res.url;
    signals.redirected = res.redirected;
    signals.finalIsHttps = signals.finalUrl && signals.finalUrl.startsWith("https://");
    const html = (await res.text()).slice(0, 350_000); // cap
    signals.htmlBytes = html.length;
    signals.title = extractTag(html, "title");
    signals.titleLength = signals.title ? signals.title.length : 0;
    signals.metaDescription = extractMeta(html, "description");
    signals.metaDescriptionLength = signals.metaDescription ? signals.metaDescription.length : 0;
    signals.metaViewport = extractMeta(html, "viewport");
    signals.metaRobots = extractMeta(html, "robots");
    signals.canonical = (html.match(/<link[^>]+rel=[\"']canonical[\"'][^>]+href=[\"']([^\"']+)[\"']/i) || [])[1] || null;
    signals.ogTitle = extractMeta(html, "og:title");
    signals.ogDescription = extractMeta(html, "og:description");
    signals.ogImage = extractMeta(html, "og:image");
    signals.h1 = extractAllTags(html, "h1", 3);
    signals.h2Sample = extractAllTags(html, "h2", 5);
    signals.h3Sample = extractAllTags(html, "h3", 5);
    signals.jsonLdTypes = extractJsonLdTypes(html);
    signals.externalLinks = detectExternalLinks(html);
    signals.imgCount = (html.match(/<img[\s>]/gi) || []).length;
    signals.imgMissingAlt = (html.match(/<img(?![^>]*\balt=)[^>]*>/gi) || []).length;
    signals.formCount = (html.match(/<form[\s>]/gi) || []).length;
    signals.phoneVisible = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(html);
    signals.emailVisible = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(html.replace(/<script[\s\S]*?<\/script>/gi, ""));
    signals.scriptCount = (html.match(/<script[\s>]/gi) || []).length;
    signals.htmlIsJsShell = signals.htmlBytes > 0 && !signals.h1.length && signals.scriptCount > 8 && html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "").trim().length < 200;
    signals.navPages = detectNavPages(html);
    signals.trustSignals = detectTrustSignals(html);
    Object.assign(signals, detectSiteDetails(html));
  } catch (e) {
    signals.fetchError = String(e && e.message || e).slice(0, 200);
  }
  // 2. robots.txt
  try {
    const r = await fetch(origin + "/robots.txt", { redirect: "follow" });
    signals.robotsStatus = r.status;
    if (r.ok) {
      const body = (await r.text()).slice(0, 4000);
      signals.robotsHasSitemap = /^\s*sitemap:/im.test(body);
      signals.robotsExcerpt = body.split("\n").slice(0, 10).join("\n").slice(0, 500);
    }
  } catch { signals.robotsStatus = 0; }
  // 3. sitemap.xml probe
  try {
    const s = await fetch(origin + "/sitemap.xml", { redirect: "follow", method: "GET" });
    signals.sitemapStatus = s.status;
    if (s.ok) {
      const body = (await s.text()).slice(0, 4000);
      signals.sitemapUrlCount = (body.match(/<loc>/gi) || []).length;
    }
  } catch { signals.sitemapStatus = 0; }
  signals.ok = true;
  return signals;
}

// mode: "public" (default, client-facing) or "internal" (team-facing detail).
async function runMarketingAudit(rawUrl, env, mode = "public") {
  const signals = await fetchSiteSignals(rawUrl);
  if (signals.error === "invalid_url") {
    throw new Error("Invalid URL. Include a hostname, e.g. supremewindowstyler.com");
  }
  const rubric = mode === "internal" ? MARKETING_AUDIT_INTERNAL_RUBRIC : MARKETING_AUDIT_PUBLIC_RUBRIC;
  const prompt = `AUDIT TARGET: ${signals.url}

PUBLIC SIGNALS (scraped just now — this is the entire input):
${JSON.stringify(signals, null, 2)}

TASK: Write the marketing audit using the methodology in your system instructions.
Every finding must cite an exact signal above.
Return ONLY the JSON object described in the system instructions.`;
  const raw = await callClaudeWithSystem(prompt, rubric, env);
  // Strip accidental code fences.
  const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  let agent;
  try { agent = JSON.parse(cleaned); }
  catch (e) {
    throw new Error(`Audit model returned non-JSON: ${cleaned.slice(0, 300)}`);
  }
  return { agent, signals, mode };
}

// Generic system-prompt Claude call. callClaude() is pinned to ASSESSMENT_RUBRIC — this
// one takes any rubric so /audit can reuse the same client without touching the CFO path.
async function callClaudeWithSystem(prompt, systemText, env) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": CONFIG.ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 4000,
      system: [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Claude API ${response.status}: ${detail.slice(0, 300)}`);
  }
  const data = await response.json();
  return data.content[0].text;
}

// Shared CSS used by both audit modes (public + internal) and the streaming shell.
const AUDIT_PAGE_CSS = `
  :root {
    --bg:#0a0e14; --card:#12181f; --line:#1e2632;
    --ink:#f2ecdf; --ink-mute:#a8b0bd; --ink-dim:#6d7480;
    --gold:#d4b565; --gold-bright:#f2c94c; --green:#4ade80;
    --serif:'Playfair Display',Georgia,serif;
    --sans:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Helvetica,Arial,sans-serif;
    --mono:ui-monospace,'SF Mono',Menlo,Consolas,monospace;
    color-scheme: dark;
  }
  *,*::before,*::after { box-sizing:border-box; }
  html,body { margin:0; padding:0; }
  body { background:var(--bg); color:var(--ink); font-family:var(--sans); font-size:16px; line-height:1.6; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:920px; margin:0 auto; padding:0 24px; }
  .topbar { padding:24px 0; border-bottom:1px solid rgba(255,255,255,0.05); }
  .topbar .wrap { display:flex; align-items:center; justify-content:space-between; gap:20px; }
  .logo img { height:52px; width:auto; display:block; }
  .tier-chip { font-family:var(--mono); font-size:11px; letter-spacing:0.22em; text-transform:uppercase; color:var(--gold); }
  .hello { padding:40px 0 24px; text-align:center; }
  .hello .eyebrow { font-family:var(--mono); font-size:12px; letter-spacing:0.22em; text-transform:uppercase; color:var(--gold); margin:0 0 12px; }
  .hello h1 { font-family:var(--serif); font-weight:600; font-size:clamp(28px,4vw,42px); line-height:1.15; margin:0; }
  .hello h1 em { font-style:italic; color:var(--gold); font-weight:500; }
  .hello .target { margin:14px 0 0; font-family:var(--mono); font-size:12px; color:var(--ink-dim); letter-spacing:0.05em; }
  .hello .target a { color:var(--gold); text-decoration:none; }
  .report-card { background:#fafaf7; color:#1a1a1a; max-width:920px; margin:24px auto 0; padding:44px 40px; border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,0.35); border:1px solid rgba(212,181,101,0.15); }
  .report-card a { color:#92400e; }
  .badge { display:inline-block; padding:6px 14px; background:#fef3c7; color:#92400e; font-weight:700; font-size:11px; letter-spacing:2px; border-radius:999px; font-family:Arial,sans-serif; }
  .card-headline { font-family:Georgia,serif; font-size:26px; line-height:1.3; margin:20px 0 16px; color:#1a1a1a; font-weight:700; }
  .card-opener { font-family:Georgia,serif; font-size:17px; color:#374151; line-height:1.65; margin:0; }
  .context { font-family:Georgia,serif; font-style:italic; color:#6b7280; font-size:15px; line-height:1.6; margin:12px 0 0; }
  h2.section-h { font-family:Arial,sans-serif; font-size:13px; letter-spacing:2px; text-transform:uppercase; color:#92400e; border-bottom:1px solid #e5e7eb; padding-bottom:8px; margin:32px 0 16px; }
  .scorecard { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:10px; margin-top:8px; }
  .score-tile { padding:14px 12px; background:#fdf8f0; border-radius:6px; display:flex; flex-direction:column; gap:6px; min-height:130px; }
  .score-dim { font-family:Arial,sans-serif; font-size:10px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:#6b7280; line-height:1.3; }
  .score-num { font-family:Georgia,serif; font-size:34px; font-weight:700; line-height:1; }
  .score-num .score-of { font-size:14px; font-weight:400; color:#9ca3af; margin-left:2px; }
  .score-note { font-family:Georgia,serif; font-size:12px; color:#374151; line-height:1.4; margin-top:auto; }
  @media (max-width:720px) { .scorecard { grid-template-columns:repeat(2,minmax(0,1fr)); } }
  .finding { padding:14px 16px; background:#fdf8f0; border-radius:4px; margin-bottom:10px; }
  .finding-title { font-family:Georgia,serif; font-weight:700; font-size:16px; color:#1a1a1a; }
  .finding .pri { font-family:Arial,sans-serif; font-size:10px; font-weight:700; letter-spacing:1.5px; margin-left:10px; }
  .finding p { font-family:Georgia,serif; color:#374151; font-size:14px; margin:6px 0 0; line-height:1.55; }
  .opp-impact { font-family:Arial,sans-serif; color:#92400e; font-weight:700; font-size:11px; margin-top:8px; letter-spacing:1.5px; text-transform:uppercase; }
  .qw { padding:10px 14px; background:#fefdf7; border:1px solid #f3ebd4; border-radius:4px; margin-bottom:8px; }
  .qw-title { font-family:Georgia,serif; font-weight:700; font-size:14px; color:#1a1a1a; }
  .qw p { font-family:Georgia,serif; font-size:13px; color:#4b5563; margin:4px 0 0; line-height:1.5; }
  .next h3 { font-family:Georgia,serif; font-size:20px; margin:0 0 8px; font-weight:700; color:#1a1a1a; }
  .next p { font-family:Georgia,serif; color:#374151; font-size:16px; line-height:1.6; font-style:italic; margin:0; }
  .solomon-intro { margin-top:20px; padding:16px 18px; background:#fdf8f0; border-left:3px solid #d4b565; border-radius:6px; }
  .solomon-chip { display:inline-block; font-family:var(--mono); font-size:10px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:#92400e; margin-bottom:8px; }
  .solomon-intro p { font-family:Georgia,serif; font-size:14.5px; color:#374151; line-height:1.6; margin:0; font-style:italic; }
  .phase-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
  .phase-card { padding:18px 16px; background:#fdf8f0; border-radius:6px; display:flex; flex-direction:column; gap:6px; }
  .phase-num { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; border-radius:999px; background:#d4b565; color:#0a0e14; font-family:var(--sans); font-weight:700; font-size:13px; }
  .phase-label { font-family:Georgia,serif; font-weight:700; font-size:15px; color:#1a1a1a; margin-top:4px; }
  .phase-time { font-family:var(--mono); font-size:10px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:#92400e; }
  .phase-card p { font-family:Georgia,serif; font-size:13.5px; color:#374151; line-height:1.55; margin:6px 0 0; }
  @media (max-width:720px) { .phase-grid { grid-template-columns:1fr; } }
  .cta-block { margin-top:36px; padding:28px 24px; background:linear-gradient(180deg,#fef3c7,#fdf8f0); border:1px solid #f3ebd4; border-radius:8px; text-align:center; }
  .cta-block h3 { font-family:Georgia,serif; font-size:22px; margin:0 0 8px; color:#1a1a1a; font-weight:700; }
  .cta-block p { font-family:Georgia,serif; font-size:15px; color:#374151; line-height:1.6; margin:0 0 20px; }
  /* .report-card a { color:#92400e } was winning on specificity — force gold */
  .report-card a.cta-btn, .cta-btn { display:inline-flex; align-items:center; gap:10px; padding:14px 28px; border-radius:6px; background:#0a0e14; color:#f2c94c !important; font-family:var(--sans); font-weight:600; font-size:15px; text-decoration:none !important; }
  .report-card a.cta-btn:hover, .cta-btn:hover { background:#12181f; color:#f2c94c !important; }
  .cta-btn .arrow { font-size:18px; }
  .signals { font-family:Arial,sans-serif; font-size:12px; color:#4b5563; }
  .signals ul { padding-left:20px; margin:0 0 12px; }
  details { margin-top:12px; }
  summary { cursor:pointer; font-family:Arial,sans-serif; font-size:11px; letter-spacing:1.5px; color:#6b7280; text-transform:uppercase; }
  pre { background:#0a0e14; color:#e5e7eb; padding:14px; overflow:auto; border-radius:6px; font-size:11px; line-height:1.4; }
  .footer { text-align:center; padding:36px 24px 30px; margin-top:48px; border-top:1px solid rgba(255,255,255,0.05); font-family:var(--mono); font-size:11px; letter-spacing:0.22em; text-transform:uppercase; color:var(--ink-dim); }
  .footer img { display:block; height:32px; width:auto; margin:0 auto 14px; opacity:0.7; }

  /* Loading state */
  .loading-card { background:#fafaf7; color:#1a1a1a; max-width:920px; margin:24px auto 0; padding:60px 40px; border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,0.35); border:1px solid rgba(212,181,101,0.15); text-align:center; }
  .loading-card .spinner { width:52px; height:52px; margin:0 auto 24px; border:3px solid #e5e7eb; border-top-color:#d4b565; border-radius:50%; animation:spin 1s linear infinite; }
  .loading-card h2 { font-family:Georgia,serif; font-size:22px; margin:0 0 8px; color:#1a1a1a; font-weight:700; }
  .loading-card p { font-family:Georgia,serif; font-size:15px; color:#6b7280; margin:0 0 6px; }
  .loading-card .loading-steps { margin-top:24px; font-family:var(--mono); font-size:11px; letter-spacing:0.15em; color:#9ca3af; text-transform:uppercase; }
  .loading-card .loading-steps span { display:inline-block; padding:4px 10px; margin:0 3px; background:#fdf8f0; border-radius:4px; }
  @keyframes spin { to { transform:rotate(360deg); } }
`;

const LOGO_SRC = "https://assets.cdn.filesafe.space/oLIENQCtGnt9U6gfLhE5/media/6a57c2731097b811951d0e7d.png";

// Immediate HTML sent to the client before the audit runs. Includes topbar, hero,
// and an animated loading card at #audit-mount that gets swapped in-place when
// the audit finishes.
function buildAuditShellStart(host, targetUrl, mode, env = {}) {
  const e = escapeHtml;
  const isInternal = mode === "internal";
  const title = isInternal
    ? `Marketing audit — ${host} · CFO by Design`
    : `View Your Digital Presence Diagnostic — ${host}`;
  const description = isInternal
    ? `Internal marketing audit for ${host}.`
    : `View your digital presence diagnostic in about 60 seconds — a marketing audit powered by CFO by Design.`;
  // Open Graph / Twitter card image. Placeholder-swappable via env var so the
  // real hosted PNG can drop in without a code change. Internal audits skip
  // the social image (never text-shared to leads).
  const ogImage = !isInternal ? ((env && env.AUDIT_OG_IMAGE_URL) || LOGO_SRC) : "";
  const ogTags = isInternal ? "" : `
<meta property="og:type" content="website">
<meta property="og:site_name" content="CFO by Design">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}">
<meta property="og:image" content="${e(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Marketing Audit — powered by CFO by Design">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${e(title)}">
<meta name="twitter:description" content="${e(description)}">
<meta name="twitter:image" content="${e(ogImage)}">`;
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(title)}</title>
<meta name="description" content="${e(description)}">${ogTags}
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;1,500;1,600&display=swap" rel="stylesheet">
<style>${AUDIT_PAGE_CSS}</style>
</head>
<body>
  <header class="topbar">
    <div class="wrap">
      <span class="logo"><img src="${LOGO_SRC}" alt="CFO by Design"></span>
      <span class="tier-chip">Marketing Audit${isInternal ? " · Internal" : ""}</span>
    </div>
  </header>
  <section class="hello">
    <div class="wrap">
      <p class="eyebrow">◆ Solomon Marketing Audit &middot; ${e(new Date().toISOString().slice(0,10))}</p>
      <h1>${e(host)}, we're <em>looking at your site</em>.</h1>
      <p class="target">${e(targetUrl)}</p>
    </div>
  </section>
  <div id="audit-mount">
    <div class="loading-card">
      <div class="spinner" aria-hidden="true"></div>
      <h2>Give me a minute. I'm reading your digital presence.</h2>
      <p>I'm Solomon &mdash; CFO by Design's diagnostic AI. This takes about 30&ndash;60 seconds. Stay on the page.</p>
      <div class="loading-steps">
        <span>Scanning your site</span>
        <span>Reading your signals</span>
        <span>Checking your listings</span>
        <span>Diagnosing</span>
      </div>
    </div>
  </div>
`;
}

function buildAuditShellEnd() {
  return `
  <footer class="footer">
    <img src="${LOGO_SRC}" alt="CFO by Design">
    <div>CFO by Design &middot; Solomon marketing audit</div>
  </footer>
</body>
</html>`;
}

// Error card used when the audit fails after the shell has been sent.
function buildAuditErrorCard(err) {
  const msg = escapeHtml((err && err.message) || String(err || "Unknown error"));
  return `<div class="report-card">
    <div class="badge" style="background:#fee2e2;color:#b91c1c;">Audit failed</div>
    <h1 class="card-headline">We couldn't finish your audit.</h1>
    <p class="card-opener">Something went wrong on our side while reading your site. It happens — please try again in a minute, and if it persists, let us know.</p>
    <details style="margin-top:16px;"><summary>Technical detail</summary><pre style="background:#f9f9f9;color:#374151;padding:12px;border-radius:6px;margin-top:8px;">${msg}</pre></details>
  </div>`;
}

// Dispatch: renders just the .report-card body for the given mode.
function buildAuditCardBody(agent, signals, mode = "public", env = {}) {
  if (mode === "internal") return buildInternalCardBody(agent, signals);
  return buildPublicCardBody(agent, signals, env);
}

// Legacy full-page renderer, kept so any non-streaming path still works. The
// streaming route builds the shell + card body itself; this helper is only used
// by callers that need the whole HTML in one string.
function buildAuditPage(agent, signals, mode = "public", env = {}) {
  const host = (() => { try { return new URL(signals.url).host; } catch { return signals.url; } })();
  const cardBody = buildAuditCardBody(agent, signals, mode, env);
  // Replace the loading card at #audit-mount with the real card body.
  const shell = buildAuditShellStart(host, signals.url, mode, env);
  const withCard = shell.replace(
    /<div id="audit-mount">[\s\S]*?<\/div>\s*<\/div>\s*$/m,
    cardBody
  );
  return withCard + buildAuditShellEnd();
}

// Client-facing card body (goes inside #audit-mount).
function buildPublicCardBody(agent, signals, env = {}) {
  const e = escapeHtml;
  // Prefer AUDIT_BOOKING_URL (marketing-audit-specific consult calendar).
  // Fall back to BOOKING_LINK_47 if unset — that keeps the audit working
  // whether the env var is deployed or not.
  const bookingUrl = (env && env.AUDIT_BOOKING_URL)
    || (env && env.BOOKING_LINK_47)
    || CONFIG.BOOKING_LINK_47;
  const priColor = (p) =>
    p === "CRITICAL" ? "#b91c1c" :
    p === "HIGH" ? "#d97706" :
    p === "MEDIUM" ? "#92400e" :
    "#a16207";
  const scoreColor = (n) =>
    n >= 8 ? "#4ade80" :
    n >= 5 ? "#d4b565" :
    n >= 3 ? "#f59e0b" :
    "#dc2626";

  const scorecard = (agent.scorecard || []).map((s) => `
    <div class="score-tile">
      <div class="score-dim">${e(s.dimension || "")}</div>
      <div class="score-num" style="color:${scoreColor(Number(s.score) || 0)};">${e(String(s.score ?? "—"))}<span class="score-of">/10</span></div>
      <div class="score-note">${e(s.note || "")}</div>
    </div>`).join("");
  const problems = (agent.problems || []).map((p) => `
    <div class="finding" style="border-left:4px solid ${priColor(p.priority)};">
      <div class="finding-title">${e(p.title)}<span class="pri" style="color:${priColor(p.priority)};">${e(p.priority)}</span></div>
      <p>${e(p.impact)}</p>
    </div>`).join("");
  const outcomes = (agent.whatItLooksLike || []).map((o) => `
    <div class="finding" style="border-left:4px solid #c4a647;">
      <div class="finding-title">${e(o.title)}</div>
      <p>${e(o.desc)}</p>
    </div>`).join("");
  const gamePlan = (agent.gamePlan || []).map((p, i) => `
    <div class="phase-card">
      <div class="phase-num">${i + 1}</div>
      <div class="phase-label">${e(p.phase || "")}</div>
      <div class="phase-time">${e(p.timeline || "")}</div>
      <p>${e(p.focus || "")}</p>
    </div>`).join("");
  const context = agent.context
    ? `<p class="context">${e(agent.context)}</p>` : "";
  const solomonIntro = agent.solomonIntro
    ? `<div class="solomon-intro">
         <span class="solomon-chip">◆ Solomon &middot; diagnostic AI &middot; trained on the CFO by Design methodology</span>
         <p>${e(agent.solomonIntro)}</p>
       </div>`
    : "";

  return `<div class="report-card">
    <div class="badge">${e(agent.badge || "AUDIT")}</div>
    <h1 class="card-headline">${e(agent.headline || "")}</h1>
    <p class="card-opener">${e(agent.opener || "")}</p>
    ${context}
    ${solomonIntro}

    <h2 class="section-h">Where you stand</h2>
    <div class="scorecard">${scorecard || '<p style="color:#6b7280;font-style:italic;">No scorecard.</p>'}</div>

    <h2 class="section-h">What's costing you customers</h2>
    ${problems || '<p style="color:#6b7280;font-style:italic;">No problems returned.</p>'}

    <h2 class="section-h">What it looks like when this is fixed</h2>
    ${outcomes || '<p style="color:#6b7280;font-style:italic;">No outcomes returned.</p>'}

    <h2 class="section-h">The game plan &middot; at a glance</h2>
    <p style="font-family:Georgia,serif;font-size:14px;color:#6b7280;margin:0 0 14px;font-style:italic;">The direction, not the tactics. The specific playbook — what, when, who — is what our 30-minute call unlocks.</p>
    <div class="phase-grid">${gamePlan || '<p style="color:#6b7280;font-style:italic;">No plan returned.</p>'}</div>

    <div class="cta-block">
      <h3>${e(agent.nextStepHeadline || "Ready for the specific playbook?")}</h3>
      <p>${e(agent.nextStepBody || "")}</p>
      <a class="cta-btn" href="${e(bookingUrl)}" target="_blank" rel="noopener">Book a 30-minute call with a human <span class="arrow">→</span></a>
    </div>
  </div>`;
}

// Internal / team-facing card body. Full detail with quick wins, signal list, raw JSON.
function buildInternalCardBody(agent, signals) {
  const e = escapeHtml;
  const priColor = (p) =>
    p === "CRITICAL" ? "#b91c1c" :
    p === "HIGH" ? "#d97706" :
    p === "MEDIUM" ? "#92400e" :
    "#a16207";
  const scoreColor = (n) =>
    n >= 8 ? "#4ade80" :
    n >= 5 ? "#d4b565" :
    n >= 3 ? "#f59e0b" :
    "#dc2626";

  const scorecard = (agent.scorecard || []).map((s) => `
    <div class="score-tile">
      <div class="score-dim">${e(s.dimension || "")}</div>
      <div class="score-num" style="color:${scoreColor(Number(s.score) || 0)};">${e(String(s.score ?? "—"))}<span class="score-of">/10</span></div>
      <div class="score-note">${e(s.note || "")}</div>
    </div>`).join("");

  const gaps = (agent.gaps || []).map((g) => `
    <div class="finding" style="border-left:4px solid ${priColor(g.priority)};">
      <div class="finding-title">${e(g.title)}<span class="pri" style="color:${priColor(g.priority)};">${e(g.priority)}</span></div>
      <p>${e(g.impact)}</p>
    </div>`).join("");
  const opps = (agent.opportunities || []).map((o) => `
    <div class="finding" style="border-left:4px solid #c4a647;">
      <div class="finding-title">${e(o.title)}</div>
      <p>${e(o.desc)}</p>
      <div class="opp-impact">${e(o.impact)}</div>
    </div>`).join("");
  const quickWins = (agent.quickWins || []).map((q) => `
    <div class="qw">
      <div class="qw-title">◆ ${e(q.title)}</div>
      <p>${e(q.desc)}</p>
    </div>`).join("");
  const signalsList = (agent.signalsAudited || []).map((s) => `<li>${e(s)}</li>`).join("");
  const rawSignals = JSON.stringify(signals, null, 2);
  const context = agent.context
    ? `<p class="context">${e(agent.context)}</p>` : "";

  return `<div class="report-card">
    <div class="badge">${e(agent.badge || "AUDIT")}</div>
    <h1 class="card-headline">${e(agent.headline || "")}</h1>
    <p class="card-opener">${e(agent.opener || "")}</p>
    ${context}

    <h2 class="section-h">Digital Presence Scorecard</h2>
    <div class="scorecard">${scorecard || '<p style="color:#6b7280;font-style:italic;">No scorecard returned.</p>'}</div>

    <h2 class="section-h">Critical Gaps</h2>
    ${gaps || '<p style="color:#6b7280;font-style:italic;">No gaps returned.</p>'}

    <h2 class="section-h">Highest-Impact Opportunities</h2>
    ${opps || '<p style="color:#6b7280;font-style:italic;">No opportunities returned.</p>'}

    ${quickWins ? `<h2 class="section-h">Quick Wins (Ship This Week)</h2>${quickWins}` : ""}

    <h2 class="section-h">Next Step</h2>
    <div class="next">
      <h3>${e(agent.nextStepHeadline || "")}</h3>
      <p>${e(agent.nextStepBody || "")}</p>
    </div>

    <h2 class="section-h signals">What Solomon actually looked at</h2>
    <div class="signals">
      <ul>${signalsList}</ul>
      <details>
        <summary>Raw signals JSON</summary>
        <pre>${e(rawSignals)}</pre>
      </details>
    </div>
  </div>`;
}


// Inline-styled HTML report body. Inline styles are essential for email clients
// (Gmail / Outlook / Apple Mail) which strip <style> blocks.
// Phase 2D: humanize a Phase 2A question_key for the "Based on:" receipts
// row on a rendered structured finding. Falls back to a title-case render
// of the key when it isn't in the table — so a new normalizer entry
// doesn't need a renderer edit to not-look-terrible.
const QUESTION_KEY_LABELS = Object.freeze({
  monthly_debt_service: "Monthly debt service",
  total_corporate_debt: "Total corporate debt",
  ar_30_plus: "A/R 30+ days",
  ar_60_plus: "A/R 60+ days",
  tax_returns_status: "Tax-return status",
  has_formal_audit: "Formal financial audit",
  has_documented_budget: "Documented budget",
  debt_status: "Debt status",
  merchant_processing_last_review: "Merchant-processing review",
  financial_decision_basis: "Decision basis",
  active_debt_summary: "Active debt",
  business_type: "Business type",
  industry: "Industry",
  customer_acquisition_channel: "Primary channel",
  leads_per_month: "Leads/month",
  bookings_per_month: "Bookings/month",
  shows_per_month: "Shows/month",
  offers_per_month: "Offers/month",
  closes_per_month: "Closes/month",
});
const DERIVED_METRIC_LABELS = Object.freeze({
  total_debt: "Total debt",
  monthly_debt_service_amount: "Monthly debt service",
  ar_30_plus_amount: "A/R 30+ amount",
  ar_60_plus_amount: "A/R 60+ amount",
  ar_30_plus_months_of_debt_service: "Months of debt service in 30+ A/R",
  ar_60_plus_months_of_debt_service: "Months of debt service in 60+ A/R",
  lead_to_booking_rate: "Lead → booking rate",
  booking_to_show_rate: "Booking → show rate",
  show_to_offer_rate: "Show → offer rate",
  offer_to_close_rate: "Offer → close rate",
  lead_to_sale_rate: "Lead → sale rate",
});
function labelForQuestionKey(k) {
  if (QUESTION_KEY_LABELS[k]) return QUESTION_KEY_LABELS[k];
  return String(k || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function labelForMetric(m) {
  if (DERIVED_METRIC_LABELS[m]) return DERIVED_METRIC_LABELS[m];
  return String(m || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
// Format a Phase 2A normalized value for display in a receipts row.
// Numeric money fields are inferred from the question_key name; booleans
// render as yes/no; strings and compound objects pass through.
function formatEvidenceValue(field, value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    // Fields that are inherently dollar amounts render with $ + commas.
    const isDollar = /debt|ar_|service|amount|revenue|cash|loan|credit/i.test(String(field));
    if (isDollar) return `$${Math.round(value).toLocaleString("en-US")}`;
    return String(value);
  }
  if (typeof value === "string") return value;
  // Compound (e.g. active_debt_summary) — render a short list of subtypes.
  if (value && Array.isArray(value.subtypes)) {
    return value.subtypes.length ? value.subtypes.join(", ") : "none";
  }
  return "";
}
// Format a Phase 2B derived metric for display. Units drive formatting:
// dollars → "$6,500", months → "3.61 months", ratio → "8.1%".
function formatMetricValue(m) {
  if (!m || typeof m.value !== "number") return "";
  if (m.unit === "dollars") return `$${Math.round(m.value).toLocaleString("en-US")}`;
  if (m.unit === "months")  return `${m.value} months`;
  if (m.unit === "ratio")   return `${(m.value * 100).toFixed(1)}%`;
  return String(m.value);
}

function buildReportHtml(agent) {
  // 2026-10-29 em-dash runtime sanitation. The TIER_GUIDE STYLE
  // block already instructs Solomon not to emit em dashes in
  // customer-facing fields, but live reports still slipped them
  // through (Liz's 2026-10-29 test surfaced several). This wraps
  // escapeHtml so every rendered field is normalized at the
  // boundary: U+2014 (em dash) becomes " - " and any resulting
  // double space is collapsed. This covers tight ("word—word")
  // and padded ("word — word") usages uniformly as a thought-break
  // hyphen, which is what the brand voice guide prefers.
  const stripEmDashes = (s) => {
    if (s == null) return s;
    return String(s).replace(/\s*—\s*/g, " - ").replace(/ {2,}/g, " ");
  };
  const e = (s) => escapeHtml(stripEmDashes(s));
  const priColor = (p) =>
    p === "CRITICAL" ? "#b91c1c" :
    p === "HIGH" ? "#d97706" :
    "#92400e";
  const severityToPriority = (s) => {
    const low = String(s || "").toLowerCase();
    if (low === "high")   return { label: "HIGH",   color: "#b91c1c" };
    if (low === "medium") return { label: "MEDIUM", color: "#d97706" };
    return                       { label: "LOW",    color: "#92400e" };
  };

  // paid47-v2 enriched gap renderer. Carries the gap's known/why-it-
  // matters/unknown/decision-implication prose onto the card without
  // bloating it into a visually exhausting panel — one card per gap,
  // one short line per field, same critical-gaps layout as v1.
  const gapV2Item = (g) => {
    const priority = g.priority || "MEDIUM";
    const bodyLines = [];
    if (g.known) bodyLines.push(`<div style="font-family:Georgia,serif;color:#374151;font-size:14px;margin-top:6px;line-height:1.55;"><strong style="color:#1a1a1a;">Known:</strong> ${e(g.known)}</div>`);
    if (g.whyItMatters) bodyLines.push(`<div style="font-family:Georgia,serif;color:#374151;font-size:14px;margin-top:4px;line-height:1.55;"><strong style="color:#1a1a1a;">Why it matters:</strong> ${e(g.whyItMatters)}</div>`);
    if (g.unknown && String(g.unknown).trim().toLowerCase() !== "none") {
      bodyLines.push(`<div style="font-family:Georgia,serif;color:#374151;font-size:14px;margin-top:4px;line-height:1.55;"><strong style="color:#1a1a1a;">Still unknown:</strong> ${e(g.unknown)}</div>`);
    }
    if (g.decisionImplication) bodyLines.push(`<div style="font-family:Georgia,serif;color:#374151;font-size:14px;margin-top:4px;line-height:1.55;"><strong style="color:#1a1a1a;">What this changes:</strong> ${e(g.decisionImplication)}</div>`);
    return `
    <tr><td style="padding:14px 16px;background:#fdf8f0;border-left:4px solid ${priColor(priority)};border-radius:4px;">
      <div style="font-family:Georgia,serif;font-weight:700;color:#1a1a1a;font-size:16px;">${e(g.title || "")}<span style="font-size:10px;font-weight:700;color:${priColor(priority)};letter-spacing:1.5px;margin-left:10px;">${e(priority)}</span></div>
      ${bodyLines.join("")}
    </td></tr><tr><td style="height:10px;"></td></tr>`;
  };

  const oppV2Item = (o) => {
    const bodyLines = [];
    if (o.whyCredible) bodyLines.push(`<div style="font-family:Georgia,serif;color:#374151;font-size:14px;margin-top:6px;line-height:1.55;"><strong style="color:#1a1a1a;">Why it's credible:</strong> ${e(o.whyCredible)}</div>`);
    if (o.whatMustBeTrue) bodyLines.push(`<div style="font-family:Georgia,serif;color:#374151;font-size:14px;margin-top:4px;line-height:1.55;"><strong style="color:#1a1a1a;">What must be true:</strong> ${e(o.whatMustBeTrue)}</div>`);
    if (o.nextValidation) bodyLines.push(`<div style="font-family:Georgia,serif;color:#374151;font-size:14px;margin-top:4px;line-height:1.55;"><strong style="color:#1a1a1a;">Next validation:</strong> ${e(o.nextValidation)}</div>`);
    const mech = o.economicMechanism ? `<div style="font-family:Arial,sans-serif;color:#92400e;font-weight:700;font-size:11px;margin-top:8px;letter-spacing:1.5px;text-transform:uppercase;">${e(o.economicMechanism)}</div>` : "";
    return `
    <tr><td style="padding:14px 16px;background:#fdf8f0;border-left:4px solid #c4a647;border-radius:4px;">
      <div style="font-family:Georgia,serif;font-weight:700;color:#1a1a1a;font-size:16px;">${e(o.title || "")}</div>
      ${bodyLines.join("")}
      ${mech}
    </td></tr><tr><td style="height:10px;"></td></tr>`;
  };

  const gapItem = (g) => `
    <tr><td style="padding:14px 16px;background:#fdf8f0;border-left:4px solid ${priColor(g.priority)};border-radius:4px;">
      <div style="font-family:Georgia,serif;font-weight:700;color:#1a1a1a;font-size:16px;">${e(g.title)}<span style="font-size:10px;font-weight:700;color:${priColor(g.priority)};letter-spacing:1.5px;margin-left:10px;">${e(g.priority)}</span></div>
      <div style="font-family:Georgia,serif;color:#374151;font-size:14px;margin-top:6px;line-height:1.55;">${e(g.impact)}</div>
    </td></tr><tr><td style="height:10px;"></td></tr>`;

  // Phase 2D: render one structured finding into the Critical Gaps slot.
  // interpretation → the top line (what this means).
  // recommendation → the sub-line (what to do).
  // severity → priority badge.
  // evidence + derived_metrics → the trust-building "Based on:" footer.
  // The visual slot is identical to a prose gap so the HTML diff vs the
  // pre-2D renderer is a strict addition at the bottom of each card, not
  // a layout rewrite.
  const structuredGapItem = (f) => {
    const sev = severityToPriority(f.severity);
    const evidenceParts = (f.evidence || [])
      .map((ev) => {
        const v = formatEvidenceValue(ev.field, ev.value);
        return v ? `${labelForQuestionKey(ev.field)}: ${v}` : null;
      })
      .filter(Boolean);
    const metricParts = (f.derived_metrics || [])
      .map((m) => (typeof m.value === "number" ? `${labelForMetric(m.metric)}: ${formatMetricValue(m)}` : null))
      .filter(Boolean);
    const receipts = [...evidenceParts, ...metricParts].join(" · ");
    const receiptsHtml = receipts
      ? `<div style="font-family:Arial,sans-serif;color:#92400e;font-weight:600;font-size:10px;margin-top:10px;letter-spacing:1px;text-transform:uppercase;">Based on: ${e(receipts)}</div>`
      : "";
    return `
    <tr><td style="padding:14px 16px;background:#fdf8f0;border-left:4px solid ${sev.color};border-radius:4px;">
      <div style="font-family:Georgia,serif;font-weight:700;color:#1a1a1a;font-size:16px;">${e(f.interpretation)}<span style="font-size:10px;font-weight:700;color:${sev.color};letter-spacing:1.5px;margin-left:10px;">${sev.label}</span></div>
      <div style="font-family:Georgia,serif;color:#374151;font-size:14px;margin-top:6px;line-height:1.55;">${e(f.recommendation)}</div>
      ${receiptsHtml}
    </td></tr><tr><td style="height:10px;"></td></tr>`;
  };

  const oppItem = (o) => `
    <tr><td style="padding:14px 16px;background:#fdf8f0;border-left:4px solid #c4a647;border-radius:4px;">
      <div style="font-family:Georgia,serif;font-weight:700;color:#1a1a1a;font-size:16px;">${e(o.title)}</div>
      <div style="font-family:Georgia,serif;color:#374151;font-size:14px;margin-top:6px;line-height:1.55;">${e(o.desc)}</div>
      <div style="font-family:Arial,sans-serif;color:#92400e;font-weight:700;font-size:11px;margin-top:8px;letter-spacing:1.5px;text-transform:uppercase;">${e(o.impact)}</div>
    </td></tr><tr><td style="height:10px;"></td></tr>`;

  // paid47-v2 branch: when the response carries reportSchemaVersion
  // "paid47-v2" + tierGuideVersion "paid47-2.0", render the richer
  // sections (Financial Snapshot, enriched gap cards, Connections,
  // Questions To Clarify, Decision Order). Everything else goes
  // through the legacy renderer so paid47-v1 reports still render.
  const isV2 = agent.reportSchemaVersion === "paid47-v2" && agent.tierGuideVersion === "paid47-2.0";

  // Phase 2D: prefer structured findings when present; fall back to the
  // prose gaps array for runs where Solomon didn't emit structured output
  // (console runs without normalization; pre-Phase-2C generations stored
  // in D1). Both arrays go through the same visual slot — a reader can't
  // tell the renderer source apart beyond the "Based on:" receipts row
  // the structured path adds.
  const structured = Array.isArray(agent.structured_findings) ? agent.structured_findings : [];
  let gaps;
  let opps;
  if (isV2) {
    gaps = (agent.gaps || []).map(gapV2Item).join("");
    opps = (agent.opportunities || []).map(oppV2Item).join("");
  } else {
    gaps = structured.length
      ? structured.map(structuredGapItem).join("")
      : (agent.gaps || []).map(gapItem).join("");
    opps = (agent.opportunities || []).map(oppItem).join("");
  }
  const context = agent.context
    ? `<p style="font-family:Georgia,serif;font-style:italic;color:#6b7280;font-size:15px;line-height:1.6;margin:12px 0 0;">${e(agent.context)}</p>`
    : "";

  // v2-only enriched sections. Each guarded by a non-empty check so a
  // v2 run that honestly returned no connections (coverage.connectionStatus
  // = no_material_connection_supported) does not render an empty header.
  let snapshotBlock = "";
  if (isV2 && Array.isArray(agent.financialSnapshot) && agent.financialSnapshot.length) {
    const rows = agent.financialSnapshot.map((r) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f3e9d2;font-family:Georgia,serif;font-size:14px;color:#374151;">${e(r.label || "")}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3e9d2;font-family:Georgia,serif;font-size:14px;font-weight:700;color:#1a1a1a;text-align:right;white-space:nowrap;">${e(r.value || "")}</td>
      </tr>${r.meaning ? `<tr><td colspan="2" style="padding:4px 12px 10px;font-family:Georgia,serif;font-size:13px;color:#6b7280;font-style:italic;border-bottom:1px solid #f3e9d2;">${e(r.meaning)}</td></tr>` : ""}`).join("");
    snapshotBlock = `
<h2 style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#92400e;border-bottom:1px solid #e5e7eb;padding-bottom:8px;margin:32px 0 16px;">Financial Snapshot</h2>
<table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background:#fdf8f0;border-radius:4px;">${rows}</table>`;
  }

  let connectionsBlock = "";
  if (isV2 && Array.isArray(agent.connections) && agent.connections.length) {
    const items = agent.connections.map((c) => `
      <tr><td style="padding:12px 14px;background:#fdf8f0;border-left:4px solid #92400e;border-radius:4px;">
        <div style="font-family:Georgia,serif;font-weight:700;color:#1a1a1a;font-size:15px;">${e(c.title || "")}</div>
        <div style="font-family:Georgia,serif;color:#374151;font-size:14px;margin-top:4px;line-height:1.55;">${e(c.explanation || "")}</div>
      </td></tr><tr><td style="height:8px;"></td></tr>`).join("");
    // Heading rebranded 2026-10-29: the paid_47 cross-finding
    // synthesis is now presented as "What the Numbers Are Telling
    // Us," with "How these findings interact" as the Georgia-serif
    // sub-eyebrow. One section only — the free tier's
    // contextualInsight is a separate card and must not duplicate
    // this synthesis prose. The underlying connections[] shape is
    // unchanged, so paid47-v2 schema + tests still match.
    connectionsBlock = `
<h2 style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#92400e;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin:32px 0 4px;">What the Numbers Are Telling Us</h2>
<p style="font-family:Georgia,serif;font-size:13px;font-style:italic;color:#6b7280;margin:0 0 16px;">How these findings interact</p>
<table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;">${items}</table>`;
  }

  let questionsBlock = "";
  if (isV2 && Array.isArray(agent.questionsToClarify) && agent.questionsToClarify.length) {
    const items = agent.questionsToClarify.map((q) => `
      <li style="margin-bottom:10px;font-family:Georgia,serif;color:#1a1a1a;font-size:14px;line-height:1.55;">
        <strong>${e(q.question || "")}</strong>${q.whyItMatters ? `<div style="color:#6b7280;font-size:13px;font-style:italic;margin-top:2px;">${e(q.whyItMatters)}</div>` : ""}
      </li>`).join("");
    questionsBlock = `
<h2 style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#92400e;border-bottom:1px solid #e5e7eb;padding-bottom:8px;margin:32px 0 16px;">Questions to Clarify With the Strategist</h2>
<ul style="margin:0;padding-left:20px;">${items}</ul>`;
  }

  // Contextual Insight — free-tier memorable connection the owner
  // may not have made themselves. Rendered only when title + body
  // are both non-empty, so an empty object never produces an empty
  // card. Also surfaces on paid tiers when the model emits it (not
  // forbidden; the paid tier typically relies on connections[] for
  // the same job, but a one-liner insight is still welcome).
  let contextualInsightBlock = "";
  if (
    agent.contextualInsight &&
    agent.contextualInsight.title &&
    String(agent.contextualInsight.title).trim() &&
    agent.contextualInsight.body &&
    String(agent.contextualInsight.body).trim()
  ) {
    const ci = agent.contextualInsight;
    // 2026-10-29 scope correction: remove the generic "Contextual
    // Insight" eyebrow and let the signature label stand on its own
    // ("The tension," "What I'd watch," "That number means," "The
    // question I wouldn't ignore"). The signature title is already
    // the memorable framing; a generic header above it just creates
    // noise and feels bureaucratic.
    contextualInsightBlock = `
<table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;margin-top:32px;">
  <tr><td style="padding:14px 16px;background:#fdf8f0;border-left:4px solid #92400e;border-radius:4px;">
    <div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#92400e;font-weight:700;margin-bottom:6px;">${e(ci.title)}</div>
    <div style="font-family:Georgia,serif;color:#1a1a1a;font-size:15px;line-height:1.6;">${e(ci.body)}</div>
  </td></tr>
</table>`;
  }

  // Strength block — free-tier card showing the owner's working
  // capability. Guarded by a non-empty title check so a response
  // without a supported strength never renders an empty card (free-
  // tier contract: never show an empty Strength card).
  let strengthBlock = "";
  if (agent.strength && agent.strength.title && String(agent.strength.title).trim()) {
    const s = agent.strength;
    const sDesc = s.desc && String(s.desc).trim() ? e(s.desc) : "";
    strengthBlock = `
<h2 style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#92400e;border-bottom:1px solid #e5e7eb;padding-bottom:8px;margin:32px 0 16px;">What's Already Working</h2>
<table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;">
  <tr><td style="padding:14px 16px;background:#fdf8f0;border-left:4px solid #92400e;border-radius:4px;">
    <div style="font-family:Georgia,serif;font-weight:700;color:#1a1a1a;font-size:16px;">${e(s.title)}</div>
    ${sDesc ? `<div style="font-family:Georgia,serif;color:#374151;font-size:14px;margin-top:6px;line-height:1.55;">${sDesc}</div>` : ""}
  </td></tr>
</table>`;
  }

  // The Gap — free-tier required block when theGap is emitted.
  // Four-part structure: known / unknown / why it matters / what the
  // paid tier will investigate. Guard on at least one field being
  // non-empty so a partial gap doesn't render as a blank card.
  let theGapBlock = "";
  if (agent.theGap && typeof agent.theGap === "object") {
    const g = agent.theGap;
    // The question is the headline (new 2026-10-29 field, Codex P1
    // on #164). The four prose fields below support it. All five
    // are optional; render whichever ones the model supplied.
    const questionLine = g.question
      ? `<div style="font-family:Georgia,serif;font-weight:700;color:#1a1a1a;font-size:16px;line-height:1.5;margin-bottom:10px;">${e(g.question)}</div>`
      : "";
    const lines = [];
    if (g.known) lines.push(`<div style="font-family:Georgia,serif;color:#374151;font-size:14px;margin-top:6px;line-height:1.55;"><strong style="color:#1a1a1a;">What we know:</strong> ${e(g.known)}</div>`);
    if (g.unknown) lines.push(`<div style="font-family:Georgia,serif;color:#374151;font-size:14px;margin-top:4px;line-height:1.55;"><strong style="color:#1a1a1a;">What's unknown:</strong> ${e(g.unknown)}</div>`);
    if (g.whyItMatters) lines.push(`<div style="font-family:Georgia,serif;color:#374151;font-size:14px;margin-top:4px;line-height:1.55;"><strong style="color:#1a1a1a;">Why it matters:</strong> ${e(g.whyItMatters)}</div>`);
    if (g.whatPaidWillInvestigate) lines.push(`<div style="font-family:Georgia,serif;color:#374151;font-size:14px;margin-top:4px;line-height:1.55;"><strong style="color:#1a1a1a;">What the Full Diagnostic investigates:</strong> ${e(g.whatPaidWillInvestigate)}</div>`);
    if (questionLine || lines.length) {
      theGapBlock = `
<h2 style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#92400e;border-bottom:1px solid #e5e7eb;padding-bottom:8px;margin:32px 0 16px;">The Gap</h2>
<table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;">
  <tr><td style="padding:14px 16px;background:#fdf8f0;border-left:4px solid #c4a647;border-radius:4px;">
    ${questionLine}${lines.join("")}
  </td></tr>
</table>`;
    }
  }

  // One Move You Can Make Now — free-tier required block when a
  // first-ranked signal exists. Rendered on BOTH tiers when the model
  // emits it (the paid tier's richer decisionOrder covers the same
  // ground, so paid responses typically omit it). Non-empty title +
  // desc gate rendering so an empty object doesn't produce an empty
  // card.
  let oneMoveBlock = "";
  if (agent.oneMove && agent.oneMove.title && String(agent.oneMove.title).trim()) {
    const om = agent.oneMove;
    const desc = om.desc && String(om.desc).trim() ? e(om.desc) : "";
    oneMoveBlock = `
<h2 style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#92400e;border-bottom:1px solid #e5e7eb;padding-bottom:8px;margin:32px 0 16px;">One Move You Can Make Now</h2>
<table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;">
  <tr><td style="padding:14px 16px;background:#fdf8f0;border-left:4px solid #c4a647;border-radius:4px;">
    <div style="font-family:Georgia,serif;font-weight:700;color:#1a1a1a;font-size:16px;">${e(om.title)}</div>
    ${desc ? `<div style="font-family:Georgia,serif;color:#374151;font-size:14px;margin-top:6px;line-height:1.55;">${desc}</div>` : ""}
  </td></tr>
</table>`;
  }

  let decisionBlock = "";
  if (isV2 && Array.isArray(agent.decisionOrder) && agent.decisionOrder.length) {
    const items = agent.decisionOrder.map((d) => `
      <tr><td style="padding:10px 14px;background:#fdf8f0;border-left:4px solid #c4a647;border-radius:4px;">
        <div style="font-family:Georgia,serif;font-weight:700;color:#1a1a1a;font-size:15px;">Step ${e(String(d.step || ""))}: ${e(d.action || "")}</div>
        ${d.whyNow ? `<div style="font-family:Georgia,serif;color:#374151;font-size:13px;margin-top:4px;line-height:1.55;font-style:italic;">${e(d.whyNow)}</div>` : ""}
      </td></tr><tr><td style="height:6px;"></td></tr>`).join("");
    decisionBlock = `
<h2 style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#92400e;border-bottom:1px solid #e5e7eb;padding-bottom:8px;margin:32px 0 16px;">Order of Attention</h2>
<table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;">${items}</table>`;
  }

  return `
<div style="display:inline-block;padding:6px 14px;background:#fef3c7;color:#92400e;font-weight:700;font-size:11px;letter-spacing:2px;border-radius:999px;font-family:Arial,sans-serif;">${e(agent.badge)}</div>
<h1 style="font-family:Georgia,serif;font-size:26px;font-weight:700;margin:20px 0 16px;color:#1a1a1a;line-height:1.3;">${e(agent.headline)}</h1>
<p style="font-family:Georgia,serif;font-size:17px;color:#374151;line-height:1.65;margin:0;">${e(agent.opener)}</p>
${context}
${snapshotBlock}
<h2 style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#92400e;border-bottom:1px solid #e5e7eb;padding-bottom:8px;margin:32px 0 16px;">Critical Gaps Identified</h2>
<table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;">${gaps}</table>
${strengthBlock}
<h2 style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#92400e;border-bottom:1px solid #e5e7eb;padding-bottom:8px;margin:32px 0 16px;">Your Highest-Impact Opportunities</h2>
<table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;">${opps}</table>
${contextualInsightBlock}
${oneMoveBlock}
${theGapBlock}
${connectionsBlock}
${decisionBlock}
${questionsBlock}
<h2 style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#1a1a1a;margin:32px 0 12px;">${e(agent.nextStepHeadline)}</h2>
<p style="font-family:Georgia,serif;font-size:16px;color:#374151;line-height:1.6;font-style:italic;margin:0;">${e(agent.nextStepBody)}</p>
`.trim();
}

// Wrap inline-styled report body in a full standalone HTML page for the /report endpoint.
// Used when someone clicks "View Report Online" from an email.
// Async because it mints an HMAC-signed apply-token bound to this contactId,
// injected into the SOLOMON50 coupon script for the /apply-solomon50 auth check.
async function buildReportPage(reportBody, tierLabel, contactName, tier, env, contactEmail, contactId, opts = {}) {
  // isPending = true when reportBody is the analyzing spinner fallback,
  // NOT a real Solomon-generated report. In that state we must not print
  // the "YOUR REPORT · READY" pill or the tier-upsell CTA — both were
  // rendering above/below the spinner and lying to the user. The pending
  // shell only shows the spinner card + honest generating-copy eyebrow,
  // and the poll script inside the spinner reloads the page when the
  // report field actually populates.
  const isPending = Boolean(opts.isPending);
  const applyToken = contactId ? await mintApplyToken(contactId, env) : null;
  const e = escapeHtml;

  // Per-tier page header — the product ladder reads intentionally when
  // each tier announces itself in its own words rather than every tier
  // being titled "YOUR REPORT · READY" + "your diagnostic is back."
  //
  // Free tier is deliberately NOT called a "diagnostic" so the $47
  // "Full Diagnostic" tier doesn't sound like merely "more of the same."
  const firstName = (contactName || "").split(" ")[0] || contactName || "there";
  const PAGE_HEADER = {
    free:     { eyebrow: "◆ YOUR BUSINESS HEALTH CHECK · READY",
                hello:   `${e(firstName)}, your <em>assessment</em> is back.` },
    paid_47:  { eyebrow: "◆ YOUR FULL DIAGNOSTIC · READY",
                hello:   `${e(firstName)}, your <em>full financial picture</em> is ready.` },
    paid_297: { eyebrow: "◆ YOUR BUSINESS GROWTH ANALYSIS · READY",
                hello:   `${e(firstName)}, your <em>analysis</em> is ready for review.` },
  };
  const headerBlock = PAGE_HEADER[tier] || PAGE_HEADER.free;

  const paymentLink47 = (env && env.PAYMENT_LINK_47) || CONFIG.PAYMENT_LINK_47;
  const paymentLink297 = (env && env.PAYMENT_LINK_297) || CONFIG.PAYMENT_LINK_297;
  const bookingLink47 = (env && env.BOOKING_LINK_47) || CONFIG.BOOKING_LINK_47;
  const bookingLink297 = (env && env.BOOKING_LINK_297) || CONFIG.BOOKING_LINK_297;
  const logoSrc = "https://assets.cdn.filesafe.space/oLIENQCtGnt9U6gfLhE5/media/6a57c2731097b811951d0e7d.png";
  const emailParam = contactEmail ? `?email=${encodeURIComponent(contactEmail)}` : "";
  // Beta / coupon-bypass mode: HL payment links require a card even on 100%-off coupons.
  // Setting env.UPGRADE_47_URL swaps the free→$47 CTA target from payment to whatever URL
  // is set (e.g. the $47 survey directly). Set env.UPGRADE_297_URL for the equivalent
  // $47→$297 bypass. Both fall back to the normal payment links.
  const upgrade47Href = (env && env.UPGRADE_47_URL) || paymentLink47;
  const upgrade297Href = (env && env.UPGRADE_297_URL) || paymentLink297;

  // Tier-appropriate CTA block rendered UNDER the report card
  let cta = "";
  let couponScript = "";
  if (tier === "free") {
    // Beta cohort bypass: user enters SOLOMON50 → CTA swaps to survey (skips paywall).
    // Only active when env.UPGRADE_47_URL is set (coupon target = upgrade47Href).
    // When UPGRADE_47_URL is unset, upgrade47Href === paymentLink47, so the coupon
    // would just re-point at payment — pointless — so we hide the coupon row entirely.
    const couponEnabled = Boolean(env && env.UPGRADE_47_URL);
    const couponRow = couponEnabled ? `
        <div class="coupon-row" id="coupon-row" data-contact-id="${e(contactId || "")}" data-apply-token="${e(applyToken || "")}">
          <label for="coupon-input" class="coupon-label">Have a beta code?</label>
          <div class="coupon-inputgroup">
            <input id="coupon-input" type="text" placeholder="Enter code (e.g. SOLOMON50)" autocomplete="off" spellcheck="false">
            <button type="button" id="coupon-apply">Apply</button>
          </div>
          <p class="coupon-msg" id="coupon-msg" aria-live="polite"></p>
        </div>` : "";
    couponScript = couponEnabled ? `
        <script>
          window.initReportCoupon = function () {
            var row = document.getElementById('coupon-row');
            var input = document.getElementById('coupon-input');
            var apply = document.getElementById('coupon-apply');
            var msg = document.getElementById('coupon-msg');
            var cta = document.getElementById('upgrade-cta');
            var label = document.getElementById('upgrade-label');
            var micro = document.getElementById('upgrade-micro');
            var chip = document.querySelector('.cta-panel .upgrade-chip');
            if (!row || !input || !apply || !msg || !cta || !label || !micro || apply.dataset.couponBound) return;
            apply.dataset.couponBound = 'true';
            var VALID = { 'SOLOMON50': { href: cta.dataset.betaHref, label: 'Claim My Beta Access — Full Diagnostic', micro: 'Beta cohort · SOLOMON50 applied · skip payment, go straight to intake.' } };
            var CONTACT_ID = row.dataset.contactId;
            var APPLY_TOKEN = row.dataset.applyToken;
            function tryCoupon() {
              var code = (input.value || '').trim().toUpperCase();
              if (!code) return;
              if (!VALID[code]) {
                msg.textContent = 'That code isn\\'t recognized. Double-check spelling.';
                msg.className = 'coupon-msg err';
                return;
              }
              var v = VALID[code];
              // Optimistic UI feedback so the button doesn't feel dead — but
              // the CTA link stays gated until the server confirms the tag
              // write. Without confirmation, the user could reach the paid
              // survey without the entitlement tag applied, and the survey
              // webhook would 403 (no swot_solomon50_applied on contact).
              msg.textContent = 'Applying code…';
              msg.className = 'coupon-msg';
              input.disabled = true;
              apply.disabled = true;
              apply.textContent = 'Applying…';
              cta.setAttribute('aria-disabled', 'true');
              cta.style.pointerEvents = 'none';
              cta.style.opacity = '0.6';
              // Guard against a click on the CTA while the request is in
              // flight — swallow it until tag write returns.
              var blockNav = function (e) { e.preventDefault(); e.stopPropagation(); };
              cta.addEventListener('click', blockNav);

              function unlockCta() {
                cta.href = v.href;
                label.textContent = v.label;
                micro.textContent = v.micro;
                msg.textContent = '✓ Code applied — payment bypassed.';
                msg.className = 'coupon-msg ok';
                if (chip) chip.textContent = '◆ BETA COHORT · ' + code + ' APPLIED';
                apply.textContent = 'Applied';
                cta.removeEventListener('click', blockNav);
                cta.removeAttribute('aria-disabled');
                cta.style.pointerEvents = '';
                cta.style.opacity = '';
              }
              function reenableForRetry(errMsg) {
                msg.textContent = errMsg || 'Could not apply that code. Please try again.';
                msg.className = 'coupon-msg err';
                input.disabled = false;
                apply.disabled = false;
                apply.textContent = 'Apply';
                cta.removeEventListener('click', blockNav);
                cta.removeAttribute('aria-disabled');
                cta.style.pointerEvents = '';
                cta.style.opacity = '';
              }

              fetch('/apply-solomon50', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contactId: CONTACT_ID || undefined,
                  token: APPLY_TOKEN || undefined,
                  code: code
                })
              }).then(function (r) {
                return r.json().catch(function () { return { success: false }; })
                  .then(function (data) { return { ok: r.ok, data: data }; });
              }).then(function (result) {
                if (result.ok && result.data && result.data.success) {
                  unlockCta();
                } else {
                  var err = (result.data && result.data.error) || 'Server rejected the code.';
                  reenableForRetry('Could not apply code: ' + err);
                }
              }).catch(function () {
                reenableForRetry('Network error — please try again.');
              });
            }
            apply.addEventListener('click', tryCoupon);
            input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); tryCoupon(); } });
          };
          window.initReportCoupon();
        </script>` : "";
    cta = `
      <div class="cta-panel">
        <span class="upgrade-chip">↑ FULL DIAGNOSTIC · $47</span>
        <p class="eyebrow gold">FROM SIGNALS TO THE FULL PICTURE</p>
        <h2>You know what deserves attention.<br><em>Now find out what's actually driving it.</em></h2>
        <p class="sub">Your Full Diagnostic goes deeper into cash flow, debt, profitability, receivables, financial visibility, and growth capacity. Then a CFO by Design strategist reviews the findings with you and helps identify what deserves action first.</p>
        <p class="sub" style="font-size:14px;color:var(--ink-dim);margin-top:-16px;">Full financial diagnostic · prioritized findings · financial tools · live 30-minute strategist review</p>
${couponRow}
        <a class="btn btn-primary" id="upgrade-cta" target="_top" href="${paymentLink47}" data-payment-href="${paymentLink47}" data-beta-href="${upgrade47Href}">
          <span id="upgrade-label">Get My Full Diagnostic + Strategist Review — $47</span>
          <span class="arrow">→</span>
        </a>
        <p class="micro" id="upgrade-micro">One-time payment · No subscription · Includes your live strategist review</p>
      </div>`;
  } else if (tier === "paid_47") {
    // The paid_47 CTA leads with the INCLUDED strategist review that the
    // customer already paid for. The $297 Business Growth Analysis link
    // is subordinated below — a next-tier reveal, not a competing primary.
    //
    // Rationale: the low-ticket $47 purchase should flow into its
    // included consultation first; stacking a $297 offer in front of
    // the included call makes the $47 feel like a paid sales funnel.
    // The strategist is the right person to introduce the next tier
    // contextually ("based on what we uncovered, here's where I'd go
    // next") — the report page should not pre-empt that conversation.
    const deepDiveSalesHref = (env && env.DEEP_DIVE_SALES_URL) || upgrade297Href;
    cta = `
      <div class="cta-panel">
        <span class="upgrade-chip">◆ YOUR NEXT STEP · INCLUDED</span>
        <p class="eyebrow gold">LIVE STRATEGIST REVIEW</p>
        <h2>You have the findings.<br><em>Now let's decide what deserves action first.</em></h2>
        <p class="sub">Your CFO by Design strategist will walk through the diagnostic with you, clarify the most important findings, and help you identify the first financial move worth addressing.</p>

        <a class="btn btn-primary" target="_top" href="${bookingLink47}" style="margin:12px 0 8px;">
          <span>Book My Included Strategist Review</span>
          <span class="arrow">→</span>
        </a>
        <p class="micro">30 minutes · Included with your Full Diagnostic</p>

        <div style="margin-top:36px; padding-top:28px; border-top:1px solid var(--line);">
          <p class="sub" style="font-size:14px;color:var(--ink-mute);margin:0 0 14px;">Ready for a deeper team review and written 90-day plan?</p>
          <a class="btn btn-secondary" target="_top" href="${deepDiveSalesHref}">Explore the Business Growth Analysis <span class="arrow">→</span></a>
        </div>
      </div>`;
  } else if (tier === "paid_297") {
    cta = `
      <div class="cta-panel">
        <p class="eyebrow gold">FINAL STEP · BOOK YOUR BGA SESSION</p>
        <h2>Your Business Growth Plan is <em>ready.</em></h2>
        <p class="sub">Pick a time below for your 50-minute session with your strategist. We'll walk the plan together and start execution.</p>
        <div class="cfobd-calendar" style="max-width:820px;margin:24px auto 0;background:#fafaf7;border:1px solid var(--line);border-radius:10px;overflow:hidden;">
          <iframe
            src="${bookingLink297}${emailParam}"
            style="width:100%;min-height:820px;border:0;display:block;"
            title="Book your 50-minute Business Growth Analysis session"
            loading="lazy"
            allow="clipboard-write"></iframe>
        </div>
        <p class="micro" style="margin-top:22px;">
          Trouble with the calendar?
          <a class="ghost-link" target="_top" href="${bookingLink297}${emailParam}">Open booking →</a>
        </p>
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(tierLabel)} — CFO by Design</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;1,500;1,600&display=swap" rel="stylesheet">
<style>
  :root {
    --bg:#0a0e14; --card:#12181f; --line:#1e2632;
    --ink:#f2ecdf; --ink-mute:#a8b0bd; --ink-dim:#6d7480;
    --gold:#d4b565; --gold-bright:#f2c94c; --green:#4ade80;
    --serif:'Playfair Display',Georgia,serif;
    --sans:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Helvetica,Arial,sans-serif;
    --mono:ui-monospace,'SF Mono',Menlo,Consolas,monospace;
  }
  *,*::before,*::after { box-sizing:border-box; }
  html,body { margin:0; padding:0; }
  body { background:var(--bg); color:var(--ink); font-family:var(--sans); font-size:16px; line-height:1.6; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:820px; margin:0 auto; padding:0 24px; }

  .topbar { padding:24px 0; border-bottom:1px solid rgba(255,255,255,0.05); }
  .topbar .wrap { display:flex; align-items:center; justify-content:space-between; gap:20px; }
  .logo img { height:52px; width:auto; display:block; }
  .tier-chip { font-family:var(--mono); font-size:11px; letter-spacing:0.22em; text-transform:uppercase; color:var(--green); }

  .hello { padding:40px 0 24px; text-align:center; }
  .hello .eyebrow { font-family:var(--mono); font-size:12px; letter-spacing:0.22em; text-transform:uppercase; color:var(--green); margin:0 0 12px; }
  .hello h1 { font-family:var(--serif); font-weight:600; font-size:clamp(28px,4vw,42px); line-height:1.1; margin:0; }
  .hello h1 em { font-style:italic; color:var(--gold); font-weight:500; }

  .report-card {
    background:#fafaf7; color:#1a1a1a;
    max-width:820px; margin:24px auto 0;
    padding:44px 40px; border-radius:12px;
    box-shadow:0 20px 60px rgba(0,0,0,0.35);
    border:1px solid rgba(212,181,101,0.15);
  }
  .report-card a { color:#92400e; }

  .cta-panel {
    max-width:820px; margin:32px auto 0;
    padding:44px 36px 40px;
    background:linear-gradient(180deg, rgba(212,181,101,0.06), rgba(212,181,101,0.02));
    border:1px solid var(--line); border-radius:12px;
    text-align:center;
  }
  .cta-panel .coupon-row {
    max-width:440px; margin:22px auto 24px; text-align:center;
  }
  .cta-panel .coupon-label {
    display:block; font-family:var(--mono); font-size:11px; letter-spacing:0.18em; text-transform:uppercase;
    color:var(--ink-mute); margin:0 0 8px;
  }
  .cta-panel .coupon-inputgroup {
    display:flex; gap:8px; justify-content:center; align-items:stretch;
  }
  .cta-panel .coupon-inputgroup input {
    flex:1; min-width:0; padding:11px 14px; border-radius:6px;
    background:rgba(255,255,255,0.04); border:1px solid var(--line);
    color:var(--ink); font-family:var(--sans); font-size:14px; letter-spacing:0.05em;
    outline:none; transition:border-color .15s;
  }
  .cta-panel .coupon-inputgroup input:focus { border-color:var(--gold); }
  .cta-panel .coupon-inputgroup input:disabled { opacity:.6; cursor:not-allowed; }
  .cta-panel .coupon-inputgroup button {
    padding:11px 18px; border-radius:6px; border:1px solid var(--line);
    background:transparent; color:var(--ink); font-family:var(--sans); font-weight:600; font-size:13px;
    cursor:pointer; transition:border-color .15s, color .15s;
  }
  .cta-panel .coupon-inputgroup button:hover:not(:disabled) { border-color:var(--gold); color:var(--gold); }
  .cta-panel .coupon-inputgroup button:disabled { opacity:.6; cursor:not-allowed; }
  .cta-panel .coupon-msg { margin:8px 0 0; font-family:var(--mono); font-size:11px; letter-spacing:0.05em; min-height:14px; }
  .cta-panel .coupon-msg.ok  { color:var(--green); }
  .cta-panel .coupon-msg.err { color:var(--red); }
  .cta-panel .upgrade-chip {
    display:inline-block; padding:6px 14px; margin:0 0 18px;
    background:rgba(74,222,128,0.10); border:1px solid rgba(74,222,128,0.35);
    color:var(--green); border-radius:999px;
    font-family:var(--mono); font-size:11px; letter-spacing:0.22em; text-transform:uppercase; font-weight:600;
  }
  .cta-panel .eyebrow { font-family:var(--mono); font-size:12px; letter-spacing:0.22em; text-transform:uppercase; margin:0 0 14px; color:var(--green); }
  .cta-panel .eyebrow.gold { color:var(--gold); }
  .cta-panel h2 { font-family:var(--serif); font-weight:600; font-size:clamp(24px,3vw,32px); line-height:1.2; margin:0 0 16px; color:var(--ink); }
  .cta-panel h2 em { font-style:italic; color:var(--gold); font-weight:500; }
  .cta-panel .sub { color:var(--ink-mute); font-size:15.5px; line-height:1.55; max-width:600px; margin:0 auto 28px; }
  .cta-panel .micro { color:var(--ink-dim); font-size:13px; margin:18px 0 0; }
  .cta-panel .ghost-link { color:var(--gold); text-decoration:underline; }

  .btn {
    display:inline-flex; align-items:center; gap:10px;
    padding:14px 28px; border-radius:6px; border:1px solid transparent;
    font-family:var(--sans); font-weight:600; font-size:15px;
    text-decoration:none; cursor:pointer; transition:transform .15s, background .15s;
  }
  .btn-primary { background:var(--gold-bright); color:#0a0e14; border-color:var(--gold-bright); }
  .btn-primary:hover { background:#f8d363; transform:translateY(-1px); }
  .btn-secondary {
    background:transparent; color:var(--ink-mute); border-color:var(--line);
    font-weight:500;
  }
  .btn-secondary:hover { color:var(--gold); border-color:var(--gold); background:rgba(212,181,101,0.04); }
  .btn .arrow { font-size:18px; line-height:1; }

  .footer { text-align:center; padding:36px 24px 30px; margin-top:48px; border-top:1px solid rgba(255,255,255,0.05); font-family:var(--mono); font-size:11px; letter-spacing:0.22em; text-transform:uppercase; color:var(--ink-dim); }
  .footer a { color:var(--ink-dim); text-decoration:none; margin:0 10px; }
  .footer a:hover { color:var(--gold); }
</style>
</head>
<body>
  <header class="topbar">
    <div class="wrap">
      <span class="logo"><img src="${logoSrc}" alt="CFO by Design"></span>
      <span class="tier-chip">${e(tierLabel).toUpperCase()}</span>
    </div>
  </header>

  <section class="hello">
    <div class="wrap">
      <p class="eyebrow">${isPending ? "◆ SOLOMON IS DIAGNOSING · GENERATING YOUR REPORT" : headerBlock.eyebrow}</p>
      <h1>${isPending
        ? `${e(firstName)}, your <em>diagnostic</em> is on the way.`
        : headerBlock.hello}</h1>
    </div>
  </section>

  <div class="report-card">
    ${reportBody}
  </div>

  ${isPending ? "" : cta}
  ${couponScript}

  <footer class="footer">
    CFO by Design · cfobydesign.com
    · <a href="mailto:support@cfobydesign.com">Contact</a>
    · <a href="https://www.cfobydesign.com/privacy">Privacy</a>
    · <a href="https://success.cfobydesign.com/tc-page">Terms</a>
  </footer>
  <script>
    // Iframe auto-resize bridge — mirrors app/src/lib/iframe-resize.ts on
    // the React side so a GHL funnel page that embeds /report/{cid} can
    // resize the iframe to fit content and eliminate nested scrollbars.
    // No-op when NOT embedded (window.self === window.top).
    (function () {
      try {
        if (window.self === window.top) return;
      } catch (_) { /* cross-origin — treat as embedded */ }
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      var scheduled = false;
      function post() {
        // Intrinsic content height only. Both offsetHeight AND scrollHeight
        // on <html>/<body> can adopt the imposed iframe height (scrollHeight
        // is max(children box, own client height); any 100vh/percentage-height
        // wrapper carries that floor). Measure the bottom edge of body's
        // tallest direct child via getBoundingClientRect instead — that reads
        // the actual rendered box regardless of the imposed root height.
        var body = document.body;
        var bottom = 0;
        for (var i = 0; i < body.children.length; i++) {
          var r = body.children[i].getBoundingClientRect();
          if (r.bottom > bottom) bottom = r.bottom;
        }
        var h = bottom > 0 ? Math.ceil(bottom + window.scrollY) : body.scrollHeight;
        window.parent.postMessage({ type: 'cfobd-iframe-height', height: h }, '*');
      }
      function schedule() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function () { scheduled = false; post(); });
      }
      window.addEventListener('load', schedule);
      window.addEventListener('resize', schedule);
      try {
        new MutationObserver(schedule).observe(document.body, {
          subtree: true, childList: true, attributes: true, characterData: true
        });
      } catch (_) {}
      try {
        if (typeof ResizeObserver !== 'undefined') new ResizeObserver(schedule).observe(document.body);
      } catch (_) {}
      var polls = 0;
      var pid = setInterval(function () {
        schedule();
        if (++polls >= 20) clearInterval(pid);
      }, 500);
      schedule();
    })();
  </script>
</body>
</html>`;
}

// Call Claude for a Solomon generation and parse the result as JSON,
// with ONE regeneration attempt on parse failure. The regeneration
// turn passes the model its own prior (malformed) response as
// `priorAssistant` and a focused nudge as `followupUser` so the model
// sees exactly what it emitted and the exact fix. This covers the
// malformed-JSON failure mode Liz hit in production (position-6246
// parse error reaching the client as a 500) without needing a code
// change every time the model finds a new way to break JSON.
//
// Fail path: if the retry also fails to parse, throws the SECOND
// parse error — the first attempt's error is already in writeQueueTrace
// via the caller, and the retry's error is the one worth bubbling up
// (it's what the model emitted after seeing its own mistake).
async function callClaudeAndParseWithRetry({ env, contactId, prompt, rubric, callOpts, trace }) {
  const raw = await callClaudeWithRubric(prompt, rubric, env, callOpts);
  try {
    return { raw, agent: parseAgentJson(raw) };
  } catch (firstErr) {
    const traceFn = typeof trace === "function" ? trace : (() => {});
    try { await traceFn("agent_json_parse_failed", { attempt: 1, error: String(firstErr?.message || firstErr).slice(0, 300), rawBytes: raw?.length || 0 }); } catch (_) {}
    const nudge =
      "Your previous response could not be parsed as JSON. The parser said: " +
      String(firstErr?.message || firstErr).slice(0, 300) +
      ". Return ONLY a single JSON object matching the schema from your original instructions. " +
      "Escape every double-quote inside a string value as \\\". Do not use literal newlines, tabs, or carriage returns inside string values — use \\n, \\t, \\r. " +
      "Do not emit trailing commas before } or ]. No prose before or after the JSON. No code fences. The whole output must be valid JSON on its own.";
    const retryRaw = await callClaudeWithRubric(prompt, rubric, env, {
      ...(callOpts || {}),
      priorAssistant: raw,
      followupUser: nudge,
    });
    try {
      const retryAgent = parseAgentJson(retryRaw);
      try { await traceFn("agent_json_parse_recovered", { attempt: 2, rawBytes: retryRaw?.length || 0 }); } catch (_) {}
      return { raw: retryRaw, agent: retryAgent };
    } catch (secondErr) {
      try { await traceFn("agent_json_parse_failed", { attempt: 2, error: String(secondErr?.message || secondErr).slice(0, 300), rawBytes: retryRaw?.length || 0 }); } catch (_) {}
      throw secondErr;
    }
  }
}

// Tolerant JSON extraction — strips fences / preamble if the model adds any.
// Also runs a conservative repair pass when strict JSON.parse fails: the
// most common failure in production is that the model echoed quoted
// customer text (Q7 referral language is literally a quote) into a string
// value without escaping the inner `"` characters. Repair walks the
// extracted slice as a state machine and `\`-escapes stray quotes that
// appear mid-string, then retries JSON.parse. If repair still fails, we
// throw the ORIGINAL parse error (not the post-repair one) so the caller
// sees the real position.
function parseAgentJson(text) {
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Agent returned no JSON object");
  const slice = t.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (firstErr) {
    const repaired = repairAgentJson(slice);
    if (repaired !== slice) {
      try {
        return JSON.parse(repaired);
      } catch (_secondErr) {
        // fall through to original error
      }
    }
    throw firstErr;
  }
}

// Repair pass: escape stray unescaped `"` characters that appear INSIDE
// JSON string literals. Walks the text as a state machine (outside /
// inside string). When inside a string, if we see a `"` that is NOT
// followed by a JSON structural continuation, it's an unescaped inner
// quote — escape it.
//
// Terminator decision uses TWO look-aheads (Codex P1 on #138):
//   - `:` or EOF after the quote → always a terminator (end-of-key /
//     end-of-document).
//   - `}` or `]` after the quote → terminator ONLY when what follows
//     the close is itself a JSON continuation (`,` `}` `]` `:` or EOF).
//     Reject `}` followed by `great` or by prose.
//   - `,` after the quote → terminator ONLY when the next non-whitespace
//     char AFTER the comma is itself a JSON value start (`"`, `{`, `[`,
//     `}`, `]`, `-`, a digit, `t`/`f`/`n` for true/false/null) or EOF.
//     Reject `,` followed by " which earned referrals." — that's prose,
//     the comma is inside the string.
//
// Deliberately conservative: it only fires on characters that cannot be
// the real end of a string value in the shapes we emit. Does NOT try to
// fix stray newlines, trailing commas, or other classes of malformed
// JSON — those are rare in production and the model is otherwise
// disciplined. See parse_agent_json_repair.test.js for cases.
function repairAgentJson(src) {
  const isWs = (c) => c === " " || c === "\t" || c === "\n" || c === "\r";
  const isDigitStart = (c) => c === "-" || (c >= "0" && c <= "9");
  // Characters that legitimately start a JSON value (after a `,`).
  const isValueStart = (c) =>
    c === '"' || c === "{" || c === "[" || c === "}" || c === "]" ||
    c === "t" || c === "f" || c === "n" || isDigitStart(c) || c === "";
  // Characters that legitimately follow a `}` or `]` (continuation of
  // the enclosing JSON structure).
  const isAfterCloseOk = (c) =>
    c === "," || c === "}" || c === "]" || c === ":" || c === "";

  const out = [];
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (!inStr) {
      // 2026-10-29: strip trailing commas before `}` or `]`. Model
      // output occasionally emits `, }` or `, ]` after the last
      // property / array element; standard JSON.parse rejects those
      // but the shape is otherwise valid. Walk the already-emitted
      // output backwards past whitespace; if the previous
      // non-whitespace char is a `,`, drop it before writing the
      // closer.
      if (ch === "}" || ch === "]") {
        let j = out.length - 1;
        while (j >= 0 && isWs(out[j])) j--;
        if (j >= 0 && out[j] === ",") out.splice(j, 1);
      }
      out.push(ch);
      if (ch === '"') inStr = true;
      continue;
    }
    // inside a string
    if (escaped) {
      out.push(ch);
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out.push(ch);
      escaped = true;
      continue;
    }
    // 2026-10-29: a literal newline / tab / carriage return inside a
    // JSON string literal is invalid (JSON requires `\n`/`\t`/`\r`
    // escape sequences). Prose-heavy models occasionally break a long
    // string across lines without escaping; escape the raw control
    // character so the parser accepts the string.
    if (ch === "\n") { out.push("\\n"); continue; }
    if (ch === "\t") { out.push("\\t"); continue; }
    if (ch === "\r") { out.push("\\r"); continue; }
    if (ch === '"') {
      // Look ahead past whitespace for the next non-space character.
      let j = i + 1;
      while (j < src.length && isWs(src[j])) j++;
      const next = j < src.length ? src[j] : "";
      let isTerminator = false;
      if (next === "" || next === ":") {
        // End-of-key or end-of-document — always a terminator.
        isTerminator = true;
      } else if (next === "}" || next === "]") {
        // Terminator ONLY if the close is itself followed by valid
        // continuation. `"foo"}` inside prose where the `}` is actually
        // literal text would fall out here (next-after-close would be
        // a word character and fail isAfterCloseOk).
        let k = j + 1;
        while (k < src.length && isWs(src[k])) k++;
        const afterClose = src[k] || "";
        isTerminator = isAfterCloseOk(afterClose);
      } else if (next === ",") {
        // Terminator ONLY if the comma is followed by a JSON value
        // start (next key, next array element, close, or EOF). Rejects
        // `", which earned referrals."` — a comma followed by prose.
        let k = j + 1;
        while (k < src.length && isWs(src[k])) k++;
        const afterComma = src[k] || "";
        isTerminator = isValueStart(afterComma);
      }
      if (isTerminator) {
        out.push(ch);
        inStr = false;
      } else {
        out.push('\\"');
      }
      continue;
    }
    out.push(ch);
  }
  return out.join("");
}

// Mutates agent.structured_findings in place: non-arrays are forced to
// [] (logged); each entry is validated against the deterministic facts
// and derived metrics; invalid entries are stripped. Call sites: every
// generation path that writes an agent to canonical storage or the
// renderer. Without this, a run that has no FACTS context (console runs,
// catalog-unavailable webhook) could still carry a model-produced
// `structured_findings` into the stored diagnostic, where Phase 2D's
// renderer would show it as if it were validated.
//
// Pass an empty normalized / derivedMetrics context when none is
// available — every finding is then evaluated with no facts to cite
// against. "No evidence that exists" fails the validator's
// grounded-in-nothing rule, which is the desired safety behavior.
function sanitizeStructuredFindings(agent, context, logLabel) {
  if (!agent || typeof agent !== "object") return;
  const raw = agent.structured_findings;
  if (raw === undefined || raw === null) return;
  if (!Array.isArray(raw)) {
    console.warn(`[${logLabel}] structured_findings is not an array (type=${typeof raw}); replacing with []`);
    agent.structured_findings = [];
    return;
  }
  const { valid, invalid } = validateStructuredFindings(raw, {
    normalized: context?.normalized || {},
    derivedMetrics: context?.derivedMetrics || [],
  });
  if (invalid.length) {
    console.warn(
      `[${logLabel}] stripped ${invalid.length} invalid structured_findings: ` +
      invalid.map((x) => `${x.finding?.finding_id || "<no id>"} (${x.reasons.join("; ")})`).join(" | ")
    );
  }
  agent.structured_findings = valid;
}

// Accept answers as an array [{question, answer}] OR an object { "Q1": "..." }.
function normalizeAnswers(raw) {
  if (Array.isArray(raw)) {
    return raw
      .filter((a) => a && (a.answer !== undefined && a.answer !== ""))
      .map((a) => ({ question: String(a.question || a.id || "Question"), answer: String(a.answer) }));
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => ({ question: k, answer: String(v) }));
  }
  return [];
}

// ---------- Canonical record (D1 + R2) ----------
// Phase 1b: after Solomon generates a report, write the whole-answer
// snapshot + diagnostic + R2 HTML artifact to the canonical store, then
// let the live GHL writeback happen as before. GHL writeback stays the
// primary user-facing path — a D1 or R2 failure must NOT break the live
// flow. When the D1 binding is missing (fresh deploy before `wrangler d1
// create` has been run), these helpers return a `{skipped:true}` sentinel
// so the request path is a no-op. The /report read path still falls back
// to GHL custom fields in Phase 1b; Phase 1c switches reads to D1.
//
// Dry runs never land in canonical history. A test run (body.dry_run:true)
// must not create a row that a strategist could later mistake for a real
// customer event.

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Immutable R2 artifact for one generated report. Keyed under
// reports/{contact_id}/{report_id}/report.html; the pair of contact+report
// is enough to find the artifact without a D1 lookup. Returns the metadata
// trio the report_versions row needs, or null when the binding is missing
// or the put failed. Callers continue even on null — HTML still lives in
// the GHL custom field through Phase 1c and the diagnostic JSON is in D1.
async function writeReportArtifact(env, { contactId, reportId, html }) {
  const bucket = env?.SOLOMON_REPORTS;
  if (!bucket) return null;
  const key = `reports/${contactId}/${reportId}/report.html`;
  const bodyBytes = new TextEncoder().encode(html || "");
  try {
    const sha256 = await sha256Hex(bodyBytes);
    await bucket.put(key, bodyBytes, {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
      customMetadata: {
        contact_id: contactId,
        report_id: reportId,
        generated_at: String(Date.now()),
      },
    });
    return { r2_html_key: key, r2_html_bytes: bodyBytes.byteLength, r2_html_sha256: sha256 };
  } catch (err) {
    console.error(`[writeReportArtifact] R2 put failed for ${key}: ${err?.message || err}`);
    return null;
  }
}

// Write the canonical record for a Solomon generation: one `submissions`
// row (whole-answer snapshot) + one `report_versions` row + the R2 HTML
// artifact. All writes are best-effort; a failure logs and returns
// `{ok:false}` without throwing. Returns `{skipped:true, reason}` when:
//   - dryRun is true
//   - the D1 binding is missing
//   - no contactId is available (synthetic console test)
//
// Phase 2 will populate `normalized_answers`, `derived_metrics`, and the
// `validation` object with real content; Phase 1b stores nulls / minimal
// shells and gets the write path landed.
async function writeCanonicalRecord(env, args) {
  const {
    contact, tier, answers, agent, reportHtml, sourceEventId, dryRun,
    normalizedAnswers, derivedMetrics,
  } = args;
  if (dryRun) return { skipped: true, reason: "dry_run" };
  if (!contact?.id) return { skipped: true, reason: "no_contact_id" };
  const db = dbFromEnv(env);
  if (!db) return { skipped: true, reason: "no_db_binding" };

  const submissionId = newSubmissionId();
  const reportId = newReportId();

  try {
    // 1. Submissions row — the whole-answer snapshot (Answer snapshot
    //    contract). Later owner edits to GHL fields never mutate this.
    const subResult = await insertSubmission(db, {
      id: submissionId,
      contact_id: contact.id,
      tier,
      assessment_version: ASSESSMENT_VERSION,
      source_event_id: sourceEventId || null,
      raw_answers: answers,
      // Phase 2A: normalized entries land here when the caller computed
      // them (webhook path). Console runs still pass undefined (no
      // field-id stream to normalize from); their canonical row stores
      // null for normalized_answers_json and Phase 2B will skip derived
      // metrics for those rows.
      normalized_answers: normalizedAnswers === undefined ? undefined : normalizedAnswers,
      derived_metrics: derivedMetrics === undefined ? undefined : derivedMetrics,
      validation: { complete: true, missing_fields: [], warnings: [] },
      status: "ready",
    });
    if (subResult?.duplicate) {
      // Durable idempotency: a webhook retry carrying the same source_event_id
      // hit the UNIQUE index. Report that back to the caller rather than
      // inserting a second report_versions row against a stranger's submission.
      return { skipped: true, reason: "duplicate_submission", source_event_id: sourceEventId };
    }

    // 2. R2 HTML artifact — immutable. Null when the bucket binding is
    //    missing or the put failed; the report_versions row still records
    //    the generation, just without an artifact reference.
    const r2 = await writeReportArtifact(env, {
      contactId: contact.id,
      reportId,
      html: reportHtml || "",
    });

    // 3. report_versions row — immutable record of this generation.
    //    report_version starts at 1 and increments per submission.
    const reportVersion = await nextReportVersion(db, submissionId);
    await insertReportVersion(db, {
      id: reportId,
      submission_id: submissionId,
      contact_id: contact.id,
      tier,
      report_version: reportVersion,
      classification: agent?.path || null,
      diagnostic: agent,
      strategist_brief: agent?.strategistBrief ? { brief: String(agent.strategistBrief) } : null,
      prompt_version: PROMPT_VERSION,
      rubric_version: RUBRIC_VERSION,
      model_version: CONFIG.CLAUDE_MODEL,
      code_version: env?.CODE_VERSION || null,
      r2_html_key: r2?.r2_html_key || null,
      r2_html_bytes: r2?.r2_html_bytes || null,
      r2_html_sha256: r2?.r2_html_sha256 || null,
      is_successful: true,
    });

    return {
      ok: true,
      submissionId,
      reportId,
      reportVersion,
      r2_html_key: r2?.r2_html_key || null,
    };
  } catch (err) {
    // Canonical write failure is a telemetry concern, not a user-facing
    // failure. GHL writeback is still primary at Phase 1b; the live flow
    // continues.
    console.error(`[writeCanonicalRecord] D1 write failed for contact ${contact.id}: ${err?.message || err}`);
    return { ok: false, error: String(err?.message || err) };
  }
}

// Record the outcome of a GHL writeback attempt in the append-only
// ghl_sync log. Called from the ctx.waitUntil chain so it never blocks
// the response; skips cleanly if D1 isn't wired or if no reportId was
// produced (writeCanonicalRecord returned skipped).
async function recordGhlWriteback(env, { reportId, contactId, status, error }) {
  if (!reportId || !contactId) return { skipped: true, reason: "no_report_id" };
  const db = dbFromEnv(env);
  if (!db) return { skipped: true, reason: "no_db_binding" };
  try {
    return await recordGhlSyncAttempt(db, {
      report_id: reportId,
      contact_id: contactId,
      status,
      error: error || null,
    });
  } catch (err) {
    console.error(`[recordGhlWriteback] insert failed: ${err?.message || err}`);
    return { ok: false, error: String(err?.message || err) };
  }
}

// Intake-completeness gate shared between the GHL survey webhook and any
// future caller that needs to decide whether a tier's answer set is complete
// enough to run Solomon on. Three-layer validation architecture per customer
// directive (2026-10-17):
//
//   BROWSER     — Q1-Q11 cannot advance without valid input (QuestionCard
//                 validateNarrativeAnswer + the required flag on every
//                 FreeAssessmentQuestion).
//   SERVER      — this gate. Rejects malformed/incomplete current free
//                 submissions by deferring the webhook until all expected
//                 fields have landed (handles GHL webhook timing where some
//                 custom-field writes land seconds after the form submits).
//   SOLOMON     — the rubric knows how to interpret valid short selections,
//                 meaningful narrative answers, honest uncertainty, and
//                 historical incomplete records via HANDLING INCOMPLETE
//                 OR NON-RESPONSIVE ANSWERS + FREE HEALTH CHECK COMPLETENESS
//                 CONTRACT in TIER_GUIDE.free.
//
// Free tier floor is 11 because every Q1-Q11 field is required at the
// browser layer, so a legitimate current submission always carries all 11.
// Paid floors stay below real-world question count so an operator omitting
// one or two optional questions doesn't trip the gate.
//
// FREE-tier identity check (Codex P1 on #137 fix): counting bare
// `answers.length` is wrong because `answersFromContactFields` includes
// every populated non-Solomon custom field with a catalog label — a
// contact with 10 real Q1-Q11 answers + 1 unrelated CRM field would
// have cleared the old count-only threshold and shipped an incomplete
// intake. The gate now also accepts the raw customFields array (via
// `opts.rawCustomFields`) and, on the free tier, counts how many of
// the known FREE_INTAKE_FIELD_IDS actually carry a non-empty value.
// Fallback path (no raw fields supplied) uses the count check so
// older callers keep working.
//
// Historical-submission bypass (Codex P2 on #137 fix): `opts.allowPartial`
// forces `ok: true` regardless of the count/identity check. Intended
// for manual reruns against pre-contract contacts — Solomon's HANDLING
// INCOMPLETE OR NON-RESPONSIVE ANSWERS rules then take over per the
// r3.6 rubric. Returns { ok, answersSeen, minExpected, tier, partial }.

// GHL custom-field IDs for Q1-Q11, in order. Sourced from
// app/src/data/freeAssessmentQuestions.ts fieldKey values. If any one
// of these moves in GHL, update it here AND in the TypeScript data
// file in the same change — the intake_catalog.test.js suite will
// surface drift at CI time either way.
const FREE_INTAKE_FIELD_IDS = Object.freeze([
  "5VWVNRrQYcLqXhckh4f4", // Q1  Business Type
  "nCRqWH0x1sdJIgUPDr2E", // Q2  Customer Reach
  "nbPL6APmjrjr43J6urVb", // Q3  Industry / Vertical
  "OyQjw4nGNHJYADsq5ggg", // Q4  Debt / Tax / Lien / Judgment Status
  "8sSKohKtQZZzJEtM2ju0", // Q5  Decision Making Basis
  "deItnw0p1H7sO1okRjGS", // Q6  Unique Value Proposition
  "hV9yij5uFitztZzanSaa", // Q7  Referral Language
  "ngBePHf4iKPhaHm2OtSv", // Q8  Revenue Leaks
  "cvuAgfuL94eBahOrnTY0", // Q9  Hidden Profit Opportunity
  "cdlV9zqJxztcxfXgD4J0", // Q10 Market Opportunity
  "qKRvCyjprebbK75tC05h", // Q11 Single Point of Failure
]);
const FREE_INTAKE_FIELD_ID_SET = new Set(FREE_INTAKE_FIELD_IDS);

const INTAKE_MIN_ANSWERS = Object.freeze({ free: 11, paid_47: 10, paid_297: 12 });
function checkIntakeCompleteness(answers, tier, opts = {}) {
  // Historical-submission bypass: manual reruns against pre-contract
  // contacts should proceed to Solomon's INCOMPLETE INTAKE handling
  // rather than loop on a 409 forever.
  if (opts.allowPartial) {
    const answersSeen = Array.isArray(answers) ? answers.length : 0;
    return {
      ok: true,
      answersSeen,
      minExpected: INTAKE_MIN_ANSWERS[tier] || 0,
      tier: tier || null,
      partial: true,
    };
  }

  const minExpected = INTAKE_MIN_ANSWERS[tier] || 0;

  // Free-tier identity check: when the caller supplies the raw
  // customFields array, count only the Q1-Q11 field IDs that actually
  // carry a non-empty value. This prevents 10 real intake answers + an
  // unrelated populated CRM field from clearing an "answers.length >= 11"
  // threshold with incomplete intake.
  if (tier === "free" && Array.isArray(opts.rawCustomFields) && opts.rawCustomFields.length) {
    const populatedFreeIds = new Set();
    for (const f of opts.rawCustomFields) {
      if (!f || !f.id || !FREE_INTAKE_FIELD_ID_SET.has(f.id)) continue;
      const val = typeof f.value === "string" ? f.value.trim() : (f.value != null ? String(f.value).trim() : "");
      if (val) populatedFreeIds.add(f.id);
    }
    return {
      ok: populatedFreeIds.size >= FREE_INTAKE_FIELD_IDS.length,
      answersSeen: populatedFreeIds.size,
      minExpected: FREE_INTAKE_FIELD_IDS.length,
      tier,
      identityCheck: true,
    };
  }

  // Fallback: pure count check (backwards compat for callers without
  // the raw customFields array, and for paid tiers where identity-based
  // field discovery is noisier).
  const answersSeen = Array.isArray(answers) ? answers.length : 0;
  return {
    ok: !minExpected || answersSeen >= minExpected,
    answersSeen,
    minExpected,
    tier: tier || null,
  };
}

async function updateGHLContact(contactId, fields, env, opts = {}) {
  if (!contactId || !env.GHL_API_KEY) return false;
  if (opts.dryRun) {
    console.log(`[DRY_RUN] updateGHLContact skipped contactId=${contactId} fieldCount=${fields?.length || 0}`);
    return true;
  }
  const res = await fetch(`${CONFIG.GHL_API_BASE}/contacts/${contactId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GHL_API_KEY}`,
      Version: "2021-07-28",
    },
    body: JSON.stringify({ customFields: fields }),
  });
  return res.ok;
}

// Find an existing contact by email in the configured location. Returns its id or null.
async function findGHLContactByEmail(email, env) {
  if (!email || !env.GHL_API_KEY) return null;
  const url = `${CONFIG.GHL_API_BASE}/contacts/search/duplicate?locationId=${(env.GHL_LOCATION_ID || CONFIG.GHL_LOCATION_ID)}&email=${encodeURIComponent(email)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GHL_API_KEY}`,
      Version: "2021-07-28",
    },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data?.contact?.id || data?.id || null;
}

// Create a contact in the configured location. Returns the new id or null.
async function createGHLContact(contact, env) {
  if (!env.GHL_API_KEY) return null;
  const body = {
    locationId: (env.GHL_LOCATION_ID || CONFIG.GHL_LOCATION_ID),
    email: contact.email,
    firstName: (contact.name || "").split(" ")[0] || undefined,
    lastName: (contact.name || "").split(" ").slice(1).join(" ") || undefined,
    source: "SWOT Funnel",
  };
  const res = await fetch(`${CONFIG.GHL_API_BASE}/contacts/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GHL_API_KEY}`,
      Version: "2021-07-28",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data?.contact?.id || data?.id || null;
}

// Resolve a contactId:
//   - contactId in the payload wins (the intended target is unambiguous)
//   - else lookup by email
//   - creating a new contact is now OPT-IN via mode="create_if_missing" to
//     prevent Solomon from silently minting contacts from public POSTs or
//     console tools. Default "match_only" returns null when no match found;
//     callers can decide whether that's a hard error, a silent skip, or
//     grounds for an explicit upsert flow (see upsertGHLContactByEmail).
//
// Only /apply-solomon50's beta-cohort upsert path is authorized to use
// create_if_missing — every other write site must know its target contactId
// so paid entitlements and email-trigger tags can never land on a contact
// the caller didn't intend.
async function resolveGHLContactId(contact, env, mode = "match_only") {
  if (contact?.contactId) return contact.contactId;
  if (!contact?.email) return null;
  const existing = await findGHLContactByEmail(contact.email, env);
  if (existing) return existing;
  if (mode === "create_if_missing") return await createGHLContact(contact, env);
  return null;
}

async function addGHLTag(contactId, tags, env, opts = {}) {
  if (!contactId || !env.GHL_API_KEY || !tags.length) return false;
  if (opts.dryRun) {
    console.log(`[DRY_RUN] addGHLTag skipped contactId=${contactId} tags=${tags.join(",")}`);
    return true;
  }
  const res = await fetch(`${CONFIG.GHL_API_BASE}/contacts/${contactId}/tags`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GHL_API_KEY}`,
      Version: "2021-07-28",
    },
    body: JSON.stringify({ tags }),
  });
  return res.ok;
}

// Bulk-remove tags from a GHL contact. Used by /reset-contact-tags when Liz
// wants to clear a contact's swot_* / path / opportunity / console_test tags
// to re-run a test or reset a real customer's lifecycle.
async function removeGHLTags(contactId, tags, env) {
  if (!contactId || !env.GHL_API_KEY || !tags.length) return false;
  const res = await fetch(`${CONFIG.GHL_API_BASE}/contacts/${contactId}/tags`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GHL_API_KEY}`,
      Version: "2021-07-28",
    },
    body: JSON.stringify({ tags }),
  });
  return res.ok;
}

// Post a note on a GHL contact card. Preferred over adding tags for
// human-readable audit trails ("Solomon ran a Full SWOT for this contact on
// 2026-09-16") — notes appear in the Notes tab of the contact card and are
// searchable, unlike a tag column that gets cluttered fast.
async function addGHLNote(contactId, body, env) {
  if (!contactId || !env.GHL_API_KEY || !body) return false;
  const res = await fetch(`${CONFIG.GHL_API_BASE}/contacts/${contactId}/notes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GHL_API_KEY}`,
      Version: "2021-07-28",
    },
    body: JSON.stringify({ body: String(body).slice(0, 5000) }),
  });
  return res.ok;
}

// Tag a paid tier requires before the front-end can show its survey.
// GHL workflows add these tags on "Payment Successful" so they cannot
// be added or spoofed by the front-end / URL params.
const TIER_REQUIRED_TAG = {
  paid_47:  "swot_paid_47",
  paid_297: "swot_paid_297",
};

// Fire an event to the HL Inbound Webhook (Workflow trigger). Non-blocking:
// runs inside a Promise.allSettled so its failure never breaks the primary
// GHL writeback. Skips silently if no webhook URL is configured.
async function fireTrackingEvent(payload, env, opts = {}) {
  const url = env.HL_TRACKING_WEBHOOK || CONFIG.HL_TRACKING_WEBHOOK;
  if (!url) return { skipped: true };
  if (opts.dryRun) {
    console.log(`[DRY_RUN] fireTrackingEvent skipped event=${payload?.event_type || "?"}`);
    return { skipped: true, dryRun: true };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, ts: new Date().toISOString() }),
    });
    if (!res.ok) {
      console.warn("[track] HL webhook non-2xx:", res.status, await res.text().catch(() => ""));
    }
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.warn("[track] HL webhook error:", err && err.message);
    return { ok: false, error: err && err.message };
  }
}

// ---------- Idempotency guard ----------
// Best-effort dedup so a webhook retry doesn't run Solomon twice (which would
// double-write the report, re-fire the tracking event, and re-trigger the
// delivery email). Keyed on contact+tier with a short TTL, so a deliberate
// re-run after the window still works. Backed by R2 (SOLOMON_LIBRARY); if R2 is
// unavailable it FAILS OPEN — never blocks a legitimate generation.
//
// Scope: used only on the /from-ghl-survey webhook path, where duplicates come
// from GHL's SEQUENTIAL retries (it waits for a timeout before retrying), so the
// read-then-write window is not a concern in practice. It is intentionally NOT
// atomic across truly-simultaneous requests — that would require a Durable
// Object, which is out of scope for the sequential-retry threat this guards.
const IDEMPOTENCY_TTL_MS = 3 * 60 * 1000; // 3 minutes
async function reserveIdempotency(key, env) {
  if (!env.SOLOMON_LIBRARY || !key) return { duplicate: false, path: null };
  const path = `idem/${encodeURIComponent(key)}.json`;
  try {
    const existing = await env.SOLOMON_LIBRARY.get(path);
    if (existing) {
      const data = await existing.json().catch(() => null);
      if (data && typeof data.ts === "number" && Date.now() - data.ts < IDEMPOTENCY_TTL_MS) {
        return { duplicate: true, path };
      }
    }
    // Reserve BEFORE running so a concurrent retry sees the marker.
    await env.SOLOMON_LIBRARY.put(path, JSON.stringify({ ts: Date.now() }), {
      httpMetadata: { contentType: "application/json" },
    });
    return { duplicate: false, path };
  } catch {
    return { duplicate: false, path: null }; // fail open — never block a real run
  }
}
async function releaseIdempotency(path, env) {
  if (!env.SOLOMON_LIBRARY || !path) return;
  try { await env.SOLOMON_LIBRARY.delete(path); } catch { /* best effort */ }
}

// POST /upload — multipart/form-data with a "file" field.
// Forwards to GHL Media Library and returns the hosted URL.
// Optional form fields: contactId (for future per-contact organization).
// Returns: { success, url, fileId, fileName, size }
async function handleUpload(request, env) {
  if (!env.GHL_API_KEY) {
    return json({ success: false, error: "GHL not configured" }, 500);
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ success: false, error: "Invalid multipart/form-data body" }, 400);
  }

  const file = formData.get("file");
  // In Workers, file-typed parts come back as File. String would mean no file part.
  if (!file || typeof file === "string") {
    return json({ success: false, error: "Missing 'file' field" }, 400);
  }

  // Conservative size limit — covers P&L PDFs, blocks accidental huge uploads.
  const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
  if (file.size > MAX_BYTES) {
    return json({ success: false, error: "File too large (max 25 MB)" }, 413);
  }

  // Forward to GHL Media Library.
  const ghlForm = new FormData();
  ghlForm.append("file", file, file.name || "upload");
  ghlForm.append("locationId", (env.GHL_LOCATION_ID || CONFIG.GHL_LOCATION_ID));
  ghlForm.append("hosted", "false");

  const res = await fetch(`${CONFIG.GHL_API_BASE}/medias/upload-file`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GHL_API_KEY}`,
      Version: "2021-07-28",
      // Don't set Content-Type — fetch sets it (with the multipart boundary) automatically.
    },
    body: ghlForm,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return json(
      { success: false, error: `GHL upload failed (${res.status})`, detail: detail.slice(0, 300) },
      502
    );
  }

  const data = await res.json().catch(() => ({}));
  return json({
    success: true,
    fileId:   data.fileId   || data.id      || null,
    url:      data.url      || data.fileUrl || data.path || null,
    fileName: file.name || "file",
    size:     file.size,
  });
}

// POST /verify — confirm a contact has paid for a tier.
// Body: { contactId, tier }
// Returns: { verified: boolean, contact: {contactId, name, email} | null }
async function handleVerify(body, env) {
  let contactId = body?.contactId;
  const tier = body?.tier;
  const email = String(body?.email || "").trim().toLowerCase();
  if (!tier || (!contactId && !email)) {
    return json({ verified: false, error: "Missing tier and (contactId or email)" }, 400);
  }
  const requiredTag = TIER_REQUIRED_TAG[tier];
  if (!requiredTag) {
    return json({ verified: false, error: `Tier "${tier}" does not require verification` }, 400);
  }
  if (!env.GHL_API_KEY) {
    return json({ verified: false, error: "GHL not configured" }, 500);
  }

  // Email-based recovery: caller lost their ?contactId link — resolve it by email.
  if (!contactId && email) {
    contactId = await findGHLContactByEmail(email, env);
    if (!contactId) {
      return json({ verified: false, error: "No paid account found for that email" }, 404);
    }
  }

  const res = await fetch(`${CONFIG.GHL_API_BASE}/contacts/${contactId}`, {
    headers: {
      Authorization: `Bearer ${env.GHL_API_KEY}`,
      Version: "2021-07-28",
    },
  });
  if (!res.ok) {
    return json({ verified: false, error: "Contact not found" }, 404);
  }
  const data = await res.json().catch(() => ({}));
  const c = data?.contact || {};
  const tags = (c.tags || []).map((t) => String(t).toLowerCase());
  const verified = tags.includes(requiredTag.toLowerCase());

  return json({
    verified,
    contact: verified
      ? {
          contactId,
          name: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" "),
          email: c.email || "",
        }
      : null,
  });
}

// GET /report/{contactId}/status — lightweight JSON check the analyzing UI polls
// to know when Solomon has written the report to the contact. Returns
// { ready: bool, tier: string } — no HTML rendering, no CTA construction.
async function handleReportStatus(contactId, env) {
  if (!contactId || !env.GHL_API_KEY) return json({ ready: false, error: "not_configured" }, 200);
  const res = await fetch(`${CONFIG.GHL_API_BASE}/contacts/${contactId}`, {
    headers: { Authorization: `Bearer ${env.GHL_API_KEY}`, Version: "2021-07-28" },
  });
  if (!res.ok) return json({ ready: false, error: "contact_not_found" }, 200);
  const data = await res.json().catch(() => ({}));
  const c = data?.contact || {};
  const tags = (c.tags || []).map((t) => String(t).toLowerCase());
  const cfs = c.customFields || [];
  const hasField = (key) => {
    const id = CONFIG.REPORT_FIELD_IDS[key];
    const found = cfs.find((f) => (id && f.id === id) ||
      (f.fieldKey || f.key || "") === `contact.${key}` ||
      (f.fieldKey || f.key || "") === key);
    return Boolean((found?.value || found?.field_value || "").toString().trim());
  };
  // Tier detection — prefer the highest tier whose report field ACTUALLY has
  // content. swot_solomon50_applied is applied at coupon redemption, before
  // the beta user completes the paid survey; without this content check we
  // would swap to swot_full_report immediately and show the analyzing screen
  // indefinitely instead of surfacing the free report they already have.
  // Dispatch order (2026-10-19 fix): paid-tier INTENT (tag) beats the
  // free-content fallback. Before this reorder, a paid_47 customer who
  // finished the extended intake but whose Full Diagnostic Claude run
  // had not yet fired (or had failed, leaving swot|deliveryfailed on
  // the contact) would land in the "has swot_free_report" branch and
  // see their OLD free report — including its "$47 Full Diagnostic"
  // upsell block at the bottom. A customer who just paid $47 being
  // offered the thing they already bought is the exact failure the
  // 2026-10-18 beta tester surfaced. We now resolve paid intent
  // first; if the paid content is not ready yet, serve the paid
  // "analyzing" state honestly instead of silently falling through
  // to the stale free content.
  const preferPaid47 = tags.includes("swot_paid_47") || tags.includes("swot_solomon50_applied");
  let reportFieldKey, tier;
  if (tags.includes("swot_paid_297") && hasField("business_playbook")) {
    reportFieldKey = "business_playbook"; tier = "paid_297";
  } else if (tags.includes("swot_paid_297")) {
    reportFieldKey = "business_playbook"; tier = "paid_297"; // paid intent, still analyzing
  } else if (preferPaid47 && hasField("swot_full_report")) {
    reportFieldKey = "swot_full_report"; tier = "paid_47";
  } else if (preferPaid47) {
    reportFieldKey = "swot_full_report"; tier = "paid_47";  // paid intent, still analyzing
  } else if (hasField("swot_free_report")) {
    reportFieldKey = "swot_free_report"; tier = "free";
  } else {
    reportFieldKey = "swot_free_report"; tier = "free";     // free intent, still analyzing
  }
  const reportFieldId = CONFIG.REPORT_FIELD_IDS[reportFieldKey];
  const found = cfs.find((f) => (reportFieldId && f.id === reportFieldId) ||
    (f.fieldKey || f.key || "") === `contact.${reportFieldKey}` ||
    (f.fieldKey || f.key || "") === reportFieldKey);
  const ready = Boolean((found?.value || found?.field_value || "").toString().trim());
  return json({ ready, tier });
}

// GET /report/{contactId} — serve the contact's stored report as a styled standalone HTML page.
// Tier is determined from the contact's tags (swot_paid_297 / swot_paid_47 / swot_free_lead).
// Used by "View Report Online" links written to swot_report_path on every successful run.
// Phase 1c: /report resolution policy, in short:
//   - Default read (no query params): D1 latest successful → GHL fallback
//     for pre-canonical contacts (and when the D1 binding is missing).
//   - Historical read (`?v=N` or `?report_id=<uuid>`): D1 only. History
//     belongs to D1; a historical URL must never reconstruct from the
//     owner's current GHL fields (SOLOMON_ARCHITECTURE Answer snapshot
//     contract). Missing D1 or missing row → 404.
//
// HTML source for a resolved D1 row: R2 artifact first (immutable); if
// the R2 object is missing or the binding isn't wired, re-render from
// `diagnostic_json` with buildReportHtml. This covers two real cases:
// (a) rows written before the R2 binding existed, and (b) rows whose
// R2 artifact was deleted or expired. Either way the diagnostic survives.
const REPORT_ID_SHAPE = /^[0-9a-f-]{32,40}$/i;
function tierLabelOf(tier) {
  if (tier === "paid_297") return "Business Growth Analysis";
  if (tier === "paid_47")  return "Full Diagnostic";
  return "SWOT Diagnostic";
}

/**
 * Emit the GHL path-signal tags for a given customer-facing path value.
 *
 * The rubric v3 rewrite (PR #75) narrowed the customer-facing path enum
 * from five values ("rehab" | "urgent" | "needs-attention" | "growth" |
 * "strong") to three ("rehab" | "needs-attention" | "growth"). Live GHL
 * workflows, however, trigger on the pre-v3 tag set:
 *   swot_path_rehab, swot_path_urgent, swot_path_growth, swot_path_strong
 *
 * Emitting only `swot_path_needs-attention` would break every HL
 * automation bound to `swot_path_urgent`, which is the historical bucket
 * now folded into needs-attention. Emitting only legacy tags would hide
 * the new classification from analytics.
 *
 * The compat strategy (Codex P1 on #75): emit BOTH tags — the new
 * canonical tag AND a legacy-mapped tag — so existing HL workflows keep
 * firing and new analytics on `needs-attention` work too. When HL
 * workflows have been migrated to listen for the new tag, the legacy
 * emission can be removed in a follow-up.
 *
 * Mapping (customer-facing path → legacy tag it collapses):
 *   rehab           → swot_path_rehab           (unchanged)
 *   needs-attention → swot_path_urgent          (needs-attention folds in urgent)
 *   growth          → swot_path_growth          (unchanged; growth folds in strong)
 */
function pathTags(path) {
  const normalized = String(path || "").toLowerCase();
  if (!normalized) return [];
  const tags = [`swot_path_${normalized}`];
  // Legacy-mapped tag for backwards compat with pre-v3 HL workflows.
  if (normalized === "needs-attention") tags.push("swot_path_urgent");
  return tags;
}

async function fetchArtifactHtml(env, r2Key) {
  if (!r2Key || !env?.SOLOMON_REPORTS) return null;
  try {
    const obj = await env.SOLOMON_REPORTS.get(r2Key);
    if (!obj) return null;
    return await obj.text();
  } catch (err) {
    console.error(`[fetchArtifactHtml] R2 get failed for ${r2Key}: ${err?.message || err}`);
    return null;
  }
}

// Resolve HTML for a D1 report row. Prefers R2; falls back to re-rendering
// the stored diagnostic JSON with buildReportHtml. Returns null only when
// both the R2 artifact AND the diagnostic are unusable (e.g. corrupted
// JSON) — callers should treat that as a signal to serve the analyzing
// shell or 404.
async function resolveReportHtml(env, report) {
  const r2Html = await fetchArtifactHtml(env, report?.r2_html_key);
  if (r2Html) return r2Html;
  // Fall back to re-rendering from the stored diagnostic. This keeps the
  // read working for rows written before R2 was wired, and for cases
  // where the R2 artifact was manually deleted. The output is the same
  // HTML the writer would have produced; the diagnostic JSON is the
  // canonical content, R2 is just a cache of its rendering.
  try {
    if (report?.diagnostic && typeof report.diagnostic === "object") {
      return buildReportHtml(report.diagnostic);
    }
  } catch (err) {
    console.error(`[resolveReportHtml] re-render failed for report ${report?.id}: ${err?.message || err}`);
  }
  return null;
}

// Phase 1c follow-up: fetch GHL contact metadata without letting a GHL
// outage block the canonical read. Returns {ok, contact}. The contact
// metadata is used ONLY for the shell page (name + email) when D1 has
// the authoritative diagnostic. If GHL is unavailable, callers that
// resolved from D1 render the shell with "Business Owner" + no email —
// the diagnostic still ships.
async function fetchGhlContactMetadata(contactId, env) {
  if (!contactId || !env?.GHL_API_KEY) return { ok: false, contact: null };
  try {
    const res = await fetch(`${CONFIG.GHL_API_BASE}/contacts/${contactId}`, {
      headers: {
        Authorization: `Bearer ${env.GHL_API_KEY}`,
        Version: "2021-07-28",
      },
    });
    if (!res.ok) return { ok: false, contact: null };
    const data = await res.json().catch(() => ({}));
    return { ok: true, contact: data?.contact || {} };
  } catch (err) {
    console.warn(`[fetchGhlContactMetadata] GHL fetch failed for ${contactId}: ${err?.message || err}`);
    return { ok: false, contact: null };
  }
}

function nameFromContact(c) {
  if (!c) return "Business Owner";
  return (
    c.firstName ||
    c.contactName ||
    [c.firstName, c.lastName].filter(Boolean).join(" ") ||
    "Business Owner"
  );
}

async function handleReport(contactId, env, requestUrl) {
  if (!contactId) {
    return new Response("Missing contact id", { status: 400, headers: htmlHeaders() });
  }
  if (!env.GHL_API_KEY) {
    return new Response("Server not configured", { status: 500, headers: htmlHeaders() });
  }

  // Parse history selectors. `v` = integer version; `report_id` = UUID of a
  // specific report_versions row. Either one puts us on the history path
  // (D1-only, no GHL fallback for the HTML body).
  const versionParam  = requestUrl?.searchParams?.get("v") || null;
  const reportIdParam = requestUrl?.searchParams?.get("report_id") || null;
  if (versionParam && reportIdParam) {
    return new Response("Pass only one of ?v or ?report_id", { status: 400, headers: htmlHeaders() });
  }
  if (versionParam && !/^\d+$/.test(versionParam)) {
    return new Response("Invalid ?v (expected positive integer)", { status: 400, headers: htmlHeaders() });
  }
  if (reportIdParam && !REPORT_ID_SHAPE.test(reportIdParam)) {
    return new Response("Invalid ?report_id", { status: 400, headers: htmlHeaders() });
  }
  const isHistoryRead = Boolean(versionParam || reportIdParam);

  // Phase 1c follow-up: resolve D1 BEFORE querying GHL. The architecture
  // doc makes D1 canonical and GHL a projection; a GHL outage or deleted
  // GHL contact must not block the historical read of a report that
  // lives safely in D1 + R2. GHL is only consulted for name/email on
  // the shell page.
  const db = dbFromEnv(env);

  // History path: D1-only for the HTML body. If the D1 binding is
  // missing or the row isn't there, we 404 — the historical URL must
  // not quietly resolve to a different generation than the one its
  // holder shared.
  if (isHistoryRead) {
    if (!db) {
      return new Response("Historical reports require the D1 binding", { status: 404, headers: htmlHeaders() });
    }
    let report;
    // History reads treat D1 as a hard dependency — the contract forbids
    // falling through to the GHL projection, which no longer carries
    // old generations. A D1 query failure here is 503 ("try again
    // shortly"), not 404 ("no such report"): the latter would mislead
    // a reviewer or holder of a shared URL into thinking their
    // generation was deleted. Codex caught this on PR #72 — reportById
    // used to swallow D1 errors as null, which produced a wrong 404.
    try {
      if (reportIdParam) {
        report = await reportById(db, reportIdParam);
        // Prevent crafted URL that points at another contact's report. The
        // contactId in the URL path must match the stored row's contact_id.
        if (report && report.contact_id !== contactId) report = null;
      } else {
        // reportByVersion is scoped to the contact's LATEST submission
        // chain (see db.js). Cross-chain history is reachable via
        // ?report_id= only. This closes the Codex finding where
        // ?v=1 silently retargeted between free and paid chains.
        report = await reportByVersion(db, contactId, parseInt(versionParam, 10));
      }
    } catch (err) {
      // Only swallow D1-query failures. A hydrateReport throw (malformed
      // diagnostic_json or strategist_brief_json) is a data-integrity
      // bug: let it propagate so the operator sees a real error, not
      // a misleading 503 that implies "come back later."
      if (!isD1QueryError(err)) throw err;
      console.warn(`[handleReport] D1 history read failed for ${contactId}: ${err?.message || err}`);
      return new Response("Historical report temporarily unavailable", { status: 503, headers: htmlHeaders() });
    }
    if (!report) {
      return new Response("Report version not found", { status: 404, headers: htmlHeaders() });
    }
    const html = await resolveReportHtml(env, report);
    if (!html) {
      return new Response("Report artifact missing", { status: 410, headers: htmlHeaders() });
    }
    const { contact: c } = await fetchGhlContactMetadata(contactId, env);
    return new Response(
      await buildReportPage(html, tierLabelOf(report.tier), nameFromContact(c), report.tier, env, c?.email || "", contactId),
      { status: 200, headers: htmlHeaders() }
    );
  }

  // Default read: try D1 latest successful FIRST. GHL comes in later
  // for identity (name/email on the shell) and for the fallback read
  // when no D1 row exists.
  //
  // Fail-open on D1 errors here: a missing report_versions table
  // (migration-not-yet-applied window) or a transient D1 outage must
  // not block the public /report/{contactId} read — we fall through to
  // the GHL projection, which is Phase 1c's documented safety net.
  // hydrateReport errors (malformed diagnostic_json) are NOT caught
  // here — a data-integrity bug must surface, not silently serve a
  // stale GHL copy.
  if (db) {
    let latest = null;
    try {
      latest = await latestSuccessfulReport(db, contactId);
    } catch (err) {
      // Only swallow D1-query failures and fall through to GHL. A
      // hydrateReport throw (malformed diagnostic_json or
      // strategist_brief_json) is a data-integrity bug — Codex caught
      // the earlier version of this fix masking it as a cache miss.
      // Let the throw propagate so the operator sees it rather than
      // silently serve a stale GHL projection.
      if (!isD1QueryError(err)) throw err;
      console.warn(`[handleReport] D1 default read failed for ${contactId}, falling through to GHL: ${err?.message || err}`);
    }
    if (latest) {
      const html = await resolveReportHtml(env, latest);
      if (html) {
        const { contact: c } = await fetchGhlContactMetadata(contactId, env);
        const readyPrelude = `<script>try{sessionStorage.removeItem('cfobd-elapsed');}catch(e){}</script>`;
        return new Response(
          await buildReportPage(readyPrelude + html, tierLabelOf(latest.tier), nameFromContact(c), latest.tier, env, c?.email || "", contactId),
          { status: 200, headers: htmlHeaders() }
        );
      }
    }
  }

  // Fallback: GHL custom-field read. This path exists for pre-canonical
  // contacts (no D1 row) and un-wired D1 workers. It requires a live
  // GHL fetch; if GHL is unavailable, 404.
  const { ok: ghlOk, contact: c } = await fetchGhlContactMetadata(contactId, env);
  if (!ghlOk || !c) {
    return new Response("Report not found", { status: 404, headers: htmlHeaders() });
  }
  const tags = (c.tags || []).map((t) => String(t).toLowerCase());
  const customFields = c.customFields || [];

  // Determine tier from tags — but prefer the highest paid tier only when
  // its report field ACTUALLY has content. swot_solomon50_applied is applied
  // when the coupon is redeemed, well before the paid survey completes and
  // the full report is written. Without the content check, a beta user
  // between coupon-apply and paid-report-ready would see the analyzing
  // fallback for an empty swot_full_report while their existing
  // swot_free_report sits unused. Fall through to the highest tier that has
  // real content; if none does, use the highest tag as "still analyzing"
  // so the poll continues to reflect the right destination tier.
  const findFieldFor = (key) => {
    const id = CONFIG.REPORT_FIELD_IDS[key];
    return customFields.find((f) => {
      if (id && f.id === id) return true;
      const k = f.fieldKey || f.key || "";
      return k === `contact.${key}` || k === key;
    });
  };
  const contentOf = (key) => {
    const f = findFieldFor(key);
    return (f?.value || f?.field_value || "").toString().trim();
  };

  // Dispatch order (2026-10-19 fix): paid-tier INTENT (tag) beats the
  // free-content fallback. Mirrors the ready-check cascade above.
  // Pre-fix, a paid_47 customer whose Full Diagnostic Claude run had
  // not fired yet (or had failed, leaving swot|deliveryfailed on the
  // contact) would fall into the "has swot_free_report" branch and
  // see their OLD free report — including its "$47 Full Diagnostic"
  // upsell block at the bottom (ResultsScreen gates the upsell on
  // `report.tier === "free"`, which was correct for the content it was
  // handed, but the content was the wrong tier for the customer).
  let reportFieldKey, tierLabel, tier, reportContent;
  const preferPaid47 = tags.includes("swot_paid_47") || tags.includes("swot_solomon50_applied");
  if (tags.includes("swot_paid_297") && contentOf("business_playbook")) {
    reportFieldKey = "business_playbook"; tierLabel = "Business Growth Analysis"; tier = "paid_297";
    reportContent = contentOf("business_playbook");
  } else if (tags.includes("swot_paid_297")) {
    reportFieldKey = "business_playbook"; tierLabel = "Business Growth Analysis"; tier = "paid_297";
    reportContent = "";  // paid intent, still analyzing — do NOT fall through to free
  } else if (preferPaid47 && contentOf("swot_full_report")) {
    reportFieldKey = "swot_full_report"; tierLabel = "Full Diagnostic"; tier = "paid_47";
    reportContent = contentOf("swot_full_report");
  } else if (preferPaid47) {
    reportFieldKey = "swot_full_report"; tierLabel = "Full Diagnostic"; tier = "paid_47";
    reportContent = "";  // paid intent, still analyzing — do NOT fall through to free
  } else if (contentOf("swot_free_report")) {
    reportFieldKey = "swot_free_report"; tierLabel = "SWOT Diagnostic"; tier = "free";
    reportContent = contentOf("swot_free_report");
  } else {
    reportFieldKey = "swot_free_report"; tierLabel = "SWOT Diagnostic"; tier = "free";
    reportContent = "";  // free intent, still analyzing
  }
  const reportField = findFieldFor(reportFieldKey);
  void reportField; // preserved for parity with prior code shape; unused below

  if (!reportContent) {
    const fallback = `
      <style>
        @keyframes cfobd-pulse { 0%,100% { opacity:.3; transform:scale(0.9); } 50% { opacity:1; transform:scale(1.1); } }
        @keyframes cfobd-fade  { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .analyzing { text-align:center; padding:36px 20px 40px; animation:cfobd-fade .5s ease-out; }
        .analyzing .dots { display:inline-flex; gap:10px; margin:6px 0 26px; }
        .analyzing .dots span {
          width:12px; height:12px; border-radius:50%; background:#d4b565;
          animation: cfobd-pulse 1.2s infinite ease-in-out;
        }
        .analyzing .dots span:nth-child(2) { animation-delay: .2s; }
        .analyzing .dots span:nth-child(3) { animation-delay: .4s; }
        .analyzing h3 {
          font-family:Georgia,serif; font-size:24px; font-weight:600; color:#1a1a1a;
          margin:6px 0 12px; line-height:1.2;
        }
        .analyzing .sub { color:#6b7280; font-size:15px; line-height:1.55; max-width:440px; margin:0 auto 8px; }
        .analyzing .step { color:#9ca3af; font-family:ui-monospace,Menlo,monospace; font-size:11px; letter-spacing:.15em; text-transform:uppercase; margin-top:20px; }
      </style>
      <div class="analyzing" id="analyzing">
        <div class="dots"><span></span><span></span><span></span></div>
        <h3>Solomon is analyzing your business.</h3>
        <p class="sub">Reading your answers, scoring the SWOT, and drafting your personalized report. This typically takes 30–60 seconds.</p>
        <p class="step" id="analyzing-step">READING YOUR ANSWERS…</p>
      </div>
      <script>
        (function () {
          var steps = [
            'READING YOUR ANSWERS…',
            'SCORING STRENGTHS &amp; WEAKNESSES…',
            'IDENTIFYING OPPORTUNITIES…',
            'DRAFTING YOUR REPORT…',
            'FINALIZING RECOMMENDATIONS…'
          ];
          var i = 0;
          var stepEl = document.getElementById('analyzing-step');
          var stepInterval = setInterval(function () {
            i = (i + 1) % steps.length;
            if (stepEl) stepEl.innerHTML = steps[i];
          }, 4000);

          // Contact id parsed from the current URL /report/{contactId}
          var pathParts = window.location.pathname.split('/').filter(Boolean);
          var contactId = pathParts[pathParts.length - 1] || '';
          var pollUrl = window.location.origin + '/report/' + encodeURIComponent(contactId) + '/status';

          // Fallback shown if the seamless in-place swap fails for any reason
          // (fetch error, HTML parse error, target elements missing). Keeps the
          // pre-existing "See My Results" button so the flow still works — we
          // just prefer to skip it when we can.
          function showReadyFallback() {
            clearInterval(stepInterval);
            var wrap = document.getElementById('analyzing');
            if (!wrap) return;
            wrap.innerHTML =
              '<div style="display:inline-flex;align-items:center;justify-content:center;' +
                'width:56px;height:56px;border-radius:50%;background:rgba(74,222,128,0.14);' +
                'color:#4ade80;font-size:28px;margin:0 auto 18px;">✓</div>' +
              '<h3 style="font-family:Georgia,serif;font-size:26px;font-weight:600;color:#1a1a1a;margin:0 0 10px;">Your report is ready.</h3>' +
              '<p style="color:#6b7280;font-size:15px;max-width:440px;margin:0 auto 24px;">' +
                'Solomon finished the diagnosis. Take a look when you\\'re ready.</p>' +
              '<a href="' + window.location.pathname + '" ' +
                'style="display:inline-block;padding:14px 32px;background:#f2c94c;color:#0a0e14;' +
                'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;' +
                'font-weight:700;font-size:15px;letter-spacing:.02em;border-radius:6px;' +
                'text-decoration:none;transition:transform .15s;">' +
                'See My Results <span style="font-size:18px;line-height:1;margin-left:6px;">→</span>' +
              '</a>';
          }

          // Seamless swap: fetch the current /report page fresh (now with a
          // populated report field), parse it, extract the .report-card
          // contents, and drop them into the current DOM in place of the
          // analyzing spinner. No reload, no intermediate button. Matches the
          // /marketing streaming UX. Falls back to showReadyFallback on any
          // error (parse failure, missing target, network hiccup) so the flow
          // still resolves.
          function showReady() {
            clearInterval(stepInterval);
            fetch(window.location.pathname, { cache: 'no-store' })
              .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
              .then(function (html) {
                var doc = new DOMParser().parseFromString(html, 'text/html');
                var fresh = doc.querySelector('.report-card');
                var here = document.querySelector('.report-card');
                if (!fresh || !here) throw new Error('missing report card');
                // Race guard: /status said ready but the fresh render might still
                // show the analyzing spinner (eventually-consistent GHL read, or
                // the status/report endpoints disagreeing). Fall back so polling
                // continues instead of swapping a spinner in for a spinner.
                var freshHello = doc.querySelector('.hello');
                var hereHello = document.querySelector('.hello');
                if (!freshHello || !hereHello || fresh.querySelector('#analyzing')) throw new Error('report not ready');
                // Replace the "GENERATING YOUR REPORT · diagnostic is on the way"
                // greeting with the "YOUR REPORT · READY · diagnostic is back" one.
                hereHello.replaceWith(freshHello);
                here.innerHTML = fresh.innerHTML;
                // The CTA panel (upgrade block) lives OUTSIDE the .report-card
                // when tier=free (isPending=true suppresses it). Bring it over
                // if the fresh page has one and we don't, then re-bind the
                // coupon script against the freshly inserted #coupon-row.
                var freshCta = doc.querySelector('.cta-panel');
                var hereCta = document.querySelector('.cta-panel');
                if (freshCta && !hereCta) {
                  here.parentNode.insertBefore(freshCta, here.nextSibling);
                  if (window.initReportCoupon) window.initReportCoupon();
                }
                window.scrollTo({ top: 0, behavior: 'smooth' });
              })
              .catch(function () { showReadyFallback(); });
          }

          // Soft "still working" state — replaces the spinner copy with a
          // longer-wait message but KEEPS polling. The paid47-v2 Full
          // Diagnostic typically lands in ~3-5 minutes under the streaming
          // Claude path; the previous terminal timeout gave up at 2.5
          // minutes and lost Priya Shankar's finished report (2026-10-28:
          // the server had the report by ~5 min, the browser had stopped
          // observing at ~3.5 min, manual refresh picked it up in 10s).
          // The new behavior: soften the copy at 3 min while polling
          // continues, then only at the hard cap (set to cover the
          // queue's full retry lifecycle) switch to an honest "we
          // stopped checking" state the customer can act on.
          var softenedCopy = false;
          function showSoftWaitCopy() {
            if (softenedCopy) return;
            softenedCopy = true;
            var wrap = document.getElementById('analyzing');
            if (!wrap) return;
            wrap.innerHTML =
              '<div class="dots"><span></span><span></span><span></span></div>' +
              '<h3 style="font-family:Georgia,serif;font-size:22px;color:#1a1a1a;margin:0 0 10px;">Still working on your report…</h3>' +
              '<p style="color:#6b7280;font-size:15px;max-width:460px;margin:0 auto 6px;">' +
                'This one is taking a little longer than usual. We are still watching for it — the page will update as soon as it is ready. ' +
                'If something feels wrong, email ' +
                '<a href="mailto:support@cfobydesign.com" style="color:#92400e;">support@cfobydesign.com</a> ' +
                'and we will dig in.</p>';
          }

          // Honest end-of-polling state. Only shown at the hard cap, when
          // the page has genuinely stopped checking. Replaces the lying
          // "the page will update as soon as it is ready" copy with a
          // concrete recovery action (refresh / email support).
          function showStoppedCheckingCopy() {
            var wrap = document.getElementById('analyzing');
            if (!wrap) return;
            wrap.innerHTML =
              '<h3 style="font-family:Georgia,serif;font-size:22px;color:#1a1a1a;margin:0 0 10px;">We have stopped checking this page automatically.</h3>' +
              '<p style="color:#6b7280;font-size:15px;max-width:460px;margin:0 auto 6px;">' +
                'Your report may still be in progress. ' +
                '<a href="javascript:window.location.reload()" style="color:#92400e;text-decoration:underline;">Refresh this page</a> ' +
                'to check again, or email ' +
                '<a href="mailto:support@cfobydesign.com" style="color:#92400e;">support@cfobydesign.com</a> ' +
                'and we will dig in. If your report finished, it is also saved to your account and emailed when ready.</p>';
          }

          var elapsed = 0;
          // Soft-wait threshold: switch the copy to "still working" but
          // keep polling. Was the terminal timeout before PR fixing
          // Priya's stuck-page bug.
          var SOFT_WAIT_SECONDS = 180; // 3 min — soften copy, do not stop
          // Hard cap on polling in a single page view. The queue
          // consumer's wrangler.toml budget is 15 minutes per invocation
          // and max_retries=2 (3 attempts total). Worst-case lifecycle
          // including Queues backoff between retries can approach
          // 25-30 minutes before swot|deliveryfailed is applied. We
          // cover the FULL lifecycle so a report that lands on retry 2
          // or 3 still auto-swaps for the customer (Codex finding on PR
          // #162). The /status GET is lightweight; 30 minutes of 4-sec
          // polling is ~450 cheap requests, negligible load.
          var MAX_SECONDS = 1800; // 30 min — covers full queue retry lifecycle
          var POLL_INTERVAL_MS = 4000;
          var pollTimer;

          function tick() {
            elapsed += POLL_INTERVAL_MS / 1000;
            if (elapsed >= SOFT_WAIT_SECONDS) showSoftWaitCopy();
            if (elapsed >= MAX_SECONDS) {
              // Hard cap reached — stop polling AND tell the customer we
              // stopped so the UI doesn't lie about watching.
              showStoppedCheckingCopy();
              return false;
            }
            return true;
          }

          function poll() {
            fetch(pollUrl, { cache: 'no-store', headers: { 'Accept': 'application/json' } })
              .then(function (r) { return r.ok ? r.json() : { ready: false }; })
              .then(function (data) {
                if (data && data.ready) { showReady(); return; }
                if (tick()) pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
              })
              .catch(function () {
                // Network hiccup — keep trying under the hard cap.
                if (tick()) pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
              });
          }
          // Kick off — 2s delay to let the initial UI settle before the first poll.
          setTimeout(poll, 2000);
        })();
      </script>`;
    // isPending=true suppresses the "READY" pill and the tier CTA — both
    // are lies while the spinner is up. Fresh-lead observability: log
    // which tier we're waiting on and whether we have any content in the
    // OTHER report fields (helps diagnose writeback failures without
    // wrangler tail).
    const contentFree = contentOf("swot_free_report");
    const contentFull = contentOf("swot_full_report");
    const contentPlaybook = contentOf("business_playbook");
    console.warn(`[handleReport] Serving analyzing shell for contact ${contactId} tier=${tier}; ` +
      `swot_free_report=${contentFree ? contentFree.length + "chars" : "empty"} ` +
      `swot_full_report=${contentFull ? contentFull.length + "chars" : "empty"} ` +
      `business_playbook=${contentPlaybook ? contentPlaybook.length + "chars" : "empty"} ` +
      `tags=[${(c.tags || []).join(",")}]`);
    // Prefer the real first name on the pending shell so the loading
    // page reads "Priya, your diagnostic is on the way" instead of
    // "Business, your diagnostic is on the way" (2026-10-28 Cowork /
    // Priya Shankar test — the pending shell hardcoded "Business Owner"
    // and the first-name split in buildReportPage then showed "Business"
    // as the greeting). Fall back to a sensible default only when no
    // first name is on the contact.
    const pendingName_fn =
      c.firstName || c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ") || "Business Owner";
    return new Response(await buildReportPage(fallback, tierLabel, pendingName_fn, tier, env, c.email || "", contactId, { isPending: true }), {
      status: 200,
      headers: htmlHeaders(),
    });
  }

  // Report is ready → clear any pending analyzing timer state on next load
  const readyPrelude = `<script>try{sessionStorage.removeItem('cfobd-elapsed');}catch(e){}</script>`;
  const reportWithReset = readyPrelude + reportContent;

  const contactName =
    c.firstName || c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ") || "Business Owner";

  return new Response(await buildReportPage(reportWithReset, tierLabel, contactName, tier, env, c.email || "", contactId), {
    status: 200,
    headers: htmlHeaders(),
  });
}

// Origin allowlist — a CSRF control, not authentication. A non-browser caller
// can set any Origin header. Kept as first-cut abuse mitigation for the
// no-token React /beta path; the token path below is the real authorization.
const ALLOWED_APPLY_ORIGINS = new Set([
  "https://success.cfobydesign.com",
  "https://my.cfobydesign.com",
  "https://oppeak26.pages.dev",
  "https://swot-engine.cfobydesign.workers.dev",
]);
function isAllowedApplyOrigin(request) {
  const origin = request.headers.get("origin") || "";
  if (!origin) return false;
  if (ALLOWED_APPLY_ORIGINS.has(origin)) return true;
  // Pages preview subdomains: <anything>.oppeak26.pages.dev
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "https:") return false;
    if (hostname.endsWith(".oppeak26.pages.dev")) return true;
    if (hostname.endsWith(".cfobydesign.workers.dev")) return true;
  } catch { /* fall through */ }
  return false;
}

// HMAC-signed token minted by the worker when it renders /report/<contactId>.
// The report URL is delivered to the user via a worker-set contact field
// (swot_report_path), so obtaining a valid token requires already being the
// legitimate holder of that contact record. Token binds the operation to a
// specific scope + subject (contactId) + expiry.
const APPLY_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h — user has time to redeem after report loads
function _tokenSecret(env) {
  return env.APPLY_TOKEN_SECRET || env.WEBHOOK_SECRET || null;
}
function _b64url(bytes) {
  let s = "";
  const bin = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < bin.length; i++) s += String.fromCharCode(bin[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function _b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function _hmac(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return new Uint8Array(sig);
}
async function mintApplyToken(subject, env) {
  const secret = _tokenSecret(env);
  if (!secret || !subject) return null;
  const payload = { s: "solomon50", sub: String(subject), exp: Date.now() + APPLY_TOKEN_TTL_MS };
  const payloadB64 = _b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await _hmac(secret, payloadB64);
  return `${payloadB64}.${_b64url(sig)}`;
}
// Returns { ok, sub } — sub is the contactId the token was minted for. Callers
// must additionally check sub matches the record they intend to write.
async function verifyApplyToken(token, env) {
  const secret = _tokenSecret(env);
  if (!secret || !token || typeof token !== "string") return { ok: false };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false };
  const [payloadB64, sigB64] = parts;
  let providedSig, expectedSig;
  try {
    providedSig = _b64urlDecode(sigB64);
    expectedSig = await _hmac(secret, payloadB64);
  } catch { return { ok: false }; }
  if (providedSig.length !== expectedSig.length) return { ok: false };
  // Constant-time compare
  let diff = 0;
  for (let i = 0; i < providedSig.length; i++) diff |= providedSig[i] ^ expectedSig[i];
  if (diff !== 0) return { ok: false };
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(_b64urlDecode(payloadB64))); }
  catch { return { ok: false }; }
  if (payload.s !== "solomon50") return { ok: false };
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) return { ok: false };
  return { ok: true, sub: String(payload.sub || "") };
}

// Coarse in-memory rate limit for the no-token /beta path. Not distributed,
// resets on worker restart — a KV binding would be strictly better and is the
// right follow-up. For demo scale this is enough to stop volume-abuse from
// a single source. Keyed by CF-Connecting-IP.
const _applyRateBucket = new Map(); // ip → [ts, ts, ...]
const APPLY_RATE_WINDOW_MS = 60 * 60 * 1000; // 1h
const APPLY_RATE_MAX = 5;               // 5 attempts / IP / hour on the no-token path
function checkNoTokenRateLimit(request) {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
  const now = Date.now();
  const arr = (_applyRateBucket.get(ip) || []).filter(t => now - t < APPLY_RATE_WINDOW_MS);
  if (arr.length >= APPLY_RATE_MAX) return false;
  arr.push(now);
  _applyRateBucket.set(ip, arr);
  return true;
}

// POST /apply-solomon50 — tag a contact when they redeem the SOLOMON50 beta code.
//
// AUTHORIZATION — one of:
//   (A) Signed token bound to a known contactId. Worker mints this token when it
//       renders /report/<contactId>, so possession proves the caller reached the
//       legitimate report page for that contact. Token is HMAC-SHA256 over
//       {scope:"solomon50", sub:contactId, exp} using APPLY_TOKEN_SECRET (falls
//       back to WEBHOOK_SECRET). Fires from the report-page coupon script.
//   (B) No-token path — origin allowlist + per-IP rate limit + email required
//       (contactId-only requests must present a token). Serves the React /beta
//       flow where the app doesn't visit a worker-minted URL first. Weaker; a
//       real captcha/Turnstile check is the correct pre-launch upgrade.
//
// Body accepts:
//   { token, contactId, code }                            — path (A)
//   { email, name?, businessName?, code }                 — path (B)
async function handleApplySolomon50(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const code = String(body.code || "").trim().toUpperCase();
  if (code !== "SOLOMON50") return json({ success: false, error: "Unrecognized code" }, 400);
  if (!env.GHL_API_KEY) return json({ success: false, error: "GHL not configured" }, 500);

  const rawContactId = body.contactId || body.contact_id || null;
  const email = String(body.email || "").trim().toLowerCase();
  const token = body.token || null;

  let contactId = null;

  if (token) {
    // Path (A): signed token. Must match the contactId in the body — the token
    // authorizes ONLY the subject it was minted for. Origin check is redundant
    // here (the signature is stronger).
    const v = await verifyApplyToken(token, env);
    if (!v.ok) return json({ success: false, error: "Invalid or expired token" }, 401);
    if (!rawContactId || String(rawContactId) !== v.sub) {
      return json({ success: false, error: "Token does not authorize this contact" }, 403);
    }
    contactId = v.sub;
  } else {
    // Path (B): no token. Origin allowlist + per-IP rate limit. Accepts either
    // email (upsert-by-email → tag) OR a bare contactId (tag existing contact).
    // Both are equivalent-strength: an attacker at 5/hr per IP could enumerate
    // either identifier space to mass-tag beta contacts, and the rate limit
    // caps the blast radius; the demo cohort is small so this is acceptable.
    // Turnstile is the correct pre-launch upgrade to close both attack shapes.
    // Kept here (rather than requiring path A) so the beta React flow —
    // /beta and /beta-thanks — can call this endpoint before it has a
    // worker-minted token.
    if (!isAllowedApplyOrigin(request)) {
      return json({ success: false, error: "Origin not allowed" }, 403);
    }
    if (!checkNoTokenRateLimit(request)) {
      return json({ success: false, error: "Too many attempts — try again later" }, 429);
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ success: false, error: "Malformed email" }, 400);
    }
    if (!email && !rawContactId) {
      return json({ success: false, error: "Need email or contactId" }, 400);
    }
    if (email) {
      contactId = await upsertGHLContactByEmail(email, {
        name: body.name,
        businessName: body.businessName,
      }, env);
      if (!contactId) return json({ success: false, error: "Contact upsert failed" }, 500);
    } else {
      // contactId-only. Basic shape check to reject obvious garbage before we
      // hit GHL. GHL IDs are 20-char alphanumeric-ish; keep the pattern
      // permissive but reject empty/URL/space characters.
      const cid = String(rawContactId).trim();
      if (!/^[A-Za-z0-9_-]{6,64}$/.test(cid)) {
        return json({ success: false, error: "Malformed contactId" }, 400);
      }
      contactId = cid;
    }
  }

  const ok = await addGHLTag(contactId, ["swot_solomon50_applied"], env);
  return json({ success: ok, contactId });
}

// Upsert a GHL contact by email. Returns the contactId on success (existing OR
// newly created), null on failure. Used by /apply-solomon50 when the beta user
// hasn't been registered upstream so we can still track their SOLOMON50 redemption.
async function upsertGHLContactByEmail(email, extras, env) {
  if (!email || !env.GHL_API_KEY) return null;
  const [firstName, ...rest] = String(extras?.name || "").trim().split(/\s+/);
  const payload = {
    email,
    locationId: env.GHL_LOCATION_ID || CONFIG.GHL_LOCATION_ID,
  };
  if (firstName) payload.firstName = firstName;
  if (rest.length) payload.lastName = rest.join(" ");
  if (extras?.businessName) payload.companyName = extras.businessName;

  try {
    const res = await fetch(`${CONFIG.GHL_API_BASE}/contacts/upsert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GHL_API_KEY}`,
        Version: "2021-07-28",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn(`[upsertGHLContactByEmail] status ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    const data = await res.json().catch(() => ({}));
    return data?.contact?.id || data?.id || null;
  } catch (err) {
    console.warn(`[upsertGHLContactByEmail] error: ${err.message}`);
    return null;
  }
}

// ----- Ask Solomon console (internal training & testing) -----

// Validate console access. Accepts EITHER:
//   1. Password via x-console-password header (matches env.CONSOLE_PASSWORD) — normal login
//   2. Embed token via x-console-password header (matches env.CONSOLE_EMBED_TOKEN) — for
//      iframe embeds (e.g., inside GHL dashboard). Bypasses the gate when passed in the URL.
// Constant-time-ish comparison: short strings, low risk for timing attacks at our volume.
function checkConsolePassword(request, env) {
  const provided = request.headers.get("x-console-password");
  if (!provided) return false;
  if (env.CONSOLE_PASSWORD && provided === env.CONSOLE_PASSWORD) return true;
  if (env.CONSOLE_EMBED_TOKEN && provided === env.CONSOLE_EMBED_TOKEN) return true;
  return false;
}

// POST /asksolomon/run — runs the SWOT assessment without GHL writeback.
// Supports `rubricOverride` to test rubric variants ephemerally.
// Probe requests (body.probe === true) just validate the password and return 200.
async function handleConsoleRun(request, env, ctx, requestUrl) {
  if (!checkConsolePassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  // Auth probe — used by the gate to verify the password without a real run.
  if (body && body.probe) return json({ success: true, probe: true });

  const tier = body.tier || "free";
  const contact = body.contact || {};
  const businessProfile = body.businessProfile || {};
  const answers = normalizeAnswers(body.answers);
  // Explicit dry-run flag — the request may set body.dry_run:true to force
  // the handler through its full Claude + render path with NO GHL side
  // effects (writeback, tag, note, tracking). Takes precedence over any
  // other signal; the response carries dryRun:true so the caller knows.
  const dryRun = body.dry_run === true;
  if (!answers.length) return json({ success: false, error: "No answers provided" }, 400);

  // Build the user prompt the normal way. Then call Claude with either the default
  // rubric (cache-eligible) or the override (cache-busted but still works).
  const prompt = buildPrompt(tier, answers, contact, businessProfile);

  // If the caller selected library items, fetch their content and append as
  // reference material to the base rubric. Deliberately AFTER the rubric override
  // check so a user can also test rubric variants + library items together.
  const libraryIds = Array.isArray(body.libraryIds) ? body.libraryIds : [];
  const libraryContext = libraryIds.length ? await buildLibraryContext(env, libraryIds) : "";

  const baseRubric = (typeof body.rubricOverride === "string" && body.rubricOverride.trim())
    ? body.rubricOverride
    : ASSESSMENT_RUBRIC;
  const rubric = libraryContext ? (baseRubric + libraryContext) : baseRubric;

  let agent;
  const startedAt = Date.now();
  try {
    const parsed = await callClaudeAndParseWithRetry({
      env, contactId: contact?.contactId || null, prompt, rubric,
    });
    agent = parsed.agent;
  } catch (err) {
    return json({ success: false, error: err.message }, 500);
  }
  const elapsedMs = Date.now() - startedAt;

  // Free-tier digital-presence scrub matches production behavior.
  if (tier === "free") {
    agent.opportunityFlags = (agent.opportunityFlags || []).filter(f => f !== "DIGITAL_PRESENCE_OPP");
  }

  // Phase 2C: sanitize any structured_findings even on the console path.
  // Console runs have no normalization context (no field-id stream), so
  // the empty-context evaluation here means every structured finding
  // will fail the grounded-in-nothing rule and be stripped — the safe
  // default. Prevents a console run from storing an unvalidated finding
  // in a canonical row (when contactId is set) or showing one in the
  // returned reportHtml.
  sanitizeStructuredFindings(agent, { normalized: {}, derivedMetrics: [] }, "handleConsoleRun");

  const reportHtml = buildReportHtml(agent);

  // Canonical write (Phase 1b). Console runs that target a real contact
  // (contactId present and not a dry-run) land in canonical history the
  // same way webhook submissions do — they are legitimate Solomon
  // generations and belong in the record. Synthetic console runs (no
  // contactId) and dry runs return a `skipped` sentinel and no row is
  // written. See writeCanonicalRecord for the full contract.
  const canonical = await writeCanonicalRecord(env, {
    contact: contact.contactId ? { id: contact.contactId, ...contact } : {},
    tier,
    answers,
    agent,
    reportHtml,
    sourceEventId: null, // console runs don't have a GHL webhook event id
    dryRun,
  });

  // TIGHTENED (2026-09-16): OPT-IN GHL writeback for console test runs.
  // Requires an explicit contactId — email-only lookups are refused so a
  // typo in the console can't retarget an unrelated contact. Solomon
  // NEVER applies tier tags (swot_paid_47 / swot_paid_297) or the
  // report-ready email trigger from a test run — a test run must never
  // fire a delivery email to a real customer. Only the report content
  // fields, path signal, and the distinguishing swot_console_test tag.
  // Operators who genuinely want to fire the delivery email from a test
  // run must add the report-ready tag manually in the GHL UI.
  let emailedTo = null;
  if (contact.contactId && ctx && requestUrl) {
    try {
      const contactId = contact.contactId; // trust the caller — no email lookup
      const reportFieldKey =
        tier === "paid_297" ? "business_playbook"
        : tier === "paid_47" ? "swot_full_report"
        : "swot_free_report";

      const fields = [
        { key: "swot_path", field_value: String(agent.path || "") },
        { key: "swot_rehab_flag", field_value: agent.path === "rehab" ? "true" : "false" },
        { key: reportFieldKey, field_value: reportHtml },
      ];
      if (agent.opener) fields.push({ key: "swot_email_blurb", field_value: String(agent.opener) });
      if (agent.strategistBrief) fields.push({ key: "swot_strategist_brief", field_value: String(agent.strategistBrief) });
      fields.push({ key: "swot_report_path", field_value: `${requestUrl.origin}/report/${contactId}` });

      // Tag stack minimized — one marker only. The path + opportunity flags
      // already live in the swot_path field and the report itself, so tagging
      // them again just creates GHL tag sprawl. We keep swot_console_test as
      // the single "this write is not from a real lead" marker.
      const tags = ["swot_console_test"];

      // Post a note describing what Solomon just did on this real contact.
      // Notes are the richer, more findable audit trail — action + update in
      // one place — and don't pollute the contact's tag column.
      const flagList = (agent.opportunityFlags || []).map(String).join(", ") || "(none)";
      const caseLabel = body.caseType === "existing_client" ? "Existing client" : "Hypothetical";
      const noteBody = [
        `Solomon test run · ${caseLabel}`,
        `Tier: ${tier}`,
        `Path: ${agent.path || "?"}`,
        `Opportunity flags: ${flagList}`,
        `At: ${new Date().toISOString()}`,
      ].join("\n");

      ctx.waitUntil(Promise.allSettled([
        updateGHLContact(contactId, fields, env, { dryRun }).then(async (ok) => {
          await recordGhlWriteback(env, {
            reportId: canonical?.reportId || null,
            contactId,
            status: ok ? "succeeded" : "failed",
            error: ok ? null : "updateGHLContact returned false",
          });
          return ok;
        }),
        addGHLTag(contactId, tags, env, { dryRun }),
        // addGHLNote does not yet honor dryRun; a dry-run request still skips
        // it here so the console-note audit trail stays accurate.
        dryRun ? Promise.resolve(true) : addGHLNote(contactId, noteBody, env),
      ]));
      emailedTo = contact.email || null; // for UI display only; no delivery email actually fires
    } catch (err) {
      console.error("Console GHL writeback failed:", err.message);
    }
  } else if (contact.email && !contact.contactId) {
    console.warn(`[/asksolomon/run] email=${contact.email} provided without contactId — writeback refused. Look up the contact and pass contactId explicitly.`);
  }

  return json({
    success: true,
    tier,
    rubricUsed: baseRubric === ASSESSMENT_RUBRIC ? "default" : "override",
    libraryItemsIncluded: libraryIds.length,
    libraryContextChars: libraryContext.length,
    reportHtml,
    emailedTo, // null if no email provided; otherwise the address that will receive the workflow email
    elapsedMs, // Anthropic API round-trip time in ms; ~drops after cache hits
    dryRun,
    canonical: canonical?.ok
      ? {
          submissionId: canonical.submissionId,
          reportId: canonical.reportId,
          reportVersion: canonical.reportVersion,
          r2_html_key: canonical.r2_html_key,
        }
      : { skipped: true, reason: canonical?.reason || canonical?.error || "unknown" },
    ...agent,
  });
}

// POST /asksolomon/send-result — take a previously-generated agent output and
// write it to a specific GHL contact so staff can review/hand-deliver it.
// Does NOT invoke Solomon. Reuses production writeback path.
//
// TIGHTENED (2026-09-16): after the Rosaline Perez incident where the console
// tagged a legitimate customer as swot_paid_297 + swot_report_ready_297 based
// on an email lookup that returned the wrong record (Miguel's email on
// Roseline's row), this endpoint now:
//   1. Requires body.contact.contactId — email lookup / create is refused.
//      The operator MUST see the contact record they're targeting.
//   2. Does NOT apply tier tags (swot_paid_47 / swot_paid_297). Payment tags
//      belong exclusively to the GHL payment workflow.
//   3. Does NOT apply the report-ready email trigger (swot_report_ready_*).
//      A test/manual send must never fire a delivery email to a customer.
//      If the operator wants to fire delivery, they add that tag manually
//      in the GHL UI while looking at the correct contact.
// Only report content + path signal + swot_console_manual_send are written.
async function handleConsoleSendResult(request, env, ctx, requestUrl) {
  if (!checkConsolePassword(request, env)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const tier = body.tier || "free";
  const contact = body.contact || {};
  const agent = body.agent || {};
  const reportHtml = body.reportHtml || "";

  if (!contact.contactId) {
    return json({
      success: false,
      error: "contact.contactId is required — look up the target contact in GHL and pass its id explicitly. Email-only send has been removed for data integrity.",
    }, 400);
  }
  if (!agent.path) {
    return json({ success: false, error: "Missing agent output (path required)" }, 400);
  }

  const contactId = contact.contactId; // trust the caller — no email resolution
  const reportFieldKey =
    tier === "paid_297" ? "business_playbook"
    : tier === "paid_47" ? "swot_full_report"
    : "swot_free_report";

  const fields = [
    { key: "swot_path", field_value: String(agent.path || "") },
    { key: "swot_rehab_flag", field_value: agent.path === "rehab" ? "true" : "false" },
    { key: reportFieldKey, field_value: reportHtml },
  ];
  if (agent.opener) fields.push({ key: "swot_email_blurb", field_value: String(agent.opener) });
  if (agent.strategistBrief) fields.push({ key: "swot_strategist_brief", field_value: String(agent.strategistBrief) });
  fields.push({ key: "swot_report_path", field_value: `${requestUrl.origin}/report/${contactId}` });

  // Single identity marker. Path + opportunity flags already land in
  // swot_path field + the stored report — no need to tag them separately.
  const tags = ["swot_console_manual_send"];

  const flagList = (agent.opportunityFlags || []).map(String).join(", ") || "(none)";
  const caseLabel = body.caseType === "existing_client" ? "Existing client" : "Hypothetical";
  const noteBody = [
    `Solomon manual send · ${caseLabel}`,
    `Tier: ${tier}`,
    `Path: ${agent.path || "?"}`,
    `Opportunity flags: ${flagList}`,
    `Emailed to: ${contact.email || "(no delivery email fired)"}`,
    `At: ${new Date().toISOString()}`,
  ].join("\n");

  ctx.waitUntil(Promise.allSettled([
    updateGHLContact(contactId, fields, env),
    addGHLTag(contactId, tags, env),
    addGHLNote(contactId, noteBody, env),
  ]));

  return json({
    success: true,
    tier,
    contactId,
    note: "Report content written and a summary note posted on the contact. No tier tag or report-ready tag applied — those must be added manually in GHL if a delivery email is intended.",
  });
}

// ----- Reference library (transcripts / testimonials / examples / rubric fragments) -----
// Stored in R2 bucket SOLOMON_LIBRARY. Manifest at library/manifest.json is the index.
// Soft-delete moves the object to SOLOMON_LIBRARY_ARCHIVE and drops it from the manifest.

const LIBRARY_MANIFEST_KEY = "library/manifest.json";
const LIBRARY_CATEGORIES = new Set(["transcript", "testimonial", "example", "rubric_fragment"]);
const LIBRARY_MAX_BYTES = 512 * 1024; // 512KB per file

async function readLibraryManifest(env) {
  if (!env.SOLOMON_LIBRARY) return { items: [] };
  const obj = await env.SOLOMON_LIBRARY.get(LIBRARY_MANIFEST_KEY);
  if (!obj) return { items: [] };
  try { return JSON.parse(await obj.text()); }
  catch { return { items: [] }; }
}

async function writeLibraryManifest(env, manifest) {
  await env.SOLOMON_LIBRARY.put(LIBRARY_MANIFEST_KEY, JSON.stringify(manifest));
}

function estimateTokens(text) {
  // Rough: ~4 chars per token for English. Fine for cost visibility.
  return Math.ceil(String(text || "").length / 4);
}

function randomLibraryId() {
  return "lib_" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

// GET /asksolomon/library — return the manifest (list of items with metadata).
async function handleLibraryList(request, env) {
  if (!checkConsolePassword(request, env)) return json({ success: false, error: "Unauthorized" }, 401);
  if (!env.SOLOMON_LIBRARY) return json({ success: false, error: "Library storage not configured" }, 500);
  const manifest = await readLibraryManifest(env);
  return json({ success: true, items: manifest.items || [] });
}

// POST /asksolomon/library — multipart upload with fields: category, description, file.
// Stores the file in R2 and appends metadata to the manifest.
async function handleLibraryUpload(request, env) {
  if (!checkConsolePassword(request, env)) return json({ success: false, error: "Unauthorized" }, 401);
  if (!env.SOLOMON_LIBRARY) return json({ success: false, error: "Library storage not configured" }, 500);

  let formData;
  try { formData = await request.formData(); }
  catch { return json({ success: false, error: "Invalid multipart/form-data body" }, 400); }

  const file = formData.get("file");
  const category = String(formData.get("category") || "").trim();
  const description = String(formData.get("description") || "").trim();

  if (!file || typeof file === "string") return json({ success: false, error: "Missing 'file' field" }, 400);
  if (!LIBRARY_CATEGORIES.has(category)) {
    return json({ success: false, error: "Invalid category. Must be one of: " + [...LIBRARY_CATEGORIES].join(", ") }, 400);
  }
  if (file.size > LIBRARY_MAX_BYTES) return json({ success: false, error: "File too large (max 512KB per item)" }, 413);

  // Read as text; if it's binary/PDF we still store the raw bytes but Solomon
  // will need text — MVP treats everything as text and warns on decode failure.
  let text;
  try { text = await file.text(); }
  catch { return json({ success: false, error: "Couldn't decode file as text — upload plain .txt or .md" }, 400); }

  if (!text.trim()) return json({ success: false, error: "File is empty" }, 400);

  const id = randomLibraryId();
  const safeName = String(file.name || "unnamed").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const storagePath = `library/${category}/${id}-${safeName}`;

  await env.SOLOMON_LIBRARY.put(storagePath, text, {
    httpMetadata: { contentType: "text/plain; charset=utf-8" },
  });

  const manifest = await readLibraryManifest(env);
  manifest.items = manifest.items || [];
  manifest.items.unshift({
    id,
    name: safeName,
    category,
    description: description.slice(0, 500) || "(no description)",
    size: text.length,
    tokenEstimate: estimateTokens(text),
    uploadedAt: new Date().toISOString(),
    storagePath,
  });
  await writeLibraryManifest(env, manifest);

  return json({ success: true, id, item: manifest.items[0] });
}

// DELETE /asksolomon/library/{id} — soft-delete: move to archive bucket, drop from manifest.
async function handleLibraryDelete(id, request, env) {
  if (!checkConsolePassword(request, env)) return json({ success: false, error: "Unauthorized" }, 401);
  if (!env.SOLOMON_LIBRARY) return json({ success: false, error: "Library storage not configured" }, 500);

  const manifest = await readLibraryManifest(env);
  const idx = (manifest.items || []).findIndex(i => i.id === id);
  if (idx === -1) return json({ success: false, error: "Item not found" }, 404);

  const item = manifest.items[idx];
  const obj = await env.SOLOMON_LIBRARY.get(item.storagePath);
  if (obj && env.SOLOMON_LIBRARY_ARCHIVE) {
    const text = await obj.text();
    await env.SOLOMON_LIBRARY_ARCHIVE.put(
      `archived/${new Date().toISOString().slice(0, 10)}/${item.storagePath.replace(/^library\//, "")}`,
      text,
      { httpMetadata: { contentType: "text/plain; charset=utf-8" } }
    );
  }
  await env.SOLOMON_LIBRARY.delete(item.storagePath);
  manifest.items.splice(idx, 1);
  await writeLibraryManifest(env, manifest);
  return json({ success: true, id });
}

// Given a list of library item ids, fetch their content and return a labeled
// concatenated string to append to Solomon's system prompt.
async function buildLibraryContext(env, ids) {
  if (!env.SOLOMON_LIBRARY || !ids || !ids.length) return "";
  const manifest = await readLibraryManifest(env);
  const included = manifest.items.filter(i => ids.includes(i.id));
  if (!included.length) return "";
  const chunks = await Promise.all(included.map(async (item) => {
    const obj = await env.SOLOMON_LIBRARY.get(item.storagePath);
    if (!obj) return "";
    const body = await obj.text();
    const catLabel = item.category.replace("_", " ").toUpperCase();
    return `\n=== ${catLabel}: ${item.name}${item.description && item.description !== "(no description)" ? " — " + item.description : ""} ===\n${body}\n=== END ${catLabel} ===\n`;
  }));
  const combined = chunks.filter(Boolean).join("\n");
  return combined
    ? `\n\n== REFERENCE MATERIAL from Miguel's library (transcripts, testimonials, examples). Learn from Miguel's voice + patterns. Do NOT quote verbatim to the client — use as internal reference only. ==${combined}\n== END REFERENCE MATERIAL ==\n`
    : "";
}
// ----- end reference library -----

// ----- Server-side session history (Fix B) -----
// Cross-device / team-shared history for Ask Solomon runs. Backed by the same
// SOLOMON_LIBRARY R2 bucket under a `history/` prefix so no new binding is
// required.
//
// Layout:
//   history/manifest.json         — up to HISTORY_MANIFEST_LIMIT run summaries
//   history/runs/{YYYY-MM-DD}/{id}.json — full run body (answers + full result)
//   (soft-deletes archived to SOLOMON_LIBRARY_ARCHIVE under archived-history/)
//
// A "summary" is small enough to list hundreds cheaply; the full body is
// lazy-loaded on demand when the user opens a run.

const HISTORY_MANIFEST_KEY = "history/manifest.json";
const HISTORY_MANIFEST_LIMIT = 500;
const HISTORY_RUN_MAX_BYTES = 512 * 1024; // 512KB per run — plenty for even large reports

async function readHistoryManifest(env) {
  if (!env.SOLOMON_LIBRARY) return { items: [] };
  const obj = await env.SOLOMON_LIBRARY.get(HISTORY_MANIFEST_KEY);
  if (!obj) return { items: [] };
  try { return JSON.parse(await obj.text()); }
  catch { return { items: [] }; }
}

async function writeHistoryManifest(env, manifest) {
  await env.SOLOMON_LIBRARY.put(HISTORY_MANIFEST_KEY, JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json" },
  });
}

// Extract the minimal summary shown in the sidebar. Kept small on purpose so
// the manifest stays cheap to fetch on page load.
function summarizeRun(run) {
  const r = run.result || {};
  return {
    id: run.id,
    ts: run.ts || new Date().toISOString(),
    tier: run.tier || "free",
    contactName: (run.contact && run.contact.name) || "",
    contactEmail: (run.contact && run.contact.email) || "",
    path: r.path || "",
    opportunityFlagsCount: Array.isArray(r.opportunityFlags) ? r.opportunityFlags.length : 0,
    feedback: run.feedback || null,
    feedbackNote: run.feedbackNote || "",
    // Storage path is server-controlled; used to fetch the full body.
    storagePath: run.storagePath,
  };
}

function historyStoragePath(id, ts) {
  const day = (ts || new Date().toISOString()).slice(0, 10); // YYYY-MM-DD
  return `history/runs/${day}/${id}.json`;
}

// GET /asksolomon/history — return manifest summaries.
async function handleHistoryList(request, env) {
  if (!checkConsolePassword(request, env)) return json({ success: false, error: "Unauthorized" }, 401);
  if (!env.SOLOMON_LIBRARY) return json({ success: false, error: "History storage not configured" }, 500);
  const manifest = await readHistoryManifest(env);
  return json({ success: true, items: manifest.items || [] });
}

// GET /asksolomon/history/{id} — return the full run body.
async function handleHistoryGet(id, request, env) {
  if (!checkConsolePassword(request, env)) return json({ success: false, error: "Unauthorized" }, 401);
  if (!env.SOLOMON_LIBRARY) return json({ success: false, error: "History storage not configured" }, 500);
  const manifest = await readHistoryManifest(env);
  const item = (manifest.items || []).find(i => i.id === id);
  if (!item || !item.storagePath) return json({ success: false, error: "Run not found" }, 404);
  const obj = await env.SOLOMON_LIBRARY.get(item.storagePath);
  if (!obj) return json({ success: false, error: "Run body missing" }, 404);
  try {
    const run = JSON.parse(await obj.text());
    return json({ success: true, run });
  } catch {
    return json({ success: false, error: "Run body corrupted" }, 500);
  }
}

// POST /asksolomon/history — append a run.
// Body: the run object as saved locally by the console page.
async function handleHistoryAppend(request, env) {
  if (!checkConsolePassword(request, env)) return json({ success: false, error: "Unauthorized" }, 401);
  if (!env.SOLOMON_LIBRARY) return json({ success: false, error: "History storage not configured" }, 500);

  let run;
  try { run = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  if (!run || typeof run !== "object" || !run.id) {
    return json({ success: false, error: "Missing run.id" }, 400);
  }

  const body = JSON.stringify(run);
  if (body.length > HISTORY_RUN_MAX_BYTES) {
    return json({ success: false, error: "Run body exceeds 512KB — refusing to persist" }, 413);
  }

  const storagePath = historyStoragePath(run.id, run.ts);
  await env.SOLOMON_LIBRARY.put(storagePath, body, {
    httpMetadata: { contentType: "application/json" },
  });

  const manifest = await readHistoryManifest(env);
  manifest.items = manifest.items || [];

  // Replace-or-prepend — a re-save (feedback edit, regenerate flow) shouldn't dupe.
  const existingIdx = manifest.items.findIndex(i => i.id === run.id);
  const summary = summarizeRun({ ...run, storagePath });
  if (existingIdx !== -1) {
    manifest.items.splice(existingIdx, 1);
  }
  manifest.items.unshift(summary);

  // Trim tail — oldest entries fall off. Their bodies stay in R2 (small footprint,
  // recoverable if we ever want lifetime history), just not listed on the dashboard.
  if (manifest.items.length > HISTORY_MANIFEST_LIMIT) {
    manifest.items.length = HISTORY_MANIFEST_LIMIT;
  }

  await writeHistoryManifest(env, manifest);
  return json({ success: true, id: run.id, summary });
}

// PATCH /asksolomon/history/{id} — update feedback / feedbackNote on a run.
// Small partial update that touches both the manifest summary and the full body.
async function handleHistoryPatch(id, request, env) {
  if (!checkConsolePassword(request, env)) return json({ success: false, error: "Unauthorized" }, 401);
  if (!env.SOLOMON_LIBRARY) return json({ success: false, error: "History storage not configured" }, 500);

  let patch;
  try { patch = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const manifest = await readHistoryManifest(env);
  const idx = (manifest.items || []).findIndex(i => i.id === id);
  if (idx === -1) return json({ success: false, error: "Run not found" }, 404);
  const item = manifest.items[idx];

  const allowed = {};
  if (patch.feedback === "up" || patch.feedback === "down" || patch.feedback === null) allowed.feedback = patch.feedback;
  if (typeof patch.feedbackNote === "string") allowed.feedbackNote = patch.feedbackNote.slice(0, 1000);
  if (!Object.keys(allowed).length) return json({ success: false, error: "No supported fields to patch" }, 400);

  Object.assign(item, allowed);

  // Update the full body too, so a later GET returns the latest feedback.
  const obj = await env.SOLOMON_LIBRARY.get(item.storagePath);
  if (obj) {
    try {
      const run = JSON.parse(await obj.text());
      Object.assign(run, allowed);
      await env.SOLOMON_LIBRARY.put(item.storagePath, JSON.stringify(run), {
        httpMetadata: { contentType: "application/json" },
      });
    } catch { /* body corrupt — manifest still updated */ }
  }

  await writeHistoryManifest(env, manifest);
  return json({ success: true, id, item });
}

// DELETE /asksolomon/history/{id} — soft-delete: archive body, drop from manifest.
async function handleHistoryDelete(id, request, env) {
  if (!checkConsolePassword(request, env)) return json({ success: false, error: "Unauthorized" }, 401);
  if (!env.SOLOMON_LIBRARY) return json({ success: false, error: "History storage not configured" }, 500);

  const manifest = await readHistoryManifest(env);
  const idx = (manifest.items || []).findIndex(i => i.id === id);
  if (idx === -1) return json({ success: false, error: "Run not found" }, 404);
  const item = manifest.items[idx];

  const obj = await env.SOLOMON_LIBRARY.get(item.storagePath);
  if (obj && env.SOLOMON_LIBRARY_ARCHIVE) {
    const text = await obj.text();
    const archivePath = `archived-history/${new Date().toISOString().slice(0, 10)}/${item.storagePath.replace(/^history\//, "")}`;
    await env.SOLOMON_LIBRARY_ARCHIVE.put(archivePath, text, {
      httpMetadata: { contentType: "application/json" },
    });
  }
  await env.SOLOMON_LIBRARY.delete(item.storagePath);
  manifest.items.splice(idx, 1);
  await writeHistoryManifest(env, manifest);
  return json({ success: true, id });
}

// DELETE /asksolomon/history — wipe the manifest. Archives a snapshot first so
// a fat-finger from the dashboard's "Clear history" button is recoverable.
async function handleHistoryWipe(request, env) {
  if (!checkConsolePassword(request, env)) return json({ success: false, error: "Unauthorized" }, 401);
  if (!env.SOLOMON_LIBRARY) return json({ success: false, error: "History storage not configured" }, 500);
  const manifest = await readHistoryManifest(env);
  if (env.SOLOMON_LIBRARY_ARCHIVE) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await env.SOLOMON_LIBRARY_ARCHIVE.put(
      `archived-history/manifest-snapshots/${stamp}.json`,
      JSON.stringify(manifest),
      { httpMetadata: { contentType: "application/json" } }
    );
  }
  await writeHistoryManifest(env, { items: [] });
  return json({ success: true, cleared: (manifest.items || []).length });
}

// ----- end server-side session history -----

// ----- Server-side bookmarks (Fix B, extended) -----
// Same shape as history: a manifest of summaries + per-bookmark body files.
// Bookmarks differ from history in three ways:
//   - No upper cap (500) — bookmarks are Miguel's curated wins, keep them all
//   - Include a `label` field
//   - Never auto-trim, only explicit delete removes an entry

const BOOKMARKS_MANIFEST_KEY = "bookmarks/manifest.json";
const BOOKMARKS_RUN_MAX_BYTES = 512 * 1024;

async function readBookmarksManifest(env) {
  if (!env.SOLOMON_LIBRARY) return { items: [] };
  const obj = await env.SOLOMON_LIBRARY.get(BOOKMARKS_MANIFEST_KEY);
  if (!obj) return { items: [] };
  try { return JSON.parse(await obj.text()); }
  catch { return { items: [] }; }
}

async function writeBookmarksManifest(env, manifest) {
  await env.SOLOMON_LIBRARY.put(BOOKMARKS_MANIFEST_KEY, JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json" },
  });
}

function summarizeBookmark(bookmark) {
  const r = bookmark.result || {};
  return {
    id: bookmark.id,
    ts: bookmark.ts || new Date().toISOString(),
    label: bookmark.label || "",
    tier: bookmark.tier || "free",
    contactName: (bookmark.contact && bookmark.contact.name) || "",
    contactEmail: (bookmark.contact && bookmark.contact.email) || "",
    path: r.path || "",
    feedback: bookmark.feedback || null,
    feedbackNote: bookmark.feedbackNote || "",
    storagePath: bookmark.storagePath,
  };
}

function bookmarkStoragePath(id, ts) {
  const day = (ts || new Date().toISOString()).slice(0, 10);
  return `bookmarks/runs/${day}/${id}.json`;
}

async function handleBookmarksList(request, env) {
  if (!checkConsolePassword(request, env)) return json({ success: false, error: "Unauthorized" }, 401);
  if (!env.SOLOMON_LIBRARY) return json({ success: false, error: "Bookmarks storage not configured" }, 500);
  const manifest = await readBookmarksManifest(env);
  return json({ success: true, items: manifest.items || [] });
}

async function handleBookmarkGet(id, request, env) {
  if (!checkConsolePassword(request, env)) return json({ success: false, error: "Unauthorized" }, 401);
  if (!env.SOLOMON_LIBRARY) return json({ success: false, error: "Bookmarks storage not configured" }, 500);
  const manifest = await readBookmarksManifest(env);
  const item = (manifest.items || []).find(i => i.id === id);
  if (!item || !item.storagePath) return json({ success: false, error: "Bookmark not found" }, 404);
  const obj = await env.SOLOMON_LIBRARY.get(item.storagePath);
  if (!obj) return json({ success: false, error: "Bookmark body missing" }, 404);
  try {
    const bookmark = JSON.parse(await obj.text());
    return json({ success: true, bookmark });
  } catch {
    return json({ success: false, error: "Bookmark body corrupted" }, 500);
  }
}

async function handleBookmarkAppend(request, env) {
  if (!checkConsolePassword(request, env)) return json({ success: false, error: "Unauthorized" }, 401);
  if (!env.SOLOMON_LIBRARY) return json({ success: false, error: "Bookmarks storage not configured" }, 500);

  let bookmark;
  try { bookmark = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }
  if (!bookmark || typeof bookmark !== "object" || !bookmark.id) {
    return json({ success: false, error: "Missing bookmark.id" }, 400);
  }

  const body = JSON.stringify(bookmark);
  if (body.length > BOOKMARKS_RUN_MAX_BYTES) {
    return json({ success: false, error: "Bookmark body exceeds 512KB" }, 413);
  }

  const storagePath = bookmarkStoragePath(bookmark.id, bookmark.ts);
  await env.SOLOMON_LIBRARY.put(storagePath, body, {
    httpMetadata: { contentType: "application/json" },
  });

  const manifest = await readBookmarksManifest(env);
  manifest.items = manifest.items || [];
  const existingIdx = manifest.items.findIndex(i => i.id === bookmark.id);
  const summary = summarizeBookmark({ ...bookmark, storagePath });
  if (existingIdx !== -1) manifest.items.splice(existingIdx, 1);
  manifest.items.unshift(summary);
  await writeBookmarksManifest(env, manifest);
  return json({ success: true, id: bookmark.id, summary });
}

async function handleBookmarkPatch(id, request, env) {
  if (!checkConsolePassword(request, env)) return json({ success: false, error: "Unauthorized" }, 401);
  if (!env.SOLOMON_LIBRARY) return json({ success: false, error: "Bookmarks storage not configured" }, 500);

  let patch;
  try { patch = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const manifest = await readBookmarksManifest(env);
  const idx = (manifest.items || []).findIndex(i => i.id === id);
  if (idx === -1) return json({ success: false, error: "Bookmark not found" }, 404);
  const item = manifest.items[idx];

  const allowed = {};
  if (typeof patch.label === "string") allowed.label = patch.label.slice(0, 200);
  if (patch.feedback === "up" || patch.feedback === "down" || patch.feedback === null) allowed.feedback = patch.feedback;
  if (typeof patch.feedbackNote === "string") allowed.feedbackNote = patch.feedbackNote.slice(0, 1000);
  if (!Object.keys(allowed).length) return json({ success: false, error: "No supported fields to patch" }, 400);

  Object.assign(item, allowed);
  const obj = await env.SOLOMON_LIBRARY.get(item.storagePath);
  if (obj) {
    try {
      const bookmark = JSON.parse(await obj.text());
      Object.assign(bookmark, allowed);
      await env.SOLOMON_LIBRARY.put(item.storagePath, JSON.stringify(bookmark), {
        httpMetadata: { contentType: "application/json" },
      });
    } catch { /* body corrupt — manifest still updated */ }
  }
  await writeBookmarksManifest(env, manifest);
  return json({ success: true, id, item });
}

async function handleBookmarkDelete(id, request, env) {
  if (!checkConsolePassword(request, env)) return json({ success: false, error: "Unauthorized" }, 401);
  if (!env.SOLOMON_LIBRARY) return json({ success: false, error: "Bookmarks storage not configured" }, 500);
  const manifest = await readBookmarksManifest(env);
  const idx = (manifest.items || []).findIndex(i => i.id === id);
  if (idx === -1) return json({ success: false, error: "Bookmark not found" }, 404);
  const item = manifest.items[idx];

  const obj = await env.SOLOMON_LIBRARY.get(item.storagePath);
  if (obj && env.SOLOMON_LIBRARY_ARCHIVE) {
    const text = await obj.text();
    const archivePath = `archived-bookmarks/${new Date().toISOString().slice(0, 10)}/${item.storagePath.replace(/^bookmarks\//, "")}`;
    await env.SOLOMON_LIBRARY_ARCHIVE.put(archivePath, text, {
      httpMetadata: { contentType: "application/json" },
    });
  }
  await env.SOLOMON_LIBRARY.delete(item.storagePath);
  manifest.items.splice(idx, 1);
  await writeBookmarksManifest(env, manifest);
  return json({ success: true, id });
}

// ----- end server-side bookmarks -----

// ----- Server-side saved rubrics (Fix B, extended) -----
// Rubric variants are small (a few KB of text) so we keep them all inline in
// one manifest file — no per-item body objects. Simpler than history/bookmarks
// and cheap to fetch on page load.

const RUBRICS_MANIFEST_KEY = "rubrics/manifest.json";
const RUBRIC_TEXT_MAX_BYTES = 64 * 1024; // 64KB per rubric variant — well beyond realistic length

async function readRubricsManifest(env) {
  if (!env.SOLOMON_LIBRARY) return { items: [] };
  const obj = await env.SOLOMON_LIBRARY.get(RUBRICS_MANIFEST_KEY);
  if (!obj) return { items: [] };
  try { return JSON.parse(await obj.text()); }
  catch { return { items: [] }; }
}

async function writeRubricsManifest(env, manifest) {
  await env.SOLOMON_LIBRARY.put(RUBRICS_MANIFEST_KEY, JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json" },
  });
}

async function handleRubricsList(request, env) {
  if (!checkConsolePassword(request, env)) return json({ success: false, error: "Unauthorized" }, 401);
  if (!env.SOLOMON_LIBRARY) return json({ success: false, error: "Rubrics storage not configured" }, 500);
  const manifest = await readRubricsManifest(env);
  return json({ success: true, items: manifest.items || [] });
}

async function handleRubricsAppend(request, env) {
  if (!checkConsolePassword(request, env)) return json({ success: false, error: "Unauthorized" }, 401);
  if (!env.SOLOMON_LIBRARY) return json({ success: false, error: "Rubrics storage not configured" }, 500);

  let rubric;
  try { rubric = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }
  if (!rubric || typeof rubric !== "object") {
    return json({ success: false, error: "Invalid rubric body" }, 400);
  }
  const label = String(rubric.label || "").trim().slice(0, 120);
  const text = String(rubric.text || "").trim();
  if (!label) return json({ success: false, error: "label is required" }, 400);
  if (!text) return json({ success: false, error: "text is required" }, 400);
  if (text.length > RUBRIC_TEXT_MAX_BYTES) return json({ success: false, error: "Rubric text exceeds 64KB" }, 413);

  const id = rubric.id || ("rubric_" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6));
  const ts = rubric.ts || new Date().toISOString();

  const manifest = await readRubricsManifest(env);
  manifest.items = manifest.items || [];
  const existingIdx = manifest.items.findIndex(i => i.id === id);
  const entry = { id, label, text, ts };
  if (existingIdx !== -1) manifest.items.splice(existingIdx, 1);
  manifest.items.unshift(entry);
  await writeRubricsManifest(env, manifest);
  return json({ success: true, id, item: entry });
}

async function handleRubricDelete(id, request, env) {
  if (!checkConsolePassword(request, env)) return json({ success: false, error: "Unauthorized" }, 401);
  if (!env.SOLOMON_LIBRARY) return json({ success: false, error: "Rubrics storage not configured" }, 500);
  const manifest = await readRubricsManifest(env);
  const idx = (manifest.items || []).findIndex(i => i.id === id);
  if (idx === -1) return json({ success: false, error: "Rubric not found" }, 404);
  const [removed] = manifest.items.splice(idx, 1);
  if (env.SOLOMON_LIBRARY_ARCHIVE) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await env.SOLOMON_LIBRARY_ARCHIVE.put(
      `archived-rubrics/${stamp}-${id}.json`,
      JSON.stringify(removed),
      { httpMetadata: { contentType: "application/json" } }
    );
  }
  await writeRubricsManifest(env, manifest);
  return json({ success: true, id });
}

// ----- end server-side saved rubrics -----

// ----- GHL survey webhook — the "no more Vibe" bridge -----
// GHL surveys write answers into contact custom fields. This endpoint receives
// a GHL workflow webhook after a survey submits, fetches the contact, maps
// field IDs to human-readable questions, runs Solomon, and writes back.
// Solomon lives on Cloudflare Worker — nothing hits Vibe.

// Maps GHL custom-field IDs → the labeled question Solomon should see.
// Free-tier IDs known from the Vibe app export (AssessmentScreen.tsx).
// $47 and $297 fields fall back to whatever value+ID pair GHL returns; the
// worker synthesizes a question from the field ID if not in the map (Solomon
// figures out semantics from the answer text at that point).
const SURVEY_FIELD_MAP = {
  // FREE tier (P1-P3 + Q1-Q8)
  "5VWVNRrQYcLqXhckh4f4": "What best describes your business type?",
  "nCRqWH0x1sdJIgUPDr2E": "How do you primarily reach your customers?",
  "nbPL6APmjrjr43J6urVb": "What industry or vertical best describes your business?",
  "OyQjw4nGNHJYADsq5ggg": "Do you currently have any active judgments, tax liens, or corporate debt you're actively managing?",
  "8sSKohKtQZZzJEtM2ju0": "When you make business decisions, are you basing them on your actual numbers or on what's in your bank account?",
  "deItnw0p1H7sO1okRjGS": "What does your business consistently deliver that your clients say they can't get anywhere else?",
  "hV9yij5uFitztZzanSaa": "When a client refers you, what specific words or outcome do they use to describe what you did for them?",
  "ngBePHf4iKPhaHm2OtSv": "Where does revenue most often leak in your business?",
  "cvuAgfuL94eBahOrnTY0": "What would change in your business if you had 20% more profit on the same revenue?",
  "cdlV9zqJxztcxfXgD4J0": "Where do you see demand in your market that you're not yet positioned to capture?",
  "qKRvCyjprebbK75tC05h": "What would happen to your business if your single largest client, revenue source, or referral channel disappeared in the next 90 days?",
};

// Fields Solomon writes to and should never re-consume as "answers" — otherwise
// a re-triggered run would feed the previous report back as an intake answer.
const SOLOMON_OWNED_FIELDS = new Set([
  "Ys28pMUc82cURfnsbQzY", // swot_free_report
  "pa6VF4GsufGuTAjlFVnf", // swot_full_report
  "XEuWL4vobueOpZGBFdLm", // business_playbook
  "UnnWDCV53D8UZp1QHs6M", // swot_path
  "v8aZ5KjE8GDXDX0S8z0d", // swot_rehab_flag
  "OnB1KqsPr0OHHidW3K3g", // swot_deep_dive_booked
  "kmZcNfFytZzwd6PbE7AT", // swot_strategist_brief
  "wjWicVUPs2IiXSl7gzBs", // swot_email_blurb
  "2tOTD1ifIR1G9ayA0Y8t", // swot_report_path
]);

async function fetchGHLContact(contactId, env) {
  if (!contactId || !env.GHL_API_KEY) return null;
  const res = await fetch(`${CONFIG.GHL_API_BASE}/contacts/${contactId}`, {
    headers: {
      Authorization: `Bearer ${env.GHL_API_KEY}`,
      Version: "2021-07-28",
    },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data?.contact || null;
}

// GHL custom-fields catalog (shared with worker/src/bga_copilot/*).
// Historical state (two module-level cache slots + the fetch function +
// the distinguished error class) now lives in ./ghl_catalog.js. All
// callers in this file use the same cache instance by virtue of module
// identity. Codex P1 on #93: BGA case endpoints need the same catalog
// to resolve customFields; keeping it as a single-source-of-truth
// module avoids drift between the two paths.
// See ./ghl_catalog.js for behavior; this file just imports.

// Build the {question, answer} array Solomon expects from the contact's
// custom fields.
//
// GHL's /contacts/{id} endpoint returns customFields as bare {id, value} —
// the name / fieldKey metadata lives on /locations/{loc}/customFields
// instead. We fetch that catalog once per worker instance (5-min TTL) and
// hydrate every bare payload before applying filters or labels. Without
// hydration, name-based exclusions like "swot_" prefix can't fire on
// bare payloads and Solomon-owned fields (swot_297_score,
// swot_last_event_type, swot_internal_notes, etc.) would leak back into
// intake on re-runs.
//
// Labeling precedence: SURVEY_FIELD_MAP (curated) → catalog name →
// catalog fieldKey. Fields that remain unresolved after hydration are
// DROPPED — feeding an opaque "field <id>" label alongside a raw dollar
// amount is worse than a missing answer, because Solomon cannot tell
// whether "$150000" is total-debt, monthly-service, or annual-revenue.
async function answersFromContactFields(contact, env) {
  const cfs = contact?.customFields || [];
  const dropped = [];
  const catalog = env ? await fetchGHLCustomFieldsCatalog(env) : {};

  // Hydrate: merge each bare {id, value} with the catalog's {name, fieldKey}
  // so downstream filters and labelers see the same shape whether GHL
  // returned bare or enriched payloads.
  const hydrated = cfs.map(f => {
    if (!f || !f.id) return f;
    const meta = catalog[f.id];
    if (!meta) return f;
    return {
      ...f,
      name: f.name || meta.name || null,
      fieldKey: f.fieldKey || f.key || meta.fieldKey || null,
    };
  });

  // Exclusion filters. A field is dropped when ANY match:
  //   1. Solomon-owned by ID (SOLOMON_OWNED_FIELDS above)
  //   2. Solomon-owned by name/key convention — anything whose key or name
  //      starts with "swot_" / "SWOT " catches fields added to GHL after
  //      the ID set was last updated (e.g. swot_297_score,
  //      swot_last_event_type, swot_internal_notes) so re-runs don't feed
  //      Solomon its own prior output as an intake answer.
  //   3. File upload fields — their "value" is a URL to the uploaded file,
  //      not analyzable text. Detected by the value being a URL string.
  //      (A dedicated file-content pipeline would be the right long-term
  //      fix; for now the LLM shouldn't see a raw URL as an "answer".)
  const isSolomonOwnedByName = (f) => {
    const key = String(f.key || f.fieldKey || "").toLowerCase();
    const name = String(f.name || "").toLowerCase();
    return key.startsWith("swot_") || key.startsWith("contact.swot_") ||
           name.startsWith("swot ") || name === "internal notes";
  };
  const looksLikeFileUpload = (f) => {
    const v = String(f.value || "").trim();
    if (!/^https?:\/\//i.test(v)) return false;
    const key = String(f.key || f.fieldKey || "").toLowerCase();
    const name = String(f.name || "").toLowerCase();
    return key.includes("file_upload") || key.includes("upload") ||
           name.includes("file upload") || name.includes("upload") ||
           /\.(pdf|xlsx|xls|csv|docx?|png|jpg|jpeg)(\?|$)/i.test(v);
  };

  const mapped = hydrated
    .filter(f => f && f.value && String(f.value).trim())
    .filter(f => !SOLOMON_OWNED_FIELDS.has(f.id))
    .filter(f => !isSolomonOwnedByName(f))
    .filter(f => !looksLikeFileUpload(f))
    .map(f => {
      const curated = SURVEY_FIELD_MAP[f.id];
      const fallback = f.name || f.fieldKey || f.key || null;
      const question = curated || fallback || null;
      if (!question) {
        // Unresolved after catalog hydration — drop rather than feed an
        // opaque label. A dollar amount without its question would let
        // Solomon guess wrong about which number answers which prompt.
        dropped.push(f.id || "(no id)");
        return null;
      }
      return {
        question,
        answer: String(f.value).trim(),
        _source: curated ? "mapped" : "fallback",
      };
    })
    .filter(Boolean)
    .map(({ _source, ...rest }) => rest);
  if (dropped.length) {
    console.warn(`[answersFromContactFields] Dropped ${dropped.length} unresolved field(s) (no catalog match, no name/key): ${dropped.join(", ")}.`);
  }
  return mapped;
}

// POST /from-ghl-survey — GHL workflow webhook after a survey submits.
// Body: { contactId, tier } — tier is "free" | "paid_47" | "paid_297"
// Optional: rubricOverride (for testing new rubrics against real submissions)
//
// AUTH: Endpoint is publicly reachable, and a contact ID is exposed to end users
// via the /report/{contactId} URL. Without protection anyone can POST here with
// tier=paid_297 and get a Business Growth Analysis generated + swot_paid_297 tag applied.
// Two-layer defense:
//   1. Shared secret compared to env.WEBHOOK_SECRET. Accepted via EITHER
//      `x-webhook-secret: <secret>` OR `Authorization: Bearer <secret>` — GHL's
//      webhook UI stores the secret as a "Bearer token" that it sends as an
//      Authorization header, while other clients typically use the custom
//      x-webhook-secret header. Both are checked so the same env value works
//      for whichever pattern the caller uses.
//   2. For paid tiers, verify the contact ALREADY carries the matching swot_paid_*
//      tag applied by the payment workflow. Free tier is unrestricted since it
//      corresponds to an intake with no gate.
async function handleGHLSurveyWebhook(request, env, ctx, requestUrl) {
  if (env.WEBHOOK_SECRET) {
    const headerSecret = request.headers.get("x-webhook-secret");
    const authHeader = request.headers.get("Authorization") || request.headers.get("authorization") || "";
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    const bearerSecret = bearerMatch ? bearerMatch[1].trim() : null;
    const provided = headerSecret || bearerSecret;
    if (!provided || provided !== env.WEBHOOK_SECRET) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const contactId = body.contactId || body.contact_id || body.contact?.id;
  const tier = body.tier || "free";
  // Explicit dry-run flag — see docs/SOLOMON_ARCHITECTURE.md. When true, the
  // handler runs Solomon end-to-end but every GHL side effect is skipped
  // (writeback, tags, tracking event). The response reports dryRun:true so
  // the caller knows nothing landed on the contact.
  const dryRun = body.dry_run === true;

  const contact = await fetchGHLContact(contactId, env);
  if (!contact) return json({ success: false, error: "Contact not found in GHL" }, 404);

  // Defense in depth: paid tiers require the matching lifecycle tag (applied by
  // the GHL payment workflow). Prevents a valid webhook secret from being used
  // to escalate a free lead's tier and generate paid content without payment.
  if (tier === "paid_47" || tier === "paid_297") {
    // Gate policy per tier:
    //   paid_47  — require swot_paid_47 (real payment) OR swot_solomon50_applied
    //              (beta cohort). Payment already cleared upstream.
    //   paid_297 — the Deep Dive uses a sell-first flow: user hits this
    //              endpoint via the tier 3 survey BEFORE they pay, so we
    //              cannot require swot_paid_297. Instead require that the
    //              contact is already a paid_47 customer (or SOLOMON50
    //              beta), i.e. someone Solomon has already vetted at the
    //              earlier tier. The $150 payment workflow applies
    //              swot_paid_297 + swot_report_ready_paid_297 later, which
    //              is what actually unlocks the report page + delivery email.
    const acceptedTags = ["swot_paid_47", "swot_paid_297", "swot_solomon50_applied"];
    const contactTags = (contact.tags || []).map(t => String(t).toLowerCase());
    if (!acceptedTags.some(t => contactTags.includes(t))) {
      return json({
        success: false,
        error: `Contact does not have any of the required tag(s): ${acceptedTags.join(", ")}`,
      }, 403);
    }
  }

  let answers;
  try {
    answers = await answersFromContactFields(contact, env);
  } catch (err) {
    // GHL customFields catalog is unavailable on this cold worker — do NOT
    // fall back to just the curated free-tier labels, or we'd silently ship
    // an incomplete paid report. 502 tells GHL's workflow retry to try again.
    if (err instanceof GHLCatalogUnavailableError) {
      console.warn(`[handleGHLSurveyWebhook] catalog unavailable: ${err.message}`);
      return json({
        success: false,
        error: "GHL custom-fields catalog unavailable; retry momentarily",
      }, 502);
    }
    throw err;
  }
  if (!answers.length) return json({ success: false, error: "No answers on this contact yet" }, 400);

  // Intake-completeness gate. GHL writes survey answers back to the contact's
  // custom fields asynchronously — the "survey submitted" webhook can fire
  // before every field has landed. If we run Solomon on a half-written
  // intake we ship an INCOMPLETE INTAKE report, apply the wrong path tag,
  // and the delivery email goes out carrying a broken first-pass version
  // (idempotency's short TTL doesn't save us — the second webhook fires
  // minutes later with the full intake and overwrites the path tag but
  // the report HTML / email have already shipped).
  //
  // Returning 409 lets GHL's workflow retry policy re-fire once the rest of
  // the fields have persisted.
  // Identity-based gate for the free tier (Codex P1 on #137): pass the
  // raw customFields so the gate counts only Q1-Q11 field IDs, not every
  // populated non-Solomon CRM field. Historical-submission bypass
  // (Codex P2 on #137): callers may pass `allowPartial: true` to let a
  // pre-contract contact proceed; Solomon's INCOMPLETE INTAKE rules then
  // handle whatever fields did land.
  const completeness = checkIntakeCompleteness(answers, tier, {
    rawCustomFields: contact.customFields || [],
    allowPartial: body.allowPartial === true,
  });
  if (!completeness.ok) {
    console.warn(`[from-ghl-survey] intake short (${completeness.answersSeen} of ${completeness.minExpected} expected for ${tier}, identityCheck=${!!completeness.identityCheck}) for contact ${contact.id}; deferring`);
    return json({
      success: false,
      error: "Intake not yet complete; retry when all survey fields have landed, or re-POST with allowPartial:true to process a historical/partial submission.",
      tier,
      contactId: contact.id,
      answersSeen: completeness.answersSeen,
      minExpected: completeness.minExpected,
      identityCheck: !!completeness.identityCheck,
    }, 409);
  }
  if (completeness.partial) {
    console.warn(`[from-ghl-survey] allowPartial=true — proceeding with ${completeness.answersSeen} intake answer(s) for contact ${contact.id}; Solomon's INCOMPLETE INTAKE rules take over.`);
  }

  const contactPayload = {
    name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.contactName || "Business Owner",
    email: contact.email || "",
    contactId: contact.id,
  };

  const businessProfile = {}; // Reserved for future paid-tier profile fields.

  // Phase 2A + 2B + 2C: compute normalization and derived metrics BEFORE
  // Solomon runs so we can inject the deterministic FACTS and DERIVED
  // METRICS into the prompt. The rubric is instructed to cite only these
  // typed values when emitting structured_findings; the post-parse
  // validator (below) rejects any finding that references a field or
  // metric that isn't here. On catalog unavailability we log and
  // continue with facts=null; Solomon still produces the prose output.
  let normalizedAnswers = null;
  let derivedMetrics = null;
  let factsBundle = null;
  try {
    const catalog = await fetchGHLCustomFieldsCatalog(env);
    normalizedAnswers = normalizeContactFields(contact, catalog);
    derivedMetrics = deriveMetrics(flatNormalized(normalizedAnswers));
    factsBundle = buildFactsForPrompt(normalizedAnswers, derivedMetrics);
  } catch (err) {
    console.warn(`[handleGHLSurveyWebhook] normalization/derived skipped (catalog unavailable): ${err?.message || err}`);
  }

  const prompt = buildPrompt(tier, answers, contactPayload, businessProfile, factsBundle);
  const rubric = ASSESSMENT_RUBRIC;

  // Idempotency: skip if we already ran for this contact+tier moments ago
  // (double-submit or a GHL webhook retry) — avoids a duplicate report + email.
  //
  // Replay escape hatch (2026-10-28): when a prior run was cancelled by
  // the client-disconnect timeout (the pre-async-split failure mode) or
  // crashed mid-run, the idempotency reservation stays live for 3
  // minutes with no completion marker. Every retry within that window
  // short-circuits with {deduped: true} and never generates the report
  // — Liz hit this when resending the webhook from the HL workflow
  // after the first run timed out. Pass `replay: true` in the body
  // (or `?replay=1` on the URL) to force a fresh run, releasing the
  // stale reservation first. HL's "Re-execute" step can be configured
  // to carry this flag so a manual re-run always clears the guard.
  const replayRequested = body?.replay === true
    || body?.force === true
    || requestUrl.searchParams.get("replay") === "1"
    || requestUrl.searchParams.get("force") === "1";
  const idemKey = `${contact.id}_${tier}`;
  if (replayRequested) {
    const staleIdemPath = `idem/${encodeURIComponent(idemKey)}.json`;
    await releaseIdempotency(staleIdemPath, env).catch(() => {});
    console.warn(`[from-ghl-survey] replay flag set — cleared idempotency for ${idemKey}`);
  }
  const idem = await reserveIdempotency(idemKey, env);
  if (idem.duplicate) {
    return json({
      success: true,
      deduped: true,
      contactId: contact.id,
      tier,
      hint: "A prior run reserved this contact+tier within the last 3 minutes. If that run was cancelled mid-execution (client timeout, worker crash), pass `replay: true` in the body to force a fresh generation.",
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // QUEUE DISPATCH (2026-10-28 Codex P1 follow-up on #154).
  //
  // HL's custom webhook has a HARD 60-second response timeout and
  // Cloudflare's ctx.waitUntil caps at 30 seconds after response send,
  // so the prior async-split still cancelled paid_47 and paid_297 runs
  // (60-180s wall-clock) — just silently instead of visibly. Cloudflare's
  // own docs point at Queues for exactly this pattern:
  //
  //   > If the work cannot finish within the waitUntil() time limit,
  //   > send messages to a Queue and process them in a separate consumer
  //   > Worker. Queues provide reliable delivery and automatic retries.
  //
  // Flow:
  //   1. Every sync gate above this point ran, so a bad request already
  //      got a meaningful HTTP error (401/403/404/409/502).
  //   2. The idempotency reservation is already live — a concurrent dupe
  //      won't enqueue twice.
  //   3. Enqueue a MINIMAL payload (contactId, tier, dryRun, source_event_id,
  //      idem path, request origin). The queue consumer re-fetches the
  //      contact + rebuilds answers + runs Solomon end-to-end with the
  //      full 15-minute per-invocation budget and automatic retries.
  //   4. Return 202 immediately so HL's workflow action succeeds in <5s.
  //
  // Fallback: when the queue binding isn't provisioned yet (missing
  // SOLOMON_QUEUE), fall back to ctx.waitUntil + the inline runAsync so
  // the endpoint keeps responding during the queue-creation window.
  // The response's `transport` field tells callers which path ran.
  // ────────────────────────────────────────────────────────────────────

  const queuePayload = {
    version: 1,
    contactId,
    tier,
    dryRun,
    allowPartial: body?.allowPartial === true,
    sourceEventId: body?.event_id || body?.webhook_id || body?.source_event_id || null,
    idemPath: idem.path,
    requestOrigin: requestUrl.origin,
    enqueuedAt: new Date().toISOString(),
  };

  if (env.SOLOMON_QUEUE && typeof env.SOLOMON_QUEUE.send === "function") {
    try {
      await env.SOLOMON_QUEUE.send(queuePayload);
      // Observability (2026-10-28): producer-side trace. If this trace
      // exists but no "received" trace follows, the queue consumer isn't
      // registered on the Worker in production — see /diag/queue-trace.
      await writeQueueTrace(env, contactId, "enqueued", { tier, source: "from-ghl-survey" });
      return json({
        success: true,
        accepted: true,
        async: true,
        transport: "queue",
        contactId,
        tier,
        note: "Solomon generation enqueued; the queue consumer runs with a 15-minute budget + automatic retries. The Reveal page's /status poll will surface the report once Solomon finishes.",
      }, 202);
    } catch (err) {
      // Enqueue failed — release idempotency so the next retry proceeds,
      // and fall through to the ctx.waitUntil fallback so this request
      // still has a chance of landing a report. Log loudly so operators
      // know queue dispatch broke.
      console.error(`[from-ghl-survey] SOLOMON_QUEUE.send failed for contact ${contactId} tier ${tier}:`, err?.message || err);
      await releaseIdempotency(idem.path, env).catch(() => {});
    }
  }

  // Fallback path (queue binding missing OR enqueue just failed): keep
  // the ctx.waitUntil shape so the endpoint doesn't 500. Paid tiers will
  // still get cancelled at ~30s past response — this is a stopgap for
  // the deploy window where queues haven't been provisioned yet.
  console.warn(`[from-ghl-survey] falling back to ctx.waitUntil for contact ${contactId} tier ${tier} — SOLOMON_QUEUE missing or send failed. Paid tiers will time out at ~30s.`);
  const idem2 = env.SOLOMON_QUEUE ? await reserveIdempotency(idemKey, env) : idem;
  if (idem2.duplicate && !idem.path) {
    return json({
      success: true,
      deduped: true,
      transport: "waituntil-fallback",
      contactId,
      tier,
    });
  }
  const runAsync = async () => {
    try {
      let agent;
      try {
        const parsed = await callClaudeAndParseWithRetry({
          env, contactId, prompt, rubric,
          trace: (stage, extra) => writeQueueTrace(env, contactId, stage, extra),
        });
        agent = parsed.agent;
      } catch (err) {
        await releaseIdempotency(idem2.path, env);
        console.error(`[from-ghl-survey:fallback] Solomon error for contact ${contactId} tier ${tier}:`, err?.message || err);
        return;
      }
      if (tier === "free") {
        agent.opportunityFlags = (agent.opportunityFlags || []).filter(f => f !== "DIGITAL_PRESENCE_OPP");
      }
      sanitizeStructuredFindings(agent, {
        normalized: factsBundle?.facts || flatNormalized(normalizedAnswers || []),
        derivedMetrics: derivedMetrics || [],
      }, `handleGHLSurveyWebhook contact ${contact.id}`);
      const reportHtml = buildReportHtml(agent);
      const canonical = await writeCanonicalRecord(env, {
        contact: { id: contactId, ...contact },
        tier, answers, agent, reportHtml,
        sourceEventId: queuePayload.sourceEventId,
        dryRun, normalizedAnswers, derivedMetrics,
      });
      if (canonical?.skipped && canonical.reason === "duplicate_submission") return;
      await finalizeSurveyWriteback({
        env, ctx, requestUrl,
        contactId, contact, tier, answers, agent, reportHtml,
        canonical, dryRun,
      });
    } catch (err) {
      await releaseIdempotency(idem2.path, env).catch(() => {});
      console.error(`[from-ghl-survey:fallback] unexpected error for contact ${contactId} tier ${tier}:`, err?.message || err);
    }
  };
  ctx.waitUntil(runAsync());
  return json({
    success: true,
    accepted: true,
    async: true,
    transport: "waituntil-fallback",
    contactId,
    tier,
    note: "SOLOMON_QUEUE not configured — using ctx.waitUntil fallback. Paid tiers will time out at ~30s. Provision solomon-generation + solomon-generation-dlq queues to unlock durable generation.",
  }, 202);
}

// Queue consumer: runs the full Solomon generation + canonical write +
// GHL writeback with a 15-minute per-invocation budget. Called by the
// Workers runtime for every message that /from-ghl-survey enqueues to
// SOLOMON_QUEUE. See the "QUEUE DISPATCH" block in
// handleGHLSurveyWebhook for the producer side.
//
// Behavior:
//   - Fresh fetch of the contact so late GHL field writebacks are visible.
//   - Rebuilds answers / normalization / facts bundle from scratch so the
//     consumer isn't tied to a stale payload shape.
//   - Runs Solomon → canonical D1/R2 write → GHL writeback → lifecycle
//     + report-ready tags → tracking event, same as the pre-queue inline
//     code path.
//
// Retries:
//   - Any thrown error reaches Queues' retry policy (max_retries from
//     wrangler.toml, exponential backoff).
//   - On the FINAL attempt, we catch the error ourselves, apply
//     swot|deliveryfailed to the contact (so an HL automation or
//     operator can see the terminal failure), release the idempotency
//     reservation (so a fresh manual re-POST can succeed), and ack the
//     message rather than throwing. If we threw, Queues would move it
//     to the DLQ, which the Worker doesn't have a consumer for yet.
// Append one trace line to R2 (SOLOMON_LIBRARY) at
// queue_traces/{contactId}/{timestamp}-{stage}.json. Fire-and-forget,
// never throws — observability must not break the pipeline it watches.
// Read via GET /diag/queue-trace/{contactId}. See the comment on that
// endpoint for the diagnostic contract.
async function writeQueueTrace(env, contactId, stage, extra = {}) {
  if (!env?.SOLOMON_LIBRARY || !contactId) return;
  const now = new Date().toISOString();
  const key = `queue_traces/${contactId}/${now}-${stage}.json`;
  try {
    const body = JSON.stringify({ ts: now, stage, contactId, ...extra });
    await env.SOLOMON_LIBRARY.put(key, body, {
      httpMetadata: { contentType: "application/json" },
    });
  } catch (err) {
    // Observability failure is itself observable — log to console but
    // don't throw up to the caller.
    console.warn(`[queue-trace] put failed for ${key}: ${err?.message || err}`);
  }
}

// paid47-v2 response quality gate wrapper. Validates the parsed agent
// response against the v2 contract; on deficiencies, regenerates once
// with the deficiency list appended as a follow-up user turn so the
// model sees its own last attempt and the exact fixes it needs.
//
// Fail-soft: if the regenerated response still fails validation, the
// v2-only fields are stripped so buildReportHtml falls back to the
// legacy renderer. The owner always gets a report; what they lose on
// a soft fail is the enriched sections, not the whole purchase.
async function runPaid47V2QualityGate({ env, contactId, prompt, rubric, raw, agent, factsBundle, derivedMetrics }) {
  const factKeys = new Set(Object.keys(factsBundle?.facts || {}));
  const metricNames = new Set((derivedMetrics || []).map((m) => m?.metric).filter(Boolean));
  const context = { validFactKeys: factKeys, validMetricNames: metricNames };

  let result = validatePaid47V2(agent, context);
  await writeQueueTrace(env, contactId, "paid47_v2_validate", {
    isV2: result.isV2,
    ok: result.ok,
    deficiencyCount: result.deficiencies.length,
    firstDeficiency: result.deficiencies[0]?.code || null,
  });

  if (result.ok) return agent;

  // Downgrade path: response didn't even claim v2 (missing version
  // tags). Nothing to regenerate — the model gave us a v1 shape under
  // the v2 contract. Strip v2-only fields and return.
  if (!result.isV2) {
    await writeQueueTrace(env, contactId, "paid47_v2_downgrade", { reason: "no_version_tags" });
    return stripPaid47V2Fields(agent);
  }

  // Try one regeneration with the deficiency list appended.
  try {
    const nudge = buildRegenerationNudge(result.deficiencies);
    await writeQueueTrace(env, contactId, "paid47_v2_regenerate_start", {
      deficiencyCount: result.deficiencies.length,
    });
    const retryRaw = await callClaudeWithRubric(prompt, rubric, env, {
      priorAssistant: raw,
      followupUser: nudge,
    });
    const retryAgent = parseAgentJson(retryRaw);
    const retryResult = validatePaid47V2(retryAgent, context);
    await writeQueueTrace(env, contactId, "paid47_v2_regenerate_done", {
      ok: retryResult.ok,
      deficiencyCount: retryResult.deficiencies.length,
    });
    if (retryResult.ok) return retryAgent;
    // Second attempt also failed — downgrade on the retry response
    // (it may still carry a usable v1 shape).
    return stripPaid47V2Fields(retryAgent);
  } catch (err) {
    await writeQueueTrace(env, contactId, "paid47_v2_regenerate_error", {
      error: String(err?.message || err).slice(0, 300),
    });
    return stripPaid47V2Fields(agent);
  }
}

// Remove the v2-only top-level fields so buildReportHtml and
// ResultsScreen fall back to the legacy paid47-v1 renderer paths.
// gaps[] and opportunities[] are preserved — they're populated under
// both contracts, just with different shapes.
function stripPaid47V2Fields(agent) {
  if (!agent || typeof agent !== "object") return agent;
  delete agent.reportSchemaVersion;
  delete agent.tierGuideVersion;
  delete agent.financialSnapshot;
  delete agent.connections;
  delete agent.questionsToClarify;
  delete agent.decisionOrder;
  delete agent.coverage;
  return agent;
}

async function handleSolomonQueueMessage(message, env) {
  const payload = message.body;
  const attemptNumber = (message.attempt ?? message.attempts ?? 1);
  const maxAttempts = 3; // keep in sync with wrangler.toml max_retries + 1 initial
  const isFinalAttempt = attemptNumber >= maxAttempts;
  const { contactId, tier, dryRun, allowPartial, sourceEventId, idemPath, requestOrigin } = payload || {};

  // Observability (2026-10-28 Codex P1 follow-up): write a trace to R2
  // at every stage so GET /diag/queue-trace/{contactId} can show
  // exactly how far the consumer got. A missing "received" trace means
  // the consumer wasn't invoked at all (queue consumer not registered,
  // or still enqueued); a trace that stops at "fetched_contact" means
  // Claude never ran; etc.
  await writeQueueTrace(env, contactId, "received", { attempt: attemptNumber, tier });

  if (!contactId || !tier) {
    console.error(`[solomon-queue] malformed payload (missing contactId/tier):`, JSON.stringify(payload));
    message.ack();
    return;
  }

  try {
    const contact = await fetchGHLContact(contactId, env);
    if (!contact) throw new Error(`contact ${contactId} not found in GHL`);
    await writeQueueTrace(env, contactId, "fetched_contact", { tier, hasTags: !!contact.tags?.length, hasFields: !!contact.customFields?.length });

    const answers = await answersFromContactFields(contact, env);
    if (!answers.length) throw new Error(`no survey answers on contact ${contactId}`);
    await writeQueueTrace(env, contactId, "built_answers", { tier, answersCount: answers.length });

    // Re-run completeness in case the first webhook landed partway
    // through HL's field writeback and the queued attempt now sees the
    // full intake. If it's still short we DO NOT want to generate on
    // half an intake — throw to let Queues retry a few minutes later,
    // by which time HL should have finished writing the rest.
    const completeness = checkIntakeCompleteness(answers, tier, {
      rawCustomFields: contact.customFields || [],
      allowPartial,
    });
    if (!completeness.ok) {
      await writeQueueTrace(env, contactId, "completeness_short", { tier, seen: completeness.answersSeen, minExpected: completeness.minExpected });
      throw new Error(`intake short for ${contactId} tier ${tier}: ${completeness.answersSeen} of ${completeness.minExpected}`);
    }

    let normalizedAnswers = null;
    let derivedMetrics = null;
    let factsBundle = null;
    try {
      const catalog = await fetchGHLCustomFieldsCatalog(env);
      normalizedAnswers = normalizeContactFields(contact, catalog);
      derivedMetrics = deriveMetrics(flatNormalized(normalizedAnswers));
      factsBundle = buildFactsForPrompt(normalizedAnswers, derivedMetrics);
    } catch (err) {
      // Catalog unavailable — Solomon can still run on raw answers, but
      // the structured_findings sanitizer will skip. Log and continue.
      console.warn(`[solomon-queue] catalog unavailable for ${contactId}:`, err?.message || err);
      await writeQueueTrace(env, contactId, "catalog_unavailable", { tier, error: String(err?.message || err).slice(0, 200) });
    }

    const contactPayload = {
      name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.contactName || "Business Owner",
      email: contact.email || "",
      contactId: contact.id,
    };
    const businessProfile = {};
    const prompt = buildPrompt(tier, answers, contactPayload, businessProfile, factsBundle);
    const rubric = ASSESSMENT_RUBRIC;

    await writeQueueTrace(env, contactId, "claude_call_start", { tier, promptBytes: prompt.length });
    const claudeStartedAt = Date.now();
    // 2026-10-29: wrap Claude call + JSON parse so a malformed-JSON
    // response (literal newline inside a string, unescaped quote,
    // trailing comma, etc.) earns ONE regeneration nudge instead of
    // 500-ing the free report to the customer. Parse failures land in
    // the queue trace at agent_json_parse_failed / _recovered.
    const parsed = await callClaudeAndParseWithRetry({
      env, contactId, prompt, rubric,
      trace: (stage, extra) => writeQueueTrace(env, contactId, stage, extra),
    });
    const raw = parsed.raw;
    let agent = parsed.agent;
    await writeQueueTrace(env, contactId, "claude_call_done", { tier, elapsedMs: Date.now() - claudeStartedAt, agentPath: agent?.path || null });

    if (tier === "free") {
      agent.opportunityFlags = (agent.opportunityFlags || []).filter(f => f !== "DIGITAL_PRESENCE_OPP");
    }

    // paid47-v2 response quality gate: on a $47 run, the richer
    // contract (financialSnapshot, connections[], gaps with
    // evidence/known/unknown, coverage{}) is validated and one
    // regeneration is attempted when deficiencies are found. If
    // regeneration still fails, the response is downgraded to the
    // v1 renderer rather than failing the whole run — the owner
    // paid $47 and gets *a* report, not a broken page.
    if (tier === "paid_47") {
      agent = await runPaid47V2QualityGate({
        env, contactId, prompt, rubric, raw, agent, factsBundle, derivedMetrics,
      });
    }

    sanitizeStructuredFindings(agent, {
      normalized: factsBundle?.facts || flatNormalized(normalizedAnswers || []),
      derivedMetrics: derivedMetrics || [],
    }, `solomon-queue contact ${contactId}`);

    const reportHtml = buildReportHtml(agent);
    await writeQueueTrace(env, contactId, "report_html_built", { tier, htmlBytes: reportHtml?.length || 0 });

    const canonical = await writeCanonicalRecord(env, {
      contact: { id: contactId, ...contact },
      tier, answers, agent, reportHtml,
      sourceEventId, dryRun, normalizedAnswers, derivedMetrics,
    });
    await writeQueueTrace(env, contactId, "canonical_written", {
      tier,
      ok: !!canonical?.ok,
      skipped: !!canonical?.skipped,
      skipReason: canonical?.reason || null,
      reportId: canonical?.reportId || null,
      error: canonical?.error || null,
    });
    if (canonical?.skipped && canonical.reason === "duplicate_submission") {
      message.ack();
      return;
    }

    // Reconstruct the ctx shape finalizeSurveyWriteback expects — it uses
    // ctx.waitUntil for parallelism inside the writeback, but queue
    // consumer invocations don't give us a real ctx. Pass a shim that
    // just awaits inline — we have the full 15-min budget here so there's
    // no reason to fire-and-forget anyway.
    const ctxShim = { waitUntil: async (p) => { try { await p; } catch (e) { console.warn("[solomon-queue:waitUntilShim]", e?.message || e); } } };
    const requestUrlShim = { origin: requestOrigin || "https://swot-engine.cfobydesign.workers.dev" };

    await finalizeSurveyWriteback({
      env, ctx: ctxShim, requestUrl: requestUrlShim,
      contactId, contact, tier, answers, agent, reportHtml,
      canonical, dryRun,
    });

    await writeQueueTrace(env, contactId, "writeback_done", { tier });
    message.ack();
  } catch (err) {
    const detail = err?.message || String(err);
    console.error(`[solomon-queue] generation failed for ${contactId} tier ${tier} attempt ${attemptNumber}/${maxAttempts}:`, detail);

    // 524 short-circuit (2026-10-28 — from Marcus Delgado's trace):
    // Cloudflare 524 means Anthropic's edge disconnected because the
    // generation ran past the 100s edge timeout. That is not a
    // transient flake — the same prompt will hit the same ceiling on
    // every retry. On 524, skip the two remaining retries (which
    // would waste another ~4 minutes of wall-clock before giving up)
    // and go straight to terminal-failure handling so the operator
    // sees the failure immediately and swot|deliveryfailed fires now.
    // Streaming (callClaudeWithRubric) is the primary mitigation —
    // this short-circuit is defense-in-depth for the case where
    // streaming itself hits a 524 at the headers phase.
    const isCloudflare524 = /Claude API 524\b/.test(detail);
    const treatAsTerminal = isFinalAttempt || isCloudflare524;
    await writeQueueTrace(env, contactId, "error", {
      tier,
      attempt: attemptNumber,
      final: treatAsTerminal,
      shortCircuit524: isCloudflare524 && !isFinalAttempt,
      error: detail.slice(0, 500),
    });

    if (treatAsTerminal) {
      // Terminal failure — apply swot|deliveryfailed so an HL automation
      // or an operator can see this contact has an undeliverable
      // generation, and release idempotency so a manual re-POST with
      // replay:true can retry. Then ack to avoid the DLQ (which the
      // Worker doesn't consume).
      try {
        await addGHLTag(contactId, ["swot|deliveryfailed"], env);
      } catch (tagErr) {
        console.error(`[solomon-queue] failed to apply swot|deliveryfailed to ${contactId}:`, tagErr?.message || tagErr);
      }
      if (idemPath) {
        await releaseIdempotency(idemPath, env).catch(() => {});
      }
      // Record the terminal failure in the ghl_sync log for operator
      // visibility — reportId is null since Solomon didn't finish.
      try {
        await recordGhlWriteback(env, {
          reportId: null,
          contactId,
          status: "failed",
          error: `queue terminal failure attempt ${attemptNumber}/${maxAttempts}: ${detail.slice(0, 500)}`,
        });
      } catch { /* best effort */ }
      message.ack();
      return;
    }

    // Not the final attempt — throw to let Queues retry with exponential
    // backoff.
    throw err;
  }
}

// Finalize the GHL writeback + lifecycle tags + tracking event for a
// generated report. Extracted so the async split in handleGHLSurveyWebhook
// has a single call site after Claude finishes. The behavior here is
// unchanged from before the async refactor — same field writes, same
// tag chaining, same tracking event, all still fanned out via
// ctx.waitUntil for parallelism inside the parent waitUntil.
async function finalizeSurveyWriteback({
  env, ctx, requestUrl,
  contactId, contact, tier, answers, agent, reportHtml,
  canonical, dryRun,
}) {
  const reportFieldKey_fn =
    tier === "paid_297" ? "business_playbook"
    : tier === "paid_47" ? "swot_full_report"
    : "swot_free_report";

  const fields_fn = [
    { key: "swot_path", field_value: String(agent.path || "") },
    { key: "swot_rehab_flag", field_value: agent.path === "rehab" ? "true" : "false" },
    { key: reportFieldKey_fn, field_value: reportHtml },
  ];
  if (agent.opener) fields_fn.push({ key: "swot_email_blurb", field_value: String(agent.opener) });
  if (agent.strategistBrief) fields_fn.push({ key: "swot_strategist_brief", field_value: String(agent.strategistBrief) });
  fields_fn.push({ key: "swot_report_path", field_value: `${requestUrl.origin}/report/${contactId}` });
  if (tier === "paid_297") fields_fn.push({ key: "swot_deep_dive_booked", field_value: "true" });

  const alreadyPaid297_fn = (contact.tags || [])
    .map((t) => String(t).toLowerCase())
    .includes("swot_paid_297");

  const tierTag_fn =
    tier === "paid_297"
      ? (alreadyPaid297_fn ? "swot_paid_297" : "swot_paid_297_pending")
      : tier === "paid_47" ? "swot_paid_47"
      : "swot_free_lead";
  // 2026-10-28 (from Marisol's first successful paid_47 generation,
  // contact DeubTUGSn9U9IL4layqU): the previous `tier.replace(/^paid_/, "")`
  // stripped the `paid_` prefix and produced swot_report_ready_47 /
  // swot_report_ready_297, mismatched with every HL workflow that
  // triggers on swot_report_ready_paid_47 / swot_report_ready_paid_297
  // (email-templates/README.md, docs/FUNNEL_TAXONOMY.md,
  // docs/hl-automations/README.md, app/public/email-preview). Email 02
  // (Full Diagnostic delivery) and Email 03 (BGA Part 1) never fired
  // because the trigger tag the code emitted wasn't the tag the HL
  // workflows watched for. Explicit canonical names below — no string
  // transformation, since the code was wrong by exactly one strip and
  // keeping the join template would hide that fact next time someone
  // asks "is the tag the HL workflow is watching for the one we emit?".
  const reportReadyTag_fn =
    tier === "paid_297" && !alreadyPaid297_fn ? null
    : tier === "paid_297" ? "swot_report_ready_paid_297"
    : tier === "paid_47"  ? "swot_report_ready_paid_47"
    :                       "swot_report_ready_free";
  const lifecycleTags_fn = [
    tierTag_fn,
    ...pathTags(agent.path),
    ...(agent.opportunityFlags || []).map((f) => String(f).toLowerCase()),
  ].filter(Boolean);

  await Promise.allSettled([
    updateGHLContact(contactId, fields_fn, env, { dryRun }).then(async ok => {
      await recordGhlWriteback(env, {
        reportId: canonical?.reportId || null,
        contactId,
        status: ok ? "succeeded" : "failed",
        error: ok ? null : "updateGHLContact returned false",
      });
      if (!ok) {
        console.warn("[from-ghl-survey] Contact writeback failed; skipping post-write tags");
        return;
      }
      const postWriteTags_fn = [];
      if (reportReadyTag_fn) postWriteTags_fn.push(reportReadyTag_fn);
      if (tier === "paid_297" && !alreadyPaid297_fn) {
        postWriteTags_fn.push("swot_playbook_written");
        const fresh = await fetchGHLContact(contactId, env).catch(() => null);
        const nowPaid = fresh && (fresh.tags || [])
          .map((t) => String(t).toLowerCase())
          .includes("swot_paid_297");
        if (nowPaid) postWriteTags_fn.push("swot_report_ready_paid_297");
      }
      if (postWriteTags_fn.length) return addGHLTag(contactId, postWriteTags_fn, env, { dryRun });
    }),
    addGHLTag(contactId, lifecycleTags_fn, env, { dryRun }),
    fireTrackingEvent({
      event_type: `report_generated_${tier}`,
      tier,
      contact_id: contactId,
      email: contact.email || "",
      name: [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() || contact.contactName || "",
      business_name: contact.companyName || "",
      path: agent.path || "",
      badge: agent.badge || "",
      headline: agent.headline || "",
      opportunity_flags: agent.opportunityFlags || [],
      answers,
      source: "ghl_survey",
    }, env, { dryRun }),
  ]);
}

// ----- end GHL survey webhook -----

// ----- Payment-status webhook (LC Payments → Solomon) -----
// GHL fires this on every payment event (success OR failure). We do TWO
// things with it:
//
//   1. AUDIT LOG — write a JSON record to R2 under payments/{YYYY-MM-DD}/
//      so every payment attempt has a durable trail we can search later.
//      Critical for refund disputes, retries, and "did they actually pay?"
//      customer-support questions.
//
//   2. STATE ROUTING — depending on status:
//        success → re-apply swot_paid_{tier} tag as a safety net (redundant
//                  with what LC Payments already did, but idempotent — GHL
//                  no-ops if the tag is already there. Prevents a payment
//                  from silently failing to trigger anything downstream if
//                  the LC Payments tag-add step ever fails.)
//        failed  → apply swot_payment_failed_{tier} tag → GHL's "update
//                  payment method" workflow fires the retry email.
//
// This endpoint does NOT run Solomon. Solomon only runs when there are
// survey answers to analyze, via /from-ghl-survey or the React app.

async function handlePaymentStatusWebhook(request, env, ctx) {
  // Same webhook secret as /from-ghl-survey. Accepted as either
  // 'x-webhook-secret' or 'Authorization: Bearer'.
  if (env.WEBHOOK_SECRET) {
    const auth = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const provided = request.headers.get("x-webhook-secret") || auth;
    if (!provided || provided !== env.WEBHOOK_SECRET) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const contactId = String(body.contactId || body.contact_id || "").trim();
  const tier = String(body.tier || "").trim().toLowerCase();
  const status = String(body.status || "").trim().toLowerCase();

  if (!contactId) return json({ success: false, error: "contactId required" }, 400);
  if (!["paid_47", "paid_297"].includes(tier)) {
    return json({ success: false, error: "tier must be paid_47 or paid_297" }, 400);
  }
  if (!["success", "succeeded", "failed", "failure"].includes(status)) {
    return json({ success: false, error: "status must be success or failed" }, 400);
  }
  const isSuccess = status === "success" || status === "succeeded";

  const ts = new Date().toISOString();
  const auditRecord = {
    contactId,
    tier,
    status: isSuccess ? "success" : "failed",
    amount: body.amount ?? null,
    productName: body.productName || body.product_name || null,
    paymentId: body.paymentId || body.payment_id || null,
    email: body.email || null,
    reason: body.reason || null,
    ts,
    receivedAt: ts,
  };

  // Audit log to R2. Non-fatal if R2 is unavailable — we still route the
  // tag so downstream workflows fire.
  if (env.SOLOMON_LIBRARY) {
    const key = `payments/${ts.slice(0, 10)}/${contactId}-${ts.replace(/[:.]/g, "-")}.json`;
    ctx.waitUntil(
      env.SOLOMON_LIBRARY.put(key, JSON.stringify(auditRecord), {
        httpMetadata: { contentType: "application/json" },
      }).catch((err) => console.warn("[/payment-status] audit write failed:", err?.message)),
    );
  }

  // Tag routing.
  const successTag = tier === "paid_297" ? "swot_paid_297" : "swot_paid_47";
  const failureTag = tier === "paid_297" ? "swot_payment_failed_297" : "swot_payment_failed_47";
  const tagToApply = isSuccess ? successTag : failureTag;

  if (isSuccess) {
    ctx.waitUntil(
      addGHLTag(contactId, [tagToApply], env).catch((err) =>
        console.warn(`[/payment-status] tag apply failed (${tagToApply}):`, err?.message),
      ),
    );
  } else {
    // Codex P1 on #78: the retry email in HL fires on the failure tag and
    // reads {{contact.swot_retry_payment_url}} for its retry button. The
    // README previously claimed this handler wrote that field; it didn't,
    // so after moving the email templates off the inline Handlebars
    // fallback (which HL doesn't actually support — see
    // email-templates/README.md), the retry button rendered an empty href.
    //
    // Fix: on failure, write a tier-specific retry URL to
    // swot_retry_payment_url FIRST, then apply the failure tag so the
    // workflow HL fires on the tag always sees a populated field. If the
    // field write errors, apply the tag anyway — a broken retry button
    // is still better than suppressing the retry email entirely, and the
    // audit log + contact note already captured the failure.
    const retryUrl =
      tier === "paid_297"
        ? ((env && env.PAYMENT_LINK_297) || CONFIG.PAYMENT_LINK_297)
        : ((env && env.PAYMENT_LINK_47) || CONFIG.PAYMENT_LINK_47);
    ctx.waitUntil(
      updateGHLContact(
        contactId,
        [{ key: "swot_retry_payment_url", field_value: retryUrl }],
        env,
      )
        .catch((err) =>
          console.warn(
            `[/payment-status] swot_retry_payment_url write failed:`,
            err?.message,
          ),
        )
        .then(() =>
          addGHLTag(contactId, [tagToApply], env).catch((err) =>
            console.warn(
              `[/payment-status] tag apply failed (${tagToApply}):`,
              err?.message,
            ),
          ),
        ),
    );
  }

  // Also post a contact note so the payment event shows up in the human-
  // readable audit trail on the contact card (less digging than R2).
  if (isSuccess) {
    const noteBody = [
      `Payment received · ${auditRecord.productName || tier}`,
      auditRecord.amount != null ? `Amount: $${auditRecord.amount}` : null,
      auditRecord.paymentId ? `Payment ID: ${auditRecord.paymentId}` : null,
      `At: ${ts}`,
    ].filter(Boolean).join("\n");
    ctx.waitUntil(addGHLNote(contactId, noteBody, env).catch(() => {}));
  } else {
    const noteBody = [
      `Payment FAILED · ${auditRecord.productName || tier}`,
      auditRecord.reason ? `Reason: ${auditRecord.reason}` : null,
      auditRecord.paymentId ? `Payment ID: ${auditRecord.paymentId}` : null,
      `At: ${ts}`,
      `Applied tag: ${failureTag} — retry workflow will fire from HL.`,
    ].filter(Boolean).join("\n");
    ctx.waitUntil(addGHLNote(contactId, noteBody, env).catch(() => {}));
  }

  // Tracking event so "00 SWOT Inbound" (or similar) can pick this up and
  // route to internal notifications.
  ctx.waitUntil(
    fireTrackingEvent({
      event_type: isSuccess ? `payment_confirmed_${tier}` : `payment_failed_${tier}`,
      tier,
      contact_id: contactId,
      email: auditRecord.email || "",
      amount: auditRecord.amount,
      product_name: auditRecord.productName,
      payment_id: auditRecord.paymentId,
      reason: auditRecord.reason,
      ts,
      source: "payment_webhook",
    }, env),
  );

  return json({
    success: true,
    status: auditRecord.status,
    tagApplied: tagToApply,
    contactId,
    tier,
  });
}

// ----- end payment-status webhook -----

// ----- GET /verify-bga-access — BGA intake access gate -----
//
// Server-side authorization for success.cfobydesign.com/bga-intake. The
// wrapper there is a static HL funnel page that we never want to render
// its intake survey unless the viewer actually purchased the Business
// Growth Analysis. Without this check the only barrier is the fact that
// HL emails the URL only to paid contacts — fine for the common path,
// but anyone who guesses or shares another paid contact's id has the
// same key.
//
// Contract:
//   - Takes contactId from the query string. Never trusts tags or
//     payment state supplied by the browser.
//   - Fetches the contact from GHL server-side with the Worker's
//     configured credentials.
//   - Checks for the EXACT tag `swot_paid_297` (lower-case match).
//   - Response bodies are deliberately boring so a probe can't tell
//     "contact exists but unpaid" from "contact does not exist":
//       paid + known contact →
//         200 { authorized: true, surveyUrl: "..." }
//       unknown / unpaid / rejected → 403 { authorized: false }
//       missing or malformed contactId → 400 { authorized: false, error }
//       GHL unavailable / errored → 503 { authorized: false }
//       no GHL_API_KEY configured → 503 { authorized: false }
//       no BGA_INTAKE_SURVEY_URL configured → 503 (can't produce the
//                                              URL to hand out, fail closed)
//   - Cache-Control: no-store so an authorized response can't be
//     cached and reused by a browser or proxy for a later request.
//   - CORS is narrow — only the configured BGA_INTAKE_ORIGIN (default
//     https://success.cfobydesign.com) can read the response. Other
//     callers see the response blocked by the browser.
//
// Codex P1 on #83: the survey URL is handed out ONLY in the authorized
// response. The wrapper HTML carries no survey URL at all — not in src,
// not in data-src — so an unauthorized visitor who view-sources the
// page never sees the URL. The URL lives in env.BGA_INTAKE_SURVEY_URL
// on the Worker side and is only emitted when the tag check passes.
//
// This endpoint is still NOT a signed access token: a paid contact can
// read the URL out of the response, save it, and share it. The
// stronger version is a short-lived signed token the GHL survey
// validates server-side — out of scope here. The URL leaving the
// server-side-only sources closes the lower bar (unauthorized visitors
// can't grab the URL from HTML view-source).

const BGA_PAID_TAG = "swot_paid_297";

async function handleVerifyBgaAccess(request, env, url) {
  const intakeOrigin =
    (env && env.BGA_INTAKE_ORIGIN) || "https://success.cfobydesign.com";
  const respond = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": intakeOrigin,
        "Vary": "Origin",
      },
    });

  const contactId = (url.searchParams.get("contactId") || "").trim();
  if (!contactId) {
    return respond(400, { authorized: false, error: "contactId required" });
  }

  // No GHL credentials wired → fail closed. We never authorize without
  // actually checking state server-side.
  if (!env.GHL_API_KEY) {
    console.warn("[/verify-bga-access] GHL_API_KEY unset — failing closed");
    return respond(503, { authorized: false });
  }

  // No survey URL configured → fail closed. Even if the viewer is
  // genuinely paid, we won't invent a URL to hand them, and we won't
  // leak that this is the config problem — generic 503 like every
  // other upstream failure.
  const surveyUrl = (env && env.BGA_INTAKE_SURVEY_URL) || "";
  if (!surveyUrl) {
    console.warn(
      "[/verify-bga-access] BGA_INTAKE_SURVEY_URL unset — failing closed",
    );
    return respond(503, { authorized: false });
  }

  // Fetch the contact directly so we can tell "not found" (403) from
  // "GHL unreachable / errored" (503). The shared fetchGHLContact helper
  // intentionally buckets both to null for its own callers, which is the
  // wrong trade-off for an authorization endpoint.
  let res;
  try {
    res = await fetch(
      `${CONFIG.GHL_API_BASE}/contacts/${encodeURIComponent(contactId)}`,
      {
        headers: {
          Authorization: `Bearer ${env.GHL_API_KEY}`,
          Version: "2021-07-28",
        },
      },
    );
  } catch (err) {
    console.warn("[/verify-bga-access] GHL fetch threw:", err?.message);
    return respond(503, { authorized: false });
  }

  // Unknown contact → treat as rejected without leaking existence. An
  // attacker enumerating ids should not get 404-vs-403 as an oracle.
  if (res.status === 404) {
    return respond(403, { authorized: false });
  }
  // Anything else non-2xx (401 bad credential, 429 rate limit, 5xx
  // outage) → fail closed. Do not authorize on a partial-state read.
  if (!res.ok) {
    console.warn(
      `[/verify-bga-access] GHL returned ${res.status} for contactId=${contactId}`,
    );
    return respond(503, { authorized: false });
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return respond(503, { authorized: false });
  }
  const contact = data && data.contact;
  if (!contact) {
    // 2xx with no contact body — unexpected shape, fail closed.
    return respond(503, { authorized: false });
  }

  // Case-insensitive EXACT match. The contact's tags array is already
  // the shape the rest of the Worker uses (see line 4454 and 4950).
  const tags = (contact.tags || []).map((t) => String(t).toLowerCase());
  if (!tags.includes(BGA_PAID_TAG)) {
    return respond(403, { authorized: false });
  }

  return respond(200, { authorized: true, surveyUrl });
}

// ----- end /verify-bga-access -----

// ----- Reset contact tags (testing / lifecycle reset) -----
// POST /reset-contact-tags
//   Body: { contactId, keep?: [tag, tag], onlyPrefixed?: true (default) }
// Removes every tag on the contact that starts with a known SWOT prefix
// (or every non-kept tag if onlyPrefixed:false) so the contact can be
// re-tested end-to-end without stale state. Auth via WEBHOOK_SECRET so this
// isn't publicly callable — testing tool for Liz / Miguel via curl or an
// internal HL workflow, not the customer-facing surface.
//
// Prefixes considered "SWOT-owned":
//   swot_*   path_* (legacy)   *_opp (opportunity flags)
//
// Non-SWOT tags on the contact are left untouched by default.

const TAG_PREFIXES_TO_RESET = ["swot_", "path_"];
const TAG_SUFFIXES_TO_RESET = ["_opp"];

async function handleResetContactTags(request, env) {
  if (env.WEBHOOK_SECRET) {
    const auth = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const provided = request.headers.get("x-webhook-secret") || auth;
    if (!provided || provided !== env.WEBHOOK_SECRET) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const contactId = String(body.contactId || body.contact_id || "").trim();
  if (!contactId) return json({ success: false, error: "contactId required" }, 400);
  const keep = Array.isArray(body.keep) ? body.keep.map((t) => String(t).toLowerCase()) : [];
  const onlyPrefixed = body.onlyPrefixed === false ? false : true;

  const contact = await fetchGHLContact(contactId, env);
  if (!contact) return json({ success: false, error: "Contact not found" }, 404);
  const allTags = (contact.tags || []).map((t) => String(t).toLowerCase());

  const toRemove = allTags.filter((t) => {
    if (keep.includes(t)) return false;
    if (!onlyPrefixed) return true;
    return TAG_PREFIXES_TO_RESET.some((p) => t.startsWith(p))
        || TAG_SUFFIXES_TO_RESET.some((s) => t.endsWith(s));
  });

  if (!toRemove.length) {
    return json({ success: true, contactId, removed: [], message: "No matching tags to remove." });
  }

  const ok = await removeGHLTags(contactId, toRemove, env);
  if (!ok) return json({ success: false, error: "GHL tag removal failed", tried: toRemove }, 502);

  // Audit note so the reset shows up on the contact card.
  const noteBody = [
    `SWOT tag reset · ${new Date().toISOString()}`,
    `Removed (${toRemove.length}): ${toRemove.join(", ")}`,
    keep.length ? `Preserved: ${keep.join(", ")}` : null,
  ].filter(Boolean).join("\n");
  await addGHLNote(contactId, noteBody, env).catch(() => {});

  return json({ success: true, contactId, removed: toRemove, kept: keep });
}

// ----- end reset contact tags -----

// Like callClaude but accepts an explicit rubric (for the console's override path).
// When the rubric is the default, cache_control still applies — repeated runs hit the cache.
async function callClaudeWithRubric(prompt, rubric, env, opts = {}) {
  // Test-only escape hatch — see callClaude above. The stub receives
  // the full opts object so tests can observe followup turns too.
  if (typeof env?.__CLAUDE_STUB__ === "function") {
    return env.__CLAUDE_STUB__(prompt, env, rubric, opts);
  }
  const isDefault = rubric === ASSESSMENT_RUBRIC;
  const systemBlock = [
    isDefault
      ? { type: "text", text: rubric, cache_control: { type: "ephemeral" } }
      : { type: "text", text: rubric }
  ];

  // 2026-10-28 (from Jordan Castellanos's queue-trace): the paid_47 Full
  // Diagnostic consistently truncated at ~4000 chars / line 34 col 6 of
  // the JSON output, which parseAgentJson then raised as
  //   "Expected ',' or ']' after array element in JSON at position NNNN"
  // on all three queue retries. Three deterministic failures = token
  // budget overrun, not an infrastructure flake. The rubric asks for
  // opener + strategistBrief + path + badge + headline + context +
  // gaps[] + opportunities[] + opportunityFlags + structured_findings[]
  // — that's 10-15 KB of JSON for a paid tier, well over 2500 tokens.
  // Bumped to a 16k default (plenty for the longest paid_297 Business
  // Growth Analysis) with per-caller override via opts.maxTokens for
  // the few places that genuinely need a smaller budget (e.g. BGA
  // Copilot sub-prompts).
  const maxTokens = opts.maxTokens || 16000;

  // Regeneration path (paid47-v2 quality gate): the caller may supply a
  // prior assistant response + a follow-up user message so the model
  // sees its own last attempt and can correct it. Both must be set
  // together — one without the other is ignored.
  const messages = [{ role: "user", content: prompt }];
  if (opts.priorAssistant && opts.followupUser) {
    messages.push({ role: "assistant", content: String(opts.priorAssistant) });
    messages.push({ role: "user", content: String(opts.followupUser) });
  }

  // Streaming subrequest (2026-10-28 — from Marcus Delgado's paid_47
  // queue trace: all 3 attempts returned Cloudflare 524 at ~2:06 each
  // because the 24KB prompt + 16k max_tokens generation ran past
  // Cloudflare's 100s edge timeout on a single-response fetch). With
  // `stream: true`, Anthropic's edge begins emitting SSE events within
  // seconds and each delta resets the edge timeout, so a 2-minute
  // generation stays alive and the full response accumulates safely.
  // Behaviorally identical to the single-response path from the
  // caller's view: same text out, same max_tokens truncation surfaced
  // as an error.
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": CONFIG.ANTHROPIC_VERSION,
      "accept": "text/event-stream",
    },
    body: JSON.stringify({
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: maxTokens,
      system: systemBlock,
      messages,
      stream: true,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Claude API ${response.status}: ${detail.slice(0, 300)}`);
  }
  const { text, stopReason } = await readAnthropicStream(response);
  // When Claude hits the output cap it returns stop_reason === "max_tokens"
  // and the final content block ends mid-JSON. Surfacing this upstream
  // means parseAgentJson's error is actionable instead of mystifying.
  if (stopReason === "max_tokens") {
    throw new Error(`Claude response truncated (stop_reason=max_tokens, max_tokens=${maxTokens}, output_bytes=${text.length}). Raise max_tokens for this caller.`);
  }
  return text;
}

// Read an Anthropic Messages SSE stream and return the full text + the
// final stop_reason. Events emitted during streaming:
//   content_block_delta { delta: { type: "text_delta", text: "..." } }
//     → accumulate text
//   message_delta { delta: { stop_reason: "..." } }
//     → capture final stop_reason
//   message_stop → end
// Malformed data lines are skipped. The whole function is safe to call
// on any Response whose body is an SSE stream (undici / fetch Response
// shape); if `body` is unavailable it falls back to .text() + a best-
// effort "last chunk" parse so test stubs returning a plain string
// still work. See exported helper _test_parseAnthropicSse below for
// unit coverage.
async function readAnthropicStream(response) {
  if (!response.body || typeof response.body.getReader !== "function") {
    // Fallback for environments that don't expose a byte stream
    // (very old polyfills, some test shims). The response body is
    // the raw SSE text; parse it in one shot.
    const raw = await response.text();
    return _test_parseAnthropicSse(raw);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let stopReason = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      // Flush decoder's final bytes + any residual buffer.
      buffer += decoder.decode();
      ({ text, stopReason } = _consumeSseLines(buffer, text, stopReason));
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lastNewline = buffer.lastIndexOf("\n");
    if (lastNewline === -1) continue;
    const complete = buffer.slice(0, lastNewline + 1);
    buffer = buffer.slice(lastNewline + 1);
    ({ text, stopReason } = _consumeSseLines(complete, text, stopReason));
  }
  return { text, stopReason };
}

function _consumeSseLines(chunk, textAcc, stopReasonAcc) {
  const lines = chunk.split("\n");
  let text = textAcc;
  let stopReason = stopReasonAcc;
  for (const rawLine of lines) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let event;
    try { event = JSON.parse(payload); } catch { continue; }
    if (event.type === "content_block_delta" && event.delta && event.delta.type === "text_delta") {
      text += String(event.delta.text || "");
    } else if (event.type === "message_delta" && event.delta && event.delta.stop_reason) {
      stopReason = event.delta.stop_reason;
    } else if (event.type === "message_stop" && event["amazon-bedrock-invocationMetrics"]) {
      // Noop — Anthropic-via-Bedrock variant carries extra metrics
      // we don't need; the branch exists so the parser doesn't
      // mistake it for an error state.
    }
  }
  return { text, stopReason };
}

// Exported for unit tests only: parse a complete SSE text blob in one
// shot. Production callers go through readAnthropicStream which reads
// incrementally.
function _test_parseAnthropicSse(sseText) {
  return _consumeSseLines(sseText, "", null);
}

// ----- end Ask Solomon console -----

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-console-password",
  };
}

function htmlHeaders() {
  return {
    ...corsHeaders(),
    "Content-Type": "text/html; charset=utf-8",
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");

    // Phase 3A: strategist feedback capture.
    //   POST /feedback — attach feedback to a report_id (and optional
    //                    structured finding_id). Capture only — no
    //                    LLM involvement, no auto-training. See
    //                    docs/SOLOMON_ARCHITECTURE.md § 21-23.
    //   GET  /feedback?report_id=X — list every feedback row for one
    //                                report (strategist review UI).
    //   GET  /feedback?pending_type=T — list pending feedback of one
    //                                   type (rule-promotion queue).
    // Both routes gated on CONSOLE_PASSWORD. Sits above the method
    // branches so POST isn't shadowed by the GET-only block below.
    // A missing D1 binding degrades gracefully (POST returns
    // {skipped:true, reason:"no_db_binding"}) so the Phase 3B UI can
    // ship before D1 is wired.
    if (path === "/feedback" && request.method === "POST") {
      if (!checkConsolePassword(request, env)) {
        return json({ success: false, error: "Unauthorized" }, 401);
      }
      let body;
      try { body = await request.json(); }
      catch { return json({ success: false, error: "Invalid JSON body" }, 400); }
      const db = dbFromEnv(env);
      const result = await insertFeedback(db, body);
      if (!result.ok) {
        if (result.reason === "invalid_feedback_type") {
          return json({
            success: false,
            error: "Invalid feedback_type",
            got: result.feedback_type,
            allowed: FEEDBACK_TYPES,
          }, 400);
        }
        if (result.reason === "missing_report_id" || result.reason === "missing_body") {
          return json({ success: false, error: "report_id (string) is required" }, 400);
        }
        return json({ success: false, error: result.reason || "Unknown feedback error" }, 400);
      }
      if (result.skipped) {
        return json({ success: true, skipped: true, reason: result.reason });
      }
      return json({ success: true, feedback_id: result.id });
    }
    if (path === "/feedback" && request.method === "GET") {
      if (!checkConsolePassword(request, env)) {
        return json({ success: false, error: "Unauthorized" }, 401);
      }
      const db = dbFromEnv(env);
      if (!db) {
        return json({ success: true, skipped: true, reason: "no_db_binding", feedback: [] });
      }
      const reportId = url.searchParams.get("report_id");
      const pendingType = url.searchParams.get("pending_type");
      if (reportId) {
        const rows = await listFeedbackForReport(db, reportId);
        return json({ success: true, feedback: rows });
      }
      if (pendingType) {
        const rows = await listPendingFeedbackByType(db, pendingType, { limit: 100 });
        return json({ success: true, feedback: rows });
      }
      return json({
        success: false,
        error: "Pass ?report_id=<uuid> for one report's feedback, or ?pending_type=<type> for the pending-review queue",
        allowed_types: FEEDBACK_TYPES,
      }, 400);
    }

    // Phase 3B: strategist review UI.
    //   GET /strategist                  — the HTML review page (served
    //                                      to any browser; API calls
    //                                      made from the page carry
    //                                      the console password).
    //   GET /strategist/report/{reportId} — JSON lookup used by the page:
    //                                       returns the report row (with
    //                                       its structured_findings) and
    //                                       every feedback already attached
    //                                       to it, in one call. Password-
    //                                       protected like the other
    //                                       console API routes.
    if (path === "/strategist" && request.method === "GET") {
      return new Response(renderStrategistPage(FEEDBACK_TYPES), {
        status: 200,
        headers: htmlHeaders(),
      });
    }
    const strategistReportMatch = path.match(/^\/strategist\/report\/([A-Za-z0-9_-]+)$/);
    if (strategistReportMatch && request.method === "GET") {
      if (!checkConsolePassword(request, env)) {
        return json({ success: false, error: "Unauthorized" }, 401);
      }
      const db = dbFromEnv(env);
      if (!db) {
        return json({ success: false, error: "Strategist review requires the D1 binding" }, 503);
      }
      // D1 is a hard dependency for the strategist review (the review
      // UI loads report rows out of D1 — there's no fallback). A D1
      // outage here is 503, not 404: 404 would mislead the reviewer
      // into thinking the report doesn't exist, when it just can't be
      // reached right now. Codex caught this on PR #72 after the
      // earlier version of reportById swallowed D1 errors as null.
      let report, feedback;
      try {
        report = await reportById(db, strategistReportMatch[1]);
        if (!report) {
          return json({ success: false, error: "Report not found" }, 404);
        }
        feedback = await listFeedbackForReport(db, report.id);
      } catch (err) {
        // Only swallow D1-query failures. A hydrateReport throw
        // (malformed diagnostic_json or strategist_brief_json) is a
        // data-integrity bug: let it propagate so the operator sees
        // the real error rather than a misleading 503.
        if (!isD1QueryError(err)) throw err;
        console.warn(`[/strategist/report] D1 query failed for ${strategistReportMatch[1]}: ${err?.message || err}`);
        return json({ success: false, error: "Strategist review temporarily unavailable" }, 503);
      }
      return json({ success: true, report, feedback });
    }

    // Phase 3C: rule-promotion review queue. All three routes are
    // CONSOLE_PASSWORD-gated and drive the Ask Solomon → Rule
    // Promotions pane. Nothing here promotes a rule into the rubric
    // automatically — approval flips a boolean so a human can bump
    // rubric_version in code and ship the new ASSESSMENT_RUBRIC in a
    // separate deploy.
    //   GET   /feedback/pending-summary       — per-type pending/approved counts
    //   GET   /feedback/approved?feedback_type=X — approved rows for the export view
    //   PATCH /feedback/{id}                   — toggle approval and/or edit candidate_rule
    if (path === "/feedback/pending-summary" && request.method === "GET") {
      if (!checkConsolePassword(request, env)) {
        return json({ success: false, error: "Unauthorized" }, 401);
      }
      const db = dbFromEnv(env);
      if (!db) {
        return json({ success: true, skipped: true, reason: "no_db_binding", summary: [] });
      }
      const summary = await pendingFeedbackSummary(db);
      return json({ success: true, summary });
    }
    if (path === "/feedback/approved" && request.method === "GET") {
      if (!checkConsolePassword(request, env)) {
        return json({ success: false, error: "Unauthorized" }, 401);
      }
      const db = dbFromEnv(env);
      if (!db) {
        return json({ success: true, skipped: true, reason: "no_db_binding", feedback: [] });
      }
      const feedbackType = url.searchParams.get("feedback_type");
      if (!feedbackType) {
        return json({ success: false, error: "feedback_type (query param) is required" }, 400);
      }
      if (!FEEDBACK_TYPES.includes(feedbackType)) {
        return json({ success: false, error: "Invalid feedback_type", allowed: FEEDBACK_TYPES }, 400);
      }
      const rows = await listApprovedFeedbackByType(db, feedbackType, { limit: 500 });
      return json({ success: true, feedback: rows });
    }
    const feedbackPatchMatch = path.match(/^\/feedback\/([A-Za-z0-9_-]+)$/);
    if (feedbackPatchMatch && request.method === "PATCH") {
      if (!checkConsolePassword(request, env)) {
        return json({ success: false, error: "Unauthorized" }, 401);
      }
      let body;
      try { body = await request.json(); }
      catch { return json({ success: false, error: "Invalid JSON body" }, 400); }
      const db = dbFromEnv(env);
      const result = await updateFeedback(db, feedbackPatchMatch[1], body);
      if (!result.ok) {
        const status = result.reason === "not_found" ? 404
          : result.reason === "nothing_to_update" ? 400
          : 400;
        return json({ success: false, error: result.reason }, status);
      }
      if (result.skipped) {
        return json({ success: true, skipped: true, reason: result.reason });
      }
      return json({ success: true, feedback: result.row });
    }

    // GET /report/{contactId} — public-readable hosted report view.
    // GET /asksolomon — internal training console (HTML page, password-protected at the API layer).
    // GET /asksolomon/rubric — return the current ASSESSMENT_RUBRIC (password-protected).
    if (request.method === "GET") {
      // GET /report/{contactId}/status — lightweight JSON readiness check for the
      // client-side analyzing UI to poll without reloading the page.
      const statusMatch = path.match(/^\/report\/([A-Za-z0-9_-]+)\/status$/);
      if (statusMatch) {
        return handleReportStatus(statusMatch[1], env);
      }
      const reportMatch = path.match(/^\/report\/([A-Za-z0-9_-]+)$/);
      if (reportMatch) {
        return handleReport(reportMatch[1], env, url);
      }
      if (path === "/asksolomon") {
        return new Response(CONSOLE_PAGE, { status: 200, headers: htmlHeaders() });
      }
      // GET /asksolomon/case — BGA Copilot case view (PR 4; docs/BGA_COPILOT_SPEC.md §2.1 + §11 row 4).
      // (Codex P1 on #94) This must live inside the GET dispatcher — the
      // POST-only guard below rejects every non-POST path, so a GET branch
      // placed later would be dead code and the page would return 404.
      // Page-level password gate lives in the HTML; API-level gate protects
      // /case/load, /case/audit-gaps, /case/verified-financials below.
      if (path === "/asksolomon/case") {
        return new Response(CASE_VIEW_PAGE, { status: 200, headers: htmlHeaders() });
      }
      // GET /asksolomon/catalog — Service Catalog + Bundles admin
      // page (slice B of 5). Page-level password gate lives in the
      // HTML; API-level gate protects /asksolomon/catalog/{active,
      // versions, version, publish} below.
      if (path === "/asksolomon/catalog") {
        return new Response(CATALOG_ADMIN_PAGE, { status: 200, headers: htmlHeaders() });
      }
      // GET /audit?url=<domain> — marketing audit endpoint.
      // Also served at /marketing (branded path for asksolomon.cfobydesign.com/marketing).
      // ?mode=internal switches to the team-facing rubric (full detail, quick wins,
      // signal list, raw JSON). Default mode is "public" (client-facing, no fixes,
      // ends with a book-a-call CTA).
      // URL-in, audit-out. No auth: worst abuse is Anthropic token cost.
      if (path === "/audit" || path === "/marketing") {
        const target = url.searchParams.get("url");
        const mode = url.searchParams.get("mode") === "internal" ? "internal" : "public";
        if (!target) {
          return new Response(
            `<!DOCTYPE html><meta charset=utf-8><title>Marketing audit</title>
             <body style="font-family:Georgia,serif;max-width:520px;margin:80px auto;padding:20px;">
             <h1 style="font-size:20px;">Marketing audit</h1>
             <p>Missing <code>url</code> parameter. Try
             <code>${escapeHtml(path)}?url=example.com</code>.</p></body>`,
            { status: 400, headers: htmlHeaders() }
          );
        }
        const normalizedTarget = normalizeAuditUrl(target) || target;
        const host = (() => { try { return new URL(normalizedTarget).host; } catch { return target; } })();
        // Serve a CLOSED response to every client with the OG-tagged shell and
        // a small <script> that fetches /marketing/render for the actual audit
        // body. This makes UA sniffing unnecessary — social unfurlers (iMessage,
        // Facebook, Slack, LinkedIn, WhatsApp, Discord, Twitter, whatever) get
        // their preview metadata immediately without waiting on Claude, and
        // real browsers run the fetch script to fill in the card. The earlier
        // streaming approach held the connection open for 30–60s, which some
        // unfurlers (iMessage in particular, which sends a Safari-style UA
        // rather than facebookexternalhit/Applebot) timed out on.
        const modeParam = mode === "internal" ? "&mode=internal" : "";
        const renderUrl = `/marketing/render?url=${encodeURIComponent(target)}${modeParam}`;
        const shell = buildAuditShellStart(host, normalizedTarget, mode, env);
        const fetchScript = `
<script>
(function () {
  var mount = document.getElementById('audit-mount');
  if (!mount) return;
  fetch(${JSON.stringify(renderUrl)}, { cache: 'no-store', headers: { 'Accept': 'text/html' } })
    .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)); })
    .then(function (html) { mount.outerHTML = html; })
    .catch(function (err) {
      mount.outerHTML = ${JSON.stringify(buildAuditErrorCard({ message: "The audit failed to load. Please refresh." }))};
      // eslint-disable-next-line no-console
      try { console.error('audit render failed:', err); } catch (_) {}
    });
})();
</script>`;
        return new Response(
          shell + fetchScript + buildAuditShellEnd(),
          { status: 200, headers: htmlHeaders() }
        );
      }

      // GET /marketing/render?url=<domain>&mode=<mode> — runs the audit and
      // returns ONLY the .report-card HTML fragment. Called by client-side JS
      // from /marketing (and /audit). No auth. Cache-Control no-store so
      // browsers don't reuse stale audits.
      if (path === "/marketing/render" || path === "/audit/render") {
        const target = url.searchParams.get("url");
        const mode = url.searchParams.get("mode") === "internal" ? "internal" : "public";
        if (!target) {
          return new Response(buildAuditErrorCard({ message: "Missing url parameter." }),
            { status: 400, headers: { ...htmlHeaders(), "Cache-Control": "no-store" } });
        }
        try {
          const { agent, signals } = await runMarketingAudit(target, env, mode);
          const cardHtml = buildAuditCardBody(agent, signals, mode, env);
          return new Response(cardHtml, {
            status: 200,
            headers: { ...htmlHeaders(), "Cache-Control": "no-store" },
          });
        } catch (err) {
          return new Response(buildAuditErrorCard(err), {
            status: 500,
            headers: { ...htmlHeaders(), "Cache-Control": "no-store" },
          });
        }
      }
      if (path === "/asksolomon/rubric") {
        if (!checkConsolePassword(request, env)) {
          return json({ success: false, error: "Unauthorized" }, 401);
        }
        return json({ success: true, rubric: ASSESSMENT_RUBRIC });
      }
      // /asksolomon/diag — UNAUTHENTICATED diagnostic endpoint. Returns only whether
      // CONSOLE_PASSWORD is configured and its character length. NEVER returns the value.
      // Use during setup to confirm Cloudflare environment has the secret.
      if (path === "/asksolomon/diag") {
        const pw = env.CONSOLE_PASSWORD;
        return json({
          passwordConfigured: Boolean(pw),
          passwordLength: typeof pw === "string" ? pw.length : 0,
          hint: "The deployed worker expects password header 'x-console-password' to match env.CONSOLE_PASSWORD exactly (case-sensitive, no trim). If passwordConfigured is false, the secret isn't in this environment.",
        });
      }
      // GET /diag/contact/{contactId} — intake diagnostic.
      // Fetches the contact from GHL, runs the same hydration + mapping the
      // survey webhook does, and returns a sanitized view of what Solomon
      // would actually see. Lets us pinpoint whether an "incomplete intake"
      // outcome is caused by missing field values, catalog hydration gaps,
      // or field-ID drift.
      // AUTH: x-console-password header ONLY. Query-string ?pw= was rejected
      // on security review (CONSOLE_PASSWORD is shared across /asksolomon
      // routes; a query-string credential retains in browser history,
      // referer headers, proxy and Cloudflare request logs). Use curl:
      //   curl -H "x-console-password: $PW" \
      //        https://swot-engine.cfobydesign.workers.dev/diag/contact/<id>
      const diagContactMatch = path.match(/^\/diag\/contact\/([A-Za-z0-9_-]+)$/);
      if (diagContactMatch) {
        const pwHeader = request.headers.get("x-console-password");
        if (!env.CONSOLE_PASSWORD || pwHeader !== env.CONSOLE_PASSWORD) {
          return json({
            error: "Unauthorized",
            hint: "Pass the console password in the x-console-password header, not the URL. The query-string form was removed to avoid credential leakage into request logs.",
          }, 401);
        }
        const cid = diagContactMatch[1];
        if (!env.GHL_API_KEY) return json({ error: "GHL_API_KEY not configured" }, 500);
        const contact = await fetchGHLContact(cid, env);
        if (!contact) return json({ error: "Contact not found" }, 404);
        let catalog = {};
        let catalogError = null;
        try { catalog = await fetchGHLCustomFieldsCatalog(env); }
        catch (err) { catalogError = String(err && err.message || err).slice(0, 200); }
        const cfs = contact.customFields || [];
        const trunc = (v) => {
          const s = String(v == null ? "" : v);
          return s.length > 120 ? s.slice(0, 117) + "..." : s;
        };
        const kept = [];
        const dropped = [];
        for (const f of cfs) {
          const id = f && f.id;
          const value = (f && (f.value ?? f.field_value)) ?? null;
          const hasValue = value != null && String(value).trim() !== "";
          const meta = id ? catalog[id] : null;
          const bareName = f && (f.name || null);
          const bareKey = f && (f.fieldKey || f.key || null);
          const effName = bareName || (meta && meta.name) || null;
          const effKey = bareKey || (meta && meta.fieldKey) || null;
          const curated = id ? SURVEY_FIELD_MAP[id] : null;
          const solomonOwned = id ? SOLOMON_OWNED_FIELDS.has(id) : false;
          const effKeyLower = String(effKey || "").toLowerCase();
          const effNameLower = String(effName || "").toLowerCase();
          const solomonByName = effKeyLower.startsWith("swot_") || effKeyLower.startsWith("contact.swot_")
            || effNameLower.startsWith("swot ") || effNameLower === "internal notes";
          const looksLikeUpload = (() => {
            const vs = String(value || "").trim();
            if (!/^https?:\/\//i.test(vs)) return false;
            return effKeyLower.includes("upload") || effNameLower.includes("upload")
              || /\.(pdf|xlsx|xls|csv|docx?|png|jpg|jpeg)(\?|$)/i.test(vs);
          })();
          const question = curated || effName || effKey || null;
          const row = {
            id,
            hasValue,
            valuePreview: hasValue ? trunc(value) : null,
            bareName, bareKey,
            catalogHit: Boolean(meta),
            catalogName: meta ? meta.name : null,
            catalogFieldKey: meta ? meta.fieldKey : null,
            curated: Boolean(curated),
            solomonOwned,
            solomonByName,
            looksLikeUpload,
            effectiveQuestion: question,
          };
          if (!hasValue) { row.reason = "empty_value"; dropped.push(row); continue; }
          if (solomonOwned) { row.reason = "solomon_owned_id"; dropped.push(row); continue; }
          if (solomonByName) { row.reason = "solomon_owned_name"; dropped.push(row); continue; }
          if (looksLikeUpload) { row.reason = "file_upload"; dropped.push(row); continue; }
          if (!question) { row.reason = "no_label"; dropped.push(row); continue; }
          kept.push({
            id, question,
            answerPreview: trunc(value),
            source: curated ? "mapped" : (meta ? "catalog" : "bare"),
          });
        }
        return json({
          contactId: cid,
          contactName: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.contactName || null,
          contactEmail: contact.email || null,
          contactTags: contact.tags || [],
          customFieldsSeen: cfs.length,
          customFieldsWithValue: cfs.filter(f => (f && (f.value ?? f.field_value) != null && String(f.value ?? f.field_value ?? "").trim() !== "")).length,
          catalogSize: Object.keys(catalog).length,
          catalogError,
          keptCount: kept.length,
          droppedCount: dropped.length,
          kept,
          dropped,
        });
      }

      // GET /diag/queue-trace/{contactId} — list the Solomon-queue
      // trace lines (2026-10-28 Codex P1 follow-up). handleSolomonQueueMessage
      // + the /from-ghl-survey producer path write a trace to R2 at
      // queue_traces/{contactId}/{iso-timestamp}-{stage}.json at every
      // step. This endpoint returns them sorted oldest-first so an
      // operator can see exactly how far the queue consumer got:
      //
      //   enqueued only                   → consumer not registered (or
      //                                     message not yet picked up)
      //   received only                   → consumer invoked but died
      //                                     before fetching contact
      //   fetched_contact → built_answers → completeness_short / passed
      //   claude_call_start then no done  → Claude call failed or hit
      //                                     a Workers wall-clock cap
      //   canonical_written with ok=false → D1 insert failed; see error
      //   writeback_done                  → full success
      //   error (final=true)              → terminal failure, deliveryfailed applied
      //
      // Same auth as /diag/contact (x-console-password header only).
      const diagTraceMatch = path.match(/^\/diag\/queue-trace\/([A-Za-z0-9_-]+)$/);
      if (diagTraceMatch) {
        const pwHeader = request.headers.get("x-console-password");
        if (!env.CONSOLE_PASSWORD || pwHeader !== env.CONSOLE_PASSWORD) {
          return json({ error: "Unauthorized" }, 401);
        }
        const traceCid = diagTraceMatch[1];
        if (!env.SOLOMON_LIBRARY) return json({ error: "SOLOMON_LIBRARY not bound" }, 500);
        const prefix = `queue_traces/${traceCid}/`;
        // Pagination (Codex P2 on #157). ISO-timestamp keys sort oldest-
        // first lexicographically, so a bare list({limit:500}) returns
        // the OLDEST 500 and silently hides newer traces once a contact
        // accumulates past that cap — operators debugging the current
        // failure would see stale old runs. Walk the cursor until R2
        // stops reporting truncated=true (sanity cap at 10000 to bound
        // the scan on any pathological contact), then sort newest-first
        // and return `?limit=N` of them (default 100). The response
        // reports both the fetched count and whether the full key space
        // for this contact was walked so operators know if the picture
        // is complete.
        const latestLimit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || 100));
        const allKeys = [];
        let cursor = undefined;
        let walked = false;
        let listErr = null;
        for (let i = 0; i < 20; i++) { // 20 * 500 = 10000-key sanity cap
          const page = await env.SOLOMON_LIBRARY.list({ prefix, limit: 500, cursor }).catch((err) => ({ _err: err }));
          if (page?._err) { listErr = String(page._err.message || page._err).slice(0, 200); break; }
          for (const obj of page.objects || []) allKeys.push(obj.key);
          if (!page.truncated || !page.cursor) { walked = true; break; }
          cursor = page.cursor;
        }
        if (listErr) return json({ error: `list failed: ${listErr}` }, 500);
        // Newest-first — timestamps embedded in the key, so lexicographic
        // descending IS chronological descending. Then take the top N so
        // operators always see the latest N trace lines, never a stale
        // first page.
        allKeys.sort((a, b) => String(b).localeCompare(String(a)));
        const picked = allKeys.slice(0, latestLimit);
        // Re-sort the picked window ascending so the response reads
        // oldest-first inside the window (the shape operators expect
        // when following a run through its stages).
        picked.sort((a, b) => String(a).localeCompare(String(b)));
        const traces = [];
        for (const key of picked) {
          const body = await env.SOLOMON_LIBRARY.get(key).catch(() => null);
          if (!body) continue;
          const text = await body.text().catch(() => null);
          if (!text) continue;
          try { traces.push(JSON.parse(text)); } catch { traces.push({ raw: text.slice(0, 200), key }); }
        }
        return json({
          contactId: traceCid,
          totalKeys: allKeys.length,
          walkedFully: walked,
          traceCount: traces.length,
          limit: latestLimit,
          traces,
        });
      }
      // GET /asksolomon/library — list library items with metadata.
      if (path === "/asksolomon/library") {
        return handleLibraryList(request, env);
      }
      // GET /asksolomon/history — list run summaries (Fix B, server-side history).
      if (path === "/asksolomon/history") {
        return handleHistoryList(request, env);
      }
      // GET /asksolomon/history/{id} — fetch full run body.
      const historyGetMatch = path.match(/^\/asksolomon\/history\/([A-Za-z0-9_-]+)$/);
      if (historyGetMatch) {
        return handleHistoryGet(historyGetMatch[1], request, env);
      }
      // GET /asksolomon/bookmarks — list bookmark summaries.
      if (path === "/asksolomon/bookmarks") {
        return handleBookmarksList(request, env);
      }
      // GET /asksolomon/bookmarks/{id} — fetch full bookmark body.
      const bookmarkGetMatch = path.match(/^\/asksolomon\/bookmarks\/([A-Za-z0-9_-]+)$/);
      if (bookmarkGetMatch) {
        return handleBookmarkGet(bookmarkGetMatch[1], request, env);
      }
      // GET /asksolomon/rubrics — list saved rubric variants (all fields inline).
      if (path === "/asksolomon/rubrics") {
        return handleRubricsList(request, env);
      }
      // GET /diag/webhook-secret — confirm WEBHOOK_SECRET is present on this deploy
      // without ever revealing its value. Use this after setting the secret in
      // Cloudflare and before wiring the GHL webhook headers.
      if (path === "/diag/webhook-secret") {
        const s = env.WEBHOOK_SECRET;
        return json({
          configured: Boolean(s),
          length: typeof s === "string" ? s.length : 0,
          hint: "Accepted as either 'x-webhook-secret: <secret>' or 'Authorization: Bearer <secret>' — use whichever your webhook client (GHL uses Bearer) supports. If configured is false, add WEBHOOK_SECRET in Cloudflare → Workers → swot-engine → Settings → Variables and redeploy.",
        });
      }
      // GET /verify-bga-access?contactId=X — authorization gate for the
      // /bga-intake wrapper on success.cfobydesign.com. Checks the GHL
      // contact's swot_paid_297 tag server-side. See
      // handleVerifyBgaAccess for the full contract (what each status
      // code means, why 403 covers both "unknown contact" and "unpaid
      // contact", and why GHL outages fail closed as 503).
      if (path === "/verify-bga-access") {
        return handleVerifyBgaAccess(request, env, url);
      }
      return json({ success: false, error: "Not found" }, 404);
    }

    // DELETE /asksolomon/library/{id} — soft-delete a library item (moves to archive).
    // DELETE /asksolomon/history/{id} — soft-delete a run (moves body to archive).
    // DELETE /asksolomon/history — wipe all run history (manifest snapshot archived).
    if (request.method === "DELETE") {
      const libMatch = path.match(/^\/asksolomon\/library\/([A-Za-z0-9_-]+)$/);
      if (libMatch) return handleLibraryDelete(libMatch[1], request, env);
      const historyDelMatch = path.match(/^\/asksolomon\/history\/([A-Za-z0-9_-]+)$/);
      if (historyDelMatch) return handleHistoryDelete(historyDelMatch[1], request, env);
      if (path === "/asksolomon/history") return handleHistoryWipe(request, env);
      const bookmarkDelMatch = path.match(/^\/asksolomon\/bookmarks\/([A-Za-z0-9_-]+)$/);
      if (bookmarkDelMatch) return handleBookmarkDelete(bookmarkDelMatch[1], request, env);
      const rubricDelMatch = path.match(/^\/asksolomon\/rubrics\/([A-Za-z0-9_-]+)$/);
      if (rubricDelMatch) return handleRubricDelete(rubricDelMatch[1], request, env);
      return json({ success: false, error: "Not found" }, 404);
    }

    // PATCH /asksolomon/history/{id} — update feedback / feedbackNote on a run.
    // PATCH /asksolomon/bookmarks/{id} — update label / feedback / feedbackNote.
    if (request.method === "PATCH") {
      const historyPatchMatch = path.match(/^\/asksolomon\/history\/([A-Za-z0-9_-]+)$/);
      if (historyPatchMatch) return handleHistoryPatch(historyPatchMatch[1], request, env);
      const bookmarkPatchMatch = path.match(/^\/asksolomon\/bookmarks\/([A-Za-z0-9_-]+)$/);
      if (bookmarkPatchMatch) return handleBookmarkPatch(bookmarkPatchMatch[1], request, env);
      return json({ success: false, error: "Not found" }, 404);
    }

    if (request.method !== "POST") return json({ success: false, error: "POST only" }, 405);

    // Route /upload BEFORE JSON parsing — it expects multipart/form-data.
    if (path === "/upload") {
      return handleUpload(request, env);
    }

    // POST /asksolomon/run — console test runs.
    // Optional rubric override + opt-in GHL writeback when contact.email is provided
    // (so the production email workflow fires and the tester receives a real email).
    if (path === "/asksolomon/run") {
      return handleConsoleRun(request, env, ctx, url);
    }

    // BGA Copilot case tools (PR 3 of the build — docs/BGA_COPILOT_SPEC.md §4).
    // Neither can write swot_growth_plan or apply swot_growth_plan_ready;
    // those are reserved for the APPROVE & SEND button endpoint (PR 12).
    if (path === "/asksolomon/case/audit-gaps") {
      return handleAuditCaseGaps(request, env, { checkPassword: checkConsolePassword });
    }
    if (path === "/asksolomon/case/verified-financials") {
      return handleVerifiedFinancialsPanel(request, env, { checkPassword: checkConsolePassword });
    }

    // BGA Copilot case view (PR 4 of the build — docs/BGA_COPILOT_SPEC.md §2.1 + §11 row 4).
    // POST /asksolomon/case/load → assembles the case bundle for a swot_paid_297 contact.
    // (The GET /asksolomon/case HTML route lives inside the GET dispatcher above,
    // per Codex P1 on #94: the POST-only guard would otherwise make it unreachable.)
    if (path === "/asksolomon/case/load") {
      return handleCaseLoad(request, env, { checkPassword: checkConsolePassword });
    }

    // PR 125 — docs/BGA_COPILOT_SPEC.md §2.1 picker ("find a client").
    // Read-only lookup over swot_paid_297 contacts. Returns display
    // cards with workflow-state badges. Feeds the strategist a
    // searchable list so the "paste a GHL Contact ID" step is only
    // a support/debug fallback (behind an Advanced disclosure).
    if (path === "/asksolomon/case/search") {
      return handleCaseSearch(request, env, { checkPassword: checkConsolePassword });
    }

    // PR 5b — docs/BGA_COPILOT_SPEC.md §4.3 + §4.3.1.
    // Writes ONLY swot_growth_plan_draft + applies swot_growth_plan_drafted.
    // Never touches swot_growth_plan or applies swot_growth_plan_ready.
    if (path === "/asksolomon/case/generate-roadmap-draft") {
      return handleGenerateRoadmapDraft(request, env, { checkPassword: checkConsolePassword });
    }
    if (path === "/asksolomon/case/update-roadmap-section") {
      return handleUpdateRoadmapSection(request, env, { checkPassword: checkConsolePassword });
    }

    // PR 6 — docs/BGA_COPILOT_SPEC.md §4.4 + §7.
    // Writes ONLY swot_growth_plan_draft (Section 7 only). No tag writes.
    if (path === "/asksolomon/case/match-services") {
      return handleMatchServices(request, env, { checkPassword: checkConsolePassword });
    }

    // PR 7 — docs/BGA_COPILOT_SPEC.md §4.6.
    // Writes ONLY swot_bga_prep_brief. No tag writes.
    if (path === "/asksolomon/case/generate-prep-brief") {
      return handleGeneratePrepBrief(request, env, { checkPassword: checkConsolePassword });
    }

    // PR 8 — docs/BGA_COPILOT_SPEC.md §4.5.
    // READ-ONLY adversarial critique. Writes NOTHING. No tags.
    if (path === "/asksolomon/case/challenge-roadmap") {
      return handleChallengeRoadmap(request, env, { checkPassword: checkConsolePassword });
    }

    // PR 9 — docs/BGA_COPILOT_SPEC.md §4.7.
    // Two-stage: extract (read-only parse), confirm (writes
    // swot_bga_decisions + swot_bga_services_selected). No tags.
    if (path === "/asksolomon/case/extract-call-decisions") {
      return handleExtractCallDecisions(request, env, { checkPassword: checkConsolePassword });
    }
    if (path === "/asksolomon/case/confirm-call-decisions") {
      return handleConfirmCallDecisions(request, env, { checkPassword: checkConsolePassword });
    }

    // PR 12 — docs/BGA_COPILOT_SPEC.md §4.8, §5.3.
    // Pre-Send QA checker. Writes swot_bga_red_team_report with the
    // 6-blocker/4-warning results and input hashes (§5.3) so the
    // approve endpoint can refuse stale reports.
    if (path === "/asksolomon/case/red-team-check") {
      return handleRedTeamCheck(request, env, { checkPassword: checkConsolePassword });
    }
    if (path === "/asksolomon/case/acknowledge-warning") {
      return handleAcknowledgeWarning(request, env, { checkPassword: checkConsolePassword });
    }

    // PR 12 — docs/BGA_COPILOT_SPEC.md §4.9 + §5. THE BUTTON.
    // The ONLY code path in the Worker that writes `swot_growth_plan`
    // or applies the `swot_growth_plan_ready` tag. All preconditions
    // (password, reviewed=true, draft present, swot_paid_297, no
    // blockers in the latest red-team report, every warning
    // acknowledged, every input hash still matches current content,
    // ready tag not already present, D1 lock not already held) are
    // enforced on this handler, in that order.
    if (path === "/asksolomon/case/approve-and-send") {
      return handleApproveAndSend(request, env, { checkPassword: checkConsolePassword });
    }

    // Service Catalog + Bundles admin (slice B of 5; customer
    // directive 2026-10-17). All four endpoints are password-gated.
    // The HTML page at GET /asksolomon/catalog consumes these.
    if (path === "/asksolomon/catalog/active") {
      return handleCatalogActive(request, env, { checkPassword: checkConsolePassword });
    }
    if (path === "/asksolomon/catalog/versions") {
      return handleCatalogVersions(request, env, { checkPassword: checkConsolePassword });
    }
    if (path === "/asksolomon/catalog/version") {
      return handleCatalogVersion(request, env, { checkPassword: checkConsolePassword });
    }
    if (path === "/asksolomon/catalog/publish") {
      return handleCatalogPublish(request, env, { checkPassword: checkConsolePassword });
    }

    // Per-case strategist overrides (slice C of 5; customer directive
    // 2026-10-17). Append-only log — never mutates the catalog, never
    // affects approve-and-send. Rows feed slice D's learning loop.
    if (path === "/asksolomon/case/overrides") {
      return handleListOverrides(request, env, { checkPassword: checkConsolePassword });
    }
    if (path === "/asksolomon/case/overrides/all") {
      return handleListOverridesAll(request, env, { checkPassword: checkConsolePassword });
    }
    if (path === "/asksolomon/case/override") {
      return handleRecordOverride(request, env, { checkPassword: checkConsolePassword });
    }
    if (path === "/asksolomon/case/override/revoke") {
      return handleRevokeOverride(request, env, { checkPassword: checkConsolePassword });
    }

    // Learning loop (slice D of 5; customer directive 2026-10-17).
    // Aggregates slice-C overrides into pending rule suggestions.
    // Human approval here is a recommendation; the catalog is still
    // mutated only through the slice-B publish flow.
    if (path === "/asksolomon/catalog/suggestions/scan") {
      return handleScanSuggestions(request, env, { checkPassword: checkConsolePassword });
    }
    if (path === "/asksolomon/catalog/suggestions") {
      return handleListSuggestions(request, env, { checkPassword: checkConsolePassword });
    }
    if (path === "/asksolomon/catalog/suggestion") {
      return handleGetSuggestion(request, env, { checkPassword: checkConsolePassword });
    }
    if (path === "/asksolomon/catalog/suggestion/decide") {
      return handleDecideSuggestion(request, env, { checkPassword: checkConsolePassword });
    }

    // Catalog-ref audit (slice E of 5 — final slice; customer
    // directive 2026-10-17). Read-only cohort scan + per-contact
    // backfill. Backfill writes through the sanctioned
    // version_history wrapper so the change is auditable.
    if (path === "/asksolomon/catalog/audit") {
      return handleAuditCatalogRefs(request, env, { checkPassword: checkConsolePassword });
    }
    if (path === "/asksolomon/catalog/audit/backfill") {
      return handleBackfillCatalogRef(request, env, { checkPassword: checkConsolePassword });
    }

    // PR 14 — docs/BGA_COPILOT_SPEC.md §11 row 14 (optional).
    // Reads an uploaded PDF / CSV and returns candidate verified-
    // financials values for the strategist to review. NEVER writes
    // any field — accepted candidates post through
    // /case/verified-financials, which runs the §4.2 hash concurrency
    // guard and stamps provenance="verified".
    if (path === "/asksolomon/case/extract-financials-from-document") {
      return handleExtractFinancialsFromDocument(request, env, { checkPassword: checkConsolePassword });
    }

    // POST /audit — JSON marketing audit. No auth (matches GET /audit).
    // Also served at /marketing for symmetry with the GET route.
    // Body: { url: "example.com" }. Response: { success, agent, signals }.
    if (path === "/audit" || path === "/marketing") {
      let body;
      try { body = await request.json(); }
      catch { return json({ success: false, error: "Invalid JSON body" }, 400); }
      const target = body.url;
      const mode = body.mode === "internal" ? "internal" : "public";
      if (!target) return json({ success: false, error: "url required" }, 400);
      try {
        const { agent, signals } = await runMarketingAudit(target, env, mode);
        return json({ success: true, agent, signals, mode });
      } catch (err) {
        return json({ success: false, error: err && err.message || String(err) }, 500);
      }
    }

    // POST /asksolomon/send-result — send a PREVIOUSLY GENERATED output to an email.
    // Does NOT re-run Solomon. Writes the provided agent + reportHtml to GHL and
    // applies tier tags, so the existing production workflow delivers the email.
    // Tagged SWOT_CONSOLE_MANUAL_SEND to distinguish from real leads and test runs.
    if (path === "/asksolomon/send-result") {
      return handleConsoleSendResult(request, env, ctx, url);
    }

    // POST /asksolomon/library — multipart upload of a reference item (transcript,
    // testimonial, example analysis, rubric fragment).
    if (path === "/asksolomon/library") {
      return handleLibraryUpload(request, env);
    }

    // POST /asksolomon/history — persist a run to server-side history (Fix B).
    if (path === "/asksolomon/history") {
      return handleHistoryAppend(request, env);
    }

    // POST /asksolomon/bookmarks — persist a bookmark to the shared manifest.
    if (path === "/asksolomon/bookmarks") {
      return handleBookmarkAppend(request, env);
    }

    // POST /asksolomon/rubrics — save a rubric variant to the shared manifest.
    if (path === "/asksolomon/rubrics") {
      return handleRubricsAppend(request, env);
    }

    // POST /apply-solomon50 — tag a contact when they apply the SOLOMON50 beta code
    // on the free report page. Fired by client-side JS in buildReportPage's coupon script.
    if (path === "/apply-solomon50") {
      return handleApplySolomon50(request, env);
    }

    // GET /diag/webhook-secret — verify WEBHOOK_SECRET is set without revealing its value.
    // Returns { configured: true|false, length: N }. Use to confirm the secret exists on
    // this deploy before firing test webhooks from GHL.
    // POST /from-ghl-survey — the "no more Vibe" bridge.
    // GHL workflow fires this webhook after a survey submits with { contactId, tier }.
    // Worker fetches the contact, runs Solomon, writes results + applies tier tag →
    // GHL's tier email workflow (00 / 01 / 02) then fires the delivery email.
    if (path === "/from-ghl-survey") {
      return handleGHLSurveyWebhook(request, env, ctx, url);
    }

    // POST /payment-status — payment confirmation channel from LC Payments.
    // Runs regardless of whether the customer has taken the assessment yet.
    // Success path: safety-net tag apply + audit log.
    // Failure path: apply retry tag → GHL "update payment method" email fires.
    if (path === "/payment-status") {
      return handlePaymentStatusWebhook(request, env, ctx);
    }

    // POST /reset-contact-tags — testing / lifecycle-reset tool. Removes every
    // SWOT-owned tag from a contact so it can be re-tested end-to-end. Auth via
    // WEBHOOK_SECRET.
    if (path === "/reset-contact-tags") {
      return handleResetContactTags(request, env);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ success: false, error: "Invalid JSON body" }, 400);
    }

    // /verify uses JSON like the main assessment endpoint.
    if (path === "/verify") {
      return handleVerify(body, env);
    }

    const tier = body.tier || "free";
    const contact = body.contact || body.contactData || {};
    const businessProfile = body.businessProfile || {};
    const answers = normalizeAnswers(body.answers);
    if (!answers.length) return json({ success: false, error: "No answers provided" }, 400);

    // NOTE: no idempotency guard on this public React path. The app prevents
    // double-submit at the UI (the survey unmounts the instant it's submitted),
    // and a report-less "deduped" response here would crash ResultsScreen, which
    // treats any success payload as a full report. Dedup lives on the
    // /from-ghl-survey webhook path, where retries are the real risk.
    let agent;
    try {
      const raw = await callClaude(
        buildPrompt(tier, answers, contact, businessProfile),
        env
      );
      agent = parseAgentJson(raw);
    } catch (err) {
      console.error("Assessment error:", err.message);
      return json({ success: false, error: err.message }, 500);
    }

    // Defensive gate: digital presence is a paid-tier reveal. Strip from FREE output
    // even if the agent misfires, and scrub any digital-presence opportunity from
    // the free report body so it isn't given away in the teaser.
    if (tier === "free") {
      agent.opportunityFlags = (agent.opportunityFlags || []).filter(
        (f) => f !== "DIGITAL_PRESENCE_OPP"
      );
      const looksDigital = (s) => {
        const t = String(s || "").toLowerCase();
        return /google business profile|gbp\b|\bseo\b|online review|low reviews|few reviews|digital presence|search visibility|social presence/.test(t);
      };
      if (Array.isArray(agent.opportunities)) {
        agent.opportunities = agent.opportunities.filter(
          (o) => !looksDigital(o && (o.title + " " + o.desc))
        );
      }
      if (Array.isArray(agent.gaps)) {
        agent.gaps = agent.gaps.filter(
          (g) => !looksDigital(g && (g.title + " " + g.impact))
        );
      }
    }

    // Phase 2C: sanitize structured_findings on the public assessment
    // path too. This endpoint receives answers in the body with no GHL
    // field-id stream, so there's no normalization context — the empty
    // context causes every structured finding to fail the grounded-in-
    // nothing rule and be stripped. Prevents public submissions from
    // emitting unvalidated findings into the returned reportHtml.
    sanitizeStructuredFindings(agent, { normalized: {}, derivedMetrics: [] }, "public assessment POST");

    // TIGHTENED (2026-09-16): paid-tier POSTs require an explicit contactId
    // AND that contactId must already carry the matching paid-entitlement
    // tag. Solomon no longer applies swot_paid_47 / swot_paid_297 or their
    // report-ready email triggers from this public endpoint — those belong
    // to the GHL payment workflow. Prevents an unauthenticated curl POST
    // with tier="paid_297" from tagging any contact as paid and firing a
    // delivery email. See handleGHLSurveyWebhook for the same shape of gate.
    if (tier === "paid_47" || tier === "paid_297") {
      if (!contact?.contactId) {
        return json({
          success: false,
          error: `tier="${tier}" requires contact.contactId — public tier upgrades are not permitted`,
        }, 400);
      }
      // Fetch the contact and verify entitlement. paid_47 accepts the beta
      // cohort tag (SOLOMON50) as an equivalent; paid_297 requires either
      // real paid_297, real paid_47 (upgrade in progress via sell-first),
      // or the beta cohort tag.
      const c = await fetchGHLContact(contact.contactId, env);
      if (!c) {
        return json({ success: false, error: "Contact not found in GHL" }, 404);
      }
      const contactTags = (c.tags || []).map((t) => String(t).toLowerCase());
      const accepted = tier === "paid_297"
        ? ["swot_paid_297", "swot_paid_47", "swot_solomon50_applied"]
        : ["swot_paid_47", "swot_solomon50_applied"];
      if (!accepted.some((t) => contactTags.includes(t))) {
        console.warn(`[POST /] tier=${tier} contactId=${contact.contactId} — no entitlement tag; expected one of [${accepted.join(",")}]. Refusing writeback.`);
        return json({
          success: false,
          error: `Contact does not carry a required entitlement tag for tier="${tier}"`,
        }, 403);
      }
    }

    // Resolve a GHL contactId. Free tier is the public React app: a brand-new
    // lead usually has only an email and no contact yet, so create-on-miss
    // (email required) — otherwise the report generates in memory but never
    // stores, and /report + the reveal page stay blank. Paid tiers stay
    // match_only: they must already exist with an entitlement tag (gated above).
    const contactId = await resolveGHLContactId(contact, env, tier === "free" ? "create_if_missing" : "match_only");
    if (!contactId) {
      console.warn(`[POST /] tier=${tier} — NO CONTACT RESOLVED for email=${contact.email || "(none)"}; ` +
        `report generated in-memory but NOT written to GHL (no create-if-missing on public POST). ` +
        `contactId in payload=${contact.contactId || "(none)"}. GHL_API_KEY set=${Boolean(env.GHL_API_KEY)}.`);
    } else {
      console.log(`[POST /] tier=${tier} contactId=${contactId} email=${contact.email || "(none)"} — starting writeback`);
    }

    // Best-effort GHL writeback to CFO By Design's real SWOT custom fields.
    if (contactId) {
      const reportBody = buildReportHtml(agent);

      // One report field per tier — no mirroring. Each tier has its own named deliverable:
      //   free     -> swot_free_report      (Free SWOT Report)
      //   paid_47  -> swot_full_report      (Full Diagnostic Report)
      //   paid_297 -> business_playbook     (Business Growth Analysis — the $297 deliverable;
      //                                      the GHL field key stays `business_playbook` as a
      //                                      stable integration identifier per
      //                                      docs/brand/PRODUCT_NAMING_AND_LADDER.md)
      const reportFieldKey =
        tier === "paid_297" ? "business_playbook"
        : tier === "paid_47" ? "swot_full_report"
        : "swot_free_report";

      const fields = [
        { key: "swot_path", field_value: String(agent.path || "") },
        { key: "swot_rehab_flag", field_value: agent.path === "rehab" ? "true" : "false" },
        { key: reportFieldKey, field_value: reportBody },
      ];

      // Personalized 1-paragraph hook for delivery emails ({{contact.swot_email_blurb}}).
      // Pulled from the LLM's `opener` — it's already written as a per-lead intro.
      if (agent.opener) {
        fields.push({ key: "swot_email_blurb", field_value: String(agent.opener) });
      }

      // Internal-only consultant brief ({{contact.swot_strategist_brief}}) — path reasoning,
      // upsell angles, opener question. Written on every tier so Miguel sees it before every call.
      if (agent.strategistBrief) {
        fields.push({ key: "swot_strategist_brief", field_value: String(agent.strategistBrief) });
      }

      // Hosted "View Report Online" URL — points at GET /report/{contactId} on this worker.
      // Used in email "View Online" buttons via {{contact.swot_report_path}}.
      fields.push({
        key: "swot_report_path",
        field_value: `${url.origin}/report/${contactId}`,
      });

      if (tier === "paid_297") {
        fields.push({ key: "swot_deep_dive_booked", field_value: "true" });
      }

      // TIGHTENED tag policy for the public POST endpoint:
      //   free tier  — swot_free_lead + swot_report_ready_free (email trigger)
      //                fire as before. The path/opportunity tags are safe
      //                LLM-derived signals.
      //   paid tiers — Solomon does NOT apply swot_paid_47 / swot_paid_297
      //                (the entitlement is already on the contact — gated
      //                above at request boundary). Solomon does NOT fire
      //                swot_report_ready_paid_* here either — for paid_47
      //                the entitlement contact already had the tier tag,
      //                and firing the ready tag from an unauthenticated
      //                endpoint would let anyone with a known contactId
      //                re-fire the delivery email. Instead we apply
      //                swot_playbook_written on writeback success so the
      //                GHL payment / delivery workflow can gate on it.
      const isPaidTier = tier === "paid_47" || tier === "paid_297";
      const tierTag = isPaidTier ? null : "swot_free_lead";
      const reportReadyTag = isPaidTier ? null : "swot_report_ready_free";
      const writebackSignalTag = isPaidTier ? "swot_playbook_written" : null;
      const lifecycleTags = [
        tierTag,
        ...pathTags(agent.path),
        ...(agent.opportunityFlags || []).map((f) => String(f).toLowerCase()),
      ].filter(Boolean);

      ctx.waitUntil(
        Promise.allSettled([
          updateGHLContact(contactId, fields, env).then(async ok => {
            if (ok) {
              const postWriteTags = [];
              if (reportReadyTag) postWriteTags.push(reportReadyTag);
              if (writebackSignalTag) postWriteTags.push(writebackSignalTag);
              if (postWriteTags.length) {
                console.log(`[POST /] tier=${tier} contactId=${contactId} — writeback OK, applying [${postWriteTags.join(",")}]`);
                return addGHLTag(contactId, postWriteTags, env);
              }
              return;
            }
            console.warn(`[POST /] tier=${tier} contactId=${contactId} — writeback FAILED; skipping post-write tags. /report/${contactId} will show analyzing until re-generated.`);
          }),
          lifecycleTags.length ? addGHLTag(contactId, lifecycleTags, env) : Promise.resolve(),
          fireTrackingEvent({
            event_type: `report_generated_${tier}`,
            tier,
            contact_id: contactId,
            email: contact.email || "",
            name: [contact.firstName || contact.first_name, contact.lastName || contact.last_name].filter(Boolean).join(" ").trim() || contact.name || "",
            business_name: contact.businessName || contact.company || businessProfile.name || "",
            path: agent.path || "",
            badge: agent.badge || "",
            headline: agent.headline || "",
            opportunity_flags: agent.opportunityFlags || [],
            answers,
            source: "swot-app",
          }, env)
        ])
      );
    }

    const bookingLink =
      tier === "paid_297" ? (env.BOOKING_LINK_297 || CONFIG.BOOKING_LINK_297)
      : tier === "paid_47" ? (env.BOOKING_LINK_47 || CONFIG.BOOKING_LINK_47)
      : null;

    return json({ success: true, tier, ...agent, bookingLink });
  },

  // Queue consumer (2026-10-28 Codex P1 follow-up). Dispatched by the
  // Workers runtime for every message /from-ghl-survey enqueues to
  // SOLOMON_QUEUE. One message per invocation (max_batch_size = 1), so
  // the loop here is defensive — Queues can batch if the config
  // changes. See handleSolomonQueueMessage for retry policy + terminal
  // failure handling.
  async queue(batch, env, _ctx) {
    for (const message of batch.messages) {
      try {
        await handleSolomonQueueMessage(message, env);
      } catch (err) {
        // handleSolomonQueueMessage already decided whether to ack or
        // throw. A throw bubbles here means a non-final attempt that
        // Queues should retry — re-throw to let the runtime handle it.
        throw err;
      }
    }
  },
};

// -----------------------------------------------------------------------------
// Named exports — for `worker/tests/*` only. The Workers runtime ignores these
// (it only consumes `export default`), and no production code path imports from
// this module as named exports. Keep this block append-only; adding a name here
// does not change runtime behavior.
// -----------------------------------------------------------------------------
export {
  ASSESSMENT_RUBRIC,
  TIER_GUIDE,
  SURVEY_FIELD_MAP,
  SOLOMON_OWNED_FIELDS,
  INTAKE_MIN_ANSWERS,
  ASSESSMENT_VERSION,
  RUBRIC_VERSION,
  PROMPT_VERSION,
  buildPrompt,
  parseAgentJson,
  repairAgentJson,
  // Report dispatch (2026-10-19): exported so the regression test can
  // drive the tier cascade against a stubbed GHL fetch without going
  // through the full HTTP handler. The dispatch rule — paid-tier
  // intent beats free-content fallback — is a repeat failure class
  // (SOLOMON50 beta code, now paid_47 Full Diagnostic), and the test
  // locks it against another silent regression.
  handleReportStatus,
  normalizeAnswers,
  checkIntakeCompleteness,
  updateGHLContact,
  addGHLTag,
  fireTrackingEvent,
  writeCanonicalRecord,
  writeReportArtifact,
  recordGhlWriteback,
  // Phase 1c read helpers
  handleReport,
  resolveReportHtml,
  fetchArtifactHtml,
  tierLabelOf,
  // Phase 2D renderer
  buildReportHtml,
  buildReportPage,
  // GHL integration adapters (Codex P1 on #75)
  pathTags,
  // Phase 2C sanitizer
  sanitizeStructuredFindings,
  // Queue consumer (Codex P1 follow-up on #154) — exported so tests can
  // drive the consumer against a stubbed GHL/Claude/env without going
  // through the Workers Queues runtime.
  handleSolomonQueueMessage,
  // Anthropic streaming SSE parser — exported for unit coverage so a
  // malformed-stream regression surfaces in tests rather than only in
  // a production 524-recovered run.
  _test_parseAnthropicSse,
};

// Phase 2A: normalization layer. Re-exported from index so tests that
// want to touch both the primitives and the request handlers can do it
// from one import.
export { FIELD_NORMALIZERS, PRIMITIVES, normalizeContactFields, flatNormalized } from "./normalize.js";

// Phase 2B: derived-metrics engine. Same re-export pattern.
export { deriveMetrics, findMetric } from "./derived.js";

// Phase 2C: structured findings schema + validator + prompt-facts builder.
export { validateStructuredFinding, validateStructuredFindings, buildFactsForPrompt } from "./findings.js";
