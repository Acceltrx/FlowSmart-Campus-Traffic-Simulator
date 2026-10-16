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

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Timer,
  Plus,
  Minus,
  Maximize2,
  Play,
  CheckCircle2,
  AlertTriangle,
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

interface SimulationCanvasProps {
  showHeatmap: boolean;
  onToggleHeatmap: (show: boolean) => void;
}

function formatTimer(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
    simTimeSeconds,
    isGridlocked,
    gridlockMessage,
    activeEdgeCase,
    startSimulation,
    pauseSimulation,
    resumeSimulation,
    stopSimulation,
    getSnapshot,
    getInterpolationAlpha,
    liveMetrics,
    segmentOccupancies,
    routeValidation,
    isMapEditedWhileRunning,
  } = useSimulation();

  const [zoom, setZoom] = useState<number>(100);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
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

  // Action: Fit resets zoom to 100 and pan to (0, 0)
  const handleFit = useCallback(() => {
    zoomRef.current = 100;
    panRef.current = { x: 0, y: 0 };
    offscreenDirtyRef.current = true;
    setZoom(100);
    setPan({ x: 0, y: 0 });
  }, []);

  // Zoom and pan reset to Fit ONLY when map bounds change or user presses Fit
  const prevBoundsRef = useRef<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const currentBounds = storeState.map.bounds;
    if (!currentBounds) return;
    if (
      !prevBoundsRef.current ||
      prevBoundsRef.current.width !== currentBounds.width ||
      prevBoundsRef.current.height !== currentBounds.height
    ) {
      prevBoundsRef.current = { width: currentBounds.width, height: currentBounds.height };
      handleFit();
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

  // Measure peak queue for floating tailback badge
  const peakQueueSeg = Object.values(segmentOccupancies).reduce(
    (max, seg) => (seg.queueCount > (max?.queueCount || 0) ? seg : max),
    null as (typeof segmentOccupancies)[string] | null
  );

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

    // 2. Reference image or base architectural buildings
    if (referenceImageRef.current) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.drawImage(referenceImageRef.current, 0, 0, mapWidth, mapHeight);
      ctx.restore();
    } else {
      // Campus grounds background
      ctx.fillStyle = '#EEF5EE';
      drawRoundRect(ctx, 70, 55, mapWidth - 140, mapHeight - 110, 14);
      ctx.fill();

      // Quad lawn polygon
      ctx.fillStyle = '#E3EDE3';
      ctx.beginPath();
      ctx.moveTo(320, 165);
      ctx.lineTo(640, 165);
      ctx.lineTo(615, 310);
      ctx.lineTo(345, 310);
      ctx.closePath();
      ctx.fill();

      // Quad center circle
      ctx.fillStyle = '#D6E8D6';
      ctx.beginPath();
      ctx.arc(480, 235, 30, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#3D6B42';
      ctx.font = '600 12px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Quad lawn', 480, 235);

      // Building 1: Main academic hall
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 1.2;
      drawRoundRect(ctx, 370, 80, 220, 54, 8);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#111C2D';
      ctx.font = '600 12px Inter, system-ui, sans-serif';
      ctx.fillText('Main Academic Hall', 480, 107);

      // Building 2: Technical & vocational complex
      ctx.fillStyle = '#FFFFFF';
      drawRoundRect(ctx, 370, 340, 220, 60, 8);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#111C2D';
      ctx.fillText('Technical & Vocational Complex', 480, 370);

      // Building 3: Gymnasium & auditorium
      ctx.fillStyle = '#FFFFFF';
      drawRoundRect(ctx, 120, 150, 140, 180, 8);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#111C2D';
      ctx.fillText('Gymnasium & Auditorium', 190, 240);

      // Building 4: Elementary wing
      ctx.fillStyle = '#FFFFFF';
      drawRoundRect(ctx, 670, 150, 140, 180, 8);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#111C2D';
      ctx.fillText('Elementary Wing', 740, 240);
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
  }, []);

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
      className="flex-1 h-full bg-[#EBF0F5] relative overflow-hidden select-none min-w-0"
    >
      {/* Top Floating Overlay Bar (Status badge, Clock, View toggles) */}
      <div className="absolute top-3 left-3 right-3 z-30 flex items-center justify-between pointer-events-none">
        {/* Status Badge & Clock */}
        <div className="pointer-events-auto flex items-center bg-white/95 backdrop-blur rounded-lg px-3 py-1.5 border border-[#E2E6EF] gap-3 shadow-sm">
          {/* Status Badge */}
          {isRunning && (
            <div className="flex items-center gap-1.5" id="statusBadge">
              <span className="w-2 h-2 rounded-full bg-[#25A76B] animate-pulse" />
              <span className="text-[12px] font-semibold text-[#25A76B] uppercase tracking-wider">
                RUNNING
              </span>
            </div>
          )}

          {isPaused && (
            <div className="flex items-center gap-1.5" id="statusBadge">
              <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
              <span className="text-[12px] font-semibold text-[#D97706] uppercase tracking-wider">
                PAUSED
              </span>
            </div>
          )}

          {isComplete && (
            <div className="flex items-center gap-1.5" id="statusBadge">
              <CheckCircle2 size={13} className="text-[#254B98]" />
              <span className="text-[12px] font-semibold text-[#254B98] uppercase tracking-wider">
                COMPLETE
              </span>
            </div>
          )}

          {isIdle && (
            <div className="flex items-center gap-1.5" id="statusBadge">
              <span className="w-2 h-2 rounded-full bg-[#6B7A99]" />
              <span className="text-[12px] font-semibold text-[#6B7A99] uppercase tracking-wider">
                IDLE
              </span>
            </div>
          )}

          <div className="h-3.5 w-[1px] bg-[#E2E6EF]" />

          {/* Timer Display */}
          <div className="flex items-center gap-1.5">
            <Timer size={15} className="text-[#6B7A99]" />
            <span
              className="text-[15px] font-semibold text-[#111C2D] tracking-tight tabular-nums"
              id="clockDisplay"
            >
              {formatTimer(isComplete ? liveMetrics.simDurationSeconds : simTimeSeconds)}
            </span>
          </div>

          {/* Amber label when map is edited while running or paused */}
          {isMapEditedWhileRunning && (isRunning || isPaused) && (
            <>
              <div className="h-3.5 w-[1px] bg-[#E2E6EF]" />
              <div className="flex items-center gap-1.5 text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 text-[11px] font-medium">
                <AlertTriangle size={12} className="text-[#F59E0B] shrink-0" />
                <span>Layout edited. Changes apply to the next run.</span>
              </div>
            </>
          )}
        </div>

        {/* Top view toggles (36px tall, 8px radius) */}
        <div className="pointer-events-auto flex items-center bg-white/95 backdrop-blur rounded-lg p-1 border border-[#E2E6EF] gap-1 shadow-sm">
          <button
            type="button"
            onClick={() => onToggleHeatmap(false)}
            className={`px-3 h-9 rounded-lg text-[13px] transition-all duration-150 cursor-pointer active:scale-95 flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] focus-visible:ring-offset-1 ${
              !showHeatmap
                ? 'bg-[#254B98] text-white font-medium'
                : 'text-[#6B7A99] hover:text-[#111C2D] hover:bg-gray-100'
            }`}
          >
            Vehicle view
          </button>
          <button
            type="button"
            onClick={() => onToggleHeatmap(true)}
            className={`px-3 h-9 rounded-lg text-[13px] transition-all duration-150 cursor-pointer active:scale-95 flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] focus-visible:ring-offset-1 ${
              showHeatmap
                ? 'bg-[#254B98] text-white font-medium'
                : 'text-[#6B7A99] hover:text-[#111C2D] hover:bg-gray-100'
            }`}
          >
            Heatmap overlay
          </button>
        </div>
      </div>

      {/* PRD 4.3 Gridlock Alert Banner */}
      {isGridlocked && (isRunning || isPaused) && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-40 bg-red-600 text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-3 border border-red-700 animate-pulse pointer-events-auto max-w-[560px]">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <AlertTriangle size={18} className="text-white" />
          </div>
          <div className="flex flex-col text-left mr-2">
            <span className="text-[13px] font-semibold tracking-tight">Gridlock detected</span>
            <span className="text-[12px] text-red-100 leading-tight">
              {gridlockMessage || 'All vehicles stationary for 120 simulated seconds. Traffic flow halted.'}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-auto">
            <button
              type="button"
              onClick={isRunning ? pauseSimulation : resumeSimulation}
              className="h-9 px-3 bg-white text-red-700 hover:bg-red-50 active:scale-95 text-[12px] font-medium rounded-lg transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {isRunning ? 'Pause' : 'Resume'}
            </button>
            <button
              type="button"
              onClick={stopSimulation}
              className="h-9 px-3 bg-red-800 hover:bg-red-900 active:scale-95 text-white text-[12px] font-medium rounded-lg transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Stop
            </button>
          </div>
        </div>
      )}

      {/* PRD 4.3 Edge-Case Notice Banner (Zero roads, No entrance, No exit, All exits blocked, Zero spawn rate) */}
      {!isGridlocked && activeEdgeCase && (isRunning || isPaused) && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-40 bg-white/95 backdrop-blur-md px-4 py-2.5 rounded-lg shadow-md border border-amber-300 flex items-center gap-3 max-w-[580px] pointer-events-auto">
          <AlertTriangle size={18} className="text-amber-500 shrink-0" />
          <div className="flex flex-col text-left">
            <span className="text-[13px] font-medium text-[#111C2D]">
              {activeEdgeCase.type === 'zero-roads'
                ? 'Zero roads configured'
                : activeEdgeCase.type === 'no-entrance'
                ? 'No entrance configured'
                : activeEdgeCase.type === 'no-exit'
                ? 'No exit configured'
                : activeEdgeCase.type === 'no-drop-off'
                ? 'No drop-off zone'
                : activeEdgeCase.type === 'no-valid-path'
                ? 'No valid path'
                : activeEdgeCase.type === 'all-exits-blocked'
                ? 'All exits blocked'
                : activeEdgeCase.type === 'zero-spawn-rate'
                ? 'Zero spawn rate'
                : 'Edge case active'}
            </span>
            <span className="text-[12px] text-[#6B7A99] leading-snug">
              {activeEdgeCase.message}
            </span>
          </div>
          {(activeEdgeCase.type === 'zero-roads' ||
            activeEdgeCase.type === 'no-entrance' ||
            activeEdgeCase.type === 'no-exit' ||
            activeEdgeCase.type === 'no-drop-off' ||
            activeEdgeCase.type === 'no-valid-path' ||
            activeEdgeCase.type === 'all-exits-blocked') && (
            <button
              type="button"
              onClick={() => setActiveTab('map-setup')}
              className="ml-auto shrink-0 h-9 px-3 bg-[#254B98] hover:bg-[#1d3b7a] active:scale-95 text-white rounded-lg text-[12px] font-medium transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98]"
            >
              Edit map
            </button>
          )}
        </div>
      )}

      {/* HTML5 Canvas element */}
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        style={{ touchAction: 'none' }}
        className={`w-full h-full block ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
      />

      {/* Idle Prompt Card with Route Validation per ENGINE SPEC */}
      {isIdle && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-3 bg-white/95 backdrop-blur-md px-6 py-5 rounded-lg border border-[#E2E6EF] shadow-lg pointer-events-auto text-center max-w-[380px] w-full">
          <div
            className={`w-12 h-12 rounded-full flex items-center justify-center ${
              !routeValidation.isValid
                ? 'bg-red-50 text-[#EF4444]'
                : 'bg-[#25A76B]/10 text-[#25A76B]'
            }`}
          >
            {!routeValidation.isValid ? (
              <AlertTriangle size={24} className="text-[#EF4444]" />
            ) : (
              <Play size={24} className="fill-[#25A76B] translate-x-[1px]" />
            )}
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="text-[16px] font-medium text-[#111C2D]">
              {!routeValidation.isValid ? 'Route validation failed' : 'Ready to simulate'}
            </h3>
            <p className="text-[12px] text-[#6B7A99] leading-snug">
              {storeState.map.roadSegments.length === 0
                ? 'Zero roads configured. You can simulate to verify empty map handling, or add roads in Map setup.'
                : !routeValidation.isValid
                ? 'One or more entrances cannot route vehicles to destinations along drawn paths.'
                : 'Generate dynamic traffic flow, drop-off dynamics, and bottleneck analytics.'}
            </p>
          </div>

          {/* Validation shown before Run per entrance */}
          {routeValidation.entranceSummaries.length > 0 && (
            <div className="w-full bg-[#F5F6F8] border border-[#E2E6EF] rounded-lg p-3 flex flex-col gap-2 text-left text-[12px]">
              <span className="font-medium text-[#111C2D]">Route eligibility</span>
              {routeValidation.entranceSummaries.map((s) => (
                <div key={s.entranceId} className="flex flex-col gap-0.5">
                  <div className="flex items-center justify-between text-[#111C2D]">
                    <span className="font-medium">{s.entranceName}:</span>
                    {s.error ? (
                      <span className="text-[#EF4444] font-medium">0 routes found</span>
                    ) : s.stickerOnly ? (
                      <span className="text-[#D97706] font-medium">Sticker holders only</span>
                    ) : s.nonStickerOnly ? (
                      <span className="text-[#D97706] font-medium">Non-sticker only</span>
                    ) : (
                      <span className="text-[#6B7A99] font-medium tabular-nums">
                        {s.stickerRoutesCount} sticker, {s.nonStickerRoutesCount} non-sticker
                      </span>
                    )}
                  </div>
                  {s.error && (
                    <span className="text-[#EF4444] text-[12px] leading-tight font-medium">
                      {s.error}
                    </span>
                  )}
                  {s.truncated && (
                    <span className="text-[#D97706] text-[12px] italic">
                      Route list truncated at 200
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Error callout when 0 routes */}
          {!routeValidation.isValid && (
            <div className="w-full bg-red-50 border border-red-200 text-[#EF4444] p-2.5 rounded-lg text-[12px] text-left flex items-start gap-2">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <span>{routeValidation.errorMessage || 'Cannot run: one or more entrances have 0 valid routes.'}</span>
            </div>
          )}

          <button
            type="button"
            disabled={!routeValidation.isValid}
            onClick={startSimulation}
            className={`w-full h-9 px-4 rounded-lg text-[13px] font-medium flex items-center justify-center gap-2 transition-all ${
              routeValidation.isValid
                ? 'bg-[#25A76B] hover:bg-[#1f8c59] active:scale-98 text-white cursor-pointer'
                : 'bg-gray-200 text-[#6B7A99] cursor-not-allowed shadow-none'
            } focus:outline-none focus-visible:ring-2 focus-visible:ring-[#254B98] focus-visible:ring-offset-2`}
          >
            <Play size={16} className={routeValidation.isValid ? 'fill-white stroke-none' : 'fill-gray-400 stroke-none'} />
            <span>{!routeValidation.isValid ? 'Run disabled' : 'Run simulation'}</span>
          </button>
          <span className="text-[12px] text-[#6B7A99]">Press [Space] to start / pause</span>
        </div>
      )}

      {/* Floating Tailback Queue Callout (During run if queue forms) */}
      {(isRunning || isPaused) && !isGridlocked && peakQueueSeg && peakQueueSeg.queueCount >= 4 && (
        <div className="absolute top-[65%] left-[22%] z-30 bg-white/95 backdrop-blur px-3 py-2 rounded-lg border border-[#EF4444]/30 flex items-center gap-2 shadow-sm">
          <span className="flex h-2 w-2 rounded-full bg-[#EF4444] animate-pulse" />
          <div className="flex flex-col">
            <span className="text-[12px] text-[#EF4444] font-medium leading-tight">
              {peakQueueSeg.queueCount} vehicles waiting
            </span>
            <span className="text-[12px] text-[#6B7A99] leading-tight">
              Queue tailback: {peakQueueSeg.segmentName}
            </span>
          </div>
        </div>
      )}

      {/* Final Simulation Summary Notification Callout (When complete) */}
      {isComplete && (
        <div className="absolute top-[65%] left-[22%] z-30 bg-white/95 backdrop-blur px-3.5 py-2.5 rounded-lg border border-[#254B98]/30 flex items-center gap-3 shadow-sm pointer-events-auto">
          <span className="flex h-2 w-2 rounded-full bg-[#254B98] shrink-0" />
          <div className="flex flex-col">
            <span className="text-[12px] text-[#254B98] font-medium leading-tight">
              {liveMetrics.totalCompletedVehicles} vehicles processed
            </span>
            <span className="text-[12px] text-[#6B7A99] leading-tight">
              Evaluation session finalized
            </span>
          </div>
          <button
            type="button"
            onClick={stopSimulation}
            className="ml-2 h-7 px-2.5 rounded-md bg-[#F5F6F8] hover:bg-gray-200 text-[12px] font-medium text-[#111C2D] border border-[#E2E6EF] transition-colors cursor-pointer active:scale-95"
            title="Clear run display and return to idle"
          >
            Clear
          </button>
        </div>
      )}

      {/* Scale Bar & Canvas Legend (bottom-left, 12px gap) */}
      <div className="absolute bottom-3 left-3 z-30 flex flex-col gap-3 pointer-events-none">
        <div className="pointer-events-auto">
          <ScaleBar metersPerUnit={metersPerUnit} screenPixelsPerUnit={currentFinalScale} />
        </div>
        <div className="pointer-events-auto bg-white/95 backdrop-blur px-3.5 py-2.5 rounded-lg border border-[#E2E6EF] flex flex-col gap-2 shadow-sm">
          {/* Vehicles Legend */}
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-[#6B7A99] font-medium">Vehicles:</span>
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-2 rounded-[2px] bg-white border border-[#0F172A] inline-block" />
              <span className="text-[12px] text-[#111C2D]">Sticker (white)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-2 rounded-[2px] bg-[#38BDF8] border border-[#0F172A] inline-block" />
              <span className="text-[12px] text-[#111C2D]">Non-sticker (blue)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-2 rounded-[2px] bg-white border border-[#F59E0B] inline-block" />
              <span className="text-[12px] text-[#111C2D]">Drop-off (amber)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-2 rounded-[2px] bg-white border border-[#0F172A] relative inline-block overflow-hidden">
                <span className="absolute left-0 top-0 bottom-0 w-[2.5px] bg-[#EF4444]" />
              </span>
              <span className="text-[12px] text-[#111C2D]">Queued</span>
            </div>
          </div>

          {/* Road access types line style legend */}
          <div className="flex items-center gap-3 pt-1.5 border-t border-gray-100">
            <span className="text-[12px] text-[#6B7A99] font-medium">Roads:</span>
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-1.5 rounded-xs bg-[#3B4658] border border-white" />
              <span className="text-[12px] text-[#111C2D]">Shared</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-1.5 rounded-xs bg-[#3B4658] border border-dashed border-[#2563EB]" />
              <span className="text-[12px] text-[#111C2D]">Sticker-only</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-1.5 rounded-xs bg-[#3B4658] border border-dotted border-[#D97706]" />
              <span className="text-[12px] text-[#111C2D]">Non-sticker</span>
            </div>
            <div className="flex items-center gap-1.5">
              <svg width="18" height="6" className="shrink-0 overflow-visible">
                <path d="M 3 0 L 7.5 3 L 3 6" fill="none" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M 10 0 L 14.5 3 L 10 6" fill="none" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-[12px] text-[#111C2D]">One-way</span>
            </div>
          </div>

          {/* Heatmap (road usage) Legend */}
          <div className="flex items-center gap-3 pt-1.5 border-t border-gray-100">
            <span className="text-[12px] text-[#6B7A99] font-medium">Heatmap (road usage):</span>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-2 rounded-xs bg-[#25A76B]" />
              <span className="text-[12px] text-[#111C2D]">Under 60% of capacity</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-2 rounded-xs bg-[#F59E0B]" />
              <span className="text-[12px] text-[#111C2D]">60 to 80%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-2 rounded-xs bg-[#EF4444]" />
              <span className="text-[12px] text-[#111C2D]">Over 80%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Grid Unit Tag on Simulation Canvas (PRD 3.1.9) */}
      {!hasReferenceImage && (
        <div className="absolute top-3 left-48 z-30 pointer-events-none">
          <span className="px-2.5 py-1.5 rounded-lg bg-white/95 backdrop-blur text-[12px] font-medium text-[#6B7A99] border border-[#E2E6EF] shadow-sm flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 border border-[#254B98] bg-[#254B98]/10 rounded-xs inline-block" />
            <span>1 cell = {currentCellMeters} m</span>
          </span>
        </div>
      )}

      {/* Scale & Zoom Controls (bottom-right) */}
      <div
        className="absolute bottom-3 right-3 z-30 flex items-center bg-white/95 backdrop-blur rounded-lg p-1 border border-[#E2E6EF] gap-1 shadow-sm"
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
          title="Fit to panel (Scroll to zoom, drag to pan)"
          aria-label="Fit to panel"
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
