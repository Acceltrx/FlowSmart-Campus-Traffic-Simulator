/**
 * FlowSmart - Wire-drawing Geometry Utilities for TinkerCAD-style Road Tool
 *
 * Implements:
 * - Snap targets: endpoint/vertex -> zone marker -> road body (nearest point on line)
 * - 45-degree angle constraint for Shift key
 * - Road splitting at point with identical properties and sequential names
 * - Duplicate point cleanup and minimum length checks
 * - Topology detection: junctions (>= 3 road ends meet) and open ends
 */

import { Point, RoadSegment, ZoneMarker } from '../types/traffic';
import { distance, closestPointOnSegment } from './mapGeometry';

export type SnapTargetType = 'vertex' | 'marker' | 'road-body';

export interface SnapTarget {
  type: SnapTargetType;
  point: Point;
  roadId?: string;
  vertexIndex?: number;
  isEndpoint?: boolean;
  markerId?: string;
  marker?: ZoneMarker;
  road?: RoadSegment;
  segmentIndex?: number;
}

/**
 * Removes consecutive duplicate points (closer than 0.01 units).
 */
export function cleanConsecutiveDuplicatePoints(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const p of points) {
    if (result.length === 0) {
      result.push(p);
    } else {
      const last = result[result.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > 0.01) {
        result.push(p);
      }
    }
  }
  return result;
}

/**
 * Calculates polyline length in units.
 */
export function polylineLength(points: Point[]): number {
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) {
    len += distance(points[i], points[i + 1]);
  }
  return len;
}

/**
 * Locks segment from 'from' to 'to' to 0, 45, or 90 degrees increments (multiples of 45 deg).
 */
export function constrainTo45Degrees(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return to;

  const angle = Math.atan2(dy, dx);
  const step = Math.PI / 4; // 45 degrees
  const snappedAngle = Math.round(angle / step) * step;

  return {
    x: Math.round(from.x + dist * Math.cos(snappedAngle)),
    y: Math.round(from.y + dist * Math.sin(snappedAngle)),
  };
}

/**
 * Finds the next available sequential segment number based on existing names.
 */
export function getNextSegmentNumber(segments: RoadSegment[]): number {
  let maxNum = 0;
  for (const seg of segments) {
    const match = seg.name.match(/Segment\s*#?(\d+)/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }
  return maxNum > 0 ? maxNum + 1 : segments.length + 1;
}

/**
 * Formats a sequential segment name, e.g. "Segment #05".
 */
export function formatSegmentName(num: number): string {
  return `Segment #${String(num).padStart(2, '0')}`;
}

/**
 * Splits a road segment at a given point into two connected segments.
 * Both segments retain flow direction, access type, lanes, and speed limit.
 * Both halves share exactly the same coordinate at the split point.
 */
export function splitRoadAt(
  road: RoadSegment,
  point: Point,
  existingSegments: RoadSegment[] = []
): { newSeg1: RoadSegment; newSeg2: RoadSegment } {
  let bestIndex = 0;
  let minDistance = Infinity;
  let bestProj: Point = point;

  for (let i = 0; i < road.points.length - 1; i++) {
    const a = road.points[i];
    const b = road.points[i + 1];
    const { point: proj, dist } = closestPointOnSegment(point, a, b);
    if (dist < minDistance) {
      minDistance = dist;
      bestIndex = i;
      bestProj = proj;
    }
  }

  // Exact shared split coordinate
  const splitPt: Point = {
    x: Math.round(bestProj.x * 10) / 10,
    y: Math.round(bestProj.y * 10) / 10,
  };

  const pts1 = cleanConsecutiveDuplicatePoints([
    ...road.points.slice(0, bestIndex + 1),
    splitPt,
  ]);
  const pts2 = cleanConsecutiveDuplicatePoints([
    splitPt,
    ...road.points.slice(bestIndex + 1),
  ]);

  const finalPts1 = pts1.length >= 2 ? pts1 : [road.points[0], splitPt];
  const finalPts2 = pts2.length >= 2 ? pts2 : [splitPt, road.points[road.points.length - 1]];

  const allSegs = existingSegments.length > 0 ? existingSegments : [road];
  const nextNum = getNextSegmentNumber(allSegs);
  const seg1Name = formatSegmentName(nextNum);
  const seg2Name = formatSegmentName(nextNum + 1);

  const uid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const newSeg1: RoadSegment = {
    ...road,
    id: `${road.id}-s1-${uid}`,
    name: seg1Name,
    points: finalPts1,
    flowDirection: road.flowDirection,
    accessType: road.accessType,
    lanes: road.lanes || 1,
    speedLimitKmH: road.speedLimitKmH,
    capacity: road.capacity,
  };

  const newSeg2: RoadSegment = {
    ...road,
    id: `${road.id}-s2-${uid}`,
    name: seg2Name,
    points: finalPts2,
    flowDirection: road.flowDirection,
    accessType: road.accessType,
    lanes: road.lanes || 1,
    speedLimitKmH: road.speedLimitKmH,
    capacity: road.capacity,
  };

  return { newSeg1, newSeg2 };
}

/**
 * Searches for snap targets within threshold in strict priority order:
 * 1. Road endpoint or bend vertex
 * 2. Zone marker
 * 3. Body of any road (nearest point on its line)
 */
export function findSnapTarget(
  cursor: Point,
  roads: RoadSegment[],
  markers: ZoneMarker[],
  threshold: number,
  inProgressPoints: Point[] = []
): SnapTarget | null {
  // Priority 1: road endpoint or bend vertex
  let bestVertexTarget: SnapTarget | null = null;
  let bestVertexDist = threshold;

  for (const road of roads) {
    for (let i = 0; i < road.points.length; i++) {
      const pt = road.points[i];
      const d = distance(cursor, pt);
      if (d <= bestVertexDist) {
        bestVertexDist = d;
        bestVertexTarget = {
          type: 'vertex',
          point: { ...pt },
          roadId: road.id,
          vertexIndex: i,
          isEndpoint: i === 0 || i === road.points.length - 1,
          road,
        };
      }
    }
  }

  // Also allow snapping to start point of the in-progress road to close a circuit
  if (inProgressPoints.length >= 2) {
    const startPt = inProgressPoints[0];
    const d = distance(cursor, startPt);
    if (d <= bestVertexDist) {
      bestVertexDist = d;
      bestVertexTarget = {
        type: 'vertex',
        point: { ...startPt },
        isEndpoint: true,
      };
    }
  }

  if (bestVertexTarget) {
    return bestVertexTarget;
  }

  // Priority 2: zone marker
  let bestMarkerTarget: SnapTarget | null = null;
  let bestMarkerDist = threshold;

  for (const marker of markers) {
    const d = distance(cursor, marker.position);
    if (d <= bestMarkerDist) {
      bestMarkerDist = d;
      bestMarkerTarget = {
        type: 'marker',
        point: { ...marker.position },
        markerId: marker.id,
        marker,
      };
    }
  }

  if (bestMarkerTarget) {
    return bestMarkerTarget;
  }

  // Priority 3: body of any road (nearest point on its line)
  let bestBodyTarget: SnapTarget | null = null;
  let bestBodyDist = threshold;

  for (const road of roads) {
    for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i];
      const b = road.points[i + 1];
      const { point: proj, dist } = closestPointOnSegment(cursor, a, b);
      if (dist <= bestBodyDist) {
        bestBodyDist = dist;
        bestBodyTarget = {
          type: 'road-body',
          point: {
            x: Math.round(proj.x * 10) / 10,
            y: Math.round(proj.y * 10) / 10,
          },
          road,
          segmentIndex: i,
        };
      }
    }
  }

  return bestBodyTarget;
}

export interface TopologyFeatures {
  junctions: Point[];
  openEnds: Point[];
}

/**
 * Identifies junctions (>= 3 road ends meeting) and open ends (disconnected endpoints).
 */
export function findTopologyFeatures(
  roads: RoadSegment[],
  markers: ZoneMarker[]
): TopologyFeatures {
  const endpoints: { pt: Point; roadId: string }[] = [];
  for (const road of roads) {
    if (road.points.length >= 2) {
      endpoints.push({ pt: road.points[0], roadId: road.id });
      endpoints.push({ pt: road.points[road.points.length - 1], roadId: road.id });
    }
  }

  const CLUSTER_DIST = 4;
  const clusters: { center: Point; count: number; items: typeof endpoints }[] = [];

  for (const ep of endpoints) {
    let found = false;
    for (const c of clusters) {
      if (distance(ep.pt, c.center) <= CLUSTER_DIST) {
        c.count++;
        c.items.push(ep);
        found = true;
        break;
      }
    }
    if (!found) {
      clusters.push({
        center: { ...ep.pt },
        count: 1,
        items: [ep],
      });
    }
  }

  const junctions: Point[] = [];
  for (const c of clusters) {
    if (c.count >= 3) {
      junctions.push(c.center);
    }
  }

  const openEnds: Point[] = [];
  for (const c of clusters) {
    if (c.count === 1) {
      const pt = c.center;
      const nearMarker = markers.some((m) => distance(pt, m.position) <= CLUSTER_DIST);
      if (!nearMarker) {
        let touchesOtherRoad = false;
        for (const road of roads) {
          if (road.id === c.items[0].roadId) continue;
          for (let i = 0; i < road.points.length - 1; i++) {
            const { dist } = closestPointOnSegment(pt, road.points[i], road.points[i + 1]);
            if (dist <= CLUSTER_DIST) {
              touchesOtherRoad = true;
              break;
            }
          }
          if (touchesOtherRoad) break;
        }
        if (!touchesOtherRoad) {
          openEnds.push(pt);
        }
      }
    }
  }

  return { junctions, openEnds };
}

/**
 * Finds all vertices in any road that share the target point (within tolerance).
 * Used so connected ends and junctions move together during a drag.
 */
export function findConnectedVertices(
  roads: RoadSegment[],
  targetPoint: Point,
  tolerance = 0.5
): { roadId: string; vertexIndices: number[] }[] {
  const matches: { roadId: string; vertexIndices: number[] }[] = [];

  for (const road of roads) {
    const indices: number[] = [];
    for (let i = 0; i < road.points.length; i++) {
      if (distance(road.points[i], targetPoint) <= tolerance) {
        indices.push(i);
      }
    }
    if (indices.length > 0) {
      matches.push({ roadId: road.id, vertexIndices: indices });
    }
  }

  return matches;
}

/**
 * Evaluates snap targets during vertex dragging in strict priority:
 * 1. Road endpoint or bend vertex (excluding the vertices currently moving with the drag)
 * 2. Zone marker
 * 3. Road body (excluding incident segments of the vertex on the dragged road)
 */
export function findSnapTargetForDrag(
  cursor: Point,
  roads: RoadSegment[],
  markers: ZoneMarker[],
  threshold: number,
  excludeVertices: { roadId: string; vertexIndex: number }[],
  draggedRoadId: string,
  draggedVertexIndex: number
): SnapTarget | null {
  const isExcludedVertex = (roadId: string, idx: number) => {
    return excludeVertices.some((v) => v.roadId === roadId && v.vertexIndex === idx);
  };

  // Priority 1: Vertices (excluding moving ones)
  let bestVertexTarget: SnapTarget | null = null;
  let bestVertexDist = threshold;

  for (const road of roads) {
    for (let i = 0; i < road.points.length; i++) {
      if (isExcludedVertex(road.id, i)) continue;
      const pt = road.points[i];
      const d = distance(cursor, pt);
      if (d <= bestVertexDist) {
        bestVertexDist = d;
        bestVertexTarget = {
          type: 'vertex',
          point: { ...pt },
          roadId: road.id,
          vertexIndex: i,
          isEndpoint: i === 0 || i === road.points.length - 1,
          road,
        };
      }
    }
  }

  if (bestVertexTarget) {
    return bestVertexTarget;
  }

  // Priority 2: Markers
  let bestMarkerTarget: SnapTarget | null = null;
  let bestMarkerDist = threshold;

  for (const marker of markers) {
    const d = distance(cursor, marker.position);
    if (d <= bestMarkerDist) {
      bestMarkerDist = d;
      bestMarkerTarget = {
        type: 'marker',
        point: { ...marker.position },
        markerId: marker.id,
        marker,
      };
    }
  }

  if (bestMarkerTarget) {
    return bestMarkerTarget;
  }

  // Priority 3: Road bodies
  let bestBodyTarget: SnapTarget | null = null;
  let bestBodyDist = threshold;

  for (const road of roads) {
    for (let i = 0; i < road.points.length - 1; i++) {
      // If this is the road being dragged, skip the segments directly attached to the dragged vertex
      if (road.id === draggedRoadId) {
        if (i === draggedVertexIndex - 1 || i === draggedVertexIndex) {
          continue;
        }
      }

      const a = road.points[i];
      const b = road.points[i + 1];
      const { point: proj, dist } = closestPointOnSegment(cursor, a, b);
      if (dist <= bestBodyDist) {
        bestBodyDist = dist;
        bestBodyTarget = {
          type: 'road-body',
          point: {
            x: Math.round(proj.x * 10) / 10,
            y: Math.round(proj.y * 10) / 10,
          },
          road,
          segmentIndex: i,
        };
      }
    }
  }

  return bestBodyTarget;
}

