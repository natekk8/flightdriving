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
  Maximize2,
  Minimize2,
  Play,
  Square,
  Sparkles,
  MapPin,
  AlertCircle,
  WifiOff,
  Sun,
  Moon,
} from 'lucide-react';

export default function Cockpit() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<'setup' | 'countdown' | 'racing'>('setup');
  const [driverName, setDriverName] = useState('');
  const [vehicleType, setVehicleType] = useState<'scooter' | 'bike'>('scooter');
  const [selectedTrack, setSelectedTrack] = useState('');
  const [countdownStep, setCountdownStep] = useState(0);
  const labelsVisible = true;
  const [showMap, setShowMap] = useState(false);
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
  const [lastCompletedLapTime, setLastCompletedLapTime] = useState<number | null>(null);

  // UI elements for rAF loop
  const speedElRef = useRef<HTMLDivElement>(null);
  const deltaElRef = useRef<HTMLDivElement>(null);
  const gForceDotRef = useRef<SVGCircleElement>(null);
  const liveTimerRef = useRef<HTMLDivElement>(null);

  const engineRef = useRef<TelemetryEngine | null>(null);
  const [pendingLapCount, setPendingLapCount] = useState(0);

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
      return 'Ta trasa nie ma poprawnie zdefiniowanej ścieżki (min. 2 punkty).';
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
      setLastCompletedLapTime(lapArgs.lapTime);
      setTimeout(() => setLastCompletedLapTime(null), 3000);

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

    // Countdown sequence (3, 2, 1, START)
    setPhase('countdown');
    setCountdownStep(3);
    playF1StartBeep(false);

    let step = 3;
    const countdownTimer = setInterval(() => {
      step--;
      if (step > 0) {
        setCountdownStep(step);
        playF1StartBeep(false);
      } else {
        clearInterval(countdownTimer);
        setCountdownStep(0); // GO!
        playF1StartBeep(true);

        if (engineRef.current) {
          engineRef.current.setLapStart();
          if (isSimulated) {
            engineRef.current.startSimulator(40, 160);
          }
        }
        setS1Time(null);
        setS2Time(null);
        setS3Time(null);

        setTimeout(() => {
          setPhase('racing');
        }, 500);
      }
    }, 850);
  };

  const stopRace = async () => {
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
    setCountdownStep(0);
    setGpsError(null);
    setS1Time(null);
    setS2Time(null);
    setS3Time(null);

    navigate('/control', { state: { trackId: selectedTrack } });
  };

  useEffect(() => {
    return () => {
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

  // 60FPS rAF render loop for speedometer and lap timer
  useEffect(() => {
    let animationFrameId: number;
    const renderLoop = () => {
      if (engineRef.current) {
        const state = engineRef.current.getState();

        if (speedElRef.current) {
          speedElRef.current.innerText = Math.round(state.speed).toString();
        }

        if (deltaElRef.current) {
          if (state.liveGhostDelta !== null) {
            const d = state.liveGhostDelta;
            const isAhead = d <= 0;
            const sign = isAhead ? '-' : '+';
            deltaElRef.current.style.color = isAhead ? 'var(--accent-green)' : 'var(--accent-amber)';
            deltaElRef.current.innerText = `${sign}${Math.abs(d).toFixed(2)}s`;
          } else {
            deltaElRef.current.innerText = '--.--';
            deltaElRef.current.style.color = 'var(--text-muted)';
          }
        }

        if (gForceDotRef.current) {
          const maxG = 1.5;
          const clampedG = Math.min(state.gForce, maxG);
          const normalizedRadius = (clampedG / maxG) * 28;
          const rad = (state.heading * Math.PI) / 180;
          const cx = 36 + Math.sin(rad) * normalizedRadius;
          const cy = 36 - Math.cos(rad) * normalizedRadius;
          gForceDotRef.current.setAttribute('cx', cx.toFixed(1));
          gForceDotRef.current.setAttribute('cy', cy.toFixed(1));
        }

        if (liveTimerRef.current) {
          if (state.lapStartTimeLocal !== null) {
            const elapsed = performance.now() - state.lapStartTimeLocal;
            const seconds = elapsed / 1000;
            const mins = Math.floor(seconds / 60);
            const remSecs = (seconds % 60).toFixed(2);
            liveTimerRef.current.innerText =
              mins > 0 ? `${mins}:${remSecs.padStart(5, '0')}` : remSecs;
          } else {
            liveTimerRef.current.innerText = '0.00';
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

  // Setup Leaflet map when user expands map
  useEffect(() => {
    if (phase === 'racing' && showMap && mapRef.current && !leafletMap.current) {
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

      labelsLayer.current = L.tileLayer(
        'http://mt0.google.com/vt/lyrs=h&hl=pl&x={x}&y={y}&z={z}',
        { maxZoom: 24, maxNativeZoom: 21 }
      );

      if (labelsVisible) {
        labelsLayer.current.addTo(leafletMap.current);
      }

      if (track?.path) {
        trackPathLayer.current = L.polyline(
          track.path.map((p: any) => [p.lat, p.lon]),
          { color: 'var(--accent-green)', weight: 5, opacity: 0.9 }
        ).addTo(leafletMap.current);
      }

      const icon = L.divIcon({
        html: `<div style="width:18px;height:18px;background:var(--accent-green);border:2px solid #ffffff;border-radius:50%;box-shadow:0 0 10px var(--accent-green);"></div>`,
        className: '',
        iconSize: [18, 18],
      });
      userMarker.current = L.marker([startPt.lat, startPt.lon], { icon }).addTo(
        leafletMap.current
      );
    }

    if (!showMap && leafletMap.current) {
      leafletMap.current.remove();
      leafletMap.current = null;
      userMarker.current = null;
      trackPathLayer.current = null;
    }
  }, [phase, showMap, selectedTrack, tracks, labelsVisible]);

  // PHASE 1: MINIMALIST SETUP
  if (phase === 'setup') {
    return (
      <div style={{ maxWidth: '480px', margin: '40px auto', padding: '0 16px' }}>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="clean-card"
          style={{ padding: '28px 24px' }}
        >
          {/* Header */}
          <div style={{ marginBottom: '24px' }}>
            <h1
              style={{
                fontSize: '22px',
                fontWeight: 800,
                letterSpacing: '-0.02em',
                marginBottom: '6px',
                color: 'var(--text-main)',
              }}
            >
              Rozpocznij przejazd
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Wybierz tor oraz pojazd, aby rozpocząć precyzyjny pomiar okrążeń.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Track Selector */}
            <div>
              <label
                htmlFor="trackSelect"
                style={{
                  display: 'block',
                  marginBottom: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: errorTrack ? 'var(--accent-red)' : 'var(--text-secondary)',
                }}
              >
                Tor {errorTrack && '— wybierz tor'}
              </label>
              <select
                id="trackSelect"
                className="custom-select"
                style={{ borderColor: errorTrack ? 'var(--accent-red)' : undefined }}
                value={selectedTrack}
                onChange={(e) => setSelectedTrack(e.target.value)}
              >
                <option value="">Wybierz tor...</option>
                {tracks.map((t: any) => (
                  <option key={t._id} value={t._id}>
                    {t.name} ({t.path?.length || 0} pkt)
                  </option>
                ))}
              </select>
              {trackConfigError && (
                <div
                  style={{
                    color: 'var(--accent-red)',
                    fontSize: '12px',
                    marginTop: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <AlertCircle size={13} /> {trackConfigError}
                </div>
              )}
            </div>

            {/* Vehicle Type Selector: Hulajnoga / Rower */}
            <div>
              <label
                style={{
                  display: 'block',
                  marginBottom: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                }}
              >
                Pojazd
              </label>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '4px',
                  background: 'rgba(255, 255, 255, 0.04)',
                  padding: '3px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setVehicleType('scooter')}
                  style={{
                    position: 'relative',
                    padding: '9px 12px',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: vehicleType === 'scooter' ? '#ffffff' : 'var(--text-secondary)',
                    background: 'transparent',
                    borderRadius: 'calc(var(--radius-sm) - 2px)',
                    zIndex: 1,
                  }}
                >
                  Hulajnoga
                  {vehicleType === 'scooter' && (
                    <motion.div
                      layoutId="vehicleSelectorPill"
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
                  onClick={() => setVehicleType('bike')}
                  style={{
                    position: 'relative',
                    padding: '9px 12px',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: vehicleType === 'bike' ? '#ffffff' : 'var(--text-secondary)',
                    background: 'transparent',
                    borderRadius: 'calc(var(--radius-sm) - 2px)',
                    zIndex: 1,
                  }}
                >
                  Rower
                  {vehicleType === 'bike' && (
                    <motion.div
                      layoutId="vehicleSelectorPill"
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
            </div>

            {/* Driver Name Input */}
            <div>
              <label
                htmlFor="driverName"
                style={{
                  display: 'block',
                  marginBottom: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: errorName ? 'var(--accent-red)' : 'var(--text-secondary)',
                }}
              >
                Kierowca {errorName && '— wpisz nazwę'}
              </label>
              <input
                id="driverName"
                className="custom-input"
                style={{ borderColor: errorName ? 'var(--accent-red)' : undefined }}
                placeholder="Twoje imię lub pseudonim"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
              />
            </div>

            {/* Extra Options */}
            <div
              style={{
                display: 'flex',
                gap: '8px',
                paddingTop: '4px',
              }}
            >
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsSimulated(!isSimulated)}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  fontSize: '12px',
                  color: isSimulated ? 'var(--accent-green)' : 'var(--text-secondary)',
                  background: isSimulated ? 'var(--accent-green-bg)' : 'transparent',
                  borderColor: isSimulated ? 'rgba(16, 185, 129, 0.3)' : 'var(--border-subtle)',
                }}
              >
                <Sparkles size={13} />
                <span>Symulacja GPS</span>
              </button>

              <button
                type="button"
                className="btn-secondary"
                onClick={() => setOutdoorMode(!outdoorMode)}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  fontSize: '12px',
                  color: outdoorMode ? '#ffffff' : 'var(--text-secondary)',
                  background: outdoorMode ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
                }}
              >
                {outdoorMode ? <Sun size={13} /> : <Moon size={13} />}
                <span>Kontrast</span>
              </button>
            </div>

            {/* Start Button */}
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              className="btn-primary"
              style={{
                marginTop: '12px',
                width: '100%',
                padding: '14px',
                fontSize: '14px',
                fontWeight: 700,
              }}
              onClick={startRace}
            >
              <Play size={16} fill="currentColor" />
              <span>Rozpocznij jazdę</span>
            </motion.button>
          </div>
        </motion.div>
      </div>
    );
  }

  // PHASE 2: SIMPLE COUNTDOWN
  if (phase === 'countdown') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 'calc(100vh - 120px)',
          textAlign: 'center',
        }}
      >
        <motion.div
          key={countdownStep}
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.3 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          <div
            className="font-digital"
            style={{
              fontSize: 'clamp(80px, 18vw, 160px)',
              fontWeight: 800,
              color: countdownStep === 0 ? 'var(--accent-green)' : '#ffffff',
              lineHeight: 1,
            }}
          >
            {countdownStep > 0 ? countdownStep : 'START'}
          </div>
        </motion.div>
        <p style={{ marginTop: '16px', color: 'var(--text-muted)', fontSize: '14px' }}>
          Przygotuj się do rozpoczęcia okrążenia
        </p>
      </div>
    );
  }

  // PHASE 3: RACING HUD (MINIMALIST & INTUITIVE)
  return (
    <div
      className={outdoorMode ? 'cockpit-outdoor' : ''}
      style={{
        maxWidth: '960px',
        margin: '0 auto',
        padding: '20px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}
    >
      {/* Top Session Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        {/* Driver info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px', fontWeight: 700, color: '#ffffff' }}>
            {driverName}
          </span>
          <span
            style={{
              fontSize: '11px',
              padding: '3px 8px',
              borderRadius: 'var(--radius-xs)',
              background: 'rgba(255, 255, 255, 0.08)',
              color: 'var(--text-secondary)',
              fontWeight: 600,
            }}
          >
            {vehicleType === 'scooter' ? 'Hulajnoga' : 'Rower'}
          </span>
          <span
            className="font-digital"
            style={{
              fontSize: '12px',
              padding: '3px 8px',
              borderRadius: 'var(--radius-xs)',
              background: 'var(--accent-green-bg)',
              color: 'var(--accent-green)',
              fontWeight: 700,
            }}
          >
            Okrążenie {lapNumberDisplay}
          </span>
          {isSimulated && (
            <span
              style={{
                fontSize: '11px',
                padding: '3px 8px',
                borderRadius: 'var(--radius-xs)',
                background: 'rgba(245, 158, 11, 0.15)',
                color: 'var(--accent-amber)',
                fontWeight: 600,
              }}
            >
              Symulator
            </span>
          )}
        </div>

        {/* Quick controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {pendingLapCount > 0 && (
            <span
              title="Okrążenia oczekujące na wysłanie"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                color: 'var(--accent-amber)',
              }}
            >
              <WifiOff size={13} /> {pendingLapCount}
            </span>
          )}

          <button
            className="btn-secondary"
            style={{ padding: '7px 12px', fontSize: '12px' }}
            onClick={() => setShowMap(!showMap)}
          >
            <MapPin size={13} />
            <span>{showMap ? 'Ukryj mapę' : 'Mapa'}</span>
          </button>

          <button
            className="btn-secondary"
            style={{ padding: '7px 10px' }}
            onClick={toggleFullscreen}
            aria-label="Pełny ekran"
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>

          <motion.button
            whileTap={{ scale: 0.96 }}
            className="btn-danger"
            onClick={stopRace}
            style={{ padding: '7px 14px', fontSize: '12px', fontWeight: 700 }}
          >
            <Square size={13} fill="currentColor" />
            <span>Zakończ</span>
          </motion.button>
        </div>
      </div>

      {/* GPS Warning */}
      <AnimatePresence>
        {gpsError && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--accent-red-bg)',
              border: '1px solid rgba(244, 63, 94, 0.3)',
              color: 'var(--accent-red)',
              fontSize: '12px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AlertCircle size={14} /> {gpsError}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lap finished alert */}
      <AnimatePresence>
        {lastCompletedLapTime !== null && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            style={{
              padding: '12px 18px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--accent-green-bg)',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              color: 'var(--accent-green)',
              textAlign: 'center',
              fontWeight: 700,
              fontSize: '14px',
            }}
          >
            Ukończono okrążenie: {(lastCompletedLapTime / 1000).toFixed(3)}s
          </motion.div>
        )}
      </AnimatePresence>

      {/* Center Speed & Timer Hero */}
      <div
        className="clean-card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '36px 20px',
          textAlign: 'center',
        }}
      >
        {/* Speedometer */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <div
            ref={speedElRef}
            className="font-digital cockpit-metric-value"
            style={{
              fontSize: 'clamp(84px, 20vw, 150px)',
              fontWeight: 800,
              lineHeight: 0.9,
              letterSpacing: '-0.04em',
            }}
          >
            0
          </div>
          <span style={{ fontSize: '18px', color: 'var(--text-muted)', fontWeight: 600 }}>
            km/h
          </span>
        </div>

        {/* Live Lap Time & Delta */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            marginTop: '20px',
            paddingTop: '16px',
            borderTop: '1px solid var(--border-subtle)',
            width: '100%',
            justifyContent: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
              Czas okrążenia
            </div>
            <div
              ref={liveTimerRef}
              className="font-digital"
              style={{ fontSize: '28px', fontWeight: 800, color: '#ffffff' }}
            >
              0.00
            </div>
          </div>

          <div style={{ width: '1px', height: '32px', background: 'var(--border-subtle)' }} />

          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
              Różnica (Delta)
            </div>
            <div
              ref={deltaElRef}
              className="font-digital"
              style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-muted)' }}
            >
              --.--
            </div>
          </div>
        </div>
      </div>

      {/* Sectors Breakdown */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '12px',
        }}
      >
        <div className="clean-card" style={{ padding: '14px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
            Sektor 1
          </div>
          <div
            className={`font-digital sector-badge ${getSectorClass(
              s1Time,
              sectorStats.personalS1,
              sectorStats.overallS1
            )}`}
            style={{ fontSize: '16px', marginTop: '6px', width: '100%' }}
          >
            {s1Time ? `${(s1Time / 1000).toFixed(3)}s` : '--.---'}
          </div>
        </div>

        <div className="clean-card" style={{ padding: '14px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
            Sektor 2
          </div>
          <div
            className={`font-digital sector-badge ${getSectorClass(
              s2Time,
              sectorStats.personalS2,
              sectorStats.overallS2
            )}`}
            style={{ fontSize: '16px', marginTop: '6px', width: '100%' }}
          >
            {s2Time ? `${(s2Time / 1000).toFixed(3)}s` : '--.---'}
          </div>
        </div>

        <div className="clean-card" style={{ padding: '14px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
            Sektor 3
          </div>
          <div
            className={`font-digital sector-badge ${getSectorClass(
              s3Time,
              sectorStats.personalS3,
              sectorStats.overallS3
            )}`}
            style={{ fontSize: '16px', marginTop: '6px', width: '100%' }}
          >
            {s3Time ? `${(s3Time / 1000).toFixed(3)}s` : '--.---'}
          </div>
        </div>
      </div>

      {/* Map View (Toggleable) */}
      <AnimatePresence>
        {showMap && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: '320px' }}
            exit={{ opacity: 0, height: 0 }}
            className="clean-card"
            style={{ overflow: 'hidden', padding: 0 }}
          >
            <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
