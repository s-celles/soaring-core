// ============ points of interest: the places, and the files that carry them ============
// A turnpoint, an airfield, a landable field, a summit, a mast. The gliding world exchanges
// them in a handful of ageing text formats, and every one of those formats is a detail — the
// PLACE is the concept. So this module is a `Poi` type and a set of doors into it, not a
// `.cup` parser with delusions.
//
// Why it lives in the kernel and not in an app (C4bis): two applications in this family
// already needed it, and both had grown their own. That is the only proof of genericity that
// means anything, and the second time this exact thing happened — the vario sound law was the
// first. The rule is now written down: a format convention is soaring domain, and soaring
// domain goes here, even when only one app is using it today.
//
// ---- the honesty rule, and why it is sharper here than anywhere else ----
//
// An earlier parser in this family answered an unreadable elevation with ZERO. It looked
// harmless. It is not: on a LANDABLE field, the elevation is the number a final glide is
// computed against. Reading 0 m where the file said 1650 m promises the pilot an arrival he
// does not have, and he finds out at 200 feet. So: a field whose elevation cannot be read
// keeps its NAME, its POSITION and its TYPE, and its elevation is `null`. We refuse the
// number, not the place. Everything downstream must then decline to compute a glide to it —
// which is exactly what `null` forces it to do, and what a zero would have hidden.
//
// The same discipline everywhere else: a row that cannot be understood is DROPPED and
// COUNTED, never guessed at. The caller can tell a pilot "412 loaded, 3 refused", which is
// the only honest thing to say about a file nobody can fully read.

/** What a place IS. Fine-grained on purpose: "grass airfield" and "outlanding field" are not
 *  the same promise, and a parser that flattens them into one `airfield` has destroyed the
 *  distinction before any caller was asked whether it mattered. It matters: a pilot filtering
 *  a training flight wants the fields, not the fields-of-last-resort. */
export type PoiCat =
  | 'airfield-solid'      // tarmac
  | 'airfield-grass'
  | 'airfield-gliding'
  | 'outlanding'          // a field, not an airfield: the day has gone wrong
  | 'summit'
  | 'pass'
  | 'obstacle'            // mast, tower, power plant — things to be away from
  | 'landmark'            // VOR, castle, dam: it is on the map, you do not land on it
  | 'waypoint';           // a plain turnpoint

/** The four categories a glider may put its wheel on. Exported as data, not buried in an
 *  `if`, because callers filter on it and a second opinion about what is landable is exactly
 *  the kind of divergence this module exists to prevent. */
export const LANDABLE_CATS: readonly PoiCat[] =
  ['airfield-solid', 'airfield-grass', 'airfield-gliding', 'outlanding'];

export const isLandable = (c: PoiCat): boolean => LANDABLE_CATS.includes(c);

export interface Poi {
  name: string;
  /** The short code (a .cup's second column). Null when the file gave none. */
  code: string | null;
  country: string | null;
  lon: number;
  lat: number;
  /** Metres. **Null when the file's elevation could not be read** — never a fake zero. See
   *  the header: on a landable, this number is a final glide. */
  elevM: number | null;
  cat: PoiCat;
  /** Runway direction (degrees) and length (m), when the source carries them — a landable's
   *  runway is what a pilot checks before committing to it (LND-007). */
  rwdirDeg: number | null;
  rwlenM: number | null;
  /** The radio frequency, kept as the STRING the file wrote ("123.500"): it is a label to
   *  read out and dial, never a number to compute with, and parsing it to a float would
   *  quietly turn "123.505" into something a radio cannot tune. */
  freq: string | null;
  desc: string | null;
  /** What the source said about the type, verbatim (a .cup style code, a WinPilot flag
   *  string). Kept so a caller needing a finer grain than PoiCat is not forced to re-parse
   *  the file — and so a format's own vocabulary survives our summary of it. */
  raw: string | null;
}

/** What a parse produced, and what it could not. `refused` is not a diagnostic detail — it is
 *  the number the pilot must be shown, because a file that half-loaded is a file whose gaps
 *  he cannot see. */
export interface PoiFile {
  pois: Poi[];
  refused: number;
}

const FT = 0.3048;
const NM = 1852;

// ---- the small readers, shared by the formats ----

/** A length with its unit: "504.0m", "1650ft", "1.2nm". A bare number is METRES — every
 *  format here writes metres by default — and anything unreadable is NULL, never zero. */
export function lengthOf(raw: string | undefined): number | null {
  if (raw == null) return null;
  const m = /^"?\s*(-?[\d.]+)\s*(m|ft|nm)?\s*"?$/i.exec(raw.trim());
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  const unit = (m[2] ?? 'm').toLowerCase();
  return unit === 'ft' ? v * FT : unit === 'nm' ? v * NM : v;
}

const num = (raw: string | undefined): number | null => {
  if (raw == null) return null;
  const t = raw.trim().replace(/^"|"$/g, '');
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

const str = (raw: string | undefined): string | null => {
  if (raw == null) return null;
  const t = raw.trim().replace(/^"|"$/g, '').trim();
  return t === '' ? null : t;
};

/** Split one CSV line, honouring double quotes — a .cup description routinely contains commas,
 *  and a naive split shreds the row into a place that does not exist. */
export function csvCells(line: string): string[] {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** A coordinate as the gliding formats write it, in either dialect:
 *    SeeYou    `5107.830N`   `00249.750E`     — DDMM.mmm / DDDMM.mmm, glued
 *    WinPilot  `51:07.830N`  `002:49.750E`    — the same, with a colon
 *    (and `51:07:50N`, degrees-minutes-SECONDS, which some exporters still emit)
 *  Degrees and MINUTES, never a decimal degree — reading `5107.830` as 5107° is the classic
 *  way to put a waypoint in the sea, so a value whose minutes reach 60 is REFUSED outright
 *  rather than silently normalised. */
export function coordOf(raw: string | undefined): number | null {
  if (raw == null) return null;
  const t = raw.trim().replace(/^"|"$/g, '').toUpperCase();
  const m = /^(\d{2,3}):?(\d{2})(?::(\d{2}(?:\.\d+)?)|(\.\d+))?\s*([NSEW])$/.exec(t);
  if (!m) return null;
  const deg = Number(m[1]);
  const min = Number(m[2]) + (m[4] ? Number(m[4]) : 0);      // .mmm decimal minutes
  const sec = m[3] ? Number(m[3]) : 0;
  if (min >= 60 || sec >= 60) return null;                   // not minutes: the row is lying
  const v = deg + min / 60 + sec / 3600;
  if (!Number.isFinite(v)) return null;
  const hemi = m[5];
  if ((hemi === 'N' || hemi === 'S') && v > 90) return null;
  if (v > 180) return null;
  return hemi === 'S' || hemi === 'W' ? -v : v;
}

// ---- SeeYou .cup ----

/** The `style` column, which is the whole reason a .cup is also a LANDABLES database. The
 *  codes are SeeYou's own; the mapping is exhaustive so an unknown code lands on `waypoint`
 *  rather than on something a pilot might try to land on. */
export function catOfCupStyle(style: number | null): PoiCat {
  switch (style) {
    case 5: return 'airfield-solid';
    case 2: return 'airfield-grass';
    case 4: return 'airfield-gliding';
    case 3: return 'outlanding';
    case 7: return 'summit';
    case 6: return 'pass';
    case 8: case 11: case 15: return 'obstacle';       // mast, cooling tower, power plant
    case 9: case 10: case 12: case 13: case 14: case 16: return 'landmark';
    default: return 'waypoint';                        // 1, 0, 17+, and anything we do not know
  }
}

/** The columns a .cup row can carry that we know what to do with. Anything else the format has
 *  grown — userdata, pics, whatever comes next — is carried by nobody and costs nothing. */
type CupColumn = 'name' | 'code' | 'country' | 'lat' | 'lon' | 'elev' | 'style'
  | 'rwdir' | 'rwlen' | 'freq' | 'desc';

const CUP_COLUMNS: readonly CupColumn[] =
  ['name', 'code', 'country', 'lat', 'lon', 'elev', 'style', 'rwdir', 'rwlen', 'freq', 'desc'];

/** The LEGACY layout: the eleven columns a .cup had before SeeYou grew a runway WIDTH. Used only
 *  when a file carries no header at all. */
const CUP_LEGACY: Record<CupColumn, number> =
  { name: 0, code: 1, country: 2, lat: 3, lon: 4, elev: 5, style: 6, rwdir: 7, rwlen: 8, freq: 9, desc: 10 };

/** Read the header row into column → index, or answer null when it does not name the things a
 *  place IS (name, lat, lon) — a header we cannot steer by is one we ignore.
 *
 *  Reading it, rather than skipping it, is the whole point. CUP 1.0 — the layout SeeYou writes
 *  TODAY — inserts `rwwidth` between rwlen and freq:
 *
 *      name,code,country,lat,lon,elev,style,rwdir,rwlen,rwwidth,freq,desc,userdata,pics
 *
 *  Under the fixed legacy positions, a row `…,1000.0m,30.0m,123.500,"…"` therefore parses to a
 *  frequency of **"30.0m"** — the runway WIDTH, printed in the column a pilot reads to tune his
 *  radio before an outlanding, with the real 123.500 nowhere on his screen. And it parses
 *  SILENTLY: the row is well-formed, so `refused` stays 0 and this module's "drop and count what
 *  we cannot read" discipline never fires. A wrong number wearing the authority of a right one is
 *  worse than a missing one, which is the rule the whole file is built on — and the file was
 *  telling us where its columns were all along. */
function cupLayout(header: readonly string[]): Record<CupColumn, number | undefined> | null {
  const l: Partial<Record<CupColumn, number>> = {};
  header.forEach((h, i) => {
    const key = h.trim().replace(/^"|"$/g, '').trim().toLowerCase() as CupColumn;
    if (CUP_COLUMNS.includes(key) && l[key] === undefined) l[key] = i;
  });
  if (l.name == null || l.lat == null || l.lon == null) return null;
  return l as Record<CupColumn, number | undefined>;
}

/** SeeYou `.cup`. The column order is taken from the file's own HEADER when it has one — see
 *  `cupLayout` — and falls back to the legacy eleven-column order only when it has none.
 *
 *  Two things end a .cup's waypoint section and must not be parsed as places: the header row,
 *  and the `-----Related Tasks-----` divider after which the file describes TASKS. A parser
 *  that reads on turns a task line into a waypoint at a plausible-looking position. */
export function parseCup(text: string): PoiFile {
  const pois: Poi[] = [];
  let refused = 0;
  let layout: Record<CupColumn, number | undefined> = CUP_LEGACY;

  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    if (/^-{3,}/.test(l)) break;                        // the task section: the places are over
    if (/^"?name"?\s*,/i.test(l)) {                     // the header — read it, do not discard it
      layout = cupLayout(csvCells(line)) ?? CUP_LEGACY;
      continue;
    }
    const f = csvCells(line);
    if (f.length < 6) { refused++; continue; }
    const at = (c: CupColumn): string | undefined => {
      const i = layout[c];
      return i == null ? undefined : f[i];
    };

    const name = str(at('name'));
    const lat = coordOf(at('lat')), lon = coordOf(at('lon'));
    // A place with no name or no position is not a place. Refuse it whole (and count it) —
    // never a "(unnamed)" marker at coordinates nobody vouched for.
    if (name == null || lat == null || lon == null) { refused++; continue; }

    const style = num(at('style'));
    pois.push({
      name,
      code: str(at('code')),
      country: str(at('country')),
      lon, lat,
      elevM: lengthOf(at('elev')),                      // NULL if unreadable — see the header
      cat: catOfCupStyle(style),
      rwdirDeg: num(at('rwdir')),
      rwlenM: lengthOf(at('rwlen')),
      freq: str(at('freq')),
      desc: str(at('desc')),
      raw: style == null ? null : String(style),
    });
  }
  return { pois, refused };
}

// ---- WinPilot / Cambridge .dat and .wpt ----

/** The flag letters WinPilot writes: `A` airport, `L` landable, `T` turnpoint, `S`/`F` start
 *  and finish, `H` home, `M` markpoint. Only A and L say anything about putting a wheel down,
 *  and the format cannot tell grass from tarmac — so an `A` becomes a grass airfield (the
 *  conservative reading: it makes no promise about a hard surface it never made). */
export function catOfWinPilotFlags(flags: string | null): PoiCat {
  const f = (flags ?? '').toUpperCase();
  if (f.includes('A')) return 'airfield-grass';
  if (f.includes('L')) return 'outlanding';
  return 'waypoint';
}

/** WinPilot `.dat` / `.wpt`: number,lat,lon,elev,flags,name,description
 *  e.g. `1,51:07.830N,002:49.750E,504.0m,AT,Oostende,Airport` */
export function parseWinPilot(text: string): PoiFile {
  const pois: Poi[] = [];
  let refused = 0;
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('*') || l.startsWith(';')) continue;   // comments
    const f = csvCells(line);
    if (f.length < 6) { refused++; continue; }

    const lat = coordOf(f[1]), lon = coordOf(f[2]);
    const name = str(f[5]);
    if (name == null || lat == null || lon == null) { refused++; continue; }

    const flags = str(f[4]);
    pois.push({
      name,
      code: null,
      country: null,
      lon, lat,
      elevM: lengthOf(f[3]),
      cat: catOfWinPilotFlags(flags),
      rwdirDeg: null,                                   // the format carries neither
      rwlenM: null,
      freq: null,
      desc: str(f[6]),
      raw: flags,
    });
  }
  return { pois, refused };
}

// ---- one door for the caller ----

export type PoiFormat = 'cup' | 'winpilot';

/** Which format is this text? Sniffed from the CONTENT, not the file name — a pilot renames
 *  files, and a `.txt` full of waypoints is still waypoints. The .cup header and the .cup
 *  glued coordinate (`5107.830N`, no colon) are the tells; WinPilot writes colons. */
export function sniffPoiFormat(text: string): PoiFormat {
  const head = text.slice(0, 4000);
  if (/^\s*"?name"?\s*,\s*"?code"?/im.test(head)) return 'cup';
  if (/^\s*-{3,}/m.test(head)) return 'cup';                       // the task divider
  if (/\d{4}\.\d+[NS]\s*,/.test(head)) return 'cup';               // glued DDMM.mmm
  if (/\d{1,3}:\d{2}[.:]\d+[NS]/.test(head)) return 'winpilot';    // colon-separated
  return 'cup';                                                    // the format of the era
}

/** Read a waypoint file of any supported format. `format` overrides the sniff when the caller
 *  knows better than we can guess. */
export function parsePoiFile(text: string, format?: PoiFormat): PoiFile {
  const fmt = format ?? sniffPoiFormat(text);
  return fmt === 'winpilot' ? parseWinPilot(text) : parseCup(text);
}

/** The landables, out of any point list — the one filter every caller wants and none should
 *  spell for itself. */
export const landablesOf = (pois: readonly Poi[]): Poi[] => pois.filter(p => isLandable(p.cat));
