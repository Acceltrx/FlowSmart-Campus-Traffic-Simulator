/**
 * FlowSmart - Pre-run Expectation Modal
 * Shows an estimate calculated from the current settings before starting a run.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Play, X } from 'lucide-react';
import { SimulationExpectation, DropoffLoadLevel } from '../../utils/expectation';

export const SKIP_EXPECTATION_STORAGE_KEY = 'flowsmart.skipExpectation';

export function shouldSkipExpectationModal(): boolean {
  try {
    const val = localStorage.getItem(SKIP_EXPECTATION_STORAGE_KEY);
    return val === '1' || val === 'true';
  } catch {
    return false;
  }
}

export interface ExpectationModalProps {
  open: boolean;
  scenarioName: string;
  simDurationMin: number;
  stickerShare: number;
  expectation: SimulationExpectation;
  returnFocusRef?: React.RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onConfirmStart: () => void;
}

const LEVEL_STYLES: Record<DropoffLoadLevel, { label: string; className: string }> = {
  comfortable: {
    label: 'Comfortable',
    className: 'bg-[#25A76B]/15 text-[#25A76B]',
  },
  busy: {
    label: 'Busy',
    className: 'bg-[#F59E0B]/15 text-[#B45309]',
  },
  overloaded: {
    label: 'Likely to back up',
    className: 'bg-[#EF4444]/15 text-[#EF4444]',
  },
};

export const ExpectationModal: React.FC<ExpectationModalProps> = ({
  open,
  scenarioName,
  simDurationMin,
  stickerShare,
  expectation,
  returnFocusRef,
  onCancel,
  onConfirmStart,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef<boolean>(false);

  const [dontShowAgain, setDontShowAgain] = useState<boolean>(() => shouldSkipExpectationModal());

  useEffect(() => {
    if (open) {
      setDontShowAgain(shouldSkipExpectationModal());
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      wasOpenRef.current = true;
      const raf = window.requestAnimationFrame(() => {
        startButtonRef.current?.focus();
      });
      return () => window.cancelAnimationFrame(raf);
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      const target = returnFocusRef?.current ?? previousFocusRef.current;
      target?.focus();
    }
  }, [open, returnFocusRef]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || !dialogRef.current.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !dialogRef.current.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const handleToggleDontShow = (checked: boolean) => {
    setDontShowAgain(checked);
    try {
      if (checked) {
        localStorage.setItem(SKIP_EXPECTATION_STORAGE_KEY, '1');
      } else {
        localStorage.removeItem(SKIP_EXPECTATION_STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors
    }
  };

  const hasOverloaded = expectation.perDropoff.some((d) => d.level === 'overloaded');
  const hasBusy = expectation.perDropoff.some((d) => d.level === 'busy');
  const headlineBannerClass = hasOverloaded
    ? 'bg-[#EF4444]/10 border-[#EF4444]/30 text-[#111C2D]'
    : hasBusy
      ? 'bg-[#F59E0B]/10 border-[#F59E0B]/30 text-[#111C2D]'
      : 'bg-[#25A76B]/10 border-[#25A76B]/30 text-[#111C2D]';

  const stickerPct = Math.round(stickerShare * 100);
  const visitorPct = 100 - stickerPct;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="expectation-modal-title"
        className="bg-white rounded-[12px] max-w-lg w-full p-6 shadow-xl border border-[#E2E6EF] flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="expectation-modal-title" className="text-[18px] font-semibold text-[#111C2D]">
              Before you start
            </h2>
            <p className="text-[13px] text-[#6B7A99] mt-0.5">
              {scenarioName} · {simDurationMin} minutes
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-[#6B7A99] hover:text-[#111C2D] hover:bg-[#F5F6F8] cursor-pointer transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className={`px-3.5 py-2.5 rounded-lg border text-[14px] font-medium ${headlineBannerClass}`}>
          {expectation.headline}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-[#F5F6F8] border border-[#E2E6EF]">
            <div className="text-[12px] text-[#6B7A99]">Expected cars</div>
            <div className="text-[18px] font-semibold text-[#111C2D] mt-0.5 tabular-nums">
              {expectation.expectedCars.toLocaleString()}
            </div>
            <div className="text-[12px] text-[#6B7A99] tabular-nums">
              {expectation.arrivalsPerHour.toLocaleString()} /hr
            </div>
          </div>
          <div className="p-3 rounded-lg bg-[#F5F6F8] border border-[#E2E6EF]">
            <div className="text-[12px] text-[#6B7A99]">Sticker cars</div>
            <div className="text-[18px] font-semibold text-[#254B98] mt-0.5 tabular-nums">
              {expectation.stickerCars.toLocaleString()}
            </div>
            <div className="text-[12px] text-[#6B7A99] tabular-nums">{stickerPct}%</div>
          </div>
          <div className="p-3 rounded-lg bg-[#F5F6F8] border border-[#E2E6EF]">
            <div className="text-[12px] text-[#6B7A99]">Visitor cars</div>
            <div className="text-[18px] font-semibold text-[#111C2D] mt-0.5 tabular-nums">
              {expectation.visitorCars.toLocaleString()}
            </div>
            <div className="text-[12px] text-[#6B7A99] tabular-nums">{visitorPct}%</div>
          </div>
        </div>

        <div>
          <h3 className="text-[14px] font-semibold text-[#111C2D] mb-2">
            Expected drop-off load
          </h3>
          {expectation.perDropoff.length === 0 ? (
            <div className="p-3 rounded-lg bg-[#F5F6F8] border border-[#E2E6EF] text-[13px] text-[#6B7A99]">
              No drop-off zones on this map. All cars drive straight to an exit.
            </div>
          ) : (
            <div className="border border-[#E2E6EF] rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse text-[13px]">
                <thead>
                  <tr className="bg-[#F5F6F8] border-b border-[#E2E6EF] text-[#6B7A99] text-[12px]">
                    <th className="py-2 px-3 font-medium">Drop-off zone</th>
                    <th className="py-2 px-3 font-medium text-right">Arriving</th>
                    <th className="py-2 px-3 font-medium text-right">Can handle</th>
                    <th className="py-2 px-3 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {expectation.perDropoff.map((d) => {
                    const badge = LEVEL_STYLES[d.level];
                    return (
                      <tr key={d.id} className="border-b border-[#E2E6EF] last:border-b-0">
                        <td className="py-2.5 px-3 font-medium text-[#111C2D]">{d.name}</td>
                        <td className="py-2.5 px-3 text-right text-[#111C2D] tabular-nums">
                          {d.arrivalsPerMin} /min
                        </td>
                        <td className="py-2.5 px-3 text-right text-[#6B7A99] tabular-nums">
                          {d.capacityPerMin} /min
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-full text-[12px] font-semibold whitespace-nowrap ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-[12px] text-[#6B7A99]">
          This is an estimate from your settings. The simulation shows what really happens.
        </p>

        <div className="flex flex-col gap-3 pt-1 border-t border-[#E2E6EF]">
          <label className="inline-flex items-center gap-2 text-[13px] text-[#6B7A99] cursor-pointer select-none min-h-[36px]">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => handleToggleDontShow(e.target.checked)}
              className="w-4 h-4 accent-[#254B98] rounded cursor-pointer"
            />
            <span>Don't show this again</span>
          </label>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="h-10 px-4 rounded-lg border border-[#E2E6EF] bg-white hover:bg-[#F5F6F8] text-[13px] font-medium text-[#111C2D] cursor-pointer transition-colors"
            >
              Back to settings
            </button>
            <button
              ref={startButtonRef}
              type="button"
              onClick={onConfirmStart}
              className="h-10 px-4 rounded-lg bg-[#25A76B] hover:bg-[#1f8c59] text-white text-[13px] font-semibold flex items-center gap-2 cursor-pointer transition-colors"
            >
              <Play size={14} className="fill-current shrink-0" />
              <span>Start simulation</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
