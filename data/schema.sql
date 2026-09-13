PRAGMA foreign_keys = ON;

CREATE TABLE merchants (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, legal_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE, website_url TEXT NOT NULL,
  default_currency TEXT NOT NULL, country TEXT NOT NULL, timezone TEXT NOT NULL,
  primary_language TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','inactive','sync_error')), synthetic INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE brands (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id), name TEXT NOT NULL, description TEXT NOT NULL);
CREATE TABLE categories (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id), parent_id TEXT REFERENCES categories(id), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL);
CREATE TABLE product_families (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id), brand_id TEXT NOT NULL REFERENCES brands(id), category_id TEXT NOT NULL REFERENCES categories(id), name TEXT NOT NULL, archetype TEXT NOT NULL);
CREATE TABLE canonical_products (
  id TEXT PRIMARY KEY, canonical_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, brand_name TEXT NOT NULL,
  category_key TEXT NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE products (
  id TEXT PRIMARY KEY, canonical_product_id TEXT NOT NULL REFERENCES canonical_products(id), merchant_id TEXT NOT NULL REFERENCES merchants(id), family_id TEXT NOT NULL REFERENCES product_families(id),
  brand_id TEXT NOT NULL REFERENCES brands(id), category_id TEXT NOT NULL REFERENCES categories(id), merchant_product_code TEXT NOT NULL,
  slug TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT NOT NULL, short_description TEXT NOT NULL, long_description TEXT NOT NULL,
  raw_data_json TEXT NOT NULL CHECK(json_valid(raw_data_json)), status TEXT NOT NULL, primary_variant_id TEXT REFERENCES product_variants(id) DEFERRABLE INITIALLY DEFERRED, product_url TEXT NOT NULL, release_date TEXT NOT NULL, warranty_summary TEXT NOT NULL,
  average_rating REAL NOT NULL, review_count INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(merchant_id, merchant_product_code), UNIQUE(merchant_id, slug)
);
CREATE TABLE product_variants (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id), product_id TEXT NOT NULL REFERENCES products(id), sku TEXT NOT NULL UNIQUE,
  variant_title TEXT NOT NULL, colour TEXT NOT NULL, size_range TEXT NOT NULL, weight_grams INTEGER NOT NULL, dimensions_json TEXT NOT NULL, status TEXT NOT NULL
);
CREATE TABLE product_content (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), locale TEXT NOT NULL, content_type TEXT NOT NULL,
  body TEXT NOT NULL, version INTEGER NOT NULL, is_current INTEGER NOT NULL, visibility TEXT NOT NULL, source_id TEXT NOT NULL
);
CREATE TABLE ontology_attributes (
  id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id), attribute_key TEXT NOT NULL, label TEXT NOT NULL,
  data_type TEXT NOT NULL, allowed_values_json TEXT NOT NULL CHECK(json_valid(allowed_values_json)), searchable INTEGER NOT NULL, filterable INTEGER NOT NULL,
  UNIQUE(category_id, attribute_key)
);
CREATE TABLE evidence_documents (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id), product_id TEXT NOT NULL REFERENCES products(id),
  document_type TEXT NOT NULL, title TEXT NOT NULL, trust_tier INTEGER NOT NULL, extracted_text TEXT NOT NULL,
  source_url TEXT NOT NULL, content_hash TEXT NOT NULL, synthetic INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE product_facts (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id), product_id TEXT NOT NULL REFERENCES products(id),
  attribute_key TEXT NOT NULL, value_json TEXT CHECK(value_json IS NULL OR json_valid(value_json)), evidence_state TEXT NOT NULL CHECK(evidence_state IN ('DIRECT','AMBIGUOUS','NONE')),
  visibility TEXT NOT NULL CHECK(visibility IN ('AGENT_VISIBLE','MATCHING_ONLY','INTERNAL_ONLY')),
  approval_status TEXT NOT NULL CHECK(approval_status IN ('pending','approved','rejected')), confidence REAL NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE fact_evidence (
  id TEXT PRIMARY KEY, fact_id TEXT NOT NULL REFERENCES product_facts(id), document_id TEXT NOT NULL REFERENCES evidence_documents(id),
  exact_span TEXT, section TEXT NOT NULL, start_offset INTEGER, end_offset INTEGER
);
CREATE TABLE fact_decisions (
  id TEXT PRIMARY KEY, fact_id TEXT NOT NULL REFERENCES product_facts(id), decision TEXT NOT NULL,
  visibility TEXT NOT NULL, decided_by TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE media_assets (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id), product_id TEXT NOT NULL REFERENCES products(id),
  role TEXT NOT NULL, file_path TEXT NOT NULL, mime_type TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
  file_size INTEGER NOT NULL, content_hash TEXT NOT NULL, alt_text TEXT NOT NULL, sort_order INTEGER NOT NULL,
  visibility TEXT NOT NULL, synthetic INTEGER NOT NULL
);
CREATE TABLE price_history (
  id TEXT PRIMARY KEY, variant_id TEXT NOT NULL REFERENCES product_variants(id), currency TEXT NOT NULL, amount REAL NOT NULL,
  compare_at_amount REAL, price_type TEXT NOT NULL, valid_from TEXT NOT NULL, valid_until TEXT
);
CREATE TABLE inventory_levels (
  id TEXT PRIMARY KEY, variant_id TEXT NOT NULL REFERENCES product_variants(id), quantity_available INTEGER NOT NULL,
  availability_status TEXT NOT NULL, source_updated_at TEXT NOT NULL
);
CREATE TABLE merchant_offers (
  id TEXT PRIMARY KEY, canonical_product_id TEXT NOT NULL REFERENCES canonical_products(id),
  product_id TEXT NOT NULL REFERENCES products(id), variant_id TEXT NOT NULL REFERENCES product_variants(id),
  merchant_id TEXT NOT NULL REFERENCES merchants(id), price_amount REAL NOT NULL CHECK(price_amount>=0), currency TEXT NOT NULL,
  availability TEXT NOT NULL CHECK(availability IN ('in_stock','out_of_stock','preorder','discontinued','unknown')),
  stock_quantity INTEGER, shipping_available INTEGER NOT NULL, shipping_countries_json TEXT NOT NULL CHECK(json_valid(shipping_countries_json)),
  shipping_fee REAL, estimated_days_min INTEGER, estimated_days_max INTEGER, return_policy TEXT NOT NULL, warranty_info TEXT NOT NULL,
  is_current INTEGER NOT NULL, last_synced_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE reviews (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id), product_id TEXT NOT NULL REFERENCES products(id),
  variant_id TEXT REFERENCES product_variants(id), rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), title TEXT NOT NULL,
  body TEXT NOT NULL, author_display_name TEXT NOT NULL, verified_purchase INTEGER NOT NULL, language TEXT NOT NULL,
  review_date TEXT NOT NULL, status TEXT NOT NULL, helpful_count INTEGER NOT NULL, synthetic INTEGER NOT NULL
);
CREATE TABLE review_aspects (
  id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES reviews(id), aspect_key TEXT NOT NULL,
  sentiment TEXT NOT NULL, confidence REAL NOT NULL, evidence_span TEXT NOT NULL
);
CREATE TABLE product_search_documents (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), locale TEXT NOT NULL, document_version INTEGER NOT NULL,
  agent_visible_text TEXT NOT NULL, internal_matching_text TEXT NOT NULL, keyword_tokens_json TEXT NOT NULL CHECK(json_valid(keyword_tokens_json)),
  content_hash TEXT NOT NULL, indexed_at TEXT NOT NULL
);
CREATE TABLE product_keywords (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), keyword TEXT NOT NULL,
  normalized_term TEXT NOT NULL, source TEXT NOT NULL, confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  created_at TEXT NOT NULL, UNIQUE(product_id, normalized_term)
);
CREATE TABLE product_aliases (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL, locale TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(product_id, normalized_alias)
);
CREATE TABLE merchant_shipping_rules (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id), country_code TEXT NOT NULL,
  currency TEXT NOT NULL, flat_fee REAL NOT NULL, free_shipping_threshold REAL, estimated_days_min INTEGER NOT NULL,
  estimated_days_max INTEGER NOT NULL, active INTEGER NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(merchant_id, country_code)
);
CREATE TABLE catalogue_sync_logs (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id), sync_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('started','success','partial','failed')), records_received INTEGER NOT NULL,
  records_created INTEGER NOT NULL, records_updated INTEGER NOT NULL, records_failed INTEGER NOT NULL,
  error_summary TEXT, started_at TEXT NOT NULL, completed_at TEXT
);
CREATE TABLE search_requests (
  id TEXT PRIMARY KEY, request_text TEXT NOT NULL, normalized_intent_json TEXT NOT NULL, hard_filters_json TEXT NOT NULL,
  preferred_requirements_json TEXT NOT NULL, result_status TEXT NOT NULL, client_name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE search_results (
  id TEXT PRIMARY KEY, search_request_id TEXT NOT NULL REFERENCES search_requests(id), product_id TEXT NOT NULL REFERENCES products(id),
  merchant_offer_id TEXT NOT NULL REFERENCES merchant_offers(id), rank INTEGER NOT NULL, score_json TEXT NOT NULL CHECK(json_valid(score_json)),
  match_status TEXT NOT NULL, requirement_results_json TEXT NOT NULL CHECK(json_valid(requirement_results_json)),
  matched_keywords_json TEXT NOT NULL CHECK(json_valid(matched_keywords_json)), matched_attributes_json TEXT NOT NULL CHECK(json_valid(matched_attributes_json)),
  unknown_attributes_json TEXT NOT NULL CHECK(json_valid(unknown_attributes_json)), reasons_json TEXT NOT NULL CHECK(json_valid(reasons_json)),
  decision_factors_json TEXT, badge TEXT, reasoning_text TEXT
);
CREATE TABLE offer_drafts (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), variant_id TEXT NOT NULL REFERENCES product_variants(id),
  quantity INTEGER NOT NULL, unit_price REAL NOT NULL, currency TEXT NOT NULL, availability_snapshot TEXT NOT NULL,
  status TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE INDEX idx_products_category_status ON products(category_id, status);
CREATE INDEX idx_products_merchant ON products(merchant_id, status);
CREATE INDEX idx_products_canonical ON products(canonical_product_id);
CREATE INDEX idx_variants_product_status ON product_variants(product_id, status);
CREATE INDEX idx_facts_product_attribute ON product_facts(product_id, attribute_key, approval_status);
CREATE INDEX idx_evidence_product ON evidence_documents(product_id);
CREATE INDEX idx_media_product_role ON media_assets(product_id, role, sort_order);
CREATE INDEX idx_reviews_product_date ON reviews(product_id, status, review_date);
CREATE INDEX idx_search_product ON product_search_documents(product_id, locale);
CREATE INDEX idx_keywords_normalized_term ON product_keywords(normalized_term, confidence);
CREATE INDEX idx_facts_attribute_value ON product_facts(attribute_key, value_json, approval_status);
CREATE INDEX idx_offers_price ON merchant_offers(currency, price_amount) WHERE is_current=1;
CREATE INDEX idx_offers_availability ON merchant_offers(availability, merchant_id) WHERE is_current=1;
CREATE UNIQUE INDEX idx_current_offer_variant ON merchant_offers(variant_id) WHERE is_current=1;

CREATE VIEW mcp_product_cards AS
SELECT p.id AS product_id, p.canonical_product_id, p.title, p.subtitle, p.short_description,
       p.merchant_id, m.name AS merchant_name, m.slug AS merchant_slug,
       o.id AS merchant_offer_id, o.price_amount AS price, o.currency, o.availability,
       o.shipping_available, o.shipping_countries_json, o.shipping_fee, o.estimated_days_min, o.estimated_days_max,
       ma.file_path AS primary_image_path, ma.alt_text AS primary_image_alt,
       p.average_rating, p.review_count, p.product_url
FROM products p
JOIN merchants m ON m.id = p.merchant_id
JOIN merchant_offers o ON o.variant_id = p.primary_variant_id AND o.is_current = 1
JOIN media_assets ma ON ma.product_id = p.id AND ma.role = 'primary'
WHERE p.status = 'active' AND m.status = 'active';

CREATE VIEW mcp_agent_visible_facts AS
SELECT f.merchant_id, f.product_id, f.attribute_key, f.value_json, f.evidence_state,
       c.exact_span, d.document_type, d.title AS evidence_title
FROM product_facts f
JOIN fact_evidence c ON c.fact_id = f.id
JOIN evidence_documents d ON d.id = c.document_id
WHERE f.approval_status = 'approved'
  AND f.visibility = 'AGENT_VISIBLE'
  AND f.evidence_state = 'DIRECT';

CREATE VIEW mcp_review_highlights AS
WITH ranked AS (
  SELECT r.product_id, r.id AS review_id, r.rating, r.title, r.body,
         a.aspect_key, a.sentiment, a.evidence_span,
         ROW_NUMBER() OVER (PARTITION BY r.product_id ORDER BY r.helpful_count DESC, r.id) AS position
  FROM reviews r JOIN review_aspects a ON a.review_id = r.id
  WHERE r.status = 'published'
)
SELECT * FROM ranked WHERE position <= 3;

CREATE VIEW mcp_ranked_product_options AS
SELECT sr.search_request_id, sr.rank, sr.product_id, p.canonical_product_id,
       p.merchant_id, m.name AS merchant_name, p.title, o.price_amount, o.currency,
       o.availability, o.shipping_available, o.shipping_fee, o.estimated_days_min, o.estimated_days_max,
       json_extract(sr.score_json,'$.match_score') AS match_score,
       sr.match_status, sr.requirement_results_json, sr.matched_keywords_json, sr.matched_attributes_json, sr.unknown_attributes_json, sr.reasons_json,
       p.product_url
FROM search_results sr
JOIN products p ON p.id=sr.product_id
JOIN merchants m ON m.id=p.merchant_id
JOIN merchant_offers o ON o.id=sr.merchant_offer_id;
