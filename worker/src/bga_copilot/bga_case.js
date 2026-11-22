// Which contacts have a BGA case the copilot tools may work on.
//
// Two ways in, one standard:
//   - swot_paid_297: bought the $297 BGA through the SWOT funnel.
//   - bga_staff_case: the CFO by Design team started a BGA for an existing client or a lead
//     from the CFO Portal, outside the funnel (Liz, Nov 22, 2026). No workflow listens to it.
//
// approve-and-send stays funnel-only (it applies swot_growth_plan_ready, which fires the SWOT
// Email 04 workflow) and the catalog backfill stays scoped to the paid cohort. Staff-started
// BGAs are delivered through the CFO Portal instead.

export const PAID_297_TAG = "swot_paid_297";
export const STAFF_CASE_TAG = "bga_staff_case";
export const BGA_CASE_TAGS = [PAID_297_TAG, STAFF_CASE_TAG];

export function isBgaCase(tags) {
  return Array.isArray(tags) && BGA_CASE_TAGS.some((t) => tags.includes(t));
}

export const NOT_A_BGA_CASE = `contact has no BGA case (tagged neither ${PAID_297_TAG} nor ${STAFF_CASE_TAG})`;
