import { createPerlin } from './perlin.js';

export const NodeCatalog = {
  CreateImage: {
    label: 'Create Image',
    inputs: [],
    outputs: ['image'],
    defaultParams: () => ({ width: 256, height: 256, color: '#8b5cf6' }),
    compute: async (params) => {
      const canvas = makeCanvas(params.width, params.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = params.color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return { image: canvas };
    },
    controls: (params, onChange) => [
      controlNumber('Width', params.width, v => onChange({ width: clampInt(v, 8, 2048) })),
      controlNumber('Height', params.height, v => onChange({ height: clampInt(v, 8, 2048) })),
      controlColor('Color', params.color, v => onChange({ color: v }))
    ]
  },
  Gradient: {
    label: 'Add Gradient',
    inputs: [],
    outputs: ['image'],
    defaultParams: () => ({ width: 256, height: 256, direction: 'horizontal', color1: '#0ea5e9', color2: '#8b5cf6' }),
    compute: async (params) => {
      const canvas = makeCanvas(params.width, params.height);
      const ctx = canvas.getContext('2d');
      const grad = params.direction === 'vertical'
        ? ctx.createLinearGradient(0, 0, 0, canvas.height)
        : ctx.createLinearGradient(0, 0, canvas.width, 0);
      grad.addColorStop(0, params.color1);
      grad.addColorStop(1, params.color2);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return { image: canvas };
    },
    controls: (params, onChange) => [
      controlSelect('Direction', params.direction, ['horizontal','vertical'], v => onChange({ direction: v })),
      controlNumber('Width', params.width, v => onChange({ width: clampInt(v, 8, 2048) })),
      controlNumber('Height', params.height, v => onChange({ height: clampInt(v, 8, 2048) })),
      controlColor('Color A', params.color1, v => onChange({ color1: v })),
      controlColor('Color B', params.color2, v => onChange({ color2: v }))
    ]
  },
  PerlinNoise: {
    label: 'Perlin Noise',
    inputs: [],
    outputs: ['image'],
    defaultParams: () => ({ width: 256, height: 256, scale: 0.02, octaves: 4, seed: 1337, contrast: 1.0 }),
    compute: async (params) => {
      const canvas = makeCanvas(params.width, params.height);
      const ctx = canvas.getContext('2d');
      const { noise2D } = createPerlin(params.seed);
      const data = ctx.createImageData(canvas.width, canvas.height);
      const freqBase = Math.max(0.0001, params.scale);
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          let amp = 1.0, freq = freqBase, sumAmp = 0.0, n = 0.0;
          for (let o = 0; o < Math.max(1, params.octaves|0); o++) {
            n += noise2D(x * freq, y * freq) * amp;
            sumAmp += amp;
            amp *= 0.5; freq *= 2.0;
          }
          let v = n / sumAmp; // 0..1
          // contrast
          v = Math.pow(v, Math.max(0.01, params.contrast));
          const i = (y * canvas.width + x) * 4;
          const c = (v * 255) | 0;
          data.data[i] = c; data.data[i+1] = c; data.data[i+2] = c; data.data[i+3] = 255;
        }
      }
      ctx.putImageData(data, 0, 0);
      return { image: canvas };
    },
    controls: (params, onChange) => [
      controlNumber('Width', params.width, v => onChange({ width: clampInt(v, 8, 2048) })),
      controlNumber('Height', params.height, v => onChange({ height: clampInt(v, 8, 2048) })),
      controlRange('Scale', params.scale, 0.002, 0.1, 0.002, v => onChange({ scale: v })),
      controlRange('Octaves', params.octaves, 1, 8, 1, v => onChange({ octaves: v })),
      controlRange('Contrast', params.contrast, 0.3, 2.0, 0.05, v => onChange({ contrast: v })),
      controlNumber('Seed', params.seed, v => onChange({ seed: clampInt(v, 1, 1<<30) }))
    ]
  },
  Combine: {
    label: 'Combine Images',
    inputs: ['A','B'],
    outputs: ['image'],
    defaultParams: () => ({ mode: 'multiply', alpha: 1.0 }),
    compute: async (params, inputs) => {
      const imgA = inputs['A']?.image;
      const imgB = inputs['B']?.image;
      const base = imgA || imgB;
      if (!base) return { image: makeCanvas(256, 256) };
      const w = base.width, h = base.height;
      const canvas = makeCanvas(w, h);
      const ctx = canvas.getContext('2d');

      if (!imgA) { ctx.drawImage(imgB, 0, 0); return { image: canvas }; }
      if (!imgB) { ctx.drawImage(imgA, 0, 0); return { image: canvas }; }

      // Manual pixel blend for predictable results
      const ca = getImageData(imgA);
      const cb = getImageData(imgB);
      const out = ctx.createImageData(w, h);
      const a = Math.max(0, Math.min(1, params.alpha));
      for (let i = 0; i < out.data.length; i += 4) {
        const r1 = ca.data[i] / 255, g1 = ca.data[i+1] / 255, b1 = ca.data[i+2] / 255;
        const r2 = cb.data[i] / 255, g2 = cb.data[i+1] / 255, b2 = cb.data[i+2] / 255;
        let r=0, g=0, b=0;
        switch (params.mode) {
          case 'add': r = r1 + r2; g = g1 + g2; b = b1 + b2; break;
          case 'multiply': r = r1 * r2; g = g1 * g2; b = b1 * b2; break;
          case 'screen': r = 1 - (1 - r1) * (1 - r2); g = 1 - (1 - g1) * (1 - g2); b = 1 - (1 - b1) * (1 - b2); break;
          case 'overlay': {
            const ov = (a,b) => (a < 0.5) ? (2*a*b) : (1 - 2*(1-a)*(1-b));
            r = ov(r1,r2); g = ov(g1,g2); b = ov(b1,b2); break;
          }
          case 'blend': default: r = r1*(1-a) + r2*a; g = g1*(1-a) + g2*a; b = b1*(1-a) + b2*a; break;
        }
        out.data[i] = Math.max(0, Math.min(255, (r*255)|0));
        out.data[i+1] = Math.max(0, Math.min(255, (g*255)|0));
        out.data[i+2] = Math.max(0, Math.min(255, (b*255)|0));
        out.data[i+3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      return { image: canvas };
    },
    controls: (params, onChange) => [
      controlSelect('Mode', params.mode, ['blend','add','multiply','screen','overlay'], v => onChange({ mode: v })),
      controlRange('Alpha', params.alpha, 0, 1, 0.05, v => onChange({ alpha: v }))
    ]
  },
  Display: {
    label: 'Display Image',
    inputs: ['image'],
    outputs: [],
    defaultParams: () => ({ }),
    compute: async (_params, inputs) => {
      // Pass-through; UI will present the image
      return { image: inputs['image']?.image || null };
    },
    controls: () => []
  }
};

// ---------- Helpers for node compute ----------
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.floor(w));
  c.height = Math.max(1, Math.floor(h));
  return c;
}
function getImageData(canvas) {
  const ctx = canvas.getContext('2d');
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
function clampInt(v, min, max) { v = Math.round(Number(v)||0); return Math.max(min, Math.min(max, v)); }

// ---------- Small UI control factories (DOM elements) ----------
export function controlNumber(label, value, onInput) {
  const wrap = document.createElement('div'); wrap.className = 'control';
  const lb = document.createElement('label'); lb.textContent = label; wrap.appendChild(lb);
  const input = document.createElement('input'); input.type = 'number'; input.value = String(value);
  input.addEventListener('change', () => onInput(Number(input.value)));
  wrap.appendChild(input); return wrap;
}
export function controlColor(label, value, onInput) {
  const wrap = document.createElement('div'); wrap.className = 'control';
  const lb = document.createElement('label'); lb.textContent = label; wrap.appendChild(lb);
  const input = document.createElement('input'); input.type = 'color'; input.value = String(value);
  input.addEventListener('input', () => onInput(input.value));
  wrap.appendChild(input); return wrap;
}
export function controlRange(label, value, min, max, step, onInput) {
  const wrap = document.createElement('div'); wrap.className = 'control';
  const lb = document.createElement('label'); lb.textContent = `${label}: ${value}`; wrap.appendChild(lb);
  const input = document.createElement('input'); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
  input.addEventListener('input', () => { const v = Number(input.value); lb.textContent = `${label}: ${v}`; onInput(v); });
  wrap.appendChild(input); return wrap;
}
export function controlSelect(label, value, options, onInput) {
  const wrap = document.createElement('div'); wrap.className = 'control';
  const lb = document.createElement('label'); lb.textContent = label; wrap.appendChild(lb);
  const sel = document.createElement('select');
  for (const opt of options) { const o = document.createElement('option'); o.value = opt; o.textContent = opt; if (opt===value) o.selected = true; sel.appendChild(o); }
  sel.addEventListener('change', () => onInput(sel.value));
  wrap.appendChild(sel); return wrap;
}
