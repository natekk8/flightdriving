import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, GitCompare } from 'lucide-react';

interface CompareModalProps {
  compareDriverA: string;
  setCompareDriverA: (val: string) => void;
  compareDriverB: string;
  setCompareDriverB: (val: string) => void;
  sortedLaps: any[];
  telemetry: any[];
  uniqueDrivers: any[];
  setShowCompareModal: (val: boolean) => void;
  buildMonotonicSpline: (pts: { x: number; y: number }[]) => string;
}

export function CompareModal({
  compareDriverA,
  setCompareDriverA,
  compareDriverB,
  setCompareDriverB,
  sortedLaps,
  telemetry,
  uniqueDrivers,
  setShowCompareModal,
  buildMonotonicSpline,
}: CompareModalProps) {
  const [scrubPercent, setScrubPercent] = useState<number>(50);

  const driverALap = compareDriverA
    ? sortedLaps.find((l: any) => l.driverName === compareDriverA)
    : null;
  const driverBLap = compareDriverB
    ? sortedLaps.find((l: any) => l.driverName === compareDriverB)
    : null;

  const driverATelem = compareDriverA
    ? telemetry.find((t: any) => t.driverName === compareDriverA)
    : null;
  const driverBTelem = compareDriverB
    ? telemetry.find((t: any) => t.driverName === compareDriverB)
    : null;

  const s1A = driverALap?.s1 ? (450000 / driverALap.s1) * 3 : driverATelem?.speed || 24;
  const s2A = driverALap?.s2 ? (450000 / driverALap.s2) * 3 : driverATelem?.speed || 27;
  const topA = driverALap?.topSpeed || driverATelem?.speed || 32;
  const s3A = driverALap?.s3 ? (450000 / driverALap.s3) * 3 : 20;

  const s1B = driverBLap?.s1 ? (450000 / driverBLap.s1) * 3 : driverBTelem?.speed || 21;
  const s2B = driverBLap?.s2 ? (450000 / driverBLap.s2) * 3 : driverBTelem?.speed || 25;
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

  // Driver A Spline
  let pathAData = '';
  if (driverALap || driverATelem) {
    const ptsA = [
      { x: 20, y: speedToY(s1A * 0.7) },
      { x: 160, y: speedToY(s1A) },
      { x: 320, y: speedToY(s2A) },
      { x: 420, y: speedToY(topA) },
      { x: 480, y: speedToY(s3A) },
    ];
    pathAData = buildMonotonicSpline(ptsA);
  }

  // Driver B Spline
  let pathBData = '';
  if (driverBLap || driverBTelem) {
    const ptsB = [
      { x: 20, y: speedToY(s1B * 0.7) },
      { x: 160, y: speedToY(s1B) },
      { x: 320, y: speedToY(s2B) },
      { x: 420, y: speedToY(topB) },
      { x: 480, y: speedToY(s3B) },
    ];
    pathBData = buildMonotonicSpline(ptsB);
  }

  const lapTimeDelta =
    driverALap?.lapTime && driverBLap?.lapTime
      ? ((driverALap.lapTime - driverBLap.lapTime) / 1000).toFixed(3)
      : null;

  // Scrub x coordinate: 20 to 480 (range 460)
  const scrubX = 20 + (scrubPercent / 100) * 460;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className="telemetry-card"
      style={{
        padding: '24px',
        marginBottom: '24px',
        border: '1px solid var(--f1-purple)',
        boxShadow: '0 24px 60px rgba(0, 0, 0, 0.8), 0 0 25px rgba(189, 52, 254, 0.2)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'rgba(189, 52, 254, 0.2)',
              border: '1px solid var(--f1-purple)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--f1-purple)',
            }}
          >
            <GitCompare size={18} />
          </div>
          <div>
            <h3 style={{ margin: 0, color: 'var(--f1-purple)', fontSize: '15px' }}>
              PORÓWNANIE TELEMETRII 2 KIEROWCÓW
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              Analiza różnic czasowych, krzywej przyspieszenia i punktów dohamowań
            </span>
          </div>
        </div>

        <button
          className="btn-danger"
          style={{ padding: '6px 14px', fontSize: '11px' }}
          onClick={() => setShowCompareModal(false)}
        >
          <X size={14} /> ZAMKNIJ
        </button>
      </div>

      {/* Driver Selectors */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
        <div>
          <label
            htmlFor="compare-driver-a"
            style={{
              fontSize: '11px',
              color: 'var(--f1-green)',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Kierowca A (Zielony)
          </label>
          <select
            id="compare-driver-a"
            aria-label="Kierowca A"
            className="custom-select"
            style={{ marginTop: '6px' }}
            value={compareDriverA}
            onChange={(e) => setCompareDriverA(e.target.value)}
          >
            <option value="">Wybierz Kierowcę A...</option>
            {uniqueDrivers.map((l: any) => (
              <option key={`comp-a-${l.driverName}`} value={l.driverName}>
                {l.driverName} ({(l.lapTime / 1000).toFixed(3)}s)
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="compare-driver-b"
            style={{
              fontSize: '11px',
              color: 'var(--f1-cyan)',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Kierowca B (Cyjan)
          </label>
          <select
            id="compare-driver-b"
            aria-label="Kierowca B"
            className="custom-select"
            style={{ marginTop: '6px' }}
            value={compareDriverB}
            onChange={(e) => setCompareDriverB(e.target.value)}
          >
            <option value="">Wybierz Kierowcę B...</option>
            {uniqueDrivers.map((l: any) => (
              <option key={`comp-b-${l.driverName}`} value={l.driverName}>
                {l.driverName} ({(l.lapTime / 1000).toFixed(3)}s)
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Speed Profile Graph */}
      <div
        className="telemetry-card-inner"
        style={{
          padding: '16px',
          position: 'relative',
          overflow: 'hidden',
          marginBottom: '16px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px',
          }}
        >
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 800 }}>
            PROFIL PRĘDKOŚCI WZDŁUŻ TRASY (0% ➔ 100%)
          </span>
          <span
            className="font-digital"
            style={{ fontSize: '11px', color: 'var(--f1-cyan)', fontWeight: 800 }}
          >
            SKALA: {Math.round(minSpeedVal)} - {Math.round(maxSpeedVal)} KM/H
          </span>
        </div>

        {!compareDriverA && !compareDriverB ? (
          <div
            style={{
              height: '140px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: '13px',
              textAlign: 'center',
            }}
          >
            Wybierz kierowców powyżej, aby wygenerować wykres telemetrii.
          </div>
        ) : (
          <div>
            <svg width="100%" height="140" viewBox="0 0 500 140" style={{ overflow: 'visible' }}>
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
              <line x1="20" y1="30" x2="480" y2="30" stroke="rgba(255,255,255,0.06)" strokeDasharray="4" />
              <line x1="20" y1="75" x2="480" y2="75" stroke="rgba(255,255,255,0.06)" strokeDasharray="4" />
              <line x1="20" y1="120" x2="480" y2="120" stroke="rgba(255,255,255,0.06)" strokeDasharray="4" />

              {/* Sector markers */}
              <line x1="160" y1="20" x2="160" y2="130" stroke="rgba(255,255,255,0.15)" strokeDasharray="3,3" />
              <line x1="320" y1="20" x2="320" y2="130" stroke="rgba(255,255,255,0.15)" strokeDasharray="3,3" />

              {/* Driver A Curve */}
              {pathAData && (
                <>
                  <path
                    d={pathAData}
                    fill="none"
                    stroke="var(--f1-green)"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    filter="url(#glowGreenComp)"
                  />
                  <circle cx="160" cy={speedToY(s1A)} r="4" fill="var(--f1-green)" />
                  <circle cx="320" cy={speedToY(s2A)} r="4" fill="var(--f1-green)" />
                  <circle cx="420" cy={speedToY(topA)} r="4" fill="var(--f1-green)" />
                </>
              )}

              {/* Driver B Curve */}
              {pathBData && (
                <>
                  <path
                    d={pathBData}
                    fill="none"
                    stroke="var(--f1-cyan)"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    filter="url(#glowCyanComp)"
                  />
                  <circle cx="160" cy={speedToY(s1B)} r="4" fill="var(--f1-cyan)" />
                  <circle cx="320" cy={speedToY(s2B)} r="4" fill="var(--f1-cyan)" />
                  <circle cx="420" cy={speedToY(topB)} r="4" fill="var(--f1-cyan)" />
                </>
              )}

              {/* Interactive Telemetry Scrubber Needle */}
              <line
                x1={scrubX}
                y1="10"
                x2={scrubX}
                y2="135"
                stroke="var(--f1-purple)"
                strokeWidth="2"
                strokeDasharray="2,2"
              />
              <circle cx={scrubX} cy="10" r="4" fill="var(--f1-purple)" />
            </svg>

            {/* Scrubber Range Slider */}
            <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 800 }}>
                SCRUBBER: {scrubPercent}% TRASY
              </span>
              <input
                type="range"
                min="0"
                max="100"
                value={scrubPercent}
                onChange={(e) => setScrubPercent(Number(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--f1-purple)', cursor: 'ew-resize' }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Comparison Metrics Cards */}
      {(driverALap || driverBLap) && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '10px',
          }}
        >
          {/* Lap Time */}
          <div className="telemetry-card-inner" style={{ padding: '12px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 800 }}>CZAS OKRĄŻENIA</div>
            <div className="font-digital" style={{ fontSize: '14px', fontWeight: 800, marginTop: '4px' }}>
              <span style={{ color: 'var(--f1-green)' }}>
                {driverALap ? (driverALap.lapTime / 1000).toFixed(3) : '--'}s
              </span>
              <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>/</span>
              <span style={{ color: 'var(--f1-cyan)' }}>
                {driverBLap ? (driverBLap.lapTime / 1000).toFixed(3) : '--'}s
              </span>
            </div>
            {lapTimeDelta !== null && (
              <div
                className="font-digital"
                style={{
                  fontSize: '11px',
                  marginTop: '4px',
                  fontWeight: 800,
                  color: Number(lapTimeDelta) < 0 ? 'var(--f1-green)' : 'var(--f1-cyan)',
                }}
              >
                Δ {Number(lapTimeDelta) < 0 ? `${lapTimeDelta}s (A szybszy)` : `+${lapTimeDelta}s (B szybszy)`}
              </div>
            )}
          </div>

          {/* S1 */}
          <div className="telemetry-card-inner" style={{ padding: '12px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 800 }}>SEKTOR 1</div>
            <div className="font-digital" style={{ fontSize: '14px', fontWeight: 800, marginTop: '4px' }}>
              <span style={{ color: 'var(--f1-green)' }}>
                {driverALap?.s1 ? (driverALap.s1 / 1000).toFixed(3) : '--'}s
              </span>
              <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>/</span>
              <span style={{ color: 'var(--f1-cyan)' }}>
                {driverBLap?.s1 ? (driverBLap.s1 / 1000).toFixed(3) : '--'}s
              </span>
            </div>
          </div>

          {/* S2 */}
          <div className="telemetry-card-inner" style={{ padding: '12px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 800 }}>SEKTOR 2</div>
            <div className="font-digital" style={{ fontSize: '14px', fontWeight: 800, marginTop: '4px' }}>
              <span style={{ color: 'var(--f1-green)' }}>
                {driverALap?.s2 ? (driverALap.s2 / 1000).toFixed(3) : '--'}s
              </span>
              <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>/</span>
              <span style={{ color: 'var(--f1-cyan)' }}>
                {driverBLap?.s2 ? (driverBLap.s2 / 1000).toFixed(3) : '--'}s
              </span>
            </div>
          </div>

          {/* Top Speed */}
          <div className="telemetry-card-inner" style={{ padding: '12px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 800 }}>V MAX</div>
            <div className="font-digital" style={{ fontSize: '14px', fontWeight: 800, marginTop: '4px' }}>
              <span style={{ color: 'var(--f1-green)' }}>
                {driverALap?.topSpeed ? Math.round(driverALap.topSpeed) : '--'}
              </span>
              <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>/</span>
              <span style={{ color: 'var(--f1-cyan)' }}>
                {driverBLap?.topSpeed ? Math.round(driverBLap.topSpeed) : '--'} km/h
              </span>
            </div>
          </div>

          {/* Max G */}
          <div className="telemetry-card-inner" style={{ padding: '12px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 800 }}>MAKS. G-FORCE</div>
            <div className="font-digital" style={{ fontSize: '14px', fontWeight: 800, marginTop: '4px' }}>
              <span style={{ color: 'var(--f1-green)' }}>
                {driverALap?.maxGForce ? `${driverALap.maxGForce}G` : '--'}
              </span>
              <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>/</span>
              <span style={{ color: 'var(--f1-cyan)' }}>
                {driverBLap?.maxGForce ? `${driverBLap.maxGForce}G` : '--'}
              </span>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
