// Scores our own normalizeBuyerLanguage/extractEvidence against the synthetic dataset's
// labeled test fixtures (data/test_fixtures/intent_cases.json, evidence_cases.json) — a much
// larger, independently-authored check than our own hand-written examples. Sample size is
// bounded by default to control LLM cost; pass a larger number as an arg to check more.
//
// Usage: npx tsx tests/evalFixtures.ts [sampleSize]
import path from 'path';
import dotenv from 'dotenv';
// Self-sufficient regardless of how this is launched — same reasoning as
// mcp/server/src/index.ts: don't rely on the caller having preloaded `-r dotenv/config`.
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { normalizeBuyerLanguage, extractEvidence } from '@machina/core';
import { dataPath, loadOntology } from '@machina/schemas';
import fs from 'fs';

const VERTICALS = [
  'running_shoes',
  'outdoor',
  'laptops',
  'headphones',
  'office_chairs',
  'coffee_machines',
  'skincare',
  'luggage',
  'cameras',
  'vacuums',
];

// evidence_cases.json has no `vertical` field and its attributes span all 10 ontologies with
// some name collisions — resolve by finding the vertical whose vocabulary set exactly
// matches allowed_values (falls back to the first vertical that has the attribute at all).
function resolveVertical(attribute: string, allowedValues: string[]): string | null {
  const allowedSet = new Set(allowedValues);
  let fallback: string | null = null;
  for (const vertical of VERTICALS) {
    const attr = loadOntology(vertical).attributes.find((a) => a.key === attribute);
    if (!attr) continue;
    if (fallback === null) fallback = vertical;
    const vocabSet = new Set(attr.vocabulary);
    if (vocabSet.size === allowedSet.size && [...vocabSet].every((v) => allowedSet.has(v))) {
      return vertical;
    }
  }
  return fallback;
}

interface IntentCase {
  case_id: string;
  vertical: string;
  input: string;
  expected_interpretation: { attribute: string; operator: string; value: string }[];
  clarity: string;
}

interface EvidenceCase {
  case_id: string;
  source_text: string;
  target_attribute: string;
  allowed_values: string[];
  expected_value: string | null;
  expected_state: 'DIRECT' | 'AMBIGUOUS' | 'NONE';
  expected_evidence_span: string | null;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(dataPath('test_fixtures', file), 'utf-8')) as T;
}

async function evalIntentCases(sampleSize: number) {
  const all = readJson<IntentCase[]>('intent_cases.json');
  const sample = all.slice(0, sampleSize);
  let correct = 0;
  for (const c of sample) {
    const result = await normalizeBuyerLanguage(c.input, c.vertical);
    const expectedSet = new Set(c.expected_interpretation.map((e) => `${e.attribute}=${e.value}`));
    const resultSet = new Set(result.map((r) => `${r.attribute}=${r.value}`));
    const match = expectedSet.size === resultSet.size && [...expectedSet].every((e) => resultSet.has(e));
    if (match) correct++;
    else console.log(`  MISMATCH ${c.case_id}: expected ${[...expectedSet]} got ${[...resultSet]}`);
  }
  console.log(`intent_cases: ${correct}/${sample.length} correct (sampled from ${all.length} available)`);
}

async function evalEvidenceCases(sampleSize: number) {
  const all = readJson<EvidenceCase[]>('evidence_cases.json');
  const sample = all.slice(0, sampleSize);
  let correct = 0;
  for (const c of sample) {
    const vertical = resolveVertical(c.target_attribute, c.allowed_values);
    if (!vertical) {
      console.log(`  SKIP ${c.case_id}: attribute ${c.target_attribute} not found in any of the 10 ontologies`);
      continue;
    }
    const result = await extractEvidence({
      attributeKey: c.target_attribute,
      vertical,
      evidenceText: c.source_text,
      sourceLabel: 'eval fixture',
    });
    const match = result.status === c.expected_state && result.value === c.expected_value;
    if (match) correct++;
    else console.log(`  MISMATCH ${c.case_id}: expected ${c.expected_state}/${c.expected_value} got ${result.status}/${result.value}`);
  }
  console.log(`evidence_cases: ${correct}/${sample.length} correct (sampled from ${all.length} available)`);
}

async function main() {
  const sampleSize = Number(process.argv[2]) || 15;
  console.log(`Sampling ${sampleSize} cases from each fixture set (pass a number to change).\n`);
  await evalIntentCases(sampleSize);
  await evalEvidenceCases(sampleSize);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
