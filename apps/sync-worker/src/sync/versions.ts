export interface VersionedMutation {
  readonly baseVersion?: number;
}

export const validBaseVersion = (value: unknown): value is number =>
  value === undefined || (Number.isSafeInteger(value) && (value as number) >= 0);

export const nextVersion = (current: number): number => {
  if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) {
    throw new Error('invalid_version');
  }
  return current + 1;
};

export const sameHash = (left: string | undefined, right: string): boolean =>
  left !== undefined && left === right;
