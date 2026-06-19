import { AnalysisResult, StockFinancials, ValuationAdjustments, HistoryData, EventData, SECFinancials } from '../types';
import { calculateIntrinsicValue, calculateWACC, calculateCostOfDebt } from '../utils/dcfEngine';

// Environment handling:
// - Requires VITE_API_URL set in .env at project root
// - Falls back to http://localhost:8000 with a warning when not set
// - All endpoints use /api/* prefix to match FastAPI routes

export const getApiBase = (): string => {
  const base = import.meta.env.VITE_API_URL || 'http://localhost:8000';
  if (!import.meta.env.VITE_API_URL) {
    console.warn('VITE_API_URL not set; falling back to http://localhost:8000');
  }
  return base;
};
const DEFAULT_INPUTS = {
  revenueGrowth: 0.10,
  targetOperatingMargin: 0.25,
  taxRate: 0.21,
  terminalGrowthRate: 0.02,
  wacc: 0.08,
  equityRiskPremium: 0.045,
  roic: 0.15,
};

/** Per-attempt timeout for /api/analyze (cold start + yfinance + AI). */
const ANALYZE_TIMEOUT_MS = 180_000;
const HEALTH_ATTEMPT_TIMEOUT_MS = 15_000;
const WARMUP_INTERVAL_MS = 4_000;
const WARMUP_MAX_ATTEMPTS = 30;
const ANALYZE_MAX_RETRIES = 2;

let backendReady = false;

export type FetchStatusCallback = (message: string) => void;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const isFetchTimeoutError = (error: unknown): boolean => {
  if (error instanceof DOMException) {
    return error.name === 'TimeoutError' || error.name === 'AbortError';
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('signal timed out') || msg.includes('aborted');
  }
  return false;
};

/** Reset warm-up cache (e.g. after explicit backend URL change in dev). */
export const resetBackendReady = () => {
  backendReady = false;
};

/**
 * Ping /health until the backend responds. Handles Render cold starts.
 */
export const warmUpBackend = async (onStatus?: FetchStatusCallback): Promise<void> => {
  if (backendReady) return;

  const base = getApiBase();
  onStatus?.('Starting server…');

  for (let attempt = 1; attempt <= WARMUP_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${base}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(HEALTH_ATTEMPT_TIMEOUT_MS),
      });
      if (response.ok) {
        backendReady = true;
        onStatus?.('Server ready — loading analysis…');
        return;
      }
    } catch {
      // Render may still be spinning up
    }

    if (attempt < WARMUP_MAX_ATTEMPTS) {
      onStatus?.(`Starting server… (${attempt}/${WARMUP_MAX_ATTEMPTS})`);
      await sleep(WARMUP_INTERVAL_MS);
    }
  }

  throw new Error(
    'Could not reach the analysis server. It may still be waking up — please wait a moment and try again.'
  );
};

const buildAnalysisResult = (
  backendData: {
    financials: StockFinancials;
    aiReport?: string;
    narrative?: AnalysisResult['narrative'];
    valuationAdjustments?: ValuationAdjustments;
  }
): AnalysisResult => {
  const financials = backendData.financials;
  const valuationAdjustments = backendData.valuationAdjustments;

  const inputs = { ...DEFAULT_INPUTS };

  if (financials.taxRate > 0 && financials.taxRate < 0.5) {
    inputs.taxRate = financials.taxRate;
  }

  inputs.equityRiskPremium = financials.equityRiskPremium ?? 0.045;
  const syntheticCostOfDebt = calculateCostOfDebt(financials);
  inputs.wacc = calculateWACC(financials, syntheticCostOfDebt, inputs.equityRiskPremium);

  const aiAdj = valuationAdjustments?.adjustments;

  if (aiAdj?.revenueGrowth) {
    inputs.revenueGrowth = aiAdj.revenueGrowth.value;
  } else {
    const actualGrowth = financials.revenueGrowth || 0.05;
    inputs.revenueGrowth = financials.suggestedModel === 'HIGH_GROWTH'
      ? Math.min(Math.max(actualGrowth, 0.10), 0.50)
      : Math.min(Math.max(actualGrowth, 0.02), 0.15);
  }

  if (aiAdj?.targetOperatingMargin) {
    inputs.targetOperatingMargin = aiAdj.targetOperatingMargin.value;
  } else {
    const actualMargin = financials.operatingMargin || 0.15;
    inputs.targetOperatingMargin = actualMargin > 0 ? actualMargin : 0.10;
  }

  if (aiAdj?.roic) {
    inputs.roic = aiAdj.roic.value;
  } else {
    inputs.roic = financials.roic > 0 ? financials.roic : 0.15;
  }

  const valuation = calculateIntrinsicValue(financials, inputs, financials.suggestedModel);

  return {
    financials,
    valuation,
    inputs,
    aiReport: backendData.aiReport,
    narrative: backendData.narrative,
    valuationAdjustments,
  };
};

const fetchAnalyzeOnce = async (ticker: string, refresh = false): Promise<AnalysisResult> => {
  const base = getApiBase();
  const url = refresh ? `${base}/api/analyze/${ticker}?refresh=true` : `${base}/api/analyze/${ticker}`;
  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(ANALYZE_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Backend error: ${response.status} ${response.statusText}`);
  }

  const backendData = await response.json();
  return buildAnalysisResult(backendData);
};

export type FetchStockAnalysisOptions = {
  onStatus?: FetchStatusCallback;
  skipWarmup?: boolean;
  refresh?: boolean;
};

/**
 * 1. fetchStockAnalysis
 * Warms the backend (Render cold start), then fetches analysis with retries on timeout.
 */
export const fetchStockAnalysis = async (
  ticker: string,
  options?: FetchStockAnalysisOptions
): Promise<AnalysisResult> => {
  const normalizedTicker = ticker.toUpperCase();
  const { onStatus, skipWarmup = false, refresh = false } = options ?? {};

  try {
    if (!skipWarmup) {
      await warmUpBackend(onStatus);
    } else {
      onStatus?.('Loading analysis…');
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= ANALYZE_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        onStatus?.(`Analysis took too long — retrying (${attempt}/${ANALYZE_MAX_RETRIES})…`);
      } else {
        onStatus?.('Running valuation and AI analysis…');
      }

      try {
        return await fetchAnalyzeOnce(normalizedTicker, refresh);
      } catch (error) {
        lastError = error;
        if (!isFetchTimeoutError(error) || attempt >= ANALYZE_MAX_RETRIES) {
          throw error;
        }
        console.warn(`Analyze attempt ${attempt + 1} timed out for ${normalizedTicker}, retrying…`);
      }
    }

    throw lastError;
  } catch (error) {
    console.error('Failed to fetch stock analysis:', error);
    if (isFetchTimeoutError(error)) {
      throw new Error(
        'Analysis timed out while the server was starting or processing data. Please try again — the second attempt is usually faster.'
      );
    }
    throw error;
  }
};

/**
 * 2. fetchStockHistory
 * Fetches historical prices and events based on a dynamic time horizon
 */
export const fetchStockHistory = async (ticker: string, period: string = '1y', refresh: boolean = false, signal?: AbortSignal): Promise<{ history: HistoryData[], events: EventData[] }> => {
  try {
    const refreshQuery = refresh ? '&refresh=true' : '';
    const base = getApiBase();
    const response = await fetch(`${base}/api/stock-history/${ticker}?period=${period}${refreshQuery}`, {
      method: 'GET',
      signal,
    });

    if (response.ok) {
      const data = await response.json();
      // Ensure history is returned as a clean array to prevent chart crashes
      return {
        history: data.history || [],
        events: data.markers || data.events || []
      };
    }
    throw new Error('Failed to fetch history');
  } catch (error) {
    console.error('Backend history fetch failed', error);
    // Return empty arrays on failure so the UI doesn't break
    return { history: [], events: [] };
  }
};

/**
 * 3. fetchValuationFinancials
 * Fetches full historical financials from SEC EDGAR via the backend.
 */
export const fetchValuationFinancials = async (ticker: string): Promise<SECFinancials | null> => {
  try {
    const base = getApiBase();
    const response = await fetch(`${base}/api/valuation/${ticker}`, {
      method: 'GET',
    });

    if (response.ok) {
      return await response.json() as SECFinancials;
    }
    console.warn('SEC data not found');
    return null;
  } catch (error) {
    console.error('Failed to fetch valuation financials:', error);
    return null;
  }
};

/**
 * 5. searchTicker
 * Searches for companies matching the query.
 */
export const searchTicker = async (query: string): Promise<{ ticker: string, name: string, exchange: string }[]> => {
  if (!query || query.length < 1) return [];
  try {
    const base = getApiBase();
    const response = await fetch(`${base}/api/search-ticker/${query}`, {
      method: 'GET',
    });

    if (response.ok) {
      return await response.json();
    }
    return [];
  } catch (error) {
    console.error('Ticker search failed:', error);
    return [];
  }
};

type PagedSearchResult = {
  results: { ticker: string, name: string, exchange: string }[];
  total: number;
  offset: number;
  limit: number;
};

const SEARCH_CACHE = new Map<string, { timestamp: number, data: PagedSearchResult | { ticker: string, name: string, exchange: string }[] }>();
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_CACHE_MAX = 500;

export const searchTickerPaged = async (
  query: string,
  offset: number = 0,
  limit: number = 10,
  signal?: AbortSignal
): Promise<PagedSearchResult> => {
  if (!query || query.length < 2) return { results: [], total: 0, offset, limit };
  const key = `q=${query}|o=${offset}|l=${limit}`;
  const now = Date.now();
  const cached = SEARCH_CACHE.get(key);
  if (cached && (now - cached.timestamp) < SEARCH_CACHE_TTL_MS) {
    const data = cached.data as PagedSearchResult;
    return data;
  }
  try {
    const base = getApiBase();
    const url = `${base}/api/search-ticker/${encodeURIComponent(query)}?offset=${offset}&limit=${limit}`;
    const response = await fetch(url, {
      method: 'GET',
      signal,
    });
    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }
    const data = await response.json();
    const normalized: PagedSearchResult = Array.isArray(data)
      ? { results: data, total: data.length, offset, limit }
      : { results: data.results || [], total: data.total || 0, offset: data.offset || offset, limit: data.limit || limit };
    if (SEARCH_CACHE.size >= SEARCH_CACHE_MAX) {
      // Evict oldest entry (Map preserves insertion order)
      SEARCH_CACHE.delete(SEARCH_CACHE.keys().next().value!);
    }
    SEARCH_CACHE.set(key, { timestamp: now, data: normalized });
    return normalized;
  } catch (error) {
    const err = error as unknown;
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { results: [], total: 0, offset, limit };
    }
    console.error('Paged ticker search failed:', error);
    throw error;
  }
};
