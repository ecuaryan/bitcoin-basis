import { longDate } from './format.ts';

export interface BuildInfo {
  version: string;
  /** Full commit hash, or `dev` for a build made without git. */
  sha: string;
  /** The commit's date, ISO (`2026-11-21T00:37:15-07:00`); empty without git. */
  date: string;
}

export const REPO_URL = 'https://github.com/ecuaryan/bitcoin-basis';
export const VERIFY_URL = `${REPO_URL}/blob/main/docs/deploy.md#verifying-a-deployment`;

export interface VersionLine {
  version: string;
  build: string;
  date: string | null;
  /** The commit on GitHub, or null for a `dev` build. */
  commitUrl: string | null;
}

/** `Version 1.0.0 · build 047e565 · Nov 21, 2026`, in parts so the build can be a link. */
export function versionLine(b: BuildInfo): VersionLine {
  const real = /^[0-9a-f]{40}$/.test(b.sha);
  const day = /^\d{4}-\d{2}-\d{2}/.exec(b.date)?.[0] ?? null;
  return { version: `Version ${b.version}`, build: real ? `build ${b.sha.slice(0, 7)}` : 'build dev', date: day === null ? null : longDate(day), commitUrl: real ? `${REPO_URL}/commit/${b.sha}` : null };
}

/** This build. In tests (no Vite define) it reads as a dev build. */
export const BUILD: BuildInfo = typeof __BB_BUILD__ === 'undefined' ? { version: '0.0.0', sha: 'dev', date: '' } : __BB_BUILD__;
