// The polar is what a MacCready solver, a speed-to-fly director and a final glide are computed
// from. Get it wrong and every one of them is wrong — plausibly, and in silence.
import { test, expect } from 'bun:test';
import { DEFAULT_POLAR, parsePlr, sinkAt, minSink, nettoAt } from './polar';

test('the reference glider loads from its own bundled .plr', () => {
  expect(DEFAULT_POLAR.name).toBe('ASK 21');
  const s = -sinkAt(DEFAULT_POLAR, 30);              // 108 km/h
  expect(s).toBeGreaterThan(0.5);
  expect(s).toBeLessThan(2);
});

test('netto is the air, not the glider: it removes the glider\'s own sink', () => {
  const v = 30;
  expect(nettoAt(DEFAULT_POLAR, 0, v)).toBeCloseTo(-sinkAt(DEFAULT_POLAR, v), 9);
  expect(minSink(DEFAULT_POLAR)).toBeLessThan(0);    // sink is negative, always
});

// ---- the envelope belongs to the WING, not to the library ----

test('a glider keeps the standard envelope: its points sit inside it', () => {
  // The ASK 21's points are 100/120/150 km/h — comfortably inside [54, 216] km/h.
  expect(DEFAULT_POLAR.vMin).toBe(15);
  expect(DEFAULT_POLAR.vMax).toBe(60);
});

test('a paraglider gets its OWN envelope — a glider\'s would ask it to fly faster than it can', () => {
  // A real row from the LK8000 polar library (soaring-data): "Para EN A-DHV1", whose FASTEST
  // measured point is 44 km/h — slower than a glider's SLOWEST (54 km/h). Clamped into the glider
  // envelope, EVERY speed it was asked about came back as 54 km/h, and sinkAt did not fail: it
  // ANSWERED, with a speed the wing cannot fly and a sink that followed from it. Speed-to-fly,
  // best glide and the reach polygon all inherited the number.
  const para = parsePlr('90,0,25,-1.1,35,-1.3,44,-2.0,25', 'Para EN A-DHV1')!;
  expect(para.vMax).toBeLessThan(15);                // it is never asked to fly at 54 km/h
  expect(para.vMax).toBeGreaterThan(44 / 3.6);       // …and its own fastest point IS inside its range
  expect(para.vMin).toBeLessThan(25 / 3.6);          // …as is its slowest

  const s = -sinkAt(para, para.vMax);                // a paraglider's sink, not a clamped glider's
  expect(s).toBeGreaterThan(0.5);
  expect(s).toBeLessThan(8);
});
