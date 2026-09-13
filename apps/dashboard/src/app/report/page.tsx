'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { ScoreCard } from '@/components/ScoreCard';
import { QueryResult } from '@/components/QueryResult';

type Bucket = 'SURFACE' | 'HARD' | 'UNRESOLVED' | 'unclassified';

interface BucketStats {
  n: number;
  baseline_top3: number;
  enriched_top3: number;
  baseline_mean_rank: number | null;
  enriched_mean_rank: number | null;
}

interface QueryDelta {
  query_id: string;
  query_text: string;
  bucket: Bucket;
  baseline_rank: number | null;
  enriched_rank: number | null;
}

interface Report {
  merchant_id: string;
  retrieval_method: string;
  embedding_model: string;
  overall: {
    baseline: { n: number; top1_count: number; top3_count: number; mean_rank: number | null };
    enriched: { n: number; top1_count: number; top3_count: number; mean_rank: number | null };
  };
  by_bucket: Record<Bucket, BucketStats>;
  regressions: QueryDelta[];
  improvements: QueryDelta[];
  unchanged: QueryDelta[];
  claim_sentence: string;
}

export default function ReportPage() {
  const searchParams = useSearchParams();
  const merchantQuery = searchParams.get('merchant') ? `?merchant=${searchParams.get('merchant')}` : '';

  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const freezeRes = await fetch(`/api/freeze${merchantQuery}`);
    const freezeJson = await freezeRes.json();
    setLocked(freezeJson.locked);

    const res = await fetch(`/api/report${merchantQuery}`);
    const json = await res.json();
    if (res.ok) {
      setReport(json);
      setError(null);
    } else {
      setReport(null);
      setError(json.error);
    }
  }, [merchantQuery]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function freeze() {
    setBusy('freeze');
    await fetch(`/api/freeze${merchantQuery}`, { method: 'POST' });
    await refresh();
    setBusy(null);
  }

  async function runBenchmark(variant: 'baseline' | 'enriched') {
    setBusy(variant);
    try {
      const res = await fetch(`/api/benchmark${merchantQuery}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Experiment Report</h1>
        <p className="text-sm text-machina-muted mt-1">
          Same held-out queries, same embedding model, same catalogue — the only variable is whether this
          merchant's approved attributes are present.
        </p>
      </div>

      <div className="card p-4 flex flex-wrap items-center gap-3">
        <button
          onClick={freeze}
          disabled={locked || busy === 'freeze'}
          className="px-3 py-1.5 text-sm rounded bg-machina-panel border border-machina-border hover:border-machina-accent disabled:opacity-40"
        >
          {locked ? 'Held-out set frozen ✓' : busy === 'freeze' ? 'Freezing…' : '1. Freeze held-out set'}
        </button>
        <button
          onClick={() => runBenchmark('baseline')}
          disabled={!locked || busy === 'baseline'}
          className="px-3 py-1.5 text-sm rounded bg-machina-panel border border-machina-border hover:border-machina-accent disabled:opacity-40"
        >
          {busy === 'baseline' ? 'Running…' : '2. Run baseline benchmark'}
        </button>
        <button
          onClick={() => runBenchmark('enriched')}
          disabled={!locked || busy === 'enriched'}
          className="px-3 py-1.5 text-sm rounded bg-machina-panel border border-machina-border hover:border-machina-accent disabled:opacity-40"
        >
          {busy === 'enriched' ? 'Running…' : '3. Run enriched benchmark'}
        </button>
      </div>

      {error && <div className="card p-3 text-sm text-machina-bad border-machina-bad/40">{error}</div>}

      {report && (
        <>
          <div className="card p-4 text-sm space-y-1">
            <p><span className="text-machina-muted">Merchant:</span> {report.merchant_id}</p>
            <p><span className="text-machina-muted">Retrieval method:</span> {report.retrieval_method}</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <ScoreCard label="Baseline Top-3" value={`${report.overall.baseline.top3_count}/${report.overall.baseline.n}`} />
            <ScoreCard label="Enriched Top-3" value={`${report.overall.enriched.top3_count}/${report.overall.enriched.n}`} tone="good" />
            <ScoreCard label="Baseline mean rank" value={report.overall.baseline.mean_rank?.toFixed(2) ?? '—'} />
            <ScoreCard label="Enriched mean rank" value={report.overall.enriched.mean_rank?.toFixed(2) ?? '—'} tone="good" />
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="card p-4">
              <h2 className="font-medium mb-2">Hard gaps (evidence-only)</h2>
              <p className="text-sm text-machina-muted mb-2">N = {report.by_bucket.HARD.n}</p>
              <p className="text-2xl font-semibold text-machina-accent">
                {report.by_bucket.HARD.baseline_top3}/{report.by_bucket.HARD.n} &rarr; {report.by_bucket.HARD.enriched_top3}/{report.by_bucket.HARD.n}
              </p>
            </div>
            <div className="card p-4">
              <h2 className="font-medium mb-2">Surface gaps (already inferable)</h2>
              <p className="text-sm text-machina-muted mb-2">N = {report.by_bucket.SURFACE.n}</p>
              <p className="text-2xl font-semibold text-machina-warn">
                {report.by_bucket.SURFACE.baseline_top3}/{report.by_bucket.SURFACE.n} &rarr; {report.by_bucket.SURFACE.enriched_top3}/{report.by_bucket.SURFACE.n}
              </p>
            </div>
            <div className="card p-4">
              <h2 className="font-medium mb-2">Unresolvable (no evidence exists)</h2>
              <p className="text-sm text-machina-muted mb-2">N = {report.by_bucket.UNRESOLVED.n}</p>
              <p className="text-2xl font-semibold text-machina-bad">
                {report.by_bucket.UNRESOLVED.baseline_top3}/{report.by_bucket.UNRESOLVED.n} &rarr; {report.by_bucket.UNRESOLVED.enriched_top3}/{report.by_bucket.UNRESOLVED.n}
              </p>
            </div>
          </div>

          <div className="card p-4">
            <h2 className="font-medium mb-2">Defensible claim</h2>
            <p className="text-sm">{report.claim_sentence}</p>
          </div>

          <div>
            <h2 className="font-medium mb-3">Regressions ({report.regressions.length})</h2>
            <div className="space-y-2">
              {report.regressions.map((q) => (
                <QueryResult key={q.query_id} queryText={q.query_text} bucket={q.bucket} baselineRank={q.baseline_rank} enrichedRank={q.enriched_rank} />
              ))}
              {report.regressions.length === 0 && <p className="text-sm text-machina-muted">None.</p>}
            </div>
          </div>

          <div>
            <h2 className="font-medium mb-3">Improvements ({report.improvements.length})</h2>
            <div className="space-y-2">
              {report.improvements.map((q) => (
                <QueryResult key={q.query_id} queryText={q.query_text} bucket={q.bucket} baselineRank={q.baseline_rank} enrichedRank={q.enriched_rank} />
              ))}
              {report.improvements.length === 0 && <p className="text-sm text-machina-muted">None.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
