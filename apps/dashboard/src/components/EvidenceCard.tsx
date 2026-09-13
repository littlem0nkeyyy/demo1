'use client';

import { useState } from 'react';

type VisibilityTier = 'AGENT_VISIBLE' | 'MATCHING_ONLY' | 'INTERNAL_ONLY';

interface PendingProposal {
  id: string;
  product_id: string;
  attribute_key: string;
  value: string | null;
  status: 'DIRECT' | 'AMBIGUOUS' | 'NONE';
  evidence_text: string | null;
  evidence_source: string | null;
}

const STATUS_LABEL: Record<PendingProposal['status'], string> = {
  DIRECT: '✓ DIRECT',
  AMBIGUOUS: '△ AMBIGUOUS',
  NONE: '✕ NONE',
};

const STATUS_COLOR: Record<PendingProposal['status'], string> = {
  DIRECT: 'bg-machina-accent/20 text-machina-accent',
  AMBIGUOUS: 'bg-machina-warn/20 text-machina-warn',
  NONE: 'bg-machina-bad/20 text-machina-bad',
};

const VISIBILITY_HINT: Record<VisibilityTier, string> = {
  AGENT_VISIBLE: 'Raw value + evidence shown to any calling agent.',
  MATCHING_ONLY: 'Used for ranking, but always reported as UNKNOWN to agents.',
  INTERNAL_ONLY: 'Excluded from matching and agent responses entirely.',
};

export function EvidenceCard({
  proposal,
  onDecide,
}: {
  proposal: PendingProposal;
  onDecide: (id: string, decision: 'approved' | 'rejected', visibility?: VisibilityTier) => void;
}) {
  const [visibility, setVisibility] = useState<VisibilityTier>('AGENT_VISIBLE');

  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">{proposal.product_id}</span>
        <span className="text-machina-muted">&middot;</span>
        <span className="text-machina-muted">{proposal.attribute_key}</span>
        <span className={`badge ${STATUS_COLOR[proposal.status]} ml-auto`}>{STATUS_LABEL[proposal.status]}</span>
      </div>
      <div className="text-lg font-semibold">
        {proposal.value ?? <span className="text-machina-muted italic">null (no value published)</span>}
      </div>
      {proposal.evidence_text ? (
        <blockquote className="text-sm text-machina-muted border-l-2 border-machina-border pl-3 italic">
          &ldquo;{proposal.evidence_text}&rdquo;
          {proposal.evidence_source && <div className="text-xs mt-1">— {proposal.evidence_source}</div>}
        </blockquote>
      ) : (
        <p className="text-sm text-machina-muted italic">No evidence span — nothing to cite.</p>
      )}
      <div className="flex items-center gap-2 pt-1">
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as VisibilityTier)}
          disabled={proposal.status === 'NONE'}
          className="bg-machina-panel border border-machina-border rounded px-2 py-1 text-xs text-machina-text disabled:opacity-40"
          title={VISIBILITY_HINT[visibility]}
        >
          <option value="AGENT_VISIBLE">Agent-visible</option>
          <option value="MATCHING_ONLY">Matching-only</option>
          <option value="INTERNAL_ONLY">Internal-only</option>
        </select>
        <button
          onClick={() => onDecide(proposal.id, 'approved', visibility)}
          disabled={proposal.status === 'NONE'}
          className="px-3 py-1 text-sm rounded bg-machina-accent/20 text-machina-accent hover:bg-machina-accent/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Approve
        </button>
        <button
          onClick={() => onDecide(proposal.id, 'rejected')}
          className="px-3 py-1 text-sm rounded bg-machina-bad/20 text-machina-bad hover:bg-machina-bad/30"
        >
          Reject
        </button>
      </div>
      <p className="text-xs text-machina-muted">{VISIBILITY_HINT[visibility]}</p>
    </div>
  );
}
