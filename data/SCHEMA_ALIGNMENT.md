# Alignment with the Machina Product & Merchant Database specification

## Added in the offer-model upgrade

- Merchant `slug`, `website_url`, and constrained sync status.
- `canonical_products` for cross-merchant identity.
- `products.canonical_product_id` and validated `raw_data_json`.
- `merchant_offers` with current price, availability, stock, shipping countries,
  fee, delivery estimate, return policy, warranty, and sync timestamp.
- Real two-row price history for every variant.
- `product_keywords` with normalized term, source, confidence, and unique constraint.
- `product_aliases`, `catalogue_sync_logs`, and `merchant_shipping_rules`.
- JSON validity constraints for facts, raw merchant records, search data, and shipping.
- Recommended merchant, product, keyword, attribute, price, and availability indexes.
- Nine PurchaseIntent fixtures and 45 ranked result fixtures.
- MCP projections containing merchant identity, offer details, match explanations,
  unknown attributes, shipping, and product URL.
- JSON Schema contracts and a full generated response example.

## Preserved from the deeper catalogue model

- Product families and variants.
- Four indexed images plus one thumbnail per product.
- Reviews and aspect summaries.
- Evidence documents, exact spans, fact approvals, and visibility controls.
- Separate agent-visible and internal matching documents.

## Intentional showcase constraint

The nine merchants occupy nine different verticals, so the current seed has a
one-to-one mapping between canonical product and merchant listing. This preserves the
requested non-overlapping store catalogues. The database permits multiple products
from different merchants to reference one canonical product when an overlapping
catalogue fixture is needed.
