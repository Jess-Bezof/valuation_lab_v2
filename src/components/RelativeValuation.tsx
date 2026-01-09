import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Activity, Plus, X, History, TrendingUp } from 'lucide-react';
import { ValuationMultiples, HistoricalMetric } from '../types';
import { searchTickerPaged } from '../services/stockService';

interface PeerData {
  ticker: string;
  metrics: ValuationMultiples;
}

interface RelativeValuationProps {
  currentTicker: string;
  currentMetrics?: ValuationMultiples;
  initialPeers?: PeerData[];
  historicalMetrics?: HistoricalMetric[];
  salesPerShare?: number;
}

const RelativeValuation: React.FC<RelativeValuationProps> = ({ 
  currentTicker, 
  currentMetrics, 
  initialPeers = [],
  historicalMetrics = [],
  salesPerShare
}) => {
  const [peers, setPeers] = useState<PeerData[]>(initialPeers);
  const [newTicker, setNewTicker] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<{ ticker: string, name: string, exchange: string }[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [totalResults, setTotalResults] = useState<number>(0);
  const [currentOffset, setCurrentOffset] = useState<number>(0);

  useEffect(() => {
    setPeers(initialPeers);
  }, [initialPeers]);

  const calculateAverages = () => {
    if (peers.length === 0) return { pe: 0, evToEbitda: 0, pb: 0, ps: 0 };
    const valuesPs = peers.map(p => p.metrics.ps || 0).filter(v => v > 0);
    const sum = peers.reduce((acc, peer) => ({
      pe: acc.pe + (peer.metrics.pe || 0),
      evToEbitda: acc.evToEbitda + (peer.metrics.evToEbitda || 0),
      pb: acc.pb + (peer.metrics.priceToBook || 0),
      ps: acc.ps + (peer.metrics.ps || 0)
    }), { pe: 0, evToEbitda: 0, pb: 0, ps: 0 });
    const unweightedPs = valuesPs.length ? (sum.ps / valuesPs.length) : 0;
    return {
      pe: sum.pe / peers.length,
      evToEbitda: sum.evToEbitda / peers.length,
      pb: sum.pb / peers.length,
      ps: unweightedPs
    };
  };

  const averages = calculateAverages();

  const handleAddPeer = async () => {
    if (!newTicker.trim()) return;
    
    const tickerToAdd = newTicker.trim().toUpperCase();
    if (peers.some(p => p.ticker === tickerToAdd) || tickerToAdd === currentTicker) {
      setError('Ticker already in list or matches current.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`http://localhost:8000/api/metrics/${tickerToAdd}`);
      if (!response.ok) throw new Error('Failed to fetch metrics');
      
      const data = await response.json();
      setPeers([...peers, { ticker: data.ticker, metrics: data.metrics }]);
      setNewTicker('');
      setSuccessMessage(`Added ${data.ticker} to peers`);
      setTimeout(() => setSuccessMessage(null), 2500);
    } catch (_err) {
      setError('Could not find ticker data.');
    } finally {
      setLoading(false);
    }
  };

  const handleRemovePeer = (tickerToRemove: string) => {
    setPeers(peers.filter(p => p.ticker !== tickerToRemove));
  };

  const selectResult = useCallback(async (res: { ticker: string, name: string, exchange: string }) => {
    setShowDropdown(false);
    setHighlightedIndex(-1);
    setInputText(res.ticker);
    if (peers.some(p => p.ticker === res.ticker) || res.ticker === currentTicker) {
      setError('Ticker already in list or matches current.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`http://localhost:8000/api/metrics/${res.ticker}`);
      if (!response.ok) throw new Error('Failed to fetch metrics');
      const data = await response.json();
      setPeers([...peers, { ticker: data.ticker, metrics: data.metrics }]);
      setInputText('');
      setSuccessMessage(`Added ${data.ticker} to peers`);
      setTimeout(() => setSuccessMessage(null), 2500);
    } catch (e) {
      setError('Could not find ticker data.');
    } finally {
      setLoading(false);
    }
  }, [peers, currentTicker]);

  useEffect(() => {
    const handler = setTimeout(async () => {
      const q = inputText.trim();
      if (q.length < 2) {
        setSearchResults([]);
        setShowDropdown(false);
        setIsSearching(false);
        return;
      }
      if (abortRef.current) {
        abortRef.current.abort();
      }
      abortRef.current = new AbortController();
      setIsSearching(true);
      try {
        const res = await searchTickerPaged(q, 0, 10, abortRef.current.signal);
        setSearchResults(res.results);
        setTotalResults(res.total || res.results.length);
        setCurrentOffset(res.offset || 0);
        setShowDropdown(true);
      } catch (_e) {
        setError('Search failed. Try again.');
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [inputText]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, searchResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < searchResults.length) {
        selectResult(searchResults[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setHighlightedIndex(-1);
    }
  };

  if (!currentMetrics) return null;

  return (
    <div className="space-y-6">
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5 text-purple-500" />
          MARKET MULTIPLES (Relative Valuation)
        </h3>

        {/* Competitor Comparison Table */}
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-800/50">
              <tr>
                <th className="px-4 py-3 rounded-l-lg">Ticker</th>
                <th className="px-4 py-3">P/E Ratio</th>
                <th className="px-4 py-3">EV/EBITDA</th>
                <th className="px-4 py-3">P/Book</th>
                <th className="px-4 py-3">P/S Ratio</th>
                <th className="px-4 py-3">Earnings Yield</th>
                <th className="px-4 py-3 rounded-r-lg">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {/* Target Company Row */}
              <tr className="bg-slate-800/20 font-medium">
                <td className="px-4 py-3 text-white flex items-center gap-2">
                  {currentTicker} 
                  <span className="text-[10px] bg-blue-900 text-blue-200 px-1.5 py-0.5 rounded border border-blue-800">TARGET</span>
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {typeof currentMetrics.pe === 'number' && currentMetrics.pe > 0 ? `${currentMetrics.pe.toFixed(1)}x` : <span title="Data not available" className="text-slate-500">-</span>}
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {typeof currentMetrics.evToEbitda === 'number' && currentMetrics.evToEbitda > 0 ? `${currentMetrics.evToEbitda.toFixed(1)}x` : <span title="Data not available" className="text-slate-500">-</span>}
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {typeof currentMetrics.priceToBook === 'number' && currentMetrics.priceToBook > 0 ? `${currentMetrics.priceToBook.toFixed(1)}x` : <span title="Data not available" className="text-slate-500">-</span>}
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {typeof currentMetrics.ps === 'number' && currentMetrics.ps > 0 ? `${currentMetrics.ps.toFixed(1)}x` : <span title="Data not available" className="text-slate-500">-</span>}
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {typeof currentMetrics.earningsYield === 'number' && currentMetrics.earningsYield > 0 ? `${currentMetrics.earningsYield.toFixed(1)}%` : <span title="Data not available" className="text-slate-500">-</span>}
                </td>
                <td className="px-4 py-3 text-slate-500"><span className="text-slate-500">-</span></td>
              </tr>
              
              {/* Peer Rows */}
              {peers.map(peer => (
                <tr key={peer.ticker} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3 text-slate-300 font-medium">{peer.ticker}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {typeof peer.metrics.pe === 'number' && peer.metrics.pe > 0 ? `${peer.metrics.pe.toFixed(1)}x` : <span title="Data not available" className="text-slate-500">-</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {typeof peer.metrics.evToEbitda === 'number' && peer.metrics.evToEbitda > 0 ? `${peer.metrics.evToEbitda.toFixed(1)}x` : <span title="Data not available" className="text-slate-500">-</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {typeof peer.metrics.priceToBook === 'number' && peer.metrics.priceToBook > 0 ? `${peer.metrics.priceToBook.toFixed(1)}x` : <span title="Data not available" className="text-slate-500">-</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {typeof peer.metrics.ps === 'number' && peer.metrics.ps > 0 ? `${peer.metrics.ps.toFixed(1)}x` : <span title="Data not available" className="text-slate-500">-</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {typeof peer.metrics.earningsYield === 'number' && peer.metrics.earningsYield > 0 ? `${peer.metrics.earningsYield.toFixed(1)}%` : <span title="Data not available" className="text-slate-500">-</span>}
                  </td>
                  <td className="px-4 py-3">
                    <button 
                      onClick={() => handleRemovePeer(peer.ticker)}
                      className="text-slate-500 hover:text-red-400 transition-colors"
                      title="Remove Peer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}

              {/* Average Row */}
              <tr className="bg-purple-900/10 border-t border-purple-900/30">
                <td className="px-4 py-3 text-purple-300 font-medium">Peer Average</td>
                <td className="px-4 py-3 text-purple-200">{averages.pe.toFixed(1)}x</td>
                <td className="px-4 py-3 text-purple-200">{averages.evToEbitda.toFixed(1)}x</td>
                <td className="px-4 py-3 text-purple-200">{averages.pb.toFixed(1)}x</td>
                <td className="px-4 py-3 text-purple-200">{averages.ps.toFixed(1)}x</td>
                <td className="px-4 py-3 text-purple-200"><span className="text-slate-500">-</span></td>
                <td className="px-4 py-3"></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Search & Add Competitor */}
        <div className="relative max-w-lg">
          <label htmlFor="peer-search" className="sr-only">Search and add competitor</label>
          <div className="flex items-center gap-2">
            <input
              id="peer-search"
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => { setInputText(e.target.value); setError(null); }}
              onKeyDown={onKeyDown}
              placeholder="Type ticker or company name to add peer..."
              aria-autocomplete="list"
              aria-controls="peer-search-listbox"
              aria-expanded={showDropdown}
              role="combobox"
              className="bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500 w-full"
            />
            <button
              onClick={handleAddPeer}
              disabled={loading}
              aria-label="Add peer by ticker"
              className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded-md border border-slate-700 transition-colors disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          {showDropdown && (
            <ul
              id="peer-search-listbox"
              role="listbox"
              className="absolute z-20 mt-2 w-full bg-slate-900 border border-slate-700 rounded-md shadow-lg max-h-64 overflow-auto"
            >
              {isSearching && (
                <li className="px-3 py-2 text-slate-300 text-sm">Loading...</li>
              )}
              {!isSearching && searchResults.length === 0 && (
                <li className="px-3 py-2 text-slate-300 text-sm">No results found</li>
              )}
              {!isSearching && searchResults.map((res, idx) => (
                <li
                  key={`${res.ticker}-${idx}`}
                  role="option"
                  aria-selected={idx === highlightedIndex}
                  onMouseDown={() => selectResult(res)}
                  className={`px-3 py-2 cursor-pointer ${idx === highlightedIndex ? 'bg-slate-800' : 'bg-slate-900'} hover:bg-slate-800`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-white font-semibold">{res.ticker}</span>
                    <span className="text-xs text-slate-400">{res.exchange}</span>
                  </div>
                  <div className="text-slate-300 text-xs">{res.name}</div>
                </li>
              ))}
              {!isSearching && searchResults.length > 0 && searchResults.length < totalResults && (
                <li className="px-3 py-2">
                  <button
                    className="w-full text-center bg-slate-800 hover:bg-slate-700 text-white text-sm px-3 py-2 rounded-md border border-slate-700"
                    onMouseDown={async () => {
                      if (abortRef.current) abortRef.current.abort();
                      abortRef.current = new AbortController();
                      setIsSearching(true);
                      try {
                        const nextOffset = currentOffset + 10;
                        const q = inputText.trim();
                        const res = await searchTickerPaged(q, nextOffset, 10, abortRef.current.signal);
                        setSearchResults([...searchResults, ...res.results]);
                        setTotalResults(res.total || totalResults);
                        setCurrentOffset(res.offset || nextOffset);
                      } catch (_e) {
                        setError('Search failed. Try again.');
                      } finally {
                        setIsSearching(false);
                      }
                    }}
                  >
                    Load more results
                  </button>
                </li>
              )}
            </ul>
          )}
          {error && (
            <div className="text-xs text-red-400 mt-2 flex items-center gap-2">
              <span>{error}</span>
              {inputText.trim().length >= 2 && (
                <button
                  className="text-[10px] px-2 py-1 rounded bg-red-900/30 text-red-200 border border-red-700 hover:bg-red-800/50"
                  onClick={async () => {
                    if (abortRef.current) abortRef.current.abort();
                    abortRef.current = new AbortController();
                    setIsSearching(true);
                    try {
                      const res = await searchTickerPaged(inputText.trim(), 0, 10, abortRef.current.signal);
                      setSearchResults(res.results);
                      setTotalResults(res.total || res.results.length);
                      setCurrentOffset(res.offset || 0);
                      setShowDropdown(true);
                      setError(null);
                    } catch (_e) {
                      setError('Search failed. Try again.');
                    } finally {
                      setIsSearching(false);
                    }
                  }}
                >
                  Retry
                </button>
              )}
            </div>
          )}
          {successMessage && <div className="text-xs text-emerald-400 mt-2">{successMessage}</div>}
        </div>
        
      </div>

      {/* Historical Valuation Section */}
      {historicalMetrics.length > 0 && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <History className="w-5 h-5 text-blue-500" />
            Historical Valuation (5-Year Trend)
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-slate-800/50">
                  <tr>
                    <th className="px-4 py-2 rounded-l-lg">Year</th>
                    <th className="px-4 py-2">P/E Ratio</th>
                    <th className="px-4 py-2">P/Sales</th>
                    <th className="px-4 py-2 rounded-r-lg">P/Book</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {historicalMetrics.map((metric) => (
                    <tr key={metric.year} className="hover:bg-slate-800/30">
                      <td className="px-4 py-2 text-slate-300 font-medium">{metric.year}</td>
                      <td className="px-4 py-2 text-slate-400">{metric.pe.toFixed(1)}x</td>
                      <td className="px-4 py-2 text-slate-400">{metric.ps.toFixed(1)}x</td>
                      <td className="px-4 py-2 text-slate-400">{metric.pb.toFixed(1)}x</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="bg-slate-800/30 p-4 rounded-lg border border-slate-700/50 flex flex-col justify-center">
               <div className="flex items-start gap-3 mb-4">
                 <TrendingUp className="w-8 h-8 text-emerald-500 mt-1" />
                 <div>
                   <h4 className="text-white font-medium mb-1">Historical Context</h4>
                   <p className="text-sm text-slate-400 leading-relaxed">
                     The 5-year average P/E is <span className="text-white font-bold">{(historicalMetrics.reduce((acc, m) => acc + m.pe, 0) / historicalMetrics.length).toFixed(1)}x</span>. 
                     Compared to the current P/E of <span className="text-white font-bold">{currentMetrics.pe?.toFixed(1)}x</span>, 
                     the stock is trading at a {currentMetrics.pe > (historicalMetrics.reduce((acc, m) => acc + m.pe, 0) / historicalMetrics.length) ? 'premium' : 'discount'} to its historical average.
                   </p>
                 </div>
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RelativeValuation;
