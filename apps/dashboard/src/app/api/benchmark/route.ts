import { NextRequest, NextResponse } from 'next/server';
import { runBenchmark, querySetHash } from '@machina/retrieval';
import { recordRun, allRuns, isLocked, listQueries, getMerchantVertical } from '@machina/database';
import { resolveMerchantFromRequest } from '@/lib/currentMerchant';

export async function GET(req: NextRequest) {
  const merchant = resolveMerchantFromRequest(req);
  return NextResponse.json({ runs: allRuns(merchant.id) });
}

export async function POST(req: NextRequest) {
  const merchant = resolveMerchantFromRequest(req);
  const body = await req.json();
  const { variant } = body as { variant?: 'baseline' | 'enriched' };
  if (variant !== 'baseline' && variant !== 'enriched') {
    return NextResponse.json({ error: "variant must be 'baseline' or 'enriched'" }, { status: 400 });
  }
  if (!isLocked(merchant.id, 'held_out')) {
    return NextResponse.json(
      { error: 'Held-out query set is not frozen yet. Freeze it on the Report page before benchmarking.' },
      { status: 400 }
    );
  }

  try {
    const vertical = getMerchantVertical(merchant.id)!;
    const result = await runBenchmark(merchant.id, vertical, variant);
    const hash = querySetHash(listQueries(merchant.id, 'held_out').map((q) => q.text));
    const runId = recordRun({
      merchant_id: merchant.id,
      catalogue_variant: variant,
      embedding_model: result.embedding_model,
      retrieval_method: result.retrieval_method,
      query_set_hash: hash,
      results: result,
    });
    return NextResponse.json({ run_id: runId, ...result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
