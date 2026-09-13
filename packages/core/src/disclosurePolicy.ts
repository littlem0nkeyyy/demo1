import type { VisibilityTier, RequirementStatus } from '@machina/schemas';

// CONTROL (§3/§8): the one place disclosure decisions get made. Everything upstream of this
// module (evaluateRequirement, ranking, get_product_details' row fetch) is allowed to see and
// use the TRUE approved value — that's what "Machina can use more data for matching than it
// discloses" means. This module is only ever called once, right at the boundary where a tool
// response is built.

// AGENT_VISIBLE passes the true status through untouched. MATCHING_ONLY suppresses it to
// UNKNOWN even though the true comparison already happened and influenced ranking — showing
// "this matched" would itself leak the value for a small controlled vocabulary. INTERNAL_ONLY
// is excluded from matching before this point ever runs (see matchingCore.evaluateRequirement),
// so it never reaches here with anything but UNKNOWN anyway — handled the same way regardless,
// as defense in depth.
export function discloseRequirementStatus(visibility: VisibilityTier | undefined, trueStatus: RequirementStatus): RequirementStatus {
  if (visibility === 'AGENT_VISIBLE' || visibility === undefined) return trueStatus;
  return 'UNKNOWN';
}

// Whether an attribute's raw value/evidence may ever leave the boundary at all — used by
// get_product_details (omit the row entirely) and check_suitability (answer
// INSUFFICIENT_DATA instead of SUITABLE/NOT_SUITABLE).
export function isAgentVisible(visibility: VisibilityTier): boolean {
  return visibility === 'AGENT_VISIBLE';
}
