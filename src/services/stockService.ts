import { AnalysisResult, StockFinancials, HistoryData, EventData } from '../types';
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
  wacc: 0.08
};

/**
 * 1. fetchStockAnalysis
 * Fetches deep financials and performs initial DCF calculation
 */
export const fetchStockAnalysis = async (ticker: string): Promise<AnalysisResult> => {
  const normalizedTicker = ticker.toUpperCase();
  
  try {
    const base = getApiBase();
    const response = await fetch(`${base}/api/analyze/${normalizedTicker}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(90000) // Increased to 90s for deep AI analysis
    });

    if (!response.ok) {
      throw new Error(`Backend error: ${response.status} ${response.statusText}`);
    }

    const backendData = await response.json();
    const financials = backendData.financials as StockFinancials;
    
    // Initialize inputs based on fetched data
    const inputs = { ...DEFAULT_INPUTS };
    
    if (financials.taxRate > 0 && financials.taxRate < 0.5) {
      inputs.taxRate = financials.taxRate;
    }

    const syntheticCostOfDebt = calculateCostOfDebt(financials);
    inputs.wacc = calculateWACC(financials, syntheticCostOfDebt);

    const actualGrowth = financials.revenueGrowth || 0.05;
    inputs.revenueGrowth = financials.suggestedModel === 'HIGH_GROWTH' 
      ? Math.min(Math.max(actualGrowth, 0.10), 0.50)
      : Math.min(Math.max(actualGrowth, 0.02), 0.15);

    const actualMargin = financials.operatingMargin || 0.15;
    inputs.targetOperatingMargin = actualMargin > 0 ? actualMargin : 0.10;

    const valuation = calculateIntrinsicValue(financials, inputs, financials.suggestedModel);

    return {
      financials,
      valuation,
      inputs,
      aiReport: backendData.aiReport,
      narrative: backendData.narrative
    };

  } catch (error) {
    console.error('Failed to fetch stock analysis:', error);
    throw error;
  }
};

/**
 * 2. fetchStockHistory
 * Fetches historical prices and events based on a dynamic time horizon
 */
export const fetchStockHistory = async (ticker: string, period: string = '1y', refresh: boolean = false): Promise<{ history: HistoryData[], events: EventData[] }> => {
  try {
    // Correctly appends the ?period= parameter for the backend
    const refreshQuery = refresh ? '&refresh=true' : '';
    const base = getApiBase();
    const response = await fetch(`${base}/api/stock-history/${ticker}?period=${period}${refreshQuery}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
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
 * 3. fetchStockEvents
 * Keeping for compatibility, though history likely carries this data now
 */
export const fetchStockEvents = async (ticker: string): Promise<EventData[]> => {
  try {
    const base = getApiBase();
    // Backend metrics endpoint replaces legacy events
    const response = await fetch(`${base}/api/metrics/${ticker}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (response.ok) {
      const data = await response.json();
      return data.events || [];
    }
  } catch (error) {
    console.warn('Backend events fetch failed', error);
  }
  return [];
};

/**
 * 4. fetchValuationFinancials
 * Fetches full historical financials from SEC EDGAR via the backend.
 */
export const fetchValuationFinancials = async (ticker: string): Promise<any> => {
  try {
    const base = getApiBase();
    const response = await fetch(`${base}/api/valuation/${ticker}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (response.ok) {
      return await response.json();
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
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
      signal
    });
    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }
    const data = await response.json();
    const normalized: PagedSearchResult = Array.isArray(data)
      ? { results: data, total: data.length, offset, limit }
      : { results: data.results || [], total: data.total || 0, offset: data.offset || offset, limit: data.limit || limit };
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
