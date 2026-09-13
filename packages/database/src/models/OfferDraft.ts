import { getDb } from '../connection';

export interface OfferDraftRow {
  id: string;
  product_id: string;
  variant_id: string;
  quantity: number;
  unit_price: number;
  currency: string;
  availability_snapshot: string;
  status: 'draft';
  expires_at: string;
  created_at: string;
}

// §6: create_offer is a mock — no real payment or external call. Insert-only.
export function createOfferDraft(input: {
  product_id: string;
  variant_id: string;
  quantity: number;
  unit_price: number;
  currency: string;
  availability_snapshot: string;
}): OfferDraftRow {
  const id = `OFFERDRAFT-${Date.now()}`;
  const db = getDb();
  db.prepare(
    `INSERT INTO offer_drafts (id, product_id, variant_id, quantity, unit_price, currency, availability_snapshot, status, expires_at, created_at)
     VALUES (@id, @product_id, @variant_id, @quantity, @unit_price, @currency, @availability_snapshot, 'draft', datetime('now', '+15 minutes'), datetime('now'))`
  ).run({ id, ...input });
  return db.prepare('SELECT * FROM offer_drafts WHERE id = ?').get(id) as OfferDraftRow;
}
