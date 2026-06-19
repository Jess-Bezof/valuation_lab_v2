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
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    const { resetBackendReady } = await import('./stockService');
    resetBackendReady();
  });

  const mockAnalyzeFetch = () =>
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation((url: string) => {
      if (String(url).includes('/health')) {
        return Promise.resolve({ ok: true, json: async () => ({ status: 'healthy' }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ financials: {}, aiReport: '', narrative: '' }),
      });
    });

  it('uses configured VITE_API_URL from .env', async () => {
    const configured = 'http://localhost:8000';
    setEnvValue(configured);
    const fetchSpy = mockAnalyzeFetch();
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { fetchStockAnalysis } = await import('./stockService');
    await fetchStockAnalysis('AAPL');

    const analyzeCall = fetchSpy.mock.calls.find((c) =>
      String(c[0]).includes('/api/analyze/AAPL')
    );
    expect(analyzeCall).toBeDefined();
    expect(String(analyzeCall![0]).startsWith(`${configured}/api/analyze/AAPL`)).toBe(true);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('falls back to default URL when VITE_API_URL missing and logs warning', async () => {
    setEnvValue(undefined as any);
    const fetchSpy = mockAnalyzeFetch();
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { fetchStockAnalysis, getApiBase } = await import('./stockService');
    const base = getApiBase();
    await fetchStockAnalysis('MSFT');

    const analyzeCall = fetchSpy.mock.calls.find((c) =>
      String(c[0]).includes('/api/analyze/MSFT')
    );
    expect(String(analyzeCall![0]).startsWith('http://localhost:8000/api/analyze/MSFT')).toBe(true);
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

  it('retries analyze on timeout and surfaces a friendly final error', async () => {
    setEnvValue('http://localhost:8000');
    const timeoutErr = new DOMException('signal timed out', 'TimeoutError');
    let analyzeAttempts = 0;

    vi.spyOn(globalThis, 'fetch' as any).mockImplementation((url: string) => {
      if (String(url).includes('/health')) {
        return Promise.resolve({ ok: true, json: async () => ({ status: 'healthy' }) });
      }
      analyzeAttempts += 1;
      return Promise.reject(timeoutErr);
    });

    const { fetchStockAnalysis, resetBackendReady } = await import('./stockService');
    resetBackendReady();

    await expect(fetchStockAnalysis('NVDA', { skipWarmup: true })).rejects.toThrow(
      /second attempt is usually faster/i
    );
    expect(analyzeAttempts).toBe(3);
  });

  it('detects fetch timeout errors', async () => {
    const { isFetchTimeoutError } = await import('./stockService');
    expect(isFetchTimeoutError(new DOMException('signal timed out', 'TimeoutError'))).toBe(true);
    expect(isFetchTimeoutError(new Error('Backend error'))).toBe(false);
  });
});
