/**
 * FlowSmart - Console checks for scenarios, duration clamping, and pre-run expectations.
 * Does not touch or import the simulation engine.
 * Run with: npx tsx src/utils/scenariosExpectationTest.ts
 */

import { DEFAULT_SETTINGS } from '../context/TrafficStoreContext';
import { MapConfig, SimulationSettings } from '../types/traffic';
import { SAMPLE_MAP } from './sampleMap';
import {
  SCENARIOS,
  DURATION_OPTIONS_MIN,
  applyScenario,
  detectScenario,
  clampDurationMin,
} from './scenarios';
import { getExpectation } from './expectation';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`[Scenario/Expectation Check Failed] ${message}`);
  }
}

export function runScenarioAndExpectationChecks(): void {
  // 1. Scenarios across 1, 2, and 3 entrances
  const threeEntrances = [{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }];
  const light = SCENARIOS.find((s) => s.id === 'light')!;
  const normal = SCENARIOS.find((s) => s.id === 'normal')!;
  const rush = SCENARIOS.find((s) => s.id === 'rush')!;

  assert(light.note === 'Quiet period', 'light scenario note mismatch');
  assert(normal.note === 'Typical day', 'normal scenario note mismatch');
  assert(rush.note === 'Busy drop-off', 'rush scenario note mismatch');

  const rushRates = rush.rates(threeEntrances);
  assert(
    rushRates.g1 === 6 && rushRates.g2 === 5 && rushRates.g3 === 5,
    `Expected rush rates {g1:6,g2:5,g3:5}, got ${JSON.stringify(rushRates)}`
  );

  // 2. applyScenario preserves splits, duration, and drop-off settings
  const baseSettings: SimulationSettings = {
    ...DEFAULT_SETTINGS,
    simDurationMin: 45,
    dropoffPatienceSec: 45,
    dropoffDwellMinSec: 15,
    dropoffDwellMaxSec: 45,
    destinationSplits: { g1: { d1: 50, direct: 50 } },
  };
  const applied = applyScenario(baseSettings, threeEntrances, 'rush');
  assert(applied.scenarioId === 'rush', 'applyScenario did not set scenarioId to rush');
  assert(applied.stickerShare === 0.6, 'applyScenario did not set rush stickerShare to 0.6');
  assert(applied.simDurationMin === 45, 'applyScenario altered simDurationMin');
  assert(applied.dropoffPatienceSec === 45, 'applyScenario altered dropoffPatienceSec');
  assert(
    applied.destinationSplits?.g1?.d1 === 50 && applied.destinationSplits?.g1?.direct === 50,
    'applyScenario altered destinationSplits'
  );

  // 3. detectScenario matches preset or falls back to 'custom'
  assert(
    detectScenario(applied, threeEntrances) === 'rush',
    'detectScenario should detect rush'
  );
  assert(
    detectScenario({ ...applied, spawnRates: { ...applied.spawnRates, g2: 4 } }, threeEntrances) === 'custom',
    'detectScenario should return custom when a rate changes'
  );
  assert(
    detectScenario({ ...applied, stickerShare: 0.7 }, threeEntrances) === 'custom',
    'detectScenario should return custom when stickerShare changes'
  );
  assert(
    detectScenario(applyScenario(baseSettings, [{ id: 'only' }], 'light'), [{ id: 'only' }]) === 'light',
    'detectScenario should detect light for single-entrance map'
  );

  // 4. Duration clamping
  assert(DURATION_OPTIONS_MIN.join(',') === '15,30,45,60', 'DURATION_OPTIONS_MIN mismatch');
  assert(clampDurationMin(undefined) === 30, 'undefined duration should default to 30');
  assert(clampDurationMin(0) === 30, '0 duration should default to 30');
  assert(clampDurationMin(20) === 15, '20 should snap to 15');
  assert(clampDurationMin(25) === 30, '25 should snap to 30');
  assert(clampDurationMin(50) === 45, '50 should snap to 45');
  assert(clampDurationMin(90) === 60, '90 should snap to 60');

  // 5. getExpectation on SAMPLE_MAP
  const entrances = SAMPLE_MAP.zoneMarkers.filter((m) => m.type === 'entrance');
  const dropoffs = SAMPLE_MAP.zoneMarkers.filter((m) => m.type === 'dropoff');
  const d1 = dropoffs[0].id;
  const d2 = dropoffs[1].id;
  const e1 = entrances[0].id;
  const e2 = entrances[1].id;

  const customMap: MapConfig = { ...SAMPLE_MAP };

  // Light scenario with 40/40/20 and 30/50/20 splits => comfortable
  const lightSettings: SimulationSettings = {
    ...applyScenario(DEFAULT_SETTINGS, entrances, 'light'),
    simDurationMin: 30,
    destinationSplits: {
      [e1]: { [d1]: 40, [d2]: 40, direct: 20 },
      [e2]: { [d1]: 30, [d2]: 50, direct: 20 },
    },
  };
  const lightExp = getExpectation(lightSettings, customMap);
  assert(lightExp.totalCarsPerMin === 4, `Expected 4 cars/min, got ${lightExp.totalCarsPerMin}`);
  assert(lightExp.expectedCars === 120, `Expected 120 cars, got ${lightExp.expectedCars}`);
  assert(lightExp.arrivalsPerHour === 240, `Expected 240/hr, got ${lightExp.arrivalsPerHour}`);
  assert(lightExp.stickerCars === 84 && lightExp.visitorCars === 36, 'Sticker/visitor split mismatch');
  assert(lightExp.headline === 'Traffic should flow comfortably', `Unexpected light headline: ${lightExp.headline}`);

  // Normal scenario with 40/40/20 and 30/50/20 splits => busy
  const normalSettings: SimulationSettings = {
    ...applyScenario(DEFAULT_SETTINGS, entrances, 'normal'),
    simDurationMin: 30,
    destinationSplits: lightSettings.destinationSplits,
  };
  const normalExp = getExpectation(normalSettings, customMap);
  assert(normalExp.perDropoff[0].loadPct === 70 && normalExp.perDropoff[0].level === 'busy', 'D1 should be 70% busy');
  assert(normalExp.perDropoff[1].loadPct === 90 && normalExp.perDropoff[1].level === 'busy', 'D2 should be 90% busy');
  assert(
    normalExp.headline === 'Drop-offs will be busy but should cope',
    `Unexpected normal headline: ${normalExp.headline}`
  );

  // Rush scenario with more traffic to Drop-off #1 => overloaded naming Drop-off #1
  const rushSettings: SimulationSettings = {
    ...applyScenario(DEFAULT_SETTINGS, entrances, 'rush'),
    simDurationMin: 30,
    destinationSplits: {
      [e1]: { [d1]: 80, [d2]: 10, direct: 10 },
      [e2]: { [d1]: 60, [d2]: 20, direct: 20 },
    },
  };
  const rushExp = getExpectation(rushSettings, customMap);
  assert(rushExp.perDropoff[0].level === 'overloaded', 'D1 should be overloaded');
  assert(
    rushExp.headline === `${dropoffs[0].name} is likely to back up`,
    `Unexpected rush headline: ${rushExp.headline}`
  );

  console.log('[Scenario/Expectation Checks] All assertions passed.');
}

runScenarioAndExpectationChecks();
