import { expect, test } from '@playwright/test';
import { expectNoViolations, openDemo } from './helpers.ts';

test('scrubbing the price chart shows a point label, by pointer and keyboard', async ({ page, isMobile }) => {
  await openDemo(page);
  const chart = page.getByRole('slider', { name: /Bitcoin price over three years/ }).first();
  await chart.scrollIntoViewIfNeeded();
  const box = await chart.boundingBox();
  if (box === null) throw new Error('chart not visible');
  const label = page.getByTestId('chart-scrub-label');
  await expect(label).toHaveCount(0);

  const y = box.y + box.height / 2;
  if (isMobile) {
    // Touch drag: dispatch pointer events like a finger would.
    const drag = (fx: number) =>
      chart.evaluate((el, [x, yy]) => {
        const opts = { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, clientX: x, clientY: yy } as PointerEventInit;
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new PointerEvent('pointermove', opts));
      }, [box.x + box.width * fx, y] as const);
    await drag(0.2);
    await expect(label).toBeVisible();
    const first = await label.innerText();
    await drag(0.8);
    expect(await label.innerText()).not.toBe(first);
  } else {
    await page.mouse.move(box.x + box.width * 0.2, y);
    await expect(label).toBeVisible();
    const first = await label.innerText();
    await page.mouse.move(box.x + box.width * 0.8, y);
    await expect(label).not.toHaveText(first);
    await expect(label).toContainText(/above your cost|below your cost|At your cost/);
    const lb = await label.boundingBox();
    if (lb === null) throw new Error('label not visible');
    expect(lb.x).toBeGreaterThanOrEqual(box.x - 1);
    expect(lb.x + lb.width).toBeLessThanOrEqual(box.x + box.width + 1);
    await page.mouse.move(box.x - 40, y);
    await expect(label).toHaveCount(0);
  }

  await chart.focus();
  await page.keyboard.press('Home');
  const home = await chart.getAttribute('aria-valuetext');
  await page.keyboard.press('End');
  const end = await chart.getAttribute('aria-valuetext');
  expect(home).not.toBe(end);
  await page.keyboard.press('ArrowLeft');
  expect(await chart.getAttribute('aria-valuetext')).not.toBe(end);
  await expectNoViolations(page);
});
