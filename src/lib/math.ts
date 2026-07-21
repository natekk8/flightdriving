type Point = { lat: number; lon: number };

// Helper to convert lat/lon to meters approximately
function toRad(val: number) { return val * Math.PI / 180; }

// Generates a perpendicular gate line (width in meters) at a specific point on the path
export function generateGateLine(path: Point[], index: number, widthMeters = 40): [Point, Point] {
  if (path.length < 2) return [path[0], path[0]];
  
  let p1 = path[index];
  let p0 = index > 0 ? path[index - 1] : p1;
  let p2 = index < path.length - 1 ? path[index + 1] : p1;
  
  // Calculate average direction
  let dx = p2.lon - p0.lon;
  let dy = p2.lat - p0.lat;
  
  // Perpendicular vector
  let px = -dy;
  let py = dx;
  
  // Normalize
  let len = Math.sqrt(px*px + py*py);
  if (len === 0) return [p1, p1];
  px /= len;
  py /= len;
  
  // Convert width to lat/lon offsets roughly
  // 1 degree lat = 111320 meters
  // 1 degree lon = 40075000 * cos(lat) / 360 meters
  const latOffset = (widthMeters / 2) / 111320;
  const lonOffset = (widthMeters / 2) / (111320 * Math.cos(toRad(p1.lat)));
  
  return [
    { lat: p1.lat + py * latOffset, lon: p1.lon + px * lonOffset },
    { lat: p1.lat - py * latOffset, lon: p1.lon - px * lonOffset }
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
