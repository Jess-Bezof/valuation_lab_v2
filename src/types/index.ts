export interface ValuationMultiples {
  pe: number;
  forwardPe: number;
  evToEbitda: number;
  priceToBook?: number;
  ps?: number;
  earningsYield?: number;
  sector: string;
  industry: string;
}

export interface HistoricalMetric {
  year: string;
  pe: number;
  ps: number;
  pb: number;
}

export interface SectorMetric {
  label: string;
  value: number;
  format: 'number' | 'percent' | 'currency';
}

export interface SectorStats {
  template: string;
  metrics: SectorMetric[];
}

export interface StockFinancials {
  ticker: string;
  lastUpdated?: string;
  name: string;
  price: number;
  beta: number;
  marketCap: number; // in millions
  totalDebt: number; // in millions
  cash: number; // in millions
  revenue: number; // in millions
  operatingIncome: number; // in millions
  taxRate: number; // as decimal (e.g., 0.21)
  sharesOutstanding: number; // in millions
  salesPerShare?: number; // computed as revenue / sharesOutstanding
  wacc: number; // as decimal
  roic: number; // as decimal
  reinvestmentEfficiency?: number; // Sales-to-Capital Ratio
  listingStatus: 'Public' | 'Private';
  costOfDebt: number; // as decimal
  riskFreeRate: number; // as decimal
  equityRiskPremium: number; // as decimal
  lifecycle?: 'High Growth' | 'Mature Stable';
  dividendsPaid?: number; // in millions
  netIncome?: number; // in millions
  revenueGrowth?: number; // historical/current
  operatingMargin?: number; // current
  valuationMultiples?: ValuationMultiples;
  suggestedModel?: 'FCFF' | 'DDM' | 'HIGH_GROWTH';
  peerDetails?: { ticker: string; metrics: ValuationMultiples }[];
  historicalMetrics?: HistoricalMetric[];
  sectorStats?: SectorStats;
}

export interface HistoryData {
  time: string;
  value: number;
}

export interface EventData {
  time: string;
  title: string;
  summary: string;
}

export interface DcfOutput {
  intrinsicValue: number;
  upside: number;
  impliedSharePrice: number;
  wacc: number;
  terminalValue: number;
  enterpriseValue: number;
  equityValue: number;
  costOfEquity: number;
  syntheticRating: string;
  dcfDetails: {
    explicitPeriodPV: number;
    terminalValuePV: number;
    projectedCashFlows: { year: number; freeCashFlow: number; presentValue: number }[];
  };
}

export interface AnalysisResult {
  financials: StockFinancials;
  valuation: DcfOutput;
  inputs: {
    revenueGrowth: number;
    targetOperatingMargin: number;
    taxRate: number;
    terminalGrowthRate: number;
    wacc: number;
  };
  aiReport?: string;
  narrative?: {
    valuationStory: string;
    keyDrivers: string;
    riskFactors: string;
  };
  suggestedModel?: 'FCFF' | 'DDM' | 'HIGH_GROWTH';
  peerDetails?: { ticker: string; metrics: ValuationMultiples }[];
}
