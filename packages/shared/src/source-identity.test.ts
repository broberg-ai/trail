/**
 * F275.1 — the identity has to be able to tell things apart. Every claim is
 * paired with its opposite, because "everything is the same source" and
 * "everything is different" both pass a one-sided test.
 */
import { test, describe, it, expect } from 'bun:test';
import { sourceIdentity, readIdentity, identityFromMetadata } from './source-identity.js';

test('LOAD-BEARING: same URL = same identity, different URL = different', () => {
  const a = identityFromMetadata(JSON.stringify({ connector: 'broberg-ai-site-sync', sourceUrl: 'https://broberg.ai/flagskibe/bid' }));
  const b = identityFromMetadata(JSON.stringify({ connector: 'broberg-ai-site-sync', sourceUrl: 'https://broberg.ai/flagskibe/bid' }));
  const c = identityFromMetadata(JSON.stringify({ sourceUrl: 'https://broberg.ai/flagskibe/andet' }));
  expect(a).toBe(b!);
  expect(a).not.toBe(c!);
  expect(a).toBe('url:https://broberg.ai/flagskibe/bid');
});

test('AC#2 NEGATIVE CONTROL: same FILENAME, different URL → DIFFERENT identity', () => {
  // This is the whole reason the identity must not be derived from the name.
  // Two sites can both serve index.md. This test must go red if anyone later
  // builds a page identity on the filename.
  const one = identityFromMetadata(JSON.stringify({ sourceUrl: 'https://a.dk/index' }));
  const two = identityFromMetadata(JSON.stringify({ sourceUrl: 'https://b.dk/index' }));
  expect(one).not.toBe(two!);
  expect(one).not.toBeNull();
  expect(two).not.toBeNull();
});

test('THE THIRD STATE: no sourceUrl yields NULL, not a guess', () => {
  // "We do not know" must never degrade into "new source" — the supersession
  // rule would then stay silent about exactly the cases it exists for.
  expect(identityFromMetadata(null)).toBeNull();
  expect(identityFromMetadata('')).toBeNull();
  expect(identityFromMetadata('{ not json')).toBeNull();
  expect(identityFromMetadata(JSON.stringify({ connector: 'upload' }))).toBeNull();
  expect(identityFromMetadata(JSON.stringify({ sourceUrl: 42 }))).toBeNull();
});

test('THE PREFIX keeps two identity spaces apart', () => {
  // Without it a file path and a URL could collide, and the collision would
  // look like "same source" — the feature's own failure, produced by its own
  // field.
  expect(sourceIdentity('url', '/a/b')).not.toBe(sourceIdentity('path', '/a/b')!);
});

test('an EMPTY value is not an identity', () => {
  // A prefix in front of nothing would look valid in every comparison, and two
  // sources with no identity would become "the same one".
  for (const v of ['', '   ', null, undefined]) expect(sourceIdentity('url', v)).toBeNull();
});

test('readIdentity splits it back apart — and rejects an unknown space', () => {
  expect(readIdentity('url:https://a.dk')).toEqual({ space: 'url', value: 'https://a.dk' });
  expect(readIdentity('path:/x/y.md')).toEqual({ space: 'path', value: '/x/y.md' });
  // NEGATIVE CONTROL: without it, "read anything at all" would pass just as green.
  expect(readIdentity('nonsense:abc')).toBeNull();
  expect(readIdentity('no-colon')).toBeNull();
  expect(readIdentity('url:')).toBeNull();
  expect(readIdentity(null)).toBeNull();
});

// bun:test — same runner as the rest of the package's tests
describe('F275.1 — two spellings of the same URL are ONE identity', () => {
  it('THE MEASURED CASE: æøå literal and percent-encoded give the same identity', () => {
    // Found in production on 17 Sept, inside the feature's own key. The same
    // page was stored under two identities, and supersession would have read an
    // edit of it as a foreign source.
    const a = sourceIdentity('url', 'https://broberg.ai/indsigter/design-i-højere-luftlag');
    const b = sourceIdentity('url', 'https://broberg.ai/indsigter/design-i-h%C3%B8jere-luftlag');
    expect(a).toBe(b);
    expect(a).toBe('url:https://broberg.ai/indsigter/design-i-h%C3%B8jere-luftlag');
  });

  it('the host is lowercased — but the PATH keeps its capitals', () => {
    // Hosts are case-insensitive; paths ARE case-sensitive. A normalisation that
    // lowercased both would melt two different pages into one.
    expect(sourceIdentity('url', 'https://BROBERG.AI/Indsigter')).toBe('url:https://broberg.ai/Indsigter');
    expect(sourceIdentity('url', 'https://broberg.ai/a')).not.toBe(sourceIdentity('url', 'https://broberg.ai/A'));
  });

  it('%2F does NOT become a slash — that would change the meaning of the path', () => {
    expect(sourceIdentity('url', 'https://x.dk/a%2Fb')).toBe('url:https://x.dk/a%2Fb');
    expect(sourceIdentity('url', 'https://x.dk/a%2Fb')).not.toBe(sourceIdentity('url', 'https://x.dk/a/b'));
  });

  it('a value that is NOT a URL is kept as-is — not dropped', () => {
    // "Could not be normalised" must never become "has no source".
    expect(sourceIdentity('url', 'not a url')).toBe('url:not a url');
  });

  it('only the `url` space is normalised — a path is not a URL', () => {
    expect(sourceIdentity('path', 'kb/Rapport.PDF')).toBe('path:kb/Rapport.PDF');
  });

  it('query string and fragment survive', () => {
    expect(sourceIdentity('url', 'https://x.dk/a?b=1&c=2#d')).toBe('url:https://x.dk/a?b=1&c=2#d');
  });
});
