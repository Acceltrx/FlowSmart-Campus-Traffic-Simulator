/**
 * FlowSmart - useWireTool Hook
 * TinkerCAD-style wire drawing and road editing hook.
 *
 * Implements:
 * Drawing:
 * - Snap priority: endpoint/vertex -> marker -> road body within 14 screen pixels (14 / zoom)
 * - Click to start: split road body if clicked on road line, snap to vertex/marker coordinates
 * - Click on empty space: add bend
 * - Connect and finish: click on vertex/marker/road body ends road (splits road body if needed)
 * - Dead end: double-click or Enter. Ignores e.detail > 1 and clicks within 3 screen pixels.
 * - Discards roads shorter than 4 units.
 * - Backspace or right-click removes last point; Esc cancels in-progress road or leaves tool.
 * - Shift locks next segment to 0, 45, or 90 degrees.
 * - Keeps Road tool active after road finishes.
 *
 * Editing:
 * - Vertex dragging with pointer capture, live preview, Esc to cancel, and single commit on release.
 * - Connected ends move together (all vertices at the same coordinate move with it).
 * - Snapping during drag within 14 screen pixels; dropping an endpoint on a road body splits that road.
 * - Midpoint '+' handles to insert a new bend and drag it.
 * - Bend removal for Erase tool.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Point, RoadSegment, ZoneMarker, MapConfig } from '../types/traffic';
import {
  SnapTarget,
  findSnapTarget,
  findSnapTargetForDrag,
  findConnectedVertices,
  splitRoadAt,
  constrainTo45Degrees,
  cleanConsecutiveDuplicatePoints,
  polylineLength,
  getNextSegmentNumber,
  formatSegmentName,
  findTopologyFeatures,
  TopologyFeatures,
} from '../utils/wireGeometry';
import { distance } from '../utils/mapGeometry';
import { clampSpeedKmH } from '../utils/scale';

export interface VertexDragState {
  roadId: string;
  vertexIndex: number;
  initialPoint: Point;
  currentPoint: Point;
  isEndpoint: boolean;
  connectedRoads: { roadId: string; vertexIndices: number[] }[];
  originalRoads: RoadSegment[];
  pointerId: number;
  isNewBend?: boolean;
}

interface UseWireToolParams {
  activeTool: string;
  setActiveTool: (tool: any) => void;
  map: MapConfig;
  commitMapChange: (updatedMap: MapConfig) => void;
  zoom: number;
  metersPerUnit: number;
  defaultSpeedLimit: number;
  worldWidth: number;
  worldHeight: number;
  selectedRoadId?: string | null;
  setSelectedRoadId: (id: string | null) => void;
  setSelectedMarkerId: (id: string | null) => void;
}

export function useWireTool({
  activeTool,
  setActiveTool,
  map,
  commitMapChange,
  zoom,
  metersPerUnit,
  defaultSpeedLimit,
  worldWidth,
  worldHeight,
  selectedRoadId,
  setSelectedRoadId,
  setSelectedMarkerId,
}: UseWireToolParams) {
  // Road creation state
  const [activeRoadPoints, setActiveRoadPoints] = useState<Point[]>([]);
  const [snapTarget, setSnapTarget] = useState<SnapTarget | null>(null);
  const [mousePos, setMousePos] = useState<Point | null>(null);
  const [isShiftPressed, setIsShiftPressed] = useState<boolean>(false);

  // Road vertex editing state
  const [editDragState, setEditDragState] = useState<VertexDragState | null>(null);
  const [dragSnapTarget, setDragSnapTarget] = useState<SnapTarget | null>(null);
  const [liveRoads, setLiveRoads] = useState<RoadSegment[] | null>(null);

  const activeRoadPointsRef = useRef<Point[]>([]);
  activeRoadPointsRef.current = activeRoadPoints;

  const mousePosRef = useRef<Point | null>(null);
  mousePosRef.current = mousePos;

  const snapTargetRef = useRef<SnapTarget | null>(null);
  snapTargetRef.current = snapTarget;

  const isShiftPressedRef = useRef<boolean>(false);
  isShiftPressedRef.current = isShiftPressed;

  const mapRef = useRef<MapConfig>(map);
  mapRef.current = map;

  const zoomRef = useRef<number>(zoom);
  zoomRef.current = zoom;

  const editDragStateRef = useRef<VertexDragState | null>(null);
  editDragStateRef.current = editDragState;

  const dragSnapTargetRef = useRef<SnapTarget | null>(null);
  dragSnapTargetRef.current = dragSnapTarget;

  const liveRoadsRef = useRef<RoadSegment[] | null>(null);
  liveRoadsRef.current = liveRoads;

  // Clamp coordinates to world boundaries
  const clampPoint = useCallback(
    (pt: Point): Point => ({
      x: Math.max(0, Math.min(worldWidth, Math.round(pt.x * 10) / 10)),
      y: Math.max(0, Math.min(worldHeight, Math.round(pt.y * 10) / 10)),
    }),
    [worldWidth, worldHeight]
  );

  // Finish and save road if valid
  const finishRoad = useCallback(
    (points: Point[], additionalSplits?: { removeId: string; newSegs: RoadSegment[] }) => {
      const cleaned = cleanConsecutiveDuplicatePoints(points);
      const totalLen = polylineLength(cleaned);

      let currentRoadSegments = [...mapRef.current.roadSegments];

      if (additionalSplits) {
        currentRoadSegments = currentRoadSegments.filter(
          (s) => s.id !== additionalSplits.removeId
        );
        currentRoadSegments.push(...additionalSplits.newSegs);
      }

      // Discard roads shorter than 4 units
      if (cleaned.length >= 2 && totalLen >= 4) {
        const nextNum = getNextSegmentNumber(currentRoadSegments);
        const roadName = formatSegmentName(nextNum);
        const uid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

        const newRoad: RoadSegment = {
          id: `seg-${uid}`,
          name: roadName,
          points: cleaned,
          flowDirection: 'two-way',
          accessType: 'shared',
          speedLimitKmH: clampSpeedKmH(defaultSpeedLimit),
          lanes: 1,
          capacity: 30,
        };

        currentRoadSegments.push(newRoad);
        commitMapChange({
          ...mapRef.current,
          roadSegments: currentRoadSegments,
        });

        setSelectedRoadId(newRoad.id);
        setSelectedMarkerId(null);
      } else if (additionalSplits) {
        commitMapChange({
          ...mapRef.current,
          roadSegments: currentRoadSegments,
        });
      }

      // Reset in-progress points. Tool stays active!
      setActiveRoadPoints([]);
      setSnapTarget(null);
    },
    [commitMapChange, defaultSpeedLimit, setSelectedRoadId, setSelectedMarkerId]
  );

  // Pop last point (Backspace / Right-click)
  const popPoint = useCallback(() => {
    setActiveRoadPoints((prev) => {
      if (prev.length <= 1) {
        return [];
      }
      return prev.slice(0, prev.length - 1);
    });
  }, []);

  // Update mouse position and evaluate snap target for drawing
  const handlePointerMove = useCallback(
    (rawCoords: Point, shiftHeld: boolean) => {
      setIsShiftPressed(shiftHeld);
      const threshold = 14 / zoomRef.current;
      const target = findSnapTarget(
        rawCoords,
        mapRef.current.roadSegments,
        mapRef.current.zoneMarkers,
        threshold,
        activeRoadPointsRef.current
      );
      setSnapTarget(target);

      let effectiveCoords = rawCoords;
      if (shiftHeld && activeRoadPointsRef.current.length > 0) {
        const lastPt = activeRoadPointsRef.current[activeRoadPointsRef.current.length - 1];
        effectiveCoords = constrainTo45Degrees(lastPt, rawCoords);
      }

      setMousePos(effectiveCoords);
    },
    []
  );

  // Handle canvas click for road drawing tool
  const handleWireClick = useCallback(
    (rawCoords: Point, e: React.MouseEvent) => {
      if (e.detail > 1) {
        return;
      }

      const currentPoints = activeRoadPointsRef.current;
      const currentSnap = snapTargetRef.current;

      if (currentPoints.length > 0) {
        const lastPt = currentPoints[currentPoints.length - 1];
        const screenDist = distance(rawCoords, lastPt) * zoomRef.current;
        if (screenDist < 3) {
          return;
        }
      }

      let targetCoord = currentSnap ? currentSnap.point : clampPoint(rawCoords);
      if (!currentSnap && e.shiftKey && currentPoints.length > 0) {
        const lastPt = currentPoints[currentPoints.length - 1];
        targetCoord = clampPoint(constrainTo45Degrees(lastPt, rawCoords));
      }

      // CASE A: Start of a new road
      if (currentPoints.length === 0) {
        if (currentSnap?.type === 'road-body' && currentSnap.road) {
          const { newSeg1, newSeg2 } = splitRoadAt(
            currentSnap.road,
            currentSnap.point,
            mapRef.current.roadSegments
          );

          const updatedRoads = mapRef.current.roadSegments
            .filter((s) => s.id !== currentSnap.road!.id)
            .concat([newSeg1, newSeg2]);

          commitMapChange({
            ...mapRef.current,
            roadSegments: updatedRoads,
          });

          setActiveRoadPoints([newSeg1.points[newSeg1.points.length - 1]]);
        } else {
          setActiveRoadPoints([targetCoord]);
        }
        return;
      }

      // CASE B: Already in progress -> Connect & Finish OR Add Bend
      if (currentSnap) {
        if (currentSnap.type === 'road-body' && currentSnap.road) {
          const { newSeg1, newSeg2 } = splitRoadAt(
            currentSnap.road,
            currentSnap.point,
            mapRef.current.roadSegments
          );
          const endPt = currentSnap.point;
          finishRoad([...currentPoints, endPt], {
            removeId: currentSnap.road.id,
            newSegs: [newSeg1, newSeg2],
          });
        } else {
          const endPt = currentSnap.point;
          finishRoad([...currentPoints, endPt]);
        }
      } else {
        setActiveRoadPoints((prev) => [...prev, targetCoord]);
      }
    },
    [clampPoint, commitMapChange, finishRoad]
  );

  // Handle double-click to finish road as dead end
  const handleWireDoubleClick = useCallback(() => {
    const currentPoints = activeRoadPointsRef.current;
    if (currentPoints.length >= 2) {
      finishRoad(currentPoints);
    } else {
      setActiveRoadPoints([]);
    }
  }, [finishRoad]);

  // Context menu (Right-click) handler
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (activeTool === 'road' && activeRoadPointsRef.current.length > 0) {
        e.preventDefault();
        popPoint();
      }
    },
    [activeTool, popPoint]
  );

  // Helper: updates live road array during vertex drag
  const updateLiveRoads = useCallback((currentPt: Point, dragInfo: VertexDragState) => {
    const baseRoads = dragInfo.originalRoads || mapRef.current.roadSegments;
    const updated = baseRoads.map((road) => {
      let ptsChanged = false;
      let newPts = road.points;

      // Check if main road being dragged
      if (road.id === dragInfo.roadId) {
        newPts = [...newPts];
        newPts[dragInfo.vertexIndex] = currentPt;
        ptsChanged = true;
      }

      // Check if any other vertex in this road shares the initial junction point
      const conn = dragInfo.connectedRoads.find((c) => c.roadId === road.id);
      if (conn) {
        if (!ptsChanged) newPts = [...newPts];
        for (const idx of conn.vertexIndices) {
          newPts[idx] = currentPt;
        }
        ptsChanged = true;
      }

      return ptsChanged ? { ...road, points: newPts } : road;
    });

    setLiveRoads(updated);
  }, []);

  // 1. Start dragging an existing vertex
  const startVertexDrag = useCallback(
    (road: RoadSegment, vertexIndex: number, e: React.PointerEvent) => {
      if (activeTool !== 'select') return;
      e.preventDefault();
      e.stopPropagation();

      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch (err) {}

      const initialPoint = { ...road.points[vertexIndex] };
      const allRoads = mapRef.current.roadSegments;
      const connected = findConnectedVertices(allRoads, initialPoint);
      const isEndpoint = vertexIndex === 0 || vertexIndex === road.points.length - 1;

      const dragState: VertexDragState = {
        roadId: road.id,
        vertexIndex,
        initialPoint,
        currentPoint: initialPoint,
        isEndpoint,
        connectedRoads: connected,
        originalRoads: allRoads,
        pointerId: e.pointerId,
        isNewBend: false,
      };

      editDragStateRef.current = dragState;
      setEditDragState(dragState);
      setDragSnapTarget(null);
      updateLiveRoads(initialPoint, dragState);
    },
    [activeTool, updateLiveRoads]
  );

  // 2. Click or drag a '+' midpoint handle to insert a new bend and move it
  const startMidpointPlusDrag = useCallback(
    (road: RoadSegment, segmentIndex: number, midpoint: Point, e: React.PointerEvent) => {
      if (activeTool !== 'select') return;
      e.preventDefault();
      e.stopPropagation();

      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch (err) {}

      const allRoads = mapRef.current.roadSegments;
      const newIndex = segmentIndex + 1;
      const newPoints = [
        ...road.points.slice(0, newIndex),
        { ...midpoint },
        ...road.points.slice(newIndex),
      ];

      const modifiedRoad = { ...road, points: newPoints };
      const updatedRoadsSnapshot = allRoads.map((r) => (r.id === road.id ? modifiedRoad : r));

      const dragState: VertexDragState = {
        roadId: road.id,
        vertexIndex: newIndex,
        initialPoint: { ...midpoint },
        currentPoint: { ...midpoint },
        isEndpoint: false,
        connectedRoads: [],
        originalRoads: allRoads, // Snapshot before insertion so Esc cleanly cancels
        pointerId: e.pointerId,
        isNewBend: true,
      };

      editDragStateRef.current = dragState;
      setEditDragState(dragState);
      setDragSnapTarget(null);
      setLiveRoads(updatedRoadsSnapshot);
    },
    [activeTool]
  );

  // 3. Pointer move while dragging a vertex
  const handleEditPointerMove = useCallback(
    (rawCoords: Point) => {
      const dragInfo = editDragStateRef.current;
      if (!dragInfo) return;

      const clamped = clampPoint(rawCoords);
      const threshold = 14 / zoomRef.current;

      // Exclude all moving vertices from snap detection
      const excludeList: { roadId: string; vertexIndex: number }[] = [
        { roadId: dragInfo.roadId, vertexIndex: dragInfo.vertexIndex },
      ];
      for (const conn of dragInfo.connectedRoads) {
        for (const idx of conn.vertexIndices) {
          excludeList.push({ roadId: conn.roadId, vertexIndex: idx });
        }
      }

      const snap = findSnapTargetForDrag(
        clamped,
        mapRef.current.roadSegments,
        mapRef.current.zoneMarkers,
        threshold,
        excludeList,
        dragInfo.roadId,
        dragInfo.vertexIndex
      );

      setDragSnapTarget(snap);
      const effectivePt = snap ? snap.point : clamped;

      editDragStateRef.current = {
        ...dragInfo,
        currentPoint: effectivePt,
      };
      setEditDragState((prev) => (prev ? { ...prev, currentPoint: effectivePt } : null));

      updateLiveRoads(effectivePt, dragInfo);
    },
    [clampPoint, updateLiveRoads]
  );

  // 4. Pointer release: commit ONE map change
  const handleEditPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const dragInfo = editDragStateRef.current;
      if (!dragInfo) return;

      try {
        e.currentTarget.releasePointerCapture(dragInfo.pointerId);
      } catch (err) {}

      const finalPt = dragInfo.currentPoint;
      const currentSnap = dragSnapTargetRef.current;

      let updatedRoads = (liveRoadsRef.current || mapRef.current.roadSegments).map((road) => {
        if (road.id === dragInfo.roadId) {
          const newPts = cleanConsecutiveDuplicatePoints(road.points);
          return { ...road, points: newPts };
        }
        const conn = dragInfo.connectedRoads.find((c) => c.roadId === road.id);
        if (conn) {
          const newPts = cleanConsecutiveDuplicatePoints(road.points);
          return { ...road, points: newPts };
        }
        return road;
      });

      // Requirement 4: Dropping an endpoint on another road's body splits that road there and connects it (use splitRoadAt)
      if (dragInfo.isEndpoint && currentSnap?.type === 'road-body' && currentSnap.road) {
        const targetRoad = updatedRoads.find((r) => r.id === currentSnap.road!.id);
        if (targetRoad) {
          const { newSeg1, newSeg2 } = splitRoadAt(targetRoad, finalPt, updatedRoads);
          const splitCoord = newSeg1.points[newSeg1.points.length - 1];

          updatedRoads = updatedRoads
            .filter((r) => r.id !== targetRoad.id)
            .concat([newSeg1, newSeg2]);

          // Ensure the dragged endpoint matches splitCoord exactly
          updatedRoads = updatedRoads.map((r) => {
            if (r.id === dragInfo.roadId) {
              const pts = [...r.points];
              const endpointIdx = dragInfo.vertexIndex === 0 ? 0 : pts.length - 1;
              pts[endpointIdx] = splitCoord;
              return { ...r, points: pts };
            }
            return r;
          });
        }
      }

      // Commit single map change
      commitMapChange({
        ...mapRef.current,
        roadSegments: updatedRoads,
      });

      editDragStateRef.current = null;
      setEditDragState(null);
      setDragSnapTarget(null);
      setLiveRoads(null);
    },
    [commitMapChange]
  );

  // 5. Cancel vertex drag (on Esc)
  const cancelEditDrag = useCallback(() => {
    const dragInfo = editDragStateRef.current;
    if (!dragInfo) return;

    editDragStateRef.current = null;
    setEditDragState(null);
    setDragSnapTarget(null);
    setLiveRoads(null);
  }, []);

  // 6. Erase a single bend vertex (not an endpoint)
  const removeBendVertex = useCallback(
    (roadId: string, vertexIndex: number) => {
      const road = mapRef.current.roadSegments.find((r) => r.id === roadId);
      if (!road) return;
      if (vertexIndex <= 0 || vertexIndex >= road.points.length - 1 || road.points.length <= 2) {
        return;
      }

      const newPoints = road.points.filter((_, idx) => idx !== vertexIndex);
      const cleaned = cleanConsecutiveDuplicatePoints(newPoints);
      if (cleaned.length < 2) return;

      const updatedRoads = mapRef.current.roadSegments.map((r) =>
        r.id === roadId ? { ...r, points: cleaned } : r
      );

      commitMapChange({
        ...mapRef.current,
        roadSegments: updatedRoads,
      });
    },
    [commitMapChange]
  );

  // Keyboard controls: Escape, Enter, Backspace, Shift
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isInput) return;

      if (e.key === 'Escape') {
        if (editDragStateRef.current) {
          e.preventDefault();
          cancelEditDrag();
          return;
        }
        if (activeTool === 'road') {
          if (activeRoadPointsRef.current.length > 0) {
            e.preventDefault();
            setActiveRoadPoints([]);
            setSnapTarget(null);
          } else {
            setActiveTool('select');
          }
        }
        return;
      }

      if (activeTool !== 'road') return;

      if (e.key === 'Shift') {
        setIsShiftPressed(true);
      } else if (e.key === 'Backspace') {
        if (activeRoadPointsRef.current.length > 0) {
          e.preventDefault();
          popPoint();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeRoadPointsRef.current.length >= 2) {
          finishRoad(activeRoadPointsRef.current);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftPressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [activeTool, cancelEditDrag, finishRoad, popPoint, setActiveTool]);

  // Clear in-progress road when tool changes away from 'road'
  useEffect(() => {
    if (activeTool !== 'road') {
      setActiveRoadPoints([]);
      setSnapTarget(null);
    }
  }, [activeTool]);

  // Calculate drawing metrics for preview line and length badges
  const activeDrawingMetrics = useMemo(() => {
    if (activeRoadPoints.length === 0) return null;

    const committedDist = polylineLength(activeRoadPoints);
    const committedMeters = committedDist * metersPerUnit;

    const currentTarget = snapTarget ? snapTarget.point : mousePos;
    let rubberDist = 0;
    let rubberMeters = 0;
    let rubberMidX = 0;
    let rubberMidY = 0;

    if (currentTarget && activeRoadPoints.length > 0) {
      const lastPt = activeRoadPoints[activeRoadPoints.length - 1];
      rubberDist = distance(lastPt, currentTarget);
      rubberMeters = rubberDist * metersPerUnit;
      rubberMidX = (lastPt.x + currentTarget.x) / 2;
      rubberMidY = (lastPt.y + currentTarget.y) / 2;
    }

    const totalMeters = committedMeters + rubberMeters;

    const pieces: { x: number; y: number; lenMeters: number }[] = [];
    for (let i = 0; i < activeRoadPoints.length - 1; i++) {
      const p1 = activeRoadPoints[i];
      const p2 = activeRoadPoints[i + 1];
      pieces.push({
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2,
        lenMeters: distance(p1, p2) * metersPerUnit,
      });
    }

    return {
      committedMeters,
      rubberMeters,
      rubberMidX,
      rubberMidY,
      totalMeters,
      pieces,
      hasTarget: Boolean(currentTarget),
      targetPoint: currentTarget,
    };
  }, [activeRoadPoints, mousePos, snapTarget, metersPerUnit]);

  // Effective road segments (live while dragging, committed otherwise)
  const effectiveRoadSegments = useMemo(() => {
    return liveRoads || map.roadSegments;
  }, [liveRoads, map.roadSegments]);

  // Calculate junctions (>= 3 road ends meet) and open ends (disconnected endpoints)
  const topology: TopologyFeatures = useMemo(() => {
    return findTopologyFeatures(effectiveRoadSegments, map.zoneMarkers);
  }, [effectiveRoadSegments, map.zoneMarkers]);

  return {
    activeRoadPoints,
    setActiveRoadPoints,
    snapTarget,
    mousePos,
    isShiftPressed,
    activeDrawingMetrics,
    topology,
    effectiveRoadSegments,
    editDragState,
    dragSnapTarget,
    startVertexDrag,
    startMidpointPlusDrag,
    handleEditPointerMove,
    handleEditPointerUp,
    cancelEditDrag,
    removeBendVertex,
    handlePointerMove,
    handleWireClick,
    handleWireDoubleClick,
    handleContextMenu,
    popPoint,
  };
}
