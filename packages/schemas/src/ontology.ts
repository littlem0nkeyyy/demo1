import fs from 'fs';
import { z } from 'zod';
import { dataPath } from './repoRoot';

export const OntologyAttributeSchema = z.object({
  key: z.string(),
  label: z.string(),
  vocabulary: z.array(z.string()),
});
export type OntologyAttribute = z.infer<typeof OntologyAttributeSchema>;

export const OntologySchema = z.object({
  vertical: z.string(),
  attributes: z.array(OntologyAttributeSchema),
});
export type Ontology = z.infer<typeof OntologySchema>;

// Raw shape of data/ontologies/<vertical>.json in the synthetic dataset: an object keyed by
// attribute name, not an array — converted into our internal array shape on load so the rest
// of the codebase (attributeKeys/getAttribute/isValidValue) doesn't need to know about it.
const RawOntologyFileSchema = z.object({
  vertical: z.string(),
  attributes: z.record(
    z.string(),
    z.object({
      type: z.string(),
      // Some attributes (e.g. capacity_litres) are numeric in this dataset's ontology, but
      // the whole matching pipeline compares string vocabulary values (evaluateRequirement
      // does strict `===` on strings) — coerce to string once here so every attribute is
      // string-vocabulary internally regardless of its declared data_type.
      values: z.array(z.union([z.string(), z.number()]).transform(String)),
    })
  ),
});

function labelFromKey(key: string): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const cache = new Map<string, Ontology>();

// Config-driven (data/ontologies/<vertical>.json), one file per vertical — each merchant is
// scoped to exactly one vertical, so callers always load the ontology for their own
// merchant's vertical, never a single global schema.
export function loadOntology(vertical: string): Ontology {
  const existing = cache.get(vertical);
  if (existing) return existing;
  const raw = fs.readFileSync(dataPath('ontologies', `${vertical}.json`), 'utf-8');
  const parsed = RawOntologyFileSchema.parse(JSON.parse(raw));
  const ontology: Ontology = {
    vertical: parsed.vertical,
    attributes: Object.entries(parsed.attributes).map(([key, def]) => ({
      key,
      label: labelFromKey(key),
      vocabulary: def.values,
    })),
  };
  cache.set(vertical, ontology);
  return ontology;
}

export function attributeKeys(vertical: string): string[] {
  return loadOntology(vertical).attributes.map((a) => a.key);
}

export function getAttribute(vertical: string, key: string): OntologyAttribute | undefined {
  return loadOntology(vertical).attributes.find((a) => a.key === key);
}

export function isValidValue(vertical: string, key: string, value: string | null): boolean {
  if (value === null) return true;
  const attr = getAttribute(vertical, key);
  if (!attr) return false;
  return attr.vocabulary.includes(value);
}
