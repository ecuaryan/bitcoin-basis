/**
 * True only in a build made with `vite build --mode fake` (the end-to-end test build). Vite replaces
 * it with the literal `false` in every other build, so the fake server and authenticator are
 * removed from the bundle as dead code. See vite.config.ts and e2e/prod-bundle.spec.ts.
 */
declare const __BB_FAKE__: boolean;
