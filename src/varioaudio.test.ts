// The one thing an audio vario must never do: make a sound that means something it does not
// mean. A dead sensor is silent; neutral air is silent; and climb and sink cannot be mistaken
// for one another with your eyes outside the cockpit — which is the entire point of the sound.
import { test, expect } from 'bun:test';
import { varioTone, stfTone, toneHz, SILENT, F0, DEADBAND_MS, SPAN_MS, OCTAVES } from './varioaudio';

test('an unknown vertical speed is SILENT — there is no honest sound for "I do not know"', () => {
  expect(varioTone(null)).toEqual(SILENT);
  expect(varioTone(undefined)).toEqual(SILENT);
  expect(varioTone(NaN)).toEqual(SILENT);
});

test('the deadband is NARROW: gentle sink is heard, it is not swallowed', () => {
  expect(varioTone(0).silent).toBe(true);
  expect(varioTone(0.1).silent).toBe(true);
  expect(varioTone(-0.1).silent).toBe(true);
  // −0.5 m/s is real sink and MUST speak. A wide sink threshold is not a milder vario, it is
  // a broken one: sinking air is the thing you most need to hear yourself entering.
  expect(varioTone(-0.5).silent).toBe(false);
  expect(varioTone(-0.5).pulsesPerS).toBe(0);            // and it growls, continuously
});

test('the pitch law is EXPONENTIAL — it doubles every SPAN/OCTAVES m/s, as the ear hears it', () => {
  expect(toneHz(0)).toBeCloseTo(F0, 6);
  const doubling = SPAN_MS / OCTAVES;                     // ≈ 3.79 m/s per octave
  expect(toneHz(doubling)).toBeCloseTo(2 * F0, 3);
  expect(toneHz(-doubling)).toBeCloseTo(F0 / 2, 3);
  // A linear ramp would make these two intervals equal in Hz; the law must NOT.
  const lowStep = toneHz(1) - toneHz(0);
  const highStep = toneHz(4) - toneHz(3);
  expect(highStep).toBeGreaterThan(lowStep * 1.5);
});

test('the pitch is clamped: a broken sensor cannot shriek or rumble out of the band', () => {
  expect(toneHz(50)).toBeLessThanOrEqual(1750);
  expect(toneHz(-50)).toBeGreaterThanOrEqual(170);
});

test('climb beeps and quickens; sink is one continuous, lower tone', () => {
  const weak = varioTone(1), strong = varioTone(4);
  expect(strong.hz).toBeGreaterThan(weak.hz);
  expect(strong.pulsesPerS).toBeGreaterThan(weak.pulsesPerS);
  expect(strong.duty).toBeGreaterThan(weak.duty);         // stronger lift is fatter, not just faster
  expect(weak.pulsesPerS).toBeGreaterThan(0);

  const sink = varioTone(-3);
  expect(sink.pulsesPerS).toBe(0);                        // continuous — a growl, not a beep
  expect(sink.hz).toBeLessThan(F0);                       // and below the reference, always
});

test('climb and sink can never be confused, at any strength', () => {
  for (const up of [0.3, 1, 2, 5, 9]) {
    for (const down of [-0.3, -1, -4, -9]) {
      const u = varioTone(up), d = varioTone(down);
      expect(u.hz).toBeGreaterThan(d.hz);                 // up is always higher…
      expect(u.pulsesPerS).toBeGreaterThan(0);            // …and always beeps…
      expect(d.pulsesPerS).toBe(0);                       // …while down never does
    }
  }
});

test('the beep rate saturates instead of running away into a buzz', () => {
  expect(varioTone(20).pulsesPerS).toBeLessThanOrEqual(11);
  expect(varioTone(0.2).pulsesPerS).toBeGreaterThanOrEqual(1.2);
});

test('speed-to-fly: too slow chirps high and urgent, too fast drones low and lazy', () => {
  const slow = stfTone(-8), fast = stfTone(8);
  expect(slow.hz).toBeGreaterThan(fast.hz);               // opposite sounds for opposite errors
  expect(slow.pulsesPerS).toBeGreaterThan(fast.pulsesPerS);
  expect(slow.duty).toBeLessThan(fast.duty);              // chirps against a drone
});

test('the speed director shuts up inside its tolerance — one that never does gets muted', () => {
  expect(stfTone(0).silent).toBe(true);
  expect(stfTone(1.9).silent).toBe(true);
  expect(stfTone(3).silent).toBe(false);
  expect(stfTone(null)).toEqual(SILENT);
});

test('the deadband constant is the one the law actually uses', () => {
  expect(varioTone(DEADBAND_MS).silent).toBe(true);
  expect(varioTone(DEADBAND_MS + 0.01).silent).toBe(false);
});
