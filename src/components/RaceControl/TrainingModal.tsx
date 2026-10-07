import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Target, TrendingUp } from 'lucide-react';

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
  const deltaS1 = lapA?.s1 && lapB?.s1 ? (lapB.s1 - lapA.s1) / 1000 : null;
  const deltaS2 = lapA?.s2 && lapB?.s2 ? (lapB.s2 - lapA.s2) / 1000 : null;
  const deltaS3 = lapA?.s3 && lapB?.s3 ? (lapB.s3 - lapA.s3) / 1000 : null;

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
        border: '1px solid var(--f1-cyan)',
        boxShadow: '0 24px 60px rgba(0, 0, 0, 0.8), 0 0 25px rgba(0, 240, 255, 0.2)',
      }}
    >
      {/* Modal Header */}
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
              background: 'rgba(0, 240, 255, 0.2)',
              border: '1px solid var(--f1-cyan)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--f1-cyan)',
            }}
          >
            <Target size={18} />
          </div>
          <div>
            <h3 style={{ margin: 0, color: 'var(--f1-cyan)', fontSize: '15px' }}>
              TRENER TELEMETRII & ANALIZA OKRĄŻEŃ
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              Porównaj dwa dowolne okrążenia, sprawdź punkty wejścia i wyjścia z zakrętów
            </span>
          </div>
        </div>

        <button
          className="btn-danger"
          style={{ padding: '6px 14px', fontSize: '11px' }}
          onClick={() => setShowTrainingModal(false)}
        >
          <X size={14} /> ZAMKNIJ
        </button>
      </div>

      {/* Selectors Bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '14px',
          marginBottom: '18px',
        }}
      >
        <div>
          <label
            htmlFor="training-driver-select"
            style={{
              fontSize: '11px',
              color: 'var(--f1-cyan)',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            1. Wybierz Kierowcę
          </label>
          <select
            id="training-driver-select"
            className="custom-select"
            style={{ marginTop: '6px' }}
            value={trainingDriver}
            onChange={(e) => {
              setTrainingDriver(e.target.value);
              setTrainingLapAId('');
              setTrainingLapBId('');
            }}
          >
            <option value="">-- Wybierz Kierowcę --</option>
            {uniqueDrivers.map((d: any) => (
              <option key={`tr-driver-${d.driverName}`} value={d.driverName}>
                👤 {d.driverName} (Best: {(d.lapTime / 1000).toFixed(3)}s)
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="training-lapa-select"
            style={{
              fontSize: '11px',
              color: 'var(--f1-yellow)',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            2. Okrążenie A (Baza / Złote)
          </label>
          <select
            id="training-lapa-select"
            className="custom-select"
            style={{ marginTop: '6px' }}
            value={trainingLapAId}
            onChange={(e) => setTrainingLapAId(e.target.value)}
            disabled={!trainingDriver || driverLaps.length === 0}
          >
            <option value="">-- Wybierz Okrążenie A --</option>
            {driverLaps.map((l: any, i: number) => (
              <option key={`tr-lapa-${l._id}`} value={l._id}>
                Okrążenie #{l.lapNumber || i + 1} — {(l.lapTime / 1000).toFixed(3)}s (V-Max:{' '}
                {Math.round(l.topSpeed || 0)} km/h)
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="training-lapb-select"
            style={{
              fontSize: '11px',
              color: 'var(--f1-cyan)',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            3. Okrążenie B (Testowe / Cyjan)
          </label>
          <select
            id="training-lapb-select"
            className="custom-select"
            style={{ marginTop: '6px' }}
            value={trainingLapBId}
            onChange={(e) => setTrainingLapBId(e.target.value)}
            disabled={!trainingDriver || driverLaps.length === 0}
          >
            <option value="">-- Wybierz Okrążenie B --</option>
            {driverLaps.map((l: any, i: number) => (
              <option key={`tr-lapb-${l._id}`} value={l._id}>
                Okrążenie #{l.lapNumber || i + 1} — {(l.lapTime / 1000).toFixed(3)}s (V-Max:{' '}
                {Math.round(l.topSpeed || 0)} km/h)
              </option>
            ))}
          </select>
        </div>
      </div>

      {!lapA || !lapB ? (
        <div
          style={{
            padding: '36px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            background: 'rgba(255,255,255,0.02)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          Wybierz kierowcę oraz dwa okrążenia powyżej, aby uruchomić pełną analizę telemetryczną.
        </div>
      ) : (
        <>
          {/* Delta Metrics Bar */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '10px',
              marginBottom: '16px',
            }}
          >
            <div className="telemetry-card-inner" style={{ padding: '12px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 800 }}>RÓŻNICA CZASU (B - A)</div>
              <div
                className="font-digital"
                style={{
                  fontSize: '15px',
                  fontWeight: 900,
                  marginTop: '4px',
                  color: deltaLap !== null ? (deltaLap < 0 ? 'var(--f1-green)' : 'var(--f1-red)') : 'white',
                }}
              >
                {deltaLap !== null
                  ? deltaLap < 0
                    ? `${deltaLap.toFixed(3)}s (B szybszy!)`
                    : `+${deltaLap.toFixed(3)}s (A szybszy)`
                  : '--'}
              </div>
            </div>

            <div className="telemetry-card-inner" style={{ padding: '12px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 800 }}>SEKTOR 1 Δ</div>
              <div
                className="font-digital"
                style={{
                  fontSize: '15px',
                  fontWeight: 800,
                  marginTop: '4px',
                  color: deltaS1 !== null ? (deltaS1 < 0 ? 'var(--f1-green)' : 'var(--f1-red)') : 'white',
                }}
              >
                {deltaS1 !== null ? `${deltaS1.toFixed(3)}s` : '--'}
              </div>
            </div>

            <div className="telemetry-card-inner" style={{ padding: '12px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 800 }}>SEKTOR 2 Δ</div>
              <div
                className="font-digital"
                style={{
                  fontSize: '15px',
                  fontWeight: 800,
                  marginTop: '4px',
                  color: deltaS2 !== null ? (deltaS2 < 0 ? 'var(--f1-green)' : 'var(--f1-red)') : 'white',
                }}
              >
                {deltaS2 !== null ? `${deltaS2.toFixed(3)}s` : '--'}
              </div>
            </div>

            <div className="telemetry-card-inner" style={{ padding: '12px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 800 }}>SEKTOR 3 Δ</div>
              <div
                className="font-digital"
                style={{
                  fontSize: '15px',
                  fontWeight: 800,
                  marginTop: '4px',
                  color: deltaS3 !== null ? (deltaS3 < 0 ? 'var(--f1-green)' : 'var(--f1-red)') : 'white',
                }}
              >
                {deltaS3 !== null ? `${deltaS3.toFixed(3)}s` : '--'}
              </div>
            </div>

            <div className="telemetry-card-inner" style={{ padding: '12px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 800 }}>RÓŻNICA V-MAX</div>
              <div
                className="font-digital"
                style={{
                  fontSize: '15px',
                  fontWeight: 800,
                  marginTop: '4px',
                  color: 'var(--f1-cyan)',
                }}
              >
                {Math.round((lapB.topSpeed || 0) - (lapA.topSpeed || 0))} km/h
              </div>
            </div>
          </div>

          {/* SVG Speed Overlay Graph */}
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
                PORÓWNANIE KRZYWEJ PRĘDKOŚCI (0% ➔ 100%)
              </span>
              <div style={{ display: 'flex', gap: '14px', fontSize: '11px' }}>
                <span style={{ color: 'var(--f1-yellow)', fontWeight: 800 }}>🟡 Okrążenie A</span>
                <span style={{ color: 'var(--f1-cyan)', fontWeight: 800 }}>🔵 Okrążenie B</span>
              </div>
            </div>

            <svg width="100%" height="150" viewBox="0 0 500 150" style={{ overflow: 'visible' }}>
              {/* Grid Lines */}
              <line x1="20" y1="30" x2="480" y2="30" stroke="rgba(255,255,255,0.06)" strokeDasharray="4" />
              <line x1="20" y1="75" x2="480" y2="75" stroke="rgba(255,255,255,0.06)" strokeDasharray="4" />
              <line x1="20" y1="120" x2="480" y2="120" stroke="rgba(255,255,255,0.06)" strokeDasharray="4" />

              {/* Sector Dividers */}
              <line x1="160" y1="20" x2="160" y2="135" stroke="rgba(255,255,255,0.15)" strokeDasharray="3,3" />
              <line x1="320" y1="20" x2="320" y2="135" stroke="rgba(255,255,255,0.15)" strokeDasharray="3,3" />

              {/* Curve A */}
              {pathAData && (
                <>
                  <path
                    d={pathAData}
                    fill="none"
                    stroke="var(--f1-yellow)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  <circle cx="160" cy={speedToY(s1A)} r="4" fill="var(--f1-yellow)" />
                  <circle cx="320" cy={speedToY(s2A)} r="4" fill="var(--f1-yellow)" />
                  <circle cx="420" cy={speedToY(topA)} r="4" fill="var(--f1-yellow)" />
                </>
              )}

              {/* Curve B */}
              {pathBData && (
                <>
                  <path
                    d={pathBData}
                    fill="none"
                    stroke="var(--f1-cyan)"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                  />
                  <circle cx="160" cy={speedToY(s1B)} r="5" fill="var(--f1-cyan)" />
                  <circle cx="320" cy={speedToY(s2B)} r="5" fill="var(--f1-cyan)" />
                  <circle cx="420" cy={speedToY(topB)} r="5" fill="var(--f1-cyan)" />
                </>
              )}

              {/* Scrubber Needle */}
              <line
                x1={scrubX}
                y1="10"
                x2={scrubX}
                y2="140"
                stroke="var(--f1-cyan)"
                strokeWidth="2"
                strokeDasharray="2,2"
              />
              <circle cx={scrubX} cy="10" r="4" fill="var(--f1-cyan)" />
            </svg>

            {/* Slider */}
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
                style={{ flex: 1, accentColor: 'var(--f1-cyan)', cursor: 'ew-resize' }}
              />
            </div>
          </div>

          {/* Corner Insights */}
          {trackCorners.length > 0 && (
            <div className="telemetry-card-inner" style={{ padding: '16px' }}>
              <h4
                style={{
                  margin: '0 0 12px 0',
                  color: 'var(--f1-cyan)',
                  fontSize: '13px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <TrendingUp size={14} /> ANALIZA ZAKRĘTÓW & PORADY INŻYNIERA
              </h4>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: '12px',
                }}
              >
                {trackCorners.slice(0, 4).map((corner: any, cIdx: number) => {
                  let sectorDelta = deltaS1;
                  if (cIdx === 1) sectorDelta = deltaS2;
                  if (cIdx >= 2) sectorDelta = deltaS3;

                  const isFaster = sectorDelta !== null ? sectorDelta < 0 : lapB.lapTime < lapA.lapTime;
                  const deltaSec = sectorDelta !== null ? Math.abs(sectorDelta).toFixed(3) : '0.120';

                  return (
                    <div
                      key={`corner-${corner.index}`}
                      style={{
                        background: 'rgba(255,255,255,0.02)',
                        padding: '12px',
                        borderRadius: 'var(--radius-sm)',
                        border: `1px solid ${isFaster ? 'rgba(0,230,118,0.3)' : 'rgba(244,63,94,0.3)'}`,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '6px',
                        }}
                      >
                        <span style={{ fontWeight: 800, fontSize: '13px', color: '#fff' }}>
                          Zakręt #{cIdx + 1}: {corner.label} ({corner.angleDegrees}°)
                        </span>
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 800,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: isFaster ? 'rgba(0,230,118,0.15)' : 'rgba(244,63,94,0.15)',
                            color: isFaster ? 'var(--f1-green)' : 'var(--f1-red)',
                          }}
                        >
                          {isFaster ? `-${deltaSec}s` : `+${deltaSec}s`}
                        </span>
                      </div>
                      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                        {isFaster
                          ? `Świetne tempo na Okrążeniu B! Płynne złożenie i wyższa prędkość w szczycie zakrętu zaowocowały zyskiem czasu.`
                          : `Zbyt wczesne dohamowanie na Okrążeniu B. Utrzymaj wyższą prędkość wejściową, aby poprawić wyjście na prostą.`}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
