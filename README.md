# soaring-core

**The soaring domain as values.** The ground is a value, the atmosphere is a value, a flight is
a value — not an effect, not a render pass, not a fetch.

A shared kernel for [OGN 3D Viewer](https://github.com/s-celles/ogn-3d-viewer) (a 3D replay of
glider flights) and **UPDRAFT** (a soaring flight computer). The two could hardly be more
different — one has a WebGL map and a network, the other may have neither — so everything they
share had to be reduced to arithmetic.

## What is in it

| | |
|---|---|
| `geo` | Web-Mercator tiles, the Terrarium elevation codec, `elevAtFromTiles` |
| `sky` | Sun and moon position, the terminator, the sky-colour ramp — pure ephemeris |
| `weather` | The atmosphere as a value: wind profile, sounding, LCL, convective ceiling, stability, and a synthetic atmosphere for briefing |
| `flight` | Where the glider was, how fast it climbed, how it was banked, what the flight added up to |
| `polar` | Sink, netto, super-netto, `.plr` import |
| `igc`, `track-import` | Reading a flight off a file |
| `airmass`, `wavemass` | Reading the AIR off the gliders that flew it: thermals from circling climbs, wave from straight ones |
| `lift/*` | Four predicted lift fields — slope, thermal, convergence, lee wave — plus the mixer and the day calibration |

## The boundary, and why it is enforced

A flight computer has no map renderer and may have no DOM at all. So the kernel imports no
renderer, touches no app state, and opens no socket — and that is **checked, not trusted**:

- `tsconfig.json` drops `DOM` from `lib`. The **compiler** refuses a browser global.
- `src/purity.test.ts` guards what the compiler cannot see: a banned package sneaking into an
  import, a relative path climbing out of `src/`, a `document.` in a string.

Everything the kernel needs from the world arrives as a **function** — see `ports.ts`:

```ts
type ElevSampler = (lon: number, lat: number) => number | null;   // null = UNKNOWN, never a fake zero
type WindProfile = (alt: number) => [number, number] | null;
interface Probe { rstart: number; rend: number; at: (t: number) => readonly [number, number, number] }
```

So the same `elevAtFromTiles` serves a browser streaming CDN tiles and a flight computer reading
a pre-flight data pack, with no network at all.

`WindProfile` is deliberately **not** `(lon, lat, alt)`. The forecast is bucketed to ~8 km
horizontally, so a spatial field would be piecewise constant with 8 km steps — and convergence
takes the *divergence* of the wind, where a step is a singularity. A port that refuses a
capability is as useful as one that offers it.

## Honesty

Every lift field here is a **model**, and a rough one. They are aids to a decision, never a
guarantee of lift. The tests say so: they pin each field to analytic terrain where the answer is
known in closed form, and several of them exist to record a limitation rather than a feature.

## Use

```bash
bun install
bun test          # 160 tests
bun run typecheck
```

```ts
import { ridgeField } from 'soaring-core/lift/ridge';
import * as core from 'soaring-core';   // core.lift.ridge.ridgeField(...)
```

## Status

Extracted from OGN 3D Viewer with its history — 18 commits, each explaining why a boundary
exists. The API is young and will move.

## Licence

AGPL-3.0, inherited from OGN 3D Viewer. **Note that this is copyleft: it propagates to anything
that links it**, including over a network.

_Assisted by AI._
