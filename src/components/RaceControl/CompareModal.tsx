
import { motion } from 'framer-motion';

interface CompareModalProps {
  compareDriverA: string;
  setCompareDriverA: (val: string) => void;
  compareDriverB: string;
  setCompareDriverB: (val: string) => void;
  sortedLaps: any[];
  telemetry: any[];
  uniqueDrivers: any[];
  setShowCompareModal: (val: boolean) => void;
  buildMonotonicSpline: (pts: {x: number, y: number}[]) => string;
}

export function CompareModal({
  compareDriverA, setCompareDriverA,
  compareDriverB, setCompareDriverB,
  sortedLaps, telemetry, uniqueDrivers,
  setShowCompareModal, buildMonotonicSpline
}: CompareModalProps) {

        const driverALap = compareDriverA ? sortedLaps.find((l: any) => l.driverName === compareDriverA) : null;
        const driverBLap = compareDriverB ? sortedLaps.find((l: any) => l.driverName === compareDriverB) : null;

        const driverATelem = compareDriverA ? telemetry.find((t: any) => t.driverName === compareDriverA) : null;
        const driverBTelem = compareDriverB ? telemetry.find((t: any) => t.driverName === compareDriverB) : null;

        const s1A = driverALap?.s1 ? (450000 / driverALap.s1) * 3 : (driverATelem?.speed || 24);
        const s2A = driverALap?.s2 ? (450000 / driverALap.s2) * 3 : (driverATelem?.speed || 27);
        const topA = driverALap?.topSpeed || driverATelem?.speed || 32;
        const s3A = driverALap?.s3 ? (450000 / driverALap.s3) * 3 : 20;

        const s1B = driverBLap?.s1 ? (450000 / driverBLap.s1) * 3 : (driverBTelem?.speed || 21);
        const s2B = driverBLap?.s2 ? (450000 / driverBLap.s2) * 3 : (driverBTelem?.speed || 25);
        const topB = driverBLap?.topSpeed || driverBTelem?.speed || 30;
        const s3B = driverBLap?.s3 ? (450000 / driverBLap.s3) * 3 : 18;

        const allSpeeds = [s1A, s2A, topA, s3A, s1B, s2B, topB, s3B];
        const minSpeedVal = Math.max(0, Math.min(...allSpeeds) - 5);
        const maxSpeedVal = Math.max(...allSpeeds) + 5;
        const speedRange = Math.max(8, maxSpeedVal - minSpeedVal);

        const speedToY = (speed: number) => {
          const clamped = Math.min(Math.max(speed, minSpeedVal), maxSpeedVal);
          return Math.round(115 - ((clamped - minSpeedVal) / speedRange) * 85);
        };

        // Driver A SVG path calculation
        let pathAData = '';
        if (driverALap || driverATelem) {
          const ptsA = [
            { x: 20, y: speedToY(s1A * 0.7) },
            { x: 160, y: speedToY(s1A) },
            { x: 320, y: speedToY(s2A) },
            { x: 420, y: speedToY(topA) },
            { x: 480, y: speedToY(s3A) }
          ];
          pathAData = buildMonotonicSpline(ptsA);
        }

        // Driver B SVG path calculation
        let pathBData = '';
        if (driverBLap || driverBTelem) {
          const ptsB = [
            { x: 20, y: speedToY(s1B * 0.7) },
            { x: 160, y: speedToY(s1B) },
            { x: 320, y: speedToY(s2B) },
            { x: 420, y: speedToY(topB) },
            { x: 480, y: speedToY(s3B) }
          ];
          pathBData = buildMonotonicSpline(ptsB);
        }

        const lapTimeDelta = (driverALap?.lapTime && driverBLap?.lapTime)
          ? ((driverALap.lapTime - driverBLap.lapTime) / 1000).toFixed(3)
          : null;

        return (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-panel"
            style={{ padding: '24px', marginBottom: '24px', border: '1px solid var(--neon-purple)', background: 'rgba(10, 10, 20, 0.95)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: 'var(--neon-purple)' }}>PORÓWNYWARKA TELEMETRII 2 KIEROWCÓW</h3>
              <button className="btn-danger" style={{ padding: '4px 12px', fontSize: '12px' }} onClick={() => setShowCompareModal(false)}>✕ ZAMKNIJ</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
              <div>
                <label htmlFor="compare-driver-a" style={{ fontSize: '12px', color: 'var(--neon-green)', fontWeight: 800 }}>KIEROWCA A (ZIELONY #00FF88)</label>
                <select id="compare-driver-a" aria-label="Kierowca A" className="custom-select" style={{ width: '100%', marginTop: '4px' }} value={compareDriverA} onChange={e => setCompareDriverA(e.target.value)}>
                  <option value="">Wybierz Kierowcę A...</option>
                  {uniqueDrivers.map((l: any) => <option key={`comp-a-${l.driverName}`} value={l.driverName}>{l.driverName} ({(l.lapTime/1000).toFixed(3)}s)</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="compare-driver-b" style={{ fontSize: '12px', color: 'var(--neon-cyan)', fontWeight: 800 }}>KIEROWCA B (JASKRAWY CYJAN #00F0FF)</label>
                <select id="compare-driver-b" aria-label="Kierowca B" className="custom-select" style={{ width: '100%', marginTop: '4px' }} value={compareDriverB} onChange={e => setCompareDriverB(e.target.value)}>
                  <option value="">Wybierz Kierowcę B...</option>
                  {uniqueDrivers.map((l: any) => <option key={`comp-b-${l.driverName}`} value={l.driverName}>{l.driverName} ({(l.lapTime/1000).toFixed(3)}s)</option>)}
                </select>
              </div>
            </div>

            {/* SVG Comparative Graph Container */}
            <div style={{ background: '#050510', borderRadius: '12px', padding: '16px', height: '190px', position: 'relative', border: '1px solid rgba(0,240,255,0.2)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ fontSize: '11px', color: '#aaa', fontWeight: 800 }}>PROFIL PRĘDKOŚCI & TELEMETRII (0% ➔ 100% TRASY)</div>
                <div style={{ fontSize: '10px', color: 'var(--neon-cyan)', fontWeight: 800 }}>SKALA PRĘDKOŚCI: {Math.round(minSpeedVal)} - {Math.round(maxSpeedVal)} km/h</div>
              </div>

              {/* Crisp HTML Sector Badges Overlay (Does NOT distort or overlap) */}
              <div style={{ position: 'absolute', left: '32%', top: '38px', transform: 'translateX(-50%)', background: '#080c18', border: '1px solid rgba(255,255,255,0.2)', padding: '2px 8px', borderRadius: '4px', fontSize: '9px', fontWeight: 800, color: '#94a3b8', zIndex: 10, pointerEvents: 'none' }}>
                SEKTOR 1
              </div>
              <div style={{ position: 'absolute', left: '64%', top: '38px', transform: 'translateX(-50%)', background: '#080c18', border: '1px solid rgba(255,255,255,0.2)', padding: '2px 8px', borderRadius: '4px', fontSize: '9px', fontWeight: 800, color: '#94a3b8', zIndex: 10, pointerEvents: 'none' }}>
                SEKTOR 2
              </div>

              {(!compareDriverA && !compareDriverB) ? (
                <div style={{ height: '130px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888899', fontSize: '13px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px stroke rgba(255,255,255,0.05)' }}>
                  <span>⚠️ Wybierz co najmniej jednego kierowcę z rozwijanego menu powyżej, aby wygenerować i porównać ich wykresy telemetrii.</span>
                </div>
              ) : (
                <svg width="100%" height="130" viewBox="0 0 500 130" style={{ overflow: 'visible' }}>
                  <defs>
                    <filter id="glowGreenComp" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="2.5" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    <filter id="glowCyanComp" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="2.5" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>

                  {/* Grid Lines */}
                  <line x1="20" y1="28" x2="480" y2="28" stroke="#1f293d" strokeDasharray="4" />
                  <line x1="20" y1="70" x2="480" y2="70" stroke="#1f293d" strokeDasharray="4" />
                  <line x1="20" y1="112" x2="480" y2="112" stroke="#1f293d" strokeDasharray="4" />
                  
                  {/* Sector Vertical Dashed Lines */}
                  <line x1="160" y1="22" x2="160" y2="120" stroke="rgba(255,255,255,0.18)" strokeDasharray="3,3" />
                  <line x1="320" y1="22" x2="320" y2="120" stroke="rgba(255,255,255,0.18)" strokeDasharray="3,3" />

                  {/* Driver A Curve (Lime Green #00ff88) */}
                  {pathAData && (
                    <>
                      <path d={pathAData} fill="none" stroke="var(--neon-green)" strokeWidth="3.5" strokeLinecap="round" filter="url(#glowGreenComp)" vectorEffect="non-scaling-stroke" />
                      <circle cx="160" cy={speedToY(s1A)} r="4.5" fill="var(--neon-green)" />
                      <circle cx="320" cy={speedToY(s2A)} r="4.5" fill="var(--neon-green)" />
                      <circle cx="420" cy={speedToY(topA)} r="4.5" fill="var(--neon-green)" />
                    </>
                  )}
                  {/* Driver B Curve (Electric Cyan #00f0ff) */}
                  {pathBData && (
                    <>
                      <path d={pathBData} fill="none" stroke="var(--neon-cyan)" strokeWidth="3.5" strokeLinecap="round" filter="url(#glowCyanComp)" vectorEffect="non-scaling-stroke" />
                      <circle cx="160" cy={speedToY(s1B)} r="4.5" fill="var(--neon-cyan)" />
                      <circle cx="320" cy={speedToY(s2B)} r="4.5" fill="var(--neon-cyan)" />
                      <circle cx="420" cy={speedToY(topB)} r="4.5" fill="var(--neon-cyan)" />
                    </>
                  )}
                </svg>
              )}
            </div>

            {/* Telemetry Comparison Table */}
            {(driverALap || driverBLap) && (
              <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontSize: '10px', color: '#888' }}>CZAS OKRĄŻENIA</div>
                  <div style={{ fontSize: '14px', fontWeight: 800, marginTop: '2px', color: 'white' }}>
                    <span style={{ color: 'var(--neon-green)' }}>{driverALap ? (driverALap.lapTime/1000).toFixed(3) : '--'}s</span>
                    <span style={{ color: '#666', margin: '0 4px' }}>vs</span>
                    <span style={{ color: 'var(--neon-cyan)' }}>{driverBLap ? (driverBLap.lapTime/1000).toFixed(3) : '--'}s</span>
                  </div>
                  {lapTimeDelta !== null && (
                    <div style={{ fontSize: '11px', marginTop: '2px', fontWeight: 800, color: Number(lapTimeDelta) < 0 ? 'var(--neon-green)' : 'var(--neon-cyan)' }}>
                      Δ {Number(lapTimeDelta) < 0 ? `${lapTimeDelta}s (A szybszy)` : `+${lapTimeDelta}s (B szybszy)`}
                    </div>
                  )}
                </div>

                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontSize: '10px', color: '#888' }}>SEKTOR 1</div>
                  <div style={{ fontSize: '14px', fontWeight: 800, marginTop: '2px', color: 'white' }}>
                    <span style={{ color: 'var(--neon-green)' }}>{driverALap?.s1 ? (driverALap.s1/1000).toFixed(3) : '--'}s</span>
                    <span style={{ color: '#666', margin: '0 4px' }}>vs</span>
                    <span style={{ color: 'var(--neon-cyan)' }}>{driverBLap?.s1 ? (driverBLap.s1/1000).toFixed(3) : '--'}s</span>
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontSize: '10px', color: '#888' }}>SEKTOR 2</div>
                  <div style={{ fontSize: '14px', fontWeight: 800, marginTop: '2px', color: 'white' }}>
                    <span style={{ color: 'var(--neon-green)' }}>{driverALap?.s2 ? (driverALap.s2/1000).toFixed(3) : '--'}s</span>
                    <span style={{ color: '#666', margin: '0 4px' }}>vs</span>
                    <span style={{ color: 'var(--neon-cyan)' }}>{driverBLap?.s2 ? (driverBLap.s2/1000).toFixed(3) : '--'}s</span>
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontSize: '10px', color: '#888' }}>V MAX</div>
                  <div style={{ fontSize: '14px', fontWeight: 800, marginTop: '2px', color: 'white' }}>
                    <span style={{ color: 'var(--neon-green)' }}>{driverALap?.topSpeed ? Math.round(driverALap.topSpeed) : '--'} km/h</span>
                    <span style={{ color: '#666', margin: '0 4px' }}>vs</span>
                    <span style={{ color: 'var(--neon-cyan)' }}>{driverBLap?.topSpeed ? Math.round(driverBLap.topSpeed) : '--'} km/h</span>
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontSize: '10px', color: '#888' }}>POCHYLENIE (LEAN)</div>
                  <div style={{ fontSize: '14px', fontWeight: 800, marginTop: '2px', color: 'white' }}>
                    <span style={{ color: 'var(--neon-green)' }}>{driverALap?.maxLeanAngle ? `${Math.round(driverALap.maxLeanAngle)}°` : '--°'}</span>
                    <span style={{ color: '#666', margin: '0 4px' }}>vs</span>
                    <span style={{ color: 'var(--neon-cyan)' }}>{driverBLap?.maxLeanAngle ? `${Math.round(driverBLap.maxLeanAngle)}°` : '--°'}</span>
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontSize: '10px', color: '#888' }}>MAKS. G-FORCE</div>
                  <div style={{ fontSize: '14px', fontWeight: 800, marginTop: '2px', color: 'white' }}>
                    <span style={{ color: 'var(--neon-green)' }}>{driverALap?.maxGForce ? `${driverALap.maxGForce}G` : '--G'}</span>
                    <span style={{ color: '#666', margin: '0 4px' }}>vs</span>
                    <span style={{ color: 'var(--neon-cyan)' }}>{driverBLap?.maxGForce ? `${driverBLap.maxGForce}G` : '--G'}</span>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        );
      
}
