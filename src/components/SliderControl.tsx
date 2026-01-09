import React from 'react';

interface SliderControlProps {
  label: string;
  value: number;
  baseValue?: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  color?: string;
  formatValue?: (val: number) => string;
}

const SliderControl: React.FC<SliderControlProps> = ({
  label,
  value,
  baseValue,
  min,
  max,
  step,
  onChange,
  color = 'blue',
  formatValue = (v) => v.toFixed(2)
}) => {
  const percentChange = baseValue 
    ? ((value - baseValue) / baseValue) * 100 
    : 0;

  return (
    <div className="mb-6 p-4 bg-slate-900/50 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors">
      <div className="flex justify-between items-center mb-3">
        <label className="text-sm font-medium text-slate-300">{label}</label>
        <div className="text-right">
          <span className={`text-lg font-bold text-${color}-400`}>
            {formatValue(value)}
          </span>
          {baseValue && Math.abs(percentChange) > 0.01 && (
            <span className={`ml-2 text-xs ${percentChange > 0 ? 'text-green-400' : 'text-red-400'}`}>
              {percentChange > 0 ? '+' : ''}{percentChange.toFixed(1)}%
            </span>
          )}
        </div>
      </div>
      
      <div className="relative flex items-center h-6">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        />
      </div>
      
      <div className="flex justify-between text-xs text-slate-500 mt-1">
        <span>{formatValue(min)}</span>
        <span>{formatValue(max)}</span>
      </div>
    </div>
  );
};

export default SliderControl;
