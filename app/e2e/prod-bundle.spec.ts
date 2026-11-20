import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/** The production build must not contain the fake server or fake authenticator (they exist only in `--mode fake`). */
test('the production bundle has no fake server or authenticator', () => {
  const assets = join(import.meta.dirname, '..', 'dist', 'assets');
  const files = readdirSync(assets).filter((f) => f.endsWith('.js'));
  expect(files.length).toBeGreaterThan(0);
  const markers = ['BB_FAKE_AUTHENTICATOR_MARKER', '__bbFake', 'FakeAuthenticator', 'FakeServer', 'fake-attestation', 'fake-public-key', 'ABCD-1234-ABCD-1234'];
  for (const f of files) {
    const text = readFileSync(join(assets, f), 'utf8');
    for (const m of markers) expect(text.includes(m), `${f} contains ${m}`).toBe(false);
  }
});

test('the test build does contain them (so the check above can fail)', () => {
  const assets = join(import.meta.dirname, '..', 'dist-fake', 'assets');
  const all = readdirSync(assets)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(assets, f), 'utf8'))
    .join('\n');
  expect(all).toContain('BB_FAKE_AUTHENTICATOR_MARKER');
});
