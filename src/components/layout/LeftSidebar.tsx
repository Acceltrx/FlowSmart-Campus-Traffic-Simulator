/**
 * FlowSmart - Left Sidebar
 * Fixed 200px width.
 * Displays setup summary read from saved map (layout, speed limit, entrances, exits, drop-offs, segments),
 * locked during run.
 * Spawn rates stay per entrance and editable before run (supports zero spawn rate for PRD 4.3 edge-case testing),
 * with visible focus rings and hover/active states.
 */

import React from 'react';
import { CheckCircle2, Lock, AlertTriangle, LogIn, LogOut } from 'lucide-react';
import { useTrafficStore } from '../../context/TrafficStoreContext';
import { useSimulation } from '../../context/SimulationContext';
import { CarPersonIcon } from '../map-setup/MapSetupView';
import { VehicleMixControl } from '../common/VehicleMixControl';

export const LeftSidebar: React.FC = () => {
  const { state: storeState, updateSettings } = useTrafficStore();
  const { status, isGridlocked, routeValidation } = useSimulation();

  const isLocked = status === 'running' || status === 'paused';
  const isComplete = status === 'completed';

  const entrances = storeState.map.zoneMarkers.filter((z) => z.type === 'entrance');
  const entrancesCount = entrances.length;
  const exitsCount = storeState.map.zoneMarkers.filter((z) => z.type === 'exit').length;
  const dropoffsCount = storeState.map.zoneMarkers.filter((z) => z.type === 'dropoff').length;
  const segmentsCount = storeState.map.roadSegments.length;

  const handleSpawnRateChange = (entranceId: string, valStr: string) => {
    if (isLocked) return;
    const parsed = parseInt(valStr, 10);
    const val = isNaN(parsed) ? 0 : Math.max(0, parsed);
    updateSettings({
      spawnRates: {
        ...storeState.settings.spawnRates,
        [entranceId]: val,
      },
    });
  };

  const getStatusText = () => {
    if (isGridlocked) return 'Gridlock stalled';
    switch (status) {
      case 'running':
        return 'Active evaluation';
      case 'paused':
        return 'Simulation paused';
      case 'completed':
        return 'Completed';
      case 'idle':
      default:
        return 'Idle / ready';
    }
  };

  const getStatusColor = () => {
    if (isGridlocked) return 'text-[#EF4444]';
    switch (status) {
      case 'running':
        return 'text-[#25A76B]';
      case 'paused':
        return 'text-[#D97706]';
      case 'completed':
        return 'text-[#254B98]';
      case 'idle':
      default:
        return 'text-[#6B7A99]';
    }
  };

  return (
    <aside className="w-[200px] shrink-0 bg-white border-r border-[#E2E6EF] p-4 flex flex-col justify-between overflow-y-auto z-20 select-none">
      <div className="flex flex-col space-y-5">
        {/* Setup summary section */}
        <div className="flex flex-col space-y-3 pb-4 border-b border-[#E2E6EF]">
          <h2 className="text-[16px] font-medium text-[#111C2D]">Setup summary</h2>

          <div className="flex items-center gap-2 bg-[#F5F6F8] px-3 py-2 rounded-lg border border-[#E2E6EF]">
            {isGridlocked ? (
              <>
                <AlertTriangle size={15} className="text-[#EF4444] shrink-0" />
                <span className="text-[12px] text-[#EF4444] font-medium">Gridlocked</span>
              </>
            ) : isLocked ? (
              <>
                <Lock size={15} className="text-[#6B7A99] shrink-0" />
                <span className="text-[12px] text-[#6B7A99] font-medium">Locked during run</span>
              </>
            ) : isComplete ? (
              <>
                <CheckCircle2 size={15} className="text-[#254B98] shrink-0" />
                <span className="text-[12px] text-[#254B98] font-medium">Run finished</span>
              </>
            ) : !routeValidation.isValid ? (
              <>
                <AlertTriangle size={15} className="text-[#EF4444] shrink-0" />
                <span className="text-[12px] text-[#EF4444] font-medium">Run disabled</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={15} className="text-[#25A76B] shrink-0" />
                <span className="text-[12px] text-[#111C2D] font-medium">Ready to simulate</span>
              </>
            )}
          </div>

          {/* Route validation per entrance & cap note */}
          {!isLocked && routeValidation.entranceSummaries.length > 0 && (
            <div className="flex flex-col space-y-2 pt-2 border-t border-[#E2E6EF]">
              <span className="text-[12px] text-[#6B7A99] font-medium">Route eligibility</span>
              {routeValidation.entranceSummaries.map((s) => (
                <div key={s.entranceId} className="flex flex-col space-y-1 text-[12px]">
                  <div className="flex items-center justify-between">
                    <span className="text-[#111C2D] font-medium truncate max-w-[85px]" title={s.entranceName}>
                      {s.entranceName.replace(/\s*\(.*\)/, '')}:
                    </span>
                    {s.error ? (
                      <span className="text-[#EF4444] font-semibold">0 routes</span>
                    ) : s.stickerOnly ? (
                      <span className="text-[#D97706] font-medium text-[11px]">Sticker holders only</span>
                    ) : s.nonStickerOnly ? (
                      <span className="text-[#D97706] font-medium text-[11px]">Non-sticker only</span>
                    ) : (
                      <span className="text-[#6B7A99] tabular-nums">
                        {s.stickerRoutesCount} stkr / {s.nonStickerRoutesCount} non
                      </span>
                    )}
                  </div>
                  {s.error && (
                    <span className="text-[#EF4444] text-[12px] leading-tight font-medium">
                      {s.error}
                    </span>
                  )}
                  {s.truncated && (
                    <span className="text-[#D97706] text-[12px] italic">
                      Route list truncated at 200
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Metric rows */}
        <div className="flex flex-col space-y-3">
          <div className="flex justify-between items-center py-1 border-b border-[#E2E6EF] text-[13px]">
            <span className="text-[12px] text-[#6B7A99]">Layout</span>
            <span className="font-medium text-[#111C2D] truncate max-w-[100px]">
              {storeState.settings.layoutName || storeState.map.layoutName || 'Layout A'}
            </span>
          </div>
          <div className="flex justify-between items-center py-1 border-b border-[#E2E6EF] text-[13px]">
            <span className="text-[12px] text-[#6B7A99]">Speed limit</span>
            <span className="font-medium text-[#111C2D]">
              {storeState.settings.defaultSpeedLimit || 10} km/h
            </span>
          </div>
          <div className="flex justify-between items-center py-1 border-b border-[#E2E6EF] text-[13px]">
            <span className="text-[12px] text-[#6B7A99] flex items-center gap-1.5">
              <LogIn size={14} className="text-[#254B98]" />
              <span>Entrances</span>
            </span>
            <span className="font-medium text-[#111C2D]">{entrancesCount}</span>
          </div>
          <div className="flex justify-between items-center py-1 border-b border-[#E2E6EF] text-[13px]">
            <span className="text-[12px] text-[#6B7A99] flex items-center gap-1.5">
              <LogOut size={14} className="text-[#25A76B]" />
              <span>Exits</span>
            </span>
            <span className="font-medium text-[#111C2D]">{exitsCount}</span>
          </div>
          <div className="flex justify-between items-center py-1 border-b border-[#E2E6EF] text-[13px]">
            <span className="text-[12px] text-[#6B7A99] flex items-center gap-1.5">
              <CarPersonIcon size={15} className="text-[#F59E0B]" />
              <span>Drop-offs</span>
            </span>
            <span className="font-medium text-[#111C2D]">{dropoffsCount}</span>
          </div>
          <div className="flex justify-between items-center py-1 border-b border-[#E2E6EF] text-[13px]">
            <span className="text-[12px] text-[#6B7A99]">Road segments</span>
            <span className="font-medium text-[#111C2D]">{segmentsCount}</span>
          </div>
        </div>

        {/* Editable Spawn rates */}
        <div className="flex flex-col space-y-3 pt-2 border-t border-[#E2E6EF]">
          <div className="flex items-center justify-between">
            <h3 className="text-[16px] font-medium text-[#111C2D]">Spawn rates</h3>
            {isLocked && <Lock size={13} className="text-[#6B7A99]" />}
          </div>
          <div className="flex flex-col space-y-3">
            {entrances.length === 0 ? (
              <span className="text-[12px] text-[#6B7A99] italic">No entrance configured</span>
            ) : (
              entrances.map((entrance) => {
                const currentRate = storeState.settings.spawnRates[entrance.id] ?? 18;
                return (
                  <div
                    key={entrance.id}
                    className="flex items-center justify-between gap-2 text-[#111C2D]"
                  >
                    <span className="text-[12px] truncate max-w-[80px]" title={entrance.name}>
                      {entrance.name.replace(/\s*\(.*\)/, '')}:
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        max={120}
                        disabled={isLocked}
                        value={currentRate}
                        onChange={(e) => handleSpawnRateChange(entrance.id, e.target.value)}
                        className={`w-14 h-9 px-2 text-center bg-white border border-[#E2E6EF] rounded-lg text-[13px] font-medium text-[#111C2D] focus:outline-none focus:border-[#254B98] focus-visible:ring-1 focus-visible:ring-[#254B98] ${
                          isLocked ? 'opacity-70 cursor-not-allowed bg-gray-100' : ''
                        }`}
                        aria-label={`Spawn rate for ${entrance.name}`}
                      />
                      <span className="text-[12px] text-[#6B7A99]">v/m</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Vehicle mix control (settings.stickerShare) */}
        <div className="pt-3 border-t border-[#E2E6EF]">
          <VehicleMixControl disabled={isLocked} />
        </div>
      </div>

      {/* Bottom state indicator */}
      <div className="pt-4 border-t border-[#E2E6EF] flex flex-col space-y-1">
        <span className="text-[12px] text-[#6B7A99]">Simulation state</span>
        <span className={`text-[13px] font-medium ${getStatusColor()}`}>
          {getStatusText()}
        </span>
      </div>
    </aside>
  );
};
