# Machina — nine synthetic merchants

> Every merchant, product, review, claim, price, URL and image in this dataset is
> fictional. Do not present any record as real merchant or customer data.

This standalone showcase database contains nine merchants in nine separate retail
verticals. Each merchant has 50 products, and every product follows the same deep
catalogue format used by the original Velora single-merchant demo.

The schema now separates canonical product identity, merchant catalogue listings,
variants, current merchant offers, and historical price/inventory records. It also
contains the normalized matching and synchronization structures described in the
Machina Product & Merchant Database specification.

| Merchant | Vertical | Products |
|---|---|---:|
| Velora Runworks | Running shoes | 50 |
| Northpine Carry | Travel backpacks | 50 |
| Sonora Audio Lab | Wireless headphones | 50 |
| Emberline Coffee | Drip coffee makers | 50 |
| LumaDerm Studio | Facial skincare | 50 |
| Aster Deskworks | Desk lamps | 50 |
| Tidecraft Hydration | Reusable water bottles | 50 |
| Stillform Movement | Yoga mats | 50 |
| Meridian Time Co. | Analog wristwatches | 50 |

## Contents

- `machina_9_merchants.sqlite` — ready-to-query SQLite database.
- `schema.sql` — relational schema and MCP-safe views.
- `data/` — portable JSON and JSONL exports.
- `contracts/` — JSON Schema contracts for PurchaseIntent and ranked responses.
- `assets/products/<product_id>/` — four indexed WebP views plus a thumbnail.
- `source_images/` — nine original AI-generated contact sheets.
- `IMAGE_PROMPTS.md` — source-image provenance and prompt set.
- `generator/` — deterministic generator and validator.
- `backups/` — the SQLite database from before the offer-model upgrade.

## Core data model

```text
canonical_products
        ↓
products (merchant listing + raw source JSON)
        ↓
product_variants
        ↓
merchant_offers (current price, stock, shipping, returns, warranty)
        ↓
price_history + inventory_levels
```

Additional matching and operations tables:

- `product_keywords` — normalized terms with source and confidence.
- `product_facts` — evidence-backed structured attributes and visibility controls.
- `product_aliases` — alternate names and merchant SKU lookup.
- `merchant_shipping_rules` — country-level fees and delivery estimates.
- `catalogue_sync_logs` — full-catalogue and offer-refresh audit records.
- `search_requests` — nine stable PurchaseIntent examples.
- `search_results` — five evidence-based ranked options per example.

Because the showcase deliberately assigns a different retail vertical to each
merchant, every current canonical product has one merchant listing. The schema supports
multiple listings pointing to the same `canonical_product_id` when overlapping
merchant catalogues are added later.

## Regenerate

```bash
npm install
npm run generate
npm run validate
```

`npm run generate` reuses existing image assets. Run `npm run generate:images` only
when the WebP renditions also need to be regenerated from the nine source sheets.

## MCP behaviour

Always require or resolve a `merchant_id` before search. Rank with
`product_search_documents.internal_matching_text`, but return fields from
`mcp_product_cards` and `mcp_agent_visible_facts`. Search should return at most five
products. Details should return one product, its four image references, approved
agent-visible facts, no more than three review highlights, and only relevant exact
evidence spans. Do not send image bytes, full review corpora, full evidence documents,
`MATCHING_ONLY` values or `INTERNAL_ONLY` values through MCP.

Use `mcp_ranked_product_options` for the response projection. A complete generated
example is available at `data/example_purchase_response.json`.
