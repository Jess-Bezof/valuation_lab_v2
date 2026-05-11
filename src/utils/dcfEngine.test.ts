import { describe, it, expect } from 'vitest';
import {
  getSyntheticRating,
  calculateCostOfDebt,
  calculateWACC,
  calculateIntrinsicValue,
} from './dcfEngine';
import type { StockFinancials } from '../types';

// ---------------------------------------------------------------------------
// Minimal fixture — only the fields the DCF engine actually reads
// ---------------------------------------------------------------------------
const base: StockFinancials = {
  ticker: 'TEST',
  name: 'Test Corp',
  price: 100,
  beta: 1.0,
  marketCap: 1000,   // $1 000 M
  totalDebt: 200,    // $200 M
  cash: 50,          // $50 M
  revenue: 500,      // $500 M
  operatingIncome: 100,
  taxRate: 0.21,
  sharesOutstanding: 10,  // 10 M shares → implied price = equityValue / 10
  wacc: 0.09,
  roic: 0.15,
  riskFreeRate: 0.04,
  equityRiskPremium: 0.045,
  costOfDebt: 0.05,
  listingStatus: 'Public',
  dividendsPaid: 10,
};

const inputs = {
  revenueGrowth: 0.08,
  targetOperatingMargin: 0.20,
  taxRate: 0.21,
  terminalGrowthRate: 0.025,
};

// ---------------------------------------------------------------------------
// getSyntheticRating
// ---------------------------------------------------------------------------
describe('getSyntheticRating', () => {
  it('returns AAA for very high coverage', () => {
    expect(getSyntheticRating(10).rating).toBe('AAA');
    expect(getSyntheticRating(10).spread).toBe(0.0063);
  });

  it('returns BBB at coverage 2.6', () => {
    expect(getSyntheticRating(2.6).rating).toBe('BBB');
  });

  it('returns D for coverage at or below 0.2', () => {
    expect(getSyntheticRating(0.1).rating).toBe('D');
    expect(getSyntheticRating(0).rating).toBe('D');
  });

  it('boundaries are exclusive on the upper bound', () => {
    // coverage exactly 8.5 should NOT qualify for AAA (> 8.5 is required)
    expect(getSyntheticRating(8.5).rating).toBe('AA');
  });
});

// ---------------------------------------------------------------------------
// calculateCostOfDebt
// ---------------------------------------------------------------------------
describe('calculateCostOfDebt', () => {
  it('returns the backend-provided costOfDebt directly when available', () => {
    // base.costOfDebt = 0.05; the function should return it without recalculating.
    expect(calculateCostOfDebt(base)).toBe(base.costOfDebt);
  });

  it('falls back to synthetic rating when costOfDebt is zero', () => {
    const noBackendCod = { ...base, costOfDebt: 0 };
    const cod = calculateCostOfDebt(noBackendCod);
    // Fallback path: rfr + spread > rfr
    expect(cod).toBeGreaterThan(base.riskFreeRate);
  });

  it('fallback uses BBB spread when there is no debt', () => {
    const noDebt = { ...base, costOfDebt: 0, totalDebt: 0 };
    const cod = calculateCostOfDebt(noDebt);
    expect(cod).toBeCloseTo(base.riskFreeRate + 0.0156, 4);
  });
});

// ---------------------------------------------------------------------------
// calculateWACC
// ---------------------------------------------------------------------------
describe('calculateWACC', () => {
  it('is bounded between cost-of-debt and cost-of-equity', () => {
    const cod = calculateCostOfDebt(base);
    const wacc = calculateWACC(base, cod);
    const ke = base.riskFreeRate + base.beta * base.equityRiskPremium;
    expect(wacc).toBeGreaterThan(cod * (1 - base.taxRate));
    expect(wacc).toBeLessThan(ke);
  });

  it('equals cost-of-equity when there is no debt', () => {
    const noDebt = { ...base, totalDebt: 0 };
    const cod = calculateCostOfDebt(noDebt);
    const wacc = calculateWACC(noDebt, cod);
    const ke = base.riskFreeRate + base.beta * base.equityRiskPremium;
    expect(wacc).toBeCloseTo(ke, 4);
  });
});

// ---------------------------------------------------------------------------
// calculateIntrinsicValue — FCFF model
// ---------------------------------------------------------------------------
describe('calculateIntrinsicValue FCFF', () => {
  it('returns a positive intrinsic value for a healthy company', () => {
    const result = calculateIntrinsicValue(base, inputs, 'FCFF');
    expect(result.intrinsicValue).toBeGreaterThan(0);
  });

  it('produces exactly 5 projected cash-flow years', () => {
    const result = calculateIntrinsicValue(base, inputs, 'FCFF');
    expect(result.dcfDetails.projectedCashFlows).toHaveLength(5);
  });

  it('clamps equity to zero when it goes negative', () => {
    // Enormous debt makes equity negative
    const leveraged = { ...base, totalDebt: 100_000 };
    const result = calculateIntrinsicValue(leveraged, inputs, 'FCFF');
    expect(result.equityValue).toBeGreaterThanOrEqual(0);
    expect(result.intrinsicValue).toBeGreaterThanOrEqual(0);
  });

  it('terminal value is a large share of total enterprise value', () => {
    const result = calculateIntrinsicValue(base, inputs, 'FCFF');
    const tvShare = result.dcfDetails.terminalValuePV / result.enterpriseValue;
    // For a 5-year model terminal value typically dominates
    expect(tvShare).toBeGreaterThan(0.5);
  });

  it('terminal growth rate is not capped at 3% (old hard cap removed)', () => {
    // Old code silently capped at 3%; now the only cap is WACC − 0.5%.
    const capped = calculateIntrinsicValue(base, { ...inputs, terminalGrowthRate: 0.03 }, 'FCFF');
    const higher = calculateIntrinsicValue(base, { ...inputs, terminalGrowthRate: 0.05 }, 'FCFF');
    // 5% terminal growth → higher terminal value → higher intrinsic value
    expect(higher.intrinsicValue).toBeGreaterThan(capped.intrinsicValue);
  });

  it('clamps terminal growth below WACC to prevent Gordon Growth breakdown', () => {
    // terminalGrowthRate ≥ WACC produces a zero or negative denominator.
    // The engine should silently cap it and return a finite positive value.
    const result = calculateIntrinsicValue(base, { ...inputs, terminalGrowthRate: 0.99 }, 'FCFF');
    expect(Number.isFinite(result.intrinsicValue)).toBe(true);
    expect(result.intrinsicValue).toBeGreaterThan(0);
  });

  it('defaults ROIC to 0.15 when zero to avoid division by zero', () => {
    const zeroRoic = { ...base, roic: 0 };
    const result = calculateIntrinsicValue(zeroRoic, inputs, 'FCFF');
    expect(Number.isFinite(result.intrinsicValue)).toBe(true);
  });

  it('interpolates margin from current to target over 5 years', () => {
    // With current margin 10% and target 30%, year-1 FCF should be lower than
    // if the full 30% were applied from day one.
    const lowMarginBase = { ...base, operatingIncome: base.revenue * 0.10 };
    const interpolated = calculateIntrinsicValue(lowMarginBase, { ...inputs, targetOperatingMargin: 0.30 }, 'FCFF');
    const stepChange = calculateIntrinsicValue(
      { ...lowMarginBase, operatingIncome: lowMarginBase.revenue * 0.30 }, // current = target
      { ...inputs, targetOperatingMargin: 0.30 },
      'FCFF'
    );
    // Interpolated should be lower because early years use lower margins
    expect(interpolated.intrinsicValue).toBeLessThan(stepChange.intrinsicValue);
  });

  it('clamps explicit-period reinvestment rate so FCF is never negative', () => {
    // growth=80%, ROIC=10% → raw reinvestmentRate=8 → unclamped FCF would be hugely negative.
    const result = calculateIntrinsicValue(
      { ...base, roic: 0.10 },
      { ...inputs, revenueGrowth: 0.80 },
      'FCFF'
    );
    result.dcfDetails.projectedCashFlows.forEach(({ freeCashFlow }) => {
      expect(freeCashFlow).toBeGreaterThanOrEqual(0);
    });
  });

  it('growth mean-reverts: year-1 uses revenueGrowth, later years track terminalGrowthRate', () => {
    // When revenueGrowth == terminalGrowthRate, all years use the same rate (no reversion).
    // When they differ, later-year FCFs diverge from the constant-growth case.
    const constant = calculateIntrinsicValue(
      base,
      { ...inputs, revenueGrowth: 0.05, terminalGrowthRate: 0.05 },
      'FCFF'
    );
    const reversion = calculateIntrinsicValue(
      base,
      { ...inputs, revenueGrowth: 0.05, terminalGrowthRate: 0.02 },
      'FCFF'
    );
    const c = constant.dcfDetails.projectedCashFlows;
    const r = reversion.dcfDetails.projectedCashFlows;
    // Year 1 is the same — both start at revenueGrowth=5%
    expect(c[0].freeCashFlow).toBeCloseTo(r[0].freeCashFlow, 2);
    // Year 5 differs — reversion ends at 2%, constant stays at 5%
    expect(c[4].freeCashFlow).not.toBeCloseTo(r[4].freeCashFlow, 0);
  });

  it('explicit wacc override is respected', () => {
    // inputs.wacc supplied → engine uses that value directly, not calculateWACC.
    const result = calculateIntrinsicValue(base, { ...inputs, wacc: 0.12 }, 'FCFF');
    expect(result.wacc).toBeCloseTo(0.12, 4);
  });

  it('uses backend syntheticRating when provided', () => {
    const withRating = { ...base, syntheticRating: 'AAA' };
    const result = calculateIntrinsicValue(withRating, inputs, 'FCFF');
    expect(result.syntheticRating).toBe('AAA');
  });
});

// ---------------------------------------------------------------------------
// calculateIntrinsicValue — HIGH_GROWTH model
// ---------------------------------------------------------------------------
describe('calculateIntrinsicValue HIGH_GROWTH', () => {
  it('produces exactly 10 projected cash-flow years', () => {
    const result = calculateIntrinsicValue(base, inputs, 'HIGH_GROWTH');
    expect(result.dcfDetails.projectedCashFlows).toHaveLength(10);
  });

  it('stable reinvestment rate is clamped between 0 and 1', () => {
    // Verify no NaN or out-of-range terminal FCF by checking a finite positive result
    const result = calculateIntrinsicValue(base, inputs, 'HIGH_GROWTH');
    expect(Number.isFinite(result.terminalValue)).toBe(true);
    expect(result.terminalValue).toBeGreaterThan(0);
  });

  it('handles negative ROIC by flooring stable ROIC at WACC', () => {
    const negRoic = { ...base, roic: -0.05 };
    const result = calculateIntrinsicValue(negRoic, inputs, 'HIGH_GROWTH');
    expect(Number.isFinite(result.intrinsicValue)).toBe(true);
  });

  it('growth mean-reverts over 10 years: year-1 uses revenueGrowth, year-10 tracks terminalGrowthRate', () => {
    const constant = calculateIntrinsicValue(
      base,
      { ...inputs, revenueGrowth: 0.05, terminalGrowthRate: 0.05 },
      'HIGH_GROWTH'
    );
    const reversion = calculateIntrinsicValue(
      base,
      { ...inputs, revenueGrowth: 0.05, terminalGrowthRate: 0.02 },
      'HIGH_GROWTH'
    );
    const c = constant.dcfDetails.projectedCashFlows;
    const r = reversion.dcfDetails.projectedCashFlows;
    // Year 1 identical (both start at revenueGrowth=5%)
    expect(c[0].freeCashFlow).toBeCloseTo(r[0].freeCashFlow, 2);
    // Year 10 differs (reversion ends at 2%, constant stays at 5%)
    expect(c[9].freeCashFlow).not.toBeCloseTo(r[9].freeCashFlow, 0);
  });
});

// ---------------------------------------------------------------------------
// calculateIntrinsicValue — DDM model
// ---------------------------------------------------------------------------
describe('calculateIntrinsicValue DDM', () => {
  it('returns a positive value for a dividend-paying company', () => {
    const result = calculateIntrinsicValue(base, inputs, 'DDM');
    expect(result.intrinsicValue).toBeGreaterThan(0);
  });

  it('returns zero intrinsic value when no dividends are paid', () => {
    const noDivs = { ...base, dividendsPaid: 0 };
    const result = calculateIntrinsicValue(noDivs, inputs, 'DDM');
    expect(result.intrinsicValue).toBe(0);
  });

  it('produces exactly 5 projected cash-flow years', () => {
    const result = calculateIntrinsicValue(base, inputs, 'DDM');
    expect(result.dcfDetails.projectedCashFlows).toHaveLength(5);
  });

  it('uses sustainable growth not revenue growth for dividends', () => {
    // Hold dividendsPaid constant so the only variable is the growth rate.
    // Low payout → high retention → higher sustainable g → higher IV.
    const sameDividends = 10;
    const highPayout = { ...base, dividendsPaid: sameDividends, netIncome: 11,  roic: 0.15 }; // ~91% payout, g≈1.4%
    const lowPayout  = { ...base, dividendsPaid: sameDividends, netIncome: 100, roic: 0.15 }; // 10%  payout, g=13.5%
    const resultHigh = calculateIntrinsicValue(highPayout, inputs, 'DDM');
    const resultLow  = calculateIntrinsicValue(lowPayout,  inputs, 'DDM');
    expect(resultLow.intrinsicValue).toBeGreaterThan(resultHigh.intrinsicValue);
  });
});
