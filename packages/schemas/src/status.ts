import { z } from 'zod';

// §5 — request-level result status. CLARIFICATION_REQUIRED means the request itself is too
// ambiguous to search safely; NO_MATCH means hard filters left zero candidates;
// INSUFFICIENT_DATA means candidates exist but Machina cannot responsibly vouch for any of
// them (every requirement on every survivor is UNKNOWN).
export const RequestStatusSchema = z.enum([
  'VERIFIED',
  'PARTIAL',
  'INSUFFICIENT_DATA',
  'NO_MATCH',
  'CLARIFICATION_REQUIRED',
]);
export type RequestStatus = z.infer<typeof RequestStatusSchema>;

// §5 — per-requirement evaluation. UNKNOWN is not the same as non-match: it means Machina
// has no approved evidence either way, not that the product fails the requirement.
export const RequirementStatusSchema = z.enum(['VERIFIED_MATCH', 'VERIFIED_NON_MATCH', 'UNKNOWN']);
export type RequirementStatus = z.infer<typeof RequirementStatusSchema>;

// Per-product roll-up. A product with any VERIFIED_NON_MATCH is excluded from results
// entirely rather than being labeled — see packages/core/src/matching.ts.
export const MatchStatusSchema = z.enum(['VERIFIED', 'PARTIAL']);
export type MatchStatus = z.infer<typeof MatchStatusSchema>;

// §11 — evidence tri-state for catalogue enrichment (renamed from v1's DIRECT_EVIDENCE /
// NO_EVIDENCE to match this doc's §10/§11 vocabulary; same semantics).
export const EvidenceStateSchema = z.enum(['DIRECT', 'AMBIGUOUS', 'NONE']);
export type EvidenceState = z.infer<typeof EvidenceStateSchema>;

export const ApprovalStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const GapTypeSchema = z.enum(['surface', 'hard']);
export type GapType = z.infer<typeof GapTypeSchema>;

// Ground-truth-level classification of a held-out query's difficulty (distinct from
// GapType, which classifies one attribute on one product). UNRESOLVED means no merchant
// product can genuinely satisfy the query even with perfect evidence — not the same as a
// hard-but-resolvable gap.
export const GapClassSchema = z.enum(['SURFACE', 'HARD', 'UNRESOLVED']);
export type GapClass = z.infer<typeof GapClassSchema>;

export const AttributeConditionSchema = z.object({
  attribute: z.string(),
  operator: z.literal('eq'),
  value: z.string(),
});
export type AttributeCondition = z.infer<typeof AttributeConditionSchema>;

// check_suitability's own result vocabulary (§6).
export const SuitabilityResultSchema = z.enum(['SUITABLE', 'NOT_SUITABLE', 'INSUFFICIENT_DATA']);
export type SuitabilityResult = z.infer<typeof SuitabilityResultSchema>;

// §3/§8 — CONTROL: per-attribute disclosure tier. This is the core differentiator of the
// "Product Intelligence Gateway" thesis — Machina can use more data for matching than it
// ever discloses to a calling agent.
//
//   AGENT_VISIBLE  — raw value, evidence, and true requirement status all flow through.
//   MATCHING_ONLY  — the real value still participates in ranking/matching internally, but
//                    every agent-facing surface reports UNKNOWN/INSUFFICIENT_DATA for it and
//                    never returns the raw value or evidence. Revealing "this matched" would
//                    itself leak the value for a small controlled vocabulary, so the whole
//                    verified/non-match distinction is suppressed, not just the value.
//   INTERNAL_ONLY  — excluded from matching entirely; never surfaced agent-facing at all
//                    (pure internal bookkeeping, e.g. cost/margin/supplier).
//
// Enforced in exactly one place: packages/core/src/disclosurePolicy.ts.
export const VisibilityTierSchema = z.enum(['AGENT_VISIBLE', 'MATCHING_ONLY', 'INTERNAL_ONLY']);
export type VisibilityTier = z.infer<typeof VisibilityTierSchema>;
