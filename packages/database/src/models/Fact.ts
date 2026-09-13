import { getDb } from '../connection';
import type { EvidenceState, ApprovalStatus, VisibilityTier } from '@machina/schemas';

// v5 invariant change (intentional, see the approved migration plan): product_facts is
// updated in place and fact_decisions is the append-only audit log of every transition —
// unlike the old single-merchant schema where attribute_log itself was append-only and
// "current" was derived by taking the latest row. We adopt this dataset's own native
// pattern rather than forcing the old one onto it.

export interface FactRow {
  id: string;
  merchant_id: string;
  product_id: string;
  attribute_key: string;
  value_json: string | null;
  evidence_state: EvidenceState;
  visibility: VisibilityTier;
  approval_status: ApprovalStatus;
  confidence: number;
  created_at: string;
}

// Some attributes (e.g. capacity_litres) store a JSON number, but the matching pipeline
// treats every attribute as string vocabulary (strict `===` against the ontology's own
// string values, coerced the same way in packages/schemas/src/ontology.ts) — always coerce
// to string here so a fact's value type never silently disagrees with the ontology's.
function parseValue(valueJson: string | null): string | null {
  if (valueJson === null) return null;
  try {
    return String(JSON.parse(valueJson));
  } catch {
    return valueJson;
  }
}

export function getFact(id: string): FactRow | undefined {
  return getDb().prepare('SELECT * FROM product_facts WHERE id = ?').get(id) as FactRow | undefined;
}

export function listPendingProposals(merchantId: string): FactRow[] {
  return getDb()
    .prepare(`SELECT * FROM product_facts WHERE merchant_id = ? AND approval_status = 'pending' ORDER BY product_id, attribute_key`)
    .all(merchantId) as FactRow[];
}

export interface PendingProposalWithEvidence {
  id: string;
  product_id: string;
  attribute_key: string;
  value: string | null;
  status: EvidenceState;
  evidence_text: string | null;
  evidence_source: string | null;
}

// Same as listPendingProposals, but joined to its evidence span/source for the Approval
// page's evidence card — a pending fact created via the Approval page's "Extract evidence"
// step has exactly one fact_evidence row; bulk-seeded facts may have several, so this takes
// the first (any real span is representative for display purposes).
export function listPendingProposalsWithEvidence(merchantId: string): PendingProposalWithEvidence[] {
  const rows = getDb()
    .prepare(
      `SELECT f.id, f.product_id, f.attribute_key, f.value_json, f.evidence_state,
              c.exact_span AS evidence_text, d.title AS evidence_source
       FROM product_facts f
       LEFT JOIN fact_evidence c ON c.fact_id = f.id
       LEFT JOIN evidence_documents d ON d.id = c.document_id
       WHERE f.merchant_id = ? AND f.approval_status = 'pending'
       GROUP BY f.id
       ORDER BY f.product_id, f.attribute_key`
    )
    .all(merchantId) as (Omit<PendingProposalWithEvidence, 'value' | 'status'> & { value_json: string | null; evidence_state: EvidenceState })[];
  return rows.map((r) => ({
    id: r.id,
    product_id: r.product_id,
    attribute_key: r.attribute_key,
    value: parseValue(r.value_json),
    status: r.evidence_state,
    evidence_text: r.evidence_text,
    evidence_source: r.evidence_source,
  }));
}

// Proposes a brand-new fact for a product/attribute that has none yet — the Approval page's
// "Extract evidence for a gap" step. Enforces the tri-state contract in code: NONE must
// never carry a value, no matter what the LLM said (same defense-in-depth as extractEvidence
// itself).
export function proposeFact(input: {
  merchant_id: string;
  product_id: string;
  attribute_key: string;
  value: string | null;
  status: EvidenceState;
  evidence_span: string | null;
  evidence_document_id: string | null;
  confidence?: number;
}): string {
  const id = `FACT-${input.product_id}-${input.attribute_key}-${Date.now()}`;
  const value = input.status === 'NONE' ? null : input.value;
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO product_facts (id, merchant_id, product_id, attribute_key, value_json, evidence_state, visibility, approval_status, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'AGENT_VISIBLE', 'pending', ?, datetime('now'))`
    ).run(id, input.merchant_id, input.product_id, input.attribute_key, value === null ? null : JSON.stringify(value), input.status, input.confidence ?? 0.8);
    if (input.evidence_document_id) {
      db.prepare(`INSERT INTO fact_evidence (id, fact_id, document_id, exact_span, section) VALUES (?, ?, ?, ?, ?)`).run(
        `EV-${id}`,
        id,
        input.evidence_document_id,
        input.evidence_span,
        'extracted'
      );
    }
  });
  tx();
  return id;
}

// Approve/reject: updates product_facts in place and appends the transition to
// fact_decisions. `visibility` lets the merchant pick the CONTROL tier at approval time
// (defaults to the fact's current tier when not specified); meaningless on a rejection.
export function decideProposal(id: string, decision: 'approved' | 'rejected', decidedBy: string, visibility?: VisibilityTier, reason = ''): void {
  const row = getFact(id);
  if (!row) throw new Error(`product_facts row ${id} not found`);
  const db = getDb();
  const finalVisibility = visibility ?? row.visibility;
  const tx = db.transaction(() => {
    db.prepare('UPDATE product_facts SET approval_status = ?, visibility = ? WHERE id = ?').run(decision, finalVisibility, id);
    db.prepare(
      `INSERT INTO fact_decisions (id, fact_id, decision, visibility, decided_by, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(`DEC-${id}-${Date.now()}`, id, decision, finalVisibility, decidedBy, reason);
  });
  tx();
}

export interface ApprovedFact {
  value: string | null;
  status: EvidenceState;
  visibility: VisibilityTier;
}

// Current approved value per attribute for a product — ALL visibility tiers included
// (matching is allowed to use MATCHING_ONLY/INTERNAL_ONLY internally; only the response
// boundary in disclosurePolicy.ts / matchingCore's evaluateRequirement filters it).
export function getApprovedFacts(productId: string): Record<string, ApprovedFact> {
  const rows = getDb()
    .prepare(`SELECT * FROM product_facts WHERE product_id = ? AND approval_status = 'approved'`)
    .all(productId) as FactRow[];
  const out: Record<string, ApprovedFact> = {};
  for (const r of rows) out[r.attribute_key] = { value: parseValue(r.value_json), status: r.evidence_state, visibility: r.visibility };
  return out;
}

export interface FactWithEvidence extends ApprovedFact {
  attribute: string;
  evidence_text: string | null;
  evidence_source: string | null;
}

// Same as above but with provenance (evidence span + document title) for
// get_product_details — this dataset's evidence lives in fact_evidence/evidence_documents
// rather than inline on the fact row.
export function getApprovedFactsWithProvenance(productId: string): FactWithEvidence[] {
  const rows = getDb()
    .prepare(
      `SELECT f.attribute_key AS attribute, f.value_json, f.evidence_state, f.visibility,
              c.exact_span AS evidence_text, d.title AS evidence_source
       FROM product_facts f
       LEFT JOIN fact_evidence c ON c.fact_id = f.id
       LEFT JOIN evidence_documents d ON d.id = c.document_id
       WHERE f.product_id = ? AND f.approval_status = 'approved'`
    )
    .all(productId) as (Omit<FactWithEvidence, 'value' | 'status'> & { value_json: string | null; evidence_state: EvidenceState })[];
  return rows.map((r) => ({
    attribute: r.attribute,
    value: parseValue(r.value_json),
    status: r.evidence_state,
    visibility: r.visibility,
    evidence_text: r.evidence_text,
    evidence_source: r.evidence_source,
  }));
}
