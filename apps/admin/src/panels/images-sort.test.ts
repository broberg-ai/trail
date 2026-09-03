/**
 * F227 — the image list's sort rules.
 *
 * Written against the ways this goes subtly wrong rather than against "does it
 * sort": a missing value treated as zero, size compared on one dimension, and
 * a second sort reshuffling rows that tied on the first.
 */
import { expect, test } from 'bun:test';
import { sortHits, type SortKey } from './images-sort.js';

type H = Parameters<typeof sortHits>[0][number];
const img = (o: Partial<H>): H =>
  ({ id: o.id ?? 'x', documentId: 'd', filename: 'f', url: '', thumbnailUrl: null,
     alt: '', page: null, width: 0, height: 0, visionModel: null, createdAt: '',
     autoFlagSignal: false, autoFlagReason: null, userFlagged: false, ...o }) as H;
const ids = (hits: H[]) => hits.map((h) => h.id);
const s = (hits: H[], key: SortKey, dir: 'asc' | 'desc') => ids(sortHits(hits, { key, dir }));

test('no sort selected leaves the server order untouched', () => {
  const hits = [img({ id: 'b' }), img({ id: 'a' })];
  expect(ids(sortHits(hits, null))).toEqual(['b', 'a']);
});

test('page sorts numerically, both directions', () => {
  const hits = [img({ id: '10', page: 10 }), img({ id: '2', page: 2 }), img({ id: '1', page: 1 })];
  expect(s(hits, 'page', 'asc')).toEqual(['1', '2', '10']);
  expect(s(hits, 'page', 'desc')).toEqual(['10', '2', '1']);
});

test('NEGATIVE CONTROL — a missing page sorts LAST in BOTH directions', () => {
  // Treating null as 0 would put every page-less image first on an ascending
  // sort, which reads as a result rather than as absent data.
  const hits = [img({ id: 'none', page: null }), img({ id: 'p5', page: 5 }), img({ id: 'p1', page: 1 })];
  expect(s(hits, 'page', 'asc')).toEqual(['p1', 'p5', 'none']);
  expect(s(hits, 'page', 'desc')).toEqual(['p5', 'p1', 'none']);
});

test('size sorts on AREA, not on width', () => {
  // The case that decides it: a 2000x10 divider rule is the WIDEST and the
  // second-smallest. Sorting on width would put it at the top.
  const hits = [
    img({ id: 'rule', width: 2000, height: 10 }),   // 20.000
    img({ id: 'figure', width: 400, height: 400 }), // 160.000
    img({ id: 'bullet', width: 20, height: 20 }),   // 400
  ];
  expect(s(hits, 'size', 'desc')).toEqual(['figure', 'rule', 'bullet']);
  expect(s(hits, 'size', 'asc')).toEqual(['bullet', 'rule', 'figure']);
});

test('an image with no dimensions sorts last, not as zero', () => {
  const hits = [img({ id: 'unknown', width: 0, height: 0 }), img({ id: 'small', width: 20, height: 20 })];
  expect(s(hits, 'size', 'asc')).toEqual(['small', 'unknown']);
  expect(s(hits, 'size', 'desc')).toEqual(['small', 'unknown']);
});

test('description sorts case-insensitively; undescribed rows sink', () => {
  const hits = [img({ id: 'z', alt: 'zebra' }), img({ id: 'none', alt: '' }), img({ id: 'a', alt: 'Apple' })];
  expect(s(hits, 'description', 'asc')).toEqual(['a', 'z', 'none']);
});

test('whitespace-only description counts as absent, not as the smallest string', () => {
  const hits = [img({ id: 'blank', alt: '   ' }), img({ id: 'a', alt: 'Apple' })];
  expect(s(hits, 'description', 'asc')).toEqual(['a', 'blank']);
});

test('the sort is STABLE — ties keep the order they arrived in', () => {
  const hits = [img({ id: 'first', page: 1 }), img({ id: 'second', page: 1 }), img({ id: 'third', page: 1 })];
  expect(s(hits, 'page', 'asc')).toEqual(['first', 'second', 'third']);
  expect(s(hits, 'page', 'desc')).toEqual(['first', 'second', 'third']);
});

test('sorting does not add or lose rows', () => {
  const hits = [img({ id: 'a', page: 3 }), img({ id: 'b', page: null }), img({ id: 'c', page: 1 })];
  for (const key of ['description', 'page', 'size'] as SortKey[]) {
    for (const dir of ['asc', 'desc'] as const) {
      expect(sortHits(hits, { key, dir }).length).toBe(3);
      expect(new Set(s(hits, key, dir))).toEqual(new Set(['a', 'b', 'c']));
    }
  }
});
