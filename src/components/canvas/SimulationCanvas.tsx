/**
 * FlowSmart - Simulation Canvas Viewport
 * 2D top-down simulation rendered on HTML5 Canvas.
 * Supports base map architecture, roads, zone markers, vehicle rectangles rotated along paths,
 * radial heatmap overlay, view mode toggles, status badge, timer, and zoom controls.
 * Features:
 * - High-DPI canvas scaling: canvas.width = cssWidth * dpr, ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
 * - Offscreen canvas caching for static layers (grid, reference image, buildings, roads, markers)
 * - Single persistent requestAnimationFrame loop with ref-based state reads (no tearing down on state changes)
 * - Fixed-step interpolation: lerp(prevPosition, position, alpha) and shortest-angle heading interpolation
 * - Scale-true vehicles: proportional dimensions (VEHICLE_LENGTH_M / mpu, VEHICLE_WIDTH_M / mpu) with 1.5px screen outline #0F172A
 *   - Sticker vehicles: white #FFFFFF
 *   - Non-sticker vehicles: light blue #38BDF8
 *   - Darker windshield at front 25% of length
 *   - Queued: red brake-light marks at rear
 *   - Waiting at drop-off: amber outline #F59E0B
 *   - Minimum screen size: clamped so vehicles are never shorter than 6 screen pixels at any zoom
 * - Exact road styling matching Map setup: edge lines (access color/dash), solid #3B4658 asphalt,
 *   white dashed centerline for two-way, and directional chevrons for one-way roads.
 * - Updated legend showing both vehicle types and road access types.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  Minus,
  Maximize2,
  Play,
  Pause,
  Square,
  Lock,
  AlertTriangle,
  BarChart3,
  SlidersHorizontal,
} from 'lucide-react';
import { useTrafficStore } from '../../context/TrafficStoreContext';
import { useSimulation } from '../../context/SimulationContext';
import { SimVehicle } from '../../sim/types';
import { samplePolyline } from '../../utils/mapGeometry';
import {
  getMetersPerUnit,
  formatScale,
  roadWidthUnits,
  edgeLineWidthUnits,
  VEHICLE_LENGTH_M,
  VEHICLE_WIDTH_M,
} from '../../utils/scale';
import { ScaleBar } from '../common/ScaleBar';
import { SCENARIOS, detectScenario } from '../../utils/scenarios';
import { DIRECT_KEY, getEntranceSplit } from '../../utils/destinationSplit';

interface SimulationCanvasProps {
  showHeatmap: boolean;
  onToggleHeatmap: (show: boolean) => void;
}

const SPEED_OPTIONS = [0.5, 1, 2, 5] as const;

function cleanName(name: string): string {
  return name.replace(/\s*\(.*\)/, '').trim();
}

// Shortest-angle interpolation between two headings in radians
function interpolateHeading(prevRad: number, currRad: number, alpha: number): number {
  let diff = (currRad - prevRad) % (Math.PI * 2);
  if (diff < -Math.PI) diff += Math.PI * 2;
  if (diff > Math.PI) diff -= Math.PI * 2;
  return prevRad + diff * alpha;
}

// Canvas helper for rounded rectangles
function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.closePath();
}

export const SimulationCanvas: React.FC<SimulationCanvasProps> = ({
  showHeatmap,
  onToggleHeatmap,
}) => {
  const { state: storeState, setActiveTab } = useTrafficStore();
  const {
    status,
    simSpeed,
    setSimSpeed,
    startNewRun,
    pauseSimulation,
    resumeSimulation,
    stopSimulation,
    getSnapshot,
    getInterpolationAlpha,
    routeValidation,
    isMapEditedWhileRunning,
  } = useSimulation();

  const [zoom, setZoom] = useState<number>(100);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [showLegend, setShowLegend] = useState<boolean>(true);

  const isPanningRef = useRef<boolean>(false);
  const panStartRef = useRef<{ pointerX: number; pointerY: number; panX: number; panY: number }>({
    pointerX: 0,
    pointerY: 0,
    panX: 0,
    panY: 0,
  });
  const pointerIdRef = useRef<number | null>(null);

  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({
    width: storeState.map.bounds?.width ?? 1000,
    height: storeState.map.bounds?.height ?? 600,
  });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Offscreen canvas for cached static layers
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  if (!offscreenCanvasRef.current && typeof document !== 'undefined') {
    offscreenCanvasRef.current = document.createElement('canvas');
  }
  const offscreenDirtyRef = useRef<boolean>(true);

  // Layout and viewport measurement refs
  const dprRef = useRef<number>(1);
  const sizeRef = useRef<{ width: number; height: number }>({
    width: storeState.map.bounds?.width ?? 1000,
    height: storeState.map.bounds?.height ?? 600,
  });
  const panRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  panRef.current = pan;

  // Up-to-date refs for persistent rAF loop
  const zoomRef = useRef<number>(zoom);
  zoomRef.current = zoom;

  const showHeatmapRef = useRef<boolean>(showHeatmap);
  showHeatmapRef.current = showHeatmap;

  const statusRef = useRef(status);
  statusRef.current = status;

  const mapRef = useRef(storeState.map);
  mapRef.current = storeState.map;

  const getSnapshotRef = useRef(getSnapshot);
  getSnapshotRef.current = getSnapshot;

  const getInterpolationAlphaRef = useRef(getInterpolationAlpha);
  getInterpolationAlphaRef.current = getInterpolationAlpha;

  // Reference image element cache
  const referenceImageRef = useRef<HTMLImageElement | null>(null);

  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isComplete = status === 'completed';
  const isIdle = status === 'idle';

  // Fit the map cleanly inside the area between the floating panels
  const handleFit = useCallback(() => {
    const cssWidth = sizeRef.current.width;
    const cssHeight = sizeRef.current.height;
    const bounds = mapRef.current.bounds || { width: 1000, height: 600 };
    const mapWidth = bounds.width;
    const mapHeight = bounds.height;

    if (cssWidth <= 0 || cssHeight <= 0 || mapWidth <= 0 || mapHeight <= 0) {
      zoomRef.current = 100;
      panRef.current = { x: 0, y: 0 };
      offscreenDirtyRef.current = true;
      setZoom(100);
      setPan({ x: 0, y: 0 });
      return;
    }

    const baseScale = Math.min(cssWidth / mapWidth, cssHeight / mapHeight);
    if (baseScale <= 0) return;

    // Safe inner viewport between top-left card, top-right card (290px), bottom-left legend, and bottom controls
    const leftPad = cssWidth >= 1040 ? 290 : cssWidth >= 780 ? 220 : 16;
    const rightPad = cssWidth >= 1040 ? 316 : cssWidth >= 780 ? 304 : 16;
    const topPad = cssWidth >= 780 ? 24 : 190;
    const bottomPad = 84;

    const availW = Math.max(120, cssWidth - leftPad - rightPad);
    const availH = Math.max(120, cssHeight - topPad - bottomPad);

    const markers = mapRef.current.zoneMarkers || [];
    let minX = 0;
    let minY = 0;
    let maxX = mapWidth;
    let maxY = mapHeight;
    for (const m of markers) {
      minX = Math.min(minX, m.position.x - 40);
      minY = Math.min(minY, m.position.y - 24);
      maxX = Math.max(maxX, m.position.x + 40);
      maxY = Math.max(maxY, m.position.y + 24);
    }

    const contentW = Math.max(1, maxX - minX);
    const contentH = Math.max(1, maxY - minY);
    const targetScale = Math.min(availW / contentW, availH / contentH);
    const targetZoom = Math.max(25, Math.min(400, (targetScale / baseScale) * 100));
    const actualScale = baseScale * (targetZoom / 100);

    const contentCenterX = (minX + maxX) / 2;
    const contentCenterY = (minY + maxY) / 2;
    const safeCenterX = leftPad + availW / 2;
    const safeCenterY = topPad + availH / 2;

    const nextPan = {
      x: safeCenterX - (cssWidth - mapWidth * actualScale) / 2 - contentCenterX * actualScale,
      y: safeCenterY - (cssHeight - mapHeight * actualScale) / 2 - contentCenterY * actualScale,
    };

    zoomRef.current = targetZoom;
    panRef.current = nextPan;
    offscreenDirtyRef.current = true;
    setZoom(targetZoom);
    setPan(nextPan);
  }, []);

  // Re-fit when map bounds change
  const prevBoundsRef = useRef<{ width: number; height: number } | null>(null);
  const hasInitialFittedRef = useRef<boolean>(false);
  useEffect(() => {
    const currentBounds = storeState.map.bounds;
    if (!currentBounds) return;
    if (
      prevBoundsRef.current &&
      (prevBoundsRef.current.width !== currentBounds.width ||
        prevBoundsRef.current.height !== currentBounds.height)
    ) {
      prevBoundsRef.current = { width: currentBounds.width, height: currentBounds.height };
      handleFit();
    } else if (!prevBoundsRef.current) {
      prevBoundsRef.current = { width: currentBounds.width, height: currentBounds.height };
    }
  }, [storeState.map.bounds, handleFit]);

  const panRafIdRef = useRef<number | null>(null);

  // Zoom around canvas center for +/- buttons
  const zoomAroundCenter = useCallback((factor: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width;
    const cssHeight = rect.height;
    if (cssWidth <= 0 || cssHeight <= 0) return;
    const bounds = mapRef.current.bounds || { width: 1000, height: 600 };
    const baseScale = Math.min(cssWidth / bounds.width, cssHeight / bounds.height);
    if (baseScale <= 0) return;

    const currentZoom = zoomRef.current;
    const currentPan = panRef.current;
    const newZoom = Math.max(25, Math.min(400, currentZoom * factor));
    if (newZoom === currentZoom) return;

    const cursorX = cssWidth / 2;
    const cursorY = cssHeight / 2;

    const currentScale = baseScale * (currentZoom / 100);
    const newScale = baseScale * (newZoom / 100);

    const currentOffsetX = (cssWidth - bounds.width * currentScale) / 2 + currentPan.x;
    const currentOffsetY = (cssHeight - bounds.height * currentScale) / 2 + currentPan.y;

    const worldX = (cursorX - currentOffsetX) / currentScale;
    const worldY = (cursorY - currentOffsetY) / currentScale;

    const newPanX = cursorX - (cssWidth - bounds.width * newScale) / 2 - worldX * newScale;
    const newPanY = cursorY - (cssHeight - bounds.height * newScale) / 2 - worldY * newScale;

    const nextPan = { x: newPanX, y: newPanY };
    zoomRef.current = newZoom;
    panRef.current = nextPan;
    offscreenDirtyRef.current = true;

    setZoom(newZoom);
    setPan(nextPan);
  }, []);

  const handleZoomIn = () => zoomAroundCenter(1.1);
  const handleZoomOut = () => zoomAroundCenter(1 / 1.1);

  // Wheel zoom around cursor with non-passive listener and preventDefault
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const cssWidth = rect.width;
      const cssHeight = rect.height;
      if (cssWidth <= 0 || cssHeight <= 0) return;

      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      const currentZoom = zoomRef.current;
      const currentPan = panRef.current;
      const bounds = mapRef.current.bounds || { width: 1000, height: 600 };

      const baseScale = Math.min(cssWidth / bounds.width, cssHeight / bounds.height);
      if (baseScale <= 0) return;

      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newZoom = Math.max(25, Math.min(400, currentZoom * factor));
      if (newZoom === currentZoom) return;

      const currentScale = baseScale * (currentZoom / 100);
      const newScale = baseScale * (newZoom / 100);

      const currentOffsetX = (cssWidth - bounds.width * currentScale) / 2 + currentPan.x;
      const currentOffsetY = (cssHeight - bounds.height * currentScale) / 2 + currentPan.y;

      const worldX = (cursorX - currentOffsetX) / currentScale;
      const worldY = (cursorY - currentOffsetY) / currentScale;

      const newPanX = cursorX - (cssWidth - bounds.width * newScale) / 2 - worldX * newScale;
      const newPanY = cursorY - (cssHeight - bounds.height * newScale) / 2 - worldY * newScale;

      const nextPan = { x: newPanX, y: newPanY };
      zoomRef.current = newZoom;
      panRef.current = nextPan;
      offscreenDirtyRef.current = true;

      setZoom(newZoom);
      setPan(nextPan);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Prevent browser autoscroll on middle button
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const preventMiddle = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
      }
    };

    container.addEventListener('mousedown', preventMiddle);
    container.addEventListener('auxclick', preventMiddle);
    return () => {
      container.removeEventListener('mousedown', preventMiddle);
      container.removeEventListener('auxclick', preventMiddle);
    };
  }, []);

  // Window blur resets panning safely
  useEffect(() => {
    const handleBlur = () => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        setIsPanning(false);
        pointerIdRef.current = null;
      }
    };
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('blur', handleBlur);
      if (panRafIdRef.current) {
        cancelAnimationFrame(panRafIdRef.current);
      }
    };
  }, []);

  // Pan handlers on canvas
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const isMiddle = e.button === 1;
    const isLeft = e.button === 0;
    const isShiftLeft = isLeft && e.shiftKey;

    if (isMiddle || isLeft || isShiftLeft) {
      e.preventDefault();
      setIsPanning(true);
      isPanningRef.current = true;
      panStartRef.current = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        panX: panRef.current.x,
        panY: panRef.current.y,
      };

      try {
        e.currentTarget.setPointerCapture(e.pointerId);
        pointerIdRef.current = e.pointerId;
      } catch {
        // Fallback
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPanningRef.current) {
      const dx = e.clientX - panStartRef.current.pointerX;
      const dy = e.clientY - panStartRef.current.pointerY;
      const nextPan = {
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      };
      panRef.current = nextPan;
      offscreenDirtyRef.current = true;

      if (!panRafIdRef.current) {
        panRafIdRef.current = requestAnimationFrame(() => {
          panRafIdRef.current = null;
          setPan(panRef.current);
        });
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      setIsPanning(false);

      if (panRafIdRef.current) {
        cancelAnimationFrame(panRafIdRef.current);
        panRafIdRef.current = null;
      }
      setPan(panRef.current);

      if (pointerIdRef.current !== null) {
        try {
          e.currentTarget.releasePointerCapture(pointerIdRef.current);
        } catch {
          // ignore
        }
        pointerIdRef.current = null;
      }
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    handlePointerUp(e);
  };

  // Single scale field (PRD 3.1.9)
  const metersPerUnit = getMetersPerUnit(storeState.map, storeState.settings);
  const mapBounds = storeState.map.bounds || { width: 1000, height: 600 };
  const baseScale = Math.min(canvasSize.width / mapBounds.width, canvasSize.height / mapBounds.height);
  const currentFinalScale = (baseScale > 0 ? baseScale : 1) * (zoom / 100);
  const hasReferenceImage = Boolean(storeState.map.referenceImageName || storeState.referenceImageUrl);
  const GRID_CELL_PX = 20;
  const currentCellMeters = Math.round(metersPerUnit * GRID_CELL_PX * 10) / 10;

  // Scenario summary & pre-run checks (matching SettingsView)
  const entrances = useMemo(
    () => (storeState.map.zoneMarkers || []).filter((m) => m.type === 'entrance'),
    [storeState.map.zoneMarkers]
  );
  const dropoffs = useMemo(
    () => (storeState.map.zoneMarkers || []).filter((m) => m.type === 'dropoff'),
    [storeState.map.zoneMarkers]
  );
  const activeScenarioId =
    storeState.settings.scenarioId ?? detectScenario(storeState.settings, entrances);
  const activeScenarioName = useMemo(() => {
    if (activeScenarioId === 'custom') return 'Custom';
    return SCENARIOS.find((s) => s.id === activeScenarioId)?.name ?? 'Custom';
  }, [activeScenarioId]);
  const stickerPct = Math.min(
    100,
    Math.max(0, Math.round((storeState.settings.stickerShare ?? 0.7) * 100))
  );
  const allSplitsOk = useMemo(() => {
    return entrances.every((ent) => {
      const split = getEntranceSplit(storeState.settings, storeState.map, ent.id);
      let sum = split[DIRECT_KEY] ?? 0;
      for (const d of dropoffs) {
        sum += split[d.id] ?? 0;
      }
      return Math.abs(Math.round(sum * 10) / 10 - 100) < 0.1;
    });
  }, [entrances, dropoffs, storeState.settings, storeState.map]);
  const hasAnyCars = useMemo(() => {
    return entrances.some((ent) => (storeState.settings.spawnRates?.[ent.id] ?? 0) > 0);
  }, [entrances, storeState.settings.spawnRates]);
  const canStart = allSplitsOk && hasAnyCars && routeValidation.isValid;
  const disabledReason = useMemo(() => {
    if (!allSplitsOk) {
      return 'Fix destination splits in Settings so every gate adds up to 100%.';
    }
    if (!hasAnyCars) {
      return 'Raise at least one gate above 0 cars/min in Settings.';
    }
    if (!routeValidation.isValid) {
      return routeValidation.errorMessage || 'One or more gates cannot reach a destination.';
    }
    return '';
  }, [allSplitsOk, hasAnyCars, routeValidation]);

  const handleIdleStartClick = () => {
    if (!canStart) return;
    startNewRun();
  };

  // Load reference image when URL changes
  useEffect(() => {
    if (!storeState.referenceImageUrl) {
      referenceImageRef.current = null;
      offscreenDirtyRef.current = true;
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = storeState.referenceImageUrl;
    img.onload = () => {
      referenceImageRef.current = img;
      offscreenDirtyRef.current = true;
    };
    img.onerror = () => {
      referenceImageRef.current = null;
      offscreenDirtyRef.current = true;
    };
  }, [storeState.referenceImageUrl]);

  // Mark offscreen dirty on map, zoom, or pan change
  useEffect(() => {
    offscreenDirtyRef.current = true;
  }, [storeState.map, zoom, pan]);

  // Redraw static layers into the offscreen canvas (grid, reference image/buildings, roads, markers)
  const redrawStaticLayer = useCallback(() => {
    const offscreen = offscreenCanvasRef.current;
    if (!offscreen) return;

    const { width: cssWidth, height: cssHeight } = sizeRef.current;
    if (cssWidth <= 0 || cssHeight <= 0) return;
    const dpr = dprRef.current;

    const targetW = Math.round(cssWidth * dpr);
    const targetH = Math.round(cssHeight * dpr);
    if (offscreen.width !== targetW || offscreen.height !== targetH) {
      offscreen.width = targetW;
      offscreen.height = targetH;
    }

    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    ctx.save();

    // Center and apply zoom
    const bounds = mapRef.current.bounds || { width: 1000, height: 600 };
    const mapWidth = bounds.width;
    const mapHeight = bounds.height;
    const baseScale = Math.min(cssWidth / mapWidth, cssHeight / mapHeight);
    const finalScale = baseScale * (zoomRef.current / 100);

    const offsetX = (cssWidth - mapWidth * finalScale) / 2 + panRef.current.x;
    const offsetY = (cssHeight - mapHeight * finalScale) / 2 + panRef.current.y;

    ctx.translate(offsetX, offsetY);
    ctx.scale(finalScale, finalScale);

    // 1. Draw CAD floor grid (20px, labeled with scale)
    ctx.strokeStyle = 'rgba(226, 230, 239, 0.7)';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    for (let x = 0; x <= mapWidth; x += GRID_CELL_PX) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, mapHeight);
    }
    for (let y = 0; y <= mapHeight; y += GRID_CELL_PX) {
      ctx.moveTo(0, y);
      ctx.lineTo(mapWidth, y);
    }
    ctx.stroke();

    // Grid unit label
    ctx.fillStyle = '#94A3B8';
    ctx.font = '500 12px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`1 cell = ${currentCellMeters} m`, 8, 8);

    // 2. Reference image (optional)
    if (referenceImageRef.current) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.drawImage(referenceImageRef.current, 0, 0, mapWidth, mapHeight);
      ctx.restore();
    }

    // 3. Roads Network Layer (exact visual styling from Map setup)
    // 3. Roads Network Layer (exact visual styling from Map setup)
    const roads = mapRef.current.roadSegments || [];
    const currentMpu = getMetersPerUnit(mapRef.current);
    roads.forEach((seg) => {
      if (seg.points.length < 2) return;

      const asphaltWidth = roadWidthUnits(seg.lanes || 1, currentMpu);
      const edgeLineWidth = edgeLineWidthUnits(asphaltWidth, currentMpu);

      const isSticker = seg.accessType === 'sticker-only';
      const isNonSticker = seg.accessType === 'non-sticker-only';
      const edgeStrokeColor = isSticker ? '#2563EB' : isNonSticker ? '#D97706' : '#FFFFFF';
      const edgeDashPattern = isSticker ? [14, 7] : isNonSticker ? [3, 5] : [];

      // Step 1: Edge lines in access color/style (solid white, blue long dash, orange dotted)
      ctx.save();
      ctx.strokeStyle = edgeStrokeColor;
      ctx.lineWidth = edgeLineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash(edgeDashPattern);
      ctx.beginPath();
      seg.points.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
      ctx.restore();

      // Step 2: Asphalt - solid path in #3B4658, round caps, never dashed
      ctx.save();
      ctx.strokeStyle = '#3B4658';
      ctx.lineWidth = asphaltWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);
      ctx.beginPath();
      seg.points.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
      ctx.restore();

      // Step 3: Two-way roads have white dashed center line (stroke 1.5, dash 8 6)
      const isOneWay = seg.flowDirection === 'one-way';
      if (!isOneWay) {
        ctx.save();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = Math.max(1, asphaltWidth * 0.1);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        seg.points.forEach((pt, idx) => {
          if (idx === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();
        ctx.restore();
      }

      // Step 4: One-way roads have small white chevrons every 40 units along path
      if (isOneWay) {
        const chevrons = samplePolyline(seg.points, 40);
        const arrowSpan = asphaltWidth * 0.25;
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = Math.max(1, asphaltWidth * 0.1);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        chevrons.forEach((ch) => {
          const rad = (ch.heading * Math.PI) / 180;
          ctx.save();
          ctx.translate(ch.point.x, ch.point.y);
          ctx.rotate(rad);
          ctx.beginPath();
          ctx.moveTo(-arrowSpan, -arrowSpan);
          ctx.lineTo(arrowSpan * 0.5, 0);
          ctx.lineTo(-arrowSpan, arrowSpan);
          ctx.stroke();
          ctx.restore();
        });
        ctx.restore();
      }
    });

    // 4. Zone Markers layer (distinct icons + text labels, fixed screen size)
    const markers = mapRef.current.zoneMarkers || [];
    markers.forEach((m) => {
      let bg = '#254B98'; // Entrance
      if (m.type === 'exit') bg = '#25A76B';
      else if (m.type === 'dropoff') bg = '#F59E0B';

      const tagText = m.name;
      ctx.save();
      ctx.translate(m.position.x, m.position.y);
      if (finalScale > 0) {
        ctx.scale(1 / finalScale, 1 / finalScale);
      }

      ctx.font = '600 12px Inter, system-ui, sans-serif';
      const textW = ctx.measureText(tagText).width;
      const bw = Math.max(textW + 36, 88);
      const bh = 24;
      const bx = -bw / 2;
      const by = -bh / 2;

      // Badge background (crisp white with colored border)
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = bg;
      ctx.lineWidth = 1.5;
      drawRoundRect(ctx, bx, by, bw, bh, 5);
      ctx.fill();
      ctx.stroke();

      // Left icon container badge
      const icBoxSize = 20;
      const icX = bx + 2;
      const icY = by + 2;
      ctx.fillStyle = bg;
      drawRoundRect(ctx, icX, icY, icBoxSize, icBoxSize, 3.5);
      ctx.fill();

      // Distinct vector icon inside (white on colored box)
      const cx = icX + 10;
      const cy = icY + 10;

      if (m.type === 'entrance') {
        // Arrow-in icon in blue #254B98
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        // Portal bracket
        ctx.moveTo(cx + 2, cy - 5);
        ctx.lineTo(cx + 5, cy - 5);
        ctx.lineTo(cx + 5, cy + 5);
        ctx.lineTo(cx + 2, cy + 5);
        // Arrow pointing in
        ctx.moveTo(cx - 5, cy);
        ctx.lineTo(cx + 2, cy);
        ctx.moveTo(cx - 1, cy - 3);
        ctx.lineTo(cx + 2, cy);
        ctx.lineTo(cx - 1, cy + 3);
        ctx.stroke();
      } else if (m.type === 'exit') {
        // Arrow-out icon in green #25A76B
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        // Portal bracket
        ctx.moveTo(cx - 2, cy - 5);
        ctx.lineTo(cx - 5, cy - 5);
        ctx.lineTo(cx - 5, cy + 5);
        ctx.lineTo(cx - 2, cy + 5);
        // Arrow pointing out
        ctx.moveTo(cx - 2, cy);
        ctx.lineTo(cx + 5, cy);
        ctx.moveTo(cx + 2, cy - 3);
        ctx.lineTo(cx + 5, cy);
        ctx.lineTo(cx + 2, cy + 3);
        ctx.stroke();
      } else {
        // Car-and-person icon (Drop-off in amber #F59E0B)
        // Person head
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(cx - 4, cy - 3.5, 1.5, 0, Math.PI * 2);
        ctx.fill();

        // Person torso
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - 6, cy + 4.5);
        ctx.lineTo(cx - 6, cy + 3);
        ctx.arc(cx - 4, cy + 3, 2, Math.PI, 0);
        ctx.lineTo(cx - 2, cy + 4.5);
        ctx.stroke();

        // Car chassis & roof
        ctx.lineWidth = 1.3;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - 0.5, cy + 1);
        ctx.lineTo(cx + 1, cy - 1.5);
        ctx.lineTo(cx + 4.5, cy - 1.5);
        ctx.lineTo(cx + 6, cy + 1);
        ctx.lineTo(cx + 6, cy + 3.5);
        ctx.lineTo(cx - 0.5, cy + 3.5);
        ctx.closePath();
        ctx.stroke();

        // Wheels
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(cx + 1.2, cy + 4.5, 0.9, 0, Math.PI * 2);
        ctx.arc(cx + 4.5, cy + 4.5, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }

      // Visible text label
      ctx.fillStyle = '#111C2D';
      ctx.font = '600 12px Inter, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(tagText, bx + 26, by + 12.5);

      ctx.restore();
    });

    ctx.restore();
  }, [currentCellMeters]);

  // Main canvas animation frame render
  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width: cssWidth, height: cssHeight } = sizeRef.current;
    if (cssWidth <= 0 || cssHeight <= 0) return;
    const dpr = dprRef.current;

    // Ensure physical canvas resolution matches css * dpr
    const targetW = Math.round(cssWidth * dpr);
    const targetH = Math.round(cssHeight * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      offscreenDirtyRef.current = true;
    }

    // Refresh offscreen static layer if dirty
    if (offscreenDirtyRef.current) {
      redrawStaticLayer();
      offscreenDirtyRef.current = false;
    }

    // Setup high-DPI scaling
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    // 1. Draw cached static layers (grid, buildings/image, roads, markers)
    const offscreen = offscreenCanvasRef.current;
    if (offscreen && offscreen.width > 0 && offscreen.height > 0) {
      ctx.drawImage(offscreen, 0, 0, cssWidth, cssHeight);
    }

    // Dynamic layer transform (world space bounds)
    const bounds = mapRef.current.bounds || { width: 1000, height: 600 };
    const mapWidth = bounds.width;
    const mapHeight = bounds.height;
    const baseScale = Math.min(cssWidth / mapWidth, cssHeight / mapHeight);
    const finalScale = baseScale * (zoomRef.current / 100);

    const offsetX = (cssWidth - mapWidth * finalScale) / 2 + panRef.current.x;
    const offsetY = (cssHeight - mapHeight * finalScale) / 2 + panRef.current.y;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(finalScale, finalScale);

    const snapshot = getSnapshotRef.current ? getSnapshotRef.current() : null;
    const currentStatus = statusRef.current;

    // 2. Heatmap overlay (when enabled)
    if (
      showHeatmapRef.current &&
      (currentStatus === 'running' || currentStatus === 'paused' || currentStatus === 'completed')
    ) {
      ctx.save();
      ctx.globalAlpha = 0.85;

      const roads = mapRef.current.roadSegments || [];
      const currentMpu = getMetersPerUnit(mapRef.current);
      roads.forEach((seg) => {
        const occ = snapshot?.segmentOccupancies[seg.id];
        const utilPct = occ ? occ.utilizationPct : currentStatus === 'completed' ? 75 : 0;
        if (utilPct < 10) return;

        const midPoint = seg.points[Math.floor(seg.points.length / 2)];
        if (!midPoint) return;

        const asphaltWidth = roadWidthUnits(seg.lanes || 1, currentMpu);
        const baseGlow = asphaltWidth * 2.5;
        const radius = Math.min(baseGlow + utilPct * 0.5, baseGlow * 2.5);
        const grad = ctx.createRadialGradient(
          midPoint.x,
          midPoint.y,
          0,
          midPoint.x,
          midPoint.y,
          radius
        );

        if (utilPct >= 80) {
          grad.addColorStop(0, 'rgba(239, 68, 68, 0.85)');
          grad.addColorStop(0.5, 'rgba(239, 68, 68, 0.45)');
          grad.addColorStop(0.8, 'rgba(245, 158, 11, 0.2)');
          grad.addColorStop(1, 'rgba(245, 158, 11, 0)');
        } else if (utilPct >= 60) {
          grad.addColorStop(0, 'rgba(245, 158, 11, 0.7)');
          grad.addColorStop(0.6, 'rgba(245, 158, 11, 0.25)');
          grad.addColorStop(1, 'rgba(37, 167, 107, 0)');
        } else {
          grad.addColorStop(0, 'rgba(37, 167, 107, 0.5)');
          grad.addColorStop(1, 'rgba(37, 167, 107, 0)');
        }

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(midPoint.x, midPoint.y, radius, 0, Math.PI * 2);
        ctx.fill();

        // Exclamation mark for critical bottlenecks (> 80%)
        if (utilPct >= 80) {
          ctx.fillStyle = '#EF4444';
          ctx.beginPath();
          ctx.arc(midPoint.x, midPoint.y, 13, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.fillStyle = '#FFFFFF';
          ctx.font = '700 13px Inter, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('!', midPoint.x, midPoint.y);
        }
      });

      ctx.restore();
    }

    // 3. Vehicles layer with fixed-step interpolation
    const vehicles: SimVehicle[] = snapshot ? snapshot.vehicles : [];
    if (vehicles.length > 0) {
      const alpha = getInterpolationAlphaRef.current ? getInterpolationAlphaRef.current() : 1;
      const currentMpu = getMetersPerUnit(mapRef.current);

      const length = VEHICLE_LENGTH_M / currentMpu;
      const width = VEHICLE_WIDTH_M / currentMpu;
      const cornerRadius = width * 0.25;

      // Keep a floor so that a car never draws shorter than 6 screen pixels long
      const minScreenPx = 6;
      const baseLengthScreenPx = length * finalScale;
      const minScale = baseLengthScreenPx < minScreenPx ? minScreenPx / baseLengthScreenPx : 1;

      // The outline stays 1.5 screen pixels at any zoom
      const effectiveScale = finalScale * (minScale > 1 ? minScale : 1);
      const outlineWidth = 1.5 / effectiveScale;

      const wsLength = length * 0.25;
      const wsWidth = width * 0.65;
      const wsX = length * 0.5 - wsLength - length * 0.04;

      const blLength = length * 0.09;
      const blWidth = width * 0.25;
      const blX = -length / 2;

      vehicles.forEach((v) => {
        ctx.save();

        // Interpolate position between prevPosition and current position
        const px = v.prevPosition ? v.prevPosition.x : v.position.x;
        const py = v.prevPosition ? v.prevPosition.y : v.position.y;
        const interpX = px + (v.position.x - px) * alpha;
        const interpY = py + (v.position.y - py) * alpha;

        // Interpolate heading along shortest angle
        const prevH = v.prevHeadingRad !== undefined ? v.prevHeadingRad : v.headingRad;
        const interpHeading = interpolateHeading(prevH, v.headingRad, alpha);

        ctx.translate(interpX, interpY);
        ctx.rotate(interpHeading);
        if (minScale > 1) {
          ctx.scale(minScale, minScale);
        }

        // Vehicle body: proportional rounded rectangle
        // Sticker vehicles: white #FFFFFF; Non-sticker: light blue #38BDF8
        const bodyColor = v.isSticker ? '#FFFFFF' : '#38BDF8';
        ctx.fillStyle = bodyColor;
        drawRoundRect(ctx, -length / 2, -width / 2, length, width, cornerRadius);
        ctx.fill();

        // 1.5 screen pixel outline: dark #0F172A; Waiting at drop-off: amber outline #F59E0B
        const outlineColor = v.state === 'waiting' ? '#F59E0B' : '#0F172A';
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = outlineWidth;
        drawRoundRect(ctx, -length / 2, -width / 2, length, width, cornerRadius);
        ctx.stroke();

        // Windshield as the front 25% of the length
        ctx.fillStyle = '#0F172A';
        drawRoundRect(ctx, wsX, -wsWidth / 2, wsLength, wsWidth, Math.min(cornerRadius * 0.4, 1));
        ctx.fill();

        // Brake lights as two small marks at the rear, all proportional
        if (v.state === 'queued') {
          ctx.fillStyle = '#EF4444';
          ctx.fillRect(blX, -width / 2 + width * 0.08, blLength, blWidth);
          ctx.fillRect(blX, width / 2 - width * 0.08 - blWidth, blLength, blWidth);
        }

        ctx.restore();
      });
    }

    ctx.restore();
  }, [redrawStaticLayer]);

  // Handle ResizeObserver and window resize
  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const cssW = Math.floor(rect.width);
      const cssH = Math.floor(rect.height);
      if (cssW <= 0 || cssH <= 0) return;

      const dpr = window.devicePixelRatio || 1;
      dprRef.current = dpr;
      sizeRef.current = { width: cssW, height: cssH };
      setCanvasSize({ width: cssW, height: cssH });

      if (canvasRef.current) {
        canvasRef.current.width = Math.round(cssW * dpr);
        canvasRef.current.height = Math.round(cssH * dpr);
        canvasRef.current.style.width = `${cssW}px`;
        canvasRef.current.style.height = `${cssH}px`;
      }
      offscreenDirtyRef.current = true;

      if (!hasInitialFittedRef.current) {
        hasInitialFittedRef.current = true;
        handleFit();
      }
    };

    handleResize();
    const observer = new ResizeObserver(handleResize);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    window.addEventListener('resize', handleResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [handleFit]);

  // Single persistent requestAnimationFrame loop (reads changing values from refs, never torn down)
  useEffect(() => {
    let animId: number;
    const loop = () => {
      renderFrame();
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [renderFrame]);

  return (
    <section
      ref={containerRef}
      className="w-full h-full bg-[#EBF0F5] relative overflow-hidden select-none"
    >
      {/* HTML5 Canvas element filling the full workspace */}
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        style={{ touchAction: 'none' }}
        className={`w-full h-full block ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
      />

      {/* Floating Top-Left Card: Scenario summary, locked notice, Heatmap toggle */}
      <div className="absolute top-3 left-3 z-30 w-[264px] bg-white/95 backdrop-blur border border-[#E2E6EF] rounded-[12px] shadow-md p-3.5 flex flex-col gap-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-[#111C2D] truncate">
              {activeScenarioName}
            </div>
            <div className="text-[12px] text-[#6B7A99]">
              {stickerPct}% sticker · {storeState.settings.simDurationMin || 30} min
            </div>
          </div>
        </div>

        {/* Gate arrival rates */}
        {entrances.length > 0 && (
          <div className="pt-2 border-t border-[#E2E6EF] flex flex-col gap-1">
            {entrances.map((ent) => {
              const rate = storeState.settings.spawnRates?.[ent.id] ?? 0;
              return (
                <div
                  key={ent.id}
                  className="flex items-center justify-between gap-2 text-[12px]"
                >
                  <span className="text-[#6B7A99] truncate">{cleanName(ent.name)}</span>
                  <span className="font-medium text-[#111C2D] tabular-nums shrink-0">
                    {rate} {rate === 1 ? 'car/min' : 'cars/min'}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Settings locked while running */}
        {(isRunning || isPaused) && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#F5F6F8] border border-[#E2E6EF] text-[12px] text-[#6B7A99]">
            <Lock size={13} className="text-[#254B98] shrink-0" />
            <span>Settings locked while running</span>
          </div>
        )}

        {/* Layout edited mid-run notice */}
        {isMapEditedWhileRunning && (isRunning || isPaused) && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/40 text-[12px] text-[#B45309]">
            <AlertTriangle size={13} className="text-[#F59E0B] shrink-0" />
            <span>Layout edited. Changes apply to the next run.</span>
          </div>
        )}

        {/* Heatmap toggle */}
        <div className="pt-2 border-t border-[#E2E6EF] flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-[#111C2D]">Heatmap</span>
          <button
            type="button"
            role="switch"
            aria-checked={showHeatmap}
            onClick={() => onToggleHeatmap(!showHeatmap)}
            aria-label="Toggle heatmap"
            className={`min-h-[36px] px-2.5 rounded-lg flex items-center gap-2 cursor-pointer transition-colors hover:bg-[#F5F6F8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] ${
              showHeatmap ? 'text-[#254B98]' : 'text-[#6B7A99]'
            }`}
          >
            <span className="text-[12px] font-medium">
              {showHeatmap ? 'On' : 'Off'}
            </span>
            <span
              className={`w-8 h-4.5 rounded-full p-0.5 flex items-center transition-colors ${
                showHeatmap ? 'bg-[#254B98] justify-end' : 'bg-[#CBD5E1] justify-start'
              }`}
            >
              <span className="w-3.5 h-3.5 bg-white rounded-full block shadow-xs" />
            </span>
          </button>
        </div>
      </div>

      {/* Bottom-Left: Scale Bar, Hide/Show legend button, and 3-row Legend (max 380px) */}
      <div className="absolute bottom-3 left-3 z-30 flex flex-col items-start gap-2.5 pointer-events-none max-w-[380px]">
        <div className="pointer-events-auto flex items-center gap-2">
          <ScaleBar metersPerUnit={metersPerUnit} screenPixelsPerUnit={currentFinalScale} />
          <button
            type="button"
            onClick={() => setShowLegend((prev) => !prev)}
            className="h-9 px-3 rounded-lg bg-white/95 backdrop-blur border border-[#E2E6EF] text-[12px] font-medium text-[#111C2D] hover:bg-[#F5F6F8] shadow-sm cursor-pointer transition-colors"
          >
            {showLegend ? 'Hide legend' : 'Show legend'}
          </button>
        </div>

        {showLegend && (
          <div className="pointer-events-auto w-full max-w-[380px] bg-white/95 backdrop-blur px-3.5 py-2.5 rounded-[12px] border border-[#E2E6EF] flex flex-col gap-2 shadow-sm">
            {/* Vehicles Legend */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[12px] text-[#6B7A99] font-medium">Vehicles:</span>
              <div className="flex items-center gap-1.5">
                <span className="w-3.5 h-2 rounded-[2px] bg-white border border-[#0F172A] inline-block shrink-0" />
                <span className="text-[12px] text-[#111C2D]">Sticker holder (white)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3.5 h-2 rounded-[2px] bg-[#38BDF8] border border-[#0F172A] inline-block shrink-0" />
                <span className="text-[12px] text-[#111C2D]">Visitor (blue)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3.5 h-2 rounded-[2px] bg-white border border-[#F59E0B] inline-block shrink-0" />
                <span className="text-[12px] text-[#111C2D]">Drop-off (amber)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3.5 h-2 rounded-[2px] bg-white border border-[#0F172A] relative inline-block overflow-hidden shrink-0">
                  <span className="absolute left-0 top-0 bottom-0 w-[2.5px] bg-[#EF4444]" />
                </span>
                <span className="text-[12px] text-[#111C2D]">Queued</span>
              </div>
            </div>

            {/* Road access types line style legend */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1.5 border-t border-[#E2E6EF]/70">
              <span className="text-[12px] text-[#6B7A99] font-medium">Roads:</span>
              <div className="flex items-center gap-1.5">
                <span className="w-4 h-1.5 rounded-xs bg-[#3B4658] border border-white shrink-0" />
                <span className="text-[12px] text-[#111C2D]">Shared</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-4 h-1.5 rounded-xs bg-[#3B4658] border border-dashed border-[#2563EB] shrink-0" />
                <span className="text-[12px] text-[#111C2D]">Sticker-only</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-4 h-1.5 rounded-xs bg-[#3B4658] border border-dotted border-[#D97706] shrink-0" />
                <span className="text-[12px] text-[#111C2D]">Non-sticker</span>
              </div>
              <div className="flex items-center gap-1.5">
                <svg width="18" height="6" className="shrink-0 overflow-visible">
                  <path
                    d="M 3 0 L 7.5 3 L 3 6"
                    fill="none"
                    stroke="#6B7A99"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M 10 0 L 14.5 3 L 10 6"
                    fill="none"
                    stroke="#6B7A99"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="text-[12px] text-[#111C2D]">One-way</span>
              </div>
            </div>

            {/* Heatmap (road usage) Legend */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1.5 border-t border-[#E2E6EF]/70">
              <span className="text-[12px] text-[#6B7A99] font-medium">
                Heatmap (road usage):
              </span>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-xs bg-[#25A76B] shrink-0" />
                <span className="text-[12px] text-[#111C2D]">Under 60% of capacity</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-xs bg-[#F59E0B] shrink-0" />
                <span className="text-[12px] text-[#111C2D]">60 to 80%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-xs bg-[#EF4444] shrink-0" />
                <span className="text-[12px] text-[#111C2D]">Over 80%</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating Bottom-Centre Control Bar */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2 pointer-events-none">
        {isIdle && !canStart && disabledReason && (
          <div className="pointer-events-auto px-3 py-1.5 rounded-lg bg-white/95 backdrop-blur border border-[#EF4444]/40 text-[#EF4444] text-[12px] font-medium shadow-sm flex items-center gap-1.5 max-w-[440px]">
            <AlertTriangle size={14} className="shrink-0" />
            <span>{disabledReason}</span>
          </div>
        )}

        <div className="pointer-events-auto flex items-center gap-2 bg-white/95 backdrop-blur border border-[#E2E6EF] rounded-[12px] p-1.5 shadow-md">
          {isIdle && (
            <>
              <button
                type="button"
                disabled={!canStart}
                onClick={handleIdleStartClick}
                title={canStart ? 'Start simulation' : disabledReason}
                className={`h-9 px-4 rounded-lg text-[13px] font-semibold flex items-center gap-2 transition-all ${
                  canStart
                    ? 'bg-[#25A76B] hover:bg-[#1f8c59] active:scale-98 text-white cursor-pointer'
                    : 'bg-[#E2E6EF] text-[#6B7A99] cursor-not-allowed'
                } focus:outline-none focus-visible:ring-2 focus-visible:ring-[#25A76B] focus-visible:ring-offset-1`}
              >
                <Play size={14} className="fill-current shrink-0" />
                <span>Start simulation</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className="h-9 px-3.5 rounded-lg border border-[#E2E6EF] bg-white hover:bg-[#F5F6F8] text-[13px] font-medium text-[#111C2D] flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <SlidersHorizontal size={14} className="text-[#6B7A99]" />
                <span>Change settings</span>
              </button>
            </>
          )}

          {(isRunning || isPaused) && (
            <>
              <button
                type="button"
                onClick={isRunning ? pauseSimulation : resumeSimulation}
                title={isRunning ? 'Pause (Space)' : 'Resume (Space)'}
                className="h-9 px-3.5 rounded-lg bg-[#E7EEFF] hover:bg-[#dce6ff] text-[#254B98] text-[13px] font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                {isRunning ? (
                  <>
                    <Pause size={14} className="fill-current shrink-0" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play size={14} className="fill-current shrink-0" />
                    <span>Resume</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={stopSimulation}
                title="Stop simulation"
                className="h-9 px-3 rounded-lg border border-[#E2E6EF] bg-white hover:bg-[#F5F6F8] text-[#111C2D] text-[13px] font-medium flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <Square size={13} className="fill-current shrink-0" />
                <span>Stop</span>
              </button>

              <div className="h-5 w-[1px] bg-[#E2E6EF]" />

              <div
                className="flex items-center gap-1"
                role="group"
                aria-label="Simulation speed"
              >
                {SPEED_OPTIONS.map((spd) => {
                  const active = Math.abs(simSpeed - spd) < 0.01;
                  return (
                    <button
                      key={spd}
                      type="button"
                      onClick={() => setSimSpeed(spd)}
                      aria-pressed={active}
                      className={`h-9 px-2.5 rounded-lg text-[12px] font-semibold tabular-nums cursor-pointer transition-colors ${
                        active
                          ? 'bg-[#254B98] text-white'
                          : 'text-[#6B7A99] hover:text-[#111C2D] hover:bg-[#F5F6F8]'
                      }`}
                    >
                      {spd}x
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {isComplete && (
            <>
              <button
                type="button"
                onClick={() => setActiveTab('results')}
                className="h-9 px-4 rounded-lg bg-[#25A76B] hover:bg-[#1f8c59] active:scale-98 text-white text-[13px] font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
              >
                <BarChart3 size={15} className="shrink-0" />
                <span>See results</span>
              </button>
              <button
                type="button"
                disabled={!canStart}
                onClick={startNewRun}
                title={canStart ? 'Run simulation again' : disabledReason}
                className={`h-9 px-3.5 rounded-lg border border-[#E2E6EF] text-[13px] font-medium flex items-center gap-1.5 transition-colors ${
                  canStart
                    ? 'bg-white hover:bg-[#F5F6F8] text-[#111C2D] cursor-pointer'
                    : 'bg-[#F5F6F8] text-[#6B7A99] cursor-not-allowed'
                }`}
              >
                <Play size={14} className="fill-current shrink-0" />
                <span>Run again</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Scale & Zoom Controls (bottom-right) */}
      <div
        className="absolute bottom-3 right-3 z-30 flex items-center bg-white/95 backdrop-blur rounded-[12px] p-1 border border-[#E2E6EF] gap-1 shadow-sm"
        title="Scroll to zoom, drag to pan"
      >
        <span className="px-2 text-[12px] font-medium text-[#111C2D] select-none">
          {hasReferenceImage
            ? `Scale: ${formatScale(metersPerUnit)}`
            : `Scale: 1 cell = ${currentCellMeters} m`}
        </span>
        <div className="h-4 w-[1px] bg-[#E2E6EF]" />
        <button
          type="button"
          onClick={handleZoomIn}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-[#6B7A99] hover:text-[#111C2D] hover:bg-[#F5F6F8] active:scale-90 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] focus-visible:ring-offset-1"
          title="Zoom in (Scroll to zoom, drag to pan)"
          aria-label="Zoom in"
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          onClick={handleZoomOut}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-[#6B7A99] hover:text-[#111C2D] hover:bg-[#F5F6F8] active:scale-90 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] focus-visible:ring-offset-1"
          title="Zoom out (Scroll to zoom, drag to pan)"
          aria-label="Zoom out"
        >
          <Minus size={16} />
        </button>
        <div className="h-4 w-[1px] bg-[#E2E6EF]" />
        <button
          type="button"
          onClick={handleFit}
          className="px-2.5 h-9 flex items-center justify-center rounded-lg text-[12px] font-medium text-[#6B7A99] hover:text-[#111C2D] hover:bg-[#F5F6F8] active:scale-95 transition-all gap-1 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] focus-visible:ring-offset-1"
          title="Fit to screen (Scroll to zoom, drag to pan)"
          aria-label="Fit to screen"
        >
          <Maximize2 size={14} />
          <span>Fit</span>
        </button>
        <span
          className="px-1.5 text-[12px] font-medium text-[#6B7A99] select-none tabular-nums"
          title="Scroll to zoom, drag to pan"
        >
          {Math.round(zoom)}%
        </span>
      </div>
    </section>
  );
};
