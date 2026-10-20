export const DEFAULT_SETTINGS = Object.freeze({
  shape: 0,
  palette: Object.freeze(['#00d5ff', '#2548ff', '#a114ef', '#ff9b18']),
  flow: 55, intensity: 90, distortion: 45, scale: 50,
  softness: 18, grain: 4, speed: 30, seed: 42, rotation: 0,
  dispersion: 78, thickness: 48, exposure: 55,
});

export const PRESETS = [
  { id: 'chromatic-flow', name: 'Chromatic flow', settings: { ...DEFAULT_SETTINGS }, preview: 'radial-gradient(ellipse at 28% 70%, #72efff, transparent 38%), conic-gradient(from 30deg, #08090d, #9a71d4, #11121c, #edbc78, #0b1525, #4cc1e0, #08090d)' },
  { id: 'prism-silk', name: 'Prism silk', settings: { ...DEFAULT_SETTINGS, shape: 1, seed: 108, flow: 48, distortion: 55, scale: 40, softness: 7, intensity: 95, dispersion: 88, thickness: 60, exposure: 60, rotation: 85, palette: ['#57c8ff', '#6455ec', '#ffa4d9', '#ffd78c'] }, preview: 'conic-gradient(from 160deg at 28% 40%, #08050d, #efcbff, #6455ec, #07070b, #ffd78c, #57c8ff, #08050d)' },
  { id: 'midnight-oil', name: 'Midnight oil', settings: { ...DEFAULT_SETTINGS, seed: 731, flow: 78, distortion: 68, scale: 74, intensity: 95, softness: 6, dispersion: 85, thickness: 66, exposure: 38, rotation: 340, palette: ['#a2b3fc', '#4534a3', '#a66ad8', '#f5c5db'] }, preview: 'conic-gradient(from 180deg, #0b0714, #b08ada, #171331, #6b56d4, #b5bafa, #0d0b18, #a2b3fc, #0b0714)' },
  { id: 'solar-flare', name: 'Solar flare', settings: { ...DEFAULT_SETTINGS, seed: 295, flow: 43, distortion: 61, scale: 62, intensity: 85, softness: 12, dispersion: 35, thickness: 80, exposure: 61, palette: ['#ffb858', '#eb4516', '#e96b89', '#fff2c0'] }, preview: 'conic-gradient(from 30deg at 70% 70%, #160703, #ffba69, #ab260d, #170606, #e96b89, #ffb858, #160703)' },
  { id: 'glacier', name: 'Glacier', settings: { ...DEFAULT_SETTINGS, shape: 1, seed: 904, flow: 62, distortion: 35, scale: 54, intensity: 80, softness: 24, dispersion: 18, thickness: 32, exposure: 52, palette: ['#bcf9ef', '#277bba', '#56cfda', '#deefff'] }, preview: 'conic-gradient(from 60deg at 30% 40%, #06171d, #66d3da, #143c54, #bdf6f1, #0c232e, #3997b4, #06171d)' },
  { id: 'opal-dream', name: 'Opal dream', settings: { ...DEFAULT_SETTINGS, shape: 2, seed: 517, flow: 32, distortion: 25, scale: 38, softness: 42, intensity: 88, dispersion: 65, thickness: 26, exposure: 58, rotation: 20, palette: ['#c9f8e8', '#8d8be8', '#f1b8d2', '#ffe3bb'] }, preview: 'conic-gradient(from 100deg at 60% 60%, #342d47, #f1b8d2, #c9f8e8, #8d8be8, #ffe3bb, #342d47)' },
];

export const ASPECTS = Object.freeze({ landscape: 3 / 2, square: 1, portrait: 2 / 3, wallpaper: 16 / 9 });
export const STORAGE_KEY = 'chroma.studio.v1';
export const COLLECTION_KEY = 'chroma.collection.v1';

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeSettings(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const settings = { ...DEFAULT_SETTINGS, palette: [...DEFAULT_SETTINGS.palette] };
  for (const key of ['flow', 'intensity', 'distortion', 'scale', 'softness', 'grain', 'speed', 'dispersion', 'thickness', 'exposure']) {
    if (Number.isFinite(value[key])) settings[key] = Math.round(Math.min(100, Math.max(0, value[key])));
  }
  if ([0, 1, 2].includes(value.shape)) settings.shape = value.shape;
  if (Number.isFinite(value.seed)) settings.seed = Math.round(Math.min(999999, Math.max(1, value.seed)));
  if (Number.isFinite(value.rotation)) settings.rotation = Math.round(Math.min(360, Math.max(0, value.rotation)));
  if (Array.isArray(value.palette) && value.palette.length === 4 && value.palette.every(color => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))) {
    settings.palette = value.palette.map(color => color.toLowerCase());
  }
  return settings;
}

export function normalizeState(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    settings: normalizeSettings(source.settings),
    presetId: PRESETS.some(preset => preset.id === source.presetId) ? source.presetId : PRESETS[0].id,
    aspect: Object.hasOwn(ASPECTS, source.aspect) ? source.aspect : 'landscape',
  };
}

export function exportDimensions(aspect, longestEdge) {
  if (!Number.isInteger(longestEdge) || longestEdge < 1 || longestEdge > 4096) {
    throw new RangeError('Image size must be a whole number between 1 and 4096.');
  }
  if (!Object.hasOwn(ASPECTS, aspect)) throw new TypeError('Unknown aspect ratio.');
  const ratio = ASPECTS[aspect];
  return ratio >= 1
    ? { width: longestEdge, height: Math.max(1, Math.round(longestEdge / ratio)) }
    : { width: Math.max(1, Math.round(longestEdge * ratio)), height: longestEdge };
}

export class History {
  #past = [];
  #future = [];
  constructor(limit = 60) { this.limit = limit; }
  get canUndo() { return this.#past.length > 0; }
  get canRedo() { return this.#future.length > 0; }
  push(state) {
    this.#past.push(clone(state));
    if (this.#past.length > this.limit) this.#past.shift();
    this.#future.length = 0;
  }
  undo(current) {
    if (!this.canUndo) return null;
    this.#future.push(clone(current));
    return this.#past.pop();
  }
  redo(current) {
    if (!this.canRedo) return null;
    this.#past.push(clone(current));
    return this.#future.pop();
  }
}
