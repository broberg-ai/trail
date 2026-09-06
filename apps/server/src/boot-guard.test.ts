/**
 * F258 — en baggrunds-fejning må aldrig vælte betjeningen.
 *
 * MÅLT 6/9 2026 med produktionen NEDE:
 *     TimeoutError: The operation timed out.
 *     Main child exited normally with code: 1
 *     [ 308.349265] reboot: Restarting system
 *
 * Fejningerne var pakket i try/catch. Det hjalp ikke: libsqls timeout ankom
 * som en AFVIST PROMISE uden for det await der blev fanget, og Bun afslutter
 * processen ved en ubehandlet afvisning.
 */
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

const boot = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

test('MOTOREN HAR EN VAGT MOD UBEHANDLEDE AFVISNINGER', () => {
  expect(boot).toContain("process.on('unhandledRejection'");
});

test('vagten står FØR fejningerne startes', () => {
  // En vagt der registreres efter det den skal beskytte, dækker ikke det
  // vindue hvor fejlen faktisk skete.
  const iVagt = boot.indexOf("process.on('unhandledRejection'");
  const iFejning = boot.indexOf('bootTenantDeferred(slug, db)');
  expect(iVagt).toBeGreaterThan(-1);
  expect(iFejning).toBeGreaterThan(-1);
  expect(iVagt).toBeLessThan(iFejning);
});

test('den fanger IKKE uncaughtException — det er en anden sag', () => {
  // Ved en uncaughtException kan tilstanden være korrupt, og at køre videre er
  // værre end at genstarte. En afvist promise fra et baggrundskald er ikke
  // korrupt tilstand; den er bare noget der ikke blev færdigt.
  expect(boot).not.toContain("process.on('uncaughtException'");
});

test('vagten LOGGER — en tavs vagt er en skjult fejl', () => {
  const blok = boot.slice(boot.indexOf("process.on('unhandledRejection'"), boot.indexOf("process.on('unhandledRejection'") + 400);
  expect(blok).toContain('console.error');
});
