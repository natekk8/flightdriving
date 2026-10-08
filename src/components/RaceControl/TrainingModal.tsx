import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Target } from 'lucide-react';

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
  buildMonotonicSpline: (pts: { x: number; y: number }[]) => string;
  calculateTrackCorners: (path: any) => any;
}

export function TrainingModal({
  trainingDriver,
  setTrainingDriver,
  trainingLapAId,
  setTrainingLapAId,
  trainingLapBId,
  setTrainingLapBId,
  driverLaps,
  tracks,
  selectedTrack,
  uniqueDrivers,
  setShowTrainingModal,
  buildMonotonicSpline,
  calculateTrackCorners,
}: TrainingModalProps) {
  const [scrubPercent, setScrubPercent] = useState<number>(50);

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
      { x: 480, y: speedToY(s3A) },
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
      { x: 480, y: speedToY(s3B) },
    ];
    pathBData = buildMonotonicSpline(ptsB);
  }

  const deltaLap = lapA && lapB ? (lapB.lapTime - lapA.lapTime) / 1000 : null;
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
      {/* Modal Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Target size={16} style={{ color: 'var(--accent-green)' }} />
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#ffffff' }}>
              Analiza okrążeń kierowcy
            </h3>
          </div>
        </div>

        <button
          className="btn-secondary"
          style={{ padding: '5px 10px', fontSize: '11px' }}
          onClick={() => setShowTrainingModal(false)}
        >
          <X size={13} /> Zamknij
        </button>
      </div>

      {/* Selectors Bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        <div>
          <label style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>
            Kierowca
          </label>
          <select
            className="custom-select"
            style={{ marginTop: '4px' }}
            value={trainingDriver}
            onChange={(e) => setTrainingDriver(e.target.value)}
          >
            {uniqueDrivers.map((d: any) => (
              <option key={`train-d-${d.driverName}`} value={d.driverName}>
                {d.driverName}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: '11px', color: 'var(--accent-amber)', fontWeight: 600 }}>
            Okrążenie A
          </label>
          <select
            className="custom-select"
            style={{ marginTop: '4px' }}
            value={trainingLapAId}
            onChange={(e) => setTrainingLapAId(e.target.value)}
          >
            {driverLaps.map((l: any, i: number) => (
              <option key={`lap-a-${l._id}`} value={l._id}>
                Okrążenie #{l.lapNumber || i + 1} ({(l.lapTime / 1000).toFixed(3)}s)
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: '11px', color: 'var(--accent-green)', fontWeight: 600 }}>
            Okrążenie B (Odniesienie)
          </label>
          <select
            className="custom-select"
            style={{ marginTop: '4px' }}
            value={trainingLapBId}
            onChange={(e) => setTrainingLapBId(e.target.value)}
          >
            {driverLaps.map((l: any, i: number) => (
              <option key={`lap-b-${l._id}`} value={l._id}>
                Okrążenie #{l.lapNumber || i + 1} ({(l.lapTime / 1000).toFixed(3)}s)
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Delta */}
      {deltaLap !== null && (
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
            Różnica między okrążeniami:
          </span>
          <span
            className="font-digital"
            style={{
              fontSize: '15px',
              fontWeight: 700,
              color: deltaLap <= 0 ? 'var(--accent-green)' : 'var(--accent-amber)',
            }}
          >
            {deltaLap > 0 ? `+${deltaLap.toFixed(3)}s` : `${deltaLap.toFixed(3)}s`}
          </span>
        </div>
      )}

      {/* Telemetry Curves */}
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
          <span>Profil prędkości na trasie</span>
          <div style={{ display: 'flex', gap: '12px' }}>
            <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>● Okrążenie A</span>
            <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>● Okrążenie B</span>
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
          <line x1="20" y1="30" x2="480" y2="30" stroke="rgba(255,255,255,0.05)" />
          <line x1="20" y1="72" x2="480" y2="72" stroke="rgba(255,255,255,0.05)" />
          <line x1="20" y1="115" x2="480" y2="115" stroke="rgba(255,255,255,0.05)" />

          <line x1="160" y1="10" x2="160" y2="115" stroke="rgba(255,255,255,0.1)" strokeDasharray="3,3" />
          <text x="162" y="20" fill="var(--text-muted)" fontSize="9">S1</text>
          <line x1="320" y1="10" x2="320" y2="115" stroke="rgba(255,255,255,0.1)" strokeDasharray="3,3" />
          <text x="322" y="20" fill="var(--text-muted)" fontSize="9">S2</text>

          {pathAData && (
            <path d={pathAData} fill="none" stroke="var(--accent-amber)" strokeWidth="2.5" />
          )}

          {pathBData && (
            <path d={pathBData} fill="none" stroke="var(--accent-green)" strokeWidth="2.5" />
          )}

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

        <div style={{ marginTop: '12px' }}>
          <input
            type="range"
            min="0"
            max="100"
            value={scrubPercent}
            onChange={(e) => setScrubPercent(Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--accent-green)' }}
          />
        </div>
      </div>

      {/* Detected Corners */}
      {trackCorners.length > 0 && (
        <div style={{ marginTop: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
            Zakręty na torze ({trackCorners.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
            {trackCorners.map((c: any) => (
              <div
                key={`corner-${c.index}`}
                className="clean-card-inner"
                style={{ padding: '8px 10px', textAlign: 'center' }}
              >
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#ffffff' }}>
                  Zakręt #{c.index}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Kąt: {Math.round(c.angle)}°
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
