import { Point, RoadSegment } from '../types/traffic';

/**
 * Calculates Euclidean distance between two points.
 */
export function distance(p1: Point, p2: Point): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Finds the closest point on segment AB to point P.
 */
export function closestPointOnSegment(p: Point, a: Point, b: Point): { point: Point; t: number; dist: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return { point: a, t: 0, dist: distance(p, a) };
  }

  // Projection scalar t
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const proj = {
    x: Math.round(a.x + t * dx),
    y: Math.round(a.y + t * dy),
  };

  return { point: proj, t, dist: distance(p, proj) };
}

/**
 * Snaps a target point to existing node positions if within radius.
 */
export function snapToNearbyNode(target: Point, nodes: Point[], radius: number = 16): Point | null {
  let closest: Point | null = null;
  let minDist = radius;

  for (const node of nodes) {
    const d = distance(target, node);
    if (d <= minDist) {
      minDist = d;
      closest = node;
    }
  }

  return closest;
}

/**
 * Counts unique intersection points (points shared by multiple segments or intersecting lines).
 */
export function countIntersections(segments: RoadSegment[]): number {
  const pointCounts = new Map<string, number>();

  for (const seg of segments) {
    for (const p of seg.points) {
      // Group points by 10px grid bucket to identify connections
      const key = `${Math.round(p.x / 8) * 8},${Math.round(p.y / 8) * 8}`;
      pointCounts.set(key, (pointCounts.get(key) || 0) + 1);
    }
  }

  let intersections = 0;
  for (const count of pointCounts.values()) {
    if (count > 1) {
      intersections++;
    }
  }

  return Math.max(intersections, 0);
}

/**
 * Splits a road segment at a given point into two connected segments.
 */
export function splitRoadSegment(
  segment: RoadSegment,
  splitPoint: Point
): { newSeg1: RoadSegment; newSeg2: RoadSegment } | null {
  if (segment.points.length < 2) return null;

  let bestIndex = 0;
  let bestProj: Point = splitPoint;
  let minDistance = Infinity;

  for (let i = 0; i < segment.points.length - 1; i++) {
    const a = segment.points[i];
    const b = segment.points[i + 1];
    const { point, dist } = closestPointOnSegment(splitPoint, a, b);
    if (dist < minDistance) {
      minDistance = dist;
      bestIndex = i;
      bestProj = point;
    }
  }

  if (minDistance > 35) {
    return null; // Click was not close enough to road
  }

  const firstPoints = [...segment.points.slice(0, bestIndex + 1), bestProj];
  const secondPoints = [bestProj, ...segment.points.slice(bestIndex + 1)];

  const newSeg1: RoadSegment = {
    ...segment,
    id: `${segment.id}-a`,
    name: `${segment.name} (Part 1)`,
    points: firstPoints,
  };

  const newSeg2: RoadSegment = {
    ...segment,
    id: `${segment.id}-b`,
    name: `${segment.name} (Part 2)`,
    points: secondPoints,
  };

  return { newSeg1, newSeg2 };
}

export interface PolylineSample {
  point: Point;
  heading: number; // in degrees
  distanceAlong: number;
}

/**
 * Calculates total polyline length in units.
 */
export function polylineLength(points: Point[]): number {
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) {
    len += distance(points[i], points[i + 1]);
  }
  return len;
}

/**
 * Samples points and headings at regular intervals along a polyline.
 * Useful for directional chevrons on one-way roads.
 */
export function samplePolyline(
  points: Point[],
  interval: number = 40,
  startOffset?: number
): PolylineSample[] {
  if (points.length < 2) return [];

  const totalLen = polylineLength(points);
  if (totalLen <= 0) return [];

  const segLengths: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    segLengths.push(distance(points[i], points[i + 1]));
  }

  const samples: PolylineSample[] = [];
  // Center chevrons along path or start with half-interval
  const offset = startOffset !== undefined ? startOffset : Math.min(interval / 2, totalLen / 2);

  let targetDist = offset;
  let currSegIdx = 0;
  let accumulatedDist = 0;

  while (targetDist <= totalLen - 4) {
    while (
      currSegIdx < segLengths.length - 1 &&
      accumulatedDist + segLengths[currSegIdx] < targetDist
    ) {
      accumulatedDist += segLengths[currSegIdx];
      currSegIdx++;
    }

    const p1 = points[currSegIdx];
    const p2 = points[currSegIdx + 1];
    const segLen = segLengths[currSegIdx];

    if (segLen > 0) {
      const t = (targetDist - accumulatedDist) / segLen;
      const x = p1.x + t * (p2.x - p1.x);
      const y = p1.y + t * (p2.y - p1.y);
      const angleRad = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const heading = (angleRad * 180) / Math.PI;

      samples.push({
        point: { x, y },
        heading,
        distanceAlong: targetDist,
      });
    }

    targetDist += interval;
  }

  return samples;
}

/**
 * Finds the midpoint position along a polyline.
 */
export function polylineMidpoint(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];

  const totalLen = polylineLength(points);
  const halfLen = totalLen / 2;

  let accumulatedDist = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const segLen = distance(points[i], points[i + 1]);
    if (accumulatedDist + segLen >= halfLen) {
      const t = segLen > 0 ? (halfLen - accumulatedDist) / segLen : 0;
      return {
        x: points[i].x + t * (points[i + 1].x - points[i].x),
        y: points[i].y + t * (points[i + 1].y - points[i].y),
      };
    }
    accumulatedDist += segLen;
  }

  const last = points[points.length - 1];
  return { x: last.x, y: last.y };
}

export { splitRoadAt } from './wireGeometry';
