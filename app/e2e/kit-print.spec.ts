import { expect, test } from '@playwright/test';
import { setUp } from './fake.ts';
import { go } from './helpers.ts';

// The emergency kit must stay one letter page, even with several wallets and the retirement note.
test('the emergency kit prints on one letter page with six wallets and the code', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'PDF printing is checked once, on desktop Chromium');
  await setUp(page);
  const wallets: [string, string][] = [
    ['Cold storage (multisig)', 'Self-custody'],
    ['Strike', 'Exchange'],
    ['River', 'Exchange'],
    ['Coinbase', 'Exchange'],
    ['Swan IRA', 'Retirement'],
    ['Fidelity Roth', 'Retirement'],
  ];
  for (const [name, type] of wallets) {
    await page.getByRole('button', { name: 'Add a wallet' }).click();
    const add = page.getByRole('dialog', { name: 'Add a wallet' });
    await add.getByLabel('Name').fill(name);
    await add.getByRole('radio', { name: type }).click();
    await add.getByRole('button', { name: 'Add wallet' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  // A kit with a code on it, as after making a new recovery code.
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Make a new recovery code' }).click();
  await page.getByRole('dialog', { name: 'Make a new recovery code?' }).getByRole('button', { name: 'Make a new code' }).click();
  const paper = page.getByRole('article', { name: 'Emergency kit' });
  await expect(paper).toContainText('Fidelity Roth');
  await expect(paper.getByRole('list', { name: 'Recovery code groups' })).not.toContainText('Not printed');
  await page.getByLabel(/Your name, printed at the top/).fill('Alexandra Montgomery-Whitfield');
  await expect(paper).toContainText('follows that account’s rules instead');
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize({ width: 816, height: 1056 });
  // Room to spare: browsers and fonts differ a little when printing.
  expect(await paper.evaluate((a) => a.getBoundingClientRect().height)).toBeLessThan(1056 - 24);
  const pdf = await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true });
  const pages = pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? [];
  expect(pages.length).toBe(1);
});
