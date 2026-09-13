import fs from 'fs';
import path from 'path';
import { getDb } from './connection';
import { findRepoRoot } from '@machina/schemas';

// v5: this dataset's data/jsonl/*.{json,jsonl} files already have exactly the columns their
// matching table expects (it was exported from the same schema.sql this project now loads
// verbatim in init.ts), so seeding is a generic bulk loader rather than a
// transform-then-insert connector. FK order matters (foreign_keys=ON) — tables are loaded
// parent-before-child.
const JSONL_DIR = () => path.join(findRepoRoot(), 'data', 'jsonl');

interface TableSource {
  table: string;
  file: string; // relative to data/jsonl
  format: 'json' | 'jsonl';
}

const SOURCES: TableSource[] = [
  { table: 'merchants', file: 'merchants.json', format: 'json' },
  { table: 'brands', file: 'brands.json', format: 'json' },
  { table: 'categories', file: 'categories.json', format: 'json' },
  { table: 'ontology_attributes', file: 'ontology_attributes.jsonl', format: 'jsonl' },
  { table: 'product_families', file: 'product_families.jsonl', format: 'jsonl' },
  { table: 'canonical_products', file: 'canonical_products.jsonl', format: 'jsonl' },
  { table: 'products', file: 'products.jsonl', format: 'jsonl' },
  { table: 'product_variants', file: 'product_variants.jsonl', format: 'jsonl' },
  { table: 'product_content', file: 'product_content.jsonl', format: 'jsonl' },
  { table: 'evidence_documents', file: 'evidence_documents.jsonl', format: 'jsonl' },
  { table: 'product_facts', file: 'product_facts.jsonl', format: 'jsonl' },
  { table: 'fact_evidence', file: 'fact_evidence.jsonl', format: 'jsonl' },
  { table: 'fact_decisions', file: 'fact_decisions.jsonl', format: 'jsonl' },
  { table: 'media_assets', file: 'media_assets.jsonl', format: 'jsonl' },
  { table: 'price_history', file: 'price_history.jsonl', format: 'jsonl' },
  { table: 'inventory_levels', file: 'inventory_levels.jsonl', format: 'jsonl' },
  { table: 'merchant_offers', file: 'merchant_offers.jsonl', format: 'jsonl' },
  { table: 'reviews', file: 'reviews.jsonl', format: 'jsonl' },
  { table: 'review_aspects', file: 'review_aspects.jsonl', format: 'jsonl' },
  { table: 'product_search_documents', file: 'product_search_documents.jsonl', format: 'jsonl' },
  { table: 'product_keywords', file: 'product_keywords.jsonl', format: 'jsonl' },
  { table: 'product_aliases', file: 'product_aliases.jsonl', format: 'jsonl' },
  { table: 'merchant_shipping_rules', file: 'merchant_shipping_rules.jsonl', format: 'jsonl' },
  { table: 'catalogue_sync_logs', file: 'catalogue_sync_logs.jsonl', format: 'jsonl' },
  // search_requests/search_results/offer_drafts seed fixtures are example-only (this
  // project generates its own live rows via matching.ts) — intentionally not loaded.
];

function readRows(source: TableSource): Record<string, unknown>[] {
  const full = path.join(JSONL_DIR(), source.file);
  if (!fs.existsSync(full)) return [];
  const text = fs.readFileSync(full, 'utf-8');
  if (source.format === 'json') return JSON.parse(text);
  return text
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

function normalize(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
  }
  return out;
}

export async function seed() {
  const db = getDb();
  // products.primary_variant_id -> product_variants is DEFERRABLE INITIALLY DEFERRED, but
  // each table here loads in its own transaction, so the deferred check would still fire at
  // that transaction's commit before product_variants exists. Bulk seeding is a controlled,
  // one-shot load of internally-consistent fixture data, so disabling FK enforcement for its
  // duration (re-enabled immediately after) is safe and simpler than reordering every table.
  db.pragma('foreign_keys = OFF');
  for (const source of SOURCES) {
    const rows = readRows(source).map(normalize);
    if (rows.length === 0) {
      console.log(`skip ${source.table}: no rows in ${source.file}`);
      continue;
    }
    const columns = Object.keys(rows[0]);
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO ${source.table} (${columns.join(', ')}) VALUES (${columns.map((c) => `@${c}`).join(', ')})`
    );
    const insertAll = db.transaction((batch: Record<string, unknown>[]) => {
      for (const row of batch) stmt.run(row);
    });
    insertAll(rows);
    console.log(`seeded ${source.table}: ${rows.length} rows`);
  }
  db.pragma('foreign_keys = ON');
}

if (require.main === module) {
  seed().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
