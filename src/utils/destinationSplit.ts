/**
 * FlowSmart - Destination Split Utilities
 * Handles per-entrance destination distribution (drop-off zones vs direct to exit).
 * Replaces deprecated settings.dropoffShare.
 */

import { SimulationSettings, MapConfig } from '../types/traffic';

export const DIRECT_KEY = 'direct';

/**
 * Returns the destination split percentages for an entrance.
 * If configured in settings.destinationSplits, returns those values (treating missing drop-offs as 0
 * and ignoring obsolete keys).
 * If not configured, returns direct 0 and an equal share for every current drop-off.
 * If the map has no drop-offs, returns { direct: 100 }.
 */
export function getEntranceSplit(
  settings: SimulationSettings,
  map: MapConfig,
  entranceId: string
): Record<string, number> {
  const dropoffs = (map.zoneMarkers || []).filter((m) => m.type === 'dropoff');

  if (dropoffs.length === 0) {
    return { [DIRECT_KEY]: 100 };
  }

  const userSplit = settings.destinationSplits?.[entranceId];
  if (userSplit) {
    const result: Record<string, number> = {
      [DIRECT_KEY]: typeof userSplit[DIRECT_KEY] === 'number' && !Number.isNaN(userSplit[DIRECT_KEY])
        ? Math.min(100, Math.max(0, userSplit[DIRECT_KEY]))
        : 0,
    };
    for (const d of dropoffs) {
      const val = userSplit[d.id];
      result[d.id] = typeof val === 'number' && !Number.isNaN(val)
        ? Math.min(100, Math.max(0, val))
        : 0;
    }
    return result;
  }

  // Default: direct 0 and every current drop-off equal (100 / number of drop-offs)
  const defaultShare = 100 / dropoffs.length;
  const result: Record<string, number> = {
    [DIRECT_KEY]: 0,
  };
  for (const d of dropoffs) {
    result[d.id] = defaultShare;
  }
  return result;
}

/**
 * Clamps every value to 0..100, replaces NaN or non-numbers with 0,
 * and deletes entries for entrances or drop-offs that no longer exist.
 * Returns a new object.
 */
export function sanitizeDestinationSplits(
  splits: Record<string, Record<string, number>> | undefined,
  map: MapConfig
): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  if (!splits) return result;

  const validEntranceIds = new Set(
    (map.zoneMarkers || []).filter((m) => m.type === 'entrance').map((m) => m.id)
  );
  const validDropoffIds = new Set(
    (map.zoneMarkers || []).filter((m) => m.type === 'dropoff').map((m) => m.id)
  );

  for (const [entranceId, entranceSplits] of Object.entries(splits)) {
    if (!validEntranceIds.has(entranceId)) continue;
    if (!entranceSplits || typeof entranceSplits !== 'object') continue;

    const cleanEntrance: Record<string, number> = {};
    for (const [key, val] of Object.entries(entranceSplits)) {
      if (key !== DIRECT_KEY && !validDropoffIds.has(key)) continue;
      const num = typeof val === 'number' && Number.isFinite(val) ? val : 0;
      cleanEntrance[key] = Math.min(100, Math.max(0, num));
    }
    result[entranceId] = cleanEntrance;
  }

  return result;
}

/**
 * Migrates deprecated settings.dropoffShare into settings.destinationSplits.
 * If destinationSplits is undefined and dropoffShare is in [0, 1], builds splits for every entrance:
 * direct = round((1 - dropoffShare) * 100), drop-offs equal share of the rest (rounded to one decimal,
 * with the last drop-off taking the remainder so total is exactly 100).
 * Then deletes settings.dropoffShare. If destinationSplits already exists, just deletes dropoffShare.
 */
export function migrateDropoffShare(settings: SimulationSettings, map: MapConfig): void {
  if (settings.destinationSplits === undefined) {
    const share = settings.dropoffShare;
    if (typeof share === 'number' && Number.isFinite(share) && share >= 0 && share <= 1) {
      const direct = Math.round((1 - share) * 100);
      const dropoffPool = 100 - direct;

      const entrances = (map.zoneMarkers || []).filter((m) => m.type === 'entrance');
      const dropoffs = (map.zoneMarkers || []).filter((m) => m.type === 'dropoff');

      const splits: Record<string, Record<string, number>> = {};

      for (const ent of entrances) {
        if (dropoffs.length === 0) {
          splits[ent.id] = { [DIRECT_KEY]: 100 };
        } else {
          const entranceSplit: Record<string, number> = {
            [DIRECT_KEY]: direct,
          };
          const baseShare = Math.round((dropoffPool / dropoffs.length) * 10) / 10;
          let accumulated = 0;

          for (let i = 0; i < dropoffs.length; i++) {
            if (i === dropoffs.length - 1) {
              entranceSplit[dropoffs[i].id] = Math.round((dropoffPool - accumulated) * 10) / 10;
            } else {
              entranceSplit[dropoffs[i].id] = baseShare;
              accumulated += baseShare;
            }
          }
          splits[ent.id] = entranceSplit;
        }
      }

      settings.destinationSplits = splits;
    }
  }

  delete settings.dropoffShare;
}

/**
 * Formats the split used by an entrance into a compact line:
 * e.g. "Gate 1: D1 20 · D2 40 · D3 40 · Direct 0"
 */
export function formatEntranceSplitLine(
  entranceName: string,
  entranceSplit: Record<string, number>,
  dropoffs: { id: string; name: string }[]
): string {
  const cleanEntrance = entranceName.replace(/\s*\(.*\)/, '').trim();
  const parts: string[] = [];

  for (const d of dropoffs) {
    const cleanDName = d.name.replace(/\s*\(.*\)/, '').trim();
    const match = cleanDName.match(/^drop-?off\s*(.*)$/i);
    const abbr = match ? `D${match[1] || ''}`.trim() : cleanDName;
    const val = Math.round(entranceSplit[d.id] ?? 0);
    parts.push(`${abbr} ${val}`);
  }

  const directVal = Math.round(entranceSplit[DIRECT_KEY] ?? 0);
  parts.push(`Direct ${directVal}`);

  return `${cleanEntrance}: ${parts.join(' · ')}`;
}

/**
 * Formats all entrance splits for a run into lines.
 */
export function formatAllEntranceSplits(
  splits: Record<string, Record<string, number>> | undefined,
  map: MapConfig
): string[] {
  if (!splits || Object.keys(splits).length === 0) return [];

  const entrances = (map.zoneMarkers || []).filter((m) => m.type === 'entrance');
  const dropoffs = (map.zoneMarkers || []).filter((m) => m.type === 'dropoff');

  const lines: string[] = [];
  for (const ent of entrances) {
    const entranceSplit = splits[ent.id];
    if (entranceSplit) {
      lines.push(formatEntranceSplitLine(ent.name, entranceSplit, dropoffs));
    }
  }

  // If map had no matching entrance markers but splits has keys, format each key
  if (lines.length === 0) {
    for (const [entId, entranceSplit] of Object.entries(splits)) {
      const parts: string[] = [];
      for (const [k, v] of Object.entries(entranceSplit)) {
        if (k === DIRECT_KEY) continue;
        parts.push(`${k} ${Math.round(v)}`);
      }
      parts.push(`Direct ${Math.round(entranceSplit[DIRECT_KEY] ?? 0)}`);
      lines.push(`${entId}: ${parts.join(' · ')}`);
    }
  }

  return lines;
}
