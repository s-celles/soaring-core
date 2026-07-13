// What these tests pin is not "the alarm makes a noise" — it is the two claims a future
// simplification would quietly break: that the alarm CANNOT be heard as a climb, and that it
// SUPERSEDES the climb. Both are about a pilot mishearing, which no amount of typing catches.
import { test, expect } from 'bun:test';
import { varioTone, stfTone, SILENT, type Tone } from './varioaudio';
import {
  steady, voiceAt, flarmVoice, terrainVoice, chooseVoice, SILENT_VOICE,
  type Voice,
} from './alarmvoice';

const pitches = (v: Voice): Set<number> => new Set(v.steps.map(s => s.tone.hz));
const period = (v: Voice): number => v.steps.reduce((s, st) => s + st.ms, 0);

test('FLM-002: every level FLARM calls an ALARM is SOUNDED, level 1 included', () => {
  // The Must names both senses — visual AND audible — and the screen already paints "FLARM —
  // ALARM 1" with the see-and-avoid sentence for a level-1 PFLAU. Level 1 is a collision alarm in
  // the Dataport spec (13–18 s), not an "info" tier: eye told, ear not, is not a split the banner
  // and the tone may take differently. One threshold for the word ALARM, and it is 1 in both.
  expect(flarmVoice(0)).toBeNull();                  // no threat, no voice
  expect(flarmVoice(1)).not.toBeNull();
  expect(flarmVoice(2)).not.toBeNull();
  expect(flarmVoice(3)).not.toBeNull();
});

test('and the three levels are told apart by the EAR, without counting', () => {
  // The nuisance worry is answered by subordination, not silence: level 1 is the slow, low,
  // narrow end of one unmistakable family, and each level up is faster, higher and wider.
  const [v1, v2, v3] = [flarmVoice(1)!, flarmVoice(2)!, flarmVoice(3)!];
  expect(period(v1)).toBeGreaterThan(period(v2));
  expect(period(v2)).toBeGreaterThan(period(v3));
  const top = (v: Voice): number => Math.max(...v.steps.map(s => s.tone.hz));
  expect(top(v1)).toBeLessThan(top(v2));
  expect(top(v2)).toBeLessThan(top(v3));
  const spread = (v: Voice): number =>
    Math.max(...v.steps.map(s => s.tone.hz)) - Math.min(...v.steps.map(s => s.tone.hz));
  expect(spread(v1)).toBeLessThan(spread(v2));
  expect(spread(v2)).toBeLessThan(spread(v3));
  // Still a warble and not a beep train: two pitches inside one continuous cry, so it can never
  // be mistaken for the vario.
  for (const v of [v1, v2, v3]) {
    expect(v.steps.length).toBe(2);
    for (const st of v.steps) expect(st.tone.pulsesPerS).toBe(0);
  }
});

test('the alarm cannot be heard as a climb: it warbles, and no vario ever does', () => {
  // THE claim of this module. varioTone maps one vz to exactly one pitch, for every vz in the
  // band a glider lives in; an alarm holds two. So no vario tone's pitch set can ever equal an
  // alarm's — not by tuning, not by accident, not after someone "simplifies" the warble away.
  const alarms = [flarmVoice(2)!, flarmVoice(3)!, terrainVoice(2), terrainVoice(3)];
  for (const a of alarms) expect(pitches(a).size).toBeGreaterThanOrEqual(2);

  for (let vz = -5; vz <= 5.0001; vz += 0.1) {
    const v = steady(varioTone(vz));
    expect(pitches(v).size).toBe(1);                       // one vz, one pitch. Always.
    for (const a of alarms) expect(pitches(v)).not.toEqual(pitches(a));
  }
  // Nor can the speed-to-fly director be mistaken for one, for the same structural reason.
  for (const d of [-12, -6, -3, 3, 6, 12]) {
    const v = steady(stfTone(d));
    for (const a of alarms) expect(pitches(v)).not.toEqual(pitches(a));
  }
});

test('a pilot hears WHICH level: 2 and 3 differ in pitch and in rate', () => {
  const a = flarmVoice(2)!, b = flarmVoice(3)!;
  expect(pitches(a)).not.toEqual(pitches(b));
  expect(a.steps[0].ms).not.toBe(b.steps[0].ms);
  expect(period(b)).toBeLessThan(period(a));               // urgent is the FASTER warble
});

test('the ground and an aircraft do not sound alike', () => {
  expect(pitches(terrainVoice(2))).not.toEqual(pitches(flarmVoice(2)!));
  expect(pitches(terrainVoice(3))).not.toEqual(pitches(flarmVoice(3)!));
  // The ground is BELOW: the terrain voice falls, the FLARM voice rises.
  const t = terrainVoice(2);
  expect(t.steps[1].tone.hz).toBeLessThan(t.steps[0].tone.hz);
  const f = flarmVoice(2)!;
  expect(f.steps[1].tone.hz).toBeGreaterThan(f.steps[0].tone.hz);
});

test('the alarm supersedes the vario, even a booming one', () => {
  const boom = varioTone(5);                               // the loudest, fastest, highest climb
  expect(boom.silent).toBe(false);
  expect(chooseVoice({ flarm: 2, terrain: null, cruise: boom })).toEqual(flarmVoice(2)!);
  expect(chooseVoice({ flarm: 0, terrain: 3, cruise: boom })).toEqual(terrainVoice(3));
});

test('one speaker, one voice: FLARM 3 > FLARM 2 > terrain > FLARM 1 > cruise', () => {
  const c: Tone = varioTone(2);
  expect(chooseVoice({ flarm: 3, terrain: 3, cruise: c })).toEqual(flarmVoice(3)!);
  expect(chooseVoice({ flarm: 2, terrain: 3, cruise: c })).toEqual(flarmVoice(2)!);
  expect(chooseVoice({ flarm: 0, terrain: 2, cruise: c })).toEqual(terrainVoice(2));
  // FLARM 1 is sounded — but it does NOT mask the rock. It is the loosest collision tier FLARM
  // has (13–18 s, most resolving themselves); a terrain alarm means the ground is inside the
  // horizon on the track being flown. Letting the softest traffic warning silence the hardest
  // terrain one would order the two hazards by which instrument spoke, not by which one kills.
  expect(chooseVoice({ flarm: 1, terrain: 3, cruise: c })).toEqual(terrainVoice(3));
  expect(chooseVoice({ flarm: 1, terrain: 2, cruise: c })).toEqual(terrainVoice(2));
  expect(chooseVoice({ flarm: 1, terrain: null, cruise: c })).toEqual(flarmVoice(1)!);
  expect(chooseVoice({ flarm: 0, terrain: null, cruise: c })).toEqual(steady(c));
  // Silence is a legitimate cruise answer, and stays one.
  expect(voiceAt(chooseVoice({ flarm: 0, terrain: null, cruise: SILENT }), 0)).toEqual(SILENT);
});

test('voiceAt wraps, and answers the same tone one period later', () => {
  const v = flarmVoice(3)!;
  const p = period(v);
  for (const t of [0, 37, 90, 91, 179, 12345.6]) {
    expect(voiceAt(v, t)).toEqual(voiceAt(v, t + p));
    expect(voiceAt(v, t)).toEqual(voiceAt(v, t + 10 * p));
  }
  expect(voiceAt(v, 0).hz).toBe(v.steps[0].tone.hz);
  expect(voiceAt(v, p / 2 + 1).hz).toBe(v.steps[1].tone.hz);
  // Over one loop both pitches really are sounded — a warble on paper is not a warble in the ear.
  const heard = new Set<number>();
  for (let t = 0; t < p; t += 5) heard.add(voiceAt(v, t).hz);
  expect(heard).toEqual(pitches(v));
});

test('voiceAt is total: no voice, no clock, no crash', () => {
  expect(voiceAt(null, 0)).toEqual(SILENT);
  expect(voiceAt(null, 999999)).toEqual(SILENT);
  expect(voiceAt(SILENT_VOICE, 500).silent).toBe(true);
  expect(voiceAt({ steps: [] }, 10)).toEqual(SILENT);
  expect(voiceAt(flarmVoice(2)!, -270).silent).toBe(false);      // a negative clock still sounds
  expect(voiceAt(flarmVoice(2)!, NaN)).toEqual(SILENT);
});

test('a steady voice answers its tone at every instant', () => {
  const t = varioTone(3);
  const v = steady(t);
  for (const at of [0, 1, 250, 999, 1000, 5001, -7]) expect(voiceAt(v, at)).toEqual(t);
});
