import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useQuery, useMutation } from 'convex/react';
// @ts-ignore
import { api } from '../../convex/_generated/api';
import L from 'leaflet';
import 'leaflet-rotate';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { calculateTrackCorners } from '../lib/math';
import { CompareModal } from '../components/RaceControl/CompareModal';
import { TrainingModal } from '../components/RaceControl/TrainingModal';
import {
  Radio,
  Download,
  Flame,
  GitCompare,
  Target,
  Activity,
  Zap,
  Clock,
} from 'lucide-react';

function buildMonotonicSpline(pts: { x: number; y: number }[]) {
  if (pts.length < 2) return '';
  let path = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const dx = p1.x - p0.x;
    const cp1x = p0.x + dx * 0.45;
    const cp1y = p0.y;
    const cp2x = p0.x + dx * 0.55;
    const cp2y = p1.y;
    path += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p1.x},${p1.y}`;
  }
  return path;
}

export default function RaceControl() {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<'scooter' | 'bike'>('scooter');
  const [selectedTrack, setSelectedTrack] = useState(location.state?.trackId || '');
  const [focusedDriver, setFocusedDriver] = useState<string | null>(null);
  const [notification, setNotification] = useState<{
    id: number;
    text: string;
    driverName: string;
  } | null>(null);

  // Feature States
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [showTrainingModal, setShowTrainingModal] = useState(false);
  const [compareDriverA, setCompareDriverA] = useState<string>('');
  const [compareDriverB, setCompareDriverB] = useState<string>('');
  const [trainingDriver, setTrainingDriver] = useState<string>('');
  const [trainingLapAId, setTrainingLapAId] = useState<string>('');
  const [trainingLapBId, setTrainingLapBId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'leaderboard' | 'all'>('leaderboard');

  const seenDriversRef = useRef<Set<string>>(new Set());

  // @ts-ignore
  const resequenceLapsMutation = useMutation(api.laps.resequenceLaps);
  useEffect(() => {
    resequenceLapsMutation().catch(console.error);
  }, [resequenceLapsMutation]);

  // @ts-ignore
  const rawTracks = useQuery(api.tracks.getTracks);
  const tracks = useMemo(() => rawTracks ?? [], [rawTracks]);
  // @ts-ignore
  const rawLaps = useQuery(api.laps.getTimingBoard, {
    trackId: selectedTrack || undefined,
    vehicleType: activeTab,
  });
  const laps = useMemo(() => rawLaps ?? [], [rawLaps]);
  // @ts-ignore
  const rawTelemetry = useQuery(api.telemetry.get);
  const telemetry = useMemo(() => rawTelemetry ?? [], [rawTelemetry]);

  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const heatmapLayerGroup = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<{
    [key: string]: { marker: L.Marker; target: L.LatLng; current: L.LatLng; heading: number };
  }>({});
  const rafRef = useRef<number | null>(null);

  // Focus Panel Map
  const focusMapRef = useRef<HTMLDivElement>(null);
  const focusLeafletMap = useRef<L.Map | null>(null);
  const focusMarkerRef = useRef<L.Marker | null>(null);
  const focusRafRef = useRef<number | null>(null);

  // Ideal Lap (Theoretical Best)
  const idealLapData = useMemo(() => {
    const validS1 = laps
      .map((l: any) => l.s1)
      .filter((v: any): v is number => typeof v === 'number' && v > 0);
    const validS2 = laps
      .map((l: any) => l.s2)
      .filter((v: any): v is number => typeof v === 'number' && v > 0);
    const validS3 = laps
      .map((l: any) => l.s3)
      .filter((v: any): v is number => typeof v === 'number' && v > 0);

    const minS1 = validS1.length > 0 ? Math.min(...validS1) : null;
    const minS2 = validS2.length > 0 ? Math.min(...validS2) : null;
    const minS3 = validS3.length > 0 ? Math.min(...validS3) : null;
    const idealLapTime = minS1 && minS2 && minS3 ? minS1 + minS2 + minS3 : null;

    return { minS1, minS2, minS3, idealLapTime };
  }, [laps]);

  // Auto-select first track
  useEffect(() => {
    if (!selectedTrack && tracks.length > 0) {
      setSelectedTrack(tracks[0]._id);
    }
  }, [tracks, selectedTrack]);

  // Initialize Global Map
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;

    // @ts-ignore
    leafletMap.current = L.map(mapRef.current, {
      zoomControl: false,
      rotate: true,
      touchRotate: true,
    } as any).setView([51.95, 20.15], 14);

    L.tileLayer('http://mt0.google.com/vt/lyrs=y&hl=pl&x={x}&y={y}&z={z}', {
      maxZoom: 24,
      maxNativeZoom: 21,
      className: 'map-tiles-dark',
    }).addTo(leafletMap.current);

    return () => {
      leafletMap.current?.remove();
      leafletMap.current = null;
    };
  }, []);

  // Update target positions from live Telemetry
  useEffect(() => {
    if (!leafletMap.current) return;
    const now = Date.now();
    const activeTelemetry = telemetry.filter(
      (t: any) => t.vehicleType === activeTab && now - (t.timestamp || 0) < 15000
    );

    // Notifications for joining session
    activeTelemetry.forEach((t: any) => {
      if (!seenDriversRef.current.has(t.driverName)) {
        seenDriversRef.current.add(t.driverName);
        setNotification({
          id: Date.now(),
          text: `Dołącza do sesji (Live)`,
          driverName: t.driverName,
        });
        setTimeout(() => setNotification(null), 4500);
      }
    });

    activeTelemetry.forEach((t: any) => {
      const heading = t.heading || 0;
      const html = `
        <div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);pointer-events:none;">
          <div style="background: rgba(5,7,12,0.92); border: 1.5px solid var(--f1-cyan); border-radius: 6px; padding: 3px 8px; color: white; font-size: 11px; font-weight: 800; white-space: nowrap; box-shadow: 0 0 12px rgba(0,240,255,0.35); font-family: var(--font-mono);">
            <strong style="color: var(--f1-cyan)">${t.driverName}</strong> · ${Math.round(t.speed)} km/h
          </div>
          <div style="width: 14px; height: 14px; margin-top: 2px; transform: rotate(${heading}deg); display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 0 8px var(--f1-cyan));">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--f1-cyan)">
              <polygon points="12,2 22,22 12,17 2,22" />
            </svg>
          </div>
        </div>
      `;
      const icon = L.divIcon({ html, className: '', iconSize: [120, 48] });
      const targetLatLng = L.latLng(t.lat, t.lon);

      if (markersRef.current[t._id]) {
        markersRef.current[t._id].target = targetLatLng;
        markersRef.current[t._id].heading = heading;
        markersRef.current[t._id].marker.setIcon(icon);
      } else {
        const marker = L.marker(targetLatLng, { icon }).addTo(leafletMap.current!);
        markersRef.current[t._id] = {
          marker,
          target: targetLatLng,
          current: targetLatLng,
          heading,
        };
      }
    });

    const currentIds = activeTelemetry.map((t: any) => t._id);
    Object.keys(markersRef.current).forEach((id) => {
      if (!currentIds.includes(id)) {
        leafletMap.current?.removeLayer(markersRef.current[id].marker);
        delete markersRef.current[id];
      }
    });
  }, [telemetry, activeTab]);

  // 60FPS Lerp Interpolation Loop for map markers
  useEffect(() => {
    const LERP = 0.12;
    const renderLoop = () => {
      Object.values(markersRef.current).forEach(({ marker, target, current }) => {
        const dLat = target.lat - current.lat;
        const dLng = target.lng - current.lng;
        current.lat += dLat * LERP;
        current.lng += dLng * LERP;
        marker.setLatLng(current);
      });
      rafRef.current = requestAnimationFrame(renderLoop);
    };
    rafRef.current = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafRef.current!);
  }, []);

  // Initialize and update Focus Map
  useEffect(() => {
    if (!focusedDriver || !focusMapRef.current) {
      if (focusLeafletMap.current) {
        focusLeafletMap.current.remove();
        focusLeafletMap.current = null;
        focusMarkerRef.current = null;
      }
      return;
    }

    if (!focusLeafletMap.current) {
      // @ts-ignore
      focusLeafletMap.current = L.map(focusMapRef.current, {
        zoomControl: false,
        rotate: true,
        touchRotate: true,
      } as any).setView([51.95, 20.15], 18);

      L.tileLayer('http://mt0.google.com/vt/lyrs=y&hl=pl&x={x}&y={y}&z={z}', {
        maxZoom: 24,
        maxNativeZoom: 21,
        className: 'map-tiles-dark',
      }).addTo(focusLeafletMap.current);

      const html = `<div style="width:20px;height:20px;background:var(--f1-green);border-radius:50%;border:3px solid white;box-shadow:0 0 16px var(--f1-green);"></div>`;
      const icon = L.divIcon({ html, className: '', iconSize: [20, 20] });
      focusMarkerRef.current = L.marker([51.95, 20.15], { icon }).addTo(focusLeafletMap.current);
    }

    const resizeTimer = setTimeout(() => {
      focusLeafletMap.current?.invalidateSize();
    }, 280);
    return () => clearTimeout(resizeTimer);
  }, [focusedDriver]);

  const focusedTelemetry = telemetry.find(
    (t: any) => t.driverName === focusedDriver && t.vehicleType === activeTab
  );
  const focusedLapData = laps.find((l: any) => l.driverName === focusedDriver) || {};

  useEffect(() => {
    if (!focusedDriver || !focusLeafletMap.current || !focusMarkerRef.current) return;

    let target = L.latLng(51.95, 20.15);
    if (focusedTelemetry) target = L.latLng(focusedTelemetry.lat, focusedTelemetry.lon);

    const current = focusMarkerRef.current.getLatLng();

    const renderLoop = () => {
      const LERP = 0.12;
      const dLat = target.lat - current.lat;
      const dLng = target.lng - current.lng;
      current.lat += dLat * LERP;
      current.lng += dLng * LERP;

      if (focusMarkerRef.current && focusLeafletMap.current) {
        focusMarkerRef.current.setLatLng(current);
        focusLeafletMap.current.panTo(current, { animate: false });
      }
      focusRafRef.current = requestAnimationFrame(renderLoop);
    };

    focusRafRef.current = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(focusRafRef.current!);
  }, [focusedTelemetry, focusedDriver]);

  const sortedLaps = useMemo(
    () => [...laps].sort((a: any, b: any) => a.lapTime - b.lapTime),
    [laps]
  );
  const bestLap = sortedLaps[0];

  const uniqueDrivers = useMemo(() => {
    const driverMap = new Map<string, any>();
    sortedLaps.forEach((lap: any) => {
      if (!driverMap.has(lap.driverName) || lap.lapTime < driverMap.get(lap.driverName).lapTime) {
        driverMap.set(lap.driverName, lap);
      }
    });
    return Array.from(driverMap.values());
  }, [sortedLaps]);

  const driverLaps = useMemo(() => {
    if (!trainingDriver) return [];
    const list = laps.filter((l: any) => l.driverName === trainingDriver);
    list.sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));
    return list;
  }, [laps, trainingDriver]);

  useEffect(() => {
    if (showTrainingModal && !trainingDriver && uniqueDrivers.length > 0) {
      setTrainingDriver(uniqueDrivers[0].driverName);
    }
  }, [showTrainingModal, uniqueDrivers, trainingDriver]);

  useEffect(() => {
    if (driverLaps.length > 0) {
      if (!trainingLapAId || !driverLaps.some((l: any) => l._id === trainingLapAId)) {
        setTrainingLapAId(driverLaps[0]._id);
      }
      if (!trainingLapBId || !driverLaps.some((l: any) => l._id === trainingLapBId)) {
        const sortedByTime = [...driverLaps].sort((a: any, b: any) => a.lapTime - b.lapTime);
        setTrainingLapBId(sortedByTime[0]._id);
      }
    }
  }, [driverLaps, trainingLapAId, trainingLapBId]);

  const displayedLaps = useMemo(() => {
    if (viewMode === 'leaderboard') return uniqueDrivers;
    return sortedLaps;
  }, [viewMode, uniqueDrivers, sortedLaps]);

  const sectorStats = useMemo(() => {
    const allS1 = laps.map((l: any) => l.s1).filter((v: any): v is number => typeof v === 'number' && v > 0);
    const allS2 = laps.map((l: any) => l.s2).filter((v: any): v is number => typeof v === 'number' && v > 0);
    const allS3 = laps.map((l: any) => l.s3).filter((v: any): v is number => typeof v === 'number' && v > 0);

    const overallS1 = allS1.length > 0 ? Math.min(...allS1) : null;
    const overallS2 = allS2.length > 0 ? Math.min(...allS2) : null;
    const overallS3 = allS3.length > 0 ? Math.min(...allS3) : null;

    const personalMap = new Map<string, { s1: number | null; s2: number | null; s3: number | null }>();

    laps.forEach((l: any) => {
      const name = l.driverName;
      if (!personalMap.has(name)) {
        personalMap.set(name, { s1: null, s2: null, s3: null });
      }
      const p = personalMap.get(name)!;
      if (typeof l.s1 === 'number' && l.s1 > 0 && (p.s1 === null || l.s1 < p.s1)) p.s1 = l.s1;
      if (typeof l.s2 === 'number' && l.s2 > 0 && (p.s2 === null || l.s2 < p.s2)) p.s2 = l.s2;
      if (typeof l.s3 === 'number' && l.s3 > 0 && (p.s3 === null || l.s3 < p.s3)) p.s3 = l.s3;
    });

    return { overallS1, overallS2, overallS3, personalMap };
  }, [laps]);

  const getSectorBadgeClass = (
    val: number | undefined | null,
    personalBest: number | null | undefined,
    overallBest: number | null | undefined
  ): string => {
    if (val === undefined || val === null || val <= 0) return 'sector-neutral';
    if (overallBest && val <= overallBest) return 'sector-purple';
    if (personalBest && val <= personalBest) return 'sector-green';
    return 'sector-yellow';
  };

  const activeTelemetryNow = telemetry.filter(
    (t: any) => t.vehicleType === activeTab && Date.now() - (t.timestamp || 0) < 15000
  );
  const activeDriverTelemetry =
    activeTelemetryNow.find((t: any) => t.driverName === bestLap?.driverName) ||
    activeTelemetryNow[0];
  const inProgressDrivers = activeTelemetryNow.filter(
    (t: any) => !sortedLaps.some((l: any) => l.driverName === t.driverName)
  );

  const selectedTrackTelemetry = useMemo(
    () => telemetry.find((t: any) => t.trackId === selectedTrack),
    [telemetry, selectedTrack]
  );

  // Heatmap rendering
  useEffect(() => {
    if (!leafletMap.current) return;
    if (!heatmapLayerGroup.current) {
      heatmapLayerGroup.current = L.layerGroup().addTo(leafletMap.current);
    }
    heatmapLayerGroup.current.clearLayers();

    if (!showHeatmap || !selectedTrack) return;

    const track = tracks.find((t: any) => t._id === selectedTrack);
    if (!track || !track.path || track.path.length < 2) return;

    const path = track.path;
    const corners = calculateTrackCorners(path);
    const cornerIndices = new Set(corners.map((c: any) => c.index));
    const liveGForce = selectedTrackTelemetry?.gForce || 0;

    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];

      let color = 'var(--f1-green)';
      let label = '🟢 Pełne Przyspieszenie';

      const isApproachingCorner = corners.some((c: any) => i >= c.index - 3 && i < c.index);
      const isAtApex = cornerIndices.has(i) || corners.some((c: any) => i === c.index);

      if (liveGForce < -0.25 || isApproachingCorner) {
        color = 'var(--f1-red)';
        label = '🔴 Strefa Hamowania';
      } else if (isAtApex) {
        color = 'var(--f1-yellow)';
        label = '🟡 Apex Zakrętu';
      }

      const segment = L.polyline([[p1.lat, p1.lon], [p2.lat, p2.lon]], {
        color,
        weight: 6,
        opacity: 0.88,
        lineCap: 'round',
      });
      segment.bindTooltip(label, { sticky: true });
      segment.addTo(heatmapLayerGroup.current);
    }
  }, [showHeatmap, selectedTrack, tracks, selectedTrackTelemetry?.gForce]);

  // Export session data
  const exportSession = useCallback(
    (format: 'csv' | 'json') => {
      if (format === 'json') {
        const dataStr =
          'data:text/json;charset=utf-8,' +
          encodeURIComponent(
            JSON.stringify(
              {
                track: tracks.find((t: any) => t._id === selectedTrack)?.name || 'Unknown',
                vehicleType: activeTab,
                laps,
                exportedAt: new Date().toISOString(),
              },
              null,
              2
            )
          );
        const anchor = document.createElement('a');
        anchor.href = dataStr;
        anchor.download = `flightdriving-session-${Date.now()}.json`;
        anchor.click();
      } else {
        const headers = [
          'Pozycja',
          'Kierowca',
          'Pojazd',
          'Okrążenie',
          'Czas_s',
          'S1_s',
          'S2_s',
          'S3_s',
          'VMax_kmh',
          'MaxG',
          'MaxLean_deg',
        ];
        const rows = laps.map((l: any, i: number) => [
          i + 1,
          l.driverName,
          l.vehicleType || activeTab,
          l.lapNumber || 1,
          (l.lapTime / 1000).toFixed(3),
          l.s1 ? (l.s1 / 1000).toFixed(3) : '',
          l.s2 ? (l.s2 / 1000).toFixed(3) : '',
          l.s3 ? (l.s3 / 1000).toFixed(3) : '',
          l.topSpeed || '',
          l.maxGForce || '',
          l.maxLeanAngle || '',
        ]);
        const csvContent =
          'data:text/csv;charset=utf-8,' +
          [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
        const anchor = document.createElement('a');
        anchor.href = encodeURI(csvContent);
        anchor.download = `flightdriving-session-${Date.now()}.csv`;
        anchor.click();
      }
    },
    [laps, tracks, selectedTrack, activeTab]
  );

  return (
    <div style={{ padding: '24px', maxWidth: '1440px', margin: '0 auto', position: 'relative' }}>
      {/* Animated Driver Join Banner */}
      <AnimatePresence>
        {notification && (
          <motion.div
            key={notification.id}
            initial={{ opacity: 0, y: -40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            style={{
              position: 'fixed',
              top: '80px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(5, 7, 12, 0.92)',
              backdropFilter: 'blur(16px)',
              border: '1px solid var(--f1-green)',
              borderRadius: 'var(--radius-lg)',
              padding: '12px 24px',
              zIndex: 99999,
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              boxShadow: '0 16px 40px rgba(0, 230, 118, 0.25)',
            }}
          >
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: 'rgba(0, 230, 118, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--f1-green)',
              }}
            >
              <Zap size={18} />
            </div>
            <div>
              <div style={{ color: '#ffffff', fontWeight: 900, fontSize: '15px' }}>
                {notification.driverName}
              </div>
              <div style={{ color: 'var(--f1-green)', fontSize: '11px', textTransform: 'uppercase', fontWeight: 800 }}>
                {notification.text}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Filter and Command Bar */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="telemetry-card"
        style={{
          display: 'flex',
          gap: '12px',
          marginBottom: '20px',
          padding: '16px 20px',
          flexWrap: 'wrap',
          alignItems: 'center',
          borderTop: '3px solid var(--f1-cyan)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              background: 'linear-gradient(135deg, var(--f1-cyan) 0%, #0284c7 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#050608',
            }}
          >
            <Radio size={16} strokeWidth={2.6} />
          </div>
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 900, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            RACE CONTROL PIT WALL
          </h2>
        </div>

        {/* Vehicle Tab Select */}
        <select
          aria-label="Kategoria"
          className="custom-select"
          style={{ flex: '1 1 160px', width: 'auto', minWidth: '140px' }}
          value={activeTab}
          onChange={(e) => setActiveTab(e.target.value as any)}
        >
          <option value="scooter">🛴 Hulajnogi Elektryczne</option>
          <option value="bike">🚴 Rowery Szosowe</option>
        </select>

        {/* Track Select */}
        <select
          aria-label="Wybór trasy"
          className="custom-select"
          style={{ flex: '1 1 200px', width: 'auto', minWidth: '160px' }}
          value={selectedTrack}
          onChange={(e) => setSelectedTrack(e.target.value)}
        >
          <option value="">-- Wybierz Tor Wyścigowy --</option>
          {tracks.map((t: any) => (
            <option key={t._id} value={t._id}>
              {t.name}
            </option>
          ))}
        </select>

        {/* Controls and Toggles */}
        <button
          className="btn-secondary"
          style={{
            flex: '1 1 140px',
            fontSize: '11px',
            padding: '10px 14px',
            background: showHeatmap ? 'rgba(244, 63, 94, 0.15)' : undefined,
            borderColor: showHeatmap ? 'var(--f1-red)' : undefined,
            color: showHeatmap ? '#ffffff' : undefined,
          }}
          onClick={() => setShowHeatmap(!showHeatmap)}
        >
          <Flame size={14} color="var(--f1-red)" />
          {showHeatmap ? 'HEATMAPA: WŁ' : 'HEATMAPA: WYŁ'}
        </button>

        <button
          className="btn-secondary"
          style={{
            flex: '1 1 160px',
            fontSize: '11px',
            padding: '10px 14px',
            background: showCompareModal ? 'rgba(189, 52, 254, 0.15)' : undefined,
            borderColor: showCompareModal ? 'var(--f1-purple)' : undefined,
            color: showCompareModal ? '#ffffff' : undefined,
          }}
          onClick={() => {
            setShowCompareModal(!showCompareModal);
            if (showTrainingModal) setShowTrainingModal(false);
          }}
        >
          <GitCompare size={14} color="var(--f1-purple)" />
          PORÓWNAJ KIEROWCÓW
        </button>

        <button
          className="btn-secondary"
          style={{
            flex: '1 1 160px',
            fontSize: '11px',
            padding: '10px 14px',
            background: showTrainingModal ? 'rgba(0, 240, 255, 0.15)' : undefined,
            borderColor: showTrainingModal ? 'var(--f1-cyan)' : undefined,
            color: showTrainingModal ? '#ffffff' : undefined,
          }}
          onClick={() => {
            setShowTrainingModal(!showTrainingModal);
            if (showCompareModal) setShowCompareModal(false);
          }}
        >
          <Target size={14} color="var(--f1-cyan)" />
          ANALIZA TRENINGU
        </button>

        {/* Export Data Button */}
        <button
          className="btn-secondary"
          style={{ padding: '10px 14px', fontSize: '11px' }}
          onClick={() => exportSession('csv')}
          title="Eksportuj czasy do formatu CSV"
        >
          <Download size={14} /> EKSPORT CSV
        </button>
      </motion.div>

      {/* 2-Driver Comparative Telemetry Overlay Modal */}
      {showCompareModal && (
        <CompareModal
          compareDriverA={compareDriverA}
          setCompareDriverA={setCompareDriverA}
          compareDriverB={compareDriverB}
          setCompareDriverB={setCompareDriverB}
          sortedLaps={sortedLaps}
          telemetry={telemetry}
          uniqueDrivers={uniqueDrivers}
          setShowCompareModal={setShowCompareModal}
          buildMonotonicSpline={buildMonotonicSpline}
        />
      )}

      {/* Driver Personal Training & Corner Analysis Modal */}
      {showTrainingModal && (
        <TrainingModal
          trainingDriver={trainingDriver}
          setTrainingDriver={setTrainingDriver}
          trainingLapAId={trainingLapAId}
          setTrainingLapAId={setTrainingLapAId}
          trainingLapBId={trainingLapBId}
          setTrainingLapBId={setTrainingLapBId}
          driverLaps={driverLaps}
          tracks={tracks}
          selectedTrack={selectedTrack}
          uniqueDrivers={uniqueDrivers}
          setShowTrainingModal={setShowTrainingModal}
          buildMonotonicSpline={buildMonotonicSpline}
          calculateTrackCorners={calculateTrackCorners}
        />
      )}

      {/* Top Stat Cards Bento */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '20px',
          marginBottom: '20px',
        }}
      >
        {/* P1 Leader Profile */}
        <div className="telemetry-card">
          <div className="card-header">
            <h3>LIDER SESJI (P1)</h3>
            <span
              style={{
                background: 'rgba(244, 63, 94, 0.15)',
                color: 'var(--f1-red)',
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: 900,
              }}
            >
              LIVE
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="font-digital" style={{ fontSize: '42px', fontWeight: 900, color: '#ffffff' }}>
              P1
            </span>
            <span
              className="font-digital"
              style={{ fontSize: '32px', fontWeight: 900, color: 'var(--f1-green)' }}
            >
              {bestLap ? (bestLap.lapTime / 1000).toFixed(3) : '--.---'}s
            </span>
          </div>

          <div style={{ marginTop: '10px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Kierowca
            </span>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#ffffff' }}>
              {bestLap ? bestLap.driverName : 'Brak Czasu'}
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: '6px',
              marginTop: '14px',
              paddingTop: '12px',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>S1</div>
              <div className="font-digital" style={{ fontSize: '13px', fontWeight: 700 }}>
                {bestLap?.s1 ? (bestLap.s1 / 1000).toFixed(3) : '--.---'}
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>S2</div>
              <div className="font-digital" style={{ fontSize: '13px', fontWeight: 700 }}>
                {bestLap?.s2 ? (bestLap.s2 / 1000).toFixed(3) : '--.---'}
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>S3</div>
              <div className="font-digital" style={{ fontSize: '13px', fontWeight: 700 }}>
                {bestLap?.s3 ? (bestLap.s3 / 1000).toFixed(3) : '--.---'}
              </div>
            </div>
          </div>
        </div>

        {/* Theoretical Best Lap */}
        <div className="telemetry-card">
          <div className="card-header">
            <h3>IDEALNY CZAS (TEORIA)</h3>
            <span style={{ color: 'var(--f1-purple)', fontSize: '14px' }}>
              <Clock size={16} />
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span
              className="font-digital"
              style={{ fontSize: '38px', fontWeight: 900, color: 'var(--f1-purple)' }}
            >
              {idealLapData.idealLapTime ? (idealLapData.idealLapTime / 1000).toFixed(3) : '--.---'}s
            </span>
          </div>

          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
            Suma najlepszych sektorów (S1+S2+S3) wszystkich kierowców w sesji.
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: '6px',
              marginTop: '14px',
              paddingTop: '12px',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>PURPLE S1</div>
              <div
                className="font-digital"
                style={{ fontSize: '13px', fontWeight: 700, color: 'var(--f1-purple)' }}
              >
                {idealLapData.minS1 ? (idealLapData.minS1 / 1000).toFixed(3) : '--.---'}
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>PURPLE S2</div>
              <div
                className="font-digital"
                style={{ fontSize: '13px', fontWeight: 700, color: 'var(--f1-purple)' }}
              >
                {idealLapData.minS2 ? (idealLapData.minS2 / 1000).toFixed(3) : '--.---'}
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>PURPLE S3</div>
              <div
                className="font-digital"
                style={{ fontSize: '13px', fontWeight: 700, color: 'var(--f1-purple)' }}
              >
                {idealLapData.minS3 ? (idealLapData.minS3 / 1000).toFixed(3) : '--.---'}
              </div>
            </div>
          </div>
        </div>

        {/* Active Telemetry Status */}
        <div className="telemetry-card">
          <div className="card-header">
            <h3>STATUS TELEMETRII</h3>
            <span style={{ color: 'var(--f1-cyan)' }}>
              <Activity size={16} />
            </span>
          </div>

          <div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Aktywny kierowca {bestLap ? '(Lider)' : ''}
            </span>
            <div style={{ fontSize: '15px', fontWeight: 800, color: '#ffffff', marginTop: '2px' }}>
              {activeDriverTelemetry ? activeDriverTelemetry.driverName : 'Brak aktywnego sygnału'}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '4px' }}>
              <span
                className="font-digital"
                style={{
                  fontSize: '48px',
                  fontWeight: 900,
                  color: 'var(--f1-cyan)',
                  textShadow: '0 0 16px rgba(0,240,255,0.3)',
                }}
              >
                {activeDriverTelemetry ? Math.round(activeDriverTelemetry.speed) : 0}
              </span>
              <span style={{ fontSize: '16px', color: 'var(--text-secondary)', fontWeight: 800 }}>
                KM/H
              </span>
            </div>
          </div>

          <div style={{ marginTop: '10px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              PRZECIĄŻENIE G-FORCE
            </span>
            <div
              style={{
                width: '100%',
                height: '8px',
                background: 'rgba(255,255,255,0.06)',
                borderRadius: '4px',
                marginTop: '6px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.min((activeDriverTelemetry?.gForce || 0) / 2, 1) * 100}%`,
                  background: 'var(--f1-purple)',
                  transition: 'width 0.15s ease-out',
                }}
              />
            </div>
          </div>
        </div>

        {/* Global Track Radar Map Card */}
        <div
          className="telemetry-card"
          style={{ padding: 0, overflow: 'hidden', minHeight: '260px', position: 'relative' }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 1000,
              background: 'linear-gradient(rgba(5,7,12,0.85), transparent)',
              padding: '14px 18px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '12px', fontWeight: 800, color: '#ffffff' }}>
              RADAR SATELITARNY NA ŻYWO
            </h3>
            <span style={{ fontSize: '10px', color: 'var(--f1-cyan)', fontWeight: 800 }}>
              ● 60FPS TRACKING
            </span>
          </div>
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
        </div>
      </div>

      {/* F1 Broadcast Timing Tower */}
      <div className="telemetry-card" style={{ padding: '24px' }}>
        <div
          className="card-header"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}
        >
          <div>
            <h3 style={{ margin: 0 }}>TABLICA WYNIKÓW (LIVE TIMING TOWER)</h3>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              Kliknij wiersz kierowcy, aby otworzyć panel Live Telemetry Focus
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              gap: '6px',
              background: 'rgba(0,0,0,0.5)',
              padding: '4px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <button
              onClick={() => setViewMode('leaderboard')}
              style={{
                padding: '6px 14px',
                fontSize: '11px',
                borderRadius: 'var(--radius-xs)',
                background: viewMode === 'leaderboard' ? 'var(--f1-cyan)' : 'transparent',
                color: viewMode === 'leaderboard' ? '#050608' : 'var(--text-secondary)',
                fontWeight: 800,
              }}
            >
              🏆 KLASYFIKACJA (LIDERZY)
            </button>
            <button
              onClick={() => setViewMode('all')}
              style={{
                padding: '6px 14px',
                fontSize: '11px',
                borderRadius: 'var(--radius-xs)',
                background: viewMode === 'all' ? 'var(--f1-cyan)' : 'transparent',
                color: viewMode === 'all' ? '#050608' : 'var(--text-secondary)',
                fontWeight: 800,
              }}
            >
              📋 WSZYSTKIE OKRĄŻENIA ({laps.length})
            </button>
          </div>
        </div>

        <div style={{ overflowX: 'auto', marginTop: '10px' }}>
          <table className="timing-table">
            <thead>
              <tr>
                <th style={{ width: '60px' }}>POS</th>
                <th>KIEROWCA</th>
                <th>SEKTOR 1</th>
                <th>SEKTOR 2</th>
                <th>SEKTOR 3</th>
                <th>CZAS OKRĄŻENIA</th>
                <th>V-MAX</th>
                <th>STRATA (GAP)</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {displayedLaps.map((lap: any, index: number) => {
                  const deltaToLeader = index === 0 ? null : lap.lapTime - bestLap.lapTime;
                  const isFocused = focusedDriver === lap.driverName;
                  const pBest = sectorStats.personalMap.get(lap.driverName);

                  const s1Class = getSectorBadgeClass(lap.s1, pBest?.s1, sectorStats.overallS1);
                  const s2Class = getSectorBadgeClass(lap.s2, pBest?.s2, sectorStats.overallS2);
                  const s3Class = getSectorBadgeClass(lap.s3, pBest?.s3, sectorStats.overallS3);

                  return (
                    <React.Fragment key={lap._id}>
                      <motion.tr
                        layout
                        onClick={() => setFocusedDriver(isFocused ? null : lap.driverName)}
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.2 }}
                        style={{
                          background: isFocused
                            ? 'rgba(0, 240, 255, 0.12)'
                            : index === 0
                            ? 'rgba(189, 52, 254, 0.08)'
                            : 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <td style={{ fontWeight: 900, fontSize: '15px' }} className="font-digital">
                          {index === 0 ? (
                            <span style={{ color: '#fbbf24' }}>🥇 1</span>
                          ) : index === 1 ? (
                            <span style={{ color: '#e2e8f0' }}>🥈 2</span>
                          ) : index === 2 ? (
                            <span style={{ color: '#b45309' }}>🥉 3</span>
                          ) : (
                            index + 1
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontWeight: 800, fontSize: '14px', color: '#fff' }}>
                              {lap.driverName}
                            </span>
                            <span
                              style={{
                                fontSize: '10px',
                                color: 'var(--text-muted)',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                background: 'rgba(255,255,255,0.04)',
                              }}
                            >
                              #{lap.lapNumber || 1}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className={`sector-badge ${s1Class}`}>
                            {lap.s1 ? (lap.s1 / 1000).toFixed(3) : '---'}
                          </span>
                        </td>
                        <td>
                          <span className={`sector-badge ${s2Class}`}>
                            {lap.s2 ? (lap.s2 / 1000).toFixed(3) : '---'}
                          </span>
                        </td>
                        <td>
                          <span className={`sector-badge ${s3Class}`}>
                            {lap.s3 ? (lap.s3 / 1000).toFixed(3) : '---'}
                          </span>
                        </td>
                        <td className="font-digital" style={{ fontWeight: 800, fontSize: '15px' }}>
                          <span style={{ color: index === 0 ? 'var(--f1-purple)' : 'var(--f1-green)' }}>
                            {(lap.lapTime / 1000).toFixed(3)}s
                          </span>
                        </td>
                        <td className="font-digital" style={{ color: 'var(--f1-cyan)', fontWeight: 700 }}>
                          {Math.round(lap.topSpeed || 0)} km/h
                        </td>
                        <td className="font-digital" style={{ fontWeight: 800 }}>
                          {deltaToLeader ? (
                            <span style={{ color: 'var(--f1-red)' }}>
                              +{(deltaToLeader / 1000).toFixed(3)}s
                            </span>
                          ) : (
                            <span style={{ color: 'var(--f1-purple)' }}>LIDER</span>
                          )}
                        </td>
                      </motion.tr>

                      {/* Focused Driver In-depth Inspection Row */}
                      <AnimatePresence>
                        {isFocused && (
                          <motion.tr
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                          >
                            <td colSpan={8} style={{ padding: 0, border: 'none' }}>
                              <div
                                style={{
                                  background: 'rgba(5, 7, 14, 0.95)',
                                  borderBottom: '1px solid var(--border-subtle)',
                                  padding: '20px',
                                  display: 'flex',
                                  gap: '20px',
                                  flexWrap: 'wrap',
                                }}
                              >
                                <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                  <h4 style={{ color: 'var(--f1-cyan)', margin: 0, fontSize: '14px', letterSpacing: '0.06em' }}>
                                    LIVE TELEMETRY FOCUS: {focusedDriver}
                                  </h4>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                    <div className="telemetry-card-inner" style={{ textAlign: 'center', padding: '12px' }}>
                                      <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>PRĘDKOŚĆ (LIVE)</div>
                                      <div className="font-digital" style={{ fontSize: '32px', color: 'var(--f1-cyan)', fontWeight: 800 }}>
                                        {focusedTelemetry ? Math.round(focusedTelemetry.speed) : 0}{' '}
                                        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>km/h</span>
                                      </div>
                                    </div>

                                    <div className="telemetry-card-inner" style={{ textAlign: 'center', padding: '12px' }}>
                                      <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>G-FORCE (LIVE)</div>
                                      <div className="font-digital" style={{ fontSize: '32px', color: 'var(--f1-purple)', fontWeight: 800 }}>
                                        {focusedTelemetry ? (focusedTelemetry.gForce || 0).toFixed(2) : '0.00'}{' '}
                                        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>G</span>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="telemetry-card-inner" style={{ padding: '12px' }}>
                                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                                      REKORDY SEKTORÓW KIEROWCY
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }} className="font-digital">
                                      <div>
                                        <span style={{ color: 'var(--text-muted)' }}>S1: </span>
                                        {(focusedLapData as any).s1
                                          ? ((focusedLapData as any).s1 / 1000).toFixed(3)
                                          : '---'}s
                                      </div>
                                      <div>
                                        <span style={{ color: 'var(--text-muted)' }}>S2: </span>
                                        {(focusedLapData as any).s2
                                          ? ((focusedLapData as any).s2 / 1000).toFixed(3)
                                          : '---'}s
                                      </div>
                                      <div>
                                        <span style={{ color: 'var(--text-muted)' }}>S3: </span>
                                        {(focusedLapData as any).s3
                                          ? ((focusedLapData as any).s3 / 1000).toFixed(3)
                                          : '---'}s
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                <div
                                  style={{
                                    flex: '1 1 340px',
                                    minHeight: '220px',
                                    position: 'relative',
                                    borderRadius: 'var(--radius-md)',
                                    overflow: 'hidden',
                                    border: '1px solid var(--border-subtle)',
                                  }}
                                >
                                  <div ref={focusMapRef} style={{ width: '100%', height: '100%' }} />
                                </div>
                              </div>
                            </td>
                          </motion.tr>
                        )}
                      </AnimatePresence>
                    </React.Fragment>
                  );
                })}
              </AnimatePresence>

              {inProgressDrivers.map((t: any) => (
                <tr key={`in-progress-${t.driverName}`} style={{ background: 'rgba(0, 240, 255, 0.04)' }}>
                  <td className="font-digital" style={{ color: 'var(--text-muted)' }}>—</td>
                  <td style={{ fontWeight: 800, color: '#ffffff' }}>{t.driverName}</td>
                  <td style={{ color: 'var(--text-muted)' }}>---</td>
                  <td style={{ color: 'var(--text-muted)' }}>---</td>
                  <td style={{ color: 'var(--text-muted)' }}>---</td>
                  <td style={{ color: 'var(--f1-cyan)', fontWeight: 800, fontSize: '12px' }}>
                    W TRAKCIE OKRĄŻENIA...
                  </td>
                  <td className="font-digital" style={{ color: 'var(--f1-cyan)' }}>
                    {Math.round(t.speed || 0)} km/h
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>—</td>
                </tr>
              ))}

              {displayedLaps.length === 0 && inProgressDrivers.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
                    Brak zarejestrowanych okrążeń w wybranej kategorii.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div
          style={{
            display: 'flex',
            gap: '20px',
            marginTop: '16px',
            paddingTop: '14px',
            borderTop: '1px solid var(--border-subtle)',
            fontSize: '11px',
            color: 'var(--text-secondary)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--f1-purple)' }} />
            <span>🟣 Rekord Sesji (Overall Best)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--f1-green)' }} />
            <span>🟢 Rekord Osobisty (Personal Best)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--f1-yellow)' }} />
            <span>🟡 Słabszy sektor</span>
          </div>
        </div>
      </div>
    </div>
  );
}
