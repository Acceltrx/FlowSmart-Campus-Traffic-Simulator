/**
 * FlowSmart - Results View
 * Implements PRD v1.4 specifications:
 * - 5 metric cards with badge states (no baseline deltas or hard-coded comparisons)
 * - Bottleneck list ranked by max queue per segment with severity badges
 * - Actionable insights (at least 2 per run, from sim/insights.ts)
 * - Run log table with clickable row selection (only real runs, no fake fallback data)
 * - Export run log (CSV) including config id, run number, spawn rates, sticker share, seed, metrics
 * - Export report producing a PDF with jsPDF + html2canvas
 */

import React, { useState, useMemo } from 'react';
import {
  Download,
  FileText,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { useTrafficStore } from '../../context/TrafficStoreContext';
import { useSimulation } from '../../context/SimulationContext';
import { generateActionableInsights, ActionableInsight } from '../../sim/insights';
import { RunLogEntry, SimulationResult, BottleneckRank } from '../../types/traffic';
import { formatAllEntranceSplits } from '../../utils/destinationSplit';

// Drop-off statistics for a run. Fields are undefined on runs saved before they existed.
interface DropStats {
  total: number | undefined;
  early: number | undefined;
  avgWait: number | undefined;
}

function getDropStats(entry: RunLogEntry | undefined, fallback?: SimulationResult): DropStats {
  const src = entry ?? undefined;
  return {
    total: src ? src.totalDropoffs ?? src.result?.totalDropoffs : fallback?.totalDropoffs,
    early: src ? src.earlyDropoffs ?? src.result?.earlyDropoffs : fallback?.earlyDropoffs,
    avgWait: src ? src.avgDropWaitSec ?? src.result?.avgDropWaitSec : fallback?.avgDropWaitSec,
  };
}

// "N of M (P%)", "0 of 0" when there were no drop-offs, "n/a" for old runs
function formatEarlyDropoffs(d: DropStats): string {
  if (d.early === undefined || d.total === undefined) return 'n/a';
  if (d.total === 0) return '0 of 0';
  return `${d.early} of ${d.total} (${Math.round((d.early / d.total) * 100)}%)`;
}

function formatDropWait(d: DropStats): string {
  return d.avgWait === undefined ? 'n/a' : `${d.avgWait.toFixed(1)} s`;
}

export const ResultsView: React.FC = () => {
  const { state: storeState, setActiveTab } = useTrafficStore();
  const { lastResult } = useSimulation();

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);

  // Active run log
  const runLog = storeState.runLog;

  // Find currently selected run or latest run
  const activeEntry: RunLogEntry | undefined = useMemo(() => {
    if (selectedRunId) {
      const found = runLog.find((r) => r.runId === selectedRunId);
      if (found) return found;
    }
    return runLog[0];
  }, [runLog, selectedRunId]);

  // If no run completed yet and no lastResult exists
  if (!activeEntry && !lastResult) {
    return (
      <div className="flex-1 bg-[#F5F6F8] flex items-center justify-center p-6 select-none">
        <div className="max-w-md w-full bg-white rounded-lg border border-[#E2E6EF] p-6 flex flex-col items-center text-center gap-3">
          <div className="w-12 h-12 rounded-full bg-[#25A76B]/10 text-[#25A76B] flex items-center justify-center">
            <CheckCircle2 size={24} />
          </div>
          <div>
            <h2 className="text-[16px] font-medium text-[#111C2D]">No simulation results yet</h2>
            <p className="text-[12px] text-[#6B7A99] mt-1 leading-relaxed">
              Run a simulation session from the Simulation screen to generate throughput analysis,
              queue bottleneck rankings, and actionable campus traffic recommendations.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('simulation')}
            className="mt-2 h-9 px-4 bg-[#254B98] hover:bg-[#1f3c7a] text-white rounded-lg text-[13px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <ArrowLeft size={14} />
            <span>Go to simulation</span>
          </button>
        </div>
      </div>
    );
  }

  // Active result data
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

  const throughput = activeEntry?.throughput ?? result.totalThroughputVehHr ?? 0;
  const avgWait = activeEntry?.avgWait ?? result.avgWaitTimeSec ?? 0;
  const avgTransit = activeEntry?.avgTransit ?? result.avgTransitTimeSec ?? 0;
  const maxQueue = activeEntry?.maxQueue ?? result.maxQueueLengthVeh ?? 0;
  const maxQueueLoc = result.maxQueueLocation || (storeState.map.roadSegments[0]?.name ?? 'None');
  const flowEfficiency = activeEntry?.flowEfficiency ?? result.flowEfficiencyPct ?? 0;
  const runNumber = activeEntry?.runNumber ?? result.runNumber ?? 1;
  const layoutName = activeEntry?.layoutName || result.layoutName || storeState.settings.layoutName || 'Layout A';
  const dropStats = getDropStats(activeEntry ?? undefined, result);
  const currentDropoffStats = activeEntry?.dropoffStats ?? result.dropoffStats;
  const currentDirectAssigned = activeEntry?.directAssigned ?? result.directAssigned;
  const currentSplits = activeEntry ? activeEntry.destinationSplits : storeState.settings.destinationSplits;
  const splitLines = useMemo(
    () => formatAllEntranceSplits(currentSplits, storeState.map),
    [currentSplits, storeState.map]
  );
  const hasDropoffStats = Boolean(currentDropoffStats && currentDropoffStats.length > 0);

  const totalSpawned =
    (activeEntry?.spawnedSticker ?? result.spawnedSticker ?? 0) +
    (activeEntry?.spawnedNonSticker ?? result.spawnedNonSticker ?? 0) ||
    ((currentDropoffStats ? currentDropoffStats.reduce((acc, d) => acc + d.assigned, 0) : 0) + (currentDirectAssigned ?? 0));

  // PRD 3.3.2 Metric card badge states
  // 1. Total Throughput: Optimal (>=1200), Moderate (900-1199), Critical (<900)
  const throughputBadge =
    throughput >= 1200
      ? { label: 'Optimal', bg: 'bg-[#82FAB6]/40 text-[#005230]' }
      : throughput >= 900
      ? { label: 'Moderate', bg: 'bg-[#FFDDB8] text-[#513100]' }
      : { label: 'Critical', bg: 'bg-[#FFDAD6] text-[#93000A]' };

  // 2. Avg Wait Time: Low (<30), Elevated (30-50), Critical (>50)
  const waitBadge =
    avgWait < 30
      ? { label: 'Low', bg: 'bg-[#82FAB6]/40 text-[#005230]' }
      : avgWait <= 50
      ? { label: 'Elevated', bg: 'bg-[#FFDDB8] text-[#513100]' }
      : { label: 'Critical', bg: 'bg-[#FFDAD6] text-[#93000A]' };

  // 3. Avg Transit Time: Low (<150), Elevated (150-180), Critical (>180)
  const transitBadge =
    avgTransit < 150
      ? { label: 'Low', bg: 'bg-[#82FAB6]/40 text-[#005230]' }
      : avgTransit <= 180
      ? { label: 'Elevated', bg: 'bg-[#FFDDB8] text-[#513100]' }
      : { label: 'Critical', bg: 'bg-[#FFDAD6] text-[#93000A]' };

  // 4. Max Queue Length: Clear (<=5), Warning (6-14), Critical (>=15)
  const queueBadge =
    maxQueue <= 5
      ? { label: 'Clear', bg: 'bg-[#82FAB6]/40 text-[#005230]' }
      : maxQueue <= 14
      ? { label: 'Warning', bg: 'bg-[#FFDDB8] text-[#513100]' }
      : { label: 'Critical', bg: 'bg-[#FFDAD6] text-[#93000A]' };

  // 5. Flow Efficiency: Good (>=75), Acceptable (60-74), Poor (<60)
  const efficiencyBadge =
    flowEfficiency >= 75
      ? { label: 'Good', bg: 'bg-[#82FAB6]/40 text-[#005230]' }
      : flowEfficiency >= 60
      ? { label: 'Acceptable', bg: 'bg-[#FFDDB8] text-[#513100]' }
      : { label: 'Poor', bg: 'bg-[#FFDAD6] text-[#93000A]' };

  // Bottlenecks list ranked by max queue per segment (PRD 3.3.3)
  const rawBottlenecks: BottleneckRank[] = result.bottlenecks || [];

  // Actionable insights from sim/insights.ts (PRD 3.3.5)
  const insights: ActionableInsight[] = useMemo(() => {
    return generateActionableInsights(result, storeState.map);
  }, [result, storeState.map]);

  // Combined run log table rows
  const tableRows: RunLogEntry[] = useMemo(() => {
    if (runLog.length > 0) return runLog;
    if (activeEntry) return [activeEntry];
    return [];
  }, [runLog, activeEntry]);

  // Export run log as CSV with requested columns (PRD 3.3.5 & prompt specification)
  const handleExportCsv = () => {
    // Collect all drop-off names across all logged runs and current map
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
      const splitLines = formatAllEntranceSplits(splits, storeState.map);
      const splitUsedStr = splitLines.length > 0 ? splitLines.join('; ') : '';

      const totalSpawned =
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
        const sharePct = totalSpawned > 0 ? `${Math.round((st.assigned / totalSpawned) * 100)}%` : '0%';
        return [st.assigned, sharePct, st.droppedAtZone, st.droppedEarly];
      });

      return [
        `"${r.layoutName}"`,
        r.runNumber,
        r.seed !== undefined ? r.seed : (r.result?.seed !== undefined ? r.result.seed : 'N/A'),
        `"${spawnSummary}"`,
        `${Math.round(r.stickerShare * 100)}%`,
        r.throughput,
        r.avgWait,
        r.avgTransit,
        r.maxQueue,
        `${r.flowEfficiency}%`,
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
      pdf.save(`flowsmart_simulation_report_${layoutName.replace(/\s+/g, '_')}_run_${runNumber}.pdf`);
    } catch (err) {
      console.error('Failed to generate PDF report:', err);
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="flex-1 bg-[#F5F6F8] overflow-y-auto p-6 select-none font-sans">
      <div id="results-printable-report" className="max-w-[1280px] mx-auto flex flex-col gap-6">
        {/* 1. Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-3 border-b border-[#E2E6EF]">
          <div>
            <h1 className="text-[22px] font-medium text-[#111C2D] tracking-tight leading-[28px]">
              Simulation results
            </h1>
            <div className="flex items-center gap-2 text-[13px] text-[#6B7A99] mt-0.5 flex-wrap">
              <span>{layoutName}, run {runNumber}</span>
              {activeEntry?.stickerShare !== undefined && (
                <>
                  <span>•</span>
                  <span>Sticker share: {Math.round(activeEntry.stickerShare * 100)}%</span>
                  {(activeEntry.spawnedSticker !== undefined || result.spawnedSticker !== undefined) && (
                    <span className="text-[#434651]">
                      (Actual: {activeEntry.spawnedSticker ?? result.spawnedSticker ?? 0} sticker / {activeEntry.spawnedNonSticker ?? result.spawnedNonSticker ?? 0} non-sticker)
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleExportCsv}
              className="h-9 px-4 rounded-lg bg-white text-[#111C2D] text-[13px] font-medium border border-[#E2E6EF] hover:bg-gray-50 active:scale-95 transition-all flex items-center gap-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] focus-visible:ring-offset-1"
            >
              <Download size={16} className="text-[#6B7A99]" />
              <span>Export run log (CSV)</span>
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={isExportingPdf}
              className="h-9 px-4 rounded-lg bg-[#254B98] text-white text-[13px] font-medium hover:bg-[#1c3870] active:scale-95 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] focus-visible:ring-offset-1"
            >
              {isExportingPdf ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Exporting PDF...</span>
                </>
              ) : (
                <>
                  <FileText size={16} />
                  <span>Export report</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* 2. Row of 5 Metric Cards (Clean, 24px gap, consistent 16px padding) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
          {/* Card 1: Total Throughput */}
          <div className="bg-white border border-[#E2E6EF] rounded-lg p-4 flex flex-col justify-between min-w-0">
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="text-[12px] text-[#6B7A99]">Total throughput</span>
              <span className={`text-[12px] px-2 py-0.5 rounded-lg font-medium ${throughputBadge.bg}`}>
                {throughputBadge.label}
              </span>
            </div>
            <div className="text-[22px] font-medium text-[#111C2D] my-1 truncate tabular-nums">
              {throughput.toLocaleString()}{' '}
              <span className="text-[13px] text-[#6B7A99] font-normal">veh/hr</span>
            </div>
            <div className="text-[12px] text-[#6B7A99]">Hourly exit rate</div>
          </div>

          {/* Card 2: Avg wait time */}
          <div className="bg-white border border-[#E2E6EF] rounded-lg p-4 flex flex-col justify-between min-w-0">
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="text-[12px] text-[#6B7A99]">Avg wait time</span>
              <span className={`text-[12px] px-2 py-0.5 rounded-lg font-medium ${waitBadge.bg}`}>
                {waitBadge.label}
              </span>
            </div>
            <div className="text-[22px] font-medium text-[#111C2D] my-1 truncate tabular-nums">
              {avgWait} <span className="text-[13px] text-[#6B7A99] font-normal">s</span>
            </div>
            <div className="text-[12px] text-[#6B7A99]">Mean queue delay</div>
          </div>

          {/* Card 3: Avg transit time */}
          <div className="bg-white border border-[#E2E6EF] rounded-lg p-4 flex flex-col justify-between min-w-0">
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="text-[12px] text-[#6B7A99]">Avg transit time</span>
              <span className={`text-[12px] px-2 py-0.5 rounded-lg font-medium ${transitBadge.bg}`}>
                {transitBadge.label}
              </span>
            </div>
            <div className="text-[22px] font-medium text-[#111C2D] my-1 truncate tabular-nums">
              {avgTransit} <span className="text-[13px] text-[#6B7A99] font-normal">s</span>
            </div>
            <div className="text-[12px] text-[#6B7A99]">Entrance to exit duration</div>
          </div>

          {/* Card 4: Max queue length */}
          <div className="bg-white border border-[#E2E6EF] rounded-lg p-4 flex flex-col justify-between min-w-0">
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="text-[12px] text-[#6B7A99]">Max queue length</span>
              <span className={`text-[12px] px-2 py-0.5 rounded-lg font-medium ${queueBadge.bg}`}>
                {queueBadge.label}
              </span>
            </div>
            <div
              className={`text-[22px] font-medium my-1 truncate tabular-nums ${
                maxQueue >= 15 ? 'text-[#EF4444]' : 'text-[#111C2D]'
              }`}
            >
              {maxQueue} <span className="text-[13px] text-[#6B7A99] font-normal">vehicles</span>
            </div>
            <div className="flex items-center gap-1.5 text-[12px] text-[#6B7A99] truncate">
              {maxQueue >= 15 ? (
                <AlertTriangle size={14} className="text-[#EF4444] shrink-0" />
              ) : (
                <CheckCircle2 size={14} className="text-[#25A76B] shrink-0" />
              )}
              <span className="truncate">at {maxQueueLoc}</span>
            </div>
          </div>

          {/* Card 5: Flow efficiency */}
          <div className="bg-white border border-[#E2E6EF] rounded-lg p-4 flex flex-col justify-between min-w-0">
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="text-[12px] text-[#6B7A99]">Flow efficiency</span>
              <span className={`text-[12px] px-2 py-0.5 rounded-lg font-medium ${efficiencyBadge.bg}`}>
                {efficiencyBadge.label}
              </span>
            </div>
            <div className="flex items-center gap-3 my-1">
              <div className="relative w-10 h-10 shrink-0">
                <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="14" fill="none" stroke="#E2E6EF" strokeWidth="4" />
                  <circle
                    cx="18"
                    cy="18"
                    r="14"
                    fill="none"
                    stroke={
                      flowEfficiency >= 75
                        ? '#25A76B'
                        : flowEfficiency >= 60
                        ? '#F59E0B'
                        : '#EF4444'
                    }
                    strokeWidth="4"
                    strokeDasharray="88"
                    strokeDashoffset={Math.max(0, 88 - (88 * flowEfficiency) / 100)}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-[12px] font-semibold text-[#111C2D]">
                  {flowEfficiency}%
                </div>
              </div>
              <div className="text-[20px] font-medium text-[#111C2D] truncate">
                {flowEfficiency}%
              </div>
            </div>
            <div className="text-[12px] text-[#6B7A99]">Capacity ratio</div>
          </div>
        </div>

        {/* 2b. Drop-off cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
          <div className="bg-white border border-[#E2E6EF] rounded-lg p-4 flex flex-col justify-between min-w-0">
            <span className="text-[12px] text-[#6B7A99] mb-1">Early drop-offs</span>
            <div className="text-[22px] font-medium text-[#111C2D] my-1 truncate tabular-nums">
              {formatEarlyDropoffs(dropStats)}
            </div>
            <div className="text-[12px] text-[#6B7A99]">
              Cars that gave up waiting and dropped off away from the zone.
            </div>
          </div>

          <div className="bg-white border border-[#E2E6EF] rounded-lg p-4 flex flex-col justify-between min-w-0">
            <span className="text-[12px] text-[#6B7A99] mb-1">Average wait at drop-off</span>
            <div className="text-[22px] font-medium text-[#111C2D] my-1 truncate tabular-nums">
              {formatDropWait(dropStats)}
            </div>
            <div className="text-[12px] text-[#6B7A99]">Time held near the zone before dropping off.</div>
          </div>
        </div>

        {/* 2c. Drop-off zones & Run details section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Drop-off zones card */}
          <div className="lg:col-span-2 bg-white border border-[#E2E6EF] rounded-lg p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-baseline justify-between mb-3">
                <div>
                  <h2 className="text-[16px] text-[#111C2D] font-medium">Drop-off zones</h2>
                  <p className="text-[12px] text-[#6B7A99] mt-0.5">
                    Vehicle distribution across campus drop-offs and direct exits
                  </p>
                </div>
              </div>

              {!hasDropoffStats ? (
                <div className="py-4 text-[#6B7A99] text-[13px]">
                  n/a
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[13px]">
                    <thead>
                      <tr className="bg-[#F5F6F8] text-[#434651] text-[12px]">
                        <th className="py-2.5 px-3 font-medium rounded-l-lg">Zone</th>
                        <th className="py-2.5 px-3 font-medium">Vehicles assigned</th>
                        <th className="py-2.5 px-3 font-medium">Share of all vehicles</th>
                        <th className="py-2.5 px-3 font-medium">Dropped off at the zone</th>
                        <th className="py-2.5 px-3 font-medium rounded-r-lg">Gave up and dropped off early</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E6EF]/60">
                      {currentDropoffStats!.map((ds) => {
                        const sharePct = totalSpawned > 0 ? Math.round((ds.assigned / totalSpawned) * 100) : 0;
                        return (
                          <tr key={ds.dropoffId} className="hover:bg-gray-50/50">
                            <td className="py-2.5 px-3 font-medium text-[#111C2D]">{ds.name}</td>
                            <td className="py-2.5 px-3 text-[#111C2D] tabular-nums">{ds.assigned}</td>
                            <td className="py-2.5 px-3 text-[#111C2D] tabular-nums">{sharePct}%</td>
                            <td className="py-2.5 px-3 text-[#111C2D] tabular-nums">{ds.droppedAtZone}</td>
                            <td className="py-2.5 px-3 text-[#111C2D] tabular-nums">{ds.droppedEarly}</td>
                          </tr>
                        );
                      })}
                      {/* Last row: Direct to exit */}
                      <tr className="border-t border-[#E2E6EF] font-medium hover:bg-gray-50/50">
                        <td className="py-2.5 px-3 text-[#111C2D]">Direct to exit</td>
                        <td className="py-2.5 px-3 text-[#111C2D] tabular-nums">{currentDirectAssigned ?? 0}</td>
                        <td className="py-2.5 px-3 text-[#111C2D] tabular-nums">
                          {totalSpawned > 0 ? Math.round(((currentDirectAssigned ?? 0) / totalSpawned) * 100) : 0}%
                        </td>
                        <td className="py-2.5 px-3 text-[#6B7A99]">—</td>
                        <td className="py-2.5 px-3 text-[#6B7A99]">—</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="text-[12px] text-[#6B7A99] mt-3">
                    Share of all vehicles is what this run produced. The split you set is shown under Run details.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Run details card */}
          <div className="bg-white border border-[#E2E6EF] rounded-lg p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-baseline justify-between mb-3">
                <div>
                  <h2 className="text-[16px] text-[#111C2D] font-medium">Run details</h2>
                  <p className="text-[12px] text-[#6B7A99] mt-0.5">
                    Destination split configured per entrance
                  </p>
                </div>
              </div>

              <div className="flex flex-col space-y-3">
                <div>
                  <span className="text-[12px] text-[#6B7A99] block mb-1">Destination split</span>
                  {splitLines.length === 0 ? (
                    <span className="text-[13px] text-[#6B7A99]">n/a</span>
                  ) : (
                    <div className="flex flex-col space-y-1.5">
                      {splitLines.map((line, idx) => (
                        <div
                          key={idx}
                          className="text-[12px] font-mono text-[#111C2D] bg-[#F5F6F8] px-2.5 py-1.5 rounded-lg border border-[#E2E6EF] leading-relaxed break-all"
                        >
                          {line}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-[#E2E6EF] flex flex-col space-y-1.5">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-[#6B7A99]">Configuration</span>
                    <span className="text-[#111C2D] font-medium">{layoutName}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-[#6B7A99]">Run number</span>
                    <span className="text-[#111C2D] font-medium">Run {runNumber}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-[#6B7A99]">Seed</span>
                    <span className="text-[#111C2D] font-mono tabular-nums">
                      {activeEntry?.seed ?? result.seed ?? 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Bottleneck Analysis Panel (Consistent 16px padding, clean border) */}
        <div className="bg-white border border-[#E2E6EF] rounded-lg p-4 flex flex-col">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <h2 className="text-[16px] text-[#111C2D] font-medium">Bottleneck analysis</h2>
              <p className="text-[12px] text-[#6B7A99] mt-0.5">Ranked by maximum queue length</p>
            </div>
            <span className="text-[12px] text-[#6B7A99]">
              {rawBottlenecks.length} active segment{rawBottlenecks.length === 1 ? '' : 's'}
            </span>
          </div>

          {rawBottlenecks.length === 0 ? (
            <div className="py-6 text-center text-[#6B7A99] text-[12px]">
              No queued bottlenecks recorded for this evaluation run.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 my-2">
              {rawBottlenecks.map((item) => {
                const severityBadge =
                  item.severity === 'critical'
                    ? { label: 'Critical', bg: 'bg-[#FFDAD6] text-[#93000A]', bar: 'bg-[#EF4444]' }
                    : item.severity === 'moderate'
                    ? { label: 'Moderate', bg: 'bg-[#FFDDB8] text-[#513100]', bar: 'bg-[#F59E0B]' }
                    : { label: 'Clear', bg: 'bg-[#82FAB6]/40 text-[#005230]', bar: 'bg-[#25A76B]' };

                return (
                  <div key={item.segmentId} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="text-[#111C2D] font-medium truncate">
                        {item.segmentName}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[12px] text-[#111C2D] font-medium">
                          {item.maxQueueLength} {item.maxQueueLength === 1 ? 'vehicle' : 'vehicles'}
                        </span>
                        <span
                          className={`text-[12px] px-2 py-0.5 rounded-lg font-medium ${severityBadge.bg}`}
                        >
                          {severityBadge.label}
                        </span>
                      </div>
                    </div>
                    <div className="w-full bg-[#E2E6EF] rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-2 rounded-full transition-all duration-300 ${severityBadge.bar}`}
                        style={{ width: `${Math.min(100, Math.max(item.percentage, 8))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 4. Actionable Insights Section (Consistent 16px padding, clean cards) */}
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-[16px] font-medium text-[#111C2D]">Actionable insights</h2>
            <p className="text-[12px] text-[#6B7A99] mt-0.5">
              Recommendations based on observed campus bottlenecks
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {insights.map((insight) => (
              <div
                key={insight.id}
                className="bg-white border border-[#E2E6EF] rounded-lg p-4 flex flex-col justify-between"
              >
                <div>
                  <span className="text-[12px] px-2 py-0.5 rounded-lg bg-[#E7EEFF] text-[#254B98] font-medium inline-block mb-2">
                    {insight.category}
                  </span>
                  <h3 className="text-[14px] font-medium text-[#111C2D] mb-1.5">
                    {insight.title}
                  </h3>
                  <p className="text-[13px] text-[#434651] leading-relaxed">
                    {insight.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 5. Run Log Table Section (Consistent 16px padding, clean table) */}
        <div className="bg-white border border-[#E2E6EF] rounded-lg p-4 flex flex-col mb-6">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <h2 className="text-[16px] font-medium text-[#111C2D]">Run log</h2>
              <p className="text-[12px] text-[#6B7A99] mt-0.5">
                Comparison across recent evaluation runs (click a row to inspect results)
              </p>
            </div>
            <span className="text-[12px] text-[#6B7A99]">
              Showing {tableRows.length} evaluation{tableRows.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="bg-[#F5F6F8] text-[#434651] text-[12px]">
                  <th className="py-2.5 px-3 font-medium rounded-l-lg">Configuration</th>
                  <th className="py-2.5 px-3 font-medium">Run</th>
                  <th className="py-2.5 px-3 font-medium">Spawn rates (veh/min)</th>
                  <th className="py-2.5 px-3 font-medium">Sticker share</th>
                  <th className="py-2.5 px-3 font-medium">Destination split</th>
                  <th className="py-2.5 px-3 font-medium">Throughput</th>
                  <th className="py-2.5 px-3 font-medium">Avg wait</th>
                  <th className="py-2.5 px-3 font-medium">Avg transit</th>
                  <th className="py-2.5 px-3 font-medium">Max queue</th>
                  <th className="py-2.5 px-3 font-medium">Flow efficiency</th>
                  <th className="py-2.5 px-3 font-medium">Early drop-offs</th>
                  <th className="py-2.5 px-3 font-medium rounded-r-lg">Avg drop-off wait</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E6EF]/60">
                {tableRows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="py-6 text-center text-[#6B7A99] text-[12px]">
                      No previous evaluation runs logged.
                    </td>
                  </tr>
                ) : (
                  tableRows.map((log, index) => {
                    const isCurrent = (activeEntry?.runId || tableRows[0].runId) === log.runId;
                    const spawnSummary = Object.values(log.spawnRates || {}).join(' / ');
                    const logDrop = getDropStats(log);
                    return (
                      <tr
                        key={log.runId || index}
                        onClick={() => setSelectedRunId(log.runId)}
                        className={`cursor-pointer transition-colors ${
                          isCurrent
                            ? 'bg-[#E7EEFF]/40 hover:bg-[#E7EEFF]/60'
                            : 'hover:bg-gray-50'
                        }`}
                      >
                        <td className="py-3 px-3 font-medium text-[#111C2D] flex items-center gap-2">
                          <span>{log.layoutName}</span>
                          {index === 0 && (
                            <span className="text-[12px] px-2 py-0.5 rounded-lg bg-[#254B98] text-white font-medium">
                              Current
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-[#434651]">Run {log.runNumber}</td>
                        <td className="py-3 px-3 text-[#111C2D]">{spawnSummary || '--'}</td>
                        <td className="py-3 px-3 text-[#111C2D]">
                          <div className="font-medium">{Math.round(log.stickerShare * 100)}%</div>
                          {(log.spawnedSticker !== undefined || log.result?.spawnedSticker !== undefined) && (
                            <div className="text-[11px] text-[#6B7A99] whitespace-nowrap mt-0.5">
                              Actual: {log.spawnedSticker ?? log.result?.spawnedSticker ?? 0} sticker / {log.spawnedNonSticker ?? log.result?.spawnedNonSticker ?? 0} non-sticker
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-[#111C2D]">
                          {(() => {
                            const splits = log.destinationSplits;
                            const lines = formatAllEntranceSplits(splits, storeState.map);
                            if (lines.length === 0) return <span className="text-[12px] text-[#6B7A99]">n/a</span>;
                            return (
                              <div className="flex flex-col space-y-0.5 max-w-[210px]">
                                {lines.map((l, i) => (
                                  <div key={i} className="text-[11px] font-mono text-[#434651] truncate" title={l}>
                                    {l}
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="py-3 px-3 font-medium text-[#111C2D]">
                          {log.throughput.toLocaleString()} veh/hr
                        </td>
                        <td className="py-3 px-3 text-[#111C2D]">{log.avgWait} s</td>
                        <td className="py-3 px-3 text-[#111C2D]">{log.avgTransit} s</td>
                        <td
                          className={`py-3 px-3 font-medium ${
                            log.maxQueue >= 15 ? 'text-[#EF4444]' : 'text-[#111C2D]'
                          }`}
                        >
                          {log.maxQueue} vehicles
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`text-[12px] px-2 py-0.5 rounded-lg font-medium ${
                              log.flowEfficiency >= 75
                                ? 'bg-[#82FAB6]/40 text-[#005230]'
                                : log.flowEfficiency >= 60
                                ? 'bg-[#FFDDB8] text-[#513100]'
                                : 'bg-[#FFDAD6] text-[#93000A]'
                            }`}
                          >
                            {log.flowEfficiency}%
                          </span>
                        </td>
                        <td className="py-3 px-3 text-[#111C2D] whitespace-nowrap">{formatEarlyDropoffs(logDrop)}</td>
                        <td className="py-3 px-3 text-[#111C2D] whitespace-nowrap">{formatDropWait(logDrop)}</td>
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
