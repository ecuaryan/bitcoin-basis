/**
 * What kind of device this is, from the browser's own hints, so the unlock button can say what the
 * person will actually be asked to do (fingerprint, Touch ID, Face ID...). Wording only: no
 * behavior depends on it, and an unknown device gets the neutral "Unlock with passkey".
 */
export type Platform = 'android' | 'ios' | 'macos' | 'windows' | 'other';

export interface PlatformHints {
  readonly userAgent?: string | undefined;
  /** `navigator.userAgentData?.platform` (Chromium): "Android", "macOS", "Windows", "Chrome OS", "Linux". */
  readonly uaDataPlatform?: string | undefined;
  readonly maxTouchPoints?: number | undefined;
}

export function detectPlatform(hints: PlatformHints): Platform {
  const hint = (hints.uaDataPlatform ?? '').toLowerCase();
  const ua = hints.userAgent ?? '';
  // Android first: some Android user agents also say "Linux" and, in desktop mode, "X11".
  if (hint === 'android' || /Android/i.test(ua)) return 'android';
  if (hint === 'ios' || /iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (hint === 'macos' || /Macintosh|Mac OS X/i.test(ua)) {
    // iPadOS in desktop mode calls itself a Mac but has a touch screen; a real Mac has none.
    return (hints.maxTouchPoints ?? 0) > 1 ? 'ios' : 'macos';
  }
  if (hint === 'windows' || /Windows/i.test(ua)) return 'windows';
  return 'other';
}

export function currentPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return detectPlatform({ userAgent: nav.userAgent, uaDataPlatform: nav.userAgentData?.platform, maxTouchPoints: nav.maxTouchPoints });
}

/** The words on the one big unlock button. Face ID only on iPhone, Touch ID only on a Mac, never either on Android. */
export function unlockButtonLabel(platform: Platform): string {
  switch (platform) {
    case 'android':
      return 'Unlock with fingerprint or screen lock';
    case 'ios':
      return 'Unlock with Face ID';
    case 'macos':
      return 'Unlock with Touch ID';
    default:
      return 'Unlock with passkey';
  }
}

/** Where to find "Add to Home Screen" and the like. */
export function isIos(platform: Platform): boolean {
  return platform === 'ios';
}
