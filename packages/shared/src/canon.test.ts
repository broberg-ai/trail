/**
 * F275.2 — the two switches. These tests are written against the ACCEPTANCE
 * CRITERIA, not against the implementation: the hierarchy (AC#3), default ON
 * (AC#2), and the overridden state the user must be able to SEE.
 */
import { describe, it, expect } from 'vitest';
import {
  newEditionIsCanon,
  connectorState,
  readDisabledConnectors,
  writeDisabledConnectors,
} from './canon.js';

const ON = { brain: true, disabledConnectors: [] };

describe('F275.2 AC#2 — both switches default to ON', () => {
  it('a fresh Brain with no stored value supersedes', () => {
    expect(newEditionIsCanon(ON, 'broberg-ai-site-sync')).toEqual({ canon: true, reason: 'on' });
  });

  it('a connector never seen before is ON without anyone touching it', () => {
    // The heart of "store the disabled ones, not the enabled ones". Store the
    // enabled ones and this would be OFF — exactly the silent failure the card
    // forbids.
    const s = { brain: true, disabledConnectors: ['upload'] };
    expect(newEditionIsCanon(s, 'a-connector-just-invented').canon).toBe(true);
  });

  it('a source with NO connector follows the Brain switch', () => {
    expect(newEditionIsCanon(ON, null).canon).toBe(true);
    expect(newEditionIsCanon({ brain: false, disabledConnectors: [] }, null).canon).toBe(false);
  });
});

describe('F275.2 AC#3 — the hierarchy is unambiguous and runs one way only', () => {
  it('Brain OFF turns everything off, including a connector switched ON', () => {
    const s = { brain: false, disabledConnectors: [] };
    expect(newEditionIsCanon(s, 'broberg-ai-site-sync')).toEqual({ canon: false, reason: 'brain-off' });
  });

  it('Brain ON + connector OFF ⇒ only that connector is off', () => {
    const s = { brain: true, disabledConnectors: ['upload'] };
    expect(newEditionIsCanon(s, 'upload')).toEqual({ canon: false, reason: 'connector-off' });
    expect(newEditionIsCanon(s, 'broberg-ai-site-sync')).toEqual({ canon: true, reason: 'on' });
  });

  it('the REASON tells the two off-states apart', () => {
    // Without the reason the product cannot say WHICH switch stopped it, and
    // then the user cannot see what to turn back on.
    const both = newEditionIsCanon({ brain: false, disabledConnectors: ['upload'] }, 'upload');
    expect(both.reason).toBe('brain-off');
  });

  it('a connector switch on ON under a disabled Brain is OVERRIDDEN — and visibly so', () => {
    const s = connectorState({ brain: false, disabledConnectors: [] }, 'broberg-ai-site-sync');
    expect(s).toEqual({ ownSwitch: true, overriddenByBrain: true, effective: false });
  });

  it('a connector that is itself off is NOT "overridden" — it is simply off', () => {
    const s = connectorState({ brain: false, disabledConnectors: ['upload'] }, 'upload');
    expect(s).toEqual({ ownSwitch: false, overriddenByBrain: false, effective: false });
  });
});

describe('F275.2 — storage', () => {
  it('an empty list is stored as null so an untouched Brain stays clean', () => {
    expect(writeDisabledConnectors([])).toBeNull();
  });

  it('a round trip preserves the ids', () => {
    const json = writeDisabledConnectors(['upload', 'chat']);
    expect(readDisabledConnectors(json)).toEqual(['chat', 'upload']);
  });

  it('duplicates and empty strings fall away', () => {
    expect(readDisabledConnectors(writeDisabledConnectors(['upload', 'upload', '', '  ']))).toEqual(['upload']);
  });

  it('a CORRUPTED value means "nothing is disabled" — never "everything is disabled"', () => {
    // Error recovery must move toward the default state. Read nonsense as
    // "all off" and a corrupted column silently disables the feature for the
    // entire Brain.
    for (const value of ['not json', '{"upload":true}', '42', 'null', '']) {
      expect(readDisabledConnectors(value)).toEqual([]);
    }
    expect(readDisabledConnectors(null)).toEqual([]);
    expect(readDisabledConnectors(undefined)).toEqual([]);
  });

  it('non-strings in the list are discarded, the rest survives', () => {
    expect(readDisabledConnectors('["upload", 7, null, "chat"]')).toEqual(['upload', 'chat']);
  });
});
