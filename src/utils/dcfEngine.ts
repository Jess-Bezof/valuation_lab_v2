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
  const estimatedInterestExpense = financials.totalDebt > 0 ? financials.totalDebt * 0.05 : 0;
  
  let spread = 0.0156; // Default BBB
  
  if (estimatedInterestExpense > 0) {
    const coverageRatio = financials.operatingIncome / estimatedInterestExpense;
    const ratingData = getSyntheticRating(coverageRatio);
    spread = ratingData.spread;
  }

  return financials.riskFreeRate + spread;
};

export const calculateWACC = (financials: StockFinancials, costOfDebt: number): number => {
  const equityValue = financials.marketCap;
  const debtValue = financials.totalDebt;
  const totalValue = equityValue + debtValue;

  const weightEquity = totalValue > 0 ? equityValue / totalValue : 0;
  const weightDebt = totalValue > 0 ? debtValue / totalValue : 0;

  const costOfEquity = financials.riskFreeRate + (financials.beta * financials.equityRiskPremium);
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
    wacc?: number; // Optional override
  },
  modelType: 'FCFF' | 'DDM' | 'HIGH_GROWTH' = 'FCFF'
): DcfOutput => {
  // Common Calculations
  const syntheticCostOfDebt = calculateCostOfDebt(financials);
  const calculatedWacc = inputs.wacc || calculateWACC(financials, syntheticCostOfDebt);
  const costOfEquity = financials.riskFreeRate + (financials.beta * financials.equityRiskPremium);
  
  // Mature Stable Lifecycle Check
  let terminalGrowth = inputs.terminalGrowthRate;
  if (terminalGrowth > 0.03) {
    terminalGrowth = 0.03; 
  }

  let enterpriseValue = 0;
  let equityValue = 0;
  let explicitPeriodPV = 0;
  let cumDiscountFactor = 1;
  let discountedTV = 0;
  const projectedCashFlows: { year: number; freeCashFlow: number; presentValue: number }[] = [];

  // MODEL SELECTION LOGIC
  
  if (modelType === 'DDM') {
    // DIVIDEND DISCOUNT MODEL
    // Use Cost of Equity as discount rate
    const discountRate = costOfEquity;
    
    // Estimate Payout Ratio (Div / Net Income)
    const currentDiv = financials.dividendsPaid || 0;
    const currentNetIncome = financials.netIncome || 1; // avoid div by zero
    
    // Base projection on dividend growth
    let currentDividend = currentDiv;
    
    for (let i = 1; i <= 5; i++) {
      // Grow dividends
      currentDividend = currentDividend * (1 + inputs.revenueGrowth); // Use rev growth as proxy
      
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
    
  } else if (modelType === 'HIGH_GROWTH') {
    // HIGH GROWTH MODEL (10 Years)
    // Interpolate Margins
    const currentMargin = financials.revenue > 0 ? financials.operatingIncome / financials.revenue : 0;
    const targetMargin = inputs.targetOperatingMargin;
    let currentRevenue = financials.revenue;
    
    for (let i = 1; i <= 10; i++) {
      currentRevenue = currentRevenue * (1 + inputs.revenueGrowth);
      
      // Linear Interpolation of Margin
      const interpolatedMargin = currentMargin + ((targetMargin - currentMargin) * (i / 10));
      
      const operatingIncome = currentRevenue * interpolatedMargin;
      const ebitAfterTax = operatingIncome * (1 - inputs.taxRate);
      
      // High growth often requires high reinvestment
      // Assume Reinvestment Rate fades from High to Stable? Or keep simplified:
      // Reinvestment = g / ROIC. 
      const roic = financials.roic || 0.15;
      const reinvestmentRate = inputs.revenueGrowth / roic;
      const fcf = ebitAfterTax * (1 - reinvestmentRate);
      
      cumDiscountFactor /= (1 + calculatedWacc);
      const pv = fcf * cumDiscountFactor;
      
      enterpriseValue += pv;
      explicitPeriodPV += pv;
      
      // Only push first 5 or 10? Chart handles dynamic? Chart likely handles it if we pass it.
      projectedCashFlows.push({ year: i, freeCashFlow: fcf, presentValue: pv });
    }
    
    // Terminal Value
    const revenueNext = currentRevenue * (1 + terminalGrowth);
    const nopatNext = revenueNext * targetMargin * (1 - inputs.taxRate);
    const stableRoic = calculatedWacc; 
    const stableReinvestmentRate = terminalGrowth / stableRoic;
    const terminalFcf = nopatNext * (1 - stableReinvestmentRate);
    
    const terminalValue = terminalFcf / (calculatedWacc - terminalGrowth);
    discountedTV = terminalValue * cumDiscountFactor;
    
    enterpriseValue += discountedTV;
    equityValue = enterpriseValue + financials.cash - financials.totalDebt;
    
  } else {
    // STANDARD FCFF (Default)
    let currentRevenue = financials.revenue;

    for (let i = 1; i <= 5; i++) {
      currentRevenue = currentRevenue * (1 + inputs.revenueGrowth);
      const operatingIncome = currentRevenue * inputs.targetOperatingMargin;
      const ebitAfterTax = operatingIncome * (1 - inputs.taxRate);
      
      const roic = financials.roic || 0.15; 
      const reinvestmentRate = inputs.revenueGrowth / roic; 
      const fcf = ebitAfterTax * (1 - reinvestmentRate);

      cumDiscountFactor /= (1 + calculatedWacc);
      const pv = fcf * cumDiscountFactor;
      
      enterpriseValue += pv;
      explicitPeriodPV += pv;

      projectedCashFlows.push({ year: i, freeCashFlow: fcf, presentValue: pv });
    }

    // Terminal Value
    const revenueNext = currentRevenue * (1 + terminalGrowth);
    const nopatNext = revenueNext * inputs.targetOperatingMargin * (1 - inputs.taxRate);
    const stableRoic = calculatedWacc; 
    const stableReinvestmentRate = terminalGrowth / stableRoic;
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

  // Rating
  const estimatedInterestExpense = financials.totalDebt > 0 ? financials.totalDebt * 0.05 : 0;
  const coverageRatio = estimatedInterestExpense > 0 ? financials.operatingIncome / estimatedInterestExpense : 100;
  const { rating } = getSyntheticRating(coverageRatio);

  return {
    intrinsicValue: impliedSharePrice,
    upside,
    impliedSharePrice,
    wacc: calculatedWacc,
    terminalValue: discountedTV,
    enterpriseValue,
    equityValue,
    costOfEquity,
    syntheticRating: rating,
    dcfDetails: {
      explicitPeriodPV,
      terminalValuePV: discountedTV,
      projectedCashFlows
    }
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
