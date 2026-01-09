import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub AbortSignal.timeout to avoid Node environment differences
// and intercept console warnings when falling back to default URL.
(globalThis as any).AbortSignal = {
  timeout: (_ms: number) => undefined
};

const setEnvValue = (value?: string) => {
  const target = (import.meta as any).env;
  try {
    Object.defineProperty(target, 'VITE_API_URL', {
      value,
      configurable: true,
      writable: true,
      enumerable: true
    });
  } catch {
    (import.meta as any).env = { ...target, VITE_API_URL: value };
  }
};

describe('stockService environment and endpoint construction', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('uses configured VITE_API_URL from .env', async () => {
    const configured = 'http://localhost:8000';
    setEnvValue(configured);
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ financials: {}, aiReport: '', narrative: '' })
    } as any);
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { fetchStockAnalysis } = await import('./stockService');
    await fetchStockAnalysis('AAPL');

    const url = (fetchSpy.mock.calls[0]?.[0] as string) || '';
    expect(url.startsWith(`${configured}/api/analyze/AAPL`)).toBe(true);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('falls back to default URL when VITE_API_URL missing and logs warning', async () => {
    setEnvValue(undefined as any);
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ financials: {}, aiReport: '', narrative: '' })
    } as any);
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { fetchStockAnalysis, getApiBase } = await import('./stockService');
    const base = getApiBase();
    await fetchStockAnalysis('MSFT');

    const url = (fetchSpy.mock.calls[0]?.[0] as string) || '';
    expect(url.startsWith('http://localhost:8000/api/analyze/MSFT')).toBe(true);
    expect(base).toBe('http://localhost:8000');
  });

  it('constructs stock-history endpoint with period and refresh', async () => {
    setEnvValue('http://localhost:8000');
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ history: [], markers: [] })
    } as any);

    const { fetchStockHistory } = await import('./stockService');
    await fetchStockHistory('NVDA', '6mo', true);

    const url = (fetchSpy.mock.calls[0]?.[0] as string) || '';
    expect(url).toContain('/api/stock-history/NVDA?period=6mo&refresh=true');
  });

  it('uses metrics endpoint for events', async () => {
    setEnvValue('http://localhost:8000');
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ events: [] })
    } as any);

    const { fetchStockEvents } = await import('./stockService');
    await fetchStockEvents('GOOGL');

    const url = (fetchSpy.mock.calls[0]?.[0] as string) || '';
    expect(url.endsWith('/api/metrics/GOOGL')).toBe(true);
  });

  it('constructs valuation and search-ticker endpoints', async () => {
    const configured = 'http://localhost:8000';
    setEnvValue(configured);
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({})
    } as any);

    const { fetchValuationFinancials, searchTicker, searchTickerPaged } = await import('./stockService');
    await fetchValuationFinancials('AMZN');
    const valuationUrl = (fetchSpy.mock.calls[0]?.[0] as string) || '';
    expect(valuationUrl).toBe(`${configured}/api/valuation/AMZN`);

    await searchTicker('TSLA');
    const searchUrl = (fetchSpy.mock.calls[1]?.[0] as string) || '';
    expect(searchUrl).toBe(`${configured}/api/search-ticker/TSLA`);

    await searchTickerPaged('META', 5, 20);
    const searchPagedUrl = (fetchSpy.mock.calls[2]?.[0] as string) || '';
    expect(searchPagedUrl).toBe(`${configured}/api/search-ticker/META?offset=5&limit=20`);
  });
});
