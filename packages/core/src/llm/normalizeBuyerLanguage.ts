import { getOpenAiClient, CHAT_MODEL } from './client';
import { loadOntology, isValidValue } from '@machina/schemas';
import type { NormalizedRequirement } from '../gaps/detectGaps';

const SYSTEM_PROMPT = `You convert a buyer's free-text shopping request into zero or more structured requirements from a fixed ontology. You are not allowed to invent attributes or values outside the ontology given to you. If the buyer's need doesn't clearly map to one of the given attribute/value pairs, omit it — do not guess.`;

function buildOntologyDescription(vertical: string): string {
  const ontology = loadOntology(vertical);
  return ontology.attributes
    .map((a) => `- ${a.key}: one of [${a.vocabulary.join(', ')}]`)
    .join('\n');
}

// LLM job 1 (§7): free text -> structured requirement(s), or nothing if it doesn't map.
// This is the ONLY thing this function is allowed to do — no gap detection, no scoring,
// no persistence decisions. Those stay in deterministic code. Scoped to one merchant's
// vertical, since each vertical has its own ontology/vocabulary.
export async function normalizeBuyerLanguage(text: string, vertical: string): Promise<NormalizedRequirement[]> {
  const client = getOpenAiClient();
  const response = await client.chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'normalized_requirements',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            requirements: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  attribute: { type: 'string' },
                  value: { type: 'string' },
                },
                required: ['attribute', 'value'],
                additionalProperties: false,
              },
            },
          },
          required: ['requirements'],
          additionalProperties: false,
        },
      },
    },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Ontology (attribute: allowed values):\n${buildOntologyDescription(vertical)}\n\nBuyer request: "${text}"\n\nReturn the requirements this maps to.`,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) return [];

  let parsed: { requirements: { attribute: string; value: string }[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  // Enforce the controlled vocabulary in code — never trust the model's output blindly,
  // even with structured output turned on.
  return parsed.requirements.filter((r) => isValidValue(vertical, r.attribute, r.value) && r.value !== null);
}
