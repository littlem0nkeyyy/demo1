import { getCandidate, getApprovedFactsWithProvenance, getReviewHighlights, getMediaAssets, listMerchantsInVertical, getMerchant } from '@machina/database';
import type { GetProductDetailsInput, GetProductDetailsOutput } from '@machina/schemas';
import { isAgentVisible } from './disclosurePolicy';

export interface ProductDetailsContext {
  vertical?: string; // unset = whole-database default (v6); set = vertical-narrowed (v5)
  merchantId?: string; // legacy narrowed scope, optional — narrowest tier
}

// Three strictly-nested optional scopes: merchant-narrowed < vertical-narrowed < whole
// database (default). Exported so suitability.ts/offers.ts share this instead of each
// re-implementing the same check.
export function belongsToScope(merchantId: string, ctx: ProductDetailsContext): boolean {
  if (ctx.merchantId) return merchantId === ctx.merchantId;
  if (ctx.vertical) return listMerchantsInVertical(ctx.vertical).some((m) => m.id === merchantId);
  const merchant = getMerchant(merchantId);
  return !!merchant && merchant.status === 'active';
}

// get_product_details (§6): approved AGENT_VISIBLE facts + provenance, plus (v5) images and
// published review highlights, which aren't gated by CONTROL since they aren't
// product_facts. Returns null (treated as not-found) if the product doesn't belong to an
// active merchant in this connection's scope — same as an unknown id.
export function getProductDetails(input: GetProductDetailsInput, ctx: ProductDetailsContext): GetProductDetailsOutput | null {
  const product = getCandidate(input.product_id);
  if (!product || !belongsToScope(product.merchant_id, ctx)) return null;
  const rows = getApprovedFactsWithProvenance(input.product_id).filter((r) => isAgentVisible(r.visibility));
  return {
    product_id: product.id,
    title: product.title,
    price: product.price_amount,
    currency: product.currency,
    merchant_id: product.merchant_id,
    merchant_name: product.merchant_name,
    attributes: rows.map((r) => ({
      attribute: r.attribute,
      value: r.value,
      evidence_text: r.evidence_text,
      evidence_source: r.evidence_source,
    })),
    images: getMediaAssets(product.id).map((m) => ({ url: m.file_path, alt_text: m.alt_text })),
    review_highlights: getReviewHighlights(product.id).map((r) => ({
      rating: r.rating,
      title: r.title,
      aspect: r.aspect_key,
      sentiment: r.sentiment,
      evidence_span: r.evidence_span,
    })),
  };
}
