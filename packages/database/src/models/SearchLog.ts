import { getDb } from '../connection';

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export interface DecisionFactor {
  factor: 'match' | 'price' | 'delivery' | 'trust' | 'similarity';
  label: string;
  detail: string;
}

export interface SearchResultInput {
  product_id: string;
  merchant_id: string;
  merchant_offer_id: string | null;
  rank: number;
  match_status: string;
  requirement_results: unknown;
  matched_attributes: Record<string, string>;
  unknown_attributes: string[];
  decision_factors: DecisionFactor[];
  badge: string | null;
  reasoning_text: string | null;
}

export interface ImpressionInput {
  product_id: string;
  merchant_id: string;
  verified_match_count: number;
  requirement_pass: unknown;
  price_amount: number | null;
  price_percentile: number | null;
  delivery_days_min: number | null;
  trust_score: number | null;
  review_count: number | null;
  semantic_similarity: number | null;
  utility_score: number | null;
  final_rank: number | null;
  was_returned: boolean;
  diversity_capped: boolean;
}

// One search_requests row per call, one search_results row per returned product, and one
// ranking_impressions row per candidate that survived hard filters (returned or not) — the
// full feature log a future LambdaMART pass would train on. All insert-only.
export function logSearch(input: {
  request_text: string;
  normalized_intent: unknown;
  hard_filters: unknown;
  preferred_requirements: unknown;
  result_status: string;
  client_name: string;
  results: SearchResultInput[];
  impressions: ImpressionInput[];
}): string {
  const db = getDb();
  const requestId = nextId('REQ');
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO search_requests (id, request_text, normalized_intent_json, hard_filters_json, preferred_requirements_json, result_status, client_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(
      requestId,
      input.request_text,
      JSON.stringify(input.normalized_intent),
      JSON.stringify(input.hard_filters),
      JSON.stringify(input.preferred_requirements),
      input.result_status,
      input.client_name
    );

    for (const r of input.results) {
      db.prepare(
        `INSERT INTO search_results
          (id, search_request_id, product_id, merchant_offer_id, rank, score_json, match_status,
           requirement_results_json, matched_keywords_json, matched_attributes_json, unknown_attributes_json,
           reasons_json, decision_factors_json, badge, reasoning_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        nextId('RESULT'),
        requestId,
        r.product_id,
        r.merchant_offer_id,
        r.rank,
        JSON.stringify({}),
        r.match_status,
        JSON.stringify(r.requirement_results),
        JSON.stringify(Object.keys(r.matched_attributes)),
        JSON.stringify(r.matched_attributes),
        JSON.stringify(r.unknown_attributes),
        JSON.stringify(r.decision_factors.map((f) => f.detail)),
        JSON.stringify(r.decision_factors),
        r.badge,
        r.reasoning_text
      );
    }

    for (const imp of input.impressions) {
      db.prepare(
        `INSERT INTO ranking_impressions
          (search_request_id, product_id, merchant_id, verified_match_count, requirement_pass_json,
           price_amount, price_percentile, delivery_days_min, trust_score, review_count,
           semantic_similarity, utility_score, final_rank, was_returned, diversity_capped)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        requestId,
        imp.product_id,
        imp.merchant_id,
        imp.verified_match_count,
        JSON.stringify(imp.requirement_pass),
        imp.price_amount,
        imp.price_percentile,
        imp.delivery_days_min,
        imp.trust_score,
        imp.review_count,
        imp.semantic_similarity,
        imp.utility_score,
        imp.final_rank,
        imp.was_returned ? 1 : 0,
        imp.diversity_capped ? 1 : 0
      );
    }
  });
  tx();
  return requestId;
}

// Live-traffic demand aggregation, scoped to a vertical's merchants — the v6 replacement
// for the old request_log-based aggregateAttributeDemand(). "Requested" counts each real
// search call once per attribute it extracted (from search_requests.normalized_intent_json,
// not ranking_impressions, to avoid inflating counts by candidate-pool size). "Unmet" counts
// how often that attribute wasn't a confirmed match on the top RETURNED result for that
// search — a rough, honest proxy for "buyers asked, Machina couldn't confirm."
export function aggregateAttributeDemand(merchantIds: string[]): { requested: Record<string, number>; unmet: Record<string, number> } {
  if (merchantIds.length === 0) return { requested: {}, unmet: {} };
  const db = getDb();
  const placeholders = merchantIds.map(() => '?').join(',');
  const requests = db
    .prepare(
      `SELECT DISTINCT sr.id AS search_request_id, sr.normalized_intent_json
       FROM search_requests sr
       JOIN ranking_impressions ri ON ri.search_request_id = sr.id
       WHERE ri.merchant_id IN (${placeholders})`
    )
    .all(...merchantIds) as { search_request_id: string; normalized_intent_json: string }[];

  const requested: Record<string, number> = {};
  const unmet: Record<string, number> = {};
  const topImpressionStmt = db.prepare(
    `SELECT requirement_pass_json FROM ranking_impressions WHERE search_request_id = ? AND was_returned = 1 ORDER BY final_rank ASC LIMIT 1`
  );

  for (const row of requests) {
    let attributeKeys: string[] = [];
    try {
      attributeKeys = Object.keys(JSON.parse(row.normalized_intent_json).attributes ?? {});
    } catch {
      continue;
    }
    for (const key of attributeKeys) requested[key] = (requested[key] ?? 0) + 1;

    const top = topImpressionStmt.get(row.search_request_id) as { requirement_pass_json: string } | undefined;
    if (!top) continue;
    let pass: { attribute: string; status: string }[] = [];
    try {
      pass = JSON.parse(top.requirement_pass_json);
    } catch {
      continue;
    }
    for (const p of pass) {
      if (attributeKeys.includes(p.attribute) && p.status !== 'VERIFIED_MATCH') unmet[p.attribute] = (unmet[p.attribute] ?? 0) + 1;
    }
  }

  return { requested, unmet };
}

export function countSearchRequests(merchantIds: string[]): number {
  if (merchantIds.length === 0) return 0;
  const db = getDb();
  const placeholders = merchantIds.map(() => '?').join(',');
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT sr.id) AS n FROM search_requests sr
       JOIN ranking_impressions ri ON ri.search_request_id = sr.id
       WHERE ri.merchant_id IN (${placeholders})`
    )
    .get(...merchantIds) as { n: number };
  return row.n;
}

// Links a later tool call to a recent impression of the same product, for a future
// click/conversion label. Best-effort: if no recent impression exists (the buyer asked
// about a product cold, never having searched for it), logs nothing.
export function logAction(productId: string, actionType: 'view_details' | 'check_suitability' | 'create_offer'): void {
  const db = getDb();
  const impression = db
    .prepare(`SELECT id FROM ranking_impressions WHERE product_id = ? ORDER BY id DESC LIMIT 1`)
    .get(productId) as { id: number } | undefined;
  if (!impression) return;
  db.prepare(`INSERT INTO ranking_actions (ranking_impression_id, action_type) VALUES (?, ?)`).run(impression.id, actionType);
}
