// ============ observed wave: the straight climbs the thermal detector throws away =======
// A thermal climb circles; a WAVE climb is smooth and nearly straight — the glider beats into
// wind, well above the ridges. The thermal detector demands a full 360° of net heading, so it
// rejects wave by construction. This is the mirror image: sustained climbs with a LOW turn
// rate and a good height above the ground.
//
// That last condition is what separates wave from a ridge beat, which is also straight and
// also climbs — but hugs the terrain. Hence AGL_MIN, and hence the elevation sampler.
//
// REQ-W-05: turn<3.2°/s, net<300°, ≥250m AGL, sustained climb — that is also exactly the
// description of an AEROTOW. On a mountain site on a wave day the old filter painted every
// tow as a wave bar, in duplicate (the tug and the glider are both tracked). Three more tests
// cut a tow out, cumulatively: a climb-rate ceiling (a tow typically climbs well above a
// sustained wave vario), a companion aircraft flying the same profile within rope distance
// (the tug), and a climb that starts near the ground and ends in a sharp drop of rate (the
// release). None of them alone is bullet-proof — a very strong wave day can climb fast, and a
// glider can rarely find wave right off a low release — so the low-start signal anchors the
// two ground-truth tests (fast-and-low, or low-and-released) while the companion-aircraft
// signal stands on its own.
import { sampleProbe, netTurn, rates, runs, mergeClimbs, type Samp } from './probe';
import { distM } from './geo';
import type { ElevSampler, Probe } from './ports';

export interface WaveClimb {
  t0: number; t1: number;
  base: number; top: number;
  strength: number;
  c: [number, number];            // centre (lon,lat)
  hdg: number;                    // mean heading (deg) — the beat direction
}

export const STEP = 4;            // resample step (s)
export const HW = 10;             // s: heading baseline half-window
export const TURN_MAX = 3.2;      // deg/s: below this the flight is "straight" (not circling)
export const CLIMB_MIN = 0.25;    // m/s: minimum sustained climb over the window
export const GAP = 30;            // s: bridge brief interruptions
export const MIN_RUN = 90;        // s: shortest wave climb kept (waves are long)
export const MIN_GAIN = 200;      // m: shortest climb kept
export const MIN_STRENGTH = 0.4;  // m/s: weakest climb kept
export const MAX_NET = 300;       // deg: net heading swept must stay below this (else it is circling)
export const AGL_MIN = 250;       // m: the top must clear the terrain by this — this is what excludes ridge beats
export const MERGE_M = 900;       // m: merge nearby climbs (same wave, several beats or gliders)
export const MAX_WAVE = 40;       // cap, strongest first

// ---- REQ-W-05: tow rejection ----
export const MAX_CLIMB = 6;         // m/s: peak climb above this reads as a tow, not a sustained wave vario
export const TOW_START_AGL = 150;   // m: a climb that begins this close to the ground reads as a takeoff
export const RELEASE_WINDOW = 40;   // s: how far past the run's end we look for the release
export const RELEASE_DROP = 1.5;    // m/s: a fall at least this big in that window reads as a release
export const TOW_PAIR_M = 150;      // m: rope-length-scale proximity to call two tracks paired
export const TOW_PAIR_FRAC = 0.6;   // fraction of the run another aircraft must shadow it for

/** Fastest instantaneous climb anywhere in [from, to] — "well above a sustained wave vario"
 *  is a PEAK test, not the run's average. */
function peakClimb(s: Samp[], from: number, to: number, g: number): number {
  let mx = 0;
  for (let i = from; i <= to; i++) mx = Math.max(mx, rates(s, i, g, STEP).climb);
  return mx;
}

/** Does the climb rate fall sharply in the RELEASE_WINDOW right after the run ends? A tow's
 *  release is abrupt; a wave climb that simply tapers off is not. False (not "no data means
 *  yes") when the probe's track does not extend far enough past the run to tell. */
function releaseDrop(s: Samp[], to: number, g: number, strength: number): boolean {
  const afterIdx = to + Math.round(RELEASE_WINDOW / STEP);
  if (afterIdx >= s.length) return false;
  const after = rates(s, afterIdx, g, STEP).climb;
  return strength - after > RELEASE_DROP;
}

function makeWave(s: Samp[], from: number, to: number, elev: ElevSampler): WaveClimb | null {
  const run = s.slice(from, to + 1);
  const t0 = run[0].t, t1 = run[run.length - 1].t, dur = t1 - t0;
  if (dur < MIN_RUN) return null;
  if (Math.abs(netTurn(run)) > MAX_NET) return null;         // really circling → not wave
  let base = Infinity, top = -Infinity, cx = 0, cy = 0, hx = 0, hy = 0;
  for (const smp of run) {
    base = Math.min(base, smp.alt); top = Math.max(top, smp.alt);
    cx += smp.lon; cy += smp.lat;
    hx += Math.sin(smp.hdg * Math.PI / 180); hy += Math.cos(smp.hdg * Math.PI / 180);
  }
  const gain = top - base; if (gain < MIN_GAIN) return null;
  const strength = gain / dur; if (strength < MIN_STRENGTH) return null;
  const c: [number, number] = [cx / run.length, cy / run.length];
  const g = elev(c[0], c[1]);
  if (g != null && top - g < AGL_MIN) return null;            // too close to the ground → a ridge beat

  // REQ-W-05: a tow starts near the ground — anchor the fast-climb and release tests on that,
  // so a genuinely high-altitude, fast, or gradually-fading wave climb is never caught by them.
  const g0 = elev(run[0].lon, run[0].lat);
  const lowStart = g0 != null && run[0].alt - g0 < TOW_START_AGL;
  if (lowStart) {
    const gw = Math.max(1, Math.round(HW / STEP));
    if (peakClimb(s, from, to, gw) > MAX_CLIMB) return null;
    if (releaseDrop(s, to, gw, strength)) return null;
  }
  return { t0, t1, base, top, strength, c, hdg: (Math.atan2(hx, hy) * 180 / Math.PI + 360) % 360 };
}

/** Every straight sustained climb in one probe (before the cross-probe companion test). */
export function detectWaveClimbs(p: Probe, elev: ElevSampler): WaveClimb[] {
  const out: WaveClimb[] = [];
  if (p.rend - p.rstart < MIN_RUN) return out;
  const s = sampleProbe(p, STEP, HW);
  if (s.length < 4) return out;
  const g = Math.max(1, Math.round(HW / STEP));
  const straightClimb = s.map((_, i) => {
    const r = rates(s, i, g, STEP);
    return r.turn < TURN_MAX && r.climb > CLIMB_MIN;
  });
  for (const [from, to] of runs(straightClimb, STEP, GAP)) {
    const w = makeWave(s, from, to, elev);
    if (w) out.push(w);
  }
  return out;
}

/** Is `w` shadowed by another probe for most of its duration, within rope distance? Both the
 *  tug and the glider are FLARM-tracked, so a tow shows up as two nearly-identical straight
 *  climbs a few tens of metres apart — a wave climb, by contrast, is normally flown alone. */
function hasCompanion(w: WaveClimb, mine: Probe, probes: readonly Probe[]): boolean {
  let hits = 0, total = 0;
  for (let t = w.t0; t <= w.t1; t += STEP) {
    total++;
    const [lon, lat] = mine.at(t);
    for (const p of probes) {
      if (p === mine || t < p.rstart || t > p.rend) continue;
      const [plon, plat] = p.at(t);
      if (distM(lon, lat, plon, plat) < TOW_PAIR_M) { hits++; break; }
    }
  }
  return total > 0 && hits / total >= TOW_PAIR_FRAC;
}

/** The day's observed wave: detected across every probe, tow tracks rejected, merged where
 *  several beats or several gliders worked the same bar, and capped strongest-first. */
export function detectWave(probes: readonly Probe[], elev: ElevSampler, max = MAX_WAVE): WaveClimb[] {
  const all: WaveClimb[] = [];
  for (const p of probes) {
    for (const w of detectWaveClimbs(p, elev)) {
      if (hasCompanion(w, p, probes)) continue;   // REQ-W-05: shadowed by another aircraft → a tow
      all.push(w);
    }
  }
  return mergeClimbs(all, w => w.c, MERGE_M, (m, w) => {
    m.t0 = Math.min(m.t0, w.t0); m.t1 = Math.max(m.t1, w.t1);
    m.base = Math.min(m.base, w.base); m.top = Math.max(m.top, w.top);
    m.strength = Math.max(m.strength, w.strength);
    m.c = [(m.c[0] + w.c[0]) / 2, (m.c[1] + w.c[1]) / 2];
  }).sort((a, b) => b.strength - a.strength).slice(0, max);
}
