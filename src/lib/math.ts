export type Point = { lat: number; lon: number };

// Helper to convert lat/lon to radians
export function toRad(val: number): number {
  return (val * Math.PI) / 180;
}

// Helper to convert radians to degrees
export function toDeg(val: number): number {
  return (val * 180) / Math.PI;
}

// Distance in meters between two lat/lon coordinates (Haversine formula)
export function getDistanceMeters(p1: Point, p2: Point): number {
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(p2.lat - p1.lat);
  const dLon = toRad(p2.lon - p1.lon);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Cumulative distance along a polyline path
export function calculateCumulativeDistances(path: Point[]): number[] {
  if (!path || path.length === 0) return [0];
  const dists = [0];
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    acc += getDistanceMeters(path[i - 1], path[i]);
    dists.push(acc);
  }
  return dists;
}

// Total track length in meters
export function getTrackLengthMeters(path: Point[]): number {
  if (!path || path.length < 2) return 0;
  let len = 0;
  for (let i = 0; i < path.length - 1; i++) {
    len += getDistanceMeters(path[i], path[i + 1]);
  }
  return Math.round(len);
}

// Checks if a track path forms a closed loop
export function isClosedCircuit(path: Point[], thresholdMeters = 40): boolean {
  if (!path || path.length < 3) return false;
  return getDistanceMeters(path[0], path[path.length - 1]) <= thresholdMeters;
}

// Calculate dynamic gate width (meters) based on speed and GPS accuracy
export function getDynamicGateWidth(speedKmh: number, gpsAccuracyMeters = 10): number {
  const baseWidth = 35;
  const speedBonus = Math.min(speedKmh * 0.4, 25); // expand up to +25m for high speeds
  const accuracyBonus = Math.min(gpsAccuracyMeters * 0.6, 20); // expand up to +20m for low accuracy
  return Math.min(baseWidth + speedBonus + accuracyBonus, 80);
}

// Sub-samples a trajectory between two points for high-precision gate collision
export function interpolateSubPoints(p1: Point, p2: Point, steps = 8): Point[] {
  if (steps <= 1) return [p1, p2];
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({
      lat: p1.lat + t * (p2.lat - p1.lat),
      lon: p1.lon + t * (p2.lon - p1.lon),
    });
  }
  return points;
}

// Calculates track heading at given path index (degrees 0..360)
export function getTrackHeading(path: Point[], index: number): number {
  if (!path || path.length < 2) return 0;
  const safeIdx = Math.max(0, Math.min(index, path.length - 1));
  const p0 = safeIdx > 0 ? path[safeIdx - 1] : path[safeIdx];
  const p1 = safeIdx < path.length - 1 ? path[safeIdx + 1] : path[safeIdx];

  const y = Math.sin(toRad(p1.lon - p0.lon)) * Math.cos(toRad(p1.lat));
  const x =
    Math.cos(toRad(p0.lat)) * Math.sin(toRad(p1.lat)) -
    Math.sin(toRad(p0.lat)) * Math.cos(toRad(p1.lat)) * Math.cos(toRad(p1.lon - p0.lon));
  const bearing = (toDeg(Math.atan2(y, x)) + 360) % 360;
  return bearing;
}

// Generates a perpendicular gate line (width in meters) at a specific point on the path
export function generateGateLine(path: Point[], index: number, widthMeters = 40): [Point, Point] {
  if (!path || path.length < 2) {
    const fallback = path && path[0] ? path[0] : { lat: 0, lon: 0 };
    return [fallback, fallback];
  }

  const safeIndex = Math.max(0, Math.min(index ?? 0, path.length - 1));
  const p1 = path[safeIndex];
  const p0 = safeIndex > 0 ? path[safeIndex - 1] : p1;
  const p2 = safeIndex < path.length - 1 ? path[safeIndex + 1] : p1;

  const cosLat = Math.cos(toRad(p1.lat));

  // Tangent vector in approximate meters
  const dxMeters = (p2.lon - p0.lon) * 111320 * cosLat;
  const dyMeters = (p2.lat - p0.lat) * 111320;

  // Perpendicular vector in meters (90 deg counter-clockwise)
  const pxMeters = -dyMeters;
  const pyMeters = dxMeters;

  // Normalize
  const len = Math.sqrt(pxMeters * pxMeters + pyMeters * pyMeters);
  if (len === 0) return [p1, p1];

  const pxNorm = pxMeters / len;
  const pyNorm = pyMeters / len;

  const halfWidth = widthMeters / 2;
  const latOffset = (pyNorm * halfWidth) / 111320;
  const lonOffset = (pxNorm * halfWidth) / (111320 * cosLat);

  return [
    { lat: p1.lat + latOffset, lon: p1.lon + lonOffset },
    { lat: p1.lat - latOffset, lon: p1.lon - lonOffset },
  ];
}

// Result of line intersection check with forward direction validation
export interface IntersectionResult {
  fraction: number; // 0..1 along p1->p2
  isForward: boolean; // true if heading aligns with track direction
}

// Line segment intersection with directional dot-product check
export function checkLineIntersection(
  p1: Point,
  p2: Point,
  gateA: Point,
  gateB: Point,
  trackHeadingDeg?: number
): IntersectionResult | null {
  const x1 = p1.lon;
  const y1 = p1.lat;
  const x2 = p2.lon;
  const y2 = p2.lat;
  const x3 = gateA.lon;
  const y3 = gateA.lat;
  const x4 = gateB.lon;
  const y4 = gateB.lat;

  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (denom === 0) return null;

  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

  if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
    let isForward = true;

    // If track heading is provided, verify trajectory is going in the forward direction
    if (trackHeadingDeg !== undefined) {
      const travelHeading =
        (toDeg(Math.atan2(x2 - x1, (y2 - y1) * Math.cos(toRad((y1 + y2) / 2)))) + 360) % 360;
      let angleDiff = Math.abs(travelHeading - trackHeadingDeg);
      if (angleDiff > 180) angleDiff = 360 - angleDiff;
      // Heading difference within 90 degrees means forward direction
      isForward = angleDiff <= 95;
    }

    return { fraction: ua, isForward };
  }
  return null;
}

// Calculate accurate arc-length progress (0.0 to 1.0) along a track path
export function calculateTrackProgress(
  point: Point,
  path: Point[],
  cumulativeDists?: number[]
): { progressRatio: number; nearestIndex: number; distanceMeters: number } {
  if (!path || path.length < 2) {
    return { progressRatio: 0, nearestIndex: 0, distanceMeters: 0 };
  }

  const dists = cumulativeDists || calculateCumulativeDistances(path);
  const totalDist = dists[dists.length - 1];
  if (totalDist === 0) return { progressRatio: 0, nearestIndex: 0, distanceMeters: 0 };

  let minDistance = Infinity;
  let nearestIndex = 0;

  for (let i = 0; i < path.length; i++) {
    const dist = getDistanceMeters(point, path[i]);
    if (dist < minDistance) {
      minDistance = dist;
      nearestIndex = i;
    }
  }

  // Refine projection onto adjacent segment (before or after nearest point)
  let projectedDist = dists[nearestIndex];

  if (nearestIndex < path.length - 1 && nearestIndex > 0) {
    const prevPt = path[nearestIndex - 1];
    const currPt = path[nearestIndex];
    const nextPt = path[nearestIndex + 1];

    const dPrev = getDistanceMeters(point, prevPt);
    const dNext = getDistanceMeters(point, nextPt);

    if (dNext < dPrev) {
      // Closer towards next point
      const segLen = getDistanceMeters(currPt, nextPt);
      if (segLen > 0) {
        const offset = Math.min(segLen, Math.max(0, (segLen * segLen + minDistance * minDistance - dNext * dNext) / (2 * segLen)));
        projectedDist += offset;
      }
    } else {
      // Closer towards previous point
      const segLen = getDistanceMeters(prevPt, currPt);
      if (segLen > 0) {
        const offset = Math.min(segLen, Math.max(0, (segLen * segLen + minDistance * minDistance - dPrev * dPrev) / (2 * segLen)));
        projectedDist -= (segLen - offset);
      }
    }
  }

  const clampedDist = Math.max(0, Math.min(projectedDist, totalDist));
  const progressRatio = clampedDist / totalDist;

  return { progressRatio, nearestIndex, distanceMeters: clampedDist };
}

// Corner severity detector for track layout analysis
export type CornerInfo = {
  index: number;
  angleDegrees: number;
  severity: 'hairpin' | 'sharp' | 'medium' | 'gentle' | 'straight';
  label: string;
};

export function calculateTrackCorners(path: Point[]): CornerInfo[] {
  if (!path || path.length < 3) return [];

  const corners: CornerInfo[] = [];

  for (let i = 1; i < path.length - 1; i++) {
    const p0 = path[i - 1];
    const p1 = path[i];
    const p2 = path[i + 1];

    const v1 = { x: (p1.lon - p0.lon) * Math.cos(toRad(p1.lat)), y: p1.lat - p0.lat };
    const v2 = { x: (p2.lon - p1.lon) * Math.cos(toRad(p1.lat)), y: p2.lat - p1.lat };

    const dot = v1.x * v2.x + v1.y * v2.y;
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);

    if (mag1 === 0 || mag2 === 0) continue;

    const cosTheta = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
    const angleRad = Math.acos(cosTheta);
    const angleDeg = (angleRad * 180) / Math.PI;

    if (angleDeg > 15) {
      let severity: CornerInfo['severity'] = 'gentle';
      let label = 'Łagodny';

      if (angleDeg >= 120) {
        severity = 'hairpin';
        label = 'Nawrót 180°';
      } else if (angleDeg >= 75) {
        severity = 'sharp';
        label = 'Ostry Zakręt';
      } else if (angleDeg >= 40) {
        severity = 'medium';
        label = 'Średni Zakręt';
      }

      corners.push({
        index: i,
        angleDegrees: Math.round(angleDeg),
        severity,
        label,
      });
    }
  }

  return corners;
}

// Adaptive Kalman Filter for GPS Smoothing with speed-guided noise variance
export class GPSKalmanFilter {
  private minAccuracy = 1;
  private qMetresPerSecond = 2.5; // Adaptive process noise
  private timestampMs = 0;
  private lat = 0;
  private lng = 0;
  private variance = -1;

  public reset() {
    this.variance = -1;
    this.timestampMs = 0;
  }

  process(lat: number, lng: number, accuracy: number, timestampMs: number) {
    if (accuracy < this.minAccuracy) accuracy = this.minAccuracy;

    if (this.variance < 0) {
      this.timestampMs = timestampMs;
      this.lat = lat;
      this.lng = lng;
      this.variance = accuracy * accuracy;
    } else {
      const timeIncMs = timestampMs - this.timestampMs;
      if (timeIncMs > 0) {
        this.variance += (timeIncMs * this.qMetresPerSecond * this.qMetresPerSecond) / 1000;
        this.timestampMs = timestampMs;
      }

      const k = this.variance / (this.variance + accuracy * accuracy);
      this.lat += k * (lat - this.lat);
      this.lng += k * (lng - this.lng);
      this.variance = (1 - k) * this.variance;
    }

    return { lat: this.lat, lon: this.lng };
  }
}

