/**
 * FlowSmart - Actionable Insights Generator
 * Evaluates simulation results and produces domain-specific, actionable recommendations
 * for campus traffic planning based on queue lengths, bottlenecks, and flow efficiency.
 * Strictly implements the 5 engine rules (always at least 2 insights):
 * 1. Top bottleneck is drop-off zone -> 'Stagger drop-off windows' or 'Add a second loading bay'
 * 2. Segment above 80% utilization while parallel sits under 60% -> 'Reroute flow to the underused road'
 * 3. Queue at an entrance exceeds 10 vehicles -> 'Add a lane or a second gate at <name>'
 * 4. Many unroutable or blocked spawns -> 'Check one-way and sticker rules near <name>'
 * 5. Fallback if fewer than 2 apply -> report top two bottlenecks with their max queue
 * No wording about signals or crossings.
 */

import { SimulationResult, MapConfig } from '../types/traffic';
import { distance } from '../utils/mapGeometry';

export interface ActionableInsight {
  id: string;
  category: 'Drop-off' | 'Circulation' | 'Access Control' | 'Timing' | 'Bottleneck';
  title: string;
  description: string;
}

export function generateActionableInsights(
  result: SimulationResult,
  mapConfig?: MapConfig
): ActionableInsight[] {
  const insights: ActionableInsight[] = [];
  const bottlenecks = result.bottlenecks || [];
  const topBottleneck = bottlenecks[0];

  // Rule 1: Top bottleneck is the drop-off zone -> 'Stagger drop-off windows' or 'Add a second loading bay'
  const topSegment = topBottleneck
    ? mapConfig?.roadSegments.find((r) => r.id === topBottleneck.segmentId)
    : undefined;
  const dropoffMarkers = mapConfig?.zoneMarkers.filter((m) => m.type === 'dropoff') || [];
  const isNearDropoff = Boolean(
    topSegment &&
      dropoffMarkers.some((m) => topSegment.points.some((p) => distance(p, m.position) <= 12))
  );

  const isTopDropoff =
    topBottleneck &&
    (topBottleneck.segmentName.toLowerCase().includes('drop-off') ||
      topBottleneck.segmentName.toLowerCase().includes('dropoff') ||
      topBottleneck.segmentName.toLowerCase().includes('loop') ||
      isNearDropoff);

  if (isTopDropoff) {
    if (topBottleneck.maxQueueLength > 8) {
      insights.push({
        id: 'insight-second-bay',
        category: 'Drop-off',
        title: 'Add a second loading bay',
        description: `The drop-off zone (${topBottleneck.segmentName}) is the primary bottleneck on campus. Providing a second parallel unloading bay allows multiple vehicles to disembark students simultaneously and eliminates vehicle tailback.`,
      });
    } else {
      insights.push({
        id: 'insight-stagger-dropoff',
        category: 'Timing',
        title: 'Stagger drop-off windows',
        description: `The drop-off zone (${topBottleneck.segmentName}) is the campus peak bottleneck. Separating arrival times between elementary and high school grade levels smooths arrival distribution and prevents drop-off loop saturation.`,
      });
    }
  }

  // Rule 2: A segment above 80% utilization while a parallel path sits under 60% -> 'Reroute flow to the underused road'
  const segUtils = result.segmentUtilization || [];
  const busySegment = segUtils.find((s) => s.utilizationPct >= 80);
  const quietSegment = segUtils.find((s) => s.utilizationPct < 60 && s.segmentId !== busySegment?.segmentId);

  if (busySegment && quietSegment) {
    const busyName =
      bottlenecks.find((b) => b.segmentId === busySegment.segmentId)?.segmentName ||
      mapConfig?.roadSegments.find((r) => r.id === busySegment.segmentId)?.name ||
      busySegment.segmentId;
    const quietName =
      bottlenecks.find((b) => b.segmentId === quietSegment.segmentId)?.segmentName ||
      mapConfig?.roadSegments.find((r) => r.id === quietSegment.segmentId)?.name ||
      quietSegment.segmentId;

    insights.push({
      id: 'insight-reroute-parallel',
      category: 'Circulation',
      title: 'Reroute flow to the underused road',
      description: `${busyName} reached ${busySegment.utilizationPct}% utilization while alternative route ${quietName} operated at ${quietSegment.utilizationPct}%. Designating directional bypasses will balance corridor loads.`,
    });
  }

  // Rule 3: Queue at an entrance exceeds 10 vehicles -> 'Add a lane or a second gate at <name>'
  const entranceMarkers = mapConfig?.zoneMarkers.filter((m) => m.type === 'entrance') || [];
  const entranceBottleneck = bottlenecks.find((b) => {
    if (b.maxQueueLength <= 10) return false;
    const nameLower = b.segmentName.toLowerCase();
    if (
      nameLower.includes('gate') ||
      nameLower.includes('entry') ||
      nameLower.includes('approach')
    ) {
      return true;
    }
    const seg = mapConfig?.roadSegments.find((r) => r.id === b.segmentId);
    return Boolean(
      seg && entranceMarkers.some((m) => seg.points.some((p) => distance(p, m.position) <= 12))
    );
  });

  if (entranceBottleneck) {
    insights.push({
      id: `insight-gate-lane-${entranceBottleneck.segmentId}`,
      category: 'Access Control',
      title: `Add a lane or a second gate at ${entranceBottleneck.segmentName}`,
      description: `Queues at ${entranceBottleneck.segmentName} peaked at ${entranceBottleneck.maxQueueLength} vehicles. Adding an additional inbound lane or dual-channel entry will prevent spillback into perimeter streets.`,
    });
  }

  // Rule 4: Many unroutable or blocked spawns -> 'Check one-way and sticker rules near <name>'
  const blockedSpawns = result.blockedSpawnsCount || 0;
  const unroutableSpawns = result.unroutableSpawnsCount || 0;

  if (blockedSpawns > 5 || unroutableSpawns > 0) {
    const firstEntrance = mapConfig?.zoneMarkers.find((m) => m.type === 'entrance');
    const gateName = firstEntrance?.name || topBottleneck?.segmentName || (mapConfig?.roadSegments[0]?.name ?? 'the entrance gate');
    insights.push({
      id: 'insight-access-rules',
      category: 'Access Control',
      title: `Check one-way and sticker rules near ${gateName}`,
      description: `Simulation detected ${blockedSpawns} blocked spawns and ${unroutableSpawns} unroutable vehicle trips. Check for conflicting one-way directions or restrictive sticker-only road classifications near ${gateName}.`,
    });
  }

  // Rule 5: Fallback if fewer than 2 apply -> report the top two bottlenecks with their max queue
  if (insights.length < 2) {
    if (bottlenecks.length > 0) {
      const b1 = bottlenecks[0];
      if (!insights.some((i) => i.description.includes(b1.segmentName))) {
        insights.push({
          id: `insight-fallback-b1-${b1.segmentId}`,
          category: 'Bottleneck',
          title: `Mitigate congestion at ${b1.segmentName}`,
          description: `${b1.segmentName} recorded a peak queue of ${b1.maxQueueLength} vehicles (${b1.severity} severity). Consider widening road lanes or staggering departure schedules.`,
        });
      }
    }

    if (bottlenecks.length > 1 && insights.length < 2) {
      const b2 = bottlenecks[1];
      if (!insights.some((i) => i.description.includes(b2.segmentName))) {
        insights.push({
          id: `insight-fallback-b2-${b2.segmentId}`,
          category: 'Bottleneck',
          title: `Improve clearance along ${b2.segmentName}`,
          description: `${b2.segmentName} accumulated a peak queue of ${b2.maxQueueLength} vehicles. Adjust lane access or parking flow to improve corridor clearance.`,
        });
      }
    }
  }

  // Final fallback if still fewer than 2 insights (e.g. empty map or completely clear run)
  if (insights.length < 2) {
    const firstRoad = mapConfig?.roadSegments[0]?.name || 'the primary campus road';
    const secondRoad = mapConfig?.roadSegments[1]?.name || 'the secondary campus corridor';

    if (insights.length === 0) {
      insights.push({
        id: 'insight-generic-1',
        category: 'Timing',
        title: `Stagger arrival times along ${firstRoad}`,
        description: `Staggering vehicle arrivals by cohort prevents simultaneous peak loading along ${firstRoad}.`,
      });
    }

    if (insights.length === 1) {
      insights.push({
        id: 'insight-generic-2',
        category: 'Circulation',
        title: `Designate directional flow along ${secondRoad}`,
        description: `Optimizing circulation along ${secondRoad} balances flow efficiency and maintains smooth campus transit.`,
      });
    }
  }

  return insights;
}
