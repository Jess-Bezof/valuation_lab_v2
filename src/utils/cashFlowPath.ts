import { AnalysisResult } from '../types';

export type CashFlowPathStatus =
  | 'distressed'
  | 'critical'
  | 'caution'
  | 'info'
  | 'sustainable'
  | 'ddm_unsustainable';

export const CASH_FLOW_PATH_INFO =
  'Compares your revenue growth assumption to ROIC and projected free cash flows. Flags when growth may destroy value, when reinvestment is strategic, or when dividends look unsustainable (DDM).';

export const CAPITAL_EFFICIENCY_INFO =
  'Sales-to-capital ratio (revenue ÷ invested capital). Measures how much revenue each dollar of invested capital generates — higher is more capital-efficient.';

export function getCashFlowPathStatus(
  analysis: AnalysisResult,
  selectedModel: 'FCFF' | 'DDM'
): CashFlowPathStatus {
  const projectedFCFs = analysis.valuation.dcfDetails.projectedCashFlows;
  const anyNegativeFCF = projectedFCFs.some((f) => f.freeCashFlow < 0);
  const historicalRoic = analysis.financials.roic;        // for distressed check only
  const modelRoic = analysis.inputs.roic;                 // same ROIC the DCF engine uses
  const growthRate = analysis.inputs.revenueGrowth;
  const growthExceedsRoic = growthRate > modelRoic;
  const ddmDivGrowth = analysis.valuation.dcfDetails.dividendGrowthRate;
  const unsustainableDdm =
    selectedModel === 'DDM' && ddmDivGrowth !== undefined && ddmDivGrowth < 0;

  if (unsustainableDdm) return 'ddm_unsustainable';
  if (historicalRoic < 0 && anyNegativeFCF) return 'distressed'; // real financial distress
  if (growthExceedsRoic && anyNegativeFCF) return 'critical';
  if (growthExceedsRoic && !anyNegativeFCF) return 'caution';
  if (!growthExceedsRoic && anyNegativeFCF) return 'info';
  return 'sustainable';
}

export const CASH_FLOW_PATH_CONFIGS: Record<
  CashFlowPathStatus,
  { bg: string; border: string; text: string; title: string; desc: string }
> = {
  ddm_unsustainable: {
    bg: 'bg-amber-900/20',
    border: 'border-amber-700',
    text: 'text-amber-200',
    title: 'Warning: Unsustainable Dividend Payout',
    desc: 'Dividends exceed earnings (payout > 100%). A negative sustainable growth rate signals a likely dividend cut.',
  },
  distressed: {
    bg: 'bg-red-950',
    border: 'border-red-600 border-2',
    text: 'text-red-100',
    title: 'Emergency: Distressed Business Model',
    desc: 'Cash burn with negative ROIC suggests the core model may not be viable without new capital.',
  },
  critical: {
    bg: 'bg-red-900/20',
    border: 'border-red-800',
    text: 'text-red-200',
    title: 'Critical Warning: Value-Destructive Burn',
    desc: 'Growth exceeds ROIC while FCF is negative — expansion may erode intrinsic value.',
  },
  caution: {
    bg: 'bg-amber-900/20',
    border: 'border-amber-800',
    text: 'text-amber-200',
    title: 'Caution: Inefficient Growth',
    desc: 'FCF is positive today, but growth outpaces ROIC — low-return projects may drag valuation over time.',
  },
  info: {
    bg: 'bg-blue-900/20',
    border: 'border-blue-800',
    text: 'text-blue-200',
    title: 'Info: Strategic Reinvestment',
    desc: 'Temporary negative FCF with strong ROIC can be healthy reinvestment for long-term value.',
  },
  sustainable: {
    bg: 'bg-emerald-900/10',
    border: 'border-emerald-800/50',
    text: 'text-emerald-200',
    title: 'Sustainable Cash Flow Path',
    desc: 'Growth is in line with returns; projected cash flows and ROIC support a sustainable path.',
  },
};
