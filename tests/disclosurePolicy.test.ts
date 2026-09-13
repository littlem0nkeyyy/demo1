import { describe, it, expect } from 'vitest';
import { discloseRequirementStatus, isAgentVisible } from '@machina/core';

describe('discloseRequirementStatus (CONTROL, §3/§8)', () => {
  it('passes the true status through for AGENT_VISIBLE', () => {
    expect(discloseRequirementStatus('AGENT_VISIBLE', 'VERIFIED_MATCH')).toBe('VERIFIED_MATCH');
    expect(discloseRequirementStatus('AGENT_VISIBLE', 'VERIFIED_NON_MATCH')).toBe('VERIFIED_NON_MATCH');
  });

  it('forces MATCHING_ONLY to UNKNOWN regardless of the true status — never reveals a match or non-match', () => {
    expect(discloseRequirementStatus('MATCHING_ONLY', 'VERIFIED_MATCH')).toBe('UNKNOWN');
    expect(discloseRequirementStatus('MATCHING_ONLY', 'VERIFIED_NON_MATCH')).toBe('UNKNOWN');
  });

  it('forces INTERNAL_ONLY to UNKNOWN too (defense in depth)', () => {
    expect(discloseRequirementStatus('INTERNAL_ONLY', 'VERIFIED_MATCH')).toBe('UNKNOWN');
  });

  it('treats an undefined tier as AGENT_VISIBLE (attribute never enriched at all)', () => {
    expect(discloseRequirementStatus(undefined, 'UNKNOWN')).toBe('UNKNOWN');
  });
});

describe('isAgentVisible', () => {
  it('is true only for AGENT_VISIBLE', () => {
    expect(isAgentVisible('AGENT_VISIBLE')).toBe(true);
    expect(isAgentVisible('MATCHING_ONLY')).toBe(false);
    expect(isAgentVisible('INTERNAL_ONLY')).toBe(false);
  });
});
