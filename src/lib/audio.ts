let audioCtx: AudioContext | null = null;

export function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

export function playBeep(frequency: number, durationMs: number, type: OscillatorType = 'sine', volume: number = 0.5) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  const safeVol = Math.max(0.001, Math.min(volume, 0.7));
  const startTime = audioCtx.currentTime;
  const durationSec = durationMs / 1000;
  
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, startTime);
  
  gain.gain.setValueAtTime(safeVol, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + durationSec);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc.start(startTime);
  osc.stop(startTime + durationSec);
}

// F1 Start: Low clean beep on each red light, high energetic beep on Lights Out (Go!)
export function playF1StartBeep(isGo = false) {
  if (isGo) {
    playBeep(950, 700, 'sine', 0.7); // Lights Out / Go!
    if (navigator.vibrate) navigator.vibrate([150, 50, 150]);
  } else {
    playBeep(450, 250, 'triangle', 0.5); // Light ON
    if (navigator.vibrate) navigator.vibrate(60);
  }
}

export function playDeltaBeep(isFaster: boolean) {
  if (isFaster) {
    // Two quick high beeps for personal best sector
    playBeep(1200, 150, 'sine', 0.6);
    setTimeout(() => playBeep(1200, 150, 'sine', 0.6), 200);
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  } else {
    // One low sad beep for slower sector
    playBeep(300, 400, 'triangle', 0.6);
    if (navigator.vibrate) navigator.vibrate(300);
  }
}

export function playLapFinishBeep() {
  playBeep(600, 200, 'sine', 0.8);
  setTimeout(() => playBeep(800, 200, 'sine', 0.8), 200);
  setTimeout(() => playBeep(1200, 400, 'sine', 0.8), 400);
  if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
}
