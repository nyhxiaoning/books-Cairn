import { expect, test } from 'bun:test';
import { nextVersion, sameHash, validBaseVersion } from '../../src/sync/versions';

test('versions are monotonic and reject unsafe values', () => {
  expect(nextVersion(0)).toBe(1);
  expect(nextVersion(41)).toBe(42);
  expect(() => nextVersion(-1)).toThrow('invalid_version');
  expect(() => nextVersion(Number.MAX_SAFE_INTEGER)).toThrow('invalid_version');
});

test('base versions accept only non-negative safe integers', () => {
  expect(validBaseVersion(undefined)).toBe(true);
  expect(validBaseVersion(0)).toBe(true);
  expect(validBaseVersion(3)).toBe(true);
  expect(validBaseVersion(-1)).toBe(false);
  expect(validBaseVersion(1.5)).toBe(false);
  expect(validBaseVersion('3')).toBe(false);
});

test('same hashes make retries idempotent', () => {
  expect(sameHash(undefined, 'a'.repeat(64))).toBe(false);
  expect(sameHash('a'.repeat(64), 'a'.repeat(64))).toBe(true);
  expect(sameHash('a'.repeat(64), 'b'.repeat(64))).toBe(false);
});
