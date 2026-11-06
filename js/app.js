import { state, save, applyTheme, h, sheet, selectRow, toggleRow, FELTS, BACKS, money, wallet, onWallet, refill, REFILL_AMOUNT, toast } from './core.js';
import { cardEl, makeCard } from './cards.js';

const GAMES = [
  { id: 'solitaire', name: 'Klondike Solitaire', blurb: 'Draw 1 or 3, Vegas scoring', icon: '♠', load: () => import('./games/solitaire.js') },
  { id: 'blackjack', name: 'Blackjack', blurb: 'Shoe game, Vegas Strip & downtown rules', icon: '♣', load: () => import('./games/blackjack.js') },
  { id: 'videopoker', name: 'Video Poker', blurb: 'Jacks or Better, Bonus, Double Double, Deuces Wild', icon: '♦', load: () => import('./games/videopoker.js') },
  { id: 'holdem', name: "Texas Hold'em", blurb: 'No-limit cash game or sit-and-go', icon: '♥', load: () => import('./games/poker.js') },
  { id: 'omaha', name: 'Omaha', blurb: 'Pot-limit, high or Hi-Lo 8', icon: '♠', load: () => import('./games/poker.js') },
  { id: 'stud', name: 'Seven Card Stud', blurb: 'Fixed limit with antes and bring-in', icon: '♣', load: () => import('./games/poker.js') },
  { id: 'draw', name: 'Five Card Draw', blurb: 'Classic draw poker', icon: '♦', load: () => import('./games/poker.js') },
];

export const APP_VERSION = 'v9';
const app = document.getElementById('app');
let cleanup = null;

export function topBar(title, { onOptions, onHelp, extra } = {}) {
  const w = h('span', { class: 'wallet', title: 'Play-money bankroll' }, money(wallet()));
  const off = onWallet((v) => { w.textContent = money(v); });
  const bar = h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn', 'aria-label': 'Back to games', onclick: () => { location.hash = ''; } }, '‹'),
    h('h1', {}, title),
    extra || null,
    w,
    onHelp ? h('button', { class: 'icon-btn', 'aria-label': 'How to play', onclick: onHelp }, '?') : null,
    onOptions ? h('button', { class: 'icon-btn', 'aria-label': 'Game options', onclick: onOptions }, '⚙') : null,
  );
  bar._off = off;
  return bar;
}

function home() {
  const tiles = GAMES.map((g) => h('a', { class: 'tile', href: '#' + g.id },
    h('span', { class: 'tile-icon' + (g.icon === '♥' || g.icon === '♦' ? ' red' : '') }, g.icon),
    h('span', { class: 'tile-text' }, h('strong', {}, g.name), h('small', {}, g.blurb))));

  const w = h('strong', {}, money(wallet()));
  const off = onWallet((v) => { w.textContent = money(v); });
  const refillBtn = h('button', { class: 'btn small', onclick: () => {
    if (wallet() >= REFILL_AMOUNT) toast(`Refills are available below ${money(REFILL_AMOUNT)}`);
    else { refill(); toast('Bankroll refilled'); }
  } }, 'Refill');

  const fan = h('div', { class: 'hero-fan', 'aria-hidden': 'true' },
    [makeCard(14, 'S'), makeCard(13, 'H'), makeCard(12, 'C'), makeCard(11, 'D'), makeCard(10, 'S')].map((c) => cardEl(c, true)));

  const view = h('div', { class: 'home felt' },
    h('div', { class: 'home-head' },
      fan,
      h('h1', { class: 'logo' }, 'High Card Casino'),
      h('p', { class: 'tag' }, 'Fair shuffles. Real Vegas rules. Play money only.'),
      h('div', { class: 'bankroll' }, h('span', {}, 'Bankroll '), w, refillBtn)),
    h('nav', { class: 'tiles' }, tiles),
    h('div', { class: 'home-foot' },
      h('button', { class: 'btn', onclick: openSettings }, '⚙ Table & Cards'),
      h('button', { class: 'btn', onclick: openStats }, 'Stats'),
      h('button', { class: 'btn', onclick: openAbout }, 'About')),
    h('p', { class: 'version' }, `Version ${APP_VERSION}`));
  app.replaceChildren(view);
  return () => off();
}

export function openSettings() {
  const preview = h('div', { class: 'settings-preview felt' }, cardEl(makeCard(14, 'S'), true), cardEl(makeCard(14, 'S'), false));
  const body = h('div', {},
    preview,
    selectRow('Table felt', state, 'felt', Object.entries(FELTS).map(([k, v]) => [k, v.name]), applyTheme),
    selectRow('Card back', state, 'back', Object.entries(BACKS), applyTheme),
    selectRow('Animation speed', state, 'animSpeed', [['fast', 'Fast'], ['normal', 'Normal'], ['slow', 'Slow'], ['off', 'Off']], applyTheme),
    toggleRow('Sound effects', state, 'sound'),
  );
  sheet('Table & Cards', body);
}

function openStats() {
  const rows = [];
  const label = { solitaire: 'Solitaire', blackjack: 'Blackjack', videopoker: 'Video Poker', poker: 'Poker', wallet: 'Bankroll' };
  for (const [g, s] of Object.entries(state.stats)) {
    rows.push(h('h3', {}, label[g] || g));
    for (const [k, v] of Object.entries(s)) rows.push(h('div', { class: 'row' }, h('span', {}, k.replace(/([A-Z])/g, ' $1').toLowerCase()), h('span', {}, typeof v === 'number' && /won|lost|net|best|wager/i.test(k) && !/hands|games/i.test(k) ? money(v) : String(v))));
  }
  if (!rows.length) rows.push(h('p', {}, 'Play a few hands and your stats will show up here.'));
  rows.push(h('div', { class: 'btn-row' }, h('button', { class: 'btn danger', onclick: () => { state.stats = {}; save(); toast('Stats cleared'); } }, 'Reset stats')));
  sheet('Stats', h('div', {}, rows));
}

function openAbout() {
  sheet('About', h('div', { class: 'prose' },
    h('p', {}, 'Every deck is shuffled with a Fisher-Yates shuffle driven by your device\'s cryptographic random number generator (the same kind used for encryption), so every card order is equally likely. There is no "streak" logic, no rigging and no adjusting the odds.'),
    h('p', {}, 'Chips are play money. Nothing here can be bought or cashed out. If you run low, refill from the main menu.'),
    h('p', {}, 'Install it: on iPhone/iPad open in Safari, tap Share, then "Add to Home Screen". On Android, Windows or Linux, open in Chrome or Edge and choose "Install app". After that it works offline.')));
}

async function route() {
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  document.querySelectorAll('.overlay').forEach((o) => o.remove());
  const id = location.hash.slice(1);
  const g = GAMES.find((x) => x.id === id);
  if (!g) { cleanup = home(); return; }
  app.replaceChildren(h('div', { class: 'loading felt' }, 'Shuffling…'));
  const mod = await g.load();
  cleanup = mod.mount(app, { id: g.id, title: g.name, topBar });
}

// Return chips left at a cash poker table if the app was closed mid-session.
if (state.pokerCashout) { state.wallet += state.pokerCashout; state.pokerCashout = 0; save(); }

applyTheme();
window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
    // Check for a new version on launch and whenever the app comes back to the foreground.
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 30 * 60 * 1000);
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || document.querySelector('.update-banner')) return;
    const b = h('button', { class: 'update-banner', onclick: () => location.reload() }, 'New version ready. Tap to update.');
    document.body.append(b);
  });
}
