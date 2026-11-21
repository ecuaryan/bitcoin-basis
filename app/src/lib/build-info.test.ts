import { describe, expect, it } from 'vitest';
import { versionLine } from './build-info.ts';

describe('versionLine', () => {
  it('shows the version, a short build and the commit date, and links the commit', () => {
    const v = versionLine({ version: '1.0.0', sha: '047e56522b615eeb0472b6db542224e9a571c0d9', date: '2026-11-21T00:37:15-07:00' });
    expect(v).toEqual({ version: 'Version 1.0.0', build: 'build 047e565', date: 'Nov 21, 2026', commitUrl: 'https://github.com/ecuaryan/bitcoin-basis/commit/047e56522b615eeb0472b6db542224e9a571c0d9' });
  });
  it('says dev without git, and links nothing', () => {
    expect(versionLine({ version: '1.0.0', sha: 'dev', date: '' })).toEqual({ version: 'Version 1.0.0', build: 'build dev', date: null, commitUrl: null });
  });
});
