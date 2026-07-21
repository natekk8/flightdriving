let audioCtx: AudioContext | null = null;

export function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

export function playBeep(frequency: number, durationMs: number, type: OscillatorType = 'sine', volume: number = 1) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);
  
  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + durationMs / 1000);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc.start();
  osc.stop(audioCtx.currentTime + durationMs / 1000);
}

// F1 Start: 4 low short beeps, 1 long high beep
export function playF1StartBeep(isGo = false) {
  if (isGo) {
    playBeep(800, 1000, 'square', 1); // Go!
  } else {
    playBeep(400, 300, 'square', 0.8); // Light ON
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
