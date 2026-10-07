import {
  GPSKalmanFilter,
  generateGateLine,
  checkLineIntersection,
  interpolateSubPoints,
  getDynamicGateWidth,
  calculateTrackProgress,
  calculateCumulativeDistances,
  getTrackHeading,
  isClosedCircuit,
  type Point,
} from './math';

export { type Point };

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
  distanceMeters: number;
  isSimulated?: boolean;
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
  private gateIndices: number[] = [];
  private nextGateIndex = 1;
  private lastGateCrossTime = 0;
  private cumulativeDistances: number[] = [];
  public isClosedLoop = false;

  private hasMotionEvent = false;
  private smoothLean = 0;

  // Simulator state
  private simulatorTimer: any = null;

  public onTick?: (state: TelemetryState) => void;
  public onLapFinish?: (lapArgs: any) => void;
  public onSector?: (sectorIndex: number, time: number) => void;
  public onLocationUpdate?: (point: Point) => void;
  public onTelemetryTick?: (data: any) => void;
  public onError?: (msg: string) => void;

  private telemetryThrottleMs = 350;
  private lastTelemetryTime = 0;

  constructor() {
    this.state = this.getInitialState();
  }

  private getInitialState(): TelemetryState {
    return {
      speed: 0,
      maxSpeed: 0,
      gForce: 0,
      maxGForce: 0,
      leanAngle: 0,
      maxLeanAngle: 0,
      heading: 0,
      currentPoint: null,
      lapStartTime: null,
      lapStartTimeLocal: null,
      lapNumber: 1,
      sectorTimes: [],
      s1Time: null,
      s2Time: null,
      s3Time: null,
      delta: null,
      liveGhostDelta: null,
      progressRatio: 0,
      distanceMeters: 0,
      isSimulated: false,
    };
  }

  public start(track: any, bestLap: any, startingLapNumber: number) {
    this.stop();
    this.track = track;
    this.bestLap = bestLap;
    this.state = this.getInitialState();
    this.state.lapNumber = startingLapNumber;
    this.gates = [];
    this.gateIndices = [];
    this.filter.reset();

    if (track && track.path && track.path.length >= 2) {
      this.cumulativeDistances = calculateCumulativeDistances(track.path);
      this.isClosedLoop = isClosedCircuit(track.path);

      const baseGateWidth = 40;
      // Gate 0: Start
      this.gates.push(generateGateLine(track.path, 0, baseGateWidth));
      this.gateIndices.push(0);

      // Gate 1: S1
      if (track.s1Index !== undefined && track.s1Index > 0) {
        this.gates.push(generateGateLine(track.path, track.s1Index, baseGateWidth));
        this.gateIndices.push(track.s1Index);
      }

      // Gate 2: S2
      if (track.s2Index !== undefined && track.s2Index > 0) {
        this.gates.push(generateGateLine(track.path, track.s2Index, baseGateWidth));
        this.gateIndices.push(track.s2Index);
      }

      // Gate Final: Finish Line
      const finishIndex = track.path.length - 1;
      this.gates.push(generateGateLine(track.path, finishIndex, baseGateWidth));
      this.gateIndices.push(finishIndex);
    }

    this.startSensors();
  }

  public setLapStart() {
    const now = Date.now();
    const nowLocal = performance.now();
    this.state.lapStartTime = now;
    this.state.lapStartTimeLocal = nowLocal;
    this.state.s1Time = null;
    this.state.s2Time = null;
    this.state.s3Time = null;
    this.state.sectorTimes = [];
    this.nextGateIndex = 1;
  }

  public stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    if (this.motionHandler) {
      window.removeEventListener('devicemotion', this.motionHandler);
      this.motionHandler = null;
    }
    if (this.orientationHandler) {
      window.removeEventListener('deviceorientation', this.orientationHandler);
      this.orientationHandler = null;
    }
    if (this.simulatorTimer) {
      clearInterval(this.simulatorTimer);
      this.simulatorTimer = null;
    }
  }

  public getState(): TelemetryState {
    return this.state;
  }

  // Starts built-in virtual GPS simulation along the current track for live testing
  public startSimulator(targetSpeedKmh = 42, intervalMs = 200) {
    if (!this.track?.path || this.track.path.length < 2) return;
    this.stop();
    this.state.isSimulated = true;
    this.setLapStart();

    const path: Point[] = this.track.path;
    const totalDist = this.cumulativeDistances[this.cumulativeDistances.length - 1] || 1000;
    const metersPerStep = (targetSpeedKmh / 3.6) * (intervalMs / 1000);

    let currentDist = 0;

    this.simulatorTimer = setInterval(() => {
      currentDist += metersPerStep;
      if (currentDist >= totalDist) {
        currentDist = currentDist % totalDist;
      }

      let segIdx = 0;
      for (let i = 0; i < this.cumulativeDistances.length - 1; i++) {
        if (currentDist >= this.cumulativeDistances[i] && currentDist <= this.cumulativeDistances[i + 1]) {
          segIdx = i;
          break;
        }
      }

      const segStartDist = this.cumulativeDistances[segIdx];
      const segEndDist = this.cumulativeDistances[segIdx + 1] || segStartDist + 1;
      const segFrac = Math.max(0, Math.min(1, (currentDist - segStartDist) / (segEndDist - segStartDist)));

      const p0 = path[segIdx];
      const p1 = path[segIdx + 1] || path[segIdx];

      const simLat = p0.lat + segFrac * (p1.lat - p0.lat);
      const simLon = p0.lon + segFrac * (p1.lon - p0.lon);
      const heading = getTrackHeading(path, segIdx);

      const currentSpeed = targetSpeedKmh + Math.sin(currentDist * 0.05) * 5;
      const simGForce = Math.min(1.2, Math.abs(Math.sin(currentDist * 0.04) * 0.7));
      const simLean = Math.round(Math.sin(currentDist * 0.04) * 28);

      this.state.gForce = simGForce;
      if (simGForce > this.state.maxGForce) this.state.maxGForce = simGForce;
      this.state.leanAngle = simLean;
      if (Math.abs(simLean) > this.state.maxLeanAngle) this.state.maxLeanAngle = Math.abs(simLean);

      const mockPos = {
        coords: {
          latitude: simLat,
          longitude: simLon,
          accuracy: 4,
          altitude: null,
          altitudeAccuracy: null,
          heading: heading,
          speed: currentSpeed / 3.6,
          toJSON: () => ({}),
        },
        timestamp: Date.now(),
        toJSON: () => ({}),
      } as unknown as GeolocationPosition;

      this.handleGPS(mockPos);
    }, intervalMs);
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
          this.smoothLean = this.smoothLean * 0.75 + rawLean * 0.25;
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
      this.smoothLean = this.smoothLean * 0.75 + lean * 0.25;
      this.state.leanAngle = Math.round(this.smoothLean);
      if (Math.abs(this.state.leanAngle) > this.state.maxLeanAngle) {
        this.state.maxLeanAngle = Math.abs(this.state.leanAngle);
      }
    };
    window.addEventListener('deviceorientation', this.orientationHandler);

    if ('geolocation' in navigator) {
      this.watchId = navigator.geolocation.watchPosition(
        (pos) => this.handleGPS(pos),
        (err) => {
          if (this.onError) {
            if (err.code === err.PERMISSION_DENIED) this.onError('Brak uprawnień do lokalizacji.');
            else if (err.code === err.TIMEOUT) this.onError('Timeout sygnału GPS.');
            else this.onError('Błąd odczytu GPS.');
          }
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
      );
    }
  }

  private handleGPS(pos: GeolocationPosition) {
    const rawTime = pos.timestamp;
    const accuracy = pos.coords.accuracy;
    const speedKmh = (pos.coords.speed || 0) * 3.6;

    this.state.speed = speedKmh;
    if (speedKmh > this.state.maxSpeed) this.state.maxSpeed = speedKmh;
    if (pos.coords.heading !== null && !isNaN(pos.coords.heading)) {
      this.state.heading = pos.coords.heading;
    }

    if (accuracy > 30) return; // Drop fixes with excessive drift

    const filtered = this.filter.process(pos.coords.latitude, pos.coords.longitude, accuracy, rawTime);
    const currentPoint: Point = { lat: filtered.lat, lon: filtered.lon };
    this.state.currentPoint = currentPoint;

    if (this.onLocationUpdate) this.onLocationUpdate(currentPoint);

    // Live Ghost Delta & Track Progress based on true arc-length
    if (this.track?.path && this.state.lapStartTime) {
      const { progressRatio, distanceMeters } = calculateTrackProgress(
        currentPoint,
        this.track.path,
        this.cumulativeDistances
      );
      this.state.progressRatio = progressRatio;
      this.state.distanceMeters = Math.round(distanceMeters);

      const currentLapElapsedSec = (rawTime - this.state.lapStartTime) / 1000;
      if (this.bestLap?.lapTime && progressRatio > 0.03) {
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
    if (!this.lastPoint || this.gates.length < 2 || this.nextGateIndex >= this.gates.length) return;

    const dynamicGateWidth = getDynamicGateWidth(speedKmh, accuracy || 10);
    const targetGatePathIndex = this.gateIndices[this.nextGateIndex] ?? 0;
    const trackHeading = getTrackHeading(this.track.path, targetGatePathIndex);

    // Re-generate gate line with dynamic width suited to current speed
    const gate = generateGateLine(this.track.path, targetGatePathIndex, dynamicGateWidth);

    // Adaptive sub-step interpolation based on speed
    const subSteps = Math.max(6, Math.min(16, Math.round(speedKmh / 5)));
    const subPoints = interpolateSubPoints(this.lastPoint, currentPoint, subSteps);

    let detectedFraction: number | null = null;
    let detectedSubIndex = 0;

    for (let step = 0; step < subPoints.length - 1; step++) {
      const intersect = checkLineIntersection(
        subPoints[step],
        subPoints[step + 1],
        gate[0],
        gate[1],
        trackHeading
      );

      if (intersect && intersect.isForward) {
        detectedFraction = intersect.fraction;
        detectedSubIndex = step;
        break;
      }
    }

    if (detectedFraction !== null) {
      const now = Date.now();
      if (now - this.lastGateCrossTime < 1800) return; // Prevent double trigger

      this.lastGateCrossTime = now;
      const subFraction = (detectedSubIndex + detectedFraction) / subSteps;
      const exactTimestamp = this.lastTime + subFraction * (rawTime - this.lastTime);

      if (this.nextGateIndex === 0) {
        // Flying start: crossing start gate arming lap 1
        this.state.lapStartTime = exactTimestamp;
        this.state.lapStartTimeLocal = performance.now();
        this.nextGateIndex = 1;
      } else if (this.state.lapStartTime !== null) {
        const elapsed = Math.max(0, exactTimestamp - this.state.lapStartTime);
        this.state.sectorTimes.push(elapsed);

        const hasS1 = this.gates.length > 2;
        const hasS2 = this.gates.length > 3;

        if (this.nextGateIndex === 1 && hasS1) {
          this.state.s1Time = elapsed;
          if (this.onSector) this.onSector(1, elapsed);
        } else if (this.nextGateIndex === 2 && hasS2) {
          const s2Split = elapsed - this.state.sectorTimes[0];
          this.state.s2Time = s2Split;
          if (this.onSector) this.onSector(2, s2Split);
        }

        const isFinishGate = this.nextGateIndex === this.gates.length - 1;
        if (isFinishGate) {
          const totalTime = elapsed;
          if (hasS1) {
            const lastSectorBoundary = hasS2 ? this.state.sectorTimes[1] : this.state.sectorTimes[0];
            this.state.s3Time = Math.max(0, totalTime - lastSectorBoundary);
          }

          if (this.bestLap?.lapTime) {
            this.state.delta = totalTime - this.bestLap.lapTime;
          } else {
            this.state.delta = 0;
          }

          if (this.onLapFinish) {
            this.onLapFinish({
              lapNumber: this.state.lapNumber,
              lapTime: totalTime,
              s1: hasS1 ? this.state.sectorTimes[0] : undefined,
              s2: hasS2 ? this.state.sectorTimes[1] - this.state.sectorTimes[0] : undefined,
              s3: hasS1
                ? totalTime - (hasS2 ? this.state.sectorTimes[1] : this.state.sectorTimes[0])
                : undefined,
              topSpeed: Math.round(this.state.maxSpeed * 10) / 10,
              maxLeanAngle: this.state.maxLeanAngle,
              maxGForce: Number(this.state.maxGForce.toFixed(2)),
              timestamp: Date.now(),
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
