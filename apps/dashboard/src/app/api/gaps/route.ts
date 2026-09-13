import { NextRequest, NextResponse } from 'next/server';
import { computeGaps, normalizeBuyerLanguage } from '@machina/core';
import { listQueries, setNormalizedRequirement, getMerchantVertical } from '@machina/database';
import { resolveMerchantFromRequest } from '@/lib/currentMerchant';

export async function GET(req: NextRequest) {
  try {
    const merchant = resolveMerchantFromRequest(req);
    const vertical = getMerchantVertical(merchant.id)!;
    const gaps = computeGaps(merchant.id, vertical);
    return NextResponse.json({ gaps });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// Runs LLM job 1 (buyer-language normalization) over any not-yet-normalized gap-mining
// queries for this merchant, then returns the freshly computed gaps. This never touches the
// held_out set. Bulk-seeded demand queries already carry normalized_requirement_json (their
// pre-given structured filters), so this is typically a no-op unless new queries were added.
export async function POST(req: NextRequest) {
  try {
    const merchant = resolveMerchantFromRequest(req);
    const vertical = getMerchantVertical(merchant.id)!;
    const queries = listQueries(merchant.id, 'gap_mining').filter((q) => !q.normalized_requirement_json);
    for (const q of queries) {
      const reqs = await normalizeBuyerLanguage(q.text, vertical);
      setNormalizedRequirement(q.id, reqs);
    }
    const gaps = computeGaps(merchant.id, vertical);
    return NextResponse.json({ normalized: queries.length, gaps });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
