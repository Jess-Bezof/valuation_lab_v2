import React from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';

interface LoadingScreenProps {
  ticker: string;
  status: string | null;
  /** true → translucent overlay over existing content; false → full solid screen */
  overlay?: boolean;
}

const STEPS = [
  {
    key: 'connect',
    label: 'Connecting',
    match: (s: string) => s.includes('connect') || s.includes('starting') || s.includes('server'),
  },
  {
    key: 'load',
    label: 'Loading data',
    match: (s: string) => s.includes('loading') || s.includes('ready') || s.includes('retrying'),
  },
  {
    key: 'analyze',
    label: 'Running analysis',
    match: (s: string) => s.includes('running') || s.includes('valuation') || s.includes('ai'),
  },
];

function getActiveStep(status: string | null): number {
  if (!status) return 0;
  const s = status.toLowerCase();
  for (let i = STEPS.length - 1; i >= 0; i--) {
    if (STEPS[i].match(s)) return i;
  }
  return 0;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ ticker, status, overlay = false }) => {
  const activeStep = getActiveStep(status);

  const content = (
    <div
      className={`flex flex-col items-center justify-center gap-8 ${
        overlay
          ? 'fixed inset-0 z-[9999] bg-[#0B0E14]/80 backdrop-blur-xl'
          : 'min-h-screen bg-[#0B0E14]'
      }`}
    >
      {/* Animated spinner (no icon box) */}
      <div className="relative flex items-center justify-center w-24 h-24">
        <div className="absolute inset-0 rounded-full bg-blue-500/10 animate-ping [animation-duration:2s]" />
        <div className="absolute w-20 h-20 rounded-full bg-blue-500/5 animate-ping [animation-duration:2.8s] [animation-delay:0.4s]" />
        <div className="absolute inset-2 rounded-full border-2 border-transparent border-t-blue-500 border-r-blue-500/40 animate-spin" />
      </div>

      {/* Title + status */}
      <div className="text-center space-y-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
          Financial Valuation Lab
        </p>
        <h2 className="text-2xl font-bold text-white">
          Analyzing{' '}
          <span className="text-blue-400">{ticker || '…'}</span>
        </h2>
        <p className="text-sm text-slate-400 min-h-[20px] transition-all duration-300">
          {status ?? 'Loading…'}
        </p>
      </div>

      {/* Step progress */}
      <div className="flex items-center gap-3">
        {STEPS.map((step, i) => {
          const done   = i < activeStep;
          const active = i === activeStep;
          return (
            <React.Fragment key={step.key}>
              <div className="flex items-center gap-1.5">
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center border transition-all duration-500 ${
                    done
                      ? 'bg-blue-500 border-blue-500'
                      : active
                      ? 'border-blue-500 bg-blue-500/20 animate-pulse'
                      : 'border-slate-700 bg-transparent'
                  }`}
                >
                  {done && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                  {active && <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
                </div>
                <span
                  className={`text-xs font-medium transition-colors duration-500 ${
                    done ? 'text-blue-400' : active ? 'text-slate-200' : 'text-slate-600'
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`w-8 h-px transition-all duration-700 ${
                    done ? 'bg-blue-500/60' : 'bg-slate-700'
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );

  // Overlay mode: portal to document.body to escape any parent stacking context
  if (overlay) return createPortal(content, document.body);
  return content;
};

export default LoadingScreen;
