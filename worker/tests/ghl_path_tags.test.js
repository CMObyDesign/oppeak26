// GHL path-tag compatibility (Codex P1 on PR #75).
//
// Rubric v3 narrowed the customer-facing path enum from five values
// to three ("rehab" | "needs-attention" | "growth"). Live GHL
// workflows still trigger on the pre-v3 tag set:
//   swot_path_rehab, swot_path_urgent, swot_path_growth, swot_path_strong
//
// Emitting only the new tags would break every HL automation bound
// to swot_path_urgent (the historical bucket now folded into
// needs-attention). The compat strategy: emit BOTH tags for
// needs-attention. Solomon's classification logic doesn't know
// about the legacy tag — it's an integration adapter.
//
// Pin:
//   - needs-attention emits swot_path_needs-attention AND
//     swot_path_urgent (legacy compat).
//   - rehab emits only swot_path_rehab (unchanged).
//   - growth emits only swot_path_growth (unchanged; "strong" is
//     folded into growth, no legacy tag needed).
//   - Legacy classifications (if a historical report has one) still
//     pass through unchanged.
//   - A null / empty path emits no tags.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// pathTags is intentionally module-private — exercised via the
// classifications it emits for each known customer-facing value and
// legacy value. Importing the public shape instead of poking at the
// helper keeps the test honest to the contract.
import { pathTags } from "../src/index.js";

describe("pathTags — GHL compat emission", () => {
  it("rehab emits only swot_path_rehab", () => {
    assert.deepEqual(pathTags("rehab"), ["swot_path_rehab"]);
  });

  it("needs-attention emits BOTH swot_path_needs-attention AND swot_path_urgent (legacy compat)", () => {
    const tags = pathTags("needs-attention");
    assert.ok(tags.includes("swot_path_needs-attention"),
      "canonical tag must be emitted");
    assert.ok(tags.includes("swot_path_urgent"),
      "legacy tag must be emitted so pre-v3 HL workflows keep firing");
    assert.equal(tags.length, 2);
  });

  it("growth emits only swot_path_growth (no legacy tag — 'strong' folds into growth without needing an adapter)", () => {
    assert.deepEqual(pathTags("growth"), ["swot_path_growth"]);
  });

  it("legacy 'urgent' (historical reports stored in D1) still emits swot_path_urgent", () => {
    assert.deepEqual(pathTags("urgent"), ["swot_path_urgent"]);
  });

  it("legacy 'strong' (historical) still emits swot_path_strong", () => {
    assert.deepEqual(pathTags("strong"), ["swot_path_strong"]);
  });

  it("empty / null / undefined path emits no tags", () => {
    assert.deepEqual(pathTags(""), []);
    assert.deepEqual(pathTags(null), []);
    assert.deepEqual(pathTags(undefined), []);
  });

  it("uppercase / mixed-case input is normalized to lowercase before emission", () => {
    assert.deepEqual(pathTags("Rehab"), ["swot_path_rehab"]);
    assert.deepEqual(pathTags("NEEDS-ATTENTION"),
      ["swot_path_needs-attention", "swot_path_urgent"]);
  });
});
