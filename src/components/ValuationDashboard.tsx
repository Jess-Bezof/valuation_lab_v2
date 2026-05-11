import React, { useState, useEffect, useRef } from 'react';
import { Search, RotateCcw, TrendingUp, AlertCircle, DollarSign, Activity, Percent, FileText, Info, AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { fetchStockAnalysis, fetchStockHistory, fetchValuationFinancials, searchTicker } from '../services/stockService';
import { calculateIntrinsicValue, calculateScenarios } from '../utils/dcfEngine';
import { AnalysisResult, AiInputAdjustment, HistoryData, EventData, SECFinancials, SECYearData } from '../types';
import SliderControl from './SliderControl';
import DCFChart from './DCFChart';
import AiReportCard from './AiReportCard';
import RelativeValuation from './RelativeValuation';
import SectorAnalysis from './SectorAnalysis';
import { StockChart } from './StockChart';

const formatCurrency = (value: number) => {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toLocaleString()}`;
};

const lineItemLabels: Record<string, string> = {
  'Revenues': 'Total Revenue',
  'GrossProfit': 'Gross Profit',
  'OperatingIncomeLoss': 'Operating Income',
  'NetIncomeLoss': 'Net Income',
  'AssetsCurrent': 'Current Assets',
  'LiabilitiesCurrent': 'Current Liabilities',
  'StockholdersEquity': "Stockholders' Equity",
  'ResearchAndDevelopmentExpense': 'R&D Expense',
  'OperatingExpenses': 'Operating Expenses',
  'CashAndCashEquivalentsAtCarryingValue': 'Cash & Equivalents',
  'LongTermDebt': 'Long Term Debt',
  'RetainedEarnings': 'Retained Earnings'
};

// Inline chip that shows AI reasoning below a slider.
// Dims to "overridden" style when the live value drifts from the AI value.
const AiChip: React.FC<{
  adj: AiInputAdjustment;
  liveValue: number;
  formatValue: (v: number) => string;
}> = ({ adj, liveValue, formatValue }) => {
  const isOverridden = Math.abs(liveValue - adj.value) > 0.0005;
  return (
    <div className={`flex items-start gap-2 mt-1.5 px-3 py-2 rounded-lg text-xs transition-all duration-200 ${
      isOverridden
        ? 'bg-slate-800/40 border border-slate-700/30 opacity-50'
        : 'bg-indigo-950/40 border border-indigo-800/30'
    }`}>
      <span className={`shrink-0 font-bold mt-0.5 ${isOverridden ? 'text-slate-500' : 'text-indigo-400'}`}>
        {isOverridden ? '✦ AI' : '⚡ AI'}
      </span>
      <div className="min-w-0">
        <p className={`leading-snug break-words ${isOverridden ? 'text-slate-500' : 'text-slate-300'}`}>
          {adj.reasoning}
        </p>
        <p className="text-slate-600 mt-0.5 font-mono">
          raw: {formatValue(adj.rawValue)} → adjusted: {formatValue(adj.value)}
          {isOverridden && <span className="text-amber-700 ml-2">· overridden</span>}
        </p>
      </div>
    </div>
  );
};

const ValuationDashboard: React.FC = () => {
  const [inputText, setInputText] = useState('NVDA'); 
  const [activeTicker, setActiveTicker] = useState('NVDA'); 
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [chartLoading, setChartLoading] = useState(false); 
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<'FCFF' | 'DDM'>('FCFF');
  const [baseInputs, setBaseInputs] = useState<AnalysisResult['inputs'] | null>(null);
  const [historicalPriceData, setHistoricalPriceData] = useState<HistoryData[]>([]);
  const [stockEvents, setStockEvents] = useState<EventData[]>([]);
  
  // Search State
  const [searchResults, setSearchResults] = useState<{ ticker: string, name: string, exchange: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // New State for Full Financials Tab
  const [activeTab, setActiveTab] = useState<'financials' | 'sentiment' | 'fcf' | 'report' | 'multiples'>('fcf');
  const [valuationData, setValuationData] = useState<SECFinancials | null>(null);

  // Tracks the current search generation. Incremented on every new search so
  // state updates from an in-flight request for a previous ticker are ignored.
  const searchGenRef = useRef(0);

  // Debounced Search Effect
  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (inputText.length > 1 && inputText !== activeTicker) {
        setIsSearching(true);
        const results = await searchTicker(inputText);
        setSearchResults(results);
        setIsSearching(false);
        setShowDropdown(true);
      } else {
        setSearchResults([]);
        setShowDropdown(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [inputText, activeTicker]);

  useEffect(() => {
    handleFullSearch(activeTicker);
  }, [activeTicker]);

  const handleSelectTicker = (ticker: string) => {
    setInputText(ticker);
    setActiveTicker(ticker);
    setShowDropdown(false);
  };

  const handleFullSearch = async (targetTicker: string, refresh = false) => {
    if (!targetTicker) return;

    // Stamp this search so we can discard results from previous in-flight requests.
    const thisGen = ++searchGenRef.current;

    setLoading(true);
    setChartLoading(true);
    setError(null);
    setValuationData(null);

    try {
      // Start chart history fetch immediately (fastest). Guard state updates with
      // the generation stamp so a slow response from a previous ticker is ignored.
      fetchStockHistory(targetTicker, 'max', refresh).then(historyResult => {
        if (searchGenRef.current !== thisGen) return;
        setHistoricalPriceData(historyResult.history || []);
        setStockEvents(historyResult.events || []);
        setChartLoading(false);
      }).catch(err => console.error('History fetch failed', err));

      const [analysisResult, valuationResult] = await Promise.all([
        fetchStockAnalysis(targetTicker),
        fetchValuationFinancials(targetTicker)
      ]);

      if (searchGenRef.current !== thisGen) return;

      setAnalysis(analysisResult);
      setBaseInputs(analysisResult.inputs);
      setValuationData(valuationResult);

      if (analysisResult.financials.suggestedModel) {
        // HIGH_GROWTH is merged into adaptive FCFF; map it accordingly
        const model = analysisResult.financials.suggestedModel === 'HIGH_GROWTH' ? 'FCFF' : analysisResult.financials.suggestedModel;
        setSelectedModel(model as 'FCFF' | 'DDM');
      }
    } catch (err) {
      if (searchGenRef.current !== thisGen) return;
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
      setAnalysis(null);
      setBaseInputs(null);
    } finally {
      if (searchGenRef.current === thisGen) {
        setLoading(false);
        setChartLoading(false);
      }
    }
  };

  const handleInputChange = (key: keyof AnalysisResult['inputs'], value: number) => {
    if (!analysis) return;
    const newInputs = { ...analysis.inputs, [key]: value };
    const newValuation = calculateIntrinsicValue(analysis.financials, newInputs, selectedModel);
    setAnalysis({ ...analysis, inputs: newInputs, valuation: newValuation });
  };

  const handleModelChange = (model: 'FCFF' | 'DDM') => {
    if (!analysis) return;
    setSelectedModel(model);
    const newValuation = calculateIntrinsicValue(analysis.financials, analysis.inputs, model);
    setAnalysis({ ...analysis, valuation: newValuation });
  };

const handleReset = () => {
  if (!analysis || !baseInputs) return;

  // 1. Reset the live inputs to match our anchor
  const resetInputs = { ...baseInputs };
  
  // 2. Re-calculate the intrinsic value based on these original numbers
  const resetValuation = calculateIntrinsicValue(
    analysis.financials, 
    resetInputs, 
    selectedModel
  );

  // 3. Update the analysis state (This is instant)
  setAnalysis({
    ...analysis,
    inputs: resetInputs,
    valuation: resetValuation
  });
};

  if (loading && !analysis) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0B0E14] text-slate-200">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

return (
    <div className="max-w-7xl mx-auto p-6 space-y-8 text-slate-200">
      {/* Header & Search */}
      <header className="flex flex-col md:flex-row justify-between items-center gap-4 border-b border-slate-800 pb-6">
        <div>
          {/* RESTORED: Company Name and Ticker */}
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-white tracking-tight">
              {analysis ? analysis.financials.name : "Financial Valuation"} <span className="text-blue-500">{analysis ? `(${analysis.financials.ticker})` : "Lab"}</span>
            </h1>
            {analysis && (
              <div className="bg-slate-800 px-2 py-1 rounded text-xs font-mono text-slate-400">
                {analysis.financials.listingStatus}
              </div>
            )}
          </div>
          <div className="flex items-center gap-4 mt-1">
            <div className="flex items-center gap-2">
              <p className="text-slate-400">Valuation Engine</p>
              <span className="bg-blue-500/10 text-blue-400 text-[10px] font-bold px-1.5 py-0.5 rounded border border-blue-500/20">BETA</span>
            </div>
            {analysis && (
              <>
                <div className="h-1 w-1 rounded-full bg-slate-700"></div>
                {/* RESTORED: Current Market Price */}
                <span className="text-white font-semibold">${analysis.financials.price.toFixed(2)}</span>
                <span className="text-slate-500 text-xs uppercase tracking-wider">Market Price</span>
                
                <div className="h-1 w-1 rounded-full bg-slate-700"></div>
                <button 
                  onClick={() => handleFullSearch(activeTicker, true)}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-xs text-blue-400 font-medium transition-colors disabled:opacity-50"
                >
                  <RotateCcw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                  {loading ? 'Refreshing AI...' : 'Refresh AI Analysis'}
                </button>
              </>
            )}
          </div>
        </div>
        
        <div className="flex w-full md:w-auto gap-2">
          <div className="relative flex-1 md:w-80">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isSearching ? 'text-blue-400 animate-pulse' : 'text-slate-500'}`} />
            <input 
              type="text" 
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value.toUpperCase());
                setShowDropdown(true);
              }}
              onFocus={() => {
                if (searchResults.length > 0) setShowDropdown(true);
              }}
              onBlur={() => {
                // Delay hiding to allow click event on dropdown items
                setTimeout(() => setShowDropdown(false), 200);
              }}
              onKeyDown={(e) => e.key === 'Enter' && setActiveTicker(inputText)}
              placeholder="Search Ticker (e.g. AAPL)"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
            {/* Search Dropdown */}
            {showDropdown && inputText.length > 1 && (
              <div className="absolute top-full left-0 w-full mt-2 bg-slate-900 border border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden max-h-80 overflow-y-auto">
                {isSearching ? (
                   <div className="p-4 text-center text-xs text-slate-500">Searching...</div>
                ) : searchResults.length > 0 ? (
                  <ul>
                    {searchResults.map((result) => (
                      <li 
                        key={result.ticker}
                        onClick={() => handleSelectTicker(result.ticker)}
                        className="px-4 py-3 hover:bg-slate-800 cursor-pointer border-b border-slate-800 last:border-0 flex justify-between items-center group"
                      >
                        <div>
                          <div className="font-bold text-white group-hover:text-blue-400 transition-colors">{result.ticker}</div>
                          <div className="text-xs text-slate-400 truncate max-w-[180px]">{result.name}</div>
                        </div>
                        <div className="text-[10px] text-slate-600 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                          {result.exchange}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="p-4 text-center text-xs text-slate-500">No companies found</div>
                )}
              </div>
            )}
          </div>
          <button onClick={() => setActiveTicker(inputText)} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-medium transition-colors">
            Analyze
          </button>
        </div>
      </header>

      {error && (
        <div className="bg-red-900/20 border border-red-800 text-red-200 p-4 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5" /> {error}
        </div>
      )}

      {analysis && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* MAIN CONTENT AREA (8 Cols) */}
          <div className="lg:col-span-8 space-y-6">
            
            {/* Top Navigation Bar */}
            <div className="flex items-center gap-1 border-b border-slate-800 pb-1 mb-6 overflow-x-auto scrollbar-thin scrollbar-thumb-slate-800">
               <button
                onClick={() => setActiveTab('fcf')}
                className={`px-4 py-2 text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === 'fcf' 
                    ? 'text-blue-400 border-b-2 border-blue-500' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Free Cash Flow
              </button>
              
              <button
                onClick={() => setActiveTab('financials')}
                className={`px-4 py-2 text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === 'financials' 
                    ? 'text-blue-400 border-b-2 border-blue-500' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Financial Highlights
              </button>

              <button
                onClick={() => setActiveTab('sentiment')}
                className={`px-4 py-2 text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === 'sentiment' 
                    ? 'text-blue-400 border-b-2 border-blue-500' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Sentiment Analysis
              </button>

              <button
                onClick={() => setActiveTab('report')}
                className={`px-4 py-2 text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === 'report' 
                    ? 'text-blue-400 border-b-2 border-blue-500' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Research Report
              </button>

              <button
                onClick={() => setActiveTab('multiples')}
                className={`px-4 py-2 text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === 'multiples' 
                    ? 'text-blue-400 border-b-2 border-blue-500' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Market Multiples
              </button>
            </div>

            {/* Common Header Cards (Visible on Financials and FCF) */}
            {(activeTab === 'financials' || activeTab === 'fcf') && (
              <>
                {/* Model Selector Card */}
                <div className="flex justify-between items-center bg-slate-900/40 p-4 rounded-xl border border-slate-800">
                  <span className="text-slate-400 text-sm font-medium">Active Valuation Model:</span>
                  <div className="flex items-center gap-3">
                    <select
                      value={selectedModel}
                      onChange={(e) => handleModelChange(e.target.value as 'FCFF' | 'DDM')}
                      className="bg-slate-800 text-white text-sm rounded-md px-3 py-1.5 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="FCFF">
                        DCF (FCFF) — {analysis.financials.lifecycle === 'High Growth' ? '10-yr · Two-Phase' : '5-yr · Stable'}
                      </option>
                      <option value="DDM">Dividend Discount (DDM)</option>
                    </select>
                    {(analysis.financials.suggestedModel === selectedModel ||
                      (analysis.financials.suggestedModel === 'HIGH_GROWTH' && selectedModel === 'FCFF')) && (
                      <span className="text-[10px] uppercase font-bold text-blue-400 bg-blue-900/30 px-2 py-1 rounded border border-blue-800">Recommended</span>
                    )}
                  </div>
                </div>

                {/* Top Cards: Financial Highlights */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-slate-900/60 p-5 rounded-xl border border-slate-800">
                    <div className="flex items-center gap-2 text-slate-400 mb-2"><DollarSign className="w-4 h-4" /><span className="text-sm font-medium">Intrinsic Value</span></div>
                    <div className="text-3xl font-bold text-white">${analysis.valuation.intrinsicValue.toFixed(2)}</div>
                    <div className="text-xs text-slate-500 mt-1">Per Share</div>
                  </div>
                  <div className="bg-slate-900/60 p-5 rounded-xl border border-slate-800">
                    <div className="flex items-center gap-2 text-slate-400 mb-2"><TrendingUp className="w-4 h-4" /><span className="text-sm font-medium">Upside</span></div>
                    <div className={`text-3xl font-bold ${analysis.valuation.upside >= 0 ? 'text-green-400' : 'text-red-400'}`}>{(analysis.valuation.upside * 100).toFixed(1)}%</div>
                    <div className="text-xs text-slate-500 mt-1">vs Current ${analysis.financials.price.toFixed(2)}</div>
                  </div>
                  <div className="bg-slate-900/60 p-5 rounded-xl border border-slate-800">
                    <div className="flex items-center gap-2 text-slate-400 mb-2"><Activity className="w-4 h-4" /><span className="text-sm font-medium">WACC</span></div>
                    <div className="text-3xl font-bold text-blue-400">{(analysis.valuation.wacc * 100).toFixed(1)}%</div>
                    <div className="text-xs text-slate-500 mt-1">Cost of Capital</div>
                  </div>
                </div>
              </>
            )}

            {/* VIEW 1: Financial Highlights */}
            {activeTab === 'financials' && (
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-6 overflow-hidden min-h-[500px]">
                 {/* Header */}
                 <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                      <FileText className="w-5 h-5 text-blue-500" />
                      SEC Filings: 10-K Historical Financials
                    </h3>
                    <div className="flex items-center gap-3">
                      <div className="group relative">
                        <Info className="w-4 h-4 text-slate-500 hover:text-blue-400 cursor-help transition-colors" />
                        <div className="absolute right-0 top-6 w-72 bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-xl z-50 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                          <p className="text-xs text-slate-300 leading-relaxed">
                            Note: Some fields may appear empty due to variations in how companies tag specific line items (XBRL) or because the item was not reported as a separate line in the SEC filing for that year.
                          </p>
                        </div>
                      </div>
                      <div className="text-xs text-slate-500 font-mono bg-slate-800 px-2 py-1 rounded">
                        Source: EDGAR (US GAAP)
                      </div>
                    </div>
                 </div>

                 {/* Table */}
                 {!valuationData ? (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                      {loading ? (
                         <>
                           <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-4"></div>
                           <p>Scanning EDGAR Filings...</p>
                         </>
                      ) : (
                         <div className="flex flex-col items-center">
                            <AlertCircle className="w-8 h-8 mb-2 opacity-50" />
                            <p>No financial data available for this ticker.</p>
                         </div>
                      )}
                    </div>
                 ) : (
                    <div className="overflow-x-auto relative scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent pb-4">
                      <table className="w-full text-sm text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-700/50">
                            <th className="py-3 px-4 text-slate-400 font-medium sticky left-0 bg-[#0F131C] z-20 w-48 shadow-[4px_0_12px_-4px_rgba(0,0,0,0.5)]">
                              Fiscal Year
                            </th>
                            {valuationData.financials.map((yearData: SECYearData) => (
                              <th key={yearData.year} className="py-3 px-6 text-slate-300 font-mono text-right min-w-[140px]">
                                {yearData.year}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                           {/* Render rows based on lineItemLabels */}
                           {Object.entries(lineItemLabels).map(([key, label]) => (
                             <tr key={key} className="hover:bg-slate-800/30 transition-colors group">
                               <td className="py-3 px-4 text-slate-300 font-medium sticky left-0 bg-[#0F131C] group-hover:bg-[#161b26] z-20 border-r border-slate-800 shadow-[4px_0_12px_-4px_rgba(0,0,0,0.5)] transition-colors">
                                 {label}
                               </td>
                               {valuationData.financials.map((yearData: SECYearData) => {
                                 const val = yearData[key];
                                 return (
                                   <td key={`${yearData.year}-${key}`} className="py-3 px-6 text-slate-400 font-mono text-right group-hover:text-slate-200">
                                     {typeof val === 'number' ? formatCurrency(val) : '-'}
                                   </td>
                                 );
                               })}
                             </tr>
                           ))}
                        </tbody>
                      </table>
                    </div>
                 )}
              </div>
            )}

            {/* VIEW 2: Sentiment Analysis */}
            {activeTab === 'sentiment' && (
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 relative h-[600px]">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-white">Full Price History (MAX)</h3>
                  {chartLoading && <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>}
                </div>
                <StockChart data={historicalPriceData} markers={stockEvents} />
              </div>
            )}

            {/* VIEW 3: Free Cash Flow */}
            {activeTab === 'fcf' && (
              <>
                {/* Reinvestment Efficiency Health Check */}
                {analysis.financials.reinvestmentEfficiency !== undefined && (
                  <div className={`p-4 rounded-xl border mb-6 flex items-center justify-between ${
                    analysis.financials.reinvestmentEfficiency > 1.5 
                      ? 'bg-emerald-900/20 border-emerald-800 text-emerald-300' 
                      : analysis.financials.reinvestmentEfficiency > 0.8
                        ? 'bg-amber-900/20 border-amber-800 text-amber-300'
                        : 'bg-red-900/20 border-red-800 text-red-300'
                  }`}>
                    <div className="flex items-center gap-3">
                      <Activity className="w-5 h-5" />
                      <div>
                        <h4 className="font-bold text-sm uppercase tracking-wide">Capital Efficiency Score</h4>
                        <p className="text-xs opacity-80 mt-0.5">Sales generated per $1 of Invested Capital</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-2xl font-bold">{analysis.financials.reinvestmentEfficiency.toFixed(2)}x</span>
                      <div className="text-[10px] font-medium uppercase mt-1 px-2 py-0.5 rounded bg-black/20 w-fit ml-auto">
                        {analysis.financials.reinvestmentEfficiency > 1.5 
                          ? 'Highly Efficient' 
                          : analysis.financials.reinvestmentEfficiency > 0.8 
                            ? 'Standard' 
                            : 'Capital Intensive'}
                      </div>
                    </div>
                  </div>
                )}

                {/* Bull / Base / Bear Scenario Bar */}
                {(() => {
                  const scenarios = calculateScenarios(analysis.financials, analysis.inputs, selectedModel);
                  const price = analysis.financials.price;
                  const fmt = (v: number) => `$${v.toFixed(2)}`;
                  const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
                  const cards = [
                    { label: 'Bear', data: scenarios.bear, accent: 'red', desc: 'Growth ÷2 · Margin −15% · WACC +2%' },
                    { label: 'Base', data: scenarios.base, accent: 'blue', desc: 'Current assumptions' },
                    { label: 'Bull', data: scenarios.bull, accent: 'emerald', desc: 'Growth ×1.5 · Margin +15% · WACC −1.5%' },
                  ] as const;
                  return (
                    <div className="grid grid-cols-3 gap-3">
                      {cards.map(({ label, data, accent, desc }) => {
                        const upside = price > 0 ? (data.intrinsicValue - price) / price : 0;
                        const colorMap = {
                          red: { bg: 'bg-red-900/20', border: 'border-red-800', badge: 'bg-red-900/40 text-red-300', val: 'text-red-300', up: 'text-red-400' },
                          blue: { bg: 'bg-blue-900/20', border: 'border-blue-800', badge: 'bg-blue-900/40 text-blue-300', val: 'text-blue-300', up: upside >= 0 ? 'text-green-400' : 'text-red-400' },
                          emerald: { bg: 'bg-emerald-900/20', border: 'border-emerald-800', badge: 'bg-emerald-900/40 text-emerald-300', val: 'text-emerald-300', up: 'text-emerald-400' },
                        }[accent];
                        return (
                          <div key={label} className={`${colorMap.bg} border ${colorMap.border} rounded-xl p-4`}>
                            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${colorMap.badge}`}>{label}</span>
                            <div className={`text-2xl font-bold mt-2 ${colorMap.val}`}>{fmt(data.intrinsicValue)}</div>
                            <div className={`text-sm font-semibold ${colorMap.up}`}>{pct(upside)}</div>
                            <div className="text-[10px] text-slate-500 mt-2 leading-snug">{desc}</div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                <DCFChart dcfDetails={analysis.valuation.dcfDetails} />
                
                {/* Growth Efficiency Insight Box */}
                {(() => {
                  const projectedFCFs = analysis.valuation.dcfDetails.projectedCashFlows;
                  const anyNegativeFCF = projectedFCFs.some(f => f.freeCashFlow < 0);
                  const roic = analysis.financials.roic;
                  const growthRate = analysis.inputs.revenueGrowth;
                  const growthExceedsRoic = growthRate > roic;
                  const ddmDivGrowth = analysis.valuation.dcfDetails.dividendGrowthRate;
                  const unsustainableDdm = selectedModel === 'DDM' && ddmDivGrowth !== undefined && ddmDivGrowth < 0;

                  let status: 'distressed' | 'critical' | 'caution' | 'info' | 'sustainable' | 'ddm_unsustainable' = 'sustainable';

                  if (unsustainableDdm) {
                    status = 'ddm_unsustainable';
                  } else if (roic < 0 && anyNegativeFCF) {
                    status = 'distressed';
                  } else if (growthExceedsRoic && anyNegativeFCF) {
                    status = 'critical';
                  } else if (growthExceedsRoic && !anyNegativeFCF) {
                    status = 'caution';
                  } else if (!growthExceedsRoic && anyNegativeFCF) {
                    status = 'info';
                  } else {
                    status = 'sustainable';
                  }

                  const configs = {
                    ddm_unsustainable: {
                      bg: 'bg-amber-900/20', border: 'border-amber-700', text: 'text-amber-200',
                      icon: <AlertTriangle className="w-5 h-5 text-amber-400" />,
                      title: "Warning: Unsustainable Dividend Payout",
                      desc: `Dividends exceed earnings (payout ratio > 100%). Sustainable dividend growth is ${ddmDivGrowth !== undefined ? (ddmDivGrowth * 100).toFixed(1) : '?'}% — a negative rate signals a likely dividend cut. The DDM terminal value assumes the company eventually reaches a sustainable payout.`
                    },
                    distressed: {
                      bg: 'bg-red-950', border: 'border-red-600 border-2', text: 'text-red-100',
                      icon: <ShieldAlert className="w-6 h-6 text-red-500" />,
                      title: "Emergency: Distressed Business Model",
                      desc: "The company is burning cash while maintaining a negative return on capital. This suggests the core business model is not yet viable or is in significant distress. High risk of insolvency without immediate capital injection."
                    },
                    critical: {
                      bg: 'bg-red-900/20', border: 'border-red-800', text: 'text-red-200',
                      icon: <AlertTriangle className="w-5 h-5 text-red-500" />,
                      title: "Critical Warning: Value-Destructive Burn",
                      desc: "The company is burning cash to fund growth that yields returns below its efficiency. This 'buys' revenue at the cost of long-term intrinsic value."
                    },
                    caution: {
                      bg: 'bg-amber-900/20', border: 'border-amber-800', text: 'text-amber-200',
                      icon: <AlertTriangle className="w-5 h-5 text-amber-500" />,
                      title: "Caution: Inefficient Growth",
                      desc: "While cash flows are currently positive, the company is growing faster than its ROIC allows. Scaling into low-return projects may lower the overall valuation over time."
                    },
                    info: {
                      bg: 'bg-blue-900/20', border: 'border-blue-800', text: 'text-blue-200',
                      icon: <Info className="w-5 h-5 text-blue-500" />,
                      title: "Info: Strategic Reinvestment",
                      desc: "Temporary negative cash flow is being used to fund highly efficient growth. Since ROIC remains high, this is a healthy use of capital to build long-term value."
                    },
                    sustainable: {
                      bg: 'bg-emerald-900/10', border: 'border-emerald-800/50', text: 'text-emerald-200',
                      icon: <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
                      title: "Sustainable Cash Flow Path",
                      desc: "The company is growing within its means, generating positive cash flows while maintaining efficient returns on capital."
                    }
                  };

                  const config = configs[status];

                  return (
                    <div className={`${config.bg} border ${config.border} rounded-xl p-4 flex items-start gap-3 transition-all duration-500 animate-in fade-in slide-in-from-top-2 shadow-lg`}>
                      <div className="shrink-0 mt-0.5">{config.icon}</div>
                      <div>
                        <h4 className={`font-bold text-sm ${status === 'distressed' ? 'text-red-50' : config.text} flex items-center gap-2`}>
                          {config.title}
                        </h4>
                        <p className={`text-xs mt-1 leading-relaxed ${status === 'distressed' ? 'text-red-200' : 'text-slate-400'}`}>
                          {config.desc}
                        </p>
                        {status !== 'ddm_unsustainable' && (
                          <div className="mt-2 flex items-center gap-4 text-[10px] uppercase font-mono text-slate-500">
                            <span className={growthRate < 0 || (status === 'distressed') ? 'text-red-400' : (growthExceedsRoic ? 'text-red-400' : 'text-green-400')}>
                              Growth: {(analysis.inputs.revenueGrowth * 100).toFixed(1)}%
                            </span>
                            <span className="text-slate-600">vs</span>
                            <span className={roic < 0 || (status === 'distressed') ? 'text-red-400' : (roic > analysis.inputs.revenueGrowth ? 'text-green-400' : 'text-amber-400')}>
                              ROIC: {(roic * 100).toFixed(1)}%
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Sector Specific Analysis */}
                {analysis.financials.sectorStats && <SectorAnalysis data={analysis.financials.sectorStats} />}

                {/* Detailed Valuation Stats Table */}
                <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-6">
                  <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <Percent className="w-5 h-5 text-blue-500" />
                    Detailed Metrics
                  </h3>
                  {(() => {
                    const nopat = analysis.financials.operatingIncome * (1 - analysis.financials.taxRate);
                    const investedCapital = analysis.financials.roic > 0 ? nopat / analysis.financials.roic : 0;
                    const excessSpread = analysis.financials.roic - analysis.valuation.wacc;
                    const excessReturns = excessSpread * investedCapital;
                    return (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    {/* Row 1: Core Valuation Components */}
                    <div>
                      <div className="text-xs text-slate-500 uppercase tracking-wider">Enterprise Value</div>
                      <div className="text-lg font-medium text-white">${(analysis.valuation.enterpriseValue / 1000).toFixed(1)}B</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 uppercase tracking-wider">Equity Value</div>
                      <div className="text-lg font-medium text-white">${(analysis.valuation.equityValue / 1000).toFixed(1)}B</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 uppercase tracking-wider">Synthetic Rating</div>
                      <div className={`text-lg font-medium ${analysis.valuation.syntheticRating.startsWith('A') ? 'text-green-400' : 'text-yellow-400'}`}>
                        {analysis.valuation.syntheticRating}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 uppercase tracking-wider">Cost of Equity</div>
                      <div className="text-lg font-medium text-white">{(analysis.valuation.costOfEquity * 100).toFixed(1)}%</div>
                    </div>

                    {/* Row 2: Drivers and Proxies */}
                    <div>
                      <div className="text-xs text-slate-500 uppercase tracking-wider">Terminal Value</div>
                      <div className="text-lg font-medium text-white">${(analysis.valuation.terminalValue / 1000).toFixed(1)}B</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 uppercase tracking-wider">Cost of Debt</div>
                      <div className="text-lg font-medium text-white">{(analysis.financials.costOfDebt * 100).toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 uppercase tracking-wider">ROIC</div>
                      <div className="text-lg font-medium text-white">{(analysis.financials.roic * 100).toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 uppercase tracking-wider">Tax Rate</div>
                      <div className="text-lg font-medium text-white">{(analysis.financials.taxRate * 100).toFixed(1)}%</div>
                    </div>

                    {/* Row 3: Excess Returns (Damodaran value creation framework) */}
                    <div>
                      <div className="text-xs text-slate-500 uppercase tracking-wider">ROIC − WACC</div>
                      <div className={`text-lg font-medium ${excessSpread >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {excessSpread >= 0 ? '+' : ''}{(excessSpread * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 uppercase tracking-wider">Annual Excess Returns</div>
                      <div className={`text-lg font-medium ${excessReturns >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {excessReturns >= 0 ? '+' : '-'}${(Math.abs(excessReturns) / 1000).toFixed(1)}B
                      </div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-xs text-slate-500 uppercase tracking-wider">Value Creation</div>
                      <div className={`text-sm font-medium mt-1 ${excessSpread >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {excessSpread >= 0
                          ? `Creates $${(Math.abs(excessReturns) / 1000).toFixed(1)}B/yr — growth at ROIC > WACC compounds value`
                          : `Destroys $${(Math.abs(excessReturns) / 1000).toFixed(1)}B/yr — growth at ROIC < WACC erodes value`}
                      </div>
                    </div>
                  </div>
                    );
                  })()}
                </div>
              </>
            )}

            {/* VIEW 4: Research Report */}
            {activeTab === 'report' && (
               <AiReportCard narrative={analysis.narrative} financials={analysis.financials} />
            )}

            {/* VIEW 5: Market Multiples */}
            {activeTab === 'multiples' && (
               <RelativeValuation 
                  currentTicker={analysis.financials.ticker}
                  currentMetrics={analysis.financials.valuationMultiples}
                  initialPeers={analysis.financials.peerDetails || []}
                  historicalMetrics={analysis.financials.historicalMetrics || []}
                  salesPerShare={analysis.financials.salesPerShare}
               />
            )}
            
          </div>

          {/* RIGHT COLUMN: Valuation Lab Sliders (4 Cols) */}
          <div className="lg:col-span-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl sticky top-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold text-white">Valuation Levers</h3>
                <button onClick={handleReset} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all">
                  <RotateCcw className="w-5 h-5" />
                </button>
              </div>

              {/* AI Context Banner */}
              {analysis.valuationAdjustments && (() => {
                const va = analysis.valuationAdjustments!;
                const cyclicalityColor = va.cyclicality === 'high' ? 'text-red-400' : va.cyclicality === 'medium' ? 'text-amber-400' : 'text-green-400';
                const moatColor = va.moatStrength === 'strong' ? 'text-green-400' : va.moatStrength === 'moderate' ? 'text-amber-400' : 'text-red-400';
                return (
                  <div className="mb-5 p-3 bg-indigo-950/50 border border-indigo-800/40 rounded-lg">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-indigo-400 font-bold text-[10px] uppercase tracking-wider">⚡ AI Normalized</span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-400 text-[10px] capitalize">{va.companyType.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="flex gap-3 mb-2 text-[10px] uppercase font-mono">
                      <span className={cyclicalityColor}>{va.cyclicality} cyclicality</span>
                      <span className="text-slate-600">·</span>
                      <span className={moatColor}>{va.moatStrength} moat</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-snug">{va.summary}</p>
                  </div>
                );
              })()}

              <div className="space-y-4">
                <div>
                  <SliderControl
                    label="Revenue Growth"
                    value={analysis.inputs.revenueGrowth}
                    min={-0.10} max={0.50} step={0.01}
                    onChange={(v) => handleInputChange('revenueGrowth', v)}
                    formatValue={(v) => `${(v * 100).toFixed(1)}%`}
                    color="blue"
                  />
                  {analysis.valuationAdjustments?.adjustments.revenueGrowth && (
                    <AiChip
                      adj={analysis.valuationAdjustments.adjustments.revenueGrowth}
                      liveValue={analysis.inputs.revenueGrowth}
                      formatValue={(v) => `${(v * 100).toFixed(1)}%`}
                    />
                  )}
                </div>

                <div>
                  <SliderControl
                    label="Target Operating Margin"
                    value={analysis.inputs.targetOperatingMargin}
                    min={0.01} max={0.60} step={0.01}
                    onChange={(v) => handleInputChange('targetOperatingMargin', v)}
                    formatValue={(v) => `${(v * 100).toFixed(1)}%`}
                    color="green"
                  />
                  {analysis.valuationAdjustments?.adjustments.targetOperatingMargin && (
                    <AiChip
                      adj={analysis.valuationAdjustments.adjustments.targetOperatingMargin}
                      liveValue={analysis.inputs.targetOperatingMargin}
                      formatValue={(v) => `${(v * 100).toFixed(1)}%`}
                    />
                  )}
                </div>

                <SliderControl
                  label="Marginal Tax Rate"
                  value={analysis.inputs.taxRate}
                  min={0.0} max={0.45} step={0.01}
                  onChange={(v) => handleInputChange('taxRate', v)}
                  formatValue={(v) => `${(v * 100).toFixed(1)}%`}
                  color="purple"
                />

                <SliderControl
                  label="WACC (Discount Rate)"
                  value={analysis.inputs.wacc}
                  min={0.04} max={0.15} step={0.001}
                  onChange={(v) => handleInputChange('wacc', v)}
                  formatValue={(v) => `${(v * 100).toFixed(1)}%`}
                  color="orange"
                />

                <SliderControl
                  label="Terminal Growth Rate"
                  value={analysis.inputs.terminalGrowthRate}
                  min={0.0}
                  max={analysis.financials.riskFreeRate}
                  step={0.001}
                  onChange={(v) => handleInputChange('terminalGrowthRate', v)}
                  formatValue={(v) => `${(v * 100).toFixed(1)}%`}
                  color="teal"
                />

                <SliderControl
                  label="Equity Risk Premium"
                  value={analysis.inputs.equityRiskPremium}
                  min={0.03} max={0.08} step={0.001}
                  onChange={(v) => handleInputChange('equityRiskPremium', v)}
                  formatValue={(v) => `${(v * 100).toFixed(1)}%`}
                  color="orange"
                />

                <div className="mt-4 p-3 bg-blue-900/10 border border-blue-800/20 rounded-lg text-xs text-blue-300">
                  Levers update Intrinsic Value in real-time. ⚡ AI chips show normalized inputs — drag to override.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Footer Disclaimer */}
      <footer className="border-t border-slate-800 pt-6 mt-8 text-center pb-8">
        <p className="text-xs text-slate-500">
          <span className="font-semibold text-slate-400">Beta Version</span> | Valuation Engine developed by Aidar Abdrakhmanov. All metrics are for research purposes and subject to data extraction variations.
        </p>
      </footer>
    </div>
  );
};

export default ValuationDashboard;
