/**
 * FlowSmart - Simulation Settings Screen
 * Configures scenario presets, gate arrival rates, sticker/visitor mix,
 * per-entrance destination splits, run duration, and advanced options.
 */

import React, { useMemo, useRef, useState, useEffect } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Lock,
  Play,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useTrafficStore, DEFAULT_SETTINGS } from '../../context/TrafficStoreContext';
import { useSimulation } from '../../context/SimulationContext';
import {
  SCENARIOS,
  DURATION_OPTIONS_MIN,
  applyScenario,
  detectScenario,
} from '../../utils/scenarios';
import { getExpectation } from '../../utils/expectation';
import { DIRECT_KEY, getEntranceSplit } from '../../utils/destinationSplit';
import { SPEED_LIMIT_OPTIONS_KMH, clampSpeedKmH } from '../../utils/scale';
import { ScenarioId, SimulationSettings } from '../../types/traffic';
import { ExpectationModal, shouldSkipExpectationModal } from '../common/ExpectationModal';

const ZONE_COLORS = ['#254B98', '#F59E0B', '#25A76B', '#6366F1', '#0EA5E9'];
const DIRECT_COLOR = '#9AA6BF';

function cleanName(name: string): string {
  return name.replace(/\s*\(.*\)/, '').trim();
}

interface ClampedNumberFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  integer?: boolean;
  disabled?: boolean;
  tip?: string;
  onCommit: (value: number) => void;
}

const ClampedNumberField: React.FC<ClampedNumberFieldProps> = ({
  id,
  label,
  value,
  min,
  max,
  step,
  unit,
  integer = true,
  disabled = false,
  tip,
  onCommit,
}) => {
  const [local, setLocal] = useState<string>(String(value));

  const clampVal = (n: number) => {
    const clamped = Math.min(max, Math.max(min, n));
    return integer ? Math.round(clamped) : Math.round(clamped * 10) / 10;
  };

  useEffect(() => {
    setLocal((prev) => {
      const parsed = Number(prev);
      if (prev.trim() !== '' && !Number.isNaN(parsed) && clampVal(parsed) === value) {
        return prev;
      }
      return String(value);
    });
  }, [value, min, max, integer]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const raw = e.target.value;
    setLocal(raw);
    if (raw.trim() === '') return;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      onCommit(clampVal(parsed));
    }
  };

  const handleBlur = () => {
    if (disabled) return;
    const parsed = Number(local);
    if (local.trim() === '' || !Number.isFinite(parsed)) {
      setLocal(String(value));
    } else {
      const clamped = clampVal(parsed);
      setLocal(String(clamped));
      onCommit(clamped);
    }
  };

  return (
    <div className="flex flex-col">
      <label htmlFor={id} className="text-[13px] text-[#6B7A99] mb-1">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={local}
          onChange={handleChange}
          onBlur={handleBlur}
          className={`w-full h-10 px-3 pr-14 bg-white border border-[#E2E6EF] rounded-lg text-[14px] text-[#111C2D] tabular-nums focus:outline-none focus:border-[#254B98] focus-visible:ring-2 focus-visible:ring-[#254B98]/20 ${
            disabled ? 'bg-[#F5F6F8] text-[#6B7A99] cursor-not-allowed' : ''
          }`}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#6B7A99] pointer-events-none">
          {unit}
        </span>
      </div>
      {tip && <p className="text-[12px] text-[#6B7A99] mt-1 leading-snug">{tip}</p>}
    </div>
  );
};

interface SplitInputFieldProps {
  id: string;
  label: string;
  color: string;
  value: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}

const SplitInputField: React.FC<SplitInputFieldProps> = ({
  id,
  label,
  color,
  value,
  disabled = false,
  onCommit,
}) => {
  const roundedVal = Math.round(value * 10) / 10;
  const [local, setLocal] = useState<string>(String(roundedVal));

  useEffect(() => {
    setLocal(String(roundedVal));
  }, [roundedVal]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const raw = e.target.value;
    setLocal(raw);
    if (raw.trim() === '') return;
    const num = Number(raw);
    if (Number.isFinite(num)) {
      onCommit(Math.min(100, Math.max(0, Math.round(num))));
    }
  };

  const handleBlur = () => {
    if (disabled) return;
    const num = Number(local);
    if (local.trim() === '' || !Number.isFinite(num)) {
      setLocal(String(roundedVal));
    } else {
      const clamped = Math.min(100, Math.max(0, Math.round(num * 10) / 10));
      setLocal(String(clamped));
      onCommit(clamped);
    }
  };

  return (
    <div className="flex flex-col">
      <label
        htmlFor={id}
        className="text-[13px] text-[#6B7A99] mb-1 flex items-center gap-1.5 truncate"
        title={label}
      >
        <span
          className="w-2.5 h-2.5 rounded-[3px] shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="truncate">{label}</span>
      </label>
      <div className="relative">
        <input
          id={id}
          type="number"
          min={0}
          max={100}
          step={5}
          disabled={disabled}
          value={local}
          onChange={handleChange}
          onBlur={handleBlur}
          className={`w-full h-10 px-3 pr-8 bg-white border border-[#E2E6EF] rounded-lg text-[14px] text-[#111C2D] tabular-nums focus:outline-none focus:border-[#254B98] focus-visible:ring-2 focus-visible:ring-[#254B98]/20 ${
            disabled ? 'bg-[#F5F6F8] text-[#6B7A99] cursor-not-allowed' : ''
          }`}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#6B7A99] pointer-events-none">
          %
        </span>
      </div>
    </div>
  );
};

export const SettingsView: React.FC = () => {
  const { state, updateSettings, setActiveTab, resetAll } = useTrafficStore();
  const { status, startNewRun, stopSimulation, routeValidation } = useSimulation();

  const { map, settings } = state;
  const isLocked = status === 'running' || status === 'paused';

  const entrances = useMemo(
    () => (map.zoneMarkers || []).filter((m) => m.type === 'entrance'),
    [map.zoneMarkers]
  );
  const dropoffs = useMemo(
    () => (map.zoneMarkers || []).filter((m) => m.type === 'dropoff'),
    [map.zoneMarkers]
  );

  const [openEntrances, setOpenEntrances] = useState<Record<string, boolean>>({});
  const [advOpen, setAdvOpen] = useState<boolean>(false);
  const [showExpectationModal, setShowExpectationModal] = useState<boolean>(false);
  const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);
  const startButtonRef = useRef<HTMLButtonElement | null>(null);

  const activeScenarioId: ScenarioId =
    settings.scenarioId ?? detectScenario(settings, entrances);

  const activeScenarioName = useMemo(() => {
    if (activeScenarioId === 'custom') return 'Custom';
    return SCENARIOS.find((s) => s.id === activeScenarioId)?.name ?? 'Custom';
  }, [activeScenarioId]);

  const stickerPct = Math.min(100, Math.max(0, Math.round((settings.stickerShare ?? 0.7) * 100)));
  const visitorPct = 100 - stickerPct;

  // Reuse VehicleMixControl's single-class entrance notices from routeValidation
  const singleClassNotices = useMemo(() => {
    const notices: { id: string; message: string }[] = [];
    for (const summary of routeValidation.entranceSummaries || []) {
      if (summary.error) continue;
      const name = cleanName(summary.entranceName);
      if (summary.stickerOnly) {
        notices.push({
          id: summary.entranceId,
          message: `${name}: sticker holders only. The mix is not applied there.`,
        });
      } else if (summary.nonStickerOnly) {
        notices.push({
          id: summary.entranceId,
          message: `${name}: non-sticker only. The mix is not applied there.`,
        });
      }
    }
    return notices;
  }, [routeValidation.entranceSummaries]);

  // Reuse DestinationSplitControl's unreachable destination notices from routeValidation
  const getUnreachableNotices = (entranceId: string): string[] => {
    const notices: string[] = [];
    const summary = routeValidation.entranceSummaries?.find(
      (s) => s.entranceId === entranceId
    );
    if (!summary || !summary.reachable) return notices;

    const split = getEntranceSplit(settings, map, entranceId);
    const { sticker, nonSticker } = summary.reachable;

    for (const d of dropoffs) {
      if ((split[d.id] ?? 0) <= 0) continue;
      const dName = cleanName(d.name);
      if (!summary.stickerOnly && !nonSticker.dropoffIds.includes(d.id)) {
        notices.push(
          `${dName} cannot be reached by non-sticker cars from this entrance. Their share goes to the other destinations.`
        );
      } else if (!summary.nonStickerOnly && !sticker.dropoffIds.includes(d.id)) {
        notices.push(
          `${dName} cannot be reached by sticker cars from this entrance. Their share goes to the other destinations.`
        );
      }
    }

    if ((split[DIRECT_KEY] ?? 0) > 0) {
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

  const splitStatuses = useMemo(() => {
    return entrances.map((ent) => {
      const split = getEntranceSplit(settings, map, ent.id);
      let sum = split[DIRECT_KEY] ?? 0;
      for (const d of dropoffs) {
        sum += split[d.id] ?? 0;
      }
      const roundedSum = Math.round(sum * 10) / 10;
      const isOk = Math.abs(roundedSum - 100) < 0.1;
      return {
        entrance: ent,
        split,
        sum: roundedSum,
        isOk,
      };
    });
  }, [entrances, dropoffs, settings, map]);

  const allSplitsOk = splitStatuses.every((s) => s.isOk);
  const expectation = useMemo(() => getExpectation(settings, map), [settings, map]);
  const hasAnyCars = expectation.totalCarsPerMin > 0;
  const canStart = allSplitsOk && hasAnyCars && routeValidation.isValid && !isLocked;

  const routeErrors = useMemo(() => {
    if (routeValidation.isValid) return [];
    const errors: string[] = [];
    if (routeValidation.errorMessage) {
      errors.push(routeValidation.errorMessage);
    }
    for (const summary of routeValidation.entranceSummaries || []) {
      if (summary.error) {
        const msg = `${cleanName(summary.entranceName)}: ${summary.error}`;
        if (!errors.includes(summary.error) && !errors.includes(msg)) {
          errors.push(msg);
        }
      }
    }
    return errors;
  }, [routeValidation]);

  const handleSelectScenario = (scenarioId: ScenarioId) => {
    if (isLocked) return;
    if (scenarioId === 'custom') {
      updateSettings({ scenarioId: 'custom' });
      return;
    }
    const updated = applyScenario(settings, entrances, scenarioId);
    updateSettings({
      spawnRates: updated.spawnRates,
      stickerShare: updated.stickerShare,
      scenarioId: updated.scenarioId,
    });
  };

  const handleRateChange = (entranceId: string, rate: number) => {
    if (isLocked) return;
    updateSettings({
      spawnRates: {
        ...settings.spawnRates,
        [entranceId]: rate,
      },
    });
  };

  const handleSplitChange = (entranceId: string, destKey: string, value: number) => {
    if (isLocked) return;
    const currentSplit = { ...getEntranceSplit(settings, map, entranceId) };
    currentSplit[destKey] = value;
    updateSettings({
      destinationSplits: {
        ...(settings.destinationSplits || {}),
        [entranceId]: currentSplit,
      },
    });
  };

  const handleFixSplit = (entranceId: string) => {
    if (isLocked) return;
    const currentSplit = { ...getEntranceSplit(settings, map, entranceId) };
    const dropoffSum = dropoffs.reduce((acc, d) => acc + (currentSplit[d.id] ?? 0), 0);

    if (dropoffSum <= 100) {
      currentSplit[DIRECT_KEY] = Math.round((100 - dropoffSum) * 10) / 10;
    } else {
      const k = 100 / dropoffSum;
      let accumulated = 0;
      dropoffs.forEach((d, idx) => {
        if (idx === dropoffs.length - 1) {
          currentSplit[d.id] = Math.round((100 - accumulated) * 10) / 10;
        } else {
          const scaled = Math.round((currentSplit[d.id] ?? 0) * k);
          currentSplit[d.id] = scaled;
          accumulated += scaled;
        }
      });
      currentSplit[DIRECT_KEY] = 0;
    }

    updateSettings({
      destinationSplits: {
        ...(settings.destinationSplits || {}),
        [entranceId]: currentSplit,
      },
    });
  };

  const handleResetDefaults = () => {
    if (isLocked) return;
    const presetDefaults = applyScenario(DEFAULT_SETTINGS, entrances, 'normal');
    const resetSettings: Partial<SimulationSettings> = {
      ...DEFAULT_SETTINGS,
      spawnRates: entrances.length > 0 ? presetDefaults.spawnRates : { ...DEFAULT_SETTINGS.spawnRates },
      scenarioId: entrances.length > 0 ? 'normal' : DEFAULT_SETTINGS.scenarioId,
      metersPerUnit: settings.metersPerUnit,
      layoutName: map.layoutName || DEFAULT_SETTINGS.layoutName,
      destinationSplits: {},
    };
    updateSettings(resetSettings);
  };

  const handleStartClick = () => {
    if (!canStart) return;
    if (shouldSkipExpectationModal()) {
      startNewRun();
      setActiveTab('simulation');
    } else {
      setShowExpectationModal(true);
    }
  };

  const handleConfirmModalStart = () => {
    setShowExpectationModal(false);
    startNewRun();
    setActiveTab('simulation');
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#F5F6F8]">
      <div className="max-w-[1160px] mx-auto px-6 py-7 pb-16">
        <div className="mb-5">
          <h1 className="text-[24px] font-semibold text-[#111C2D] tracking-tight">
            Set up your simulation
          </h1>
          <p className="text-[14px] text-[#6B7A99] mt-0.5">
            Pick a scenario, change what you need, then press Start. Everything else already has a sensible default.
          </p>
        </div>

        {isLocked && (
          <div className="mb-5 px-4 py-3 rounded-[12px] bg-[#FFFBEB] border border-[#F59E0B]/40 text-[#111C2D] flex items-center gap-2.5 text-[13px]">
            <Lock size={16} className="text-[#F59E0B] shrink-0" />
            <span>
              {status === 'running'
                ? 'Simulation is running. Settings are read-only until you stop the run.'
                : 'Simulation is paused. Settings are read-only until you stop the run.'}
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
          {/* Left column of cards */}
          <div className="space-y-4">
            {/* 1. Start from a scenario */}
            <section className="bg-white border border-[#E2E6EF] rounded-[12px] p-5">
              <h2 className="text-[17px] font-semibold text-[#111C2D]">
                1. Start from a scenario
              </h2>
              <p className="text-[14px] text-[#6B7A99] mt-0.5 mb-4">
                A quick way to fill in the numbers below. You can still adjust them afterwards.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {SCENARIOS.map((sc) => {
                  const selected = activeScenarioId === sc.id;
                  return (
                    <button
                      key={sc.id}
                      type="button"
                      disabled={isLocked}
                      aria-pressed={selected}
                      onClick={() => handleSelectScenario(sc.id)}
                      className={`min-h-[62px] p-3 rounded-[10px] border text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] ${
                        selected
                          ? 'border-[#254B98] bg-[#E7EEFF]'
                          : 'border-[#E2E6EF] bg-white hover:bg-[#F5F6F8]'
                      } ${isLocked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <span className="block font-semibold text-[14px] text-[#111C2D]">
                        {sc.name}
                      </span>
                      <span className="block text-[13px] text-[#6B7A99]">{sc.note}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  disabled={isLocked}
                  aria-pressed={activeScenarioId === 'custom'}
                  onClick={() => handleSelectScenario('custom')}
                  className={`min-h-[62px] p-3 rounded-[10px] border text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] ${
                    activeScenarioId === 'custom'
                      ? 'border-[#254B98] bg-[#E7EEFF]'
                      : 'border-[#E2E6EF] bg-white hover:bg-[#F5F6F8]'
                  } ${isLocked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <span className="block font-semibold text-[14px] text-[#111C2D]">Custom</span>
                  <span className="block text-[13px] text-[#6B7A99]">Your own mix</span>
                </button>
              </div>
            </section>

            {/* 2. Who is arriving? */}
            <section className="bg-white border border-[#E2E6EF] rounded-[12px] p-5">
              <h2 className="text-[17px] font-semibold text-[#111C2D]">2. Who is arriving?</h2>
              <p className="text-[14px] text-[#6B7A99] mt-0.5 mb-4">
                How busy each gate is, and how many drivers hold a school sticker.
              </p>

              {entrances.length === 0 ? (
                <div className="p-3 rounded-lg bg-[#F5F6F8] border border-[#E2E6EF] text-[13px] text-[#6B7A99] mb-4">
                  No entrances on this map yet. Add an entrance in Map setup.
                </div>
              ) : (
                <div className="divide-y divide-[#E2E6EF]">
                  {entrances.map((ent, idx) => {
                    const rate = settings.spawnRates?.[ent.id] ?? 0;
                    const sliderId = `gate-rate-${ent.id}`;
                    return (
                      <div key={ent.id} className={idx === 0 ? 'pb-3.5' : 'py-3.5'}>
                        <div className="flex items-baseline justify-between gap-3 mb-2">
                          <label htmlFor={sliderId} className="font-medium text-[15px] text-[#111C2D]">
                            {cleanName(ent.name)}
                          </label>
                          <span className="font-semibold text-[14px] text-[#254B98] tabular-nums">
                            {rate} {rate === 1 ? 'car/min' : 'cars/min'}
                          </span>
                        </div>
                        <input
                          id={sliderId}
                          type="range"
                          min={0}
                          max={20}
                          step={1}
                          disabled={isLocked}
                          value={Math.min(20, Math.max(0, rate))}
                          onChange={(e) => handleRateChange(ent.id, Number(e.target.value))}
                          className="w-full h-9 accent-[#254B98] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                        />
                        <p className="text-[13px] text-[#6B7A99] mt-1">
                          {rate <= 0
                            ? 'Gate closed, no cars will arrive here.'
                            : `About 1 car every ${Math.round(60 / rate)} seconds`}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Sticker holders vs visitors */}
              <div className="pt-3.5 border-t border-[#E2E6EF]">
                <div className="flex items-baseline justify-between gap-3 mb-2">
                  <label htmlFor="sticker-share-slider" className="font-medium text-[15px] text-[#111C2D]">
                    Sticker holders vs visitors
                  </label>
                  <span className="font-semibold text-[14px] text-[#254B98] tabular-nums">
                    {stickerPct}% sticker · {visitorPct}% visitors
                  </span>
                </div>
                <input
                  id="sticker-share-slider"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  disabled={isLocked}
                  value={stickerPct}
                  onChange={(e) => updateSettings({ stickerShare: Number(e.target.value) / 100 })}
                  className="w-full h-9 accent-[#254B98] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                />
                <div
                  className="flex h-3 rounded-full overflow-hidden bg-[#E2E6EF] mt-1.5"
                  aria-hidden="true"
                >
                  <div
                    style={{ width: `${stickerPct}%` }}
                    className="h-full bg-[#254B98] transition-all duration-150"
                  />
                  <div
                    style={{ width: `${visitorPct}%` }}
                    className="h-full bg-[#38BDF8] transition-all duration-150"
                  />
                </div>
                <div className="flex flex-wrap gap-4 text-[13px] text-[#6B7A99] mt-2">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-[3px] bg-[#254B98]" />
                    Sticker holders
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-[3px] bg-[#38BDF8]" />
                    Visitors
                  </span>
                </div>
                <p className="text-[13px] text-[#6B7A99] mt-1.5">
                  Sticker holders may use sticker-only roads. Visitors may not.
                </p>

                {singleClassNotices.length > 0 && (
                  <div className="flex flex-col gap-1.5 mt-3">
                    {singleClassNotices.map((notice) => (
                      <div
                        key={notice.id}
                        className="text-[12px] text-[#B45309] bg-[#FFFBEB] border border-[#F59E0B]/40 rounded-lg px-3 py-2 flex items-start gap-2 leading-snug"
                      >
                        <AlertTriangle size={14} className="text-[#F59E0B] shrink-0 mt-0.5" />
                        <span>{notice.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* 3. Where do they go? */}
            <section className="bg-white border border-[#E2E6EF] rounded-[12px] p-5">
              <h2 className="text-[17px] font-semibold text-[#111C2D]">3. Where do they go?</h2>
              <p className="text-[14px] text-[#6B7A99] mt-0.5 mb-4">
                For each gate, choose how many cars use each drop-off zone and how many drive straight out. Open a gate to change it.
              </p>

              {entrances.length === 0 ? (
                <div className="p-3 rounded-lg bg-[#F5F6F8] border border-[#E2E6EF] text-[13px] text-[#6B7A99]">
                  No entrances configured on this map.
                </div>
              ) : dropoffs.length === 0 ? (
                <div className="p-3 rounded-lg bg-[#F5F6F8] border border-[#E2E6EF] text-[13px] text-[#6B7A99]">
                  No drop-off zones on this map. All cars drive straight to an exit.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {splitStatuses.map(({ entrance, split, sum, isOk }) => {
                    const isOpen = !!openEntrances[entrance.id];
                    const headerValues = [
                      ...dropoffs.map((d) => Math.round(split[d.id] ?? 0)),
                      Math.round(split[DIRECT_KEY] ?? 0),
                    ].join(' / ');
                    const barTotal = Math.max(100, sum);
                    const unreachableNotices = getUnreachableNotices(entrance.id);

                    return (
                      <div
                        key={entrance.id}
                        className="border border-[#E2E6EF] rounded-[10px] bg-white overflow-hidden"
                      >
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() =>
                            setOpenEntrances((prev) => ({
                              ...prev,
                              [entrance.id]: !prev[entrance.id],
                            }))
                          }
                          className="w-full min-h-[46px] px-3.5 py-2.5 flex items-center gap-3 text-left hover:bg-[#F5F6F8] cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] focus-visible:ring-inset"
                        >
                          <span className="font-medium text-[14px] text-[#111C2D] min-w-[68px] truncate">
                            {cleanName(entrance.name)}
                          </span>

                          <span
                            className="flex-1 min-w-[72px] flex h-2 rounded-full overflow-hidden bg-[#E2E6EF]"
                            aria-hidden="true"
                          >
                            {dropoffs.map((d, dIdx) => (
                              <span
                                key={d.id}
                                style={{
                                  width: `${((split[d.id] ?? 0) / barTotal) * 100}%`,
                                  backgroundColor: ZONE_COLORS[dIdx % ZONE_COLORS.length],
                                }}
                                className="h-full block"
                              />
                            ))}
                            <span
                              style={{
                                width: `${((split[DIRECT_KEY] ?? 0) / barTotal) * 100}%`,
                                backgroundColor: DIRECT_COLOR,
                              }}
                              className="h-full block"
                            />
                          </span>

                          <span
                            className={`text-[14px] font-semibold tabular-nums text-right min-w-[88px] ${
                              isOk ? 'text-[#254B98]' : 'text-[#EF4444]'
                            }`}
                          >
                            {headerValues}
                          </span>

                          <ChevronDown
                            size={18}
                            className={`text-[#6B7A99] shrink-0 transition-transform duration-150 ${
                              isOpen ? 'rotate-180' : ''
                            }`}
                          />
                        </button>

                        {isOpen && (
                          <div className="px-3.5 pb-4 pt-3 border-t border-[#E2E6EF] bg-white">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              {dropoffs.map((d, dIdx) => (
                                <SplitInputField
                                  key={d.id}
                                  id={`split-${entrance.id}-${d.id}`}
                                  label={cleanName(d.name)}
                                  color={ZONE_COLORS[dIdx % ZONE_COLORS.length]}
                                  value={split[d.id] ?? 0}
                                  disabled={isLocked}
                                  onCommit={(v) => handleSplitChange(entrance.id, d.id, v)}
                                />
                              ))}
                              <SplitInputField
                                id={`split-${entrance.id}-direct`}
                                label="Straight to exit"
                                color={DIRECT_COLOR}
                                value={split[DIRECT_KEY] ?? 0}
                                disabled={isLocked}
                                onCommit={(v) => handleSplitChange(entrance.id, DIRECT_KEY, v)}
                              />
                            </div>

                            <div
                              className={`flex items-center gap-2 text-[13px] mt-3 ${
                                isOk ? 'text-[#25A76B]' : 'text-[#EF4444]'
                              }`}
                            >
                              {isOk ? (
                                <Check size={16} className="shrink-0" />
                              ) : (
                                <AlertTriangle size={16} className="shrink-0" />
                              )}
                              <span>
                                {isOk
                                  ? 'Adds up to 100%'
                                  : `Adds up to ${sum}%. It needs to be exactly 100%.`}
                              </span>
                            </div>

                            {!isOk && (
                              <button
                                type="button"
                                disabled={isLocked}
                                onClick={() => handleFixSplit(entrance.id)}
                                className="mt-2 h-9 px-2 text-[13px] font-medium text-[#254B98] hover:bg-[#E7EEFF] rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                Fix: make it add up to 100%
                              </button>
                            )}

                            {unreachableNotices.length > 0 && (
                              <div className="flex flex-col gap-1.5 mt-3">
                                {unreachableNotices.map((msg, idx) => (
                                  <div
                                    key={idx}
                                    className="text-[12px] text-[#B45309] bg-[#FFFBEB] border border-[#F59E0B]/40 rounded-lg px-3 py-2 flex items-start gap-2 leading-snug"
                                  >
                                    <AlertTriangle size={14} className="text-[#F59E0B] shrink-0 mt-0.5" />
                                    <span>{msg}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 4. How long should it run? */}
            <section className="bg-white border border-[#E2E6EF] rounded-[12px] p-5">
              <h2 className="text-[17px] font-semibold text-[#111C2D]">
                4. How long should it run?
              </h2>
              <p className="text-[14px] text-[#6B7A99] mt-0.5 mb-4">
                Simulated time, not real time.
              </p>

              <div
                className="inline-flex border border-[#E2E6EF] rounded-[10px] overflow-hidden"
                role="group"
                aria-label="Run length"
              >
                {DURATION_OPTIONS_MIN.map((minutes, idx) => {
                  const selected = settings.simDurationMin === minutes;
                  return (
                    <button
                      key={minutes}
                      type="button"
                      disabled={isLocked}
                      aria-pressed={selected}
                      onClick={() => updateSettings({ simDurationMin: minutes })}
                      className={`h-10 px-4 text-[14px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] focus-visible:ring-inset ${
                        idx < DURATION_OPTIONS_MIN.length - 1 ? 'border-r border-[#E2E6EF]' : ''
                      } ${
                        selected
                          ? 'bg-[#254B98] text-white'
                          : 'bg-white text-[#111C2D] hover:bg-[#F5F6F8]'
                      } ${isLocked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      {minutes} min
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 5. Advanced options (collapsed) */}
            <section className="bg-white border border-[#E2E6EF] rounded-[12px] p-5">
              <div className="border border-[#E2E6EF] rounded-[10px] overflow-hidden bg-white">
                <button
                  type="button"
                  aria-expanded={advOpen}
                  onClick={() => setAdvOpen((v) => !v)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 flex items-center gap-3 text-left font-medium text-[15px] text-[#111C2D] hover:bg-[#F5F6F8] cursor-pointer transition-colors"
                >
                  <SlidersHorizontal size={18} className="text-[#111C2D] shrink-0" />
                  <span className="flex-1">
                    Advanced options{' '}
                    <span className="text-[#6B7A99] font-normal text-[14px]">
                      (most people can skip these)
                    </span>
                  </span>
                  <ChevronDown
                    size={18}
                    className={`text-[#6B7A99] shrink-0 transition-transform duration-150 ${
                      advOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {advOpen && (
                  <div className="px-4 pb-5 pt-3 border-t border-[#E2E6EF] space-y-5">
                    {/* Drop-off behaviour */}
                    <div>
                      <h3 className="text-[14px] font-semibold text-[#111C2D]">
                        Drop-off behaviour
                      </h3>
                      <p className="text-[13px] text-[#6B7A99] mb-3">
                        What cars do when the drop-off zone is full.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <ClampedNumberField
                          id="adv-patience"
                          label="Wait before giving up"
                          value={settings.dropoffPatienceSec ?? DEFAULT_SETTINGS.dropoffPatienceSec!}
                          min={5}
                          max={300}
                          step={5}
                          unit="s"
                          disabled={isLocked}
                          tip="A car that has waited this long drops off where it is."
                          onCommit={(v) => updateSettings({ dropoffPatienceSec: v })}
                        />
                        <ClampedNumberField
                          id="adv-spread"
                          label="Extra random patience"
                          value={
                            settings.dropoffPatienceSpreadSec ??
                            DEFAULT_SETTINGS.dropoffPatienceSpreadSec!
                          }
                          min={0}
                          max={120}
                          step={5}
                          unit="s"
                          disabled={isLocked}
                          tip="Adds 0 to this many seconds so cars are not identical."
                          onCommit={(v) => updateSettings({ dropoffPatienceSpreadSec: v })}
                        />
                        <ClampedNumberField
                          id="adv-dwell-min"
                          label="Fastest drop-off"
                          value={settings.dropoffDwellMinSec ?? DEFAULT_SETTINGS.dropoffDwellMinSec!}
                          min={5}
                          max={300}
                          step={5}
                          unit="s"
                          disabled={isLocked}
                          tip="Shortest time a car stays to let passengers out."
                          onCommit={(v) => updateSettings({ dropoffDwellMinSec: v })}
                        />
                        <ClampedNumberField
                          id="adv-dwell-max"
                          label="Slowest drop-off"
                          value={settings.dropoffDwellMaxSec ?? DEFAULT_SETTINGS.dropoffDwellMaxSec!}
                          min={5}
                          max={300}
                          step={5}
                          unit="s"
                          disabled={isLocked}
                          tip="Longest time a car stays to let passengers out."
                          onCommit={(v) => updateSettings({ dropoffDwellMaxSec: v })}
                        />
                      </div>
                    </div>

                    {/* Roads and vehicles */}
                    <div className="pt-4 border-t border-[#E2E6EF]">
                      <h3 className="text-[14px] font-semibold text-[#111C2D]">
                        Roads and vehicles
                      </h3>
                      <p className="text-[13px] text-[#6B7A99] mb-3">
                        Applies to every road unless a road has its own limit.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="flex flex-col">
                          <label htmlFor="adv-speed" className="text-[13px] text-[#6B7A99] mb-1">
                            Speed limit
                          </label>
                          <select
                            id="adv-speed"
                            disabled={isLocked}
                            value={clampSpeedKmH(settings.defaultSpeedLimit)}
                            onChange={(e) =>
                              updateSettings({
                                defaultSpeedLimit: clampSpeedKmH(Number(e.target.value)),
                              })
                            }
                            className={`w-full h-10 px-3 bg-white border border-[#E2E6EF] rounded-lg text-[14px] text-[#111C2D] focus:outline-none focus:border-[#254B98] ${
                              isLocked
                                ? 'bg-[#F5F6F8] text-[#6B7A99] cursor-not-allowed'
                                : 'cursor-pointer'
                            }`}
                          >
                            {SPEED_LIMIT_OPTIONS_KMH.map((spd) => (
                              <option key={spd} value={spd}>
                                {spd} km/h
                              </option>
                            ))}
                          </select>
                        </div>
                        <ClampedNumberField
                          id="adv-car-len"
                          label="Car length"
                          value={settings.vehicleLengthMeters ?? 4.5}
                          min={1}
                          max={20}
                          step={0.1}
                          unit="m"
                          integer={false}
                          disabled={isLocked}
                          onCommit={(v) => updateSettings({ vehicleLengthMeters: v })}
                        />
                        <ClampedNumberField
                          id="adv-car-gap"
                          label="Gap between stopped cars"
                          value={settings.standstillGapMeters ?? 2.0}
                          min={0.5}
                          max={10}
                          step={0.1}
                          unit="m"
                          integer={false}
                          disabled={isLocked}
                          onCommit={(v) => updateSettings({ standstillGapMeters: v })}
                        />
                      </div>
                    </div>

                    {/* Warnings */}
                    <div className="pt-4 border-t border-[#E2E6EF]">
                      <h3 className="text-[14px] font-semibold text-[#111C2D]">Warnings</h3>
                      <p className="text-[13px] text-[#6B7A99] mb-3">
                        When the simulation should flag a problem while it runs.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <ClampedNumberField
                          id="adv-warn-wait"
                          label="Warn when a car has waited more than"
                          value={settings.alertWaitThresholdSec ?? 120}
                          min={10}
                          max={600}
                          step={5}
                          unit="s"
                          disabled={isLocked}
                          onCommit={(v) => updateSettings({ alertWaitThresholdSec: v })}
                        />
                        <ClampedNumberField
                          id="adv-warn-full"
                          label="Warn when a road is more than"
                          value={settings.alertUtilThresholdPct ?? 80}
                          min={50}
                          max={100}
                          step={5}
                          unit="% full"
                          disabled={isLocked}
                          onCommit={(v) => updateSettings({ alertUtilThresholdPct: v })}
                        />
                        <ClampedNumberField
                          id="adv-warn-for"
                          label="…for at least"
                          value={settings.alertUtilDurationSec ?? 30}
                          min={5}
                          max={180}
                          step={5}
                          unit="s"
                          disabled={isLocked}
                          onCommit={(v) => updateSettings({ alertUtilDurationSec: v })}
                        />
                        <ClampedNumberField
                          id="adv-warn-clear"
                          label="Clear the warning once below"
                          value={settings.alertReturnUtilPct ?? 60}
                          min={20}
                          max={80}
                          step={5}
                          unit="% full"
                          disabled={isLocked}
                          onCommit={(v) => updateSettings({ alertReturnUtilPct: v })}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Sticky right summary card */}
          <aside className="lg:sticky lg:top-6">
            <div className="bg-white border border-[#E2E6EF] rounded-[12px] p-5">
              <div className="text-[14px] text-[#6B7A99]">Your scenario</div>
              <div className="text-[32px] font-bold text-[#111C2D] leading-tight mt-0.5 tabular-nums">
                {expectation.totalCarsPerMin}{' '}
                <small className="text-[15px] font-medium text-[#6B7A99]">cars per minute</small>
              </div>

              <div className="mt-4 divide-y divide-[#E2E6EF] border-t border-[#E2E6EF] text-[14px]">
                <div className="flex justify-between py-2.5">
                  <span className="text-[#6B7A99]">Expected cars</span>
                  <span className="font-semibold text-[#111C2D] tabular-nums">
                    ≈ {expectation.expectedCars.toLocaleString()} cars
                  </span>
                </div>
                <div className="flex justify-between py-2.5">
                  <span className="text-[#6B7A99]">Run length</span>
                  <span className="font-semibold text-[#111C2D] tabular-nums">
                    {settings.simDurationMin} minutes
                  </span>
                </div>
                <div className="flex justify-between py-2.5">
                  <span className="text-[#6B7A99]">Sticker holders</span>
                  <span className="font-semibold text-[#111C2D] tabular-nums">{stickerPct}%</span>
                </div>
              </div>

              {/* Live checks */}
              <div className="my-4 space-y-2 text-[14px]">
                <div className="flex items-start gap-2">
                  {allSplitsOk ? (
                    <Check size={17} className="text-[#25A76B] shrink-0 mt-0.5" />
                  ) : (
                    <X size={17} className="text-[#EF4444] shrink-0 mt-0.5" />
                  )}
                  <span className="text-[#111C2D]">
                    {allSplitsOk
                      ? 'Every gate sends 100% of its cars somewhere'
                      : "A gate's destinations do not add up to 100%"}
                  </span>
                </div>

                <div className="flex items-start gap-2">
                  {hasAnyCars ? (
                    <Check size={17} className="text-[#25A76B] shrink-0 mt-0.5" />
                  ) : (
                    <X size={17} className="text-[#EF4444] shrink-0 mt-0.5" />
                  )}
                  <span className="text-[#111C2D]">
                    {hasAnyCars
                      ? 'Cars will arrive'
                      : 'No cars will arrive. Raise a gate above 0.'}
                  </span>
                </div>

                {routeErrors.map((err, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <X size={17} className="text-[#EF4444] shrink-0 mt-0.5" />
                    <span className="text-[#EF4444] text-[13px] leading-snug">{err}</span>
                  </div>
                ))}
              </div>

              <button
                ref={startButtonRef}
                type="button"
                disabled={!canStart}
                onClick={handleStartClick}
                className={`w-full h-11 px-4 rounded-[10px] text-[15px] font-semibold flex items-center justify-center gap-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] focus-visible:ring-offset-2 ${
                  canStart
                    ? 'bg-[#25A76B] hover:bg-[#1f8c59] text-white cursor-pointer'
                    : 'bg-[#E2E6EF] text-[#6B7A99] cursor-not-allowed'
                }`}
              >
                <Play size={16} className="fill-current shrink-0" />
                <span>Start simulation</span>
              </button>

              <div className="text-center mt-2.5">
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={handleResetDefaults}
                  className="h-9 px-3 rounded-lg text-[13px] font-medium text-[#254B98] hover:bg-[#E7EEFF] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Reset to defaults
                </button>
              </div>
            </div>
          </aside>
        </div>

        {/* Bottom small link: Reset all data */}
        <div className="mt-10 pt-4 border-t border-[#E2E6EF] flex items-center justify-between">
          <button
            type="button"
            disabled={isLocked}
            onClick={() => setShowResetConfirm(true)}
            className="min-h-[36px] px-1 text-[13px] text-[#6B7A99] hover:text-[#EF4444] underline underline-offset-2 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Reset all data
          </button>
        </div>
      </div>

      {/* Pre-run Expectation Modal */}
      <ExpectationModal
        open={showExpectationModal}
        scenarioName={activeScenarioName}
        simDurationMin={settings.simDurationMin}
        stickerShare={settings.stickerShare ?? 0.7}
        expectation={expectation}
        returnFocusRef={startButtonRef}
        onCancel={() => setShowExpectationModal(false)}
        onConfirmStart={handleConfirmModalStart}
      />

      {/* Reset All Data Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-all-modal-title"
            className="bg-white rounded-[12px] max-w-sm w-full p-5 shadow-xl border border-[#E2E6EF] flex flex-col gap-3"
          >
            <div className="flex items-center gap-2 text-[#EF4444] font-semibold text-[15px]">
              <AlertTriangle size={18} />
              <span id="reset-all-modal-title">Confirm data reset</span>
            </div>
            <p className="text-[13px] text-[#6B7A99] leading-relaxed">
              This erases the map, all settings and the whole run history. Use New layout in Map setup if you only want a fresh map.
            </p>
            <div className="flex items-center justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="h-9 px-4 rounded-lg border border-[#E2E6EF] text-[13px] font-medium text-[#111C2D] hover:bg-[#F5F6F8] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  stopSimulation();
                  resetAll();
                  setShowResetConfirm(false);
                }}
                className="h-9 px-4 rounded-lg bg-[#EF4444] hover:bg-[#dc2626] text-white text-[13px] font-medium cursor-pointer"
              >
                Reset all
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
