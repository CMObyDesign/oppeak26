// Regression: Solomon's returned JSON occasionally contains unescaped
// double-quote characters inside string values. The classic trigger is
// Q7 referral language — owners paste a verbatim customer testimonial
// in quotes ("They came out the same day…"), and when Solomon echoes
// that paste back inside `opener`, `strategistBrief`, or any gaps[]
// entry without re-escaping the inner `"`, strict JSON.parse blows up
// mid-document (reproduced in prod 2026-10-17, Liz Test / Cool Air HVAC).
//
// parseAgentJson() now runs a repair pass on parse failure: it walks
// the extracted slice as a state machine and escapes stray unescaped
// `"` characters that appear inside string literals. These tests pin
// that behavior down.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseAgentJson, repairAgentJson } from "../src/index.js";

describe("parseAgentJson — strict path", () => {
  it("parses clean JSON without touching repair", () => {
    const src = '{"headline":"ok","gaps":[{"title":"x"}]}';
    const out = parseAgentJson(src);
    assert.equal(out.headline, "ok");
    assert.equal(out.gaps[0].title, "x");
  });

  it("strips a leading ```json fence and trailing ``` fence", () => {
    const src = '```json\n{"a": 1}\n```';
    const out = parseAgentJson(src);
    assert.equal(out.a, 1);
  });

  it("tolerates preamble before the opening brace", () => {
    const src = 'Here is your JSON:\n{"a": 2}';
    const out = parseAgentJson(src);
    assert.equal(out.a, 2);
  });
});

describe("parseAgentJson — repair fallback", () => {
  it("repairs an unescaped inner quote in a top-level string value", () => {
    // The character sequence `"trust us"` would otherwise close the
    // string early. Repair must escape both inner quotes.
    const src = '{"opener": "they said "trust us" to me"}';
    const out = parseAgentJson(src);
    assert.equal(out.opener, 'they said "trust us" to me');
  });

  it("repairs an unescaped inner quote inside an array of objects", () => {
    const src = '{"gaps":[{"title":"Referral: "same-day" quote","impact":"ok"}]}';
    const out = parseAgentJson(src);
    assert.equal(out.gaps[0].title, 'Referral: "same-day" quote');
    assert.equal(out.gaps[0].impact, "ok");
  });

  it("repairs quoted prose where the inner close-quote is followed by a comma (Codex P1 on #138)", () => {
    // The naive heuristic would treat the `"` after "great job" as a
    // real string terminator because it's followed by `,`. The
    // tightened heuristic checks what the comma leads INTO — here it
    // leads into prose ` which earned referrals.`, which is NOT a
    // JSON value start, so the quote is correctly recognized as
    // inside-string and escaped. The whole opener survives intact.
    const src = '{"opener":"They said "great job", which earned referrals."}';
    const out = parseAgentJson(src);
    assert.equal(out.opener, 'They said "great job", which earned referrals.');
  });

  it("repairs quoted prose where the inner close-quote is followed by `}` + prose (defensive)", () => {
    // Here the `}` after the second inner quote is still followed by
    // more prose. The afterClose check rejects it as a real close.
    // Not a realistic shape but verifies the braces/brackets look-ahead
    // mirrors the comma look-ahead.
    const src = '{"opener":"a "b"} and more"}';
    const out = parseAgentJson(src);
    assert.equal(out.opener, 'a "b"} and more');
  });

  it("repairs the Q7-referral-language production failure shape", () => {
    // Mirrors the actual field layout Solomon emitted when Q7 was the
    // customer-testimonial paste. The strategistBrief contains an
    // echoed `"honest guys"` fragment that broke strict parse.
    const src = `{
      "path": "needs-attention",
      "headline": "Cool Air HVAC",
      "opener": "You said customers call you "honest guys" — leverage that.",
      "gaps": [{"title":"lead concentration","impact":"35% from one builder","priority":"HIGH"}],
      "opportunities": [],
      "nextStepHeadline": "x",
      "nextStepBody": "y",
      "opportunityFlags": [],
      "strategistBrief": "Owner quoted a customer saying "trust us" verbatim.",
      "structured_findings": []
    }`;
    const out = parseAgentJson(src);
    assert.equal(out.opener, 'You said customers call you "honest guys" — leverage that.');
    assert.equal(out.strategistBrief, 'Owner quoted a customer saying "trust us" verbatim.');
    assert.equal(out.gaps[0].title, "lead concentration");
  });

  it("leaves already-escaped strings alone", () => {
    const src = '{"opener":"they said \\"trust us\\" to me"}';
    const out = parseAgentJson(src);
    assert.equal(out.opener, 'they said "trust us" to me');
  });

  it("does not false-positive on empty strings", () => {
    const src = '{"a":"","b":"ok"}';
    const out = parseAgentJson(src);
    assert.equal(out.a, "");
    assert.equal(out.b, "ok");
  });

  it("does not false-positive on adjacent key/value quotes", () => {
    const src = '{"a":"x","b":"y","c":"z"}';
    const out = parseAgentJson(src);
    assert.deepEqual(out, { a: "x", b: "y", c: "z" });
  });

  it("rethrows the ORIGINAL parse error when repair cannot fix it", () => {
    // Trailing comma + missing close brace is outside the class of
    // failures repair handles. parseAgentJson must still throw.
    const src = '{"a": 1,,';
    assert.throws(() => parseAgentJson(src), /JSON/);
  });

  it("throws cleanly when no JSON object is present", () => {
    assert.throws(() => parseAgentJson("not json at all"), /no JSON object/);
  });
});

describe("repairAgentJson — unit", () => {
  it("is a no-op on clean JSON", () => {
    const src = '{"a":"b","c":[1,2]}';
    assert.equal(repairAgentJson(src), src);
  });

  it("escapes a single unescaped inner quote", () => {
    const src = '{"a": "say "hi""}';
    // Repair should produce something JSON.parse accepts and whose
    // decoded value includes both inner quotes.
    const repaired = repairAgentJson(src);
    const parsed = JSON.parse(repaired);
    assert.equal(parsed.a, 'say "hi"');
  });
});
