/**
 * FlowSmart - Vehicle Mix Control
 * Allows configuring the proportion of sticker vs non-sticker vehicles (settings.stickerShare).
 * Shows:
 * - Label "Vehicle mix"
 * - Number input "Sticker %" (0 to 100, step 5) with slider next to it
 * - Read-only complement "Non-sticker: N%"
 * - Thin two-colour bar: white with dark outline for sticker, #38BDF8 for non-sticker, split at chosen percentage
 * - Single-class entrance notice: amber line for entrances that only allow one vehicle class
 * - Sentence case everywhere
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Lock, AlertTriangle } from 'lucide-react';
import { useTrafficStore } from '../../context/TrafficStoreContext';
import { useSimulation } from '../../context/SimulationContext';

export interface VehicleMixControlProps {
  disabled?: boolean;
}

export const VehicleMixControl: React.FC<VehicleMixControlProps> = ({ disabled = false }) => {
  const { state: storeState, updateSettings } = useTrafficStore();
  const { routeValidation } = useSimulation();

  const stickerShare = storeState.settings.stickerShare ?? 0.7;
  const stickerPercent = Math.min(100, Math.max(0, Math.round(stickerShare * 100)));
  const nonStickerPercent = 100 - stickerPercent;

  const [localInput, setLocalInput] = useState<string>(String(stickerPercent));

  // Keep local input in sync if stickerShare changes externally
  useEffect(() => {
    setLocalInput(String(stickerPercent));
  }, [stickerPercent]);

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const raw = e.target.value;
    setLocalInput(raw);

    if (raw.trim() === '') return;
    const parsed = Number(raw);
    if (!Number.isNaN(parsed)) {
      const clamped = Math.min(100, Math.max(0, Math.round(parsed)));
      updateSettings({ stickerShare: clamped / 100 });
    }
  };

  const handleNumberBlur = () => {
    if (disabled) return;
    const parsed = Number(localInput);
    if (localInput.trim() === '' || Number.isNaN(parsed)) {
      setLocalInput(String(stickerPercent));
    } else {
      const clamped = Math.min(100, Math.max(0, Math.round(parsed)));
      setLocalInput(String(clamped));
      updateSettings({ stickerShare: clamped / 100 });
    }
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const val = Math.min(100, Math.max(0, Number(e.target.value)));
    setLocalInput(String(val));
    updateSettings({ stickerShare: val / 100 });
  };

  // Entrances that allow only one class per router validation
  const singleClassEntrances = useMemo(() => {
    const notices: { id: string; message: string }[] = [];
    if (!routeValidation || !routeValidation.entranceSummaries) return notices;

    for (const summary of routeValidation.entranceSummaries) {
      if (summary.error) continue;
      const cleanName = summary.entranceName.replace(/\s*\(.*\)/, '');
      if (summary.stickerOnly) {
        notices.push({
          id: summary.entranceId,
          message: `${cleanName}: sticker holders only. The mix is not applied there.`,
        });
      } else if (summary.nonStickerOnly) {
        notices.push({
          id: summary.entranceId,
          message: `${cleanName}: non-sticker only. The mix is not applied there.`,
        });
      }
    }
    return notices;
  }, [routeValidation]);

  return (
    <div
      className={`flex flex-col space-y-2.5 ${
        disabled ? 'opacity-70' : ''
      }`}
    >
      {/* Header with Lock icon if disabled */}
      <div className="flex items-center justify-between">
        <label className="text-[16px] font-medium text-[#111C2D]" htmlFor="sticker-share-input">
          Vehicle mix
        </label>
        {disabled && <Lock size={13} className="text-[#6B7A99]" />}
      </div>

      {/* Number input & Slider row */}
      <div className="flex flex-col space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="sticker-share-input" className="text-[12px] text-[#6B7A99]">
            Sticker %
          </label>
          <div className="flex items-center gap-1">
            <input
              id="sticker-share-input"
              type="number"
              min={0}
              max={100}
              step={5}
              disabled={disabled}
              value={localInput}
              onChange={handleNumberChange}
              onBlur={handleNumberBlur}
              className={`w-14 h-8 px-2 text-center bg-white border border-[#E2E6EF] rounded-lg text-[13px] font-medium text-[#111C2D] focus:outline-none focus:border-[#254B98] focus-visible:ring-1 focus-visible:ring-[#254B98] ${
                disabled ? 'cursor-not-allowed bg-gray-100' : ''
              }`}
              aria-label="Sticker percentage"
            />
            <span className="text-[12px] text-[#6B7A99] font-medium">%</span>
          </div>
        </div>

        {/* Range Slider (step 5) */}
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          disabled={disabled}
          value={stickerPercent}
          onChange={handleSliderChange}
          className="w-full h-2 bg-[#E2E6EF] rounded-lg appearance-none cursor-pointer accent-[#254B98] focus:outline-none disabled:cursor-not-allowed"
          aria-label="Sticker percentage slider"
        />
      </div>

      {/* Read-only complement Non-sticker: N% */}
      <div className="flex items-center justify-between text-[12px] pt-0.5">
        <span className="text-[#6B7A99]">Non-sticker: {nonStickerPercent}%</span>
        <span className="text-[#6B7A99] tabular-nums font-mono text-[11px]">
          {stickerPercent}% / {nonStickerPercent}%
        </span>
      </div>

      {/* Thin two-colour split bar */}
      <div
        className="w-full h-2 rounded-[2px] overflow-hidden flex border border-[#0F172A] bg-[#38BDF8]"
        title={`Sticker: ${stickerPercent}%, Non-sticker: ${nonStickerPercent}%`}
      >
        {stickerPercent > 0 && (
          <div
            style={{ width: `${stickerPercent}%` }}
            className={`h-full bg-white transition-all duration-150 ${
              stickerPercent < 100 ? 'border-r border-[#0F172A]' : ''
            }`}
          />
        )}
        {nonStickerPercent > 0 && (
          <div
            style={{ width: `${nonStickerPercent}%` }}
            className="h-full bg-[#38BDF8] transition-all duration-150"
          />
        )}
      </div>

      {/* Amber lines for single-class entrances */}
      {singleClassEntrances.length > 0 && (
        <div className="flex flex-col space-y-1 pt-1">
          {singleClassEntrances.map((notice) => (
            <div
              key={notice.id}
              className="text-[11px] text-[#B45309] bg-amber-50/90 border border-amber-200/80 rounded px-2 py-1 flex items-start gap-1.5 leading-snug"
            >
              <AlertTriangle size={12} className="text-[#F59E0B] shrink-0 mt-0.5" />
              <span>{notice.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
