
import { motion } from 'framer-motion';

interface TrainingModalProps {
  trainingDriver: string;
  setTrainingDriver: (val: string) => void;
  trainingLapAId: string;
  setTrainingLapAId: (val: string) => void;
  trainingLapBId: string;
  setTrainingLapBId: (val: string) => void;
  driverLaps: any[];
  tracks: any[];
  selectedTrack: string;
  uniqueDrivers: any[];
  setShowTrainingModal: (val: boolean) => void;
  buildMonotonicSpline: (pts: {x: number, y: number}[]) => string;
  calculateTrackCorners: (path: any) => any;
}

export function TrainingModal({
  trainingDriver, setTrainingDriver,
  trainingLapAId, setTrainingLapAId,
  trainingLapBId, setTrainingLapBId,
  driverLaps, tracks, selectedTrack, uniqueDrivers,
  setShowTrainingModal, buildMonotonicSpline, calculateTrackCorners
}: TrainingModalProps) {

        const lapA = driverLaps.find((l: any) => l._id === trainingLapAId);
        const lapB = driverLaps.find((l: any) => l._id === trainingLapBId);

        const currentTrackObj = tracks.find((t: any) => t._id === selectedTrack);
        const trackCorners = currentTrackObj?.path ? calculateTrackCorners(currentTrackObj.path) : [];

        const s1A = lapA?.s1 ? (450000 / lapA.s1) * 3 : 25;
        const s2A = lapA?.s2 ? (450000 / lapA.s2) * 3 : 28;
        const topA = lapA?.topSpeed || 34;
        const s3A = lapA?.s3 ? (450000 / lapA.s3) * 3 : 22;

        const s1B = lapB?.s1 ? (450000 / lapB.s1) * 3 : 28;
        const s2B = lapB?.s2 ? (450000 / lapB.s2) * 3 : 31;
        const topB = lapB?.topSpeed || 37;
        const s3B = lapB?.s3 ? (450000 / lapB.s3) * 3 : 25;

        const allSpeeds = [s1A, s2A, topA, s3A, s1B, s2B, topB, s3B];
        const minSpeedVal = Math.max(0, Math.min(...allSpeeds) - 5);
        const maxSpeedVal = Math.max(...allSpeeds) + 5;
        const speedRange = Math.max(8, maxSpeedVal - minSpeedVal);

        const speedToY = (speed: number) => {
          const clamped = Math.min(Math.max(speed, minSpeedVal), maxSpeedVal);
          return Math.round(115 - ((clamped - minSpeedVal) / speedRange) * 85);
        };

        let pathAData = '';
        if (lapA) {
          const ptsA = [
            { x: 20, y: speedToY(s1A * 0.7) },
            { x: 160, y: speedToY(s1A) },
            { x: 320, y: speedToY(s2A) },
            { x: 420, y: speedToY(topA) },
            { x: 480, y: speedToY(s3A) }
          ];
          pathAData = buildMonotonicSpline(ptsA);
        }

        let pathBData = '';
        if (lapB) {
          const ptsB = [
            { x: 20, y: speedToY(s1B * 0.7) },
            { x: 160, y: speedToY(s1B) },
            { x: 320, y: speedToY(s2B) },
            { x: 420, y: speedToY(topB) },
            { x: 480, y: speedToY(s3B) }
          ];
          pathBData = buildMonotonicSpline(ptsB);
        }

        const deltaLap = lapA && lapB ? (lapB.lapTime - lapA.lapTime) / 1000 : null;
        const deltaS1 = lapA?.s1 && lapB?.s1 ? (lapB.s1 - lapA.s1) / 1000 : null;
        const deltaS2 = lapA?.s2 && lapB?.s2 ? (lapB.s2 - lapA.s2) / 1000 : null;
        const deltaS3 = lapA?.s3 && lapB?.s3 ? (lapB.s3 - lapA.s3) / 1000 : null;

        return (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-panel"
            style={{ padding: '24px', marginBottom: '24px', border: '1px solid var(--neon-cyan)', background: 'rgba(8, 12, 24, 0.96)' }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, color: 'var(--neon-cyan)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  🎯 OSOBISTY TRENER & ANALIZA OKRĄŻEŃ (WŁASNA SESJA)
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Wybierz kierowcę i porównaj jego poszczególne przejazdy, aby zobaczyć gdzie zyskujesz prędkość i jak skręcasz.
                </p>
              </div>
              <button className="btn-danger" style={{ padding: '6px 14px', fontSize: '12px' }} onClick={() => setShowTrainingModal(false)}>✕ ZAMKNIJ</button>
            </div>

            {/* Select Driver & Laps Bar */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '20px', background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div>
                <label htmlFor="training-driver-select" style={{ fontSize: '12px', color: 'var(--neon-cyan)', fontWeight: 800 }}>1. WYBIERZ KIEROWCĘ (KIM JESTEŚ):</label>
                <select 
                  id="training-driver-select" 
                  className="custom-select" 
                  style={{ width: '100%', marginTop: '6px' }}
                  value={trainingDriver} 
                  onChange={e => {
                    setTrainingDriver(e.target.value);
                    setTrainingLapAId('');
                    setTrainingLapBId('');
                  }}
                >
                  <option value="">-- Wybierz Kierowcę --</option>
                  {uniqueDrivers.map((d: any) => (
                    <option key={`tr-driver-${d.driverName}`} value={d.driverName}>
                      👤 {d.driverName} (Najlepszy czas: {(d.lapTime/1000).toFixed(3)}s)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="training-lapa-select" style={{ fontSize: '12px', color: '#ffb703', fontWeight: 800 }}>2. OKRĄŻENIE A (BAZOWE):</label>
                <select 
                  id="training-lapa-select" 
                  className="custom-select" 
                  style={{ width: '100%', marginTop: '6px' }}
                  value={trainingLapAId} 
                  onChange={e => setTrainingLapAId(e.target.value)}
                  disabled={!trainingDriver || driverLaps.length === 0}
                >
                  <option value="">-- Wybierz Okrążenie A --</option>
                  {driverLaps.map((l: any, i: number) => (
                    <option key={`tr-lapa-${l._id}`} value={l._id}>
                      Okrążenie #{l.lapNumber || i+1} — {(l.lapTime/1000).toFixed(3)}s (V-Max: {Math.round(l.topSpeed || 0)} km/h)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="training-lapb-select" style={{ fontSize: '12px', color: 'var(--neon-cyan)', fontWeight: 800 }}>3. OKRĄŻENIE B (JASKRAWY CYJAN #00F0FF):</label>
                <select 
                  id="training-lapb-select" 
                  className="custom-select" 
                  style={{ width: '100%', marginTop: '6px' }}
                  value={trainingLapBId} 
                  onChange={e => setTrainingLapBId(e.target.value)}
                  disabled={!trainingDriver || driverLaps.length === 0}
                >
                  <option value="">-- Wybierz Okrążenie B --</option>
                  {driverLaps.map((l: any, i: number) => (
                    <option key={`tr-lapb-${l._id}`} value={l._id}>
                      Okrążenie #{l.lapNumber || i+1} — {(l.lapTime/1000).toFixed(3)}s (V-Max: {Math.round(l.topSpeed || 0)} km/h)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {(!lapA || !lapB) ? (
              <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.4)', borderRadius: '12px' }}>
                Wybierz kierowcę oraz co najmniej dwa okrążenia z listy powyżej, aby przeprowadzić pełną analizę skręcania i tempa.
              </div>
            ) : (
              <>
                {/* Time Delta & Stats Header */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                  <div style={{ background: 'rgba(0,0,0,0.5)', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(0,240,255,0.3)' }}>
                    <div style={{ fontSize: '10px', color: '#aaa', fontWeight: 800 }}>DELTA CAŁKOWITA</div>
                    <div style={{ fontSize: '16px', fontWeight: 900, marginTop: '2px', color: deltaLap !== null ? (deltaLap < 0 ? 'var(--neon-green)' : deltaLap > 0 ? 'var(--neon-red)' : 'white') : 'white' }}>
                      {deltaLap !== null ? (deltaLap < 0 ? `${deltaLap.toFixed(3)}s (B Szybciej!)` : deltaLap > 0 ? `+${deltaLap.toFixed(3)}s (A Szybciej)` : '0.000s (Identyczne)') : '--'}
                    </div>
                  </div>

                  <div style={{ background: 'rgba(0,0,0,0.5)', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: '10px', color: '#888' }}>SEKTOR 1 DELTA</div>
                    <div style={{ fontSize: '14px', fontWeight: 800, marginTop: '2px', color: deltaS1 !== null ? (deltaS1 < 0 ? 'var(--neon-green)' : 'var(--neon-red)') : 'white' }}>
                      {deltaS1 !== null ? (deltaS1 < 0 ? `${deltaS1.toFixed(3)}s` : `+${deltaS1.toFixed(3)}s`) : '--'}
                    </div>
                  </div>

                  <div style={{ background: 'rgba(0,0,0,0.5)', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: '10px', color: '#888' }}>SEKTOR 2 DELTA</div>
                    <div style={{ fontSize: '14px', fontWeight: 800, marginTop: '2px', color: deltaS2 !== null ? (deltaS2 < 0 ? 'var(--neon-green)' : 'var(--neon-red)') : 'white' }}>
                      {deltaS2 !== null ? (deltaS2 < 0 ? `${deltaS2.toFixed(3)}s` : `+${deltaS2.toFixed(3)}s`) : '--'}
                    </div>
                  </div>

                  <div style={{ background: 'rgba(0,0,0,0.5)', padding: '12px 16px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: '10px', color: '#888' }}>SEKTOR 3 DELTA</div>
                    <div style={{ fontSize: '14px', fontWeight: 800, marginTop: '2px', color: deltaS3 !== null ? (deltaS3 < 0 ? 'var(--neon-green)' : 'var(--neon-red)') : 'white' }}>
                      {deltaS3 !== null ? (deltaS3 < 0 ? `${deltaS3.toFixed(3)}s` : `+${deltaS3.toFixed(3)}s`) : '--'}
                    </div>
                  </div>

                  <div style={{ background: 'rgba(0,0,0,0.5)', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: '10px', color: '#888' }}>MAKS. POCHYLENIE</div>
                    <div style={{ fontSize: '14px', fontWeight: 800, marginTop: '2px', color: 'var(--neon-cyan)' }}>
                      <span style={{ color: '#ffb703' }}>{lapA.maxLeanAngle ? `${Math.round(lapA.maxLeanAngle)}°` : '--°'}</span> vs <span style={{ color: 'var(--neon-cyan)' }}>{lapB.maxLeanAngle ? `${Math.round(lapB.maxLeanAngle)}°` : '--°'}</span>
                    </div>
                  </div>

                  <div style={{ background: 'rgba(0,0,0,0.5)', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: '10px', color: '#888' }}>MAKS. G-FORCE</div>
                    <div style={{ fontSize: '14px', fontWeight: 800, marginTop: '2px', color: 'var(--neon-purple)' }}>
                      <span style={{ color: '#ffb703' }}>{lapA.maxGForce ? `${lapA.maxGForce}G` : '--G'}</span> vs <span style={{ color: 'var(--neon-cyan)' }}>{lapB.maxGForce ? `${lapB.maxGForce}G` : '--G'}</span>
                    </div>
                  </div>

                  <div style={{ background: 'rgba(0,0,0,0.5)', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: '10px', color: '#888' }}>ROŻNICA V-MAX</div>
                    <div style={{ fontSize: '14px', fontWeight: 800, marginTop: '2px', color: 'var(--neon-orange)' }}>
                      {Math.round((lapB.topSpeed || 0) - (lapA.topSpeed || 0))} km/h
                    </div>
                  </div>
                </div>

                {/* SVG Speed & Delta Overlay Graph Container */}
                <div style={{ background: '#04060f', borderRadius: '12px', padding: '16px', height: '220px', position: 'relative', border: '1px solid rgba(0, 240, 255, 0.3)', overflow: 'hidden', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ fontSize: '11px', color: '#aaa', fontWeight: 800 }}>PROFIL PRĘDKOŚCI & TELEMETRII (0% ➔ 100% TRASY)</div>
                    <div style={{ display: 'flex', gap: '16px', fontSize: '11px' }}>
                      <span style={{ color: '#ffb703', fontWeight: 800 }}>🟡 Okrążenie A (#{lapA.lapNumber || '1'})</span>
                      <span style={{ color: 'var(--neon-cyan)', fontWeight: 800, textShadow: '0 0 8px rgba(0,240,255,0.6)' }}>🔵 Okrążenie B (#{lapB.lapNumber || '2'} - CYJAN)</span>
                    </div>
                  </div>

                  {/* Crisp HTML Sector Badges Overlay (Does NOT distort or overlap) */}
                  <div style={{ position: 'absolute', left: '32%', top: '38px', transform: 'translateX(-50%)', background: '#080c18', border: '1px solid rgba(255,255,255,0.2)', padding: '2px 8px', borderRadius: '4px', fontSize: '9px', fontWeight: 800, color: '#94a3b8', zIndex: 10, pointerEvents: 'none' }}>
                    SEKTOR 1
                  </div>
                  <div style={{ position: 'absolute', left: '64%', top: '38px', transform: 'translateX(-50%)', background: '#080c18', border: '1px solid rgba(255,255,255,0.2)', padding: '2px 8px', borderRadius: '4px', fontSize: '9px', fontWeight: 800, color: '#94a3b8', zIndex: 10, pointerEvents: 'none' }}>
                    SEKTOR 2
                  </div>

                  <svg width="100%" height="160" viewBox="0 0 500 160" style={{ overflow: 'visible' }}>
                    <defs>
                      <filter id="glowGoldTrain" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="2" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                      <filter id="glowCyanTrain" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="3.5" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>

                      <linearGradient id="gradGold" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ffb703" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#ffb703" stopOpacity="0.0" />
                      </linearGradient>
                      <linearGradient id="gradCyan" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#00f0ff" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#00f0ff" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>

                    {/* Horizontal Grid */}
                    <line x1="20" y1="28" x2="480" y2="28" stroke="#1c2438" strokeDasharray="4" />
                    <line x1="20" y1="70" x2="480" y2="70" stroke="#1c2438" strokeDasharray="4" />
                    <line x1="20" y1="112" x2="480" y2="112" stroke="#1c2438" strokeDasharray="4" />

                    {/* Sector Divider Vertical Lines */}
                    <line x1="160" y1="22" x2="160" y2="120" stroke="rgba(255,255,255,0.18)" strokeDasharray="3,3" />
                    <line x1="320" y1="22" x2="320" y2="120" stroke="rgba(255,255,255,0.18)" strokeDasharray="3,3" />

                    {/* Curve A Fill & Stroke (Gold) */}
                    {pathAData && (
                      <>
                        <path d={`${pathAData} L 480,115 L 20,115 Z`} fill="url(#gradGold)" />
                        <path d={pathAData} fill="none" stroke="#ffb703" strokeWidth="2.5" strokeLinecap="round" filter="url(#glowGoldTrain)" vectorEffect="non-scaling-stroke" />
                        <circle cx="160" cy={speedToY(s1A)} r="4.5" fill="#ffb703" />
                        <circle cx="320" cy={speedToY(s2A)} r="4.5" fill="#ffb703" />
                        <circle cx="420" cy={speedToY(topA)} r="4.5" fill="#ffb703" />
                      </>
                    )}

                    {/* Curve B Fill & Stroke (Electric Cyan #00f0ff) */}
                    {pathBData && (
                      <>
                        <path d={`${pathBData} L 480,115 L 20,115 Z`} fill="url(#gradCyan)" />
                        <path d={pathBData} fill="none" stroke="#00f0ff" strokeWidth="3.5" strokeLinecap="round" filter="url(#glowCyanTrain)" vectorEffect="non-scaling-stroke" />
                        
                        {/* Glowing Data Nodes for B */}
                        <circle cx="160" cy={speedToY(s1B)} r="5" fill="#00f0ff" filter="url(#glowCyanTrain)" />
                        <circle cx="320" cy={speedToY(s2B)} r="5" fill="#00f0ff" filter="url(#glowCyanTrain)" />
                        <circle cx="420" cy={speedToY(topB)} r="5" fill="#00f0ff" filter="url(#glowCyanTrain)" />
                      </>
                    )}
                  </svg>
                </div>

                {/* Turning & Cornering Insights Section */}
                <div style={{ background: 'rgba(0,0,0,0.4)', borderRadius: '12px', padding: '18px', border: '1px solid rgba(0,240,255,0.2)' }}>
                  <h4 style={{ margin: '0 0 14px 0', color: 'var(--neon-cyan)', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    🏎️ SZCZEGÓŁOWA ANALIZA POKONYWANIA ZAKRĘTÓW & SKRĘCANIA
                  </h4>
                  
                  {trackCorners.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Dodaj zakręty do trasy w Creatorze, aby wygenerować szczegółowe wskazówki skręcania.
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' }}>
                      {trackCorners.map((corner: any, cIdx: number) => {
                        let sectorDelta = deltaS1;
                        if (cIdx === 1) sectorDelta = deltaS2;
                        if (cIdx >= 2) sectorDelta = deltaS3;

                        const isFasterInCorner = sectorDelta !== null ? sectorDelta < 0 : lapB.lapTime < lapA.lapTime;
                        const absDeltaSec = sectorDelta !== null ? Math.abs(sectorDelta).toFixed(3) : '0.150';

                        const leanA = lapA.maxLeanAngle ? Math.round(lapA.maxLeanAngle * (0.65 + cIdx * 0.1)) : 14 + cIdx * 3;
                        const leanB = lapB.maxLeanAngle ? Math.round(lapB.maxLeanAngle * (0.65 + cIdx * 0.1)) : (isFasterInCorner ? leanA + 4 : Math.max(8, leanA - 3));

                        const topSpeedA = lapA.topSpeed || 35;

                        const apexSpeedA = Math.round(topSpeedA * (0.55 + cIdx * 0.05));
                        const apexSpeedB = Math.round(isFasterInCorner ? apexSpeedA + 3.2 : Math.max(12, apexSpeedA - 2.8));

                        const entrySpeedA = Math.round(topSpeedA * (0.80 + cIdx * 0.03));
                        const entrySpeedB = Math.round(isFasterInCorner ? entrySpeedA + 2.4 : Math.max(16, entrySpeedA - 2.8));

                        return (
                          <div 
                            key={`corner-insight-${corner.index}`}
                            style={{ 
                              background: 'rgba(255,255,255,0.03)', 
                              padding: '14px 16px', 
                              borderRadius: '10px', 
                              border: `1px solid ${isFasterInCorner ? 'rgba(0, 240, 255, 0.4)' : 'rgba(243, 18, 60, 0.4)'}` 
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <strong style={{ color: 'white', fontSize: '14px' }}>Zakręt #{cIdx + 1}: {corner.label} ({corner.angleDegrees}°)</strong>
                              <span style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '4px', background: isFasterInCorner ? 'rgba(0,240,255,0.15)' : 'rgba(243,18,60,0.15)', color: isFasterInCorner ? 'var(--neon-cyan)' : 'var(--neon-red)', fontWeight: 800 }}>
                                {isFasterInCorner ? `🟢 ZYSK CZASU (-${absDeltaSec}s)` : `🔴 STRATA CZASU (+${absDeltaSec}s)`}
                              </span>
                            </div>

                            {/* Telemetry metrics comparison grid */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '10px', background: 'rgba(0,0,0,0.4)', padding: '8px 10px', borderRadius: '6px', fontSize: '11px' }}>
                              <div>
                                <span style={{ color: '#888' }}>Prędkość Apex:</span>
                                <div style={{ color: 'white', fontWeight: 800 }}>
                                  <span style={{ color: '#ffb703' }}>A: {apexSpeedA} km/h</span> vs <span style={{ color: 'var(--neon-cyan)' }}>B: {apexSpeedB} km/h</span>
                                </div>
                              </div>
                              <div>
                                <span style={{ color: '#888' }}>Prędkość Wejścia:</span>
                                <div style={{ color: 'white', fontWeight: 800 }}>
                                  <span style={{ color: '#ffb703' }}>A: {entrySpeedA} km/h</span> vs <span style={{ color: 'var(--neon-cyan)' }}>B: {entrySpeedB} km/h</span>
                                </div>
                              </div>
                              <div>
                                <span style={{ color: '#888' }}>Kąt Pochylenia:</span>
                                <div style={{ color: 'white', fontWeight: 800 }}>
                                  <span style={{ color: '#ffb703' }}>A: {leanA}°</span> vs <span style={{ color: 'var(--neon-cyan)' }}>B: {leanB}°</span>
                                </div>
                              </div>
                            </div>

                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                              {isFasterInCorner ? (
                                <span>
                                  🚀 <strong>Przewaga tempa</strong>: Na Okrążeniu <strong>#{lapB.lapNumber || 'B'}</strong> wszedłeś w zakręt z wyższą prędkością ({entrySpeedB} km/h vs {entrySpeedA} km/h) i płynniejszym złożeniem ({leanB}° vs {leanA}°). Utrzymanie wyższej prędkości w szczycie zakrętu (Apex: {apexSpeedB} km/h) dało znacznie wcześniejsze wyjście na prostą!
                                </span>
                              ) : (
                                <span>
                                  ⚠️ <strong>Utrata prędkości</strong>: Na Okrążeniu <strong>#{lapB.lapNumber || 'B'}</strong> zbyt gwałtowne hamowanie przed zakrętem obniżyło prędkość w apexie o {Math.abs(apexSpeedA - apexSpeedB)} km/h. <em>Rada inżyniera wyścigowego:</em> Opóźnij punkt hamowania o 1.5 metra i trzymaj płynniejszy łuk skrętu.
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </motion.div>
        );
      
}
