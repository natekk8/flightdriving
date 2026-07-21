type Point = { lat: number; lon: number };

// Helper to convert lat/lon to meters approximately
function toRad(val: number) { return val * Math.PI / 180; }

// Distance in meters between two lat/lon coordinates
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

// Calculate dynamic gate width (meters) based on speed and GPS accuracy
export function getDynamicGateWidth(speedKmh: number, gpsAccuracyMeters = 10): number {
  const baseWidth = 35;
  const speedBonus = Math.min(speedKmh * 0.4, 20); // expand up to +20m for high speeds
  const accuracyBonus = Math.min(gpsAccuracyMeters * 0.5, 15); // expand up to +15m for low accuracy
  return Math.min(baseWidth + speedBonus + accuracyBonus, 70);
}

// Sub-samples a straight trajectory between two points for high-precision gate collision
export function interpolateSubPoints(p1: Point, p2: Point, steps = 5): Point[] {
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
  
  // Perpendicular vector in meters
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
    { lat: p1.lat - latOffset, lon: p1.lon - lonOffset }
  ];
}

export function checkLineIntersection(p1: Point, p2: Point, gateA: Point, gateB: Point): number | null {
  const x1 = p1.lon; const y1 = p1.lat;
  const x2 = p2.lon; const y2 = p2.lat;
  const x3 = gateA.lon; const y3 = gateA.lat;
  const x4 = gateB.lon; const y4 = gateB.lat;

  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (denom === 0) return null;

  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

  if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
    return ua; // Fraction 0..1 representing when exactly the line was crossed
  }
  return null;
}

// Calculate progress (0.0 to 1.0) along a track path for live ghost delta
export function calculateTrackProgress(point: Point, path: Point[]): { progressRatio: number; nearestIndex: number } {
  if (!path || path.length < 2) return { progressRatio: 0, nearestIndex: 0 };
  
  let minDistance = Infinity;
  let nearestIndex = 0;

  for (let i = 0; i < path.length; i++) {
    const dist = getDistanceMeters(point, path[i]);
    if (dist < minDistance) {
      minDistance = dist;
      nearestIndex = i;
    }
  }

  const progressRatio = nearestIndex / (path.length - 1);
  return { progressRatio, nearestIndex };
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

    if (angleDeg > 15) { // Only detect noticeable direction changes
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

// Kalman Filter for GPS Smoothing
export class GPSKalmanFilter {
  private minAccuracy = 1;
  private qMetresPerSecond = 3; // Noise per second
  private timestampMs = 0;
  private lat = 0;
  private lng = 0;
  private variance = -1;

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
        this.variance += timeIncMs * this.qMetresPerSecond * this.qMetresPerSecond / 1000;
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

