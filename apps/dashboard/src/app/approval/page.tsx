'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { EvidenceCard } from '@/components/EvidenceCard';

interface Gap {
  product_id: string;
  attribute_key: string;
  gap_type: 'surface' | 'hard';
  matched_rule: string | null;
  priority: number;
}

interface PendingProposal {
  id: string;
  product_id: string;
  attribute_key: string;
  value: string | null;
  status: 'DIRECT' | 'AMBIGUOUS' | 'NONE';
  evidence_text: string | null;
  evidence_source: string | null;
}

export default function ApprovalPage() {
  const searchParams = useSearchParams();
  const merchantQuery = searchParams.get('merchant') ? `?merchant=${searchParams.get('merchant')}` : '';

  const [gaps, setGaps] = useState<Gap[]>([]);
  const [pending, setPending] = useState<PendingProposal[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [gapsRes, pendingRes] = await Promise.all([fetch(`/api/gaps${merchantQuery}`), fetch(`/api/approve${merchantQuery}`)]);
    const gapsJson = await gapsRes.json();
    const pendingJson = await pendingRes.json();
    setGaps(gapsJson.gaps ?? []);
    setPending(pendingJson.pending ?? []);
  }, [merchantQuery]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function runNormalization() {
    setBusyKey('normalize');
    setError(null);
    try {
      const res = await fetch(`/api/gaps${merchantQuery}`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  async function extract(gap: Gap) {
    setBusyKey(`${gap.product_id}:${gap.attribute_key}`);
    setError(null);
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: gap.product_id, attribute_key: gap.attribute_key }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  async function decide(id: string, decision: 'approved' | 'rejected', visibility?: 'AGENT_VISIBLE' | 'MATCHING_ONLY' | 'INTERNAL_ONLY') {
    setBusyKey(`decide-${id}`);
    setError(null);
    try {
      const res = await fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ log_id: id, decision, visibility }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  const openGaps = gaps.filter((g) => !pending.some((p) => p.product_id === g.product_id && p.attribute_key === g.attribute_key));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Merchant Approval</h1>
        <p className="text-sm text-machina-muted mt-1">
          Every proposed attribute shows its evidence span and tri-state status. Nothing publishes without your
          approval, and nothing is ever silently overwritten. Choosing a visibility tier on approval is CONTROL
          (§3/§8): Machina can use Matching-only/Internal-only data to rank products without ever disclosing it
          to a calling agent.
        </p>
      </div>

      {error && <div className="card p-3 text-sm text-machina-bad border-machina-bad/40">{error}</div>}

      <div className="card p-4 flex items-center justify-between">
        <div>
          <h2 className="font-medium">Step 1 — Buyer-language demand</h2>
          <p className="text-sm text-machina-muted">
            Normalize any not-yet-normalized gap-mining queries so gap priority reflects real demand. Bulk-seeded
            demand queries already carry their normalized filters, so this is usually a no-op unless new queries
            were added.
          </p>
        </div>
        <button
          onClick={runNormalization}
          disabled={busyKey === 'normalize'}
          className="px-3 py-1.5 text-sm rounded bg-machina-accent/20 text-machina-accent hover:bg-machina-accent/30 disabled:opacity-40"
        >
          {busyKey === 'normalize' ? 'Running…' : 'Run normalization'}
        </button>
      </div>

      <div>
        <h2 className="font-medium mb-3">Step 2 — Extract evidence for a gap ({openGaps.length} open)</h2>
        <div className="space-y-2">
          {openGaps.slice(0, 15).map((g) => {
            const key = `${g.product_id}:${g.attribute_key}`;
            return (
              <div key={key} className="card p-3 flex items-center gap-3 text-sm">
                <span className="flex-1">{g.product_id}</span>
                <span className="text-machina-muted">{g.attribute_key}</span>
                <span className={`badge ${g.gap_type === 'hard' ? 'bg-machina-accent/20 text-machina-accent' : 'bg-machina-warn/20 text-machina-warn'}`}>
                  {g.gap_type}
                </span>
                <button
                  onClick={() => extract(g)}
                  disabled={busyKey === key}
                  className="px-2 py-1 text-xs rounded bg-machina-panel border border-machina-border hover:border-machina-accent disabled:opacity-40"
                >
                  {busyKey === key ? 'Extracting…' : 'Extract evidence'}
                </button>
              </div>
            );
          })}
          {openGaps.length === 0 && (
            <p className="text-sm text-machina-muted">No open gaps — run normalization first, or everything is already proposed/approved.</p>
          )}
        </div>
      </div>

      <div>
        <h2 className="font-medium mb-3">Step 3 — Review &amp; approve ({pending.length} pending)</h2>
        <div className="space-y-3">
          {pending.map((p) => (
            <EvidenceCard key={p.id} proposal={p} onDecide={decide} />
          ))}
          {pending.length === 0 && <p className="text-sm text-machina-muted">Nothing awaiting review.</p>}
        </div>
      </div>
    </div>
  );
}
