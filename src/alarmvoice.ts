// ============ the alarm, out loud ============
// A collision warning must reach the pilot where his attention already is — in the air, not on a
// screen. And the obvious way to sound one is the one thing that must NOT be done.
//
// A fast, high beep is exactly what a 5 m/s climb sounds like. A pilot circling in strong lift
// would hear a collision warning as a compliment to his centring. So the alarm does not live on
// the vario's axis at all. It is a WARBLE: two pitches alternating INSIDE one continuous cry.
// No vario has ever changed pitch within its own beep train — `varioTone` gives one hz for one
// vz, always — and that STRUCTURAL difference, not loudness and not speed, is what makes an
// alarm unconfusable. Loudness can be turned down and speed can be mimicked by a good thermal;
// a pitch that changes mid-cry cannot be either.
//
// The two alarms are also distinct FROM EACH OTHER, because they demand different actions: the
// traffic warble rises through a wide interval (another aircraft — look out, manoeuvre), while
// the terrain cry falls through an octave, low (the ground is below, and it is coming up). A
// pilot who confuses them turns the wrong way.
//
// This widens the vocabulary by exactly one idea. A `Tone` is one pitch; a `Voice` is a LOOPED
// SEQUENCE of tones, and `voiceAt` is the only clock a player needs. The vario and the
// speed-to-fly director become one-step voices, which costs them nothing and lets one speaker
// carry every source under one priority law — written down once, in `chooseVoice`.
//
// It lives in the kernel for the reason the vario law does (C4bis): a tone law is soaring
// DOMAIN, not app logic. This is the LAW; the loudspeaker belongs to the app.

/** FLARM's own alarm scale: 0 none · 1 (13–18 s) · 2 (9–12 s) · 3 (0–8 s). Every level from 1 up
 *  is a COLLISION ALARM in the Dataport spec — there is no "info" tier, and this type exists so
 *  that no caller can invent one. */
export type AlarmLevel = 0 | 1 | 2 | 3;

import { type Tone, SILENT } from './varioaudio';
/** One held pitch and how long it is held. */
export interface ToneStep { tone: Tone; ms: number }

/** A looped sequence of tones. One step is a vario; two are an alarm. */
export interface Voice { steps: ToneStep[] }

export const SILENT_VOICE: Voice = { steps: [{ tone: SILENT, ms: 1000 }] };

/** Wrap a plain Tone — the vario, the STF director — as a one-step voice. It then sounds
 *  exactly as it always did: `voiceAt` answers it at every instant. */
export function steady(t: Tone): Voice {
  return { steps: [{ tone: t, ms: 1000 }] };
}

/** Total loop length. Zero-length or empty voices have no period, and `voiceAt` treats them
 *  as silence rather than dividing by zero. */
const periodMs = (v: Voice): number =>
  v.steps.reduce((s, st) => s + Math.max(0, st.ms), 0);

/** Which tone a voice is sounding at absolute time `tMs`. Pure, total, and the ONLY clock the
 *  shell needs to know about: it wraps modulo the voice's own period, so the shell can hand it
 *  the audio clock and never track a phase of its own. A null voice is silence — the honest
 *  answer to "nothing is speaking", and not a zero-hertz tone. */
export function voiceAt(v: Voice | null, tMs: number): Tone {
  if (!v || v.steps.length === 0) return SILENT;
  const period = periodMs(v);
  if (period <= 0 || !Number.isFinite(tMs)) return SILENT;
  // A modulo that survives a negative or absurd clock: the shell must never be able to hand us
  // a time that produces `undefined`.
  let x = tMs % period;
  if (x < 0) x += period;
  for (const st of v.steps) {
    const w = Math.max(0, st.ms);
    if (x < w) return st.tone;
    x -= w;
  }
  return v.steps[v.steps.length - 1].tone;
}

/** A two-pitch warble: `a` then `b`, each held `ms`, continuous (`pulsesPerS: 0`, `duty: 1`).
 *  Continuous is the point — a chopped warble is a beep train again, and a beep train is a
 *  vario. The pilot hears one unbroken cry that keeps changing its mind. */
const warble = (a: number, b: number, ms: number): Voice => ({
  steps: [
    { tone: { silent: false, hz: a, pulsesPerS: 0, duty: 1 }, ms },
    { tone: { silent: false, hz: b, pulsesPerS: 0, duty: 1 }, ms },
  ],
});

/** FLM-002: the collision voice.
 *
 *  Every level FLARM calls an alarm gets a voice, because FLM-002 is a Must and names both
 *  senses: "une alerte visuelle ET, si disponible, sonore". Level 1 used to be silent here, on
 *  the reading that it was mere "info" — but the Dataport spec has no info tier: level 1 IS a
 *  collision alarm (13–18 s to impact), 2 is 9–12 s, 3 is 0–8 s, and the screen already prints
 *  the word ALARM and the see-and-avoid sentence for it. Eye told, ear not, is not a decision the
 *  banner and the tone are allowed to take differently — the threshold for the word ALARM is one
 *  threshold, and it lives at 1 in flarmBanner and at 1 here.
 *
 *  The nuisance worry was real and is answered by SUBORDINATION, not by silence. The three levels
 *  are three different amounts of time to decide, and a pilot must hear WHICH without counting:
 *
 *  Level 1 (13–18 s): low, narrow and slow — 520/700 Hz held 300 ms. Unmistakably the same family
 *    as the others and unmistakably the quiet end of it.
 *  Level 2 (9–12 s): a fifth apart, 660/990 Hz, twice the rate.
 *  Level 3 (0–8 s): higher, wider and twice as fast again, 880/1320 Hz. */
export function flarmVoice(level: AlarmLevel): Voice | null {
  if (level === 3) return warble(880, 1320, 90);
  if (level === 2) return warble(660, 990, 180);
  if (level === 1) return warble(520, 700, 300);
  return null;
}

/** TER-008's voice, and audibly NOT the FLARM warble. It falls instead of rising, an octave
 *  instead of a fifth, and it sits low where the FLARM cry is high — because "another aircraft"
 *  and "the ground" are two different actions, and a pilot who confuses them turns the wrong
 *  way. Level 3 is faster and slightly higher, on the same reasoning as FLARM's. */
export function terrainVoice(level: 2 | 3): Voice {
  return level === 3 ? warble(560, 280, 100) : warble(500, 250, 150);
}

/** THE PRIORITY LAW, and the only place it is written down.
 *
 *  One speaker, one voice, never a mix: two tones at once is not twice the information, it is
 *  noise. The alarm SUPERSEDES the vario while it sounds — a collision warning that has to
 *  wait for a beep to finish is a collision warning that arrives late, and the climb the pilot
 *  loses by missing two seconds of vario is not worth discussing.
 *
 *  FLARM 3 > FLARM 2 > terrain > FLARM 1 > (speed-to-fly | vario). FLARM outranks terrain at
 *  levels 2 and 3 because the ground does not manoeuvre and the other glider does: the rock is
 *  still there in four seconds, and it is on the screen the whole time. But FLARM 1 does NOT
 *  outrank it. Level 1 is the loosest collision tier FLARM has (13–18 s, and most of them resolve
 *  themselves), while a terrain alarm means the ground is inside the horizon on the track the
 *  glider is flying — letting the softest traffic warning mask the hardest terrain one would put
 *  the two hazards in the wrong order for the sake of a rule about which instrument spoke.
 *  Level 1 is still SOUNDED (FLM-002 is a Must); it simply waits for the rock.
 *
 *  `cruise` is whatever the vario or the STF director would have said — including SILENT, which
 *  is a perfectly good answer and the usual one. */
export function chooseVoice(x: {
  flarm: AlarmLevel;              // 0 when there is no FLARM or no alarm
  terrain: 2 | 3 | null;          // terrainalarm's verdict, null when clear or unmeasured
  cruise: Tone;                   // what the vario or the STF director would have said
}): Voice {
  if (x.flarm >= 2) return flarmVoice(x.flarm)!;
  if (x.terrain != null) return terrainVoice(x.terrain);
  const f = flarmVoice(x.flarm);
  if (f) return f;
  return steady(x.cruise);
}
