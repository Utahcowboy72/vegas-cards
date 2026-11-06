// Video poker: Jacks or Better, Bonus, Double Bonus, Double Double Bonus, Deuces Wild.
// Real pay tables, 1-5 coins, denominations, single or multi-play, exact optimal-hold trainer.
import { shuffledDeck, cardEl, shuffle } from '../cards.js';
import { GAMES, classify, toCode, payFor, analyze } from '../poker/vp.js';
import { h, gameOpts, save, sheet, selectRow, toggleRow, toast, sfx, stat, addWallet, wallet, money, wait } from '../core.js';

const OPTS = { game: 'jacks', table: '9/6', denom: 1, coins: 5, hands: 1, showHint: false, coach: false, speed: 'normal' };

export function mount(root, { topBar }) {
  const o = gameOpts('videopoker', OPTS);
  if (!GAMES[o.game].tables[o.table]) o.table = GAMES[o.game].def;

  let phase = 'idle'; // idle | held | drawing
  let deck = [];
  let hand = [];
  let held = [false, false, false, false, false];
  let extra = []; // multi-play hands (results)
  let lastWin = 0;
  let analysis = null;
  let busy = false;

  const topEl = topBar('Video Poker', { onOptions: openOptions, onHelp: openHelp });
  const pay = h('div', { class: 'vp-pay' });
  const multi = h('div', { class: 'vp-multi' });
  const cardsRow = h('div', { class: 'vp-cards' });
  const msg = h('div', { class: 'vp-msg' });
  const meters = h('div', { class: 'vp-meters' });
  const btns = h('div', { class: 'btn-row vp-btns' });
  const machine = h('div', { class: 'vp-machine' }, pay, multi, msg, cardsRow, meters);
  const view = h('div', { class: 'game vp felt' }, topEl, machine, h('div', { class: 'action-bar' }, btns));
  root.replaceChildren(view);

  const bet = () => o.coins * o.denom * o.hands;
  const credits = () => Math.floor(wallet() / o.denom + 1e-9);

  function renderPay(winRow = -1) {
    const g = GAMES[o.game];
    const t = g.tables[o.table];
    const head = h('tr', {}, h('th', {}, `${g.name} ${o.table}`), [1, 2, 3, 4, 5].map((c) => h('th', { class: c === o.coins ? 'cur' : '' }, c)));
    const rows = g.rows.map((name, i) => h('tr', { class: i === winRow ? 'win' : '' }, h('td', {}, name),
      [1, 2, 3, 4, 5].map((c) => h('td', { class: c === o.coins ? 'cur' : '' }, String(payFor(o.game, o.table, i, c))))));
    pay.replaceChildren(h('table', { class: 'paytable vp-table' }, h('thead', {}, head), h('tbody', {}, rows)));
  }

  function renderCards(fresh = []) {
    cardsRow.replaceChildren(...[0, 1, 2, 3, 4].map((i) => {
      const c = hand[i];
      const wrap = h('button', { class: 'vp-slot', 'aria-label': 'Hold card ' + (i + 1), onclick: () => toggleHold(i) });
      const el = c ? cardEl(c, phase !== 'idle' || !!c, 'vp-card') : cardEl(null, false, 'vp-card');
      if (fresh.includes(i)) el.classList.add('flip-in');
      if (held[i]) el.classList.add('held');
      if (analysis && o.showHint && phase === 'held' && analysis[0].mask & (1 << i)) el.classList.add('hintmark');
      wrap.append(h('div', { class: 'held-tag' + (held[i] ? ' on' : '') }, 'HELD'), el);
      return wrap;
    }));
  }

  function renderMeters() {
    meters.replaceChildren(
      h('div', {}, h('small', {}, 'WIN'), h('b', {}, String(lastWin))),
      h('div', {}, h('small', {}, `BET ${o.hands > 1 ? `(${o.hands} hands)` : ''}`), h('b', {}, String(o.coins * o.hands))),
      h('div', {}, h('small', {}, `CREDITS (${money(o.denom)})`), h('b', {}, credits().toLocaleString())));
  }

  function renderButtons() {
    const dealing = phase === 'held';
    btns.replaceChildren(
      h('button', { class: 'btn', disabled: dealing || busy, onclick: betOne }, 'Bet One'),
      h('button', { class: 'btn', disabled: dealing || busy, onclick: betMax }, 'Bet Max'),
      h('button', { class: 'btn primary vp-deal', disabled: busy, onclick: dealOrDraw }, dealing ? 'Draw' : 'Deal'));
  }

  function sizeCards() { view.style.setProperty('--cw', Math.floor(Math.max(48, Math.min(120, (view.clientWidth - 44) / 5.2, (view.clientHeight - 520) / 1.4 + 60))) + 'px'); }
  function renderAll(fresh) { sizeCards(); renderPay(currentRow()); renderCards(fresh); renderMeters(); renderButtons(); }

  function currentRow() {
    if (hand.length !== 5) return -1;
    return classify(o.game, hand.map(toCode));
  }

  function toggleHold(i) {
    if (phase !== 'held' || busy) return;
    held[i] = !held[i];
    sfx.chip();
    renderCards();
  }

  function betOne() {
    if (phase === 'held') return;
    o.coins = o.coins >= 5 ? 1 : o.coins + 1;
    save(); sfx.chip(); renderAll();
  }
  function betMax() {
    if (phase === 'held') return;
    o.coins = 5; save(); sfx.chip();
    dealOrDraw();
  }

  async function dealOrDraw() {
    if (busy) return;
    if (phase === 'held') return draw();
    if (wallet() < bet()) { toast(`Not enough credits. You need ${money(bet())}. Lower the bet or refill.`); return; }
    busy = true;
    addWallet(-bet());
    stat('videopoker', 'totalWagered', bet());
    stat('videopoker', 'handsPlayed', o.hands);
    lastWin = 0;
    extra = [];
    multi.replaceChildren();
    deck = shuffledDeck(1);
    hand = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
    held = [false, false, false, false, false];
    phase = 'held';
    analysis = null;
    msg.textContent = '';
    if (o.hands > 1) renderMultiPlaceholders();
    for (let i = 0; i < 5; i++) { renderPartial(i); sfx.card(); await wait(70); }
    const row = currentRow();
    msg.textContent = row >= 0 ? GAMES[o.game].rows[row] : '';
    if (o.showHint || o.coach) {
      // Defer analysis so the cards paint first.
      await new Promise((r) => setTimeout(r, 20));
      analysis = analyze(o.game, o.table, hand);
    }
    busy = false;
    renderAll();
    if (o.showHint && analysis) msg.textContent = hintText();
  }

  function renderPartial(n) {
    const shownHand = hand;
    cardsRow.replaceChildren(...[0, 1, 2, 3, 4].map((i) => {
      const wrap = h('div', { class: 'vp-slot' });
      const el = cardEl(shownHand[i], i <= n, 'vp-card');
      if (i === n) el.classList.add('flip-in');
      wrap.append(h('div', { class: 'held-tag' }, 'HELD'), el);
      return wrap;
    }));
    renderPay(-1);
    renderMeters();
    renderButtons();
  }

  function hintText() {
    const best = analysis[0];
    const names = hand.filter((_, i) => best.mask & (1 << i)).map((c) => (c.r > 10 ? 'JQKA'[c.r - 11] : c.r) + ({ S: '♠', H: '♥', D: '♦', C: '♣' })[c.s]);
    return names.length ? `Best hold: ${names.join(' ')} (avg return ${(best.ev).toFixed(2)} per coin)` : `Best play: draw five new cards (avg ${(best.ev).toFixed(2)})`;
  }

  async function draw() {
    const mask = held.reduce((m, x, i) => m | (x ? 1 << i : 0), 0);
    if (o.coach && analysis && analysis[0].mask !== mask) {
      const mine = analysis.find((a) => a.mask === mask);
      const lossPct = analysis[0].ev > 0 ? ((analysis[0].ev - mine.ev) / analysis[0].ev) * 100 : 0;
      if (analysis[0].ev - mine.ev > 1e-9) {
        busy = true;
        const choice = await new Promise((res) => {
          let picked = false;
          const close = sheet('Strategy check', h('div', {},
            h('p', {}, `That hold returns ${mine.ev.toFixed(3)} per coin on average. The best hold returns ${analysis[0].ev.toFixed(3)} (${lossPct.toFixed(1)}% better).`),
            h('p', {}, hintText()),
            h('div', { class: 'btn-row' },
              h('button', { class: 'btn', onclick: () => { picked = true; close(); res('fix'); } }, 'Use best hold'),
              h('button', { class: 'btn primary', onclick: () => { picked = true; close(); res('keep'); } }, 'Keep mine'))),
          { onClose: () => { if (!picked) res('cancel'); } });
        });
        busy = false;
        if (choice === 'cancel') return;
        if (choice === 'fix') { held = [0, 1, 2, 3, 4].map((i) => !!(analysis[0].mask & (1 << i))); renderCards(); stat('videopoker', 'strategyCorrections'); await wait(250); }
        else stat('videopoker', 'strategyMistakes');
      }
    }
    busy = true;
    phase = 'drawing';
    const base = hand.slice();
    const heldNow = held.slice();
    // Main hand draws from the remaining 47 cards.
    const fresh = [];
    for (let i = 0; i < 5; i++) if (!heldNow[i]) { hand[i] = deck.pop(); fresh.push(i); }
    held = heldNow;
    for (const i of fresh) { renderCards([i]); sfx.card(); await wait(90); }
    let totalCoins = 0;
    const row = currentRow();
    const mainPay = payFor(o.game, o.table, row, o.coins);
    totalCoins += mainPay;
    // Multi-play: every extra hand draws from its own fresh copy of the same 47-card stub.
    if (o.hands > 1) {
      const stub = shuffledDeck(1).filter((c) => !base.some((b) => b.id === c.id));
      extra = [];
      for (let k = 1; k < o.hands; k++) {
        const d = shuffle(stub.slice());
        const hh = base.map((c, i) => (heldNow[i] ? c : d.pop()));
        const r = classify(o.game, hh.map(toCode));
        const p = payFor(o.game, o.table, r, o.coins);
        totalCoins += p;
        extra.push({ cards: hh, row: r, pay: p });
      }
      renderMulti();
    }
    const winCash = totalCoins * o.denom;
    lastWin = totalCoins;
    if (winCash) addWallet(winCash);
    stat('videopoker', 'netWon', winCash - bet());
    if (row === 0) stat('videopoker', 'royalFlushes');
    msg.textContent = row >= 0 ? `${GAMES[o.game].rows[row]}! ${o.hands > 1 ? '' : `Pays ${mainPay}`}` : (o.hands > 1 ? '' : 'Game over');
    if (o.hands > 1) msg.textContent += ` Total win ${totalCoins} credits`;
    if (totalCoins) sfx.win();
    phase = 'idle';
    busy = false;
    renderPay(row);
    renderCards();
    renderMeters();
    renderButtons();
  }

  function renderMultiPlaceholders() {
    multi.replaceChildren(...Array.from({ length: o.hands - 1 }, () => h('div', { class: 'vp-mini' }, Array.from({ length: 5 }, () => cardEl(null, false)))));
  }
  function renderMulti() {
    multi.replaceChildren(...extra.map((x) => h('div', { class: 'vp-mini' + (x.pay ? ' paid' : '') },
      x.cards.map((c) => cardEl(c, true)),
      h('span', { class: 'mini-label' }, x.row >= 0 ? `${GAMES[o.game].rows[x.row]} ${x.pay}` : ''))));
  }

  // ---------- Menus ----------
  function openOptions() {
    if (phase === 'held') { toast('Finish this hand first.'); return; }
    const tablePick = { table: o.table };
    const box = h('div', {});
    const build = () => {
      const g = GAMES[o.game];
      if (!g.tables[o.table]) o.table = g.def;
      tablePick.table = o.table;
      box.replaceChildren(
        selectRow('Game', o, 'game', Object.entries(GAMES).map(([k, v]) => [k, v.name]), () => { o.table = GAMES[o.game].def; save(); build(); renderAll(); }),
        selectRow('Pay table', o, 'table', Object.entries(g.tables).map(([k, v]) => [k, `${k}  (${v.ret.toFixed(2)}% return)`]), () => { renderAll(); build(); }),
        h('p', { class: 'prose' }, h('small', {}, `"${o.table}" is how players name a pay table: the full house / flush pays for one coin. This table returns ${g.tables[o.table].ret.toFixed(2)}% with perfect play and max coins. Over 100% means the player has the edge.`)),
        selectRow('Denomination', o, 'denom', [[0.25, '25¢'], [1, '$1'], [5, '$5'], [25, '$25']], () => renderAll()),
        selectRow('Hands per deal', o, 'hands', [[1, 'Single hand'], [3, 'Triple play (3)'], [5, 'Five play (5)'], [10, 'Ten play (10)']], () => { multi.replaceChildren(); renderAll(); }),
        toggleRow('Show best hold', o, 'showHint', null, 'Exact math: checks all 32 ways to hold'),
        toggleRow('Coach: warn on mistakes', o, 'coach', null, 'Asks before you draw with a weaker hold'),
      );
    };
    build();
    sheet('Video poker options', box);
  }

  function openHelp() {
    sheet('How to play Video Poker', h('div', { class: 'prose' },
      h('p', {}, 'Bet 1 to 5 coins and press Deal. Tap the cards you want to keep (HELD), then press Draw to replace the rest. You are paid according to the table at the top.'),
      h('p', {}, 'Always play 5 coins: the royal flush pays 4,000 coins at max bet but only 250 per coin otherwise. That bonus is part of the published return.'),
      h('p', {}, 'Each hand is dealt from a freshly shuffled 52-card deck, like a certified Nevada machine. Multi-play deals extra hands from separate copies of the same remaining deck, with your held cards copied into each.'),
      h('p', {}, h('b', {}, 'Deuces Wild: '), 'every 2 is wild and the lowest paying hand is three of a kind.'),
      h('p', {}, h('b', {}, 'Double Double Bonus: '), 'four aces with a 2, 3 or 4 as the fifth card pays 400 per coin.')));
  }

  renderAll();
  const ro = new ResizeObserver(sizeCards);
  ro.observe(view);
  return () => { ro.disconnect(); topEl._off?.(); };
}
