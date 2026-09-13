import { describe, it, expect } from 'vitest';
import { classifyGap } from '@machina/core';

// Deterministic, rule-based classification, signals auto-derived from the real
// data/ontologies/running_shoes.json vocabulary — no hand-authored rule file, no LLM.
describe('classifyGap', () => {
  it('classifies as surface when a vocabulary value appears verbatim in the product copy', () => {
    const product = {
      title: 'Guide Rail Trainer',
      long_description: 'This shoe offers excellent motion control for overpronators.',
    };
    const result = classifyGap(product, 'support_category', 'running_shoes');
    expect(result.gap_type).toBe('surface');
    expect(result.matched_rule).not.toBeNull();
  });

  it('classifies as hard when no vocabulary value appears anywhere in name or copy', () => {
    const product = {
      title: 'City Glide',
      long_description: 'An everyday value sneaker-runner hybrid for casual walkers and light joggers.',
    };
    const result = classifyGap(product, 'support_category', 'running_shoes');
    expect(result.gap_type).toBe('hard');
    expect(result.matched_rule).toBeNull();
  });

  it('does not false-positive on a short vocabulary value that is merely a substring of another word (e.g. "ultra" inside "ultralight")', () => {
    const product = {
      title: 'Featherlight Racer',
      long_description: 'An ultralight racing flat for road efforts.',
    };
    const result = classifyGap(product, 'distance', 'running_shoes');
    // "ultra" (a real distance vocab value in this vertical) must not fire on "ultralight".
    expect(result.gap_type).toBe('hard');
    expect(result.matched_rule).toBeNull();
  });

  it('still matches "ultra" as a genuine standalone word', () => {
    const product = {
      title: 'Endurance Max',
      long_description: 'Built for runners tackling an ultra distance mountain race.',
    };
    const result = classifyGap(product, 'distance', 'running_shoes');
    expect(result.gap_type).toBe('surface');
    expect(result.matched_rule).toBe('ultra');
  });
});
