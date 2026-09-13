import { describe, it, expect } from 'vitest';
import {
  evaluateRequirement,
  hasVerifiedNonMatch,
  countVerifiedMatches,
  compareCandidates,
  deriveMatchStatus,
  deriveTopLevelStatus,
  computeRelevance,
  computePoolStats,
  computeUtilityBreakdown,
  isEligibleOffer,
  compareByUtility,
  assignBadges,
} from '@machina/core';

describe('evaluateRequirement', () => {
  it('returns UNKNOWN when there is no approved value', () => {
    const result = evaluateRequirement({}, { attribute: 'surface', value: 'road' });
    expect(result.status).toBe('UNKNOWN');
  });

  it('returns UNKNOWN when the approved entry has a null value', () => {
    const result = evaluateRequirement(
      { surface: { value: null, visibility: 'AGENT_VISIBLE' } },
      { attribute: 'surface', value: 'road' }
    );
    expect(result.status).toBe('UNKNOWN');
  });

  it('returns VERIFIED_MATCH when the approved value equals the requested value', () => {
    const result = evaluateRequirement(
      { surface: { value: 'road', visibility: 'AGENT_VISIBLE' } },
      { attribute: 'surface', value: 'road' }
    );
    expect(result.status).toBe('VERIFIED_MATCH');
  });

  it('returns VERIFIED_NON_MATCH when the approved value differs — not the same as UNKNOWN', () => {
    const result = evaluateRequirement(
      { surface: { value: 'trail', visibility: 'AGENT_VISIBLE' } },
      { attribute: 'surface', value: 'road' }
    );
    expect(result.status).toBe('VERIFIED_NON_MATCH');
  });

  it('CONTROL: still uses the true value for MATCHING_ONLY (matching sees everything)', () => {
    const result = evaluateRequirement(
      { surface: { value: 'road', visibility: 'MATCHING_ONLY' } },
      { attribute: 'surface', value: 'road' }
    );
    expect(result.status).toBe('VERIFIED_MATCH');
  });

  it('CONTROL: treats INTERNAL_ONLY as unavailable even for matching itself', () => {
    const result = evaluateRequirement(
      { surface: { value: 'road', visibility: 'INTERNAL_ONLY' } },
      { attribute: 'surface', value: 'road' }
    );
    expect(result.status).toBe('UNKNOWN');
  });
});

describe('hasVerifiedNonMatch / countVerifiedMatches', () => {
  it('detects a disqualifying non-match among otherwise-fine requirements', () => {
    const results = [
      { attribute: 'surface', requested_value: 'road', status: 'VERIFIED_MATCH' as const },
      { attribute: 'width', requested_value: 'wide', status: 'VERIFIED_NON_MATCH' as const },
    ];
    expect(hasVerifiedNonMatch(results)).toBe(true);
    expect(countVerifiedMatches(results)).toBe(1);
  });

  it('is false when every requirement is a match or unknown', () => {
    const results = [
      { attribute: 'surface', requested_value: 'road', status: 'VERIFIED_MATCH' as const },
      { attribute: 'width', requested_value: 'wide', status: 'UNKNOWN' as const },
    ];
    expect(hasVerifiedNonMatch(results)).toBe(false);
  });
});

describe('compareCandidates', () => {
  it('ranks higher verified-match count first, regardless of similarity', () => {
    const strongMatchLowSimilarity = { verifiedCount: 3, similarity: 0.1 };
    const weakMatchHighSimilarity = { verifiedCount: 1, similarity: 0.9 };
    const sorted = [weakMatchHighSimilarity, strongMatchLowSimilarity].sort(compareCandidates);
    expect(sorted[0]).toBe(strongMatchLowSimilarity);
  });

  it('uses similarity only as a tiebreak when verified-match counts are equal', () => {
    const higherSimilarity = { verifiedCount: 2, similarity: 0.8 };
    const lowerSimilarity = { verifiedCount: 2, similarity: 0.3 };
    const sorted = [lowerSimilarity, higherSimilarity].sort(compareCandidates);
    expect(sorted[0]).toBe(higherSimilarity);
  });
});

describe('deriveMatchStatus', () => {
  it('is VERIFIED only when every requirement is a verified match', () => {
    expect(deriveMatchStatus([{ attribute: 'a', requested_value: 'x', status: 'VERIFIED_MATCH' }])).toBe('VERIFIED');
  });

  it('is PARTIAL when some requirements are unknown', () => {
    expect(
      deriveMatchStatus([
        { attribute: 'a', requested_value: 'x', status: 'VERIFIED_MATCH' },
        { attribute: 'b', requested_value: 'y', status: 'UNKNOWN' },
      ])
    ).toBe('PARTIAL');
  });
});

describe('deriveTopLevelStatus', () => {
  it('is INSUFFICIENT_DATA when nothing was verified anywhere but requirements existed', () => {
    expect(deriveTopLevelStatus(['PARTIAL', 'PARTIAL'], false, 2)).toBe('INSUFFICIENT_DATA');
  });

  it('is VERIFIED when at least one candidate is fully verified', () => {
    expect(deriveTopLevelStatus(['PARTIAL', 'VERIFIED'], true, 2)).toBe('VERIFIED');
  });

  it('is PARTIAL when something verified but nothing fully verified', () => {
    expect(deriveTopLevelStatus(['PARTIAL', 'PARTIAL'], true, 2)).toBe('PARTIAL');
  });
});

describe('demo-backed multi-objective scoring', () => {
  const base = {
    price_amount: 120,
    shipping_fee: 10,
    estimated_days_min: 2,
    estimated_days_max: 4,
    average_rating: 4.5,
    review_count: 100,
    verifiedCount: 2,
    requirementCount: 4,
    similarity: 0.75,
  };

  it('computes relevance as 60% attribute match and 40% semantic similarity', () => {
    expect(computeRelevance(base)).toBeCloseTo(0.6, 8);
  });

  it('rewards lower comparable price and better fulfillment within the same pool', () => {
    const stronger = { ...base, price_amount: 100, shipping_fee: 0, estimated_days_min: 1, estimated_days_max: 2 };
    const weaker = { ...base, price_amount: 150, shipping_fee: 20, estimated_days_min: 4, estimated_days_max: 6 };
    const pool = computePoolStats([stronger, weaker]);
    const strongScore = computeUtilityBreakdown(stronger, pool);
    const weakScore = computeUtilityBreakdown(weaker, pool);

    expect(strongScore.price).toBe(1);
    expect(strongScore.fulfillment).toBe(1);
    expect(weakScore.price).toBe(0);
    expect(weakScore.fulfillment).toBe(0);
    expect(strongScore.utility).toBeGreaterThan(weakScore.utility);
  });

  it('treats a missing shipping fee as unknown rather than free', () => {
    const unknownFee = { ...base, shipping_fee: null };
    const paidShipping = { ...base, shipping_fee: 20 };
    const pool = computePoolStats([{ ...base, shipping_fee: 0 }, paidShipping]);

    expect(computeUtilityBreakdown(unknownFee, pool).fulfillment)
      .toBeGreaterThan(computeUtilityBreakdown(paidShipping, pool).fulfillment);
    expect(computeUtilityBreakdown(unknownFee, pool).fulfillment).toBeLessThan(1);
  });

  it('never lets utility outrank a higher verified-match bucket', () => {
    const betterMatch = { verifiedCount: 2, utility: 0.1 };
    const weakerMatch = { verifiedCount: 1, utility: 0.99 };
    expect([weakerMatch, betterMatch].sort(compareByUtility)[0]).toBe(betterMatch);
  });

  it('uses the full delivery window consistently for the fastest badge', () => {
    const wideWindow = { price_amount: 100, estimated_days_min: 1, estimated_days_max: 10 };
    const fasterWindow = { price_amount: 110, estimated_days_min: 2, estimated_days_max: 3 };
    const badges = assignBadges([wideWindow, fasterWindow]);

    expect(badges.get(wideWindow)).toBe('best_overall');
    expect(badges.get(fasterWindow)).toBe('fastest_delivery');
  });
});

describe('demo-backed offer eligibility', () => {
  it('keeps a shippable in-stock offer', () => {
    expect(isEligibleOffer({ availability: 'in_stock', stock_quantity: 3, shipping_available: 1 })).toBe(true);
  });

  it('rejects zero stock, terminal availability and unavailable shipping', () => {
    expect(isEligibleOffer({ availability: 'in_stock', stock_quantity: 0, shipping_available: 1 })).toBe(false);
    expect(isEligibleOffer({ availability: 'discontinued', stock_quantity: 3, shipping_available: 1 })).toBe(false);
    expect(isEligibleOffer({ availability: 'in_stock', stock_quantity: 3, shipping_available: 0 })).toBe(false);
  });
});
