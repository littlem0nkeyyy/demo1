// Manual smoke test: spawns the real Machina MCP server over stdio and drives it with the
// SDK's own Client, exactly like a real agent would — not a unit test, run directly with tsx.
// v5: vertical-scoped (cross-merchant) by default, same as .mcp.json's MACHINA_VERTICAL.
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'mcp/server/src/index.ts'],
    cwd: repoRoot,
    env: { ...process.env } as Record<string, string>, // whole-database default (v6)
  });

  const client = new Client({ name: 'smoke-test-client', version: '0.0.1' });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log(
    'Tools registered:',
    tools.tools.map((t) => t.name)
  );

  console.log('\n--- search_products (cross-merchant, running_shoes) ---');
  const search = await client.callTool({
    name: 'search_products',
    arguments: {
      request_text: 'a neutral support shoe for track running, wide fit',
      max_results: 5,
      client: { name: 'smoke-test' },
    },
  });
  console.log(JSON.stringify(search.structuredContent, null, 2));

  console.log('\n--- get_product_details: M01-P0013 ---');
  const details = await client.callTool({
    name: 'get_product_details',
    arguments: { product_id: 'M01-P0013' },
  });
  console.log(JSON.stringify(details.structuredContent, null, 2));

  console.log('\n--- get_product_details: M02-P0001 (a DIFFERENT vertical — v6 default is whole-database, so this now legitimately succeeds) ---');
  const crossVertical = await client.callTool({
    name: 'get_product_details',
    arguments: { product_id: 'M02-P0001' },
  });
  console.log(JSON.stringify(crossVertical.structuredContent, null, 2));

  console.log('\n--- get_product_details: NOT-A-REAL-ID (must be not-found) ---');
  const unknown = await client.callTool({
    name: 'get_product_details',
    arguments: { product_id: 'NOT-A-REAL-ID' },
  });
  console.log('isError:', unknown.isError, JSON.stringify(unknown.content, null, 2));

  console.log('\n--- check_suitability: M01-P0013 / surface / track ---');
  const suit = await client.callTool({
    name: 'check_suitability',
    arguments: { product_id: 'M01-P0013', attribute: 'surface', requested_value: 'track' },
  });
  console.log(JSON.stringify(suit.structuredContent, null, 2));

  console.log('\n--- create_offer: M01-P0013 ---');
  const offer = await client.callTool({
    name: 'create_offer',
    arguments: { product_id: 'M01-P0013', quantity: 1 },
  });
  console.log(JSON.stringify(offer.structuredContent, null, 2));

  console.log('\n--- create_offer: NOT-A-REAL-ID (must fail) ---');
  const badOffer = await client.callTool({
    name: 'create_offer',
    arguments: { product_id: 'NOT-A-REAL-ID', quantity: 1 },
  });
  console.log('isError:', badOffer.isError, JSON.stringify(badOffer.content, null, 2));

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
