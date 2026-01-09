import React from 'react';
import { Layers, Activity, Info } from 'lucide-react';
import { SectorStats, SectorMetric } from '../types';

interface SectorAnalysisProps {
  data?: SectorStats;
}

const SectorAnalysis: React.FC<SectorAnalysisProps> = ({ data }) => {
  if (!data || data.metrics.length === 0) return null;

  const formatValue = (metric: SectorMetric) => {
    if (metric.format === 'percent') return `${metric.value.toFixed(1)}%`;
    if (metric.format === 'currency') return `$${metric.value.toFixed(1)}M`;
    return metric.value.toFixed(2);
  };

  return (
    <div className="bg-slate-800 rounded-lg p-6 shadow-lg border border-slate-700 mt-6">
      <div className="flex items-center justify-between mb-4 border-b border-slate-700 pb-2">
        <div className="flex items-center gap-2">
          <Layers className="text-blue-400 w-6 h-6" />
          <h3 className="text-lg font-bold text-white">
            {data.template} Highlighted Metrics
          </h3>
        </div>
        <span className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded-full border border-slate-600 hidden">
          {data.template}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {data.metrics.map((metric, idx) => (
          <div key={idx} className="bg-slate-900/50 p-4 rounded-lg border border-slate-700/50 hover:border-slate-600 transition-colors">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-slate-500" />
              <p className="text-sm font-medium text-slate-400">{metric.label}</p>
            </div>
            <p className="text-2xl font-bold text-white mt-2">
              {formatValue(metric)}
            </p>
          </div>
        ))}
      </div>
      
      <div className="mt-4 flex items-start gap-2 text-xs text-slate-500">
        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <p>
          These metrics are dynamically selected based on the company's sector ({data.template}). 
          Standard metrics apply if specific sector data is unavailable.
        </p>
      </div>
    </div>
  );
};

export default SectorAnalysis;
