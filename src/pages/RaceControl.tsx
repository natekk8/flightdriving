import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useQuery, useMutation } from 'convex/react';
// @ts-ignore
import { api } from '../../convex/_generated/api';
import L from 'leaflet';
import 'leaflet-rotate';
import { motion } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { calculateTrackCorners } from '../lib/math';
import { CompareModal } from '../components/RaceControl/CompareModal';
import { TrainingModal } from '../components/RaceControl/TrainingModal';
import {
  Download,
  Flame,
  GitCompare,
  Target,
  Clock,
  Activity,
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

  // Modals
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [showTrainingModal, setShowTrainingModal] = useState(false);
  const [compareDriverA, setCompareDriverA] = useState<string>('');
  const [compareDriverB, setCompareDriverB] = useState<string>('');
  const [trainingDriver, setTrainingDriver] = useState<string>('');
  const [trainingLapAId, setTrainingLapAId] = useState<string>('');
  const [trainingLapBId, setTrainingLapBId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'leaderboard' | 'all'>('leaderboard');

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

  // Theoretical best
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

  // Initialize Map
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

  // Update track path on map
  useEffect(() => {
    if (!leafletMap.current || !selectedTrack) return;
    const track = tracks.find((t: any) => t._id === selectedTrack);
    if (!track || !track.path || track.path.length < 2) return;

    const latLngs: [number, number][] = track.path.map((p: any) => [p.lat, p.lon]);
    const bounds = L.latLngBounds(latLngs);
    leafletMap.current.fitBounds(bounds, { padding: [30, 30] });

    const trackLine = L.polyline(latLngs, {
      color: 'var(--accent-green)',
      weight: 4,
      opacity: 0.8,
    }).addTo(leafletMap.current);

    return () => {
      trackLine.remove();
    };
  }, [selectedTrack, tracks]);

  // Interpolated driver markers on map
  useEffect(() => {
    if (!leafletMap.current) return;

    const activeDrivers = telemetry.filter(
      (t: any) => t.vehicleType === activeTab && Date.now() - (t.timestamp || 0) < 15000
    );

    const currentDriverNames = new Set(activeDrivers.map((t: any) => t.driverName));
    Object.keys(markersRef.current).forEach((driverName) => {
      if (!currentDriverNames.has(driverName)) {
        markersRef.current[driverName].marker.remove();
        delete markersRef.current[driverName];
      }
    });

    activeDrivers.forEach((driver: any) => {
      const targetLatLng = L.latLng(driver.lat, driver.lon);
      const heading = driver.heading || 0;

      if (!markersRef.current[driver.driverName]) {
        const arrowSvg = `<svg width="22" height="22" viewBox="0 0 24 24" style="transform: rotate(${heading}deg); transform-origin: center;">
          <polygon points="12,2 22,22 12,17 2,22" fill="var(--accent-green)" stroke="#ffffff" stroke-width="2"/>
        </svg>`;
        const icon = L.divIcon({
          html: `<div style="display:flex;flex-direction:column;align-items:center;">
            ${arrowSvg}
            <span style="font-size:9px;font-weight:700;color:#ffffff;background:rgba(9,10,15,0.8);padding:1px 4px;border-radius:3px;margin-top:2px;">
              ${driver.driverName}
            </span>
          </div>`,
          className: '',
          iconSize: [40, 40],
          iconAnchor: [20, 11],
        });

        const marker = L.marker(targetLatLng, { icon }).addTo(leafletMap.current!);
        markersRef.current[driver.driverName] = {
          marker,
          target: targetLatLng,
          current: targetLatLng,
          heading,
        };
      } else {
        markersRef.current[driver.driverName].target = targetLatLng;
        markersRef.current[driver.driverName].heading = heading;
      }
    });

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const animateMarkers = () => {
      Object.keys(markersRef.current).forEach((driverName) => {
        const item = markersRef.current[driverName];
        const curLat = item.current.lat + (item.target.lat - item.current.lat) * 0.15;
        const curLng = item.current.lng + (item.target.lng - item.current.lng) * 0.15;
        item.current = L.latLng(curLat, curLng);
        item.marker.setLatLng(item.current);

        const el = item.marker.getElement();
        const svg = el?.querySelector('svg');
        if (svg) {
          svg.style.transform = `rotate(${item.heading}deg)`;
        }
      });
      rafRef.current = requestAnimationFrame(animateMarkers);
    };
    rafRef.current = requestAnimationFrame(animateMarkers);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [telemetry, activeTab]);

  // Sorted laps
  const sortedLaps = useMemo(() => {
    return [...laps].sort((a: any, b: any) => a.lapTime - b.lapTime);
  }, [laps]);

  const bestLap = sortedLaps.length > 0 ? sortedLaps[0] : null;

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
    const allS1 = laps
      .map((l: any) => l.s1)
      .filter((v: any): v is number => typeof v === 'number' && v > 0);
    const allS2 = laps
      .map((l: any) => l.s2)
      .filter((v: any): v is number => typeof v === 'number' && v > 0);
    const allS3 = laps
      .map((l: any) => l.s3)
      .filter((v: any): v is number => typeof v === 'number' && v > 0);

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

    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];

      let color = 'var(--accent-green)';
      let label = 'Prosta';

      const isApproachingCorner = corners.some((c: any) => i >= c.index - 3 && i < c.index);
      const isAtApex = cornerIndices.has(i) || corners.some((c: any) => i === c.index);

      if (isApproachingCorner) {
        color = 'var(--accent-red)';
        label = 'Hamowanie';
      } else if (isAtApex) {
        color = 'var(--accent-amber)';
        label = 'Zakręt';
      }

      const segment = L.polyline([[p1.lat, p1.lon], [p2.lat, p2.lon]], {
        color,
        weight: 5,
        opacity: 0.85,
      });
      segment.bindTooltip(label, { sticky: true });
      segment.addTo(heatmapLayerGroup.current);
    }
  }, [showHeatmap, selectedTrack, tracks]);

  // Export session
  const exportSession = useCallback(
    (format: 'csv' | 'json') => {
      if (format === 'json') {
        const dataStr =
          'data:text/json;charset=utf-8,' +
          encodeURIComponent(
            JSON.stringify(
              {
                track: tracks.find((t: any) => t._id === selectedTrack)?.name || 'Nieznany',
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
          l.vehicleType === 'scooter' ? 'Hulajnoga' : 'Rower',
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
    <div
      style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}
    >
      {/* Top Filter and Command Bar */}
      <div
        className="clean-card"
        style={{
          padding: '16px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        {/* Left: Vehicle segmented control (Hulajnoga / Rower) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div
            style={{
              display: 'flex',
              background: 'rgba(255, 255, 255, 0.04)',
              padding: '3px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab('scooter')}
              style={{
                position: 'relative',
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 600,
                color: activeTab === 'scooter' ? '#ffffff' : 'var(--text-secondary)',
                background: 'transparent',
                borderRadius: 'calc(var(--radius-sm) - 2px)',
                zIndex: 1,
              }}
            >
              Hulajnoga
              {activeTab === 'scooter' && (
                <motion.div
                  layoutId="raceControlVehicleTab"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid var(--border-medium)',
                    borderRadius: 'calc(var(--radius-sm) - 2px)',
                    zIndex: -1,
                  }}
                  transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                />
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('bike')}
              style={{
                position: 'relative',
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 600,
                color: activeTab === 'bike' ? '#ffffff' : 'var(--text-secondary)',
                background: 'transparent',
                borderRadius: 'calc(var(--radius-sm) - 2px)',
                zIndex: 1,
              }}
            >
              Rower
              {activeTab === 'bike' && (
                <motion.div
                  layoutId="raceControlVehicleTab"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid var(--border-medium)',
                    borderRadius: 'calc(var(--radius-sm) - 2px)',
                    zIndex: -1,
                  }}
                  transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                />
              )}
            </button>
          </div>

          {/* Track selector */}
          <select
            aria-label="Wybór toru"
            className="custom-select"
            style={{ minWidth: '180px', width: 'auto' }}
            value={selectedTrack}
            onChange={(e) => setSelectedTrack(e.target.value)}
          >
            <option value="">Wybierz tor...</option>
            {tracks.map((t: any) => (
              <option key={t._id} value={t._id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {/* Right: Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            className="btn-secondary"
            style={{
              padding: '7px 12px',
              fontSize: '12px',
              color: showHeatmap ? 'var(--accent-green)' : 'inherit',
            }}
            onClick={() => setShowHeatmap(!showHeatmap)}
          >
            <Flame size={13} />
            <span>Mapa ciepła</span>
          </button>

          <button
            className="btn-secondary"
            style={{
              padding: '7px 12px',
              fontSize: '12px',
              color: showCompareModal ? 'var(--accent-purple)' : 'inherit',
            }}
            onClick={() => {
              setShowCompareModal(!showCompareModal);
              if (showTrainingModal) setShowTrainingModal(false);
            }}
          >
            <GitCompare size={13} />
            <span>Porównaj</span>
          </button>

          <button
            className="btn-secondary"
            style={{
              padding: '7px 12px',
              fontSize: '12px',
              color: showTrainingModal ? 'var(--accent-blue)' : 'inherit',
            }}
            onClick={() => {
              setShowTrainingModal(!showTrainingModal);
              if (showCompareModal) setShowCompareModal(false);
            }}
          >
            <Target size={13} />
            <span>Analiza</span>
          </button>

          <button
            className="btn-secondary"
            style={{ padding: '7px 12px', fontSize: '12px' }}
            onClick={() => exportSession('csv')}
            title="Eksportuj do CSV"
          >
            <Download size={13} />
            <span>Eksport CSV</span>
          </button>
        </div>
      </div>

      {/* Modals */}
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

      {/* Stats Bento Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '16px',
        }}
      >
        {/* Best Lap Card */}
        <div className="clean-card" style={{ padding: '18px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px',
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
              Najlepszy czas
            </span>
            <span
              style={{
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: 'var(--radius-xs)',
                background: 'var(--accent-green-bg)',
                color: 'var(--accent-green)',
                fontWeight: 700,
              }}
            >
              Rekord
            </span>
          </div>

          <div
            className="font-digital"
            style={{
              fontSize: '32px',
              fontWeight: 800,
              color: 'var(--accent-green)',
              lineHeight: 1.1,
            }}
          >
            {bestLap ? `${(bestLap.lapTime / 1000).toFixed(3)}s` : '--.---'}
          </div>

          <div style={{ fontSize: '14px', fontWeight: 600, color: '#ffffff', marginTop: '6px' }}>
            {bestLap ? bestLap.driverName : 'Brak danych'}
          </div>

          {bestLap && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: '6px',
                marginTop: '12px',
                paddingTop: '10px',
                borderTop: '1px solid var(--border-subtle)',
                textAlign: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>S1</div>
                <div className="font-digital" style={{ fontSize: '11px' }}>
                  {bestLap.s1 ? (bestLap.s1 / 1000).toFixed(2) : '--'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>S2</div>
                <div className="font-digital" style={{ fontSize: '11px' }}>
                  {bestLap.s2 ? (bestLap.s2 / 1000).toFixed(2) : '--'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>S3</div>
                <div className="font-digital" style={{ fontSize: '11px' }}>
                  {bestLap.s3 ? (bestLap.s3 / 1000).toFixed(2) : '--'}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Theoretical Best Lap */}
        <div className="clean-card" style={{ padding: '18px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px',
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
              Czas teoretyczny (S1+S2+S3)
            </span>
            <Clock size={14} style={{ color: 'var(--accent-purple)' }} />
          </div>

          <div
            className="font-digital"
            style={{
              fontSize: '32px',
              fontWeight: 800,
              color: 'var(--accent-purple)',
              lineHeight: 1.1,
            }}
          >
            {idealLapData.idealLapTime
              ? `${(idealLapData.idealLapTime / 1000).toFixed(3)}s`
              : '--.---'}
          </div>

          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '6px' }}>
            Suma najlepszych sektorów sesji
          </div>

          {idealLapData.idealLapTime && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: '6px',
                marginTop: '12px',
                paddingTop: '10px',
                borderTop: '1px solid var(--border-subtle)',
                textAlign: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>S1</div>
                <div className="font-digital" style={{ fontSize: '11px', color: 'var(--accent-purple)' }}>
                  {idealLapData.minS1 ? (idealLapData.minS1 / 1000).toFixed(2) : '--'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>S2</div>
                <div className="font-digital" style={{ fontSize: '11px', color: 'var(--accent-purple)' }}>
                  {idealLapData.minS2 ? (idealLapData.minS2 / 1000).toFixed(2) : '--'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>S3</div>
                <div className="font-digital" style={{ fontSize: '11px', color: 'var(--accent-purple)' }}>
                  {idealLapData.minS3 ? (idealLapData.minS3 / 1000).toFixed(2) : '--'}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Live Telemetry Card */}
        <div className="clean-card" style={{ padding: '18px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px',
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
              Aktywność na torze
            </span>
            <Activity size={14} style={{ color: 'var(--accent-blue)' }} />
          </div>

          <div style={{ fontSize: '14px', fontWeight: 600, color: '#ffffff' }}>
            {activeDriverTelemetry ? activeDriverTelemetry.driverName : 'Brak sygnału'}
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '4px' }}>
            <span
              className="font-digital"
              style={{ fontSize: '36px', fontWeight: 800, color: 'var(--accent-blue)' }}
            >
              {activeDriverTelemetry ? Math.round(activeDriverTelemetry.speed) : 0}
            </span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>km/h</span>
          </div>

          <div style={{ marginTop: '10px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Przeciążenie</div>
            <div
              style={{
                width: '100%',
                height: '6px',
                background: 'rgba(255,255,255,0.06)',
                borderRadius: '3px',
                marginTop: '4px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.min((activeDriverTelemetry?.gForce || 0) / 1.5, 1) * 100}%`,
                  background: 'var(--accent-blue)',
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
          </div>
        </div>

        {/* Mini Map */}
        <div
          className="clean-card"
          style={{ padding: 0, overflow: 'hidden', minHeight: '180px', position: 'relative' }}
        >
          <div
            style={{
              position: 'absolute',
              top: '10px',
              left: '12px',
              zIndex: 1000,
              fontSize: '11px',
              fontWeight: 600,
              color: '#ffffff',
              background: 'rgba(9, 10, 15, 0.8)',
              padding: '3px 8px',
              borderRadius: 'var(--radius-xs)',
            }}
          >
            Podgląd toru
          </div>
          <div ref={mapRef} style={{ width: '100%', height: '100%', minHeight: '180px' }} />
        </div>
      </div>

      {/* Leaderboard Table Card */}
      <div className="clean-card" style={{ padding: '20px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#ffffff', margin: 0 }}>
            Tabela wyników
          </h2>

          <div
            style={{
              display: 'flex',
              background: 'rgba(255, 255, 255, 0.04)',
              padding: '3px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <button
              onClick={() => setViewMode('leaderboard')}
              style={{
                padding: '5px 12px',
                fontSize: '12px',
                borderRadius: 'calc(var(--radius-sm) - 2px)',
                background: viewMode === 'leaderboard' ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                color: viewMode === 'leaderboard' ? '#ffffff' : 'var(--text-secondary)',
                fontWeight: 600,
              }}
            >
              Najlepsze okrążenia
            </button>
            <button
              onClick={() => setViewMode('all')}
              style={{
                padding: '5px 12px',
                fontSize: '12px',
                borderRadius: 'calc(var(--radius-sm) - 2px)',
                background: viewMode === 'all' ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                color: viewMode === 'all' ? '#ffffff' : 'var(--text-secondary)',
                fontWeight: 600,
              }}
            >
              Wszystkie ({laps.length})
            </button>
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ padding: '10px 12px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
                  #
                </th>
                <th style={{ padding: '10px 12px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Kierowca
                </th>
                <th style={{ padding: '10px 12px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
                  S1
                </th>
                <th style={{ padding: '10px 12px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
                  S2
                </th>
                <th style={{ padding: '10px 12px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
                  S3
                </th>
                <th style={{ padding: '10px 12px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Czas okrążenia
                </th>
                <th style={{ padding: '10px 12px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
                  V-Max
                </th>
                <th style={{ padding: '10px 12px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Strata
                </th>
              </tr>
            </thead>
            <tbody>
              {displayedLaps.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                    Brak zarejestrowanych okrążeń na tym torze.
                  </td>
                </tr>
              ) : (
                displayedLaps.map((lap: any, index: number) => {
                  const deltaToLeader =
                    index === 0 || !bestLap ? null : (lap.lapTime - bestLap.lapTime) / 1000;
                  const isFocused = focusedDriver === lap.driverName;
                  const pBest = sectorStats.personalMap.get(lap.driverName);

                  const s1Class = getSectorBadgeClass(lap.s1, pBest?.s1, sectorStats.overallS1);
                  const s2Class = getSectorBadgeClass(lap.s2, pBest?.s2, sectorStats.overallS2);
                  const s3Class = getSectorBadgeClass(lap.s3, pBest?.s3, sectorStats.overallS3);

                  return (
                    <motion.tr
                      key={lap._id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      onClick={() => setFocusedDriver(isFocused ? null : lap.driverName)}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        background: isFocused ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                        cursor: 'pointer',
                        transition: 'background 0.12s ease',
                      }}
                    >
                      <td style={{ padding: '12px', fontSize: '13px', fontWeight: 700, color: index === 0 ? 'var(--accent-green)' : 'var(--text-secondary)' }} className="font-digital">
                        {index + 1}
                      </td>
                      <td style={{ padding: '12px', fontSize: '13px', fontWeight: 600, color: '#ffffff' }}>
                        {lap.driverName}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span className={`sector-badge ${s1Class}`}>
                          {lap.s1 ? (lap.s1 / 1000).toFixed(3) : '--'}
                        </span>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span className={`sector-badge ${s2Class}`}>
                          {lap.s2 ? (lap.s2 / 1000).toFixed(3) : '--'}
                        </span>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span className={`sector-badge ${s3Class}`}>
                          {lap.s3 ? (lap.s3 / 1000).toFixed(3) : '--'}
                        </span>
                      </td>
                      <td style={{ padding: '12px', fontSize: '14px', fontWeight: 700, color: index === 0 ? 'var(--accent-green)' : '#ffffff' }} className="font-digital">
                        {(lap.lapTime / 1000).toFixed(3)}s
                      </td>
                      <td style={{ padding: '12px', fontSize: '12px', color: 'var(--text-secondary)' }} className="font-digital">
                        {lap.topSpeed ? `${Math.round(lap.topSpeed)} km/h` : '--'}
                      </td>
                      <td style={{ padding: '12px', fontSize: '12px', color: 'var(--text-muted)' }} className="font-digital">
                        {deltaToLeader === null ? 'Lider' : `+${deltaToLeader.toFixed(3)}s`}
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
