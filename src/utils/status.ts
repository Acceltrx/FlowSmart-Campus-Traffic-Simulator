/**
 * FlowSmart - Shared Status Bands & Styling
 * Single source of truth for status thresholds, plain-language pill labels,
 * and FlowSmart palette classes across Results, Run log, Bottlenecks, Live panel, and Insights.
 */

import { SpawnRates } from '../types/traffic';

export type StatusLevel = 'good' | 'warning' | 'bad';

export interface MetricStatus {
  level: StatusLevel;
  label: string;
  badgeClass: string;
  barClass: string;
  textClass: string;
}

const LEVEL_STYLES: Record<
  StatusLevel,
  { badgeClass: string; barClass: string; textClass: string }
> = {
  good: {
    badgeClass: 'bg-[#25A76B]/15 text-[#25A76B]',
    barClass: 'bg-[#25A76B]',
    textClass: 'text-[#25A76B]',
  },
  warning: {
    badgeClass: 'bg-[#F59E0B]/20 text-[#111C2D]',
    barClass: 'bg-[#F59E0B]',
    textClass: 'text-[#F59E0B]',
  },
  bad: {
    badgeClass: 'bg-[#EF4444]/15 text-[#EF4444]',
    barClass: 'bg-[#EF4444]',
    textClass: 'text-[#EF4444]',
  },
};

function makeStatus(level: StatusLevel, label: string): MetricStatus {
  return {
    level,
    label,
    ...LEVEL_STYLES[level],
  };
}

/**
 * Longest line of cars: good <= 5, warning 6 to 14, bad >= 15.
 */
export function getQueueStatus(cars: number): MetricStatus {
  if (cars >= 15) return makeStatus('bad', 'Backed up');
  if (cars >= 6) return makeStatus('warning', 'Building up');
  return makeStatus('good', 'Clear');
}

/**
 * Average wait in line: good < 30 s, warning 30 to 50 s, bad > 50 s.
 */
export function getWaitStatus(waitSec: number): MetricStatus {
  if (waitSec > 50) return makeStatus('bad', 'Too long');
  if (waitSec >= 30) return makeStatus('warning', 'Getting long');
  return makeStatus('good', 'Short');
}

/**
 * Average trip time: good < 150 s, warning 150 to 180 s, bad > 180 s.
 */
export function getTripTimeStatus(tripSec: number): MetricStatus {
  if (tripSec > 180) return makeStatus('bad', 'Too slow');
  if (tripSec >= 150) return makeStatus('warning', 'Slowish');
  return makeStatus('good', 'Quick');
}

/**
 * Road capacity used: good >= 75%, warning 60 to 74%, bad < 60%.
 */
export function getCapacityUsedStatus(pct: number): MetricStatus {
  if (pct >= 75) return makeStatus('good', 'Good');
  if (pct >= 60) return makeStatus('warning', 'Acceptable');
  return makeStatus('bad', 'Poor');
}

/**
 * Cars exiting per hour compared with arrivals per hour:
 * good >= 90% of arrivals, warning 70 to 89%, bad < 70%.
 */
export function getThroughputStatus(
  throughputVehHr: number,
  arrivalsPerHr: number
): MetricStatus {
  if (!Number.isFinite(arrivalsPerHr) || arrivalsPerHr <= 0) {
    return makeStatus('good', 'Keeping up');
  }
  const pct = Math.round((throughputVehHr / arrivalsPerHr) * 100);
  if (pct >= 90) return makeStatus('good', 'Keeping up');
  if (pct >= 70) return makeStatus('warning', 'Falling behind');
  return makeStatus('bad', 'Far behind');
}

/**
 * Helper to compute arrivals per hour for a run from configured gate rates,
 * falling back to spawned count and run duration if rates are unavailable.
 */
export function getArrivalsPerHour(
  spawnRates?: SpawnRates,
  fallbackSpawned?: number,
  durationMin?: number
): number {
  const rateSum = Object.values(spawnRates || {}).reduce(
    (sum, r) => sum + (typeof r === 'number' && Number.isFinite(r) && r > 0 ? r : 0),
    0
  );
  if (rateSum > 0) {
    return rateSum * 60;
  }
  if (
    typeof fallbackSpawned === 'number' &&
    fallbackSpawned > 0 &&
    typeof durationMin === 'number' &&
    durationMin > 0
  ) {
    return (fallbackSpawned / durationMin) * 60;
  }
  return 0;
}

/**
 * Live per-segment road usage bars (< 60% green, 60 to 80% amber, >= 80% red).
 */
export function getSegmentUsageStatus(pct: number): MetricStatus {
  if (pct >= 80) return makeStatus('bad', 'Over 80%');
  if (pct >= 60) return makeStatus('warning', '60 to 80%');
  return makeStatus('good', 'Under 60%');
}

/**
 * Overall run outcome derived from the shared status bands.
 */
export function getRunOutcome(params: {
  isGridlocked?: boolean;
  maxQueue: number;
  avgWait: number;
  avgTransit: number;
  flowEfficiency: number;
  throughput: number;
  arrivalsPerHr: number;
}): MetricStatus {
  if (params.isGridlocked) {
    return makeStatus('bad', 'Gridlocked');
  }

  const statuses = [
    getQueueStatus(params.maxQueue),
    getWaitStatus(params.avgWait),
    getTripTimeStatus(params.avgTransit),
    getCapacityUsedStatus(params.flowEfficiency),
    getThroughputStatus(params.throughput, params.arrivalsPerHr),
  ];

  if (statuses.some((s) => s.level === 'bad')) {
    return makeStatus('bad', 'Struggled');
  }
  if (statuses.some((s) => s.level === 'warning')) {
    return makeStatus('warning', 'Some build-up');
  }
  return makeStatus('good', 'Smooth');
}
