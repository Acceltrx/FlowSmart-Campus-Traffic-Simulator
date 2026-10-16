import {
  Point,
  MapConfig,
  SimulationSettings,
  SimulationResult,
  RoadSegment,
  ZoneMarker,
  BottleneckRank,
  AccessType,
  FlowDirection,
} from '../types/traffic';

export type VehicleState = 'moving' | 'queued' | 'waiting' | 'exited';

export interface GraphNode {
  id: string;
  point: Point;
  outgoingEdgeIds: string[];
  incomingEdgeIds: string[];
}

export interface GraphEdge {
  id: string;
  segmentId: string;
  segmentName: string;
  fromNodeId: string;
  toNodeId: string;
  points: Point[];
  lengthPx: number;
  lengthMeters: number;
  lanes: number;
  access: AccessType;
  accessType?: AccessType;
  speedLimitKmH: number;
  speedLimitMS: number;
  isMainRoad: boolean;
}

export interface RoadGraph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  nodePositions: { id: string; point: Point }[];
  entranceNodeMap: Map<string, string>; // entranceId -> nodeId
  exitNodeMap: Map<string, string>; // exitId -> nodeId
  dropoffNodeMap: Map<string, string>; // dropoffId -> nodeId
}

export interface Router {
  route: (
    vehicle: { isSticker: boolean; usesDropoff: boolean },
    graph: RoadGraph,
    entranceMarkerId: string,
    targetExitId?: string
  ) => {
    routeEdges: GraphEdge[];
    routePoints: Point[];
    targetExitId: string;
    dropoffId?: string;
  } | null;
  allowedClasses?: (entranceId: string) => { sticker: boolean; nonSticker: boolean };
}

export interface SimVehicle {
  id: string;
  isSticker: boolean;
  usesDropoff: boolean;
  dropoffId?: string; // drop-off marker this vehicle's route stops at (undefined for direct routes)
  position: Point;
  headingRad: number; // direction angle
  prevPosition: Point;
  prevHeadingRad: number;
  speedMS: number; // speed in meters per second
  speedPxPerSec: number; // speed in pixels per second
  targetSpeedMS: number;
  state: VehicleState;
  currentEdgeIndex: number;
  distanceAlongCurrentEdgeMeters: number;
  routeEdges: GraphEdge[];
  routePoints: Point[];
  currentPointIndex: number;
  enterTimeSec: number;
  exitTimeSec: number | null;
  totalWaitTimeSec: number;
  dwellRemainingSec: number; // For drop-off dwell
  entranceId: string;
  exitId: string;
  yieldingToLeader?: SimVehicle | null;
}

export interface SegmentOccupancy {
  segmentId: string;
  segmentName: string;
  vehicleCount: number;
  queueCount: number;
  capacity: number;
  utilizationPct: number;
  meanWaitSeconds: number;
}

export interface SimLiveMetrics {
  activeVehicles: number;
  totalCompletedVehicles: number;
  throughputVehHr: number;
  avgWaitTimeSec: number;
  avgTransitTimeSec: number;
  maxQueueLengthVeh: number;
  simTimeSeconds: number;
  simDurationSeconds: number;
  blockedSpawnsCount?: number;
  unroutableSpawnsCount?: number;
}

export type SimEdgeCaseType =
  | 'zero-roads'
  | 'no-entrance'
  | 'no-exit'
  | 'no-drop-off'
  | 'no-valid-path'
  | 'all-exits-blocked'
  | 'zero-spawn-rate'
  | 'all-sticker-only'
  | 'all-non-sticker-only'
  | 'gridlock';

export interface EdgeCaseInfo {
  type: SimEdgeCaseType;
  message: string;
}

export interface SimSnapshot {
  simTimeSeconds: number;
  isComplete: boolean;
  isGridlocked?: boolean;
  gridlockMessage?: string;
  edgeCase?: EdgeCaseInfo | null;
  vehicles: SimVehicle[];
  segmentOccupancies: Record<string, SegmentOccupancy>;
  liveMetrics: SimLiveMetrics;
  alpha?: number;
}

export interface SimulationEngine {
  step: (dtSeconds: number) => void;
  getSnapshot: () => SimSnapshot;
  isComplete: () => boolean;
  isGridlocked?: () => boolean;
  getEdgeCase?: () => EdgeCaseInfo | null;
  getResult: () => SimulationResult;
  findLeader: (vehicle: SimVehicle) => { leader: SimVehicle; netGapMeters: number } | null;
}

