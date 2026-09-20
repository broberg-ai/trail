/**
 * F212.3 — GRÆNSERNE, DREVET AF INDSATTE TAL.
 *
 * Kravet er at 79/81 og 89/91 begge asserteres UDEN at fylde en disk. Det
 * er derfor `readDiskUsage` (som rører filsystemet) og `bandOf` /
 * `diskAlarmFor` (som afgør) er skilt: beslutningen kan drives med et tal,
 * og den ene funktion der læser en rigtig disk har sin egen prøve.
 *
 * DEN VIGTIGSTE PÅSTAND ER IKKE EN GRÆNSE. Den er at beskeden IKKE bærer
 * den øjeblikkelige procent. Målt mod Upmetrics' levende API 20/9 2026:
 *
 *   3 ENS fejl fra ét kaldested        → 1 issue
 *   3 FORSKELLIGE fejl, samme kaldested → 1 issue, og titlen er FØRSTE
 *                                          hændelses tekst
 *
 * Grupperingen er det der giver «ét åbent issue, ikke ét pr. time» gratis
 * — anti-spam-kravet skal altså ikke bygges. Men den betyder også at en
 * titel med et momentant tal FRYSER: et issue rejst ved 91 % ville stadig
 * sige «91 %» når disken er på 99 %. Det er en alarm der lyver, og det er
 * netop den fejlform epicen findes for. Derfor: bandet og tærsklen i
 * beskeden, det levende tal i tags og i log-linjen.
 *
 * MUTATIONS-TJEK, kørt 20. september 2026. Baseline 9/9 grønne:
 *   - `usedPercent > CRITICAL` → `>=`            8 pass / 1 fail
 *       rød: «præcis 90,0 % er endnu ikke kritisk».
 *   - `usedPercent > WARN` → `>=`                8 pass / 1 fail
 *       rød: «præcis 80,0 % er endnu ikke en advarsel».
 *   - byt CRITICAL og WARN i `bandOf`            6 pass / 3 fail
 *   - sæt procenten ind i `message`              7 pass / 2 fail
 *       rød: «beskeden bærer IKKE det momentane tal» OG «stien står i
 *       beskeden». Det er mutationen der ville give et frossent,
 *       løgnagtigt issue-titel.
 *   - `s.bavail` → `s.bfree` i readDiskUsage     9 pass / 0 fail
 *       GRØN, og det siges her frem for at blive udeladt: forskellen er
 *       den root-reserverede slack, som er 0 på denne Macs volumen og på
 *       en Fly-volumen. Prøven kan ikke skelne dem; valget er begrundet i
 *       koden (motoren skriver som en ikke-privilegeret bruger) og er
 *       ikke afprøvet.
 */
import { test, expect } from 'bun:test';
import {
  bandOf,
  diskAlarmFor,
  readDiskUsage,
  runDiskCheck,
  CRITICAL_PERCENT,
  WARN_PERCENT,
  type DiskUsage,
} from './disk-guard.js';

const usage = (usedPercent: number): DiskUsage => ({
  totalBytes: 20 * 1024 ** 3,
  freeBytes: Math.round((20 * 1024 ** 3) * (1 - usedPercent / 100)),
  usedPercent,
});

test('under advarslen er der ingen alarm', () => {
  expect(bandOf(0)).toBe('ok');
  expect(bandOf(40)).toBe('ok'); // volumens tilstand i juni
  expect(bandOf(79)).toBe('ok');
  expect(diskAlarmFor('/data', usage(79))).toBe(null);
});

test('præcis 80,0 % er endnu ikke en advarsel — 80,1 er', () => {
  expect(bandOf(WARN_PERCENT)).toBe('ok');
  expect(bandOf(WARN_PERCENT + 0.1)).toBe('warning');
  expect(bandOf(81)).toBe('warning');
});

test('præcis 90,0 % er endnu ikke kritisk — 90,1 er', () => {
  expect(bandOf(CRITICAL_PERCENT)).toBe('warning');
  expect(bandOf(CRITICAL_PERCENT + 0.1)).toBe('critical');
  expect(bandOf(91)).toBe('critical');
});

test('99,8 % — den tilstand der tog motoren ned — er kritisk', () => {
  const alarm = diskAlarmFor('/data', usage(99.8))!;
  expect(alarm.band).toBe('critical');
  expect(alarm.usedPercent).toBe(99.8);
});

test('beskeden bærer IKKE det momentane tal — kun bandet og tærsklen', () => {
  // Issue-titlen fryser ved første hændelse (målt), så et tal her ville
  // blive en forældet påstand mens issuet stadig er åbent.
  const a = diskAlarmFor('/data', usage(91))!;
  const b = diskAlarmFor('/data', usage(99.8))!;
  expect(a.message).toBe(b.message);
  expect(a.message).toContain('over 90%');
  expect(a.message).not.toContain('91');
  expect(b.message).not.toContain('99');
  // Men tallet er BEVARET på alarmen, så log og tags kan vise det.
  expect(a.usedPercent).toBe(91);
  expect(b.usedPercent).toBe(99.8);
});

test('advarsel og kritisk er TO forskellige beskeder — ellers ét fælles issue', () => {
  const warn = diskAlarmFor('/data', usage(85))!;
  const crit = diskAlarmFor('/data', usage(95))!;
  expect(warn.message).not.toBe(crit.message);
  expect(warn.message).toContain('over 80%');
  expect(crit.message).toContain('over 90%');
});

test('stien står i beskeden — to volumener må ikke blive ét issue', () => {
  const a = diskAlarmFor('/data', usage(95))!;
  const b = diskAlarmFor('/var/lib/sqld', usage(95))!;
  expect(a.message).toContain('/data');
  expect(b.message).toContain('/var/lib/sqld');
  expect(a.message).not.toBe(b.message);
});

test('readDiskUsage læser en RIGTIG disk og giver sammenhængende tal', () => {
  const u = readDiskUsage(process.cwd());
  expect(u.totalBytes).toBeGreaterThan(0);
  expect(u.freeBytes).toBeGreaterThanOrEqual(0);
  expect(u.freeBytes).toBeLessThanOrEqual(u.totalBytes);
  expect(u.usedPercent).toBeGreaterThanOrEqual(0);
  expect(u.usedPercent).toBeLessThanOrEqual(100);
  // Og procenten følger FAKTISK af de to tal — ikke et separat felt der
  // kunne drifte fra dem.
  const derived = 100 * (1 - u.freeBytes / u.totalBytes);
  expect(Math.abs(u.usedPercent - derived)).toBeLessThan(0.0001);
});

test('en sti der ikke kan læses kaster — den må ikke svare «fin»', () => {
  expect(() => readDiskUsage('/no/such/path/f212-3')).toThrow();
  // Og vagtens egen løkke fanger det og logger; den svarer ikke ok.
  expect(() => runDiskCheck('/no/such/path/f212-3')).toThrow();
});
