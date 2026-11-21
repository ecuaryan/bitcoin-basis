import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { go } from './helpers.ts';

async function demo(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('bb.hide', '0'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.getByText('Your Bitcoin is worth', { exact: true })).toBeVisible();
}

async function openLog(page: Page, tab: string): Promise<void> {
  await page.getByRole('button', { name: 'Log something' }).or(page.getByRole('button', { name: 'Log', exact: true })).first().click();
  const dialog = page.getByRole('dialog', { name: 'Log' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: tab }).click();
}

async function axeClean(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })))).toEqual([]);
}

const dialog = (page: Page) => page.getByRole('dialog').last();

test('log a buy: review shows no tax, saving raises the total', async ({ page }) => {
  await demo(page);
  await openLog(page, 'Bought');
  const d = dialog(page);
  await d.getByLabel('Amount', { exact: true }).fill('0.01');
  await d.getByLabel('Total paid, including fees').fill('750');
  await axeClean(page);
  await d.getByRole('button', { name: 'Save purchase' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('3.3767 2105 BTC')).toBeVisible();
});

test('log a move with a network fee', async ({ page }) => {
  await demo(page);
  await openLog(page, 'Moved');
  const d = dialog(page);
  await d.getByLabel('From', { exact: true }).selectOption({ label: 'Strike' });
  await d.getByLabel('To', { exact: true }).selectOption({ label: 'River' });
  await d.getByLabel('Amount that arrives').fill('0.01');
  await d.getByLabel('Network fee in sats (optional)').fill('1500');
  await axeClean(page);
  await d.getByRole('button', { name: 'Save move' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('sell with hand-picked coins saves the pick', async ({ page }) => {
  await demo(page);
  await openLog(page, 'Sold');
  const d = dialog(page);
  await d.getByLabel('From wallet').selectOption({ label: 'Strike' });
  await d.getByLabel('Amount', { exact: true }).fill('0.002');
  await d.getByRole('radio', { name: 'Choose coins' }).click();
  await d.getByRole('checkbox').nth(1).check();
  await d.getByRole('button', { name: 'Review sale' }).click();
  await expect(d.getByText('Taxable gain')).toBeVisible();
  await expect(d.getByRole('region', { name: 'Coins used' })).toContainText('(1)');
  await axeClean(page);
  await d.getByRole('button', { name: 'Save sale' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('selling from self-custody is refused and offers a prepare-a-sale move', async ({ page }) => {
  await demo(page);
  await openLog(page, 'Sold');
  const d = dialog(page);
  await d.getByLabel('From wallet').selectOption({ label: 'Cold storage' });
  await d.getByLabel('Amount', { exact: true }).fill('0.001');
  await expect(d.getByText('Coins in self-custody cannot be sold directly')).toBeVisible();
  await d.getByRole('button', { name: 'Prepare a sale' }).click();
  await expect(d.getByText('Preparing a sale')).toBeVisible();
  await d.getByLabel('To (an exchange)').selectOption({ label: 'Strike' });
  await d.getByRole('button', { name: 'Save move, then sell' }).click();
  // Now on the sale form for the moved coins.
  await expect(d.getByLabel('From wallet')).toHaveValue('wallet-strike');
  await expect(d.getByLabel('Amount', { exact: true })).toHaveValue('0.0010 0000');
});

test('gift to a person shows the gift note; charity gift shows the CPA note', async ({ page }) => {
  await demo(page);
  await openLog(page, 'Gave');
  let d = dialog(page);
  await d.getByLabel('Who is it for?').fill('Sam');
  await d.getByLabel('From wallet').selectOption({ label: 'Strike' });
  await d.getByLabel('Amount', { exact: true }).fill('0.001');
  await d.getByRole('button', { name: 'Review gift' }).click();
  await expect(d.getByRole('region', { name: 'Gift note' })).toBeVisible();
  await axeClean(page);
  await d.getByRole('button', { name: 'Save gift' }).click();
  await expect(d.getByText('Gift saved')).toBeVisible();
  await expect(d.getByRole('link', { name: 'Open to print' })).toBeVisible();
  await d.getByRole('button', { name: 'Done' }).click();

  await openLog(page, 'Gave');
  d = dialog(page);
  await d.getByRole('radio', { name: 'A charity or church' }).click();
  await d.getByLabel('Charity or church').fill('Hope Church');
  await d.getByLabel('From wallet').selectOption({ label: 'Strike' });
  await d.getByLabel('Amount', { exact: true }).fill('0.001');
  await d.getByRole('button', { name: 'Review gift' }).click();
  await expect(d.getByText('Confirm with your CPA').first()).toBeVisible();
  await expect(d.getByText('lower of cost and value')).toBeVisible();
  await d.getByRole('button', { name: 'Save gift' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('confirm a balance: yes, then no with a different number', async ({ page }) => {
  await demo(page);
  await go(page, '/wallet/wallet-strike');
  await expect(page.getByRole('heading', { name: 'Strike', level: 1 })).toBeVisible();
  await expect(page.getByText('0.6188 2140 BTC').first()).toBeVisible();
  const card = page.getByRole('region', { name: 'Does it match?' });
  await expect(card).toContainText('Does Strike show 0.6188 2140 BTC?');
  await card.getByRole('button', { name: 'Yes' }).click();
  await expect(page.getByText('Confirmed. Strike matches.')).toBeVisible();
  await expect(card.getByText('Confirmed today', { exact: true })).toBeVisible();
  await expect(card.getByLabel('What Strike shows')).toHaveCount(0);
  await card.getByRole('button', { name: "No, it's different" }).click();
  const box = card.getByLabel('What Strike shows');
  await expect(box).toBeFocused();
  await box.fill('0.6253214');
  await card.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText(/Strike shows .* more\./)).toBeVisible();
  await expect(page.getByText('0.0065 0000 BTC')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Log it' })).toBeVisible();
  await axeClean(page);
});

test('freeze a wallet, log a payout, close it out', async ({ page }) => {
  await demo(page);
  await go(page, '/wallet/wallet-river');
  await page.getByRole('button', { name: 'Wallet options' }).click();
  await page.getByRole('button', { name: /Platform frozen or failed/ }).click();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await axeClean(page);
  await page.getByRole('button', { name: 'Mark frozen' }).click();
  await expect(page.getByText(/FROZEN SINCE/)).toBeVisible();

  await page.getByRole('button', { name: 'Log a payout' }).click();
  const d = dialog(page);
  await d.getByLabel('Amount', { exact: true }).fill('0.001');
  await d.getByLabel('Wallet it arrived in').selectOption({ label: 'Strike' });
  await d.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(d.getByText('No tax yet')).toBeVisible();
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'Review and close out' }).click();
  const c = dialog(page);
  await expect(c.getByText('IF YOU CLOSE IT OUT')).toBeVisible();
  await c.getByLabel('Why are you closing it out?').fill('The platform plan took effect');
  await c.getByRole('button', { name: 'Review and close out' }).click();
  await expect(c.getByText('Capital loss')).toBeVisible();
  await expect(c.getByText('Confirm with your CPA').first()).toBeVisible();
  await axeClean(page);
  await c.getByRole('button', { name: 'Close out wallet' }).click();
  await expect(page.getByText('Closed out', { exact: true }).first()).toBeVisible();
});

test('lost or stolen coins are flagged for the CPA', async ({ page }) => {
  await demo(page);
  await go(page, '/wallet/wallet-strike');
  await page.getByRole('button', { name: 'Wallet options' }).click();
  await page.getByRole('button', { name: /Coins lost or stolen/ }).click();
  const d = dialog(page);
  await d.getByLabel('How much was lost or stolen').fill('0.001');
  await d.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(d.getByText('No deduction recorded')).toBeVisible();
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('edit an entry needs a reason; closed years are locked', async ({ page }) => {
  await demo(page);
  await openLog(page, 'Bought');
  let d = dialog(page);
  await d.getByLabel('Amount', { exact: true }).fill('0.002');
  await d.getByLabel('Total paid, including fees').fill('150');
  await d.getByRole('button', { name: 'Save purchase' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await go(page, '/wallet/wallet-strike');
  const first = page.getByRole('region', { name: 'Entries' }).getByRole('button', { expanded: false }).first();
  await first.click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  d = dialog(page);
  await d.getByLabel('Amount', { exact: true }).fill('0.003');
  await d.getByRole('button', { name: 'Review change' }).click();
  await d.getByRole('button', { name: 'Save purchase' }).click();
  await expect(d.getByText('Say why you are changing this.')).toBeVisible();
  await d.getByLabel('Why are you changing it?').fill('Typo in the amount');
  await d.getByRole('button', { name: 'Save purchase' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Entries' }).getByText('edited').first()).toBeVisible();

  // Close 2025, then a 2025 entry shows as locked.
  await go(page, '/tax?year=2025');
  await page.getByRole('button', { name: /Close 2025 once/ }).click();
  await page.getByRole('dialog', { name: 'Close 2025?' }).getByRole('button', { name: 'Close 2025' }).click();
  await expect(page.getByText('2025 is closed', { exact: true })).toBeVisible();
  await go(page, '/wallet/wallet-strike');
  await page.getByRole('button', { name: /^Show all \d+ entries/ }).click({ clickCount: 1 }).catch(() => undefined);
  await expect(page.getByRole('region', { name: 'Entries' }).getByText(/locked, 2025 is closed/).first()).toBeVisible();
});

test('add a wallet from the log form', async ({ page }) => {
  await demo(page);
  await openLog(page, 'Bought');
  const d = dialog(page);
  await d.getByLabel('Wallet', { exact: true }).selectOption({ label: 'Add a wallet…' });
  const add = page.getByRole('dialog', { name: 'Add a wallet' });
  await add.getByLabel('Name').fill('Kraken');
  await axeClean(page);
  await add.getByRole('button', { name: 'Add wallet' }).click();
  await expect(page.getByRole('dialog', { name: 'Log' }).getByLabel('Wallet', { exact: true })).toHaveValue(/kraken/);
});
