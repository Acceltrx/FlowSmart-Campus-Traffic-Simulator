/**
 * FlowSmart - Top Navigation Bar
 * Fixed at 48px height with #254B98 background.
 * Provides tab navigation and global main action reflecting simulation state:
 * - Idle / Complete: green "Run simulation" with Play icon (starts a new run)
 * - Running: red "Stop" with Square icon (ends run and resets vehicles)
 * - Paused: green "Resume" with Play icon (calls resumeSimulation)
 * - Disabled only when idle or complete and route check fails
 * - Fixed button width to prevent shifting when label changes
 */

import React, { useState, useEffect } from 'react';
import { Play, Square, CircleHelp } from 'lucide-react';
import { useTrafficStore } from '../../context/TrafficStoreContext';
import { useSimulation } from '../../context/SimulationContext';
import { ActiveTab } from '../../types/traffic';
import { HelpModal } from '../common/HelpModal';

export const TopNav: React.FC = () => {
  const { state, setActiveTab } = useTrafficStore();
  const [helpOpen, setHelpOpen] = useState(false);

  // Close help window automatically whenever activeTab changes
  useEffect(() => {
    setHelpOpen(false);
  }, [state.activeTab]);
  const {
    status,
    startNewRun,
    stopSimulation,
    resumeSimulation,
    routeValidation,
  } = useSimulation();

  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isIdleOrComplete = status === 'idle' || status === 'completed';
  const isDisabled = isIdleOrComplete && !routeValidation.isValid;

  const handleMainAction = () => {
    if (isRunning) {
      stopSimulation();
    } else if (isPaused) {
      resumeSimulation();
    } else {
      // Idle or complete: start fresh run
      setActiveTab('simulation');
      if (routeValidation.isValid) {
        startNewRun();
      }
    }
  };

  const tabs: { id: ActiveTab; label: string }[] = [
    { id: 'map-setup', label: 'Map setup' },
    { id: 'simulation', label: 'Simulation' },
    { id: 'results', label: 'Results' },
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
    buttonTitle = isDisabled
      ? (routeValidation.errorMessage || 'Cannot run: invalid routes')
      : 'Run simulation';
    ariaLabel = 'Run simulation';
    bgClasses = isDisabled
      ? 'bg-white/20 text-white/50 cursor-not-allowed shadow-none'
      : 'bg-[#25A76B] hover:bg-[#1f8c59] text-white';
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-12 bg-[#254B98] select-none border-b border-[#254B98]">
      <div className="h-12 w-full px-4 flex items-center justify-between">
        {/* Left: Brand mark */}
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-[#25A76B] shrink-0" />
          <span className="text-[17px] font-semibold text-white tracking-tight">FlowSmart</span>
        </div>

        {/* Center: Tabs in sentence case */}
        <nav className="flex items-center gap-1">
          {tabs.map((tab) => {
            const isActive = state.activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-1.5 rounded-lg text-[13px] transition-all duration-150 cursor-pointer active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1 focus-visible:ring-offset-[#254B98] ${
                  isActive
                    ? 'bg-white/20 text-white font-medium'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Right: Help button and primary execution action */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            aria-label="How to use this screen"
            title="How to use this screen"
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1 focus-visible:ring-offset-[#254B98]"
          >
            <CircleHelp size={18} />
          </button>

          <button
            type="button"
            onClick={handleMainAction}
            disabled={isDisabled}
            title={buttonTitle}
            aria-label={ariaLabel}
            className={`w-[148px] h-9 px-3 rounded-lg text-[13px] font-medium flex items-center justify-center gap-1.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1 focus-visible:ring-offset-[#254B98] ${bgClasses} ${
              isDisabled ? '' : 'cursor-pointer active:scale-95'
            }`}
          >
            {isRunning ? (
              <Square size={13} className="fill-current shrink-0" />
            ) : (
              <Play
                size={14}
                className={`shrink-0 ${isDisabled ? 'fill-white/40 stroke-none' : 'fill-current'}`}
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
