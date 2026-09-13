import { getOpenAiClient, CHAT_MODEL } from './client';
import { listVerticals } from '@machina/database';

const SYSTEM_PROMPT = `You decide which one product category a buyer's shopping request belongs to, from a fixed list of categories. You are not allowed to invent a category outside the list given to you. If the request could plausibly belong to more than one category, or doesn't clearly belong to any of them, return null and a short, friendly clarification question that names the real categories available.`;

export interface ClassifyVerticalResult {
  vertical: string | null;
  question: string | null;
}

// Job 0 (v6): resolves which vertical a request is about, only used when the MCP
// connection has no fixed MACHINA_VERTICAL/MACHINA_MERCHANT_ID (the whole-database default
// scope). Mirrors normalizeBuyerLanguage's "don't guess" discipline one level up — a wrong
// guess here would search the wrong vertical entirely, so ambiguity must surface as a
// clarification question, never a silent pick.
export async function classifyVertical(requestText: string): Promise<ClassifyVerticalResult> {
  const verticals = listVerticals();
  if (verticals.length === 0) return { vertical: null, question: 'No product categories are available right now.' };
  if (verticals.length === 1) return { vertical: verticals[0].vertical, question: null };

  const client = getOpenAiClient();
  const response = await client.chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'vertical_classification',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            vertical: { type: ['string', 'null'], enum: [...verticals.map((v) => v.vertical), null] },
            question: { type: ['string', 'null'] },
          },
          required: ['vertical', 'question'],
          additionalProperties: false,
        },
      },
    },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Categories:\n${verticals.map((v) => `- ${v.vertical}: ${v.description}`).join('\n')}\n\nBuyer request: "${requestText}"\n\nWhich category does this belong to?`,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) return { vertical: null, question: defaultClarification(verticals.map((v) => v.vertical)) };

  let parsed: ClassifyVerticalResult;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { vertical: null, question: defaultClarification(verticals.map((v) => v.vertical)) };
  }

  // Defense in depth: never trust an out-of-list vertical, even from structured output.
  if (parsed.vertical !== null && !verticals.some((v) => v.vertical === parsed.vertical)) {
    return { vertical: null, question: defaultClarification(verticals.map((v) => v.vertical)) };
  }
  // The vertical choice itself is enum-constrained, but the LLM's free-text `question` is
  // not — it sometimes names only a few categories as examples instead of the full list.
  // The clarification question is always built deterministically from the real list, never
  // trusted from the model, so it's complete every time.
  if (parsed.vertical === null) {
    return { vertical: null, question: defaultClarification(verticals.map((v) => v.vertical)) };
  }
  return parsed;
}

function defaultClarification(verticalNames: string[]): string {
  return `Could you tell me what kind of product you're looking for? For example: ${verticalNames.join(', ')}.`;
}
