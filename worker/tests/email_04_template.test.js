// Email 04 (Deep Dive Part 2 / Growth Plan Delivery) template shape test.
//
// PR 11 adds two new merge fields to Email 04:
//   - {{contact.swot_bga_next_steps}}            → "What you committed to on the call"
//   - {{contact.swot_bga_services_selected_display}} → "Services you selected"
// These fields are written by the APPROVE & SEND button (PR 12) in the
// same PUT that writes swot_growth_plan, immediately before the ready
// tag fires Email 04. If the template drops either merge tag, the
// customer email loses that section — a quiet, high-blast-radius
// regression — so this test pins the three required merge fields.
//
// Also pins that both tracked copies of the template stay in sync:
//   - email-templates/04_deep_dive_part2.html  (canonical)
//   - app/public/email-preview/04_deep_dive_part2.html  (preview)
// (`app/dist/*` is a build artifact and git-ignored, so not tested here.)
//
// Spec: BGA_COPILOT_SPEC.md §4 (toolkit table), §5.2 (approve-and-send
// writes all three fields in one PUT), §11 row 11.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

const PATHS = [
  "email-templates/04_deep_dive_part2.html",
  "app/public/email-preview/04_deep_dive_part2.html",
];

const REQUIRED_MERGE_FIELDS = [
  "{{contact.first_name}}",
  "{{contact.swot_growth_plan}}",
  "{{contact.swot_bga_next_steps}}",
  "{{contact.swot_bga_services_selected_display}}",
];

function readTemplate(relPath) {
  return readFileSync(resolve(repoRoot, relPath), "utf8");
}

describe("Email 04 — Deep Dive Part 2 template (PR 11)", () => {
  for (const relPath of PATHS) {
    describe(relPath, () => {
      it("contains all three BGA merge fields", () => {
        const html = readTemplate(relPath);
        for (const tag of REQUIRED_MERGE_FIELDS) {
          assert.ok(
            html.includes(tag),
            `${relPath} is missing required merge tag ${tag}`,
          );
        }
      });

      it("renders the Growth Plan block BEFORE the next-steps and services blocks", () => {
        // Ordering: a reader sees the plan first, then what they
        // committed to on the call, then which services they selected.
        const html = readTemplate(relPath);
        const planIdx = html.indexOf("{{contact.swot_growth_plan}}");
        const nextStepsIdx = html.indexOf("{{contact.swot_bga_next_steps}}");
        const servicesIdx = html.indexOf("{{contact.swot_bga_services_selected_display}}");
        assert.ok(planIdx !== -1 && nextStepsIdx !== -1 && servicesIdx !== -1);
        assert.ok(planIdx < nextStepsIdx, "growth plan must appear before next-steps");
        assert.ok(nextStepsIdx < servicesIdx, "next-steps must appear before services-selected");
      });

      it("each of the new blocks has a visible section header", () => {
        // The two new blocks must be labeled so a customer can tell
        // what they're reading — a bare merge-field drop with no
        // header would read as a context-free paragraph if the field
        // ever contains plain prose.
        const html = readTemplate(relPath);
        assert.ok(
          html.includes("WHAT YOU COMMITTED TO ON THE CALL"),
          "next-steps block missing its header",
        );
        assert.ok(
          html.includes("SERVICES YOU SELECTED"),
          "services-selected block missing its header",
        );
      });
    });
  }

  it("canonical template and preview mirrors are byte-identical", () => {
    const canonical = readTemplate(PATHS[0]);
    for (let i = 1; i < PATHS.length; i++) {
      const mirror = readTemplate(PATHS[i]);
      assert.equal(
        mirror,
        canonical,
        `${PATHS[i]} drifted from canonical ${PATHS[0]}`,
      );
    }
  });
});
