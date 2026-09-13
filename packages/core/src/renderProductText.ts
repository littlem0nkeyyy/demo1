import type { CatalogueEntry } from '@machina/database';
import { getApprovedFacts } from '@machina/database';
import { loadOntology } from '@machina/schemas';

// Always reflects the matchable current state for any candidate. AGENT_VISIBLE and
// MATCHING_ONLY facts may feed retrieval; INTERNAL_ONLY is unavailable to matching and is
// excluded here as required by CONTROL. This dataset's title already includes the brand.
export function renderProductText(product: CatalogueEntry, vertical: string): string {
  const approved = getApprovedFacts(product.id);
  const attrLines = loadOntology(vertical)
    .attributes.map((a) => {
      const entry = approved[a.key];
      if (!entry || entry.value === null || entry.visibility === 'INTERNAL_ONLY') return null;
      return `${a.label}: ${entry.value}`;
    })
    .filter((line): line is string => line !== null);
  const attrText = attrLines.length > 0 ? ` ${attrLines.join('. ')}.` : '';
  return `${product.title}. ${product.long_description}${attrText}`;
}
