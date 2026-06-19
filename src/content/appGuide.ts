export interface GuideSection {
  id: string;
  title: string;
  body: string;
}

export const APP_GUIDE_TITLE = 'Financial Valuation Lab';
export const APP_GUIDE_TAGLINE =
  'Damodaran-style DCF and dividend models with AI-normalized assumptions, sector metrics, and market context.';

export const APP_GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'start',
    title: 'Getting started',
    body:
      'Search or enter a ticker (e.g. NVDA, AAPL) and click Analyze. The app loads market data, runs a valuation model, and fetches SEC filings. Use Refresh AI Analysis to regenerate AI narrative and normalized levers.',
  },
  {
    id: 'header',
    title: 'Header cards',
    body:
      'Intrinsic Value shows per-share fair value from your model and scenario (Bear / Base / Bull). Upside compares that value to the live market price. WACC is the discount rate used in the DCF.',
  },
  {
    id: 'fcf',
    title: 'Free Cash Flow tab',
    body:
      'The core valuation tab. Projected free cash flows for years 1–10 are discounted to present value and shown as a bar chart. Below, Detailed Metrics break down enterprise value, terminal value, and value creation (ROIC − WACC).',
  },
  {
    id: 'financials',
    title: 'Financial Highlights tab',
    body:
      'Historical line items from SEC EDGAR (10-K), year by year. Useful for auditing revenue, margins, and balance-sheet trends behind your assumptions.',
  },
  {
    id: 'sentiment',
    title: 'Sentiment Analysis tab',
    body:
      'Full price history with AI-labeled news markers on large moves. Hover markers for headline summaries and sentiment color (green / red / amber).',
  },
  {
    id: 'report',
    title: 'Research Report tab',
    body:
      'AI-generated equity research: business description, valuation story, key drivers, and risks. Complements the numeric model with qualitative context.',
  },
  {
    id: 'multiples',
    title: 'Market Multiples tab',
    body:
      'Relative valuation vs peers and historical P/E, P/S, P/B. Add or remove peers to compare trading multiples to your intrinsic value estimate.',
  },
  {
    id: 'levers',
    title: 'Valuation Levers (right panel)',
    body:
      'Adjust revenue growth, target margin, tax rate, WACC, terminal growth, and equity risk premium — intrinsic value updates instantly. The violet AI Company Profile summarizes cyclicality and moat. Teal chips under sliders show AI-suggested inputs for that lever only; drag sliders to override.',
  },
];

export const INTRO_STORAGE_KEY = 'stock-analyzer-intro-dismissed';
