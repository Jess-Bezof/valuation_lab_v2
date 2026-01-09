import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

interface DCFChartProps {
  dcfDetails: {
    explicitPeriodPV: number;
    terminalValuePV: number;
    projectedCashFlows: { year: number; freeCashFlow: number; presentValue: number }[];
  };
}

const DCFChart: React.FC<DCFChartProps> = ({ dcfDetails }) => {
  // Prepare chart data for explicit period (Years 1-10)
  const chartData = dcfDetails.projectedCashFlows.map(item => ({
    name: `Year ${item.year}`,
    FCF: item.freeCashFlow,
    PV: item.presentValue
  }));

  // Calculate percentages for Composition Bar
  const totalValue = dcfDetails.explicitPeriodPV + dcfDetails.terminalValuePV;
  const explicitPercent = totalValue > 0 ? (dcfDetails.explicitPeriodPV / totalValue) * 100 : 0;
  const terminalPercent = totalValue > 0 ? (dcfDetails.terminalValuePV / totalValue) * 100 : 0;

  // Determine growth period (5 or 10 years)
  const isHighGrowth = chartData.length > 5;
  const growthPeriodLabel = isHighGrowth ? "10" : "5";

  return (
    <div className="flex flex-col gap-4">
      {/* Main Bar Chart */}
      <div className="w-full min-h-[300px] bg-slate-900/50 rounded-lg p-4 border border-slate-800 flex flex-col pb-8">
        <h3 className="text-sm font-semibold text-slate-400 mb-4">Projected Free Cash Flows (Years 1-{growthPeriodLabel})</h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData} margin={{ top: 20, right: 30, left: 60, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis 
              dataKey="name" 
              stroke="#94a3b8" 
              fontSize={12} 
              tickLine={false} 
              axisLine={false}
            />
            <YAxis 
              stroke="#94a3b8" 
              fontSize={12} 
              tickLine={false} 
              axisLine={false}
              tickFormatter={(value) => `$${(value / 1000).toFixed(1)}B`}
            />
            <Tooltip 
              cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }}
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#e2e8f0' }}
              itemStyle={{ color: '#e2e8f0' }}
              formatter={(value: number) => [`$${(value).toFixed(0)} M`, '']}
            />
            <Legend wrapperStyle={{ paddingTop: '20px', position: 'relative' }} />
            <Bar dataKey="FCF" name="Free Cash Flow" fill="#34d399" radius={[4, 4, 0, 0]} barSize={30} />
            <Bar dataKey="PV" name="Present Value" fill="#059669" radius={[4, 4, 0, 0]} barSize={30} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Value Composition Bar */}
      <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
        <h3 className="text-sm font-semibold text-slate-400 mb-3">VALUE COMPOSITION</h3>
        <div className="relative h-8 w-full rounded-full overflow-hidden flex bg-slate-800">
          {/* Explicit Period Segment */}
          <div 
            style={{ width: `${explicitPercent}%` }} 
            className="h-full bg-emerald-500 flex items-center justify-center text-xs font-bold text-slate-900 transition-all duration-500"
          >
            {explicitPercent > 10 && `${growthPeriodLabel}yr Sum: ${explicitPercent.toFixed(0)}%`}
          </div>
          
          {/* Terminal Value Segment */}
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
