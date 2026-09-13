import OpenAI from 'openai';

let client: OpenAI | null = null;

// Single shared client. Kept behind this function (rather than exported as a bare
// singleton) so normalizeBuyerLanguage/extractEvidence stay easy to unit-test against a
// fake without needing a live API key.
export function getOpenAiClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set. Add it to .env before running LLM steps.');
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

export const CHAT_MODEL = 'gpt-4o-mini';
export const EMBEDDING_MODEL = 'text-embedding-3-small';
