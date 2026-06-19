/** Format a number with thousand commas and fixed decimal places. */
const n = (value: number, decimals: number): string =>
  value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

/**
 * Compact currency — scales to T / B / M with thousand commas.
 * Input: raw dollar value (e.g. 3.14e12 for Apple market cap).
 * Handles negative values by formatting the absolute amount and prepending "−".
 */
export const fmtCompact = (value: number): string => {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${n(abs / 1e12, 2)}T`;
  if (abs >= 1e9)  return `${sign}$${n(abs / 1e9,  2)}B`;
  if (abs >= 1e6)  return `${sign}$${n(abs / 1e6,  2)}M`;
  if (abs >= 1e3)  return `${sign}$${n(abs / 1e3,  2)}K`;
  return `${sign}$${n(abs, 2)}`;
};

/**
 * Dollar price / per-share value with thousand commas.
 * e.g. 600000 → "$600,000.00"
 */
export const fmtPrice = (value: number): string => `$${n(value, 2)}`;

/**
 * Values already expressed in millions — adds commas, appends "M".
 * e.g. 25431 → "$25,431M"
 * Uses Math.abs; caller prepends sign if needed.
 */
export const fmtM = (value: number, decimals = 0): string =>
  `$${n(Math.abs(value), decimals)}M`;

/**
 * Values expressed in millions, displayed as billions.
 * Divides by 1000, adds commas, appends "B".
 * e.g. 3_140_000 → "$3,140.0B"
 */
export const fmtB = (valueInMillions: number, decimals = 1): string =>
  `$${n(valueInMillions / 1000, decimals)}B`;

/**
 * Percentage from a decimal fraction (0.153 → "15.3%").
 */
export const fmtPct = (value: number, decimals = 1): string =>
  `${n(value * 100, decimals)}%`;

/**
 * Valuation multiple (25.3 → "25.3x").
 */
export const fmtX = (value: number, decimals = 1): string =>
  `${n(value, decimals)}x`;
