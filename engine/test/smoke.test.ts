import { expect, test } from 'vitest';
import { ENGINE_VERSION } from '../src/index.ts';
test('engine loads', () => expect(ENGINE_VERSION).toBe(1));
