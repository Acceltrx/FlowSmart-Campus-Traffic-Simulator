/**
 * FlowSmart - Pure Simulation Engine Public API
 */

export { createSimulation } from './engine';
export {
  buildRoadGraph,
  planFullVehicleRoute,
  DrawnPathRouter,
} from './graph';
export type {
  DrawnRoute,
  EntranceRouteSet,
  EntranceValidationSummary,
  RouteValidationResult,
} from './graph';
export { generateActionableInsights } from './insights';
export type { ActionableInsight } from './insights';
export type {
  SimVehicle,
  VehicleState,
  SimSnapshot,
  SegmentOccupancy,
  SimLiveMetrics,
  SimulationEngine,
  GraphEdge,
  GraphNode,
  RoadGraph,
  Router,
} from './types';
