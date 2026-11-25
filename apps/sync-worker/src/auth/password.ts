const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const DERIVED_KEY_BYTES = 32;

export interface PasswordHash {
  readonly algorithm: 'PBKDF2-SHA-256';
  readonly iterations: number;
  readonly salt: string;
  readonly hash: string;
}

const toBase64 = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes));

const fromBase64 = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

const derive = async (
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> => {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as unknown as BufferSource, iterations },
    material,
    DERIVED_KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
};

export const hashPassword = async (
  password: string,
  salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES)),
): Promise<PasswordHash> => ({
  algorithm: 'PBKDF2-SHA-256',
  iterations: PBKDF2_ITERATIONS,
  salt: toBase64(salt),
  hash: toBase64(await derive(password, salt, PBKDF2_ITERATIONS)),
});

export const verifyPassword = async (
  password: string,
  stored: PasswordHash,
): Promise<boolean> => {
  if (stored.algorithm !== 'PBKDF2-SHA-256') return false;

  const actual = await derive(
    password,
    fromBase64(stored.salt),
    stored.iterations,
  );
  const expected = fromBase64(stored.hash);
  if (actual.length !== expected.length) return false;

  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= (actual[index] ?? 0) ^ (expected[index] ?? 0);
  }
  return difference === 0;
};
