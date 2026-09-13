import { computeGaps } from '@machina/core';
import { listCandidates, listPendingProposals, isLocked, listMerchantsInVertical, aggregateAttributeDemand, countSearchRequests, getMerchantVertical } from '@machina/database';
import { ScoreCard } from '@/components/ScoreCard';
import { resolveMerchant } from '@/lib/currentMerchant';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ merchant?: string }>;
}) {
  const { merchant: requestedMerchant } = await searchParams;
  const merchant = resolveMerchant(requestedMerchant);
  const vertical = getMerchantVertical(merchant.id) ?? 'unknown';

  const products = listCandidates(vertical, merchant.id);
  const gaps = computeGaps(merchant.id, vertical);
  const pending = listPendingProposals(merchant.id);
  const heldOutLocked = isLocked(merchant.id, 'held_out');
  const hasApiKey = !!process.env.OPENAI_API_KEY;
  const merchantIdsInVertical = listMerchantsInVertical(vertical).map((m) => m.id);
  const requestCount = countSearchRequests(merchantIdsInVertical);
  const demand = aggregateAttributeDemand(merchantIdsInVertical);

  const hardGaps = gaps.filter((g) => g.gap_type === 'hard').length;
  const surfaceGaps = gaps.filter((g) => g.gap_type === 'surface').length;

  const demandRows = Object.entries(demand.requested)
    .map(([attr, requested]) => ({ attr, requested, unmet: demand.unmet[attr] ?? 0 }))
    .sort((a, b) => b.requested - a.requested);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">{merchant.name} — Merchant Intelligence Dashboard</h1>
        <p className="text-sm text-machina-muted mt-1">
          {merchant.id} &middot; {vertical} &middot; {merchant.default_currency}. Machina is a
          cross-merchant MCP product discovery layer — this view is scoped to one merchant, but MCP
          search for this vertical spans every active merchant in it.
        </p>
      </div>

      {!hasApiKey && (
        <div className="card p-4 border-machina-warn/40">
          <h2 className="font-medium text-machina-warn">No OpenAI API key yet</h2>
          <p className="text-sm text-machina-muted mt-1">
            Everything here already works without one (the catalogue is bulk-seeded). Live buyer-language
            normalization, evidence extraction, vertical classification, and the MCP server's live search
            need a key. Add it to <code className="text-machina-text">.env</code> at the repo root:
          </p>
          <pre className="text-xs bg-machina-bg border border-machina-border rounded p-2 mt-2 overflow-x-auto">OPENAI_API_KEY=sk-...</pre>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <ScoreCard label="Catalogue size" value={String(products.length)} sublabel={vertical} />
        <ScoreCard label="Detected gaps" value={String(gaps.length)} sublabel={`${hardGaps} hard, ${surfaceGaps} surface`} tone={hardGaps > 0 ? 'warn' : 'neutral'} />
        <ScoreCard
          label="Held-out set"
          value={heldOutLocked ? 'Frozen' : 'Not frozen'}
          sublabel={heldOutLocked ? 'locked, ready to benchmark' : 'freeze on the Report page'}
          tone={heldOutLocked ? 'good' : 'warn'}
        />
        <ScoreCard label="Approval queue" value={String(pending.length)} sublabel="pending proposals" tone={pending.length > 0 ? 'warn' : 'neutral'} />
      </div>

      <div className="card p-4">
        <h2 className="font-medium mb-3">Demand — what agents are asking for ({requestCount} logged searches, this vertical)</h2>
        <div className="space-y-1 text-sm">
          {demandRows.map((d) => (
            <div key={d.attr} className="flex items-center gap-3 py-1 border-b border-machina-border last:border-0">
              <span className="flex-1">{d.attr}</span>
              <span className="text-machina-muted">requested {d.requested}x</span>
              <span className={d.unmet > 0 ? 'text-machina-warn' : 'text-machina-muted'}>unmet {d.unmet}x</span>
            </div>
          ))}
          {demandRows.length === 0 && (
            <p className="text-machina-muted">No demand recorded yet — run a live search_products call via the skill/MCP.</p>
          )}
        </div>
      </div>

      <div className="card p-4">
        <h2 className="font-medium mb-2">Merchant approval queue</h2>
        <p className="text-sm text-machina-muted">
          {pending.length} proposal{pending.length === 1 ? '' : 's'} awaiting review.{' '}
          <a href={`/approval?merchant=${merchant.id}`} className="text-machina-accent underline">Go to Approval &rarr;</a>
        </p>
      </div>

      <div className="card p-4">
        <h2 className="font-medium mb-3">Catalogue gaps — buyer demand &times; missing coverage</h2>
        <div className="space-y-1 text-sm">
          {gaps.slice(0, 10).map((g, i) => (
            <div key={i} className="flex items-center gap-3 py-1 border-b border-machina-border last:border-0">
              <span className="text-machina-muted w-10 text-right">{g.priority.toFixed(2)}</span>
              <span className="flex-1">{g.product_id}</span>
              <span className="text-machina-muted">{g.attribute_key}</span>
              <span className={`badge ${g.gap_type === 'hard' ? 'bg-machina-accent/20 text-machina-accent' : 'bg-machina-warn/20 text-machina-warn'}`}>
                {g.gap_type}
              </span>
            </div>
          ))}
          {gaps.length === 0 && (
            <p className="text-machina-muted">
              No demand-backed gaps yet — run buyer-language normalization on the gap-mining query set first.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
