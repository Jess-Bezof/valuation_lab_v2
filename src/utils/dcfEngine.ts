import { StockFinancials, DcfOutput } from '../types';

export const getSyntheticRating = (interestCoverageRatio: number): { rating: string; spread: number } => {
  if (interestCoverageRatio > 8.5) return { rating: 'AAA', spread: 0.0063 };
  if (interestCoverageRatio > 6.5) return { rating: 'AA', spread: 0.0078 };
  if (interestCoverageRatio > 5.5) return { rating: 'A+', spread: 0.0098 };
  if (interestCoverageRatio > 4.25) return { rating: 'A', spread: 0.0108 };
  if (interestCoverageRatio > 3.0) return { rating: 'A-', spread: 0.0122 };
  if (interestCoverageRatio > 2.5) return { rating: 'BBB', spread: 0.0156 };
  if (interestCoverageRatio > 2.25) return { rating: 'BB+', spread: 0.0240 };
  if (interestCoverageRatio > 2.0) return { rating: 'BB', spread: 0.0351 };
  if (interestCoverageRatio > 1.75) return { rating: 'B+', spread: 0.0478 };
  if (interestCoverageRatio > 1.5) return { rating: 'B', spread: 0.0728 };
  if (interestCoverageRatio > 1.25) return { rating: 'B-', spread: 0.0913 };
  if (interestCoverageRatio > 0.8) return { rating: 'CCC', spread: 0.1085 };
  if (interestCoverageRatio > 0.65) return { rating: 'CC', spread: 0.1245 };
  if (interestCoverageRatio > 0.2) return { rating: 'C', spread: 0.1580 };
  return { rating: 'D', spread: 0.2000 };
};

export const calculateCostOfDebt = (financials: StockFinancials): number => {
  // Prefer the backend-computed value: it uses actual interest expense from
  // the income statement rather than an assumed 5% yield on total debt.
  if (financials.costOfDebt > 0) {
    return financials.costOfDebt;
  }
  // Fallback for cases where backend value is absent.
  const estimatedInterestExpense = financials.totalDebt > 0 ? financials.totalDebt * 0.05 : 0;
  let spread = 0.0156; // Default BBB
  if (estimatedInterestExpense > 0) {
    const coverageRatio = financials.operatingIncome / estimatedInterestExpense;
    const ratingData = getSyntheticRating(coverageRatio);
    spread = ratingData.spread;
  }
  return financials.riskFreeRate + spread;
};

export const calculateWACC = (
  financials: StockFinancials,
  costOfDebt: number,
  equityRiskPremium?: number
): number => {
  const equityValue = financials.marketCap;
  const debtValue = financials.totalDebt;
  const totalValue = equityValue + debtValue;

  const weightEquity = totalValue > 0 ? equityValue / totalValue : 0;
  const weightDebt = totalValue > 0 ? debtValue / totalValue : 0;

  const erp = equityRiskPremium ?? financials.equityRiskPremium;
  const costOfEquity = financials.riskFreeRate + (financials.beta * erp);
  const afterTaxCostOfDebt = costOfDebt * (1 - financials.taxRate);

  return (weightEquity * costOfEquity) + (weightDebt * afterTaxCostOfDebt);
};

export const calculateIntrinsicValue = (
  financials: StockFinancials,
  inputs: {
    revenueGrowth: number;
    targetOperatingMargin: number;
    taxRate: number;
    terminalGrowthRate: number;
    wacc?: number;
    equityRiskPremium?: number;
    roic?: number;
  },
  modelType: 'FCFF' | 'DDM' | 'HIGH_GROWTH' = 'FCFF'
): DcfOutput => {
  const erp = inputs.equityRiskPremium ?? financials.equityRiskPremium;
  const syntheticCostOfDebt = calculateCostOfDebt(financials);
  const calculatedWacc = inputs.wacc ?? calculateWACC(financials, syntheticCostOfDebt, erp);
  const costOfEquity = financials.riskFreeRate + (financials.beta * erp);
  
  // Gordon Growth requires: discount_rate > terminal_growth.
  // Also bounded by the risk-free rate — no company can grow faster than the economy
  // in perpetuity (Damodaran). The WACC guard guarantees a positive denominator.
  const terminalGrowth = Math.min(
    inputs.terminalGrowthRate,
    financials.riskFreeRate,   // economy-growth ceiling
    calculatedWacc - 0.005     // denominator guard
  );

  let enterpriseValue = 0;
  let equityValue = 0;
  let explicitPeriodPV = 0;
  let cumDiscountFactor = 1;
  let discountedTV = 0;
  const projectedCashFlows: { year: number; freeCashFlow: number; presentValue: number; phase?: 1 | 2 }[] = [];
  let dividendGrowthRate: number | undefined = undefined;

  // MODEL SELECTION LOGIC
  
  if (modelType === 'DDM') {
    // DIVIDEND DISCOUNT MODEL
    // Use Cost of Equity as discount rate
    const discountRate = costOfEquity;

    const currentDiv = financials.dividendsPaid ?? 0;
    let currentDividend = currentDiv;

    // Sustainable dividend growth = ROIC × retention ratio (Damodaran).
    // Retention ratio = 1 − payout ratio = 1 − (dividends / net income).
    const ddmRoic = financials.roic > 0 ? financials.roic : 0.10;
    const netIncome = financials.netIncome ?? 0;
    // No Math.min cap on payoutRatio: payout > 100% yields negative growth,
    // which is Damodaran's signal for dividend cut risk. Floor at -0.5 to
    // prevent runaway compounding in deeply distressed cases.
    const payoutRatio = netIncome > 0
      ? (financials.dividendsPaid ?? 0) / netIncome
      : 0.5;
    dividendGrowthRate = Math.max(ddmRoic * (1 - payoutRatio), -0.5);

    for (let i = 1; i <= 5; i++) {
      currentDividend = currentDividend * (1 + dividendGrowthRate);
      
      cumDiscountFactor /= (1 + discountRate);
      const pv = currentDividend * cumDiscountFactor;
      
      equityValue += pv; // Direct Equity Value addition
      explicitPeriodPV += pv;
      
      projectedCashFlows.push({ year: i, freeCashFlow: currentDividend, presentValue: pv });
    }
    
    // Terminal Value (Gordon Growth Model)
    // TV = Div_n+1 / (Ke - g)
    const nextDividend = currentDividend * (1 + terminalGrowth);
    const terminalValue = nextDividend / (discountRate - terminalGrowth);
    discountedTV = terminalValue * cumDiscountFactor;
    
    equityValue += discountedTV;
    enterpriseValue = equityValue + financials.totalDebt - financials.cash; // Back into EV
    
  } else {
    // ADAPTIVE FCFF — lifecycle drives period length and growth-decay pattern.
    //
    //   High Growth   → 10-year explicit, two-phase decay (Damodaran 3-stage):
    //                    Phase 1 (yrs 1–5): growth holds near current level (moat intact)
    //                    Phase 2 (yrs 6–10): rapid convergence to terminal (normalisation)
    //   Mature Stable →  5-year explicit, single-phase linear decay
    const isHighGrowth = financials.lifecycle === 'High Growth';
    const explicitYears = isHighGrowth ? 10 : 5;
    const currentMargin = financials.revenue > 0 ? financials.operatingIncome / financials.revenue : 0;
    let currentRevenue = financials.revenue;

    for (let i = 1; i <= explicitYears; i++) {
      let yearGrowth: number;
      if (isHighGrowth) {
        if (i <= 5) {
          // Phase 1: gentle decay — growth goes from 100% to 80% of initial by yr 5
          yearGrowth = inputs.revenueGrowth * (1 - 0.2 * ((i - 1) / 4));
        } else {
          // Phase 2: rapid convergence from 80% of initial growth down to terminal
          const phase1End = inputs.revenueGrowth * 0.8;
          yearGrowth = phase1End + (terminalGrowth - phase1End) * ((i - 5) / 5);
        }
      } else {
        // Mature Stable: linear decay over 5 years
        yearGrowth = inputs.revenueGrowth + (terminalGrowth - inputs.revenueGrowth) * ((i - 1) / 4);
      }

      currentRevenue = currentRevenue * (1 + yearGrowth);
      const interpolatedMargin = currentMargin + ((inputs.targetOperatingMargin - currentMargin) * (i / explicitYears));
      const operatingIncome = currentRevenue * interpolatedMargin;
      const ebitAfterTax = operatingIncome * (1 - inputs.taxRate);

      const roic = (inputs.roic ?? financials.roic) || 0.15;
      const reinvestmentRate = Math.max(yearGrowth / roic, 0);
      const fcf = ebitAfterTax * (1 - reinvestmentRate);

      cumDiscountFactor /= (1 + calculatedWacc);
      const pv = fcf * cumDiscountFactor;

      enterpriseValue += pv;
      explicitPeriodPV += pv;
      projectedCashFlows.push({
        year: i,
        freeCashFlow: fcf,
        presentValue: pv,
        phase: isHighGrowth ? (i <= 5 ? 1 : 2) : undefined,
      });
    }

    // Terminal Value (Damodaran: terminal ROIC → WACC, competitive equilibrium)
    const revenueNext = currentRevenue * (1 + terminalGrowth);
    const nopatNext = revenueNext * inputs.targetOperatingMargin * (1 - inputs.taxRate);
    const stableReinvestmentRate = Math.max(terminalGrowth / calculatedWacc, 0);
    const terminalFcf = nopatNext * (1 - stableReinvestmentRate);

    const terminalValue = terminalFcf / (calculatedWacc - terminalGrowth);
    discountedTV = terminalValue * cumDiscountFactor;

    enterpriseValue += discountedTV;
    equityValue = enterpriseValue + financials.cash - financials.totalDebt;
  }

  // Option Valuation Check
  if (equityValue < 0) {
    equityValue = 0;
  }

  const shares = financials.sharesOutstanding;
  const impliedSharePrice = shares > 0 ? equityValue / shares : 0;
  const upside = financials.price > 0 ? (impliedSharePrice - financials.price) / financials.price : 0;

  // Rating — prefer backend-computed value (uses actual interest expense);
  // fall back to a local estimate only when the backend field is absent.
  let syntheticRating = financials.syntheticRating;
  if (!syntheticRating) {
    const estimatedInterestExpense = financials.totalDebt > 0 ? financials.totalDebt * 0.05 : 0;
    const coverageRatio = estimatedInterestExpense > 0 ? financials.operatingIncome / estimatedInterestExpense : 100;
    syntheticRating = getSyntheticRating(coverageRatio).rating;
  }

  return {
    intrinsicValue: impliedSharePrice,
    upside,
    impliedSharePrice,
    wacc: calculatedWacc,
    terminalValue: discountedTV,
    enterpriseValue,
    equityValue,
    costOfEquity,
    syntheticRating,
    dcfDetails: {
      explicitPeriodPV,
      terminalValuePV: discountedTV,
      projectedCashFlows,
      dividendGrowthRate
    }
  };
};

export interface ScenarioOutput {
  bear: DcfOutput;
  base: DcfOutput;
  bull: DcfOutput;
}

type DCFInputs = Parameters<typeof calculateIntrinsicValue>[1];

export const calculateScenarios = (
  financials: StockFinancials,
  baseInputs: DCFInputs,
  modelType: 'FCFF' | 'DDM' | 'HIGH_GROWTH' = 'FCFF'
): ScenarioOutput => {
  const baseWacc = baseInputs.wacc ?? calculateWACC(
    financials,
    calculateCostOfDebt(financials),
    baseInputs.equityRiskPremium
  );

  const bearInputs: DCFInputs = {
    ...baseInputs,
    revenueGrowth: baseInputs.revenueGrowth * 0.5,
    targetOperatingMargin: baseInputs.targetOperatingMargin * 0.85,
    wacc: Math.min(baseWacc + 0.02, 0.20),
  };
  const bullInputs: DCFInputs = {
    ...baseInputs,
    revenueGrowth: Math.min(baseInputs.revenueGrowth * 1.5, 0.50),
    targetOperatingMargin: Math.min(baseInputs.targetOperatingMargin * 1.15, 0.60),
    wacc: Math.max(baseWacc - 0.015, 0.04),
  };

  return {
    bear: calculateIntrinsicValue(financials, bearInputs, modelType),
    base: calculateIntrinsicValue(financials, baseInputs, modelType),
    bull: calculateIntrinsicValue(financials, bullInputs, modelType),
  };
};

// Wrapper for backward compatibility if needed, though we will update call sites.
export const calculateDCF = (
  financials: StockFinancials,
  inputs: {
    revenueGrowth: number;
    targetOperatingMargin: number;
    taxRate: number;
    terminalGrowthRate: number;
    wacc?: number;
  }
) => {
  return calculateIntrinsicValue(financials, inputs, financials.suggestedModel || 'FCFF');
};
