import { GPSKalmanFilter, generateGateLine, checkLineIntersection, interpolateSubPoints, getDynamicGateWidth, calculateTrackProgress } from './math';

export type Point = { lat: number; lon: number };

export interface TelemetryState {
  speed: number;
  maxSpeed: number;
  gForce: number;
  maxGForce: number;
  leanAngle: number;
  maxLeanAngle: number;
  heading: number;
  currentPoint: Point | null;
  lapStartTime: number | null;
  lapStartTimeLocal: number | null;
  lapNumber: number;
  sectorTimes: number[];
  s1Time: number | null;
  s2Time: number | null;
  s3Time: number | null;
  delta: number | null;
  liveGhostDelta: number | null;
  progressRatio: number;
}

export class TelemetryEngine {
  private track: any;
  private bestLap: any;
  private state: TelemetryState;
  
  private watchId: number | null = null;
  private motionHandler: ((e: DeviceMotionEvent) => void) | null = null;
  private orientationHandler: ((e: DeviceOrientationEvent) => void) | null = null;
  
  private filter = new GPSKalmanFilter();
  private lastPoint: Point | null = null;
  private lastTime = 0;
  
  private gates: [Point, Point][] = [];
  private nextGateIndex = 1;
  private lastGateCrossTime = 0;
  
  private hasMotionEvent = false;
  private smoothLean = 0;
  
  public onTick?: (state: TelemetryState) => void;
  public onLapFinish?: (lapArgs: any) => void;
  public onSector?: (sectorIndex: number, time: number) => void;
  public onLocationUpdate?: (point: Point) => void;
  public onTelemetryTick?: (data: any) => void;
  public onError?: (msg: string) => void;

  private telemetryThrottleMs = 250;
  private lastTelemetryTime = 0;

  constructor() {
    this.state = this.getInitialState();
  }

  private getInitialState(): TelemetryState {
    return {
      speed: 0, maxSpeed: 0, gForce: 0, maxGForce: 0, leanAngle: 0, maxLeanAngle: 0, heading: 0,
      currentPoint: null, lapStartTime: null, lapStartTimeLocal: null, lapNumber: 1,
      sectorTimes: [], s1Time: null, s2Time: null, s3Time: null, delta: null, liveGhostDelta: null, progressRatio: 0
    };
  }

  public start(track: any, bestLap: any, startingLapNumber: number) {
    this.track = track;
    this.bestLap = bestLap;
    this.state = this.getInitialState();
    this.state.lapNumber = startingLapNumber;

    if (track && track.path && track.path.length >= 2) {
      const baseGateWidth = 40;
      this.gates.push(generateGateLine(track.path, 0, baseGateWidth));
      if (track.s1Index !== undefined) this.gates.push(generateGateLine(track.path, track.s1Index, baseGateWidth));
      if (track.s2Index !== undefined) this.gates.push(generateGateLine(track.path, track.s2Index, baseGateWidth));
      this.gates.push(generateGateLine(track.path, track.path.length - 1, baseGateWidth));
    }

    this.startSensors();
  }

  public setLapStart() {
    this.state.lapStartTime = Date.now();
    this.state.lapStartTimeLocal = performance.now();
    this.state.s1Time = null;
    this.state.s2Time = null;
    this.state.s3Time = null;
    this.state.sectorTimes = [];
    this.nextGateIndex = 1;
  }

  public stop() {
    if (this.watchId) navigator.geolocation.clearWatch(this.watchId);
    if (this.motionHandler) window.removeEventListener('devicemotion', this.motionHandler);
    if (this.orientationHandler) window.removeEventListener('deviceorientation', this.orientationHandler);
  }

  public getState() {
    return this.state;
  }

  private startSensors() {
    this.motionHandler = (e: DeviceMotionEvent) => {
      const ag = e.accelerationIncludingGravity;
      if (ag && (ag.x !== null || ag.y !== null || ag.z !== null)) {
        this.hasMotionEvent = true;
        const agx = ag.x || 0;
        const agy = ag.y || 0;
        const agz = ag.z || 0;

        const linAcc = e.acceleration;
        if (linAcc && (linAcc.x !== null || linAcc.y !== null)) {
          const lx = linAcc.x || 0;
          const ly = linAcc.y || 0;
          this.state.gForce = Math.sqrt(lx * lx + ly * ly) / 9.81;
        } else {
          const gTotal = Math.sqrt(agx * agx + agy * agy + agz * agz) / 9.81;
          this.state.gForce = Math.max(0, gTotal - 1.0);
        }

        if (this.state.gForce > this.state.maxGForce) this.state.maxGForce = this.state.gForce;

        const norm = Math.sqrt(agy * agy + agz * agz);
        if (norm > 0.5) {
          const rawLean = (Math.atan2(-agx, norm) * 180) / Math.PI;
          this.smoothLean = this.smoothLean * 0.7 + rawLean * 0.3;
          this.state.leanAngle = Math.round(this.smoothLean);
          if (Math.abs(this.state.leanAngle) > this.state.maxLeanAngle) {
            this.state.maxLeanAngle = Math.abs(this.state.leanAngle);
          }
        }
      }
    };
    window.addEventListener('devicemotion', this.motionHandler);

    this.orientationHandler = (e: DeviceOrientationEvent) => {
      if (this.hasMotionEvent) return;
      const beta = e.beta || 0;
      const gamma = e.gamma || 0;
      let lean = gamma;
      if (Math.abs(beta) > 35) {
        const betaRad = (beta * Math.PI) / 180;
        const gammaRad = (gamma * Math.PI) / 180;
        const trueRoll = Math.atan2(Math.sin(gammaRad), Math.cos(betaRad) * Math.cos(gammaRad));
        lean = (trueRoll * 180) / Math.PI;
      }
      this.smoothLean = this.smoothLean * 0.7 + lean * 0.3;
      this.state.leanAngle = Math.round(this.smoothLean);
    };
    window.addEventListener('deviceorientation', this.orientationHandler);

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.handleGPS(pos),
      (err) => {
        if (this.onError) {
          if (err.code === err.PERMISSION_DENIED) this.onError('Brak uprawnień do lokalizacji.');
          else if (err.code === err.TIMEOUT) this.onError('Timeout GPS.');
          else this.onError('Błąd GPS.');
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
  }

  private handleGPS(pos: GeolocationPosition) {
    const rawTime = pos.timestamp;
    const accuracy = pos.coords.accuracy;
    const speedKmh = (pos.coords.speed || 0) * 3.6;

    this.state.speed = speedKmh;
    if (speedKmh > this.state.maxSpeed) this.state.maxSpeed = speedKmh;
    if (pos.coords.heading !== null && !isNaN(pos.coords.heading)) this.state.heading = pos.coords.heading;

    if (accuracy > 25) return; // ignore bad accuracy

    const filtered = this.filter.process(pos.coords.latitude, pos.coords.longitude, accuracy, rawTime);
    const currentPoint: Point = { lat: filtered.lat, lon: filtered.lon };
    this.state.currentPoint = currentPoint;

    if (this.onLocationUpdate) this.onLocationUpdate(currentPoint);

    // Live Ghost Delta
    if (this.track?.path && this.state.lapStartTime) {
      const { progressRatio } = calculateTrackProgress(currentPoint, this.track.path);
      this.state.progressRatio = progressRatio;
      const currentLapElapsedSec = (rawTime - this.state.lapStartTime) / 1000;
      
      if (this.bestLap?.lapTime && progressRatio > 0.05) {
        const expectedTimeSec = (this.bestLap.lapTime / 1000) * progressRatio;
        this.state.liveGhostDelta = currentLapElapsedSec - expectedTimeSec;
      }
    }

    const now = Date.now();
    if (now - this.lastTelemetryTime > this.telemetryThrottleMs && this.onTelemetryTick) {
      this.lastTelemetryTime = now;
      this.onTelemetryTick(this.state);
    }

    this.checkGates(currentPoint, rawTime, accuracy, speedKmh);
    
    this.lastPoint = currentPoint;
    this.lastTime = rawTime;
    
    if (this.onTick) this.onTick(this.state);
  }

  private checkGates(currentPoint: Point, rawTime: number, accuracy: number, speedKmh: number) {
    if (!this.lastPoint || this.nextGateIndex >= this.gates.length) return;

    const dynamicGateWidth = getDynamicGateWidth(speedKmh, accuracy || 10);
    
    let gateIndexToTest = this.nextGateIndex;
    if (this.nextGateIndex === 1 && this.track.s1Index !== undefined) gateIndexToTest = this.track.s1Index;
    else if (this.nextGateIndex === 2 && this.track.s2Index !== undefined) gateIndexToTest = this.track.s2Index;
    else if (this.nextGateIndex === this.gates.length - 1) gateIndexToTest = this.track.path.length - 1;
    else gateIndexToTest = 0;

    const gate = generateGateLine(this.track.path, Math.min(gateIndexToTest, this.track.path.length - 1), dynamicGateWidth);
    const subPoints = interpolateSubPoints(this.lastPoint, currentPoint, 6);
    
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

    if (detectedIntersection !== null) {
      if (Date.now() - this.lastGateCrossTime < 2000) return; // throttle re-arm

      this.lastGateCrossTime = Date.now();
      const subFraction = (detectedSubIndex + detectedIntersection) / 6;
      const exactTimestamp = this.lastTime + subFraction * (rawTime - this.lastTime);

      if (this.nextGateIndex === 0) {
        this.state.lapStartTime = exactTimestamp;
        this.state.lapStartTimeLocal = performance.now();
        this.nextGateIndex++;
      } else if (this.state.lapStartTime !== null) {
        const elapsed = exactTimestamp - this.state.lapStartTime;
        this.state.sectorTimes.push(elapsed);

        const hasS1 = this.gates.length > 2;
        const hasS2 = this.gates.length > 3;

        if (this.nextGateIndex === 1 && hasS1) {
          this.state.s1Time = elapsed;
          if (this.onSector) this.onSector(1, elapsed);
        }
        if (this.nextGateIndex === 2 && hasS2) {
          this.state.s2Time = elapsed - this.state.sectorTimes[0];
          if (this.onSector) this.onSector(2, this.state.s2Time);
        }

        if (this.nextGateIndex === this.gates.length - 1) {
          const totalTime = elapsed;
          if (hasS1) {
            const lastSectorBoundary = hasS2 ? this.state.sectorTimes[1] : this.state.sectorTimes[0];
            this.state.s3Time = totalTime - lastSectorBoundary;
          }

          if (this.bestLap) {
            this.state.delta = totalTime - this.bestLap.lapTime;
          } else {
            this.state.delta = -1;
          }

          if (this.onLapFinish) {
            this.onLapFinish({
              lapNumber: this.state.lapNumber,
              lapTime: totalTime,
              s1: hasS1 ? this.state.sectorTimes[0] : undefined,
              s2: hasS2 ? (this.state.sectorTimes[1] - this.state.sectorTimes[0]) : undefined,
              s3: hasS1 ? (totalTime - (hasS2 ? this.state.sectorTimes[1] : this.state.sectorTimes[0])) : undefined,
              topSpeed: this.state.maxSpeed,
              maxLeanAngle: this.state.maxLeanAngle,
              maxGForce: Number(this.state.maxGForce.toFixed(2)),
              timestamp: Date.now()
            });
          }

          // Reset for next lap
          this.state.maxLeanAngle = 0;
          this.state.maxGForce = 0;
          this.state.maxSpeed = 0;
          this.state.lapNumber++;
          this.nextGateIndex = 1;
          this.state.lapStartTime = exactTimestamp;
          this.state.lapStartTimeLocal = performance.now();
          this.state.sectorTimes = [];
        } else {
          this.nextGateIndex++;
        }
      }
    }
  }
}
