import type { RequirementStatus, MatchStatus, RequestStatus, VisibilityTier } from '@machina/schemas';

export interface Requirement {
  attribute: string;
  value: string;
}

export interface ApprovedAttributeMap {
  [attribute: string]: { value: string | null; visibility: VisibilityTier } | undefined;
}

export interface RequirementResult {
  attribute: string;
  requested_value: string;
  status: RequirementStatus;
}

// Pure, deterministic, no I/O — the actual §4/§5/§12 comparison rule, computed against the
// TRUE approved value regardless of its disclosure tier — CONTROL only decides what gets
// reported later (see disclosurePolicy.ts), never what Machina itself compares against.
// The one exception is INTERNAL_ONLY, which per §3/§8 is excluded from matching entirely
// (never even used internally) — the doc's own example never lists cost/margin/supplier
// among the fields used for matching at all, so it's treated exactly like no data.
// UNKNOWN (no usable evidence either way) is deliberately distinct from VERIFIED_NON_MATCH
// (evidenced disagreement) — collapsing them would misrepresent what Machina actually knows.
export function evaluateRequirement(approved: ApprovedAttributeMap, requirement: Requirement): RequirementResult {
  const entry = approved[requirement.attribute];
  let status: RequirementStatus;
  if (!entry || entry.value === null || entry.visibility === 'INTERNAL_ONLY') status = 'UNKNOWN';
  else if (entry.value === requirement.value) status = 'VERIFIED_MATCH';
  else status = 'VERIFIED_NON_MATCH';
  return { attribute: requirement.attribute, requested_value: requirement.value, status };
}

// A verified non-match is a real, evidenced disqualification — not just missing data.
export function hasVerifiedNonMatch(results: RequirementResult[]): boolean {
  return results.some((r) => r.status === 'VERIFIED_NON_MATCH');
}

export function countVerifiedMatches(results: RequirementResult[]): number {
  return results.filter((r) => r.status === 'VERIFIED_MATCH').length;
}

export function isEligibleOffer(candidate: {
  availability: string;
  stock_quantity: number | null;
  shipping_available: number;
}): boolean {
  return candidate.availability !== 'out_of_stock'
    && candidate.availability !== 'discontinued'
    && (candidate.stock_quantity === null || candidate.stock_quantity > 0)
    && candidate.shipping_available === 1;
}

// Deterministic ranking comparator: verified-match count is always the primary key:
// semantic similarity is a tiebreak only, never the primary signal (§12).
export function compareCandidates(
  a: { verifiedCount: number; similarity: number },
  b: { verifiedCount: number; similarity: number }
): number {
  return b.verifiedCount - a.verifiedCount || b.similarity - a.similarity;
}

// ---------------------------------------------------------------------------
// v5 cross-merchant ranking: Stage B (secondary, within a verifiedCount bucket) — a
// deterministic multi-objective utility blending relevance/price/trust/fulfillment. Never
// the primary key (verifiedCount always wins first, via compareCandidates' bucketing
// logic reused as compareByUtility's first term) — a materially better requirement match
// always outranks a cheaper/faster one. No LLM anywhere in this file.
// ---------------------------------------------------------------------------

export interface UtilityWeights {
  relevance: number;
  price: number;
  trust: number;
  fulfillment: number;
}

// Cold-start defaults from scoring_stategy.md. Stage A still guarantees that a candidate
// with more verified requirement matches wins before this Stage-B score is considered.
export const DEFAULT_UTILITY_WEIGHTS: UtilityWeights = {
  relevance: 0.4,
  price: 0.25,
  trust: 0.2,
  fulfillment: 0.15,
};

export const DEFAULT_RELEVANCE_WEIGHTS = { attributes: 0.6, semantic: 0.4 } as const;
export const DEFAULT_FULFILLMENT_WEIGHTS = { delivery: 0.7, shippingFee: 0.3 } as const;

export interface UtilityCandidate {
  price_amount: number;
  shipping_fee: number | null;
  estimated_days_min: number;
  estimated_days_max: number;
  average_rating: number;
  review_count: number;
  verifiedCount: number;
  requirementCount: number;
  similarity: number;
}

export interface PoolStats {
  minPrice: number;
  maxPrice: number;
  minDelivery: number;
  maxDelivery: number;
  minShippingFee: number;
  maxShippingFee: number;
}

function deliveryEstimate(candidate: Pick<UtilityCandidate, 'estimated_days_min' | 'estimated_days_max'>): number {
  return (candidate.estimated_days_min + candidate.estimated_days_max) / 2;
}

export function computePoolStats(
  candidates: Pick<UtilityCandidate, 'price_amount' | 'shipping_fee' | 'estimated_days_min' | 'estimated_days_max'>[]
): PoolStats {
  const prices = candidates.map((c) => c.price_amount);
  const deliveries = candidates.map(deliveryEstimate);
  const shippingFees = candidates.flatMap((c) => (c.shipping_fee === null ? [] : [c.shipping_fee]));
  return {
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
    minDelivery: Math.min(...deliveries),
    maxDelivery: Math.max(...deliveries),
    minShippingFee: shippingFees.length === 0 ? 0 : Math.min(...shippingFees),
    maxShippingFee: shippingFees.length === 0 ? 0 : Math.max(...shippingFees),
  };
}

function normalizeInverse(value: number, min: number, max: number): number {
  // lower value -> higher score. A pool with a single price/delivery point scores neutral.
  if (max === min) return 0.5;
  return 1 - (value - min) / (max - min);
}

// Demo-backed trust = product rating (0-5, normalized 0-1) weighted by log(review_count),
// so a 5.0 with 2 reviews doesn't outrank a 4.5 with 500 — a real, if simple, Bayesian-flavoured trust
// signal rather than the raw average.
function trustScore(rating: number, reviewCount: number): number {
  const ratingNorm = Math.max(0, Math.min(1, rating / 5));
  const confidence = Math.min(1, Math.log10(Math.max(0, reviewCount) + 1) / 3); // saturates around ~1000 reviews
  return ratingNorm * (0.5 + 0.5 * confidence);
}

export function computeRelevance(candidate: Pick<UtilityCandidate, 'verifiedCount' | 'requirementCount' | 'similarity'>): number {
  const attributeScore = candidate.requirementCount === 0
    ? 0
    : Math.max(0, Math.min(1, candidate.verifiedCount / candidate.requirementCount));
  const semanticScore = Math.max(0, Math.min(1, candidate.similarity));
  return DEFAULT_RELEVANCE_WEIGHTS.attributes * attributeScore
    + DEFAULT_RELEVANCE_WEIGHTS.semantic * semanticScore;
}

export interface UtilityBreakdown {
  relevance: number;
  price: number;
  trust: number;
  fulfillment: number;
  utility: number;
}

export function computeUtilityBreakdown(
  candidate: UtilityCandidate,
  pool: PoolStats,
  weights: UtilityWeights = DEFAULT_UTILITY_WEIGHTS
): UtilityBreakdown {
  const relevance = computeRelevance(candidate);
  const priceScore = normalizeInverse(candidate.price_amount, pool.minPrice, pool.maxPrice);
  const deliveryScore = normalizeInverse(deliveryEstimate(candidate), pool.minDelivery, pool.maxDelivery);
  // A missing fee is unknown, not free, so it receives the neutral midpoint.
  const shippingFeeScore = candidate.shipping_fee === null
    ? 0.5
    : normalizeInverse(candidate.shipping_fee, pool.minShippingFee, pool.maxShippingFee);
  const fulfillment = DEFAULT_FULFILLMENT_WEIGHTS.delivery * deliveryScore
    + DEFAULT_FULFILLMENT_WEIGHTS.shippingFee * shippingFeeScore;
  const trust = trustScore(candidate.average_rating, candidate.review_count);
  const utility = weights.relevance * relevance
    + weights.price * priceScore
    + weights.trust * trust
    + weights.fulfillment * fulfillment;
  return { relevance, price: priceScore, trust, fulfillment, utility };
}

export function computeUtility(candidate: UtilityCandidate, pool: PoolStats, weights: UtilityWeights = DEFAULT_UTILITY_WEIGHTS): number {
  return computeUtilityBreakdown(candidate, pool, weights).utility;
}

// Stage A (verifiedCount, descending) then Stage B (utility, descending) — never blended
// into one number, so a better requirement match can never be out-ranked by a cheaper one.
export function compareByUtility(a: { verifiedCount: number; utility: number }, b: { verifiedCount: number; utility: number }): number {
  return b.verifiedCount - a.verifiedCount || b.utility - a.utility;
}

// ---------------------------------------------------------------------------
// Merchant diversity: greedy re-rank over an already Stage-A/Stage-B-sorted list. Fully
// deterministic, no randomness — walks the list once, taking the next-best item whose
// merchant hasn't hit `cap` selections yet; only relaxes the cap on a second pass if the
// result set would otherwise come up short of maxResults.
// ---------------------------------------------------------------------------
export function applyMerchantDiversity<T extends { merchant_id: string }>(
  ranked: T[],
  cap: number,
  maxResults: number
): { selected: T[]; diversityCapped: Set<T> } {
  const counts = new Map<string, number>();
  const selected: T[] = [];
  const skipped: T[] = [];
  const diversityCapped = new Set<T>();

  for (const item of ranked) {
    if (selected.length >= maxResults) break;
    const count = counts.get(item.merchant_id) ?? 0;
    if (count < cap) {
      selected.push(item);
      counts.set(item.merchant_id, count + 1);
    } else {
      skipped.push(item);
      diversityCapped.add(item);
    }
  }
  // Backfill from skipped (still in ranked order) if the cap left us short — a small pool
  // shouldn't return fewer results than requested just to satisfy diversity.
  for (const item of skipped) {
    if (selected.length >= maxResults) break;
    selected.push(item);
  }
  return { selected, diversityCapped };
}

// ---------------------------------------------------------------------------
// Grounded decision factors + badge — still deterministic, still no LLM. CONTROL rule:
// a MATCHING_ONLY-driven requirement match is omitted from decision_factors entirely (not
// redacted — absent), even though it already influenced verifiedCount/bucket placement.
// ---------------------------------------------------------------------------

export interface DecisionFactor {
  factor: 'match' | 'price' | 'delivery' | 'trust' | 'similarity';
  label: string;
  detail: string;
}

export function buildDecisionFactors(
  disclosedReqResults: { attribute: string; requested_value: string; status: string }[],
  candidate: Pick<UtilityCandidate, 'price_amount' | 'shipping_fee' | 'estimated_days_min' | 'estimated_days_max' | 'average_rating' | 'review_count'> & { currency: string },
  pool: PoolStats
): DecisionFactor[] {
  const factors: DecisionFactor[] = [];
  for (const r of disclosedReqResults) {
    if (r.status === 'VERIFIED_MATCH') {
      factors.push({ factor: 'match', label: r.attribute, detail: `${r.attribute} matches ${r.requested_value}` });
    }
  }
  if (candidate.price_amount === pool.minPrice) {
    factors.push({ factor: 'price', label: 'lowest_price', detail: `Lowest price in this comparison at ${candidate.price_amount} ${candidate.currency}` });
  }
  if (deliveryEstimate(candidate) === pool.minDelivery) {
    factors.push({
      factor: 'delivery',
      label: 'fastest_delivery',
      detail: `Fastest estimated delivery window at ${candidate.estimated_days_min}-${candidate.estimated_days_max} days`,
    });
  }
  if (candidate.shipping_fee !== null && candidate.shipping_fee === pool.minShippingFee) {
    factors.push({
      factor: 'delivery',
      label: 'lowest_shipping_fee',
      detail: `Lowest shipping fee in this comparison at ${candidate.shipping_fee} ${candidate.currency}`,
    });
  }
  if (candidate.average_rating >= 4.5 && candidate.review_count >= 20) {
    factors.push({ factor: 'trust', label: 'highly_rated', detail: `Rated ${candidate.average_rating} from ${candidate.review_count} reviews` });
  }
  return factors;
}

export type Badge = 'best_overall' | 'lowest_price' | 'fastest_delivery' | null;

// Fixed priority so exactly one badge is ever assigned per product: best_overall (the #1
// utility-ranked finalist) wins over the narrower lowest_price/fastest_delivery badges even
// when it also qualifies for those.
export function assignBadges<T extends { price_amount: number; estimated_days_min: number; estimated_days_max: number }>(
  finalists: T[]
): Map<T, Badge> {
  const badges = new Map<T, Badge>();
  if (finalists.length === 0) return badges;
  const minPrice = Math.min(...finalists.map((f) => f.price_amount));
  const minDelivery = Math.min(...finalists.map(deliveryEstimate));
  finalists.forEach((f, i) => {
    if (i === 0) badges.set(f, 'best_overall');
    else if (f.price_amount === minPrice) badges.set(f, 'lowest_price');
    else if (deliveryEstimate(f) === minDelivery) badges.set(f, 'fastest_delivery');
    else badges.set(f, null);
  });
  return badges;
}

// §5 per-product roll-up: every requirement verified -> VERIFIED; a mix of
// VERIFIED_MATCH/UNKNOWN -> PARTIAL. (VERIFIED_NON_MATCH candidates are excluded upstream,
// before this is ever called.)
export function deriveMatchStatus(results: RequirementResult[]): MatchStatus {
  return results.every((r) => r.status === 'VERIFIED_MATCH') ? 'VERIFIED' : 'PARTIAL';
}

// §5 request-level roll-up.
export function deriveTopLevelStatus(
  matchStatuses: MatchStatus[],
  anyVerifiedMatchAnywhere: boolean,
  requirementCount: number
): RequestStatus {
  if (!anyVerifiedMatchAnywhere && requirementCount > 0) return 'INSUFFICIENT_DATA';
  if (matchStatuses.some((s) => s === 'VERIFIED')) return 'VERIFIED';
  return 'PARTIAL';
}
