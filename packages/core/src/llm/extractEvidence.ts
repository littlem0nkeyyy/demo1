import { getOpenAiClient, CHAT_MODEL } from './client';
import { getAttribute, type EvidenceState } from '@machina/schemas';

const SYSTEM_PROMPT = `You extract one structured attribute value from a trusted evidence document about a product. You must use the tri-state model strictly:
- DIRECT: the evidence text explicitly and unambiguously states this value.
- AMBIGUOUS: the evidence suggests this value but does not clearly confirm it (e.g. it hedges, applies conditionally, or names more than one plausible value).
- NONE: the evidence does not support any of the allowed values.
If the status is NONE, value MUST be null. Never invent a value that is not explicitly one of the allowed values. Never guess from general knowledge about the product category — only use what is written in the evidence text given to you. Always quote the exact verbatim span of the evidence text you relied on (or null if NONE).`;

export interface ExtractEvidenceInput {
  attributeKey: string;
  vertical: string;
  evidenceText: string;
  sourceLabel: string;
}

export interface ExtractEvidenceResult {
  status: EvidenceState;
  value: string | null;
  evidence_span: string | null;
}

// LLM job 2 (§10/§11). Deliberately takes ONLY the evidence text + target attribute — it
// has no parameter through which a held-out query set could ever be passed in, by
// construction, and it makes no gap-detection or scoring decisions.
export async function extractEvidence(input: ExtractEvidenceInput): Promise<ExtractEvidenceResult> {
  const attr = getAttribute(input.vertical, input.attributeKey);
  if (!attr) throw new Error(`Unknown ontology attribute: ${input.attributeKey} (vertical: ${input.vertical})`);

  const client = getOpenAiClient();
  const response = await client.chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'evidence_extraction',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['DIRECT', 'AMBIGUOUS', 'NONE'] },
            value: { type: ['string', 'null'], enum: [...attr.vocabulary, null] },
            evidence_span: { type: ['string', 'null'] },
          },
          required: ['status', 'value', 'evidence_span'],
          additionalProperties: false,
        },
      },
    },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Target attribute: ${attr.key} (${attr.label})\nAllowed values: [${attr.vocabulary.join(', ')}]\n\nEvidence source: ${input.sourceLabel}\nEvidence text:\n"""\n${input.evidenceText}\n"""\n\nExtract this attribute per the tri-state rules.`,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) return { status: 'NONE', value: null, evidence_span: null };

  let parsed: ExtractEvidenceResult;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'NONE', value: null, evidence_span: null };
  }

  // Defense in depth: enforce the contract in code even if the model's structured output
  // somehow violates it. NONE can never carry a value; any other value must be a legal
  // vocabulary entry.
  if (parsed.status === 'NONE') return { ...parsed, value: null };
  if (parsed.value !== null && !attr.vocabulary.includes(parsed.value)) {
    return { status: 'NONE', value: null, evidence_span: null };
  }
  return parsed;
}
