/**
 * FlowSmart - Global State Management
 * Handles settings, map configuration, simulation logs, and LocalStorage persistence.
 * Conforms to PRD v1.4 section 3.1.1:
 * - Bumped storage version to 1.4.0
 * - Reference image is session-only (never saved to LocalStorage or exported JSON)
 * - Drops any embedded baseMapImage / imageUrl from older stored versions
 * - Stores only referenceImageName on map
 */

import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  useState,
  ReactNode,
} from 'react';
import { registerCurrentMap } from '../components/common/ErrorBoundary';
import {
  MapConfig,
  SimulationSettings,
  RunLogEntry,
  ActiveTab,
  SimulationStatus,
  RoadSegment,
} from '../types/traffic';

import { SAMPLE_MAP } from '../utils/sampleMap';
import { DEFAULT_METERS_PER_UNIT, clampSpeedKmH, DEFAULT_SPEED_KMH } from '../utils/scale';
import { migrateDropoffShare, sanitizeDestinationSplits } from '../utils/destinationSplit';

const STORAGE_KEY_MAP = 'flowsmart.map';
const STORAGE_KEY_SETTINGS = 'flowsmart.settings';
const STORAGE_KEY_RUNLOG = 'flowsmart.runlog';
const STORAGE_KEY_VERSION = 'flowsmart.version';
export const CURRENT_STORAGE_VERSION = '1.4.0';

// Default DBTC campus settings
export const DEFAULT_SETTINGS: SimulationSettings = {
  defaultSpeedLimit: DEFAULT_SPEED_KMH, // 10 km/h
  spawnRates: {
    'gate-1': 18, // veh/min Gate 1 (main)
    'gate-2': 12, // veh/min Gate 2 (east)
  },
  stickerShare: 0.7, // 70% sticker-holding vehicles
  metersPerUnit: DEFAULT_METERS_PER_UNIT,
  vehicleLengthMeters: 4.5,
  standstillGapMeters: 2.0,
  simDurationMin: 30,
  layoutName: 'Layout A',
  dropoffPatienceSec: 30,
  dropoffPatienceSpreadSec: 20,
  dropoffDwellMinSec: 20,
  dropoffDwellMaxSec: 60,
  alertWaitThresholdSec: 120,
  alertUtilThresholdPct: 80,
  alertUtilDurationSec: 30,
  alertReturnUtilPct: 60,
};

function clampOrDefault(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Clamps the drop-off settings to their allowed ranges. Missing or non-numeric values get the defaults.
 * dropoffShare 0 to 1, patience 5 to 300 s, spread 0 to 120 s, dwell min/max 5 to 300 s (max is raised to min if lower).
 * Returns a new object; other settings are left untouched.
 */
export function sanitizeDropoffSettings<T extends Partial<SimulationSettings>>(settings: T): T {
  const dwellMin = clampOrDefault(settings.dropoffDwellMinSec, 5, 300, DEFAULT_SETTINGS.dropoffDwellMinSec!);
  const dwellMax = clampOrDefault(settings.dropoffDwellMaxSec, 5, 300, DEFAULT_SETTINGS.dropoffDwellMaxSec!);
  return {
    ...settings,
    dropoffPatienceSec: clampOrDefault(settings.dropoffPatienceSec, 5, 300, DEFAULT_SETTINGS.dropoffPatienceSec!),
    dropoffPatienceSpreadSec: clampOrDefault(
      settings.dropoffPatienceSpreadSec,
      0,
      120,
      DEFAULT_SETTINGS.dropoffPatienceSpreadSec!
    ),
    dropoffDwellMinSec: dwellMin,
    dropoffDwellMaxSec: Math.max(dwellMin, dwellMax),
  };
}

// Initial default campus map specification using the 14-segment network
export const DEFAULT_MAP: MapConfig = SAMPLE_MAP;

export interface State {
  map: MapConfig;
  settings: SimulationSettings;
  runLog: RunLogEntry[];
  activeTab: ActiveTab;
  simulationStatus: SimulationStatus;
  selectedSegmentId: string | null;
  simSpeed: number;
  referenceImageUrl: string | null; // Session-only object URL
}

type Action =
  | { type: 'SET_TAB'; payload: ActiveTab }
  | { type: 'SET_SIM_STATUS'; payload: SimulationStatus }
  | { type: 'SET_SIM_SPEED'; payload: number }
  | { type: 'SELECT_SEGMENT'; payload: string | null }
  | { type: 'UPDATE_SETTINGS'; payload: Partial<SimulationSettings> }
  | { type: 'UPDATE_MAP'; payload: MapConfig }
  | { type: 'SET_REFERENCE_IMAGE_URL'; payload: string | null }
  | { type: 'LOAD_SAMPLE_MAP' }
  | { type: 'ADD_RUN_LOG'; payload: RunLogEntry }
  | { type: 'RESET_ALL' };

let sessionWarned = false;
let sessionDismissed = false;
let initialWriteFailed = false;
let initialSpeedAdjusted = false;

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const item = localStorage.getItem(key);
    if (item) {
      return JSON.parse(item) as T;
    }
  } catch (error) {
    console.warn(`Unable to read ${key} from LocalStorage`, error);
  }
  return fallback;
}

function getInitialState(): State {
  // Bump LocalStorage version and drop legacy embedded data if needed
  try {
    const storedVersion = localStorage.getItem(STORAGE_KEY_VERSION);
    if (storedVersion !== CURRENT_STORAGE_VERSION) {
      localStorage.setItem(STORAGE_KEY_VERSION, CURRENT_STORAGE_VERSION);
    }
  } catch (e) {
    console.warn('LocalStorage version check failed', e);
    initialWriteFailed = true;
  }

  // Load map and strip any older embedded image data
  const rawMap = loadFromStorage<Record<string, unknown> | null>(STORAGE_KEY_MAP, null);
  let map: MapConfig;
  if (rawMap && typeof rawMap === 'object') {
    // Drop embedded base64 image data
    delete rawMap.baseMapImage;
    delete rawMap.imageUrl;
    delete rawMap.referenceImageUrl;

    // Migrate old saved data: metersPerPixel becomes metersPerUnit
    if (rawMap.metersPerPixel !== undefined) {
      if (!rawMap.settings) {
        rawMap.settings = { ...DEFAULT_SETTINGS };
      }
      if (typeof rawMap.settings === 'object' && !(rawMap.settings as Record<string, unknown>).metersPerUnit) {
        (rawMap.settings as Record<string, unknown>).metersPerUnit = rawMap.metersPerPixel;
      }
      delete rawMap.metersPerPixel;
    }
    if (rawMap.settings && typeof rawMap.settings === 'object') {
      const s = rawMap.settings as Record<string, unknown>;
      if (s.metersPerPixel !== undefined) {
        if (s.metersPerUnit === undefined) {
          s.metersPerUnit = s.metersPerPixel;
        }
        delete s.metersPerPixel;
      }
      if (s.defaultSpeedLimit !== undefined) {
        const originalSpeed = s.defaultSpeedLimit;
        const clamped = clampSpeedKmH(originalSpeed);
        if (originalSpeed !== clamped) {
          initialSpeedAdjusted = true;
        }
        s.defaultSpeedLimit = clamped;
      }
      rawMap.settings = sanitizeDropoffSettings(s as Partial<SimulationSettings>);
    }

    // Migrate referenceImageName from sourceFileName if needed
    if (!rawMap.referenceImageName && typeof rawMap.sourceFileName === 'string') {
      rawMap.referenceImageName = rawMap.sourceFileName;
    }

    // Clamp speed limits on all road segments loaded from LocalStorage
    if (Array.isArray(rawMap.roadSegments)) {
      rawMap.roadSegments = (rawMap.roadSegments as RoadSegment[]).map((seg) => {
        const originalSpeed = seg.speedLimitKmH;
        const clamped = clampSpeedKmH(originalSpeed);
        if (originalSpeed !== clamped) {
          initialSpeedAdjusted = true;
        }
        return {
          ...seg,
          speedLimitKmH: clamped,
        };
      });
    }

    map = rawMap as unknown as MapConfig;
  } else {
    map = DEFAULT_MAP;
  }

  const rawSettings = loadFromStorage<Record<string, unknown> | null>(STORAGE_KEY_SETTINGS, null);
  let settings: SimulationSettings;
  if (rawSettings && typeof rawSettings === 'object') {
    if (rawSettings.metersPerPixel !== undefined) {
      if (rawSettings.metersPerUnit === undefined) {
        rawSettings.metersPerUnit = rawSettings.metersPerPixel;
      }
      delete rawSettings.metersPerPixel;
    }
    if (rawSettings.defaultSpeedLimit !== undefined) {
      const originalSpeed = rawSettings.defaultSpeedLimit;
      const clamped = clampSpeedKmH(originalSpeed);
      if (originalSpeed !== clamped) {
        initialSpeedAdjusted = true;
      }
      rawSettings.defaultSpeedLimit = clamped;
    }
    settings = sanitizeDropoffSettings({ ...DEFAULT_SETTINGS, ...rawSettings } as SimulationSettings);
  } else {
    settings = DEFAULT_SETTINGS;
  }

  // Ensure map.settings has metersPerUnit and settings is synced with single field
  if (!map.settings) {
    map.settings = { ...settings };
  } else {
    if (map.settings.metersPerUnit === undefined) {
      map.settings.metersPerUnit = settings.metersPerUnit ?? DEFAULT_METERS_PER_UNIT;
    }
    settings.metersPerUnit = map.settings.metersPerUnit;
  }

  settings.defaultSpeedLimit = clampSpeedKmH(settings.defaultSpeedLimit);
  migrateDropoffShare(settings, map);
  settings.destinationSplits = sanitizeDestinationSplits(settings.destinationSplits, map);

  if (map.settings) {
    map.settings.defaultSpeedLimit = clampSpeedKmH(map.settings.defaultSpeedLimit);
    map.settings = sanitizeDropoffSettings(map.settings);
    migrateDropoffShare(map.settings, map);
    map.settings.destinationSplits = sanitizeDestinationSplits(map.settings.destinationSplits, map);
  }

  registerCurrentMap(map);

  return {
    map,
    settings,
    runLog: loadFromStorage<RunLogEntry[]>(STORAGE_KEY_RUNLOG, []),
    activeTab: 'simulation',
    simulationStatus: 'idle',
    selectedSegmentId: 'seg-4',
    simSpeed: 1,
    referenceImageUrl: null, // Session-only, never persisted
  };
}

function trafficReducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_TAB':
      return { ...state, activeTab: action.payload };

    case 'SET_SIM_STATUS':
      if (state.simulationStatus === action.payload) return state;
      return { ...state, simulationStatus: action.payload };

    case 'SET_SIM_SPEED':
      return { ...state, simSpeed: action.payload };

    case 'SELECT_SEGMENT':
      return { ...state, selectedSegmentId: action.payload };

    case 'UPDATE_SETTINGS': {
      const sanitized = { ...action.payload };
      if (sanitized.defaultSpeedLimit !== undefined) {
        sanitized.defaultSpeedLimit = clampSpeedKmH(sanitized.defaultSpeedLimit);
      }
      if (sanitized.destinationSplits !== undefined) {
        sanitized.destinationSplits = sanitizeDestinationSplits(sanitized.destinationSplits, state.map);
      }
      const newSettings = sanitizeDropoffSettings({ ...state.settings, ...sanitized });
      const updatedMap = {
        ...state.map,
        settings: {
          ...(state.map.settings || DEFAULT_SETTINGS),
          ...newSettings,
        },
      };
      return { ...state, settings: newSettings, map: updatedMap };
    }

    case 'UPDATE_MAP': {
      // Ensure incoming map never contains embedded image data
      const cleanMap = { ...action.payload };
      delete (cleanMap as Record<string, unknown>).baseMapImage;
      delete (cleanMap as Record<string, unknown>).imageUrl;
      if (Array.isArray(cleanMap.roadSegments)) {
        cleanMap.roadSegments = cleanMap.roadSegments.map((seg) => ({
          ...seg,
          speedLimitKmH: clampSpeedKmH(seg.speedLimitKmH),
        }));
      }
      if (cleanMap.settings?.defaultSpeedLimit !== undefined) {
        cleanMap.settings.defaultSpeedLimit = clampSpeedKmH(cleanMap.settings.defaultSpeedLimit);
      }
      // Sync metersPerUnit if present on map.settings
      const newMeters = cleanMap.settings?.metersPerUnit ?? state.settings.metersPerUnit;
      const syncedSettings: SimulationSettings = {
        ...state.settings,
        ...(cleanMap.settings || {}),
        defaultSpeedLimit: clampSpeedKmH(cleanMap.settings?.defaultSpeedLimit ?? state.settings.defaultSpeedLimit),
        metersPerUnit: newMeters,
      };
      migrateDropoffShare(syncedSettings, cleanMap);
      syncedSettings.destinationSplits = sanitizeDestinationSplits(
        cleanMap.settings?.destinationSplits ?? state.settings.destinationSplits,
        cleanMap
      );
      const finalSettings = sanitizeDropoffSettings(syncedSettings);
      cleanMap.settings = finalSettings;
      return { ...state, map: cleanMap, settings: finalSettings };
    }

    case 'SET_REFERENCE_IMAGE_URL':
      return { ...state, referenceImageUrl: action.payload };

    case 'LOAD_SAMPLE_MAP':
      return {
        ...state,
        map: SAMPLE_MAP,
        settings: {
          ...state.settings,
          spawnRates: {
            'gate-1': 18,
            'gate-2': 12,
          },
        },
      };

    case 'ADD_RUN_LOG': {
      const updatedLog = [action.payload, ...state.runLog];
      return { ...state, runLog: updatedLog };
    }

    case 'RESET_ALL':
      if (state.referenceImageUrl) {
        try {
          URL.revokeObjectURL(state.referenceImageUrl);
        } catch {
          // ignore
        }
      }
      return {
        map: DEFAULT_MAP,
        settings: DEFAULT_SETTINGS,
        runLog: [],
        activeTab: 'map-setup',
        simulationStatus: 'idle',
        selectedSegmentId: null,
        simSpeed: 1,
        referenceImageUrl: null,
      };

    default:
      return state;
  }
}

interface TrafficStoreContextType {
  state: State;
  dispatch: React.Dispatch<Action>;
  setActiveTab: (tab: ActiveTab) => void;
  updateSettings: (settings: Partial<SimulationSettings>) => void;
  updateMap: (map: MapConfig) => void;
  setReferenceImageUrl: (url: string | null) => void;
  addRunLogEntry: (entry: RunLogEntry) => void;
  resetAll: () => void;
  loadSampleMap: () => void;
  setSimulationStatus: (status: SimulationStatus) => void;
  storageWarning: boolean;
  dismissStorageWarning: () => void;
  speedAdjustedNotice: boolean;
  setSpeedAdjustedNotice: (show: boolean) => void;
  dismissSpeedAdjustedNotice: () => void;
}

const TrafficStoreContext = createContext<TrafficStoreContextType | undefined>(undefined);

export const TrafficStoreProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(trafficReducer, undefined, getInitialState);
  const isResetRef = React.useRef(false);
  const [storageWarning, setStorageWarning] = useState<boolean>(() => {
    return initialWriteFailed && !sessionDismissed;
  });
  const [speedAdjustedNotice, setSpeedAdjustedNotice] = useState<boolean>(() => initialSpeedAdjusted);

  const dismissSpeedAdjustedNotice = useCallback(() => {
    setSpeedAdjustedNotice(false);
  }, []);

  const notifyWriteFailure = useCallback(() => {
    if (!sessionDismissed && !sessionWarned) {
      sessionWarned = true;
      setStorageWarning(true);
    }
  }, []);

  const dismissStorageWarning = useCallback(() => {
    sessionDismissed = true;
    setStorageWarning(false);
  }, []);

  // Auto-save Map changes to LocalStorage (without any embedded images)
  useEffect(() => {
    registerCurrentMap(state.map);
    if (isResetRef.current) return;
    try {
      const cleanMap = { ...state.map };
      delete (cleanMap as Record<string, unknown>).baseMapImage;
      delete (cleanMap as Record<string, unknown>).imageUrl;
      delete (cleanMap as Record<string, unknown>).referenceImageUrl;
      localStorage.setItem(STORAGE_KEY_MAP, JSON.stringify(cleanMap));
    } catch (e) {
      console.warn('Failed saving map to LocalStorage', e);
      notifyWriteFailure();
    }
  }, [state.map, notifyWriteFailure]);

  // Auto-save Settings to LocalStorage
  useEffect(() => {
    if (isResetRef.current) return;
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(state.settings));
    } catch (e) {
      console.warn('Failed saving settings to LocalStorage', e);
      notifyWriteFailure();
    }
  }, [state.settings, notifyWriteFailure]);

  // Auto-save Run Log to LocalStorage
  useEffect(() => {
    if (isResetRef.current) return;
    try {
      localStorage.setItem(STORAGE_KEY_RUNLOG, JSON.stringify(state.runLog));
    } catch (e) {
      console.warn('Failed saving runLog to LocalStorage', e);
      notifyWriteFailure();
    }
  }, [state.runLog, notifyWriteFailure]);

  const resetAll = useCallback(() => {
    isResetRef.current = true;
    try {
      localStorage.removeItem(STORAGE_KEY_MAP);
      localStorage.removeItem(STORAGE_KEY_SETTINGS);
      localStorage.removeItem(STORAGE_KEY_RUNLOG);
      localStorage.removeItem(STORAGE_KEY_VERSION);
    } catch (e) {
      console.warn('Failed clearing LocalStorage', e);
      notifyWriteFailure();
    }
    dispatch({ type: 'RESET_ALL' });
    setTimeout(() => {
      isResetRef.current = false;
    }, 100);
  }, [notifyWriteFailure]);

  const loadSampleMap = useCallback(() => {
    dispatch({ type: 'LOAD_SAMPLE_MAP' });
  }, []);

  const setActiveTab = useCallback((tab: ActiveTab) => {
    dispatch({ type: 'SET_TAB', payload: tab });
  }, []);

  const updateSettings = useCallback((settings: Partial<SimulationSettings>) => {
    dispatch({ type: 'UPDATE_SETTINGS', payload: settings });
  }, []);

  const updateMap = useCallback((map: MapConfig) => {
    dispatch({ type: 'UPDATE_MAP', payload: map });
  }, []);

  const setReferenceImageUrl = useCallback((url: string | null) => {
    dispatch({ type: 'SET_REFERENCE_IMAGE_URL', payload: url });
  }, []);

  const addRunLogEntry = useCallback((entry: RunLogEntry) => {
    dispatch({ type: 'ADD_RUN_LOG', payload: entry });
  }, []);

  const setSimulationStatus = useCallback((status: SimulationStatus) => {
    dispatch({ type: 'SET_SIM_STATUS', payload: status });
  }, []);

  return (
    <TrafficStoreContext.Provider
      value={{
        state,
        dispatch,
        setActiveTab,
        updateSettings,
        updateMap,
        setReferenceImageUrl,
        addRunLogEntry,
        resetAll,
        loadSampleMap,
        setSimulationStatus,
        storageWarning,
        dismissStorageWarning,
        speedAdjustedNotice,
        setSpeedAdjustedNotice,
        dismissSpeedAdjustedNotice,
      }}
    >
      {children}
    </TrafficStoreContext.Provider>
  );
};

export function useTrafficStore(): TrafficStoreContextType {
  const context = useContext(TrafficStoreContext);
  if (!context) {
    throw new Error('useTrafficStore must be used within a TrafficStoreProvider');
  }
  return context;
}
