import { attributeKeys } from '@machina/schemas';
import { listCandidates, listQueries, getApprovedFacts } from '@machina/database';
import { classifyGap } from './classifyGap';

export interface NormalizedRequirement {
  attribute: string;
  value: string;
}

export interface DetectedGap {
  product_id: string;
  attribute_key: string;
  gap_type: 'surface' | 'hard';
  matched_rule: string | null;
  demand_frequency: number;
  coverage: number;
  priority: number;
}

// Deterministic gap detection (§7/§8): buyer demand for attribute X — aggregated from BOTH
// the offline gap-mining query set (seed demand, bootstraps the loop before any real
// traffic exists) AND live search_products calls logged via request_log (§8's real agent
// demand) — AND the catalogue currently lacking an approved value for X on a given product
// => a gap for (product, X). No LLM judgment involved — this only reads data the LLM/MCP
// server already wrote earlier, it does not call the model itself. Scoped to one merchant
// and its vertical's ontology.
export function computeDemand(merchantId: string, vertical: string): Record<string, number> {
  const demand: Record<string, number> = {};
  for (const key of attributeKeys(vertical)) demand[key] = 0;

  const queries = listQueries(merchantId, 'gap_mining');
  for (const q of queries) {
    if (!q.normalized_requirement_json) continue;
    let reqs: NormalizedRequirement[] = [];
    try {
      reqs = JSON.parse(q.normalized_requirement_json);
    } catch {
      continue;
    }
    for (const r of reqs) {
      if (r.attribute in demand) demand[r.attribute] += 1;
    }
  }

  // v5 TODO: live demand from search_requests/ranking_impressions isn't aggregated into
  // this yet (the old request_log-based aggregateAttributeDemand() was retired along with
  // request_log) — gap-mining query-set demand still works, live-traffic demand is deferred.
  return demand;
}

export function computeCoverage(merchantId: string, vertical: string): Record<string, number> {
  const products = listCandidates(vertical, merchantId);
  const coverage: Record<string, number> = {};
  for (const key of attributeKeys(vertical)) {
    if (products.length === 0) {
      coverage[key] = 0;
      continue;
    }
    let covered = 0;
    for (const p of products) {
      const approved = getApprovedFacts(p.id);
      if (approved[key] && approved[key].value !== null) covered += 1;
    }
    coverage[key] = covered / products.length;
  }
  return coverage;
}

export function computeGaps(merchantId: string, vertical: string): DetectedGap[] {
  const demand = computeDemand(merchantId, vertical);
  const coverage = computeCoverage(merchantId, vertical);
  const products = listCandidates(vertical, merchantId);
  const gaps: DetectedGap[] = [];

  for (const key of attributeKeys(vertical)) {
    if (demand[key] <= 0) continue; // no buyer demand => not a gap worth acting on
    const priority = demand[key] * (1 - coverage[key]);
    for (const p of products) {
      const approved = getApprovedFacts(p.id);
      if (approved[key] && approved[key].value !== null) continue; // already covered
      const { gap_type, matched_rule } = classifyGap(p, key, vertical);
      gaps.push({
        product_id: p.id,
        attribute_key: key,
        gap_type,
        matched_rule,
        demand_frequency: demand[key],
        coverage: coverage[key],
        priority,
      });
    }
  }

  return gaps.sort((a, b) => b.priority - a.priority);
}
