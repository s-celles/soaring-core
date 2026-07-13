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

// ---- atMass: what ballast buys, and what it does not ----

import { atMass } from './polar';

test('ballast leaves the best glide ratio EXACTLY unchanged — it buys speed, not performance', () => {
  // This is the whole physical content of the mass scaling, and the one claim a pilot could be
  // materially misled by. A ballasted glider goes further per second, not further per metre.
  const p = DEFAULT_POLAR;
  const heavy = atMass(p, 350, 500);
  const bestLd = (pl: typeof p): number => {
    let best = 0;
    for (let v = pl.vMin; v <= pl.vMax; v += 0.01) best = Math.max(best, v / -sinkAt(pl, v));
    return best;
  };
  expect(bestLd(heavy)).toBeCloseTo(bestLd(p), 3);
});

test('ballast moves the whole curve to (k·V, k·w) — the speed for best glide rises by √(m/m₀)', () => {
  const p = DEFAULT_POLAR;
  const k = Math.sqrt(500 / 350);
  const heavy = atMass(p, 350, 500);
  // Every point maps: the sink at k·V of the heavy glider is k× the sink at V of the light one.
  for (const v of [25, 30, 40]) {
    expect(sinkAt(heavy, k * v)).toBeCloseTo(k * sinkAt(p, v), 6);
  }
  expect(heavy.vMin).toBeCloseTo(p.vMin * k, 6);
  expect(heavy.vMax).toBeCloseTo(p.vMax * k, 6);
});

test('the ballasted polar CROSSES the empty one — that is the whole reason to carry water', () => {
  // Written first as "the heavy glider sinks faster at every speed", which failed. The test was
  // wrong and the algebra was right, and the difference is the point of ballast:
  //
  //   SLOW, where the induced term B/V rules, the heavy glider pays — it sinks faster, and its
  //   climb in a thermal is worse. That is the cost, and it is real.
  //   FAST, where the profile term A·V³ rules, the heavy glider WINS — at the same airspeed it
  //   sinks LESS than the empty one, and that is what buys the cross-country speed.
  //
  // The two curves therefore cross, near the best-glide speed. A flight computer that told a pilot
  // ballast is uniformly worse would be telling him not to fly the strong day.
  const p = DEFAULT_POLAR, heavy = atMass(p, 350, 500);
  expect(sinkAt(heavy, 26)).toBeLessThan(sinkAt(p, 26));     // slow: the heavy one sinks faster
  expect(sinkAt(heavy, 55)).toBeGreaterThan(sinkAt(p, 55));  // fast: the heavy one sinks LESS

  // And they cross exactly once in between — one crossing, not a curve that wanders across.
  let crossings = 0, prev = Math.sign(sinkAt(heavy, 26) - sinkAt(p, 26));
  for (let v = 26; v <= 55; v += 0.05) {
    const s = Math.sign(sinkAt(heavy, v) - sinkAt(p, v));
    if (s !== 0 && s !== prev) { crossings++; prev = s; }
  }
  expect(crossings).toBe(1);
});

test('a mass nobody could have meant returns the polar UNTOUCHED, never a disfigured one', () => {
  // There is no glider of mass 0, and the answer to being asked for one is not a polar of infinite
  // performance — which is precisely what A/k² would hand back as k → 0.
  const p = DEFAULT_POLAR;
  for (const bad of [0, -1, NaN, Infinity]) {
    expect(atMass(p, 350, bad)).toEqual(p);
    expect(atMass(p, bad, 500)).toEqual(p);
  }
});
