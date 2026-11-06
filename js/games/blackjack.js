// Blackjack: multi-deck shoe with cut card, Vegas rule options, up to 3 betting spots,
// splits/doubles/surrender/insurance, basic-strategy coach and Hi-Lo count trainer.
import { shuffledDeck, cardEl } from '../cards.js';
import { h, gameOpts, save, sheet, selectRow, toggleRow, toast, sfx, stat, addWallet, wallet, money, wait, state as appState } from '../core.js';

const OPTS = {
  preset: 'strip',
  decks: 6,
  h17: false,
  bjPays: '3:2',
  das: true,
  doubleOn: 'any',
  surrender: 'late',
  resplitAces: true,
  hitSplitAces: false,
  maxHands: 4,
  holeCard: 'us', // 'us' (dealer peeks) | 'enhc' (European no hole card)
  limits: '10-1000',
  penetration: 0.75,
  spots: 1,
  coach: false,
  showHint: true,
  showCount: false,
  showTotals: true,
  lastBets: [10],
};

const PRESETS = {
  strip: { name: 'Las Vegas Strip', decks: 6, h17: false, bjPays: '3:2', das: true, doubleOn: 'any', surrender: 'late', resplitAces: true, hitSplitAces: false, maxHands: 4, holeCard: 'us', limits: '10-1000' },
  downtown: { name: 'Downtown Vegas', decks: 2, h17: true, bjPays: '3:2', das: true, doubleOn: 'any', surrender: 'none', resplitAces: false, hitSplitAces: false, maxHands: 4, holeCard: 'us', limits: '10-1000' },
  single: { name: 'Single Deck (6:5)', decks: 1, h17: true, bjPays: '6:5', das: false, doubleOn: '10-11', surrender: 'none', resplitAces: false, hitSplitAces: false, maxHands: 2, holeCard: 'us', limits: '5-500' },
  eight: { name: 'Eight Deck Shoe', decks: 8, h17: true, bjPays: '3:2', das: true, doubleOn: 'any', surrender: 'late', resplitAces: false, hitSplitAces: false, maxHands: 4, holeCard: 'us', limits: '10-1000' },
  euro: { name: 'European (no hole card)', decks: 6, h17: false, bjPays: '3:2', das: true, doubleOn: '9-11', surrender: 'none', resplitAces: false, hitSplitAces: false, maxHands: 3, holeCard: 'enhc', limits: '10-1000' },
};
const RULE_KEYS = ['decks', 'h17', 'bjPays', 'das', 'doubleOn', 'surrender', 'resplitAces', 'hitSplitAces', 'maxHands', 'holeCard', 'limits'];

const val = (c) => (c.r === 14 ? 11 : c.r >= 10 ? 10 : c.r);
const hiLo = (c) => (c.r >= 10 ? -1 : c.r <= 6 ? 1 : 0);

export function total(cards) {
  let t = 0; let aces = 0;
  for (const c of cards) { t += val(c); if (c.r === 14) aces++; }
  while (t > 21 && aces) { t -= 10; aces--; }
  return { t, soft: aces > 0 && t <= 21 };
}
const isBJ = (cards) => cards.length === 2 && total(cards).t === 21;
const tenVal = (c) => val(c) === 10;

// Approximate house edge (%) for the chosen rules, from published rule-effect tables.
export function houseEdge(o) {
  let e = 0.44; // 8 decks, S17, DAS, no surrender, no RSA, dealer peeks, 3:2
  e += { 1: -0.48, 2: -0.19, 4: -0.06, 6: -0.02, 8: 0 }[o.decks] ?? 0;
  if (o.h17) e += 0.22;
  if (!o.das) e += 0.14;
  if (o.surrender === 'late') e -= 0.08;
  if (o.resplitAces) e -= 0.08;
  if (o.hitSplitAces) e -= 0.18;
  if (o.bjPays === '6:5') e += 1.39;
  if (o.bjPays === '1:1') e += 2.27;
  if (o.doubleOn === '10-11') e += 0.18;
  if (o.doubleOn === '9-11') e += 0.09;
  if (o.holeCard === 'enhc') e += 0.11;
  if (o.maxHands === 2) e += 0.05;
  if (o.maxHands === 3) e += 0.01;
  return e;
}

// Multi-deck basic strategy. Returns 'H','S','D','P','R'.
export function basicStrategy(cards, up, o, canDouble, canSplit, canSurrender) {
  const d = up.r === 14 ? 11 : val(up);
  const { t, soft } = total(cards);
  const pair = cards.length === 2 && val(cards[0]) === val(cards[1]);
  const D = (alt) => (canDouble ? 'D' : alt);
  const R = (alt) => (canSurrender ? 'R' : alt);

  if (pair && canSplit) {
    const p = val(cards[0]);
    const das = o.das;
    if (p === 11) return 'P';
    if (p === 8) return o.h17 && d === 11 && canSurrender ? 'R' : 'P';
    if (p === 9 && ![7, 10, 11].includes(d)) return 'P';
    if (p === 7 && d <= 7) return 'P';
    if (p === 6 && (d >= 3 && d <= 6 || (d === 2 && das))) return 'P';
    if (p === 4 && das && (d === 5 || d === 6)) return 'P';
    if ((p === 2 || p === 3) && (d >= 4 && d <= 7 || (das && d <= 3))) return 'P';
  }
  if (soft && cards.length >= 2) {
    if (t >= 20) return 'S';
    if (t === 19) return o.h17 && d === 6 ? D('S') : 'S';
    if (t === 18) {
      if (d >= 3 && d <= 6) return D('S');
      if (d === 2) return o.h17 ? D('S') : 'S';
      if (d <= 8) return 'S';
      return 'H';
    }
    if (t === 17) return d >= 3 && d <= 6 ? D('H') : 'H';
    if (t === 15 || t === 16) return d >= 4 && d <= 6 ? D('H') : 'H';
    if (t === 13 || t === 14) return d >= 5 && d <= 6 ? D('H') : 'H';
    return 'H';
  }
  if (t >= 17) return o.h17 && t === 17 && d === 11 ? R('S') : 'S';
  if (t === 16) return d <= 6 ? 'S' : d >= 9 ? R('H') : 'H';
  if (t === 15) return d <= 6 ? 'S' : (d === 10 || (o.h17 && d === 11)) ? R('H') : 'H';
  if (t === 13 || t === 14) return d <= 6 ? 'S' : 'H';
  if (t === 12) return d >= 4 && d <= 6 ? 'S' : 'H';
  if (t === 11) return d === 11 && !o.h17 ? 'H' : D('H');
  if (t === 10) return d <= 9 ? D('H') : 'H';
  if (t === 9) return d >= 3 && d <= 6 ? D('H') : 'H';
  return 'H';
}

const ACTION_NAME = { H: 'Hit', S: 'Stand', D: 'Double', P: 'Split', R: 'Surrender' };

export function mount(root, { topBar }) {
  const o = gameOpts('blackjack', OPTS);
  const lim = () => o.limits.split('-').map(Number);

  let shoe = []; let cutIndex = 0; let discards = 0;
  let running = 0;
  let phase = 'bet'; // bet | deal | insurance | play | dealer | done
  let spots = []; // [{bet, hands:[{cards, bet, done, doubled, fromSplit, splitAces, surrendered, result}], insurance}]
  let dealer = [];
  let holeHidden = true;
  let active = { s: 0, h: 0 };
  let selChip = 25;
  let uid = 0;
  let busy = false;
  let reshuffleAfter = false;

  // ---------- DOM ----------
  const topEl = topBar('Blackjack', { onOptions: openOptions, onHelp: openHelp });
  const dealerArea = h('div', { class: 'bj-dealer' });
  const dealerTotal = h('div', { class: 'bj-total' });
  const tableText = h('div', { class: 'bj-table-text' });
  const spotsArea = h('div', { class: 'bj-spots' });
  const shoeInfo = h('div', { class: 'bj-shoe' });
  const countEl = h('div', { class: 'bj-count' });
  const status = h('div', { class: 'status-line' });
  const controls = h('div', { class: 'btn-row' });
  const chipsRow = h('div', { class: 'chip-row' });
  const table = h('div', { class: 'bj-table' }, shoeInfo, countEl, h('div', { class: 'bj-dealer-wrap' }, dealerArea, dealerTotal), tableText, spotsArea);
  const bar = h('div', { class: 'action-bar' }, status, chipsRow, controls);
  const view = h('div', { class: 'game bj felt' }, topEl, table, bar);
  root.replaceChildren(view);

  // ---------- Shoe ----------
  function newShoe() {
    shoe = shuffledDeck(o.decks);
    cutIndex = Math.floor(shoe.length * (1 - o.penetration));
    running = 0;
    discards = 0;
    // Burn one card face down after the shuffle, as dealers do.
    shoe.pop();
    discards = 1;
    sfx.shuffle();
    reshuffleAfter = false;
  }
  function draw(faceUp = true) {
    if (!shoe.length) newShoe();
    const c = shoe.pop();
    if (shoe.length <= cutIndex) reshuffleAfter = true;
    const card = { ...c, uid: ++uid, fresh: true };
    if (faceUp) running += hiLo(c);
    return card;
  }
  const decksLeft = () => Math.max(0.5, shoe.length / 52);

  // ---------- Betting ----------
  function initSpots() {
    spots = Array.from({ length: o.spots }, (_, i) => ({ bet: 0, hands: [], insurance: 0, last: o.lastBets[i] || 0 }));
  }

  function addChip(si, v) {
    if (phase !== 'bet') return;
    const [, max] = lim();
    const s = spots[si];
    const committed = spots.reduce((a, x) => a + x.bet, 0);
    if (committed + v > wallet()) { toast('Not enough in your bankroll.'); return; }
    if (s.bet + v > max) { toast(`Table maximum is ${money(max)}.`); return; }
    s.bet += v;
    sfx.chip();
    render();
  }

  function rebet(mult = 1) {
    if (phase !== 'bet') return;
    const [min, max] = lim();
    const want = spots.map((s) => Math.min(max, Math.max(s.last ? min : 0, s.last * mult)));
    if (want.reduce((a, b) => a + b, 0) > wallet()) { toast('Not enough in your bankroll.'); return; }
    spots.forEach((s, i) => { s.bet = want[i]; });
    sfx.chip();
    render();
  }

  async function deal() {
    const [min] = lim();
    const playing = spots.filter((s) => s.bet > 0);
    if (!playing.length) { toast(`Place a bet (minimum ${money(min)}).`); return; }
    if (playing.some((s) => s.bet < min)) { toast(`Table minimum is ${money(min)} per spot.`); return; }
    const totalBet = playing.reduce((a, s) => a + s.bet, 0);
    if (totalBet > wallet()) { toast('Not enough in your bankroll.'); return; }
    if (reshuffleAfter || !shoe.length) { newShoe(); toast('Shuffling a new shoe…'); await wait(500); }
    o.lastBets = spots.map((s) => s.bet);
    save();
    spots.forEach((s) => { s.last = s.bet; });
    addWallet(-totalBet);
    stat('blackjack', 'totalWagered', totalBet);
    busy = true;
    phase = 'deal';
    dealer = [];
    holeHidden = o.holeCard === 'us';
    for (const s of spots) s.hands = s.bet ? [{ cards: [], bet: s.bet, done: false }] : [];
    render();
    const order = spots.filter((s) => s.bet);
    // First card to each spot, dealer up card, second card to each spot, dealer hole card.
    for (const s of order) { s.hands[0].cards.push(draw()); sfx.card(); render(); await wait(260); }
    dealer.push(draw()); sfx.card(); render(); await wait(260);
    for (const s of order) { s.hands[0].cards.push(draw()); sfx.card(); render(); await wait(260); }
    if (o.holeCard === 'us') { dealer.push(draw(false)); sfx.card(); render(); await wait(260); }

    const up = dealer[0];
    if (up.r === 14) {
      phase = 'insurance';
      busy = false;
      render();
      return; // insurance buttons drive the next step
    }
    await afterInsurance();
  }

  async function takeInsurance(yes) {
    if (phase !== 'insurance') return;
    if (yes) {
      for (const s of spots) {
        if (!s.hands.length) continue;
        const ins = s.hands[0].bet / 2;
        if (ins <= wallet()) { s.insurance = ins; addWallet(-ins); }
      }
      sfx.chip();
    }
    busy = true;
    await afterInsurance();
  }

  async function afterInsurance() {
    const up = dealer[0];
    if (o.holeCard === 'us' && (up.r === 14 || tenVal(up))) {
      status.textContent = 'Dealer checks for blackjack…';
      await wait(600);
      if (isBJ(dealer)) {
        revealHole();
        render();
        await wait(400);
        settle();
        return;
      }
      if (spots.some((s) => s.insurance)) {
        toast('Dealer does not have blackjack. Insurance loses.');
        stat('blackjack', 'insuranceLost');
      }
      for (const s of spots) s.insurance = 0;
    }
    // Player blackjacks are paid when the dealer cannot have one.
    phase = 'play';
    for (const s of spots) for (const hand of s.hands) if (isBJ(hand.cards)) hand.done = true;
    active = { s: -1, h: 0 };
    nextHand();
    busy = false;
    render();
    if (phase === 'dealer') await dealerPlay();
  }

  function nextHand() {
    // Find next unfinished hand in seat order.
    for (let si = Math.max(0, active.s); si < spots.length; si++) {
      const s = spots[si];
      for (let hi = si === active.s ? active.h : 0; hi < s.hands.length; hi++) {
        const hand = s.hands[hi];
        if (!hand.done) {
          active = { s: si, h: hi };
          if (hand.cards.length === 1) { hand.cards.push(draw()); sfx.card(); autoFinishSplitAce(hand); if (hand.done) continue; }
          if (total(hand.cards).t === 21) { hand.done = true; continue; }
          return;
        }
      }
    }
    phase = 'dealer';
  }

  function autoFinishSplitAce(hand) {
    if (hand.splitAces && !o.hitSplitAces) {
      const canResplit = o.resplitAces && hand.cards[1].r === 14 && handCount() < o.maxHands;
      if (!canResplit) hand.done = true;
    }
  }
  const handCount = () => spots[active.s].hands.length;
  const curHand = () => spots[active.s]?.hands[active.h];

  function canDouble(hand) {
    if (hand.cards.length !== 2 || hand.doubled) return false;
    if (hand.splitAces && !o.hitSplitAces) return false;
    if (hand.fromSplit && !o.das) return false;
    if (wallet() < hand.bet) return false;
    const { t, soft } = total(hand.cards);
    if (o.doubleOn === '10-11') return !soft && (t === 10 || t === 11);
    if (o.doubleOn === '9-11') return !soft && t >= 9 && t <= 11;
    return true;
  }
  function canSplit(hand) {
    if (hand.cards.length !== 2) return false;
    if (val(hand.cards[0]) !== val(hand.cards[1])) return false;
    if (handCount() >= o.maxHands) return false;
    if (hand.splitAces && !o.resplitAces) return false;
    return wallet() >= hand.bet;
  }
  function canSurrender(hand) {
    return o.surrender === 'late' && hand.cards.length === 2 && !hand.fromSplit && spots[active.s].hands.length === 1;
  }

  function recommended() {
    const hand = curHand();
    if (!hand) return null;
    return basicStrategy(hand.cards, dealer[0], o, canDouble(hand), canSplit(hand), canSurrender(hand));
  }

  async function act(a) {
    if (phase !== 'play' || busy) return;
    const hand = curHand();
    if (!hand) return;
    const rec = recommended();
    if (o.coach && rec && rec !== a) {
      busy = true;
      const ok = await new Promise((res) => {
        let picked = false;
        const close = sheet('Basic strategy check', h('div', {},
          h('p', {}, `Basic strategy says ${ACTION_NAME[rec]} here, not ${ACTION_NAME[a]}.`),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn', onclick: () => { picked = true; close(); res(false); } }, `Do ${ACTION_NAME[rec]}`),
            h('button', { class: 'btn primary', onclick: () => { picked = true; close(); res(true); } }, `${ACTION_NAME[a]} anyway`))),
        { onClose: () => { if (!picked) res(null); } });
      });
      busy = false;
      if (ok === null) return;
      if (!ok) a = rec;
      stat('blackjack', ok ? 'strategyMistakes' : 'strategyCorrections');
    }
    busy = true;
    if (a === 'H') {
      hand.cards.push(draw()); sfx.card();
      const t = total(hand.cards).t;
      if (t >= 21) hand.done = true;
    } else if (a === 'S') {
      hand.done = true;
    } else if (a === 'D' && canDouble(hand)) {
      addWallet(-hand.bet);
      stat('blackjack', 'totalWagered', hand.bet);
      hand.bet *= 2; hand.doubled = true;
      sfx.chip();
      hand.cards.push(draw()); sfx.card();
      hand.done = true;
    } else if (a === 'P' && canSplit(hand)) {
      addWallet(-hand.bet);
      stat('blackjack', 'totalWagered', hand.bet);
      const aces = hand.cards[0].r === 14;
      const second = { cards: [hand.cards.pop()], bet: hand.bet, done: false, fromSplit: true, splitAces: aces };
      hand.fromSplit = true; hand.splitAces = aces;
      spots[active.s].hands.splice(active.h + 1, 0, second);
      sfx.chip();
      render(); await wait(250);
      hand.cards.push(draw()); sfx.card();
      autoFinishSplitAce(hand);
      if (total(hand.cards).t === 21) hand.done = true;
    } else if (a === 'R' && canSurrender(hand)) {
      hand.surrendered = true; hand.done = true;
    } else { busy = false; return; }
    render();
    await wait(220);
    if (hand.done) nextHand();
    busy = false;
    render();
    if (phase === 'dealer') await dealerPlay();
  }

  function revealHole() {
    if (holeHidden && dealer[1]) { running += hiLo(dealer[1]); dealer[1].fresh = true; dealer[1].flip = true; }
    holeHidden = false;
  }

  async function dealerPlay() {
    busy = true;
    phase = 'dealer';
    render();
    await wait(350);
    if (o.holeCard === 'enhc') { dealer.push(draw()); sfx.card(); } else revealHole();
    render();
    await wait(450);
    const live = spots.some((s) => s.hands.some((x) => !x.surrendered && total(x.cards).t <= 21 && !(isBJ(x.cards) && !x.fromSplit)));
    if (live && !isBJ(dealer)) {
      for (;;) {
        const { t, soft } = total(dealer);
        if (t > 17 || (t === 17 && !(soft && o.h17))) break;
        dealer.push(draw()); sfx.card(); render();
        await wait(450);
      }
    }
    settle();
  }

  function settle() {
    phase = 'done';
    revealHole();
    const dt = total(dealer).t;
    const dBJ = isBJ(dealer);
    const bjMult = { '3:2': 1.5, '6:5': 1.2, '1:1': 1 }[o.bjPays];
    let net = 0;
    for (const s of spots) {
      if (s.insurance) {
        if (dBJ) { addWallet(s.insurance * 3); net += s.insurance * 2; stat('blackjack', 'insuranceWon'); } else net -= s.insurance;
        s.insurance = 0;
      }
      for (const hand of s.hands) {
        const pt = total(hand.cards).t;
        const natural = isBJ(hand.cards) && !hand.fromSplit;
        let pay = 0; let res;
        if (hand.surrendered) { pay = hand.bet / 2; res = 'Surrender'; }
        else if (natural && dBJ) { pay = hand.bet; res = 'Push'; }
        else if (natural) { pay = hand.bet * (1 + bjMult); res = 'Blackjack!'; stat('blackjack', 'blackjacks'); }
        else if (dBJ) { pay = 0; res = 'Dealer BJ'; }
        else if (pt > 21) { pay = 0; res = 'Bust'; }
        else if (dt > 21 || pt > dt) { pay = hand.bet * 2; res = 'Win'; }
        else if (pt === dt) { pay = hand.bet; res = 'Push'; }
        else { pay = 0; res = 'Lose'; }
        if (o.holeCard === 'enhc' && dBJ && !natural) { pay = 0; res = 'Dealer BJ'; }
        hand.result = res;
        hand.pay = pay;
        if (pay) addWallet(pay);
        net += pay - hand.bet;
        stat('blackjack', 'handsPlayed');
        stat('blackjack', res === 'Win' || res === 'Blackjack!' ? 'handsWon' : res === 'Push' ? 'handsPushed' : 'handsLost');
      }
    }
    stat('blackjack', 'netWon', net);
    if (net > 0) sfx.win(); else if (net < 0) sfx.lose();
    status.textContent = net > 0 ? `You win ${money(net)}` : net < 0 ? `You lose ${money(-net)}` : 'Push';
    busy = false;
    render();
  }

  function newRound() {
    discards += dealer.length + spots.reduce((a, s) => a + s.hands.reduce((b, x) => b + x.cards.length, 0), 0);
    dealer = [];
    for (const s of spots) { s.hands = []; s.bet = 0; s.insurance = 0; }
    phase = 'bet';
    if (reshuffleAfter) { newShoe(); toast('Cut card reached. New shoe shuffled.'); }
    render();
  }

  // ---------- Rendering ----------
  function cardsRow(cards, hideSecond) {
    const row = h('div', { class: 'bj-cards' });
    cards.forEach((c, i) => {
      const up = !(hideSecond && i === 1);
      const el = cardEl(c, up);
      if (c.fresh) { el.classList.add(c.flip ? 'flip-in' : 'deal-in'); c.fresh = false; c.flip = false; }
      row.append(el);
    });
    return row;
  }

  function chipStack(amount) {
    if (!amount) return h('div', { class: 'bet-chips empty' }, '');
    const denoms = [1000, 500, 100, 25, 5, 1];
    const chips = [];
    let left = amount;
    for (const d of denoms) while (left >= d && chips.length < 8) { chips.push(d); left -= d; }
    return h('div', { class: 'bet-chips' }, chips.reverse().map((d, i) => h('span', { class: 'chip mini', 'data-v': d, style: { bottom: i * 4 + 'px' } })), h('span', { class: 'bet-amt' }, money(amount)));
  }

  function render() {
    const cw = Math.max(46, Math.min(84, Math.floor(Math.min(view.clientWidth / (o.spots > 1 ? 7.5 : 5.2), (view.clientHeight - 260) / 4.2))));
    view.style.setProperty('--cw', cw + 'px');
    const [min, max] = lim();
    tableText.innerHTML = '';
    tableText.append(
      h('div', { class: 'arc' }, `BLACKJACK PAYS ${o.bjPays.replace(':', ' TO ')}`),
      h('div', {}, `Dealer ${o.h17 ? 'hits' : 'stands on'} soft 17${o.holeCard === 'us' ? ' · Insurance pays 2 to 1' : ' · No hole card'}`),
      h('div', { class: 'limits' }, `${money(min)} – ${money(max)}`));

    dealerArea.replaceChildren(cardsRow(dealer, holeHidden));
    if (dealer.length && o.showTotals) {
      const shown = holeHidden ? [dealer[0]] : dealer;
      const t = total(shown);
      dealerTotal.textContent = isBJ(dealer) && !holeHidden ? 'Blackjack' : t.t > 21 ? `Bust (${t.t})` : String(t.t);
    } else dealerTotal.textContent = '';

    const pct = shoe.length ? Math.round((1 - shoe.length / (o.decks * 52)) * 100) : 0;
    shoeInfo.textContent = `${o.decks} deck${o.decks > 1 ? 's' : ''} · shoe ${pct}% dealt${reshuffleAfter ? ' · cut card out' : ''}`;
    countEl.style.display = o.showCount ? '' : 'none';
    countEl.textContent = `Running ${running >= 0 ? '+' : ''}${running} · True ${(running / decksLeft()).toFixed(1)}`;

    spotsArea.replaceChildren(...spots.map((s, si) => {
      const handsEl = s.hands.map((hand, hi) => {
        const t = total(hand.cards);
        const isActive = phase === 'play' && active.s === si && active.h === hi;
        const label = hand.result || (o.showTotals && hand.cards.length ? (isBJ(hand.cards) && !hand.fromSplit ? 'Blackjack' : t.t > 21 ? `Bust (${t.t})` : (t.soft && t.t < 21 ? `${t.t - 10}/${t.t}` : String(t.t))) : '');
        return h('div', { class: 'bj-hand' + (isActive ? ' active' : '') + (hand.result ? ' r-' + hand.result.replace(/\W/g, '').toLowerCase() : '') },
          cardsRow(hand.cards),
          h('div', { class: 'bj-hand-label' }, label, hand.doubled ? ' · x2' : ''),
          chipStack(hand.bet));
      });
      const circle = h('button', { class: 'bet-circle' + (phase === 'bet' ? ' open' : ''), 'aria-label': `Betting spot ${si + 1}`, onclick: () => addChip(si, selChip) },
        chipStack(phase === 'bet' ? s.bet : 0), phase === 'bet' && !s.bet ? h('span', { class: 'circle-hint' }, 'BET') : null);
      return h('div', { class: 'bj-spot' }, handsEl.length ? h('div', { class: 'bj-hands' }, handsEl) : null, phase === 'bet' ? circle : null,
        s.insurance ? h('div', { class: 'ins' }, `Insurance ${money(s.insurance)}`) : null);
    }));

    // Controls
    controls.replaceChildren();
    chipsRow.replaceChildren();
    if (phase === 'bet') {
      status.textContent = spots.some((s) => s.bet) ? 'Tap the circle to add chips, then Deal.' : `Pick a chip and tap the betting circle. Table ${money(min)}–${money(max)}.`;
      [1, 5, 25, 100, 500, 1000].filter((v) => v <= max).forEach((v) => chipsRow.append(h('button', { class: 'chip' + (v === selChip ? ' sel' : ''), 'data-v': v, onclick: () => { selChip = v; if (o.spots === 1) addChip(0, v); else render(); } }, v >= 1000 ? '1K' : String(v))));
      controls.append(
        h('button', { class: 'btn', onclick: () => { spots.forEach((s) => { s.bet = 0; }); render(); } }, 'Clear'),
        h('button', { class: 'btn', onclick: () => rebet(1), disabled: !spots.some((s) => s.last) }, 'Rebet'),
        h('button', { class: 'btn', onclick: () => rebet(2), disabled: !spots.some((s) => s.last) }, '2× Rebet'),
        h('button', { class: 'btn primary', onclick: deal }, 'Deal'));
    } else if (phase === 'insurance') {
      const anyBJ = spots.some((s) => s.hands[0] && isBJ(s.hands[0].cards));
      status.textContent = anyBJ ? 'Dealer shows an Ace. Even money / insurance?' : 'Dealer shows an Ace. Insurance pays 2 to 1.';
      controls.append(h('button', { class: 'btn', onclick: () => takeInsurance(false) }, 'No insurance'), h('button', { class: 'btn primary', onclick: () => takeInsurance(true) }, anyBJ ? 'Even money / Insure' : 'Insurance'));
    } else if (phase === 'play') {
      const hand = curHand();
      if (hand) {
        const rec = o.showHint ? recommended() : null;
        status.textContent = spots.length > 1 || spots[active.s].hands.length > 1 ? `Spot ${active.s + 1}${spots[active.s].hands.length > 1 ? ', hand ' + (active.h + 1) : ''}` : '';
        const b = (code, label, ok) => h('button', { class: 'btn' + (code === 'H' ? ' green' : code === 'S' ? ' danger' : '') + (rec === code ? ' rec' : ''), disabled: !ok || busy, onclick: () => act(code) }, label);
        controls.append(
          b('H', 'Hit', true), b('S', 'Stand', true), b('D', 'Double', canDouble(hand)), b('P', 'Split', canSplit(hand)),
          o.surrender === 'late' ? b('R', 'Surrender', canSurrender(hand)) : null);
        if (rec) status.textContent += (status.textContent ? ' · ' : '') + `Basic strategy: ${ACTION_NAME[rec]}`;
      }
    } else if (phase === 'done') {
      controls.append(h('button', { class: 'btn', onclick: () => { newRound(); } }, 'Change bet'), h('button', { class: 'btn primary', onclick: async () => { newRound(); rebet(1); if (spots.some((s) => s.bet)) await deal(); } }, 'Same bet, deal'));
    } else {
      status.textContent = phase === 'dealer' ? 'Dealer plays…' : 'Dealing…';
    }
  }

  // ---------- Menus ----------
  function openOptions() {
    if (phase !== 'bet') { toast('Change rules between hands.'); }
    const edgeEl = h('strong', {});
    const presetSel = { preset: o.preset };
    const updateEdge = () => { edgeEl.textContent = `${houseEdge(o).toFixed(2)}%`; };
    const markCustom = () => { o.preset = 'custom'; presetSel.preset = 'custom'; save(); updateEdge(); rebuild(); };
    const container = h('div', {});
    const changeLocked = () => phase !== 'bet';
    function rebuild() {
      container.replaceChildren(
        h('p', { class: 'prose' }, 'House edge with these rules (basic strategy): ', edgeEl, h('br'), h('small', {}, 'Approximate, from published rule-effect tables.')),
        h('h3', {}, 'Table'),
        selectRow('Rule set', presetSel, 'preset', [...Object.entries(PRESETS).map(([k, v]) => [k, v.name]), ['custom', 'Custom']], (k) => {
          if (PRESETS[k]) { for (const key of RULE_KEYS) o[key] = PRESETS[k][key]; o.preset = k; save(); newShoe(); render(); }
          updateEdge(); rebuild();
        }),
        selectRow('Number of decks', o, 'decks', [[1, '1 deck'], [2, '2 decks'], [4, '4 decks'], [6, '6 decks'], [8, '8 decks']], () => { newShoe(); markCustom(); render(); }),
        selectRow('Dealer soft 17', o, 'h17', [[false, 'Stands (S17)'], [true, 'Hits (H17)']], markCustom),
        selectRow('Blackjack pays', o, 'bjPays', [['3:2', '3 to 2'], ['6:5', '6 to 5'], ['1:1', 'Even money']], markCustom),
        selectRow('Hole card', o, 'holeCard', [['us', 'US: dealer peeks'], ['enhc', 'European: no hole card']], markCustom),
        selectRow('Table limits', o, 'limits', [['5-500', '$5 – $500'], ['10-1000', '$10 – $1,000'], ['25-5000', '$25 – $5,000'], ['100-10000', '$100 – $10,000']], markCustom),
        selectRow('Betting spots', o, 'spots', [[1, '1 hand'], [2, '2 hands'], [3, '3 hands']], () => { if (phase === 'bet') { initSpots(); render(); } }),
        selectRow('Shuffle point (cut card)', o, 'penetration', [[0.5, '50% dealt'], [0.67, '67% dealt'], [0.75, '75% dealt'], [0.83, '83% dealt']], () => newShoe()),
        h('h3', {}, 'Player options'),
        selectRow('Double down on', o, 'doubleOn', [['any', 'Any two cards'], ['9-11', '9, 10, 11 only'], ['10-11', '10, 11 only']], markCustom),
        toggleRow('Double after split', o, 'das', markCustom),
        selectRow('Surrender', o, 'surrender', [['none', 'Not allowed'], ['late', 'Late surrender']], markCustom),
        selectRow('Split up to', o, 'maxHands', [[2, '2 hands'], [3, '3 hands'], [4, '4 hands']], markCustom),
        toggleRow('Resplit aces', o, 'resplitAces', markCustom),
        toggleRow('Hit split aces', o, 'hitSplitAces', markCustom),
        h('h3', {}, 'Training'),
        toggleRow('Show basic strategy hint', o, 'showHint', () => render()),
        toggleRow('Coach: warn on mistakes', o, 'coach', null, 'Asks before you deviate from basic strategy'),
        toggleRow('Show Hi-Lo card count', o, 'showCount', () => render(), 'Running and true count for practice'),
        toggleRow('Show hand totals', o, 'showTotals', () => render()),
      );
      if (changeLocked()) container.querySelectorAll('select, input').forEach((x) => { if (!/hint|coach|count|totals/i.test(x.closest('.row')?.textContent || '')) x.disabled = true; });
      updateEdge();
    }
    rebuild();
    sheet('Blackjack rules', container, { onClose: () => render() });
  }

  function openHelp() {
    sheet('How to play Blackjack', h('div', { class: 'prose' },
      h('p', {}, 'Get closer to 21 than the dealer without going over. Number cards count their value, J/Q/K count 10, and an Ace counts 1 or 11. An Ace plus a 10-value card on the first two cards is a Blackjack.'),
      h('p', {}, h('b', {}, 'Hit'), ' takes a card. ', h('b', {}, 'Stand'), ' ends your hand. ', h('b', {}, 'Double'), ' doubles your bet for exactly one more card. ', h('b', {}, 'Split'), ' turns a pair into two hands with equal bets. ', h('b', {}, 'Surrender'), ' gives up half your bet before playing.'),
      h('p', {}, 'Insurance is a side bet, offered when the dealer shows an Ace, that the dealer has Blackjack. It pays 2 to 1 and is a losing bet in the long run unless you are counting cards.'),
      h('p', {}, 'The dealer draws to 16 and stands on 17. With "H17", the dealer also hits a soft 17 (like Ace-6), which costs the player about 0.2%.'),
      h('p', {}, 'Avoid 6 to 5 blackjack tables: they raise the house edge by about 1.4%.')));
  }

  // ---------- Lifecycle ----------
  initSpots();
  newShoe();
  render();
  const ro = new ResizeObserver(() => render());
  ro.observe(view);
  return () => { ro.disconnect(); topEl._off?.(); };
}
