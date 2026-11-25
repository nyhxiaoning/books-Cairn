import { expect, test } from 'bun:test';
import { hashPassword, verifyPassword } from '../../src/auth/password';

test('hashPassword and verifyPassword round-trip a password', async () => {
  const stored = await hashPassword('correct horse battery staple');

  expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
  expect(await verifyPassword('wrong password', stored)).toBe(false);
});

test('password hashes use a salt and do not contain the password', async () => {
  const first = await hashPassword('same password');
  const second = await hashPassword('same password');

  expect(first.salt).not.toBe(second.salt);
  expect(first.hash).not.toContain('same password');
  expect(first).not.toHaveProperty('password');
});
