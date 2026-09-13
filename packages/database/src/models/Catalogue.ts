import { getDb } from '../connection';

// A search candidate: a merchant's product listing flattened with its current offer.
// price/currency/availability now live on merchant_offers (a merchant can reprice without
// touching the underlying product), not inline on products as in the old single-merchant
// schema — this is the main shape change downstream code needs to account for.
export interface CatalogueEntry {
  id: string; // product_id
  merchant_id: string;
  merchant_name: string;
  merchant_offer_id: string;
  canonical_product_id: string;
  title: string;
  long_description: string;
  average_rating: number;
  review_count: number;
  price_amount: number;
  currency: string;
  availability: string;
  stock_quantity: number | null;
  shipping_available: number;
  shipping_countries_json: string;
  shipping_fee: number | null;
  estimated_days_min: number;
  estimated_days_max: number;
}

const CANDIDATE_SELECT = `
  SELECT p.id, p.merchant_id, m.name AS merchant_name, o.id AS merchant_offer_id, p.canonical_product_id,
         p.title, p.long_description, p.average_rating, p.review_count,
         o.price_amount, o.currency, o.availability, o.stock_quantity, o.shipping_available,
         o.shipping_countries_json, o.shipping_fee, o.estimated_days_min, o.estimated_days_max
  FROM products p
  JOIN merchants m ON m.id = p.merchant_id
  JOIN merchant_offers o ON o.variant_id = p.primary_variant_id AND o.is_current = 1
  JOIN categories c ON c.id = p.category_id AND c.name != 'Catalogue'
`;

// Every active-merchant candidate in a vertical, optionally narrowed to one merchant (the
// legacy merchant-scoped mode). This is the cross-merchant candidate pool search_products
// ranks over.
export function listCandidates(vertical: string, merchantId?: string): CatalogueEntry[] {
  const db = getDb();
  if (merchantId) {
    return db
      .prepare(`${CANDIDATE_SELECT} WHERE p.status='active' AND m.status='active' AND p.merchant_id = ? ORDER BY p.id`)
      .all(merchantId) as CatalogueEntry[];
  }
  return db
    .prepare(
      `${CANDIDATE_SELECT} WHERE p.status='active' AND m.status='active'
       AND lower(replace(trim(c.name), ' ', '_')) = ? ORDER BY p.id`
    )
    .all(vertical) as CatalogueEntry[];
}

// Global lookup by id (product ids are unique across the whole dataset). Callers that
// received this id from an external caller MUST separately verify it belongs to an active
// merchant in ctx.vertical (or exactly ctx.merchantId when narrowed) before using it.
export function getCandidate(id: string): CatalogueEntry | undefined {
  return getDb().prepare(`${CANDIDATE_SELECT} WHERE p.id = ?`).get(id) as CatalogueEntry | undefined;
}

export interface ReviewHighlight {
  review_id: string;
  rating: number;
  title: string;
  aspect_key: string;
  sentiment: string;
  evidence_span: string;
}

// Mirrors this dataset's own mcp_review_highlights view: up to 3 published reviews per
// product, most-helpful first, joined to their aspect-level evidence spans.
export function getReviewHighlights(productId: string, limit = 3): ReviewHighlight[] {
  return getDb()
    .prepare(
      `SELECT r.id AS review_id, r.rating, r.title, a.aspect_key, a.sentiment, a.evidence_span
       FROM reviews r JOIN review_aspects a ON a.review_id = r.id
       WHERE r.product_id = ? AND r.status = 'published'
       ORDER BY r.helpful_count DESC, r.id
       LIMIT ?`
    )
    .all(productId, limit) as ReviewHighlight[];
}

export interface MediaAsset {
  file_path: string;
  alt_text: string;
  role: string;
}

export function getMediaAssets(productId: string): MediaAsset[] {
  return getDb()
    .prepare(`SELECT file_path, alt_text, role FROM media_assets WHERE product_id = ? ORDER BY sort_order`)
    .all(productId) as MediaAsset[];
}

export interface EvidenceDocument {
  id: string;
  title: string;
  extracted_text: string;
}

// The Approval page's "Extract evidence for a gap" step reads all of a product's evidence
// documents (product spec/description text, bulk-imported at seed time) — the extractor
// only ever sees this text and the target attribute, never the held-out query set.
export function getEvidenceDocuments(productId: string): EvidenceDocument[] {
  return getDb()
    .prepare(`SELECT id, title, extracted_text FROM evidence_documents WHERE product_id = ?`)
    .all(productId) as EvidenceDocument[];
}
