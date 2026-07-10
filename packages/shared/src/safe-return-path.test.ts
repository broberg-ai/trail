/**
 * F201.17 — open-redirect guard for the post-login returnTo path. These reject
 * cases are the RED test: if the validator ever starts accepting an off-site or
 * scheme-bearing target, login becomes an open-redirect and this fails in CI.
 */
import { expect, test } from 'bun:test';
import { safeReturnPath } from './safe-return-path.js';

test('accepts a real Neuron deep-link path', () => {
  expect(safeReturnPath('/kb/019f2333-a1b9/neurons/split-brain')).toBe('/kb/019f2333-a1b9/neurons/split-brain');
});

test('accepts other in-app paths (with query)', () => {
  expect(safeReturnPath('/kb/abc/neurons?tag=trail')).toBe('/kb/abc/neurons?tag=trail');
  expect(safeReturnPath('/wikis')).toBe('/wikis');
});

test('rejects protocol-relative and backslash off-site tricks', () => {
  expect(safeReturnPath('//evil.com')).toBeNull();
  expect(safeReturnPath('/\\evil.com')).toBeNull();
  expect(safeReturnPath('/\\/evil.com')).toBeNull();
});

test('rejects absolute URLs / schemes', () => {
  expect(safeReturnPath('https://evil.com')).toBeNull();
  expect(safeReturnPath('http://evil.com')).toBeNull();
  expect(safeReturnPath('/javascript:alert(1)')).toBeNull();
  expect(safeReturnPath('/redirect?to=https://evil.com')).toBeNull(); // contains ://
});

test('rejects the login / api / auth surfaces (loop / non-page)', () => {
  expect(safeReturnPath('/login')).toBeNull();
  expect(safeReturnPath('/login?returnTo=/x')).toBeNull();
  expect(safeReturnPath('/api/v1/me')).toBeNull();
  expect(safeReturnPath('/auth/verify')).toBeNull();
});

test('rejects control-char / header-splitting attempts', () => {
  expect(safeReturnPath('/kb/a' + String.fromCharCode(10) + 'Set-Cookie: x')).toBeNull();
  expect(safeReturnPath('/kb/a' + String.fromCharCode(13) + '/b')).toBeNull();
  expect(safeReturnPath('/kb/a' + String.fromCharCode(0))).toBeNull();
});

test('rejects non-strings, empty, non-absolute, and over-long', () => {
  expect(safeReturnPath(undefined)).toBeNull();
  expect(safeReturnPath(null)).toBeNull();
  expect(safeReturnPath(42)).toBeNull();
  expect(safeReturnPath('')).toBeNull();
  expect(safeReturnPath('kb/no-leading-slash')).toBeNull();
  expect(safeReturnPath('/' + 'a'.repeat(2000))).toBeNull();
});
