import { useState, useEffect, useRef, useMemo } from 'react';
import { useMutation, useQuery } from 'convex/react';
// @ts-ignore
import { api } from '../../convex/_generated/api';
import { initAudio, playF1StartBeep, playLapFinishBeep } from '../lib/audio';
import { requestWakeLock, releaseWakeLock } from '../lib/wakelock';
import { queueLap, flushLapQueue, getQueuedLapCount } from '../lib/offlineQueue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-rotate';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { TelemetryEngine } from '../lib/TelemetryEngine';
import {
  Gauge,
  Maximize2,
  Minimize2,
  Sun,
  Moon,
  Play,
  RotateCcw,
  Sparkles,
  MapPin,
  AlertTriangle,
  Compass,
  WifiOff,
} from 'lucide-react';

export default function Cockpit() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<'setup' | 'f1_lights' | 'racing'>('setup');
  const [driverName, setDriverName] = useState('');
  const [vehicleType, setVehicleType] = useState<'scooter' | 'bike'>('scooter');
  const [selectedTrack, setSelectedTrack] = useState('');
  const [lights, setLights] = useState(0);
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [outdoorMode, setOutdoorMode] = useState(false);
  const [isSimulated, setIsSimulated] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Validation errors
  const [errorName, setErrorName] = useState(false);
  const [errorTrack, setErrorTrack] = useState(false);
  const [trackConfigError, setTrackConfigError] = useState<string | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const [leanAngleDisplay, setLeanAngleDisplay] = useState(0);
  const [lapNumberDisplay, setLapNumberDisplay] = useState(1);

  // Timing state
  const [s1Time, setS1Time] = useState<number | null>(null);
  const [s2Time, setS2Time] = useState<number | null>(null);
  const [s3Time, setS3Time] = useState<number | null>(null);
  const [lapFlash, setLapFlash] = useState(false);

  // UI elements for rAF loop
  const speedElRef = useRef<HTMLDivElement>(null);
  const deltaElRef = useRef<HTMLDivElement>(null);
  const gForceDotRef = useRef<SVGCircleElement>(null);
  const liveTimerRef = useRef<HTMLDivElement>(null);

  const engineRef = useRef<TelemetryEngine | null>(null);

  const [pendingLapCount, setPendingLapCount] = useState(0);

  const [exitHoldProgress, setExitHoldProgress] = useState(0);
  const exitHoldStartRef = useRef<number | null>(null);
  const exitHoldRafRef = useRef<number | null>(null);
  const EXIT_HOLD_MS = 900;

  const [isLightsOut, setIsLightsOut] = useState(false);

  // @ts-ignore
  const rawTracks = useQuery(api.tracks.getTracks);
  const tracks = useMemo(() => rawTracks ?? [], [rawTracks]);
  // @ts-ignore
  const rawLaps = useQuery(api.laps.getTimingBoard, {
    trackId: (selectedTrack as any) || undefined,
    vehicleType,
  });
  const laps = useMemo(() => rawLaps ?? [], [rawLaps]);
  // @ts-ignore
  const updateTelemetry = useMutation(api.telemetry.update);
  // @ts-ignore
  const clearDriverTelemetry = useMutation(api.telemetry.clearDriver);
  // @ts-ignore
  const recordLap = useMutation(api.laps.record);

  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const userMarker = useRef<L.Marker | null>(null);
  const trackPathLayer = useRef<L.Polyline | null>(null);
  const labelsLayer = useRef<L.TileLayer | null>(null);

  const bestLapRef = useRef<any>(null);
  useEffect(() => {
    bestLapRef.current =
      laps.length > 0 ? [...laps].sort((a: any, b: any) => a.lapTime - b.lapTime)[0] : null;
  }, [laps]);

  const myLapsCount = useMemo(() => {
    return laps.filter((l: any) => l.driverName === driverName).length;
  }, [laps, driverName]);

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

    const myLaps = laps.filter((l: any) => l.driverName === driverName);
    const myS1 = myLaps
      .map((l: any) => l.s1)
      .filter((v: any): v is number => typeof v === 'number' && v > 0);
    const myS2 = myLaps
      .map((l: any) => l.s2)
      .filter((v: any): v is number => typeof v === 'number' && v > 0);
    const myS3 = myLaps
      .map((l: any) => l.s3)
      .filter((v: any): v is number => typeof v === 'number' && v > 0);

    const personalS1 = myS1.length > 0 ? Math.min(...myS1) : null;
    const personalS2 = myS2.length > 0 ? Math.min(...myS2) : null;
    const personalS3 = myS3.length > 0 ? Math.min(...myS3) : null;

    return { overallS1, overallS2, overallS3, personalS1, personalS2, personalS3 };
  }, [laps, driverName]);

  const getSectorClass = (
    val: number | null,
    personalMin: number | null,
    overallMin: number | null
  ) => {
    if (!val || val <= 0) return 'sector-neutral';
    if (overallMin && val <= overallMin) return 'sector-purple';
    if (personalMin && val <= personalMin) return 'sector-green';
    return 'sector-yellow';
  };

  const validateTrackConfig = (track: any): string | null => {
    if (!track || !track.path || track.path.length < 2) {
      return 'Ta trasa nie ma poprawnie zdefiniowanej ścieżki (min. 2 punkty). Popraw ją w Kreatorze Tras.';
    }
    const lastIndex = track.path.length - 1;
    if (track.s1Index !== undefined && (track.s1Index <= 0 || track.s1Index >= lastIndex)) {
      return 'Punkt sektora S1 jest poza zakresem trasy.';
    }
    if (track.s2Index !== undefined && (track.s2Index <= 0 || track.s2Index >= lastIndex)) {
      return 'Punkt sektora S2 jest poza zakresem trasy.';
    }
    if (
      track.s1Index !== undefined &&
      track.s2Index !== undefined &&
      track.s1Index >= track.s2Index
    ) {
      return 'Sektor S1 musi znajdować się przed sektorem S2.';
    }
    return null;
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const startRace = async () => {
    let hasError = false;
    if (!driverName.trim()) {
      setErrorName(true);
      hasError = true;
    }
    if (!selectedTrack) {
      setErrorTrack(true);
      hasError = true;
    }
    if (hasError) {
      setTimeout(() => {
        setErrorName(false);
        setErrorTrack(false);
      }, 500);
      return;
    }

    const track = tracks.find((t: any) => t._id === selectedTrack);
    const configError = validateTrackConfig(track);
    if (configError) {
      setErrorTrack(true);
      setTrackConfigError(configError);
      setTimeout(() => setErrorTrack(false), 500);
      return;
    }
    setTrackConfigError(null);
    setGpsError(null);

    initAudio();
    await requestWakeLock();

    if (typeof (DeviceMotionEvent as any)?.requestPermission === 'function') {
      try {
        await (DeviceMotionEvent as any).requestPermission();
      } catch (e) {
        console.error(e);
      }
    }
    if (typeof (DeviceOrientationEvent as any)?.requestPermission === 'function') {
      try {
        await (DeviceOrientationEvent as any).requestPermission();
      } catch (e) {
        console.error(e);
      }
    }

    engineRef.current = new TelemetryEngine();

    engineRef.current.onSector = (sectorIndex, time) => {
      if (sectorIndex === 1) setS1Time(time);
      if (sectorIndex === 2) setS2Time(time);
    };

    engineRef.current.onLapFinish = (lapArgs) => {
      playLapFinishBeep();
      setLapFlash(true);
      setTimeout(() => setLapFlash(false), 2000);

      recordLap({ ...lapArgs, driverName, vehicleType, trackId: track!._id })
        .then(() => flushLapQueue(recordLap).then(setPendingLapCount).catch(console.error))
        .catch((err) => {
          console.warn('Okrążenie w kolejce offline:', err);
          const count = queueLap({ ...lapArgs, driverName, vehicleType, trackId: track!._id });
          setPendingLapCount(count);
        });
    };

    engineRef.current.onLocationUpdate = (point) => {
      if (userMarker.current && leafletMap.current) {
        userMarker.current.setLatLng([point.lat, point.lon]);
        leafletMap.current.setView([point.lat, point.lon]);
      }
    };

    engineRef.current.onTelemetryTick = (state) => {
      if (!state.currentPoint) return;
      updateTelemetry({
        driverName,
        vehicleType,
        trackId: track!._id,
        lat: state.currentPoint.lat,
        lon: state.currentPoint.lon,
        speed: state.speed,
        heading: state.heading,
        gForce: state.gForce,
        leanAngle: state.leanAngle,
        timestamp: Date.now(),
      }).catch(console.error);
    };

    engineRef.current.onError = (msg) => {
      setGpsError(msg);
    };

    engineRef.current.start(track, bestLapRef.current, myLapsCount + 1);

    setPhase('f1_lights');
    setIsLightsOut(false);
    setS1Time(null);
    setS2Time(null);
    setS3Time(null);

    let currentLight = 0;
    const interval = setInterval(() => {
      currentLight++;
      if (currentLight <= 5) {
        setLights(currentLight);
        playF1StartBeep(false);
      } else {
        clearInterval(interval);
        setTimeout(() => {
          setLights(0);
          setIsLightsOut(true);
          playF1StartBeep(true);

          if (engineRef.current) {
            engineRef.current.setLapStart();
            if (isSimulated) {
              engineRef.current.startSimulator(45, 180);
            }
          }
          setS1Time(null);
          setS2Time(null);
          setS3Time(null);

          setTimeout(() => {
            setPhase('racing');
            setIsLightsOut(false);
          }, 700);
        }, 500 + Math.random() * 1200);
      }
    }, 900);
  };

  const abortRace = async () => {
    if (engineRef.current) {
      engineRef.current.stop();
      engineRef.current = null;
    }

    if (driverName) {
      clearDriverTelemetry({ driverName }).catch(console.error);
    }

    try {
      const remaining = await flushLapQueue(recordLap);
      setPendingLapCount(remaining);
    } catch (err) {
      console.error('Błąd fluszowania kolejki offline:', err);
    }

    releaseWakeLock();
    setPhase('setup');
    setLights(0);
    setGpsError(null);
    setS1Time(null);
    setS2Time(null);
    setS3Time(null);

    navigate('/control', { state: { trackId: selectedTrack } });
  };

  const cancelExitHold = () => {
    exitHoldStartRef.current = null;
    setExitHoldProgress(0);
    if (exitHoldRafRef.current) cancelAnimationFrame(exitHoldRafRef.current);
    exitHoldRafRef.current = null;
  };

  const startExitHold = () => {
    exitHoldStartRef.current = performance.now();
    const tick = () => {
      if (exitHoldStartRef.current === null) return;
      const elapsed = performance.now() - exitHoldStartRef.current;
      const pct = Math.min(elapsed / EXIT_HOLD_MS, 1);
      setExitHoldProgress(pct);
      if (pct >= 1) {
        exitHoldStartRef.current = null;
        setExitHoldProgress(0);
        abortRace();
        return;
      }
      exitHoldRafRef.current = requestAnimationFrame(tick);
    };
    exitHoldRafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    return () => {
      if (exitHoldRafRef.current) cancelAnimationFrame(exitHoldRafRef.current);
      if (engineRef.current) engineRef.current.stop();
    };
  }, []);

  useEffect(() => {
    setPendingLapCount(getQueuedLapCount());

    const tryFlush = () => {
      flushLapQueue(recordLap).then(setPendingLapCount);
    };

    tryFlush();
    window.addEventListener('online', tryFlush);
    const intervalId = setInterval(() => {
      if (navigator.onLine) tryFlush();
    }, 10000);

    return () => {
      window.removeEventListener('online', tryFlush);
      clearInterval(intervalId);
    };
  }, [recordLap]);

  // 60/120FPS rAF render loop
  useEffect(() => {
    let animationFrameId: number;
    const renderLoop = () => {
      if (engineRef.current) {
        const state = engineRef.current.getState();

        // Speedometer
        if (speedElRef.current) {
          speedElRef.current.innerText = Math.round(state.speed).toString();
        }

        // Live Ghost Delta
        if (deltaElRef.current) {
          if (state.liveGhostDelta !== null) {
            const d = state.liveGhostDelta;
            const isAhead = d <= 0;
            const sign = isAhead ? '-' : '+';
            deltaElRef.current.style.color = isAhead ? 'var(--f1-green)' : 'var(--f1-red)';
            deltaElRef.current.innerText = `${sign}${Math.abs(d).toFixed(2)}s`;
          } else {
            deltaElRef.current.innerText = 'DELTA --.--';
            deltaElRef.current.style.color = 'var(--text-muted)';
          }
        }

        // Friction Circle (G-Force dot)
        if (gForceDotRef.current) {
          const maxG = 1.5;
          const clampedG = Math.min(state.gForce, maxG);
          const normalizedRadius = (clampedG / maxG) * 32;
          const rad = (state.heading * Math.PI) / 180;
          const cx = 40 + Math.sin(rad) * normalizedRadius;
          const cy = 40 - Math.cos(rad) * normalizedRadius;
          gForceDotRef.current.setAttribute('cx', cx.toFixed(1));
          gForceDotRef.current.setAttribute('cy', cy.toFixed(1));
          gForceDotRef.current.setAttribute(
            'fill',
            clampedG > 1.0 ? 'var(--f1-red)' : clampedG > 0.6 ? 'var(--f1-yellow)' : 'var(--f1-cyan)'
          );
        }

        // Live Lap Timer
        if (liveTimerRef.current) {
          if (state.lapStartTimeLocal !== null) {
            const elapsed = performance.now() - state.lapStartTimeLocal;
            liveTimerRef.current.innerText = (elapsed / 1000).toFixed(3);
          } else {
            liveTimerRef.current.innerText = '0.000';
          }
        }

        if (leanAngleDisplay !== state.leanAngle) {
          setLeanAngleDisplay(state.leanAngle);
        }
        if (lapNumberDisplay !== state.lapNumber) {
          setLapNumberDisplay(state.lapNumber);
        }
        if (state.s3Time !== null && s3Time !== state.s3Time) {
          setS3Time(state.s3Time);
        }
      }
      animationFrameId = requestAnimationFrame(renderLoop);
    };

    if (phase === 'racing') {
      animationFrameId = requestAnimationFrame(renderLoop);
    }

    return () => cancelAnimationFrame(animationFrameId);
  }, [phase, leanAngleDisplay, lapNumberDisplay, s3Time]);

  // Setup Live Map
  useEffect(() => {
    if (phase === 'racing' && mapRef.current && !leafletMap.current) {
      const track = tracks.find((t: any) => t._id === selectedTrack);
      const startPt = track?.path?.[0] || { lat: 51.95, lon: 20.15 };

      // @ts-ignore
      leafletMap.current = L.map(mapRef.current, {
        zoomControl: false,
        attributionControl: false,
        rotate: true,
        touchRotate: true,
      } as any).setView([startPt.lat, startPt.lon], 18);

      L.tileLayer('http://mt0.google.com/vt/lyrs=s&hl=pl&x={x}&y={y}&z={z}', {
        maxZoom: 24,
        maxNativeZoom: 21,
        className: 'map-tiles-dark',
      }).addTo(leafletMap.current);

      labelsLayer.current = L.tileLayer('http://mt0.google.com/vt/lyrs=h&hl=pl&x={x}&y={y}&z={z}', {
        maxZoom: 24,
        maxNativeZoom: 21,
      });

      if (labelsVisible) {
        labelsLayer.current.addTo(leafletMap.current);
      }

      if (track?.path) {
        trackPathLayer.current = L.polyline(track.path as any, {
          color: 'var(--f1-cyan)',
          weight: 4,
          opacity: 0.85,
        }).addTo(leafletMap.current);
      }

      const html = `<div style="width:24px;height:24px;background:var(--f1-red);border-radius:50%;border:3px solid white;box-shadow:0 0 18px var(--f1-red);"></div>`;
      const icon = L.divIcon({ html, className: '', iconSize: [24, 24] });
      userMarker.current = L.marker([startPt.lat, startPt.lon], { icon }).addTo(leafletMap.current);
    }

    if (phase !== 'racing' && leafletMap.current) {
      leafletMap.current.remove();
      leafletMap.current = null;
      labelsLayer.current = null;
    }
  }, [phase, selectedTrack, tracks, labelsVisible]);

  useEffect(() => {
    if (!leafletMap.current || !labelsLayer.current) return;
    if (labelsVisible) {
      if (!leafletMap.current.hasLayer(labelsLayer.current)) {
        labelsLayer.current.addTo(leafletMap.current);
      }
    } else {
      if (leafletMap.current.hasLayer(labelsLayer.current)) {
        leafletMap.current.removeLayer(labelsLayer.current);
      }
    }
  }, [labelsVisible]);

  // Phase 1: Setup
  if (phase === 'setup') {
    return (
      <div style={{ maxWidth: '640px', margin: '40px auto', padding: '0 16px' }}>
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="telemetry-card"
          style={{
            borderTop: '3px solid var(--f1-red)',
            padding: '28px',
          }}
        >
          {/* Card Title */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '20px',
            }}
          >
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '11px',
                  fontWeight: 800,
                  color: 'var(--f1-red)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.12em',
                }}
              >
                <Gauge size={14} /> LIVE COCKPIT HUD
              </div>
              <h2
                style={{
                  fontSize: '24px',
                  fontWeight: 900,
                  letterSpacing: '0.02em',
                  marginTop: '4px',
                  color: '#ffffff',
                }}
              >
                Konfiguracja Sesji Wyścigowej
              </h2>
            </div>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 800,
                padding: '4px 10px',
                borderRadius: 'var(--radius-xs)',
                background: 'rgba(244, 63, 94, 0.15)',
                border: '1px solid var(--f1-red)',
                color: 'var(--f1-red)',
                letterSpacing: '0.08em',
              }}
            >
              FIA READY
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Driver Name Input */}
            <motion.div
              animate={errorName ? { x: [-8, 8, -6, 6, 0] } : {}}
              transition={{ duration: 0.35 }}
            >
              <label
                htmlFor="driverName"
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontSize: '11px',
                  fontWeight: 800,
                  color: errorName ? 'var(--f1-red)' : 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}
              >
                Kierowca / Alias {errorName && ' (WYMAGANE)'}
              </label>
              <input
                id="driverName"
                className="custom-input"
                style={{ borderColor: errorName ? 'var(--f1-red)' : undefined }}
                placeholder="Wpisz np. Max Verstappen..."
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
              />
            </motion.div>

            {/* Vehicle Type Selection */}
            <div>
              <label
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontSize: '11px',
                  fontWeight: 800,
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}
              >
                Kategoria Pojazdu
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{
                    padding: '14px',
                    background:
                      vehicleType === 'scooter'
                        ? 'rgba(0, 240, 255, 0.12)'
                        : 'rgba(255,255,255,0.03)',
                    borderColor:
                      vehicleType === 'scooter' ? 'var(--f1-cyan)' : 'var(--border-subtle)',
                    color: vehicleType === 'scooter' ? '#fff' : 'var(--text-secondary)',
                  }}
                  onClick={() => setVehicleType('scooter')}
                >
                  🛴 Hulajnoga Elektryczna
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{
                    padding: '14px',
                    background:
                      vehicleType === 'bike'
                        ? 'rgba(0, 230, 118, 0.12)'
                        : 'rgba(255,255,255,0.03)',
                    borderColor:
                      vehicleType === 'bike' ? 'var(--f1-green)' : 'var(--border-subtle)',
                    color: vehicleType === 'bike' ? '#fff' : 'var(--text-secondary)',
                  }}
                  onClick={() => setVehicleType('bike')}
                >
                  🚴 Rower Szosowy / Gravel
                </button>
              </div>
            </div>

            {/* Track Selector */}
            <motion.div
              animate={errorTrack ? { x: [-8, 8, -6, 6, 0] } : {}}
              transition={{ duration: 0.35 }}
            >
              <label
                htmlFor="trackSelect"
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontSize: '11px',
                  fontWeight: 800,
                  color: errorTrack ? 'var(--f1-red)' : 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}
              >
                Tor Wyścigowy {errorTrack && ' (WYMAGANE)'}
              </label>
              <select
                id="trackSelect"
                className="custom-select"
                style={{ borderColor: errorTrack ? 'var(--f1-red)' : undefined }}
                value={selectedTrack}
                onChange={(e) => setSelectedTrack(e.target.value)}
              >
                <option value="">Wybierz trasę z bazy danych...</option>
                {tracks.map((t: any) => (
                  <option key={t._id} value={t._id}>
                    {t.name} ({t.path?.length || 0} punktów)
                  </option>
                ))}
              </select>
              {trackConfigError && (
                <div
                  style={{
                    color: 'var(--f1-red)',
                    fontSize: '12px',
                    marginTop: '8px',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <AlertTriangle size={14} /> {trackConfigError}
                </div>
              )}
            </motion.div>

            {/* Options Toggle Bar: Simulator Mode & Outdoor High Contrast */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '10px',
                paddingTop: '6px',
              }}
            >
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsSimulated(!isSimulated)}
                style={{
                  padding: '10px 14px',
                  background: isSimulated ? 'rgba(0, 240, 255, 0.12)' : 'rgba(255,255,255,0.02)',
                  borderColor: isSimulated ? 'var(--f1-cyan)' : 'var(--border-subtle)',
                  color: isSimulated ? 'var(--f1-cyan)' : 'var(--text-secondary)',
                  fontSize: '11px',
                  textTransform: 'none',
                }}
              >
                <Sparkles size={14} /> {isSimulated ? 'Symulator GPS: WŁĄCZONY' : 'Symulator GPS (Test)'}
              </button>

              <button
                type="button"
                className="btn-secondary"
                onClick={() => setOutdoorMode(!outdoorMode)}
                style={{
                  padding: '10px 14px',
                  background: outdoorMode ? 'rgba(245, 158, 11, 0.12)' : 'rgba(255,255,255,0.02)',
                  borderColor: outdoorMode ? 'var(--f1-yellow)' : 'var(--border-subtle)',
                  color: outdoorMode ? 'var(--f1-yellow)' : 'var(--text-secondary)',
                  fontSize: '11px',
                  textTransform: 'none',
                }}
              >
                {outdoorMode ? <Sun size={14} /> : <Moon size={14} />}{' '}
                {outdoorMode ? 'Tryb Słoneczny: ON' : 'Tryb Słoneczny (OLED)'}
              </button>
            </div>

            {/* Action Buttons */}
            <button
              className="btn-primary"
              style={{
                marginTop: '10px',
                width: '100%',
                padding: '16px',
                fontSize: '14px',
                fontWeight: 900,
              }}
              onClick={startRace}
            >
              <Play size={16} /> ROZPOCZNIJ PROCEDURĘ STARTOWĄ (LIGHTS OUT)
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Phase 2: F1 Start Lights & Racing
  return (
    <div
      className={outdoorMode ? 'cockpit-outdoor' : ''}
      style={{
        position: 'fixed',
        inset: 0,
        background: outdoorMode ? '#000000' : 'var(--bg-deep)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Background Map in Racing Phase */}
      {phase === 'racing' && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
          <div
            ref={mapRef}
            style={{
              width: '100%',
              height: '100%',
              filter: outdoorMode ? 'brightness(0.2) contrast(1.5)' : 'brightness(0.35) saturate(1.2)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: outdoorMode
                ? 'linear-gradient(to bottom, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,0.95) 100%)'
                : 'linear-gradient(to bottom, rgba(5,6,8,0.85) 0%, rgba(5,6,8,0.3) 50%, rgba(5,6,8,0.9) 100%)',
              zIndex: 1,
            }}
          />
        </div>
      )}

      {/* GPS Error & Offline Banners */}
      <AnimatePresence>
        {gpsError && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            style={{
              position: 'absolute',
              top: '72px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 10002,
              background: 'rgba(244, 63, 94, 0.9)',
              color: '#ffffff',
              padding: '8px 16px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AlertTriangle size={14} /> {gpsError}
          </motion.div>
        )}
        {pendingLapCount > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            style={{
              position: 'absolute',
              top: gpsError ? '110px' : '72px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 10002,
              background: 'rgba(245, 158, 11, 0.9)',
              color: '#050608',
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '11px',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <WifiOff size={13} /> {pendingLapCount} okrążeń w pamięci offline
          </motion.div>
        )}
      </AnimatePresence>

      {/* F1 5-Red-Light Countdown Screen */}
      {phase === 'f1_lights' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#000000',
            zIndex: 10,
            padding: '24px',
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 'clamp(6px, 2vw, 16px)',
              background: '#090b10',
              padding: 'clamp(12px, 3vw, 28px)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.9)',
            }}
          >
            {[1, 2, 3, 4, 5].map((i) => {
              const active = !isLightsOut && lights >= i;
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'clamp(6px, 1.5vw, 10px)',
                    padding: 'clamp(6px, 1.5vw, 12px)',
                    background: '#050608',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid rgba(255,255,255,0.05)',
                  }}
                >
                  <div
                    style={{
                      width: 'clamp(28px, 8vw, 48px)',
                      height: 'clamp(28px, 8vw, 48px)',
                      borderRadius: '50%',
                      background: active ? '#f43f5e' : '#151922',
                      boxShadow: active
                        ? '0 0 35px #f43f5e, inset 0 0 10px rgba(255,255,255,0.6)'
                        : 'none',
                      transition: 'all 0.1s ease',
                    }}
                  />
                  <div
                    style={{
                      width: 'clamp(28px, 8vw, 48px)',
                      height: 'clamp(28px, 8vw, 48px)',
                      borderRadius: '50%',
                      background: active ? '#f43f5e' : '#151922',
                      boxShadow: active
                        ? '0 0 35px #f43f5e, inset 0 0 10px rgba(255,255,255,0.6)'
                        : 'none',
                      transition: 'all 0.1s ease',
                    }}
                  />
                </div>
              );
            })}
          </div>

          <h1
            style={{
              marginTop: '36px',
              color: isLightsOut ? 'var(--f1-green)' : '#ffffff',
              fontFamily: 'var(--font-mono)',
              fontSize: 'clamp(22px, 5vw, 42px)',
              fontWeight: 900,
              letterSpacing: '0.04em',
              textAlign: 'center',
              textShadow: isLightsOut ? '0 0 30px var(--f1-green)' : 'none',
            }}
          >
            {isLightsOut ? 'LIGHTS OUT AND AWAY WE GO!' : 'CZEKAJ NA ZGASZENIE ŚWIATEŁ...'}
          </h1>
        </div>
      )}

      {/* Lap Finish Flash Banner */}
      <AnimatePresence>
        {lapFlash && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.15 }}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0, 230, 118, 0.18)',
              backdropFilter: 'blur(8px)',
              zIndex: 10001,
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                fontSize: 'clamp(64px, 14vw, 120px)',
                color: '#ffffff',
                textShadow: '0 0 45px var(--f1-green)',
                fontWeight: 900,
                fontFamily: 'var(--font-mono)',
                lineHeight: 1,
              }}
            >
              LAP COMPLETED
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main OLED HUD */}
      {phase === 'racing' && (
        <div
          style={{
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            justifyContent: 'space-between',
          }}
        >
          {/* Top Control Bar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '16px 20px',
              gap: '12px',
            }}
          >
            {/* Driver Pill */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(0, 0, 0, 0.65)',
                  border: '1px solid var(--border-subtle)',
                  backdropFilter: 'blur(16px)',
                }}
              >
                <span
                  style={{
                    color: 'var(--f1-green)',
                    fontWeight: 900,
                    fontSize: 'clamp(16px, 3.5vw, 20px)',
                    letterSpacing: '0.04em',
                  }}
                >
                  {driverName}
                </span>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-xs)',
                    background: 'rgba(255,255,255,0.08)',
                    fontSize: '11px',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {vehicleType}
                </span>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-xs)',
                    background: 'rgba(0, 240, 255, 0.12)',
                    fontSize: '11px',
                    fontWeight: 800,
                    color: 'var(--f1-cyan)',
                  }}
                  className="font-digital"
                >
                  LAP {lapNumberDisplay}
                </span>
                {isSimulated && (
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-xs)',
                      background: 'rgba(244, 63, 94, 0.15)',
                      color: 'var(--f1-red)',
                      fontSize: '10px',
                      fontWeight: 800,
                    }}
                  >
                    SIM 45KM/H
                  </span>
                )}
              </div>
            </div>

            {/* Quick Action Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                className="btn-secondary"
                style={{
                  padding: '8px 12px',
                  fontSize: '11px',
                  background: 'rgba(0,0,0,0.6)',
                  backdropFilter: 'blur(10px)',
                }}
                onClick={() => setLabelsVisible(!labelsVisible)}
                title="Przełącz nazwy ulic"
              >
                <MapPin size={13} />
              </button>

              <button
                className="btn-secondary"
                style={{
                  padding: '8px 12px',
                  fontSize: '11px',
                  background: 'rgba(0,0,0,0.6)',
                  backdropFilter: 'blur(10px)',
                }}
                onClick={toggleFullscreen}
                title="Tryb pełnoekranowy"
              >
                {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>

              {/* Hold-to-abort Safety Button */}
              <button
                className="btn-danger"
                onPointerDown={startExitHold}
                onPointerUp={cancelExitHold}
                onPointerLeave={cancelExitHold}
                onPointerCancel={cancelExitHold}
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  padding: '10px 18px',
                  minHeight: '42px',
                  background: 'rgba(244, 63, 94, 0.15)',
                  border: '1px solid var(--f1-red)',
                  color: '#ffffff',
                  touchAction: 'none',
                  userSelect: 'none',
                  fontSize: '12px',
                  fontWeight: 900,
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    bottom: 0,
                    width: `${exitHoldProgress * 100}%`,
                    background: 'var(--f1-red)',
                    opacity: 0.6,
                    transition: exitHoldProgress === 0 ? 'width 0.15s ease-out' : 'none',
                  }}
                />
                <span style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <RotateCcw size={13} /> PRZYTRZYMAJ ABY ZAKOŃCZYĆ
                </span>
              </button>
            </div>
          </div>

          {/* Central Telemetry Section */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '8px 16px',
            }}
          >
            {/* Live Lap Time Banner */}
            <div
              style={{
                background: 'rgba(9, 12, 18, 0.75)',
                border: '1px solid rgba(0, 240, 255, 0.35)',
                borderRadius: 'var(--radius-md)',
                padding: '6px 28px',
                textAlign: 'center',
                marginBottom: '8px',
                backdropFilter: 'blur(20px)',
                boxShadow: '0 8px 30px rgba(0, 240, 255, 0.15)',
              }}
            >
              <div
                style={{
                  fontSize: '10px',
                  color: 'var(--f1-cyan)',
                  fontWeight: 800,
                  letterSpacing: '0.12em',
                }}
              >
                LIVE LAP TIME
              </div>
              <div
                ref={liveTimerRef}
                className="font-digital cockpit-metric-value"
                style={{
                  fontSize: 'clamp(32px, 7vw, 48px)',
                  color: '#ffffff',
                  fontWeight: 800,
                  textShadow: '0 0 20px rgba(255,255,255,0.4)',
                  lineHeight: 1.1,
                }}
              >
                0.000
              </div>
            </div>

            {/* Live Ghost Delta */}
            <div
              ref={deltaElRef}
              className="font-digital"
              style={{
                fontSize: 'clamp(20px, 4.5vw, 32px)',
                height: '36px',
                fontWeight: 800,
                letterSpacing: '-0.02em',
                textShadow: '0 0 12px currentColor',
              }}
            >
              DELTA --.--
            </div>

            {/* Main Speed Readout */}
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'center',
                margin: '10px 0',
              }}
            >
              <div
                ref={speedElRef}
                className="font-digital cockpit-metric-value"
                style={{
                  fontSize: 'clamp(100px, 24vw, 180px)',
                  color: '#ffffff',
                  fontWeight: 800,
                  lineHeight: 0.9,
                  textShadow: '0 0 30px rgba(0, 240, 255, 0.25)',
                }}
              >
                0
              </div>
              <div
                className="cockpit-unit"
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: 'clamp(18px, 4vw, 30px)',
                  fontWeight: 800,
                  marginLeft: '12px',
                  letterSpacing: '0.04em',
                }}
              >
                KM/H
              </div>
            </div>

            {/* Motorsport Dual Gauge: Friction Circle & Lean Horizon */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '24px',
                background: 'rgba(5, 7, 12, 0.75)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                padding: '12px 20px',
                backdropFilter: 'blur(20px)',
              }}
            >
              {/* Friction Circle (G-G Diagram) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <svg width="64" height="64" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="32" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
                  <circle cx="40" cy="40" r="16" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                  <line x1="8" y1="40" x2="72" y2="40" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                  <line x1="40" y1="8" x2="40" y2="72" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                  <circle
                    ref={gForceDotRef}
                    cx="40"
                    cy="40"
                    r="5"
                    fill="var(--f1-cyan)"
                    style={{
                      filter: 'drop-shadow(0 0 6px var(--f1-cyan))',
                      transition: 'cx 0.08s ease-out, cy 0.08s ease-out',
                    }}
                  />
                </svg>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '9px', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
                    G-FORCE
                  </span>
                  <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-main)' }}>
                    FRICTION CIRCLE
                  </span>
                </div>
              </div>

              <div style={{ width: '1px', height: '40px', background: 'var(--border-subtle)' }} />

              {/* Lean Horizon Angle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: `rotate(${leanAngleDisplay}deg)`,
                    transition: 'transform 0.15s ease-out',
                  }}
                >
                  <Compass size={22} color="var(--f1-cyan)" />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '9px', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
                    LEAN ANGLE
                  </span>
                  <span
                    className="font-digital"
                    style={{ fontSize: '14px', fontWeight: 800, color: 'var(--f1-cyan)' }}
                  >
                    {Math.abs(leanAngleDisplay)}°{' '}
                    <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                      {leanAngleDisplay > 4 ? 'RIGHT' : leanAngleDisplay < -4 ? 'LEFT' : 'CENTER'}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* F1 Sector Timing Tower (Bottom HUD) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: '6px',
              padding: '12px 16px',
              background: 'rgba(5, 7, 12, 0.85)',
              borderTop: '1px solid var(--border-subtle)',
              backdropFilter: 'blur(24px)',
            }}
          >
            {/* Sector 1 */}
            <div
              className={`sector-badge ${getSectorClass(s1Time, sectorStats.personalS1, sectorStats.overallS1)}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                padding: '10px 8px',
                borderRadius: 'var(--radius-sm)',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.06em', opacity: 0.8 }}>
                SEKTOR 1
              </div>
              <div className="font-digital" style={{ fontSize: 'clamp(18px, 4.5vw, 26px)', fontWeight: 800, marginTop: '2px' }}>
                {s1Time ? (s1Time / 1000).toFixed(3) : '--.---'}
              </div>
            </div>

            {/* Sector 2 */}
            <div
              className={`sector-badge ${getSectorClass(s2Time, sectorStats.personalS2, sectorStats.overallS2)}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                padding: '10px 8px',
                borderRadius: 'var(--radius-sm)',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.06em', opacity: 0.8 }}>
                SEKTOR 2
              </div>
              <div className="font-digital" style={{ fontSize: 'clamp(18px, 4.5vw, 26px)', fontWeight: 800, marginTop: '2px' }}>
                {s2Time ? (s2Time / 1000).toFixed(3) : '--.---'}
              </div>
            </div>

            {/* Sector 3 (Lap) */}
            <div
              className={`sector-badge ${getSectorClass(s3Time, sectorStats.personalS3, sectorStats.overallS3)}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                padding: '10px 8px',
                borderRadius: 'var(--radius-sm)',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.06em', opacity: 0.8 }}>
                SEKTOR 3 (FINISH)
              </div>
              <div className="font-digital" style={{ fontSize: 'clamp(18px, 4.5vw, 26px)', fontWeight: 800, marginTop: '2px' }}>
                {s3Time ? (s3Time / 1000).toFixed(3) : '--.---'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
