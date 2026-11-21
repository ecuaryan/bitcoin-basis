import { describe, expect, test } from 'vitest';
import { serviceWorkerUrl, SW_POLICY, SW_URL } from './register-sw.ts';

describe('service worker Trusted Types policy', () => {
  test('creates the `sw` policy, which allows only /sw.js', () => {
    let rules: { createScriptURL: (s: string) => string } | null = null;
    const names: string[] = [];
    const tt = {
      createPolicy(name: string, r: { createScriptURL: (s: string) => string }) {
        names.push(name);
        rules = r;
        return { createScriptURL: (s: string) => ({ trusted: r.createScriptURL(s) }) };
      },
    };
    expect(serviceWorkerUrl(tt)).toEqual({ trusted: SW_URL });
    expect(names).toEqual([SW_POLICY]);
    const r = rules as unknown as { createScriptURL: (s: string) => string };
    expect(() => r.createScriptURL('/evil.js')).toThrow(TypeError);
    expect(() => r.createScriptURL('https://evil.example/sw.js')).toThrow(TypeError);
  });

  test('without Trusted Types, the plain URL', () => {
    expect(serviceWorkerUrl(undefined)).toBe(SW_URL);
  });
});
