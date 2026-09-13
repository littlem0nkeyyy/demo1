import { NextRequest, NextResponse } from 'next/server';
import { isLocked, listQueries } from '@machina/database';
import { freezeHeldOutSet } from '@machina/retrieval';
import { resolveMerchantFromRequest } from '@/lib/currentMerchant';

export async function GET(req: NextRequest) {
  const merchant = resolveMerchantFromRequest(req);
  return NextResponse.json({ locked: isLocked(merchant.id, 'held_out'), count: listQueries(merchant.id, 'held_out').length });
}

// §10 Step 1: freeze one merchant's held-out eval set before any enrichment happens.
export async function POST(req: NextRequest) {
  try {
    const merchant = resolveMerchantFromRequest(req);
    const result = freezeHeldOutSet(merchant.id);
    return NextResponse.json({ locked: true, already: result.alreadyLocked, count: result.count });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
