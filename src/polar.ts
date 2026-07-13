// ============ glider polar + netto vario ============
// A glider's still-air sink rate follows the physical two-term polar
//     w(V) = A·V³ + B/V          (parasitic drag ∝ V³, induced drag ∝ 1/V)
// obtained from the drag power balance W·w = D·V. We least-squares fit A and B to the
// three (speed, sink) points of the polar. From it we get the NETTO vario — the vertical
// velocity of the air mass — by removing the glider's own sink from the (total-energy) climb:
//     netto = Vz,TE − sink_polar(V)      (sink_polar < 0, so netto = Vz,TE + |sink|)
// Polars can be imported as XCSoar/LK8000 `.plr` files. A rough diagnostic: OGN gives no
// airspeed, so we substitute GPS ground speed (biased by wind/turns) — see the docs.
// The reference glider (ASK 21) ships as a bundled `.plr` under data/polars/, parsed here
// through the very same path a user import takes.
/// <reference path="./plr.d.ts" />
// The triple-slash is load-bearing, not decoration: an ambient module declaration is only
// seen by a compiler that has been told to load the file, and nothing IMPORTS a .d.ts. Inside
// this package tsconfig's `include` picks it up; inside a CONSUMER's node_modules it would not,
// and the consumer's typecheck fails on this very import. The reference makes it travel.
import ask21Plr from '../data/polars/ASK 21.plr' with { type: 'text' };

export interface Polar { name: string; A: number; B: number; vMin: number; vMax: number }

const VMIN = 15, VMAX = 60;   // m/s: clamp airspeed to the polar's sensible range (~54–216 km/h)

// Least-squares fit of  w = A·x + B·y  with x = V³, y = 1/V, over the (V, sink) points.
function fit(pts: [number, number][]): { A: number; B: number } {
  let sxx = 0, sxy = 0, syy = 0, sxw = 0, syw = 0;
  for (const [v, w] of pts) {
    const x = v * v * v, y = 1 / v;
    sxx += x * x; sxy += x * y; syy += y * y; sxw += x * w; syw += y * w;
  }
  const det = sxx * syy - sxy * sxy;
  if (!det) return { A: 0, B: 0 };
  return { A: (sxw * syy - syw * sxy) / det, B: (sxx * syw - sxy * sxw) / det };
}
/** The flight envelope a polar is clamped to. It is a property of the WING, not a constant of the
 *  library — and treating it as a constant is a bug real data found.
 *
 *  A `.plr` carries no envelope, so [VMIN, VMAX] is the sensible default FOR A GLIDER. But the
 *  polar files in circulation also describe paragliders and hang gliders, and a paraglider's
 *  FASTEST measured point (≈ 44 km/h) is slower than a glider's SLOWEST (54 km/h). Clamped into
 *  the glider envelope, every speed such a wing is asked about comes back as 54 km/h — faster
 *  than it can fly — and `sinkAt` does not fail: it answers, confidently, a number that is wrong.
 *  Everything downstream (speed to fly, best glide, the reach polygon) then inherits it.
 *
 *  So: when the whole measured range lies BELOW the glider envelope, the wing is not a glider and
 *  its own points define its envelope. A glider's polar is untouched — its points sit inside
 *  [15, 60] and the default stands. */
function envelope(speedsMs: number[]): { vMin: number; vMax: number } {
  const lo = Math.min(...speedsMs), hi = Math.max(...speedsMs);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi >= VMIN) return { vMin: VMIN, vMax: VMAX };
  // A little either side of what was measured: a wing flies slightly slower and slightly faster
  // than the three points someone happened to record.
  return { vMin: Math.max(1, lo * 0.85), vMax: hi * 1.15 };
}

// Build a polar from three (speed km/h, sink m/s ≤ 0) points.
function make(name: string, pts: [number, number][]): Polar {
  const ms = pts.map(([v, s]) => [v / 3.6, s > 0 ? -s : s] as [number, number]);
  return { name, ...fit(ms), ...envelope(ms.map(([v]) => v)) };
}

/** The reference glider (ASK 21), from the bundled data/polars/ASK 21.plr. */
export const DEFAULT_POLAR: Polar =
  parsePlr(ask21Plr, 'ASK 21') ?? make('ASK 21', [[100, -0.82], [120, -1.10], [150, -1.9]]);

/** Still-air sink (m/s, negative) at true airspeed V (m/s), clamped to the polar's range. */
export function sinkAt(pl: Polar, vMs: number): number {
  const v = Math.max(pl.vMin, Math.min(pl.vMax, vMs));
  return pl.A * v * v * v + pl.B / v;
}
/** Netto (air vertical velocity, m/s): the total-energy climb minus the glider's own sink. */
export function nettoAt(pl: Polar, teVario: number, vMs: number): number {
  return teVario - sinkAt(pl, vMs);
}

/** The glider's minimum sink (m/s, negative) — its sink at the min-sink (circling) speed,
 *  the vertex of A·V³ + B/V at V = (B/3A)^¼. Used for the super/relative netto. */
export function minSink(pl: Polar): number {
  const r = pl.B / (3 * pl.A);
  let v = Number.isFinite(r) && r > 0 ? Math.pow(r, 0.25) : NaN;
  if (!Number.isFinite(v)) {   // degenerate fit: scan for the least-negative sink
    let best = -Infinity;
    for (let x = pl.vMin; x <= pl.vMax; x += 1) { const s = pl.A * x * x * x + pl.B / x; if (s > best) { best = s; v = x; } }
  }
  return sinkAt(pl, v);
}
/** Super (relative) netto (m/s): the climb the glider would get circling in this air —
 *  the netto reduced by the glider's own minimum (circling) sink. */
export function superNettoAt(pl: Polar, teVario: number, vMs: number): number {
  return nettoAt(pl, teVario, vMs) + minSink(pl);   // minSink < 0 → subtracts the circling sink
}

/** Parse an XCSoar/LK8000 `.plr` polar: a line
 *  `MassDryGross, MaxWaterBallast, Speed1, Sink1, Speed2, Sink2, Speed3, Sink3, WingArea`
 *  (comment lines start with `*`). Returns null if no usable line is found. */
export function parsePlr(text: string, name: string): Polar | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('*') || line.startsWith('#') || line.startsWith(';')) continue;
    const n = line.split(',').map(s => parseFloat(s.trim()));
    if (n.length < 8 || n.slice(2, 8).some(x => !Number.isFinite(x))) continue;
    return make(name, [[n[2], n[3]], [n[4], n[5]], [n[6], n[7]]]);
  }
  return null;
}

/** The same glider at a different all-up mass — the classic mass scaling of a polar (CFG-002).
 *
 *  A heavier glider flies the SAME aerodynamic curve, only faster and sinking faster in the same
 *  proportion: with k = √(m/m₀), every point (V, w) of the polar moves to (k·V, k·w). Its glide
 *  ratio at each corresponding point is therefore UNCHANGED — ballast buys speed, not performance,
 *  and a pilot who reads a better L/D after taking water has been told something false.
 *
 *  Pushing (kV, kw) through w(V) = A·V³ + B/V gives A' = A/k² and B' = B·k², and the usable speed
 *  band stretches by k with the curve — a ballasted glider does not fly the empty one's stall speed.
 *
 *  A mass nobody could have meant — zero, negative, NaN — is not an adjustment, so the polar comes
 *  back untouched rather than silently disfigured. There is no such thing as a glider of mass 0,
 *  and the answer to being asked for one is not a polar of infinite performance.
 *
 *  This lives in the kernel, not in an app, because it is the same algebra as sinkAt() and it is
 *  the same algebra for every flight computer ever written on this library. */
export function atMass(p: Polar, refMassKg: number, massKg: number): Polar {
  if (!Number.isFinite(massKg) || massKg <= 0) return p;
  if (!Number.isFinite(refMassKg) || refMassKg <= 0) return p;
  const k = Math.sqrt(massKg / refMassKg);
  return { name: p.name, A: p.A / (k * k), B: p.B * k * k, vMin: p.vMin * k, vMax: p.vMax * k };
}
