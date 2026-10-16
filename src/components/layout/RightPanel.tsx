/**
 * FlowSmart - Right Telemetry & Control Panel
 * Fixed 300px width.
 * Displays in order:
 * 1. Live metrics (refreshed every 500ms)
 * 2. Active alerts (gridlock, edge cases, wait/utilization alerts)
 * 3. Capacity utilization bars with Show Heatmap toggle synced to canvas
 * Controls pinned at the bottom (Stop, Pause/Resume, speed slider, reset all data, view results).
 * Meets all type scale (>= 12px) and spacing (16px padding, 20px sections, 12px rows, 36px buttons/inputs).
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Square,
  Play,
  Pause,
  AlertTriangle,
  Info,
  CheckCircle2,
  BarChart3,
  RotateCcw,
} from 'lucide-react';
import { useTrafficStore } from '../../context/TrafficStoreContext';
import { useSimulation } from '../../context/SimulationContext';

interface RightPanelProps {
  showHeatmap: boolean;
  onToggleHeatmap: (show: boolean) => void;
}

export const RightPanel: React.FC<RightPanelProps> = ({
  showHeatmap,
  onToggleHeatmap,
}) => {
  const { setActiveTab, resetAll, state: storeState } = useTrafficStore();
  const {
    status,
    liveMetrics,
    segmentOccupancies,
    activeAlerts,
    isGridlocked,
    gridlockMessage,
    activeEdgeCase,
    simSpeed,
    setSimSpeed,
    startSimulation,
    startNewRun,
    pauseSimulation,
    resumeSimulation,
    stopSimulation,
    lastResult,
    routeValidation,
  } = useSimulation();

  const [showResetModal, setShowResetModal] = useState<boolean>(false);

  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isComplete = status === 'completed';
  const isIdle = status === 'idle';

  // Dismiss confirmation prompt on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowResetModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleTogglePlay = () => {
    if (isRunning) {
      pauseSimulation();
    } else if (isPaused) {
      resumeSimulation();
    } else {
      startNewRun();
    }
  };

  // Determine top segments for capacity bars dynamically from drawn road segments
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

  const getBarColor = (pct: number) => {
    if (pct >= 80) return 'bg-[#EF4444]'; // Red > 80%
    if (pct >= 60) return 'bg-[#F59E0B]'; // Amber 60-80%
    return 'bg-[#25A76B]'; // Green < 60%
  };

  const getTextColor = (pct: number) => {
    if (pct >= 80) return 'text-[#EF4444]';
    if (pct >= 60) return 'text-[#F59E0B]';
    return 'text-[#25A76B]';
  };

  return (
    <aside className="w-[300px] shrink-0 bg-white border-l border-[#E2E6EF] flex flex-col justify-between h-full z-20 select-none">
      {/* Scrollable upper sections: Live metrics, Active alerts, Capacity utilization */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Section 1: Live metrics / Final metrics */}
        <div className="flex flex-col space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#E2E6EF]">
            <h2 className="text-[16px] font-medium text-[#111C2D]">
              {isComplete ? 'Final metrics' : 'Live metrics'}
            </h2>
            {isComplete ? (
              <span className="text-[12px] font-medium text-[#254B98]">Finished</span>
            ) : isGridlocked ? (
              <span className="text-[12px] font-semibold text-[#EF4444] animate-pulse">Gridlocked</span>
            ) : isRunning ? (
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#25A76B] animate-pulse" />
                <span className="text-[12px] font-medium text-[#25A76B]">Active</span>
              </div>
            ) : (
              <span className="text-[12px] text-[#6B7A99]">Inactive</span>
            )}
          </div>

          <div className="p-3 rounded-lg bg-[#F5F6F8] border border-[#E2E6EF] flex flex-col space-y-2.5">
            {isComplete ? (
              <>
                <div className="flex justify-between items-center text-[13px]">
                  <span className="text-[12px] text-[#6B7A99]">Total completed</span>
                  <span className="text-[14px] font-medium text-[#254B98] tabular-nums">
                    {liveMetrics.totalCompletedVehicles || lastResult?.totalProcessedVehicles || 0} veh
                  </span>
                </div>
                <div className="flex justify-between items-center text-[13px] pt-1.5 border-t border-[#E2E6EF]/70">
                  <span className="text-[12px] text-[#6B7A99]">Avg throughput</span>
                  <span className="text-[14px] font-medium text-[#111C2D] tabular-nums">
                    {(liveMetrics.throughputVehHr || lastResult?.totalThroughputVehHr || 0).toLocaleString()} veh/hr
                  </span>
                </div>
                <div className="flex justify-between items-center text-[13px] pt-1.5 border-t border-[#E2E6EF]/70">
                  <span className="text-[12px] text-[#6B7A99]">Avg wait time</span>
                  <span className="text-[14px] font-medium text-[#111C2D] tabular-nums">
                    {lastResult ? `${lastResult.avgWaitTimeSec} s` : (liveMetrics.avgWaitTimeSec ? `${liveMetrics.avgWaitTimeSec} s` : '0 s')}
                  </span>
                </div>
                <div className="flex justify-between items-center text-[13px] pt-1.5 border-t border-[#E2E6EF]/70">
                  <span className="text-[12px] text-[#6B7A99]">Max queue length</span>
                  <span className="text-[14px] font-medium text-[#EF4444] tabular-nums">
                    {lastResult ? `${lastResult.maxQueueLengthVeh} veh` : (liveMetrics.maxQueueLengthVeh ? `${liveMetrics.maxQueueLengthVeh} veh` : '0 veh')}
                  </span>
                </div>
                <div className="flex justify-between items-center text-[13px] pt-1.5 border-t border-[#E2E6EF]/70">
                  <span className="text-[12px] text-[#6B7A99]">Avg transit time</span>
                  <span className="text-[14px] font-medium text-[#111C2D] tabular-nums">
                    {liveMetrics.avgTransitTimeSec || lastResult?.avgTransitTimeSec || 0} s
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between items-center text-[13px]">
                  <span className="text-[12px] text-[#6B7A99]">Active vehicles</span>
                  <span
                    className={`text-[14px] font-medium tabular-nums ${
                      isRunning || isPaused ? 'text-[#254B98]' : 'text-[#6B7A99]'
                    }`}
                  >
                    {isRunning || isPaused ? liveMetrics.activeVehicles : '--'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-[13px] pt-1.5 border-t border-[#E2E6EF]/70">
                  <span className="text-[12px] text-[#6B7A99]">Throughput</span>
                  <span
                    className={`text-[14px] font-medium tabular-nums ${
                      isRunning || isPaused ? 'text-[#111C2D]' : 'text-[#6B7A99]'
                    }`}
                  >
                    {isRunning || isPaused
                      ? `${liveMetrics.throughputVehHr.toLocaleString()} v/h`
                      : '--'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-[13px] pt-1.5 border-t border-[#E2E6EF]/70">
                  <span className="text-[12px] text-[#6B7A99]">Avg wait</span>
                  <span
                    className={`text-[14px] font-medium tabular-nums ${
                      isRunning || isPaused ? 'text-[#111C2D]' : 'text-[#6B7A99]'
                    }`}
                  >
                    {isRunning || isPaused ? `${liveMetrics.avgWaitTimeSec}s` : '--'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-[13px] pt-1.5 border-t border-[#E2E6EF]/70">
                  <span className="text-[12px] text-[#6B7A99]">Avg transit</span>
                  <span
                    className={`text-[14px] font-medium tabular-nums ${
                      isRunning || isPaused ? 'text-[#111C2D]' : 'text-[#6B7A99]'
                    }`}
                  >
                    {isRunning || isPaused ? `${liveMetrics.avgTransitTimeSec}s` : '--'}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Section 2: Active alerts */}
        <div className="flex flex-col space-y-3 pt-2 border-t border-[#E2E6EF]">
          <div className="flex items-center justify-between pb-1">
            <h2 className="text-[16px] font-medium text-[#111C2D]">Active alerts</h2>
            {isGridlocked ? (
              <span className="text-[12px] bg-red-100 text-[#EF4444] px-2 py-0.5 rounded-lg font-bold">
                Gridlock
              </span>
            ) : activeAlerts.filter((a) => a.type === 'critical').length > 0 ? (
              <span className="text-[12px] bg-red-100 text-[#EF4444] px-2 py-0.5 rounded-lg font-semibold">
                {activeAlerts.filter((a) => a.type === 'critical').length} Critical
              </span>
            ) : null}
          </div>

          {/* Gridlock condition callout */}
          {isGridlocked && (
            <div className="bg-red-50 border border-[#EF4444] p-3 rounded-lg flex flex-col space-y-1 text-red-900">
              <div className="flex items-center gap-2 text-[#EF4444]">
                <AlertTriangle size={16} className="shrink-0" />
                <span className="text-[13px] font-semibold">Gridlock condition</span>
              </div>
              <p className="text-[12px] text-[#EF4444] leading-relaxed">
                {gridlockMessage || 'Zero vehicle movement for over 120 simulated seconds.'}
              </p>
            </div>
          )}

          {/* Edge case callout */}
          {!isGridlocked && activeEdgeCase && (
            <div
              className={`p-3 rounded-lg flex flex-col space-y-1 border ${
                activeEdgeCase.type === 'zero-spawn-rate'
                  ? 'bg-amber-50 border-[#F59E0B] text-amber-900'
                  : 'bg-red-50 border-[#EF4444] text-red-900'
              }`}
            >
              <div
                className={`flex items-center gap-2 ${
                  activeEdgeCase.type === 'zero-spawn-rate' ? 'text-[#F59E0B]' : 'text-[#EF4444]'
                }`}
              >
                <AlertTriangle size={15} className="shrink-0" />
                <span className="text-[13px] font-semibold capitalize">
                  {activeEdgeCase.type.replace(/-/g, ' ')}
                </span>
              </div>
              <p className="text-[12px] leading-relaxed">{activeEdgeCase.message}</p>
            </div>
          )}

          {/* Active alert cards list */}
          <div className="flex flex-col space-y-3">
            {activeAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`p-3 rounded-lg border flex flex-col space-y-1 ${
                  alert.type === 'critical'
                    ? 'bg-red-50/70 border-[#EF4444]/30 text-red-900'
                    : 'bg-[#F5F6F8] border-[#E2E6EF] text-[#434651]'
                }`}
              >
                <div
                  className={`flex items-center gap-1.5 ${
                    alert.type === 'critical' ? 'text-[#EF4444]' : 'text-[#254B98]'
                  }`}
                >
                  {alert.type === 'critical' ? (
                    <AlertTriangle size={15} className="shrink-0" />
                  ) : (
                    <Info size={15} className="shrink-0" />
                  )}
                  <span className="text-[13px] font-medium truncate">{alert.title}</span>
                </div>
                <p className="text-[12px] text-[#434651] leading-relaxed">{alert.message}</p>
              </div>
            ))}

            {activeAlerts.length === 0 && !isGridlocked && !activeEdgeCase && (
              <div className="bg-[#F5F6F8] border border-[#E2E6EF] p-3 rounded-lg text-center text-[#6B7A99] text-[12px]">
                {isRunning
                  ? 'Normal flow across all corridors'
                  : isComplete
                  ? 'Evaluation session finalized'
                  : 'No active alerts'}
              </div>
            )}
          </div>
        </div>

        {/* Section 3: Capacity utilization */}
        <div className="flex flex-col space-y-3 pt-2 border-t border-[#E2E6EF]">
          <div className="flex items-center justify-between pb-1">
            <h2 className="text-[16px] font-medium text-[#111C2D]">
              {isComplete ? 'Peak utilization' : 'Capacity utilization'}
            </h2>
            {/* Show Heatmap Toggle */}
            <label className="flex items-center gap-2 cursor-pointer h-9 px-2 rounded-lg hover:bg-gray-50 transition-colors">
              <span className="text-[12px] text-[#6B7A99]">Heatmap</span>
              <button
                type="button"
                onClick={() => onToggleHeatmap(!showHeatmap)}
                className={`w-7 h-4 rounded-full relative p-0.5 transition-colors flex items-center cursor-pointer active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] focus-visible:ring-offset-1 ${
                  showHeatmap ? 'bg-[#254B98] justify-end' : 'bg-[#CBD5E1] justify-start'
                }`}
                aria-label="Toggle heatmap overlay"
              >
                <span className="w-3 h-3 bg-white rounded-full block" />
              </button>
            </label>
          </div>

          <div className="flex flex-col space-y-3">
            {displaySegments.length === 0 ? (
              <div className="text-center text-[#6B7A99] py-2 text-[12px]">No roads drawn yet</div>
            ) : (
              displaySegments.map((seg) => {
                const segOcc = segmentOccupancies[seg.id];
                const pct = isIdle ? 0 : segOcc ? segOcc.utilizationPct : 0;
                const name = seg.name;

                return (
                  <div key={seg.id} className="flex flex-col space-y-1">
                    <div className="flex justify-between items-center text-[13px]">
                      <span className="text-[#111C2D] font-medium truncate max-w-[190px]" title={name}>
                        {name}
                      </span>
                      <span
                        className={`font-semibold text-[12px] tabular-nums ${
                          isIdle ? 'text-[#6B7A99]' : getTextColor(pct)
                        }`}
                      >
                        {isIdle ? '0%' : `${pct}%`}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-[#E2E6EF] rounded-lg overflow-hidden">
                      <div
                        className={`h-full rounded-lg transition-all duration-300 ${
                          isIdle ? 'bg-[#CBD5E1]' : getBarColor(pct)
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Pinned bottom controls container */}
      <div className="p-4 pt-3 border-t border-[#E2E6EF] shrink-0 bg-white space-y-3">
        {isComplete ? (
          /* Three things in order: Run again (green), View results (outline), Edit layout (text link) */
          <div className="flex flex-col space-y-2">
            {/* 1. Green primary button "Run again" (Play icon, calls startNewRun) */}
            <button
              type="button"
              onClick={startNewRun}
              disabled={!routeValidation.isValid}
              className={`w-full h-9 px-4 rounded-lg text-[13px] font-medium flex items-center justify-center gap-2 transition-all ${
                routeValidation.isValid
                  ? 'bg-[#25A76B] hover:bg-[#1f8c59] active:scale-98 text-white cursor-pointer'
                  : 'bg-gray-200 text-[#6B7A99] cursor-not-allowed shadow-none'
              } focus:outline-none focus-visible:ring-2 focus-visible:ring-[#25A76B] focus-visible:ring-offset-1`}
              title={routeValidation.isValid ? 'Run simulation again' : (routeValidation.errorMessage || 'Cannot run: invalid routes')}
            >
              <Play size={15} className={routeValidation.isValid ? 'fill-current' : 'fill-gray-400 stroke-none'} />
              <span>Run again</span>
            </button>

            {/* 2. Secondary outline button "View results" */}
            <button
              type="button"
              onClick={() => setActiveTab('results')}
              className="w-full h-9 px-4 bg-white hover:bg-[#F5F6F8] active:scale-98 text-[#1E293B] border border-[#E2E6EF] rounded-lg text-[13px] font-medium flex items-center justify-center gap-2 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] focus-visible:ring-offset-1"
            >
              <BarChart3 size={15} />
              <span>View results</span>
            </button>

            {/* 3. Small text link "Edit layout" (goes to Map setup tab) */}
            <div className="text-center pt-0.5">
              <button
                type="button"
                onClick={() => setActiveTab('map-setup')}
                className="text-[12px] text-[#254B98] hover:text-[#1b366e] hover:underline cursor-pointer"
              >
                Edit layout
              </button>
            </div>
          </div>
        ) : (
          /* Playback controls (Stop, Pause/Resume) when running, paused, or idle */
          <div className="flex items-center gap-2">
            {/* Stop button (36px tall) */}
            <button
              type="button"
              onClick={stopSimulation}
              className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg text-[#6B7A99] hover:text-[#111C2D] bg-[#F5F6F8] hover:bg-gray-200 border border-[#E2E6EF] active:scale-90 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] focus-visible:ring-offset-1"
              title="Stop simulation"
              aria-label="Stop simulation"
            >
              <Square size={14} className="fill-current" />
            </button>

            {/* Pause / Resume / Start toggle button (36px tall) */}
            <button
              type="button"
              onClick={handleTogglePlay}
              className="flex-1 h-9 px-3 flex items-center justify-center rounded-lg bg-[#F5F6F8] hover:bg-gray-200 border border-[#E2E6EF] text-[#25A76B] active:scale-95 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] focus-visible:ring-offset-1 font-medium gap-2 text-[13px]"
              title={isRunning ? 'Pause [Space]' : isPaused ? 'Resume [Space]' : 'Start [Space]'}
              aria-label={isRunning ? 'Pause' : isPaused ? 'Resume' : 'Start'}
            >
              {isRunning ? (
                <>
                  <Pause size={15} className="fill-current text-[#254B98]" />
                  <span className="text-[#254B98]">Pause</span>
                </>
              ) : (
                <>
                  <Play size={15} className="fill-current text-[#25A76B]" />
                  <span>{isPaused ? 'Resume' : 'Start'}</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Speed slider 0.5x to 5x (visible in all states including completed) */}
        <div className="flex flex-col space-y-1.5 pt-1">
          <div className="flex justify-between items-center text-[12px]">
            <span className="text-[#6B7A99]">Simulation speed</span>
            <span className="text-[#254B98] font-medium tabular-nums" id="speedLabel">
              {simSpeed}x
            </span>
          </div>
          <input
            id="speedSlider"
            type="range"
            min="0.5"
            max="5"
            step="0.5"
            value={simSpeed}
            onChange={(e) => setSimSpeed(parseFloat(e.target.value))}
            className="w-full h-2 bg-[#E2E6EF] rounded-lg appearance-none cursor-pointer accent-[#254B98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] focus-visible:ring-offset-1"
            aria-label="Simulation speed slider"
          />
          <div className="flex justify-between text-[12px] text-[#6B7A99] px-0.5">
            <span>0.5x</span>
            <span>1x</span>
            <span>2x</span>
            <span>5x</span>
          </div>
        </div>

        {/* Reset all data button (at least 36px tall) */}
        <button
          type="button"
          onClick={() => setShowResetModal(true)}
          className="w-full h-9 px-3 rounded-lg text-[12px] font-medium transition-all border border-[#E2E6EF] text-[#6B7A99] hover:text-red-600 hover:border-red-200 flex items-center justify-center gap-2 cursor-pointer active:scale-98 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1"
          title="Clears all map, settings, and run logs from LocalStorage"
        >
          <RotateCcw size={14} />
          <span>Reset all data</span>
        </button>
      </div>

      {/* Reset all data Confirmation Modal */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-sm w-full p-5 shadow-xl border border-[#E2E6EF] flex flex-col gap-3">
            <div className="flex items-center gap-2 text-red-600 font-medium text-[15px]">
              <AlertTriangle size={18} />
              <span>Confirm data reset</span>
            </div>
            <p className="text-[12px] text-[#6B7A99] leading-relaxed">
              This erases the map, all settings and the whole run history. Use New layout if you only want a fresh map.
            </p>
            <div className="flex items-center justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                className="h-9 px-4 rounded-lg border border-[#E2E6EF] text-[13px] font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  stopSimulation();
                  resetAll();
                  setShowResetModal(false);
                }}
                className="h-9 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[13px] font-medium cursor-pointer"
              >
                Reset all
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
