import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, PRESETS, normalizeSettings, normalizeState, exportDimensions, History } from '../studio-state.js';

test('defaults are isolated and invalid persisted values are safe', () => {
  const defaults = normalizeState(null);
  assert.equal(defaults.presetId, 'chromatic-flow');
  assert.equal(defaults.aspect, 'landscape');
  defaults.settings.palette[0] = '#ffffff';
  assert.equal(DEFAULT_SETTINGS.palette[0], '#00d5ff');
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  const invalid = normalizeState({ aspect: '__proto__', presetId: 'missing', settings: { flow: -30, distortion: 1000, seed: -1, intensity: NaN, rotation: Infinity, shape: 7, palette: ['bad'] } });
  assert.equal(invalid.aspect, 'landscape');
  assert.equal(invalid.settings.flow, 0);
  assert.equal(invalid.settings.distortion, 100);
  assert.equal(invalid.settings.seed, 1);
  assert.equal(invalid.settings.intensity, DEFAULT_SETTINGS.intensity);
  assert.equal(invalid.settings.rotation, 0);
  assert.equal(invalid.settings.shape, 0);
  assert.deepEqual(invalid.settings.palette, DEFAULT_SETTINGS.palette);
});

test('valid settings survive normalization and hex values are canonical', () => {
  for (const preset of PRESETS) assert.deepEqual(normalizeSettings(preset.settings), preset.settings);
  const colors = ['#ABCDEF', '#112233', '#123456', '#aa00ff'];
  assert.deepEqual(normalizeSettings({ palette: colors }).palette, colors.map(color => color.toLowerCase()));
  assert.equal(normalizeSettings({ speed: 12.6 }).speed, 13);
});

test('older recipes acquire optical controls without losing user edits', () => {
  const old = normalizeState({ presetId: 'prism-silk', aspect: 'portrait', settings: { seed: 812, flow: 73, palette: ['#113355', '#557799', '#99bbcc', '#ddeeff'] } });
  assert.equal(old.settings.seed, 812);
  assert.equal(old.settings.flow, 73);
  assert.equal(old.aspect, 'portrait');
  assert.equal(old.settings.palette[0], '#113355');
  for (const key of ['dispersion', 'thickness', 'exposure']) assert.equal(old.settings[key], DEFAULT_SETTINGS[key]);
  const clamped = normalizeSettings({ dispersion: 200, thickness: -10, exposure: Infinity });
  assert.equal(clamped.dispersion, 100);
  assert.equal(clamped.thickness, 0);
  assert.equal(clamped.exposure, DEFAULT_SETTINGS.exposure);
});

test('export dimensions preserve aspect ratios and use the longest edge', () => {
  assert.deepEqual(exportDimensions('landscape', 2400), { width: 2400, height: 1600 });
  assert.deepEqual(exportDimensions('portrait', 2400), { width: 1600, height: 2400 });
  assert.deepEqual(exportDimensions('square', 3840), { width: 3840, height: 3840 });
  assert.deepEqual(exportDimensions('wallpaper', 3840), { width: 3840, height: 2160 });
  assert.throws(() => exportDimensions('landscape', 4097), RangeError);
  assert.throws(() => exportDimensions('landscape', -1), RangeError);
  assert.throws(() => exportDimensions('landscape', 100.5), RangeError);
  assert.throws(() => exportDimensions('invalid', 2400), TypeError);
  assert.throws(() => exportDimensions('__proto__', 2400), TypeError);
});

test('undo/redo use deep snapshots and new edits invalidate redo', () => {
  const history = new History();
  const first = normalizeState();
  history.push(first);
  first.settings.palette[0] = '#ffffff';
  const current = normalizeState({ settings: { seed: 55 } });
  const previous = history.undo(current);
  assert.equal(previous.settings.palette[0], DEFAULT_SETTINGS.palette[0]);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, true);
  assert.equal(history.redo(previous).settings.seed, 55);
  history.undo(current);
  history.push(previous);
  assert.equal(history.canRedo, false);
  assert.equal(history.redo(previous), null);
});

test('history is bounded and empty operations are no-ops', () => {
  const history = new History(2);
  assert.equal(history.undo({}), null);
  assert.equal(history.redo({}), null);
  history.push({ seed: 1 });
  history.push({ seed: 2 });
  history.push({ seed: 3 });
  assert.deepEqual(history.undo({ seed: 4 }), { seed: 3 });
  assert.deepEqual(history.undo({ seed: 3 }), { seed: 2 });
  assert.equal(history.undo({}), null);
});
