import fs from 'fs';
import path from 'path';
import { getDb } from './connection';
import { findRepoRoot } from '@machina/schemas';

// v5: the base commerce schema (merchants → canonical_products → products → variants →
// offers → price_history/inventory, plus facts/evidence/decisions, reviews/aspects, media)
// is loaded verbatim from data/schema.sql — the schema of the 9-merchant dataset this
// project now natively speaks. product_facts already carries Machina's exact
// DIRECT/AMBIGUOUS/NONE + AGENT_VISIBLE/MATCHING_ONLY/INTERNAL_ONLY + pending/approved/
// rejected vocabulary, so nothing there needed renaming.
//
// Two tables below are Machina-specific additions, kept because the source dataset has no
// equivalent concept:
// - buyer_queries / experiment_runs: the frozen held-out query set + immutable benchmark
//   runs the Validation Lab (Report page) depends on. INSERT-only, same as before.
// - ranking_impressions / ranking_actions: LTR feature logging (§ v5 cross-merchant plan).
//   Nothing reads these yet — they exist so a future learning-to-rank pass has real
//   (features, outcome) rows. INSERT-only.
const MACHINA_EXTRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS buyer_queries (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  text TEXT NOT NULL,
  query_set TEXT NOT NULL CHECK (query_set IN ('gap_mining','held_out')),
  normalized_requirement_json TEXT,
  required_attributes_json TEXT,
  preferred_attributes_json TEXT,
  relevant_product_ids_json TEXT,
  expected_result_type TEXT,
  gap_class TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_buyer_queries_merchant ON buyer_queries(merchant_id, query_set);

CREATE TABLE IF NOT EXISTS experiment_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id TEXT NOT NULL,
  catalogue_variant TEXT NOT NULL CHECK (catalogue_variant IN ('baseline','enriched')),
  embedding_model TEXT NOT NULL,
  retrieval_method TEXT NOT NULL,
  query_set_hash TEXT NOT NULL,
  results_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- LTR feature logging (no learning yet). One row per candidate that survived hard filters
-- for a search — including candidates NOT returned to the agent, so they can serve as
-- negative examples later. requirement_pass_json reflects TRUE per-requirement pass/fail
-- (not disclosure-filtered) because this is internal training data, never agent-facing.
CREATE TABLE IF NOT EXISTS ranking_impressions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  search_request_id TEXT NOT NULL REFERENCES search_requests(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  verified_match_count INTEGER NOT NULL,
  requirement_pass_json TEXT NOT NULL,
  price_amount REAL,
  price_percentile REAL,
  delivery_days_min INTEGER,
  trust_score REAL,
  review_count INTEGER,
  semantic_similarity REAL,
  utility_score REAL,
  final_rank INTEGER,
  was_returned INTEGER NOT NULL DEFAULT 0,
  diversity_capped INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ranking_impressions_request ON ranking_impressions(search_request_id);
CREATE INDEX IF NOT EXISTS idx_ranking_impressions_product ON ranking_impressions(product_id);

-- Links a later tool call (get_product_details/check_suitability/create_offer) back to the
-- impression it followed, when the product_id was part of a recent search's results — the
-- eventual click/conversion label for a future LTR pass.
CREATE TABLE IF NOT EXISTS ranking_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ranking_impression_id INTEGER NOT NULL REFERENCES ranking_impressions(id),
  action_type TEXT NOT NULL CHECK (action_type IN ('view_details','check_suitability','create_offer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ranking_actions_impression ON ranking_actions(ranking_impression_id);
`;

function main() {
  const db = getDb();
  const baseSchema = fs.readFileSync(path.join(findRepoRoot(), 'data', 'schema.sql'), 'utf-8');
  db.exec(baseSchema);
  db.exec(MACHINA_EXTRA_SCHEMA);
  console.log('Schema initialized at machina.db');
}

if (require.main === module) {
  main();
}

export { main as initSchema };
