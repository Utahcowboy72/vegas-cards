// Shared app services: settings, play-money wallet, stats, sound, UI helpers.

const KEY = 'vegas-cards-v1';

const DEFAULTS = {
  felt: 'green',
  back: 'classic-red',
  sound: true,
  animSpeed: 'normal',
  wallet: 1000,
  stats: {},
  games: {},
};

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...structuredClone(DEFAULTS), ...s };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const state = load();

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

// Per-game option blob with defaults merged in.
export function gameOpts(name, defaults) {
  state.games[name] = { ...defaults, ...(state.games[name] || {}) };
  return state.games[name];
}

export function stat(game, key, delta = 1) {
  const g = (state.stats[game] ||= {});
  g[key] = (g[key] || 0) + delta;
  save();
}
export function statMax(game, key, value) {
  const g = (state.stats[game] ||= {});
  if (g[key] === undefined || value > g[key]) g[key] = value;
  save();
}

// ---------- Wallet ----------
export const REFILL_AMOUNT = 1000;
const walletListeners = new Set();
export function onWallet(fn) { walletListeners.add(fn); return () => walletListeners.delete(fn); }
export function wallet() { return state.wallet; }
export function addWallet(n) {
  state.wallet = Math.round((state.wallet + n) * 100) / 100;
  save();
  walletListeners.forEach((f) => f(state.wallet));
}
export function canAfford(n) { return state.wallet >= n; }
export function refill() {
  if (state.wallet < REFILL_AMOUNT) {
    addWallet(REFILL_AMOUNT - state.wallet);
    stat('wallet', 'refills');
  }
}
export function money(n) {
  const neg = n < 0;
  const v = Math.abs(n);
  const s = Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (neg ? '-$' : '$') + s;
}

// ---------- Theme ----------
export const FELTS = {
  green: { name: 'Classic Green', c1: '#0f6b3a', c2: '#0a4d29' },
  blue: { name: 'Casino Blue', c1: '#145a8a', c2: '#0c3c5e' },
  red: { name: 'Crimson', c1: '#8e1b22', c2: '#5e1015' },
  purple: { name: 'Royal Purple', c1: '#4b2a7a', c2: '#2f1a4e' },
  black: { name: 'High Limit Black', c1: '#2a2a2e', c2: '#151517' },
  teal: { name: 'Teal', c1: '#0e6f6a', c2: '#084a47' },
  tan: { name: 'Desert Tan', c1: '#8a6b3c', c2: '#5e4826' },
};
export const BACKS = {
  'classic-red': 'Classic Red',
  'classic-blue': 'Classic Blue',
  'diamond-black': 'Black Diamond',
  'gold-lattice': 'Gold Lattice',
  'green-check': 'Green Check',
  'purple-star': 'Purple Star',
};

export function applyTheme() {
  const f = FELTS[state.felt] || FELTS.green;
  const root = document.documentElement;
  root.style.setProperty('--felt1', f.c1);
  root.style.setProperty('--felt2', f.c2);
  document.body.dataset.back = state.back;
  document.body.dataset.anim = state.animSpeed;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', f.c2);
}

export function animMs(base) {
  const m = { fast: 0.5, normal: 1, slow: 1.6, off: 0 }[state.animSpeed] ?? 1;
  return base * m;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const wait = (base) => sleep(animMs(base));

// ---------- Sound (synthesised, no audio files) ----------
let ctx;
function ac() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function noiseBurst(dur, freq, gain) {
  const a = ac();
  if (!a) return;
  const len = Math.floor(a.sampleRate * dur);
  const b = a.createBuffer(1, len, a.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = a.createBufferSource();
  src.buffer = b;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}
function tone(freq, dur, gain = 0.08, type = 'sine') {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur);
}
export const sfx = {
  card() { if (state.sound) noiseBurst(0.06, 2500, 0.5); },
  chip() { if (state.sound) { tone(2200, 0.05, 0.05, 'triangle'); setTimeout(() => tone(2600, 0.04, 0.04, 'triangle'), 30); } },
  win() { if (state.sound) [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.18, 0.07), i * 90)); },
  lose() { if (state.sound) tone(220, 0.25, 0.05, 'sawtooth'); },
  shuffle() { if (state.sound) for (let i = 0; i < 8; i++) setTimeout(() => noiseBurst(0.04, 3000, 0.3), i * 35); },
};

// ---------- DOM helpers ----------
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function toast(msg, ms = 1800) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

// Modal sheet. fields: built nodes. Returns close fn.
export function sheet(title, body, { onClose } = {}) {
  const overlay = h('div', { class: 'overlay' });
  const close = () => { overlay.remove(); onClose?.(); };
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕')),
    h('div', { class: 'sheet-body' }, body));
  overlay.append(panel);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.append(overlay);
  return close;
}

// Form row builders for option menus. They mutate obj[key] and call onChange.
export function selectRow(label, obj, key, options, onChange) {
  const sel = h('select', {
    onchange: (e) => {
      const raw = e.target.value;
      const opt = options.find(([v]) => String(v) === raw);
      obj[key] = opt ? opt[0] : raw;
      save();
      onChange?.(obj[key]);
    },
  }, options.map(([v, t]) => h('option', { value: String(v), selected: String(obj[key]) === String(v) }, t)));
  return h('label', { class: 'row' }, h('span', {}, label), sel);
}
export function toggleRow(label, obj, key, onChange, hint) {
  const cb = h('input', { type: 'checkbox', checked: !!obj[key], onchange: (e) => { obj[key] = e.target.checked; save(); onChange?.(obj[key]); } });
  return h('label', { class: 'row' }, h('span', {}, label, hint ? h('small', {}, hint) : null), h('span', { class: 'switch' }, cb, h('i')));
}

export function confirmBox(title, msg, okText = 'OK') {
  return new Promise((resolve) => {
    let done = false;
    const close = sheet(title, h('div', {},
      h('p', {}, msg),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => { done = true; close(); resolve(false); } }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => { done = true; close(); resolve(true); } }, okText))),
    { onClose: () => { if (!done) resolve(false); } });
  });
}
