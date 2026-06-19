import React, { useState, useEffect } from 'react';
import { X, BookOpen, TrendingUp, FileText, Activity, BarChart2, SlidersHorizontal, ChevronLeft, ChevronRight } from 'lucide-react';
import { APP_GUIDE_SECTIONS, APP_GUIDE_TAGLINE, APP_GUIDE_TITLE } from '../content/appGuide';

interface AppGuideModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  showDontShowAgain?: boolean;
  onDontShowAgain?: () => void;
  primaryLabel?: string;
}

// IDs that belong to named app tabs — these get the card-switcher treatment
const TAB_IDS = ['fcf', 'financials', 'sentiment', 'report', 'multiples'];

const TAB_META: Record<string, { icon: React.ReactNode; shortTitle: string }> = {
  fcf:        { icon: <TrendingUp className="w-3.5 h-3.5" />,        shortTitle: 'Free Cash Flow' },
  financials: { icon: <FileText className="w-3.5 h-3.5" />,          shortTitle: 'Financial Highlights' },
  sentiment:  { icon: <Activity className="w-3.5 h-3.5" />,          shortTitle: 'Sentiment Analysis' },
  report:     { icon: <BookOpen className="w-3.5 h-3.5" />,          shortTitle: 'Research Report' },
  multiples:  { icon: <BarChart2 className="w-3.5 h-3.5" />,         shortTitle: 'Market Multiples' },
};

const tabSections = APP_GUIDE_SECTIONS.filter(s => TAB_IDS.includes(s.id));
const plainSections = APP_GUIDE_SECTIONS.filter(s => !TAB_IDS.includes(s.id));

const AppGuideModal: React.FC<AppGuideModalProps> = ({
  open,
  onClose,
  title = APP_GUIDE_TITLE,
  showDontShowAgain = false,
  onDontShowAgain,
  primaryLabel = 'Close',
}) => {
  const [activeTabIndex, setActiveTabIndex] = useState(0);

  useEffect(() => {
    if (open) setActiveTabIndex(0);
  }, [open]);

  if (!open) return null;

  const activeTab = tabSections[activeTabIndex] ?? tabSections[0];
  const total = tabSections.length;

  const goPrev = () => setActiveTabIndex(i => (i - 1 + total) % total);
  const goNext = () => setActiveTabIndex(i => (i + 1) % total);

  // Split plain sections: those that appear before tabs and after
  const beforeTabs = plainSections.filter(s => !['levers'].includes(s.id));
  const afterTabs  = plainSections.filter(s =>  ['levers'].includes(s.id));

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-guide-title"
    >
      <div className="bg-[#0F131C] border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-6 border-b border-slate-800">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <BookOpen className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 id="app-guide-title" className="text-xl font-bold text-white">
                {title}
              </h2>
              <p className="text-sm text-slate-400 mt-1">{APP_GUIDE_TAGLINE}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 p-6 space-y-5 scrollbar-thin scrollbar-thumb-slate-700">

          {/* Plain sections before tabs */}
          {beforeTabs.map(section => (
            <section key={section.id}>
              <h3 className="text-sm font-semibold text-blue-400 mb-1">{section.title}</h3>
              <p className="text-sm text-slate-300 leading-relaxed">{section.body}</p>
            </section>
          ))}

          {/* Interactive tab cards — one at a time with arrow navigation */}
          <section>
            <h3 className="text-sm font-semibold text-blue-400 mb-2">App tabs</h3>

            {/* Arrow navigator */}
            <div className="flex items-center gap-2 mb-2">
              <button
                type="button"
                onClick={goPrev}
                className="p-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors shrink-0"
                aria-label="Previous tab"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* Centered tab label */}
              <div className="flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg bg-blue-500/10 border border-blue-500/25">
                <span className="text-blue-400">{TAB_META[activeTab.id].icon}</span>
                <span className="text-sm font-semibold text-blue-300">{TAB_META[activeTab.id].shortTitle}</span>
                <span className="text-[10px] text-slate-500 ml-1">{activeTabIndex + 1}/{total}</span>
              </div>

              <button
                type="button"
                onClick={goNext}
                className="p-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors shrink-0"
                aria-label="Next tab"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Active tab content */}
            <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4">
              <p className="text-sm text-slate-300 leading-relaxed">{activeTab.body}</p>
            </div>

            {/* Dot indicators */}
            <div className="flex justify-center gap-1.5 mt-2.5">
              {tabSections.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveTabIndex(i)}
                  className={`rounded-full transition-all ${
                    i === activeTabIndex
                      ? 'w-4 h-1.5 bg-blue-400'
                      : 'w-1.5 h-1.5 bg-slate-600 hover:bg-slate-500'
                  }`}
                  aria-label={`Go to ${tabSections[i].id}`}
                />
              ))}
            </div>
          </section>

          {/* Plain sections after tabs */}
          {afterTabs.map(section => (
            <section key={section.id}>
              <h3 className="text-sm font-semibold text-blue-400 mb-1">{section.title}</h3>
              <p className="text-sm text-slate-300 leading-relaxed">{section.body}</p>
            </section>
          ))}

        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-800 flex flex-wrap items-center justify-end gap-3">
          {showDontShowAgain && onDontShowAgain && (
            <button
              type="button"
              onClick={onDontShowAgain}
              className="mr-auto text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Don&apos;t show again on startup
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {primaryLabel}
          </button>
        </div>

      </div>
    </div>
  );
};

export default AppGuideModal;
