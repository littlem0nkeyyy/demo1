import { getCandidate, createOfferDraft, logAction } from '@machina/database';
import { getDb } from '@machina/database';
import type { CreateOfferInput, CreateOfferOutput } from '@machina/schemas';
import { belongsToScope, type ProductDetailsContext } from './productDetails';

// create_offer (§6): a mock, non-binding structured offer record. No real payment, no
// external call. Multi-tenant boundary: refuses to create an offer for a product outside
// this connection's scope.
export function createOffer(input: CreateOfferInput, ctx: ProductDetailsContext): CreateOfferOutput {
  const product = getCandidate(input.product_id);
  if (!product || !belongsToScope(product.merchant_id, ctx)) {
    throw new Error(`Unknown product_id in this scope: ${input.product_id}`);
  }
  const variantRow = getDb().prepare('SELECT primary_variant_id FROM products WHERE id = ?').get(product.id) as { primary_variant_id: string };
  const quantity = input.quantity ?? 1;
  logAction(product.id, 'create_offer');
  const row = createOfferDraft({
    product_id: product.id,
    variant_id: variantRow.primary_variant_id,
    quantity,
    unit_price: product.price_amount,
    currency: product.currency,
    availability_snapshot: product.availability,
  });
  return {
    offer_id: row.id,
    product_id: product.id,
    price: row.unit_price * row.quantity,
    currency: row.currency,
    quantity: row.quantity,
    status: 'draft',
    note: 'Mock offer for demo purposes — no real payment or checkout has occurred.',
  };
}
