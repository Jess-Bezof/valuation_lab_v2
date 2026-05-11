import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, Cell, ReferenceArea, ReferenceLine,
} from 'recharts';

interface DCFChartProps {
  dcfDetails: {
    explicitPeriodPV: number;
    terminalValuePV: number;
    projectedCashFlows: { year: number; freeCashFlow: number; presentValue: number; phase?: 1 | 2 }[];
  };
}

const PHASE_META = {
  1: {
    label: 'Phase 1 — High Growth (Yrs 1–5)',
    color: '#34d399',
    pvColor: '#059669',
    bgColor: '#10b981',
    desc: 'Competitive moat is intact. Growth holds near its current level; high ROIC means the company can fund expansion efficiently while generating strong free cash flow.',
  },
  2: {
    label: 'Phase 2 — Transition (Yrs 6–10)',
    color: '#60a5fa',
    pvColor: '#2563eb',
    bgColor: '#3b82f6',
    desc: 'Growth decelerates as the market matures and competition intensifies. Margins converge toward their target and excess returns begin to normalise toward the cost of capital.',
  },
} as const;

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const phase = payload[0]?.payload?.phase as 1 | 2 | undefined;
  const meta = phase ? PHASE_META[phase] : null;

  return (
    <div style={{
      backgroundColor: '#0f172a',
      border: '1px solid #1e293b',
      borderRadius: '10px',
      padding: '12px 14px',
      maxWidth: '260px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    }}>
      <p style={{ color: '#e2e8f0', fontWeight: 700, marginBottom: meta ? '8px' : '4px', fontSize: '13px' }}>
        {label}
      </p>
      {meta && (
        <div style={{
          borderLeft: `3px solid ${meta.color}`,
          paddingLeft: '8px',
          marginBottom: '10px',
        }}>
          <p style={{ color: meta.color, fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>
            {meta.label}
          </p>
          <p style={{ color: '#94a3b8', fontSize: '11px', lineHeight: '1.5' }}>
            {meta.desc}
          </p>
        </div>
      )}
      {payload.map((entry: any, i: number) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', marginTop: '4px' }}>
          <span style={{ color: entry.color, fontSize: '12px' }}>{entry.name}</span>
          <span style={{ color: '#e2e8f0', fontFamily: 'monospace', fontSize: '12px' }}>
            {entry.value != null
              ? `${entry.value < 0 ? '-' : ''}$${Math.abs(entry.value).toFixed(0)}M`
              : '—'}
          </span>
        </div>
      ))}
    </div>
  );
};

const DCFChart: React.FC<DCFChartProps> = ({ dcfDetails }) => {
  const chartData = dcfDetails.projectedCashFlows.map(item => ({
    name: `Year ${item.year}`,
    FCF: item.freeCashFlow,
    PV: item.presentValue,
    phase: item.phase,
  }));

  const totalValue = dcfDetails.explicitPeriodPV + dcfDetails.terminalValuePV;
  const explicitPercent = totalValue > 0 ? (dcfDetails.explicitPeriodPV / totalValue) * 100 : 0;
  const terminalPercent = totalValue > 0 ? (dcfDetails.terminalValuePV / totalValue) * 100 : 0;
  const hasPhases = chartData.some(d => d.phase !== undefined);
  const years = chartData.length;

  return (
    <div className="flex flex-col gap-4">

      {/* Phase legend — only shown for high-growth two-phase charts */}
      {hasPhases && (
        <div className="flex flex-wrap items-center gap-5 px-1">
          {([1, 2] as const).map(p => (
            <div key={p} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: PHASE_META[p].color }} />
              <span className="text-xs text-slate-400 font-medium">{PHASE_META[p].label}</span>
            </div>
          ))}
          <span className="text-[11px] text-slate-600 ml-auto italic">Hover bars for phase details</span>
        </div>
      )}

      {/* Bar chart */}
      <div className="w-full min-h-[300px] bg-slate-900/50 rounded-lg p-4 border border-slate-800 pb-8">
        <h3 className="text-sm font-semibold text-slate-400 mb-4">
          Projected Free Cash Flows (Years 1–{years})
        </h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData} margin={{ top: 20, right: 30, left: 60, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />

            {/* Phase background shading */}
            {hasPhases && (
              <>
                <ReferenceArea x1="Year 1" x2="Year 5" fill="#10b981" fillOpacity={0.05} />
                <ReferenceArea x1="Year 6" x2="Year 10" fill="#3b82f6" fillOpacity={0.05} />
                <ReferenceLine
                  x="Year 6"
                  stroke="#334155"
                  strokeDasharray="5 4"
                  label={{ value: '← Growth  |  Transition →', position: 'top', fill: '#475569', fontSize: 10 }}
                />
              </>
            )}

            <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis
              stroke="#94a3b8"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `$${(v / 1000).toFixed(1)}B`}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
            <Legend wrapperStyle={{ paddingTop: '20px' }} />

            <Bar dataKey="FCF" name="Free Cash Flow" radius={[4, 4, 0, 0]} barSize={30}>
              {chartData.map((entry, i) => (
                <Cell
                  key={`fcf-${i}`}
                  fill={entry.FCF < 0 ? '#ef4444' : entry.phase === 2 ? PHASE_META[2].color : PHASE_META[1].color}
                />
              ))}
            </Bar>
            <Bar dataKey="PV" name="Present Value" radius={[4, 4, 0, 0]} barSize={30}>
              {chartData.map((entry, i) => (
                <Cell
                  key={`pv-${i}`}
                  fill={entry.PV < 0 ? '#dc2626' : entry.phase === 2 ? PHASE_META[2].pvColor : PHASE_META[1].pvColor}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Value composition bar */}
      <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
        <h3 className="text-sm font-semibold text-slate-400 mb-3">VALUE COMPOSITION</h3>
        <div className="relative h-8 w-full rounded-full overflow-hidden flex bg-slate-800">
          <div
            style={{ width: `${explicitPercent}%` }}
            className="h-full bg-emerald-500 flex items-center justify-center text-xs font-bold text-slate-900 transition-all duration-500"
          >
            {explicitPercent > 10 && `${years}yr Sum: ${explicitPercent.toFixed(0)}%`}
          </div>
          <div
            style={{ width: `${terminalPercent}%` }}
            className="h-full bg-blue-500 flex items-center justify-center text-xs font-bold text-white transition-all duration-500"
          >
            {terminalPercent > 10 && `Terminal: ${terminalPercent.toFixed(0)}%`}
          </div>
        </div>
        <div className="flex justify-between text-xs text-slate-500 mt-2 px-1">
          <div>PV of Cash Flows: <span className="text-emerald-400">${(dcfDetails.explicitPeriodPV / 1000).toFixed(1)}B</span></div>
          <div>PV of Terminal Value: <span className="text-blue-400">${(dcfDetails.terminalValuePV / 1000).toFixed(1)}B</span></div>
        </div>
      </div>
    </div>
  );
};

export default DCFChart;
