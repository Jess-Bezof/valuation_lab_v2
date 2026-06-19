import React from 'react';
import { Layers, Activity } from 'lucide-react';
import { fmtM } from '../lib/formatters';
import { SectorStats, SectorMetric } from '../types';
import InfoTooltip from './InfoTooltip';
import { getSectorMetricHelp } from '../utils/sectorMetricHelp';

interface SectorAnalysisProps {
  data?: SectorStats;
}

const SECTOR_PANEL_INFO =
  'Sector-specific KPIs chosen for this company\'s industry (e.g. Rule of 40 for Technology). They supplement the DCF with operating context peers often track.';

const SectorAnalysis: React.FC<SectorAnalysisProps> = ({ data }) => {
  if (!data || data.metrics.length === 0) return null;

  const formatValue = (metric: SectorMetric) => {
    if (metric.format === 'percent') return `${metric.value.toFixed(1)}%`;
    if (metric.format === 'currency') return fmtM(metric.value, 1);
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
          <InfoTooltip content={SECTOR_PANEL_INFO} widthClass="w-72" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {data.metrics.map((metric, idx) => (
          <div
            key={idx}
            className="bg-slate-900/50 p-4 rounded-lg border border-slate-700/50 hover:border-slate-600 transition-colors"
          >
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-slate-500 shrink-0" />
              <p className="text-sm font-medium text-slate-400">{metric.label}</p>
              <InfoTooltip
                content={getSectorMetricHelp(metric.label, data.template)}
                widthClass="w-72"
              />
            </div>
            <p className="text-2xl font-bold text-white mt-2">{formatValue(metric)}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SectorAnalysis;
