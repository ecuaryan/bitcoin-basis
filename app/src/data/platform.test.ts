import { describe, expect, it } from 'vitest';
import { detectPlatform, unlockButtonLabel } from './platform.ts';

const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

describe('detectPlatform', () => {
  it('reads user agent hints first, then the user agent string', () => {
    expect(detectPlatform({ uaDataPlatform: 'Android' })).toBe('android');
    expect(detectPlatform({ uaDataPlatform: 'macOS', userAgent: MAC, maxTouchPoints: 0 })).toBe('macos');
    expect(detectPlatform({ userAgent: ANDROID })).toBe('android');
    expect(detectPlatform({ userAgent: MAC })).toBe('macos');
    expect(detectPlatform({ userAgent: IPHONE })).toBe('ios');
    expect(detectPlatform({ userAgent: WINDOWS })).toBe('windows');
    expect(detectPlatform({ userAgent: 'curl/8', uaDataPlatform: 'Linux' })).toBe('other');
    expect(detectPlatform({})).toBe('other');
  });
  it('an iPad that calls itself a Mac is iOS (it has a touch screen)', () => {
    expect(detectPlatform({ userAgent: MAC, maxTouchPoints: 5 })).toBe('ios');
  });
});

describe('unlockButtonLabel', () => {
  it('says what the person will actually do', () => {
    expect(unlockButtonLabel('android')).toBe('Unlock with fingerprint or screen lock');
    expect(unlockButtonLabel('macos')).toBe('Unlock with Touch ID');
    expect(unlockButtonLabel('ios')).toBe('Unlock with Face ID');
    expect(unlockButtonLabel('windows')).toBe('Unlock with passkey');
    expect(unlockButtonLabel('other')).toBe('Unlock with passkey');
  });
  it('never mentions Face ID or Touch ID anywhere but iPhone and Mac', () => {
    for (const p of ['android', 'windows', 'other'] as const) expect(unlockButtonLabel(p)).not.toMatch(/Face ID|Touch ID/);
    expect(unlockButtonLabel('macos')).not.toMatch(/Face ID/);
    expect(unlockButtonLabel('ios')).not.toMatch(/Touch ID/);
  });
});
