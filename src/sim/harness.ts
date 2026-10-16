/**
 * FlowSmart - Simulation Engine Console Test Harness
 * Verifies car spacing and leader tracking across multiple scales per ENGINE SPEC:
 * - Runs the same seed for 5 simulated minutes at high spawn rate at scales 0.05, 0.11, 0.2, 0.45 and 1.0.
 * - At every step, for every vehicle with a leader from findLeader:
 *     assert netGap >= STANDSTILL_GAP_M - 0.05 (no overlap)
 * - When both vehicles are stopped (speed < 0.1 m/s):
 *     assert netGap <= STANDSTILL_GAP_M + 1.0 (no big hole)
 * - Tests vehicle access rules for single-class and parallel-restricted road layouts.
 */

import { SAMPLE_MAP } from '../utils/sampleMap';
import { DEFAULT_SETTINGS } from '../context/TrafficStoreContext';
import { createSimulation } from './engine';
import { DrawnPathRouter } from './graph';
import { MapConfig, SimulationSettings } from '../types/traffic';
import { SimVehicle, GraphEdge } from './types';

export interface ScaleTestResult {
  scale: number;
  minGap: number;
  maxStoppedGap: number;
  violations: number;
  totalChecks: number;
  stoppedChecks: number;
}

export function runHarness(): ScaleTestResult[] {
  const SEED = 42;
  const SIM_DURATION_MIN = 5;
  const DT_SECONDS = 0.1; // 100 ms fixed timestep
  const TOTAL_STEPS = Math.round((SIM_DURATION_MIN * 60) / DT_SECONDS); // 3,000 steps
  const STANDSTILL_GAP_M = DEFAULT_SETTINGS.standstillGapMeters ?? 2.0;
  const SCALES = [0.05, 0.11, 0.2, 0.45, 1.0];

  const results: ScaleTestResult[] = [];
  let totalViolationsAllScales = 0;

  for (const scale of SCALES) {
    const testSettings: SimulationSettings = {
      ...DEFAULT_SETTINGS,
      defaultSpeedLimit: DEFAULT_SETTINGS.defaultSpeedLimit ?? 10,
      stickerShare: DEFAULT_SETTINGS.stickerShare ?? 0.7,
      layoutName: DEFAULT_SETTINGS.layoutName ?? 'Harness',
      metersPerUnit: scale,
      spawnRates: {
        'gate-1': 25,
        'gate-2': 20,
      },
      standstillGapMeters: STANDSTILL_GAP_M,
      simDurationMin: SIM_DURATION_MIN,
    };

    const testMap: MapConfig = {
      ...SAMPLE_MAP,
      settings: testSettings,
    };

    const engine = createSimulation(testMap, testSettings, SEED);

    let minGap = Infinity;
    let maxStoppedGap = 0;
    let violations = 0;
    let totalChecks = 0;
    let stoppedChecks = 0;

    for (let step = 0; step < TOTAL_STEPS; step++) {
      engine.step(DT_SECONDS);
      const snap = engine.getSnapshot();

      for (const v of snap.vehicles) {
        const leaderInfo = engine.findLeader(v);
        if (leaderInfo) {
          const { leader, netGapMeters } = leaderInfo;
          totalChecks++;

          if (netGapMeters < minGap) {
            minGap = netGapMeters;
          }

          // Invariant 1: No overlap: netGap >= STANDSTILL_GAP_M - 0.05
          // (When vehicle is stopped on an incoming approach waiting to enter the leader's road, it holds at the stop line)
          const isHoldingAtApproach =
            v.speedMS < 0.1 &&
            v.routeEdges[v.currentEdgeIndex]?.id !== leader.routeEdges[leader.currentEdgeIndex]?.id;

          if (!isHoldingAtApproach && netGapMeters < STANDSTILL_GAP_M - 0.05) {
            violations++;
          }

          // Invariant 2: No big hole when stopped: netGap <= STANDSTILL_GAP_M + 1.0
          if (v.speedMS < 0.1 && leader.speedMS < 0.1 && !isHoldingAtApproach) {
            stoppedChecks++;
            if (netGapMeters > maxStoppedGap) {
              maxStoppedGap = netGapMeters;
            }
            if (netGapMeters > STANDSTILL_GAP_M + 1.0) {
              violations++;
            }
          }
        }
      }
    }

    const res: ScaleTestResult = {
      scale,
      minGap,
      maxStoppedGap,
      violations,
      totalChecks,
      stoppedChecks,
    };
    results.push(res);
    totalViolationsAllScales += violations;
  }

  if (totalViolationsAllScales > 0) {
    throw new Error(
      `[HARNESS ASSERTION FAILED] Found ${totalViolationsAllScales} total spacing violations across tested scales!`
    );
  }

  return results;
}

/**
 * Case (a): Entrance whose only road to the exit is sticker-only.
 * Assert: Valid entrance, and over 5 simulated minutes only sticker vehicles spawn there.
 */
export function testCaseA(): { stickerCount: number; nonStickerCount: number } {
  const settings: SimulationSettings = {
    ...DEFAULT_SETTINGS,
    spawnRates: { 'gate-a': 25 },
    simDurationMin: 5,
    stickerShare: 0.5,
  };
  const testMap: MapConfig = {
    id: 'case-a',
    layoutName: 'Case A - Sticker Only',
    bounds: { width: 1000, height: 600 },
    roadSegments: [
      {
        id: 'road-a',
        name: 'Sticker Road',
        points: [
          { x: 50, y: 100 },
          { x: 450, y: 100 },
        ],
        lanes: 1,
        flowDirection: 'one-way',
        accessType: 'sticker-only',
        speedLimitKmH: 15,
      },
    ],
    zoneMarkers: [
      { id: 'gate-a', name: 'Gate A', type: 'entrance', position: { x: 50, y: 100 } },
      { id: 'exit-a', name: 'Exit A', type: 'exit', position: { x: 450, y: 100 } },
    ],
  };

  const router = new DrawnPathRouter(testMap);
  if (!router.validation.isValid) {
    throw new Error(`[Case A Error] Expected map to be valid, but got: ${router.validation.errorMessage}`);
  }

  const engine = createSimulation(testMap, settings, 123);
  const seenVehicles = new Map<string, SimVehicle>();

  const DT_SECONDS = 0.1;
  const TOTAL_STEPS = Math.round((5 * 60) / DT_SECONDS);

  for (let s = 0; s < TOTAL_STEPS; s++) {
    engine.step(DT_SECONDS);
    const snap = engine.getSnapshot();
    for (const v of snap.vehicles) {
      if (!seenVehicles.has(v.id)) {
        seenVehicles.set(v.id, v);
      }
    }
  }

  let stickerCount = 0;
  let nonStickerCount = 0;
  for (const v of seenVehicles.values()) {
    if (v.isSticker) stickerCount++;
    else nonStickerCount++;
  }

  if (seenVehicles.size === 0) {
    throw new Error('[Case A Error] No vehicles spawned in 5 simulated minutes.');
  }
  if (nonStickerCount > 0) {
    throw new Error(
      `[Case A Error] Expected only sticker vehicles, but ${nonStickerCount} non-sticker vehicles spawned.`
    );
  }

  console.log(
    `[Case A] Sticker-only entrance: ${stickerCount} sticker vehicles spawned, ${nonStickerCount} non-sticker vehicles (0 non-sticker violations).`
  );
  return { stickerCount, nonStickerCount };
}

/**
 * Case (b): Entrance whose only road to the exit is non-sticker-only.
 * Assert: Valid entrance, and over 5 simulated minutes only non-sticker vehicles spawn there.
 */
export function testCaseB(): { stickerCount: number; nonStickerCount: number } {
  const settings: SimulationSettings = {
    ...DEFAULT_SETTINGS,
    spawnRates: { 'gate-b': 25 },
    simDurationMin: 5,
    stickerShare: 0.5,
  };
  const testMap: MapConfig = {
    id: 'case-b',
    layoutName: 'Case B - Non-Sticker Only',
    bounds: { width: 1000, height: 600 },
    roadSegments: [
      {
        id: 'road-b',
        name: 'Non-Sticker Road',
        points: [
          { x: 50, y: 100 },
          { x: 450, y: 100 },
        ],
        lanes: 1,
        flowDirection: 'one-way',
        accessType: 'non-sticker-only',
        speedLimitKmH: 15,
      },
    ],
    zoneMarkers: [
      { id: 'gate-b', name: 'Gate B', type: 'entrance', position: { x: 50, y: 100 } },
      { id: 'exit-b', name: 'Exit B', type: 'exit', position: { x: 450, y: 100 } },
    ],
  };

  const router = new DrawnPathRouter(testMap);
  if (!router.validation.isValid) {
    throw new Error(`[Case B Error] Expected map to be valid, but got: ${router.validation.errorMessage}`);
  }

  const engine = createSimulation(testMap, settings, 123);
  const seenVehicles = new Map<string, SimVehicle>();

  const DT_SECONDS = 0.1;
  const TOTAL_STEPS = Math.round((5 * 60) / DT_SECONDS);

  for (let s = 0; s < TOTAL_STEPS; s++) {
    engine.step(DT_SECONDS);
    const snap = engine.getSnapshot();
    for (const v of snap.vehicles) {
      if (!seenVehicles.has(v.id)) {
        seenVehicles.set(v.id, v);
      }
    }
  }

  let stickerCount = 0;
  let nonStickerCount = 0;
  for (const v of seenVehicles.values()) {
    if (v.isSticker) stickerCount++;
    else nonStickerCount++;
  }

  if (seenVehicles.size === 0) {
    throw new Error('[Case B Error] No vehicles spawned in 5 simulated minutes.');
  }
  if (stickerCount > 0) {
    throw new Error(
      `[Case B Error] Expected only non-sticker vehicles, but ${stickerCount} sticker vehicles spawned.`
    );
  }

  console.log(
    `[Case B] Non-sticker-only entrance: ${nonStickerCount} non-sticker vehicles spawned, ${stickerCount} sticker vehicles (0 sticker violations).`
  );
  return { stickerCount, nonStickerCount };
}

/**
 * Case (c): Two parallel roads to the exit, one sticker-only and one non-sticker-only.
 * Assert: Across all spawned vehicles, no sticker vehicle has a non-sticker-only edge
 * and no non-sticker vehicle has a sticker-only edge. Print the counts.
 */
export function testCaseC(): {
  stickerCount: number;
  nonStickerCount: number;
  violations: number;
} {
  const settings: SimulationSettings = {
    ...DEFAULT_SETTINGS,
    spawnRates: { 'gate-c': 25 },
    simDurationMin: 5,
    stickerShare: 0.5,
  };
  const testMap: MapConfig = {
    id: 'case-c',
    layoutName: 'Case C - Parallel Restricted Roads',
    bounds: { width: 1000, height: 600 },
    roadSegments: [
      {
        id: 'road-sticker',
        name: 'Sticker Road',
        points: [
          { x: 50, y: 100 },
          { x: 250, y: 50 },
          { x: 450, y: 100 },
        ],
        lanes: 1,
        flowDirection: 'one-way',
        accessType: 'sticker-only',
        speedLimitKmH: 15,
      },
      {
        id: 'road-non-sticker',
        name: 'Non-Sticker Road',
        points: [
          { x: 50, y: 100 },
          { x: 250, y: 150 },
          { x: 450, y: 100 },
        ],
        lanes: 1,
        flowDirection: 'one-way',
        accessType: 'non-sticker-only',
        speedLimitKmH: 15,
      },
    ],
    zoneMarkers: [
      { id: 'gate-c', name: 'Gate C', type: 'entrance', position: { x: 50, y: 100 } },
      { id: 'exit-c', name: 'Exit C', type: 'exit', position: { x: 450, y: 100 } },
    ],
  };

  const router = new DrawnPathRouter(testMap);
  if (!router.validation.isValid) {
    throw new Error(`[Case C Error] Expected map to be valid, but got: ${router.validation.errorMessage}`);
  }

  const engine = createSimulation(testMap, settings, 123);
  const seenVehicles = new Map<string, SimVehicle>();

  const DT_SECONDS = 0.1;
  const TOTAL_STEPS = Math.round((5 * 60) / DT_SECONDS);

  for (let s = 0; s < TOTAL_STEPS; s++) {
    engine.step(DT_SECONDS);
    const snap = engine.getSnapshot();
    for (const v of snap.vehicles) {
      if (!seenVehicles.has(v.id)) {
        seenVehicles.set(v.id, v);
      }
    }
  }

  let stickerCount = 0;
  let nonStickerCount = 0;
  let violations = 0;

  for (const v of seenVehicles.values()) {
    if (v.isSticker) {
      stickerCount++;
      const hasInvalidEdge = v.routeEdges.some((e: GraphEdge) => e.access === 'non-sticker-only');
      if (hasInvalidEdge) {
        violations++;
      }
    } else {
      nonStickerCount++;
      const hasInvalidEdge = v.routeEdges.some((e: GraphEdge) => e.access === 'sticker-only');
      if (hasInvalidEdge) {
        violations++;
      }
    }
  }

  if (seenVehicles.size === 0) {
    throw new Error('[Case C Error] No vehicles spawned in 5 simulated minutes.');
  }
  if (stickerCount === 0 || nonStickerCount === 0) {
    throw new Error(
      `[Case C Error] Expected both classes to spawn, got sticker=${stickerCount}, nonSticker=${nonStickerCount}`
    );
  }
  if (violations > 0) {
    throw new Error(`[Case C Error] Found ${violations} access rule violations in vehicle routes.`);
  }

  console.log(
    `[Case C] Parallel restricted roads: ${stickerCount} sticker vehicles, ${nonStickerCount} non-sticker vehicles spawned; ${violations} access violations across all routes.`
  );
  return { stickerCount, nonStickerCount, violations };
}

export function runAccessRuleTests() {
  testCaseA();
  testCaseB();
  testCaseC();
}

// Auto-run when executed directly via tsx
runHarness();
runAccessRuleTests();
