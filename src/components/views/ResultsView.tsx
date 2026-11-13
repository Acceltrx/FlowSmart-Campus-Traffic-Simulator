/**
 * FlowSmart - Results View
 * Plain-language summary of a simulation run, drop-off load, bottlenecks,
 * suggestions, run settings, and comparison table with CSV and PDF export.
 */

import React, { useState, useMemo } from 'react';
import {
  Download,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  SlidersHorizontal,
  ChevronDown,
  Lightbulb,
} from 'lucide-react';
import { useTrafficStore } from '../../context/TrafficStoreContext';
import { useSimulation } from '../../context/SimulationContext';
import { generateActionableInsights, ActionableInsight } from '../../sim/insights';
import {
  RunLogEntry,
  SimulationResult,
  BottleneckRank,
  ScenarioId,
  ZoneMarker,
} from '../../types/traffic';
import { DIRECT_KEY, formatAllEntranceSplits, getEntranceSplit } from '../../utils/destinationSplit';
import { SCENARIOS, detectScenario } from '../../utils/scenarios';
import {
  getArrivalsPerHour,
  getCapacityUsedStatus,
  getQueueStatus,
  getRunOutcome,
  getThroughputStatus,
  getTripTimeStatus,
  getWaitStatus,
} from '../../utils/status';

interface DropStats {
  total: number | undefined;
  early: number | undefined;
  avgWait: number | undefined;
}

const ZONE_COLORS = ['#254B98', '#F59E0B', '#25A76B', '#6366F1', '#0EA5E9'];
const DIRECT_COLOR = '#9AA6BF';

function cleanName(name: string): string {
  return name.replace(/\s*\(.*\)/, '').trim();
}

function getDropStats(entry: RunLogEntry | undefined, fallback?: SimulationResult): DropStats {
  const src = entry ?? undefined;
  return {
    total: src ? src.totalDropoffs ?? src.result?.totalDropoffs : fallback?.totalDropoffs,
    early: src ? src.earlyDropoffs ?? src.result?.earlyDropoffs : fallback?.earlyDropoffs,
    avgWait: src ? src.avgDropWaitSec ?? src.result?.avgDropWaitSec : fallback?.avgDropWaitSec,
  };
}

function formatEarlyDropoffs(d: DropStats): string {
  if (d.early === undefined || d.total === undefined) return 'n/a';
  if (d.total === 0) return '0 of 0';
  return `${d.early} of ${d.total}`;
}

function formatEarlyDropoffsWithPct(d: DropStats): string {
  if (d.early === undefined || d.total === undefined) return 'n/a';
  if (d.total === 0) return '0 of 0';
  return `${d.early} of ${d.total} (${Math.round((d.early / d.total) * 100)}%)`;
}

function formatDropWait(d: DropStats): string {
  return d.avgWait === undefined ? 'n/a' : `${d.avgWait.toFixed(1)} s`;
}

function getScenarioLabel(
  entry: RunLogEntry | undefined,
  entrances: readonly Pick<ZoneMarker, 'id'>[],
  fallbackScenarioId?: ScenarioId
): string {
  if (!entry) {
    if (fallbackScenarioId && fallbackScenarioId !== 'custom') {
      return SCENARIOS.find((s) => s.id === fallbackScenarioId)?.name ?? 'Custom';
    }
    return 'Custom';
  }
  const optionalScenarioId = (entry as RunLogEntry & { scenarioId?: ScenarioId }).scenarioId;
  if (optionalScenarioId) {
    if (optionalScenarioId === 'custom') return 'Custom';
    return SCENARIOS.find((s) => s.id === optionalScenarioId)?.name ?? 'Custom';
  }
  if (!entry.spawnRates || Object.keys(entry.spawnRates).length === 0) {
    return '—';
  }
  const detected = detectScenario(
    { spawnRates: entry.spawnRates, stickerShare: entry.stickerShare },
    entrances
  );
  if (detected === 'custom') return 'Custom';
  return SCENARIOS.find((s) => s.id === detected)?.name ?? 'Custom';
}

export const ResultsView: React.FC = () => {
  const { state: storeState, setActiveTab } = useTrafficStore();
  const { lastResult } = useSimulation();

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [showAllColumns, setShowAllColumns] = useState<boolean>(false);

  const runLog = storeState.runLog;
  const entrances = useMemo(
    () => (storeState.map.zoneMarkers || []).filter((m) => m.type === 'entrance'),
    [storeState.map.zoneMarkers]
  );
  const dropoffs = useMemo(
    () => (storeState.map.zoneMarkers || []).filter((m) => m.type === 'dropoff'),
    [storeState.map.zoneMarkers]
  );

  const activeEntry: RunLogEntry | undefined = useMemo(() => {
    if (selectedRunId) {
      const found = runLog.find((r) => r.runId === selectedRunId);
      if (found) return found;
    }
    return runLog[0];
  }, [runLog, selectedRunId]);

  const result: SimulationResult = useMemo(() => {
    if (activeEntry?.result) return activeEntry.result;
    if (lastResult) return lastResult;
    return {
      runId: activeEntry?.runId || 'run-1',
      runNumber: activeEntry?.runNumber || 1,
      timestamp: activeEntry?.timestamp || new Date().toISOString(),
      layoutName: activeEntry?.layoutName || storeState.settings.layoutName || 'Layout A',
      totalThroughputVehHr: activeEntry?.throughput || 0,
      avgWaitTimeSec: activeEntry?.avgWait || 0,
      avgTransitTimeSec: activeEntry?.avgTransit || 0,
      maxQueueLengthVeh: activeEntry?.maxQueue || 0,
      maxQueueLocation: storeState.map.roadSegments[0]?.name ?? 'None',
      flowEfficiencyPct: activeEntry?.flowEfficiency || 0,
      totalProcessedVehicles: 0,
      bottlenecks: [],
    };
  }, [activeEntry, lastResult, storeState.map.roadSegments, storeState.settings.layoutName]);

  const currentSplits = activeEntry
    ? activeEntry.destinationSplits
    : storeState.settings.destinationSplits;

  const splitLines = useMemo(
    () => formatAllEntranceSplits(currentSplits, storeState.map),
    [currentSplits, storeState.map]
  );

  const insights: ActionableInsight[] = useMemo(() => {
    return generateActionableInsights(result, storeState.map);
  }, [result, storeState.map]);

  const tableRows: RunLogEntry[] = useMemo(() => {
    if (runLog.length > 0) return runLog;
    if (activeEntry) return [activeEntry];
    return [];
  }, [runLog, activeEntry]);

  // Empty state
  if (!activeEntry && !lastResult) {
    return (
      <div className="flex-1 bg-[#F5F6F8] flex items-center justify-center p-6 select-none">
        <div className="max-w-md w-full bg-white rounded-[12px] border border-[#E2E6EF] p-8 flex flex-col items-center text-center gap-3 shadow-xs">
          <div className="w-12 h-12 rounded-full bg-[#E7EEFF] text-[#254B98] flex items-center justify-center">
            <FileText size={22} />
          </div>
          <div>
            <h2 className="text-[18px] font-semibold text-[#111C2D]">No results yet</h2>
            <p className="text-[13px] text-[#6B7A99] mt-1 leading-relaxed">
              Run a simulation to see a plain-language summary of how traffic flowed, where cars
              backed up, and what to try next.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className="mt-2 h-10 px-4 bg-[#254B98] hover:bg-[#1c3b78] text-white rounded-lg text-[13px] font-medium flex items-center gap-2 transition-colors cursor-pointer"
          >
            <SlidersHorizontal size={15} />
            <span>Go to settings</span>
          </button>
        </div>
      </div>
    );
  }

  const throughput = activeEntry?.throughput ?? result.totalThroughputVehHr ?? 0;
  const avgWait = activeEntry?.avgWait ?? result.avgWaitTimeSec ?? 0;
  const avgTransit = activeEntry?.avgTransit ?? result.avgTransitTimeSec ?? 0;
  const maxQueue = activeEntry?.maxQueue ?? result.maxQueueLengthVeh ?? 0;
  const maxQueueLoc =
    result.maxQueueLocation || (storeState.map.roadSegments[0]?.name ?? 'campus roads');
  const flowEfficiency = activeEntry?.flowEfficiency ?? result.flowEfficiencyPct ?? 0;
  const runNumber = activeEntry?.runNumber ?? result.runNumber ?? 1;
  const layoutName =
    activeEntry?.layoutName || result.layoutName || storeState.settings.layoutName || 'Layout A';
  const dropStats = getDropStats(activeEntry ?? undefined, result);
  const currentDropoffStats = activeEntry?.dropoffStats ?? result.dropoffStats;
  const currentDirectAssigned = activeEntry?.directAssigned ?? result.directAssigned;
  const hasDropoffStats = Boolean(currentDropoffStats && currentDropoffStats.length > 0);
  const rawBottlenecks: BottleneckRank[] = result.bottlenecks || [];
  const worstRoad = rawBottlenecks[0]?.segmentName || maxQueueLoc;

  const totalSpawned =
    (activeEntry?.spawnedSticker ?? result.spawnedSticker ?? 0) +
      (activeEntry?.spawnedNonSticker ?? result.spawnedNonSticker ?? 0) ||
    (currentDropoffStats
      ? currentDropoffStats.reduce((acc, d) => acc + d.assigned, 0)
      : 0) + (currentDirectAssigned ?? 0);

  const totalFinished = result.totalProcessedVehicles ?? 0;
  const arrivedCount =
    totalSpawned > 0
      ? totalSpawned
      : totalFinished + (result.unfinishedVehiclesCount ?? 0);

  const activeScenarioName = getScenarioLabel(
    activeEntry,
    entrances,
    storeState.settings.scenarioId
  );
  const isLatestSelected = !activeEntry || runLog[0]?.runId === activeEntry.runId;
  const activeRates = activeEntry?.spawnRates ?? storeState.settings.spawnRates ?? {};
  const ratesListText =
    entrances.length > 0
      ? entrances.map((e) => activeRates[e.id] ?? 0).join(' + ')
      : Object.values(activeRates).join(' + ');
  const stickerPct = Math.round(
    (activeEntry?.stickerShare ?? storeState.settings.stickerShare ?? 0.7) * 100
  );
  const runDurationMin =
    (activeEntry as (RunLogEntry & { simDurationMin?: number }) | undefined)?.simDurationMin ??
    (result as SimulationResult & { simDurationMin?: number }).simDurationMin ??
    storeState.settings.simDurationMin ??
    30;

  // Shared status bands from src/utils/status.ts
  const arrivalsPerHr = getArrivalsPerHour(
    activeEntry?.spawnRates ?? storeState.settings.spawnRates,
    totalSpawned,
    runDurationMin
  );
  const throughputBadge = getThroughputStatus(throughput, arrivalsPerHr);
  const waitBadge = getWaitStatus(avgWait);
  const transitBadge = getTripTimeStatus(avgTransit);
  const queueBadge = getQueueStatus(maxQueue);
  const efficiencyBadge = getCapacityUsedStatus(flowEfficiency);

  const outcome = getRunOutcome({
    isGridlocked: result.isGridlocked,
    maxQueue,
    avgWait,
    avgTransit,
    flowEfficiency,
    throughput,
    arrivalsPerHr,
  });

  const bannerConfig = result.isGridlocked
    ? {
        box: 'bg-[#EF4444]/10 border-[#EF4444]/35',
        iconBg: 'bg-[#EF4444] text-white',
        title: 'Traffic got stuck',
        sentence: `Cars stopped moving around ${worstRoad} and traffic backed up across campus.`,
      }
    : outcome.level === 'bad'
      ? {
          box: 'bg-[#EF4444]/10 border-[#EF4444]/35',
          iconBg: 'bg-[#EF4444] text-white',
          title: 'Traffic struggled',
          sentence: `${worstRoad} had the worst backup, with a line reaching ${maxQueue} ${
            maxQueue === 1 ? 'car' : 'cars'
          }.`,
        }
      : outcome.level === 'warning'
        ? {
            box: 'bg-[#F59E0B]/10 border-[#F59E0B]/35',
            iconBg: 'bg-[#F59E0B] text-white',
            title: `Mostly fine, but ${worstRoad} backs up`,
            sentence: `Most cars got through, though the line at ${worstRoad} reached ${maxQueue} ${
              maxQueue === 1 ? 'car' : 'cars'
            }.`,
          }
        : {
            box: 'bg-[#25A76B]/10 border-[#25A76B]/35',
            iconBg: 'bg-[#25A76B] text-white',
            title: 'Traffic flowed smoothly',
            sentence: `Cars moved cleanly along ${worstRoad} and across campus without any serious build-up.`,
          };

  // Stacked bar data for "Where cars went" (actual vs planned)
  const zoneShares = (() => {
    const items: {
      key: string;
      name: string;
      color: string;
      actualPct: number;
      plannedPct: number;
    }[] = [];

    // Compute planned shares weighted by gate rates (or equal average if all 0)
    const rateTotal = entrances.reduce((sum, e) => sum + Math.max(0, activeRates[e.id] ?? 0), 0);
    const settingsForSplit = {
      ...storeState.settings,
      destinationSplits: currentSplits,
    };

    const getPlannedPct = (destKey: string): number => {
      if (entrances.length === 0) return 0;
      if (rateTotal > 0) {
        let weighted = 0;
        for (const ent of entrances) {
          const split = getEntranceSplit(settingsForSplit, storeState.map, ent.id);
          const r = Math.max(0, activeRates[ent.id] ?? 0);
          weighted += (split[destKey] ?? 0) * (r / rateTotal);
        }
        return Math.round(weighted);
      }
      let sum = 0;
      for (const ent of entrances) {
        const split = getEntranceSplit(settingsForSplit, storeState.map, ent.id);
        sum += split[destKey] ?? 0;
      }
      return Math.round(sum / entrances.length);
    };

    if (currentDropoffStats && currentDropoffStats.length > 0) {
      currentDropoffStats.forEach((ds, idx) => {
        const actualPct = totalSpawned > 0 ? Math.round((ds.assigned / totalSpawned) * 100) : 0;
        items.push({
          key: ds.dropoffId,
          name: cleanName(ds.name),
          color: ZONE_COLORS[idx % ZONE_COLORS.length],
          actualPct,
          plannedPct: getPlannedPct(ds.dropoffId),
        });
      });
    } else {
      dropoffs.forEach((d, idx) => {
        items.push({
          key: d.id,
          name: cleanName(d.name),
          color: ZONE_COLORS[idx % ZONE_COLORS.length],
          actualPct: 0,
          plannedPct: getPlannedPct(d.id),
        });
      });
    }

    const actualDirectPct =
      totalSpawned > 0 ? Math.round(((currentDirectAssigned ?? 0) / totalSpawned) * 100) : 0;
    items.push({
      key: DIRECT_KEY,
      name: 'Direct to exit',
      color: DIRECT_COLOR,
      actualPct: actualDirectPct,
      plannedPct: getPlannedPct(DIRECT_KEY),
    });

    return items;
  })();

  // Export run log as CSV (preserved column contract and values)
  const handleExportCsv = () => {
    const allDropoffNames = Array.from(
      new Set([
        ...storeState.map.zoneMarkers.filter((m) => m.type === 'dropoff').map((m) => m.name),
        ...tableRows.flatMap((r) => {
          const stats = r.dropoffStats ?? r.result?.dropoffStats ?? [];
          return stats.map((s) => s.name);
        }),
      ])
    );

    const headers = [
      'Layout name',
      'Run number',
      'Seed',
      'Spawn rate per entrance',
      'Sticker share',
      'Throughput (veh/hr)',
      'Avg wait (s)',
      'Avg transit (s)',
      'Max queue (veh)',
      'Flow efficiency (%)',
      'Per-segment max queue',
      'total_dropoffs',
      'early_dropoffs',
      'early_dropoff_pct',
      'avg_drop_wait_sec',
      'direct_assigned',
      'split_used_per_entrance',
      ...allDropoffNames.flatMap((zone) => [
        `"${zone} assigned"`,
        `"${zone} share_pct"`,
        `"${zone} dropped_at_zone"`,
        `"${zone} dropped_early"`,
      ]),
    ];

    const rows = tableRows.map((r) => {
      const spawnSummary = Object.entries(r.spawnRates || {})
        .map(([k, v]) => `${k}: ${v} veh/min`)
        .join('; ');

      const segmentQueueStr =
        (r.result?.bottlenecks || [])
          .map((b) => `${b.segmentName}: ${b.maxQueueLength}`)
          .join('; ') ||
        (r.result?.segmentMaxQueue || [])
          .map((s) => `${s.segmentId}: ${s.maxQueueLength}`)
          .join('; ') ||
        'None';

      const d = getDropStats(r);
      const earlyPct =
        d.early !== undefined && d.total !== undefined && d.total > 0
          ? Math.round((d.early / d.total) * 100)
          : '';

      const stats = r.dropoffStats ?? r.result?.dropoffStats;
      const direct = r.directAssigned ?? r.result?.directAssigned;
      const splits = r.destinationSplits;
      const rowSplitLines = formatAllEntranceSplits(splits, storeState.map);
      const splitUsedStr = rowSplitLines.length > 0 ? rowSplitLines.join('; ') : '';

      const rowSpawned =
        (r.spawnedSticker ?? r.result?.spawnedSticker ?? 0) +
          (r.spawnedNonSticker ?? r.result?.spawnedNonSticker ?? 0) ||
        (stats ? stats.reduce((acc, s) => acc + s.assigned, 0) + (direct ?? 0) : 0);

      const dropoffCells = allDropoffNames.flatMap((zone) => {
        if (!stats) {
          return ['', '', '', ''];
        }
        const st = stats.find((s) => s.name === zone);
        if (!st) {
          return ['', '', '', ''];
        }
        const sharePct =
          rowSpawned > 0 ? `${Math.round((st.assigned / rowSpawned) * 100)}%` : '0%';
        return [st.assigned, sharePct, st.droppedAtZone, st.droppedEarly];
      });

      return [
        `"${r.layoutName || 'Layout A'}"`,
        r.runNumber ?? '',
        r.seed !== undefined ? r.seed : r.result?.seed !== undefined ? r.result.seed : 'N/A',
        `"${spawnSummary}"`,
        `${Math.round((r.stickerShare ?? 0.7) * 100)}%`,
        r.throughput ?? 0,
        r.avgWait ?? 0,
        r.avgTransit ?? 0,
        r.maxQueue ?? 0,
        `${r.flowEfficiency ?? 0}%`,
        `"${segmentQueueStr}"`,
        d.total ?? '',
        d.early ?? '',
        earlyPct,
        d.avgWait !== undefined ? d.avgWait.toFixed(1) : '',
        direct !== undefined ? direct : '',
        splitUsedStr ? `"${splitUsedStr}"` : '',
        ...dropoffCells,
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `flowsmart_run_log_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export report to PDF via dynamic jsPDF + html2canvas
  const handleExportPdf = async () => {
    const reportElem = document.getElementById('results-printable-report');
    if (!reportElem) return;

    try {
      setIsExportingPdf(true);
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);

      const canvas = await html2canvas(reportElem, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#F5F6F8',
        onclone: (clonedDoc, clonedElem) => {
          const probe = clonedDoc.createElement('canvas');
          probe.width = 1;
          probe.height = 1;
          const pCtx = probe.getContext('2d', { willReadFrequently: true });
          if (!pCtx) return;

          const toRgba = (cssColor: string): string => {
            pCtx.clearRect(0, 0, 1, 1);
            pCtx.fillStyle = 'rgba(0, 0, 0, 0)';
            pCtx.fillStyle = cssColor;
            pCtx.fillRect(0, 0, 1, 1);
            const [r, g, b, a] = pCtx.getImageData(0, 0, 1, 1).data;
            return `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(3))})`;
          };

          const colorFnRegex = /(oklab|oklch|color-mix|color)\([^)]*(?:\([^)]*\)[^)]*)*\)/g;
          const normalizeValue = (val: string): string => {
            if (!val || !/(oklab|oklch|color-mix|color\()/.test(val)) return val;
            if (val.trim().match(/^(oklab|oklch|color-mix|color)\(/)) {
              return toRgba(val);
            }
            return val.replace(colorFnRegex, (fn) => toRgba(fn));
          };

          const colorProps: (keyof CSSStyleDeclaration)[] = [
            'color',
            'backgroundColor',
            'borderTopColor',
            'borderRightColor',
            'borderBottomColor',
            'borderLeftColor',
            'outlineColor',
            'textDecorationColor',
            'boxShadow',
          ];

          const view = clonedDoc.defaultView || window;
          const elements: HTMLElement[] = [
            clonedDoc.documentElement,
            clonedDoc.body,
            clonedElem,
            ...Array.from(clonedElem.querySelectorAll<HTMLElement>('*')),
          ];

          for (const el of elements) {
            const cs = view.getComputedStyle(el);
            for (const prop of colorProps) {
              const raw = cs[prop];
              if (typeof raw === 'string' && /(oklab|oklch|color-mix|color\()/.test(raw)) {
                (el.style as unknown as Record<string, string>)[prop as string] = normalizeValue(raw);
              }
            }
          }
        },
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const canvasAspectRatio = canvas.width / canvas.height;

      let renderWidth = pdfWidth;
      let renderHeight = pdfWidth / canvasAspectRatio;

      if (renderHeight > pdfHeight) {
        renderHeight = pdfHeight;
        renderWidth = pdfHeight * canvasAspectRatio;
      }

      const xPos = (pdfWidth - renderWidth) / 2;
      const yPos = 5;

      pdf.addImage(imgData, 'PNG', xPos, yPos, renderWidth, renderHeight);
      pdf.save(
        `flowsmart_simulation_report_${layoutName.replace(/\s+/g, '_')}_run_${runNumber}.pdf`
      );
    } catch (err) {
      console.error('Failed to generate PDF report:', err);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const seedValue = activeEntry?.seed ?? result.seed ?? 'N/A';

  return (
    <div className="flex-1 bg-[#F5F6F8] overflow-y-auto px-6 py-7 select-none font-sans">
      <div id="results-printable-report" className="max-w-[1160px] mx-auto flex flex-col gap-5">
        {/* 1. Header */}
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-[24px] font-semibold text-[#111C2D] tracking-tight">
              Results
            </h1>
            <p className="text-[14px] text-[#6B7A99] mt-0.5">
              {activeScenarioName} · {layoutName} · Run {runNumber}
              {isLatestSelected ? ' (latest)' : ''} · {runDurationMin} min
              {ratesListText ? ` · ${ratesListText} cars/min` : ''} · {stickerPct}% sticker holders
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              type="button"
              onClick={handleExportCsv}
              className="h-10 px-4 rounded-lg bg-white text-[#111C2D] text-[13px] font-medium border border-[#E2E6EF] hover:bg-[#F5F6F8] active:scale-98 transition-all flex items-center gap-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98]"
            >
              <Download size={16} className="text-[#6B7A99]" />
              <span>Download run log (CSV)</span>
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={isExportingPdf}
              className="h-10 px-4 rounded-lg bg-white text-[#111C2D] text-[13px] font-medium border border-[#E2E6EF] hover:bg-[#F5F6F8] active:scale-98 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98]"
            >
              {isExportingPdf ? (
                <>
                  <Loader2 size={16} className="animate-spin text-[#254B98]" />
                  <span>Preparing PDF...</span>
                </>
              ) : (
                <>
                  <FileText size={16} className="text-[#6B7A99]" />
                  <span>Download report</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className="h-10 px-4 rounded-lg bg-[#254B98] text-white text-[13px] font-medium hover:bg-[#1c3b78] active:scale-98 transition-all flex items-center gap-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] focus-visible:ring-offset-1"
            >
              <SlidersHorizontal size={15} />
              <span>Change settings</span>
            </button>
          </div>
        </header>

        {/* 2. Coloured summary banner */}
        <div
          className={`rounded-[12px] border p-5 flex items-start gap-4 ${bannerConfig.box}`}
        >
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${bannerConfig.iconBg}`}
          >
            {outcome.level === 'good' && !result.isGridlocked ? (
              <CheckCircle2 size={20} />
            ) : (
              <AlertTriangle size={20} />
            )}
          </div>
          <div>
            <h2 className="text-[18px] font-semibold text-[#111C2D] leading-snug">
              {bannerConfig.title}
            </h2>
            <p className="text-[14px] text-[#111C2D]/80 mt-0.5">{bannerConfig.sentence}</p>
          </div>
        </div>

        {/* 3. Two labelled rows of four cards */}
        <section aria-label="How traffic moved" className="flex flex-col gap-2.5">
          <h2 className="text-[14px] font-semibold text-[#6B7A99]">How traffic moved</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Cars that finished */}
            <div className="bg-white border border-[#E2E6EF] rounded-[12px] p-4 flex flex-col justify-between min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-[#6B7A99]">Cars that finished</span>
              </div>
              <div className="text-[28px] font-bold text-[#111C2D] my-1.5 tabular-nums leading-tight">
                {totalFinished.toLocaleString()}{' '}
                <span className="text-[14px] text-[#6B7A99] font-medium">
                  {totalFinished === 1 ? 'car' : 'cars'}
                </span>
              </div>
              <div className="text-[12px] text-[#6B7A99]">
                Out of {arrivedCount.toLocaleString()} that arrived
              </div>
            </div>

            {/* Cars exiting per hour */}
            <div className="bg-white border border-[#E2E6EF] rounded-[12px] p-4 flex flex-col justify-between min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-[#6B7A99]">Cars exiting per hour</span>
                <span className={`text-[12px] px-2.5 py-0.5 rounded-full font-semibold shrink-0 ${throughputBadge.badgeClass}`}>
                  {throughputBadge.label}
                </span>
              </div>
              <div className="text-[28px] font-bold text-[#111C2D] my-1.5 tabular-nums leading-tight">
                {throughput.toLocaleString()}{' '}
                <span className="text-[14px] text-[#6B7A99] font-medium">/hr</span>
              </div>
              <div className="text-[12px] text-[#6B7A99]">
                {arrivalsPerHr > 0
                  ? `${Math.round(arrivalsPerHr).toLocaleString()} /hr arriving`
                  : 'Rate of cars reaching an exit'}
              </div>
            </div>

            {/* Average trip time */}
            <div className="bg-white border border-[#E2E6EF] rounded-[12px] p-4 flex flex-col justify-between min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-[#6B7A99]">Average trip time</span>
                <span className={`text-[12px] px-2.5 py-0.5 rounded-full font-semibold shrink-0 ${transitBadge.badgeClass}`}>
                  {transitBadge.label}
                </span>
              </div>
              <div className="text-[28px] font-bold text-[#111C2D] my-1.5 tabular-nums leading-tight">
                {avgTransit} <span className="text-[14px] text-[#6B7A99] font-medium">s</span>
              </div>
              <div className="text-[12px] text-[#6B7A99]">Average time from gate to exit</div>
            </div>

            {/* Road capacity used (no gauge or ring) */}
            <div className="bg-white border border-[#E2E6EF] rounded-[12px] p-4 flex flex-col justify-between min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-[#6B7A99]">Road capacity used</span>
                <span className={`text-[12px] px-2.5 py-0.5 rounded-full font-semibold shrink-0 ${efficiencyBadge.badgeClass}`}>
                  {efficiencyBadge.label}
                </span>
              </div>
              <div className="text-[28px] font-bold text-[#111C2D] my-1.5 tabular-nums leading-tight">
                {flowEfficiency} <span className="text-[14px] text-[#6B7A99] font-medium">%</span>
              </div>
              <div className="text-[12px] text-[#6B7A99]">Share of road space in use</div>
            </div>
          </div>
        </section>

        <section aria-label="Waiting and drop-offs" className="flex flex-col gap-2.5">
          <h2 className="text-[14px] font-semibold text-[#6B7A99]">Waiting and drop-offs</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Average wait in line */}
            <div className="bg-white border border-[#E2E6EF] rounded-[12px] p-4 flex flex-col justify-between min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-[#6B7A99]">Average wait in line</span>
                <span className={`text-[12px] px-2.5 py-0.5 rounded-full font-semibold shrink-0 ${waitBadge.badgeClass}`}>
                  {waitBadge.label}
                </span>
              </div>
              <div className="text-[28px] font-bold text-[#111C2D] my-1.5 tabular-nums leading-tight">
                {avgWait} <span className="text-[14px] text-[#6B7A99] font-medium">s</span>
              </div>
              <div className="text-[12px] text-[#6B7A99]">Average time stopped in traffic</div>
            </div>

            {/* Longest line of cars */}
            <div className="bg-white border border-[#E2E6EF] rounded-[12px] p-4 flex flex-col justify-between min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-[#6B7A99]">Longest line of cars</span>
                <span className={`text-[12px] px-2.5 py-0.5 rounded-full font-semibold shrink-0 ${queueBadge.badgeClass}`}>
                  {queueBadge.label}
                </span>
              </div>
              <div
                className={`text-[28px] font-bold my-1.5 tabular-nums leading-tight ${
                  queueBadge.level === 'bad' ? 'text-[#EF4444]' : 'text-[#111C2D]'
                }`}
              >
                {maxQueue}{' '}
                <span className="text-[14px] text-[#6B7A99] font-medium">
                  {maxQueue === 1 ? 'car' : 'cars'}
                </span>
              </div>
              <div className="text-[12px] text-[#6B7A99] truncate" title={`At ${maxQueueLoc}`}>
                At {maxQueueLoc}
              </div>
            </div>

            {/* Gave up and dropped off early */}
            <div className="bg-white border border-[#E2E6EF] rounded-[12px] p-4 flex flex-col justify-between min-w-0">
              <span className="text-[13px] text-[#6B7A99]">Gave up and dropped off early</span>
              <div className="text-[28px] font-bold text-[#111C2D] my-1.5 tabular-nums leading-tight">
                {formatEarlyDropoffs(dropStats)}
              </div>
              <div className="text-[12px] text-[#6B7A99]">
                {dropStats.early !== undefined && dropStats.total && dropStats.total > 0
                  ? `${Math.round((dropStats.early / dropStats.total) * 100)}% dropped off away from the zone`
                  : 'Cars that dropped off away from the zone'}
              </div>
            </div>

            {/* Average wait before dropping off */}
            <div className="bg-white border border-[#E2E6EF] rounded-[12px] p-4 flex flex-col justify-between min-w-0">
              <span className="text-[13px] text-[#6B7A99]">Average wait before dropping off</span>
              <div className="text-[28px] font-bold text-[#111C2D] my-1.5 tabular-nums leading-tight">
                {dropStats.avgWait !== undefined ? (
                  <>
                    {dropStats.avgWait.toFixed(1)}{' '}
                    <span className="text-[14px] text-[#6B7A99] font-medium">s</span>
                  </>
                ) : (
                  'n/a'
                )}
              </div>
              <div className="text-[12px] text-[#6B7A99]">
                Time waiting near a drop-off zone
              </div>
            </div>
          </div>
        </section>

        {/* 4. Two cards side by side: Where cars got stuck & What you could try */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Where cars got stuck */}
          <div className="bg-white border border-[#E2E6EF] rounded-[12px] p-5 flex flex-col">
            <div className="flex items-baseline justify-between mb-4">
              <div>
                <h2 className="text-[17px] font-semibold text-[#111C2D]">Where cars got stuck</h2>
                <p className="text-[13px] text-[#6B7A99] mt-0.5">
                  Longest line of cars on each road. Worst first.
                </p>
              </div>
              <span className="text-[12px] text-[#6B7A99]">
                {rawBottlenecks.length} road{rawBottlenecks.length === 1 ? '' : 's'}
              </span>
            </div>

            {rawBottlenecks.length === 0 ? (
              <div className="py-8 text-center text-[#6B7A99] text-[13px]">
                No lines of cars recorded in this run.
              </div>
            ) : (
              <div className="flex flex-col gap-3.5">
                {rawBottlenecks.map((item) => {
                  const rowStatus = getQueueStatus(item.maxQueueLength);

                  return (
                    <div key={item.segmentId} className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2 text-[13px]">
                        <span className="text-[#111C2D] font-medium truncate">
                          {item.segmentName}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[13px] text-[#111C2D] font-semibold tabular-nums">
                            {item.maxQueueLength} {item.maxQueueLength === 1 ? 'car' : 'cars'}
                          </span>
                          <span
                            className={`text-[12px] px-2.5 py-0.5 rounded-full font-semibold ${rowStatus.badgeClass}`}
                          >
                            {rowStatus.label}
                          </span>
                        </div>
                      </div>
                      <div className="w-full bg-[#E2E6EF] rounded-full h-2.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${rowStatus.barClass}`}
                          style={{ width: `${Math.min(100, Math.max(item.percentage, 8))}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* What you could try (no category chips) */}
          <div className="bg-white border border-[#E2E6EF] rounded-[12px] p-5 flex flex-col">
            <div className="mb-4">
              <h2 className="text-[17px] font-semibold text-[#111C2D]">What you could try</h2>
              <p className="text-[13px] text-[#6B7A99] mt-0.5">Based on this run.</p>
            </div>

            <div className="flex flex-col gap-3">
              {insights.map((insight) => (
                <div
                  key={insight.id}
                  className="p-3.5 rounded-[12px] border border-[#E2E6EF] flex items-start gap-3"
                >
                  <div className="w-9 h-9 rounded-lg bg-[#E7EEFF] text-[#254B98] flex items-center justify-center shrink-0">
                    <Lightbulb size={17} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[14px] font-semibold text-[#111C2D]">
                      {insight.title}
                    </h3>
                    <p className="text-[13px] text-[#6B7A99] leading-relaxed mt-0.5">
                      {insight.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 5. Where cars went: stacked bar of actual vs planned share + zones table */}
        <div className="bg-white border border-[#E2E6EF] rounded-[12px] p-5 flex flex-col gap-4">
          <div>
            <h2 className="text-[17px] font-semibold text-[#111C2D]">Where cars went</h2>
            <p className="text-[13px] text-[#6B7A99] mt-0.5">
              Share of all cars that used each destination in this run versus what was planned.
            </p>
          </div>

          {/* Stacked bars: Actual vs Planned */}
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[12px] text-[#6B7A99]">
                <span className="font-medium text-[#111C2D]">Actual</span>
                <span>{totalSpawned.toLocaleString()} cars</span>
              </div>
              <div className="w-full h-4 rounded-full overflow-hidden bg-[#E2E6EF] flex">
                {zoneShares.map((z) =>
                  z.actualPct > 0 ? (
                    <div
                      key={`act-${z.key}`}
                      style={{ width: `${z.actualPct}%`, backgroundColor: z.color }}
                      title={`${z.name}: ${z.actualPct}%`}
                      className="h-full transition-all"
                    />
                  ) : null
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[12px] text-[#6B7A99]">
                <span>Planned</span>
              </div>
              <div className="w-full h-2.5 rounded-full overflow-hidden bg-[#E2E6EF] flex">
                {zoneShares.map((z) =>
                  z.plannedPct > 0 ? (
                    <div
                      key={`plan-${z.key}`}
                      style={{ width: `${z.plannedPct}%`, backgroundColor: z.color }}
                      title={`${z.name} (planned): ${z.plannedPct}%`}
                      className="h-full opacity-75 transition-all"
                    />
                  ) : null
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-1.5 pt-1 text-[13px] text-[#6B7A99]">
              {zoneShares.map((z) => (
                <span key={`leg-${z.key}`} className="inline-flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-[3px] shrink-0"
                    style={{ backgroundColor: z.color }}
                  />
                  <span>{z.name}:</span>
                  <b className="font-semibold text-[#111C2D] tabular-nums">{z.actualPct}%</b>
                  <span className="text-[12px] tabular-nums">(planned {z.plannedPct}%)</span>
                </span>
              ))}
            </div>
          </div>

          {/* Existing zones table with renamed headings */}
          {!hasDropoffStats ? (
            <div className="py-3 text-[#6B7A99] text-[13px]">n/a</div>
          ) : (
            <div className="overflow-x-auto pt-1">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="bg-[#F5F6F8] text-[#6B7A99] text-[12px]">
                    <th className="py-2.5 px-3 font-medium rounded-l-lg">Zone</th>
                    <th className="py-2.5 px-3 font-medium">Cars sent here</th>
                    <th className="py-2.5 px-3 font-medium">Share of all cars</th>
                    <th className="py-2.5 px-3 font-medium">Dropped off at the zone</th>
                    <th className="py-2.5 px-3 font-medium rounded-r-lg">
                      Gave up and dropped off early
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E6EF]/70">
                  {currentDropoffStats!.map((ds) => {
                    const sharePct =
                      totalSpawned > 0 ? Math.round((ds.assigned / totalSpawned) * 100) : 0;
                    return (
                      <tr key={ds.dropoffId} className="hover:bg-[#F5F6F8]/60">
                        <td className="py-2.5 px-3 font-medium text-[#111C2D]">
                          {cleanName(ds.name)}
                        </td>
                        <td className="py-2.5 px-3 text-[#111C2D] tabular-nums">{ds.assigned}</td>
                        <td className="py-2.5 px-3 text-[#111C2D] tabular-nums">{sharePct}%</td>
                        <td className="py-2.5 px-3 text-[#111C2D] tabular-nums">
                          {ds.droppedAtZone}
                        </td>
                        <td className="py-2.5 px-3 text-[#111C2D] tabular-nums">
                          {ds.droppedEarly}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-[#E2E6EF] font-medium hover:bg-[#F5F6F8]/60">
                    <td className="py-2.5 px-3 text-[#111C2D]">Direct to exit</td>
                    <td className="py-2.5 px-3 text-[#111C2D] tabular-nums">
                      {currentDirectAssigned ?? 0}
                    </td>
                    <td className="py-2.5 px-3 text-[#111C2D] tabular-nums">
                      {totalSpawned > 0
                        ? Math.round(((currentDirectAssigned ?? 0) / totalSpawned) * 100)
                        : 0}
                      %
                    </td>
                    <td className="py-2.5 px-3 text-[#6B7A99]">—</td>
                    <td className="py-2.5 px-3 text-[#6B7A99]">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 6. Collapsed "Settings used for this run" */}
        <div className="bg-white border border-[#E2E6EF] rounded-[12px] overflow-hidden">
          <button
            type="button"
            onClick={() => setSettingsOpen((prev) => !prev)}
            aria-expanded={settingsOpen}
            className="w-full min-h-[48px] px-5 py-3 flex items-center justify-between gap-3 text-left hover:bg-[#F5F6F8]/70 cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <SlidersHorizontal size={17} className="text-[#6B7A99] shrink-0" />
              <span className="text-[15px] font-semibold text-[#111C2D]">
                Settings used for this run
              </span>
            </div>
            <ChevronDown
              size={18}
              className={`text-[#6B7A99] transition-transform duration-150 ${
                settingsOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {settingsOpen && (
            <div className="px-5 pb-5 pt-3 border-t border-[#E2E6EF] grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex flex-col gap-3">
                <div>
                  <span className="text-[12px] text-[#6B7A99] block mb-1.5">
                    Cars per minute at each gate
                  </span>
                  {entrances.length === 0 ? (
                    <span className="text-[13px] text-[#6B7A99]">n/a</span>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {entrances.map((ent) => {
                        const rate = activeRates[ent.id] ?? 0;
                        return (
                          <div
                            key={ent.id}
                            className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#F5F6F8] border border-[#E2E6EF] text-[13px]"
                          >
                            <span className="text-[#111C2D] font-medium">
                              {cleanName(ent.name)}
                            </span>
                            <span className="text-[#111C2D] tabular-nums">
                              {rate} {rate === 1 ? 'car/min' : 'cars/min'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <span className="text-[12px] text-[#6B7A99] block mb-1.5">
                    Where cars were sent
                  </span>
                  {splitLines.length === 0 ? (
                    <span className="text-[13px] text-[#6B7A99]">n/a</span>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {splitLines.map((line, idx) => (
                        <div
                          key={idx}
                          className="text-[12px] font-mono text-[#111C2D] bg-[#F5F6F8] px-3 py-2 rounded-lg border border-[#E2E6EF] break-all"
                        >
                          {line}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between py-2 border-b border-[#E2E6EF] text-[13px]">
                  <span className="text-[#6B7A99]">Sticker holders</span>
                  <span className="font-semibold text-[#111C2D] tabular-nums">{stickerPct}%</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-[#E2E6EF] text-[13px]">
                  <span className="text-[#6B7A99]">Run length</span>
                  <span className="font-semibold text-[#111C2D] tabular-nums">
                    {runDurationMin} minutes
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-[#E2E6EF] text-[13px]">
                  <span className="text-[#6B7A99]">Layout</span>
                  <span className="font-semibold text-[#111C2D]">{layoutName}</span>
                </div>
                <div className="flex items-start justify-between py-2 text-[13px] gap-4">
                  <div>
                    <div className="text-[#6B7A99]">Random seed</div>
                    <div className="text-[12px] text-[#6B7A99] mt-0.5">
                      Use it to repeat this exact run.
                    </div>
                  </div>
                  <span className="font-mono font-semibold text-[#111C2D] tabular-nums shrink-0">
                    {seedValue}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 7. Compare with earlier runs */}
        <div className="bg-white border border-[#E2E6EF] rounded-[12px] p-5 flex flex-col mb-6">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
            <div>
              <h2 className="text-[17px] font-semibold text-[#111C2D]">
                Compare with earlier runs
              </h2>
              <p className="text-[13px] text-[#6B7A99] mt-0.5">
                Click a run to look at its results.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAllColumns((prev) => !prev)}
              className="h-9 px-3 rounded-lg text-[13px] font-medium text-[#254B98] hover:bg-[#E7EEFF] cursor-pointer transition-colors"
            >
              {showAllColumns ? 'Show fewer columns' : 'Show all columns'}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="bg-[#F5F6F8] text-[#6B7A99] text-[12px]">
                  <th className="py-2.5 px-3 font-medium rounded-l-lg whitespace-nowrap">Run</th>
                  <th className="py-2.5 px-3 font-medium whitespace-nowrap">Scenario</th>
                  {showAllColumns && (
                    <>
                      <th className="py-2.5 px-3 font-medium whitespace-nowrap">Layout</th>
                      <th className="py-2.5 px-3 font-medium whitespace-nowrap">
                        Arrival rates (cars/min)
                      </th>
                      <th className="py-2.5 px-3 font-medium whitespace-nowrap">Sticker share</th>
                      <th className="py-2.5 px-3 font-medium whitespace-nowrap">
                        Where cars went
                      </th>
                    </>
                  )}
                  <th className="py-2.5 px-3 font-medium whitespace-nowrap">
                    Cars exiting per hour
                  </th>
                  <th className="py-2.5 px-3 font-medium whitespace-nowrap">Average wait</th>
                  {showAllColumns && (
                    <th className="py-2.5 px-3 font-medium whitespace-nowrap">
                      Average trip time
                    </th>
                  )}
                  <th className="py-2.5 px-3 font-medium whitespace-nowrap">Longest line</th>
                  {showAllColumns && (
                    <>
                      <th className="py-2.5 px-3 font-medium whitespace-nowrap">
                        Road capacity used
                      </th>
                      <th className="py-2.5 px-3 font-medium whitespace-nowrap">
                        Dropped off early
                      </th>
                      <th className="py-2.5 px-3 font-medium whitespace-nowrap">
                        Drop-off wait
                      </th>
                    </>
                  )}
                  <th className="py-2.5 px-3 font-medium rounded-r-lg whitespace-nowrap">
                    Outcome
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E6EF]/70">
                {tableRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={showAllColumns ? 14 : 6}
                      className="py-6 text-center text-[#6B7A99] text-[13px]"
                    >
                      No previous simulation runs logged.
                    </td>
                  </tr>
                ) : (
                  tableRows.map((log, index) => {
                    const isCurrent = (activeEntry?.runId || tableRows[0].runId) === log.runId;
                    const spawnSummary = Object.values(log.spawnRates || {}).join(' / ');
                    const logDrop = getDropStats(log);
                    const rowScenario = getScenarioLabel(log, entrances);
                    const rowSpawned =
                      (log.spawnedSticker ?? log.result?.spawnedSticker ?? 0) +
                      (log.spawnedNonSticker ?? log.result?.spawnedNonSticker ?? 0);
                    const rowDuration =
                      (log as RunLogEntry & { simDurationMin?: number }).simDurationMin ??
                      storeState.settings.simDurationMin;
                    const rowArrivalsPerHr = getArrivalsPerHour(
                      log.spawnRates,
                      rowSpawned,
                      rowDuration
                    );
                    const rowOutcome = getRunOutcome({
                      isGridlocked: log.result?.isGridlocked,
                      maxQueue: log.maxQueue,
                      avgWait: log.avgWait,
                      avgTransit: log.avgTransit,
                      flowEfficiency: log.flowEfficiency,
                      throughput: log.throughput,
                      arrivalsPerHr: rowArrivalsPerHr,
                    });
                    const rowQueueStatus = getQueueStatus(log.maxQueue);
                    const rowCapacityStatus = getCapacityUsedStatus(log.flowEfficiency);

                    return (
                      <tr
                        key={log.runId || index}
                        onClick={() => setSelectedRunId(log.runId)}
                        className={`cursor-pointer transition-colors ${
                          isCurrent
                            ? 'bg-[#E7EEFF]/70 hover:bg-[#E7EEFF]'
                            : 'hover:bg-[#F5F6F8]'
                        }`}
                      >
                        <td className="py-3 px-3 font-semibold text-[#111C2D] whitespace-nowrap">
                          <span>Run {log.runNumber}</span>
                          {index === 0 && (
                            <span className="ml-2 text-[12px] px-2 py-0.5 rounded-full bg-[#F5F6F8] border border-[#E2E6EF] text-[#6B7A99] font-medium">
                              latest
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-[#111C2D] whitespace-nowrap">
                          {rowScenario}
                        </td>
                        {showAllColumns && (
                          <>
                            <td className="py-3 px-3 text-[#111C2D] whitespace-nowrap">
                              {log.layoutName}
                            </td>
                            <td className="py-3 px-3 text-[#111C2D] whitespace-nowrap tabular-nums">
                              {spawnSummary || '--'}
                            </td>
                            <td className="py-3 px-3 text-[#111C2D] whitespace-nowrap">
                              <div className="font-medium tabular-nums">
                                {Math.round((log.stickerShare ?? 0.7) * 100)}%
                              </div>
                              {(log.spawnedSticker !== undefined ||
                                log.result?.spawnedSticker !== undefined) && (
                                <div className="text-[12px] text-[#6B7A99] whitespace-nowrap mt-0.5 tabular-nums">
                                  {log.spawnedSticker ?? log.result?.spawnedSticker ?? 0} sticker /{' '}
                                  {log.spawnedNonSticker ?? log.result?.spawnedNonSticker ?? 0}{' '}
                                  visitor
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3 text-[#111C2D]">
                              {(() => {
                                const splits = log.destinationSplits;
                                const lines = formatAllEntranceSplits(splits, storeState.map);
                                if (lines.length === 0) {
                                  return <span className="text-[12px] text-[#6B7A99]">n/a</span>;
                                }
                                return (
                                  <div className="flex flex-col space-y-0.5 max-w-[210px]">
                                    {lines.map((l, i) => (
                                      <div
                                        key={i}
                                        className="text-[12px] font-mono text-[#6B7A99] truncate"
                                        title={l}
                                      >
                                        {l}
                                      </div>
                                    ))}
                                  </div>
                                );
                              })()}
                            </td>
                          </>
                        )}
                        <td className="py-3 px-3 font-medium text-[#111C2D] whitespace-nowrap tabular-nums">
                          {(log.throughput ?? 0).toLocaleString()} /hr
                        </td>
                        <td className="py-3 px-3 text-[#111C2D] whitespace-nowrap tabular-nums">
                          {log.avgWait ?? 0} s
                        </td>
                        {showAllColumns && (
                          <td className="py-3 px-3 text-[#111C2D] whitespace-nowrap tabular-nums">
                            {log.avgTransit ?? 0} s
                          </td>
                        )}
                        <td
                          className={`py-3 px-3 font-medium whitespace-nowrap tabular-nums ${
                            rowQueueStatus.level === 'bad' ? 'text-[#EF4444]' : 'text-[#111C2D]'
                          }`}
                        >
                          {log.maxQueue} {log.maxQueue === 1 ? 'car' : 'cars'}
                        </td>
                        {showAllColumns && (
                          <>
                            <td className="py-3 px-3 whitespace-nowrap">
                              <span
                                className={`text-[12px] px-2.5 py-0.5 rounded-full font-semibold tabular-nums ${rowCapacityStatus.badgeClass}`}
                              >
                                {log.flowEfficiency}%
                              </span>
                            </td>
                            <td className="py-3 px-3 text-[#111C2D] whitespace-nowrap tabular-nums">
                              {formatEarlyDropoffsWithPct(logDrop)}
                            </td>
                            <td className="py-3 px-3 text-[#111C2D] whitespace-nowrap tabular-nums">
                              {formatDropWait(logDrop)}
                            </td>
                          </>
                        )}
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className={`text-[12px] px-2.5 py-0.5 rounded-full font-semibold ${rowOutcome.badgeClass}`}
                          >
                            {rowOutcome.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
