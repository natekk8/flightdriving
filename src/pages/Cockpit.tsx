import { useState, useEffect, useRef, useMemo } from 'react';
import { useMutation, useQuery } from 'convex/react';
// @ts-ignore
import { api } from '../../convex/_generated/api';
import { checkLineIntersection, generateGateLine, GPSKalmanFilter, interpolateSubPoints, getDynamicGateWidth, calculateTrackProgress } from '../lib/math';
import { initAudio, playF1StartBeep, playLapFinishBeep, speakRaceEngineerMessage } from '../lib/audio';
import { requestWakeLock, releaseWakeLock } from '../lib/wakelock';
import { queueLap, flushLapQueue, getQueuedLapCount } from '../lib/offlineQueue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

type Point = { lat: number; lon: number };

// Ignore GPS fixes worse than this (meters) for lap/sector gate detection -
// a poor fix can otherwise register a false gate crossing.
const MAX_GPS_ACCURACY_METERS = 25;
// Minimum time between two detections of the *same* gate, to avoid GPS
// jitter re-triggering the gate crossing twice in a row.
const MIN_GATE_REARM_MS = 2000;

export default function Cockpit() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<'setup' | 'f1_lights' | 'racing'>('setup');
  const [driverName, setDriverName] = useState('');
  const [vehicleType, setVehicleType] = useState<'scooter' | 'bike'>('scooter');
  const [selectedTrack, setSelectedTrack] = useState('');
  const [lights, setLights] = useState(0); 
  
  // Validation errors
  const [errorName, setErrorName] = useState(false);
  const [errorTrack, setErrorTrack] = useState(false);
  const [trackConfigError, setTrackConfigError] = useState<string | null>(null);
  // GPS permission/availability error shown to the driver
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Real-time state (avoids React re-renders via refs)
  const speedRef = useRef(0);
  const maxSpeedRef = useRef(0);
  const deltaRef = useRef<number | null>(null);
  const liveGhostDeltaRef = useRef<number | null>(null);
  const gForceRef = useRef(0);
  const leanAngleRef = useRef(0);
  const [leanAngleDisplay, setLeanAngleDisplay] = useState(0);
  const lapStartTimeRef = useRef<number | null>(null);
  const lapNumberRef = useRef<number>(1);
  const timeOffsetRef = useRef<number>(0);
  const lapStartTimeLocalRef = useRef<number | null>(null);

  // Timing state
  const [s1Time, setS1Time] = useState<number | null>(null);
  const [s2Time, setS2Time] = useState<number | null>(null);
  const [s3Time, setS3Time] = useState<number | null>(null);
  const [lapFlash, setLapFlash] = useState(false);

  // UI elements for rAF loop
  const speedElRef = useRef<HTMLDivElement>(null);
  const deltaElRef = useRef<HTMLDivElement>(null);
  const gForceBarRef = useRef<HTMLDivElement>(null);
  const liveTimerRef = useRef<HTMLDivElement>(null);

  const watchIdRef = useRef<number | null>(null);
  const motionHandlerRef = useRef<any>(null);
  const orientationHandlerRef = useRef<any>(null);


  // Laps that failed to sync to Convex and are waiting to be resent
  const [pendingLapCount, setPendingLapCount] = useState(0);

  // "Hold to confirm" state for the ZAKOŃCZ (exit race) button
  const [exitHoldProgress, setExitHoldProgress] = useState(0);
  const exitHoldStartRef = useRef<number | null>(null);
  const exitHoldRafRef = useRef<number | null>(null);
  const EXIT_HOLD_MS = 900;

  const [isLightsOut, setIsLightsOut] = useState(false);

  // @ts-ignore
  const rawTracks = useQuery(api.tracks.getTracks);
  const tracks = useMemo(() => rawTracks ?? [], [rawTracks]);
  // @ts-ignore
  const rawLaps = useQuery(api.laps.getTimingBoard, { trackId: selectedTrack || undefined, vehicleType });
  const laps = useMemo(() => rawLaps ?? [], [rawLaps]);
  // @ts-ignore
  const updateTelemetry = useMutation(api.telemetry.update);
  // @ts-ignore
  const recordLap = useMutation(api.laps.record);

  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const userMarker = useRef<L.Marker | null>(null);
  const trackPathLayer = useRef<L.Polyline | null>(null);

  const bestLapRef = useRef<any>(null);
  useEffect(() => {
    bestLapRef.current = laps.length > 0 ? [...laps].sort((a: any, b: any) => a.lapTime - b.lapTime)[0] : null;
  }, [laps]);

  const validateTrackConfig = (track: any): string | null => {
    if (!track || !track.path || track.path.length < 2) {
      return 'Ta trasa nie ma poprawnie zdefiniowanej ścieżki (min. 2 punkty). Popraw ją w Ustawieniach Trasy.';
    }
    const lastIndex = track.path.length - 1;
    if (track.s1Index !== undefined && (track.s1Index <= 0 || track.s1Index >= lastIndex)) {
      return 'Punkt sektora S1 tej trasy jest poza zakresem ścieżki. Popraw go w Ustawieniach Trasy.';
    }
    if (track.s2Index !== undefined && (track.s2Index <= 0 || track.s2Index >= lastIndex)) {
      return 'Punkt sektora S2 tej trasy jest poza zakresem ścieżki. Popraw go w Ustawieniach Trasy.';
    }
    if (track.s1Index !== undefined && track.s2Index !== undefined && track.s1Index >= track.s2Index) {
      return 'Sektor S1 musi znajdować się przed sektorem S2 na trasie. Popraw ją w Ustawieniach Trasy.';
    }
    return null;
  };

  const startRace = async () => {
    let hasError = false;
    if (!driverName) { setErrorName(true); hasError = true; }
    if (!selectedTrack) { setErrorTrack(true); hasError = true; }
    if (hasError) {
      setTimeout(() => { setErrorName(false); setErrorTrack(false); }, 500);
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
    
    // Start GPS tracking early so connection is live and verified
    startGPS();

    setPhase('f1_lights');
    setIsLightsOut(false);
    
    setS1Time(null); setS2Time(null); setS3Time(null);
    maxSpeedRef.current = 0;
    lapStartTimeRef.current = null;
    lapStartTimeLocalRef.current = null;
    lapNumberRef.current = 1;
    
    if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
      try { await (DeviceMotionEvent as any).requestPermission(); } catch (e) { console.error(e); }
    }
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      try { await (DeviceOrientationEvent as any).requestPermission(); } catch (e) { console.error(e); }
    }
    
    motionHandlerRef.current = (e: DeviceMotionEvent) => {
      const x = e.acceleration?.x || 0;
      const y = e.acceleration?.y || 0;
      gForceRef.current = Math.sqrt(x*x + y*y) / 9.81;
    };
    window.addEventListener('devicemotion', motionHandlerRef.current);

    orientationHandlerRef.current = (e: DeviceOrientationEvent) => {
      // Roll angle (gamma) or pitch (beta)
      const roll = e.gamma || 0;
      leanAngleRef.current = Math.round(roll);
      setLeanAngleDisplay(Math.round(roll));
    };
    window.addEventListener('deviceorientation', orientationHandlerRef.current);

    let currentLight = 0;
    const interval = setInterval(() => {
      currentLight++;
      if (currentLight <= 5) {
        setLights(currentLight);
        playF1StartBeep(false);
      } else {
        clearInterval(interval);
        // Random F1 delay before Lights Out (500ms - 2000ms)
        setTimeout(() => {
          setLights(0);
          setIsLightsOut(true);
          playF1StartBeep(true);
          speakRaceEngineerMessage("Start! Dajesz gazu!");
          
          setTimeout(() => {
            setPhase('racing');
            setIsLightsOut(false);
          }, 800);
        }, 500 + Math.random() * 1500);
      }
    }, 1000);
  };

  const startGPS = () => {
    const track = tracks.find((t: any) => t._id === selectedTrack);
    if (!track || !track.path || track.path.length < 2) return;

    // Generate Gates with dynamic width
    const gates: [Point, Point][] = [];
    const baseGateWidth = 40;
    gates.push(generateGateLine(track.path, 0, baseGateWidth));
    if (track.s1Index !== undefined) gates.push(generateGateLine(track.path, track.s1Index, baseGateWidth));
    if (track.s2Index !== undefined) gates.push(generateGateLine(track.path, track.s2Index, baseGateWidth));
    gates.push(generateGateLine(track.path, track.path.length - 1, baseGateWidth));

    let nextGateIndex = 1;
    let sectorTimes: number[] = [];
    let lastGateCrossTime = 0;

    const filter = new GPSKalmanFilter();
    let lastPoint: Point | null = null;
    let lastTime = 0;
    let lastTelemetryTime = 0;
    const THROTTLE_MS = 250;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsError(null);
        const rawTime = pos.timestamp;
        const accuracy = pos.coords.accuracy;
        const speedKmh = (pos.coords.speed || 0) * 3.6;

        timeOffsetRef.current = Date.now() - rawTime;
        speedRef.current = speedKmh;
        if (speedKmh > maxSpeedRef.current) maxSpeedRef.current = speedKmh;

        if (accuracy != null && accuracy > MAX_GPS_ACCURACY_METERS) {
          return;
        }

        if (lapStartTimeRef.current === null) {
          lapStartTimeRef.current = rawTime;
          lapStartTimeLocalRef.current = performance.now();
        }

        const filtered = filter.process(pos.coords.latitude, pos.coords.longitude, accuracy, rawTime);
        const currentPoint: Point = { lat: filtered.lat, lon: filtered.lon };

        // Calculate Real-Time Live Ghost Delta
        if (track.path && track.path.length >= 2 && lapStartTimeRef.current !== null) {
          const { progressRatio } = calculateTrackProgress(currentPoint, track.path);
          const currentLapElapsedSec = (rawTime - lapStartTimeRef.current) / 1000;
          const bestLap = bestLapRef.current;

          if (bestLap && bestLap.lapTime && progressRatio > 0.05) {
            const expectedTimeSec = (bestLap.lapTime / 1000) * progressRatio;
            liveGhostDeltaRef.current = currentLapElapsedSec - expectedTimeSec;
          }
        }

        // Update Map Marker
        if (userMarker.current && leafletMap.current) {
          userMarker.current.setLatLng([currentPoint.lat, currentPoint.lon]);
          leafletMap.current.setView([currentPoint.lat, currentPoint.lon]);
        }

        const now = Date.now();
        if (now - lastTelemetryTime > THROTTLE_MS) {
          lastTelemetryTime = now;
          updateTelemetry({
            driverName, vehicleType, trackId: track._id,
            lat: currentPoint.lat, lon: currentPoint.lon,
            speed: speedKmh, heading: pos.coords.heading || 0,
            gForce: gForceRef.current, timestamp: rawTime,
          }).catch(console.error);
        }

        if (lastPoint && nextGateIndex < gates.length) {
          // Sub-sample trajectory path between previous GPS fix and current GPS fix
          const dynamicGateWidth = getDynamicGateWidth(speedKmh, accuracy || 10);
          const activeGateIndex = nextGateIndex;
          let gateIndexToTest = activeGateIndex;
          if (activeGateIndex === 1 && track.s1Index !== undefined) gateIndexToTest = track.s1Index;
          else if (activeGateIndex === 2 && track.s2Index !== undefined) gateIndexToTest = track.s2Index;
          else if (activeGateIndex === gates.length - 1) gateIndexToTest = track.path.length - 1;
          else gateIndexToTest = 0;

          const gate = generateGateLine(track.path, Math.min(gateIndexToTest, track.path.length - 1), dynamicGateWidth);

          const subPoints = interpolateSubPoints(lastPoint, currentPoint, 6);
          let detectedIntersection: number | null = null;
          let detectedSubIndex = 0;

          for (let step = 0; step < subPoints.length - 1; step++) {
            const ua = checkLineIntersection(subPoints[step], subPoints[step + 1], gate[0], gate[1]);
            if (ua !== null) {
              detectedIntersection = ua;
              detectedSubIndex = step;
              break;
            }
          }

          if (detectedIntersection !== null && Date.now() - lastGateCrossTime < MIN_GATE_REARM_MS) {
            // Re-arm ignore
          } else if (detectedIntersection !== null) {
            lastGateCrossTime = Date.now();
            const subFraction = (detectedSubIndex + detectedIntersection) / 5;
            const exactTimestamp = lastTime + subFraction * (rawTime - lastTime);

            if (nextGateIndex === 0) {
              lapStartTimeRef.current = exactTimestamp;
              lapStartTimeLocalRef.current = performance.now();
              nextGateIndex++;
            } else if (lapStartTimeRef.current !== null) {
              const elapsed = exactTimestamp - lapStartTimeRef.current;
              sectorTimes.push(elapsed);

              const hasS1 = gates.length > 2;
              const hasS2 = gates.length > 3;

              if (nextGateIndex === 1 && hasS1) {
                setS1Time(elapsed);
                speakRaceEngineerMessage(`Sektor 1: ${(elapsed / 1000).toFixed(1)} sekundy`);
              }
              if (nextGateIndex === 2 && hasS2) {
                const s2Val = elapsed - sectorTimes[0];
                setS2Time(s2Val);
                speakRaceEngineerMessage(`Sektor 2: ${(s2Val / 1000).toFixed(1)} sekundy`);
              }

              if (nextGateIndex === gates.length - 1) {
                const totalTime = elapsed;
                if (hasS1) {
                  const lastSectorBoundary = hasS2 ? sectorTimes[1] : sectorTimes[0];
                  setS3Time(totalTime - lastSectorBoundary);
                }

                const bestLap = bestLapRef.current;
                let isPersonalBest = false;
                if (bestLap) {
                  const delta = totalTime - bestLap.lapTime;
                  deltaRef.current = delta;
                  if (delta < 0) isPersonalBest = true;
                } else {
                  deltaRef.current = -1;
                  isPersonalBest = true;
                }

                playLapFinishBeep();
                setLapFlash(true);
                setTimeout(() => setLapFlash(false), 2000);

                if (isPersonalBest) {
                  speakRaceEngineerMessage(`Meta! Rekord życiowy! ${(totalTime / 1000).toFixed(2)} sekundy`);
                } else {
                  speakRaceEngineerMessage(`Meta okrążenia! Czas: ${(totalTime / 1000).toFixed(2)} sekundy`);
                }

                {
                  const lapArgs = {
                    driverName, vehicleType, trackId: track._id,
                    lapNumber: lapNumberRef.current, lapTime: totalTime,
                    s1: hasS1 ? sectorTimes[0] : undefined,
                    s2: hasS2 ? (sectorTimes[1] - sectorTimes[0]) : undefined,
                    s3: hasS1 ? (totalTime - (hasS2 ? sectorTimes[1] : sectorTimes[0])) : undefined,
                    topSpeed: maxSpeedRef.current, timestamp: Date.now()
                  };
                  recordLap(lapArgs).catch(() => {
                    const count = queueLap(lapArgs);
                    setPendingLapCount(count);
                  });
                }

                lapNumberRef.current++;
                nextGateIndex = 1; 
                lapStartTimeRef.current = exactTimestamp;
                lapStartTimeLocalRef.current = performance.now();
                sectorTimes = [];
              } else {
                nextGateIndex++;
              }
            }
          }
        }

        
        lastPoint = currentPoint;
        lastTime = rawTime;
      },
      (err) => {
        console.error(err);
        if (err.code === err.PERMISSION_DENIED) {
          setGpsError('Brak uprawnień do lokalizacji. Włącz dostęp do GPS dla tej strony w ustawieniach telefonu/przeglądarki.');
        } else if (err.code === err.TIMEOUT) {
          setGpsError('Nie udało się uzyskać sygnału GPS. Wyjdź na otwartą przestrzeń i spróbuj ponownie.');
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setGpsError('Lokalizacja GPS jest niedostępna. Sprawdź, czy GPS jest włączony w telefonie.');
        } else {
          setGpsError('Błąd GPS. Sprawdź uprawnienia i połączenie lokalizacji.');
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
  };

  const abortRace = () => {
    if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    if (motionHandlerRef.current) window.removeEventListener('devicemotion', motionHandlerRef.current);
    releaseWakeLock();
    setPhase('setup');
    setLights(0);
    setGpsError(null);
    navigate('/control', { state: { trackId: selectedTrack } });
  };

  // "Hold to confirm" handlers for the ZAKOŃCZ (exit race) button, to avoid
  // accidental taps aborting the race while riding on rough ground.
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
    };
  }, []);

  // Retry any laps that failed to sync (e.g. connection dropped mid-ride)
  // once we're back online.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 60FPS UI rendering
  useEffect(() => {
    let animationFrameId: number;
    const renderLoop = () => {
      if (speedElRef.current) {
        speedElRef.current.innerText = Math.round(speedRef.current).toString();
      }
      if (deltaElRef.current && deltaRef.current !== null) {
        const d = deltaRef.current;
        const color = d < 0 ? 'var(--neon-green)' : 'var(--neon-red)';
        const sign = d < 0 ? '-' : '+';
        deltaElRef.current.style.color = color;
        deltaElRef.current.innerText = `${sign}${(Math.abs(d)/1000).toFixed(3)}s`;
      }
      if (gForceBarRef.current) {
        const pct = Math.min(gForceRef.current / 2, 1) * 100;
        gForceBarRef.current.style.width = `${pct}%`;
        gForceBarRef.current.style.background = pct > 80 ? 'var(--neon-red)' : 'var(--neon-purple)';
      }
      if (liveTimerRef.current) {
        if (lapStartTimeLocalRef.current !== null) {
          // Use purely local time difference for visual smoothness to avoid micro-stutters
          const elapsed = performance.now() - lapStartTimeLocalRef.current;
          liveTimerRef.current.innerText = (elapsed / 1000).toFixed(3);
        } else {
          liveTimerRef.current.innerText = '0.000';
        }
      }
      animationFrameId = requestAnimationFrame(renderLoop);
    };
    if (phase === 'racing') renderLoop();
    return () => cancelAnimationFrame(animationFrameId);
  }, [phase]);

  // Setup Live Map
  useEffect(() => {
    if (phase === 'racing' && mapRef.current && !leafletMap.current) {
      const track = tracks.find((t: any) => t._id === selectedTrack);
      const startPt = track?.path?.[0] || { lat: 51.95, lon: 20.15 };
      
      leafletMap.current = L.map(mapRef.current, { zoomControl: false, attributionControl: false }).setView([startPt.lat, startPt.lon], 18);
      
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19
      }).addTo(leafletMap.current);

      if (track?.path) {
        trackPathLayer.current = L.polyline(track.path as any, { color: 'var(--neon-blue)', weight: 4 }).addTo(leafletMap.current);
      }

      const html = `<div style="width:20px;height:20px;background:var(--neon-red);border-radius:50%;border:3px solid white;box-shadow:0 0 15px var(--neon-red);"></div>`;
      const icon = L.divIcon({ html, className: '', iconSize: [20, 20] });
      userMarker.current = L.marker([startPt.lat, startPt.lon], { icon }).addTo(leafletMap.current);
    }
    
    if (phase !== 'racing' && leafletMap.current) {
      leafletMap.current.remove();
      leafletMap.current = null;
    }
  }, [phase, selectedTrack, tracks]);

  if (phase === 'setup') {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel" 
        style={{ maxWidth: '520px', margin: '40px auto', padding: '36px', borderTop: '4px solid var(--f1-red)', boxShadow: '0 20px 50px rgba(0,0,0,0.8)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 900, letterSpacing: '1px', textTransform: 'uppercase', color: '#fff' }}>
              <span style={{ color: 'var(--f1-red)' }}>F1</span> COCKPIT SETUP
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginTop: '4px', fontSize: '13px' }}>
              Skonfiguruj sesję telemetryczną przed zamontowaniem urządzenia.
            </p>
          </div>
          <div style={{ padding: '6px 12px', background: 'rgba(225, 6, 0, 0.15)', border: '1px solid var(--f1-red)', borderRadius: '8px', color: 'var(--f1-red)', fontSize: '11px', fontWeight: 800 }}>
            READY
          </div>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '24px' }}>
          <motion.div animate={errorName ? { x: [-10, 10, -10, 10, 0] } : {}} transition={{ duration: 0.4 }}>
            <label htmlFor="driverName" style={{ display: 'block', marginBottom: '8px', fontSize: '11px', fontWeight: 800, color: errorName ? 'var(--neon-red)' : 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px' }}>
              🏎️ Imię / Alias Kierowcy {errorName && ' (WYMAGANE)'}
            </label>
            <input 
              id="driverName"
              className="custom-input" 
              style={{ borderColor: errorName ? 'var(--neon-red)' : undefined }}
              placeholder="Wpisz np. Max Verstappen..." 
              value={driverName} 
              onChange={e => setDriverName(e.target.value)} 
            />
          </motion.div>
          
          <div>
            <label htmlFor="vehicleType" style={{ display: 'block', marginBottom: '8px', fontSize: '11px', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px' }}>
              ⚡ Typ Pojazdu
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <button
                type="button"
                className="btn-secondary"
                style={{
                  padding: '14px',
                  background: vehicleType === 'scooter' ? 'rgba(0, 240, 255, 0.18)' : 'rgba(255,255,255,0.04)',
                  borderColor: vehicleType === 'scooter' ? 'var(--neon-cyan)' : 'rgba(255,255,255,0.12)',
                  color: vehicleType === 'scooter' ? '#fff' : 'var(--text-secondary)',
                  fontWeight: 700
                }}
                onClick={() => setVehicleType('scooter')}
              >
                🛵 HULAJNOGA
              </button>
              <button
                type="button"
                className="btn-secondary"
                style={{
                  padding: '14px',
                  background: vehicleType === 'bike' ? 'rgba(57, 255, 20, 0.18)' : 'rgba(255,255,255,0.04)',
                  borderColor: vehicleType === 'bike' ? 'var(--neon-green)' : 'rgba(255,255,255,0.12)',
                  color: vehicleType === 'bike' ? '#fff' : 'var(--text-secondary)',
                  fontWeight: 700
                }}
                onClick={() => setVehicleType('bike')}
              >
                🚴 ROWER
              </button>
            </div>
          </div>
          
          <motion.div animate={errorTrack ? { x: [-10, 10, -10, 10, 0] } : {}} transition={{ duration: 0.4 }}>
            <label htmlFor="trackSelect" style={{ display: 'block', marginBottom: '8px', fontSize: '11px', fontWeight: 800, color: errorTrack ? 'var(--neon-red)' : 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px' }}>
              🏁 Wybierz Tor Wyścigowy {errorTrack && ' (WYMAGANE)'}
            </label>
            <select 
              id="trackSelect"
              className="custom-select" 
              style={{ borderColor: errorTrack ? 'var(--neon-red)' : undefined }}
              value={selectedTrack} 
              onChange={(e) => setSelectedTrack(e.target.value)}
            >
              <option value="">Wybierz trasy wyścigowe...</option>
              {tracks.map((t: any) => <option key={t._id} value={t._id}>{t.name}</option>)}
            </select>
            {trackConfigError && (
              <div style={{ color: 'var(--neon-red)', fontSize: '12px', marginTop: '8px', fontWeight: 600 }}>⚠️ {trackConfigError}</div>
            )}
          </motion.div>

          <button className="btn-primary" style={{ marginTop: '12px', width: '100%', padding: '18px' }} onClick={startRace}>
            🟢 ROZPOCZNIJ SEKWENCJĘ STARTOWĄ (LIGHTS)
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: '#000', zIndex: 9999, display: 'flex', flexDirection: 'column' }}>
      
      {/* Background Live Map with dark overlay for OLED */}
      {phase === 'racing' && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0 }}>
          <div ref={mapRef} style={{ width: '100%', height: '100%', filter: 'brightness(0.35) saturate(1.2)' }} />
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.9) 100%)', zIndex: 1 }} />
        </div>
      )}

      {phase === 'f1_lights' && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#000', zIndex: 10, padding: '16px' }}>
          <div style={{ display: 'flex', gap: 'clamp(4px, 1.8vw, 14px)', background: '#050505', padding: 'clamp(10px, 3vw, 24px)', borderRadius: '16px', border: '1px solid #222', maxWidth: '94vw', justifyContent: 'center' }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(4px, 1.5vw, 8px)', padding: 'clamp(4px, 1.5vw, 10px)', background: '#0a0a0a', borderRadius: '10px' }}>
                <div style={{ width: 'clamp(24px, 8.5vw, 44px)', height: 'clamp(24px, 8.5vw, 44px)', borderRadius: '50%', background: (!isLightsOut && lights >= i) ? '#ff0000' : '#111', boxShadow: (!isLightsOut && lights >= i) ? '0 0 30px #ff0000' : 'none' }} />
                <div style={{ width: 'clamp(24px, 8.5vw, 44px)', height: 'clamp(24px, 8.5vw, 44px)', borderRadius: '50%', background: (!isLightsOut && lights >= i) ? '#ff0000' : '#111', boxShadow: (!isLightsOut && lights >= i) ? '0 0 30px #ff0000' : 'none' }} />
              </div>
            ))}
          </div>
          <h1 style={{ marginTop: '32px', color: isLightsOut ? 'var(--neon-green)' : 'white', fontFamily: 'var(--font-mono)', fontSize: 'clamp(20px, 5vw, 40px)', fontStyle: isLightsOut ? 'italic' : 'normal', textAlign: 'center', maxWidth: '90vw' }}>
            {isLightsOut ? 'LIGHTS OUT AND AWAY WE GO!' : 'CZEKAJ NA SYGNAŁ...'}
          </h1>
        </div>
      )}

      <AnimatePresence>
        {lapFlash && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.2 }}
            style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0, 255, 136, 0.2)', zIndex: 10001, pointerEvents: 'none'
            }}
          >
            <h1 style={{ fontSize: 'clamp(60px, 15vw, 120px)', color: 'white', textShadow: '0 0 40px var(--neon-green)', fontWeight: 900, fontStyle: 'italic' }}>
              META
            </h1>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {gpsError && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            style={{
              position: 'absolute', top: '12px', left: '50%', transform: 'translateX(-50%)',
              zIndex: 10002, background: 'rgba(200, 0, 0, 0.9)', color: 'white',
              padding: '10px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 700,
              maxWidth: '90%', textAlign: 'center', boxShadow: '0 0 20px rgba(255,0,0,0.5)'
            }}
          >
            {gpsError}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main OLED HUD Layer */}
      {phase === 'racing' && (
      <div style={{ zIndex: 10, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Top Header Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ color: 'var(--neon-green)', fontWeight: 800, fontSize: 'clamp(18px, 4vw, 24px)', textShadow: '0 0 10px rgba(0,255,136,0.5)' }}>{driverName}</span>
            <span style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.15)', color: '#aaa', fontSize: '11px', textTransform: 'uppercase', fontWeight: 700 }}>{vehicleType}</span>
          </div>
          
          <button
            className="btn-danger"
            onPointerDown={startExitHold}
            onPointerUp={cancelExitHold}
            onPointerLeave={cancelExitHold}
            onPointerCancel={cancelExitHold}
            style={{
              position: 'relative', overflow: 'hidden', padding: '10px 18px', minHeight: '44px',
              background: 'rgba(255,0,0,0.15)', border: '2px solid var(--neon-red)', color: 'white',
              touchAction: 'none', userSelect: 'none', fontSize: '12px', fontWeight: 900, borderRadius: '10px'
            }}
          >
            <div style={{
              position: 'absolute', top: 0, left: 0, bottom: 0,
              width: `${exitHoldProgress * 100}%`, background: 'rgba(255,0,0,0.6)',
              transition: exitHoldProgress === 0 ? 'width 0.15s ease-out' : 'none',
            }} />
            <span style={{ position: 'relative' }}>PRZYTRZYMAJ ZAKOŃCZ</span>
          </button>
        </div>

        {gpsError && (
          <div style={{
            margin: '0 24px', padding: '10px 16px', background: 'rgba(255,0,0,0.15)',
            border: '1px solid var(--neon-red)', borderRadius: '8px', color: 'white',
            fontSize: '13px', textAlign: 'center',
          }}>
            {gpsError}
          </div>
        )}

        {pendingLapCount > 0 && (
          <div style={{
            margin: '8px 24px 0', padding: '8px 16px', background: 'rgba(255,145,0,0.15)',
            border: '1px solid var(--neon-orange)', borderRadius: '8px', color: 'white',
            fontSize: '12px', textAlign: 'center',
          }}>
            Zapisano offline: {pendingLapCount} {pendingLapCount === 1 ? 'okrążenie' : 'okrążeń'} — wysyłanie po odzyskaniu połączenia...
          </div>
        )}

        {/* Main Central Telemetry Area */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', padding: '8px 16px' }}>
          
          {/* Live Lap Time Box (Lowered into main view) */}
          <div style={{ background: 'rgba(0, 0, 0, 0.65)', border: '1px solid rgba(0, 240, 255, 0.4)', borderRadius: '14px', padding: '8px 24px', textAlign: 'center', marginBottom: '8px', boxShadow: '0 0 20px rgba(0, 240, 255, 0.15)' }}>
            <div style={{ fontSize: '10px', color: 'var(--neon-cyan)', fontWeight: 800, letterSpacing: '1px' }}>LIVE LAP TIME</div>
            <div ref={liveTimerRef} className="font-digital" style={{ fontSize: 'clamp(28px, 6vw, 42px)', color: 'white', textShadow: '0 0 15px rgba(255,255,255,0.4)', lineHeight: 1.1 }}>0.000</div>
          </div>

          {/* Delta Display */}
          <div ref={deltaElRef} className="font-digital" style={{ fontSize: 'clamp(24px, 5vw, 36px)', height: '40px', opacity: 0.9 }}>
            {/* Delta goes here */}
          </div>

          {/* Speedometer */}
          <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', justifyContent: 'center' }}>
            <div ref={speedElRef} className="font-digital" style={{ fontSize: 'clamp(90px, 20vw, 170px)', color: 'white', lineHeight: 1, textShadow: '0 0 20px rgba(255,255,255,0.2)' }}>0</div>
            <div style={{ color: '#aaa', fontSize: 'clamp(20px, 4vw, 32px)', fontWeight: 800, marginLeft: '12px' }}>km/h</div>
          </div>

          {/* G-Force RPM Bar & Lean Angle Display */}
          <div style={{ width: '80%', height: '10px', background: 'rgba(255,255,255,0.1)', borderRadius: '5px', marginTop: '16px', overflow: 'hidden' }}>
            <div ref={gForceBarRef} style={{ height: '100%', width: '0%', background: 'var(--neon-purple)', transition: 'width 0.1s linear, background 0.2s' }} />
          </div>
          
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginTop: '8px' }}>
            <div style={{ color: '#aaa', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px' }}>G-FORCE ACCELERATION</div>
            <div style={{ color: 'var(--neon-cyan)', fontSize: '11px', fontWeight: 800, padding: '2px 8px', background: 'rgba(0,240,255,0.1)', borderRadius: '4px', border: '1px solid rgba(0,240,255,0.3)' }}>
              LEAN ANGLE: {Math.abs(leanAngleDisplay)}° {leanAngleDisplay > 5 ? '➡️ R' : leanAngleDisplay < -5 ? '⬅️ L' : '⏺️'}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2px', background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(10px)' }}>
          <div style={{ background: 'rgba(0,0,0,0.5)', padding: '16px 8px', textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: '#aaa', fontWeight: 800, marginBottom: '4px' }}>SEKTOR 1</div>
            <div className="font-digital" style={{ fontSize: 'clamp(18px, 4vw, 28px)', color: s1Time ? 'white' : '#888899' }}>{s1Time ? (s1Time/1000).toFixed(3) : '--.---'}</div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.5)', padding: '16px 8px', textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: '#aaa', fontWeight: 800, marginBottom: '4px' }}>SEKTOR 2</div>
            <div className="font-digital" style={{ fontSize: 'clamp(18px, 4vw, 28px)', color: s2Time ? 'white' : '#888899' }}>{s2Time ? (s2Time/1000).toFixed(3) : '--.---'}</div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.5)', padding: '16px 8px', textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: '#aaa', fontWeight: 800, marginBottom: '4px' }}>SEKTOR 3 (LAP)</div>
            <div className="font-digital" style={{ fontSize: 'clamp(18px, 4vw, 28px)', color: s3Time ? 'var(--neon-purple)' : '#888899' }}>{s3Time ? (s3Time/1000).toFixed(3) : '--.---'}</div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
