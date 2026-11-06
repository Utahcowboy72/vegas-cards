import { state, save, applyTheme, h, sheet, selectRow, toggleRow, FELTS, BACKS, money, wallet, onWallet, refill, REFILL_AMOUNT, toast } from './core.js';
import { cardEl, makeCard } from './cards.js';

const GAMES = [
  { id: 'solitaire', name: 'Klondike Solitaire', blurb: 'Draw 1 or 3, Vegas scoring', icon: '♠', load: () => import('./games/solitaire.js') },
  { id: 'blackjack', name: 'Blackjack', blurb: 'Strip & downtown rules, 1 to 3 spots', icon: '♣', load: () => import('./games/blackjack.js') },
  { id: 'videopoker', name: 'Video Poker', blurb: 'Jacks or Better, Bonus, Deuces Wild & more', icon: '♦', load: () => import('./games/videopoker.js') },
  { id: 'holdem', name: "Texas Hold'em", blurb: 'No-limit cash game or sit-and-go', icon: '♥', load: () => import('./games/poker.js') },
  { id: 'omaha', name: 'Omaha', blurb: 'Pot-limit, high or Hi-Lo 8', icon: '♠', load: () => import('./games/poker.js') },
  { id: 'stud', name: 'Seven Card Stud', blurb: 'Fixed limit with antes and bring-in', icon: '♣', load: () => import('./games/poker.js') },
  { id: 'draw', name: 'Five Card Draw', blurb: 'Classic draw poker', icon: '♦', load: () => import('./games/poker.js') },
];

export const APP_VERSION = 'v11';
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

// Little card vignettes that show what each game looks like at a glance.
const ART = {
  solitaire: { kind: 'cascade', cards: [[13, 'S'], [12, 'H'], [11, 'C'], [10, 'D']] },
  blackjack: { kind: 'pair', cards: [[14, 'S'], [13, 'H']], badge: '21' },
  videopoker: { kind: 'row', cards: [[10, 'H'], [11, 'H'], [12, 'H'], [13, 'H'], [14, 'H']] },
  holdem: { kind: 'pair', cards: [[14, 'C'], [14, 'D']] },
  omaha: { kind: 'fan', cards: [[14, 'H'], [13, 'H'], [12, 'S'], [11, 'S']] },
  stud: { kind: 'stud', cards: [[0], [0], [9, 'C'], [9, 'D'], [9, 'H']] },
  draw: { kind: 'fan', cards: [[5, 'S'], [6, 'S'], [7, 'S'], [8, 'S'], [9, 'S']] },
};

function gameArt(id) {
  const a = ART[id];
  return h('div', { class: `art art-${a.kind} mobile-faces`, 'aria-hidden': 'true' },
    a.cards.map(([r, s]) => cardEl(r ? makeCard(r, s) : makeCard(2, 'S'), !!r)),
    a.badge ? h('span', { class: 'art-badge' }, a.badge) : null);
}

function gameTile(g, extra = '') {
  return h('a', { class: `tile tile-${g.id} ${extra}`, href: '#' + g.id },
    gameArt(g.id),
    h('span', { class: 'tile-text' }, h('strong', {}, g.name), h('small', {}, g.blurb)));
}

function home() {
  const byId = Object.fromEntries(GAMES.map((g) => [g.id, g]));

  const w = h('strong', {}, money(wallet()));
  const off = onWallet((v) => { w.textContent = money(v); });
  const refillBtn = h('button', { class: 'btn primary small', onclick: () => {
    if (wallet() >= REFILL_AMOUNT) toast(`Refills are available below ${money(REFILL_AMOUNT)}`);
    else { refill(); toast('Bankroll refilled'); }
  } }, 'Refill');

  const fan = h('div', { class: 'hero-fan', 'aria-hidden': 'true' },
    [makeCard(14, 'S'), makeCard(13, 'H'), makeCard(12, 'C'), makeCard(11, 'D'), makeCard(10, 'S')].map((c) => cardEl(c, true)));

  const view = h('div', { class: 'home felt' },
    h('div', { class: 'home-head' },
      h('div', { class: 'marquee' },
        fan,
        h('h1', { class: 'logo' }, h('span', { class: 'logo-top' }, 'High Card'), h('span', { class: 'logo-sub' }, 'Casino')),
        h('div', { class: 'suits-rule', 'aria-hidden': 'true' }, h('i'), '♠ ', h('b', {}, '♥'), ' ♣ ', h('b', {}, '♦'), h('i'))),
      h('div', { class: 'bankroll' }, h('span', { class: 'chip-ico', 'aria-hidden': 'true' }),
        h('span', { class: 'bk-text' }, h('small', {}, 'Bankroll'), w), refillBtn)),
    h('section', { class: 'lobby' },
      h('h2', { class: 'lobby-h' }, 'Table Games'),
      h('nav', { class: 'tiles' },
        gameTile(byId.solitaire, 'wide'), gameTile(byId.blackjack), gameTile(byId.videopoker)),
      h('h2', { class: 'lobby-h' }, 'Poker Room'),
      h('nav', { class: 'tiles' }, ['holdem', 'omaha', 'stud', 'draw'].map((id) => gameTile(byId[id])))),
    h('div', { class: 'home-foot' },
      h('button', { class: 'pill', onclick: openSettings }, h('span', { 'aria-hidden': 'true' }, '⚙'), ' Table & Cards'),
      h('button', { class: 'pill', onclick: openStats }, h('span', { 'aria-hidden': 'true' }, '▤'), ' Stats'),
      h('button', { class: 'pill', onclick: openAbout }, h('span', { 'aria-hidden': 'true' }, 'ⓘ'), ' About')),
    h('p', { class: 'version' }, `Play money only · Version ${APP_VERSION}`));
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
