/**
 * F201.10 — modprøver for enheds-stemplet.
 *
 * Hver prøve har sin makker i den anden retning, så en funktion der altid
 * svarer det samme ikke kan bestå ved et uheld.
 */
import { describe, expect, test } from 'bun:test';
import { deviceNameFromKeyName, stampAmbientDevice } from './ambient-device.js';

describe('deviceNameFromKeyName', () => {
  test('device-auth-formen giver enhedsnavnet', () => {
    expect(deviceNameFromKeyName('ambient:Christians MacBook:1a2b3c4d')).toBe('Christians MacBook');
  });
  test('et kolon INDE i enhedsnavnet overlever', () => {
    // Et split på kolon ville have givet «Mac» og smidt resten væk.
    expect(deviceNameFromKeyName('ambient:Mac: Studio:1a2b3c4d')).toBe('Mac: Studio');
  });
  test('et frit nøglenavn uden præfiks og hale returneres uændret', () => {
    expect(deviceNameFromKeyName('helpdesk')).toBe('helpdesk');
  });
});

describe('stampAmbientDevice', () => {
  const dev = { keyId: 'k1', name: 'Mac A' };

  test('lægger device ind og bevarer klientens egne felter', () => {
    const r = stampAmbientDevice(JSON.stringify({ connector: 'trail-ambient-capture', capturedAt: 'x' }), dev);
    expect(r.stamped).toBe(true);
    expect(JSON.parse(r.metadata)).toEqual({ connector: 'trail-ambient-capture', capturedAt: 'x', device: dev });
  });

  test('OVERSKRIVER en device klienten selv har påstået', () => {
    const r = stampAmbientDevice(JSON.stringify({ device: { keyId: 'fake', name: 'Mac B' } }), dev);
    expect(JSON.parse(r.metadata).device).toEqual(dev);
  });

  test('ingen metadata giver et objekt med kun device', () => {
    expect(JSON.parse(stampAmbientDevice(null, dev).metadata)).toEqual({ device: dev });
  });

  test('metadata der ikke er et objekt røres ikke — og det siges', () => {
    const r = stampAmbientDevice('[1,2,3]', dev);
    expect(r.stamped).toBe(false);
    expect(r.metadata).toBe('[1,2,3]');
  });
});
