// A lee wave is a resonance: a stable airstream crossing a ridge oscillates downwind at
// λ = 2π·U/N. That is a closed-form claim, so these tests make the model prove it — put an
// analytic ridge in an analytic wind and measure the wavelength that comes out, check the
// air upwind of the ridge is undisturbed (a wave is a *lee* phenomenon), and watch the
// train decay downwind. No app state, no DEM tiles, no renderer.
import { test, expect } from 'bun:test';
import {
  waveField, waveResonance, rotorSpots, scorerL2, ETA_MAX, ROTOR_W, ROTOR_MAX,
  MIN_NODES_PER_WAVELENGTH, SCORER_DZ, FROUDE_MAX,
} from './wave';
import { nodeStep, WIND_ALT, type NodeGrid } from './grid';
import { M_PER_LAT, mPerLng } from '../geo';
import type { ElevSampler, WindProfile } from '../ports';

const G: NodeGrid = { cLon: 6, cLat: 45, R: 20000, n: 80 };
const SP = nodeStep(G);               // ≈ 506 m — the grid's own node spacing
const mLng = mPerLng(G.cLat);
const east = (lon: number) => (lon - G.cLon) * mLng;

const flat: ElevSampler = () => 1000;
/** A north–south ridge (invariant along y), Gaussian across the flow, centred at x = x0. */
const ridge = (h: number, L: number, x0: number): ElevSampler =>
  (lon) => 1000 + h * Math.exp(-((east(lon) - x0) ** 2) / (2 * L * L));

const WEST_WIND = [15, 0] as const;   // 15 m/s towards the east
const N_STABLE = 0.011;               // 1/s — a stable airstream
const RIDGE_X = -8000;                // the ridge sits upwind of the domain centre
const RES = waveResonance(WEST_WIND, N_STABLE, SP)!;
/** A wind that is the same at every height. */
const uniform = (u: number, v: number) => () => [u, v] as [number, number];
const WIND = uniform(15, 0);

/** The field along the centre row (y ≈ 0), west to east. */
const profile = (f: ReturnType<typeof waveField>) => {
  const j = Math.round((G.n - 1) / 2);
  return Array.from({ length: G.n }, (_, i) => ({
    x: east(f.lon[i]), w: f.w[j * G.n + i], eta: f.eta[j * G.n + i],
  }));
};
/** Where a profile crosses zero, downwind of the ridge. */
const zeros = (prof: { x: number; w: number }[], from: number) => {
  const zs: number[] = [];
  for (let i = 1; i < prof.length; i++) {
    const a = prof[i - 1].w, b = prof[i].w;
    if (prof[i].x > from && a * b < 0)
      zs.push(prof[i - 1].x + (prof[i].x - prof[i - 1].x) * Math.abs(a) / (Math.abs(a) + Math.abs(b)));
  }
  return zs;
};

// ---- the resonance gate ----

test('the Scorer relation: λ = 2π·U/N', () => {
  expect(RES.lambda).toBeCloseTo(2 * Math.PI * 15 / N_STABLE, 6);
  expect(RES.l).toBeCloseTo(N_STABLE / 15, 9);
});

test('no wave without wind, without stability, or at an implausible wavelength', () => {
  expect(waveResonance([6, 0], N_STABLE, SP)).toBeNull();      // too little wind to force one
  expect(waveResonance([15, 0], 0.005, SP)).toBeNull();        // neutral air: nothing to oscillate
  expect(waveResonance([7, 0], 0.03, SP)).toBeNull();          // λ ≈ 1.5 km — below even a fine mesh's floor
  expect(waveResonance([35, 0], 0.0061, SP)).toBeNull();       // λ ≈ 36 km — too long to be real
  expect(waveResonance([15, 0], N_STABLE, SP)).not.toBeNull();
});

// ---- REQ-W-01: the short end of the plausible band comes from the MESH, not a fixed constant ----

test('a wavelength that only spans a handful of nodes is rejected as aliased', () => {
  // wind=15, N=0.02 → λ ≈ 4712 m. On a 1000 m mesh that is under 6 nodes/λ: reject.
  // On a 200 m mesh the same physical wave spans over 20 nodes: resolve it.
  const N = 0.02, lambda = 2 * Math.PI * 15 / N;
  expect(lambda / 1000).toBeLessThan(MIN_NODES_PER_WAVELENGTH);
  expect(waveResonance([15, 0], N, 1000)).toBeNull();
  expect(waveResonance([15, 0], N, 200)).not.toBeNull();
});

test('the mesh-derived floor is exactly MIN_NODES_PER_WAVELENGTH × spacing', () => {
  const spacing = 640;   // the viewer's own NODE_M
  const floor = MIN_NODES_PER_WAVELENGTH * spacing;
  // N picked so the boundary wind U clears WIND_MIN — the wavelength floor is the only gate
  // separating the two cases below, not the wind-speed one.
  const N = 0.02, U = N * floor / (2 * Math.PI);
  expect(U).toBeGreaterThan(7);
  expect(waveResonance([U * 0.999, 0], N, spacing)).toBeNull();       // just under the floor
  expect(waveResonance([U * 1.05, 0], N, spacing)).not.toBeNull();    // comfortably over it
});

test('a finer node grid resolves a shorter wavelength end-to-end through waveField', () => {
  const N = 0.02;   // λ ≈ 4712 m with the 15 m/s test wind
  const coarse: NodeGrid = { cLon: 6, cLat: 45, R: 20000, n: 21 };    // 2000 m spacing → 6 nodes/λ ≈ 2357 m, too coarse
  const fine: NodeGrid = { cLon: 6, cLat: 45, R: 20000, n: 200 };     // ≈ 201 m spacing → plenty of nodes/λ
  const fc = waveField(coarse, ridge(600, 1200, RIDGE_X), WIND, { N });
  const ff = waveField(fine, ridge(600, 1200, RIDGE_X), WIND, { N });
  expect(fc.res).toBeNull();
  expect(ff.res).not.toBeNull();
});

// ---- REQ-W-02: the full Scorer parameter l² = N²/U² − (1/U)·d²U/dz² ----

test('scorerL2: falls back to N²/U² when the curvature is unknown, and flags it degraded', () => {
  const { l2, degraded } = scorerL2(0.011, 15, null);
  expect(l2).toBeCloseTo((0.011 * 0.011) / (15 * 15), 12);
  expect(degraded).toBe(true);
});

test('scorerL2: a known curvature shifts l² away from N²/U², and is not degraded', () => {
  const N = 0.011, U = 15, d2Udz2 = 2e-6;   // wind accelerating upward
  const { l2, degraded } = scorerL2(N, U, d2Udz2);
  expect(degraded).toBe(false);
  expect(l2).toBeCloseTo((N * N) / (U * U) - d2Udz2 / U, 12);
  expect(l2).toBeLessThan((N * N) / (U * U));   // positive curvature here REDUCES l²
});

test('curvature strong enough leaves no oscillatory solution: waveResonance returns null', () => {
  const N = 0.011, U = 15;
  const overwhelming = ((N * N) / (U * U)) * U * 2;   // d2Udz2/U alone exceeds N²/U²
  expect(waveResonance([U, 0], N, 100, overwhelming)).toBeNull();
  expect(waveResonance([U, 0], N, 100, 0)).not.toBeNull();   // curvature exactly 0 behaves like N/U
});

test('waveField: a curved wind profile is not degraded, and l² matches the finite-difference formula', () => {
  const c = 2e-6;   // U(z) = 15 + c·z² → curvature exactly 2c everywhere, no truncation error
  const curved: WindProfile = (alt) => [15 + c * alt * alt, 0];
  const f = waveField(G, ridge(600, 1200, RIDGE_X), curved, { N: N_STABLE });
  expect(f.res).not.toBeNull();
  expect(f.res!.degraded).toBe(false);
  const refAlt = f.refElev! + WIND_ALT;
  const [uLo] = curved(refAlt - SCORER_DZ)!, [uHi] = curved(refAlt + SCORER_DZ)!, [U] = curved(refAlt)!;
  const d2Udz2 = (uLo - 2 * U + uHi) / (SCORER_DZ * SCORER_DZ);
  const expectedL2 = (N_STABLE * N_STABLE) / (U * U) - d2Udz2 / U;
  expect(f.res!.l * f.res!.l).toBeCloseTo(expectedL2, 9);
  expect(expectedL2).toBeLessThan((N_STABLE * N_STABLE) / (U * U));   // the curvature term bit in
});

test('waveField: a wind profile with no vertical structure has a known, zero curvature — not degraded', () => {
  const f = waveField(G, ridge(600, 1200, RIDGE_X), WIND, { N: N_STABLE });   // uniform(15, 0)
  expect(f.res!.degraded).toBe(false);   // curvature IS known here — it is exactly zero, not unknown
  expect(f.res!.l).toBeCloseTo(N_STABLE / 15, 9);   // and a zero curvature reduces to plain N/U
});

// ---- REQ-W-03: trapped (l² decreasing with height) vs vertically-propagating regime ----

test('wind strengthening with height traps the wave: l² decreases aloft', () => {
  const strengthening: WindProfile = (alt) => [8 + 0.004 * (alt - 1400), 0];   // 8 → 18 m/s over TRAP_DZ
  const f = waveField(G, flat, strengthening, { N: N_STABLE });
  expect(f.trapped).toBe(true);
});

test('wind weakening with height does not trap: l² does not decrease aloft', () => {
  const weakening: WindProfile = (alt) => [20 - 0.001 * (alt - 1400), 0];      // 20 → 17.5 m/s
  const f = waveField(G, flat, weakening, { N: N_STABLE });
  expect(f.trapped).toBe(false);
});

test('no wind data above the reference altitude: trapped is null, not a guess', () => {
  const shallow: WindProfile = (alt) => (alt <= 2000 ? [15, 0] : null);   // sounding tops out early
  const f = waveField(G, flat, shallow, { N: N_STABLE });
  expect(f.trapped).toBeNull();
});

test('reversed flow aloft (a critical layer) leaves trapped null, not a false answer', () => {
  const reversing: WindProfile = (alt) => [alt < 2500 ? 15 : -5, 0];
  const f = waveField(G, flat, reversing, { N: N_STABLE });
  expect(f.trapped).toBeNull();
});

test('trapped describes the atmosphere, independent of whether the wave itself gates open', () => {
  const strengthening: WindProfile = (alt) => [8 + 0.004 * (alt - 1400), 0];
  const f = waveField(G, flat, strengthening, { N: 0.003 });   // N below N_MIN: no wave at all
  expect(f.res).toBeNull();
  expect(f.trapped).toBe(true);   // yet the wind-only trapping diagnostic still resolves
});

// ---- the wave itself ----

test('flat ground makes no wave, however stable and windy the air', () => {
  const f = waveField(G, flat, WIND, { N: N_STABLE });
  expect(f.ready).toBeGreaterThan(0);   // the ground IS loaded — there is simply nothing to force it
  expect(Array.from(f.w).every(v => v === 0)).toBe(true);
  expect(Array.from(f.eta).every(v => v === 0)).toBe(true);
});

test('the air upwind of the ridge is undisturbed — the wave is a LEE phenomenon', () => {
  const prof = profile(waveField(G, ridge(600, 1200, RIDGE_X), WIND, { N: N_STABLE }));
  // Well upwind of the ridge (more than a couple of ridge-widths), nothing is moving.
  for (const p of prof.filter(p => p.x < RIDGE_X - 4000)) {
    expect(Math.abs(p.w)).toBeLessThan(0.01);
    expect(Math.abs(p.eta)).toBeLessThan(1);
  }
});

test('downwind of the ridge the flow oscillates at exactly the resonant wavelength', () => {
  const prof = profile(waveField(G, ridge(600, 1200, RIDGE_X), WIND, { N: N_STABLE }));
  const zs = zeros(prof, RIDGE_X);
  expect(zs.length).toBeGreaterThanOrEqual(4);   // several crests and troughs in the domain
  // Successive zero crossings of a sinusoid are half a wavelength apart. The tolerance is
  // the grid itself: at 506 m node spacing a crossing is only located to about ±250 m.
  const gaps = zs.slice(1).map((z, i) => z - zs[i]);
  for (const gap of gaps) expect(Math.abs(gap - RES.lambda / 2) / (RES.lambda / 2)).toBeLessThan(0.06);
});

test('a shorter wavelength comes out of a stronger stability', () => {
  // λ = 2π·U/N: double N, halve λ — the wave train packs together.
  const soft = waveResonance(WEST_WIND, 0.008, SP)!, hard = waveResonance(WEST_WIND, 0.016, SP)!;
  expect(hard.lambda).toBeCloseTo(soft.lambda / 2, 6);
  const zsSoft = zeros(profile(waveField(G, ridge(600, 1200, RIDGE_X), WIND, { N: 0.008 })), RIDGE_X);
  const zsHard = zeros(profile(waveField(G, ridge(600, 1200, RIDGE_X), WIND, { N: 0.016 })), RIDGE_X);
  expect(zsHard.length).toBeGreaterThan(zsSoft.length);   // more crests fit in the same domain
});

test('the wave train decays downwind', () => {
  const prof = profile(waveField(G, ridge(600, 1200, RIDGE_X), WIND, { N: N_STABLE }));
  // Peak |w| in the first wavelength after the ridge, versus two wavelengths further out.
  const peak = (a: number, b: number) =>
    Math.max(...prof.filter(p => p.x >= a && p.x < b).map(p => Math.abs(p.w)));
  const near = peak(RIDGE_X, RIDGE_X + RES.lambda);
  const far = peak(RIDGE_X + 2 * RES.lambda, RIDGE_X + 3 * RES.lambda);
  expect(far).toBeLessThan(near);
});

test('a taller ridge drives a stronger wave', () => {
  const small = profile(waveField(G, ridge(300, 1200, RIDGE_X), WIND, { N: N_STABLE }));
  const big = profile(waveField(G, ridge(900, 1200, RIDGE_X), WIND, { N: N_STABLE }));
  const amp = (prof: { x: number; w: number }[]) => Math.max(...prof.map(p => Math.abs(p.w)));
  expect(amp(big)).toBeGreaterThan(amp(small));
});

// ---- REQ-W-08: linear theory does not apply once N·h/U (inverse Froude) gets too large ----

test('a mountain far taller than N/U can support closes the gate', () => {
  // N=0.011, U=15 → the Froude limit is at a ridge height of U·FROUDE_MAX/N ≈ 1364 m.
  const tooTall = waveField(G, ridge(2000, 800, RIDGE_X), WIND, { N: N_STABLE });   // ≈2000 m ridge
  expect(tooTall.res).toBeNull();
  expect(Array.from(tooTall.w).every(v => v === 0)).toBe(true);
});

test('the same tall ridge is fine again once the wind is strong enough to lower N·h/U', () => {
  const strongerWind = uniform(40, 0);   // N·h/U ≈ 0.011·2000/40 ≈ 0.55, comfortably under FROUDE_MAX
  const f = waveField(G, ridge(2000, 800, RIDGE_X), strongerWind, { N: N_STABLE });
  expect(f.res).not.toBeNull();
});

test('the gate sits at N·h/U = FROUDE_MAX, not at some other ad-hoc height', () => {
  const U = 15, h = (U * FROUDE_MAX) / N_STABLE;   // the ridge height that puts N·h/U at the limit
  const justUnder = waveField(G, ridge(h * 0.9, 800, RIDGE_X), uniform(U, 0), { N: N_STABLE });
  const justOver = waveField(G, ridge(h * 1.15, 800, RIDGE_X), uniform(U, 0), { N: N_STABLE });
  expect(justUnder.res).not.toBeNull();
  expect(justOver.res).toBeNull();
});

test('the streamline displacement is clamped, so the stacked sheets can never cross', () => {
  // A steep ridge (same h/L ratio as the old "absurd" 3000/1200, scaled down to stay inside
  // FROUDE_MAX — REQ-W-08 now closes the gate on a ridge that tall at this N and wind).
  const f = waveField(G, ridge(1200, 480, RIDGE_X), WIND, { N: N_STABLE });
  expect(f.res).not.toBeNull();
  for (const v of f.eta) expect(Math.abs(v)).toBeLessThanOrEqual(ETA_MAX);
  expect(Math.max(...Array.from(f.eta))).toBeCloseTo(ETA_MAX, 6);   // and it does reach the clamp
});

test('w and η are a quarter wave out of phase — where the air rises fastest it has risen least', () => {
  // w is the sine of the response, η the cosine. A quarter-wave shift makes them orthogonal
  // over the wave train, which is the robust way to state it: their correlation is ~0 while
  // each correlates perfectly with itself. Run without the clamp, so the phase is visible.
  const f = waveField(G, ridge(600, 1200, RIDGE_X), WIND, { N: N_STABLE, etaGain: 10, etaMax: 1e9 });
  const lee = profile(f).filter(p => p.x > RIDGE_X);
  const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
  const W = lee.map(p => p.w), E = lee.map(p => p.eta);
  const corr = dot(W, E) / Math.sqrt(dot(W, W) * dot(E, E));
  expect(Math.abs(corr)).toBeLessThan(0.2);   // orthogonal: a quarter wave apart
});

// ---- the rotor under the crests ----

test('rotors roll only under strong crests, thinned and capped', () => {
  const f = waveField(G, ridge(600, 1200, RIDGE_X), WIND, { N: N_STABLE });
  const spots = rotorSpots(f);
  expect(spots.length).toBeGreaterThan(0);
  expect(spots.length).toBeLessThanOrEqual(ROTOR_MAX);
  expect(rotorSpots(waveField(G, flat, WIND, { N: N_STABLE }))).toEqual([]);   // no wave, no rotor
  // Every spot sits on the ground it was found over, and grows with its crest.
  for (const s of spots) {
    expect(s.elev).toBeGreaterThan(0);
    expect(s.size).toBeGreaterThanOrEqual(320);
    expect(s.size).toBeLessThanOrEqual(700);
  }
});

test('the cap holds even when a single row is full of crests', () => {
  // A long ridge across the flow puts a strong crest in every column, so one row alone can
  // fill the quota. The cap has to be honoured per spot, not per row. (Same h/L ratio as
  // before, scaled down to stay inside FROUDE_MAX — REQ-W-08.)
  const f = waveField(G, ridge(1300, 2600, RIDGE_X), WIND, { N: N_STABLE });
  expect(f.res).not.toBeNull();
  expect(rotorSpots(f, 1, 5).length).toBe(5);        // thinning off: every node qualifies
  expect(rotorSpots(f, 1, 1).length).toBe(1);
});

test('a weak wave spins no rotor', () => {
  const f = waveField(G, ridge(600, 1200, RIDGE_X), WIND, { N: N_STABLE, amp: 0.01 });
  expect(Math.max(...Array.from(f.w))).toBeLessThan(ROTOR_W);
  expect(rotorSpots(f)).toEqual([]);
});

// ---- the field must say "I could not look", not "there is nothing here" ----

test('the wind that forces the wave is read over the TYPICAL ground, not under the camera', () => {
  // A ridge in a wind that strengthens with height. On real terrain, reading the wind at the
  // pixel under the camera gave 3.9 m/s where the median ground gave 10.6 — one side of
  // WIND_MIN, then the other. The wave layer literally appeared and vanished as the view panned.
  const sheared = (alt: number) => [alt / 150, 0] as [number, number];   // 0 at sea level, +6.7 m/s per km
  const f = waveField(G, ridge(600, 1200, RIDGE_X), sheared, { N: N_STABLE });
  expect(f.refElev).not.toBeNull();
  expect(f.wind[0]).toBeCloseTo((f.refElev! + 400) / 150, 6);   // the profile, at the median + WIND_ALT
  expect(f.res).not.toBeNull();                                  // and it is enough to make wave
  // The same terrain in a wind read 400 m lower down would be under WIND_MIN and make none.
  expect(Math.hypot(...(f.wind))).toBeGreaterThan(7);
});

test('no resonance means an empty field, not a crash', () => {
  const f = waveField(G, ridge(600, 1200, RIDGE_X), uniform(3, 0), { N: N_STABLE });   // too little wind
  expect(f.res).toBeNull();
  expect(Array.from(f.w).every(v => v === 0)).toBe(true);
  expect(rotorSpots(f)).toEqual([]);
});

test('unloaded terrain reports zero ready nodes, so the caller knows not to trust the calm', () => {
  const f = waveField(G, () => null, WIND, { N: N_STABLE });
  expect(f.ready).toBe(0);
  expect(f.total).toBe(G.n * G.n);
  expect(Array.from(f.w).every(v => v === 0)).toBe(true);
});
