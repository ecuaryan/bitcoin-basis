import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe('plain wording', () => {
  it('never says "carryforward" to the user (code names aside)', () => {
    const bad: string[] = [];
    for (const file of sources(__dirname)) {
      const text = readFileSync(file, 'utf8').replace(/\w*[cC]arryforward\w*/g, '');
      if (/carry[- ]?forward/i.test(text)) bad.push(file);
    }
    expect(bad).toEqual([]);
  });
});
