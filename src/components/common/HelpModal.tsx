/**
 * FlowSmart - In-App Help Window
 * Modal overlay explaining current screen features.
 * Focus-managed, accessible, and responsive.
 */

import React, { useEffect, useRef } from 'react';
import { X, CircleHelp, Info } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ActiveTab } from '../../types/traffic';
import { HELP_CONTENT, HelpChip, HelpMetric, HelpSetting } from '../layout/helpContent';

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
  tab: ActiveTab;
}

const SettingCardView: React.FC<{ setting: HelpSetting }> = ({ setting }) => {
  return (
    <div className="border border-[#E2E6EF] rounded-lg p-3 bg-[#FAFBFD] flex flex-col gap-2">
      <div className="text-[14px] font-bold text-[#111C2D] leading-snug">
        {setting.name}
      </div>

      <div>
        <div className="text-[12px] font-bold text-[#6B7280] mb-0.5">What it does</div>
        <div className="text-[13px] text-[#434651] leading-relaxed">{setting.what}</div>
      </div>

      {setting.why && (
        <div>
          <div className="text-[12px] font-bold text-[#6B7280] mb-0.5">When to change it</div>
          <div className="text-[13px] text-[#434651] leading-relaxed">{setting.why}</div>
        </div>
      )}

      {setting.fields && setting.fields.length > 0 && (
        <div className="flex flex-col gap-2 pt-1 border-t border-[#E2E6EF]/60">
          {setting.fields.map((field, fIdx) => {
            const parts: string[] = [];
            if (field.range) parts.push(`Range: ${field.range}`);
            if (field.defaultValue) parts.push(`Default: ${field.defaultValue}`);
            return (
              <div key={fIdx} className="flex flex-col">
                <span className="text-[13px] font-bold text-[#111C2D] leading-snug">
                  {field.label}
                </span>
                <span className="text-[13px] text-[#434651] leading-relaxed">
                  {field.text}
                </span>
                {parts.length > 0 && (
                  <span className="text-[12px] text-[#6B7280] mt-0.5">
                    {parts.join('  |  ')}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {setting.note && (
        <div className="flex items-start gap-1.5 text-[12px] text-[#6B7280] leading-relaxed pt-0.5">
          <Info size={14} className="shrink-0 mt-0.5 text-[#6B7280]" aria-hidden="true" />
          <span>{setting.note}</span>
        </div>
      )}
    </div>
  );
};

const MetricCardView: React.FC<{ metric: HelpMetric }> = ({ metric }) => {
  return (
    <div className="border border-[#E2E6EF] rounded-lg p-3 bg-[#FAFBFD] flex flex-col gap-2">
      <div className="text-[14px] font-bold text-[#111C2D] leading-snug">
        {metric.name}
      </div>

      <div>
        <div className="text-[12px] font-bold text-[#6B7280] mb-0.5">What it means</div>
        <div className="text-[13px] text-[#434651] leading-relaxed">{metric.meaning}</div>
      </div>

      <div>
        <div className="text-[12px] font-bold text-[#6B7280] mb-0.5">How it is calculated</div>
        <div className="text-[13px] text-[#434651] leading-relaxed">{metric.how}</div>
      </div>

      {metric.ratings && metric.ratings.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {metric.ratings.map((rating, rIdx) => {
            const toneClass =
              rating.tone === 'good'
                ? 'bg-[#82FAB6]/40 text-[#005230]'
                : rating.tone === 'warn'
                ? 'bg-[#FFDDB8] text-[#513100]'
                : 'bg-[#FFDAD6] text-[#93000A]';

            return (
              <span
                key={rIdx}
                className={`text-[12px] rounded-lg px-2 py-0.5 font-medium ${toneClass}`}
              >
                {rating.label}: {rating.range}
              </span>
            );
          })}
        </div>
      )}

      {metric.note && (
        <div className="text-[12px] text-[#6B7280] leading-relaxed pt-0.5">
          {metric.note}
        </div>
      )}
    </div>
  );
};

const ChipView: React.FC<{ chip: HelpChip }> = ({ chip }) => {
  return (
    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#F5F6F8] border border-[#E2E6EF] text-[12px]">
      <svg width="22" height="6" className="shrink-0 overflow-visible" aria-hidden="true">
        <line
          x1="0"
          y1="3"
          x2="22"
          y2="3"
          stroke={chip.color}
          strokeWidth="2.5"
          strokeDasharray={
            chip.style === 'dashed' ? '5 3' : chip.style === 'dotted' ? '2 3' : undefined
          }
          strokeLinecap="round"
        />
      </svg>
      <span className="font-medium text-[#111C2D]">{chip.label}</span>
      <span className="text-[#6B7280]">({chip.note})</span>
    </div>
  );
};

export const HelpModal: React.FC<HelpModalProps> = ({ open, onClose, tab }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const shouldReduceMotion = useReducedMotion();

  const guide = HELP_CONTENT[tab] || HELP_CONTENT['map-setup'];

  // Prevent page behind modal from scrolling while open
  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  // Track previous active element and manage focus
  useEffect(() => {
    if (open) {
      previousActiveElementRef.current = document.activeElement as HTMLElement | null;

      // Small delay to allow element mounting before focusing
      const timeout = setTimeout(() => {
        if (panelRef.current) {
          const focusable = panelRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          );
          if (focusable.length > 0) {
            focusable[0].focus();
          } else {
            panelRef.current.focus();
          }
        }
      }, 20);

      return () => clearTimeout(timeout);
    } else {
      const returnFocus = () => {
        if (
          previousActiveElementRef.current &&
          typeof previousActiveElementRef.current.focus === 'function' &&
          previousActiveElementRef.current !== document.body
        ) {
          previousActiveElementRef.current.focus();
        } else {
          const helpBtn = document.querySelector<HTMLElement>(
            'button[aria-label="How to use this screen"]'
          );
          helpBtn?.focus();
        }
      };

      returnFocus();
      // Ensure focus isn't lost during exit animation unmount
      const focusTimer = setTimeout(returnFocus, 160);
      return () => clearTimeout(focusTimer);
    }
  }, [open]);

  // Trap focus and handle Escape
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        if (!panelRef.current) return;
        const focusableElements = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement || !panelRef.current.contains(document.activeElement)) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement || !panelRef.current.contains(document.activeElement)) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const animationDuration = shouldReduceMotion ? 0 : 0.15;

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 font-sans overscroll-contain"
          onClick={onClose}
          onWheel={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault();
            }
          }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-modal-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.96 }}
            transition={{ duration: animationDuration, ease: 'easeOut' }}
            className="bg-white rounded-xl shadow-xl w-full max-w-[640px] max-h-[80vh] flex flex-col border border-[#E2E6EF] overflow-hidden focus:outline-none"
          >
            {/* Fixed Header */}
            <header className="px-5 py-4 border-b border-[#E5E7EB] flex items-start justify-between gap-3 bg-white shrink-0">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#254B98]/10 text-[#254B98] flex items-center justify-center shrink-0 mt-0.5">
                  <CircleHelp size={18} />
                </div>
                <div>
                  <h2
                    id="help-modal-title"
                    className="text-[16px] font-medium text-[#111C2D] leading-tight"
                  >
                    {guide.title}
                  </h2>
                  <p className="text-[12px] text-[#6B7280] mt-0.5">{guide.subtitle}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close help"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6B7280] hover:text-[#111C2D] hover:bg-[#F5F6F8] transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98]"
              >
                <X size={18} />
              </button>
            </header>

            {/* Scrollable Body */}
            <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-5 overscroll-contain">
              <p className="text-[13px] sm:text-[14px] text-[#111C2D] leading-relaxed">
                {guide.intro}
              </p>

              {/* Numbered Steps */}
              {guide.steps.length > 0 && (
                <div className="space-y-4">
                  {guide.steps.map((step, idx) => (
                    <div key={idx} className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-[#254B98] text-white text-[12px] font-semibold flex items-center justify-center shrink-0 mt-0.5">
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-[14px] font-medium text-[#111C2D] leading-snug">
                          {step.heading}
                        </h3>
                        <p className="text-[13px] text-[#434651] leading-relaxed mt-1">
                          {step.body}
                        </p>
                        {step.chips && step.chips.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            {step.chips.map((chip, cIdx) => (
                              <ChipView key={cIdx} chip={chip} />
                            ))}
                          </div>
                        )}
                        {step.metrics && step.metrics.length > 0 && (
                          <div className="mt-3 flex flex-col gap-2">
                            {step.metrics.map((metric, mIdx) => (
                              <MetricCardView key={mIdx} metric={metric} />
                            ))}
                          </div>
                        )}
                        {step.settings && step.settings.length > 0 && (
                          <div className="mt-3 flex flex-col gap-2">
                            {step.settings.map((setting, sIdx) => (
                              <SettingCardView key={sIdx} setting={setting} />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Good to Know Box */}
              {guide.tips && guide.tips.length > 0 && (
                <div className="mt-6 p-3.5 bg-[#EEF3FB] border-l-[3px] border-[#254B98] rounded-r-lg">
                  <h4 className="text-[13px] font-semibold text-[#254B98] mb-1.5">Good to know</h4>
                  <ul className="space-y-1.5 text-[12px] sm:text-[13px] text-[#111C2D] list-disc list-inside">
                    {guide.tips.map((tip, idx) => (
                      <li key={idx} className="leading-relaxed">
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Fixed Footer */}
            <footer className="px-5 py-3.5 border-t border-[#E5E7EB] bg-white flex justify-end shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-4 rounded-lg bg-[#254B98] hover:bg-[#1b366e] text-white text-[13px] font-medium transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] focus-visible:ring-offset-1"
              >
                Got it
              </button>
            </footer>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
