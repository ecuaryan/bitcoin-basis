import { describe, expect, test } from 'vitest';
import { createUuidV7, isUuidV7, uuidv7 } from '../src/uuidv7.ts';

const zeros = (bytes: Uint8Array): void => void bytes.fill(0);
const ones = (bytes: Uint8Array): void => void bytes.fill(0xff);

describe('uuidv7', () => {
  test('default generator gives valid, increasing, unique ids', () => {
    const ids = Array.from({ length: 2000 }, () => uuidv7());
    expect(ids.every(isUuidV7)).toBe(true);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
  test('encodes the injected clock in the first 48 bits', () => {
    const gen = createUuidV7({ now: () => 0x0123456789ab, random: zeros });
    expect(gen()).toBe('01234567-89ab-7000-8000-000000000000');
  });
  test('same millisecond: counter increases; clock going backwards still sorts after', () => {
    let t = 1_000;
    const gen = createUuidV7({ now: () => t, random: zeros });
    const a = gen();
    const b = gen();
    t = 500;
    const c = gen();
    expect(a < b && b < c).toBe(true);
    expect(b.slice(0, 13)).toBe(a.slice(0, 13));
    expect(c.slice(0, 13)).toBe(a.slice(0, 13));
  });
  test('counter overflow moves to the next millisecond', () => {
    const gen = createUuidV7({ now: () => 42, random: ones });
    const ids = Array.from({ length: 2100 }, () => gen());
    expect([...ids].sort()).toEqual(ids);
    expect(ids.every(isUuidV7)).toBe(true);
    expect(ids.at(-1)?.slice(0, 13)).toBe('00000000-002b');
  });
  test('a broken clock is a programmer error', () => {
    expect(() => createUuidV7({ now: () => -1 })()).toThrow(RangeError);
    expect(() => createUuidV7({ now: () => 1.5 })()).toThrow(RangeError);
    expect(() => createUuidV7({ now: () => 2 ** 48 })()).toThrow(RangeError);
  });
  test('isUuidV7 rejects other versions and uppercase', () => {
    expect(isUuidV7('01234567-89ab-4000-8000-000000000000')).toBe(false);
    expect(isUuidV7('01234567-89AB-7000-8000-000000000000')).toBe(false);
  });
});
