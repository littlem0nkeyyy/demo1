import { getDb } from '../connection';

export interface Merchant {
  id: string;
  name: string;
  slug: string;
  default_currency: string;
  country: string;
  status: 'active' | 'inactive' | 'sync_error';
  synthetic: number;
}

export function getMerchant(id: string): Merchant | undefined {
  return getDb().prepare('SELECT * FROM merchants WHERE id = ?').get(id) as Merchant | undefined;
}

export function listMerchants(): Merchant[] {
  return getDb().prepare('SELECT * FROM merchants ORDER BY id').all() as Merchant[];
}

// A merchant's vertical isn't a column — it's derived from its one leaf category (each
// merchant in this dataset has exactly one non-root category). Slugified the same way the
// v5 migration script generated data/ontologies/<vertical>.json, so this always matches a
// real ontology file.
export function getMerchantVertical(merchantId: string): string | undefined {
  const row = getDb()
    .prepare(`SELECT name FROM categories WHERE merchant_id = ? AND name != 'Catalogue' LIMIT 1`)
    .get(merchantId) as { name: string } | undefined;
  if (!row) return undefined;
  return row.name.trim().toLowerCase().replace(/\s+/g, '_');
}

// Every active merchant whose leaf category matches this vertical — the cross-merchant
// candidate pool's merchant boundary.
export function listMerchantsInVertical(vertical: string): Merchant[] {
  return getDb()
    .prepare(
      `SELECT m.* FROM merchants m
       JOIN categories c ON c.merchant_id = m.id AND c.name != 'Catalogue'
       WHERE m.status = 'active' AND lower(replace(trim(c.name), ' ', '_')) = ?
       ORDER BY m.id`
    )
    .all(vertical) as Merchant[];
}

export interface VerticalInfo {
  vertical: string;
  description: string;
}

// Every distinct vertical actually present in the database right now, with a description
// pulled straight from that category's own row — used by classifyVertical.ts so its prompt/
// enum always matches real seeded data instead of a hand-maintained list that can drift.
export function listVerticals(): VerticalInfo[] {
  const rows = getDb()
    .prepare(`SELECT DISTINCT name, description FROM categories WHERE name != 'Catalogue'`)
    .all() as { name: string; description: string }[];
  const seen = new Map<string, string>();
  for (const r of rows) {
    const vertical = r.name.trim().toLowerCase().replace(/\s+/g, '_');
    if (!seen.has(vertical)) seen.set(vertical, r.description);
  }
  return [...seen.entries()].map(([vertical, description]) => ({ vertical, description }));
}
