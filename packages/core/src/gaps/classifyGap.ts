import type { CatalogueEntry } from '@machina/database';
import { loadOntology } from '@machina/schemas';

export interface GapClassification {
  gap_type: 'surface' | 'hard';
  matched_rule: string | null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Deterministic, rule-based, no LLM call, no hand-authored rule file. A gap is "surface"
// when the product's own name + public copy already contains one of the attribute's own
// controlled-vocabulary values (in its natural hyphenated form or a space-separated
// variant) — so a capable retrieval/ranking system could plausibly infer it from context
// already present. Otherwise "hard" — genuinely absent and only recoverable from dedicated
// evidence. Deriving signals straight from each vertical's ontology (instead of a
// hand-written rules file per vertical) is what makes this generalize across all 10
// verticals in the synthetic dataset without hand-authoring 10 rule sets.
//
// Matching is done at word boundaries (\b), not naive substring search — a short vocab
// value like "ultra" must not falsely fire on "ultralight". The matched signal is returned
// so the classification is inspectable rather than a black box.
export function classifyGap(product: Pick<CatalogueEntry, 'title' | 'long_description'>, attributeKey: string, vertical: string): GapClassification {
  const attribute = loadOntology(vertical).attributes.find((a) => a.key === attributeKey);
  const signals = (attribute?.vocabulary ?? []).flatMap((value) => {
    const spaced = value.replace(/[-_]/g, ' ');
    return spaced === value ? [value] : [value, spaced];
  });
  const haystack = `${product.title} ${product.long_description}`.toLowerCase();
  for (const signal of signals) {
    const pattern = new RegExp(`\\b${escapeRegExp(signal.toLowerCase())}\\b`);
    if (pattern.test(haystack)) {
      return { gap_type: 'surface', matched_rule: signal };
    }
  }
  return { gap_type: 'hard', matched_rule: null };
}
