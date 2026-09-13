import { lockQuerySet, isLocked, listQueries } from '@machina/database';

// §10 Step 1: freeze one merchant's held-out eval set before any enrichment happens. After
// this runs, BuyerQuery.insertQuery will refuse further inserts/updates against that
// merchant's 'held_out' set.
export function freezeHeldOutSet(merchantId: string): { alreadyLocked: boolean; count: number } {
  if (isLocked(merchantId, 'held_out')) {
    return { alreadyLocked: true, count: listQueries(merchantId, 'held_out').length };
  }
  const queries = listQueries(merchantId, 'held_out');
  if (queries.length === 0) {
    throw new Error(`No held-out queries found for merchant ${merchantId} — run npm run db:seed first.`);
  }
  lockQuerySet(merchantId, 'held_out');
  return { alreadyLocked: false, count: queries.length };
}

function main() {
  const merchantId = process.argv[2] || process.env.MACHINA_MERCHANT_ID;
  if (!merchantId) {
    console.error('Usage: tsx freezeQuerySet.ts <merchant_id>  (or set MACHINA_MERCHANT_ID)');
    process.exit(1);
  }
  const result = freezeHeldOutSet(merchantId);
  if (result.alreadyLocked) {
    console.log(`Held-out query set for ${merchantId} is already locked. No action taken.`);
  } else {
    console.log(`Locked ${result.count} held-out queries for ${merchantId}. This set is now frozen and cannot be edited.`);
  }
}

if (require.main === module) {
  main();
}
