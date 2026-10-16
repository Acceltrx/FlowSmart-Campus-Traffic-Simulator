/**
 * FlowSmart - Pure Simulation Engine
 * Core traffic simulation without React or DOM dependencies.
 * Conforms strictly to PRD v1.4 and ENGINE SPEC:
 * - Drawn-path following (replaces Dijkstra / shortest-path routing).
 * - Fixed timestep dt = 0.1 s of simulated time.
 * - Seeded RNG (mulberry32) stored with every run.
 * - Scale: metersPerUnit converts drawn pixels to meters. Speed limit converted to m/s.
 * - Vehicle length 4.5 m, minimum standstill gap 2 m (effective space 6.5 m).
 * - Graph with road splitting at shared nodes, directed edges, length, lanes, access, speed limit.
 * - Poisson entrance spawning with exponential inter-arrival time. Free-space check at entrance (skip & count blocked).
 * - DrawnPathRouter builds loop-free drawn paths (entrance -> drop-off -> exit, or entrance -> exit direct).
 * - Sticker and non-sticker vehicle access rules (non-sticker excluded from sticker-only edges).
 * - Drop-off: 20-60 s uniform dwell, capacity max 2 vehicles, others queue behind.
 * - IDM-style car following with spatial lookup by edge (O(n)).
 * - Collision handling: no overtaking, no overlap. Entering vehicles wait for length + gap.
 * - Merging arbitration: side roads yield to main roads within 15 m / 3 s; FIFO for equal roads.
 * - Configured max capacity computed from routes with fewest edges across entrances.
 * - Gridlock detection: stops run & flags if no vehicle moved for 120 simulated seconds.
 * - Complete metrics: live throughput (last 5 min x 12), avgWait, avgTransit, segmentUtilizationPct, flowEfficiency.
 */

import {
  MapConfig,
  SimulationSettings,
  SimulationResult,
  Point,
  BottleneckRank,
} from '../types/traffic';
import {
  SimVehicle,
  SimSnapshot,
  SegmentOccupancy,
  SimLiveMetrics,
  SimulationEngine,
  EdgeCaseInfo,
  GraphEdge,
  RoadGraph,
  Router,
} from './types';
import { buildRoadGraph, DrawnPathRouter } from './graph';
import { distance } from '../utils/mapGeometry';
import { getMetersPerUnit } from '../utils/scale';

// Seeded pseudo-random number generator (Mulberry32)
function createRng(seed: number = 42) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Helper to get polyline coordinate and heading along an edge
 */
export function getPointAndHeadingAlongEdge(
  edge: GraphEdge,
  distanceAlongMeters: number,
  metersPerUnit: number = 0.2
): { point: Point; headingRad: number } {
  const pts = edge.points;
  if (pts.length < 2) {
    return { point: pts[0] || { x: 0, y: 0 }, headingRad: 0 };
  }

  const pixelsPerMeter = 1 / (metersPerUnit > 0 ? metersPerUnit : 0.2);
  const distPx = distanceAlongMeters * pixelsPerMeter;
  let accumulatedPx = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const segmentLen = Math.max(distance(p1, p2), 0.001);

    if (accumulatedPx + segmentLen >= distPx || i === pts.length - 2) {
      const remaining = Math.max(0, distPx - accumulatedPx);
      const ratio = Math.min(1, Math.max(0, remaining / segmentLen));
      const x = p1.x + (p2.x - p1.x) * ratio;
      const y = p1.y + (p2.y - p1.y) * ratio;
      const headingRad = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      return { point: { x, y }, headingRad };
    }

    accumulatedPx += segmentLen;
  }

  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  return { point: last, headingRad: Math.atan2(last.y - prev.y, last.x - prev.x) };
}

/**
 * Returns the vehicle center and heading: the point VEHICLE_LENGTH_M / 2 behind the front bumper,
 * measured along the route.
 * If the front is less than half a car length into the current edge, continue backward through
 * v.routeEdges[currentEdgeIndex - 1] and earlier edges; if there are none, extrapolate backward
 * along the first edge's direction.
 */
export function getVehicleRenderPose(
  vehicle: SimVehicle,
  vehicleLengthM: number = 4.5,
  metersPerUnit: number = 0.2
): { point: Point; headingRad: number } {
  const edges = vehicle.routeEdges;
  if (!edges || edges.length === 0) {
    return { point: vehicle.position, headingRad: vehicle.headingRad };
  }

  const halfLengthM = vehicleLengthM / 2;
  const currDist = vehicle.distanceAlongCurrentEdgeMeters;

  // Case 1: Front bumper is far enough into current edge
  if (currDist >= halfLengthM) {
    const currentEdge = edges[vehicle.currentEdgeIndex] || edges[0];
    return getPointAndHeadingAlongEdge(currentEdge, currDist - halfLengthM, metersPerUnit);
  }

  // Case 2: Walk backward along previous edges in the route
  let remainingBackM = halfLengthM - currDist;
  let edgeIdx = vehicle.currentEdgeIndex - 1;

  while (edgeIdx >= 0) {
    const prevEdge = edges[edgeIdx];
    if (prevEdge.lengthMeters >= remainingBackM) {
      return getPointAndHeadingAlongEdge(
        prevEdge,
        prevEdge.lengthMeters - remainingBackM,
        metersPerUnit
      );
    }
    remainingBackM -= prevEdge.lengthMeters;
    edgeIdx--;
  }

  // Case 3: Extrapolate backward along the first edge's direction
  const firstEdge = edges[0];
  const pts = firstEdge.points;
  if (pts.length < 2) {
    return { point: pts[0] || { x: 0, y: 0 }, headingRad: 0 };
  }

  const p0 = pts[0];
  const p1 = pts[1];
  const headingRad = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  const remainingBackUnits = remainingBackM / (metersPerUnit > 0 ? metersPerUnit : 0.2);

  const x = p0.x - Math.cos(headingRad) * remainingBackUnits;
  const y = p0.y - Math.sin(headingRad) * remainingBackUnits;

  return {
    point: { x, y },
    headingRad,
  };
}

/**
 * findLeader(vehicle, vehiclesByEdge, vehicleLengthM) returns { leader, netGapMeters } or null.
 * - Same edge: the next vehicle ahead in vehiclesByEdge (list is sorted by distance, largest first).
 *   netGap = leader.dist - v.dist - VEHICLE_LENGTH_M.
 * - Otherwise walk forward through v.routeEdges starting at currentEdgeIndex + 1.
 *   Accumulate distance = (current edge length - v.dist) + lengths of fully passed edges.
 *   On the first edge that has vehicles, the leader is its REARMOST vehicle (last in the list).
 *   netGap = accumulated + leader.dist - VEHICLE_LENGTH_M.
 * - Stop looking after 80 m of road or the end of the route. Return null if nothing is found.
 * Clamps netGap to 0 at the minimum.
 */
export function findLeader(
  vehicle: {
    routeEdges: GraphEdge[];
    currentEdgeIndex: number;
    distanceAlongCurrentEdgeMeters: number;
  },
  vehiclesByEdge: Map<string, SimVehicle[]>,
  vehicleLengthM: number = 4.5
): { leader: SimVehicle; netGapMeters: number } | null {
  const edges = vehicle.routeEdges;
  if (
    !edges ||
    edges.length === 0 ||
    vehicle.currentEdgeIndex < 0 ||
    vehicle.currentEdgeIndex >= edges.length
  ) {
    return null;
  }

  const currentEdge = edges[vehicle.currentEdgeIndex];
  if (!currentEdge) return null;

  const edgeVehicles = vehiclesByEdge.get(currentEdge.id) || [];
  const myIdx = edgeVehicles.indexOf(vehicle as SimVehicle);

  // 1. Same edge: the next vehicle ahead in vehiclesByEdge (list is sorted by distance, largest first)
  let sameEdgeLeader: SimVehicle | null = null;
  if (myIdx > 0) {
    sameEdgeLeader = edgeVehicles[myIdx - 1];
  } else if (myIdx === -1 && edgeVehicles.length > 0) {
    // Synthetic or unlisted vehicle (e.g. spawn check at distance 0)
    for (let k = edgeVehicles.length - 1; k >= 0; k--) {
      if (edgeVehicles[k].distanceAlongCurrentEdgeMeters >= vehicle.distanceAlongCurrentEdgeMeters) {
        sameEdgeLeader = edgeVehicles[k];
        break;
      }
    }
  }

  if (sameEdgeLeader) {
    const rawGap = sameEdgeLeader.distanceAlongCurrentEdgeMeters - vehicle.distanceAlongCurrentEdgeMeters;
    if (rawGap > 80) {
      return null;
    }
    const netGap = Math.max(0, rawGap - vehicleLengthM);
    return { leader: sameEdgeLeader, netGapMeters: netGap };
  }

  // 2. Otherwise walk forward through v.routeEdges starting at currentEdgeIndex + 1.
  // Accumulate distance = (current edge length - v.dist) + lengths of fully passed edges.
  let accumulated = Math.max(0, currentEdge.lengthMeters - vehicle.distanceAlongCurrentEdgeMeters);
  if (accumulated > 80) {
    return null;
  }

  for (let nextIdx = vehicle.currentEdgeIndex + 1; nextIdx < edges.length; nextIdx++) {
    const nextEdge = edges[nextIdx];
    const nextVehicles = vehiclesByEdge.get(nextEdge.id);
    if (nextVehicles && nextVehicles.length > 0) {
      // On the first edge that has vehicles, the leader is its REARMOST vehicle (last in the list)
      const leader = nextVehicles[nextVehicles.length - 1];
      const totalDist = accumulated + leader.distanceAlongCurrentEdgeMeters;
      if (totalDist > 80) {
        return null;
      }
      const netGap = Math.max(0, totalDist - vehicleLengthM);
      return { leader, netGapMeters: netGap };
    }
    accumulated += nextEdge.lengthMeters;
    if (accumulated > 80) {
      return null;
    }
  }

  return null;
}
export function createSimulation(
  mapConfig: MapConfig,
  settings: SimulationSettings,
  seed: number = 42,
  customRouter?: Router
): SimulationEngine {
  const rng = createRng(seed);

  // Scale calibration (single scale value: meters per canvas unit)
  const metersPerUnit = getMetersPerUnit(mapConfig, settings);
  const pixelsPerMeter = 1 / metersPerUnit;

  // Build directed road graph
  const graph: RoadGraph = buildRoadGraph(mapConfig, undefined, metersPerUnit);

  // Router instance: uses DrawnPathRouter by default
  const router: Router =
    customRouter ?? new DrawnPathRouter(mapConfig, graph, rng);

  // Vehicle geometry
  const VEHICLE_LENGTH_M = settings.vehicleLengthMeters ?? 4.5;
  const STANDSTILL_GAP_M = settings.standstillGapMeters ?? 2.0;
  const EFFECTIVE_SPACE_M = VEHICLE_LENGTH_M + STANDSTILL_GAP_M; // 6.5 m

  // Simulation time parameters
  const durationSeconds = (settings.simDurationMin || 30) * 60;
  const maxSimTimeWithGrace = durationSeconds + 10 * 60; // 10 extra minutes for campus to clear
  const stickerShare = settings.stickerShare !== undefined ? settings.stickerShare : 0.7;
  const dropoffShare =
    (settings as unknown as { dropoffShare?: number }).dropoffShare !== undefined
      ? (settings as unknown as { dropoffShare?: number }).dropoffShare!
      : 1.0;

  let simTime = 0;
  let vehicleIdCounter = 0;
  let spawnedStickerCount = 0;
  let spawnedNonStickerCount = 0;
  let isRunCompleted = false;

  // Active campus vehicles
  const activeVehicles: SimVehicle[] = [];

  // Spatial lookup by edge: edgeId -> sorted array of vehicles (index 0 is furthest along edge)
  const vehiclesByEdge = new Map<string, SimVehicle[]>();

  // Completed vehicle log
  const completedVehicles: {
    enterTime: number;
    exitTime: number;
    transitTime: number;
    waitTime: number;
    isSticker: boolean;
  }[] = [];

  // Counters for diagnostics
  let blockedSpawnsCount = 0;
  let unroutableSpawnsCount = 0;

  // Drop-off bay management: track active vehicles dwelling at each drop-off marker (max capacity = 2)
  const dropoffDwellers = new Map<string, Set<string>>();
  for (const m of mapConfig.zoneMarkers) {
    if (m.type === 'dropoff') {
      dropoffDwellers.set(m.id, new Set<string>());
    }
  }

  // Merge arbitration tracking by node: nodeId -> incomingEdgeId of last merged vehicle
  const lastMergedEdgeByNode = new Map<string, string>();

  // Segment metrics tracking: peak queue and high utilization timers
  const peakQueuesBySegment = new Map<string, number>();
  const segmentHighUtilTimers = new Map<string, number>();
  const segmentAlertStates = new Map<string, 'critical' | 'normal'>();

  for (const seg of mapConfig.roadSegments) {
    peakQueuesBySegment.set(seg.id, 0);
    segmentHighUtilTimers.set(seg.id, 0);
    segmentAlertStates.set(seg.id, 'normal');
  }

  // Gridlock detection state
  let stationaryTimerSec = 0;
  let isGridlocked = false;
  let gridlockMessage = '';

  // Edge cases identification
  const roadCount = mapConfig.roadSegments.length;
  const entranceMarkers = mapConfig.zoneMarkers.filter((m) => m.type === 'entrance');
  const exitMarkers = mapConfig.zoneMarkers.filter((m) => m.type === 'exit');
  const dropoffMarkers = mapConfig.zoneMarkers.filter((m) => m.type === 'dropoff');

  let initialEdgeCase: EdgeCaseInfo | null = null;

  if (roadCount === 0) {
    initialEdgeCase = {
      type: 'zero-roads',
      message:
        'Zero roads configured. Simulation running with 0 active vehicles. Add road segments in Map Setup to route traffic.',
    };
  } else if (entranceMarkers.length === 0) {
    initialEdgeCase = {
      type: 'no-entrance',
      message:
        'No entrance configured. Campus requires at least one entrance marker to generate traffic.',
    };
  } else if (exitMarkers.length === 0) {
    initialEdgeCase = {
      type: 'no-exit',
      message:
        'No exit configured. Vehicles require at least one exit gate to complete trips.',
    };
  } else if (dropoffMarkers.length === 0 && dropoffShare > 0) {
    initialEdgeCase = {
      type: 'no-drop-off',
      message:
        'No drop-off zone placed on campus. Vehicles requiring a drop-off cannot complete their trips.',
    };
  } else {
    // Check validation from DrawnPathRouter
    if (router instanceof DrawnPathRouter) {
      if (!router.validation.isValid) {
        const errorMsg = router.validation.errorMessage || 'No valid loop-free drawn paths found for entrances.';
        const isBlocked = errorMsg.toLowerCase().includes('exit') || errorMsg.toLowerCase().includes('block');
        initialEdgeCase = {
          type: isBlocked ? 'all-exits-blocked' : 'no-valid-path',
          message: errorMsg,
        };
      }
    } else {
      // Fallback check
      let hasAnyPath = false;
      for (const entrance of entranceMarkers) {
        const r1 = router.route({ isSticker: true, usesDropoff: false }, graph, entrance.id);
        const r2 = router.route({ isSticker: false, usesDropoff: false }, graph, entrance.id);
        const r3 = router.route({ isSticker: true, usesDropoff: true }, graph, entrance.id);
        const r4 = router.route({ isSticker: false, usesDropoff: true }, graph, entrance.id);
        if (r1 || r2 || r3 || r4) {
          hasAnyPath = true;
          break;
        }
      }

      if (!hasAnyPath) {
        initialEdgeCase = {
          type: 'all-exits-blocked',
          message:
            'All exits blocked: One-way restrictions or access rules prevent vehicles from reaching any exit.',
        };
      }
    }

    if (!initialEdgeCase) {
      const totalInflow = entranceMarkers.reduce((sum, ent) => {
        const rate = settings.spawnRates[ent.id] !== undefined ? settings.spawnRates[ent.id] : 18;
        return sum + Math.max(0, rate);
      }, 0);

      if (totalInflow === 0) {
        initialEdgeCase = {
          type: 'zero-spawn-rate',
          message:
            'Zero spawn rate: Inflow set to 0 veh/min across all entrance gates. Simulation running in zero-traffic state.',
        };
      } else if (entranceMarkers.length > 0) {
        const allEntranceClasses = entranceMarkers.map((ent) =>
          router.allowedClasses ? router.allowedClasses(ent.id) : { sticker: true, nonSticker: true }
        );

        const allStickerOnly =
          allEntranceClasses.every((c) => c.sticker && !c.nonSticker);
        const allNonStickerOnly =
          allEntranceClasses.every((c) => !c.sticker && c.nonSticker);

        if (allStickerOnly) {
          initialEdgeCase = {
            type: 'all-sticker-only',
            message: 'All entrances are sticker-only. No non-sticker vehicles will enter.',
          };
        } else if (allNonStickerOnly) {
          initialEdgeCase = {
            type: 'all-non-sticker-only',
            message: 'All entrances are non-sticker-only. No sticker vehicles will enter.',
          };
        }
      }
    }
  }

  // Spawners configuration with Poisson exponential inter-arrival times
  interface EntranceSpawner {
    entranceId: string;
    rateVehPerMin: number;
    nextSpawnTime: number;
  }

  const spawners: EntranceSpawner[] = [];

  for (const entrance of entranceMarkers) {
    const rawRate = settings.spawnRates[entrance.id];
    const rate = rawRate !== undefined ? Math.max(0, rawRate) : 18;
    if (rate <= 0) {
      spawners.push({
        entranceId: entrance.id,
        rateVehPerMin: 0,
        nextSpawnTime: Infinity,
      });
      continue;
    }
    const meanIntervalSec = 60 / rate;
    const initialDelay = -Math.log(Math.max(1 - rng(), 0.0001)) * meanIntervalSec * 0.2;
    spawners.push({
      entranceId: entrance.id,
      rateVehPerMin: rate,
      nextSpawnTime: initialDelay,
    });
  }

  function scheduleNextSpawn(spawner: EntranceSpawner) {
    if (spawner.rateVehPerMin <= 0) {
      spawner.nextSpawnTime = Infinity;
      return;
    }
    const meanIntervalSec = 60 / spawner.rateVehPerMin;
    const delay = -Math.log(Math.max(1 - rng(), 0.0001)) * meanIntervalSec;
    spawner.nextSpawnTime = simTime + delay;
  }

  // Pre-calculate Configured Max Capacity (PRD § 3.3.2 / ENGINE SPEC)
  // for each entrance, take the route with the fewest edges, compute min(lanes x 1900) along it,
  // then take the minimum across entrances
  let configuredMaxCapacity = 1900;
  if (router instanceof DrawnPathRouter) {
    configuredMaxCapacity = router.getConfiguredMaxCapacity();
  } else if (entranceMarkers.length > 0 && exitMarkers.length > 0 && mapConfig.roadSegments.length > 0) {
    let minEntranceCap = Infinity;
    for (const entrance of entranceMarkers) {
      const routeResult = router.route({ isSticker: true, usesDropoff: false }, graph, entrance.id);
      if (routeResult && routeResult.routeEdges.length > 0) {
        let routeMinLanes = Infinity;
        for (const edge of routeResult.routeEdges) {
          routeMinLanes = Math.min(routeMinLanes, edge.lanes || 1);
        }
        if (isFinite(routeMinLanes) && routeMinLanes > 0) {
          minEntranceCap = Math.min(minEntranceCap, routeMinLanes * 1900);
        }
      }
    }
    if (isFinite(minEntranceCap) && minEntranceCap > 0) {
      configuredMaxCapacity = minEntranceCap;
    }
  }

  // Helper to get polyline coordinate and heading along an edge
  function getPointAndHeadingAlongEdge(
    edge: GraphEdge,
    distanceAlongMeters: number
  ): { point: Point; headingRad: number } {
    const pts = edge.points;
    if (pts.length < 2) {
      return { point: pts[0] || { x: 0, y: 0 }, headingRad: 0 };
    }

    const distPx = distanceAlongMeters * pixelsPerMeter;
    let accumulatedPx = 0;

    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const segmentLen = Math.max(distance(p1, p2), 0.001);

      if (accumulatedPx + segmentLen >= distPx || i === pts.length - 2) {
        const remaining = Math.max(0, distPx - accumulatedPx);
        const ratio = Math.min(1, Math.max(0, remaining / segmentLen));
        const x = p1.x + (p2.x - p1.x) * ratio;
        const y = p1.y + (p2.y - p1.y) * ratio;
        const headingRad = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        return { point: { x, y }, headingRad };
      }

      accumulatedPx += segmentLen;
    }

    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    return { point: last, headingRad: Math.atan2(last.y - prev.y, last.x - prev.x) };
  }

  // Spatial lookup by edge builder
  function rebuildVehiclesByEdge() {
    vehiclesByEdge.clear();
    for (let i = 0; i < activeVehicles.length; i++) {
      const v = activeVehicles[i];
      const edge = v.routeEdges[v.currentEdgeIndex];
      if (!edge) continue;

      let list = vehiclesByEdge.get(edge.id);
      if (!list) {
        list = [];
        vehiclesByEdge.set(edge.id, list);
      }
      list.push(v);
    }

    for (const list of vehiclesByEdge.values()) {
      list.sort((a, b) => b.distanceAlongCurrentEdgeMeters - a.distanceAlongCurrentEdgeMeters);
    }
  }

  // Main simulation fixed-timestep step
  function step(dtSeconds: number) {
    if (dtSeconds <= 0 || isRunCompleted) return;

    // Set prevPosition and prevHeadingRad for all active vehicles before moving
    for (let i = 0; i < activeVehicles.length; i++) {
      const v = activeVehicles[i];
      v.prevPosition = { ...v.position };
      v.prevHeadingRad = v.headingRad;
    }

    simTime += dtSeconds;

    // 1. Spawning: exponential inter-arrival time around configured rate
    if (simTime < durationSeconds) {
      for (const spawner of spawners) {
        if (spawner.rateVehPerMin <= 0) continue;

        if (simTime >= spawner.nextSpawnTime) {
          const allowed = router.allowedClasses
            ? router.allowedClasses(spawner.entranceId)
            : { sticker: true, nonSticker: true };

          const roll = rng();
          let isSticker: boolean;
          if (allowed.sticker && allowed.nonSticker) {
            isSticker = roll < stickerShare;
          } else if (allowed.sticker) {
            isSticker = true;
          } else if (allowed.nonSticker) {
            isSticker = false;
          } else {
            isSticker = roll < stickerShare;
          }

          const usesDropoff = rng() < dropoffShare;

          const planned = router.route({ isSticker, usesDropoff }, graph, spawner.entranceId);

          if (!planned || planned.routeEdges.length === 0) {
            unroutableSpawnsCount++;
            scheduleNextSpawn(spawner);
            continue;
          }

          const firstEdge = planned.routeEdges[0];

          // Spawning: a new car may spawn only if findLeader for a car placed at distance 0 on its first edge gives netGap >= STANDSTILL_GAP_M (or no leader)
          const spawnLeaderInfo = findLeader(
            {
              routeEdges: planned.routeEdges,
              currentEdgeIndex: 0,
              distanceAlongCurrentEdgeMeters: 0,
            },
            vehiclesByEdge,
            VEHICLE_LENGTH_M
          );

          const isEntranceBlocked =
            spawnLeaderInfo !== null && spawnLeaderInfo.netGapMeters < STANDSTILL_GAP_M;

          if (isEntranceBlocked) {
            blockedSpawnsCount++;
            spawner.nextSpawnTime = simTime + 0.8 + rng() * 0.8;
          } else {
            // Spawn new vehicle
            vehicleIdCounter++;
            if (isSticker) {
              spawnedStickerCount++;
            } else {
              spawnedNonStickerCount++;
            }
            const { point, headingRad } = getPointAndHeadingAlongEdge(firstEdge, 0);

            const initialSpeedMS = Math.min(firstEdge.speedLimitMS, 3.0);

            const newVeh: SimVehicle = {
              id: `veh-${vehicleIdCounter}`,
              isSticker,
              usesDropoff,
              dropoffId: planned.dropoffId,
              position: point,
              headingRad,
              prevPosition: { ...point },
              prevHeadingRad: headingRad,
              speedMS: initialSpeedMS,
              speedPxPerSec: initialSpeedMS * pixelsPerMeter,
              targetSpeedMS: firstEdge.speedLimitMS,
              state: 'moving',
              currentEdgeIndex: 0,
              distanceAlongCurrentEdgeMeters: 0,
              routeEdges: planned.routeEdges,
              routePoints: planned.routePoints,
              currentPointIndex: 0,
              enterTimeSec: simTime,
              exitTimeSec: null,
              totalWaitTimeSec: 0,
              dwellRemainingSec: 0,
              entranceId: spawner.entranceId,
              exitId: planned.targetExitId,
            };

            const initialPose = getVehicleRenderPose(newVeh, VEHICLE_LENGTH_M, metersPerUnit);
            newVeh.position = initialPose.point;
            newVeh.headingRad = initialPose.headingRad;
            newVeh.prevPosition = { ...initialPose.point };
            newVeh.prevHeadingRad = initialPose.headingRad;

            activeVehicles.push(newVeh);
            let fList = vehiclesByEdge.get(firstEdge.id);
            if (!fList) {
              fList = [];
              vehiclesByEdge.set(firstEdge.id, fList);
            }
            fList.push(newVeh);
            scheduleNextSpawn(spawner);
          }
        }
      }
    }

    // 2. Build spatial lookup by edge: vehiclesByEdge
    rebuildVehiclesByEdge();

    // 3. Drop-off dwell state and capacity enforcement (holds up to 2 vehicles, others queue behind)
    const dropoffMarkers = mapConfig.zoneMarkers.filter((m) => m.type === 'dropoff');

    for (const [dropId, set] of dropoffDwellers.entries()) {
      for (const vehId of set) {
        const v = activeVehicles.find((veh) => veh.id === vehId);
        if (!v || v.dwellRemainingSec <= 0 || v.state !== 'waiting') {
          set.delete(vehId);
        }
      }
    }

    // 4. Car-following (IDM-style) and Merging Arbitration
    const toRemoveIndices: number[] = [];

    for (let i = 0; i < activeVehicles.length; i++) {
      const v = activeVehicles[i];
      const edge = v.routeEdges[v.currentEdgeIndex];
      if (!edge) {
        toRemoveIndices.push(i);
        continue;
      }

      // Check drop-off stop: route-based stop line at the drop-off node.
      // The vehicle brakes toward the stop line (see 4c/4e) and starts dwelling when it
      // reaches it, or when it is queued right behind a vehicle that is already dwelling.
      // A full bay (2 dwellers) makes it wait instead of driving past.
      let dropStopDistM = Infinity;
      const dropMarker = v.usesDropoff && v.dropoffId
        ? dropoffMarkers.find((m) => m.id === v.dropoffId)
        : undefined;
      if (dropMarker && !v.dwellDone) {
        const dwellers = dropoffDwellers.get(dropMarker.id);

        if (v.dwellRemainingSec > 0) {
          // Currently dwelling
          v.dwellRemainingSec = Math.max(0, v.dwellRemainingSec - dtSeconds);
          if (v.dwellRemainingSec > 0) {
            v.speedMS = 0;
            v.speedPxPerSec = 0;
            v.state = 'waiting';
            continue;
          }
          v.dwellDone = true;
          dwellers?.delete(v.id);
          v.state = 'moving';
        } else {
          const dropNodeId = graph.dropoffNodeMap.get(dropMarker.id);
          if (dropNodeId) {
            // Route distance from the vehicle front to the stop line (end of the edge entering the drop-off node)
            let distToStop = 0;
            let foundStop = false;
            for (let k = v.currentEdgeIndex; k < v.routeEdges.length; k++) {
              const e = v.routeEdges[k];
              distToStop +=
                k === v.currentEdgeIndex
                  ? Math.max(0, e.lengthMeters - v.distanceAlongCurrentEdgeMeters)
                  : e.lengthMeters;
              if (e.toNodeId === dropNodeId) {
                foundStop = true;
                break;
              }
            }

            if (foundStop) {
              const ld = findLeader(v, vehiclesByEdge, VEHICLE_LENGTH_M);
              const queuedBehindDweller =
                !!ld &&
                ld.leader.state === 'waiting' &&
                ld.leader.dwellRemainingSec > 0 &&
                ld.netGapMeters <= STANDSTILL_GAP_M + 0.5;
              const atStopLine = distToStop <= 0.5;

              if ((atStopLine || queuedBehindDweller) && (dwellers ? dwellers.size : 0) < 2) {
                // Uniform dwell time from 20 to 60 s
                v.dwellRemainingSec = 20 + rng() * 40;
                v.speedMS = 0;
                v.speedPxPerSec = 0;
                v.state = 'waiting';
                dwellers?.add(v.id);
                continue;
              }
              dropStopDistM = distToStop;
            }
          }
        }
      }

      // 4a. Find leader ahead using findLeader
      const leaderInfo = findLeader(v, vehiclesByEdge, VEHICLE_LENGTH_M);
      const leader = leaderInfo?.leader ?? null;
      const netGapMeters = leaderInfo ? leaderInfo.netGapMeters : Infinity;
      const leaderSpeedMS = leader ? leader.speedMS : edge.speedLimitMS;

      // 4b. Merging arbitration at nodes where multiple incoming edges enter the same next edge
      let mustYieldAtMerge = false;
      v.yieldingToLeader = null;
      const distToNodeMeters = edge.lengthMeters - v.distanceAlongCurrentEdgeMeters;

      if (distToNodeMeters <= 25 && v.currentEdgeIndex < v.routeEdges.length - 1) {
        const nextEdge = v.routeEdges[v.currentEdgeIndex + 1];
        const mergeNode = graph.nodes.get(edge.toNodeId);

        if (mergeNode && mergeNode.incomingEdgeIds.length > 1) {
          for (const incEdgeId of mergeNode.incomingEdgeIds) {
            if (incEdgeId === edge.id) continue;
            const incEdge = graph.edges.get(incEdgeId);
            if (!incEdge) continue;

            const otherEdgeVehicles = vehiclesByEdge.get(incEdge.id) || [];
            if (otherEdgeVehicles.length === 0) continue;

            const otherLead = otherEdgeVehicles[0];
            const otherNextEdge = otherLead.routeEdges[otherLead.currentEdgeIndex + 1];
            if (!otherNextEdge || otherNextEdge.id !== nextEdge.id) continue;

            const otherDistToNode = incEdge.lengthMeters - otherLead.distanceAlongCurrentEdgeMeters;

            // Determine priority: road hierarchy, then proximity / arrival
            const otherIsMain = incEdge.lanes > edge.lanes || (incEdge.lanes === edge.lanes && incEdge.isMainRoad && !edge.isMainRoad);
            const vIsMain = edge.lanes > incEdge.lanes || (edge.lanes === incEdge.lanes && edge.isMainRoad && !incEdge.isMainRoad);

            let otherHasPriority = false;
            if (otherIsMain) {
              otherHasPriority = true;
            } else if (vIsMain) {
              otherHasPriority = false;
            } else {
              otherHasPriority =
                otherDistToNode < distToNodeMeters - 0.05 ||
                (Math.abs(otherDistToNode - distToNodeMeters) <= 0.05 && otherLead.enterTimeSec < v.enterTimeSec);
            }

            if (otherHasPriority && otherDistToNode <= 25) {
              mustYieldAtMerge = true;
              v.yieldingToLeader = otherLead;
              break;
            }
          }
        }
      }
// 4c. IDM-style speed & acceleration calculation
      const v0 = edge.speedLimitMS;
      const s0 = STANDSTILL_GAP_M;
      const T = 1.2; // Safe time headway (seconds)
      const a = 1.5; // Acceleration (m/s^2)
      const b = 2.0; // Comfortable deceleration (m/s^2)

      let targetSpeed = v0;

      if (mustYieldAtMerge) {
        const gapToYield = Math.max(0, distToNodeMeters - EFFECTIVE_SPACE_M);
        if (gapToYield <= 0.05) {
          targetSpeed = 0;
        } else {
          const maxSafeYieldSpeed = gapToYield / T;
          targetSpeed = Math.min(targetSpeed, maxSafeYieldSpeed);
        }
      } else if (leader && netGapMeters <= s0) {
        targetSpeed = 0;
      } else if (leader && netGapMeters < 50) {
        const deltaV = v.speedMS - leaderSpeedMS;
        const sStar =
          s0 +
          Math.max(
            0,
            v.speedMS * T + (v.speedMS * deltaV) / (2 * Math.sqrt(a * b))
          );
        const acc =
          a *
          (1 -
            Math.pow(v.speedMS / v0, 4) -
            Math.pow(sStar / Math.max(0.1, netGapMeters), 2));

        const maxSafeSpeed = Math.max(0, leaderSpeedMS + (netGapMeters - s0) / T);
        targetSpeed = Math.max(0, Math.min(v0, v.speedMS + acc * dtSeconds));
        targetSpeed = Math.min(targetSpeed, maxSafeSpeed);
      } else {
        const acc = a * (1 - Math.pow(v.speedMS / v0, 4));
        targetSpeed = Math.max(0, Math.min(v0, v.speedMS + acc * dtSeconds));
      }

      if (Number.isFinite(dropStopDistM)) {
        // Brake smoothly toward the drop-off stop line
        const stopCap = Math.sqrt(2 * b * Math.max(0, dropStopDistM - 0.2));
        targetSpeed = Math.min(targetSpeed, stopCap);
      }

      v.speedMS = Math.max(0, targetSpeed);
      v.speedPxPerSec = v.speedMS * pixelsPerMeter;

      // 4d. Queued classification: speed < 0.5 m/s and not dwelling at drop-off
      if (v.speedMS < 0.5 && v.state !== 'waiting') {
        v.state = 'queued';
        v.totalWaitTimeSec += dtSeconds;
      } else if (v.state !== 'waiting') {
        v.state = 'moving';
      }

      // 4e. Advance position along route edges with single overlap guard rule
      let stepDistanceMeters = v.speedMS * dtSeconds;
      if (leader) {
        stepDistanceMeters = Math.min(
          stepDistanceMeters,
          Math.max(0, netGapMeters - STANDSTILL_GAP_M)
        );
      }
      if (mustYieldAtMerge) {
        stepDistanceMeters = Math.min(
          stepDistanceMeters,
          Math.max(0, distToNodeMeters - EFFECTIVE_SPACE_M)
        );
      }
      if (Number.isFinite(dropStopDistM)) {
        // Never overshoot the drop-off stop line
        stepDistanceMeters = Math.min(stepDistanceMeters, dropStopDistM);
      }

      if (leader && stepDistanceMeters === 0 && netGapMeters <= STANDSTILL_GAP_M) {
        v.speedMS = 0;
        v.speedPxPerSec = 0;
        if (v.state !== 'waiting') {
          v.state = 'queued';
        }
      } else if (dtSeconds > 0 && stepDistanceMeters < v.speedMS * dtSeconds) {
        v.speedMS = stepDistanceMeters / dtSeconds;
        v.speedPxPerSec = v.speedMS * pixelsPerMeter;
      }

// Edge transition and route advancement (works when edges are shorter than one car)
      let remainingStep = stepDistanceMeters;
      while (remainingStep > 0) {
        const currEdge = v.routeEdges[v.currentEdgeIndex];
        if (!currEdge) break;

        const distToEdgeEnd = Math.max(0, currEdge.lengthMeters - v.distanceAlongCurrentEdgeMeters);

        if (remainingStep >= distToEdgeEnd) {
          if (v.currentEdgeIndex < v.routeEdges.length - 1) {
            // Remove from current edge in vehiclesByEdge
            const oldList = vehiclesByEdge.get(currEdge.id);
            if (oldList) {
              const oIdx = oldList.indexOf(v);
              if (oIdx !== -1) oldList.splice(oIdx, 1);
            }

            remainingStep -= distToEdgeEnd;
            v.currentEdgeIndex++;
            v.distanceAlongCurrentEdgeMeters = 0;

            // Track merge at node for zipper arbitration
            lastMergedEdgeByNode.set(currEdge.toNodeId, currEdge.id);

            // Add to new edge in vehiclesByEdge
            const enteredEdge = v.routeEdges[v.currentEdgeIndex];
            if (enteredEdge) {
              let nList = vehiclesByEdge.get(enteredEdge.id);
              if (!nList) {
                nList = [];
                vehiclesByEdge.set(enteredEdge.id, nList);
              }
              nList.push(v);
              nList.sort((a, b) => b.distanceAlongCurrentEdgeMeters - a.distanceAlongCurrentEdgeMeters);
            }
          } else {
            // Reached exit marker: despawn
            v.distanceAlongCurrentEdgeMeters = currEdge.lengthMeters;
            v.state = 'exited';
            v.exitTimeSec = simTime;
            completedVehicles.push({
              enterTime: v.enterTimeSec,
              exitTime: simTime,
              transitTime: Math.max(1, simTime - v.enterTimeSec),
              waitTime: v.totalWaitTimeSec,
              isSticker: v.isSticker,
            });
            toRemoveIndices.push(i);
            break;
          }
        } else {
          v.distanceAlongCurrentEdgeMeters += remainingStep;
          remainingStep = 0;
        }
      }

      // Update current coordinates and heading for canvas rendering
      const currentEdge = v.routeEdges[v.currentEdgeIndex];
      if (currentEdge) {
        const pose = getVehicleRenderPose(v, VEHICLE_LENGTH_M, metersPerUnit);
        v.position = pose.point;
        v.headingRad = pose.headingRad;
      }
    }

    // Remove exited vehicles
    for (let r = toRemoveIndices.length - 1; r >= 0; r--) {
      activeVehicles.splice(toRemoveIndices[r], 1);
    }

    // Rebuild spatial lookup so engine.findLeader() callers and next step see updated positions
    rebuildVehiclesByEdge();


    // 5. Gridlock Detection: if no vehicle has moved for 120 simulated seconds while vehicles are active
    if (activeVehicles.length > 0) {
      const anyMoved = activeVehicles.some((v) => v.speedMS >= 0.5);
      if (!anyMoved) {
        stationaryTimerSec += dtSeconds;
        if (stationaryTimerSec >= 120) {
          isGridlocked = true;
          gridlockMessage = `Gridlock detected: No vehicle moved for 120 simulated seconds while ${activeVehicles.length} vehicles active. Traffic halted.`;
          isRunCompleted = true;
        }
      } else {
        stationaryTimerSec = 0;
        isGridlocked = false;
        gridlockMessage = '';
      }
    } else {
      stationaryTimerSec = 0;
      isGridlocked = false;
      gridlockMessage = '';
    }

    // 6. Metrics & Queue Tracking per Segment
    for (const seg of mapConfig.roadSegments) {
      const segLengthMeters =
        (seg.points.length > 1
          ? seg.points.reduce((acc, p, idx) => (idx === 0 ? 0 : acc + distance(seg.points[idx - 1], p)), 0)
          : 100) * metersPerUnit;

      const lanes = seg.lanes || 1;
      const capacityVeh = Math.max(1, Math.round((segLengthMeters / EFFECTIVE_SPACE_M) * lanes));

      const segVehicles = activeVehicles.filter(
        (v) => v.routeEdges[v.currentEdgeIndex]?.segmentId === seg.id
      );
      const queuedCount = segVehicles.filter((v) => v.state === 'queued').length;

      const peak = peakQueuesBySegment.get(seg.id) || 0;
      if (queuedCount > peak) {
        peakQueuesBySegment.set(seg.id, queuedCount);
      }

      const utilPct = Math.min(100, Math.round((segVehicles.length / capacityVeh) * 100));
      const currentHighTimer = segmentHighUtilTimers.get(seg.id) || 0;

      if (utilPct >= 80) {
        segmentHighUtilTimers.set(seg.id, currentHighTimer + dtSeconds);
      } else {
        segmentHighUtilTimers.set(seg.id, Math.max(0, currentHighTimer - dtSeconds * 0.5));
      }
    }

    // 7. Run completion check
    if (simTime >= durationSeconds) {
      if (activeVehicles.length === 0 || simTime >= maxSimTimeWithGrace) {
        isRunCompleted = true;
      }
    }
  }

  // Live Snapshot Calculation
  function getSnapshot(): SimSnapshot {
    const windowStart = Math.max(0, simTime - 300);
    const exitsInLast5Min = completedVehicles.filter((c) => c.exitTime >= windowStart).length;
    const windowDurationHours = Math.max(Math.min(simTime, 300) / 3600, 0.0001);
    const liveThroughput =
      simTime < 300
        ? Math.round(completedVehicles.length / windowDurationHours)
        : exitsInLast5Min * 12;

    const totalFinishedWait = completedVehicles.reduce((acc, c) => acc + c.waitTime, 0);
    const totalActiveWait = activeVehicles.reduce((acc, v) => acc + v.totalWaitTimeSec, 0);
    const totalVehicleEntities = completedVehicles.length + activeVehicles.length;
    const avgWait =
      totalVehicleEntities > 0
        ? Math.round((totalFinishedWait + totalActiveWait) / totalVehicleEntities)
        : 0;

    const avgTransit =
      completedVehicles.length > 0
        ? Math.round(
            completedVehicles.reduce((acc, c) => acc + c.transitTime, 0) / completedVehicles.length
          )
        : 0;

    let maxQueue = 0;
    for (const q of peakQueuesBySegment.values()) {
      if (q > maxQueue) maxQueue = q;
    }

    const liveMetrics: SimLiveMetrics = {
      activeVehicles: activeVehicles.length,
      totalCompletedVehicles: completedVehicles.length,
      throughputVehHr: liveThroughput,
      avgWaitTimeSec: avgWait,
      avgTransitTimeSec: avgTransit,
      maxQueueLengthVeh: maxQueue,
      simTimeSeconds: Math.round(simTime),
      simDurationSeconds: durationSeconds,
      blockedSpawnsCount,
      unroutableSpawnsCount,
    };

    const segmentOccupancies: Record<string, SegmentOccupancy> = {};
    for (const seg of mapConfig.roadSegments) {
      const segLengthMeters =
        (seg.points.length > 1
          ? seg.points.reduce((acc, p, idx) => (idx === 0 ? 0 : acc + distance(seg.points[idx - 1], p)), 0)
          : 100) * metersPerUnit;

      const lanes = seg.lanes || 1;
      const capacityVeh = Math.max(1, Math.round((segLengthMeters / EFFECTIVE_SPACE_M) * lanes));

      const segVehicles = activeVehicles.filter(
        (v) => v.routeEdges[v.currentEdgeIndex]?.segmentId === seg.id
      );
      const queuedVehicles = segVehicles.filter((v) => v.state === 'queued');
      const queueCount = queuedVehicles.length;

      const meanWait =
        queueCount > 0
          ? Math.round(queuedVehicles.reduce((acc, v) => acc + v.totalWaitTimeSec, 0) / queueCount)
          : 0;

      const utilPct = Math.min(100, Math.round((segVehicles.length / capacityVeh) * 100));

      segmentOccupancies[seg.id] = {
        segmentId: seg.id,
        segmentName: seg.name,
        vehicleCount: segVehicles.length,
        queueCount,
        capacity: capacityVeh,
        utilizationPct: utilPct,
        meanWaitSeconds: meanWait,
      };
    }

    const currentEdgeCase: EdgeCaseInfo | null = isGridlocked
      ? {
          type: 'gridlock',
          message: gridlockMessage || 'Gridlock detected: vehicles stationary for 120 simulated seconds.',
        }
      : initialEdgeCase;

    return {
      simTimeSeconds: Math.round(simTime),
      isComplete: isRunCompleted || isComplete(),
      isGridlocked,
      gridlockMessage: isGridlocked ? gridlockMessage : undefined,
      edgeCase: currentEdgeCase,
      vehicles: activeVehicles,
      segmentOccupancies,
      liveMetrics,
    };
  }

  function isComplete(): boolean {
    if (isRunCompleted) return true;
    if (simTime >= durationSeconds) {
      return activeVehicles.length === 0 || simTime >= maxSimTimeWithGrace;
    }
    return false;
  }

  function isGridlockedFn(): boolean {
    return isGridlocked;
  }

  function getEdgeCase(): EdgeCaseInfo | null {
    return isGridlocked
      ? {
          type: 'gridlock',
          message: gridlockMessage,
        }
      : initialEdgeCase;
  }

  function getResult(): SimulationResult {
    const effectiveHours = Math.max(durationSeconds / 3600, 0.001);
    const finalThroughput = Math.round(completedVehicles.length / effectiveHours);

    const avgWait =
      completedVehicles.length > 0
        ? Math.round(
            completedVehicles.reduce((acc, c) => acc + c.waitTime, 0) / completedVehicles.length
          )
        : 0;

    const avgTransit =
      completedVehicles.length > 0
        ? Math.round(
            completedVehicles.reduce((acc, c) => acc + c.transitTime, 0) / completedVehicles.length
          )
        : 0;

    const rankedSegments: BottleneckRank[] = [...mapConfig.roadSegments]
      .map((seg) => {
        const peakQueue = peakQueuesBySegment.get(seg.id) || 0;
        const segLengthMeters =
          (seg.points.length > 1
            ? seg.points.reduce((acc, p, idx) => (idx === 0 ? 0 : acc + distance(seg.points[idx - 1], p)), 0)
            : 100) * metersPerUnit;
        const capacity = Math.max(1, Math.round((segLengthMeters / EFFECTIVE_SPACE_M) * (seg.lanes || 1)));

        let severity: 'critical' | 'moderate' | 'clear' = 'clear';
        if (peakQueue > 12) severity = 'critical';
        else if (peakQueue > 4) severity = 'moderate';

        return {
          segmentId: seg.id,
          segmentName: seg.name,
          maxQueueLength: peakQueue,
          severity,
          percentage: Math.min(100, Math.round((peakQueue / capacity) * 100)),
        };
      })
      .sort((a, b) => b.maxQueueLength - a.maxQueueLength);

    const maxQueue = rankedSegments[0]?.maxQueueLength || 0;
    const maxQueueLoc =
      rankedSegments[0]?.segmentName ||
      (mapConfig.roadSegments.length > 0 ? mapConfig.roadSegments[0].name : 'None');

    const flowEfficiency = Math.min(
      100,
      Math.max(0, Math.round((finalThroughput / configuredMaxCapacity) * 100))
    );

    const segmentUtilizationList = mapConfig.roadSegments.map((seg) => {
      const segLengthMeters =
        (seg.points.length > 1
          ? seg.points.reduce((acc, p, idx) => (idx === 0 ? 0 : acc + distance(seg.points[idx - 1], p)), 0)
          : 100) * metersPerUnit;
      const capacity = Math.max(1, Math.round((segLengthMeters / EFFECTIVE_SPACE_M) * (seg.lanes || 1)));
      const peakQ = peakQueuesBySegment.get(seg.id) || 0;
      return {
        segmentId: seg.id,
        utilizationPct: Math.min(100, Math.round((peakQ / capacity) * 100)),
      };
    });

    return {
      runId: `run-${Date.now()}`,
      runNumber: 1,
      seed,
      timestamp: new Date().toISOString(),
      layoutName: mapConfig.layoutName || 'Layout A',
      totalThroughputVehHr: finalThroughput,
      avgWaitTimeSec: avgWait,
      avgTransitTimeSec: avgTransit,
      maxQueueLengthVeh: maxQueue,
      maxQueueLocation: maxQueueLoc,
      flowEfficiencyPct: flowEfficiency,
      configuredMaxCapacity,
      totalProcessedVehicles: completedVehicles.length,
      unfinishedVehiclesCount: activeVehicles.length,
      blockedSpawnsCount,
      unroutableSpawnsCount,
      isGridlocked,
      gridlockMessage: isGridlocked ? gridlockMessage : undefined,
      bottlenecks: rankedSegments,
      segmentUtilization: segmentUtilizationList,
      segmentMaxQueue: rankedSegments.map((r) => ({
        segmentId: r.segmentId,
        maxQueueLength: r.maxQueueLength,
      })),
      spawnedSticker: spawnedStickerCount,
      spawnedNonSticker: spawnedNonStickerCount,
    };
  }

  return {
    step,
    getSnapshot,
    isComplete,
    isGridlocked: isGridlockedFn,
    getEdgeCase,
    getResult,
    findLeader: (vehicle: SimVehicle) => {
      if (vehicle.yieldingToLeader && vehicle.yieldingToLeader.state !== 'exited') {
        const other = vehicle.yieldingToLeader;
        const currEdge = vehicle.routeEdges[vehicle.currentEdgeIndex];
        const otherEdge = other.routeEdges[other.currentEdgeIndex];
        if (currEdge && otherEdge) {
          const dToNode = Math.max(0, currEdge.lengthMeters - vehicle.distanceAlongCurrentEdgeMeters);
          const otherDToNode = Math.max(0, otherEdge.lengthMeters - other.distanceAlongCurrentEdgeMeters);
          const relDist = Math.max(0, dToNode - otherDToNode);
          const netGap = Math.min(STANDSTILL_GAP_M + 0.5, Math.max(STANDSTILL_GAP_M, relDist - VEHICLE_LENGTH_M));
          return { leader: other, netGapMeters: netGap };
        }
      }
      return findLeader(vehicle, vehiclesByEdge, VEHICLE_LENGTH_M);
    },
  };
}
