// Klondike solitaire with draw 1/3, pass limits, standard & Vegas scoring, left-handed layout.
import { shuffledDeck, cardEl, setCardFace, isRed, shuffle } from '../cards.js';
import { h, gameOpts, save, sheet, selectRow, toggleRow, toast, sfx, stat, statMax, addWallet, wallet, money, canAfford, confirmBox, state as appState } from '../core.js';

const OPTS = {
  draw: 3,
  passes: 'unlimited', // 'unlimited' | 3 | 1
  scoring: 'standard', // 'none' | 'standard' | 'vegas' | 'vegas-bankroll'
  leftHanded: false,
  tapToMove: true,
  autoPlay: false,
  timer: true,
};

const VEGAS_ANTE = 52;
const VEGAS_PER_CARD = 5;

export function mount(root, { topBar }) {
  const o = gameOpts('solitaire', OPTS);
  let g; // game state
  let history = [];
  let timerId = null;
  const els = new Map(); // card id -> element
  let layout = null;
  let drag = null;

  const scoreEl = h('span', {});
  const movesEl = h('span', {});
  const timeEl = h('span', {});
  const passEl = h('span', {});
  const info = h('div', { class: 'sol-info' }, scoreEl, movesEl, timeEl, passEl);

  const board = h('div', { class: 'sol-board' });
  const undoBtn = h('button', { class: 'btn', onclick: undo }, '↶ Undo');
  const hintBtn = h('button', { class: 'btn', onclick: hint }, 'Hint');
  const autoBtn = h('button', { class: 'btn primary', onclick: autoFinish, style: { display: 'none' } }, 'Auto finish');
  const newBtn = h('button', { class: 'btn', onclick: () => newGameAsk() }, 'New deal');
  const shuffleBtn = h('button', { class: 'btn', onclick: () => reshuffleStock() }, '⇄ Shuffle');
  const bar = h('div', { class: 'action-bar' }, h('div', { class: 'btn-row' }, newBtn, undoBtn, shuffleBtn, hintBtn, autoBtn));

  const topEl = topBar('Klondike', { onOptions: openOptions, onHelp: openHelp });
  const view = h('div', { class: 'game sol felt' }, topEl, info, board, bar);
  root.replaceChildren(view);

  // ---------- Game setup ----------
  function newGame() {
    const vegasBank = o.scoring === 'vegas-bankroll';
    if (vegasBank) {
      if (!canAfford(VEGAS_ANTE)) {
        toast(`You need ${money(VEGAS_ANTE)} to buy a Vegas deck. Refill from the main menu.`, 3000);
        o.scoring = 'vegas';
        save();
      } else {
        addWallet(-VEGAS_ANTE);
        stat('solitaire', 'vegasWagered', VEGAS_ANTE);
      }
    }
    const deck = shuffledDeck(1);
    const tableau = [];
    for (let i = 0; i < 7; i++) {
      tableau.push([]);
      for (let j = 0; j <= i; j++) tableau[i].push({ c: deck.pop(), up: j === i });
    }
    g = {
      stock: deck.map((c) => ({ c, up: false })),
      waste: [],
      found: [[], [], [], []],
      tab: tableau,
      draw: o.draw,
      passesAllowed: o.passes === 'unlimited' ? Infinity : Number(o.passes),
      pass: 1,
      scoring: o.scoring,
      score: o.scoring.startsWith('vegas') ? -VEGAS_ANTE : 0,
      moves: 0,
      start: 0,
      elapsed: 0,
      won: false,
      started: false,
    };
    history = [];
    stat('solitaire', 'gamesPlayed');
    for (const el of els.values()) el.remove();
    els.clear();
    sfx.shuffle();
    buildSlots();
    render(true);
    tick();
  }

  async function newGameAsk() {
    if (g && g.started && !g.won) {
      const msg = o.scoring === 'vegas-bankroll' ? `Start a new deal? This one is over and a new deck costs ${money(VEGAS_ANTE)}.` : 'Start a new deal? This game will count as a loss.';
      if (!(await confirmBox('New deal', msg, 'Deal'))) return;
    }
    newGame();
  }

  // ---------- Rules ----------
  const top = (pile) => pile[pile.length - 1];
  function canFound(card, fi) {
    const f = g.found[fi];
    if (!f.length) return card.r === 14;
    const t = top(f).c;
    return t.s === card.s && rankUp(t.r) === card.r;
  }
  // Aces are stored as 14; in solitaire ace is low.
  function low(r) { return r === 14 ? 1 : r; }
  function rankUp(r) { return low(r) + 1; }
  function canTab(card, ti) {
    const col = g.tab[ti];
    if (!col.length) return low(card.r) === 13;
    const t = top(col);
    if (!t.up) return false;
    return isRed(t.c.s) !== isRed(card.s) && low(t.c.r) === low(card.r) + 1;
  }

  function snapshot() {
    history.push(JSON.stringify({ ...g, passesAllowed: g.passesAllowed === Infinity ? 'inf' : g.passesAllowed }));
    if (history.length > 500) history.shift();
  }

  function undo() {
    if (!history.length) return;
    if (g.scoring === 'vegas-bankroll') { toast('No undo when playing for bankroll, just like the casino.'); return; }
    const prev = JSON.parse(history.pop());
    prev.passesAllowed = prev.passesAllowed === 'inf' ? Infinity : prev.passesAllowed;
    const elapsed = g.elapsed;
    g = prev;
    g.elapsed = elapsed;
    g.moves += 1; // undo counts as a move in most scoring schemes
    if (g.scoring === 'standard') g.score = Math.max(0, g.score - 2);
    render();
  }

  function addScore(kind) {
    if (g.scoring === 'standard') {
      const pts = { wasteTab: 5, toFound: 10, flip: 5, fromFound: -15, recycle: g.draw === 1 ? -100 : -20 }[kind] || 0;
      g.score = Math.max(0, g.score + pts);
    } else if (g.scoring.startsWith('vegas')) {
      const d = kind === 'toFound' ? VEGAS_PER_CARD : kind === 'fromFound' ? -VEGAS_PER_CARD : 0;
      g.score += d;
      if (d && g.scoring === 'vegas-bankroll') addWallet(d);
    }
  }

  function startClock() {
    if (!g.started) { g.started = true; g.start = Date.now() - g.elapsed * 1000; }
  }

  // Move cards: from = {pile:'waste'|'tab'|'found', i, idx}, to = {pile:'tab'|'found', i}
  function doMove(from, to) {
    const src = pileOf(from);
    const moving = src.slice(from.idx);
    snapshot();
    startClock();
    src.length = from.idx;
    pileOf(to).push(...moving);
    if (to.pile === 'found') addScore('toFound');
    if (from.pile === 'waste' && to.pile === 'tab') addScore('wasteTab');
    if (from.pile === 'found') addScore('fromFound');
    if (from.pile === 'tab' && src.length && !top(src).up) {
      top(src).up = true;
      addScore('flip');
    }
    g.moves++;
    sfx.card();
    afterMove();
  }

  function pileOf(loc) {
    if (loc.pile === 'waste') return g.waste;
    if (loc.pile === 'found') return g.found[loc.i];
    if (loc.pile === 'stock') return g.stock;
    return g.tab[loc.i];
  }

  // Gather every card that isn't face up in play (stock, waste and the face-down tableau cards), shuffle them
  // fairly, and deal them back: each column keeps the same number of face-down cards, the rest go to the stock.
  // Face-up tableau runs and foundations stay put.
  function reshuffleStock() {
    if (!g || g.won) return;
    const downCounts = g.tab.map((col) => col.filter((x) => !x.up).length);
    const pool = g.stock.concat(g.waste).map((x) => x.c);
    g.tab.forEach((col) => col.forEach((x) => { if (!x.up) pool.push(x.c); }));
    if (pool.length < 2) { toast('No face-down cards left to shuffle.'); return; }
    if (g.scoring === 'vegas-bankroll') { toast('Reshuffling is not allowed when playing for bankroll.'); return; }
    snapshot();
    startClock();
    const order = shuffle(pool);
    g.tab.forEach((col, i) => {
      // Face-down cards always sit at the bottom of a column, below the face-up run.
      for (let k = 0; k < downCounts[i]; k++) col[k] = { c: order.pop(), up: false };
    });
    g.stock = order.map((c) => ({ c, up: false }));
    g.waste = [];
    g.moves++;
    if (g.scoring === 'standard') g.score = Math.max(0, g.score - 20);
    sfx.shuffle();
    // Little riffle: wiggle the stock pile.
    const els2 = g.stock.slice(-6).map((x) => els.get(x.c.id));
    els2.forEach((el, k) => el?.animate?.([{ transform: 'translateX(0)' }, { transform: `translateX(${k % 2 ? 10 : -10}px) rotate(${k % 2 ? 6 : -6}deg)` }, { transform: 'translateX(0)' }], { duration: 380, delay: k * 30 }));
    render();
    toast('Face-down cards shuffled');
  }

  function drawStock() {
    if (g.won) return;
    startClock();
    if (g.stock.length) {
      snapshot();
      const n = Math.min(g.draw, g.stock.length);
      for (let i = 0; i < n; i++) {
        const x = g.stock.pop();
        x.up = true;
        g.waste.push(x);
      }
      g.moves++;
      sfx.card();
    } else if (g.waste.length) {
      if (g.pass >= g.passesAllowed) { toast(g.passesAllowed === 1 ? 'Only one pass through the deck in this mode.' : `No passes left (limit ${g.passesAllowed}).`); return; }
      snapshot();
      g.stock = g.waste.reverse().map((x) => ({ c: x.c, up: false }));
      g.waste = [];
      g.pass++;
      g.moves++;
      addScore('recycle');
      sfx.shuffle();
    }
    afterMove();
  }

  function afterMove() {
    if (o.autoPlay) autoPlaySafe();
    render();
    if (g.found.every((f) => f.length === 13)) win();
  }

  // Safe auto-play: move a card to foundation when no tableau build could still need it.
  function autoPlaySafe() {
    let moved = true;
    while (moved) {
      moved = false;
      const cands = [];
      if (g.waste.length) cands.push({ pile: 'waste', i: 0, idx: g.waste.length - 1 });
      g.tab.forEach((col, i) => { if (col.length && top(col).up) cands.push({ pile: 'tab', i, idx: col.length - 1 }); });
      for (const from of cands) {
        const card = pileOf(from)[from.idx].c;
        const r = low(card.r);
        const opp = g.found.filter((f) => f.length && isRed(f[0].c.s) !== isRed(card.s)).map((f) => f.length);
        const minOpp = opp.length === 2 ? Math.min(...opp) : 0;
        if (r > 2 && minOpp < r - 1) continue;
        const fi = g.found.findIndex((_, k) => canFound(card, k));
        if (fi >= 0) {
          const src = pileOf(from);
          src.pop();
          g.found[fi].push({ c: card, up: true });
          addScore('toFound');
          if (from.pile === 'tab' && src.length && !top(src).up) { top(src).up = true; addScore('flip'); }
          moved = true;
          break;
        }
      }
    }
  }

  function bestTarget(from) {
    const src = pileOf(from);
    const card = src[from.idx].c;
    const single = from.idx === src.length - 1;
    if (single && from.pile !== 'found') {
      for (let fi = 0; fi < 4; fi++) if (canFound(card, fi)) return { pile: 'found', i: fi };
    }
    // Prefer non-empty tableau targets, then empty columns (not for a king already at the base of a column).
    const order = [...g.tab.keys()];
    for (const ti of order) {
      if (from.pile === 'tab' && from.i === ti) continue;
      if (g.tab[ti].length && canTab(card, ti)) return { pile: 'tab', i: ti };
    }
    if (from.pile === 'tab' && from.idx === 0) return null;
    for (const ti of order) {
      if (from.pile === 'tab' && from.i === ti) continue;
      if (!g.tab[ti].length && canTab(card, ti)) return { pile: 'tab', i: ti };
    }
    return null;
  }

  function findMoves() {
    const moves = [];
    const froms = [];
    if (g.waste.length) froms.push({ pile: 'waste', i: 0, idx: g.waste.length - 1 });
    g.tab.forEach((col, i) => col.forEach((x, idx) => { if (x.up) froms.push({ pile: 'tab', i, idx }); }));
    for (const from of froms) {
      const t = bestTarget(from);
      if (!t) continue;
      // Skip pointless shuffles of a fully built stack onto another column unless it uncovers a card.
      if (from.pile === 'tab' && t.pile === 'tab' && from.idx > 0 && pileOf(from)[from.idx - 1].up) continue;
      moves.push({ from, to: t });
    }
    return moves;
  }

  function hint() {
    const m = findMoves();
    if (m.length) {
      const pile = pileOf(m[0].from);
      const el = els.get(pile[m[0].from.idx].c.id);
      el?.classList.remove('hint'); void el?.offsetWidth; el?.classList.add('hint');
    } else if (g.stock.length || (g.waste.length && g.pass < g.passesAllowed)) {
      toast('Draw from the stock.');
    } else toast('No moves left. Try a new deal.');
  }

  function canAutoFinish() {
    return !g.won && !g.stock.length && !g.waste.length && g.tab.every((col) => col.every((x) => x.up));
  }

  async function autoFinish() {
    autoBtn.disabled = true;
    while (!g.won) {
      let moved = false;
      for (let ti = 0; ti < 7 && !moved; ti++) {
        const col = g.tab[ti];
        if (!col.length) continue;
        for (let fi = 0; fi < 4; fi++) if (canFound(top(col).c, fi)) { doMove({ pile: 'tab', i: ti, idx: col.length - 1 }, { pile: 'found', i: fi }); moved = true; break; }
      }
      if (!moved) break;
      await new Promise((r) => setTimeout(r, appState.animSpeed === 'off' ? 0 : 70));
    }
    autoBtn.disabled = false;
  }

  function win() {
    if (g.won) return;
    g.won = true;
    g.elapsed = (Date.now() - g.start) / 1000;
    let bonus = 0;
    if (g.scoring === 'standard' && g.elapsed > 30) bonus = Math.round(700000 / g.elapsed);
    g.score += bonus;
    stat('solitaire', 'gamesWon');
    statMax('solitaire', 'bestScore' + (g.scoring.startsWith('vegas') ? 'Vegas' : ''), g.score);
    const best = (appState.stats.solitaire.fastestWinSeconds);
    if (!best || g.elapsed < best) appState.stats.solitaire.fastestWinSeconds = Math.round(g.elapsed);
    save();
    sfx.win();
    render();
    celebrate(bonus);
  }

  function celebrate(bonus) {
    const msg = g.scoring.startsWith('vegas') ? `You won! ${money(g.score)}` : g.scoring === 'standard' ? `You won! ${g.score.toLocaleString()} pts${bonus ? ` (time bonus ${bonus.toLocaleString()})` : ''}` : 'You won!';
    const b = h('div', { class: 'banner' }, msg);
    board.append(b);
    // Cascade the foundation cards for a bit of flair.
    const cards = g.found.flat().map((x) => els.get(x.c.id));
    cards.forEach((el, k) => {
      setTimeout(() => {
        el.style.transition = 'left 1.2s ease-in, top 1.2s cubic-bezier(.3,-0.6,.7,1), transform 1.2s';
        el.style.left = Math.random() * (layout.W - layout.cw) + 'px';
        el.style.top = layout.H + 'px';
        el.style.transform = `rotate(${(Math.random() * 2 - 1) * 180}deg)`;
      }, k * 40);
    });
    setTimeout(() => b.remove(), 4000);
  }

  // ---------- Layout & rendering ----------
  let slotEls = {};
  function buildSlots() {
    board.querySelectorAll('.slot').forEach((s) => s.remove());
    slotEls = {
      stock: h('div', { class: 'slot stock-slot', onclick: drawStock }, '↻'),
      found: [0, 1, 2, 3].map(() => h('div', { class: 'slot' }, 'A')),
      tab: [0, 1, 2, 3, 4, 5, 6].map(() => h('div', { class: 'slot' }, 'K')),
    };
    board.append(slotEls.stock, ...slotEls.found, ...slotEls.tab);
  }

  function computeLayout() {
    const W = board.clientWidth;
    const H = board.clientHeight;
    const pad = Math.max(4, Math.round(W * 0.01));
    const gap = Math.max(3, Math.round(W * 0.008));
    let cw = Math.floor((W - 2 * pad - 6 * gap) / 7);
    // Limit by height so the top row + a 13-card run fits on wide screens.
    cw = Math.min(cw, Math.floor((H - 3 * pad) / (1.4 * 2 + 1.4 * 0.25 * 12)), 130);
    cw = Math.max(cw, 36);
    const ch = Math.round(cw * (cw < 72 ? 1.45 : 1.4));
    const totalW = 7 * cw + 6 * gap;
    const left = Math.round((W - totalW) / 2);
    const colX = (i) => left + (o.leftHanded ? 6 - i : i) * (cw + gap);
    const tabY = pad + ch + Math.max(gap * 2, 12);
    view.style.setProperty('--cw', cw + 'px');
    view.style.setProperty('--ratio', String(ch / cw));
    board.classList.toggle('mobile-faces', cw < 72);
    return { W, H, pad, gap, cw, ch, colX, tabY };
  }

  function place(el, x, y, z, card, up) {
    if (el._up !== up) {
      setCardFace(el, card, up);
      if (el._up !== undefined && up) { el.classList.remove('flip-in'); void el.offsetWidth; el.classList.add('flip-in'); }
      el._up = up;
    }
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.zIndex = z;
  }

  function getEl(x) {
    let el = els.get(x.c.id);
    if (!el) {
      el = cardEl(x.c, x.up, 'sol-card');
      el._up = x.up;
      el.addEventListener('pointerdown', onDown);
      els.set(x.c.id, el);
      board.append(el);
    }
    return el;
  }

  function render(dealing = false) {
    if (!g) return;
    layout = computeLayout();
    const { cw, ch, colX, tabY, pad, H } = layout;
    const ty = pad;
    // Stock / waste / foundations on the top row. Mirrored for left-handed.
    const stockX = colX(0);
    const wasteX = colX(1);
    const fanDir = o.leftHanded ? -1 : 1;
    const fanStep = Math.round(cw * 0.42);

    const setSlot = (el, x, y) => { el.style.left = x + 'px'; el.style.top = y + 'px'; };
    setSlot(slotEls.stock, stockX, ty);
    slotEls.stock.textContent = g.stock.length ? '' : (g.waste.length && g.pass < g.passesAllowed ? '↻' : '✕');
    g.found.forEach((_, i) => setSlot(slotEls.found[i], colX(3 + i), ty));
    g.tab.forEach((_, i) => setSlot(slotEls.tab[i], colX(i), tabY));

    let z = 1;
    g.stock.forEach((x, k) => {
      const el = getEl(x);
      const off = Math.min(Math.floor(k / 8), 3) * 1.5;
      place(el, stockX + off * fanDir * -1, ty - off, z++, x.c, false);
      el.dataset.loc = 'stock';
    });

    const visibleFan = g.draw === 3 ? 3 : 1;
    const fanStart = Math.max(0, g.waste.length - visibleFan);
    g.waste.forEach((x, k) => {
      const el = getEl(x);
      const fanIdx = k >= fanStart ? k - fanStart : 0;
      place(el, wasteX + fanIdx * fanStep * fanDir, ty, z++, x.c, true);
      el.dataset.loc = `waste:0:${k}`;
    });

    g.found.forEach((f, i) => f.forEach((x, k) => {
      const el = getEl(x);
      place(el, colX(3 + i), ty, z++, x.c, true);
      el.dataset.loc = `found:${i}:${k}`;
    }));

    const avail = H - tabY - pad - ch;
    g.tab.forEach((col, i) => {
      const downs = col.filter((x) => !x.up).length;
      const ups = col.length - downs;
      // Roomy spacing like a real table; only squeeze a column when it would run off the screen.
      let dOff = ch * (layout.cw < 72 ? 0.11 : 0.16);
      let uOff = ch * (layout.cw < 72 ? 0.3 : 0.36);
      const need = downs * dOff + Math.max(0, ups - 1) * uOff;
      if (need > avail && ups > 1) {
        uOff = Math.max(ch * 0.22, (avail - downs * dOff) / (ups - 1));
        if (downs * dOff + (ups - 1) * uOff > avail) {
          dOff = Math.max(ch * 0.07, (avail - (ups - 1) * uOff) / Math.max(1, downs));
          if (downs * dOff + (ups - 1) * uOff > avail) uOff = Math.max(ch * 0.16, (avail - downs * dOff) / (ups - 1));
        }
      }
      let y = tabY;
      col.forEach((x, k) => {
        const el = getEl(x);
        place(el, colX(i), y, 100 + k, x.c, x.up);
        el.dataset.loc = `tab:${i}:${k}`;
        y += x.up ? uOff : dOff;
      });
    });

    if (dealing && appState.animSpeed !== 'off') {
      // Deal animation: cards fly from the stock position in order.
      const order = [];
      for (let row = 0; row < 7; row++) for (let i = row; i < 7; i++) order.push(g.tab[i][row]);
      order.forEach((x, k) => {
        const el = els.get(x.c.id);
        const fx = el.style.left; const fy = el.style.top;
        el.style.transition = 'none';
        el.style.left = stockX + 'px'; el.style.top = ty + 'px';
        void el.offsetWidth;
        setTimeout(() => { el.style.transition = ''; el.style.left = fx; el.style.top = fy; if (k % 3 === 0) sfx.card(); }, 20 + k * (appState.animSpeed === 'fast' ? 12 : appState.animSpeed === 'slow' ? 45 : 25));
      });
    }

    updateInfo();
    undoBtn.disabled = !history.length || g.scoring === 'vegas-bankroll';
    autoBtn.style.display = canAutoFinish() ? '' : 'none';
    hintBtn.style.display = canAutoFinish() ? 'none' : '';
    shuffleBtn.disabled = g.scoring === 'vegas-bankroll';
  }

  function updateInfo() {
    if (g.scoring === 'none') scoreEl.textContent = '';
    else if (g.scoring.startsWith('vegas')) scoreEl.textContent = `Vegas ${money(g.score)}`;
    else scoreEl.textContent = `Score ${g.score}`;
    movesEl.textContent = `Moves ${g.moves}`;
    passEl.textContent = g.passesAllowed === Infinity ? `Draw ${g.draw}` : `Draw ${g.draw} · Pass ${Math.min(g.pass, g.passesAllowed)}/${g.passesAllowed}`;
    if (o.timer) {
      const s = g.won ? Math.round(g.elapsed) : g.started ? Math.floor((Date.now() - g.start) / 1000) : 0;
      timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    } else timeEl.textContent = '';
  }

  function tick() {
    clearInterval(timerId);
    timerId = setInterval(() => { if (g && g.started && !g.won) { g.elapsed = (Date.now() - g.start) / 1000; updateInfo(); } }, 1000);
  }

  // ---------- Input ----------
  function parseLoc(s) {
    const [pile, i, idx] = s.split(':');
    return { pile, i: Number(i), idx: Number(idx) };
  }

  function onDown(e) {
    if (g.won || e.button > 0) return;
    const el = e.currentTarget;
    const locStr = el.dataset.loc;
    if (locStr === 'stock') { drawStock(); return; }
    const from = parseLoc(locStr);
    const pile = pileOf(from);
    const item = pile[from.idx];
    if (!item.up) return;
    if (from.pile === 'waste' && from.idx !== g.waste.length - 1) return;
    if (from.pile === 'found' && from.idx !== pile.length - 1) return;
    e.preventDefault();
    const moving = pile.slice(from.idx).map((x) => els.get(x.c.id));
    const rect = board.getBoundingClientRect();
    drag = {
      from, moving, startX: e.clientX, startY: e.clientY, active: false,
      origin: moving.map((m) => ({ x: parseFloat(m.style.left), y: parseFloat(m.style.top) })), rect,
    };
    el.setPointerCapture?.(e.pointerId);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp, { once: true });
    el.addEventListener('pointercancel', onUp, { once: true });
  }

  function onMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.active && Math.hypot(dx, dy) > 6) {
      drag.active = true;
      drag.moving.forEach((m, k) => { m.classList.add('dragging'); m.style.zIndex = 1000 + k; });
    }
    if (drag.active) drag.moving.forEach((m, k) => { m.style.left = drag.origin[k].x + dx + 'px'; m.style.top = drag.origin[k].y + dy + 'px'; });
  }

  function onUp(e) {
    const el = e.currentTarget;
    el.removeEventListener('pointermove', onMove);
    const d = drag;
    drag = null;
    if (!d) return;
    d.moving.forEach((m) => m.classList.remove('dragging'));
    if (!d.active) {
      if (o.tapToMove) {
        const t = bestTarget(d.from);
        if (t) { doMove(d.from, t); return; }
        el.classList.remove('hint'); void el.offsetWidth;
        el.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 180 });
      }
      render();
      return;
    }
    const target = dropTarget(d);
    if (target) doMove(d.from, target);
    else render();
  }

  function dropTarget(d) {
    const { cw, ch, colX, tabY, pad } = layout;
    const lead = d.moving[0];
    const x = parseFloat(lead.style.left);
    const y = parseFloat(lead.style.top);
    const card = pileOf(d.from)[d.from.idx].c;
    const single = d.moving.length === 1;
    let best = null; let bestArea = 0;
    const overlap = (rx, ry, rw, rh) => Math.max(0, Math.min(x + cw, rx + rw) - Math.max(x, rx)) * Math.max(0, Math.min(y + ch, ry + rh) - Math.max(y, ry));
    if (single) for (let fi = 0; fi < 4; fi++) {
      if (d.from.pile === 'found' && d.from.i === fi) continue;
      const a = overlap(colX(3 + fi), pad, cw, ch);
      if (a > bestArea && canFound(card, fi)) { best = { pile: 'found', i: fi }; bestArea = a; }
    }
    for (let ti = 0; ti < 7; ti++) {
      if (d.from.pile === 'tab' && d.from.i === ti) continue;
      const col = g.tab[ti];
      const lastEl = col.length ? els.get(top(col).c.id) : null;
      const bottom = lastEl ? parseFloat(lastEl.style.top) + ch : tabY + ch;
      const a = overlap(colX(ti), tabY, cw, bottom - tabY);
      if (a > bestArea && canTab(card, ti)) { best = { pile: 'tab', i: ti }; bestArea = a; }
    }
    return best;
  }

  // ---------- Menus ----------
  function openOptions() {
    const changed = { needsNew: false };
    const needNew = () => { changed.needsNew = true; };
    const body = h('div', {},
      h('h3', {}, 'Deal'),
      selectRow('Cards per draw', o, 'draw', [[1, 'Draw 1'], [3, 'Draw 3']], needNew),
      selectRow('Passes through deck', o, 'passes', [['unlimited', 'Unlimited'], [3, '3 passes'], [1, '1 pass']], needNew),
      selectRow('Scoring', o, 'scoring', [['none', 'None'], ['standard', 'Standard points'], ['vegas', 'Vegas (practice)'], ['vegas-bankroll', 'Vegas (uses bankroll)']], needNew),
      h('p', { class: 'prose' }, h('small', {}, `Vegas: the deck costs ${money(VEGAS_ANTE)} and every card you put on a foundation pays ${money(VEGAS_PER_CARD)}. Casino rules allowed 1 pass on draw 1 and 3 passes on draw 3. "Uses bankroll" charges your real play-money bankroll and turns off undo.`)),
      h('h3', {}, 'Play'),
      toggleRow('Left-handed layout', o, 'leftHanded', () => render(), 'Stock on the right, foundations on the left'),
      toggleRow('Tap to move', o, 'tapToMove', null, 'Tap a card to send it to the best spot'),
      toggleRow('Auto-play safe cards', o, 'autoPlay', null, 'Moves cards to foundations when nothing can need them'),
      toggleRow('Show timer', o, 'timer', () => updateInfo()),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: () => { close(); newGame(); } }, 'Deal with these settings')),
    );
    const close = sheet('Solitaire options', body, { onClose: () => { if (changed.needsNew) toast('New settings apply on the next deal.'); } });
  }

  function openHelp() {
    sheet('How to play Klondike', h('div', { class: 'prose' },
      h('p', {}, 'Build four foundation piles up by suit from Ace to King. In the seven tableau columns, build down in alternating colors (red on black). Only a King, or a run starting with a King, can go into an empty column.'),
      h('p', {}, 'Tap the stock to turn cards onto the waste pile. On Draw 3, three cards turn at once and only the top one can be played.'),
      h('p', {}, h('b', {}, 'Standard scoring: '), 'waste to tableau +5, any card to foundation +10, turning a tableau card +5, foundation back to tableau −15, recycling the waste −100 (draw 1) or −20 (draw 3). Winning after 30 seconds adds a time bonus.'),
      h('p', {}, h('b', {}, 'Vegas scoring: '), `you "buy" the deck for ${money(VEGAS_ANTE)} and earn ${money(VEGAS_PER_CARD)} per card on the foundations. Break even is 11 cards; a full win pays ${money(52 * 5)} for a ${money(208)} profit.`),
      h('p', {}, 'Drag cards, or tap a card to auto-move it. Wallet: ' + money(wallet()))));
  }

  // ---------- Lifecycle ----------
  const ro = new ResizeObserver(() => { if (!drag) render(); });
  ro.observe(board);
  newGame();

  return () => {
    clearInterval(timerId);
    ro.disconnect();
    topEl._off?.();
  };
}
