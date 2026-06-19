import React from 'react';
import { Info } from 'lucide-react';

interface InfoTooltipProps {
  content: string;
  className?: string;
  iconClassName?: string;
  widthClass?: string;
}

const InfoTooltip: React.FC<InfoTooltipProps> = ({
  content,
  className = '',
  iconClassName = 'text-slate-500 hover:text-blue-400',
  widthClass = 'w-64',
}) => (
  <span className={`group relative inline-flex shrink-0 ${className}`}>
    <button
      type="button"
      className={`cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 rounded-full ${iconClassName}`}
      aria-label="More information"
    >
      <Info className="w-4 h-4" />
    </button>
    <span
      role="tooltip"
      className={`absolute left-1/2 -translate-x-1/2 bottom-full mb-2 ${widthClass} px-3 py-2 text-xs text-slate-300 leading-relaxed bg-slate-900 border border-slate-700 rounded-lg shadow-xl z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-opacity pointer-events-none`}
    >
      {content}
    </span>
  </span>
);

export default InfoTooltip;
