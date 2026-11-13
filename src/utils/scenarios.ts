/**
 * FlowSmart - Preset Scenarios & Run Duration Options
 */

import { ScenarioId, SimulationSettings, SpawnRates, ZoneMarker } from '../types/traffic';

export type PresetScenarioId = Exclude<ScenarioId, 'custom'>;

export interface ScenarioDefinition {
  id: PresetScenarioId;
  name: string;
  note: string;
  stickerShare: number;
  rates: (entrances: readonly Pick<ZoneMarker, 'id'>[]) => SpawnRates;
}

export const DURATION_OPTIONS_MIN = [15, 30, 45, 60] as const;
export type DurationOptionMin = (typeof DURATION_OPTIONS_MIN)[number];

export const DEFAULT_DURATION_MIN: DurationOptionMin = 30;

function uniformRates(
  entrances: readonly Pick<ZoneMarker, 'id'>[],
  ratePerEntrance: number
): SpawnRates {
  const rates: SpawnRates = {};
  for (const ent of entrances) {
    rates[ent.id] = ratePerEntrance;
  }
  return rates;
}

export const SCENARIOS: readonly ScenarioDefinition[] = [
  {
    id: 'light',
    name: 'Light traffic',
    note: 'Quiet period',
    stickerShare: 0.7,
    rates: (entrances) => uniformRates(entrances, 2),
  },
  {
    id: 'normal',
    name: 'Normal morning',
    note: 'Typical day',
    stickerShare: 0.7,
    rates: (entrances) => uniformRates(entrances, 3),
  },
  {
    id: 'rush',
    name: 'Rush hour',
    note: 'Busy drop-off',
    stickerShare: 0.6,
    rates: (entrances) => {
      const rates: SpawnRates = {};
      entrances.forEach((ent, index) => {
        rates[ent.id] = index === 0 ? 6 : 5;
      });
      return rates;
    },
  },
];

/**
 * Clamps simDurationMin to one of DURATION_OPTIONS_MIN (default 30).
 * Values saved by older versions that are not in the list snap to the nearest option.
 */
export function clampDurationMin(value: unknown): DurationOptionMin {
  const num =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;

  if (!Number.isFinite(num) || num <= 0) {
    return DEFAULT_DURATION_MIN;
  }

  let best: DurationOptionMin = DURATION_OPTIONS_MIN[0];
  let bestDiff = Math.abs(num - best);

  for (let i = 1; i < DURATION_OPTIONS_MIN.length; i++) {
    const option = DURATION_OPTIONS_MIN[i];
    const diff = Math.abs(num - option);
    if (diff < bestDiff) {
      best = option;
      bestDiff = diff;
    }
  }

  return best;
}

/**
 * Applies a scenario preset to settings, returning new spawnRates, stickerShare, and scenarioId.
 * Leaves destinationSplits, simDurationMin, and all drop-off settings untouched.
 */
export function applyScenario(
  settings: SimulationSettings,
  entrances: readonly Pick<ZoneMarker, 'id'>[],
  scenarioId: ScenarioId
): SimulationSettings {
  if (scenarioId === 'custom') {
    return {
      ...settings,
      scenarioId: 'custom',
    };
  }

  const scenario = SCENARIOS.find((s) => s.id === scenarioId);
  if (!scenario) {
    return {
      ...settings,
      scenarioId: 'custom',
    };
  }

  return {
    ...settings,
    spawnRates: scenario.rates(entrances),
    stickerShare: scenario.stickerShare,
    scenarioId: scenario.id,
  };
}

/**
 * Returns the scenarioId whose arrival rates and sticker share match the current settings,
 * otherwise 'custom'.
 */
export function detectScenario(
  settings: Pick<SimulationSettings, 'spawnRates' | 'stickerShare'>,
  entrances: readonly Pick<ZoneMarker, 'id'>[]
): ScenarioId {
  if (entrances.length === 0) {
    return 'custom';
  }

  const stickerShare = typeof settings.stickerShare === 'number' ? settings.stickerShare : NaN;
  const spawnRates = settings.spawnRates || {};

  for (const scenario of SCENARIOS) {
    if (Math.abs(stickerShare - scenario.stickerShare) > 1e-6) {
      continue;
    }

    const expectedRates = scenario.rates(entrances);
    const allRatesMatch = entrances.every((ent) => {
      const actual = spawnRates[ent.id];
      return typeof actual === 'number' && Number.isFinite(actual) && actual === expectedRates[ent.id];
    });

    if (allRatesMatch) {
      return scenario.id;
    }
  }

  return 'custom';
}
