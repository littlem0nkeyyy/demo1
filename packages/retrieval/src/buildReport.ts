import { latestRun } from '@machina/database';
import type { GapClass } from '@machina/schemas';
import type { BenchmarkRunResult, PerQueryResult } from './runBenchmark';

type Bucket = GapClass | 'unclassified';
const BUCKETS: Bucket[] = ['SURFACE', 'HARD', 'UNRESOLVED', 'unclassified'];

interface BucketStats {
  n: number;
  baseline_top3: number;
  enriched_top3: number;
  baseline_mean_rank: number | null;
  enriched_mean_rank: number | null;
}

export interface QueryDelta {
  query_id: string;
  query_text: string;
  relevant_product_ids: string[];
  bucket: Bucket;
  baseline_rank: number | null;
  enriched_rank: number | null;
  baseline_top3: boolean;
  enriched_top3: boolean;
}

export interface Report {
  generated_at: string;
  merchant_id: string;
  retrieval_method: string;
  embedding_model: string;
  baseline_run_id: number;
  enriched_run_id: number;
  overall: {
    baseline: BenchmarkRunResult['summary'];
    enriched: BenchmarkRunResult['summary'];
  };
  by_bucket: Record<Bucket, BucketStats>;
  regressions: QueryDelta[];
  improvements: QueryDelta[];
  unchanged: QueryDelta[];
  claim_sentence: string;
}

function bucketOf(r: PerQueryResult): Bucket {
  return r.gap_class ?? 'unclassified';
}

function meanRank(rows: PerQueryResult[]): number | null {
  const ranks = rows.map((r) => r.rank).filter((r): r is number => r !== null);
  if (ranks.length === 0) return null;
  return ranks.reduce((a, b) => a + b, 0) / ranks.length;
}

export function buildReport(merchantId: string): Report {
  const baselineRow = latestRun(merchantId, 'baseline');
  const enrichedRow = latestRun(merchantId, 'enriched');
  if (!baselineRow || !enrichedRow) {
    throw new Error('Need both a baseline and an enriched experiment run before a report can be built.');
  }

  const baseline: BenchmarkRunResult = JSON.parse(baselineRow.results_json);
  const enriched: BenchmarkRunResult = JSON.parse(enrichedRow.results_json);

  const baselineById = new Map(baseline.per_query.map((r) => [r.query_id, r]));

  const buckets: Record<Bucket, PerQueryResult[]> = { SURFACE: [], HARD: [], UNRESOLVED: [], unclassified: [] };
  for (const r of enriched.per_query) buckets[bucketOf(r)].push(r);

  const by_bucket: Record<Bucket, BucketStats> = {} as Record<Bucket, BucketStats>;
  for (const bucket of BUCKETS) {
    const enrichedRows = buckets[bucket];
    const baselineRows = enrichedRows.map((r) => baselineById.get(r.query_id)).filter((r): r is PerQueryResult => !!r);
    by_bucket[bucket] = {
      n: enrichedRows.length,
      baseline_top3: baselineRows.filter((r) => r.top3).length,
      enriched_top3: enrichedRows.filter((r) => r.top3).length,
      baseline_mean_rank: meanRank(baselineRows),
      enriched_mean_rank: meanRank(enrichedRows),
    };
  }

  const regressions: QueryDelta[] = [];
  const improvements: QueryDelta[] = [];
  const unchanged: QueryDelta[] = [];

  for (const eq of enriched.per_query) {
    const bq = baselineById.get(eq.query_id);
    const delta: QueryDelta = {
      query_id: eq.query_id,
      query_text: eq.query_text,
      relevant_product_ids: eq.relevant_product_ids,
      bucket: bucketOf(eq),
      baseline_rank: bq?.rank ?? null,
      enriched_rank: eq.rank,
      baseline_top3: bq?.top3 ?? false,
      enriched_top3: eq.top3,
    };
    if (delta.baseline_top3 && !delta.enriched_top3) regressions.push(delta);
    else if (!delta.baseline_top3 && delta.enriched_top3) improvements.push(delta);
    else if ((bq?.rank ?? Infinity) < (eq.rank ?? Infinity)) regressions.push(delta);
    else if ((bq?.rank ?? Infinity) > (eq.rank ?? Infinity)) improvements.push(delta);
    else unchanged.push(delta);
  }

  const hard = by_bucket.HARD;
  const surface = by_bucket.SURFACE;
  const unresolved = by_bucket.UNRESOLVED;
  const claim_sentence =
    `When a required attribute existed nowhere in the merchant's public copy (hard gaps, N=${hard.n}), ` +
    `evidence-backed enrichment moved Top-3 resolution from ${hard.baseline_top3}/${hard.n} to ${hard.enriched_top3}/${hard.n} ` +
    `in this held-out benchmark. When the information was already implicit in the copy (surface gaps, N=${surface.n}), ` +
    `resolution moved from ${surface.baseline_top3}/${surface.n} to ${surface.enriched_top3}/${surface.n} — ` +
    `a smaller change, because retrieval already handled some of that inference. ` +
    `${unresolved.n} quer${unresolved.n === 1 ? 'y was' : 'ies were'} genuinely unresolvable (no catalogue evidence exists at all). ` +
    `${regressions.length} quer${regressions.length === 1 ? 'y' : 'ies'} got worse after enrichment.`;

  return {
    generated_at: new Date().toISOString(),
    merchant_id: merchantId,
    retrieval_method: enriched.retrieval_method,
    embedding_model: enriched.embedding_model,
    baseline_run_id: baselineRow.id,
    enriched_run_id: enrichedRow.id,
    overall: { baseline: baseline.summary, enriched: enriched.summary },
    by_bucket,
    regressions,
    improvements,
    unchanged,
    claim_sentence,
  };
}
