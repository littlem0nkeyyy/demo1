#!/usr/bin/env node
import path from 'path';
import dotenv from 'dotenv';
// Self-sufficient regardless of how this process is launched (npm script with
// `-r dotenv/config`, or directly via .mcp.json's `npx tsx ...`, which does not preload
// anything). This file runs as a plain Node process (never bundled), so __dirname is
// reliable here.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
process.env.MACHINA_REPO_ROOT = path.resolve(__dirname, '../../..');

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  SearchProductsInputSchema,
  SearchProductsOutputSchema,
  GetProductDetailsInputSchema,
  GetProductDetailsOutputSchema,
  CheckSuitabilityInputSchema,
  CheckSuitabilityOutputSchema,
  CreateOfferInputSchema,
  CreateOfferOutputSchema,
} from '@machina/schemas';
import fs from 'fs';
import { getMerchant, getMerchantVertical, listMerchantsInVertical } from '@machina/database';
import { searchProducts, checkSuitability, createOffer, getProductDetails } from '@machina/core';

const SOURCE = 'mcp';

// v6 tenancy model: whole-database by default (search_products classifies which vertical a
// request is about, per call — see packages/core/src/llm/classifyVertical.ts). Two optional,
// strictly narrower tiers, unchanged from v5: MACHINA_VERTICAL (cross-merchant within one
// vertical, classification skipped) and MACHINA_MERCHANT_ID (single merchant, narrowest).
// Set via .mcp.json's "env" (default: neither, i.e. {}), or directly when running
// `npm run mcp:server`.
const merchantId = process.env.MACHINA_MERCHANT_ID;
let vertical: string | undefined = process.env.MACHINA_VERTICAL;

if (merchantId) {
  const merchant = getMerchant(merchantId);
  if (!merchant) {
    console.error(`Unknown merchant_id: ${merchantId}. Run npm run db:seed first, or check MACHINA_MERCHANT_ID.`);
    process.exit(1);
  }
  const merchantVertical = getMerchantVertical(merchantId);
  if (!merchantVertical) {
    console.error(`Could not resolve a vertical for merchant ${merchantId}.`);
    process.exit(1);
  }
  if (vertical && vertical !== merchantVertical) {
    console.error(`MACHINA_VERTICAL=${vertical} conflicts with MACHINA_MERCHANT_ID=${merchantId}'s own vertical (${merchantVertical}).`);
    process.exit(1);
  }
  vertical = merchantVertical;
} else if (vertical && listMerchantsInVertical(vertical).length === 0) {
  console.error(`No active merchants found in vertical "${vertical}". Run npm run db:seed first, or check MACHINA_VERTICAL.`);
  process.exit(1);
}

const ctx = { merchantId, vertical };

const server = new McpServer({ name: 'machina', version: '0.1.0' });

function structured<T extends Record<string, unknown>>(result: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}

const MIME_BY_EXT: Record<string, string> = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

// Reads a product's primary image off disk and returns it as an MCP image content block
// (base64), so the calling agent can actually render it inline instead of only seeing a
// file path string in JSON. Only ever the ONE primary image, and only for
// get_product_details (a single product a buyer is actively looking at) — not
// search_products, which would multiply this by every returned candidate.
function loadPrimaryImageContent(relativePath: string): { type: 'image'; data: string; mimeType: string } | null {
  try {
    const fullPath = path.join(process.env.MACHINA_REPO_ROOT!, 'data', relativePath);
    const bytes = fs.readFileSync(fullPath);
    const ext = path.extname(relativePath).toLowerCase();
    return { type: 'image', data: bytes.toString('base64'), mimeType: MIME_BY_EXT[ext] ?? 'application/octet-stream' };
  } catch {
    return null; // asset not present locally — degrade to the file-path-only JSON, no crash
  }
}

server.registerTool(
  'search_products',
  {
    title: 'Search Products',
    description:
      "Find products in the merchant's verified catalogue for a natural-language shopping request. " +
      'Returns a request-level status (VERIFIED / PARTIAL / INSUFFICIENT_DATA / NO_MATCH / CLARIFICATION_REQUIRED) ' +
      'and, per product, a per-requirement breakdown (VERIFIED_MATCH / VERIFIED_NON_MATCH / UNKNOWN). ' +
      'UNKNOWN is not the same as non-match — it means Machina has no approved evidence either way. ' +
      'Never upgrade PARTIAL to VERIFIED when presenting this to a user.',
    inputSchema: SearchProductsInputSchema.shape,
    outputSchema: SearchProductsOutputSchema.shape,
  },
  async (input) => {
    const result = await searchProducts(input, { source: input.client?.name ?? SOURCE, merchantId: ctx.merchantId, vertical: ctx.vertical });
    return structured(result);
  }
);

const detailsCtx = { vertical: ctx.vertical, merchantId: ctx.merchantId };

server.registerTool(
  'get_product_details',
  {
    title: 'Get Product Details',
    description:
      'Return a product\'s approved structured attributes plus provenance (evidence text and source). ' +
      'Only ever returns approved facts — a pending or rejected proposal never appears here.',
    inputSchema: GetProductDetailsInputSchema.shape,
    outputSchema: GetProductDetailsOutputSchema.shape,
  },
  async (input) => {
    const result = getProductDetails(input, detailsCtx);
    if (!result) {
      return {
        content: [{ type: 'text' as const, text: `Unknown product_id: ${input.product_id}` }],
        isError: true,
      };
    }
    const base = structured(result);
    const primaryImage = result.images[0] ? loadPrimaryImageContent(result.images[0].url) : null;
    return primaryImage ? { ...base, content: [...base.content, primaryImage] } : base;
  }
);

server.registerTool(
  'check_suitability',
  {
    title: 'Check Suitability',
    description:
      'Answer SUITABLE / NOT_SUITABLE / INSUFFICIENT_DATA for one product and one requirement, based only on ' +
      "approved evidence. INSUFFICIENT_DATA means Machina genuinely doesn't know, not that the product fails.",
    inputSchema: CheckSuitabilityInputSchema.shape,
    outputSchema: CheckSuitabilityOutputSchema.shape,
  },
  async (input) => structured(checkSuitability(input, detailsCtx))
);

server.registerTool(
  'create_offer',
  {
    title: 'Create Offer',
    description:
      'Create a machine-readable, non-binding draft offer for a product. MVP mock only — no real payment or ' +
      'checkout occurs.',
    inputSchema: CreateOfferInputSchema.shape,
    outputSchema: CreateOfferOutputSchema.shape,
  },
  async (input) => structured(createOffer(input, detailsCtx))
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const scopeDescription = ctx.merchantId
    ? `merchant ${ctx.merchantId} (${ctx.vertical})`
    : ctx.vertical
    ? `vertical ${ctx.vertical}`
    : 'the whole database (vertical classified per request)';
  console.error(`Machina MCP server running on stdio, scoped to ${scopeDescription}.`);
}

main().catch((err) => {
  console.error('Machina MCP server failed to start:', err);
  process.exit(1);
});
