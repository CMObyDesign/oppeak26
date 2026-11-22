// Which contacts have a BGA case (src/bga_copilot/bga_case.js): funnel buyers and staff-started
// BGAs. approve-and-send must stay funnel-only.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isBgaCase, BGA_CASE_TAGS } from "../src/bga_copilot/bga_case.js";

describe("isBgaCase", () => {
  it("accepts the funnel tag and the staff tag, nothing else", () => {
    assert.equal(isBgaCase(["swot_paid_297"]), true);
    assert.equal(isBgaCase(["bga_staff_case"]), true);
    assert.equal(isBgaCase(["swot_paid_47", "swot_free_lead"]), false);
    assert.equal(isBgaCase([]), false);
    assert.equal(isBgaCase(undefined), false);
    assert.deepEqual(BGA_CASE_TAGS, ["swot_paid_297", "bga_staff_case"]);
  });

  it("approve-and-send still requires the funnel tag (it fires the SWOT Email 04 workflow)", () => {
    const src = readFileSync(new URL("../src/bga_copilot/approve_and_send.js", import.meta.url), "utf8");
    assert.match(src, /!tags\.includes\(PAID_297_TAG\)/);
    assert.doesNotMatch(src, /isBgaCase|bga_staff_case/);
  });

  it("the console hides Approve & Send for staff-started cases (it would always fail)", () => {
    const page = readFileSync(new URL("../src/bga_copilot/case_view_page.js", import.meta.url), "utf8");
    const fn = page.slice(page.indexOf("function renderApproveAndSend(bundle)"));
    const staffBranch = fn.slice(0, fn.indexOf("return;\n  }"));
    assert.match(staffBranch, /case_source === "staff"/);
    assert.doesNotMatch(staffBranch, /approve-send-btn/);
    assert.match(fn, /id="approve-send-btn"/);
  });
});
