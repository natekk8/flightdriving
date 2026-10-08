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

  // Splines
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

  const scrubX = 20 + (scrubPercent / 100) * 460;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="clean-card"
      style={{
        padding: '20px',
        marginBottom: '20px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <GitCompare size={16} style={{ color: 'var(--accent-green)' }} />
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#ffffff' }}>
            Porównanie kierowców
          </h3>
        </div>

        <button
          className="btn-secondary"
          style={{ padding: '5px 10px', fontSize: '11px' }}
          onClick={() => setShowCompareModal(false)}
        >
          <X size={13} /> Zamknij
        </button>
      </div>

      {/* Selectors */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        <div>
          <label
            htmlFor="compare-driver-a"
            style={{ fontSize: '11px', color: 'var(--accent-green)', fontWeight: 600 }}
          >
            Kierowca A
          </label>
          <select
            id="compare-driver-a"
            className="custom-select"
            style={{ marginTop: '4px' }}
            value={compareDriverA}
            onChange={(e) => setCompareDriverA(e.target.value)}
          >
            <option value="">Wybierz kierowcę A...</option>
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
            style={{ fontSize: '11px', color: 'var(--accent-blue)', fontWeight: 600 }}
          >
            Kierowca B
          </label>
          <select
            id="compare-driver-b"
            className="custom-select"
            style={{ marginTop: '4px' }}
            value={compareDriverB}
            onChange={(e) => setCompareDriverB(e.target.value)}
          >
            <option value="">Wybierz kierowcę B...</option>
            {uniqueDrivers.map((l: any) => (
              <option key={`comp-b-${l.driverName}`} value={l.driverName}>
                {l.driverName} ({(l.lapTime / 1000).toFixed(3)}s)
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Comparison Delta */}
      {lapTimeDelta && (
        <div
          className="clean-card-inner"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
          }}
        >
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Różnica czasowa (A vs B):
          </span>
          <span
            className="font-digital"
            style={{
              fontSize: '15px',
              fontWeight: 700,
              color: Number(lapTimeDelta) < 0 ? 'var(--accent-green)' : 'var(--accent-amber)',
            }}
          >
            {Number(lapTimeDelta) > 0 ? `+${lapTimeDelta}s` : `${lapTimeDelta}s`}
          </span>
        </div>
      )}

      {/* Velocity curves SVG */}
      <div className="clean-card-inner" style={{ padding: '14px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px',
            fontSize: '11px',
            color: 'var(--text-secondary)',
          }}
        >
          <span>Wykres prędkości na dystansie toru</span>
          <div style={{ display: 'flex', gap: '12px' }}>
            <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>● Kierowca A</span>
            <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>● Kierowca B</span>
          </div>
        </div>

        <svg
          viewBox="0 0 500 130"
          style={{
            width: '100%',
            height: '140px',
            overflow: 'visible',
            background: 'rgba(0, 0, 0, 0.2)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          {/* Grid lines */}
          <line x1="20" y1="30" x2="480" y2="30" stroke="rgba(255,255,255,0.05)" />
          <line x1="20" y1="72" x2="480" y2="72" stroke="rgba(255,255,255,0.05)" />
          <line x1="20" y1="115" x2="480" y2="115" stroke="rgba(255,255,255,0.05)" />

          {/* S1 and S2 dividers */}
          <line x1="160" y1="10" x2="160" y2="115" stroke="rgba(255,255,255,0.1)" strokeDasharray="3,3" />
          <text x="162" y="20" fill="var(--text-muted)" fontSize="9">S1</text>
          <line x1="320" y1="10" x2="320" y2="115" stroke="rgba(255,255,255,0.1)" strokeDasharray="3,3" />
          <text x="322" y="20" fill="var(--text-muted)" fontSize="9">S2</text>

          {/* Spline A */}
          {pathAData && (
            <path d={pathAData} fill="none" stroke="var(--accent-green)" strokeWidth="2.5" />
          )}

          {/* Spline B */}
          {pathBData && (
            <path d={pathBData} fill="none" stroke="var(--accent-blue)" strokeWidth="2.5" />
          )}

          {/* Scrubber vertical bar */}
          <line
            x1={scrubX}
            y1="10"
            x2={scrubX}
            y2="115"
            stroke="#ffffff"
            strokeWidth="1.5"
            strokeDasharray="2,2"
          />
        </svg>

        {/* Timeline slider */}
        <div style={{ marginTop: '12px' }}>
          <input
            type="range"
            min="0"
            max="100"
            value={scrubPercent}
            onChange={(e) => setScrubPercent(Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--accent-green)' }}
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '10px',
              color: 'var(--text-muted)',
              marginTop: '4px',
            }}
          >
            <span>Start</span>
            <span>Sektor 1</span>
            <span>Sektor 2</span>
            <span>Meta ({scrubPercent}%)</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
