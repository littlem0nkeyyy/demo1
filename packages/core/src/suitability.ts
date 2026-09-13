import { getCandidate, getApprovedFactsWithProvenance, logAction } from '@machina/database';
import type { CheckSuitabilityInput, CheckSuitabilityOutput } from '@machina/schemas';
import { isAgentVisible } from './disclosurePolicy';
import { belongsToScope, type ProductDetailsContext } from './productDetails';

// check_suitability (§6): a single product, a single requirement, an honest answer.
// Multi-tenant boundary: refuses to answer for a product outside this connection's scope,
// treated identically to an unknown id. CONTROL: anything not AGENT_VISIBLE answers
// INSUFFICIENT_DATA regardless of what Machina actually knows internally — a
// single-attribute suitability check is itself a strong disclosure.
export function checkSuitability(input: CheckSuitabilityInput, ctx: ProductDetailsContext): CheckSuitabilityOutput {
  const product = getCandidate(input.product_id);
  if (!product || !belongsToScope(product.merchant_id, ctx)) {
    return { result: 'INSUFFICIENT_DATA', evidence_text: null };
  }
  logAction(product.id, 'check_suitability');
  const rows = getApprovedFactsWithProvenance(input.product_id);
  const row = rows.find((r) => r.attribute === input.attribute);
  if (!row || row.value === null || !isAgentVisible(row.visibility)) {
    return { result: 'INSUFFICIENT_DATA', evidence_text: null };
  }
  if (row.value === input.requested_value) {
    return { result: 'SUITABLE', evidence_text: row.evidence_text };
  }
  return { result: 'NOT_SUITABLE', evidence_text: row.evidence_text };
}
