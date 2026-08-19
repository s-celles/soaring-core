// ============ lee waves (mountain wave / onde): resonant lift downwind of ridges ======
// When a stable airstream crosses a ridge with enough wind, it oscillates downwind as a
// standing wave: smooth lift in the crests, sink in the troughs, at the wavelength
//   λ = 2π·U / N                (U = cross-ridge wind, N = Brunt–Väisälä frequency)
// We take the terrain forcing along the wind (w₀ = wind·∇terrain) and convolve the UPWIND
// profile with a decaying sinusoid at the resonant wavenumber l = N/U — a linear,
// illustrative lee-wave response. It yields, per node, the vertical velocity w (sin) and
// the streamline displacement η (cos, a quarter-wave out of phase).
//
// The wave is an ELEVATED phenomenon: nothing here is draped on the ground, and nothing
// here draws. Rough (see the docs), but a value.
import { sampleNodes, medianElev, referenceWind, WIND_ALT, type NodeGrid } from './grid';
import type { ElevSampler, WindProfile } from '../ports';

export const GB = 140;          // terrain-gradient baseline (m)
export const WIND_MIN = 7;      // m/s: weakest cross-ridge wind that makes wave (~25 km/h)
export const N_MIN = 0.006;     // 1/s: weakest stability that makes wave
// A resonant sinusoid sampled on a lattice needs several nodes per wavelength or it aliases —
// at 3 nodes/λ the "wave" the field draws is a sampling artefact, not the sin() it computes.
// So the SHORT end of the plausible band is derived from the caller's own mesh, not fixed: a
// fine grid can resolve a shorter λ, a coarse one cannot, whatever LAMBDA_MIN used to say.
export const MIN_NODES_PER_WAVELENGTH = 6;
export const LAMBDA_MAX = 35000;   // m: plausible lee-wave wavelengths — an upper sanity bound only
export const AMP = 1.6;         // display gain on the vertical-velocity (w) response
export const ETA_GAIN = 320;    // gain on the streamline vertical displacement η (m)
export const ETA_MAX = 260;     // m: clamp η so sheets never cross
// Rotor: a turbulent low-level roll beneath the wave crests (the hazard under the smooth wave).
export const ROTOR_W = 0.9;     // m/s: crest updraft strong enough to spin a rotor beneath it
export const ROTOR_THIN = 5, ROTOR_MAX = 48;   // thinning bucket + cap for rotor puffs
// REQ-W-02: the full Scorer parameter needs the CURVATURE of the along-wind speed with height,
// estimated as a centred finite difference over ±SCORER_DZ around the altitude asked about.
export const SCORER_DZ = 500;   // m: half-step of the curvature finite difference
// REQ-W-03: trapping is read off how l² changes between the ridge-top reference altitude and
// a band TRAP_DZ higher — roughly the depth the stacked wave sheets occupy.
export const TRAP_DZ = 2500;    // m: separation between the two altitudes compared for trapping
// REQ-W-08: linear lee-wave theory is a small-amplitude approximation — it assumes the ridge is
// modest next to N/U. Nh/U (the inverse Froude number) is the standard way to size that: past
// about 1, the atmosphere starts breaking waves, blocking the flow low down, or forming a
// hydraulic jump — exactly the violent regime a pilot most wants to know about, and exactly what
// a linear response cannot represent. FROUDE_MAX gates the field shut there rather than draw a
// smooth sheet over what is actually a rotor-and-breaking day.
export const FROUDE_MAX = 1.0;

/** The resonant response of a stable airstream to a ridge: the Scorer wavenumber l and the
 *  wavelength λ = 2π/l it sets. `degraded` is true when l came from the simplified l = N/U
 *  (the curvature term d²U/dz² could not be estimated — REQ-W-02) rather than the full
 *  l² = N²/U² − (1/U)·d²U/dz². */
export interface Resonance { l: number; lambda: number; degraded: boolean }

/** The Scorer parameter l² at one altitude: N²/U² if the curvature is unknown (`d2Udz2 ===
 *  null`), else the exact l² = N²/U² − (1/U)·d²U/dz². `degraded` flags the fallback. */
export function scorerL2(N: number, U: number, d2Udz2: number | null): { l2: number; degraded: boolean } {
  const l2 = d2Udz2 == null ? (N * N) / (U * U) : (N * N) / (U * U) - d2Udz2 / U;
  return { l2, degraded: d2Udz2 == null };
}

/** Is there a lee wave at all, and at what wavelength? Null when the wind is too weak to
 *  force one, the air too neutral to oscillate, the curvature term leaves no oscillatory
 *  solution (l² ≤ 0), or the resulting wavelength is implausible — including too short for
 *  `nodeSpacingM` to resolve without aliasing (REQ-W-01). Cheap enough to ask before
 *  touching the terrain. `d2Udz2` is optional: omit it (or pass null) for the simplified
 *  l = N/U, degraded-flagged (REQ-W-02). */
export function waveResonance(
  wind: readonly [number, number], N: number, nodeSpacingM: number, d2Udz2: number | null = null,
): Resonance | null {
  const spd = Math.hypot(wind[0], wind[1]);
  if (spd < WIND_MIN) return null;          // too little wind → no wave
  if (!(N > N_MIN)) return null;            // neutral / unstable → nothing to oscillate
  const { l2, degraded } = scorerL2(N, spd, d2Udz2);
  if (!(l2 > 0)) return null;               // curvature overwhelms N²/U² → no oscillatory solution
  const l = Math.sqrt(l2), lambda = 2 * Math.PI / l;
  const lambdaMin = MIN_NODES_PER_WAVELENGTH * nodeSpacingM;
  if (lambda < lambdaMin || lambda > LAMBDA_MAX) return null;
  return { l, lambda, degraded };
}

/** The along-wind speed component at `alt` (projected on the unit vector `dir`), and its
 *  vertical curvature by a centred finite difference over ±SCORER_DZ. Null (whole result,
 *  or just the curvature) wherever `windProfile` has no answer — an unknown layer is never
 *  guessed at. */
function alongWind(
  windProfile: WindProfile, alt: number, dirE: number, dirN: number,
): { U: number; d2Udz2: number | null } | null {
  const c = windProfile(alt); if (!c) return null;
  const U = c[0] * dirE + c[1] * dirN;
  const lo = windProfile(alt - SCORER_DZ), hi = windProfile(alt + SCORER_DZ);
  const d2Udz2 = lo && hi
    ? ((lo[0] * dirE + lo[1] * dirN) - 2 * U + (hi[0] * dirE + hi[1] * dirN)) / (SCORER_DZ * SCORER_DZ)
    : null;
  return { U, d2Udz2 };
}

/** REQ-W-03: is the regime trapped (l² decreasing with height — the classic condition for a
 *  resonant lee-wave cavity) or vertically propagating (l² flat or increasing)? Null when
 *  either altitude's l² cannot be pinned down (no profile data, or no oscillatory solution
 *  there) — an honest "don't know", not a guess at either regime.
 *
 *  N is treated as constant across the two altitudes: the sounding gives one representative
 *  stability for the layer above the ridges (REQ-W-06 note), so the vertical structure this
 *  test can see comes from the WIND profile's curvature alone. That is the classic textbook
 *  trapping mechanism (wind strengthening with height) and it is what the data actually
 *  supports — see Limitations. */
function trappedRegime(
  windProfile: WindProfile, refAlt: number, dirE: number, dirN: number, N: number,
): boolean | null {
  const lo = alongWind(windProfile, refAlt, dirE, dirN);
  const hi = alongWind(windProfile, refAlt + TRAP_DZ, dirE, dirN);
  if (!lo || !hi || hi.U <= 0.5) return null;   // missing data, or reversed/calm flow aloft (critical layer)
  const lo2 = scorerL2(N, lo.U, lo.d2Udz2).l2, hi2 = scorerL2(N, hi.U, hi.d2Udz2).l2;
  if (!(lo2 > 0) || !(hi2 > 0)) return null;
  return hi2 < lo2;
}

export interface WaveParams {
  /** Brunt–Väisälä frequency (1/s) from the sounding. The RESONANCE is not passed in: it depends
   *  on the wind, and the right wind depends on the terrain, which only this function has. */
  N: number;
  gb?: number; amp?: number; etaGain?: number; etaMax?: number;
}

/** The wave, per node of the lattice (indexed j * n + i): the vertical velocity `w` (m/s)
 *  and the streamline displacement `eta` (m). `h` and `maxTerr` come along because the
 *  sheets are stacked above the highest ridge and the rotor sits just above the ground. */
export interface WaveField {
  grid: NodeGrid;
  /** Null when there is no wave: too little wind to force one, air too neutral, no
   *  oscillatory solution, or an implausible wavelength. The field is then empty. */
  res: Resonance | null;
  /** REQ-W-03: trapped (stacked sheets share one η), vertically propagating (phase tilts,
   *  amplitude decays with height), or null — the regime could not be determined, and the
   *  renderer must say so rather than default to either. Independent of `res`: it describes
   *  the atmosphere, not whether the wind/λ gates happened to pass. */
  trapped: boolean | null;
  refElev: number | null; wind: [number, number];
  lon: Float64Array; lat: Float64Array;                     // node coordinates, by i and by j
  w: Float32Array; eta: Float32Array; h: Float32Array; ok: Uint8Array;
  maxTerr: number; ready: number; total: number;
}

export function waveField(
  g: NodeGrid, elev: ElevSampler, windProfile: WindProfile, p: WaveParams,
): WaveField {
  const gb = p.gb ?? GB, amp = p.amp ?? AMP;
  const etaGain = p.etaGain ?? ETA_GAIN, etaMax = p.etaMax ?? ETA_MAX;
  const n = g.n, total = n * n;

  // Pass 1: terrain forcing along the wind, w₀ = wind·∇terrain (m/s), per node; and the
  // highest ridge, so the elevated sheets can sit above the terrain — and so REQ-W-08 can
  // size the ridge BEFORE deciding whether linear theory still applies to it.
  const t = sampleNodes(g, elev, gb);
  const { ok, h, gx, gy, sp, lon, lat } = t;
  let maxTerr = -Infinity;
  for (let idx = 0; idx < total; idx++) if (ok[idx] && h[idx] > maxTerr) maxTerr = h[idx];

  // The wind that crosses the RIDGES, read over the typical ground in view. Reading it under
  // the camera swung it by a factor of 3 on real terrain — enough to put the wind on either
  // side of WIND_MIN, so the wave appeared and vanished as the view was panned.
  const refElev = medianElev(t);
  const wind = referenceWind(refElev, windProfile);
  const spd0 = Math.hypot(wind[0], wind[1]);

  // REQ-W-02/03: the curvature of U(z) at the reference altitude (feeds the full Scorer l²),
  // and the trapping test (l² a couple of km higher, same direction — see trappedRegime).
  let d2Udz2: number | null = null, trapped: boolean | null = null;
  if (refElev != null && spd0 > 0) {
    const dirE = wind[0] / spd0, dirN = wind[1] / spd0, refAlt = refElev + WIND_ALT;
    d2Udz2 = alongWind(windProfile, refAlt, dirE, dirN)?.d2Udz2 ?? null;
    trapped = trappedRegime(windProfile, refAlt, dirE, dirN, p.N);
  }

  let res = waveResonance(wind, p.N, t.sp, d2Udz2);
  // REQ-W-08: linear lee-wave theory assumes a MODEST mountain — it has nothing honest to say
  // once Nh/U (the inverse Froude number) gets large: that is exactly where the real atmosphere
  // starts breaking waves, blocking the flow, or forming a hydraulic jump, which is precisely
  // what a pilot needs to know about and what this linear response cannot represent. Close the
  // gate rather than draw a smooth sheet over a day that is actually violent.
  if (res && refElev != null && spd0 > 0) {
    const ridgeHeight = Math.max(0, maxTerr - refElev);
    if ((p.N * ridgeHeight) / spd0 > FROUDE_MAX) res = null;
  }
  const empty = (): WaveField => ({
    grid: g, res: null, trapped, refElev, wind, lon, lat,
    w: new Float32Array(total), eta: new Float32Array(total), h, ok,
    maxTerr: -Infinity, ready: t.ready, total,
  });
  if (!res) return empty();
  const { l, lambda } = res;
  const spd = spd0;
  const F = new Float32Array(total);
  for (let idx = 0; idx < total; idx++) {
    if (!ok[idx]) continue;
    F[idx] = wind[0] * gx[idx] + wind[1] * gy[idx];
  }

  // Pass 2: convolve the UPWIND forcing with a decaying resonant kernel — the vertical
  // velocity w (sin) for the colour, and the displacement η (cos, a quarter-wave out of
  // phase) for the ripple. Looking only upwind is what makes the wave a *lee* phenomenon.
  const uE = -wind[0] / spd, uN = -wind[1] / spd;                    // upwind unit vector
  const Ld = 2.5 * lambda, Lmax = Math.min(3 * lambda, g.R * 1.7), stepM = lambda / 9;
  const w = new Float32Array(total), eta = new Float32Array(total);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const idx = j * n + i; if (!ok[idx]) continue;
    let ws = 0, we = 0;
    for (let s = stepM; s <= Lmax; s += stepM) {
      const si = Math.round(i + uE * s / sp), sj = Math.round(j + uN * s / sp);
      if (si < 0 || si >= n || sj < 0 || sj >= n) break;
      const fi = sj * n + si; if (!ok[fi]) continue;
      const dec = Math.exp(-s / Ld);
      ws += F[fi] * Math.sin(l * s) * dec; we += F[fi] * Math.cos(l * s) * dec;
    }
    w[idx] = ws * amp * stepM / lambda;
    eta[idx] = Math.max(-etaMax, Math.min(etaMax, we * etaGain * stepM / lambda));
  }
  return { grid: g, res, trapped, refElev, wind, lon, lat, w, eta, h, ok, maxTerr, ready: t.ready, total };
}

/** REQ-W-07: this is NOT a rotor-detection model — there is no boundary-layer separation
 *  criterion here, nothing about the low-level wind shear a real rotor needs to spin up. It
 *  is a graphical placement rule: a fixed height band (ROTOR_HGT) under nodes whose crest
 *  updraft clears ROTOR_W, which the resonant decay happens to concentrate under the first
 *  crest downwind — where a rotor most often IS, in the textbook picture. Treat it as an
 *  indicative hazard marker ("expect turbulence near here on a wave day"), not a computed
 *  rotor location; the caller (viewer UI and docs) must say so. Positions and sizes only —
 *  what to draw there is the renderer's business. */
export interface RotorSpot { lon: number; lat: number; elev: number; size: number }

export function rotorSpots(f: WaveField, thin = ROTOR_THIN, max = ROTOR_MAX): RotorSpot[] {
  const { n } = f.grid;
  const out: RotorSpot[] = [], occ = new Set<string>();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (out.length >= max) return out;   // per spot, not per row: one crest-filled row can fill the quota alone
    const idx = j * n + i;
    if (!f.ok[idx] || f.w[idx] < ROTOR_W) continue;
    const bk = `${(i / thin) | 0},${(j / thin) | 0}`;
    if (occ.has(bk)) continue;
    occ.add(bk);
    out.push({
      lon: f.lon[i], lat: f.lat[j], elev: f.h[idx],
      size: 320 + Math.min(1, (f.w[idx] - ROTOR_W) / 1.5) * 380,
    });
  }
  return out;
}
