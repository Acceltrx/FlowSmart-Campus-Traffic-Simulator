/**
 * FlowSmart - Road Network Graph & Drawn-Path Router
 * Implements road splitting at shared nodes, directed edges for one-way/two-way roads,
 * and drawn-path following per PRD v1.4 section 3.2.2 and ENGINE SPEC.
 * No Dijkstra or A* shortest-path routing is used anywhere.
 */

import { Point, RoadSegment, ZoneMarker, MapConfig } from '../types/traffic';
import { distance } from '../utils/mapGeometry';
import { GraphNode, GraphEdge, RoadGraph, Router } from './types';
import { getMetersPerUnit, clampSpeedKmH } from '../utils/scale';

/**
 * Builds a directed routing graph from road segments and zone markers.
 * Two-way road = two directed edges; one-way = one edge following drawn point order.
 * Each edge includes length in meters, lanes, access rules, and speed limits.
 */
export function buildRoadGraph(
  mapConfig: MapConfig,
  snapRadiusPx?: number,
  metersPerUnit?: number
): RoadGraph {
  const scale = metersPerUnit ?? getMetersPerUnit(mapConfig);
  const snapRadiusUnits =
    snapRadiusPx !== undefined
      ? snapRadiusPx
      : Math.max(4, Math.min(20, 4 / (scale > 0 ? scale : 0.2)));
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const nodePositions: { id: string; point: Point }[] = [];

  // Helper to find or create a graph node near point p
  function getOrCreateNode(p: Point): string {
    for (const item of nodePositions) {
      if (distance(p, item.point) <= snapRadiusUnits) {
        return item.id;
      }
    }
    const newId = `node-${nodePositions.length + 1}`;
    const newNode: GraphNode = {
      id: newId,
      point: { x: p.x, y: p.y },
      outgoingEdgeIds: [],
      incomingEdgeIds: [],
    };
    nodes.set(newId, newNode);
    nodePositions.push({ id: newId, point: newNode.point });
    return newId;
  }

  // 1. Register all segment vertices as nodes
  for (const seg of mapConfig.roadSegments) {
    for (const pt of seg.points) {
      getOrCreateNode(pt);
    }
  }

  // 2. Build directed edges for each segment
  for (const seg of mapConfig.roadSegments) {
    if (seg.points.length < 2) continue;

    for (let i = 0; i < seg.points.length - 1; i++) {
      const pA = seg.points[i];
      const pB = seg.points[i + 1];
      const nodeA = getOrCreateNode(pA);
      const nodeB = getOrCreateNode(pB);

      if (nodeA === nodeB) continue; // Skip degenerate zero-length loops

      const edgeLengthPx = Math.max(distance(pA, pB), 1);
      const edgeLengthMeters = edgeLengthPx * scale;
      const speedKmH = clampSpeedKmH(seg.speedLimitKmH);
      const speedMS = Math.max(speedKmH / 3.6, 0.5);
      const lanes = seg.lanes || 1;
      const access = seg.accessType || 'shared';
      const isMain =
        lanes > 1 ||
        seg.name.toLowerCase().includes('main') ||
        seg.name.toLowerCase().includes('boulevard') ||
        seg.name.toLowerCase().includes('arterial');

      // Forward edge: from A to B (drawn point order)
      const forwardEdgeId = `edge-${seg.id}-${i}-fwd`;
      const fwdEdge: GraphEdge = {
        id: forwardEdgeId,
        segmentId: seg.id,
        segmentName: seg.name,
        fromNodeId: nodeA,
        toNodeId: nodeB,
        points: [pA, pB],
        lengthPx: edgeLengthPx,
        lengthMeters: edgeLengthMeters,
        lanes,
        access,
        accessType: access,
        speedLimitKmH: speedKmH,
        speedLimitMS: speedMS,
        isMainRoad: isMain,
      };

      edges.set(forwardEdgeId, fwdEdge);
      nodes.get(nodeA)?.outgoingEdgeIds.push(forwardEdgeId);
      nodes.get(nodeB)?.incomingEdgeIds.push(forwardEdgeId);

      // Two-way road = reverse directed edge from B to A
      const isTwoWay =
        seg.flowDirection === 'two-way' ||
        (seg as unknown as { direction?: string }).direction === 'two-way';
      if (isTwoWay) {
        const reverseEdgeId = `edge-${seg.id}-${i}-rev`;
        const revEdge: GraphEdge = {
          id: reverseEdgeId,
          segmentId: seg.id,
          segmentName: seg.name,
          fromNodeId: nodeB,
          toNodeId: nodeA,
          points: [pB, pA],
          lengthPx: edgeLengthPx,
          lengthMeters: edgeLengthMeters,
          lanes,
          access,
          accessType: access,
          speedLimitKmH: speedKmH,
          speedLimitMS: speedMS,
          isMainRoad: isMain,
        };

        edges.set(reverseEdgeId, revEdge);
        nodes.get(nodeB)?.outgoingEdgeIds.push(reverseEdgeId);
        nodes.get(nodeA)?.incomingEdgeIds.push(reverseEdgeId);
      }
    }
  }

  // 3. Map zone markers to closest graph nodes
  const entranceNodeMap = new Map<string, string>();
  const exitNodeMap = new Map<string, string>();
  const dropoffNodeMap = new Map<string, string>();

  function findClosestNode(p: Point): string | null {
    let closestId: string | null = null;
    let minDist = Infinity;
    for (const item of nodePositions) {
      const d = distance(p, item.point);
      if (d < minDist) {
        minDist = d;
        closestId = item.id;
      }
    }
    return closestId;
  }

  for (const marker of mapConfig.zoneMarkers) {
    const closest = findClosestNode(marker.position);
    if (!closest) continue;
    if (marker.type === 'entrance') {
      entranceNodeMap.set(marker.id, closest);
    } else if (marker.type === 'exit') {
      exitNodeMap.set(marker.id, closest);
    } else if (marker.type === 'dropoff') {
      dropoffNodeMap.set(marker.id, closest);
    }
  }

  return {
    nodes,
    edges,
    nodePositions,
    entranceNodeMap,
    exitNodeMap,
    dropoffNodeMap,
  };
}

export interface DrawnRoute {
  id: string;
  entranceId: string;
  exitId: string;
  dropoffId?: string;
  edges: GraphEdge[];
  points: Point[];
  isEligibleSticker: boolean;
  isEligibleNonSticker: boolean;
  edgeCount: number;
}

export interface EntranceRouteSet {
  entranceId: string;
  entranceName: string;
  stickerWithDropoff: DrawnRoute[];
  nonStickerWithDropoff: DrawnRoute[];
  stickerDirect: DrawnRoute[];
  nonStickerDirect: DrawnRoute[];
  stickerAllowed: boolean;
  nonStickerAllowed: boolean;
  isTruncatedSticker: boolean;
  isTruncatedNonSticker: boolean;
  error?: string;
}

export interface EntranceValidationSummary {
  entranceId: string;
  entranceName: string;
  stickerRoutesCount: number;
  nonStickerRoutesCount: number;
  stickerOnly: boolean;
  nonStickerOnly: boolean;
  truncated: boolean;
  error?: string;
  reachable?: {
    sticker: { dropoffIds: string[]; direct: boolean };
    nonSticker: { dropoffIds: string[]; direct: boolean };
  };
}

export interface RouteValidationResult {
  isValid: boolean;
  entranceSummaries: EntranceValidationSummary[];
  errorMessage?: string;
}

/**
 * Depth-first search for all loop-free paths (no node visited twice) from startNode to endNode.
 */
function findLoopFreeLegs(
  graph: RoadGraph,
  startNodeId: string,
  endNodeId: string,
  maxPaths: number = 500
): GraphEdge[][] {
  const results: GraphEdge[][] = [];
  const visitedNodes = new Set<string>();
  visitedNodes.add(startNodeId);

  function dfs(currNodeId: string, path: GraphEdge[]) {
    if (results.length >= maxPaths) return;
    if (currNodeId === endNodeId) {
      if (path.length > 0) {
        results.push([...path]);
      }
      return;
    }

    const node = graph.nodes.get(currNodeId);
    if (!node) return;

    for (const edgeId of node.outgoingEdgeIds) {
      const edge = graph.edges.get(edgeId);
      if (!edge) continue;

      const nextNodeId = edge.toNodeId;
      if (!visitedNodes.has(nextNodeId)) {
        visitedNodes.add(nextNodeId);
        path.push(edge);

        dfs(nextNodeId, path);

        path.pop();
        visitedNodes.delete(nextNodeId);
      }
    }
  }

  dfs(startNodeId, []);
  return results;
}

function buildRoutePoints(edges: GraphEdge[]): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < edges.length; i++) {
    const pts = edges[i].points;
    if (i === 0) {
      points.push(...pts);
    } else {
      points.push(pts[pts.length - 1]);
    }
  }
  return points;
}

/**
 * DrawnPathRouter implements drawn-path following per PRD v1.4 section 3.2.2.
 * Vehicles follow the roads the user drew. The engine never searches for a shortest
 * or cheapest route and never uses edge weights.
 */
export class DrawnPathRouter implements Router {
  public readonly mapConfig: MapConfig;
  public readonly graph: RoadGraph;
  public readonly routesByEntrance = new Map<string, EntranceRouteSet>();
  public readonly validation: RouteValidationResult;
  private rng: () => number;

  constructor(mapConfig: MapConfig, graph?: RoadGraph, rng?: () => number) {
    this.mapConfig = mapConfig;
    this.graph = graph ?? buildRoadGraph(mapConfig);
    this.rng = rng ?? (() => Math.random());
    this.validation = this.buildAllRoutes();
  }

  public setRng(rng: () => number) {
    this.rng = rng;
  }

  private buildAllRoutes(): RouteValidationResult {
    let routeCounter = 1;
    const entranceMarkers = this.mapConfig.zoneMarkers.filter((m) => m.type === 'entrance');
    const exitMarkers = this.mapConfig.zoneMarkers.filter((m) => m.type === 'exit');
    const dropoffMarkers = this.mapConfig.zoneMarkers.filter((m) => m.type === 'dropoff');

    const entranceSummaries: EntranceValidationSummary[] = [];
    let overallValid = true;
    let firstError = '';

    for (const entrance of entranceMarkers) {
      const startNodeId = this.graph.entranceNodeMap.get(entrance.id);
      if (!startNodeId) {
        const errorMsg = `No road connects to ${entrance.name}`;
        this.routesByEntrance.set(entrance.id, {
          entranceId: entrance.id,
          entranceName: entrance.name,
          stickerWithDropoff: [],
          nonStickerWithDropoff: [],
          stickerDirect: [],
          nonStickerDirect: [],
          stickerAllowed: false,
          nonStickerAllowed: false,
          isTruncatedSticker: false,
          isTruncatedNonSticker: false,
          error: errorMsg,
        });
        entranceSummaries.push({
          entranceId: entrance.id,
          entranceName: entrance.name,
          stickerRoutesCount: 0,
          nonStickerRoutesCount: 0,
          stickerOnly: false,
          nonStickerOnly: false,
          truncated: false,
          error: errorMsg,
          reachable: {
            sticker: { dropoffIds: [], direct: false },
            nonSticker: { dropoffIds: [], direct: false },
          },
        });
        overallValid = false;
        if (!firstError) firstError = errorMsg;
        continue;
      }

      const routesWithDropoff: DrawnRoute[] = [];
      const directRoutes: DrawnRoute[] = [];

      let hasLeg1ToAnyDropoff = false;
      let hasLeg2FromAnyDropoff = false;

      // 1. Routes with drop-off (Entrance -> Drop-off -> Exit)
      for (const dropoff of dropoffMarkers) {
        const dropoffNodeId = this.graph.dropoffNodeMap.get(dropoff.id);
        if (!dropoffNodeId) continue;

        const leg1List = findLoopFreeLegs(this.graph, startNodeId, dropoffNodeId, 500);
        if (leg1List.length > 0) hasLeg1ToAnyDropoff = true;

        for (const exit of exitMarkers) {
          const exitNodeId = this.graph.exitNodeMap.get(exit.id);
          if (!exitNodeId) continue;

          const leg2List = findLoopFreeLegs(this.graph, dropoffNodeId, exitNodeId, 500);
          if (leg2List.length > 0) hasLeg2FromAnyDropoff = true;

          // Join each leg1 with each leg2.
          // Spec: "A route may not reuse a node, except that the drop-off node joins the two legs."
          for (const leg1 of leg1List) {
            const leg1Nodes = new Set<string>();
            leg1Nodes.add(startNodeId);
            for (const edge of leg1) {
              leg1Nodes.add(edge.toNodeId);
            }

            for (const leg2 of leg2List) {
              let reusesNode = false;
              for (const edge of leg2) {
                // The dropoff node joins the two legs, so edge.fromNodeId on the first edge of leg2 is dropoffNodeId.
                // Any subsequent node visited in leg2 must not be in leg1Nodes (except dropoffNodeId).
                if (edge.toNodeId !== dropoffNodeId && leg1Nodes.has(edge.toNodeId)) {
                  reusesNode = true;
                  break;
                }
              }

              if (!reusesNode) {
                const combinedEdges = [...leg1, ...leg2];
                const isEligibleSticker = combinedEdges.every(
                  (e) => e.access !== 'non-sticker-only'
                );
                const isEligibleNonSticker = combinedEdges.every(
                  (e) => e.access !== 'sticker-only'
                );

                routesWithDropoff.push({
                  id: `route-${entrance.id}-${dropoff.id}-${exit.id}-${routeCounter++}`,
                  entranceId: entrance.id,
                  exitId: exit.id,
                  dropoffId: dropoff.id,
                  edges: combinedEdges,
                  points: buildRoutePoints(combinedEdges),
                  isEligibleSticker,
                  isEligibleNonSticker,
                  edgeCount: combinedEdges.length,
                });
              }
            }
          }
        }
      }

      // 2. Direct routes skipping drop-off (Entrance -> Exit directly)
      const dropoffNodeIds = new Set(this.graph.dropoffNodeMap.values());
      for (const exit of exitMarkers) {
        const exitNodeId = this.graph.exitNodeMap.get(exit.id);
        if (!exitNodeId) continue;

        const directLegs = findLoopFreeLegs(this.graph, startNodeId, exitNodeId, 500);
        for (const edges of directLegs) {
          // Exclude routes that pass through a drop-off node
          const passesDropoff = edges.some(
            (e) => dropoffNodeIds.has(e.toNodeId) || dropoffNodeIds.has(e.fromNodeId)
          );
          if (!passesDropoff) {
            const isEligibleSticker = edges.every((e) => e.access !== 'non-sticker-only');
            const isEligibleNonSticker = edges.every((e) => e.access !== 'sticker-only');
            directRoutes.push({
              id: `route-direct-${entrance.id}-${exit.id}-${routeCounter++}`,
              entranceId: entrance.id,
              exitId: exit.id,
              edges,
              points: buildRoutePoints(edges),
              isEligibleSticker,
              isEligibleNonSticker,
              edgeCount: edges.length,
            });
          }
        }
      }

      // 3. Classify into sticker and non-sticker eligible sets
      let stickerWithDropoff = routesWithDropoff.filter((r) => r.isEligibleSticker);
      let nonStickerWithDropoff = routesWithDropoff.filter((r) => r.isEligibleNonSticker);
      let stickerDirect = directRoutes.filter((r) => r.isEligibleSticker);
      let nonStickerDirect = directRoutes.filter((r) => r.isEligibleNonSticker);

      // 4. Cap at 200 routes per entrance and per vehicle class (sort by fewest edges)
      let isTruncatedSticker = false;
      let isTruncatedNonSticker = false;

      if (stickerWithDropoff.length > 200) {
        stickerWithDropoff.sort((a, b) => a.edgeCount - b.edgeCount);
        stickerWithDropoff = stickerWithDropoff.slice(0, 200);
        isTruncatedSticker = true;
      }
      if (nonStickerWithDropoff.length > 200) {
        nonStickerWithDropoff.sort((a, b) => a.edgeCount - b.edgeCount);
        nonStickerWithDropoff = nonStickerWithDropoff.slice(0, 200);
        isTruncatedNonSticker = true;
      }
      if (stickerDirect.length > 200) {
        stickerDirect.sort((a, b) => a.edgeCount - b.edgeCount);
        stickerDirect = stickerDirect.slice(0, 200);
      }
      if (nonStickerDirect.length > 200) {
        nonStickerDirect.sort((a, b) => a.edgeCount - b.edgeCount);
        nonStickerDirect = nonStickerDirect.slice(0, 200);
      }

      const stickerAllowed = stickerWithDropoff.length > 0 || stickerDirect.length > 0;
      const nonStickerAllowed = nonStickerWithDropoff.length > 0 || nonStickerDirect.length > 0;
      const stickerOnly = stickerAllowed && !nonStickerAllowed;
      const nonStickerOnly = !stickerAllowed && nonStickerAllowed;
      const hasAnyRoute = stickerAllowed || nonStickerAllowed;

      // Determine validation error if no vehicle class can use any route
      let entranceError: string | undefined;

      if (!hasAnyRoute) {
        const totalTopologicalRoutes = routesWithDropoff.length + directRoutes.length;

        if (exitMarkers.length === 0) {
          entranceError = 'No exit marker placed on campus';
        } else if (totalTopologicalRoutes > 0) {
          entranceError = `Roads from ${entrance.name} to an exit mix sticker-only and non-sticker-only sections, so no vehicle class can drive the whole way.`;
        } else if (dropoffMarkers.length > 0) {
          if (!hasLeg1ToAnyDropoff) {
            entranceError = `No road connects ${entrance.name} to a drop-off`;
          } else if (!hasLeg2FromAnyDropoff) {
            entranceError = 'No road connects the drop-off to an exit';
          } else {
            entranceError = `No loop-free path connects ${entrance.name} through drop-off to an exit`;
          }
        } else {
          entranceError = `No road connects ${entrance.name} to an exit`;
        }

        overallValid = false;
        if (!firstError) firstError = entranceError;
      }

      this.routesByEntrance.set(entrance.id, {
        entranceId: entrance.id,
        entranceName: entrance.name,
        stickerWithDropoff,
        nonStickerWithDropoff,
        stickerDirect,
        nonStickerDirect,
        stickerAllowed,
        nonStickerAllowed,
        isTruncatedSticker,
        isTruncatedNonSticker,
        error: entranceError,
      });

      entranceSummaries.push({
        entranceId: entrance.id,
        entranceName: entrance.name,
        stickerRoutesCount: stickerWithDropoff.length > 0 ? stickerWithDropoff.length : stickerDirect.length,
        nonStickerRoutesCount: nonStickerWithDropoff.length > 0 ? nonStickerWithDropoff.length : nonStickerDirect.length,
        stickerOnly,
        nonStickerOnly,
        truncated: isTruncatedSticker || isTruncatedNonSticker,
        error: entranceError,
        reachable: this.reachableDestinations(entrance.id),
      });
    }

    return {
      isValid: overallValid,
      entranceSummaries,
      errorMessage: firstError || undefined,
    };
  }

  /**
   * Returns whether sticker and/or non-sticker vehicles are allowed for an entrance.
   */
  public allowedClasses(entranceId: string): { sticker: boolean; nonSticker: boolean } {
    const data = this.routesByEntrance.get(entranceId);
    if (!data) return { sticker: false, nonSticker: false };
    return {
      sticker: data.stickerAllowed,
      nonSticker: data.nonStickerAllowed,
    };
  }

  /**
   * Returns drop-off zone IDs and direct route availability reachable from an entrance per vehicle class.
   */
  public reachableDestinations(entranceId: string): {
    sticker: { dropoffIds: string[]; direct: boolean };
    nonSticker: { dropoffIds: string[]; direct: boolean };
  } {
    const data = this.routesByEntrance.get(entranceId);
    if (!data) {
      return {
        sticker: { dropoffIds: [], direct: false },
        nonSticker: { dropoffIds: [], direct: false },
      };
    }

    const stickerDropoffSet = new Set<string>();
    for (const r of data.stickerWithDropoff) {
      if (r.dropoffId) stickerDropoffSet.add(r.dropoffId);
    }
    const nonStickerDropoffSet = new Set<string>();
    for (const r of data.nonStickerWithDropoff) {
      if (r.dropoffId) nonStickerDropoffSet.add(r.dropoffId);
    }

    const dropoffMarkers = this.mapConfig.zoneMarkers.filter((m) => m.type === 'dropoff');
    const stickerDropoffIds: string[] = [];
    const nonStickerDropoffIds: string[] = [];

    for (const m of dropoffMarkers) {
      if (stickerDropoffSet.has(m.id)) {
        stickerDropoffIds.push(m.id);
      }
      if (nonStickerDropoffSet.has(m.id)) {
        nonStickerDropoffIds.push(m.id);
      }
    }

    return {
      sticker: {
        dropoffIds: stickerDropoffIds,
        direct: data.stickerDirect.length > 0,
      },
      nonSticker: {
        dropoffIds: nonStickerDropoffIds,
        direct: data.nonStickerDirect.length > 0,
      },
    };
  }

  /**
   * Chooses destination (dropoff or direct) using cumulative distribution of weights from split
   * across reachable options for the vehicle class, with a single random roll in [0, 1).
   */
  public chooseDestination(
    entranceId: string,
    isSticker: boolean,
    split: Record<string, number>,
    roll: number
  ): { usesDropoff: boolean; dropoffId?: string } | null {
    const reachable = this.reachableDestinations(entranceId);
    const classReachable = isSticker ? reachable.sticker : reachable.nonSticker;

    // Keys in fixed order: drop-offs in map order, then 'direct'
    const reachableKeys: string[] = [];
    for (const dId of classReachable.dropoffIds) {
      reachableKeys.push(dId);
    }
    if (classReachable.direct) {
      reachableKeys.push('direct');
    }

    if (reachableKeys.length === 0) {
      return null;
    }

    // Weights from split (missing = 0)
    const weights: number[] = reachableKeys.map((k) => {
      const w = split[k];
      return typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : 0;
    });

    const totalWeight = weights.reduce((acc, w) => acc + w, 0);

    let normalizedWeights: number[];
    if (totalWeight <= 0) {
      const equalShare = 1 / reachableKeys.length;
      normalizedWeights = reachableKeys.map(() => equalShare);
    } else {
      normalizedWeights = weights.map((w) => w / totalWeight);
    }

    let cumulative = 0;
    let chosenKey = reachableKeys[reachableKeys.length - 1];

    for (let i = 0; i < reachableKeys.length; i++) {
      cumulative += normalizedWeights[i];
      if (roll < cumulative || i === reachableKeys.length - 1) {
        chosenKey = reachableKeys[i];
        break;
      }
    }

    if (chosenKey === 'direct') {
      return { usesDropoff: false };
    }
    return { usesDropoff: true, dropoffId: chosenKey };
  }

  /**
   * Router implementation conforming to the Router interface:
   * route(vehicle, graph) -> edge list
   * Picks one route uniformly at random from the eligible set for that entrance and class.
   * If targetDropoffId is given, the pool is only the routes of the vehicle's class with that dropoffId,
   * with NO fallback to direct routes or other drop-offs; returns null if empty.
   * If targetDropoffId is not given, previous behavior is preserved.
   */
  public route(
    vehicle: { isSticker: boolean; usesDropoff: boolean },
    graph: RoadGraph,
    entranceMarkerId: string,
    targetExitId?: string,
    targetDropoffId?: string
  ): {
    routeEdges: GraphEdge[];
    routePoints: Point[];
    targetExitId: string;
    dropoffId?: string;
  } | null {
    const entranceData = this.routesByEntrance.get(entranceMarkerId);
    if (!entranceData) return null;

    let pool: DrawnRoute[];

    if (targetDropoffId !== undefined) {
      const candidates = vehicle.isSticker
        ? entranceData.stickerWithDropoff
        : entranceData.nonStickerWithDropoff;
      pool = candidates.filter((r) => r.dropoffId === targetDropoffId);
    } else {
      if (vehicle.isSticker) {
        if (vehicle.usesDropoff) {
          pool = entranceData.stickerWithDropoff;
          if (pool.length === 0) {
            pool = entranceData.stickerDirect;
          }
        } else {
          pool = entranceData.stickerDirect;
          if (pool.length === 0) {
            pool = entranceData.stickerWithDropoff;
          }
        }
      } else {
        if (vehicle.usesDropoff) {
          pool = entranceData.nonStickerWithDropoff;
          if (pool.length === 0) {
            pool = entranceData.nonStickerDirect;
          }
        } else {
          pool = entranceData.nonStickerDirect;
          if (pool.length === 0) {
            pool = entranceData.nonStickerWithDropoff;
          }
        }
      }
    }

    if (targetExitId) {
      pool = pool.filter((r) => r.exitId === targetExitId);
    }

    if (pool.length === 0) {
      return null;
    }

    // Uniformly at random from eligible set
    const selected = pool[Math.floor(this.rng() * pool.length)];
    return {
      routeEdges: selected.edges,
      routePoints: selected.points,
      targetExitId: selected.exitId,
      dropoffId: selected.dropoffId,
    };
  }

  /**
   * Configured maximum capacity per ENGINE SPEC:
   * "for each entrance, take the route with the fewest edges, compute min(lanes x 1900) along it,
   * then take the minimum across entrances"
   * Evaluates routes of both classes (not only sticker routes).
   */
  public getConfiguredMaxCapacity(): number {
    let minEntranceCapacity = Infinity;

    for (const [_, data] of this.routesByEntrance.entries()) {
      const routeMap = new Map<string, DrawnRoute>();
      for (const r of data.stickerWithDropoff) routeMap.set(r.id, r);
      for (const r of data.stickerDirect) routeMap.set(r.id, r);
      for (const r of data.nonStickerWithDropoff) routeMap.set(r.id, r);
      for (const r of data.nonStickerDirect) routeMap.set(r.id, r);
      const allRoutes = Array.from(routeMap.values());
      if (allRoutes.length === 0) continue;

      let fewestRoute = allRoutes[0];
      for (const r of allRoutes) {
        if (r.edges.length < fewestRoute.edges.length) {
          fewestRoute = r;
        }
      }

      let routeMinLanes = Infinity;
      for (const edge of fewestRoute.edges) {
        routeMinLanes = Math.min(routeMinLanes, edge.lanes || 1);
      }

      if (isFinite(routeMinLanes) && routeMinLanes > 0) {
        minEntranceCapacity = Math.min(minEntranceCapacity, routeMinLanes * 1900);
      }
    }

    if (isFinite(minEntranceCapacity) && minEntranceCapacity > 0) {
      return minEntranceCapacity;
    }

    let minSegLanes = Infinity;
    for (const seg of this.mapConfig.roadSegments) {
      minSegLanes = Math.min(minSegLanes, seg.lanes || 1);
    }
    return (isFinite(minSegLanes) && minSegLanes > 0 ? minSegLanes : 1) * 1900;
  }
}

/**
 * Convenience wrapper for router
 */
export function planFullVehicleRoute(
  graph: RoadGraph,
  entranceMarkerId: string,
  isSticker: boolean,
  targetExitId?: string,
  visitDropoff: boolean = true,
  mapConfig?: MapConfig
): {
  routeEdges: GraphEdge[];
  routePoints: Point[];
  targetExitId: string;
  dropoffId?: string;
} | null {
  if (!mapConfig) return null;
  const router = new DrawnPathRouter(mapConfig, graph);
  return router.route(
    { isSticker, usesDropoff: visitDropoff },
    graph,
    entranceMarkerId,
    targetExitId
  );
}
