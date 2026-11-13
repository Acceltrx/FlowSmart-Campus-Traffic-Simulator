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
import { getQueueStatus, getSegmentUsageStatus } from '../utils/status';

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
        description: `${topBottleneck.segmentName} is the main bottleneck on campus. Adding a second unloading bay lets two cars drop off at the same time and shortens the line of cars.`,
      });
    } else {
      insights.push({
        id: 'insight-stagger-dropoff',
        category: 'Timing',
        title: 'Stagger drop-off windows',
        description: `${topBottleneck.segmentName} is the busiest spot on campus. Spreading out arrival times stops the drop-off loop from backing up.`,
      });
    }
  }

  // Rule 2: A segment at >= 80% usage while a parallel path sits under 60% -> 'Reroute flow to the underused road'
  const segUtils = result.segmentUtilization || [];
  const busySegment = segUtils.find((s) => getSegmentUsageStatus(s.utilizationPct).level === 'bad');
  const quietSegment = segUtils.find(
    (s) =>
      getSegmentUsageStatus(s.utilizationPct).level === 'good' &&
      s.segmentId !== busySegment?.segmentId
  );

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
      description: `${busyName} reached ${busySegment.utilizationPct}% of its capacity while ${quietName} only used ${quietSegment.utilizationPct}%. Guiding some cars onto the quieter road will balance traffic.`,
    });
  }

  // Rule 3: Line of cars at an entrance exceeds 10 vehicles -> 'Add a lane or a second gate at <name>'
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
      description: `The line of cars at ${entranceBottleneck.segmentName} peaked at ${entranceBottleneck.maxQueueLength} cars. Adding an extra inbound lane or a second gate will stop cars spilling back onto nearby streets.`,
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
      description: `${blockedSpawns} cars were blocked from entering and ${unroutableSpawns} could not find a route. Check for conflicting one-way arrows or sticker-only roads near ${gateName}.`,
    });
  }

  // Rule 5: Fallback if fewer than 2 apply -> report the top two bottlenecks with their longest line of cars
  if (insights.length < 2) {
    if (bottlenecks.length > 0) {
      const b1 = bottlenecks[0];
      if (!insights.some((i) => i.description.includes(b1.segmentName))) {
        const b1Status = getQueueStatus(b1.maxQueueLength).label.toLowerCase();
        insights.push({
          id: `insight-fallback-b1-${b1.segmentId}`,
          category: 'Bottleneck',
          title: `Ease the backup at ${b1.segmentName}`,
          description: `${b1.segmentName} had a longest line of ${b1.maxQueueLength} cars (${b1Status}). Widening the road or staggering arrivals would help.`,
        });
      }
    }

    if (bottlenecks.length > 1 && insights.length < 2) {
      const b2 = bottlenecks[1];
      if (!insights.some((i) => i.description.includes(b2.segmentName))) {
        const b2Status = getQueueStatus(b2.maxQueueLength).label.toLowerCase();
        insights.push({
          id: `insight-fallback-b2-${b2.segmentId}`,
          category: 'Bottleneck',
          title: `Keep traffic moving along ${b2.segmentName}`,
          description: `${b2.segmentName} reached a longest line of ${b2.maxQueueLength} cars (${b2Status}). Adjusting lane access or direction could clear it faster.`,
        });
      }
    }
  }

  // Final fallback if still fewer than 2 insights (e.g. empty map or completely clear run)
  if (insights.length < 2) {
    const firstRoad = mapConfig?.roadSegments[0]?.name || 'the main campus road';
    const secondRoad = mapConfig?.roadSegments[1]?.name || 'the secondary campus road';

    if (insights.length === 0) {
      insights.push({
        id: 'insight-generic-1',
        category: 'Timing',
        title: `Stagger arrival times along ${firstRoad}`,
        description: `Spreading out arrival times prevents too many cars hitting ${firstRoad} at once.`,
      });
    }

    if (insights.length === 1) {
      insights.push({
        id: 'insight-generic-2',
        category: 'Circulation',
        title: `Balance traffic along ${secondRoad}`,
        description: `Guiding some cars along ${secondRoad} evens out road capacity used and keeps trips smooth.`,
      });
    }
  }

  return insights;
}
