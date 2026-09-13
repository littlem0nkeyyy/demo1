import { NextRequest, NextResponse } from 'next/server';
import { decideProposal, listPendingProposalsWithEvidence } from '@machina/database';
import type { VisibilityTier } from '@machina/schemas';
import { resolveMerchantFromRequest } from '@/lib/currentMerchant';

export async function GET(req: NextRequest) {
  const merchant = resolveMerchantFromRequest(req);
  return NextResponse.json({ pending: listPendingProposalsWithEvidence(merchant.id) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { log_id, decision, approved_by, visibility } = body as {
    log_id?: string;
    decision?: 'approved' | 'rejected';
    approved_by?: string;
    visibility?: VisibilityTier;
  };
  if (!log_id || (decision !== 'approved' && decision !== 'rejected')) {
    return NextResponse.json({ error: 'log_id and decision (approved|rejected) are required' }, { status: 400 });
  }
  try {
    decideProposal(log_id, decision, approved_by || 'merchant', visibility);
    return NextResponse.json({ id: log_id, decision });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
