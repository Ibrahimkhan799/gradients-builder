import { test, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';

// Render without the editor so optical regressions can be inspected independently.
async function rendererPage(page) {
  await page.route('**/optics-study', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  await page.goto('/optics-study');
}

test('optical reference study produces dark, spectral liquid and distinct presets', async ({ page }) => {
  test.setTimeout(90000);
  await rendererPage(page);
  const images = await page.evaluate(async () => {
    const { LiquidRenderer } = await import('/renderer.js');
    const { PRESETS } = await import('/studio-state.js');
    const renderer = new LiquidRenderer(document.createElement('canvas'));
    const images = [];
    try {
      for (const preset of PRESETS) {
        renderer.setSettings(preset.settings);
        const blob = await renderer.exportPNG(600, 400);
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const pixels = ctx.getImageData(0, 0, 600, 400).data;
        let dark = 0, bright = 0, saturated = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const peak = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
          const low = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
          if (peak < 24) dark++;
          if (peak > 160) bright++;
          if (peak > 90 && peak - low > 70) saturated++;
        }
        images.push({ id: preset.id, data: canvas.toDataURL('image/png'), dark: dark / 240000, bright: bright / 240000, saturated: saturated / 240000 });
      }
      renderer.setSettings(PRESETS[0].settings);
      const portrait = await renderer.exportPNG(480, 800);
      const data = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(portrait); });
      images.push({ id: 'portrait-reference', data });
    } finally { renderer.destroy(); }
    return images;
  });
  await mkdir('.artifacts/optics', { recursive: true });
  for (const image of images) {
    await writeFile(`.artifacts/optics/${image.id}.png`, Buffer.from(image.data.split(',')[1], 'base64'));
  }
  const main = images[0];
  expect(main.dark).toBeGreaterThan(0.25);
  expect(main.bright).toBeGreaterThan(0.03);
  expect(main.saturated).toBeGreaterThan(0.08);
  expect(new Set(images.map(image => image.data)).size).toBe(images.length);
  console.log('Optical image statistics:', images.filter(image => image.dark !== undefined).map(({ id, dark, bright, saturated }) => ({ id, dark, bright, saturated })));
});

test('optical settings are effective, bounded, and preserve paused export determinism', async ({ page }) => {
  await rendererPage(page);
  const result = await page.evaluate(async () => {
    const { LiquidRenderer } = await import('/renderer.js');
    const { DEFAULT_SETTINGS } = await import('/studio-state.js');
    const renderer = new LiquidRenderer(document.createElement('canvas'));
    const bytes = async () => new Uint8Array(await (await renderer.exportPNG(160, 100)).arrayBuffer());
    const equal = (a, b) => a.length === b.length && a.every((byte, index) => byte === b[index]);
    try {
      const original = await bytes();
      const deterministic = equal(original, await bytes());
      const changes = {};
      for (const key of ['dispersion', 'thickness', 'exposure', 'softness']) {
        renderer.setSettings({ ...DEFAULT_SETTINGS, [key]: 0 });
        const low = await bytes();
        renderer.setSettings({ [key]: 100 });
        changes[key] = !equal(low, await bytes());
      }
      renderer.setSettings({ dispersion: -20, thickness: 200, exposure: NaN });
      const bounds = renderer.settings;
      renderer.setSettings({ ...DEFAULT_SETTINGS, speed: 100 });
      renderer.setPlaying(true);
      await new Promise(resolve => setTimeout(resolve, 180));
      renderer.setPlaying(false);
      const animated = await bytes();
      return { deterministic, changes, animated: !equal(original, animated), paused: equal(animated, await bytes()), dispersion: bounds.dispersion, thickness: bounds.thickness, exposure: bounds.exposure };
    } finally { renderer.destroy(); }
  });
  expect(result.deterministic).toBe(true);
  expect(result.animated).toBe(true);
  expect(result.paused).toBe(true);
  expect(result.changes).toEqual({ dispersion: true, thickness: true, exposure: true, softness: true });
  expect(result.dispersion).toBe(0);
  expect(result.thickness).toBe(100);
  expect(result.exposure).toBe(55);
});
