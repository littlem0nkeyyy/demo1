import crypto from 'crypto';
import { listCandidates, getApprovedFacts, listQueries, type CatalogueEntry, type CatalogueVariant } from '@machina/database';
import { loadOntology, type GapClass } from '@machina/schemas';
import { embedTexts, cosineSimilarity } from '@machina/core';

export const RETRIEVAL_METHOD_DESCRIPTION =
  'Cosine similarity over OpenAI text-embedding-3-small embeddings of product text vs. buyer query text. No hard filters, no re-ranking — a plain nearest-neighbour benchmark, directional/illustrative rather than a production ranking system.';

export interface PerQueryResult {
  query_id: string;
  query_text: string;
  relevant_product_ids: string[];
  gap_class: GapClass | null;
  rank: number | null; // best (lowest) rank among any relevant product id
  best_relevant_product_id: string | null;
  top1: boolean;
  top3: boolean;
  similarity_to_best: number | null;
}

export interface BenchmarkRunResult {
  catalogue_variant: CatalogueVariant;
  embedding_model: string;
  retrieval_method: string;
  per_query: PerQueryResult[];
  summary: {
    n: number;
    top1_count: number;
    top3_count: number;
    resolved_count: number;
    mean_rank: number | null;
    unresolved_query_ids: string[];
  };
}

// Renders a product's text representation for embedding. Baseline uses public copy only;
// enriched adds every currently-approved structured attribute (any visibility tier — the
// offline benchmark measures the effect of enrichment itself on retrieval, independent of
// the live CONTROL disclosure question, which only governs what a calling agent is told).
// NOTE: deliberately different from packages/core's live renderProductText(), which always
// reflects true current state for any product — this function simulates the two
// counterfactual catalogue states needed for the A/B benchmark comparison.
function productText(product: CatalogueEntry, variant: CatalogueVariant, vertical: string): string {
  if (variant === 'baseline') {
    return `${product.title}. ${product.long_description}`;
  }
  const approved = getApprovedFacts(product.id);
  const attrLines = loadOntology(vertical)
    .attributes.map((a) => {
      const entry = approved[a.key];
      if (!entry || entry.value === null) return null;
      return `${a.label}: ${entry.value}`;
    })
    .filter((line): line is string => line !== null);
  const attrText = attrLines.length > 0 ? ` ${attrLines.join('. ')}.` : '';
  return `${product.title}. ${product.long_description}${attrText}`;
}

export function querySetHash(querySetTexts: string[]): string {
  return crypto.createHash('sha256').update(querySetTexts.join('\n')).digest('hex').slice(0, 16);
}

export async function runBenchmark(merchantId: string, vertical: string, variant: CatalogueVariant): Promise<BenchmarkRunResult> {
  const products = listCandidates(vertical, merchantId);
  const queries = listQueries(merchantId, 'held_out');
  if (queries.length === 0) throw new Error(`No held-out queries loaded for merchant ${merchantId} — run npm run db:seed first.`);

  const productTexts = products.map((p) => productText(p, variant, vertical));
  const queryTexts = queries.map((q) => q.text);

  const [productEmbeddings, queryEmbeddings] = await Promise.all([
    embedTexts(productTexts),
    embedTexts(queryTexts),
  ]);

  const perQuery: PerQueryResult[] = queries.map((q, qi) => {
    const scored = products
      .map((p, pi) => ({ productId: p.id, score: cosineSimilarity(queryEmbeddings[qi], productEmbeddings[pi]) }))
      .sort((a, b) => b.score - a.score);

    const relevantIds: string[] = q.relevant_product_ids_json ? JSON.parse(q.relevant_product_ids_json) : [];

    let bestRank: number | null = null;
    let bestId: string | null = null;
    let bestScore: number | null = null;
    for (const id of relevantIds) {
      const idx = scored.findIndex((s) => s.productId === id);
      if (idx < 0) continue;
      const rank = idx + 1;
      if (bestRank === null || rank < bestRank) {
        bestRank = rank;
        bestId = id;
        bestScore = scored[idx].score;
      }
    }

    return {
      query_id: q.id,
      query_text: q.text,
      relevant_product_ids: relevantIds,
      gap_class: (q.gap_class as GapClass) ?? null,
      rank: bestRank,
      best_relevant_product_id: bestId,
      top1: bestRank === 1,
      top3: bestRank !== null && bestRank <= 3,
      similarity_to_best: bestScore,
    };
  });

  const ranks = perQuery.map((r) => r.rank).filter((r): r is number => r !== null);
  const summary = {
    n: perQuery.length,
    top1_count: perQuery.filter((r) => r.top1).length,
    top3_count: perQuery.filter((r) => r.top3).length,
    resolved_count: perQuery.filter((r) => r.top3).length,
    mean_rank: ranks.length > 0 ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null,
    unresolved_query_ids: perQuery.filter((r) => !r.top3).map((r) => r.query_id),
  };

  return {
    catalogue_variant: variant,
    embedding_model: 'text-embedding-3-small',
    retrieval_method: RETRIEVAL_METHOD_DESCRIPTION,
    per_query: perQuery,
    summary,
  };
}
