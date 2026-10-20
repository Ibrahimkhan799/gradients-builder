import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openStudio(page) {
  await page.goto('/');
  await expect(page.locator('.preset-art img')).toHaveCount(6);
  await expect(page.locator('#canvas-error')).toBeHidden();
}

test('renders the desktop studio without application or external network errors', async ({ page }) => {
  const errors = [];
  const external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4173') && !request.url().startsWith('blob:') && !request.url().startsWith('data:')) external.push(request.url()); });
  await openStudio(page);
  await expect(page).toHaveTitle('Chroma — Liquid gradient studio');
  await expect(page.locator('#undo-button')).toBeDisabled();
  await page.screenshot({ path: '.artifacts/studio-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('sliders, history, presets, palette, animation, and local persistence work', async ({ page }) => {
  await openStudio(page);
  await page.locator('#flow').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#flow-value')).toHaveText('56');
  await page.locator('#undo-button').click();
  await expect(page.locator('#flow')).toHaveValue('55');
  await page.locator('#redo-button').click();
  await expect(page.locator('#flow')).toHaveValue('56');
  await page.getByRole('button', { name: 'Apply Solar flare preset', exact: true }).click();
  await expect(page.locator('#seed-input')).toHaveValue('295');
  await expect(page.locator('#palette-0')).toHaveValue('#ffb858');
  await page.getByRole('button', { name: 'Ribbon', exact: true }).click();
  await expect(page.locator('[data-shape="1"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#play-button').click();
  await expect(page.locator('#motion-toggle')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#motion-speed')).toBeVisible();
  await page.locator('#play-button').click();
  await expect(page.locator('#motion-toggle')).toHaveAttribute('aria-checked', 'false');
  await page.locator('#rotate-button').click();
  await page.locator('.fine-details summary').click();
  await expect(page.locator('#rotation')).toHaveValue('90');
  await page.locator('#dispersion').focus();
  await page.keyboard.press('End');
  await expect(page.locator('#dispersion')).toHaveValue('100');
  await page.locator('#undo-button').click();
  await expect(page.locator('#dispersion')).toHaveValue('35');
  await page.locator('#redo-button').click();
  await expect(page.locator('#dispersion')).toHaveValue('100');
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator('#seed-input')).toHaveValue('295');
  await expect(page.locator('[data-shape="1"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#dispersion')).toHaveValue('100');
  await page.locator('#reset-button').click();
  await expect(page.locator('[data-shape="0"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#dispersion')).toHaveValue('35');
});

test('favorites can be saved, restored, and removed', async ({ page }) => {
  await openStudio(page);
  await page.locator('#save-button').click();
  await expect(page.locator('#toast')).toContainText('Saved to your collection');
  await page.locator('#shuffle-button').click();
  await page.locator('#collection-button').click();
  await expect(page.locator('.saved-card')).toHaveCount(1);
  await page.locator('.saved-card > button:first-child').click();
  await expect(page.locator('#seed-input')).toHaveValue('42');
  await page.locator('#collection-button').click();
  await page.locator('.delete-saved').click();
  await expect(page.locator('.collection-empty')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#collection-dialog')).not.toBeVisible();
});

test('exports an actual portrait PNG at the chosen resolution', async ({ page }) => {
  await openStudio(page);
  await page.locator('#aspect-select').selectOption('portrait');
  await page.locator('#export-button').click();
  await page.locator('#export-size').selectOption('1600');
  await expect(page.locator('#export-dimensions')).toHaveText('1067 × 1600');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-submit').click();
  const download = await downloadPromise;
  const png = await readFile(await download.path());
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.readUInt32BE(16)).toBe(1067);
  expect(png.readUInt32BE(20)).toBe(1600);
  expect(png.length).toBeGreaterThan(50000);
  await expect(page.locator('#export-dialog')).not.toBeVisible();
  await expect(page.locator('#canvas-error')).toBeHidden();
});

test('renderer is deterministic, controls change pixels, and invalid exports reject', async ({ page }) => {
  await openStudio(page);
  const result = await page.evaluate(async () => {
    const { LiquidRenderer } = await import('/renderer.js');
    const canvas = document.createElement('canvas');
    const renderer = new LiquidRenderer(canvas);
    const pixels = async () => {
      const bitmap = await createImageBitmap(await renderer.exportPNG(180, 120));
      const output = document.createElement('canvas');
      output.width = bitmap.width;
      output.height = bitmap.height;
      const context = output.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return [...context.getImageData(0, 0, output.width, output.height).data];
    };
    const first = await pixels();
    const second = await pixels();
    renderer.setSettings({ seed: 108 });
    const third = await pixels();
    renderer.setSettings({ shape: 1 });
    const fourth = await pixels();
    let invalidRejected = false;
    try { await renderer.exportPNG(5000, 100); } catch { invalidRejected = true; }
    renderer.destroy();
    return { deterministic: first.every((value, index) => value === second[index]), seeded: first.some((value, index) => value !== third[index]), shaped: third.some((value, index) => value !== fourth[index]), colorful: first.filter((value, index) => index % 4 !== 3 && value > 100).length > 3000, invalidRejected, destroyed: !renderer.supported };
  });
  expect(result).toEqual({ deterministic: true, seeded: true, shaped: true, colorful: true, invalidRejected: true, destroyed: true });
});

test('mobile layout has no horizontal overflow and controls remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStudio(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.artifacts/studio-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Bloom', exact: true }).click();
  await expect(page.locator('[data-shape="2"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#export-button').click();
  await expect(page.locator('#export-dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('WebGL-unavailable browsers receive an actionable fallback', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === 'webgl' || type === 'experimental-webgl') return null;
      return original.call(this, type, ...args);
    };
  });
  await page.goto('/');
  await expect(page.locator('#canvas-error')).toBeVisible();
  await expect(page.locator('#export-button')).toBeDisabled();
  await page.locator('#guide-button').click();
  await expect(page.locator('#guide-dialog')).toBeVisible();
});
