import { z } from 'zod';
import { RequestStatusSchema, RequirementStatusSchema, MatchStatusSchema, SuitabilityResultSchema } from './status';

// ---- search_products ----------------------------------------------------
// §3: client-side filters are hints/hard constraints Machina applies deterministically;
// request_text is the only place free-form buyer language goes. §13: no unrelated
// conversation history, no hidden reasoning — this schema physically can't carry that.
export const SearchProductsInputSchema = z.object({
  request_text: z.string().min(1),
  filters: z
    .object({
      price_max: z.number().positive().optional(),
      currency: z.string().optional(),
      availability: z.string().optional(),
      delivery_days_max: z.number().int().nonnegative().optional(),
    })
    .partial()
    .optional(),
  // v5: search is vertical-scoped (cross-merchant) by default; this narrows an
  // otherwise-cross-merchant connection down to one merchant within that vertical.
  merchant_id: z.string().optional(),
  max_results: z.number().int().positive().max(20).optional().default(5),
  client: z.object({ name: z.string() }).optional(),
});
export type SearchProductsInput = z.infer<typeof SearchProductsInputSchema>;

export const RequirementResultSchema = z.object({
  attribute: z.string(),
  requested_value: z.string(),
  status: RequirementStatusSchema,
});

export const DecisionFactorSchema = z.object({
  factor: z.enum(['match', 'price', 'delivery', 'trust', 'similarity']),
  label: z.string(),
  detail: z.string(),
});

export const ProductResultSchema = z.object({
  product_id: z.string(),
  title: z.string(),
  price: z.number(),
  currency: z.string(),
  // v5: results can come from different merchants within the same vertical.
  merchant_id: z.string(),
  merchant_name: z.string(),
  match_status: MatchStatusSchema,
  requirements: z.array(RequirementResultSchema),
  // Deterministic, disclosure-aware — computed by matchingCore, never by an LLM.
  decision_factors: z.array(DecisionFactorSchema),
  badge: z.enum(['best_overall', 'lowest_price', 'fastest_delivery']).nullable(),
  // The one LLM-generated field in this response: a verbalization of decision_factors/badge
  // above, nothing else. Use this, not an independently-invented justification.
  reason: z.string().nullable(),
});

export const SearchProductsOutputSchema = z.object({
  status: RequestStatusSchema,
  clarification_question: z.string().nullable().optional(),
  products: z.array(ProductResultSchema),
});
export type SearchProductsOutput = z.infer<typeof SearchProductsOutputSchema>;

// ---- get_product_details --------------------------------------------------
export const GetProductDetailsInputSchema = z.object({
  product_id: z.string(),
});
export type GetProductDetailsInput = z.infer<typeof GetProductDetailsInputSchema>;

export const ProductAttributeDetailSchema = z.object({
  attribute: z.string(),
  value: z.string().nullable(),
  evidence_text: z.string().nullable(),
  evidence_source: z.string().nullable(),
});

export const ProductImageSchema = z.object({ url: z.string(), alt_text: z.string() });
export const ReviewHighlightSchema = z.object({
  rating: z.number(),
  title: z.string(),
  aspect: z.string(),
  sentiment: z.string(),
  evidence_span: z.string(),
});

export const GetProductDetailsOutputSchema = z.object({
  product_id: z.string(),
  title: z.string(),
  price: z.number(),
  currency: z.string(),
  merchant_id: z.string(),
  merchant_name: z.string(),
  attributes: z.array(ProductAttributeDetailSchema),
  images: z.array(ProductImageSchema),
  review_highlights: z.array(ReviewHighlightSchema),
});
export type GetProductDetailsOutput = z.infer<typeof GetProductDetailsOutputSchema>;

// ---- check_suitability -----------------------------------------------------
export const CheckSuitabilityInputSchema = z.object({
  product_id: z.string(),
  attribute: z.string(),
  requested_value: z.string(),
});
export type CheckSuitabilityInput = z.infer<typeof CheckSuitabilityInputSchema>;

export const CheckSuitabilityOutputSchema = z.object({
  result: SuitabilityResultSchema,
  evidence_text: z.string().nullable(),
});
export type CheckSuitabilityOutput = z.infer<typeof CheckSuitabilityOutputSchema>;

// ---- create_offer -----------------------------------------------------
// §6: no real payment in MVP — this creates a non-binding, structured offer record only.
export const CreateOfferInputSchema = z.object({
  product_id: z.string(),
  quantity: z.number().int().positive().optional().default(1),
});
export type CreateOfferInput = z.infer<typeof CreateOfferInputSchema>;

export const CreateOfferOutputSchema = z.object({
  offer_id: z.string(),
  product_id: z.string(),
  price: z.number(),
  currency: z.string(),
  quantity: z.number(),
  status: z.literal('draft'),
  note: z.string(),
});
export type CreateOfferOutput = z.infer<typeof CreateOfferOutputSchema>;
