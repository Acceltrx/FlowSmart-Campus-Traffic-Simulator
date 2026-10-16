/**
 * FlowSmart - Core traffic simulation type definitions
 * Conforms strictly to PRD v1.4 and visual guidelines.
 */

export interface Point {
  x: number;
  y: number;
}

export type FlowDirection = 'one-way' | 'two-way';
export type AccessType = 'shared' | 'sticker-only' | 'non-sticker-only';
export type ZoneType = 'entrance' | 'exit' | 'dropoff';
export type ActiveTab = 'map-setup' | 'simulation' | 'results';
export type SimulationStatus = 'idle' | 'running' | 'paused' | 'completed';

export interface RoadSegment {
  id: string;
  name: string;
  points: Point[];
  flowDirection: FlowDirection;
  accessType: AccessType;
  speedLimitKmH: number;
  capacity?: number;
  lanes?: number;
  lengthMeters?: number;
}

export interface ZoneMarker {
  id: string;
  name: string;
  type: ZoneType;
  position: Point;
  roadSegmentId?: string;
  capacity?: number;
  targetTimeMin?: number;
}

export interface MapBounds {
  width: number;
  height: number;
}

export interface SpawnRates {
  [entranceId: string]: number; // vehicles per minute
}

export interface SimulationSettings {
  defaultSpeedLimit: number; // default 10 km/h
  spawnRates: SpawnRates;
  stickerShare: number; // default 0.7 (70%)
  metersPerUnit: number; // scale calibration (meters per canvas unit)
  vehicleLengthMeters?: number; // default 4.5 m
  standstillGapMeters?: number; // default 2.0 m
  simDurationMin: number; // default 30 minutes
  layoutName: string; // e.g. 'Layout A'
  dropoffShare?: number; // default 1.0
  alertWaitThresholdSec?: number; // default 120 s
  alertUtilThresholdPct?: number; // default 80 %
  alertUtilDurationSec?: number; // default 30 s
  alertReturnUtilPct?: number; // default 60 %
}

export interface MapConfig {
  id: string;
  layoutName: string;
  roadSegments: RoadSegment[];
  zoneMarkers: ZoneMarker[];
  bounds: MapBounds;
  referenceImageName?: string;
  sourceFileName?: string;
  referenceImageDimensions?: { width: number; height: number };
  settings?: SimulationSettings;
}

export interface BottleneckRank {
  segmentId: string;
  segmentName: string;
  maxQueueLength: number;
  severity: 'critical' | 'moderate' | 'clear';
  percentage: number;
}

export interface SimulationResult {
  runId: string;
  runNumber: number;
  timestamp: string;
  layoutName: string;
  totalThroughputVehHr: number;
  avgWaitTimeSec: number;
  avgTransitTimeSec: number;
  maxQueueLengthVeh: number;
  maxQueueLocation: string;
  flowEfficiencyPct: number;
  configuredMaxCapacity?: number;
  totalProcessedVehicles: number;
  unfinishedVehiclesCount?: number;
  blockedSpawnsCount?: number;
  unroutableSpawnsCount?: number;
  isGridlocked?: boolean;
  gridlockMessage?: string;
  seed?: number;
  bottlenecks: BottleneckRank[];
  segmentMaxQueue?: { segmentId: string; maxQueueLength: number }[];
  segmentUtilization?: { segmentId: string; utilizationPct: number }[];
  spawnedSticker?: number;
  spawnedNonSticker?: number;
}

export interface RunLogEntry {
  runId: string;
  configId?: string;
  timestamp: string;
  layoutName: string;
  runNumber: number;
  spawnRates: SpawnRates;
  stickerShare: number;
  seed?: number;
  throughput: number;
  avgWait: number;
  avgTransit: number;
  maxQueue: number;
  flowEfficiency: number;
  spawnedSticker?: number;
  spawnedNonSticker?: number;
  result?: SimulationResult;
}
