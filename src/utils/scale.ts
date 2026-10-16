/**
 * FlowSmart - Scale and calibration utilities
 * Single source of truth for scale conversions and vehicle/lane dimensions.
 */

import { MapConfig, SimulationSettings } from '../types/traffic';

export const DEFAULT_METERS_PER_UNIT = 0.2;
export const VEHICLE_LENGTH_M = 4.5;
export const VEHICLE_WIDTH_M = 1.8;
export const LANE_WIDTH_M = 3.0;

export const SPEED_LIMIT_OPTIONS_KMH = [5, 10, 15];
export const MIN_SPEED_KMH = 5;
export const MAX_SPEED_KMH = 15;
export const DEFAULT_SPEED_KMH = 10;

export function clampSpeedKmH(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SPEED_KMH;
  }
  return Math.min(MAX_SPEED_KMH, Math.max(MIN_SPEED_KMH, value));
}

export function getMetersPerUnit(
  map?: Partial<MapConfig> | null,
  settings?: Partial<SimulationSettings> | null
): number {
  return map?.settings?.metersPerUnit ?? settings?.metersPerUnit ?? DEFAULT_METERS_PER_UNIT;
}

export function formatScale(mpu: number): string {
  return `${mpu.toPrecision(3)} m per unit`;
}

export function describeScale(
  mpu: number,
  bounds?: { width: number; height: number } | null
): {
  worldWidthM: number;
  worldHeightM: number;
  carLengthUnits: number;
  laneWidthUnits: number;
} {
  const width = bounds?.width ?? 1000;
  const height = bounds?.height ?? 600;
  return {
    worldWidthM: width * mpu,
    worldHeightM: height * mpu,
    carLengthUnits: mpu > 0 ? VEHICLE_LENGTH_M / mpu : 0,
    laneWidthUnits: mpu > 0 ? LANE_WIDTH_M / mpu : 0,
  };
}

export function roadWidthUnits(lanes: number, mpu: number): number {
  const safeMpu = mpu > 0 ? mpu : DEFAULT_METERS_PER_UNIT;
  return (Math.max(lanes, 1) * LANE_WIDTH_M) / safeMpu;
}

export function edgeLineWidthUnits(asphaltWidth: number, mpu: number): number {
  const safeMpu = mpu > 0 ? mpu : DEFAULT_METERS_PER_UNIT;
  return asphaltWidth + Math.max(2, 0.3 / safeMpu);
}

export interface ScaleBarData {
  meters: number;
  widthPx: number;
  label: string;
}

export function getScaleBarData(
  metersPerUnit: number,
  screenPixelsPerUnit: number
): ScaleBarData {
  const candidates = [5, 10, 20, 50, 100, 200];
  const mpu = metersPerUnit > 0 ? metersPerUnit : DEFAULT_METERS_PER_UNIT;
  const sppu = screenPixelsPerUnit > 0 ? screenPixelsPerUnit : 1;
  const pxPerMeter = sppu / mpu;

  // Candidate must be between 60 and 140 screen pixels
  const matching = candidates.filter((m) => {
    const px = m * pxPerMeter;
    return px >= 60 && px <= 140;
  });

  let chosenMeters: number;
  if (matching.length > 0) {
    // Pick the largest of candidates between 60 and 140
    chosenMeters = matching[matching.length - 1];
  } else {
    // Fallback if extreme zoom: candidate closest to 100 px
    chosenMeters = candidates.reduce((prev, curr) => {
      const prevDiff = Math.abs(prev * pxPerMeter - 100);
      const currDiff = Math.abs(curr * pxPerMeter - 100);
      return currDiff < prevDiff ? curr : prev;
    });
  }

  const widthPx = Math.round(chosenMeters * pxPerMeter);
  return {
    meters: chosenMeters,
    widthPx,
    label: `${chosenMeters} m`,
  };
}
