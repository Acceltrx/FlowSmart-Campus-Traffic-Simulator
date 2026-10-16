/**
 * FlowSmart - Map Setup Screen
 * Complete interactive campus map designer according to PRD 3.1 and map_setup draft.
 * Features:
 * - Reference image optional visual aid (PNG/JPG, 200 KB – 5 MB, min 1280x720, session object URL)
 * - Blank grid canvas when no image is attached
 * - Unified world coordinate system inside one SVG <g id="world" transform="translate(panX panY) scale(zoom)">
 * - Exact pointer position conversion: world = ((clientX - rect.left) - panX) / zoom
 * - Smooth wheel zoom keeping cursor world point fixed, and center zoom for +/- buttons
 * - Middle drag, Space + left drag, Shift + left drag panning with pointer capture and RAF
 * - Road rendering: Edge lines (shared solid white, sticker blue dash, non-sticker orange dot), solid asphalt in #3B4658, two-way white dashed centerline, one-way directional chevrons every 40 units
 * - Real-time drawing length labels (current segment and running total) in constant on-screen size
 * - Committed segments length labels at midpoints
 * - "Show lengths" layer toggle; selected road always displays its length
 * - React.memo RoadLayer and MarkerLayer for 60+ FPS rendering without mousemove re-renders
 * - Automatic Fit to panel on load and on Fit button
 * - Visible crosshair dot following cursor with subpixel accuracy at 40%, 100%, 220%
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Edit3,
  MousePointer,
  Eraser,
  Split,
  Plus,
  Minus,
  Maximize2,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Ruler,
  LogIn,
  LogOut,
  ArrowRight,
  X,
} from 'lucide-react';

export const CarPersonIcon: React.FC<{ size?: number; className?: string }> = ({ size = 16, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-label="Car and person icon"
  >
    <circle cx="6" cy="6" r="2.5" fill="currentColor" />
    <path d="M2.5 17v-2a3.5 3.5 0 0 1 7 0v2" />
    <path d="M12 12l2-3h5l2 3v4h-9z" />
    <circle cx="14" cy="17" r="1.5" fill="currentColor" />
    <circle cx="19" cy="17" r="1.5" fill="currentColor" />
  </svg>
);

import { useTrafficStore } from '../../context/TrafficStoreContext';
import { useSimulation } from '../../context/SimulationContext';
import { VehicleMixControl } from '../common/VehicleMixControl';
import {
  RoadSegment,
  ZoneMarker,
  Point,
  MapConfig,
  ZoneType,
  MapBounds,
} from '../../types/traffic';
import {
  distance,
  snapToNearbyNode,
  countIntersections,
  splitRoadSegment,
  splitRoadAt,
  samplePolyline,
  polylineLength,
  polylineMidpoint,
} from '../../utils/mapGeometry';
import { validateAndLoadReferenceImage } from '../../utils/imageUtils';
import { useWireTool } from '../../hooks/useWireTool';
import {
  DEFAULT_METERS_PER_UNIT,
  getMetersPerUnit,
  formatScale,
  describeScale,
  roadWidthUnits,
  edgeLineWidthUnits,
  SPEED_LIMIT_OPTIONS_KMH,
  DEFAULT_SPEED_KMH,
  clampSpeedKmH,
} from '../../utils/scale';
import { ScaleBar } from '../common/ScaleBar';

type ActiveTool = 'road' | 'select' | 'erase' | 'split' | 'entrance' | 'exit' | 'dropoff';

// Requirement: Memoized road layer rendering edge lines, solid asphalt, two-way centerlines, one-way chevrons, and lengths
// Requirement: Memoized individual road segment item to ensure only moving roads re-render
interface RoadSegmentItemProps {
  seg: RoadSegment;
  isSelected: boolean;
  activeTool: ActiveTool;
  showLengths: boolean;
  metersPerUnit: number;
  zoom: number;
  onRoadSelect: (id: string) => void;
  onRoadSplit: (seg: RoadSegment, screenPt: Point) => void;
  onRoadErase: (id: string) => void;
  onBendErase: (id: string, vertexIndex: number) => void;
}

const RoadSegmentItemMemo = React.memo<RoadSegmentItemProps>(
  ({
    seg,
    isSelected,
    activeTool,
    showLengths,
    metersPerUnit,
    zoom,
    onRoadSelect,
    onRoadSplit,
    onRoadErase,
    onBendErase,
  }) => {
    if (seg.points.length < 2) return null;
    const asphaltWidth = roadWidthUnits(seg.lanes || 1, metersPerUnit);
    const edgeLineWidth = edgeLineWidthUnits(asphaltWidth, metersPerUnit);
    const hitStrokeWidth = Math.max(edgeLineWidth, 14 / zoom);

    const pathData = seg.points
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
      .join(' ');

    // Edge line styling based on access type
    const isSticker = seg.accessType === 'sticker-only';
    const isNonSticker = seg.accessType === 'non-sticker-only';
    const edgeStrokeColor = isSticker ? '#2563EB' : isNonSticker ? '#D97706' : '#FFFFFF';
    const edgeDashArray = isSticker ? '14 7' : isNonSticker ? '3 5' : undefined;

    // Chevrons every 40 units for one-way roads
    const isOneWay = seg.flowDirection === 'one-way';
    const chevrons = isOneWay ? samplePolyline(seg.points, 40) : [];

    // Road length badge
    const isLengthVisible = showLengths || isSelected;
    const midPoint = isLengthVisible ? polylineMidpoint(seg.points) : null;
    const lengthMeters = isLengthVisible
      ? (polylineLength(seg.points) * metersPerUnit).toFixed(1)
      : null;

    return (
      <g
        onClick={(e) => {
          if (activeTool === 'split') {
            e.stopPropagation();
            onRoadSplit(seg, { x: e.clientX, y: e.clientY });
          } else if (activeTool === 'erase') {
            e.stopPropagation();
            onRoadErase(seg.id);
          } else if (activeTool === 'select') {
            e.stopPropagation();
            onRoadSelect(seg.id);
          }
        }}
        className="cursor-pointer group"
      >
        {/* Invisible hit stroke for easy clicking at any scale: at least 14 screen pixels */}
        <path
          d={pathData}
          fill="none"
          stroke="rgba(0, 0, 0, 0.001)"
          strokeWidth={hitStrokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="stroke"
        />

        {/* Selection highlight aura */}
        {isSelected && (
          <path
            d={pathData}
            fill="none"
            stroke="#254B98"
            strokeWidth={edgeLineWidth + Math.max(6, asphaltWidth * 0.4)}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.35"
          />
        )}

        {/* 1. Edge lines: path stroked slightly wider than asphalt in access color */}
        <path
          d={pathData}
          fill="none"
          stroke={edgeStrokeColor}
          strokeWidth={edgeLineWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={edgeDashArray}
        />

        {/* 2. Asphalt: solid path in #3B4658, round caps, never dashed */}
        <path
          d={pathData}
          fill="none"
          stroke="#3B4658"
          strokeWidth={asphaltWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* 3. Two-way roads: white dashed center line */}
        {!isOneWay && (
          <path
            d={pathData}
            fill="none"
            stroke="#FFFFFF"
            strokeWidth={Math.max(1, asphaltWidth * 0.1)}
            strokeDasharray="8 6"
            strokeLinecap="round"
          />
        )}

        {/* 4. One-way roads: small white chevrons every 40 units pointing in travel direction */}
        {isOneWay &&
          chevrons.map((ch, chIdx) => {
            const arrowSize = asphaltWidth * 0.25;
            return (
              <path
                key={chIdx}
                d={`M ${-arrowSize} ${-arrowSize} L ${arrowSize * 0.5} 0 L ${-arrowSize} ${arrowSize}`}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth={Math.max(1, asphaltWidth * 0.1)}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.8"
                transform={`translate(${ch.point.x}, ${ch.point.y}) rotate(${ch.heading})`}
              />
            );
          })}

        {/* 5. Erase tool: Clickable targets on bend vertices (not endpoints) to remove just that bend */}
        {activeTool === 'erase' &&
          seg.points.length > 2 &&
          seg.points.slice(1, -1).map((pt, bendOffset) => {
            const realIdx = bendOffset + 1;
            return (
              <g
                key={`bend-erase-${realIdx}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onBendErase(seg.id, realIdx);
                }}
                className="cursor-pointer group/bend"
              >
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={8 / zoom}
                  fill="#EF4444"
                  fillOpacity="0.25"
                  stroke="#EF4444"
                  strokeWidth={1.5 / zoom}
                  className="hover:fill-opacity-60 transition-opacity"
                />
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={3.5 / zoom}
                  fill="#EF4444"
                />
              </g>
            );
          })}

        {/* Saved road length label at midpoint (constant on-screen size) */}
        {isLengthVisible && midPoint && lengthMeters && (
          <g
            transform={`translate(${midPoint.x}, ${midPoint.y}) scale(${1 / zoom})`}
            pointerEvents="none"
          >
            <rect
              x={-(lengthMeters.length * 3.5 + 14)}
              y="-9"
              width={lengthMeters.length * 7 + 28}
              height="18"
              rx="4"
              fill="#0F172A"
              fillOpacity={isSelected ? 0.95 : 0.82}
              stroke={isSelected ? '#254B98' : '#334155'}
              strokeWidth={isSelected ? 1.5 : 1}
            />
            <text
              x="0"
              y="4"
              fill="#FFFFFF"
              fontSize="12"
              fontWeight="500"
              textAnchor="middle"
              fontFamily="Inter, sans-serif"
            >
              {lengthMeters} m
            </text>
          </g>
        )}
      </g>
    );
  }
);
RoadSegmentItemMemo.displayName = 'RoadSegmentItemMemo';

interface RoadLayerProps {
  roads: RoadSegment[];
  selectedRoadId: string | null;
  activeTool: ActiveTool;
  showLengths: boolean;
  metersPerUnit: number;
  zoom: number;
  onRoadSelect: (id: string) => void;
  onRoadSplit: (seg: RoadSegment, screenPt: Point) => void;
  onRoadErase: (id: string) => void;
  onBendErase: (id: string, vertexIndex: number) => void;
}

const RoadLayerMemo = React.memo<RoadLayerProps>(
  ({
    roads,
    selectedRoadId,
    activeTool,
    showLengths,
    metersPerUnit,
    zoom,
    onRoadSelect,
    onRoadSplit,
    onRoadErase,
    onBendErase,
  }) => {
    return (
      <g id="layer-roadnetwork">
        {roads.map((seg) => (
          <RoadSegmentItemMemo
            key={seg.id}
            seg={seg}
            isSelected={selectedRoadId === seg.id}
            activeTool={activeTool}
            showLengths={showLengths}
            metersPerUnit={metersPerUnit}
            zoom={zoom}
            onRoadSelect={onRoadSelect}
            onRoadSplit={onRoadSplit}
            onRoadErase={onRoadErase}
            onBendErase={onBendErase}
          />
        ))}
      </g>
    );
  }
);
RoadLayerMemo.displayName = 'RoadLayerMemo';

interface MarkerDragState {
  id: string;
  grabOffset: Point;
  position: Point;
}

// Requirement: Memoized marker layer to prevent re-render on cursor movement
interface MarkerLayerProps {
  markers: ZoneMarker[];
  selectedMarkerId: string | null;
  draggedMarkerId: string | null;
  activeTool: ActiveTool;
  zoom: number;
  onMarkerSelect: (id: string) => void;
  onMarkerErase: (id: string) => void;
  onMarkerPointerDown: (marker: ZoneMarker, e: React.PointerEvent) => void;
}

const MarkerLayerMemo = React.memo<MarkerLayerProps>(
  ({
    markers,
    selectedMarkerId,
    draggedMarkerId,
    activeTool,
    zoom,
    onMarkerSelect,
    onMarkerErase,
    onMarkerPointerDown,
  }) => {
    return (
      <g id="layer-zonemarkers">
        {markers.map((marker) => {
          const isMarkerSelected = selectedMarkerId === marker.id;
          const isMarkerDragging = draggedMarkerId === marker.id;
          let bgFill = '#254B98'; // Entrance
          if (marker.type === 'exit') bgFill = '#25A76B';
          else if (marker.type === 'dropoff') bgFill = '#F59E0B';

          const badgeWidth = Math.max(marker.name.length * 7 + 36, 88);
          const badgeHeight = 24;

          const cursorClass =
            activeTool === 'select'
              ? isMarkerDragging
                ? 'cursor-grabbing'
                : 'cursor-grab'
              : activeTool === 'erase'
              ? 'cursor-pointer'
              : 'cursor-pointer';

          return (
            <g
              key={marker.id}
              style={{ touchAction: 'none' }}
              onPointerDown={(e) => {
                onMarkerPointerDown(marker, e);
              }}
              onClick={(e) => {
                if (activeTool === 'erase') {
                  e.stopPropagation();
                  onMarkerErase(marker.id);
                } else if (activeTool === 'select') {
                  e.stopPropagation();
                  onMarkerSelect(marker.id);
                }
              }}
              transform={`translate(${marker.position.x}, ${marker.position.y}) scale(${1 / zoom}) translate(${-badgeWidth / 2}, ${-badgeHeight / 2})`}
              className={`${cursorClass} group select-none`}
            >
              {/* Selection ring */}
              {isMarkerSelected && (
                <rect
                  x="-3"
                  y="-3"
                  width={badgeWidth + 6}
                  height={badgeHeight + 6}
                  rx="8"
                  fill="none"
                  stroke="#254B98"
                  strokeWidth="2"
                  strokeDasharray="3 3"
                />
              )}

              {/* Marker badge container */}
              <rect
                x="0"
                y="0"
                width={badgeWidth}
                height={badgeHeight}
                rx="5"
                fill="#FFFFFF"
                stroke={bgFill}
                strokeWidth="1.5"
              />

              {/* Left icon container badge */}
              <rect
                x="2"
                y="2"
                width="20"
                height="20"
                rx="3.5"
                fill={bgFill}
              />

              {/* Distinct vector icon inside */}
              {marker.type === 'entrance' ? (
                <g stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none">
                  <path d="M15 7h2a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-2" />
                  <path d="M11 15l3-3-3-3" />
                  <path d="M14 12H6" />
                </g>
              ) : marker.type === 'exit' ? (
                <g stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none">
                  <path d="M9 7H7a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 7 17h2" />
                  <path d="M13 9l3 3-3 3" />
                  <path d="M16 12H7" />
                </g>
              ) : (
                <g stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
                  <circle cx="7" cy="8" r="1.5" fill="#FFFFFF" stroke="none" />
                  <path d="M5 16v-1.5a1.5 1.5 0 0 1 3 0V16" />
                  <path d="M10 12l1.2-1.8h3.2l1.2 1.8v2.4h-5.6z" />
                  <circle cx="11.5" cy="15.5" r="0.9" fill="#FFFFFF" stroke="none" />
                  <circle cx="14.5" cy="15.5" r="0.9" fill="#FFFFFF" stroke="none" />
                </g>
              )}

              {/* Visible Label text */}
              <text
                x="26"
                y="16"
                fill="#111C2D"
                fontSize="12"
                fontWeight="600"
                letterSpacing="-0.2px"
              >
                {marker.name}
              </text>
            </g>
          );
        })}
      </g>
    );
  }
);
MarkerLayerMemo.displayName = 'MarkerLayerMemo';

export const MapSetupView: React.FC = () => {
  const {
    state,
    updateMap,
    updateSettings,
    setActiveTab,
    resetAll,
    loadSampleMap,
    setReferenceImageUrl,
    speedAdjustedNotice,
    setSpeedAdjustedNotice,
    dismissSpeedAdjustedNotice,
  } = useTrafficStore();
  const { stopSimulation } = useSimulation();

  const { map, settings, referenceImageUrl } = state;

  // Auto-dismiss speed adjusted note after 6 seconds
  useEffect(() => {
    if (speedAdjustedNotice) {
      const timer = window.setTimeout(() => {
        dismissSpeedAdjustedNotice();
      }, 6000);
      return () => window.clearTimeout(timer);
    }
  }, [speedAdjustedNotice, dismissSpeedAdjustedNotice]);

  // Active tool state
  const [activeTool, setActiveTool] = useState<ActiveTool>('select');
  const activeToolRef = useRef<ActiveTool>(activeTool);
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  // Selection state
  const [selectedRoadId, setSelectedRoadId] = useState<string | null>('seg-4');
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);

  // Layers visibility toggles
  const [showReferenceImage, setShowReferenceImage] = useState<boolean>(true);
  const [showRoadNetwork, setShowRoadNetwork] = useState<boolean>(true);
  const [showLengths, setShowLengths] = useState<boolean>(false);

  // Viewport zoom (scale factor, 1.0 = 100%, 0.25 to 4.0) & pan (px offset)
  const [zoom, setZoom] = useState<number>(1.0);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const zoomRef = useRef<number>(1.0);
  const panRef = useRef<Point>({ x: 0, y: 0 });
  const latestPanRef = useRef<Point>({ x: 0, y: 0 });
  const panRafIdRef = useRef<number | null>(null);
  const cursorRafIdRef = useRef<number | null>(null);

  // Sync refs with state
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    panRef.current = pan;
    latestPanRef.current = pan;
  }, [pan]);

  // Panning state
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const isPanningRef = useRef<boolean>(false);
  const panStartRef = useRef<{ pointerX: number; pointerY: number; panX: number; panY: number }>({
    pointerX: 0,
    pointerY: 0,
    panX: 0,
    panY: 0,
  });
  const pointerIdRef = useRef<number | null>(null);
  const hasMovedOrPannedRef = useRef<boolean>(false);

  // Space key tracking
  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);
  const isSpacePressedRef = useRef<boolean>(false);

  // Marker drag state: { id, grabOffset, position }
  const [markerDrag, setMarkerDrag] = useState<MarkerDragState | null>(null);
  const markerDragRef = useRef<MarkerDragState | null>(null);
  const markerDragStartScreenRef = useRef<Point>({ x: 0, y: 0 });
  const isMarkerDraggingActiveRef = useRef<boolean>(false);
  const markerPointerIdRef = useRef<number | null>(null);

  // References for keyboard shortcuts and events without reattaching listeners
  const boundsRef = useRef<MapBounds>({ width: 1000, height: 600 });
  const mapRef = useRef<MapConfig>(map);
  mapRef.current = map;
  const selectedMarkerIdRef = useRef<string | null>(selectedMarkerId);
  selectedMarkerIdRef.current = selectedMarkerId;
  const selectedRoadIdRef = useRef<string | null>(selectedRoadId);
  selectedRoadIdRef.current = selectedRoadId;

  // Single scale field & grid scale calculation
  const hasReferenceImage = Boolean(referenceImageUrl || map.referenceImageName);
  const metersPerUnit = getMetersPerUnit(map, settings);
  const GRID_CELL_PX = 20;
  const currentCellMeters = Math.round(metersPerUnit * GRID_CELL_PX * 10) / 10;

  // Grid scale mode ('preset' | 'custom') and input state (PRD 3.1.9)
  const [gridMode, setGridMode] = useState<'preset' | 'custom'>(() =>
    [5, 10, 20, 50].includes(currentCellMeters) ? 'preset' : 'custom'
  );
  const [customCellInput, setCustomCellInput] = useState<string>(() => String(currentCellMeters || 10));
  const [customCellError, setCustomCellError] = useState<string | null>(null);

  // Status notification for scale changes (4-second duration)
  const [scaleNotification, setScaleNotification] = useState<string | null>(null);
  const scaleNotificationTimerRef = useRef<number | null>(null);

  const showScaleNotification = useCallback((message: string) => {
    if (scaleNotificationTimerRef.current) {
      window.clearTimeout(scaleNotificationTimerRef.current);
    }
    setScaleNotification(message);
    scaleNotificationTimerRef.current = window.setTimeout(() => {
      setScaleNotification(null);
      scaleNotificationTimerRef.current = null;
    }, 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (scaleNotificationTimerRef.current) {
        window.clearTimeout(scaleNotificationTimerRef.current);
      }
    };
  }, []);

  // Check if simulation is running or paused to disable scale controls
  const isSimulationActive = state.simulationStatus === 'running' || state.simulationStatus === 'paused';

  // World bounds (defaults to 1000 x 600 for blank canvas, or height derived from reference image aspect ratio)
  const bounds = map.bounds || { width: 1000, height: 600 };
  const worldWidth = bounds.width;
  const worldHeight = bounds.height;
  boundsRef.current = bounds;

  // Helper to commit map state
  const commitMapChange = useCallback(
    (newMap: MapConfig) => {
      updateMap(newMap);
    },
    [updateMap]
  );

  // TinkerCAD-style wire drawing hook for the Road Tool
  const wireTool = useWireTool({
    activeTool,
    setActiveTool,
    map,
    commitMapChange,
    zoom,
    metersPerUnit,
    defaultSpeedLimit: clampSpeedKmH(settings.defaultSpeedLimit || DEFAULT_SPEED_KMH),
    worldWidth,
    worldHeight,
    selectedRoadId,
    setSelectedRoadId,
    setSelectedMarkerId,
  });

  const [mousePos, setMousePos] = useState<Point | null>(null);
  const mousePosRef = useRef<Point>({ x: 0, y: 0 });

  // DOM refs
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const crosshairGroupRef = useRef<SVGGElement>(null);
  const crosshairDotRef = useRef<SVGCircleElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Upload feedback state
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // Reset confirmation modal
  const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);
  const [showNewLayoutConfirm, setShowNewLayoutConfirm] = useState<boolean>(false);

  // New layout confirm handler (PRD / FlowSmart requirements)
  const handleNewLayoutConfirm = useCallback(() => {
    const usedNames = new Set<string>();
    if (map.layoutName) {
      usedNames.add(map.layoutName.trim().toLowerCase());
    }
    if (settings.layoutName) {
      usedNames.add(settings.layoutName.trim().toLowerCase());
    }
    state.runLog.forEach((entry) => {
      if (entry.layoutName) {
        usedNames.add(entry.layoutName.trim().toLowerCase());
      }
    });

    let nextLetterName = 'Layout B';
    for (let i = 1; i < 26; i++) {
      const candidate = `Layout ${String.fromCharCode(65 + i)}`;
      if (!usedNames.has(candidate.toLowerCase())) {
        nextLetterName = candidate;
        break;
      }
    }
    if (usedNames.has(nextLetterName.toLowerCase())) {
      for (let i = 0; i < 26; i++) {
        const candidate = `Layout A${String.fromCharCode(65 + i)}`;
        if (!usedNames.has(candidate.toLowerCase())) {
          nextLetterName = candidate;
          break;
        }
      }
    }

    const newMap: MapConfig = {
      ...map,
      id: `map-${Date.now()}`,
      layoutName: nextLetterName,
      roadSegments: [],
      zoneMarkers: [],
      settings: {
        ...(map.settings || settings),
        layoutName: nextLetterName,
        spawnRates: {},
      },
    };

    commitMapChange(newMap);
    updateSettings({
      layoutName: nextLetterName,
      spawnRates: {},
    });

    stopSimulation();
    setSelectedRoadId(null);
    setSelectedMarkerId(null);
    wireTool.setActiveRoadPoints([]);
    setActiveTool('select');
    setShowNewLayoutConfirm(false);
  }, [map, settings, state.runLog, commitMapChange, updateSettings, stopSimulation, wireTool]);

  // Calibration state (PRD 3.1.9)
  type CalibrationStep = 'idle' | 'pick-a' | 'pick-b' | 'dialog';
  const [calibrationStep, setCalibrationStep] = useState<CalibrationStep>('idle');
  const calibrationStepRef = useRef<CalibrationStep>(calibrationStep);
  useEffect(() => {
    calibrationStepRef.current = calibrationStep;
  }, [calibrationStep]);

  const [calibPointA, setCalibPointA] = useState<Point | null>(null);
  const [calibPointB, setCalibPointB] = useState<Point | null>(null);
  const [calibRealDistanceInput, setCalibRealDistanceInput] = useState<string>('50');

  // Track natural image dimensions for reference image info display
  const [loadedImageDimensions, setLoadedImageDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!referenceImageUrl) {
      setLoadedImageDimensions(null);
      return;
    }
    const img = new Image();
    img.src = referenceImageUrl;
    img.onload = () => {
      setLoadedImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
    };
  }, [referenceImageUrl]);

  const imageResolutionText = useMemo(() => {
    if (map.referenceImageDimensions) {
      return `${map.referenceImageDimensions.width} x ${map.referenceImageDimensions.height} px`;
    }
    if (loadedImageDimensions) {
      return `${loadedImageDimensions.width} x ${loadedImageDimensions.height} px`;
    }
    return null;
  }, [map.referenceImageDimensions, loadedImageDimensions]);

  // Count items (roads with any point, or markers) lying outside current world bounds
  const outsideItemsCount = useMemo(() => {
    const bw = worldWidth;
    const bh = worldHeight;
    let count = 0;
    for (const marker of map.zoneMarkers) {
      if (marker.position.x < 0 || marker.position.x > bw || marker.position.y < 0 || marker.position.y > bh) {
        count++;
      }
    }
    for (const road of map.roadSegments) {
      if (road.points.some((p) => p.x < 0 || p.x > bw || p.y < 0 || p.y > bh)) {
        count++;
      }
    }
    return count;
  }, [worldWidth, worldHeight, map.zoneMarkers, map.roadSegments]);

  const cancelCalibration = useCallback(() => {
    setCalibrationStep('idle');
    setCalibPointA(null);
    setCalibPointB(null);
  }, []);

  // Keyboard shortcut: Escape cancels active tool, polyline, calibration, or selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (e.key === 'Escape') {
        if (markerDragRef.current) {
          if (markerPointerIdRef.current !== null && svgRef.current) {
            try {
              svgRef.current.releasePointerCapture(markerPointerIdRef.current);
            } catch {
              // ignore
            }
            markerPointerIdRef.current = null;
          }
          setMarkerDrag(null);
          markerDragRef.current = null;
          isMarkerDraggingActiveRef.current = false;
          return;
        }
        if (calibrationStepRef.current !== 'idle') {
          cancelCalibration();
          return;
        }
        if (activeToolRef.current === 'road') {
          return; // Handled by useWireTool
        }
        setSelectedRoadId(null);
        setSelectedMarkerId(null);
        setActiveTool('select');
        setShowResetConfirm(false);
      } else if (e.code === 'Space' && !e.repeat && !isInput) {
        e.preventDefault();
        setIsSpacePressed(true);
        isSpacePressedRef.current = true;
      } else if (
        !isInput &&
        selectedMarkerIdRef.current &&
        !selectedRoadIdRef.current &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        e.preventDefault();
        const markerId = selectedMarkerIdRef.current;
        const currentMarker = mapRef.current.zoneMarkers.find((m) => m.id === markerId);
        if (currentMarker) {
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          const bw = boundsRef.current.width;
          const bh = boundsRef.current.height;
          const nextX = Math.round(Math.max(0, Math.min(bw, currentMarker.position.x + dx)));
          const nextY = Math.round(Math.max(0, Math.min(bh, currentMarker.position.y + dy)));
          if (nextX !== currentMarker.position.x || nextY !== currentMarker.position.y) {
            commitMapChange({
              ...mapRef.current,
              zoneMarkers: mapRef.current.zoneMarkers.map((m) =>
                m.id === markerId ? { ...m, position: { x: nextX, y: nextY } } : m
              ),
            });
          }
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
        isSpacePressedRef.current = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [cancelCalibration]);

  // Extract all existing nodes for snapping
  const existingNodes = useMemo(() => {
    const nodes: Point[] = [];
    for (const seg of map.roadSegments) {
      nodes.push(...seg.points);
    }
    for (const marker of map.zoneMarkers) {
      nodes.push(marker.position);
    }
    return nodes;
  }, [map.roadSegments, map.zoneMarkers]);

  const existingNodesRef = useRef<Point[]>(existingNodes);
  useEffect(() => {
    existingNodesRef.current = existingNodes;
  }, [existingNodes]);

  // Exact pointer position conversion
  const getCanvasCoords = useCallback((clientX: number, clientY: number): Point => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    const worldX = (clientX - rect.left - panRef.current.x) / zoomRef.current;
    const worldY = (clientY - rect.top - panRef.current.y) / zoomRef.current;
    return { x: worldX, y: worldY };
  }, []);

  // Center and fit the world to the panel
  const fitToPanel = useCallback((overrideBounds?: MapBounds | unknown) => {
    if (!canvasContainerRef.current) return;
    const rect = canvasContainerRef.current.getBoundingClientRect();
    const panelW = rect.width;
    const panelH = rect.height;
    if (panelW <= 0 || panelH <= 0) return;

    const isBounds = (b: unknown): b is MapBounds =>
      Boolean(b && typeof b === 'object' && 'width' in b && typeof (b as MapBounds).width === 'number' && 'height' in b && typeof (b as MapBounds).height === 'number');

    const currentBounds = (isBounds(overrideBounds) ? overrideBounds : null) || map.bounds || { width: 1000, height: 600 };
    const WORLD_W = currentBounds.width;
    const WORLD_H = currentBounds.height;
    const PADDING = 28;

    const availW = Math.max(100, panelW - PADDING * 2);
    const availH = Math.max(100, panelH - PADDING * 2);

    const fitScale = Math.min(availW / WORLD_W, availH / WORLD_H);
    const clampedZoom = Math.max(0.25, Math.min(4.0, fitScale));

    const panX = Math.round((panelW - WORLD_W * clampedZoom) / 2);
    const panY = Math.round((panelH - WORLD_H * clampedZoom) / 2);

    zoomRef.current = clampedZoom;
    panRef.current = { x: panX, y: panY };
    latestPanRef.current = { x: panX, y: panY };

    setZoom(clampedZoom);
    setPan({ x: panX, y: panY });
  }, [map.bounds]);

  // First load auto-fit
  const initialFitDoneRef = useRef(false);
  useEffect(() => {
    if (!initialFitDoneRef.current && canvasContainerRef.current) {
      const rect = canvasContainerRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        fitToPanel();
        initialFitDoneRef.current = true;
      }
    }
  }, [fitToPanel]);

  useEffect(() => {
    if (!canvasContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          if (!initialFitDoneRef.current) {
            fitToPanel();
            initialFitDoneRef.current = true;
          }
        }
      }
    });
    observer.observe(canvasContainerRef.current);
    return () => observer.disconnect();
  }, [fitToPanel]);

  // Wheel zoom
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      const currentZoom = zoomRef.current;
      const currentPan = panRef.current;

      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newZoom = Math.max(0.25, Math.min(4.0, currentZoom * factor));

      if (newZoom === currentZoom) return;

      const ratio = newZoom / currentZoom;
      const newPanX = cursorX - (cursorX - currentPan.x) * ratio;
      const newPanY = cursorY - (cursorY - currentPan.y) * ratio;

      zoomRef.current = newZoom;
      panRef.current = { x: newPanX, y: newPanY };
      latestPanRef.current = { x: newPanX, y: newPanY };

      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Zoom around panel center for +/- buttons
  const zoomAroundCenter = useCallback((zoomIn: boolean) => {
    if (!canvasContainerRef.current) return;
    const rect = canvasContainerRef.current.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const currentZoom = zoomRef.current;
    const currentPan = panRef.current;

    const factor = zoomIn ? 1.1 : 1 / 1.1;
    const newZoom = Math.max(0.25, Math.min(4.0, currentZoom * factor));

    if (newZoom === currentZoom) return;

    const ratio = newZoom / currentZoom;
    const newPanX = centerX - (centerX - currentPan.x) * ratio;
    const newPanY = centerY - (centerY - currentPan.y) * ratio;

    zoomRef.current = newZoom;
    panRef.current = { x: newPanX, y: newPanY };
    latestPanRef.current = { x: newPanX, y: newPanY };

    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  }, []);

  // Prevent browser autoscroll on middle button
  useEffect(() => {
    const container = canvasContainerRef.current;
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

  // Panning handlers
  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const isMiddle = e.button === 1;
    const isLeft = e.button === 0;
    const isSpaceLeft = isLeft && isSpacePressedRef.current;
    const isShiftLeft = isLeft && e.shiftKey;

    hasMovedOrPannedRef.current = false;

    if (isMiddle || isSpaceLeft || isShiftLeft) {
      e.preventDefault();
      e.stopPropagation();
      setIsPanning(true);
      isPanningRef.current = true;
      hasMovedOrPannedRef.current = true;
      panStartRef.current = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        panX: panRef.current.x,
        panY: panRef.current.y,
      };
      latestPanRef.current = { ...panRef.current };

      try {
        e.currentTarget.setPointerCapture(e.pointerId);
        pointerIdRef.current = e.pointerId;
      } catch (err) {
        // Fallback
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (isPanningRef.current) {
      const dx = e.clientX - panStartRef.current.pointerX;
      const dy = e.clientY - panStartRef.current.pointerY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasMovedOrPannedRef.current = true;
      }
      const nextPan = {
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      };
      latestPanRef.current = nextPan;
      panRef.current = nextPan;

      if (!panRafIdRef.current) {
        panRafIdRef.current = requestAnimationFrame(() => {
          panRafIdRef.current = null;
          setPan(latestPanRef.current);
        });
      }
      return;
    }

    if (markerDragRef.current) {
      const screenDx = e.clientX - markerDragStartScreenRef.current.x;
      const screenDy = e.clientY - markerDragStartScreenRef.current.y;
      const distScreen = Math.hypot(screenDx, screenDy);

      // Do nothing until the pointer has moved more than 4 screen pixels
      if (!isMarkerDraggingActiveRef.current) {
        if (distScreen > 4) {
          isMarkerDraggingActiveRef.current = true;
          hasMovedOrPannedRef.current = true;
        }
      }

      if (isMarkerDraggingActiveRef.current) {
        hasMovedOrPannedRef.current = true;
        const coords = getCanvasCoords(e.clientX, e.clientY);
        const bw = bounds.width;
        const bh = bounds.height;
        const clampedX = Math.round(
          Math.max(0, Math.min(bw, coords.x - markerDragRef.current.grabOffset.x))
        );
        const clampedY = Math.round(
          Math.max(0, Math.min(bh, coords.y - markerDragRef.current.grabOffset.y))
        );
        const nextPos: Point = { x: clampedX, y: clampedY };
        const nextDrag = { ...markerDragRef.current, position: nextPos };
        markerDragRef.current = nextDrag;
        setMarkerDrag(nextDrag);
      }
      return;
    }

    const coords = getCanvasCoords(e.clientX, e.clientY);
    mousePosRef.current = coords;

    if (crosshairGroupRef.current) {
      crosshairGroupRef.current.setAttribute('transform', `translate(${coords.x}, ${coords.y})`);
      crosshairGroupRef.current.style.visibility = 'visible';
    }

    if (wireTool.editDragState) {
      wireTool.handleEditPointerMove(coords);
      return;
    }

    if (activeTool === 'road') {
      wireTool.handlePointerMove(coords, e.shiftKey);
      return;
    }

    const isCalibrating = calibrationStepRef.current !== 'idle';
    if (isCalibrating) {
      setMousePos(coords);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (wireTool.editDragState) {
      wireTool.handleEditPointerUp(e);
    }

    if (markerDragRef.current) {
      if (markerPointerIdRef.current !== null && svgRef.current) {
        try {
          svgRef.current.releasePointerCapture(markerPointerIdRef.current);
        } catch {
          // ignore
        }
        markerPointerIdRef.current = null;
      }

      const activeDrag = markerDragRef.current;
      const didDrag = isMarkerDraggingActiveRef.current;

      if (didDrag) {
        const finalPosition = activeDrag.position;
        commitMapChange({
          ...map,
          zoneMarkers: map.zoneMarkers.map((m) =>
            m.id === activeDrag.id ? { ...m, position: finalPosition } : m
          ),
        });
        hasMovedOrPannedRef.current = true;
      }

      setMarkerDrag(null);
      markerDragRef.current = null;
      isMarkerDraggingActiveRef.current = false;
      return;
    }

    if (isPanningRef.current) {
      isPanningRef.current = false;
      setIsPanning(false);

      if (panRafIdRef.current) {
        cancelAnimationFrame(panRafIdRef.current);
        panRafIdRef.current = null;
      }
      setPan(latestPanRef.current);

      if (pointerIdRef.current !== null) {
        try {
          e.currentTarget.releasePointerCapture(pointerIdRef.current);
        } catch (err) {
          // ignore
        }
        pointerIdRef.current = null;
      }
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<SVGSVGElement>) => {
    if (wireTool.editDragState) {
      wireTool.cancelEditDrag();
    }

    if (markerDragRef.current) {
      if (markerPointerIdRef.current !== null && svgRef.current) {
        try {
          svgRef.current.releasePointerCapture(markerPointerIdRef.current);
        } catch {
          // ignore
        }
        markerPointerIdRef.current = null;
      }
      setMarkerDrag(null);
      markerDragRef.current = null;
      isMarkerDraggingActiveRef.current = false;
    }

    if (isPanningRef.current) {
      isPanningRef.current = false;
      setIsPanning(false);
      if (panRafIdRef.current) {
        cancelAnimationFrame(panRafIdRef.current);
        panRafIdRef.current = null;
      }
      setPan(latestPanRef.current);
      if (pointerIdRef.current !== null) {
        try {
          e.currentTarget.releasePointerCapture(pointerIdRef.current);
        } catch (err) {
          // ignore
        }
        pointerIdRef.current = null;
      }
    }
  };

  const handlePointerLeave = () => {
    if (crosshairGroupRef.current) {
      crosshairGroupRef.current.style.visibility = 'hidden';
    }
  };

  // Canvas Click Handler
  const handleCanvasClick = (e: React.MouseEvent) => {
    if (hasMovedOrPannedRef.current || isPanningRef.current) return;

    const rawCoords = getCanvasCoords(e.clientX, e.clientY);
    const coords = rawCoords;

    // 0. Calibration tool interceptor
    if (calibrationStep === 'pick-a') {
      setCalibPointA(rawCoords);
      setCalibrationStep('pick-b');
      return;
    }
    if (calibrationStep === 'pick-b') {
      setCalibPointB(rawCoords);
      setCalibrationStep('dialog');
      return;
    }
    if (calibrationStep === 'dialog') {
      return;
    }

    // 1. Road drawing tool: delegate to useWireTool
    if (activeTool === 'road') {
      wireTool.handleWireClick(rawCoords, e);
      return;
    }

    // 2. Zone marker placement tools
    if (activeTool === 'entrance' || activeTool === 'exit' || activeTool === 'dropoff') {
      const type = activeTool as ZoneType;
      const countOfType = map.zoneMarkers.filter((m) => m.type === type).length + 1;
      let defaultName = '';
      if (type === 'entrance') defaultName = `Gate ${countOfType} (entrance)`;
      else if (type === 'exit') defaultName = `Exit ${String.fromCharCode(64 + countOfType)} (exit)`;
      else defaultName = `Drop-off #${countOfType}`;

      const clampedPos: Point = {
        x: Math.round(Math.max(0, Math.min(worldWidth, coords.x))),
        y: Math.round(Math.max(0, Math.min(worldHeight, coords.y))),
      };

      const newMarker: ZoneMarker = {
        id: `${type}-${Date.now()}`,
        name: defaultName,
        type,
        position: clampedPos,
        capacity: type === 'dropoff' ? 12 : 20,
        targetTimeMin: type === 'dropoff' ? 0.5 : undefined,
      };

      const updatedMarkers = [...map.zoneMarkers, newMarker];
      commitMapChange({
        ...map,
        zoneMarkers: updatedMarkers,
      });

      if (type === 'entrance') {
        updateSettings({
          spawnRates: {
            ...settings.spawnRates,
            [newMarker.id]: 15,
          },
        });
      }

      setSelectedMarkerId(newMarker.id);
      setSelectedRoadId(null);
      setActiveTool('select');
      return;
    }

    // 3. Deselect when clicking empty space in select tool
    if (activeTool === 'select') {
      setSelectedRoadId(null);
      setSelectedMarkerId(null);
    }
  };



  // Split road callback
  const handleRoadSplit = useCallback(
    (seg: RoadSegment, screenPt: Point) => {
      const clickPoint = getCanvasCoords(screenPt.x, screenPt.y);
      const splitResult = splitRoadSegment(seg, clickPoint);
      if (splitResult) {
        const remaining = map.roadSegments.filter((s) => s.id !== seg.id);
        commitMapChange({
          ...map,
          roadSegments: [...remaining, splitResult.newSeg1, splitResult.newSeg2],
        });
        setSelectedRoadId(splitResult.newSeg1.id);
        setActiveTool('select');
      }
    },
    [commitMapChange, getCanvasCoords, map]
  );

  // Erase road callback
  const handleRoadErase = useCallback(
    (segId: string) => {
      commitMapChange({
        ...map,
        roadSegments: map.roadSegments.filter((s) => s.id !== segId),
      });
      setSelectedRoadId((prev) => (prev === segId ? null : prev));
    },
    [commitMapChange, map]
  );

  // Select road callback
  const handleRoadSelect = useCallback((id: string) => {
    setSelectedRoadId(id);
    setSelectedMarkerId(null);
  }, []);

  // Marker callbacks
  const handleMarkerSelect = useCallback((id: string) => {
    setSelectedMarkerId(id);
    setSelectedRoadId(null);
  }, []);

  const handleMarkerErase = useCallback(
    (markerId: string) => {
      commitMapChange({
        ...map,
        zoneMarkers: map.zoneMarkers.filter((m) => m.id !== markerId),
      });
      setSelectedMarkerId((prev) => (prev === markerId ? null : prev));
    },
    [commitMapChange, map]
  );

  const handleMarkerPointerDown = useCallback(
    (marker: ZoneMarker, e: React.PointerEvent) => {
      // With the Select tool, a marker can be dragged with the left mouse button.
      // Pressing on a marker (not while Space or Shift is held, those are for panning) calls stopPropagation, selects it, and starts a drag.
      if (
        activeToolRef.current !== 'select' ||
        e.button !== 0 ||
        e.shiftKey ||
        isSpacePressedRef.current
      ) {
        return;
      }

      e.stopPropagation();
      setSelectedMarkerId(marker.id);
      setSelectedRoadId(null);

      // On pointer down, grabOffset = pointer world position minus the marker position, so the marker does not jump.
      const worldCoords = getCanvasCoords(e.clientX, e.clientY);
      const grabOffset: Point = {
        x: worldCoords.x - marker.position.x,
        y: worldCoords.y - marker.position.y,
      };

      const initialDrag: MarkerDragState = {
        id: marker.id,
        grabOffset,
        position: marker.position,
      };

      setMarkerDrag(initialDrag);
      markerDragRef.current = initialDrag;
      markerDragStartScreenRef.current = { x: e.clientX, y: e.clientY };
      isMarkerDraggingActiveRef.current = false;

      // Use setPointerCapture on the svg so the drag keeps working when the pointer leaves the marker.
      if (svgRef.current) {
        try {
          svgRef.current.setPointerCapture(e.pointerId);
          markerPointerIdRef.current = e.pointerId;
        } catch {
          // ignore
        }
      }
    },
    [getCanvasCoords]
  );

  // File Upload Handlers
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setIsUploading(true);

    try {
      const result = await validateAndLoadReferenceImage(file);
      if (!result.valid) {
        setUploadError(result.error);
        setIsUploading(false);
        return;
      }

      // Requirement 1: World width at 1000, height at Math.round(1000 * imageHeight / imageWidth)
      const newWorldHeight = Math.round((1000 * result.height) / result.width);
      const newBounds: MapBounds = { width: 1000, height: newWorldHeight };

      setReferenceImageUrl(result.objectUrl);
      commitMapChange({
        ...map,
        bounds: newBounds,
        referenceImageName: result.fileName,
        sourceFileName: result.fileName,
        referenceImageDimensions: { width: result.width, height: result.height },
      });
      setShowReferenceImage(true);

      // Requirement 4: After attaching an image, fit the view to the panel
      fitToPanel(newBounds);
    } catch (err) {
      setUploadError('Failed processing image. Please try another PNG or JPG (200 KB – 5 MB, min 1280x720 px).');
      console.error(err);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Import Map JSON
  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        if (!imported || !Array.isArray(imported.roadSegments)) {
          setUploadError('Invalid map format. Expected JSON containing roadSegments.');
          return;
        }
        delete imported.baseMapImage;
        delete imported.imageUrl;
        delete imported.referenceImageUrl;

        let speedWasClamped = false;
        imported.roadSegments = imported.roadSegments.map((seg: RoadSegment) => {
          const original = seg.speedLimitKmH;
          const clamped = clampSpeedKmH(original);
          if (original !== clamped) {
            speedWasClamped = true;
          }
          return {
            ...seg,
            speedLimitKmH: clamped,
          };
        });

        if (imported.settings && imported.settings.defaultSpeedLimit !== undefined) {
          const original = imported.settings.defaultSpeedLimit;
          const clamped = clampSpeedKmH(original);
          if (original !== clamped) {
            speedWasClamped = true;
          }
          imported.settings.defaultSpeedLimit = clamped;
        }

        if (speedWasClamped) {
          setSpeedAdjustedNotice(true);
        }

        if (imported.metersPerPixel !== undefined) {
          if (!imported.settings) imported.settings = {};
          if (imported.settings.metersPerUnit === undefined) {
            imported.settings.metersPerUnit = imported.metersPerPixel;
          }
          delete imported.metersPerPixel;
        }
        if (imported.settings && imported.settings.metersPerPixel !== undefined) {
          if (imported.settings.metersPerUnit === undefined) {
            imported.settings.metersPerUnit = imported.settings.metersPerPixel;
          }
          delete imported.settings.metersPerPixel;
        }

        if (!imported.bounds) {
          imported.bounds = { width: 1000, height: 600 };
        }

        if (!imported.referenceImageName && imported.sourceFileName) {
          imported.referenceImageName = imported.sourceFileName;
        }
        commitMapChange(imported as MapConfig);
        if (imported.settings) {
          updateSettings(imported.settings);
        }
        fitToPanel(imported.bounds);
      } catch (err) {
        setUploadError('Failed parsing map JSON file.');
      } finally {
        if (importInputRef.current) importInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  // Export Map JSON
  const handleExportJson = () => {
    const cleanMap: MapConfig = {
      ...map,
      bounds: map.bounds || { width: 1000, height: 600 },
      referenceImageDimensions: map.referenceImageDimensions,
      settings: {
        ...(map.settings || settings),
        metersPerUnit,
        vehicleLengthMeters: settings.vehicleLengthMeters ?? 4.5,
        standstillGapMeters: settings.standstillGapMeters ?? 2.0,
        alertWaitThresholdSec: settings.alertWaitThresholdSec ?? 120,
        alertUtilThresholdPct: settings.alertUtilThresholdPct ?? 80,
        alertUtilDurationSec: settings.alertUtilDurationSec ?? 30,
        alertReturnUtilPct: settings.alertReturnUtilPct ?? 60,
      },
      roadSegments: map.roadSegments.map((seg) => {
        const polylinePx = seg.points.reduce(
          (acc, p, idx) => (idx === 0 ? 0 : acc + distance(seg.points[idx - 1], p)),
          0
        );
        const lengthMeters = Math.round(polylinePx * metersPerUnit * 10) / 10;
        const vehLength = settings.vehicleLengthMeters ?? 4.5;
        const vehGap = settings.standstillGapMeters ?? 2.0;
        const capacity = Math.max(1, Math.round((lengthMeters / (vehLength + vehGap)) * (seg.lanes || 1)));
        return {
          ...seg,
          lengthMeters,
          capacity,
        };
      }),
      referenceImageName: map.referenceImageName || map.sourceFileName,
    };
    delete (cleanMap as unknown as Record<string, unknown>).baseMapImage;
    delete (cleanMap as unknown as Record<string, unknown>).imageUrl;
    delete (cleanMap as unknown as Record<string, unknown>).referenceImageUrl;
    delete (cleanMap as unknown as Record<string, unknown>).metersPerPixel;
    if (cleanMap.settings) {
      delete (cleanMap.settings as unknown as Record<string, unknown>).metersPerPixel;
    }

    const jsonStr = JSON.stringify(cleanMap, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${map.layoutName.toLowerCase().replace(/\s+/g, '-')}-map.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Single source of truth for scale updates
  const setMapScale = useCallback(
    (newScale: number) => {
      updateMap({
        ...map,
        settings: { ...(map.settings ?? settings), metersPerUnit: newScale },
      });
      showScaleNotification('Scale updated. Roads keep their shape; their real lengths were recalculated.');
    },
    [map, settings, updateMap, showScaleNotification]
  );

  // Calibration apply handler (PRD 3.1.9)
  const handleApplyCalibration = () => {
    if (!calibPointA || !calibPointB) return;
    const pixelDist = distance(calibPointA, calibPointB);
    const realDist = parseFloat(calibRealDistanceInput);
    if (!isNaN(realDist) && realDist > 0 && pixelDist > 0) {
      const newScale = realDist / pixelDist;
      setMapScale(newScale);
    }
    cancelCalibration();
  };

  // Grid scale change handler
  const handleGridScaleChange = (val: string) => {
    if (isSimulationActive) return;
    if (val === 'custom') {
      setGridMode('custom');
      setCustomCellError(null);
    } else {
      setGridMode('preset');
      setCustomCellError(null);
      const distMeters = parseFloat(val);
      if (!isNaN(distMeters) && distMeters > 0) {
        const newScale = distMeters / GRID_CELL_PX;
        setCustomCellInput(val);
        setMapScale(newScale);
      }
    }
  };

  // Apply custom cell input on blur or Enter
  const applyCustomCellInput = () => {
    if (isSimulationActive) return;
    const parsed = parseFloat(customCellInput);
    if (isNaN(parsed) || parsed < 0.5 || parsed > 200) {
      setCustomCellError('Enter a value between 0.5 and 200 m per cell.');
      return;
    }
    setCustomCellError(null);
    const newScale = parsed / GRID_CELL_PX;
    setMapScale(newScale);
  };

  // Custom grid cell input change helper
  const handleCustomCellChange = (metersStr: string) => {
    setCustomCellInput(metersStr);
    const parsed = parseFloat(metersStr);
    if (!isNaN(parsed) && parsed >= 0.5 && parsed <= 200) {
      setCustomCellError(null);
      const newScale = parsed / GRID_CELL_PX;
      setMapScale(newScale);
    } else if (isNaN(parsed) || parsed < 0.5 || parsed > 200) {
      setCustomCellError('Enter a value between 0.5 and 200 m per cell.');
    }
  };

  // Selected road details & metrics (updates live during vertex drag)
  const selectedRoad = useMemo(
    () => wireTool.effectiveRoadSegments.find((r) => r.id === selectedRoadId) || null,
    [wireTool.effectiveRoadSegments, selectedRoadId]
  );

  const selectedRoadLengthMeters = useMemo(() => {
    if (!selectedRoad || selectedRoad.points.length < 2) return 0;
    const polylinePx = selectedRoad.points.reduce((acc, p, idx) => {
      if (idx === 0) return 0;
      return acc + distance(selectedRoad.points[idx - 1], p);
    }, 0);
    return Math.round(polylinePx * metersPerUnit * 10) / 10;
  }, [selectedRoad, metersPerUnit]);

  const selectedRoadQueueCapacity = useMemo(() => {
    const vehLength = settings.vehicleLengthMeters ?? 4.5;
    const vehGap = settings.standstillGapMeters ?? 2.0;
    const effectiveSpace = Math.max(0.1, vehLength + vehGap);
    const lanes = selectedRoad?.lanes || 1;
    return Math.max(1, Math.round((selectedRoadLengthMeters / effectiveSpace) * lanes));
  }, [selectedRoadLengthMeters, selectedRoad?.lanes, settings.vehicleLengthMeters, settings.standstillGapMeters]);

  // Selected marker details
  const selectedMarker = useMemo(
    () => map.zoneMarkers.find((m) => m.id === selectedMarkerId) || null,
    [map.zoneMarkers, selectedMarkerId]
  );

  // Memoized display markers passing temporary dragged position to MarkerLayerMemo
  const displayMarkers = useMemo(() => {
    if (!markerDrag) return map.zoneMarkers;
    return map.zoneMarkers.map((m) =>
      m.id === markerDrag.id ? { ...m, position: markerDrag.position } : m
    );
  }, [map.zoneMarkers, markerDrag]);

  // Check if selected marker is farther than 6 m (6 / metersPerUnit units) from every road point
  const isSelectedMarkerFarFromRoads = useMemo(() => {
    if (!selectedMarker) return false;
    const currentPos =
      markerDrag && markerDrag.id === selectedMarker.id
        ? markerDrag.position
        : selectedMarker.position;
    const thresholdUnits = 6 / metersPerUnit;
    for (const seg of map.roadSegments) {
      for (const pt of seg.points) {
        if (Math.hypot(currentPos.x - pt.x, currentPos.y - pt.y) <= thresholdUnits) {
          return false;
        }
      }
    }
    return true;
  }, [selectedMarker, markerDrag, map.roadSegments, metersPerUnit]);

  const updateSelectedRoad = (changes: Partial<RoadSegment>) => {
    if (!selectedRoad) return;
    const updated = map.roadSegments.map((r) =>
      r.id === selectedRoad.id ? { ...r, ...changes } : r
    );
    commitMapChange({
      ...map,
      roadSegments: updated,
    });
  };

  const updateSelectedMarker = (changes: Partial<ZoneMarker>) => {
    if (!selectedMarker) return;
    const updated = map.zoneMarkers.map((m) =>
      m.id === selectedMarker.id ? { ...m, ...changes } : m
    );
    commitMapChange({
      ...map,
      zoneMarkers: updated,
    });
  };

  // Summary counts (updates live during vertex drag)
  const intersectionCount = useMemo(
    () => countIntersections(wireTool.effectiveRoadSegments),
    [wireTool.effectiveRoadSegments]
  );
  const entrances = useMemo(() => map.zoneMarkers.filter((m) => m.type === 'entrance'), [map.zoneMarkers]);
  const exits = useMemo(() => map.zoneMarkers.filter((m) => m.type === 'exit'), [map.zoneMarkers]);
  const dropoffs = useMemo(() => map.zoneMarkers.filter((m) => m.type === 'dropoff'), [map.zoneMarkers]);

  // Viewport cursor CSS
  const getCursorClass = () => {
    if (isPanning || markerDrag) return 'cursor-grabbing';
    if (isSpacePressed) return 'cursor-grab';
    if (calibrationStep !== 'idle') return 'cursor-crosshair';
    if (activeTool === 'road') return 'cursor-crosshair';
    if (activeTool === 'erase') return 'cursor-pointer';
    return 'cursor-default';
  };



  return (
    <div className="flex-1 flex w-full h-[calc(100vh-48px)] overflow-hidden select-none">
      {/* 1. Left utility sidebar (200px width, 16px padding, 20px section spacing) */}
      <aside className="w-[200px] shrink-0 bg-white border-r border-[#E2E6EF] p-4 flex flex-col justify-between overflow-y-auto z-20 select-none">
        <div className="flex flex-col space-y-5">
          {/* Tools Section */}
          <div className="flex flex-col space-y-3">
            <h2 className="text-[16px] font-medium text-[#111C2D]">Tools</h2>
            <div className="flex flex-col gap-2" id="tools-group">
              {/* Road Tool (36px tall) */}
              <button
                type="button"
                onClick={() => {
                  setActiveTool('road');
                  setSelectedRoadId(null);
                  setSelectedMarkerId(null);
                }}
                className={`flex items-center gap-2.5 px-3 h-9 rounded-lg text-left transition-colors cursor-pointer text-[13px] ${
                  activeTool === 'road'
                    ? 'bg-[#254B98] text-white font-medium'
                    : 'text-[#111C2D] hover:bg-[#F5F6F8]'
                }`}
                title="Click points, double-click to finish road"
              >
                <Edit3 size={16} />
                <span>Road</span>
              </button>

              {/* Select Tool (36px tall) */}
              <button
                type="button"
                onClick={() => {
                  setActiveTool('select');
                  wireTool.setActiveRoadPoints([]);
                }}
                className={`flex items-center gap-2.5 px-3 h-9 rounded-lg text-left transition-colors cursor-pointer text-[13px] ${
                  activeTool === 'select'
                    ? 'bg-[#254B98] text-white font-medium'
                    : 'text-[#111C2D] hover:bg-[#F5F6F8]'
                }`}
                title="Select roads or markers to inspect"
              >
                <MousePointer size={16} />
                <span>Select</span>
              </button>

              {/* Erase Tool (36px tall) */}
              <div className="flex flex-col space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTool('erase');
                    wireTool.setActiveRoadPoints([]);
                  }}
                  className={`flex items-center gap-2.5 px-3 h-9 rounded-lg text-left transition-colors cursor-pointer text-[13px] w-full ${
                    activeTool === 'erase'
                      ? 'bg-[#254B98] text-white font-medium'
                      : 'text-[#111C2D] hover:bg-[#F5F6F8]'
                  }`}
                  title="Click a road or marker to delete it"
                >
                  <Eraser size={16} />
                  <span>Erase</span>
                </button>
                <span className="text-[12px] text-[#6B7A99] px-1 leading-snug">
                  Click a road or marker to delete it.
                </span>
              </div>

              {/* Split Tool (36px tall) */}
              <button
                type="button"
                onClick={() => {
                  setActiveTool('split');
                  wireTool.setActiveRoadPoints([]);
                }}
                className={`flex items-center gap-2.5 px-3 h-9 rounded-lg text-left transition-colors cursor-pointer text-[13px] ${
                  activeTool === 'split'
                    ? 'bg-[#254B98] text-white font-medium'
                    : 'text-[#111C2D] hover:bg-[#F5F6F8]'
                }`}
                title="Click on a road to split at an intersection node"
              >
                <Split size={16} />
                <span>Split</span>
              </button>
            </div>
          </div>

          {/* Zone markers section (36px tall, 8px gaps) */}
          <div className="flex flex-col space-y-3">
            <h2 className="text-[16px] font-medium text-[#111C2D]">Zone markers</h2>
            <div className="flex flex-col gap-2">
              {/* Entrance Marker */}
              <button
                type="button"
                onClick={() => {
                  setActiveTool('entrance');
                  wireTool.setActiveRoadPoints([]);
                }}
                className={`flex items-center gap-2.5 px-3 h-9 rounded-lg text-left transition-colors border border-dashed cursor-pointer text-[13px] ${
                  activeTool === 'entrance'
                    ? 'bg-[#254B98]/10 border-[#254B98] font-medium'
                    : 'text-[#111C2D] border-gray-200 hover:bg-[#F5F6F8]'
                }`}
                title="Click to place entrance on map"
              >
                <LogIn size={16} className="text-[#254B98] shrink-0" />
                <span>Entrance</span>
              </button>

              {/* Exit Marker */}
              <button
                type="button"
                onClick={() => {
                  setActiveTool('exit');
                  wireTool.setActiveRoadPoints([]);
                }}
                className={`flex items-center gap-2.5 px-3 h-9 rounded-lg text-left transition-colors border border-dashed cursor-pointer text-[13px] ${
                  activeTool === 'exit'
                    ? 'bg-[#25A76B]/10 border-[#25A76B] font-medium'
                    : 'text-[#111C2D] border-gray-200 hover:bg-[#F5F6F8]'
                }`}
                title="Click to place exit on map"
              >
                <LogOut size={16} className="text-[#25A76B] shrink-0" />
                <span>Exit</span>
              </button>

              {/* Drop-off Marker */}
              <button
                type="button"
                onClick={() => {
                  setActiveTool('dropoff');
                  wireTool.setActiveRoadPoints([]);
                }}
                className={`flex items-center gap-2.5 px-3 h-9 rounded-lg text-left transition-colors border border-dashed cursor-pointer text-[13px] ${
                  activeTool === 'dropoff'
                    ? 'bg-[#F59E0B]/10 border-[#F59E0B] font-medium'
                    : 'text-[#111C2D] border-gray-200 hover:bg-[#F5F6F8]'
                }`}
                title="Click to place drop-off loop on map"
              >
                <CarPersonIcon size={17} className="text-[#F59E0B] shrink-0" />
                <span>Drop-off</span>
              </button>
            </div>

            {/* Placed Zone Markers List */}
            {map.zoneMarkers.length > 0 && (
              <div className="flex flex-col space-y-2 pt-3 border-t border-[#E2E6EF]">
                <span className="text-[12px] text-[#6B7A99] font-medium">Placed markers</span>
                <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto pr-0.5">
                  {map.zoneMarkers.map((marker) => (
                    <button
                      key={marker.id}
                      type="button"
                      onClick={() => {
                        setSelectedMarkerId(marker.id);
                        setSelectedRoadId(null);
                        setActiveTool('select');
                      }}
                      className={`flex items-center gap-2 px-2.5 h-9 rounded-lg text-left text-[12px] transition-colors cursor-pointer ${
                        selectedMarkerId === marker.id
                          ? 'bg-[#254B98]/10 text-[#254B98] font-medium border border-[#254B98]/30'
                          : 'text-[#111C2D] hover:bg-[#F5F6F8] border border-transparent'
                      }`}
                      title={`Inspect ${marker.name}`}
                    >
                      {marker.type === 'entrance' ? (
                        <LogIn size={15} className="text-[#254B98] shrink-0" />
                      ) : marker.type === 'exit' ? (
                        <LogOut size={15} className="text-[#25A76B] shrink-0" />
                      ) : (
                        <CarPersonIcon size={15} className="text-[#F59E0B] shrink-0" />
                      )}
                      <span className="truncate">{marker.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Layers section at bottom */}
        <div className="pt-4 border-t border-[#E2E6EF] flex flex-col space-y-3">
          <h2 className="text-[16px] font-medium text-[#111C2D]">Layers</h2>
          <label className="flex items-center justify-between cursor-pointer py-1">
            <span className="text-[13px] text-[#111C2D]">Reference image</span>
            <input
              type="checkbox"
              checked={showReferenceImage}
              onChange={(e) => setShowReferenceImage(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-8 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#25A76B] relative" />
          </label>

          <label className="flex items-center justify-between cursor-pointer py-1">
            <span className="text-[13px] text-[#111C2D]">Road network</span>
            <input
              type="checkbox"
              checked={showRoadNetwork}
              onChange={(e) => setShowRoadNetwork(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-8 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#25A76B] relative" />
          </label>

          {/* Show lengths toggle */}
          <label className="flex items-center justify-between cursor-pointer py-1">
            <span className="text-[13px] text-[#111C2D]">Show lengths</span>
            <input
              type="checkbox"
              checked={showLengths}
              onChange={(e) => setShowLengths(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-8 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#25A76B] relative" />
          </label>
        </div>

        {/* Layout actions at bottom of left panel */}
        <div className="pt-3 border-t border-[#E2E6EF] flex flex-col space-y-2">
          <button
            type="button"
            onClick={() => setShowNewLayoutConfirm(true)}
            className="w-full h-9 px-3 rounded-lg bg-blue-50 text-[#254B98] hover:bg-blue-100 border border-blue-200 text-[12px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            title="Start a blank layout while preserving run history"
          >
            <Plus size={15} />
            <span>New layout</span>
          </button>
          <button
            type="button"
            onClick={() => setShowResetConfirm(true)}
            className="w-full h-9 px-3 rounded-lg text-center text-gray-500 hover:text-red-600 hover:border-red-200 border border-[#E2E6EF] transition-colors text-[12px] font-medium cursor-pointer"
          >
            Reset all data
          </button>
        </div>
      </aside>

      {/* 2. Center fluid canvas viewport */}
      <main className="flex-1 min-w-0 relative bg-[#F5F6F8] overflow-hidden flex flex-col justify-between">
        {/* Top floating canvas toolbar */}
        <div className="absolute top-2.5 right-2.5 z-30 flex items-center gap-1 bg-white/95 backdrop-blur p-1 rounded-lg border border-[#E2E6EF] shadow-sm">
          <button
            type="button"
            onClick={() => zoomAroundCenter(false)}
            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 text-[#111C2D] cursor-pointer"
            title="Zoom out"
          >
            <Minus size={16} />
          </button>
          <span className="px-2 font-medium text-[#111C2D] text-[12px] tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => zoomAroundCenter(true)}
            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 text-[#111C2D] cursor-pointer"
            title="Zoom in"
          >
            <Plus size={16} />
          </button>
          <div className="w-px h-4 bg-gray-200 mx-0.5" />
          <button
            type="button"
            onClick={() => fitToPanel()}
            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 text-[#111C2D] cursor-pointer"
            title="Fit map to screen"
          >
            <Maximize2 size={16} />
          </button>
        </div>

        {/* Floating Canvas Legend (top-left) */}
        <div className="absolute top-3 left-3 z-30 bg-white/95 backdrop-blur px-3.5 py-2.5 rounded-lg border border-[#E2E6EF] shadow-sm flex flex-col gap-2 pointer-events-none">
          <span className="text-[12px] font-medium text-[#6B7A99]">Road access & flow</span>
          <div className="flex items-center gap-2">
            <div className="w-5 h-2.5 rounded-sm bg-[#3B4658] border border-white flex items-center justify-center shrink-0" />
            <span className="text-[#111C2D] text-[12px]">Shared (solid)</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="20" height="8" className="shrink-0 overflow-visible">
              <line x1="0" y1="4" x2="20" y2="4" stroke="#2563EB" strokeWidth="3" strokeDasharray="6 3" strokeLinecap="round" />
            </svg>
            <span className="text-[#111C2D] text-[12px]">Sticker-only (blue dash)</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="20" height="8" className="shrink-0 overflow-visible">
              <line x1="0" y1="4" x2="20" y2="4" stroke="#D97706" strokeWidth="3" strokeDasharray="2 3" strokeLinecap="round" />
            </svg>
            <span className="text-[#111C2D] text-[12px]">Non-sticker (orange dot)</span>
          </div>
          <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
            <svg width="20" height="10" className="shrink-0 overflow-visible">
              <rect x="0" y="1" width="20" height="8" rx="2" fill="#3B4658" />
              <path d="M 6 3 L 9 5 L 6 7" fill="none" stroke="#FFFFFF" strokeWidth="1.3" opacity="0.85" />
              <path d="M 12 3 L 15 5 L 12 7" fill="none" stroke="#FFFFFF" strokeWidth="1.3" opacity="0.85" />
            </svg>
            <span className="text-[#111C2D] text-[12px]">One-way (chevrons)</span>
          </div>
        </div>

        {/* Calibration Instruction Banner (PRD 3.1.9) */}
        {calibrationStep !== 'idle' && calibrationStep !== 'dialog' && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 bg-white/95 backdrop-blur px-4 py-2 rounded-lg border border-[#254B98] shadow-md flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-[#254B98] animate-ping" />
            <span className="text-[13px] font-medium text-[#111C2D]">
              {calibrationStep === 'pick-a'
                ? 'Step 1 of 2: Click point A on the reference image'
                : 'Step 2 of 2: Click point B on the reference image'}
            </span>
            <button
              type="button"
              onClick={cancelCalibration}
              className="px-2.5 py-1 rounded-lg border border-gray-300 hover:border-red-300 hover:bg-red-50 text-red-600 text-[12px] font-medium cursor-pointer transition-colors"
            >
              Cancel (Esc)
            </button>
          </div>
        )}

        {/* Canvas Grid Unit Tag (PRD 3.1.9) */}
        <div className="absolute top-3 left-64 z-30 pointer-events-none">
          <span className="px-2.5 py-1.5 rounded-lg bg-white/95 backdrop-blur text-[12px] font-medium text-[#6B7A99] border border-[#E2E6EF] shadow-sm flex items-center gap-2">
            <span className="w-3 h-3 border border-[#254B98] bg-[#254B98]/10 rounded-xs inline-block" />
            <span>1 cell = {currentCellMeters} m</span>
          </span>
        </div>

        {/* Interactive Drawing Viewport */}
        <div
          ref={canvasContainerRef}
          className={`flex-1 relative w-full h-full overflow-hidden select-none ${getCursorClass()}`}
        >
          {/* Single drawing <svg> filling container with NO viewBox and NO marker definitions */}
          <svg
            ref={svgRef}
            className="absolute inset-0 w-full h-full overflow-hidden"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onPointerLeave={handlePointerLeave}
            onClick={handleCanvasClick}
            onDoubleClick={wireTool.handleWireDoubleClick}
            onContextMenu={wireTool.handleContextMenu}
          >
            <defs>
              <pattern id="setupGridPattern" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#E2E6EF" strokeWidth="0.75" />
              </pattern>
            </defs>

            {/* Unified World Group */}
            <g id="world" transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
              {/* World boundary & canvas background */}
              <rect x="0" y="0" width={worldWidth} height={worldHeight} fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="1" />

              {/* Grid inside world group (20-unit cells) */}
              <rect x="0" y="0" width={worldWidth} height={worldHeight} fill="url(#setupGridPattern)" pointerEvents="none" />

              {/* Labeled grid scale marker in world top-left */}
              <g id="layer-grid-label" pointerEvents="none" opacity="0.75">
                <rect x="0" y="0" width="20" height="20" fill="rgba(37, 75, 152, 0.08)" stroke="#254B98" strokeWidth="0.75" />
                <text x="24" y="15" fill="#6B7A99" fontSize="12" fontWeight="500">
                  1 cell = {currentCellMeters} m
                </text>
              </g>

              {/* 1. Reference Image Layer */}
              {showReferenceImage && referenceImageUrl && (
                <g id="layer-reference-image" pointerEvents="none">
                  <image
                    href={referenceImageUrl}
                    x="0"
                    y="0"
                    width={worldWidth}
                    height={worldHeight}
                    preserveAspectRatio="none"
                    opacity="0.85"
                  />
                </g>
              )}

              {/* 2. Road Network Layer (Edge lines, solid asphalt, chevrons, lengths) */}
              {showRoadNetwork && (
                <RoadLayerMemo
                  roads={wireTool.effectiveRoadSegments}
                  selectedRoadId={selectedRoadId}
                  activeTool={activeTool}
                  showLengths={showLengths}
                  metersPerUnit={metersPerUnit}
                  zoom={zoom}
                  onRoadSelect={handleRoadSelect}
                  onRoadSplit={handleRoadSplit}
                  onRoadErase={handleRoadErase}
                  onBendErase={wireTool.removeBendVertex}
                />
              )}

              {/* 3. Zone Markers Layer */}
              {showRoadNetwork && (
                <MarkerLayerMemo
                  markers={displayMarkers}
                  selectedMarkerId={selectedMarkerId}
                  draggedMarkerId={markerDrag ? markerDrag.id : null}
                  activeTool={activeTool}
                  zoom={zoom}
                  onMarkerSelect={handleMarkerSelect}
                  onMarkerErase={handleMarkerErase}
                  onMarkerPointerDown={handleMarkerPointerDown}
                />
              )}

              {/* 4. Selected Road Edit Handles (Vertex drag & Midpoint '+' handles) */}
              {activeTool === 'select' && selectedRoad && selectedRoad.points.length >= 2 && (
                <g id="layer-selected-road-handles">
                  {/* Midpoint '+' handles */}
                  {selectedRoad.points.slice(0, -1).map((p1, idx) => {
                    const p2 = selectedRoad.points[idx + 1];
                    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
                    const r = 6 / zoom;
                    const bar = 3 / zoom;
                    const strokeW = 1.5 / zoom;
                    return (
                      <g
                        key={`mid-plus-${idx}`}
                        transform={`translate(${mid.x}, ${mid.y})`}
                        className="cursor-pointer group"
                        onPointerDown={(e) => wireTool.startMidpointPlusDrag(selectedRoad, idx, mid, e)}
                        onPointerMove={(e) => {
                          const pt = getCanvasCoords(e.clientX, e.clientY);
                          wireTool.handleEditPointerMove(pt);
                        }}
                        onPointerUp={(e) => wireTool.handleEditPointerUp(e)}
                      >
                        <circle
                          r={r}
                          fill="#FFFFFF"
                          stroke="#254B98"
                          strokeWidth={strokeW}
                          className="group-hover:fill-blue-50 transition-colors"
                        />
                        <line
                          x1={-bar}
                          y1={0}
                          x2={bar}
                          y2={0}
                          stroke="#254B98"
                          strokeWidth={strokeW}
                          strokeLinecap="round"
                        />
                        <line
                          x1={0}
                          y1={-bar}
                          x2={0}
                          y2={bar}
                          stroke="#254B98"
                          strokeWidth={strokeW}
                          strokeLinecap="round"
                        />
                      </g>
                    );
                  })}

                  {/* Round vertex handles */}
                  {selectedRoad.points.map((pt, idx) => {
                    const isEndpoint = idx === 0 || idx === selectedRoad.points.length - 1;
                    const isBeingDragged =
                      wireTool.editDragState?.roadId === selectedRoad.id &&
                      wireTool.editDragState.vertexIndex === idx;
                    const currPt =
                      isBeingDragged && wireTool.editDragState
                        ? wireTool.editDragState.currentPoint
                        : pt;
                    const r = (isEndpoint ? 6 : 5) / zoom;
                    const strokeW = 2 / zoom;

                    return (
                      <circle
                        key={`vertex-handle-${idx}`}
                        cx={currPt.x}
                        cy={currPt.y}
                        r={r}
                        fill="#FFFFFF"
                        stroke="#254B98"
                        strokeWidth={strokeW}
                        className="cursor-grab active:cursor-grabbing hover:scale-125 transition-transform"
                        onPointerDown={(e) => wireTool.startVertexDrag(selectedRoad, idx, e)}
                        onPointerMove={(e) => {
                          const cPt = getCanvasCoords(e.clientX, e.clientY);
                          wireTool.handleEditPointerMove(cPt);
                        }}
                        onPointerUp={(e) => wireTool.handleEditPointerUp(e)}
                      />
                    );
                  })}
                </g>
              )}

              {/* Drag Snap Target Indicator */}
              {wireTool.dragSnapTarget && wireTool.editDragState && (
                <g id="drag-snap-indicator" pointerEvents="none">
                  {wireTool.dragSnapTarget.type === 'road-body' ? (
                    <polygon
                      points={`${wireTool.dragSnapTarget.point.x},${wireTool.dragSnapTarget.point.y - 7} ${wireTool.dragSnapTarget.point.x + 7},${wireTool.dragSnapTarget.point.y} ${wireTool.dragSnapTarget.point.x},${wireTool.dragSnapTarget.point.y + 7} ${wireTool.dragSnapTarget.point.x - 7},${wireTool.dragSnapTarget.point.y}`}
                      fill="rgba(37, 167, 107, 0.2)"
                      stroke="#25A76B"
                      strokeWidth="2"
                    />
                  ) : (
                    <circle
                      cx={wireTool.dragSnapTarget.point.x}
                      cy={wireTool.dragSnapTarget.point.y}
                      r="7"
                      fill="none"
                      stroke="#25A76B"
                      strokeWidth="2"
                    />
                  )}
                </g>
              )}

              {/* 5. Topology Features: Junctions (>= 3 ends) and Open Ends */}
              {showRoadNetwork && (
                <g id="layer-topology-features" pointerEvents="none">
                  {wireTool.topology.junctions.map((pt, jIdx) => (
                    <circle
                      key={`junction-${jIdx}`}
                      cx={pt.x}
                      cy={pt.y}
                      r={roadWidthUnits(1, metersPerUnit) * 0.28}
                      fill="#1E293B"
                    />
                  ))}
                  {wireTool.topology.openEnds.map((pt, oIdx) => (
                    <circle
                      key={`open-end-${oIdx}`}
                      cx={pt.x}
                      cy={pt.y}
                      r={roadWidthUnits(1, metersPerUnit) * 0.35}
                      fill="none"
                      stroke="#EF4444"
                      strokeWidth={Math.max(1, roadWidthUnits(1, metersPerUnit) * 0.1)}
                    />
                  ))}
                </g>
              )}

              {/* 5. Active In-Progress Road Drawing Overlay with Lengths */}
              {wireTool.activeRoadPoints.length > 0 && wireTool.activeDrawingMetrics && (
                <g id="active-drawing-road" pointerEvents="none">
                  {/* Committed road path: edge line + asphalt */}
                  {wireTool.activeRoadPoints.length >= 2 && (
                    <>
                      <path
                        d={wireTool.activeRoadPoints
                          .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
                          .join(' ')}
                        fill="none"
                        stroke="#254B98"
                        strokeWidth={edgeLineWidthUnits(roadWidthUnits(1, metersPerUnit), metersPerUnit)}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity="0.4"
                      />
                      <path
                        d={wireTool.activeRoadPoints
                          .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
                          .join(' ')}
                        fill="none"
                        stroke="#3B4658"
                        strokeWidth={roadWidthUnits(1, metersPerUnit)}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </>
                  )}

                  {/* Rubber band line to live cursor or snap target */}
                  {wireTool.activeDrawingMetrics.targetPoint && (
                    <line
                      x1={wireTool.activeRoadPoints[wireTool.activeRoadPoints.length - 1].x}
                      y1={wireTool.activeRoadPoints[wireTool.activeRoadPoints.length - 1].y}
                      x2={wireTool.activeDrawingMetrics.targetPoint.x}
                      y2={wireTool.activeDrawingMetrics.targetPoint.y}
                      stroke="#254B98"
                      strokeWidth="2.5"
                      strokeDasharray="4 4"
                    />
                  )}

                  {/* Vertices */}
                  {wireTool.activeRoadPoints.map((p, idx) => (
                    <circle
                      key={idx}
                      cx={p.x}
                      cy={p.y}
                      r="4.5"
                      fill="#254B98"
                      stroke="#FFFFFF"
                      strokeWidth="2"
                    />
                  ))}

                  {/* Committed pieces midpoints length badges (constant on-screen size) */}
                  {wireTool.activeDrawingMetrics.pieces.map((pc, pIdx) => (
                    <g
                      key={`piece-len-${pIdx}`}
                      transform={`translate(${pc.x}, ${pc.y}) scale(${1 / zoom})`}
                      pointerEvents="none"
                    >
                      <rect
                        x="-24"
                        y="-9"
                        width="48"
                        height="18"
                        rx="3"
                        fill="#0F172A"
                        fillOpacity="0.88"
                        stroke="#334155"
                        strokeWidth="0.75"
                      />
                      <text
                        x="0"
                        y="4"
                        fill="#F8FAFC"
                        fontSize="12"
                        fontWeight="500"
                        textAnchor="middle"
                        fontFamily="Inter, sans-serif"
                      >
                        {pc.lenMeters.toFixed(1)} m
                      </text>
                    </g>
                  ))}

                  {/* Rubber-band length badge: segment length + running total (constant on-screen size) */}
                  {wireTool.activeDrawingMetrics.hasTarget && (
                    <g
                      transform={`translate(${wireTool.activeDrawingMetrics.rubberMidX}, ${wireTool.activeDrawingMetrics.rubberMidY}) scale(${1 / zoom})`}
                      pointerEvents="none"
                    >
                      <rect
                        x="-72"
                        y="-44"
                        width="144"
                        height="38"
                        rx="6"
                        fill="#0F172A"
                        fillOpacity="0.94"
                        stroke="#334155"
                        strokeWidth="1"
                      />
                      <text
                        x="0"
                        y="-26"
                        fill="#FFFFFF"
                        fontSize="12"
                        fontWeight="600"
                        textAnchor="middle"
                        fontFamily="Inter, sans-serif"
                      >
                        {wireTool.activeDrawingMetrics.rubberMeters.toFixed(1)} m
                      </text>
                      <text
                        x="0"
                        y="-11"
                        fill="#94A3B8"
                        fontSize="12"
                        fontWeight="500"
                        textAnchor="middle"
                        fontFamily="Inter, sans-serif"
                      >
                        (total {wireTool.activeDrawingMetrics.totalMeters.toFixed(1)} m)
                      </text>
                    </g>
                  )}
                </g>
              )}

              {/* 6. Snapping Target Indicator (Green ring for vertex/marker, diamond for road body) */}
              {wireTool.snapTarget && activeTool === 'road' && (
                <g id="snap-target-indicator" pointerEvents="none">
                  {wireTool.snapTarget.type === 'road-body' ? (
                    <polygon
                      points={`${wireTool.snapTarget.point.x},${wireTool.snapTarget.point.y - 7} ${wireTool.snapTarget.point.x + 7},${wireTool.snapTarget.point.y} ${wireTool.snapTarget.point.x},${wireTool.snapTarget.point.y + 7} ${wireTool.snapTarget.point.x - 7},${wireTool.snapTarget.point.y}`}
                      fill="rgba(37, 167, 107, 0.2)"
                      stroke="#25A76B"
                      strokeWidth="2"
                    />
                  ) : (
                    <circle
                      cx={wireTool.snapTarget.point.x}
                      cy={wireTool.snapTarget.point.y}
                      r="7"
                      fill="none"
                      stroke="#25A76B"
                      strokeWidth="2"
                    />
                  )}
                </g>
              )}

              {/* 6. Calibration Visual Overlay */}
              {calibrationStep !== 'idle' && (
                <g id="layer-calibration" pointerEvents="none">
                  {calibPointA && (
                    <g>
                      <circle cx={calibPointA.x} cy={calibPointA.y} r="6" fill="#254B98" stroke="#FFFFFF" strokeWidth="2" />
                      <circle cx={calibPointA.x} cy={calibPointA.y} r="14" fill="none" stroke="#254B98" strokeWidth="1.5" strokeDasharray="3 3" />
                      <rect x={calibPointA.x + 8} y={calibPointA.y - 18} width="20" height="16" rx="4" fill="#254B98" />
                      <text x={calibPointA.x + 18} y={calibPointA.y - 6} fill="#FFFFFF" fontSize="12" fontWeight="600" textAnchor="middle">A</text>
                    </g>
                  )}
                  {calibPointA && (calibPointB || mousePos) && (
                    <g>
                      <line
                        x1={calibPointA.x}
                        y1={calibPointA.y}
                        x2={calibPointB ? calibPointB.x : mousePos!.x}
                        y2={calibPointB ? calibPointB.y : mousePos!.y}
                        stroke="#254B98"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                      />
                      <rect
                        x={((calibPointA.x + (calibPointB ? calibPointB.x : mousePos!.x)) / 2) - 30}
                        y={((calibPointA.y + (calibPointB ? calibPointB.y : mousePos!.y)) / 2) - 10}
                        width="60"
                        height="18"
                        rx="4"
                        fill="#111C2D"
                        opacity="0.85"
                      />
                      <text
                        x={(calibPointA.x + (calibPointB ? calibPointB.x : mousePos!.x)) / 2}
                        y={((calibPointA.y + (calibPointB ? calibPointB.y : mousePos!.y)) / 2) + 3}
                        fill="#FFFFFF"
                        fontSize="12"
                        fontWeight="500"
                        textAnchor="middle"
                      >
                        {distance(calibPointA, calibPointB || mousePos!).toFixed(0)} px
                      </text>
                    </g>
                  )}
                  {calibPointB && (
                    <g>
                      <circle cx={calibPointB.x} cy={calibPointB.y} r="6" fill="#25A76B" stroke="#FFFFFF" strokeWidth="2" />
                      <circle cx={calibPointB.x} cy={calibPointB.y} r="14" fill="none" stroke="#25A76B" strokeWidth="1.5" strokeDasharray="3 3" />
                      <rect x={calibPointB.x + 8} y={calibPointB.y - 18} width="20" height="16" rx="4" fill="#25A76B" />
                      <text x={calibPointB.x + 18} y={calibPointB.y - 6} fill="#FFFFFF" fontSize="12" fontWeight="600" textAnchor="middle">B</text>
                    </g>
                  )}
                </g>
              )}

              {/* Crosshair dot that follows the cursor exactly */}
              <g id="cursor-crosshair" ref={crosshairGroupRef} pointerEvents="none" style={{ visibility: 'hidden' }}>
                <circle
                  ref={crosshairDotRef}
                  cx="0"
                  cy="0"
                  r="3.5"
                  fill="#254B98"
                  stroke="#FFFFFF"
                  strokeWidth="1.5"
                />
                <line x1="-8" y1="0" x2="8" y2="0" stroke="#254B98" strokeWidth="1" opacity="0.5" />
                <line x1="0" y1="-8" x2="0" y2="8" stroke="#254B98" strokeWidth="1" opacity="0.5" />
              </g>
            </g>
          </svg>
        </div>

        {/* Scale Bar (bottom-left) */}
        <div className="absolute bottom-3 left-3 z-30 pointer-events-auto">
          <ScaleBar metersPerUnit={metersPerUnit} screenPixelsPerUnit={zoom} />
        </div>

        {/* Calibration Dialog Modal (PRD 3.1.9) */}
        {calibrationStep === 'dialog' && calibPointA && calibPointB && (() => {
          const pixelDist = distance(calibPointA, calibPointB);
          const realDist = parseFloat(calibRealDistanceInput);
          const computedScale = !isNaN(realDist) && realDist > 0 && pixelDist > 0 ? realDist / pixelDist : null;
          const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

          return (
            <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-lg max-w-sm w-full p-5 shadow-xl border border-[#E2E6EF] flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                  <div className="flex items-center gap-2 text-[#254B98] font-medium text-[15px]">
                    <Ruler size={16} />
                    <span>Calibrate map scale</span>
                  </div>
                  <span className="text-[12px] text-[#6B7A99]">2 points marked</span>
                </div>
                <p className="text-[12px] text-[#6B7A99] leading-relaxed">
                  Measured on image: <strong className="text-[#111C2D] font-medium">{pixelDist.toFixed(1)} px</strong> between point A and point B.
                </p>
                {pixelDist < 20 && (
                  <div className="text-[12px] text-amber-700 bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-200/60 leading-snug flex items-center gap-1.5">
                    <AlertTriangle size={15} className="shrink-0" />
                    <span>Points are very close; accuracy will be low.</span>
                  </div>
                )}
                <div className="flex flex-col gap-1.5 mt-1">
                  <label className="text-[12px] font-medium text-[#111C2D]">Real distance in meters</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={calibRealDistanceInput}
                      onChange={(e) => setCalibRealDistanceInput(e.target.value)}
                      className="flex-1 h-9 px-3 bg-white border border-[#E2E6EF] rounded-lg text-[13px] text-[#111C2D] focus:outline-none focus:border-[#254B98]"
                      placeholder="e.g. 50"
                      autoFocus
                    />
                    <span className="text-[12px] text-[#6B7A99] font-medium">m</span>
                  </div>
                </div>
                {computedScale !== null && (() => {
                  const desc = describeScale(computedScale, bounds);
                  return (
                    <>
                      <div className="bg-blue-50 border border-blue-100 rounded-lg p-2.5 text-[12px] flex flex-col gap-1.5 text-[#254B98]">
                        <div className="flex justify-between items-center">
                          <span>Computed scale:</span>
                          <span className="font-mono font-medium">
                            {formatScale(computedScale)}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#254B98]/80 pt-1 border-t border-blue-200/50 flex flex-col gap-0.5">
                          <div>Map size: {fmt(desc.worldWidthM)} m x {fmt(desc.worldHeightM)} m</div>
                          <div>A car will be {fmt(desc.carLengthUnits)} units long</div>
                          <div>A 1-lane road will be {fmt(desc.laneWidthUnits)} units wide</div>
                        </div>
                      </div>

                      {(computedScale < 0.02 || computedScale > 2) && (
                        <div className="text-[12px] text-amber-700 bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-200/60 leading-snug flex items-start gap-1.5">
                          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                          <span>This scale looks unusual. Check the real distance, or pick two points farther apart.</span>
                        </div>
                      )}
                    </>
                  );
                })()}
                <div className="flex items-center justify-end gap-2 mt-2">
                  <button
                    type="button"
                    onClick={cancelCalibration}
                    className="h-9 px-4 rounded-lg border border-[#E2E6EF] text-[13px] font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyCalibration}
                    disabled={!parseFloat(calibRealDistanceInput) || parseFloat(calibRealDistanceInput) <= 0 || pixelDist <= 0}
                    className="h-9 px-4 rounded-lg bg-[#254B98] hover:bg-[#1d3b7a] text-white text-[13px] font-medium cursor-pointer disabled:opacity-50"
                  >
                    Apply scale
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* 3. Canvas bottom status bar */}
        <footer className="h-9 w-full bg-white border-t border-[#E2E6EF] px-4 flex items-center justify-between z-30 shrink-0 text-[12px] text-[#6B7A99]">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[#25A76B] animate-pulse" />
            <span className="font-medium text-[#111C2D]">System ready</span>
            {speedAdjustedNotice ? (
              <span className="text-[#254B98] ml-2 font-medium flex items-center gap-1.5">
                <span>Speed limits outside 5-15 km/h were adjusted.</span>
                <button
                  type="button"
                  onClick={dismissSpeedAdjustedNotice}
                  className="hover:text-red-500 cursor-pointer text-[#6B7A99] p-0.5 rounded transition-colors"
                  aria-label="Dismiss note"
                  title="Dismiss note"
                >
                  <X size={12} />
                </button>
              </span>
            ) : scaleNotification ? (
              <span className="text-[#254B98] ml-2 font-medium">
                {scaleNotification}
              </span>
            ) : calibrationStep !== 'idle' ? (
              <span className="text-[#254B98] ml-2">
                Calibrating scale: {calibrationStep === 'pick-a' ? 'Click point A' : 'Click point B'}
              </span>
            ) : activeTool === 'road' ? (
              <span className="text-[#254B98] ml-2 font-medium">
                Click to add a bend. Click a road, end or marker to connect. Double-click or Enter to finish. Esc to cancel.
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-3 text-[#6B7A99]">
            <span className="font-medium text-[#111C2D]">
              {hasReferenceImage
                ? `Scale: ${formatScale(metersPerUnit)}`
                : `Scale: 1 cell = ${currentCellMeters} m`}
            </span>
            <div className="w-px h-3.5 bg-gray-200" />
            <span className="tabular-nums">Zoom {Math.round(zoom * 100)}%</span>
          </div>
        </footer>
      </main>

      {/* 4. Right properties panel (300px width, ordered sections, pinned bottom action) */}
      <aside className="w-[300px] shrink-0 bg-white border-l border-[#E2E6EF] flex flex-col justify-between h-full z-20 select-none">
        {/* Scrollable upper sections: Map, Network summary, Spawn rates, Selected road or marker, Map file */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Section 1: Map (layout name, reference image, scale) */}
          <div className="flex flex-col space-y-3">
            <h2 className="text-[16px] font-medium text-[#111C2D]">Map</h2>

            {/* Layout name field */}
            <div className="flex flex-col space-y-1">
              <label className="text-[12px] text-[#6B7A99]" htmlFor="layout-name">
                Layout name
              </label>
              <input
                id="layout-name"
                type="text"
                value={map.layoutName}
                onChange={(e) => {
                  const val = e.target.value;
                  commitMapChange({ ...map, layoutName: val });
                  updateSettings({ layoutName: val });
                }}
                className="w-full h-9 px-3 bg-white border border-[#E2E6EF] rounded-lg text-[#111C2D] text-[13px] font-medium focus:outline-none focus:border-[#254B98]"
              />
            </div>

            {/* Reference image with Attach / Re-attach */}
            <div className="flex flex-col space-y-1.5">
              <span className="text-[12px] text-[#6B7A99]">Reference image</span>
              <div className="bg-[#F5F6F8] border border-[#E2E6EF] rounded-lg p-3 flex flex-col space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-col min-w-0">
                    <span
                      className="text-[#111C2D] font-mono text-[12px] truncate max-w-[170px]"
                      title={map.referenceImageName || map.sourceFileName || 'No image attached'}
                    >
                      {map.referenceImageName || map.sourceFileName || 'None'}
                    </span>
                    {(map.referenceImageName || map.sourceFileName) && imageResolutionText && (
                      <span className="text-[12px] text-[#6B7A99] font-mono mt-0.5">
                        {imageResolutionText}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-9 px-3 rounded-lg bg-white hover:bg-gray-100 text-[#254B98] border border-[#E2E6EF] text-[12px] font-medium transition-colors cursor-pointer shrink-0"
                    title="Attach or re-attach PNG or JPG reference image (200 KB – 5 MB)"
                  >
                    {map.referenceImageName ? 'Re-attach' : 'Attach'}
                  </button>
                </div>

                {outsideItemsCount > 0 && (
                  <p className="text-[12px] text-amber-700 bg-amber-50 px-2 py-1.5 rounded-lg border border-amber-200/60 leading-snug">
                    {outsideItemsCount === 1 ? '1 item is' : `${outsideItemsCount} items are`} outside the image area.
                  </p>
                )}

                {!referenceImageUrl && map.referenceImageName && (
                  <p className="text-[12px] text-amber-700 bg-amber-50 px-2 py-1 rounded-lg border border-amber-200/60 leading-snug">
                    Re-attach the image to see it
                  </p>
                )}

                {referenceImageUrl && (
                  <div className="flex items-center justify-between text-[12px] text-[#25A76B] pt-0.5">
                    <span className="font-medium">● Visible in session</span>
                    <button
                      type="button"
                      onClick={() => {
                        setReferenceImageUrl(null);
                        commitMapChange({
                          ...map,
                          referenceImageName: undefined,
                          sourceFileName: undefined,
                        });
                      }}
                      className="text-gray-400 hover:text-red-500 cursor-pointer"
                      title="Remove reference image"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg"
                onChange={handleFileUpload}
                className="hidden"
              />
              {uploadError && (
                <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-600 text-[12px] leading-snug flex items-start gap-1.5">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                  <span>{uploadError}</span>
                </div>
              )}
              {isUploading && (
                <span className="text-[12px] text-[#254B98]">Validating image...</span>
              )}
            </div>

            {/* Map scale section */}
            <div className="flex flex-col space-y-1.5">
              <span className="text-[12px] text-[#6B7A99]">Map scale</span>
              {hasReferenceImage ? (
                <div className="bg-[#F5F6F8] border border-[#E2E6EF] rounded-lg p-3 flex flex-col space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-[#111C2D]">
                      Scale: {formatScale(metersPerUnit)}
                    </span>
                    <button
                      type="button"
                      disabled={isSimulationActive}
                      onClick={() => {
                        if (isSimulationActive) return;
                        setCalibrationStep('pick-a');
                        setCalibPointA(null);
                        setCalibPointB(null);
                        setActiveTool('select');
                      }}
                      className="h-9 px-3 rounded-lg bg-[#254B98] hover:bg-[#1d3b7a] text-white text-[12px] font-medium transition-colors cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                      title={
                        isSimulationActive
                          ? 'Stop the simulation to change the scale'
                          : 'Calibrate scale by marking two points on the image'
                      }
                    >
                      Calibrate
                    </button>
                  </div>
                  <p className="text-[12px] text-[#6B7A99] leading-snug">
                    Mark two points on the image and enter the real distance in meters.
                  </p>
                </div>
              ) : (
                <div className="bg-[#F5F6F8] border border-[#E2E6EF] rounded-lg p-3 flex flex-col space-y-2">
                  <div className="flex flex-col space-y-1">
                    <label className="text-[12px] text-[#6B7A99]">Grid scale</label>
                    <div
                      className="relative"
                      title={isSimulationActive ? 'Stop the simulation to change the scale' : undefined}
                    >
                      <select
                        disabled={isSimulationActive}
                        value={gridMode === 'custom' ? 'custom' : String(currentCellMeters)}
                        onChange={(e) => handleGridScaleChange(e.target.value)}
                        className="w-full h-9 px-3 bg-white border border-[#E2E6EF] rounded-lg text-[13px] appearance-none focus:outline-none focus:border-[#254B98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-50"
                        title={isSimulationActive ? 'Stop the simulation to change the scale' : undefined}
                      >
                        <option value="5">1 cell = 5 m</option>
                        <option value="10">1 cell = 10 m (default)</option>
                        <option value="20">1 cell = 20 m</option>
                        <option value="50">1 cell = 50 m</option>
                        <option value="custom">Custom value...</option>
                      </select>
                      <span className="text-[12px] text-[#6B7A99] absolute right-3 top-2.5 pointer-events-none">
                        ▼
                      </span>
                    </div>
                  </div>

                  {gridMode === 'custom' && (
                    <div className="flex flex-col mt-1">
                      <div
                        className="flex items-center gap-2"
                        title={isSimulationActive ? 'Stop the simulation to change the scale' : undefined}
                      >
                        <input
                          type="number"
                          min="0.5"
                          max="200"
                          step="any"
                          disabled={isSimulationActive}
                          value={customCellInput}
                          onChange={(e) => {
                            setCustomCellInput(e.target.value);
                            setCustomCellError(null);
                          }}
                          onBlur={applyCustomCellInput}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              applyCustomCellInput();
                              e.currentTarget.blur();
                            }
                          }}
                          className={`w-full h-9 px-3 bg-white border ${
                            customCellError ? 'border-red-500' : 'border-[#E2E6EF]'
                          } rounded-lg text-[13px] focus:outline-none focus:border-[#254B98] disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-50`}
                          placeholder="Meters per cell"
                          title={isSimulationActive ? 'Stop the simulation to change the scale' : undefined}
                        />
                        <span className="text-[12px] text-[#6B7A99] shrink-0">m/cell</span>
                      </div>
                      {customCellError && (
                        <span className="text-[11px] text-red-600 mt-1">{customCellError}</span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[12px] text-[#6B7A99] pt-1">
                    <span className="font-medium text-[#111C2D]">1 grid cell = {currentCellMeters} m</span>
                    <span className="font-mono">({formatScale(metersPerUnit)})</span>
                  </div>
                </div>
              )}
            </div>

            {/* Default speed limit dropdown */}
            <div className="flex flex-col space-y-1">
              <label className="text-[12px] text-[#6B7A99]" htmlFor="speed-limit">
                Default speed limit
              </label>
              <div className="relative">
                <select
                  id="speed-limit"
                  value={settings.defaultSpeedLimit}
                  onChange={(e) =>
                    updateSettings({ defaultSpeedLimit: clampSpeedKmH(parseInt(e.target.value, 10)) })
                  }
                  className="w-full h-9 px-3 bg-white border border-[#E2E6EF] rounded-lg text-[#111C2D] text-[13px] appearance-none focus:outline-none focus:border-[#254B98] cursor-pointer"
                >
                  {SPEED_LIMIT_OPTIONS_KMH.map((speed) => (
                    <option key={speed} value={speed}>
                      {speed} km/h{speed === DEFAULT_SPEED_KMH ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
                <span className="text-[12px] text-[#6B7A99] absolute right-3 top-2.5 pointer-events-none">
                  ▼
                </span>
              </div>
            </div>

            {/* Vehicle mix control (settings.stickerShare) */}
            <div className="pt-1 pb-1">
              <VehicleMixControl disabled={isSimulationActive} />
            </div>

            {/* Vehicle geometry & gap */}
            <div className="flex flex-col space-y-1.5">
              <span className="text-[12px] text-[#6B7A99]">Vehicle geometry & gap</span>
              <div className="grid grid-cols-2 gap-2 bg-[#F5F6F8] border border-[#E2E6EF] rounded-lg p-3">
                <div className="flex flex-col space-y-1">
                  <label className="text-[12px] text-[#6B7A99]">Length</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.1"
                      min="1"
                      max="20"
                      value={settings.vehicleLengthMeters ?? 4.5}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 4.5;
                        updateSettings({ vehicleLengthMeters: val });
                      }}
                      className="w-full h-9 px-2 bg-white border border-[#E2E6EF] rounded-lg text-[13px] focus:outline-none focus:border-[#254B98]"
                    />
                    <span className="text-[12px] text-[#6B7A99]">m</span>
                  </div>
                </div>
                <div className="flex flex-col space-y-1">
                  <label className="text-[12px] text-[#6B7A99]">Standstill gap</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.1"
                      min="0.5"
                      max="10"
                      value={settings.standstillGapMeters ?? 2.0}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 2.0;
                        updateSettings({ standstillGapMeters: val });
                      }}
                      className="w-full h-9 px-2 bg-white border border-[#E2E6EF] rounded-lg text-[13px] focus:outline-none focus:border-[#254B98]"
                    />
                    <span className="text-[12px] text-[#6B7A99]">m</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Alert thresholds */}
            <div className="flex flex-col space-y-1.5">
              <span className="text-[12px] text-[#6B7A99]">Alert thresholds</span>
              <div className="bg-[#F5F6F8] border border-[#E2E6EF] rounded-lg p-3 flex flex-col space-y-2 text-[12px]">
                <div className="flex items-center justify-between">
                  <label className="text-[#6B7A99]" htmlFor="alert-wait-input">Wait threshold</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="alert-wait-input"
                      type="number"
                      min="10"
                      max="600"
                      step="5"
                      value={settings.alertWaitThresholdSec ?? 120}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 120;
                        updateSettings({ alertWaitThresholdSec: val });
                      }}
                      className="w-16 h-9 px-2 bg-white border border-[#E2E6EF] rounded-lg text-right font-medium text-[#111C2D] focus:outline-none focus:border-[#254B98]"
                    />
                    <span className="text-[#6B7A99]">s</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-[#6B7A99]" htmlFor="alert-util-input">Saturation threshold</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="alert-util-input"
                      type="number"
                      min="50"
                      max="100"
                      step="5"
                      value={settings.alertUtilThresholdPct ?? 80}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 80;
                        updateSettings({ alertUtilThresholdPct: val });
                      }}
                      className="w-16 h-9 px-2 bg-white border border-[#E2E6EF] rounded-lg text-right font-medium text-[#111C2D] focus:outline-none focus:border-[#254B98]"
                    />
                    <span className="text-[#6B7A99]">%</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-[#6B7A99]" htmlFor="alert-duration-input">Duration threshold</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="alert-duration-input"
                      type="number"
                      min="5"
                      max="180"
                      step="5"
                      value={settings.alertUtilDurationSec ?? 30}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 30;
                        updateSettings({ alertUtilDurationSec: val });
                      }}
                      className="w-16 h-9 px-2 bg-white border border-[#E2E6EF] rounded-lg text-right font-medium text-[#111C2D] focus:outline-none focus:border-[#254B98]"
                    />
                    <span className="text-[#6B7A99]">s</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-[#6B7A99]" htmlFor="alert-return-input">Recovery threshold</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="alert-return-input"
                      type="number"
                      min="20"
                      max="80"
                      step="5"
                      value={settings.alertReturnUtilPct ?? 60}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 60;
                        updateSettings({ alertReturnUtilPct: val });
                      }}
                      className="w-16 h-9 px-2 bg-white border border-[#E2E6EF] rounded-lg text-right font-medium text-[#111C2D] focus:outline-none focus:border-[#254B98]"
                    />
                    <span className="text-[#6B7A99]">%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Network summary */}
          <div className="flex flex-col space-y-3 pt-2 border-t border-[#E2E6EF]">
            <h2 className="text-[16px] font-medium text-[#111C2D]">Network summary</h2>
            <div className="p-3 rounded-lg bg-[#F5F6F8] border border-[#E2E6EF] flex flex-col space-y-3">
              <div className="grid grid-cols-2 gap-2 text-[13px] text-[#111C2D]">
                <div>
                  <span className="text-[12px] text-[#6B7A99] block">Road segments</span>
                  <span className="font-medium text-[#111C2D]">{map.roadSegments.length}</span>
                </div>
                <div>
                  <span className="text-[12px] text-[#6B7A99] block">Intersections</span>
                  <span className="font-medium text-[#111C2D]">{intersectionCount}</span>
                </div>
              </div>
              <div className="border-t border-[#E2E6EF] pt-2.5">
                <span className="text-[12px] text-[#6B7A99] font-medium block mb-2">Zone breakdown</span>
                <div className="flex flex-col space-y-2 text-[13px]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[#111C2D]">
                      <LogIn size={15} className="text-[#254B98] shrink-0" />
                      <span>Entrances:</span>
                    </div>
                    <span className="font-medium text-[#111C2D]">{entrances.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[#111C2D]">
                      <LogOut size={15} className="text-[#25A76B] shrink-0" />
                      <span>Exits:</span>
                    </div>
                    <span className="font-medium text-[#111C2D]">{exits.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[#111C2D]">
                      <CarPersonIcon size={16} className="text-[#F59E0B] shrink-0" />
                      <span>Drop-offs:</span>
                    </div>
                    <span className="font-medium text-[#111C2D]">{dropoffs.length}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Spawn rates */}
          <div className="flex flex-col space-y-3 pt-2 border-t border-[#E2E6EF]">
            <h2 className="text-[16px] font-medium text-[#111C2D]">Spawn rates</h2>
            <div className="flex flex-col space-y-3">
              {entrances.map((ent) => (
                <div
                  key={ent.id}
                  className="flex items-center justify-between gap-2 text-[#111C2D] text-[13px]"
                >
                  <span className="truncate max-w-[130px] font-medium" title={ent.name}>{ent.name}:</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="0"
                      max="120"
                      value={settings.spawnRates[ent.id] ?? 18}
                      onChange={(e) => {
                        const parsed = parseInt(e.target.value, 10);
                        const val = isNaN(parsed) ? 0 : Math.max(0, parsed);
                        updateSettings({
                          spawnRates: {
                            ...settings.spawnRates,
                            [ent.id]: val,
                          },
                        });
                      }}
                      className="w-16 h-9 px-2 text-center bg-white border border-[#E2E6EF] rounded-lg text-[13px] font-medium text-[#111C2D] focus:outline-none focus:border-[#254B98] focus-visible:ring-1 focus-visible:ring-[#254B98]"
                      aria-label={`Spawn rate for ${ent.name}`}
                    />
                    <span className="text-[12px] text-[#6B7A99]">veh/min</span>
                  </div>
                </div>
              ))}
              {entrances.length === 0 && (
                <span className="text-[12px] text-[#6B7A99] italic">
                  No entrances placed yet
                </span>
              )}
            </div>
          </div>

          {/* Section 4: Selected road or marker */}
          <div className="flex flex-col space-y-3 pt-2 border-t border-[#E2E6EF]">
            <h2 className="text-[16px] font-medium text-[#111C2D]">
              Selected road or marker
            </h2>

            {/* Selected Road Inspector */}
            {selectedRoad && (
              <div className="p-3 rounded-lg bg-blue-50/60 border border-blue-100 flex flex-col space-y-3">
                <span className="text-[13px] font-medium text-[#254B98] truncate">
                  {selectedRoad.name}
                </span>

                {/* Length & Queue capacity */}
                <div className="grid grid-cols-2 gap-2 bg-white rounded-lg p-2.5 border border-blue-100 text-[13px]">
                  <div className="flex flex-col">
                    <span className="text-[12px] text-[#6B7A99]">Length</span>
                    <span className="font-medium text-[#111C2D] tabular-nums">
                      {selectedRoadLengthMeters} m
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[12px] text-[#6B7A99]">Queue capacity</span>
                    <span
                      className="font-medium text-[#111C2D] tabular-nums"
                      title={`${selectedRoadLengthMeters}m / (${settings.vehicleLengthMeters ?? 4.5}m + ${settings.standstillGapMeters ?? 2.0}m) × ${selectedRoad.lanes || 1} lane(s)`}
                    >
                      {selectedRoadQueueCapacity} veh
                    </span>
                  </div>
                </div>

                {/* Flow direction toggle (One-way / Two-way) - 36px tall */}
                <div className="flex flex-col space-y-1.5">
                  <span className="text-[12px] text-[#6B7A99]">Flow direction</span>
                  <div className="grid grid-cols-2 gap-1.5 p-1 bg-gray-200/70 rounded-lg text-center">
                    <button
                      type="button"
                      onClick={() => updateSelectedRoad({ flowDirection: 'one-way' })}
                      className={`h-9 rounded-lg text-[13px] transition-colors cursor-pointer ${
                        selectedRoad.flowDirection === 'one-way'
                          ? 'bg-white text-[#254B98] font-medium'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      One-way
                    </button>
                    <button
                      type="button"
                      onClick={() => updateSelectedRoad({ flowDirection: 'two-way' })}
                      className={`h-9 rounded-lg text-[13px] transition-colors cursor-pointer ${
                        selectedRoad.flowDirection === 'two-way'
                          ? 'bg-white text-[#254B98] font-medium'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      Two-way
                    </button>
                  </div>

                  {/* Requirement 7: Reverse direction button for one-way roads */}
                  {selectedRoad.flowDirection === 'one-way' && (
                    <button
                      type="button"
                      onClick={() => {
                        const reversedPoints = [...selectedRoad.points].reverse();
                        updateSelectedRoad({ points: reversedPoints });
                      }}
                      className="h-9 w-full rounded-lg bg-white border border-[#E2E6EF] hover:bg-[#F5F6F8] text-[#111C2D] text-[13px] font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors mt-1.5"
                      title="Reverse the one-way travel direction"
                    >
                      <RotateCcw size={14} className="text-[#254B98]" />
                      <span>Reverse direction</span>
                    </button>
                  )}
                </div>

                {/* Access type selector */}
                <div className="flex flex-col space-y-1.5">
                  <span className="text-[12px] text-[#6B7A99]">Access type</span>
                  <div className="flex flex-col space-y-2">
                    <label className="flex items-center gap-2 text-[13px] text-[#111C2D] cursor-pointer">
                      <input
                        type="radio"
                        name="access_type"
                        checked={selectedRoad.accessType === 'shared'}
                        onChange={() => updateSelectedRoad({ accessType: 'shared' })}
                        className="text-[#254B98] focus:ring-0 w-4 h-4"
                      />
                      <span>Shared</span>
                    </label>
                    <label className="flex items-center gap-2 text-[13px] text-[#111C2D] cursor-pointer">
                      <input
                        type="radio"
                        name="access_type"
                        checked={selectedRoad.accessType === 'sticker-only'}
                        onChange={() => updateSelectedRoad({ accessType: 'sticker-only' })}
                        className="text-[#254B98] focus:ring-0 w-4 h-4"
                      />
                      <span>Sticker-only</span>
                    </label>
                    <label className="flex items-center gap-2 text-[13px] text-[#111C2D] cursor-pointer">
                      <input
                        type="radio"
                        name="access_type"
                        checked={selectedRoad.accessType === 'non-sticker-only'}
                        onChange={() => updateSelectedRoad({ accessType: 'non-sticker-only' })}
                        className="text-[#254B98] focus:ring-0 w-4 h-4"
                      />
                      <span>Non-sticker-only</span>
                    </label>
                  </div>
                </div>

                {/* Lanes field (1-3, default 1) - 36px tall buttons */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-blue-100">
                  <span className="text-[12px] text-[#6B7A99]">Lanes</span>
                  <div className="flex items-center gap-1.5">
                    {[1, 2, 3].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => updateSelectedRoad({ lanes: num })}
                        className={`w-9 h-9 rounded-lg text-[13px] font-medium transition-colors cursor-pointer ${
                          (selectedRoad.lanes || 1) === num
                            ? 'bg-[#254B98] text-white'
                            : 'bg-white text-[#111C2D] border border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Selected Zone Marker Inspector */}
            {selectedMarker && !selectedRoad && (
              <div className="p-3 rounded-lg bg-[#F5F6F8] border border-[#E2E6EF] flex flex-col space-y-3">
                <div className="flex items-center gap-2">
                  {selectedMarker.type === 'entrance' ? (
                    <LogIn size={16} className="text-[#254B98] shrink-0" />
                  ) : selectedMarker.type === 'exit' ? (
                    <LogOut size={16} className="text-[#25A76B] shrink-0" />
                  ) : (
                    <CarPersonIcon size={16} className="text-[#F59E0B] shrink-0" />
                  )}
                  <span className="text-[13px] font-medium text-[#111C2D] truncate">
                    {selectedMarker.name}
                  </span>
                </div>
                <div className="flex flex-col space-y-1">
                  <label className="text-[12px] text-[#6B7A99]">Marker name</label>
                  <input
                    type="text"
                    value={selectedMarker.name}
                    onChange={(e) => updateSelectedMarker({ name: e.target.value })}
                    className="w-full h-9 px-3 bg-white border border-[#E2E6EF] rounded-lg text-[13px] focus:outline-none focus:border-[#254B98]"
                  />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-[12px] text-[#6B7A99]">Type:</span>
                  <span className="text-[13px] font-medium capitalize text-[#111C2D]">{selectedMarker.type}</span>
                </div>
                {isSelectedMarkerFarFromRoads && (
                  <div className="text-[12px] text-amber-700 bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-200/60 leading-snug flex items-start gap-1.5">
                    <AlertTriangle size={14} className="text-[#F59E0B] shrink-0 mt-0.5" />
                    <span>No road within 6 m. Vehicles attach to the nearest road point.</span>
                  </div>
                )}
              </div>
            )}

            {/* Placeholder when no selection */}
            {!selectedRoad && !selectedMarker && (
              <div className="p-3.5 rounded-lg bg-[#F5F6F8] border border-[#E2E6EF] text-center text-[#6B7A99] text-[12px]">
                Click a road or marker to inspect properties
              </div>
            )}
          </div>

          {/* Section 5: Map file */}
          <div className="flex flex-col space-y-3 pt-2 border-t border-[#E2E6EF]">
            <h2 className="text-[16px] font-medium text-[#111C2D]">Map file</h2>

            {/* Import / Export JSON buttons (36px tall) */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="h-9 px-3 rounded-lg bg-white text-[#254B98] border border-[#E2E6EF] hover:bg-gray-50 text-[12px] font-medium transition-colors cursor-pointer text-center flex items-center justify-center"
              >
                Import (JSON)
              </button>
              <button
                type="button"
                onClick={handleExportJson}
                className="h-9 px-3 rounded-lg bg-white text-[#254B98] border border-[#E2E6EF] hover:bg-gray-50 text-[12px] font-medium transition-colors cursor-pointer text-center flex items-center justify-center"
              >
                Export (JSON)
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportJson}
                className="hidden"
              />
            </div>

            {/* Load Sample Map Button (36px tall) */}
            <button
              type="button"
              onClick={loadSampleMap}
              className="w-full h-9 px-3 rounded-lg bg-blue-50 text-[#254B98] hover:bg-blue-100 border border-blue-200 text-[12px] font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
              title="Creates a valid network: 2 entrances, 2 exits, 1 drop-off, 14 road segments"
            >
              <Sparkles size={15} />
              <span>Load sample map</span>
            </button>

            {/* New layout button */}
            <button
              type="button"
              onClick={() => setShowNewLayoutConfirm(true)}
              className="w-full h-9 px-3 rounded-lg bg-blue-50 text-[#254B98] hover:bg-blue-100 border border-blue-200 text-[12px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              title="Start a blank layout while preserving run history"
            >
              <Plus size={15} />
              <span>New layout</span>
            </button>

            {/* Reset all data button (36px tall) */}
            <button
              type="button"
              onClick={() => setShowResetConfirm(true)}
              className="w-full h-9 px-3 rounded-lg text-center text-gray-500 hover:text-red-600 hover:border-red-200 border border-[#E2E6EF] transition-colors text-[12px] font-medium cursor-pointer"
            >
              Reset all data
            </button>

            <p className="text-[12px] text-[#6B7A99] leading-snug">
              Use Export to back up your map or move it to another computer. Saved maps stay in this browser only.
            </p>
          </div>
        </div>

        {/* Pinned bottom: Save and go to simulation */}
        <div className="p-4 border-t border-[#E2E6EF] shrink-0 bg-white">
          <button
            type="button"
            onClick={() => setActiveTab('simulation')}
            className="w-full h-10 px-4 bg-[#25A76B] hover:bg-[#1f8c59] text-white rounded-lg text-[14px] font-medium flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <span>Save and go to simulation</span>
            <ArrowRight size={16} />
          </button>
        </div>
      </aside>

      {/* New Layout Confirmation Modal */}
      {showNewLayoutConfirm && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-sm w-full p-5 shadow-xl border border-[#E2E6EF] flex flex-col gap-3">
            <div className="flex items-center gap-2 text-[#254B98] font-medium text-[15px]">
              <Plus size={18} />
              <span>Start blank layout</span>
            </div>
            <p className="text-[12px] text-[#6B7A99] leading-relaxed">
              Start a blank layout? Roads and markers are cleared. Your run history stays in Results.
            </p>
            <div className="flex items-center justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => setShowNewLayoutConfirm(false)}
                className="h-9 px-4 rounded-lg border border-[#E2E6EF] text-[13px] font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleNewLayoutConfirm}
                className="h-9 px-4 rounded-lg bg-[#254B98] hover:bg-[#1d3b7a] text-white text-[13px] font-medium cursor-pointer"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-sm w-full p-5 shadow-xl border border-[#E2E6EF] flex flex-col gap-3">
            <div className="flex items-center gap-2 text-red-600 font-medium text-[15px]">
              <AlertTriangle size={18} />
              <span>Confirm data reset</span>
            </div>
            <p className="text-[12px] text-[#6B7A99] leading-relaxed">
              This erases the map, all settings and the whole run history. Use New layout if you only want a fresh map.
            </p>
            <div className="flex items-center justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="h-9 px-4 rounded-lg border border-[#E2E6EF] text-[13px] font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  stopSimulation();
                  resetAll();
                  setShowResetConfirm(false);
                }}
                className="h-9 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[13px] font-medium cursor-pointer"
              >
                Reset all
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
