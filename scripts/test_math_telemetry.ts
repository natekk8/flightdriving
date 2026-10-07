import assert from 'node:assert';
import {
  getDistanceMeters,
  calculateCumulativeDistances,
  getTrackLengthMeters,
  isClosedCircuit,
  getTrackHeading,
  generateGateLine,
  checkLineIntersection,
  calculateTrackProgress,
  calculateTrackCorners,
  GPSKalmanFilter,
  type Point,
} from '../src/lib/math.ts';

console.log('🧪 Starting FlightDriving Telemetry & Mathematics Test Suite...');

// 1. Distance Calculation (Haversine)
{
  const p1: Point = { lat: 52.0, lon: 21.0 };
  const p2: Point = { lat: 52.0, lon: 21.01 }; // ~685 meters east
  const dist = getDistanceMeters(p1, p2);
  assert(dist > 600 && dist < 750, `Distance should be ~685m, got ${dist}`);
  console.log(`✓ getDistanceMeters: ${dist.toFixed(2)}m (expected ~686m)`);
}

// 2. Track Cumulative Distances & Length
{
  const testTrack: Point[] = [
    { lat: 52.0, lon: 21.0 },
    { lat: 52.001, lon: 21.0 }, // ~111m North
    { lat: 52.001, lon: 21.001 }, // ~68m East
    { lat: 52.0, lon: 21.001 }, // ~111m South
    { lat: 52.0, lon: 21.0 }, // ~68m West (Closed loop)
  ];

  const totalLen = getTrackLengthMeters(testTrack);
  assert(totalLen > 300 && totalLen < 400, `Track length should be ~360m, got ${totalLen}`);
  console.log(`✓ getTrackLengthMeters: ${totalLen}m`);

  const cumDists = calculateCumulativeDistances(testTrack);
  assert(cumDists.length === 5, 'Should have 5 cumulative points');
  assert(cumDists[0] === 0, 'Start point distance should be 0');
  assert(Math.round(cumDists[cumDists.length - 1]) === totalLen, 'Final distance matches total');
  console.log(`✓ calculateCumulativeDistances: [${cumDists.map((d) => Math.round(d)).join(', ')}]`);

  const closed = isClosedCircuit(testTrack);
  assert(closed === true, 'Test track should be detected as closed circuit');
  console.log('✓ isClosedCircuit: detected loop successfully');
}

// 3. Track Heading & Perpendicular Gate Generation
{
  const straightNorthTrack: Point[] = [
    { lat: 52.0, lon: 21.0 },
    { lat: 52.01, lon: 21.0 },
    { lat: 52.02, lon: 21.0 },
  ];

  const headingNorth = getTrackHeading(straightNorthTrack, 1);
  assert(Math.abs(headingNorth - 0) < 1 || Math.abs(headingNorth - 360) < 1, `Heading North should be ~0 deg, got ${headingNorth}`);
  console.log(`✓ getTrackHeading: ${headingNorth.toFixed(1)}°`);

  const gate = generateGateLine(straightNorthTrack, 1, 40);
  const gateWidth = getDistanceMeters(gate[0], gate[1]);
  assert(Math.abs(gateWidth - 40) < 2, `Gate width should be 40m, got ${gateWidth.toFixed(2)}m`);
  console.log(`✓ generateGateLine width: ${gateWidth.toFixed(2)}m (expected 40m)`);

  // Gate for North-bound track should be East-West oriented (roughly same latitude, different longitude)
  assert(Math.abs(gate[0].lat - gate[1].lat) < 0.0001, 'Gate line should be horizontal for vertical track');
  console.log('✓ generateGateLine perpendicularity confirmed');
}

// 4. Directional Line Intersection Check (Forward vs Backward)
{
  const gateA: Point = { lat: 52.01, lon: 20.9995 };
  const gateB: Point = { lat: 52.01, lon: 21.0005 };
  const trackHeadingNorth = 0; // degrees

  // Forward crossing (South to North)
  const forwardCrossStart: Point = { lat: 52.009, lon: 21.0 };
  const forwardCrossEnd: Point = { lat: 52.011, lon: 21.0 };

  const forwardResult = checkLineIntersection(
    forwardCrossStart,
    forwardCrossEnd,
    gateA,
    gateB,
    trackHeadingNorth
  );

  assert(forwardResult !== null, 'Forward crossing should intersect');
  assert(forwardResult?.isForward === true, 'Forward crossing should have isForward = true');
  assert(Math.abs(forwardResult.fraction - 0.5) < 0.05, `Fraction should be ~0.5, got ${forwardResult?.fraction}`);
  console.log(`✓ checkLineIntersection (Forward): crossed at fraction ${forwardResult.fraction.toFixed(3)}, isForward=${forwardResult.isForward}`);

  // Backward crossing (North to South)
  const backwardCrossStart: Point = { lat: 52.011, lon: 21.0 };
  const backwardCrossEnd: Point = { lat: 52.009, lon: 21.0 };

  const backwardResult = checkLineIntersection(
    backwardCrossStart,
    backwardCrossEnd,
    gateA,
    gateB,
    trackHeadingNorth
  );

  assert(backwardResult !== null, 'Backward trajectory intersects line geometrically');
  assert(backwardResult?.isForward === false, 'Backward crossing should be rejected (isForward = false)');
  console.log(`✓ checkLineIntersection (Backward): correctly rejected with isForward=${backwardResult?.isForward}`);

  // Parallel trajectory (No intersection)
  const parallelStart: Point = { lat: 52.009, lon: 21.005 };
  const parallelEnd: Point = { lat: 52.011, lon: 21.005 };
  const noIntersect = checkLineIntersection(parallelStart, parallelEnd, gateA, gateB, trackHeadingNorth);
  assert(noIntersect === null, 'Parallel outside trajectory should not intersect');
  console.log('✓ checkLineIntersection (Missed gate): null as expected');
}

// 5. Arc-Length Track Progress
{
  const path: Point[] = [
    { lat: 52.0, lon: 21.0 },
    { lat: 52.005, lon: 21.0 },
    { lat: 52.01, lon: 21.0 },
  ];

  const midPoint: Point = { lat: 52.005, lon: 21.0 };
  const progress = calculateTrackProgress(midPoint, path);
  assert(Math.abs(progress.progressRatio - 0.5) < 0.05, `Progress should be ~0.5, got ${progress.progressRatio}`);
  console.log(`✓ calculateTrackProgress: ratio=${progress.progressRatio.toFixed(3)}, distance=${progress.distanceMeters}m`);
}

// 6. Corner Detection
{
  const chicaneTrack: Point[] = [
    { lat: 52.0, lon: 21.0 },
    { lat: 52.001, lon: 21.0 },
    { lat: 52.001, lon: 21.002 }, // 90 degree sharp right
    { lat: 52.002, lon: 21.002 }, // 90 degree sharp left
  ];

  const corners = calculateTrackCorners(chicaneTrack);
  assert(corners.length === 2, `Should detect 2 corners, found ${corners.length}`);
  console.log(`✓ calculateTrackCorners: detected ${corners.length} corners (${corners.map((c) => `${c.label} ${c.angleDegrees}°`).join(', ')})`);
}

// 7. Kalman Filter Stability
{
  const filter = new GPSKalmanFilter();
  const t0 = 1000;
  filter.process(52.0001, 21.0001, 10, t0);
  filter.process(52.0002, 21.0002, 5, t0 + 1000);
  const fix3 = filter.process(52.0003, 21.0003, 3, t0 + 2000);

  assert(typeof fix3.lat === 'number' && typeof fix3.lon === 'number', 'Kalman should produce valid coordinates');
  console.log(`✓ GPSKalmanFilter: filtered position (${fix3.lat.toFixed(6)}, ${fix3.lon.toFixed(6)})`);
}

console.log('\n🎉 ALL 7 TEST SUITES PASSED FLAWLESSLY!');
