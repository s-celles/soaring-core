// ============ convergence lines: lift where the low-level wind piles up ============
// Wind deflected by terrain converges at valley heads, bowls and terrain confluences
// facing the flow, and diverges in the lee — real, often strong, lift/sink that slope
// lift misses (slope lift ∝ terrain gradient; convergence ∝ terrain *curvature*). We
// deflect a uniform background wind around the DEM (remove its into-slope component),
// then take the horizontal divergence of that field. Convergence = −divergence.
//
// The lake/sea breeze rides on the same field: on a sunny day the cool water and warm
// land drive a breeze from water to land, converging just inland of the shore and
// sinking over the water. It is modelled from the curvature of a smoothed water-cover
// field — which the kernel takes as *data*, never fetching it.
//
// Rough and illustrative (see the docs), but a value: no renderer, no app state.
import { sampleNodes, boxBlur, nodeStep, medianElev, referenceWind, type NodeGrid, type TerrainCell } from './grid';
import type { ElevSampler, WindProfile } from '../ports';

export const GB = 110;          // terrain-gradient baseline (m)
export const ALPHA = 0.85;      // how strongly terrain blocks the into-slope wind component
export const CONV_MIN = 0.05;   // min |normalised divergence| worth reporting
export const CONV_FRAC: readonly [number, number] = [0.12, 0.22];   // strength strata boundaries (3 per side)
export const LB_GAIN = 2.5;     // lake-breeze convergence gain (× insolation × water-field curvature)
export const LB_BLUR = 5;       // cells: blur radius of the water field → how far the breeze reaches inland
export const LB_WATER = 0.12;   // land-cover sensible fraction below this ⇒ a water cell
const WIND_MIN = 1.5;           // m/s: below this, only a shoreline can make convergence

export interface ConvergParams {
  /** Daytime heating, 0..1 — see core/lift/ridge's insolation(). 0 ⇒ no lake breeze. */
  insol: number;
  /** Sensible-heat fraction per node (j * n + i), from a land-cover raster. Null ⇒ no
   *  water mask available, so no lake breeze. The kernel never fetches it. */
  water: Float32Array | null;
  gb?: number; alpha?: number; convMin?: number;
  lbGain?: number; lbBlur?: number; lbWater?: number;
}

/** A cell of ground with the normalised convergence over it: dimensionless, the fraction
 *  of the wind lost per cell, so it does not change with the view. Positive = rising. */
export interface ConvCell extends TerrainCell { c: number }

/** `wind` is the reference wind the whole field was deflected by — the one over the TYPICAL
 *  ground in view, reported so a caller can key a cache on it. `refElev` is the ground it was
 *  read at. The wind is deliberately UNIFORM here: the field takes the DIVERGENCE of the
 *  deflected flow, and a wind that varied with the terrain height would inject a divergence of
 *  its own — one that is an artefact of terrain-following sampling, not a fact about the air. */
export interface ConvergField {
  grid: NodeGrid; cells: ConvCell[]; ready: number; total: number;
  refElev: number | null; wind: [number, number];
}

/** Can there be convergence here at all? A calm day with no shoreline has neither a flow
 *  to deflect nor a heating contrast to drive one. Cheap enough to ask before any terrain work. */
export function convergActive(wind: readonly [number, number], hasWater: boolean): boolean {
  return Math.hypot(wind[0], wind[1]) >= WIND_MIN || hasWater;
}

export function convergField(
  g: NodeGrid, elev: ElevSampler, windProfile: WindProfile, p: ConvergParams,
): ConvergField {
  const gb = p.gb ?? GB, alpha = p.alpha ?? ALPHA, convMin = p.convMin ?? CONV_MIN;
  const lbGain = p.lbGain ?? LB_GAIN, lbBlur = p.lbBlur ?? LB_BLUR, lbWater = p.lbWater ?? LB_WATER;
  const n = g.n, total = n * n;
  const breeze = p.insol > 0 && p.water ? p.water : null;

  const t = sampleNodes(g, elev, gb);
  const { ok, h, gx, gy, lon, lat, sp } = t;

  // The wind over the typical ground in view — not over the pixel under the camera. See
  // referenceWind: reading it there swung the wind by a factor of 3 and flipped this field's
  // gate on and off as the view panned.
  const refElev = medianElev(t);
  const wind = referenceWind(refElev, windProfile);
  const spd = Math.hypot(wind[0], wind[1]);
  if (!convergActive(wind, !!breeze)) return { grid: g, cells: [], ready: 0, total, refElev, wind };

  // Pass 1: deflect the wind around the terrain (remove its into-slope component) — a
  // planar slope just turns the flow, but where slopes *converge* the flow decelerates.
  const U = new Float32Array(total), V = new Float32Array(total);
  for (let idx = 0; idx < total; idx++) {
    if (!ok[idx]) continue;
    const g2 = gx[idx] * gx[idx] + gy[idx] * gy[idx];
    const proj = g2 > 1e-9 ? (wind[0] * gx[idx] + wind[1] * gy[idx]) / g2 : 0;   // V·ĝ / |g|
    const kk = proj > 0 ? alpha * proj : 0;                                      // remove the uphill inflow only
    U[idx] = wind[0] - kk * gx[idx]; V[idx] = wind[1] - kk * gy[idx];
  }

  // Pass 2: horizontal divergence, normalised (dimensionless: fraction of the wind lost
  // per cell) so it is view-independent. Convergence = −divergence.
  const norm = sp / Math.max(spd, 1), invS = 1 / (2 * sp);
  const Cn = new Float32Array(total).fill(NaN);
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const idx = j * n + i;
    if (!ok[idx] || !ok[idx + 1] || !ok[idx - 1] || !ok[idx + n] || !ok[idx - n]) continue;
    const div = (U[idx + 1] - U[idx - 1]) * invS + (V[idx + n] - V[idx - n]) * invS;   // ∂u/∂x + ∂v/∂y
    Cn[idx] = -div * norm;
  }

  // Lake/sea breeze: curvature of a smoothed water-cover field → convergence (lift) just
  // inland of the shore, subsidence over the water; scaled by insolation, damped by wind.
  if (breeze) {
    const wm = new Float32Array(total);
    for (let idx = 0; idx < total; idx++) wm[idx] = breeze[idx] < lbWater ? 1 : 0;
    const wS = boxBlur(wm, n, lbBlur);
    const damp = Math.max(0.2, Math.min(1, 1 - (spd - 3) / 9));   // strong synoptic wind washes the breeze out
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const idx = j * n + i; if (!ok[idx]) continue;
      const lap = wS[idx + 1] + wS[idx - 1] + wS[idx + n] + wS[idx - n] - 4 * wS[idx];   // land-side shore: +, over water: −
      Cn[idx] = (Number.isNaN(Cn[idx]) ? 0 : Cn[idx]) + lbGain * p.insol * damp * lap;
    }
  }

  // Pass 3: light 3×3 blur (curvature is noisier than gradient), then keep what is worth drawing.
  const cells: ConvCell[] = [];
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    let s = 0, m = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const v = Cn[(j + dj) * n + (i + di)]; if (!Number.isNaN(v)) { s += v; m++; }
    }
    if (!m) continue;
    const c = s / m;
    if (Math.abs(c) < convMin) continue;
    const idx = j * n + i;
    cells.push({ lon: lon[i], lat: lat[j], elev: h[idx], gx: gx[idx], gy: gy[idx], c });
  }
  return { grid: g, cells, ready: t.ready, total, refElev, wind };
}

/** Node spacing of the field's grid — the layer needs it to size its patches. */
export { nodeStep };
