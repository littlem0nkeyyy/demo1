import { getDb } from '../connection';
import type { AttributeCondition, RequestStatus, GapClass } from '@machina/schemas';

export type QuerySet = 'gap_mining' | 'held_out';

export interface BuyerQueryRow {
  id: string;
  merchant_id: string;
  text: string;
  query_set: QuerySet;
  normalized_requirement_json: string | null;
  required_attributes_json: string | null;
  preferred_attributes_json: string | null;
  relevant_product_ids_json: string | null;
  expected_result_type: RequestStatus | null;
  gap_class: GapClass | null;
  locked: number;
  created_at: string;
}

export class LockedQuerySetError extends Error {
  constructor(querySet: QuerySet) {
    super(`Query set '${querySet}' is locked and cannot be modified.`);
  }
}

export interface InsertQueryInput {
  id: string;
  merchant_id: string;
  text: string;
  query_set: QuerySet;
  required_attributes?: AttributeCondition[];
  preferred_attributes?: AttributeCondition[];
  relevant_product_ids?: string[];
  expected_result_type?: RequestStatus;
  gap_class?: GapClass;
}

export function insertQuery(row: InsertQueryInput): void {
  assertNotLocked(row.query_set);
  const db = getDb();
  db.prepare(
    `INSERT INTO buyer_queries
      (id, merchant_id, text, query_set, required_attributes_json, preferred_attributes_json, relevant_product_ids_json, expected_result_type, gap_class)
     VALUES (@id, @merchant_id, @text, @query_set, @required_attributes_json, @preferred_attributes_json, @relevant_product_ids_json, @expected_result_type, @gap_class)
     ON CONFLICT(id) DO UPDATE SET
       text=excluded.text,
       required_attributes_json=excluded.required_attributes_json,
       preferred_attributes_json=excluded.preferred_attributes_json,
       relevant_product_ids_json=excluded.relevant_product_ids_json,
       expected_result_type=excluded.expected_result_type,
       gap_class=excluded.gap_class`
  ).run({
    id: row.id,
    merchant_id: row.merchant_id,
    text: row.text,
    query_set: row.query_set,
    required_attributes_json: row.required_attributes ? JSON.stringify(row.required_attributes) : null,
    preferred_attributes_json: row.preferred_attributes ? JSON.stringify(row.preferred_attributes) : null,
    relevant_product_ids_json: row.relevant_product_ids ? JSON.stringify(row.relevant_product_ids) : null,
    expected_result_type: row.expected_result_type ?? null,
    gap_class: row.gap_class ?? null,
  });
}

export function assertNotLocked(querySet: QuerySet): void {
  const db = getDb();
  const anyLocked = db
    .prepare('SELECT 1 FROM buyer_queries WHERE query_set = ? AND locked = 1 LIMIT 1')
    .get(querySet);
  if (anyLocked) throw new LockedQuerySetError(querySet);
}

export function lockQuerySet(merchantId: string, querySet: QuerySet): void {
  getDb().prepare('UPDATE buyer_queries SET locked = 1 WHERE merchant_id = ? AND query_set = ?').run(merchantId, querySet);
}

export function isLocked(merchantId: string, querySet: QuerySet): boolean {
  const db = getDb();
  const row = db
    .prepare('SELECT COUNT(*) as total, SUM(locked) as locked FROM buyer_queries WHERE merchant_id = ? AND query_set = ?')
    .get(merchantId, querySet) as { total: number; locked: number | null };
  return row.total > 0 && row.locked === row.total;
}

export function listQueries(merchantId: string, querySet: QuerySet): BuyerQueryRow[] {
  return getDb()
    .prepare('SELECT * FROM buyer_queries WHERE merchant_id = ? AND query_set = ? ORDER BY id')
    .all(merchantId, querySet) as BuyerQueryRow[];
}

export function setNormalizedRequirement(id: string, normalized: unknown): void {
  getDb()
    .prepare('UPDATE buyer_queries SET normalized_requirement_json = ? WHERE id = ?')
    .run(JSON.stringify(normalized), id);
}
