/**
 * FlowSmart - Floating Top-Right Telemetry Card
 * 290px wide, scrolls if tall.
 * Displays:
 * 1. Status header (Ready / Running / Paused / Gridlocked / Finished), simulated clock, thin progress bar
 * 2. Four live metrics in plain language ("--" before a run)
 * 3. One alert at a time (gridlock first, then edge case, then newest alert)
 * 4. Collapsible "Road usage" top-5 utilization bars
 */

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Info,
} from 'lucide-react';
import { useTrafficStore } from '../../context/TrafficStoreContext';
import { useSimulation } from '../../context/SimulationContext';
import {
  getArrivalsPerHour,
  getSegmentUsageStatus,
  getThroughputStatus,
  getTripTimeStatus,
  getWaitStatus,
} from '../../utils/status';

interface RightPanelProps {
  showHeatmap?: boolean;
  onToggleHeatmap?: (show: boolean) => void;
}

function formatClockMMSS(seconds: number): string {
  const totalSec = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const RightPanel: React.FC<RightPanelProps> = () => {
  const { setActiveTab, state: storeState } = useTrafficStore();
  const {
    status,
    simTimeSeconds,
    liveMetrics,
    segmentOccupancies,
    activeAlerts,
    isGridlocked,
    gridlockMessage,
    activeEdgeCase,
    lastResult,
  } = useSimulation();

  const [roadUsageOpen, setRoadUsageOpen] = useState<boolean>(true);

  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isComplete = status === 'completed';
  const isIdle = status === 'idle';

  const durationMin = storeState.settings.simDurationMin || 30;
  const totalDurationSec = durationMin * 60;
  const elapsedSec = isIdle
    ? 0
    : Math.min(totalDurationSec, Math.max(0, simTimeSeconds));
  const progressPct =
    totalDurationSec > 0
      ? Math.min(100, Math.max(0, (elapsedSec / totalDurationSec) * 100))
      : 0;

  const statusMeta = useMemo(() => {
    if (isGridlocked && !isIdle) {
      return {
        label: 'Gridlocked',
        pillClass: 'bg-[#EF4444]/10 text-[#EF4444]',
        dotClass: 'bg-[#EF4444] animate-pulse',
        barClass: 'bg-[#EF4444]',
      };
    }
    if (isRunning) {
      return {
        label: 'Running',
        pillClass: 'bg-[#25A76B]/10 text-[#25A76B]',
        dotClass: 'bg-[#25A76B] animate-pulse',
        barClass: 'bg-[#25A76B]',
      };
    }
    if (isPaused) {
      return {
        label: 'Paused',
        pillClass: 'bg-[#F59E0B]/15 text-[#B45309]',
        dotClass: 'bg-[#F59E0B]',
        barClass: 'bg-[#F59E0B]',
      };
    }
    if (isComplete) {
      return {
        label: 'Finished',
        pillClass: 'bg-[#E7EEFF] text-[#254B98]',
        dotClass: 'bg-[#254B98]',
        barClass: 'bg-[#254B98]',
      };
    }
    return {
      label: 'Ready',
      pillClass: 'bg-[#F5F6F8] text-[#6B7A99]',
      dotClass: 'bg-[#6B7A99]',
      barClass: 'bg-[#254B98]',
    };
  }, [isGridlocked, isIdle, isRunning, isPaused, isComplete]);

  // Single alert at a time: gridlock first, then edge case, then newest alert
  const singleAlert = useMemo(() => {
    if (isGridlocked && !isIdle) {
      return {
        tone: 'critical' as const,
        title: 'Traffic is gridlocked',
        message:
          gridlockMessage || 'Zero vehicle movement for over 120 simulated seconds.',
        showEditMap: false,
      };
    }

    if (activeEdgeCase && !isIdle) {
      const isAmber =
        activeEdgeCase.type === 'zero-spawn-rate' ||
        activeEdgeCase.type === 'all-sticker-only' ||
        activeEdgeCase.type === 'all-non-sticker-only';
      const needsMapFix =
        activeEdgeCase.type === 'zero-roads' ||
        activeEdgeCase.type === 'no-entrance' ||
        activeEdgeCase.type === 'no-exit' ||
        activeEdgeCase.type === 'no-drop-off' ||
        activeEdgeCase.type === 'no-valid-path' ||
        activeEdgeCase.type === 'all-exits-blocked';

      const titles: Record<string, string> = {
        'zero-roads': 'No roads drawn',
        'no-entrance': 'No entrance gate',
        'no-exit': 'No exit gate',
        'no-drop-off': 'No drop-off zone',
        'no-valid-path': 'No connected route',
        'all-exits-blocked': 'All exits blocked',
        'zero-spawn-rate': 'No arriving cars',
        'all-sticker-only': 'Sticker holders only',
        'all-non-sticker-only': 'Visitors only',
      };

      return {
        tone: isAmber ? ('warn' as const) : ('critical' as const),
        title: titles[activeEdgeCase.type] || 'Notice',
        message: activeEdgeCase.message,
        showEditMap: needsMapFix,
      };
    }

    if (activeAlerts.length > 0 && !isIdle) {
      const criticalAlerts = activeAlerts.filter((a) => a.type === 'critical');
      const picked =
        criticalAlerts.length > 0
          ? criticalAlerts[criticalAlerts.length - 1]
          : activeAlerts[activeAlerts.length - 1];
      return {
        tone: picked.type === 'critical' ? ('critical' as const) : ('info' as const),
        title: picked.title,
        message: picked.message,
        showEditMap: false,
      };
    }

    return null;
  }, [isGridlocked, isIdle, gridlockMessage, activeEdgeCase, activeAlerts]);

  // Top 5 segments sorted by current utilization
  const displaySegments = useMemo(() => {
    const segments = storeState.map.roadSegments;
    if (segments.length === 0) return [];
    return [...segments]
      .sort((a, b) => {
        const occA = segmentOccupancies[a.id]?.utilizationPct || 0;
        const occB = segmentOccupancies[b.id]?.utilizationPct || 0;
        return occB - occA;
      })
      .slice(0, 5);
  }, [storeState.map.roadSegments, segmentOccupancies]);

  const throughputVal =
    isComplete && lastResult ? lastResult.totalThroughputVehHr : liveMetrics.throughputVehHr;
  const waitVal = isComplete && lastResult ? lastResult.avgWaitTimeSec : liveMetrics.avgWaitTimeSec;
  const tripVal =
    isComplete && lastResult ? lastResult.avgTransitTimeSec : liveMetrics.avgTransitTimeSec;

  const arrivalsPerHr = getArrivalsPerHour(
    storeState.settings.spawnRates,
    isComplete && lastResult
      ? (lastResult.spawnedSticker ?? 0) + (lastResult.spawnedNonSticker ?? 0)
      : undefined,
    durationMin
  );

  const throughputStatus = isIdle ? null : getThroughputStatus(throughputVal, arrivalsPerHr);
  const waitStatus = isIdle ? null : getWaitStatus(waitVal);
  const tripStatus = isIdle ? null : getTripTimeStatus(tripVal);

  const carsOnCampus = isIdle ? '--' : liveMetrics.activeVehicles.toLocaleString();
  const carsExitingPerHr = isIdle ? '--' : `${throughputVal.toLocaleString()} /hr`;
  const avgWaitSec = isIdle ? '--' : `${waitVal} s`;
  const avgTripSec = isIdle ? '--' : `${tripVal} s`;

  return (
    <aside
      aria-label="Live simulation summary"
      className="absolute top-3 right-3 z-30 w-[290px] max-h-[calc(100%-76px)] overflow-y-auto bg-white/95 backdrop-blur border border-[#E2E6EF] rounded-[12px] shadow-md p-4 flex flex-col gap-3.5 select-none"
    >
      {/* Header: Status + Simulated clock + Thin progress bar */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span
            id="statusBadge"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold ${statusMeta.pillClass}`}
          >
            <span className={`w-2 h-2 rounded-full ${statusMeta.dotClass}`} />
            <span>{statusMeta.label}</span>
          </span>

          <span
            id="clockDisplay"
            className="text-[13px] font-semibold text-[#111C2D] tabular-nums"
          >
            {formatClockMMSS(elapsedSec)} / {String(durationMin).padStart(2, '0')}:00
          </span>
        </div>

        <div
          className="w-full h-1.5 bg-[#E2E6EF] rounded-full overflow-hidden"
          role="progressbar"
          aria-valuenow={Math.round(progressPct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Simulation progress"
        >
          <div
            className={`h-full rounded-full transition-all duration-300 ${statusMeta.barClass}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Four live metrics */}
      <div className="p-3 rounded-[12px] bg-[#F5F6F8] border border-[#E2E6EF] flex flex-col gap-2">
        <div className="flex justify-between items-center gap-2">
          <span className="text-[12px] text-[#6B7A99]">Cars on campus now</span>
          <span
            className={`text-[14px] font-semibold tabular-nums ${
              isIdle ? 'text-[#6B7A99]' : 'text-[#254B98]'
            }`}
          >
            {carsOnCampus}
          </span>
        </div>

        <div className="flex flex-wrap justify-between items-center gap-x-2 gap-y-1 pt-2 border-t border-[#E2E6EF]/80">
          <span className="text-[12px] text-[#6B7A99]">Cars exiting per hour</span>
          <div className="flex items-center gap-1.5 ml-auto">
            {throughputStatus && (
              <span
                className={`text-[12px] px-2 py-0.5 rounded-full font-semibold ${throughputStatus.badgeClass}`}
              >
                {throughputStatus.label}
              </span>
            )}
            <span
              className={`text-[14px] font-semibold tabular-nums ${
                isIdle ? 'text-[#6B7A99]' : 'text-[#111C2D]'
              }`}
            >
              {carsExitingPerHr}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap justify-between items-center gap-x-2 gap-y-1 pt-2 border-t border-[#E2E6EF]/80">
          <span className="text-[12px] text-[#6B7A99]">Average wait in line</span>
          <div className="flex items-center gap-1.5 ml-auto">
            {waitStatus && (
              <span
                className={`text-[12px] px-2 py-0.5 rounded-full font-semibold ${waitStatus.badgeClass}`}
              >
                {waitStatus.label}
              </span>
            )}
            <span
              className={`text-[14px] font-semibold tabular-nums ${
                isIdle ? 'text-[#6B7A99]' : 'text-[#111C2D]'
              }`}
            >
              {avgWaitSec}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap justify-between items-center gap-x-2 gap-y-1 pt-2 border-t border-[#E2E6EF]/80">
          <span className="text-[12px] text-[#6B7A99]">Average trip time</span>
          <div className="flex items-center gap-1.5 ml-auto">
            {tripStatus && (
              <span
                className={`text-[12px] px-2 py-0.5 rounded-full font-semibold ${tripStatus.badgeClass}`}
              >
                {tripStatus.label}
              </span>
            )}
            <span
              className={`text-[14px] font-semibold tabular-nums ${
                isIdle ? 'text-[#6B7A99]' : 'text-[#111C2D]'
              }`}
            >
              {avgTripSec}
            </span>
          </div>
        </div>
      </div>

      {/* Single alert line at a time */}
      <div>
        {singleAlert ? (
          <div
            className={`p-3 rounded-[12px] border flex flex-col gap-1.5 ${
              singleAlert.tone === 'critical'
                ? 'bg-[#EF4444]/10 border-[#EF4444]/40 text-[#111C2D]'
                : singleAlert.tone === 'warn'
                ? 'bg-[#F59E0B]/10 border-[#F59E0B]/40 text-[#111C2D]'
                : 'bg-[#E7EEFF]/70 border-[#254B98]/25 text-[#111C2D]'
            }`}
          >
            <div className="flex items-center gap-1.5">
              {singleAlert.tone === 'info' ? (
                <Info size={14} className="text-[#254B98] shrink-0" />
              ) : (
                <AlertTriangle
                  size={14}
                  className={
                    singleAlert.tone === 'critical'
                      ? 'text-[#EF4444] shrink-0'
                      : 'text-[#F59E0B] shrink-0'
                  }
                />
              )}
              <span className="text-[12px] font-semibold text-[#111C2D] truncate">
                {singleAlert.title}
              </span>
            </div>
            <p className="text-[12px] text-[#6B7A99] leading-snug">
              {singleAlert.message}
            </p>
            {singleAlert.showEditMap && (
              <button
                type="button"
                onClick={() => setActiveTab('map-setup')}
                className="self-start h-9 px-3 mt-0.5 rounded-lg bg-[#254B98] hover:bg-[#1c3b78] text-white text-[12px] font-medium cursor-pointer transition-colors"
              >
                Edit map
              </button>
            )}
          </div>
        ) : (
          <div className="px-3 py-2.5 rounded-[12px] bg-[#F5F6F8] border border-[#E2E6EF] text-[12px] text-[#6B7A99]">
            {isRunning || isPaused
              ? 'No alerts. Traffic is moving.'
              : isComplete
              ? 'Run finished.'
              : 'No active alerts.'}
          </div>
        )}
      </div>

      {/* Collapsible Road usage (top 5 segments) */}
      <div className="pt-1 border-t border-[#E2E6EF]">
        <button
          type="button"
          onClick={() => setRoadUsageOpen((prev) => !prev)}
          aria-expanded={roadUsageOpen}
          className="w-full h-9 px-1 flex items-center justify-between text-[13px] font-semibold text-[#111C2D] hover:text-[#254B98] rounded-lg cursor-pointer transition-colors"
        >
          <span>Road usage</span>
          <ChevronDown
            size={16}
            className={`text-[#6B7A99] transition-transform duration-150 ${
              roadUsageOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {roadUsageOpen && (
          <div className="pt-2 flex flex-col gap-2.5">
            {displaySegments.length === 0 ? (
              <div className="text-center text-[#6B7A99] py-2 text-[12px]">
                No roads drawn yet
              </div>
            ) : (
              displaySegments.map((seg) => {
                const segOcc = segmentOccupancies[seg.id];
                const pct = isIdle ? 0 : segOcc ? segOcc.utilizationPct : 0;
                const usageStatus = getSegmentUsageStatus(pct);

                return (
                  <div key={seg.id} className="flex flex-col gap-1">
                    <div className="flex justify-between items-center gap-2 text-[12px]">
                      <span
                        className="text-[#111C2D] font-medium truncate"
                        title={seg.name}
                      >
                        {seg.name}
                      </span>
                      <span
                        className={`font-semibold tabular-nums shrink-0 ${
                          isIdle ? 'text-[#6B7A99]' : usageStatus.textClass
                        }`}
                      >
                        {isIdle ? '0%' : `${pct}%`}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-[#E2E6EF] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          isIdle ? 'bg-[#E2E6EF]' : usageStatus.barClass
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
