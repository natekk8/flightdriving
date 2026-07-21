import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery } from 'convex/react';
// @ts-ignore
import { api } from '../../convex/_generated/api';
import { checkLineIntersection, generateGateLine, GPSKalmanFilter } from '../lib/math';
import { initAudio, playF1StartBeep, playLapFinishBeep } from '../lib/audio';
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
  const gForceRef = useRef(0);
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

  // Laps that failed to sync to Convex and are waiting to be resent
  const [pendingLapCount, setPendingLapCount] = useState(0);

  // "Hold to confirm" state for the ZAKOŃCZ (exit race) button
  const [exitHoldProgress, setExitHoldProgress] = useState(0);
  const exitHoldStartRef = useRef<number | null>(null);
  const exitHoldRafRef = useRef<number | null>(null);
  const EXIT_HOLD_MS = 900;

  // @ts-ignore
  const tracks = useQuery(api.tracks.getTracks) || [];
  // @ts-ignore
  const laps = useQuery(api.laps.getTimingBoard, { trackId: selectedTrack || undefined, vehicleType }) || [];
  // @ts-ignore
  const updateTelemetry = useMutation(api.telemetry.update);
  // @ts-ignore
  const recordLap = useMutation(api.laps.record);

  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const userMarker = useRef<L.Marker | null>(null);
  const trackPathLayer = useRef<L.Polyline | null>(null);

  const bestLap = [...laps].sort((a: any, b: any) => a.lapTime - b.lapTime)[0];

  // Validates that the selected track has a usable path and, if defined,
  // sector gates in sane positions before a race is allowed to start.
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
    setPhase('f1_lights');
    
    setS1Time(null); setS2Time(null); setS3Time(null);
    maxSpeedRef.current = 0;
    lapStartTimeRef.current = null;
    lapStartTimeLocalRef.current = null;
    lapNumberRef.current = 1;
    
    if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
      try { await (DeviceMotionEvent as any).requestPermission(); } catch (e) { console.error(e); }
    }
    
    motionHandlerRef.current = (e: DeviceMotionEvent) => {
      const x = e.acceleration?.x || 0;
      const y = e.acceleration?.y || 0;
      gForceRef.current = Math.sqrt(x*x + y*y) / 9.81;
    };
    window.addEventListener('devicemotion', motionHandlerRef.current);

    let currentLight = 0;
    const interval = setInterval(() => {
      currentLight++;
      if (currentLight <= 5) {
        setLights(currentLight);
        playF1StartBeep(false);
      } else {
        clearInterval(interval);
        setTimeout(() => {
          playF1StartBeep(true);
          setPhase('racing');
          startGPS();
        }, 500 + Math.random() * 1500);
      }
    }, 1000);
  };

  const startGPS = () => {
    const track = tracks.find((t: any) => t._id === selectedTrack);
    if (!track || !track.path || track.path.length < 2) return;

    // Generate Gates
    const gates: [Point, Point][] = [];
    gates.push(generateGateLine(track.path, 0));
    if (track.s1Index !== undefined) gates.push(generateGateLine(track.path, track.s1Index));
    if (track.s2Index !== undefined) gates.push(generateGateLine(track.path, track.s2Index));
    gates.push(generateGateLine(track.path, track.path.length - 1));

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

        // A poor GPS fix can trigger a false gate crossing (jitter jumping
        // across the sector line). Still show speed, but skip lap-detection
        // and telemetry for this reading and wait for a better fix.
        if (accuracy != null && accuracy > MAX_GPS_ACCURACY_METERS) {
          return;
        }

        if (lapStartTimeRef.current === null) {
          lapStartTimeRef.current = rawTime;
          lapStartTimeLocalRef.current = performance.now();
        }

        const filtered = filter.process(pos.coords.latitude, pos.coords.longitude, accuracy, rawTime);
        const currentPoint: Point = { lat: filtered.lat, lon: filtered.lon };

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
          const gate = gates[nextGateIndex];
          const ua = checkLineIntersection(lastPoint, currentPoint, gate[0], gate[1]);

          if (ua !== null && Date.now() - lastGateCrossTime < MIN_GATE_REARM_MS) {
            // Likely GPS jitter re-crossing the same gate right after the
            // last detection - ignore it.
          } else if (ua !== null) {
            lastGateCrossTime = Date.now();
            const exactTimestamp = lastTime + ua * (rawTime - lastTime);

            if (nextGateIndex === 0) {
              lapStartTimeRef.current = exactTimestamp;
              lapStartTimeLocalRef.current = performance.now();
              nextGateIndex++;
            } else if (lapStartTimeRef.current !== null) {
              const elapsed = exactTimestamp - lapStartTimeRef.current;
              sectorTimes.push(elapsed);
              
              if (nextGateIndex === 1 && gates.length > 2) setS1Time(elapsed);
              if (nextGateIndex === 2 && gates.length > 3) setS2Time(elapsed - sectorTimes[0]);
              
              if (nextGateIndex === gates.length - 1) {
                const totalTime = elapsed;
                if (gates.length > 2) {
                    setS3Time(totalTime - sectorTimes[sectorTimes.length - 2]);
                }
                
                if (bestLap) {
                  const delta = totalTime - bestLap.lapTime;
                  deltaRef.current = delta;
                } else {
                  deltaRef.current = -1;
                }

                playLapFinishBeep();
                setLapFlash(true);
                setTimeout(() => setLapFlash(false), 2000);

                {
                  const lapArgs = {
                    driverName, vehicleType, trackId: track._id,
                    lapNumber: lapNumberRef.current, lapTime: totalTime,
                    s1: sectorTimes[0],
                    s2: gates.length > 2 ? (sectorTimes[1] - sectorTimes[0]) : undefined,
                    s3: gates.length > 3 ? (totalTime - sectorTimes[1]) : (gates.length > 2 ? (totalTime - sectorTimes[0]) : undefined),
                    topSpeed: maxSpeedRef.current, timestamp: Date.now()
                  };
                  recordLap(lapArgs).catch(() => {
                    // Connection dropped mid-ride - keep the lap locally and
                    // retry once we're back online instead of losing it.
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
      <div className="glass-panel" style={{ maxWidth: '500px', margin: '40px auto', padding: '32px' }}>
        <h2 style={{ marginBottom: '8px', borderLeft: '4px solid var(--neon-red)', paddingLeft: '12px' }}>Cockpit (F1 Edition)</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '14px' }}>
          Zainstaluj telefon stabilnie w uchwycie przed startem.
        </p>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <motion.div animate={errorName ? { x: [-10, 10, -10, 10, 0] } : {}} transition={{ duration: 0.4 }}>
            <label htmlFor="driverName" style={{ display: 'block', marginBottom: '8px', fontSize: '12px', color: errorName ? 'var(--neon-red)' : 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Imię Kierowcy {errorName && ' (WYMAGANE)'}
            </label>
            <input 
              id="driverName"
              className="custom-input" 
              style={{ borderColor: errorName ? 'var(--neon-red)' : undefined }}
              placeholder="Wpisz imię..." 
              value={driverName} 
              onChange={e => setDriverName(e.target.value)} 
            />
          </motion.div>
          
          <div>
            <label htmlFor="vehicleType" style={{ display: 'block', marginBottom: '8px', fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Pojazd</label>
            <select id="vehicleType" className="custom-select" value={vehicleType} onChange={(e: any) => setVehicleType(e.target.value)}>
              <option value="scooter">Hulajnoga</option>
              <option value="bike">Rower</option>
            </select>
          </div>
          
          <motion.div animate={errorTrack ? { x: [-10, 10, -10, 10, 0] } : {}} transition={{ duration: 0.4 }}>
            <label htmlFor="trackSelect" style={{ display: 'block', marginBottom: '8px', fontSize: '12px', color: errorTrack ? 'var(--neon-red)' : 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Wybierz Trasę {errorTrack && ' (WYMAGANE)'}
            </label>
            <select 
              id="trackSelect"
              className="custom-select" 
              style={{ borderColor: errorTrack ? 'var(--neon-red)' : undefined }}
              value={selectedTrack} 
              onChange={(e) => setSelectedTrack(e.target.value)}
            >
              <option value="">Wybierz...</option>
              {tracks.map((t: any) => <option key={t._id} value={t._id}>{t.name}</option>)}
            </select>
            {trackConfigError && (
              <div style={{ color: 'var(--neon-red)', fontSize: '12px', marginTop: '8px' }}>{trackConfigError}</div>
            )}
          </motion.div>

          <button className="btn-primary" style={{ marginTop: '16px', width: '100%' }} onClick={startRace}>
            ROZPOCZNIJ SEKWENCJĘ STARTOWĄ
          </button>
        </div>
      </div>
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
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#000', zIndex: 10 }}>
          <div style={{ display: 'flex', gap: '16px', background: '#050505', padding: '24px', borderRadius: '16px', border: '1px solid #222' }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', background: '#0a0a0a', borderRadius: '12px' }}>
                <div style={{ width: '50px', height: '50px', borderRadius: '50%', background: lights >= i ? '#ff0000' : (lights === -1 ? '#000' : '#111'), boxShadow: lights >= i ? '0 0 40px #ff0000' : 'none' }} />
                <div style={{ width: '50px', height: '50px', borderRadius: '50%', background: lights >= i ? '#ff0000' : (lights === -1 ? '#000' : '#111'), boxShadow: lights >= i ? '0 0 40px #ff0000' : 'none' }} />
              </div>
            ))}
          </div>
          <h1 style={{ marginTop: '48px', color: 'white', fontFamily: 'var(--font-mono)', fontSize: '48px' }}>
            {lights === -1 ? 'GO GO GO!' : 'CZEKAJ NA SYGNAŁ...'}
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
            <h1 style={{ fontSize: '120px', color: 'white', textShadow: '0 0 40px var(--neon-green)', fontWeight: 900, fontStyle: 'italic' }}>
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
      <div style={{ zIndex: 10, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '24px' }}>
          <div>
            <span style={{ color: 'var(--neon-green)', fontWeight: 800, fontSize: '24px', textShadow: '0 0 10px rgba(0,255,136,0.5)' }}>{driverName}</span>
            <span style={{ color: '#aaa', marginLeft: '12px', fontSize: '14px', textTransform: 'uppercase' }}>{vehicleType}</span>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '12px', color: 'var(--neon-blue)', fontWeight: 800 }}>LIVE LAP TIME</div>
            <div ref={liveTimerRef} className="font-digital" style={{ fontSize: '32px', color: 'white', textShadow: '0 0 15px rgba(255,255,255,0.4)' }}></div>
          </div>
          <button
            className="btn-danger"
            onPointerDown={startExitHold}
            onPointerUp={cancelExitHold}
            onPointerLeave={cancelExitHold}
            onPointerCancel={cancelExitHold}
            style={{
              position: 'relative', overflow: 'hidden', padding: '8px 16px',
              background: 'rgba(255,0,0,0.1)', border: '1px solid var(--neon-red)', color: 'white',
              touchAction: 'none', userSelect: 'none',
            }}
          >
            <div style={{
              position: 'absolute', top: 0, left: 0, bottom: 0,
              width: `${exitHoldProgress * 100}%`, background: 'rgba(255,0,0,0.5)',
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

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <div ref={deltaElRef} className="font-digital" style={{ fontSize: '48px', height: '60px', opacity: 0.9 }}>
            {/* Delta goes here */}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <div ref={speedElRef} className="font-digital" style={{ fontSize: '180px', color: 'white', lineHeight: 1, textShadow: '0 0 20px rgba(255,255,255,0.2)' }}></div>
            <div style={{ color: '#aaa', fontSize: '32px', fontWeight: 800, marginLeft: '16px' }}>km/h</div>
          </div>
          
          {/* G-Force RPM Bar */}
          <div style={{ width: '80%', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', marginTop: '32px', overflow: 'hidden' }}>
            <div ref={gForceBarRef} style={{ height: '100%', width: '0%', background: 'var(--neon-purple)', transition: 'width 0.1s linear, background 0.2s' }} />
          </div>
          <div style={{ color: '#aaa', fontSize: '10px', marginTop: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>G-Force / Acceleration</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2px', background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(10px)' }}>
          <div style={{ background: 'rgba(0,0,0,0.5)', padding: '24px', textAlign: 'center' }}>
            <div style={{ fontSize: '12px', color: '#888', fontWeight: 800, marginBottom: '8px' }}>SEKTOR 1</div>
            <div className="font-digital" style={{ fontSize: '28px', color: s1Time ? 'white' : '#555' }}>{s1Time ? (s1Time/1000).toFixed(3) : '--.---'}</div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.5)', padding: '24px', textAlign: 'center' }}>
            <div style={{ fontSize: '12px', color: '#888', fontWeight: 800, marginBottom: '8px' }}>SEKTOR 2</div>
            <div className="font-digital" style={{ fontSize: '28px', color: s2Time ? 'white' : '#555' }}>{s2Time ? (s2Time/1000).toFixed(3) : '--.---'}</div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.5)', padding: '24px', textAlign: 'center' }}>
            <div style={{ fontSize: '12px', color: '#888', fontWeight: 800, marginBottom: '8px' }}>SEKTOR 3 (LAP)</div>
            <div className="font-digital" style={{ fontSize: '28px', color: s3Time ? 'var(--neon-purple)' : '#555' }}>{s3Time ? (s3Time/1000).toFixed(3) : '--.---'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
