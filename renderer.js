import { DEFAULT_SETTINGS } from './studio-state.js';
import { FRAGMENT_SHADER, FINISH_SHADER } from './liquid-shader.js';

const PERCENT_SETTINGS = [
  'flow', 'intensity', 'distortion', 'scale', 'softness', 'grain', 'speed',
  'dispersion', 'thickness', 'exposure',
];
const MAX_EXPORT_SIZE = 4096;
// Every animated phase in the shader is a multiple of 0.1, so wrapping is seamless.
const TIME_PERIOD = Math.PI * 20;

const VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;


const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const clock = () => globalThis.performance?.now() ?? Date.now();

function parseHex(value) {
  if (typeof value !== 'string') return null;
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1].length === 3
    ? [...match[1]].map((digit) => digit + digit).join('')
    : match[1];
  return `#${hex.toLowerCase()}`;
}

function linearPalette(palette) {
  const result = new Float32Array(12);
  palette.forEach((hex, index) => {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = parseInt(hex.slice(1 + channel * 2, 3 + channel * 2), 16) / 255;
      result[index * 3 + channel] = value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    }
  });
  return result;
}

function seedVector(seed) {
  let state = seed >>> 0;
  const values = new Float32Array(4);
  for (let i = 0; i < 4; i += 1) {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    values[i] = ((value ^ (value >>> 14)) >>> 0) / 4294967296 * Math.PI * 2;
  }
  return values;
}

/**
 * Dependency-free WebGL 1 liquid renderer. Construction paints a paused frame.
 * Size the canvas with CSS, then call resize() when its layout or DPR changes.
 * onError receives an Error; exportPNG also rejects its promise on failure.
 */
export class LiquidRenderer {
  constructor(canvas, { onError } = {}) {
    this.canvas = canvas;
    this.supported = false;
    this._onError = typeof onError === 'function' ? onError : null;
    this._settings = { ...DEFAULT_SETTINGS, palette: [...DEFAULT_SETTINGS.palette] };
    this._palette = linearPalette(this._settings.palette);
    this._seed = seedVector(this._settings.seed);
    this._gl = null;
    this._program = null;
    this._postProgram = null;
    this._postUniforms = null;
    this._previewTarget = null;
    this._buffer = null;
    this._uniforms = null;
    this._position = -1;
    this._playing = false;
    this._destroyed = false;
    this._contextLost = false;
    this._time = 0;
    this._lastTick = null;
    this._frame = null;
    this._window = canvas?.ownerDocument?.defaultView ?? globalThis;
    this._tick = () => {
      this._frame = null;
      this.render();
    };
    this._handleContextLost = (event) => {
      event.preventDefault();
      this._advanceTime();
      this._contextLost = true;
      this.supported = false;
      this._lastTick = null;
      this._cancelFrame();
      // The browser has invalidated these objects and reclaimed their storage.
      this._program = null;
      this._postProgram = null;
      this._postUniforms = null;
      this._previewTarget = null;
      this._buffer = null;
      this._uniforms = null;
      this._reportError(new Error('WebGL context lost. Rendering will resume if it is restored.'));
    };
    this._handleContextRestored = () => {
      if (this._destroyed) return;
      this._contextLost = false;
      try {
        this._initialize();
        this._lastTick = this._playing ? clock() : null;
        this.resize();
      } catch (error) {
        this.supported = false;
        this._disposeResources();
        this._reportError(error);
      }
    };

    try {
      if (!canvas || typeof canvas.getContext !== 'function' ||
          typeof canvas.getBoundingClientRect !== 'function') {
        throw new TypeError('LiquidRenderer requires an HTML canvas element.');
      }
      const attributes = {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      };
      this._gl = canvas.getContext('webgl', attributes) ||
        canvas.getContext('experimental-webgl', attributes);
      if (!this._gl) throw new Error('WebGL is unavailable or disabled in this browser.');
      canvas.addEventListener('webglcontextlost', this._handleContextLost, false);
      canvas.addEventListener('webglcontextrestored', this._handleContextRestored, false);
      this._initialize();
      this.resize();
    } catch (error) {
      this.supported = false;
      this._disposeResources();
      this._reportError(error);
    }
  }

  /** A defensive snapshot; use setSettings() to apply changes. */
  get settings() {
    return { ...this._settings, palette: [...this._settings.palette] };
  }

  /** Unknown keys and invalid values are ignored; numeric controls are clamped. */
  setSettings(partial) {
    if (this._destroyed || !partial || typeof partial !== 'object') return;
    this._advanceTime();
    const next = { ...this._settings };
    for (const key of PERCENT_SETTINGS) {
      if (typeof partial[key] === 'number' && Number.isFinite(partial[key])) {
        next[key] = clamp(partial[key], 0, 100);
      }
    }
    if (Number.isInteger(partial.shape) && partial.shape >= 0 && partial.shape <= 2) {
      next.shape = partial.shape;
    }
    if (Number.isSafeInteger(partial.seed)) next.seed = partial.seed;
    if (typeof partial.rotation === 'number' && Number.isFinite(partial.rotation)) {
      next.rotation = clamp(partial.rotation, 0, 360);
    }
    if (Array.isArray(partial.palette) && partial.palette.length === 4) {
      const palette = Array.from(partial.palette, parseHex);
      if (palette.every(Boolean)) next.palette = palette;
    }
    this._settings = next;
    this._palette = linearPalette(next.palette);
    this._seed = seedVector(next.seed);
    this._requestRender();
  }

  /** Match the CSS bounding box, with a maximum device pixel ratio of 1.5. */
  resize() {
    if (!this.supported || this._destroyed || this._contextLost) return;
    try {
      const rect = this.canvas.getBoundingClientRect();
      const reportedDPR = Number(this._window.devicePixelRatio) || 1;
      const dpr = Math.min(1.5, Math.max(0.1, reportedDPR));
      let width = Math.max(1, Math.round((Number(rect.width) || 0) * dpr));
      let height = Math.max(1, Math.round((Number(rect.height) || 0) * dpr));
      // Bound the expensive optical pass on high-DPI/full-screen displays.
      // Export resolution is independent of this live-preview pixel budget.
      const fit = Math.min(1, this._maxWidth / width, this._maxHeight / height, Math.sqrt(900000 / (width * height)));
      width = Math.max(1, Math.floor(width * fit));
      height = Math.max(1, Math.floor(height * fit));
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
      this._requestRender();
    } catch (error) {
      this._reportError(error);
    }
  }

  setPlaying(playing) {
    if (this._destroyed) return;
    this._advanceTime();
    this._playing = Boolean(playing);
    this._lastTick = this._playing && this.supported ? clock() : null;
    if (!this._playing) this._cancelFrame();
    this.render();
  }

  /** Draw now; an animation loop is scheduled only while playing at speed > 0. */
  render() {
    if (!this.supported || this._destroyed || this._contextLost) return;
    this._cancelFrame();
    this._advanceTime();
    try {
      this._draw(this._gl.drawingBufferWidth, this._gl.drawingBufferHeight, null);
      this._scheduleFrame();
    } catch (error) {
      this._cancelFrame();
      this.supported = false;
      this._reportError(error);
    }
  }

  /**
   * Render an opaque PNG at the requested aspect ratio, without stretching.
   * Dimensions must be integers in [1, 4096], within the GPU's texture limits.
   * Captures the currently displayed animation time without advancing it.
   */
  async exportPNG(width, height) {
    let texture = null;
    let framebuffer = null;
    const gl = this._gl;
    try {
      if (this._destroyed) throw new Error('Cannot export from a destroyed LiquidRenderer.');
      if (!this.supported || !gl || this._contextLost || gl.isContextLost()) {
        throw new Error('Cannot export: WebGL is unavailable or its context is lost.');
      }
      if (!Number.isInteger(width) || !Number.isInteger(height) ||
          width < 1 || height < 1 || width > MAX_EXPORT_SIZE || height > MAX_EXPORT_SIZE) {
        throw new RangeError('PNG width and height must be integers between 1 and 4096.');
      }
      if (width > this._maxWidth || height > this._maxHeight) {
        throw new RangeError(`This GPU supports exports up to ${this._maxWidth} × ${this._maxHeight}.`);
      }

      const pixels = new Uint8Array(width * height * 4);
      texture = gl.createTexture();
      framebuffer = gl.createFramebuffer();
      if (!texture || !framebuffer) throw new Error('Unable to allocate PNG export resources.');
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('The GPU could not allocate a complete PNG framebuffer. Try a smaller export.');
      }
      this._draw(width, height, framebuffer);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const error = gl.getError();
      if (error !== gl.NO_ERROR || gl.isContextLost()) {
        throw new Error(`PNG rendering failed (WebGL error ${error}). Try a smaller export.`);
      }

      // WebGL rows run bottom-to-top; flip in place to avoid a second full image.
      const stride = width * 4;
      const row = new Uint8Array(stride);
      for (let top = 0, bottom = height - 1; top < bottom; top += 1, bottom -= 1) {
        const a = top * stride;
        const b = bottom * stride;
        row.set(pixels.subarray(a, a + stride));
        pixels.copyWithin(a, b, b + stride);
        pixels.set(row, b);
      }

      const ownerDocument = this.canvas.ownerDocument;
      let output;
      if (ownerDocument?.createElement) {
        output = ownerDocument.createElement('canvas');
        output.width = width;
        output.height = height;
      } else if (typeof globalThis.OffscreenCanvas === 'function') {
        output = new globalThis.OffscreenCanvas(width, height);
      } else {
        throw new Error('No canvas implementation is available to encode a PNG.');
      }
      const context = output.getContext('2d');
      if (!context) throw new Error('Unable to create the PNG encoding canvas.');
      const ImageDataType = this._window.ImageData ?? globalThis.ImageData;
      const image = new ImageDataType(new Uint8ClampedArray(pixels.buffer), width, height);
      context.putImageData(image, 0, 0);

      // Release GPU memory before asynchronous PNG encoding. The default
      // framebuffer was never resized, and no settings or clock state changed.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      framebuffer = null;
      texture = null;

      try {
        if (typeof output.convertToBlob === 'function') {
          return await output.convertToBlob({ type: 'image/png' });
        }
        return await new Promise((resolve, reject) => {
          output.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('PNG encoding failed. Try a smaller export.'));
          }, 'image/png');
        });
      } finally {
        output.width = 1;
        output.height = 1;
      }
    } catch (error) {
      this._reportError(error);
      throw error;
    } finally {
      if (gl && !gl.isContextLost()) {
        if (framebuffer) gl.deleteFramebuffer(framebuffer);
        if (texture) gl.deleteTexture(texture);
        if (!this._destroyed) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.bindTexture(gl.TEXTURE_2D, null);
          gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        }
      }
    }
  }

  destroy() {
    if (this._destroyed) return;
    this._cancelFrame();
    this._playing = false;
    this._lastTick = null;
    this._destroyed = true;
    this.supported = false;
    this.canvas?.removeEventListener?.('webglcontextlost', this._handleContextLost, false);
    this.canvas?.removeEventListener?.('webglcontextrestored', this._handleContextRestored, false);
    this._disposeResources();
    this._gl = null;
    this._onError = null;
  }

  _initialize() {
    const gl = this._gl;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Unable to allocate a WebGL shader.');
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader) || 'Unknown shader compiler error.';
        gl.deleteShader(shader);
        throw new Error(`Liquid shader compilation failed: ${log}`);
      }
      return shader;
    };
    let vertex = null;
    let fragment = null;
    let finish = null;
    try {
      vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
      fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      this._program = gl.createProgram();
      if (!this._program) throw new Error('Unable to allocate a WebGL program.');
      gl.attachShader(this._program, vertex);
      gl.attachShader(this._program, fragment);
      gl.bindAttribLocation(this._program, 0, 'a_position');
      gl.linkProgram(this._program);
      if (!gl.getProgramParameter(this._program, gl.LINK_STATUS)) {
        throw new Error(`Liquid shader link failed: ${gl.getProgramInfoLog(this._program)}`);
      }
      finish = compile(gl.FRAGMENT_SHADER, FINISH_SHADER);
      this._postProgram = gl.createProgram();
      if (!this._postProgram) throw new Error('Unable to allocate the optical finishing program.');
      gl.attachShader(this._postProgram, vertex);
      gl.attachShader(this._postProgram, finish);
      gl.bindAttribLocation(this._postProgram, 0, 'a_position');
      gl.linkProgram(this._postProgram);
      if (!gl.getProgramParameter(this._postProgram, gl.LINK_STATUS)) {
        throw new Error(`Optical finishing shader link failed: ${gl.getProgramInfoLog(this._postProgram)}`);
      }
      this._postUniforms = {
        image: gl.getUniformLocation(this._postProgram, 'u_image'),
        resolution: gl.getUniformLocation(this._postProgram, 'u_resolution'),
      };
      this._position = gl.getAttribLocation(this._program, 'a_position');
      this._uniforms = {};
      for (const name of [
        'resolution', 'time', 'shape', 'palette[0]', 'seed', 'flow',
        'intensity', 'distortion', 'scale', 'softness', 'grain', 'rotation',
        'dispersion', 'thickness', 'exposure',
      ]) {
        this._uniforms[name] = gl.getUniformLocation(this._program, `u_${name}`);
      }
      this._buffer = gl.createBuffer();
      if (!this._buffer) throw new Error('Unable to allocate the WebGL vertex buffer.');
      gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
      // A single oversized triangle avoids a diagonal seam and extra fragments.
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      const textureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const renderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
      this._maxWidth = Math.min(MAX_EXPORT_SIZE, textureSize, renderbufferSize, viewport[0]);
      this._maxHeight = Math.min(MAX_EXPORT_SIZE, textureSize, renderbufferSize, viewport[1]);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.DITHER);
      this.supported = true;
    } finally {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      if (finish) gl.deleteShader(finish);
    }
  }

  _createTarget(width, height) {
    const gl = this._gl;
    const target = { width, height, texture: gl.createTexture(), framebuffer: gl.createFramebuffer() };
    try {
      if (!target.texture || !target.framebuffer) throw new Error('Unable to allocate optical rendering resources.');
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('Not enough GPU memory for the optical render. Try a smaller resolution.');
      }
      gl.bindTexture(gl.TEXTURE_2D, null);
      return target;
    } catch (error) {
      this._deleteTarget(target);
      throw error;
    }
  }

  _deleteTarget(target) {
    if (!target || !this._gl || this._gl.isContextLost()) return;
    if (target.framebuffer) this._gl.deleteFramebuffer(target.framebuffer);
    if (target.texture) this._gl.deleteTexture(target.texture);
  }

  _draw(width, height, framebuffer) {
    const gl = this._gl;
    const exporting = framebuffer !== null;
    let target;
    if (exporting) {
      target = this._createTarget(width, height);
    } else {
      if (this._previewTarget?.width !== width || this._previewTarget?.height !== height) {
        this._deleteTarget(this._previewTarget);
        this._previewTarget = null;
        this._previewTarget = this._createTarget(width, height);
      }
      target = this._previewTarget;
    }
    try {
      this._drawScene(width, height, target.framebuffer);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.useProgram(this._postProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.uniform1i(this._postUniforms.image, 0);
      gl.uniform2f(this._postUniforms.resolution, width, height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } finally {
      gl.bindTexture(gl.TEXTURE_2D, null);
      if (exporting) this._deleteTarget(target);
    }
  }

  _drawScene(width, height, framebuffer) {
    const gl = this._gl;
    const u = this._uniforms;
    const s = this._settings;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, width, height);
    gl.useProgram(this._program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
    gl.enableVertexAttribArray(this._position);
    gl.vertexAttribPointer(this._position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(u.resolution, width, height);
    gl.uniform1f(u.time, this._time);
    gl.uniform1i(u.shape, s.shape);
    gl.uniform3fv(u['palette[0]'], this._palette);
    gl.uniform4fv(u.seed, this._seed);
    for (const key of PERCENT_SETTINGS) {
      if (key !== 'speed') gl.uniform1f(u[key], s[key] / 100);
    }
    gl.uniform1f(u.rotation, s.rotation * Math.PI / 180);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _advanceTime() {
    const now = clock();
    if (this._playing && this.supported && !this._contextLost && this._lastTick !== null) {
      // Do not jump ahead when a background tab resumes or an export stalls a frame.
      const elapsed = clamp((now - this._lastTick) / 1000, 0, 0.1);
      this._time = (this._time + elapsed * this._settings.speed / 100) % TIME_PERIOD;
    }
    this._lastTick = this._playing && this.supported ? now : null;
  }

  _requestRender() {
    if (this._frame === null && !this._destroyed && this.supported) {
      this._frame = this._window.requestAnimationFrame(this._tick);
    }
  }

  _scheduleFrame() {
    if (this._playing && this._settings.speed > 0) this._requestRender();
  }

  _cancelFrame() {
    if (this._frame !== null) {
      this._window.cancelAnimationFrame(this._frame);
      this._frame = null;
    }
  }

  _disposeResources() {
    const gl = this._gl;
    if (gl && !gl.isContextLost()) {
      // A current program is only marked for deletion until it is unbound.
      gl.useProgram(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      if (this._position >= 0) gl.disableVertexAttribArray(this._position);
      if (this._buffer) gl.deleteBuffer(this._buffer);
      if (this._program) gl.deleteProgram(this._program);
      if (this._postProgram) gl.deleteProgram(this._postProgram);
      this._deleteTarget(this._previewTarget);
    }
    this._previewTarget = null;
    this._postProgram = null;
    this._postUniforms = null;
    this._buffer = null;
    this._program = null;
    this._uniforms = null;
    this._position = -1;
  }

  _reportError(error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (this._onError) {
      try {
        this._onError(normalized);
      } catch (callbackError) {
        console.error('LiquidRenderer onError callback failed:', callbackError);
      }
    } else {
      console.error('LiquidRenderer:', normalized);
    }
  }
}
