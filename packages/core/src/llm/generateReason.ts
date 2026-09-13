import { getOpenAiClient, CHAT_MODEL } from './client';
import type { DecisionFactor, Badge } from '../matchingCore';

const SYSTEM_PROMPT = `You write one short, natural sentence explaining why a product is a good option, for a shopper comparing several merchants. You will be given a fixed list of decision factors that were already computed deterministically — you do not decide ranking, you only put these facts into plain words. You must not mention, imply, or infer any attribute, value, price comparison, or claim that is not explicitly present in the decision factors you were given. Do not invent reasons. Do not use superlatives ("best", "cheapest") unless the matching factor/badge explicitly says so.`;

export interface GenerateReasonInput {
  title: string;
  merchant_name: string;
  decision_factors: DecisionFactor[];
  badge: Badge;
}

// Layer 4 (verbalization only): input is EXACTLY the already-disclosed decision_factors/
// badge computed by matchingCore's pure functions — never the true/internal state, never a
// pending fact. This function has no influence on ranking, weights, or the diversity cap.
export async function generateReason(input: GenerateReasonInput): Promise<string | null> {
  if (input.decision_factors.length === 0 && !input.badge) return null;

  const client = getOpenAiClient();
  const response = await client.chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0.2,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Product: ${input.title} (sold by ${input.merchant_name})\nBadge: ${input.badge ?? 'none'}\nDecision factors:\n${input.decision_factors.map((f) => `- ${f.detail}`).join('\n')}\n\nWrite one sentence.`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content?.trim() ?? null;
  if (!text) return null;
  return containmentCheck(text, input) ? text : deterministicFallback(input);
}

// Defense in depth (same philosophy as extractEvidence's NONE->null rule): if the generated
// sentence doesn't reference at least one of the given factor labels/details in any
// recognizable form, don't trust it — fall back to a deterministic template built only from
// the same factors, rather than risk showing an unrelated or hallucinated claim.
function containmentCheck(text: string, input: GenerateReasonInput): boolean {
  if (input.decision_factors.length === 0) return true;
  const lower = text.toLowerCase();
  return input.decision_factors.some((f) => lower.includes(f.label.toLowerCase().replace(/_/g, ' ')) || lower.includes(f.factor));
}

export function deterministicFallback(input: GenerateReasonInput): string {
  const parts = input.decision_factors.map((f) => f.detail);
  const badgeText = input.badge ? ` (${input.badge.replace(/_/g, ' ')})` : '';
  return parts.length > 0 ? `${parts.join('; ')}${badgeText}.` : `Available from ${input.merchant_name}.`;
}
