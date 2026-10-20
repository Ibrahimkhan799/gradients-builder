import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';
import { LiquidRenderer } from './renderer.js';
import { PRESETS, ASPECTS, STORAGE_KEY, COLLECTION_KEY, normalizeState, clone, exportDimensions, History } from './studio-state.js';

const ICONS = {
  download: '<path d="M12 3v12m-5-5 5 5 5-5M5 15v5h14v-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 2-2.5 3.5m0 3v.01"/>',
  undo: '<path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 7 7v3"/>',
  redo: '<path d="m16 4 5 5-5 5m5-5H11a7 7 0 0 0-7 7v3"/>',
  shuffle: '<path d="M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c1.5 0 3-1.5 4-3m4-6c1-1.5 2.5-3 4-3h3m-4-4 4 4-4 4"/>',
  play: '<path d="m9 5 11 7-11 7Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  rotate: '<path d="M3 11a9 9 0 1 1 3 8M3 4v7h7"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  collapse: '<path d="M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5"/>',
  ratio: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 15h8"/>',
  'chevron-down': '<path d="m7 10 5 5 5-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4Z"/>',
  'arrow-up-right': '<path d="M6 18 18 6M6 6h12v12"/>',
  sliders: '<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2.6 9M3 4v6h6"/>',
  refresh: '<path d="M3 10a9 9 0 0 1 15-6l3 3m0-5v5h-5M21 14a9 9 0 0 1-15 6l-3-3m0 5v-5h5"/>',
  waves: '<path d="M2 7c3-6 6 6 10 0s7 6 10 0M2 12c3-6 6 6 10 0s7 6 10 0M2 17c3-6 6 6 10 0s7 6 10 0"/>',
  ribbon: '<path d="M6 3c-8 9 20 9 12 18M12 3c-8 9 14 9 6 18M6 3h6M12 21h6"/>',
  bloom: '<path d="M12 3c6-7 8 4 3 6 8-2 8 7 1 6 4 7-5 10-6 3-4 6-11 0-5-4-8-3-3-10 3-6-1-4 1-6 4-5Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  sparkles: '<path d="m14 3 2.5 6.5L23 12l-6.5 2.5L14 21l-2.5-6.5L5 12l6.5-2.5ZM4 2v5M1.5 4.5h5M4 17v5m-2.5-2.5h5"/>',
  hash: '<path d="m10 3-4 18M18 3l-4 18M3 8h18M2 16h18"/>',
  infinity: '<path d="M12 12c-3-5-10-7-10 0s7 5 10 0 10-7 10 0-7 5-10 0Z"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  warning: '<path d="m12 3 10 18H2ZM12 9v5m0 3v.01"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.sparkles}</svg>`;
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(element => {
    const wrapper = document.createElement('span');
    wrapper.innerHTML = icon(element.dataset.icon);
    const svg = wrapper.firstElementChild;
    for (const attribute of element.attributes) if (attribute.name !== 'data-icon') svg.setAttribute(attribute.name, attribute.value);
    element.replaceWith(svg);
  });
}
hydrateIcons();

const $ = selector => document.querySelector(selector);
const history = new History();
let state = normalizeState();
let collection = [];
let storageAvailable = true;
try {
  state = normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  const saved = JSON.parse(localStorage.getItem(COLLECTION_KEY));
  if (Array.isArray(saved)) collection = saved.filter(item => item && typeof item.id === 'string' && typeof item.image === 'string' && /^data:image\/png;base64,/.test(item.image) && item.image.length < 500000 && Number.isFinite(item.created)).slice(0, 24).map(item => ({ id: item.id, image: item.image, created: item.created, state: normalizeState(item.state) }));
} catch { storageAvailable = false; }

let renderer;
let playing = false;
let editingControl = null;
let saveTimer;
let toastTimer;
let resizeFrame;
let thumbnailRenderer;
const thumbnailURLs = [];
const rangeInputs = [...document.querySelectorAll('[data-setting]')];

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast span').textContent = message;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3200);
}

function storageStatus(message) {
  $('.autosave-note').innerHTML = `${icon('check')}<span></span>`;
  $('.autosave-note span').textContent = message;
}

function persist() {
  clearTimeout(saveTimer);
  storageStatus('Saving locally…');
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageAvailable = true;
      storageStatus('All changes saved locally');
    } catch {
      storageAvailable = false;
      storageStatus('Local storage unavailable');
    }
  }, 300);
}

function syncHistory() {
  $('#undo-button').disabled = !history.canUndo;
  $('#redo-button').disabled = !history.canRedo;
}

function syncUI() {
  for (const input of rangeInputs) {
    const value = state.settings[input.dataset.setting];
    input.value = value;
    input.style.setProperty('--range', `${value / Number(input.max) * 100}%`);
    $(`#${input.id}-value`).textContent = `${value}${input.id === 'rotation' ? '°' : ''}`;
  }
  document.querySelectorAll('[data-shape]').forEach(button => {
    const selected = Number(button.dataset.shape) === state.settings.shape;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', selected);
  });
  state.settings.palette.forEach((color, index) => {
    const input = $(`#palette-${index}`);
    input.value = color;
    input.style.setProperty('--color', color);
    input.nextElementSibling.textContent = color;
  });
  document.querySelectorAll('.preset-card').forEach(button => {
    const selected = button.dataset.preset === state.presetId;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', selected);
  });
  $('#seed-input').value = state.settings.seed;
  $('#aspect-select').value = state.aspect;
  const preset = PRESETS.find(item => item.id === state.presetId);
  $('#canvas-preset-name').textContent = preset.name.toUpperCase();
  const dimensions = exportDimensions(state.aspect, 2400);
  $('#resolution-label').textContent = `${dimensions.width} × ${dimensions.height}`;
  syncHistory();
}

function fitCanvas() {
  const stage = $('#canvas-stage');
  const ratio = ASPECTS[state.aspect];
  stage.style.setProperty('--canvas-aspect', String(ratio));
  const width = Math.min(stage.clientWidth, stage.clientHeight * ratio);
  $('#artboard').style.width = `${width}px`;
  $('#artboard').style.height = `${width / ratio}px`;
  renderer?.resize();
}

function applyState(next, { record = true, control = null } = {}) {
  const normalized = normalizeState(next);
  if (JSON.stringify(normalized) === JSON.stringify(state)) return;
  if (record && (!control || editingControl !== control)) history.push(state);
  editingControl = control;
  const aspectChanged = state.aspect !== normalized.aspect;
  state = normalized;
  renderer?.setSettings(state.settings);
  syncUI();
  if (aspectChanged) fitCanvas();
  persist();
}

function changeSettings(patch, control = null) {
  applyState({ ...state, settings: { ...state.settings, ...patch } }, { control });
}

function applyPreset(preset) {
  applyState({ ...state, presetId: preset.id, settings: clone(preset.settings) });
}

function randomSeed() {
  return 1 + crypto.getRandomValues(new Uint32Array(1))[0] % 999999;
}

function shuffle() {
  changeSettings({ seed: randomSeed(), flow: 30 + Math.floor(Math.random() * 56), distortion: 20 + Math.floor(Math.random() * 61), rotation: Math.floor(Math.random() * 360) });
  toast('A new flow. A fresh perspective.');
}

function setPlaying(value) {
  playing = Boolean(value && renderer?.supported);
  renderer?.setPlaying(playing);
  $('#play-button').setAttribute('aria-pressed', playing);
  $('#play-button').setAttribute('aria-label', playing ? 'Pause animation' : 'Animate gradient');
  $('#play-button').innerHTML = `${icon(playing ? 'pause' : 'play')}<span>${playing ? 'Pause' : 'Animate'}</span>`;
  $('#motion-toggle').setAttribute('aria-checked', playing);
  $('#motion-speed').hidden = !playing;
}

function undo() {
  const previous = history.undo(state);
  if (previous) applyState(previous, { record: false });
}
function redo() {
  const next = history.redo(state);
  if (next) applyState(next, { record: false });
}

for (let index = 0; index < 4; index++) {
  const label = document.createElement('label');
  label.className = 'color-swatch';
  label.innerHTML = `<input type="color" id="palette-${index}" aria-label="Palette color ${index + 1}" /><span aria-hidden="true"></span>`;
  const input = label.querySelector('input');
  input.addEventListener('input', () => {
    const palette = [...state.settings.palette];
    palette[index] = input.value;
    changeSettings({ palette }, input.id);
  });
  input.addEventListener('change', () => { editingControl = null; });
  $('#palette-colors').append(label);
}

for (const preset of PRESETS) {
  const button = document.createElement('button');
  button.className = 'preset-card';
  button.dataset.preset = preset.id;
  button.setAttribute('aria-label', `Apply ${preset.name} preset`);
  button.innerHTML = `<span class="preset-art"><span class="preset-check">${icon('check')}</span></span><span class="preset-name"></span>`;
  button.querySelector('.preset-art').style.setProperty('--preview', preset.preview);
  button.querySelector('.preset-name').textContent = preset.name;
  button.addEventListener('click', () => applyPreset(preset));
  $('#presets-grid').append(button);
}

for (const input of rangeInputs) {
  input.addEventListener('input', () => changeSettings({ [input.dataset.setting]: Number(input.value) }, input.id));
  input.addEventListener('change', () => { editingControl = null; });
  input.addEventListener('blur', () => { editingControl = null; });
}
$('#shape-control').addEventListener('click', event => {
  const button = event.target.closest('[data-shape]');
  if (button) changeSettings({ shape: Number(button.dataset.shape) });
});
$('#aspect-select').addEventListener('change', event => applyState({ ...state, aspect: event.target.value }));
$('#seed-input').addEventListener('change', event => {
  const value = event.target.valueAsNumber;
  if (Number.isFinite(value)) changeSettings({ seed: value });
  event.target.value = state.settings.seed;
});
$('#seed-button').addEventListener('click', () => changeSettings({ seed: randomSeed() }));
$('#shuffle-button').addEventListener('click', shuffle);
$('#palette-shuffle').addEventListener('click', () => {
  const palettes = PRESETS.filter(preset => preset.settings.palette.join() !== state.settings.palette.join());
  changeSettings({ palette: palettes[Math.floor(Math.random() * palettes.length)].settings.palette });
});
$('#reset-button').addEventListener('click', () => {
  applyPreset(PRESETS.find(preset => preset.id === state.presetId));
  setPlaying(false);
  toast('Back to the original flow.');
});
$('#undo-button').addEventListener('click', undo);
$('#redo-button').addEventListener('click', redo);
$('#play-button').addEventListener('click', () => setPlaying(!playing));
$('#motion-toggle').addEventListener('click', () => setPlaying(!playing));
$('#rotate-button').addEventListener('click', () => changeSettings({ rotation: (state.settings.rotation + 90) % 360 }));
$('#fullscreen-button').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if ($('#canvas-stage').requestFullscreen) await $('#canvas-stage').requestFullscreen();
    else toast('Full screen is not supported by this browser.');
  } catch { toast('Your browser could not enter full screen.'); }
});
document.addEventListener('fullscreenchange', () => {
  $('#fullscreen-button').innerHTML = icon(document.fullscreenElement ? 'collapse' : 'expand');
  $('#fullscreen-button').setAttribute('aria-label', document.fullscreenElement ? 'Exit full screen' : 'Enter full screen');
  fitCanvas();
});

function openDialog(id) {
  editingControl = null;
  $(`#${id}`).showModal();
}
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.querySelector('.close-dialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
}
$('#guide-button').addEventListener('click', () => openDialog('guide-dialog'));
function updateExportDimensions() {
  const { width, height } = exportDimensions(state.aspect, Number($('#export-size').value));
  $('#export-dimensions').textContent = `${width} × ${height}`;
}
$('#export-button').addEventListener('click', () => {
  updateExportDimensions();
  $('#export-error').hidden = true;
  openDialog('export-dialog');
});
$('#export-size').addEventListener('change', updateExportDimensions);
$('#export-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = $('#export-submit');
  if (submit.disabled) return;
  submit.disabled = true;
  submit.querySelector('span').textContent = 'Rendering your gradient…';
  $('#export-error').hidden = true;
  try {
    // Let the busy state paint before starting GPU readback.
    await new Promise(resolve => setTimeout(resolve, 40));
    const { width, height } = exportDimensions(state.aspect, Number($('#export-size').value));
    const blob = await renderer.exportPNG(width, height);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chroma-${state.presetId}-${state.settings.seed}-${width}x${height}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    $('#export-dialog').close();
    toast('A little light, ready to take with you.');
  } catch (error) {
    $('#export-error').textContent = `Could not export this image. Try a smaller resolution. ${error.message}`;
    $('#export-error').hidden = false;
  } finally {
    submit.disabled = false;
    submit.querySelector('span').textContent = 'Download PNG';
  }
});

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the preview image.'));
    reader.readAsDataURL(blob);
  });
}
function saveCollection(next) {
  try {
    localStorage.setItem(COLLECTION_KEY, JSON.stringify(next));
    collection = next;
    return true;
  } catch {
    toast('Could not save. Your browser storage may be full or disabled.');
    return false;
  }
}
$('#save-button').addEventListener('click', async () => {
  const button = $('#save-button');
  if (collection.length >= 24) return toast('Your collection is full. Remove a favorite to make room.');
  const snapshot = clone(state);
  if (collection.some(item => JSON.stringify(item.state) === JSON.stringify(snapshot))) return toast('This flow is already in your collection.');
  button.disabled = true;
  try {
    const { width, height } = exportDimensions(snapshot.aspect, 300);
    const image = await blobToDataURL(await renderer.exportPNG(width, height));
    const next = [{ id: crypto.randomUUID(), state: snapshot, image, created: Date.now() }, ...collection];
    if (saveCollection(next)) toast('A keeper. Saved to your collection.');
  } catch { toast('Could not save this flow. Please try again.'); }
  finally { button.disabled = false; }
});

function renderCollection() {
  const container = $('#collection-items');
  container.replaceChildren();
  if (!collection.length) {
    container.innerHTML = `<div class="collection-empty">${icon('bookmark')}<h3>Keep the flows you love.</h3><p>Tap the bookmark below your canvas to save a gradient.<br>Your favorites stay on this device.</p></div>`;
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'collection-grid';
  for (const item of collection) {
    const preset = PRESETS.find(preset => preset.id === item.state.presetId);
    const card = document.createElement('div');
    card.className = 'saved-card';
    const button = document.createElement('button');
    button.setAttribute('aria-label', `Load saved ${preset.name}, seed ${item.state.settings.seed}`);
    const image = document.createElement('img');
    image.src = item.image;
    image.alt = '';
    const label = document.createElement('span');
    label.className = 'saved-card-label';
    const name = document.createElement('strong');
    name.textContent = preset.name;
    const date = document.createElement('small');
    date.textContent = `${new Date(item.created).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · Seed ${item.state.settings.seed}`;
    label.append(name, date);
    button.append(image, label);
    button.addEventListener('click', () => {
      applyState(item.state);
      $('#collection-dialog').close();
      toast('Your saved flow, back in the studio.');
    });
    const remove = document.createElement('button');
    remove.className = 'icon-button delete-saved';
    remove.setAttribute('aria-label', `Delete saved ${preset.name}, seed ${item.state.settings.seed}`);
    remove.innerHTML = icon('trash');
    remove.addEventListener('click', () => {
      if (saveCollection(collection.filter(saved => saved.id !== item.id))) renderCollection();
    });
    card.append(button, remove);
    grid.append(card);
  }
  container.append(grid);
}
$('#collection-button').addEventListener('click', () => { renderCollection(); openDialog('collection-dialog'); });

document.addEventListener('keydown', event => {
  const editing = event.target.closest('input, select, textarea, button, summary, [contenteditable="true"]');
  if (document.querySelector('dialog[open]')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.target.closest('input, textarea, [contenteditable="true"]')) {
    event.preventDefault();
    if (event.shiftKey) redo(); else undo();
  } else if (event.code === 'Space' && !editing && !event.repeat) {
    event.preventDefault();
    shuffle();
  }
});

syncUI();
if (!storageAvailable) storageStatus('Local storage unavailable');
renderer = new LiquidRenderer($('#gradient-canvas'), {
  onError(error) {
    queueMicrotask(() => {
      if (!renderer?.supported) {
        $('#canvas-error').hidden = false;
        for (const id of ['export-button', 'save-button', 'play-button', 'motion-toggle']) $(`#${id}`).disabled = true;
      }
      console.error('Chroma renderer:', error);
    });
  },
});
renderer.setSettings(state.settings);
$('#gradient-canvas').addEventListener('webglcontextrestored', () => {
  if (!renderer.supported) return;
  $('#canvas-error').hidden = true;
  for (const id of ['export-button', 'save-button', 'play-button', 'motion-toggle']) $(`#${id}`).disabled = false;
  renderer.setPlaying(playing && !document.hidden);
});
fitCanvas();
const observer = new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(fitCanvas);
});
observer.observe($('#canvas-stage'));
window.addEventListener('resize', fitCanvas);
document.addEventListener('visibilitychange', () => renderer.setPlaying(playing && !document.hidden));

async function buildThumbnails() {
  if (!renderer.supported) return;
  const canvas = document.createElement('canvas');
  thumbnailRenderer = new LiquidRenderer(canvas);
  if (!thumbnailRenderer.supported) return;
  try {
    for (const preset of PRESETS) {
      thumbnailRenderer.setSettings(preset.settings);
      const blob = await thumbnailRenderer.exportPNG(240, 160);
      const url = URL.createObjectURL(blob);
      thumbnailURLs.push(url);
      const image = document.createElement('img');
      image.src = url;
      image.alt = '';
      image.width = 240;
      image.height = 160;
      $(`[data-preset="${preset.id}"] .preset-art`).prepend(image);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } catch (error) { console.warn('Preset previews unavailable:', error); }
  finally { thumbnailRenderer.destroy(); thumbnailRenderer = null; }
}
if ('requestIdleCallback' in window) requestIdleCallback(buildThumbnails, { timeout: 1800 });
else setTimeout(buildThumbnails, 300);

window.addEventListener('pagehide', () => {
  clearTimeout(saveTimer);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Storage may be disabled. */ }
  renderer.setPlaying(false);
});
window.addEventListener('pageshow', () => renderer.setPlaying(playing && !document.hidden));
