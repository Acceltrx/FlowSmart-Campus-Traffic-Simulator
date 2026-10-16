/**
 * FlowSmart - Simulation Runtime Controller Context
 * Manages simulation lifecycle, requestAnimationFrame loop with fixed-timestep accumulator,
 * throttled UI updates (500ms), alert monitoring, edge-case detection, and results persistence.
 */

import React, { createContext, useContext, useState, useRef, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { useTrafficStore } from './TrafficStoreContext';
import { createSimulation } from '../sim/engine';
import {
  buildRoadGraph,
  DrawnPathRouter,
  RouteValidationResult,
} from '../sim';
import {
  SimulationEngine,
  SimSnapshot,
  SimLiveMetrics,
  SegmentOccupancy,
  EdgeCaseInfo,
} from '../sim/types';
import {
  SimulationStatus,
  SimulationResult,
  RunLogEntry,
  MapConfig,
} from '../types/traffic';
import { getMetersPerUnit } from '../utils/scale';

export interface AlertItem {
  id: string;
  type: 'critical' | 'info';
  title: string;
  message: string;
}

export interface SimulationContextType {
  status: SimulationStatus;
  simTimeSeconds: number;
  isGridlocked: boolean;
  gridlockMessage: string;
  activeEdgeCase: EdgeCaseInfo | null;
  liveMetrics: SimLiveMetrics;
  segmentOccupancies: Record<string, SegmentOccupancy>;
  activeAlerts: AlertItem[];
  showHeatmap: boolean;
  setShowHeatmap: (show: boolean) => void;
  toggleHeatmap: () => void;
  simSpeed: number;
  setSimSpeed: (speed: number) => void;
  lastResult: SimulationResult | null;
  routeValidation: RouteValidationResult;
  startSimulation: () => void;
  startNewRun: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  stopSimulation: () => void;
  getSnapshot: () => SimSnapshot | null;
  alpha: number;
  getInterpolationAlpha: () => number;
  isMapEditedWhileRunning: boolean;
}

const DEFAULT_METRICS: SimLiveMetrics = {
  activeVehicles: 0,
  totalCompletedVehicles: 0,
  throughputVehHr: 0,
  avgWaitTimeSec: 0,
  avgTransitTimeSec: 0,
  maxQueueLengthVeh: 0,
  simTimeSeconds: 0,
  simDurationSeconds: 1800,
};

const SimulationContext = createContext<SimulationContextType | undefined>(undefined);

export const SimulationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { state: storeState, addRunLogEntry, setSimulationStatus } = useTrafficStore();

  const [status, setStatus] = useState<SimulationStatus>(storeState.simulationStatus || 'idle');
  const [simTimeSeconds, setSimTimeSeconds] = useState<number>(0);
  const [isGridlocked, setIsGridlocked] = useState<boolean>(false);
  const [gridlockMessage, setGridlockMessage] = useState<string>('');
  const [activeEdgeCase, setActiveEdgeCase] = useState<EdgeCaseInfo | null>(null);

  const [liveMetrics, setLiveMetrics] = useState<SimLiveMetrics>(DEFAULT_METRICS);
  const [segmentOccupancies, setSegmentOccupancies] = useState<Record<string, SegmentOccupancy>>({});
  const [activeAlerts, setActiveAlerts] = useState<AlertItem[]>([]);
  const [showHeatmap, setShowHeatmap] = useState<boolean>(false);
  const [simSpeed, setSimSpeedState] = useState<number>(storeState.simSpeed || 1);
  const [lastResult, setLastResult] = useState<SimulationResult | null>(null);

  // Pre-run route validation per ENGINE SPEC
  const routeValidation = useMemo<RouteValidationResult>(() => {
    try {
      const metersPerUnit = getMetersPerUnit(storeState.map, storeState.settings);
      const graph = buildRoadGraph(storeState.map, undefined, metersPerUnit);
      const router = new DrawnPathRouter(storeState.map, graph);
      return router.validation;
    } catch {
      return {
        isValid: false,
        errorMessage: 'Unable to evaluate routes for current map layout.',
        entranceSummaries: [],
      };
    }
  }, [storeState.map, storeState.settings.metersPerUnit]);

  const engineRef = useRef<SimulationEngine | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(performance.now());
  const accumulatorRef = useRef<number>(0);
  const alphaRef = useRef<number>(0);
  const lastUiUpdateRef = useRef<number>(0);
  const statusRef = useRef<SimulationStatus>(status);
  statusRef.current = status;

  const simSpeedRef = useRef<number>(simSpeed);
  simSpeedRef.current = simSpeed;

  const storeStateRef = useRef(storeState);
  storeStateRef.current = storeState;

  // Keep TrafficStore simulationStatus in sync
  useEffect(() => {
    setSimulationStatus(status);
  }, [status, setSimulationStatus]);

  const currentSeedRef = useRef<number>(Date.now() & 0xffffffff);
  const prevCriticalSegmentsRef = useRef<Set<string>>(new Set());
  const highUtilDurationRef = useRef<Map<string, number>>(new Map());
  const lastSimTimeForAlertsRef = useRef<number>(0);
  const normalizingAlertsRef = useRef<Map<string, { alert: AlertItem; expireSimTime: number }>>(new Map());

  // Refs for tracking completion and detecting stale results or mid-run map edits
  const completedMapRef = useRef<MapConfig | null>(null);
  const completedSettingsKeyRef = useRef<string>('');
  const runningMapRef = useRef<MapConfig | null>(null);
  const routeValidationRef = useRef<RouteValidationResult>(routeValidation);
  routeValidationRef.current = routeValidation;

  // Set sim speed
  const setSimSpeed = useCallback((speed: number) => {
    const clamped = Math.max(0.5, Math.min(5, speed));
    setSimSpeedState(clamped);
    simSpeedRef.current = clamped;
  }, []);

  const toggleHeatmap = useCallback(() => {
    setShowHeatmap((prev) => !prev);
  }, []);

  // Compute live alerts per ENGINE SPEC & PRD 3.2.6:
  // Critical when a segment's average wait exceeds configurable threshold (default 120s)
  // or utilization exceeds 80% for 30 simulated seconds; informational when it returns below 60%.
  // Thresholds editable in settings. Alert text uses real segment names and real numbers.
  const computeAlerts = useCallback((snap: SimSnapshot): AlertItem[] => {
    const alerts: AlertItem[] = [];

    // PRD 4.3 Gridlock alert
    if (snap.isGridlocked) {
      alerts.push({
        id: 'gridlock-critical',
        type: 'critical',
        title: 'Gridlock condition',
        message: snap.gridlockMessage || 'Zero vehicle movement for over 120 simulated seconds.',
      });
      return alerts;
    }

    // PRD 4.3 Edge-case alerts
    if (snap.edgeCase) {
      const isInfo =
        snap.edgeCase.type === 'zero-spawn-rate' ||
        snap.edgeCase.type === 'all-sticker-only' ||
        snap.edgeCase.type === 'all-non-sticker-only';

      alerts.push({
        id: `edgecase-${snap.edgeCase.type}`,
        type: isInfo ? 'info' : 'critical',
        title:
          snap.edgeCase.type === 'zero-spawn-rate'
            ? 'Zero spawn rate'
            : snap.edgeCase.type === 'all-sticker-only'
            ? 'Sticker holders only'
            : snap.edgeCase.type === 'all-non-sticker-only'
            ? 'Non-sticker only'
            : snap.edgeCase.type === 'no-drop-off'
            ? 'No drop-off zone'
            : snap.edgeCase.type === 'no-valid-path'
            ? 'No valid path'
            : `Notice: ${snap.edgeCase.type.replace(/-/g, ' ')}`,
        message: snap.edgeCase.message,
      });
      if (
        snap.edgeCase.type === 'zero-roads' ||
        snap.edgeCase.type === 'no-entrance' ||
        snap.edgeCase.type === 'no-exit' ||
        snap.edgeCase.type === 'all-exits-blocked' ||
        snap.edgeCase.type === 'no-valid-path'
      ) {
        return alerts;
      }
    }

    const settings = storeStateRef.current.settings;
    const waitThreshold = settings.alertWaitThresholdSec ?? 120;
    const utilThreshold = settings.alertUtilThresholdPct ?? 80;
    const utilDuration = settings.alertUtilDurationSec ?? 30;
    const returnThreshold = settings.alertReturnUtilPct ?? 60;

    const dtSim = Math.max(0, snap.simTimeSeconds - lastSimTimeForAlertsRef.current);
    lastSimTimeForAlertsRef.current = snap.simTimeSeconds;

    const occupancies = Object.values(snap.segmentOccupancies);
    const currentCriticalSet = new Set<string>();

    for (const seg of occupancies) {
      // Track sustained high utilization timer
      const prevDur = highUtilDurationRef.current.get(seg.segmentId) || 0;
      const nextDur = seg.utilizationPct >= utilThreshold ? prevDur + dtSim : 0;
      highUtilDurationRef.current.set(seg.segmentId, nextDur);

      const isWaitCritical = seg.meanWaitSeconds >= waitThreshold && seg.queueCount > 0;
      const isUtilSustainedCritical = nextDur >= utilDuration;

      if (isWaitCritical || isUtilSustainedCritical) {
        currentCriticalSet.add(seg.segmentId);
        normalizingAlertsRef.current.delete(seg.segmentId);

        if (isWaitCritical) {
          alerts.push({
            id: `crit-wait-${seg.segmentId}`,
            type: 'critical',
            title: `${seg.segmentName} congestion`,
            message: `Average wait time reached ${seg.meanWaitSeconds}s (threshold: ${waitThreshold}s, ${seg.queueCount} veh queued)`,
          });
        } else {
          alerts.push({
            id: `crit-util-${seg.segmentId}`,
            type: 'critical',
            title: `${seg.segmentName} saturation`,
            message: `Utilization sustained at ${seg.utilizationPct}% for ${Math.round(nextDur)}s (threshold: ${utilThreshold}% for ${utilDuration}s)`,
          });
        }
      } else if (prevCriticalSegmentsRef.current.has(seg.segmentId) && seg.utilizationPct < returnThreshold) {
        // Informational alert when returning below recovery threshold (default 60%)
        normalizingAlertsRef.current.set(seg.segmentId, {
          alert: {
            id: `info-return-${seg.segmentId}`,
            type: 'info',
            title: `${seg.segmentName} normalizing`,
            message: `Flow returned to nominal rate at ${seg.utilizationPct}% capacity (below ${returnThreshold}%)`,
          },
          expireSimTime: snap.simTimeSeconds + 30,
        });
      }
    }

    prevCriticalSegmentsRef.current = currentCriticalSet;

    // Append active normalizing alerts that haven't expired
    for (const [segId, item] of normalizingAlertsRef.current.entries()) {
      if (snap.simTimeSeconds >= item.expireSimTime || currentCriticalSet.has(segId)) {
        normalizingAlertsRef.current.delete(segId);
      } else {
        alerts.push(item.alert);
      }
    }

    return alerts.slice(0, 4);
  }, []);

  // Process completed run
  const handleCompletion = useCallback(
    (engine: SimulationEngine) => {
      const result = engine.getResult();
      const currentLog = storeStateRef.current.runLog;
      const nextRunNumber =
        (currentLog.length > 0 ? Math.max(...currentLog.map((r) => r.runNumber)) : 0) + 1;

      const runEntry: RunLogEntry = {
        runId: result.runId,
        configId: storeStateRef.current.map.id,
        timestamp: result.timestamp,
        layoutName: storeStateRef.current.settings.layoutName || 'Layout A',
        runNumber: nextRunNumber,
        spawnRates: { ...storeStateRef.current.settings.spawnRates },
        stickerShare: storeStateRef.current.settings.stickerShare,
        seed: result.seed || currentSeedRef.current,
        throughput: result.totalThroughputVehHr || 0,
        avgWait: result.avgWaitTimeSec || 0,
        avgTransit: result.avgTransitTimeSec || 0,
        maxQueue: result.maxQueueLengthVeh || 0,
        flowEfficiency: result.flowEfficiencyPct || 0,
        spawnedSticker: result.spawnedSticker,
        spawnedNonSticker: result.spawnedNonSticker,
        result,
      };

      addRunLogEntry(runEntry);
      setLastResult(result);
      setStatus('completed');

      const finalSnap = engine.getSnapshot();
      setLiveMetrics(finalSnap.liveMetrics);
      setSegmentOccupancies(finalSnap.segmentOccupancies);
      setSimTimeSeconds(finalSnap.simTimeSeconds);
      setIsGridlocked(!!finalSnap.isGridlocked);
      setGridlockMessage(finalSnap.gridlockMessage || '');
      setActiveEdgeCase(finalSnap.edgeCase || null);

      // Final session alerts
      const peakBottleneck = result.bottlenecks[0];
      setActiveAlerts([
        {
          id: 'peak-bottleneck',
          type: peakBottleneck && peakBottleneck.maxQueueLength > 0 ? 'critical' : 'info',
          title: peakBottleneck && peakBottleneck.maxQueueLength > 0 ? 'Peak bottleneck' : 'Session summary',
          message:
            peakBottleneck && peakBottleneck.maxQueueLength > 0
              ? `${peakBottleneck.segmentName} reached ${peakBottleneck.percentage}% saturation`
              : 'Evaluation session completed with 0 queued bottlenecks',
        },
        {
          id: 'run-finalized',
          type: 'info',
          title: 'Run finalized',
          message: `Evaluation completed: ${result.totalProcessedVehicles} vehicles processed across campus.`,
        },
      ]);
      // Track completed map state to detect stale results on layout/settings edits
      completedMapRef.current = storeStateRef.current.map;
      const s = storeStateRef.current.settings;
      completedSettingsKeyRef.current = JSON.stringify({
        spawnRates: s.spawnRates,
        stickerShare: s.stickerShare,
        defaultSpeedLimit: s.defaultSpeedLimit,
        metersPerUnit: s.metersPerUnit,
        simDurationMin: s.simDurationMin,
      });
      runningMapRef.current = null;
    },
    [addRunLogEntry]
  );

  // Stop simulation and return to idle state
  const stopSimulation = useCallback(() => {
    setStatus('idle');
    engineRef.current = null;
    runningMapRef.current = null;
    completedMapRef.current = null;
    completedSettingsKeyRef.current = '';
    accumulatorRef.current = 0;
    alphaRef.current = 0;
    setSimTimeSeconds(0);
    setLiveMetrics(DEFAULT_METRICS);
    setSegmentOccupancies({});
    setActiveAlerts([]);
    setIsGridlocked(false);
    setGridlockMessage('');
    setActiveEdgeCase(null);
  }, []);

  // Start a new run: if running or paused does nothing; otherwise clears old run display and starts fresh run with new seed on current map
  const startNewRun = useCallback(() => {
    if (statusRef.current === 'running' || statusRef.current === 'paused') {
      return;
    }

    if (!routeValidationRef.current.isValid) {
      return;
    }

    // Reset old run display (same as stopSimulation)
    engineRef.current = null;
    accumulatorRef.current = 0;
    alphaRef.current = 0;
    setSimTimeSeconds(0);
    setLiveMetrics(DEFAULT_METRICS);
    setSegmentOccupancies({});
    setActiveAlerts([]);
    setIsGridlocked(false);
    setGridlockMessage('');
    setActiveEdgeCase(null);

    // Track active map when running started for detecting mid-run edits
    runningMapRef.current = storeStateRef.current.map;
    completedMapRef.current = null;
    completedSettingsKeyRef.current = '';

    const seed = Date.now() & 0xffffffff;
    currentSeedRef.current = seed;

    const engine = createSimulation(
      storeStateRef.current.map,
      storeStateRef.current.settings,
      seed
    );

    engineRef.current = engine;
    accumulatorRef.current = 0;
    lastTimeRef.current = performance.now();
    lastUiUpdateRef.current = performance.now();

    const initialSnap = engine.getSnapshot();
    setLiveMetrics(initialSnap.liveMetrics);
    setSegmentOccupancies(initialSnap.segmentOccupancies);
    setSimTimeSeconds(0);
    setIsGridlocked(!!initialSnap.isGridlocked);
    setGridlockMessage(initialSnap.gridlockMessage || '');
    setActiveEdgeCase(initialSnap.edgeCase || null);
    setActiveAlerts(computeAlerts(initialSnap));

    setStatus('running');
  }, [computeAlerts]);

  // Start simulation alias
  const startSimulation = useCallback(() => {
    startNewRun();
  }, [startNewRun]);

  // Pause simulation
  const pauseSimulation = useCallback(() => {
    setStatus('paused');
  }, []);

  // Resume simulation
  const resumeSimulation = useCallback(() => {
    if (!engineRef.current) {
      startNewRun();
      return;
    }
    lastTimeRef.current = performance.now();
    lastUiUpdateRef.current = performance.now();
    setStatus('running');
  }, [startNewRun]);

  // Automatically clear stale results if map or key settings change after run completion
  useEffect(() => {
    if (status !== 'completed') return;
    if (!completedMapRef.current) return;

    const s = storeState.settings;
    const currentSettingsKey = JSON.stringify({
      spawnRates: s.spawnRates,
      stickerShare: s.stickerShare,
      defaultSpeedLimit: s.defaultSpeedLimit,
      metersPerUnit: s.metersPerUnit,
      simDurationMin: s.simDurationMin,
    });

    const isMapChanged = storeState.map !== completedMapRef.current;
    const isSettingsChanged = currentSettingsKey !== completedSettingsKeyRef.current;

    if (isMapChanged || isSettingsChanged) {
      stopSimulation();
    }
  }, [storeState.map, storeState.settings, status, stopSimulation]);

  // Detect whether map was edited while running or paused
  const isMapEditedWhileRunning = useMemo(() => {
    if (status !== 'running' && status !== 'paused') return false;
    if (!runningMapRef.current) return false;
    return storeState.map !== runningMapRef.current;
  }, [status, storeState.map]);

  const getInterpolationAlpha = useCallback((): number => {
    return alphaRef.current;
  }, []);

  // Synchronous snapshot accessor for 60fps canvas loop
  const getSnapshot = useCallback((): SimSnapshot | null => {
    if (!engineRef.current) return null;
    const snap = engineRef.current.getSnapshot();
    snap.alpha = alphaRef.current;
    return snap;
  }, []);

  // Fixed-timestep animation loop with 500ms throttled UI updates
  useEffect(() => {
    const FIXED_DT = 0.1; // 100ms simulated fixed timestep per sub-step (ENGINE SPEC)

    const frameLoop = (now: number) => {
      const realDtSec = Math.min((now - lastTimeRef.current) / 1000, 0.1);
      lastTimeRef.current = now;

      const engine = engineRef.current;

      if (statusRef.current === 'running' && engine) {
        accumulatorRef.current += realDtSec * simSpeedRef.current;

        // Run fixed physics steps (capped at 30 to support up to 5x speed without dropping steps)
        let stepsRun = 0;
        while (accumulatorRef.current >= FIXED_DT && stepsRun < 30) {
          engine.step(FIXED_DT);
          accumulatorRef.current -= FIXED_DT;
          stepsRun++;

          if (engine.isComplete()) {
            handleCompletion(engine);
            break;
          }
        }

        // Expose accumulator ratio for canvas interpolation
        alphaRef.current = Math.min(1, Math.max(0, accumulatorRef.current / FIXED_DT));

        // Throttle React UI updates to every 500ms
        if (now - lastUiUpdateRef.current >= 500) {
          lastUiUpdateRef.current = now;
          const snap = engine.getSnapshot();
          setSimTimeSeconds(snap.simTimeSeconds);
          setLiveMetrics(snap.liveMetrics);
          setSegmentOccupancies(snap.segmentOccupancies);
          setIsGridlocked(!!snap.isGridlocked);
          setGridlockMessage(snap.gridlockMessage || '');
          setActiveEdgeCase(snap.edgeCase || null);
          setActiveAlerts(computeAlerts(snap));
        }
      }

      animFrameRef.current = requestAnimationFrame(frameLoop);
    };

    lastTimeRef.current = performance.now();
    lastUiUpdateRef.current = performance.now();
    animFrameRef.current = requestAnimationFrame(frameLoop);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [computeAlerts, handleCompletion]);

  // Global Keyboard Shortcuts (Space for pause/resume/start/startNewRun)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (e.code === 'Space' && !isInput) {
        e.preventDefault();
        if (statusRef.current === 'running') {
          pauseSimulation();
        } else if (statusRef.current === 'paused') {
          resumeSimulation();
        } else if (statusRef.current === 'idle' || statusRef.current === 'completed') {
          if (routeValidationRef.current.isValid) {
            startNewRun();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pauseSimulation, resumeSimulation, startNewRun]);

  return (
    <SimulationContext.Provider
      value={{
        status,
        simTimeSeconds,
        isGridlocked,
        gridlockMessage,
        activeEdgeCase,
        liveMetrics,
        segmentOccupancies,
        activeAlerts,
        showHeatmap,
        setShowHeatmap,
        toggleHeatmap,
        simSpeed,
        setSimSpeed,
        lastResult,
        routeValidation,
        startSimulation,
        startNewRun,
        pauseSimulation,
        resumeSimulation,
        stopSimulation,
        getSnapshot,
        getInterpolationAlpha,
        isMapEditedWhileRunning,
        get alpha() {
          return alphaRef.current;
        },
      }}
    >
      {children}
    </SimulationContext.Provider>
  );
};

export function useSimulation(): SimulationContextType {
  const context = useContext(SimulationContext);
  if (!context) {
    throw new Error('useSimulation must be used within a SimulationProvider');
  }
  return context;
}
