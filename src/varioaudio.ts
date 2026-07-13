// ============ the sound of the air ============
// A glider pilot does not look at the vario. He listens to it — his eyes are outside, where
// they belong. So the audio is not a decoration on the vario: in a thermal it IS the vario,
// and a tone that lies is worse than silence.
//
// This module is the LAW, not the loudspeaker: a pure function from a vertical speed to a
// tone. It lives in the kernel because it is soaring domain, not app logic — and because two
// apps already needed it, which is the only proof of genericity that means anything. What
// plays it (an AudioContext, an oscillator, a beep scheduler) belongs to the app.
//
// The law is not invented here either: it is what an electronic vario actually sounds like,
// and every parameter below is load-bearing. A first attempt elsewhere got four things wrong,
// and each is worth naming because each is a trap a fresh implementation walks straight into:
//
//   1. A LINEAR pitch ramp. The ear hears pitch logarithmically and every real vario is
//      exponential — here the pitch DOUBLES every ~3.8 m/s. Linear sounds mechanical, and a
//      pilot who has flown an LX or a Borgelt has to translate at exactly the moment he
//      should not be thinking.
//   2. A sine wave. Real varios are harsh, and the harshness is what makes them audible under
//      a canopy at 100 km/h. A sine is a doorbell. (The waveform is the app's to choose —
//      choose square.)
//   3. A sink threshold set wide, so gentle sink stayed SILENT. That is not a milder vario,
//      it is a broken one: sinking air is the thing you most need to hear yourself entering.
//      The deadband is NARROW, and deliberately so.
//   4. Beeps toggled from a timer. The edges land wherever the event loop happens to be, and
//      every one of them clicks. Schedule them on the audio clock, with attack and release
//      ramps — that is half the realism, and it is the app's job (see the note on Tone.duty).

/** What to sound. `pulsesPerS = 0` means a CONTINUOUS tone — the sink growl — and is not the
 *  same thing as silence, which is `silent`. */
export interface Tone {
  /** Nothing to say: the deadband, or no data at all. Silence is a legitimate answer, and the
   *  only honest one when the vario is unknown — a 0 m/s beep over a dead sensor is a lie the
   *  pilot cannot see through, because he is not looking. */
  silent: boolean;
  hz: number;
  /** Beeps per second; 0 = continuous. */
  pulsesPerS: number;
  /** Fraction of each period that sounds. The player is expected to give each beep real
   *  attack and release ramps — a gain that steps from 0 to 1 is a discontinuity, and a
   *  discontinuity is a pop. */
  duty: number;
}

export const SILENT: Tone = { silent: true, hz: 0, pulsesPerS: 0, duty: 0 };

/** Reference pitch (Hz) at zero vertical speed. */
export const F0 = 600;
/** |vz| below this is silent — narrow on purpose (see trap 3 above). */
export const DEADBAND_MS = 0.15;
/** The pitch law spans ±5 m/s, over which it climbs 1.32 octaves. */
export const SPAN_MS = 5;
export const OCTAVES = 1.32;
export const HZ_MIN = 170, HZ_MAX = 1750;

const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

/** The pitch for a vertical speed — exponential, as the ear and every real vario have it. */
export const toneHz = (vz: number): number =>
  clamp(F0 * Math.pow(2, (vz / SPAN_MS) * OCTAVES), HZ_MIN, HZ_MAX);

/** The classic vario voice: climb chops into beeps that rise in pitch and quicken with the
 *  lift; sink is one continuous, falling tone; a narrow deadband around zero is silent. A
 *  null vz is SILENT — there is no honest sound for "I do not know". */
export function varioTone(vz: number | null | undefined): Tone {
  if (vz == null || !Number.isFinite(vz)) return SILENT;
  if (Math.abs(vz) <= DEADBAND_MS) return SILENT;

  const hz = toneHz(vz);
  // Sink GROWLS: continuous rather than chopped, which is the whole point — a pilot knows he
  // is in sink before he has finished parsing the sound.
  if (vz < 0) return { silent: false, hz, pulsesPerS: 0, duty: 1 };

  // Climb BEEPS: quicker AND fatter as the lift strengthens, which is how a good vario feels
  // under the hand — not merely faster.
  return {
    silent: false,
    hz,
    pulsesPerS: clamp(1.2 + 1.8 * vz, 1.2, 11),
    duty: clamp(0.34 + 0.16 * (vz / SPAN_MS), 0.30, 0.55),
  };
}

/** The speed-to-fly voice, for cruise. `deltaMs` is (current airspeed − commanded speed):
 *  positive means flying TOO FAST, negative means TOO SLOW.
 *
 *  The two errors get OPPOSITE sounds on purpose — a pilot must know which way to push without
 *  thinking about it. Too slow: high, urgent, short chirps ("nose down"). Too fast: a low,
 *  slow drone ("ease off"). And the tolerance band is silent, because a speed director that
 *  never shuts up is a speed director that gets muted.
 *
 *  It must never be mistaken for the vario: same speaker, opposite meaning, so an app plays
 *  one or the other and never both. */
export function stfTone(deltaMs: number | null | undefined, toleranceMs = 2): Tone {
  if (deltaMs == null || !Number.isFinite(deltaMs)) return SILENT;
  if (Math.abs(deltaMs) <= toleranceMs) return SILENT;
  const err = Math.min(Math.abs(deltaMs), 15);
  if (deltaMs < 0) {
    return { silent: false, hz: 700 + 40 * err, pulsesPerS: 3 + 0.5 * err, duty: 0.35 };
  }
  return { silent: false, hz: Math.max(160, 320 - 8 * err), pulsesPerS: 1.2, duty: 0.6 };
}
