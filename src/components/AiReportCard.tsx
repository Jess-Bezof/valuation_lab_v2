import React from 'react';
import { Bot, TrendingUp, AlertTriangle, FileText, CheckCircle2, AlertOctagon } from 'lucide-react';
import { StockFinancials } from '../types';

interface Narrative {
  companyDescription?: string;
  valuationStory: string;
  keyDrivers: string;
  riskFactors: string;
}

interface AiReportCardProps {
  narrative?: Narrative;
  financials?: StockFinancials;
  isLoading?: boolean;
}

const AiReportCard: React.FC<AiReportCardProps> = ({ narrative, financials, isLoading }) => {
  // Placeholder for future tabs

  if (isLoading) {
    return (
      <div className="bg-slate-900/60 backdrop-blur-md rounded-xl p-6 animate-pulse border border-slate-700/50 h-[400px]">
        <div className="flex items-center gap-3 mb-6 border-b border-slate-700/50 pb-4">
           <div className="w-8 h-8 bg-slate-700 rounded-full"></div>
           <div className="h-6 bg-slate-700 rounded w-1/3"></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-4">
            <div className="h-4 bg-slate-700 rounded w-full"></div>
            <div className="h-4 bg-slate-700 rounded w-5/6"></div>
          </div>
          <div className="space-y-4">
            <div className="h-4 bg-slate-700 rounded w-full"></div>
            <div className="h-4 bg-slate-700 rounded w-4/6"></div>
          </div>
          <div className="space-y-4">
            <div className="h-4 bg-slate-700 rounded w-full"></div>
            <div className="h-4 bg-slate-700 rounded w-3/4"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!narrative) return null;

  // Helper to parse bullet points
  const parseBullets = (text: string) => {
    return text.split('\n').filter(line => line.trim().length > 0).map(line => line.replace(/^[•\-*]\s*/, '').trim());
  };

  return (
    <div className="bg-slate-900/60 backdrop-blur-md rounded-xl shadow-xl border border-slate-700/50 flex flex-col overflow-hidden transition-all duration-500 ease-in-out">
      
      {/* 1. Quick Info Top Bar */}
      <div className="bg-slate-800/40 p-4 border-b border-slate-700/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500/10 p-2 rounded-lg border border-emerald-500/20">
            <Bot className="text-emerald-400 w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white tracking-wide font-sans">
              AI RESEARCH REPORT
            </h3>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="font-medium text-slate-300">{financials?.name || 'Company'}</span>
              <span>•</span>
              <span>{financials?.valuationMultiples?.sector || 'Sector'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Company Summary Card */}
      {narrative.companyDescription && (
        <div className="px-6 py-4 bg-slate-800/20 border-b border-slate-700/30">
          <p className="text-sm text-slate-300 italic leading-relaxed font-light">
            "{narrative.companyDescription}"
          </p>
        </div>
      )}
      
      {/* 3. Three-Column Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-slate-700/50">
        
        {/* Column 1: Valuation Narrative */}
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4 text-blue-400" />
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Valuation Thesis</h4>
          </div>
          <div className="space-y-3">
             {/* Simple paragraph or split if needed. Usually narrative is a paragraph. */}
             <p className="text-sm text-slate-300 leading-relaxed text-left">
               {narrative.valuationStory}
             </p>
          </div>
        </div>

        {/* Column 2: Key Drivers (Bullish) */}
        <div className="p-6 bg-emerald-900/5 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <h4 className="text-xs font-bold text-emerald-500/80 uppercase tracking-widest">Growth Catalysts</h4>
            </div>
            <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-[10px] font-bold uppercase rounded border border-emerald-500/20">Bullish</span>
          </div>
          <div className="space-y-3">
            {parseBullets(narrative.keyDrivers).map((driver, idx) => {
              const isHeader = driver.endsWith(':');
              if (isHeader) {
                return (
                  <h5 key={idx} className="text-[10px] font-bold text-emerald-500/80 uppercase tracking-widest mt-4 first:mt-0 mb-1.5 border-b border-emerald-500/10 pb-1">
                    {driver.replace(':', '')}
                  </h5>
                );
              }
              return (
                <div key={idx} className="flex items-start gap-2.5 group">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5 group-hover:text-emerald-400 transition-colors" />
                  <span className="text-sm text-slate-300 leading-snug">{driver}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Column 3: Key Risks (Bearish) */}
        <div className="p-6 bg-amber-900/5 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <h4 className="text-xs font-bold text-amber-500/80 uppercase tracking-widest">Risk Factors</h4>
            </div>
            <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 text-[10px] font-bold uppercase rounded border border-amber-500/20">Caution</span>
          </div>
          <div className="space-y-3">
            {parseBullets(narrative.riskFactors)
              .filter(risk => !risk.toLowerCase().includes('risk factors:'))
              .map((risk, idx) => (
              <div key={idx} className="flex items-start gap-2.5 group">
                <AlertOctagon className="w-4 h-4 text-amber-500 shrink-0 mt-0.5 group-hover:text-amber-400 transition-colors" />
                <span className="text-sm text-slate-300 leading-snug">{risk}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* 4. Footer / Interactive Tabs (Optional Placeholder for Future Expansion) */}
      <div className="bg-slate-900/40 p-2 border-t border-slate-700/50 flex justify-center">
         <div className="flex gap-4">
            <button className="text-[10px] uppercase font-semibold text-slate-500 hover:text-slate-300 transition-colors">View Full Report</button>
            <span className="text-slate-700">•</span>
            <button className="text-[10px] uppercase font-semibold text-slate-500 hover:text-slate-300 transition-colors">Export PDF</button>
         </div>
      </div>
    </div>
  );
};

export default AiReportCard;
