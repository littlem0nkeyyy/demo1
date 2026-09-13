import { listCandidates, getApprovedFacts, logSearch, type CatalogueEntry } from '@machina/database';
import { attributeKeys } from '@machina/schemas';
import type { SearchProductsInput, SearchProductsOutput } from '@machina/schemas';
import { normalizeBuyerLanguage } from './llm/normalizeBuyerLanguage';
import { embedTexts, cosineSimilarity } from './embeddings';
import { renderProductText } from './renderProductText';
import { discloseRequirementStatus } from './disclosurePolicy';
import { generateReason, deterministicFallback } from './llm/generateReason';
import { classifyVertical } from './llm/classifyVertical';
import {
  evaluateRequirement,
  hasVerifiedNonMatch,
  countVerifiedMatches,
  computePoolStats,
  computeUtilityBreakdown,
  compareByUtility,
  applyMerchantDiversity,
  buildDecisionFactors,
  assignBadges,
  isEligibleOffer,
} from './matchingCore';

export interface SearchProductsContext {
  source: string;
  vertical?: string; // fixed only for a vertical- or merchant-narrowed connection
  merchantId?: string; // legacy narrowed scope — optional, not the default
}

const MERCHANT_DIVERSITY_CAP = 2;

// v6: the whole-database default connection has no fixed vertical, so the very first step
// is figuring out which one this request is about — see classifyVertical.ts. A vertical- or
// merchant-scoped connection already knows its vertical and skips this entirely, exactly as
// v5 did.
async function resolveVertical(ctx: SearchProductsContext, requestText: string): Promise<{ vertical: string } | { question: string }> {
  if (ctx.vertical) return { vertical: ctx.vertical };
  const result = await classifyVertical(requestText);
  if (!result.vertical) return { question: result.question ?? 'Could you tell me what kind of product you\'re looking for?' };
  return { vertical: result.vertical };
}

// v5/v6 cross-merchant pipeline (see the approved plans for the full rationale): classify
// vertical (only if unscoped) -> unified normalization -> hard filters -> hybrid candidate
// retrieval -> deterministic multi-objective utility ranking (Stage A verifiedCount, Stage B
// utility) -> merchant diversity -> grounded decision_factors + badge (still deterministic)
// -> LLM verbalization only. No LLM decides ranking, ever.
export async function searchProducts(input: SearchProductsInput, ctx: SearchProductsContext): Promise<SearchProductsOutput> {
  const filters = input.filters ?? {};
  const hasFilters = Object.values(filters).some((v) => v !== undefined) || !!input.merchant_id;

  const resolved = await resolveVertical(ctx, input.request_text);
  if ('question' in resolved) {
    logSearch({
      request_text: input.request_text,
      normalized_intent: { attributes: {} },
      hard_filters: filters,
      preferred_requirements: {},
      result_status: 'CLARIFICATION_REQUIRED',
      client_name: input.client?.name ?? ctx.source,
      results: [],
      impressions: [],
    });
    return { status: 'CLARIFICATION_REQUIRED', clarification_question: resolved.question, products: [] };
  }
  const vertical = resolved.vertical;

  const requirements = await normalizeBuyerLanguage(input.request_text, vertical);

  if (requirements.length === 0 && !hasFilters) {
    const question = `Could you tell me a bit more about what you need — for example ${attributeKeys(vertical).join(', ')}, or a price range?`;
    logSearch({
      request_text: input.request_text,
      normalized_intent: { attributes: {} },
      hard_filters: filters,
      preferred_requirements: {},
      result_status: 'CLARIFICATION_REQUIRED',
      client_name: input.client?.name ?? ctx.source,
      results: [],
      impressions: [],
    });
    return { status: 'CLARIFICATION_REQUIRED', clarification_question: question, products: [] };
  }

  // Step 2: hard filters, over the cross-merchant candidate pool (or the legacy narrowed
  // merchant scope, or a per-call merchant_id filter within a vertical-scoped connection).
  let candidates = listCandidates(vertical, ctx.merchantId);
  if (input.merchant_id) candidates = candidates.filter((c) => c.merchant_id === input.merchant_id);
  // The demo data has explicit offer state, stock and shipping availability. These are
  // eligibility constraints, never soft scoring signals.
  candidates = candidates.filter(isEligibleOffer);
  if (filters.price_max !== undefined) candidates = candidates.filter((c) => c.price_amount <= filters.price_max!);
  if (filters.currency !== undefined) candidates = candidates.filter((c) => c.currency === filters.currency);
  if (filters.availability !== undefined) candidates = candidates.filter((c) => c.availability === filters.availability);
  if (filters.delivery_days_max !== undefined) {
    candidates = candidates.filter((c) => c.estimated_days_max <= filters.delivery_days_max!);
  }

  if (candidates.length === 0) {
    logSearch({
      request_text: input.request_text,
      normalized_intent: { attributes: Object.fromEntries(requirements.map((r) => [r.attribute, r.value])) },
      hard_filters: filters,
      preferred_requirements: {},
      result_status: 'NO_MATCH',
      client_name: input.client?.name ?? ctx.source,
      results: [],
      impressions: [],
    });
    return { status: 'NO_MATCH', products: [] };
  }

  // The demo has no FX rates. Never normalize incomparable amounts as if they shared a
  // currency; ask the caller to choose instead. (The committed dataset is AUD-only today,
  // but this keeps future seed additions safe.)
  const currencies = [...new Set(candidates.map((c) => c.currency))];
  if (currencies.length > 1) {
    const question = `Which currency should I use? Available currencies are ${currencies.sort().join(', ')}.`;
    logSearch({
      request_text: input.request_text,
      normalized_intent: { attributes: Object.fromEntries(requirements.map((r) => [r.attribute, r.value])) },
      hard_filters: filters,
      preferred_requirements: {},
      result_status: 'CLARIFICATION_REQUIRED',
      client_name: input.client?.name ?? ctx.source,
      results: [],
      impressions: [],
    });
    return { status: 'CLARIFICATION_REQUIRED', clarification_question: question, products: [] };
  }

  // Step 3: hybrid candidate retrieval. Structured survivors first (TRUE state, all tiers
  // except INTERNAL_ONLY per evaluateRequirement) — a verified non-match is a real,
  // evidenced disqualification. The remaining survivor pool is then embedded alongside the
  // request text, so semantic similarity (the "hybrid" half) feeds Stage B for every
  // structurally-eligible candidate rather than only a pre-filtered top-N — the candidate
  // pools here are small enough (tens to low hundreds) that a separate ANN pre-filter would
  // add complexity without changing the result.
  const evaluated = candidates.map((product) => {
    const approved = getApprovedFacts(product.id);
    const trueReqResults = requirements.map((r) => evaluateRequirement(approved, r));
    return { product, approved, trueReqResults };
  });
  const survivors = evaluated.filter((e) => !hasVerifiedNonMatch(e.trueReqResults));

  if (survivors.length === 0) {
    logSearch({
      request_text: input.request_text,
      normalized_intent: { attributes: Object.fromEntries(requirements.map((r) => [r.attribute, r.value])) },
      hard_filters: filters,
      preferred_requirements: {},
      result_status: 'NO_MATCH',
      client_name: input.client?.name ?? ctx.source,
      results: [],
      impressions: [],
    });
    return { status: 'NO_MATCH', products: [] };
  }

  const productTexts = survivors.map((e) => renderProductText(e.product, vertical));
  const [requestEmbedding, ...productEmbeddings] = await embedTexts([input.request_text, ...productTexts]);

  const withSimilarity = survivors.map((e, i) => ({
    ...e,
    verifiedCount: countVerifiedMatches(e.trueReqResults),
    similarity: cosineSimilarity(requestEmbedding, productEmbeddings[i]),
  }));

  // Step 4: deterministic multi-objective utility ranking. Stage A (verifiedCount) is
  // computed by compareByUtility itself; Stage B blends relevance/price/trust/fulfillment
  // via computeUtility, normalized over the FULL survivor pool (not just the eventual
  // finalists) so the utility score reflects real spread, not just whatever happens to make
  // the cut.
  const pool = computePoolStats(withSimilarity.map((e) => e.product));
  const ranked = withSimilarity
    .map((e) => {
      const utilityBreakdown = computeUtilityBreakdown({
        ...e.product,
        verifiedCount: e.verifiedCount,
        requirementCount: requirements.length,
        similarity: e.similarity,
      }, pool);
      return {
        ...e,
        merchant_id: e.product.merchant_id,
        utility: utilityBreakdown.utility,
        utilityBreakdown,
      };
    })
    .sort(compareByUtility);

  // Step 5: merchant diversity — no single merchant crowds out the comparison.
  const { selected, diversityCapped } = applyMerchantDiversity(ranked, MERCHANT_DIVERSITY_CAP, input.max_results ?? 5);

  // Step 6: grounded decision factors + badge, computed over the finalist set actually
  // shown (so "lowest price"/"fastest delivery" claims are true of the comparison the buyer
  // sees) — still deterministic, still no LLM. CONTROL: buildDecisionFactors receives only
  // the DISCLOSED requirement results, so a MATCHING_ONLY-driven match never appears here
  // even though it already influenced verifiedCount/bucket placement above.
  const finalistPool = computePoolStats(selected.map((e) => e.product));
  const badgeByEntry = assignBadges(selected.map((e) => e.product));

  const products = await Promise.all(
    selected.map(async (e, i) => {
      const disclosedReqResults = e.trueReqResults.map((r) => ({
        ...r,
        status: discloseRequirementStatus(e.approved[r.attribute]?.visibility, r.status),
      }));
      const decisionFactors = buildDecisionFactors(disclosedReqResults, { ...e.product, similarity: e.similarity }, finalistPool);
      const badge = badgeByEntry.get(e.product) ?? null;

      let reason: string | null;
      try {
        reason = await generateReason({ title: e.product.title, merchant_name: e.product.merchant_name, decision_factors: decisionFactors, badge });
      } catch {
        // No API key or a transient failure: fall back to the deterministic template built
        // from the exact same factors, rather than showing nothing.
        reason = deterministicFallback({ title: e.product.title, merchant_name: e.product.merchant_name, decision_factors: decisionFactors, badge });
      }

      return {
        product_id: e.product.id,
        title: e.product.title,
        price: e.product.price_amount,
        currency: e.product.currency,
        merchant_id: e.product.merchant_id,
        merchant_name: e.product.merchant_name,
        match_status: (disclosedReqResults.every((r) => r.status === 'VERIFIED_MATCH') ? 'VERIFIED' : 'PARTIAL') as 'VERIFIED' | 'PARTIAL',
        requirements: disclosedReqResults,
        decision_factors: decisionFactors,
        badge,
        reason,
        _rank: i + 1,
        _entry: e,
      };
    })
  );

  const anyDisclosedVerifiedMatch = products.some((p) => p.requirements.some((r) => r.status === 'VERIFIED_MATCH'));
  const status = anyDisclosedVerifiedMatch || requirements.length === 0
    ? products.some((p) => p.match_status === 'VERIFIED') ? 'VERIFIED' : 'PARTIAL'
    : 'INSUFFICIENT_DATA';

  // LTR feature logging: every survivor that passed hard filters, whether returned or not.
  const returnedIds = new Set(products.map((p) => p.product_id));
  const impressions = ranked.map((e) => ({
    product_id: e.product.id,
    merchant_id: e.product.merchant_id,
    verified_match_count: e.verifiedCount,
    requirement_pass: e.trueReqResults,
    price_amount: e.product.price_amount,
    price_percentile: pool.maxPrice === pool.minPrice ? 0.5 : (e.product.price_amount - pool.minPrice) / (pool.maxPrice - pool.minPrice),
    delivery_days_min: e.product.estimated_days_min,
    trust_score: e.utilityBreakdown.trust,
    review_count: e.product.review_count,
    semantic_similarity: e.similarity,
    utility_score: (e as { utility?: number }).utility ?? null,
    final_rank: returnedIds.has(e.product.id) ? products.find((p) => p.product_id === e.product.id)!._rank : null,
    was_returned: returnedIds.has(e.product.id),
    diversity_capped: diversityCapped.has(e),
  }));

  logSearch({
    request_text: input.request_text,
    normalized_intent: { attributes: Object.fromEntries(requirements.map((r) => [r.attribute, r.value])) },
    hard_filters: filters,
    preferred_requirements: {},
    result_status: status,
    client_name: input.client?.name ?? ctx.source,
    results: products.map((p) => ({
      product_id: p.product_id,
      merchant_id: p.merchant_id,
      merchant_offer_id: p._entry.product.merchant_offer_id,
      rank: p._rank,
      match_status: p.match_status,
      requirement_results: p.requirements,
      matched_attributes: Object.fromEntries(p.requirements.filter((r) => r.status === 'VERIFIED_MATCH').map((r) => [r.attribute, r.requested_value])),
      unknown_attributes: p.requirements.filter((r) => r.status === 'UNKNOWN').map((r) => r.attribute),
      decision_factors: p.decision_factors,
      badge: p.badge,
      reasoning_text: p.reason,
    })),
    impressions,
  });

  return {
    status,
    products: products.map(({ _rank, _entry, ...p }) => p),
  };
}
