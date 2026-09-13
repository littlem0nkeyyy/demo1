import { getDb } from '../connection';

export type CatalogueVariant = 'baseline' | 'enriched';

export interface ExperimentRunRow {
  id: number;
  merchant_id: string;
  catalogue_variant: CatalogueVariant;
  embedding_model: string;
  retrieval_method: string;
  query_set_hash: string;
  results_json: string;
  created_at: string;
}

// Immutable: this is the only way rows enter experiment_runs. Never UPDATE/DELETE this table.
export function recordRun(input: {
  merchant_id: string;
  catalogue_variant: CatalogueVariant;
  embedding_model: string;
  retrieval_method: string;
  query_set_hash: string;
  results: unknown;
}): number {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO experiment_runs (merchant_id, catalogue_variant, embedding_model, retrieval_method, query_set_hash, results_json)
       VALUES (@merchant_id, @catalogue_variant, @embedding_model, @retrieval_method, @query_set_hash, @results_json)`
    )
    .run({
      merchant_id: input.merchant_id,
      catalogue_variant: input.catalogue_variant,
      embedding_model: input.embedding_model,
      retrieval_method: input.retrieval_method,
      query_set_hash: input.query_set_hash,
      results_json: JSON.stringify(input.results),
    });
  return Number(result.lastInsertRowid);
}

export function latestRun(merchantId: string, variant: CatalogueVariant): ExperimentRunRow | undefined {
  return getDb()
    .prepare('SELECT * FROM experiment_runs WHERE merchant_id = ? AND catalogue_variant = ? ORDER BY id DESC LIMIT 1')
    .get(merchantId, variant) as ExperimentRunRow | undefined;
}

export function allRuns(merchantId: string): ExperimentRunRow[] {
  return getDb().prepare('SELECT * FROM experiment_runs WHERE merchant_id = ? ORDER BY id DESC').all(merchantId) as ExperimentRunRow[];
}
