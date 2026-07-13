// The rule that matters most in this file, and the reason it was written: an unreadable
// elevation is NULL, never zero. A parser in this family answered zero, and on a landable
// field the elevation IS the final glide — 0 m where the file said 1650 m promises an arrival
// the pilot does not have, and he learns it at 200 feet. The test below fails if that comes
// back.
import { test, expect } from 'bun:test';
import {
  parseCup, parseWinPilot, parsePoiFile, sniffPoiFormat, coordOf, lengthOf, csvCells,
  catOfCupStyle, isLandable, landablesOf, LANDABLE_CATS,
} from './poi';

const CUP = [
  'name,code,country,lat,lon,elev,style,rwdir,rwlen,freq,desc',
  '"Oostende","OST","BE",5111.783N,00252.083E,4.0m,5,082,3200.0m,"119.850","Solid runway"',
  '"Saint-Auban","STA","FR",4402.900N,00559.700E,459.0m,4,110,1000.0m,"122.500","Gliding site"',
  '"Champ Nord","CN","FR",4510.000N,00600.000E,650.0m,3,,,,"Outlanding, flat, watch the wires"',
  '"Mont Ventoux","VTX","FR",4417.400N,00516.100E,1909.0m,7,,,,"Summit"',
  '"Pylone","PYL","FR",4400.000N,00500.000E,300.0m,8,,,,"Mast"',
  '"Turn 1","T1","FR",4430.000N,00530.000E,,1,,,,"a turnpoint with NO elevation"',
  '-----Related Tasks-----',
  '"Task 1","","","","",""',
].join('\r\n');

test('a .cup loads its places, with the style column deciding what each one IS', () => {
  const { pois, refused } = parseCup(CUP);
  expect(refused).toBe(0);
  expect(pois.length).toBe(6);                       // the task section is NOT a place
  expect(pois.map(p => p.cat)).toEqual([
    'airfield-solid', 'airfield-gliding', 'outlanding', 'summit', 'obstacle', 'waypoint',
  ]);
  expect(pois.map(p => p.name)).not.toContain('Task 1');
});

test('an unreadable elevation is NULL — the place survives, the number does not', () => {
  const turn = parseCup(CUP).pois.find(p => p.name === 'Turn 1')!;
  expect(turn.elevM).toBeNull();                     // NOT 0 — see this file's header
  expect(turn.lat).toBeCloseTo(44.5, 6);             // …and the place is still there
  expect(turn.name).toBe('Turn 1');
});

test('DDMM.mmm is degrees and MINUTES — the classic way to put a field in the sea', () => {
  expect(coordOf('5111.783N')).toBeCloseTo(51 + 11.783 / 60, 9);
  expect(coordOf('00252.083E')).toBeCloseTo(2 + 52.083 / 60, 9);
  expect(coordOf('4402.900S')).toBeCloseTo(-(44 + 2.9 / 60), 9);
  expect(coordOf('00559.700W')).toBeCloseTo(-(5 + 59.7 / 60), 9);
  // WinPilot's colon dialect, and the seconds dialect some exporters still emit.
  expect(coordOf('51:07.830N')).toBeCloseTo(51 + 7.83 / 60, 9);
  expect(coordOf('51:07:30N')).toBeCloseTo(51 + 7 / 60 + 30 / 3600, 9);
});

test('sixty minutes is not a coordinate — it is a lying row, and it is refused', () => {
  expect(coordOf('5160.000N')).toBeNull();
  expect(coordOf('9500.000N')).toBeNull();           // past the pole
  expect(coordOf('garbage')).toBeNull();
  expect(coordOf(undefined)).toBeNull();
});

test('units are read, and an unreadable length is null rather than zero', () => {
  expect(lengthOf('504.0m')).toBeCloseTo(504, 6);
  expect(lengthOf('1650ft')).toBeCloseTo(1650 * 0.3048, 6);
  expect(lengthOf('504')).toBeCloseTo(504, 6);       // bare = metres, as every format writes
  expect(lengthOf('')).toBeNull();
  expect(lengthOf('n/a')).toBeNull();
});

test('a description full of commas does not shred the row', () => {
  const p = parseCup(CUP).pois.find(x => x.name === 'Champ Nord')!;
  expect(p.desc).toBe('Outlanding, flat, watch the wires');
  expect(p.cat).toBe('outlanding');
  expect(csvCells('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
});

test('the runway and the frequency reach the caller — a landable is checked before it is used', () => {
  const ost = parseCup(CUP).pois.find(p => p.name === 'Oostende')!;
  expect(ost.rwdirDeg).toBe(82);
  expect(ost.rwlenM).toBeCloseTo(3200, 6);
  expect(ost.freq).toBe('119.850');                  // a STRING: it is dialled, not computed
  expect(ost.elevM).toBeCloseTo(4, 6);
});

test('landable is four categories, stated as data — and a summit is not one of them', () => {
  expect(LANDABLE_CATS.length).toBe(4);
  expect(isLandable('airfield-gliding')).toBe(true);
  expect(isLandable('outlanding')).toBe(true);
  expect(isLandable('summit')).toBe(false);
  expect(isLandable('obstacle')).toBe(false);
  expect(isLandable('waypoint')).toBe(false);
  expect(landablesOf(parseCup(CUP).pois).map(p => p.name))
    .toEqual(['Oostende', 'Saint-Auban', 'Champ Nord']);
});

test('an unknown style code is a waypoint — never something a pilot might land on', () => {
  expect(catOfCupStyle(99)).toBe('waypoint');
  expect(catOfCupStyle(null)).toBe('waypoint');
  expect(isLandable(catOfCupStyle(99))).toBe(false);
});

test('a row that cannot be understood is DROPPED and COUNTED, never guessed at', () => {
  const bad = [
    'name,code,country,lat,lon,elev,style',
    '"Good","G","FR",4500.000N,00600.000E,500.0m,4',
    '"NoPosition","N","FR",,,,4',
    'too,few',
  ].join('\n');
  const { pois, refused } = parseCup(bad);
  expect(pois.length).toBe(1);
  expect(refused).toBe(2);                           // the pilot can be told "1 loaded, 2 refused"
});

// ---- WinPilot ----

const DAT = [
  '* a comment line',
  '1,51:07.830N,002:49.750E,504.0m,AT,Oostende,Airport',
  '2,44:02.900N,005:59.700E,459.0m,L,Champ Sud,Outlanding',
  '3,44:30.000N,005:30.000E,1200.0m,T,Turn,Turnpoint only',
].join('\n');

test('WinPilot .dat/.wpt reads through the same door, into the same type', () => {
  const { pois, refused } = parseWinPilot(DAT);
  expect(refused).toBe(0);
  expect(pois.length).toBe(3);
  expect(pois[0].cat).toBe('airfield-grass');        // 'A' promises no hard surface, so we do not
  expect(pois[1].cat).toBe('outlanding');            // 'L' = landable
  expect(pois[2].cat).toBe('waypoint');              // 'T' = a turnpoint, not a place to land
  expect(pois[0].elevM).toBeCloseTo(504, 6);
  expect(landablesOf(pois).length).toBe(2);
});

test('the format is sniffed from the CONTENT — a pilot renames files', () => {
  expect(sniffPoiFormat(CUP)).toBe('cup');
  expect(sniffPoiFormat(DAT)).toBe('winpilot');
  // And the one door routes both to the same shape.
  expect(parsePoiFile(CUP).pois[0].name).toBe('Oostende');
  expect(parsePoiFile(DAT).pois[0].name).toBe('Oostende');
  expect(parsePoiFile(DAT, 'winpilot').pois.length).toBe(3);
});

test('an empty file is an empty list, not a throw', () => {
  expect(parsePoiFile('')).toEqual({ pois: [], refused: 0 });
  expect(parsePoiFile('\n\n')).toEqual({ pois: [], refused: 0 });
});
