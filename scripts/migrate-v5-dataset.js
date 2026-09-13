// One-off migration for the v5 cross-merchant rebuild:
//   1. Generates data/ontologies/<vertical>.json for all 9 verticals from this dataset's
//      own categories.json + ontology_attributes.jsonl, so packages/schemas' loadOntology()
//      needs zero code changes.
//   2. Reshapes the running_shoes vertical from 1 merchant (M01) into 3 competing merchants
//      (M01 + new M10, M11) so search_products has something real to rank across merchants.
//      New merchants clone M01's 50 products (same canonical_product_id, same true facts —
//      it's the same physical product sold by a different retailer) with jittered
//      price/stock/shipping/rating so the deterministic multi-objective ranker has real
//      differences to weigh.
//
// Run once: node scripts/migrate-v5-dataset.js
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const JSONL_DIR = path.join(DATA_DIR, 'jsonl');

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(JSONL_DIR, file), 'utf-8'));
}
function readJsonl(file) {
  return fs
    .readFileSync(path.join(JSONL_DIR, file), 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}
function writeJson(file, data) {
  fs.writeFileSync(path.join(JSONL_DIR, file), JSON.stringify(data, null, 2));
}
function appendJsonl(file, rows) {
  const lines = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.appendFileSync(path.join(JSONL_DIR, file), lines);
}

function verticalSlug(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}

// ---------------------------------------------------------------------------
// Step 1: generate data/ontologies/<vertical>.json for all 9 verticals
// ---------------------------------------------------------------------------
function generateOntologies() {
  const categories = readJson('categories.json');
  const attrs = readJsonl('ontology_attributes.jsonl');
  const leafCategories = categories.filter((c) => c.parent_id !== null);

  const ontologiesDir = path.join(DATA_DIR, 'ontologies');
  fs.mkdirSync(ontologiesDir, { recursive: true });

  for (const cat of leafCategories) {
    const vertical = verticalSlug(cat.name);
    const catAttrs = attrs.filter((a) => a.category_id === cat.id);
    const attributes = {};
    for (const a of catAttrs) {
      attributes[a.attribute_key] = {
        type: a.data_type,
        values: JSON.parse(a.allowed_values_json),
      };
    }
    fs.writeFileSync(
      path.join(ontologiesDir, `${vertical}.json`),
      JSON.stringify({ vertical, attributes }, null, 2)
    );
    console.log(`ontology: ${vertical}.json (${catAttrs.length} attributes, from ${cat.id})`);
  }
  return leafCategories.map((c) => ({ ...c, vertical: verticalSlug(c.name) }));
}

// ---------------------------------------------------------------------------
// Step 2: reshape running_shoes (M01) into 3 competing merchants
// ---------------------------------------------------------------------------
function jitter(value, pct) {
  const factor = 1 + (Math.random() * 2 - 1) * pct;
  return Math.round(value * factor * 100) / 100;
}

function reshapeRunningShoes() {
  const SOURCE_MERCHANT = 'M01';
  const NEW_MERCHANTS = [
    {
      id: 'M10',
      name: 'Ridgemark Trailhead',
      legal_name: 'Ridgemark Trailhead Synthetic Pty Ltd',
      slug: 'ridgemark-trailhead',
      brandName: 'Ridgemark',
      // faster delivery, similar price, less stock
      priceJitter: 0.08,
      deliveryDelta: -1,
      stockFactor: 0.5,
      ratingDelta: -0.15,
    },
    {
      id: 'M11',
      name: 'Solace Track Supply',
      legal_name: 'Solace Track Supply Synthetic Pty Ltd',
      slug: 'solace-track-supply',
      brandName: 'Solace',
      // cheaper, slower delivery, more stock
      priceJitter: -0.15,
      deliveryDelta: 3,
      stockFactor: 1.8,
      ratingDelta: 0.1,
    },
  ];

  const merchants = readJson('merchants.json');
  const categories = readJson('categories.json');
  const brands = readJson('brands.json');
  const families = readJsonl('product_families.jsonl');
  const products = readJsonl('products.jsonl');
  const variants = readJsonl('product_variants.jsonl');
  const offers = readJsonl('merchant_offers.jsonl');
  const facts = readJsonl('product_facts.jsonl');

  const srcMerchant = merchants.find((m) => m.id === SOURCE_MERCHANT);
  const srcCategory = categories.find((c) => c.merchant_id === SOURCE_MERCHANT && c.parent_id !== null);
  const srcProducts = products.filter((p) => p.merchant_id === SOURCE_MERCHANT);
  const srcVariants = variants.filter((v) => v.merchant_id === SOURCE_MERCHANT);
  const srcOffers = offers.filter((o) => o.merchant_id === SOURCE_MERCHANT);
  const srcFacts = facts.filter((f) => f.merchant_id === SOURCE_MERCHANT);

  const newMerchantRows = [];
  const newCategoryRows = [];
  const newBrandRows = [];
  const newFamilyRows = [];
  const newProductRows = [];
  const newVariantRows = [];
  const newOfferRows = [];
  const newFactRows = [];

  for (const cfg of NEW_MERCHANTS) {
    newMerchantRows.push({
      ...srcMerchant,
      id: cfg.id,
      name: cfg.name,
      legal_name: cfg.legal_name,
      slug: cfg.slug,
      website_url: `https://example.invalid/${cfg.slug}`,
    });

    const categoryId = `${cfg.id}-CAT-RUNNING_SHOES`;
    newCategoryRows.push({ ...srcCategory, id: categoryId, merchant_id: cfg.id, parent_id: null, slug: `${cfg.id.toLowerCase()}-running-shoes` });

    const brandId = `${cfg.id}-BR01`;
    newBrandRows.push({ id: brandId, merchant_id: cfg.id, name: cfg.brandName, description: `A wholly fictional running shoes brand created for Machina testing.` });

    const familyId = `${cfg.id}-F1`;
    newFamilyRows.push({ id: familyId, merchant_id: cfg.id, brand_id: brandId, category_id: categoryId, name: `${cfg.brandName} Line`, archetype: 'running_shoes-1' });

    for (const srcProduct of srcProducts) {
      const suffix = srcProduct.id.split('-P')[1]; // e.g. "0001"
      const newProductId = `${cfg.id}-P${suffix}`;
      const newVariantId = `${newProductId}-V1`;

      const srcVariant = srcVariants.find((v) => v.id === srcProduct.primary_variant_id) || srcVariants.find((v) => v.product_id === srcProduct.id);
      const srcOffer = srcOffers.find((o) => o.variant_id === (srcVariant && srcVariant.id));

      const title = srcProduct.title.replace('Velora', cfg.brandName);

      newProductRows.push({
        ...srcProduct,
        id: newProductId,
        merchant_id: cfg.id,
        family_id: familyId,
        brand_id: brandId,
        category_id: categoryId,
        merchant_product_code: `${cfg.id}-${suffix}`,
        slug: `${cfg.slug}-${suffix}`,
        title,
        subtitle: srcProduct.subtitle,
        primary_variant_id: newVariantId,
        product_url: `https://example.invalid/${cfg.slug}/products/${cfg.slug}-${suffix}`,
        average_rating: Math.max(1, Math.min(5, Math.round((srcProduct.average_rating + cfg.ratingDelta) * 10) / 10)),
        review_count: Math.max(0, Math.round(srcProduct.review_count * cfg.stockFactor)),
      });

      if (srcVariant) {
        newVariantRows.push({
          ...srcVariant,
          id: newVariantId,
          merchant_id: cfg.id,
          product_id: newProductId,
          sku: `${cfg.id}-${suffix}-1`,
        });
      }

      if (srcOffer) {
        const newPrice = jitter(srcOffer.price_amount, Math.abs(cfg.priceJitter)) * (cfg.priceJitter < 0 ? 1 - Math.abs(cfg.priceJitter) : 1 + cfg.priceJitter);
        newOfferRows.push({
          ...srcOffer,
          id: `OFFER-${newProductId}-V1`,
          product_id: newProductId,
          variant_id: newVariantId,
          merchant_id: cfg.id,
          price_amount: Math.round(newPrice * 100) / 100,
          availability: 'in_stock',
          stock_quantity: Math.max(1, Math.round((srcOffer.stock_quantity || 10) * cfg.stockFactor) || Math.round(10 * cfg.stockFactor)),
          shipping_available: 1,
          estimated_days_min: Math.max(1, srcOffer.estimated_days_min + cfg.deliveryDelta),
          estimated_days_max: Math.max(2, srcOffer.estimated_days_max + cfg.deliveryDelta),
        });
      }

      const productFacts = srcFacts.filter((f) => f.product_id === srcProduct.id);
      productFacts.forEach((f, i) => {
        newFactRows.push({
          ...f,
          id: `FACT-${newProductId}-${String(i + 1).padStart(2, '0')}`,
          merchant_id: cfg.id,
          product_id: newProductId,
        });
      });
    }
  }

  writeJson('merchants.json', [...merchants, ...newMerchantRows]);
  writeJson('categories.json', [...categories, ...newCategoryRows]);
  writeJson('brands.json', [...brands, ...newBrandRows]);
  appendJsonl('product_families.jsonl', newFamilyRows);
  appendJsonl('products.jsonl', newProductRows);
  appendJsonl('product_variants.jsonl', newVariantRows);
  appendJsonl('merchant_offers.jsonl', newOfferRows);
  appendJsonl('product_facts.jsonl', newFactRows);

  console.log(`reshape: added merchants ${NEW_MERCHANTS.map((c) => c.id).join(', ')} — ${newProductRows.length} products, ${newOfferRows.length} offers, ${newFactRows.length} facts`);
}

generateOntologies();
reshapeRunningShoes();
console.log('done');
