/**
 * FlowSmart - Top Navigation Bar
 * White 48px header with FlowSmart wordmark, 4 numbered step tabs, help button, and Start/Stop action.
 */

import React, { useState, useEffect } from 'react';
import { Play, Square, CircleHelp } from 'lucide-react';
import { useTrafficStore } from '../../context/TrafficStoreContext';
import { useSimulation } from '../../context/SimulationContext';
import { ActiveTab } from '../../types/traffic';
import { HelpModal } from '../common/HelpModal';
import { DIRECT_KEY, getEntranceSplit } from '../../utils/destinationSplit';

export const TopNav: React.FC = () => {
  const { state, setActiveTab } = useTrafficStore();
  const [helpOpen, setHelpOpen] = useState(false);
  const [viewedResults, setViewedResults] = useState(false);

  // Close help window automatically whenever activeTab changes; track results visit when runs exist
  useEffect(() => {
    setHelpOpen(false);
    if (state.activeTab === 'results' && state.runLog.length > 0) {
      setViewedResults(true);
    }
  }, [state.activeTab, state.runLog.length]);

  useEffect(() => {
    if (state.runLog.length === 0) {
      setViewedResults(false);
    }
  }, [state.runLog.length]);

  const {
    status,
    startNewRun,
    stopSimulation,
    resumeSimulation,
    routeValidation,
  } = useSimulation();

  const entrances = state.map.zoneMarkers.filter((z) => z.type === 'entrance');
  const dropoffs = state.map.zoneMarkers.filter((z) => z.type === 'dropoff');
  const hasSpawnRate = entrances.some((ent) => (state.settings.spawnRates[ent.id] ?? 0) > 0);
  const allSplitsOk = entrances.every((ent) => {
    const split = getEntranceSplit(state.settings, state.map, ent.id);
    let sum = split[DIRECT_KEY] ?? 0;
    for (const d of dropoffs) {
      sum += split[d.id] ?? 0;
    }
    return Math.abs(Math.round(sum * 10) / 10 - 100) < 0.1;
  });
  const canStartFromCurrent = routeValidation.isValid && hasSpawnRate && allSplitsOk;

  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isIdleOrComplete = status === 'idle' || status === 'completed';
  const requiresStartReady = state.activeTab === 'simulation' || state.activeTab === 'settings';
  const isDisabled =
    isIdleOrComplete && (!routeValidation.isValid || (requiresStartReady && !canStartFromCurrent));

  const handleMainAction = () => {
    if (isRunning) {
      stopSimulation();
    } else if (isPaused) {
      resumeSimulation();
    } else if (state.activeTab !== 'simulation') {
      // From any tab except Simulation, go to Settings instead of starting directly
      setActiveTab('settings');
    } else {
      // From Simulation tab when idle or complete: start fresh run
      if (canStartFromCurrent) {
        startNewRun();
      }
    }
  };

  const hasRunResults = state.runLog.length > 0;

  const tabs: { id: ActiveTab; step: number; label: string; isDone: boolean }[] = [
    { id: 'map-setup', step: 1, label: 'Map setup', isDone: routeValidation.isValid },
    { id: 'settings', step: 2, label: 'Settings', isDone: routeValidation.isValid && hasSpawnRate },
    { id: 'simulation', step: 3, label: 'Simulation', isDone: status === 'completed' || hasRunResults },
    { id: 'results', step: 4, label: 'Results', isDone: hasRunResults && viewedResults },
  ];

  let buttonText = 'Run simulation';
  let buttonTitle = 'Run simulation';
  let ariaLabel = 'Run simulation';
  let bgClasses = 'bg-[#25A76B] hover:bg-[#1f8c59] text-white';

  if (isRunning) {
    buttonText = 'Stop';
    buttonTitle = 'Stop simulation';
    ariaLabel = 'Stop simulation';
    bgClasses = 'bg-[#EF4444] hover:bg-[#dc2626] text-white';
  } else if (isPaused) {
    buttonText = 'Resume';
    buttonTitle = 'Resume simulation';
    ariaLabel = 'Resume simulation';
    bgClasses = 'bg-[#25A76B] hover:bg-[#1f8c59] text-white';
  } else {
    buttonText = 'Run simulation';
    const invalidReason = !routeValidation.isValid
      ? routeValidation.errorMessage || 'Cannot run: invalid routes'
      : !allSplitsOk
        ? 'Fix destination splits in Settings so every gate adds up to 100%.'
        : 'Raise at least one gate above 0 cars/min in Settings.';
    buttonTitle = isDisabled
      ? invalidReason
      : state.activeTab !== 'simulation'
        ? 'Go to Settings'
        : 'Run simulation';
    ariaLabel = 'Run simulation';
    bgClasses = isDisabled
      ? 'bg-[#E2E6EF] text-[#6B7A99] cursor-not-allowed shadow-none'
      : 'bg-[#25A76B] hover:bg-[#1f8c59] text-white';
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-12 bg-white select-none border-b border-[#E2E6EF]">
      <div className="h-12 w-full px-6 flex items-center justify-between gap-6">
        {/* Left: Brand mark + 4 numbered tabs */}
        <div className="flex items-center gap-7 h-full min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-2.5 h-2.5 rounded-full bg-[#25A76B] shrink-0" />
            <span className="text-[17px] font-bold text-[#254B98] tracking-tight">FlowSmart</span>
          </div>

          <nav className="flex items-center gap-1 h-full" role="tablist" aria-label="Workspace steps">
            {tabs.map((tab) => {
              const isActive = state.activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tab.id)}
                  className={`h-full px-3.5 flex items-center gap-2 text-[13px] font-medium border-b-[3px] transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] focus-visible:ring-inset whitespace-nowrap ${
                    isActive
                      ? 'text-[#254B98] border-[#254B98]'
                      : 'text-[#6B7A99] border-transparent hover:text-[#111C2D]'
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full text-[12px] font-semibold flex items-center justify-center shrink-0 transition-colors ${
                      tab.isDone
                        ? 'bg-[#25A76B] text-white'
                        : isActive
                          ? 'bg-[#254B98] text-white'
                          : 'bg-[#E2E6EF] text-[#6B7A99]'
                    }`}
                  >
                    {tab.step}
                  </span>
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right: Help button and primary execution action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            aria-label="How to use this screen"
            title="How to use this screen"
            className="w-9 h-9 rounded-full flex items-center justify-center text-[#6B7A99] hover:text-[#111C2D] hover:bg-[#F5F6F8] transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98]"
          >
            <CircleHelp size={18} />
          </button>

          <button
            type="button"
            onClick={handleMainAction}
            disabled={isDisabled}
            title={buttonTitle}
            aria-label={ariaLabel}
            className={`w-[148px] h-9 px-3 rounded-lg text-[13px] font-medium flex items-center justify-center gap-1.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] focus-visible:ring-offset-1 focus-visible:ring-offset-white ${bgClasses} ${
              isDisabled ? '' : 'cursor-pointer active:scale-95'
            }`}
          >
            {isRunning ? (
              <Square size={13} className="fill-current shrink-0" />
            ) : (
              <Play
                size={14}
                className={`shrink-0 ${isDisabled ? 'fill-[#6B7A99] stroke-none' : 'fill-current'}`}
              />
            )}
            <span>{buttonText}</span>
          </button>
        </div>
      </div>

      {/* In-App Help Modal */}
      <HelpModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        tab={state.activeTab}
      />
    </header>
  );
};
