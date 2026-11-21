import { expect, test } from '@playwright/test';

// The rest of the suite blocks service workers; this one checks that the production build registers
// its service worker under its own strict CSP (require-trusted-types-for 'script' + trusted-types sw).
test.use({ serviceWorkers: 'allow' });

test('the service worker registers under the production CSP (Trusted Types)', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/TrustedScriptURL|Trusted Type|Content Security Policy/i.test(m.text()) && !/frame-ancestors/.test(m.text())) violations.push(m.text());
  });
  await page.goto('/');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("require-trusted-types-for 'script'");
  expect(csp).toContain('trusted-types sw');
  const scriptURL = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.active?.scriptURL ?? null;
  });
  expect(scriptURL).toMatch(/\/sw\.js$/);
  expect(violations).toEqual([]);
});
