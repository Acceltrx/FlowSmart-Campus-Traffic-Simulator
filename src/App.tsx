/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { TrafficStoreProvider, useTrafficStore } from './context/TrafficStoreContext';
import { SimulationProvider, useSimulation } from './context/SimulationContext';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { TopNav } from './components/layout/TopNav';
import { LeftSidebar } from './components/layout/LeftSidebar';
import { RightPanel } from './components/layout/RightPanel';
import { SimulationCanvas } from './components/canvas/SimulationCanvas';
import { MapSetupView } from './components/map-setup/MapSetupView';
import { ResultsView } from './components/views/ResultsView';

const WorkspaceShell: React.FC = () => {
  const { state, storageWarning, dismissStorageWarning } = useTrafficStore();
  const { showHeatmap, setShowHeatmap } = useSimulation();

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#F5F6F8]">
      {/* 48px Top Navigation Bar */}
      <TopNav />

      {/* Main Workspace below 48px header */}
      <main className="pt-12 flex-1 flex flex-col w-full overflow-hidden">
        {/* Dismissible storage warning banner */}
        {storageWarning && (
          <div className="bg-[#FFFBEB] border-b border-[#FDE68A] text-[#92400E] px-4 py-2 text-[12px] flex items-center justify-between shrink-0 z-40">
            <div className="flex items-center gap-2">
              <AlertTriangle size={15} className="text-[#F59E0B] shrink-0" />
              <span>Your browser blocked saving. Use Export JSON to keep a backup.</span>
            </div>
            <button
              type="button"
              onClick={dismissStorageWarning}
              className="text-[#92400E] hover:text-[#78350F] p-1 rounded hover:bg-amber-100 transition-colors cursor-pointer"
              aria-label="Dismiss banner"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div className="flex-1 flex w-full overflow-hidden">
          {state.activeTab === 'simulation' && (
            <div className="flex flex-row w-full h-full overflow-hidden">
              {/* 160px Left Sidebar */}
              <LeftSidebar />

              {/* Fluid Center Simulation Canvas */}
              <SimulationCanvas
                showHeatmap={showHeatmap}
                onToggleHeatmap={setShowHeatmap}
              />

              {/* 210px Right Panel */}
              <RightPanel
                showHeatmap={showHeatmap}
                onToggleHeatmap={setShowHeatmap}
              />
            </div>
          )}

          {state.activeTab === 'map-setup' && <MapSetupView />}

          {state.activeTab === 'results' && <ResultsView />}
        </div>
      </main>
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <TrafficStoreProvider>
        <SimulationProvider>
          <WorkspaceShell />
        </SimulationProvider>
      </TrafficStoreProvider>
    </ErrorBoundary>
  );
}
