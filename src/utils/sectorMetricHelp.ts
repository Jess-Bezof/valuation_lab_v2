/** Explanations for sector-specific highlighted metrics (keyed by label). */
export const SECTOR_METRIC_HELP: Record<string, string> = {
  'Rule of 40':
    'Revenue growth % plus free-cash-flow margin %. Scores above 40 are often viewed as healthy for growth software; below 40 may signal weak growth or profitability.',
  'R&D Intensity':
    'Research & development spend as a share of revenue. Higher values indicate a more innovation-driven, IP-heavy business model.',
  'Gross Margin':
    'Gross profit divided by revenue. Measures pricing power and unit economics before operating expenses.',
  'Inventory Turnover':
    'Cost of goods sold divided by average inventory. Higher turnover means inventory sells through faster (capital efficiency).',
  'Net Margin':
    'Net income as a percentage of revenue. Bottom-line profitability after all expenses.',
  'Return on Assets':
    'Net income divided by total assets. Shows how efficiently the company uses its asset base.',
  'Return on Equity':
    'Net income divided by shareholders\' equity. Core profitability metric for banks and financial firms.',
  'Fin. Leverage':
    'Total assets divided by equity (equity multiplier). Higher leverage amplifies returns but increases risk.',
  'Dividend Yield':
    'Annual dividend per share divided by share price. Income return to shareholders.',
  'Est. FFO (M)':
    'Estimated funds from operations (net income + depreciation), in millions. Common cash-earnings proxy for REITs.',
  'Debt / EBITDA':
    'Total debt divided by EBITDA. Leverage gauge; higher ratios imply more debt relative to operating cash generation.',
  'Current Ratio':
    'Current assets divided by current liabilities. Liquidity buffer for near-term obligations (>1 is generally solvent).',
  'Debt / Equity':
    'Total debt divided by shareholders\' equity. Capital structure leverage vs. equity cushion.',
};

export const getSectorMetricHelp = (label: string, template: string): string =>
  SECTOR_METRIC_HELP[label] ??
  `${label} is a ${template} sector metric computed from the latest financial statements to complement the DCF view.`;
