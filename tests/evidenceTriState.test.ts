import { describe, it, expect, vi } from 'vitest';

// extractEvidence must enforce the tri-state contract in CODE, not just trust the model's
// structured output — this test simulates a misbehaving model response and checks the
// defense-in-depth logic actually kicks in.
vi.mock('@machina/core/src/llm/client', () => ({
  getOpenAiClient: () => fakeClient,
  CHAT_MODEL: 'test-model',
  EMBEDDING_MODEL: 'test-embed-model',
}));

let mockResponseContent = '';
const fakeClient = {
  chat: {
    completions: {
      create: vi.fn(async () => ({
        choices: [{ message: { content: mockResponseContent } }],
      })),
    },
  },
};

const { extractEvidence } = await import('@machina/core/src/llm/extractEvidence');

describe('extractEvidence tri-state enforcement', () => {
  it('forces value to null when the model returns NONE with a value anyway', async () => {
    mockResponseContent = JSON.stringify({
      status: 'NONE',
      value: 'road', // a misbehaving model that shouldn't have set this
      evidence_span: 'some irrelevant span',
    });
    const result = await extractEvidence({
      attributeKey: 'surface',
      vertical: 'running_shoes',
      evidenceText: 'irrelevant text',
      sourceLabel: 'test source',
    });
    expect(result.status).toBe('NONE');
    expect(result.value).toBeNull();
  });

  it('downgrades to NONE when the model returns a value outside the controlled vocabulary', async () => {
    mockResponseContent = JSON.stringify({
      status: 'DIRECT',
      value: 'sideways', // not in the surface vocabulary (road/trail/track/treadmill)
      evidence_span: 'goes sideways apparently',
    });
    const result = await extractEvidence({
      attributeKey: 'surface',
      vertical: 'running_shoes',
      evidenceText: 'irrelevant text',
      sourceLabel: 'test source',
    });
    expect(result.status).toBe('NONE');
    expect(result.value).toBeNull();
  });

  it('passes through a legitimate DIRECT result unchanged', async () => {
    mockResponseContent = JSON.stringify({
      status: 'DIRECT',
      value: 'road',
      evidence_span: 'tested exclusively on road surfaces',
    });
    const result = await extractEvidence({
      attributeKey: 'surface',
      vertical: 'running_shoes',
      evidenceText: 'tested exclusively on road surfaces',
      sourceLabel: 'test source',
    });
    expect(result.status).toBe('DIRECT');
    expect(result.value).toBe('road');
    expect(result.evidence_span).toBe('tested exclusively on road surfaces');
  });
});
