import { NextResponse } from 'next/server';
import { listMerchants, getMerchantVertical } from '@machina/database';

export async function GET() {
  const merchants = listMerchants().map((m) => ({ ...m, vertical: getMerchantVertical(m.id) ?? 'unknown' }));
  return NextResponse.json({ merchants });
}
