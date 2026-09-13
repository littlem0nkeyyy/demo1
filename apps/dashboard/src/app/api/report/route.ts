import { NextRequest, NextResponse } from 'next/server';
import { buildReport } from '@machina/retrieval';
import { resolveMerchantFromRequest } from '@/lib/currentMerchant';

export async function GET(req: NextRequest) {
  try {
    const merchant = resolveMerchantFromRequest(req);
    const report = buildReport(merchant.id);
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
