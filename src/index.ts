// ============ soaring-core ============
// The soaring domain as VALUES. The ground is a value, the atmosphere is a value, a flight
// is a value — none of them an effect, a render pass, or a fetch. Everything the kernel needs
// from the world arrives as a function (see ports.ts), so the same code serves a browser
// streaming CDN tiles and a flight computer reading an offline data pack.
//
// Nothing here imports a renderer, touches app state, or opens a socket. That is ENFORCED:
// tsconfig drops DOM from `lib`, so the compiler itself refuses a browser global, and
// purity.test.ts guards what the compiler cannot see.
//
// The modules are exposed as NAMESPACES, not flattened. Each field carries its own tuning
// vocabulary — converg's GB is not wave's GB, airmass's STEP is not wavemass's STEP — and a
// flat barrel would collapse them into one namespace and silently pick a winner. The names
// belong to their physics. Import the submodule directly if you prefer:
//
//     import { ridgeField } from 'soaring-core/lift/ridge';
//     import * as core from 'soaring-core';   core.lift.ridge.ridgeField(...)

// --- ports: everything the kernel needs from the world, as functions ---
export type { ElevSampler, WindProfile, Probe } from './ports';

// --- domain types (unambiguous, so they are exported flat) ---
export type { TrackPoint, RelPoint, Pos3, ImportedTrack, ImportedFile } from './types';

// --- the world, as values ---
export * as geo from './geo';           // tiles, the Terrarium codec, the elevation sampler
export * as sky from './sky';           // sun and moon: pure ephemeris
export * as weather from './weather';   // the atmosphere: profile, sounding, LCL, stability

// --- a flight, as values ---
export * as flight from './flight';     // position, vario, attitude, stats
export * as polar from './polar';       // sink, netto, super-netto, .plr import
export * as varioaudio from './varioaudio';   // the sound of the air: the LAW, not the loudspeaker
export * as igc from './igc';
export * as trackImport from './track-import';

// --- reading the air off the gliders that flew it ---
export * as probe from './probe';
export * as airmass from './airmass';     // thermals, from circling climbs
export * as wavemass from './wavemass';   // wave, from straight climbs high above the ground

// --- predicted lift fields ---
export * as lift from './lift';
export * as liftviz from './liftviz';   // the shared colour language for vertical air motion
