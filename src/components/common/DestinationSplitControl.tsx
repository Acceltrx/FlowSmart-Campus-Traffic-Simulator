/**
 * FlowSmart - Destination Split Control
 * Allows configuring the proportion of vehicles from each entrance that go to each
 * drop-off zone or straight to an exit (Direct).
 * Replaces deprecated settings.dropoffShare.
 *
 * Rules:
 * - Sentence case everywhere
 * - No text smaller than 12px
 * - Inputs and buttons at least 36px tall (h-9)
 * - Accordions keep reading/expandable even when disabled
 * - Autosaves via updateSettings
 * - Unreachable destination notices via routeValidation.entranceSummaries
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Lock, ChevronDown, AlertTriangle, Scale, Copy } from 'lucide-react';
import { useTrafficStore } from '../../context/TrafficStoreContext';
import { useSimulation } from '../../context/SimulationContext';
import { DIRECT_KEY, getEntranceSplit } from '../../utils/destinationSplit';
import { ZoneMarker } from '../../types/traffic';

export interface DestinationSplitControlProps {
  disabled?: boolean;
}

interface DestinationRowProps {
  id: string;
  label: string;
  value: number;
  disabled?: boolean;
  onCommit: (newValue: number) => void;
}

/**
 * Individual row for a destination with local string editing to prevent snap-back while typing.
 */
const DestinationRow: React.FC<DestinationRowProps> = ({
  id,
  label,
  value,
  disabled = false,
  onCommit,
}) => {
  const roundedVal = Math.round(value * 10) / 10;
  const [localInput, setLocalInput] = useState<string>(String(roundedVal));

  useEffect(() => {
    setLocalInput(String(roundedVal));
  }, [roundedVal]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const raw = e.target.value;
    setLocalInput(raw);

    if (raw.trim() === '') return;
    const num = Number(raw);
    if (!Number.isNaN(num)) {
      const clamped = Math.min(100, Math.max(0, num));
      onCommit(clamped);
    }
  };

  const handleBlur = () => {
    if (disabled) return;
    const num = Number(localInput);
    if (localInput.trim() === '' || Number.isNaN(num)) {
      setLocalInput(String(roundedVal));
    } else {
      const clamped = Math.min(100, Math.max(0, Math.round(num * 10) / 10));
      setLocalInput(String(clamped));
      onCommit(clamped);
    }
  };

  return (
    <div className="flex flex-col space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={id}
          className="text-[13px] text-[#111C2D] truncate font-normal"
          title={label}
        >
          {label}
        </label>
        <div className="flex items-center gap-1 shrink-0">
          <input
            id={id}
            type="number"
            min={0}
            max={100}
            step={5}
            disabled={disabled}
            value={localInput}
            onChange={handleChange}
            onBlur={handleBlur}
            className={`w-16 h-9 px-2 text-center bg-white border border-[#E2E6EF] rounded-lg text-[13px] font-medium text-[#111C2D] focus:outline-none focus:border-[#254B98] focus-visible:ring-1 focus-visible:ring-[#254B98] ${
              disabled ? 'cursor-not-allowed bg-gray-100 text-gray-500' : ''
            }`}
            aria-label={`${label} percentage`}
          />
          <span className="text-[12px] text-[#6B7A99] font-medium">%</span>
        </div>
      </div>
      {/* Thin blue progress bar showing share */}
      <div className="w-full h-1.5 bg-[#E2E6EF] rounded-full overflow-hidden">
        <div
          className="h-full bg-[#254B98] rounded-full transition-all duration-150"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  );
};

export const DestinationSplitControl: React.FC<DestinationSplitControlProps> = ({
  disabled = false,
}) => {
  const { state: storeState, updateSettings } = useTrafficStore();
  const { routeValidation } = useSimulation();

  const entrances = useMemo(
    () => (storeState.map.zoneMarkers || []).filter((m) => m.type === 'entrance'),
    [storeState.map.zoneMarkers]
  );

  const dropoffs = useMemo(
    () => (storeState.map.zoneMarkers || []).filter((m) => m.type === 'dropoff'),
    [storeState.map.zoneMarkers]
  );

  // Accordion open/close state: first entrance open by default
  const [openEntrances, setOpenEntrances] = useState<Record<string, boolean>>(() => {
    if (entrances.length > 0) {
      return { [entrances[0].id]: true };
    }
    return {};
  });

  // Ensure newly added entrances get closed by default and first remains open if none open
  useEffect(() => {
    if (entrances.length === 0) return;
    setOpenEntrances((prev) => {
      const hasAnyOpen = Object.keys(prev).some((k) => prev[k]);
      if (!hasAnyOpen) {
        return { [entrances[0].id]: true };
      }
      return prev;
    });
  }, [entrances]);

  const toggleAccordion = useCallback((entranceId: string) => {
    setOpenEntrances((prev) => ({
      ...prev,
      [entranceId]: !prev[entranceId],
    }));
  }, []);

  // Confirmation dialog for "Apply to all entrances"
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    sourceEntranceId: string;
    sourceEntranceName: string;
  } | null>(null);

  // Helper to format clean names
  const cleanName = (name: string) => name.replace(/\s*\(.*\)/, '').trim();

  // Helper for summary string (e.g. "D1 20 · D2 40 · D3 40 · Direct 0")
  const getSummaryString = (entranceId: string): string => {
    const split = getEntranceSplit(storeState.settings, storeState.map, entranceId);
    const parts: string[] = [];

    for (const d of dropoffs) {
      const name = cleanName(d.name);
      const match = name.match(/^drop-?off\s*(.*)$/i);
      const abbr = match ? `D${match[1] || ''}`.trim() : name;
      const val = Math.round(split[d.id] ?? 0);
      parts.push(`${abbr} ${val}`);
    }

    const directVal = Math.round(split[DIRECT_KEY] ?? 0);
    parts.push(`Direct ${directVal}`);

    return parts.join(' · ');
  };

  // Balance shares evenly across all drop-offs and Direct to exit
  const handleBalanceEvenly = (entranceId: string) => {
    if (disabled) return;
    const destKeys = [...dropoffs.map((d) => d.id), DIRECT_KEY];
    const totalCount = destKeys.length;
    if (totalCount === 0) return;

    const baseShare = Math.round((100 / totalCount) * 10) / 10;
    const newEntranceSplit: Record<string, number> = {};

    let accumulated = 0;
    for (let i = 0; i < totalCount; i++) {
      const key = destKeys[i];
      if (i === totalCount - 1) {
        // Remainder on the last row
        newEntranceSplit[key] = Math.round((100 - accumulated) * 10) / 10;
      } else {
        newEntranceSplit[key] = baseShare;
        accumulated += baseShare;
      }
    }

    const currentSplits = storeState.settings.destinationSplits || {};
    updateSettings({
      destinationSplits: {
        ...currentSplits,
        [entranceId]: newEntranceSplit,
      },
    });
  };

  // Apply this entrance's split to every other entrance
  const handleApplyToAllConfirm = () => {
    if (!confirmModal || disabled) return;
    const sourceSplit = {
      ...getEntranceSplit(storeState.settings, storeState.map, confirmModal.sourceEntranceId),
    };

    const newSplits: Record<string, Record<string, number>> = {};
    for (const ent of entrances) {
      newSplits[ent.id] = { ...sourceSplit };
    }

    updateSettings({
      destinationSplits: newSplits,
    });
    setConfirmModal(null);
  };

  // Update a single destination's share for an entrance
  const handleUpdateShare = (entranceId: string, destKey: string, newValue: number) => {
    if (disabled) return;
    const currentSplit = {
      ...getEntranceSplit(storeState.settings, storeState.map, entranceId),
    };
    currentSplit[destKey] = newValue;

    const currentSplits = storeState.settings.destinationSplits || {};
    updateSettings({
      destinationSplits: {
        ...currentSplits,
        [entranceId]: currentSplit,
      },
    });
  };

  // Unreachable destination warnings per entrance
  const getUnreachableNotices = (entranceId: string) => {
    const notices: string[] = [];
    if (!routeValidation || !routeValidation.entranceSummaries) return notices;

    const summary = routeValidation.entranceSummaries.find((s) => s.entranceId === entranceId);
    if (!summary || !summary.reachable) return notices;

    const split = getEntranceSplit(storeState.settings, storeState.map, entranceId);
    const { sticker, nonSticker } = summary.reachable;

    // Check drop-offs
    for (const d of dropoffs) {
      const share = split[d.id] ?? 0;
      if (share <= 0) continue;

      const dName = cleanName(d.name);
      const isReachableSticker = sticker.dropoffIds.includes(d.id);
      const isReachableNonSticker = nonSticker.dropoffIds.includes(d.id);

      if (!summary.stickerOnly && !isReachableNonSticker) {
        notices.push(
          `${dName} cannot be reached by non-sticker cars from this entrance. Their share goes to the other destinations.`
        );
      } else if (!summary.nonStickerOnly && !isReachableSticker) {
        notices.push(
          `${dName} cannot be reached by sticker cars from this entrance. Their share goes to the other destinations.`
        );
      }
    }

    // Check Direct to exit
    const directShare = split[DIRECT_KEY] ?? 0;
    if (directShare > 0) {
      if (!summary.stickerOnly && !nonSticker.direct) {
        notices.push(
          'Direct exit cannot be reached by non-sticker cars from this entrance. Their share goes to the other destinations.'
        );
      } else if (!summary.nonStickerOnly && !sticker.direct) {
        notices.push(
          'Direct exit cannot be reached by sticker cars from this entrance. Their share goes to the other destinations.'
        );
      }
    }

    return notices;
  };

  return (
    <div className="flex flex-col space-y-2">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <label className="text-[14px] font-medium text-[#111C2D]">
          Destination split
        </label>
        {disabled && (
          <Lock
            size={13}
            className="text-[#6B7A99]"
            aria-label="Locked while the simulation is running"
          />
        )}
      </div>

      {/* Muted Help Line */}
      <p className="text-[12px] text-[#6B7A99] leading-snug">
        Share of each entrance's vehicles that go to each drop-off or straight to an exit.
      </p>

      {/* Edge cases: No entrances or No drop-offs */}
      {entrances.length === 0 ? (
        <div className="p-3 bg-[#F5F6F8] border border-[#E2E6EF] rounded-lg text-[12px] text-[#6B7A99]">
          No entrance configured
        </div>
      ) : dropoffs.length === 0 ? (
        <div className="p-3 bg-[#F5F6F8] border border-[#E2E6EF] rounded-lg text-[12px] text-[#6B7A99] leading-relaxed">
          No drop-off zone placed. All vehicles go straight to an exit.
        </div>
      ) : (
        /* Accordion for each entrance */
        <div className="flex flex-col space-y-2 pt-1">
          {entrances.map((entrance) => {
            const isOpen = !!openEntrances[entrance.id];
            const split = getEntranceSplit(storeState.settings, storeState.map, entrance.id);
            const summaryText = getSummaryString(entrance.id);

            // Compute total percentage for this entrance
            let totalShare = 0;
            for (const d of dropoffs) {
              totalShare += split[d.id] ?? 0;
            }
            totalShare += split[DIRECT_KEY] ?? 0;
            const roundedTotal = Math.round(totalShare * 10) / 10;
            const isExactly100 = Math.abs(roundedTotal - 100) < 0.1;

            const notices = getUnreachableNotices(entrance.id);

            return (
              <div
                key={entrance.id}
                className="border border-[#E2E6EF] rounded-lg overflow-hidden bg-white shadow-xs"
              >
                {/* Accordion Header Button */}
                <button
                  type="button"
                  id={`dest-split-header-${entrance.id}`}
                  aria-expanded={isOpen}
                  aria-controls={`dest-split-panel-${entrance.id}`}
                  onClick={() => toggleAccordion(entrance.id)}
                  className="w-full min-h-[36px] py-2 px-3 bg-white hover:bg-[#F5F6F8] active:bg-[#E2E6EF]/50 flex items-center justify-between gap-2 text-left cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ChevronDown
                      size={15}
                      className={`text-[#6B7A99] shrink-0 transition-transform duration-200 motion-reduce:transition-none ${
                        isOpen ? 'rotate-180 text-[#254B98]' : ''
                      }`}
                    />
                    <span className="text-[13px] font-medium text-[#111C2D] truncate">
                      {cleanName(entrance.name)}
                    </span>
                  </div>

                  {/* Summary string on the right */}
                  <span
                    className="text-[12px] text-[#6B7A99] font-mono truncate max-w-[125px] shrink-0 text-right"
                    title={summaryText}
                  >
                    {summaryText}
                  </span>
                </button>

                {/* Collapsible Accordion Content */}
                <div
                  id={`dest-split-panel-${entrance.id}`}
                  role="region"
                  aria-labelledby={`dest-split-header-${entrance.id}`}
                  className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-in-out motion-reduce:transition-none ${
                    isOpen ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'
                  }`}
                >
                  <div className="p-3 bg-[#F5F6F8] border-t border-[#E2E6EF] flex flex-col space-y-3">
                    {/* Destination Rows */}
                    <div className="flex flex-col space-y-2.5">
                      {dropoffs.map((d) => (
                        <DestinationRow
                          key={d.id}
                          id={`dest-split-${entrance.id}-${d.id}`}
                          label={cleanName(d.name)}
                          value={split[d.id] ?? 0}
                          disabled={disabled}
                          onCommit={(newVal) => handleUpdateShare(entrance.id, d.id, newVal)}
                        />
                      ))}

                      {/* Last row: Direct to exit */}
                      <DestinationRow
                        id={`dest-split-${entrance.id}-direct`}
                        label="Direct to exit"
                        value={split[DIRECT_KEY] ?? 0}
                        disabled={disabled}
                        onCommit={(newVal) =>
                          handleUpdateShare(entrance.id, DIRECT_KEY, newVal)
                        }
                      />
                    </div>

                    {/* Total share indicator */}
                    <div className="flex flex-col space-y-0.5 pt-1 border-t border-[#E2E6EF]">
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] text-[#6B7A99]">Total</span>
                        <span
                          className={`text-[13px] font-medium tabular-nums ${
                            isExactly100 ? 'text-[#25A76B]' : 'text-[#D97706]'
                          }`}
                        >
                          Total {roundedTotal}%
                        </span>
                      </div>
                      <span className="text-[12px] text-[#6B7A99] leading-tight">
                        Shares are scaled to 100% when the run starts.
                      </span>
                    </div>

                    {/* Action buttons: Balance evenly & Apply to all entrances */}
                    <div className="flex flex-col gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleBalanceEvenly(entrance.id)}
                        disabled={disabled}
                        className={`w-full h-9 px-3 rounded-lg border border-[#E2E6EF] bg-white hover:bg-gray-50 active:bg-gray-100 text-[13px] font-medium text-[#111C2D] flex items-center justify-center gap-1.5 transition-all cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#254B98] ${
                          disabled ? 'opacity-50 cursor-not-allowed bg-gray-100' : ''
                        }`}
                      >
                        <Scale size={14} className="text-[#6B7A99]" />
                        <span>Balance evenly</span>
                      </button>

                      {entrances.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmModal({
                              open: true,
                              sourceEntranceId: entrance.id,
                              sourceEntranceName: cleanName(entrance.name),
                            })
                          }
                          disabled={disabled}
                          className={`w-full h-9 px-3 rounded-lg border border-[#E2E6EF] bg-white hover:bg-gray-50 active:bg-gray-100 text-[13px] font-medium text-[#111C2D] flex items-center justify-center gap-1.5 transition-all cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#254B98] ${
                            disabled ? 'opacity-50 cursor-not-allowed bg-gray-100' : ''
                          }`}
                        >
                          <Copy size={14} className="text-[#6B7A99]" />
                          <span>Apply to all entrances</span>
                        </button>
                      )}
                    </div>

                    {/* Unreachable destination notices */}
                    {notices.length > 0 && (
                      <div className="flex flex-col space-y-1.5 pt-1">
                        {notices.map((notice, nIdx) => (
                          <div
                            key={nIdx}
                            className="text-[12px] text-[#B45309] bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-start gap-1.5 leading-snug"
                          >
                            <AlertTriangle size={13} className="text-[#F59E0B] shrink-0 mt-0.5" />
                            <span>{notice}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation Modal for "Apply to all entrances" */}
      {confirmModal && confirmModal.open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-apply-title"
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-lg max-w-sm w-full p-5 shadow-xl border border-[#E2E6EF] flex flex-col gap-3">
            <div className="flex items-center gap-2 text-[#254B98] font-medium text-[15px]">
              <Copy size={18} />
              <span id="confirm-apply-title">Apply split to all entrances</span>
            </div>
            <p className="text-[13px] text-[#111C2D] leading-relaxed">
              Replace the split of the other entrances with this one?
            </p>
            <div className="flex items-center justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="h-9 px-4 rounded-lg border border-[#E2E6EF] text-[13px] font-medium text-gray-700 hover:bg-gray-50 cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyToAllConfirm}
                className="h-9 px-4 rounded-lg bg-[#254B98] hover:bg-[#1d3b7a] text-white text-[13px] font-medium cursor-pointer transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
