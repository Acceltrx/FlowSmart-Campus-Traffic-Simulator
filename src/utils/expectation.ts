/**
 * FlowSmart - Pre-run Expectation Estimate
 *
 * NOTE: This is an estimate from the settings only, not a simulation.
 * Actual traffic flow depends on road layout, bottlenecks, and driver behavior.
 */

import { MapConfig, SimulationSettings } from '../types/traffic';
import { DEFAULT_SETTINGS } from '../context/TrafficStoreContext';
import { getEntranceSplit } from './destinationSplit';

export type DropoffLoadLevel = 'comfortable' | 'busy' | 'overloaded';

export interface DropoffExpectation {
  id: string;
  name: string;
  arrivalsPerMin: number;
  capacityPerMin: number;
  loadPct: number;
  level: DropoffLoadLevel;
}

export interface SimulationExpectation {
  totalCarsPerMin: number;
  expectedCars: number;
  arrivalsPerHour: number;
  stickerCars: number;
  visitorCars: number;
  perDropoff: DropoffExpectation[];
  headline: string;
}

const DROPOFF_BAYS = 2;

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Computes a pre-run expectation summary from settings and map markers.
 * This is an estimate from the settings only, not a simulation.
 */
export function getExpectation(
  settings: SimulationSettings,
  map: MapConfig
): SimulationExpectation {
  const markers = map.zoneMarkers || [];
  const entrances = markers.filter((m) => m.type === 'entrance');
  const dropoffs = markers.filter((m) => m.type === 'dropoff');

  let totalCarsPerMin = 0;
  for (const ent of entrances) {
    const rawRate = settings.spawnRates?.[ent.id];
    const rate = typeof rawRate === 'number' && Number.isFinite(rawRate) && rawRate > 0 ? rawRate : 0;
    totalCarsPerMin += rate;
  }

  const durationMin =
    typeof settings.simDurationMin === 'number' &&
    Number.isFinite(settings.simDurationMin) &&
    settings.simDurationMin > 0
      ? settings.simDurationMin
      : DEFAULT_SETTINGS.simDurationMin;

  const expectedCars = Math.round(totalCarsPerMin * durationMin);
  const arrivalsPerHour = Math.round(totalCarsPerMin * 60);

  const rawStickerShare =
    typeof settings.stickerShare === 'number' && Number.isFinite(settings.stickerShare)
      ? settings.stickerShare
      : DEFAULT_SETTINGS.stickerShare;
  const stickerShare = Math.min(1, Math.max(0, rawStickerShare));
  const stickerCars = Math.round(expectedCars * stickerShare);
  const visitorCars = Math.max(0, expectedCars - stickerCars);

  const fallbackDwellMin = DEFAULT_SETTINGS.dropoffDwellMinSec ?? 20;
  const fallbackDwellMax = DEFAULT_SETTINGS.dropoffDwellMaxSec ?? 60;
  const dwellMin =
    typeof settings.dropoffDwellMinSec === 'number' &&
    Number.isFinite(settings.dropoffDwellMinSec) &&
    settings.dropoffDwellMinSec > 0
      ? settings.dropoffDwellMinSec
      : fallbackDwellMin;
  const dwellMax =
    typeof settings.dropoffDwellMaxSec === 'number' &&
    Number.isFinite(settings.dropoffDwellMaxSec) &&
    settings.dropoffDwellMaxSec > 0
      ? Math.max(dwellMin, settings.dropoffDwellMaxSec)
      : Math.max(dwellMin, fallbackDwellMax);

  const meanDropoffSec = (dwellMin + dwellMax) / 2;
  const rawCapacityPerMin = (DROPOFF_BAYS * 60) / meanDropoffSec;
  const capacityPerMin = roundToTwoDecimals(rawCapacityPerMin);

  const perDropoff: DropoffExpectation[] = dropoffs.map((dropoff) => {
    let rawArrivalsPerMin = 0;
    for (const ent of entrances) {
      const rawRate = settings.spawnRates?.[ent.id];
      const rate = typeof rawRate === 'number' && Number.isFinite(rawRate) && rawRate > 0 ? rawRate : 0;
      const split = getEntranceSplit(settings, map, ent.id);
      const pct = split[dropoff.id] ?? 0;
      rawArrivalsPerMin += rate * (pct / 100);
    }

    const loadPct = rawCapacityPerMin > 0 ? Math.round((rawArrivalsPerMin / rawCapacityPerMin) * 100) : 0;
    const level: DropoffLoadLevel =
      loadPct > 100 ? 'overloaded' : loadPct >= 70 ? 'busy' : 'comfortable';

    return {
      id: dropoff.id,
      name: dropoff.name,
      arrivalsPerMin: roundToTwoDecimals(rawArrivalsPerMin),
      capacityPerMin,
      loadPct,
      level,
    };
  });

  const overloaded = perDropoff.filter((d) => d.level === 'overloaded');
  let headline: string;
  if (overloaded.length > 0) {
    let worst = overloaded[0];
    for (let i = 1; i < overloaded.length; i++) {
      if (overloaded[i].loadPct > worst.loadPct) {
        worst = overloaded[i];
      }
    }
    headline = `${worst.name} is likely to back up`;
  } else if (perDropoff.some((d) => d.level === 'busy')) {
    headline = 'Drop-offs will be busy but should cope';
  } else {
    headline = 'Traffic should flow comfortably';
  }

  return {
    totalCarsPerMin: roundToTwoDecimals(totalCarsPerMin),
    expectedCars,
    arrivalsPerHour,
    stickerCars,
    visitorCars,
    perDropoff,
    headline,
  };
}
