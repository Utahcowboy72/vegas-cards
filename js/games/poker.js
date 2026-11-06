// Poker room: Texas Hold'em, Omaha (high / Hi-Lo), Seven Card Stud (high / Hi-Lo), Five Card Draw.
// No-limit, pot-limit and fixed-limit betting, side pots, cash games and sit-and-go tournaments vs bots.
import { shuffledDeck, cardEl, shuffle, SUIT_CHAR, RANK_CHAR } from '../cards.js';
import { bestHigh, bestOmaha, bestOmahaLow, bestLow, eval5, handName, lowName, partialScore } from '../poker/eval.js';
import { equity, decide, drawDiscards, BOT_NAMES, STYLES, pickStyle } from '../poker/bots.js';
import { h, gameOpts, save, sheet, selectRow, toggleRow, toast, sfx, stat, addWallet, wallet, money, wait, confirmBox, state as appState } from '../core.js';

const VARIANTS = {
  holdem: { name: "Texas Hold'em", hole: 2, board: true, structure: 'nl' },
  omaha: { name: 'Omaha', hole: 4, board: true, structure: 'pl' },
  stud: { name: 'Seven Card Stud', stud: true, structure: 'fl' },
  draw: { name: 'Five Card Draw', hole: 5, draw: true, structure: 'nl' },
};

const STAKES_BLIND = [
  { sb: 1, bb: 2, label: '$1 / $2' },
  { sb: 2, bb: 5, label: '$2 / $5' },
  { sb: 5, bb: 10, label: '$5 / $10' },
  { sb: 10, bb: 25, label: '$10 / $25' },
];
const STAKES_STUD = [
  { small: 4, big: 8, ante: 1, bring: 2, label: '$4 / $8' },
  { small: 10, big: 20, ante: 1, bring: 3, label: '$10 / $20' },
  { small: 20, big: 40, ante: 3, bring: 5, label: '$20 / $40' },
];
const SNG_LEVELS = [[10, 20], [15, 30], [25, 50], [50, 100], [75, 150], [100, 200], [150, 300], [200, 400], [300, 600], [400, 800], [600, 1200], [800, 1600], [1000, 2000], [1500, 3000], [2000, 4000]];
const SNG_START = 1500;

const SUIT_ORDER = { C: 0, D: 1, H: 2, S: 3 }; // stud bring-in tie break: clubs lowest

export function mount(root, { id, topBar }) {
  const V = VARIANTS[id];
  const o = gameOpts('poker-' + id, {
    mode: 'cash', opponents: 5, structure: V.structure, stakes: 0, buyinBB: 100, hiLo: false,
    botStyle: 'mixed', showOdds: false, autoNext: false, levelHands: 10, sngBuyin: 100, showFolded: true,
  });
  if (V.stud) o.structure = 'fl';

  let players = [];
  let deck = [];
  let muck = [];
  let board = [];
  let button = 0;
  let handNo = 0;
  let level = 0;
  let running = false;
  let destroyed = false;
  let log = [];
  let userResolve = null;
  let legal = null;
  let phaseLabel = '';
  let lastResult = null;
  let tourney = null; // {buyin, places:[], prize}
  let round = null; // betting-round state
  let selectedDiscards = new Set();
  let drawResolve = null;

  // ---------- DOM ----------
  const topEl = topBar(V.name, { onOptions: openOptions, onHelp: openHelp, extra: h('button', { class: 'icon-btn', 'aria-label': 'Hand history', onclick: openLog }, '☰') });
  const tableEl = h('div', { class: 'pk-table' });
  const tableWrap = h('div', { class: 'pk-wrap' }, tableEl);
  const info = h('div', { class: 'pk-info' });
  const actions = h('div', { class: 'pk-actions' });
  const view = h('div', { class: 'game pk felt' }, topEl, info, tableWrap, h('div', { class: 'action-bar' }, actions));
  root.replaceChildren(view);

  // ---------- Structure helpers ----------
  const stakes = () => {
    if (o.mode === 'sng') {
      const [sb, bb] = SNG_LEVELS[Math.min(level, SNG_LEVELS.length - 1)];
      if (V.stud) return { small: bb, big: bb * 2, ante: Math.max(1, Math.round(bb / 5)), bring: Math.max(1, Math.round(bb / 2)), sb, bb };
      return { sb, bb, ante: level >= 5 ? Math.round(bb / 10) : 0 };
    }
    if (V.stud) { const s = STAKES_STUD[Math.min(o.stakes, STAKES_STUD.length - 1)]; return { ...s, bb: s.small }; }
    return { ...STAKES_BLIND[Math.min(o.stakes, STAKES_BLIND.length - 1)], ante: 0 };
  };
  const bigUnit = () => (V.stud ? stakes().small : stakes().bb);
  const buyinAmount = () => (V.stud ? stakes().big : stakes().bb) * (V.stud ? Math.round(o.buyinBB / 2) : o.buyinBB);

  const me = () => players[0];
  const inHand = () => players.filter((p) => p.inHand && !p.folded);
  const canActP = (p) => p.inHand && !p.folded && !p.allIn;
  const potTotal = () => players.reduce((a, p) => a + p.total, 0);
  const nextSeat = (i) => (i + 1) % players.length;
  const seatAfter = (i, pred) => { let j = i; for (let k = 0; k < players.length; k++) { j = nextSeat(j); if (pred(players[j])) return j; } return -1; };

  const FIX = { folds: 'fold', calls: 'call', checks: 'check', bets: 'bet', raises: 'raise', wins: 'win', posts: 'post', shows: 'show', draws: 'draw', stands: 'stand', finishes: 'finish', completes: 'complete', is: 'are' };
  const you = (s) => s.replace(/\bYou (folds|calls|checks|bets|raises|wins|posts|shows|draws|stands|finishes|completes)\b/g, (_, v) => 'You ' + FIX[v]).replace('and is all-in', (m) => m);
  function addLog(s) { log.push(you(s)); if (log.length > 400) log.shift(); }
  const cardTxt = (c) => RANK_CHAR[c.r] + SUIT_CHAR[c.s];

  // ---------- Seating ----------
  function seatPlayers() {
    const names = shuffle(BOT_NAMES.slice());
    const n = Math.min(o.opponents, V.stud ? 6 : 5);
    players = [{ name: 'You', bot: false, stack: 0, seat: 0 }];
    for (let i = 0; i < n; i++) players.push({ name: names[i], bot: true, style: pickStyle(o.botStyle), stack: 0, seat: i + 1 });
    button = Math.floor(Math.random() * players.length);
  }

  async function sitDown() {
    seatPlayers();
    handNo = 0; level = 0; log = []; lastResult = null;
    if (o.mode === 'sng') {
      const fee = Math.round(o.sngBuyin * 0.1);
      if (wallet() < o.sngBuyin + fee) { showMessage(`A ${money(o.sngBuyin)} + ${money(fee)} sit-and-go needs ${money(o.sngBuyin + fee)}. Refill your bankroll or pick a cheaper one in options.`); return false; }
      addWallet(-(o.sngBuyin + fee));
      stat('poker', 'tournamentsPlayed');
      stat('poker', 'totalWagered', o.sngBuyin + fee);
      players.forEach((p) => { p.stack = SNG_START; });
      const prizePool = o.sngBuyin * players.length;
      tourney = { buyin: o.sngBuyin, places: [], prizes: players.length >= 4 ? [Math.round(prizePool * 0.65), Math.round(prizePool * 0.35)] : [prizePool] };
      addLog(`Sit-and-go: ${players.length} players, ${money(o.sngBuyin)} buy-in, prize pool ${money(prizePool)}.`);
    } else {
      const amt = buyinAmount();
      if (wallet() < amt) {
        const min = Math.round(amt * 0.4);
        if (wallet() < min) { showMessage(`This table needs at least ${money(min)} to sit. Pick lower stakes or refill your bankroll.`); return false; }
      }
      const buy = Math.min(amt, Math.floor(wallet()));
      addWallet(-buy);
      appState.pokerCashout = buy; save();
      players[0].stack = buy;
      players.slice(1).forEach((p) => { p.stack = amt; });
      tourney = null;
      addLog(`Cash game ${stakesLabel()}. You bought in for ${money(buy)}.`);
    }
    return true;
  }

  function stakesLabel() {
    const s = stakes();
    const st = { nl: 'No-Limit', pl: 'Pot-Limit', fl: 'Limit' }[o.structure];
    return V.stud ? `${st} ${money(s.small)}/${money(s.big)}` : `${st} ${money(s.sb)}/${money(s.bb)}`;
  }

  function cashOut() {
    if (o.mode === 'cash' && players[0] && appState.pokerCashout) {
      const amt = players[0].stack;
      addWallet(amt);
      stat('poker', 'cashNet', amt - (players[0].buyins || appState.pokerCashout));
      appState.pokerCashout = 0;
      save();
    }
  }

  // ---------- Dealing ----------
  function deal(up = true) {
    if (!deck.length) { deck = shuffle(muck); muck = []; addLog('(Deck reshuffled from the muck)'); }
    const c = deck.pop();
    return { ...c, up, fresh: true };
  }
  const burn = () => { if (deck.length) muck.push(deck.pop()); };

  // ---------- Hand ----------
  async function playHand() {
    handNo++;
    const s = stakes();
    deck = shuffledDeck(1); muck = []; board = []; lastResult = null;
    players.forEach((p) => {
      Object.assign(p, { cards: [], folded: false, allIn: false, bet: 0, total: 0, inHand: p.stack > 0, lastAction: '', won: 0, shown: false, handName: '', drew: undefined });
    });
    sfx.shuffle();
    addLog(`— Hand #${handNo} · ${stakesLabel()}${tourney ? ` · Level ${level + 1}` : ''} —`);

    if (!V.stud) {
      button = seatAfter(button, (p) => p.stack > 0);
    }
    const active = players.filter((p) => p.inHand);
    const headsUp = active.length === 2;

    // Antes
    if (s.ante) for (const p of active) post(p, Math.min(s.ante, p.stack), 'ante', true);

    let sbSeat = -1; let bbSeat = -1;
    if (!V.stud) {
      sbSeat = headsUp ? button : seatAfter(button, (p) => p.inHand);
      bbSeat = seatAfter(sbSeat, (p) => p.inHand);
      post(players[sbSeat], Math.min(s.sb, players[sbSeat].stack), 'small blind');
      post(players[bbSeat], Math.min(s.bb, players[bbSeat].stack), 'big blind');
    }
    render();
    await wait(300);

    // Deal hole cards one at a time around the table starting left of the button.
    const holeN = V.stud ? 3 : V.hole;
    const order = [];
    let j = button;
    for (let k = 0; k < players.length; k++) { j = nextSeat(j); if (players[j].inHand) order.push(players[j]); }
    for (let r = 0; r < holeN; r++) {
      for (const p of order) {
        p.cards.push(deal(V.stud ? r === 2 : false));
        sfx.card();
        render();
        await wait(70);
      }
    }
    if (destroyed) return;

    if (V.board) {
      const streets = [['Preflop', 0], ['Flop', 3], ['Turn', 1], ['River', 1]];
      for (let si = 0; si < streets.length; si++) {
        const [name, n] = streets[si];
        if (n) {
          burn();
          for (let k = 0; k < n; k++) board.push(deal(true));
          addLog(`${name}: ${board.map(cardTxt).join(' ')}`);
          sfx.card();
        }
        phaseLabel = name;
        render();
        if (n) await wait(450);
        if (inHand().length > 1 && players.filter(canActP).length > 1) {
          const first = si === 0 ? seatAfter(bbSeat, canActP) : seatAfter(button, canActP);
          await bettingRound(si === 0 ? s.bb : 0, first, si === 0 ? 'pre' : 'post', si >= 2 ? 'big' : 'small');
        } else if (inHand().length > 1) {
          revealAll();
        }
        if (inHand().length <= 1) break;
      }
    } else if (V.stud) {
      const streetNames = ['Third street', 'Fourth street', 'Fifth street', 'Sixth street', 'Seventh street'];
      for (let si = 0; si < 5; si++) {
        if (si > 0) {
          burn();
          for (const p of order) if (p.inHand && !p.folded) { p.cards.push(deal(si < 4)); }
          sfx.card();
        }
        phaseLabel = streetNames[si];
        render();
        await wait(si ? 450 : 200);
        if (inHand().length > 1 && players.filter(canActP).length > 1) {
          if (si === 0) {
            const bring = bringInSeat(order);
            const p = players[bring];
            post(p, Math.min(s.bring, p.stack), 'brings in');
            render();
            await wait(300);
            await bettingRound(s.bring, seatAfter(bring, canActP), 'pre', 'small', true);
          } else {
            const first = bestShowingSeat();
            await bettingRound(0, first, 'post', si >= 2 ? 'big' : 'small');
          }
        } else if (inHand().length > 1) revealAll();
        if (inHand().length <= 1) break;
      }
    } else {
      // Five card draw
      phaseLabel = 'Before the draw';
      render();
      const first = seatAfter(bbSeat, canActP);
      if (players.filter(canActP).length > 1) await bettingRound(s.bb, first, 'pre', 'small');
      if (inHand().length > 1) {
        phaseLabel = 'The draw';
        await drawRound();
        phaseLabel = 'After the draw';
        render();
        if (players.filter(canActP).length > 1) await bettingRound(0, seatAfter(button, canActP), 'post', o.structure === 'fl' ? 'big' : 'small');
      }
    }
    if (destroyed) return;
    await showdown();
  }

  function post(p, amt, what, quiet) {
    // Antes go straight into the pot; blinds and bring-ins are live bets.
    p.stack -= amt; p.total += amt;
    if (what !== 'ante') p.bet += amt;
    if (p.stack === 0) p.allIn = true;
    if (!quiet) p.lastAction = `${what} ${money(amt)}`;
    addLog(`${p.name} posts ${what} ${money(amt)}`);
  }

  function bringInSeat(order) {
    let best = null; let seat = -1;
    for (const p of order) {
      const up = p.cards[2];
      const v = up.r * 4 + SUIT_ORDER[up.s];
      if (best === null || v < best) { best = v; seat = players.indexOf(p); }
    }
    return seat;
  }
  function bestShowingSeat() {
    let best = -1; let seat = -1;
    let j = button;
    for (let k = 0; k < players.length; k++) {
      j = nextSeat(j);
      const p = players[j];
      if (!canActP(p)) continue;
      const ups = p.cards.filter((c) => c.up);
      const sc = partialScore(ups);
      if (sc > best) { best = sc; seat = j; }
    }
    return seat === -1 ? seatAfter(button, canActP) : seat;
  }

  // ---------- Betting ----------
  async function bettingRound(openBet, firstSeat, street, size, studBringIn = false) {
    const s = stakes();
    const unit = o.structure === 'fl' ? (V.stud ? (size === 'big' ? s.big : s.small) : (size === 'big' ? s.bb * 2 : s.bb)) : s.bb;
    round = {
      currentBet: Math.max(openBet, ...players.map((p) => p.bet)),
      lastRaise: V.stud ? unit : s.bb,
      raises: openBet > 0 && !studBringIn ? 1 : 0,
      unit, street,
      bringIn: studBringIn ? openBet : 0,
    };
    players.forEach((p) => { p.mayRaise = true; p.acted = false; });
    let need = new Set(players.filter(canActP));
    let seat = firstSeat;
    let guard = 0;
    while (need.size && inHand().length > 1 && guard++ < 200) {
      const p = players[seat];
      if (need.has(p) && canActP(p)) {
        // A player facing no bet with everyone else all-in has nothing to decide.
        const others = players.filter((x) => x !== p && canActP(x));
        if (!others.length && p.bet >= round.currentBet) { need.delete(p); seat = nextSeat(seat); continue; }
        legal = legalFor(p);
        actingPlayer = p;
        render();
        const act = p.bot ? await botAct(p) : await userAct();
        if (destroyed) return;
        const raised = apply(p, act);
        need.delete(p);
        p.acted = true;
        p.mayRaise = false;
        if (raised) {
          need = new Set(players.filter((x) => x !== p && canActP(x)));
          if (raised === 'full') players.forEach((x) => { if (x !== p) x.mayRaise = true; });
        }
        legal = null;
        render();
        await wait(p.bot ? 120 : 60);
      } else need.delete(p);
      seat = nextSeat(seat);
    }
    // Collect bets into the pot.
    players.forEach((p) => { p.bet = 0; });
    round = null;
    render();
  }

  function legalFor(p) {
    const toCallFull = round.currentBet - p.bet;
    const toCall = Math.min(toCallFull, p.stack);
    const others = players.filter((x) => x !== p && canActP(x));
    let canRaise = p.mayRaise && p.stack > toCall && others.length > 0;
    let minTo; let maxTo;
    const all = p.bet + p.stack;
    if (o.structure === 'fl') {
      if (round.raises >= 4) canRaise = false;
      const to = round.currentBet < round.unit ? round.unit : round.currentBet + round.unit;
      minTo = maxTo = Math.min(to, all);
    } else {
      const minInc = Math.max(round.lastRaise, stakes().bb);
      minTo = round.currentBet === 0 ? Math.min(stakes().bb, all) : Math.min(round.currentBet + minInc, all);
      if (o.structure === 'pl') {
        const pot = potTotal() + toCallFull;
        maxTo = Math.min(all, round.currentBet + pot);
      } else maxTo = all;
      if (maxTo < minTo) minTo = maxTo;
    }
    return { toCall, canCheck: toCall === 0, canRaise, minTo, maxTo, isBet: round.currentBet === 0 || (round.bringIn && round.currentBet === round.bringIn) };
  }

  function apply(p, act) {
    const L = legalFor(p);
    let raised = false;
    if (act.type === 'fold') {
      if (L.canCheck) { act = { type: 'check' }; } else {
        p.folded = true; p.lastAction = 'Fold';
        addLog(`${p.name} folds`);
        muck.push(...p.cards);
        return false;
      }
    }
    if (act.type === 'check') {
      if (!L.canCheck) act = { type: 'call' };
      else { p.lastAction = 'Check'; addLog(`${p.name} checks`); sfx.card(); return false; }
    }
    if (act.type === 'call') {
      const amt = L.toCall;
      p.stack -= amt; p.bet += amt; p.total += amt;
      if (p.stack === 0) p.allIn = true;
      p.lastAction = p.allIn ? `All-in ${money(p.bet)}` : `Call ${money(amt)}`;
      addLog(`${p.name} calls ${money(amt)}${p.allIn ? ' and is all-in' : ''}`);
      sfx.chip();
      return false;
    }
    if (act.type === 'raise') {
      if (!L.canRaise) return apply(p, { type: L.canCheck ? 'check' : 'call' });
      let to = Math.round(Math.max(L.minTo, Math.min(L.maxTo, act.to)));
      const amt = to - p.bet;
      const inc = to - round.currentBet;
      p.stack -= amt; p.bet = to; p.total += amt;
      if (p.stack === 0) p.allIn = true;
      const wasBet = round.currentBet === 0;
      const fullInc = o.structure === 'fl' ? (round.currentBet < round.unit ? round.unit - round.currentBet : round.unit) : Math.max(round.lastRaise, stakes().bb);
      if (inc >= fullInc || (o.structure === 'fl' && inc >= fullInc * 0.5)) { raised = 'full'; if (o.structure !== 'fl') round.lastRaise = inc; round.raises++; }
      else raised = 'short';
      round.currentBet = to;
      const word = round.bringIn && wasBet === false && round.raises === 1 && V.stud ? 'completes to' : wasBet ? 'bets' : 'raises to';
      p.lastAction = p.allIn ? `All-in ${money(to)}` : `${word === 'bets' ? 'Bet' : word === 'completes to' ? 'Complete' : 'Raise to'} ${money(to)}`;
      addLog(`${p.name} ${word} ${money(to)}${p.allIn ? ' (all-in)' : ''}`);
      sfx.chip();
      return raised;
    }
    return false;
  }

  async function botAct(p) {
    await wait(380 + Math.random() * 520);
    const L = legal;
    const opp = inHand().length - 1;
    const eq = equity(ctxFor(p, opp));
    const decision = decide(p.style, {
      equity: eq, toCall: L.toCall, pot: potTotal(), minTo: L.minTo, maxTo: L.maxTo, canRaise: L.canRaise,
      bet: round.currentBet, myBet: p.bet, stack: p.stack, bb: bigUnit(), street: round.street, opponents: opp,
      structure: o.structure, facingRaises: Math.max(0, round.raises - 1),
    });
    // Don't fold getting a free look.
    if (decision.type === 'fold' && L.canCheck) return { type: 'check' };
    return decision;
  }

  function ctxFor(p, opp) {
    const others = players.filter((x) => x !== p && x.inHand && !x.folded);
    if (V.board) return { variant: id, hole: p.cards, board, opponents: opp, hiLo: o.hiLo };
    if (V.stud) return { variant: 'stud', hole: p.cards, opponents: opp, oppUp: others.map((x) => x.cards.filter((c) => c.up)), dead: muck.filter((c) => c.up), hiLo: o.hiLo };
    return { variant: 'draw', hole: p.cards, opponents: opp, drawPhase: p.drew === undefined ? 'pre' : 'post', oppDrew: p.drew === undefined ? undefined : others.map((x) => x.drew) };
  }

  function userAct() {
    return new Promise((res) => { userResolve = res; render(); });
  }
  function userChoose(a) {
    if (!userResolve) return;
    const r = userResolve; userResolve = null;
    r(a);
  }

  // ---------- Draw ----------
  async function drawRound() {
    let j = button;
    for (let k = 0; k < players.length; k++) {
      j = nextSeat(j);
      const p = players[j];
      if (!p.inHand || p.folded) continue;
      let disc;
      if (p.bot) {
        await wait(400);
        disc = drawDiscards(p.cards);
      } else {
        selectedDiscards = new Set();
        disc = await new Promise((res) => { drawResolve = res; render(); });
        drawResolve = null;
      }
      disc.sort((a, b) => b - a);
      for (const i of disc) muck.push(p.cards[i]);
      for (const i of disc) p.cards[i] = deal(false);
      p.drew = disc.length;
      p.lastAction = disc.length ? `Draws ${disc.length}` : 'Stands pat';
      addLog(`${p.name} ${disc.length ? `draws ${disc.length}` : 'stands pat'}`);
      sfx.card();
      render();
      await wait(250);
    }
  }

  // ---------- Showdown ----------
  function revealAll() {
    for (const p of inHand()) { p.shown = true; p.cards.forEach((c) => { c.revealed = true; }); }
    render();
  }

  function scoreHigh(p) {
    if (V.board && id === 'omaha') return bestOmaha(p.cards, board);
    if (V.board) return bestHigh(p.cards.concat(board));
    return bestHigh(p.cards);
  }
  function scoreLow(p) {
    if (!o.hiLo) return null;
    if (id === 'omaha') return bestOmahaLow(p.cards, board);
    if (V.stud) return bestLow(p.cards);
    return null;
  }

  async function showdown() {
    // Return any uncalled bet.
    const sorted = players.filter((p) => p.total > 0).sort((a, b) => b.total - a.total);
    if (sorted.length >= 1) {
      const top = sorted[0];
      const second = sorted[1] ? sorted[1].total : 0;
      if (top.total > second) {
        const back = top.total - second;
        top.total -= back; top.stack += back;
        if (top.stack > 0) top.allIn = false;
        if (back > 0 && inHand().length > 1) addLog(`Uncalled ${money(back)} returned to ${top.name}`);
        if (inHand().length === 1) { /* folded-to: refund silently */ }
      }
    }
    const contenders = inHand();
    const results = [];
    if (contenders.length === 1) {
      const w = contenders[0];
      const pot = potTotal();
      w.stack += pot; w.won = pot;
      addLog(`${w.name} wins ${money(pot)} (everyone else folded)`);
      results.push(you(`${w.name} wins ${money(pot)}`));
    } else {
      revealAll();
      phaseLabel = 'Showdown';
      const hi = new Map(); const lo = new Map();
      for (const p of contenders) {
        const H = scoreHigh(p); hi.set(p, H);
        const Lw = scoreLow(p); if (Lw) lo.set(p, Lw);
        p.handName = handName(H.score) + (Lw ? ` · ${lowName(Lw.hand)}` : '');
        p.bestCards = new Set([...H.hand].map((c) => c.r + c.s));
        addLog(`${p.name} shows ${p.cards.map(cardTxt).join(' ')} — ${p.handName}`);
      }
      // Side pots by contribution level.
      const levels = [...new Set(players.filter((p) => p.total > 0).map((p) => p.total))].sort((a, b) => a - b);
      let prev = 0;
      const pots = [];
      for (const lv of levels) {
        const contributors = players.filter((p) => p.total >= lv);
        const amount = (lv - prev) * contributors.length + players.filter((p) => p.total > prev && p.total < lv).reduce((a, p) => a + (p.total - prev), 0);
        const eligible = contributors.filter((p) => !p.folded && p.inHand);
        if (amount > 0) {
          if (eligible.length) pots.push({ amount, eligible });
          else if (pots.length) pots[pots.length - 1].amount += amount;
        }
        prev = lv;
      }
      // Merge pots with identical eligibility.
      const merged = [];
      for (const pt of pots) {
        const last = merged[merged.length - 1];
        if (last && last.eligible.length === pt.eligible.length && last.eligible.every((x) => pt.eligible.includes(x))) last.amount += pt.amount;
        else merged.push({ ...pt });
      }
      merged.forEach((pt, pi) => {
        const label = merged.length > 1 ? (pi === 0 ? 'main pot' : `side pot ${pi}`) : 'the pot';
        const lows = pt.eligible.filter((p) => lo.has(p));
        let hiAmt = pt.amount; let loAmt = 0;
        if (o.hiLo && lows.length) { loAmt = Math.floor(pt.amount / 2); hiAmt = pt.amount - loAmt; }
        const bestHiScore = Math.max(...pt.eligible.map((p) => hi.get(p).score));
        const hiW = pt.eligible.filter((p) => hi.get(p).score === bestHiScore);
        splitTo(hiW, hiAmt, label + (loAmt ? ' (high)' : ''), results);
        if (loAmt) {
          const bestLo = Math.min(...lows.map((p) => lo.get(p).score));
          const loW = lows.filter((p) => lo.get(p).score === bestLo);
          splitTo(loW, loAmt, label + ' (low)', results);
        }
      });
    }
    players.forEach((p) => { p.total = 0; });
    lastResult = results;
    const m = me();
    if (m.won > 0) { sfx.win(); stat('poker', 'potsWon'); }
    stat('poker', 'handsPlayed');
    if (o.mode === 'cash') { appState.pokerCashout = m.stack; save(); }
    render();
  }

  function splitTo(winners, amount, label, results) {
    // Odd chips go to the first winner left of the button.
    const order = [];
    let j = button;
    for (let k = 0; k < players.length; k++) { j = nextSeat(j); if (winners.includes(players[j])) order.push(players[j]); }
    const share = Math.floor(amount / order.length);
    let odd = amount - share * order.length;
    for (const w of order) {
      const amt = share + (odd > 0 ? 1 : 0);
      if (odd > 0) odd--;
      w.stack += amt; w.won += amt;
      addLog(`${w.name} wins ${money(amt)} from ${label}${order.length > 1 ? ' (split)' : ''}`);
      results.push(you(`${w.name} wins ${money(amt)}${order.length > 1 ? ' (split)' : ''} — ${w.handName.split(' · ')[label.includes('low') ? 1 : 0] || w.handName}`));
    }
  }

  // ---------- Session loop ----------
  async function loop() {
    if (running) return;
    running = true;
    while (!destroyed) {
      // Busts / rebuys
      if (o.mode === 'sng') {
        const busted = players.filter((p) => p.stack <= 0 && !p.out);
        const remainingBefore = players.filter((p) => !p.out).length;
        busted.forEach((p, k) => { p.out = true; tourney.places.push({ name: p.name, place: remainingBefore - k }); addLog(`${p.name} finishes in place ${remainingBefore - k}`); });
        if (me().out) { await tourneyOver(tourney.places.find((x) => x.name === 'You').place); break; }
        const alive = players.filter((p) => !p.out);
        if (alive.length === 1) { await tourneyOver(1); break; }
        if (handNo && handNo % o.levelHands === 0 && level < SNG_LEVELS.length - 1) { level++; toast(`Blinds up: level ${level + 1}`); addLog(`Blinds increase to level ${level + 1}`); }
      } else {
        for (const p of players.slice(1)) if (p.stack < bigUnit() * 2) {
          // Busted or short bot reloads, or a new player takes the seat.
          if (Math.random() < 0.5) { p.name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]; p.style = pickStyle(o.botStyle); addLog(`${p.name} sits down`); }
          p.stack = buyinAmount();
        }
        if (me().stack <= 0) {
          render();
          const again = await askRebuy();
          if (!again) break;
        }
      }
      players.forEach((p) => { if (p.out) p.stack = 0; });
      await playHand();
      if (destroyed) break;
      if (o.autoNext && !(o.mode === 'sng' && me().stack <= 0)) await wait(2200);
      else await waitNext();
    }
    running = false;
  }

  function waitNext() {
    return new Promise((res) => { nextResolve = res; render(); });
  }
  let nextResolve = null;

  async function askRebuy() {
    const amt = buyinAmount();
    if (wallet() < amt * 0.4) { showMessage('You are out of chips and your bankroll is too low to rebuy. Refill from the main menu.'); return false; }
    const ok = await confirmBox('Rebuy?', `You're out of chips. Buy in again for ${money(Math.min(amt, Math.floor(wallet())))}?`, 'Rebuy');
    if (!ok) return false;
    const buy = Math.min(amt, Math.floor(wallet()));
    addWallet(-buy);
    me().stack = buy;
    me().buyins = (me().buyins || appState.pokerCashout) + buy;
    appState.pokerCashout = buy; save();
    return true;
  }

  async function tourneyOver(place) {
    const prize = tourney.prizes[place - 1] || 0;
    if (prize) { addWallet(prize); sfx.win(); stat('poker', 'tournamentCashes'); }
    if (place === 1) stat('poker', 'tournamentsWon');
    stat('poker', 'tournamentNet', prize - tourney.buyin - Math.round(tourney.buyin * 0.1));
    const ord = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th'][place];
    showMessage(`You finished ${ord}${prize ? ` and won ${money(prize)}` : ''}.`, true);
  }

  function showMessage(text, again) {
    actions.replaceChildren(h('div', { class: 'status-line' }, text), h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => { location.hash = ''; } }, 'Lobby'),
      again ? h('button', { class: 'btn primary', onclick: start }, 'Play again') : h('button', { class: 'btn primary', onclick: openOptions }, 'Options')));
  }

  async function start() {
    if (running) return;
    cashOut();
    const ok = await sitDown();
    render();
    if (ok) loop();
  }

  // ---------- Rendering ----------
  function seatPos(i, n) {
    const ang = Math.PI / 2 + (i * 2 * Math.PI) / n;
    if (i === 0) return { x: 50, y: 83 };
    return { x: 50 + 40 * Math.cos(ang), y: 47 + 36 * Math.sin(ang) };
  }

  function cardNode(c, faceUp, cls = '') {
    const el = cardEl(c, faceUp, cls);
    if (c.fresh) { el.classList.add('deal-in'); c.fresh = false; }
    return el;
  }

  function render() {
    if (destroyed) return;
    const W = tableWrap.clientWidth; const H = tableWrap.clientHeight;
    const portrait = H > W;
    const base = Math.min(W, H * (portrait ? 0.75 : 1.4));
    const cw = Math.round(Math.max(30, Math.min(64, base / (V.stud ? 13 : 9.5))));
    view.style.setProperty('--cw', cw + 'px');
    tableEl.classList.toggle('portrait', portrait);
    const s = stakes();
    info.textContent = players.length ? `${stakesLabel()}${o.hiLo && (id === 'omaha' || V.stud) ? ' Hi-Lo 8' : ''}${tourney ? ` · Level ${level + 1} · ${players.filter((p) => !p.out).length} left` : ''}${phaseLabel ? ' · ' + phaseLabel : ''}` : '';

    const n = players.length;
    const seats = players.map((p, i) => {
      const pos = seatPos(i, n);
      const isTurn = !!(legal && round && p === actingPlayer);
      const showFace = (c) => !p.bot || c.up || c.revealed || p.shown;
      const cards = (p.cards || []).map((c, ci) => {
        const el = cardNode(c, showFace(c), c.up && !p.bot && V.stud ? 'upcard' : '');
        if (!p.bot && V.draw && drawResolve && selectedDiscards.has(ci)) el.classList.add('discard');
        if (!p.bot && V.draw && drawResolve) el.addEventListener('click', () => { selectedDiscards.has(ci) ? selectedDiscards.delete(ci) : selectedDiscards.add(ci); render(); });
        if (p.bestCards && lastResult && p.bestCards.has(c.r + c.s)) el.classList.add('win');
        if (V.stud && !c.up && !p.bot) el.classList.add('mydown');
        return el;
      });
      const seat = h('div', {
        class: 'pk-seat' + (p.bot ? '' : ' me') + (p.folded ? ' folded' : '') + (p.out ? ' out' : '') + (isTurn ? ' turn' : '') + (p.won ? ' winner' : ''),
        style: { left: pos.x + '%', top: pos.y + '%' },
      },
      h('div', { class: 'pk-cards' + (p.folded && !o.showFolded ? ' hidden' : '') }, p.folded && p.bot ? [] : cards),
      h('div', { class: 'pk-plate' },
        h('div', { class: 'pk-name' }, p.name, p.bot && STYLES[p.style] ? h('small', { title: STYLES[p.style].label }, ' ' + styleIcon(p.style)) : null),
        h('div', { class: 'pk-stack' }, p.out ? 'Out' : money(p.stack)),
        p.lastAction ? h('div', { class: 'pk-act' }, p.lastAction) : null,
        p.handName && p.shown ? h('div', { class: 'pk-hand' }, p.handName) : null),
      i === button && !V.stud ? h('div', { class: 'dealer-btn' }, 'D') : null,
      null);
      return seat;
    });

    const pot = potTotal() - players.reduce((a, p) => a + p.bet, 0);
    const center = h('div', { class: 'pk-center' },
      V.board ? h('div', { class: 'pk-board' }, board.map((c) => cardNode(c, true, lastResult && players.some((p) => p.bestCards?.has(c.r + c.s) && p.won) ? 'win' : '')), Array.from({ length: 5 - board.length }, () => h('div', { class: 'card-ghost' }))) : null,
      h('div', { class: 'pk-pot' }, pot > 0 ? `Pot ${money(pot)}` : ''),
      lastResult ? h('div', { class: 'pk-result' }, lastResult.slice(0, 4).map((r) => h('div', {}, r))) : null);

    // Bets sit on the felt between each player and the pot.
    const bets = players.map((p, i) => {
      if (!p.bet) return null;
      const pos = seatPos(i, n);
      const f = i === 0 ? 0.55 : 0.6;
      return h('div', { class: 'pk-bet', style: { left: 50 + (pos.x - 50) * f + '%', top: 47 + (pos.y - 47) * f + '%' } }, money(p.bet));
    }).filter(Boolean);
    tableEl.replaceChildren(h('div', { class: 'pk-felt-oval' }), center, ...seats, ...bets);
    renderActions();
  }

  let actingPlayer = null;

  function styleIcon(k) { return { rock: '🪨', tag: '🎯', lag: '🔥', station: '📞', solid: '🃏' }[k] || ''; }

  function betOffset(pos) {
    const dx = (50 - pos.x) * 0.9; const dy = (50 - pos.y) * 0.9;
    return { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))` };
  }

  function renderActions() {
    actions.replaceChildren();
    if (!players.length || (!running && !lastResult)) {
      actions.append(h('div', { class: 'status-line' }, o.mode === 'sng' ? `Sit-and-go: ${money(o.sngBuyin)} + ${money(Math.round(o.sngBuyin * 0.1))} fee, ${Math.min(o.opponents, V.stud ? 6 : 5) + 1} players, top ${o.opponents >= 3 ? 2 : 1} paid.` : `Cash game ${stakesLabel()}. Buy-in ${money(buyinAmount())}.`),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: openOptions }, 'Options'), h('button', { class: 'btn primary', onclick: start }, o.mode === 'sng' ? 'Register' : 'Sit down')));
      return;
    }
    if (drawResolve) {
      const n = selectedDiscards.size;
      actions.append(h('div', { class: 'status-line' }, 'Tap the cards you want to throw away.'),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: () => { const d = [...selectedDiscards]; selectedDiscards = new Set(); drawResolve(d); } }, n ? `Draw ${n}` : 'Stand pat')));
      return;
    }
    if (userResolve && legal) {
      const L = legal;
      const p = me();
      const st = h('div', { class: 'status-line' });
      if (o.showOdds) {
        const opp = inHand().length - 1;
        const eq = equity({ ...ctxFor(p, opp), iters: 500 });
        st.textContent = `Your equity vs ${opp} random hand${opp > 1 ? 's' : ''}: ${(eq * 100).toFixed(0)}%` + (L.toCall ? ` · pot odds need ${((L.toCall / (potTotal() + L.toCall)) * 100).toFixed(0)}%` : '');
      } else st.textContent = currentHandName(p);
      const row = h('div', { class: 'btn-row' });
      row.append(h('button', { class: 'btn danger', onclick: () => userChoose({ type: 'fold' }) }, 'Fold'));
      row.append(h('button', { class: 'btn green', onclick: () => userChoose({ type: L.canCheck ? 'check' : 'call' }) }, L.canCheck ? 'Check' : (L.toCall >= p.stack ? `All-in ${money(L.toCall)}` : `Call ${money(L.toCall)}`)));
      let sizer = null;
      if (L.canRaise) {
        const word = L.isBet ? (round.bringIn && V.stud && round.currentBet === round.bringIn ? 'Complete' : 'Bet') : 'Raise to';
        if (o.structure === 'fl' || L.minTo === L.maxTo) {
          row.append(h('button', { class: 'btn primary', onclick: () => userChoose({ type: 'raise', to: L.minTo }) }, `${word} ${money(L.minTo)}${L.minTo === p.bet + p.stack ? ' (all-in)' : ''}`));
        } else {
          let amount = L.minTo;
          const label = h('span', {}, money(amount));
          const range = h('input', { type: 'range', min: L.minTo, max: L.maxTo, step: 1, value: L.minTo, class: 'pk-range', oninput: (e) => { amount = Number(e.target.value); label.textContent = money(amount) + (amount === L.maxTo && o.structure === 'nl' ? ' all-in' : ''); } });
          const set = (v) => { amount = Math.max(L.minTo, Math.min(L.maxTo, Math.round(v))); range.value = amount; label.textContent = money(amount) + (amount === p.bet + p.stack ? ' all-in' : ''); };
          const potNow = potTotal();
          const callAmt = round.currentBet - p.bet;
          const potRaise = (f) => round.currentBet + (potNow + callAmt) * f;
          sizer = h('div', { class: 'pk-sizer' },
            h('div', { class: 'btn-row' },
              h('button', { class: 'btn small', onclick: () => set(L.minTo) }, 'Min'),
              h('button', { class: 'btn small', onclick: () => set(potRaise(0.5)) }, '½ Pot'),
              h('button', { class: 'btn small', onclick: () => set(potRaise(0.75)) }, '¾ Pot'),
              h('button', { class: 'btn small', onclick: () => set(potRaise(1)) }, 'Pot'),
              o.structure === 'nl' ? h('button', { class: 'btn small', onclick: () => set(L.maxTo) }, 'All-in') : null),
            range);
          row.append(h('button', { class: 'btn primary', onclick: () => userChoose({ type: 'raise', to: amount }) }, word + ' ', label));
        }
      }
      actions.append(...[st, sizer, row].filter(Boolean));
      return;
    }
    if (nextResolve) {
      actions.append(h('div', { class: 'status-line' }, lastResult ? lastResult[0] : ''),
        h('div', { class: 'btn-row' },
          o.mode === 'cash' ? h('button', { class: 'btn', onclick: leaveTable }, 'Leave table') : null,
          h('button', { class: 'btn primary', onclick: () => { const r = nextResolve; nextResolve = null; r(); } }, 'Next hand')));
      return;
    }
    actions.append(h('div', { class: 'status-line' }, actingName()), h('div', { class: 'btn-row' }, h('button', { class: 'btn', disabled: true }, 'Waiting…')));
  }

  function actingName() {
    return phaseLabel || '';
  }

  function currentHandName(p) {
    if (!p.cards || !p.cards.length || p.folded) return '';
    try {
      if (V.board) {
        if (board.length < 3) return '';
        return 'You have: ' + handName((id === 'omaha' ? bestOmaha(p.cards, board) : bestHigh(p.cards.concat(board))).score);
      }
      if (V.stud) return 'You have: ' + handName(p.cards.length >= 5 ? bestHigh(p.cards).score : partialScore(p.cards));
      return 'You have: ' + handName(eval5(p.cards));
    } catch { return ''; }
  }

  async function leaveTable() {
    cashOut();
    players = [];
    if (nextResolve) { destroyed = true; const r = nextResolve; nextResolve = null; r(); }
    location.hash = '';
  }

  // ---------- Menus ----------
  function openOptions() {
    const locked = running;
    const body = h('div', {},
      locked ? h('p', { class: 'prose' }, h('small', {}, 'Table changes take effect when you next sit down (leave the table first).')) : null,
      h('h3', {}, 'Game'),
      selectRow('Format', o, 'mode', [['cash', 'Cash game'], ['sng', 'Sit-and-go tournament']], () => render()),
      V.stud ? null : selectRow('Betting', o, 'structure', [['nl', 'No-limit'], ['pl', 'Pot-limit'], ['fl', 'Fixed limit']], () => render()),
      (id === 'omaha' || V.stud) ? toggleRow('Hi-Lo split (8 or better)', o, 'hiLo', () => render(), 'Best high and best qualifying low split the pot') : null,
      selectRow('Opponents', o, 'opponents', (V.stud ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]).map((x) => [x, x === 1 ? 'Heads-up (1)' : `${x} players`]), () => render()),
      selectRow('Opponent style', o, 'botStyle', [['mixed', 'Mixed table'], ...Object.entries(STYLES).map(([k, v]) => [k, v.label])]),
      h('h3', {}, o.mode === 'sng' ? 'Tournament' : 'Stakes'),
      selectRow('Cash stakes', o, 'stakes', (V.stud ? STAKES_STUD : STAKES_BLIND).map((x, i) => [i, x.label]), () => render()),
      selectRow('Cash buy-in', o, 'buyinBB', [[40, 'Short (40 big blinds)'], [100, 'Standard (100 big blinds)'], [200, 'Deep (200 big blinds)']], () => render()),
      selectRow('Sit-and-go buy-in', o, 'sngBuyin', [[20, '$20 + $2'], [50, '$50 + $5'], [100, '$100 + $10'], [500, '$500 + $50']], () => render()),
      selectRow('Blinds go up every', o, 'levelHands', [[6, '6 hands (turbo)'], [10, '10 hands'], [15, '15 hands']]),
      h('h3', {}, 'Table'),
      toggleRow('Show my odds', o, 'showOdds', () => render(), 'Equity versus random hands and pot odds'),
      toggleRow('Auto-deal next hand', o, 'autoNext'),
    );
    if (locked) body.querySelectorAll('select').forEach((x) => { const lbl = x.closest('.row')?.textContent || ''; if (!/style/i.test(lbl)) x.disabled = true; });
    sheet(`${V.name} options`, body);
  }

  function openLog() {
    sheet('Hand history', h('div', { class: 'pk-log' }, log.slice(-120).map((l) => h('div', { class: l.startsWith('—') ? 'hd' : '' }, l))));
  }

  function openHelp() {
    const bodies = {
      holdem: ['Each player gets two private cards. Five community cards come out in three stages: the flop (3), the turn (1) and the river (1). Make the best five-card hand from any combination of your two cards and the board.', 'Betting goes: blinds, preflop, flop, turn, river. The button moves one seat each hand.'],
      omaha: ['Each player gets four private cards, and you must use exactly two of them with exactly three board cards. Four hearts in your hand with one on board is not a flush.', 'Usually played pot-limit: the most you can raise is the size of the pot. In Hi-Lo, the best high and the best low (five different cards 8 or lower, ace counts low) split the pot.'],
      stud: ['No community cards. You get two cards down and one up (third street), then three more face up, then a final card face down: seven cards total, best five play.', 'Everyone antes. The lowest up card must "bring in" a small forced bet (ties broken by suit: clubs, diamonds, hearts, spades). After that, the best visible hand acts first each street. Third and fourth streets use the small bet; fifth, sixth and seventh use the big bet.'],
      draw: ['Each player gets five cards face down. After a betting round, you may throw away any number of cards and draw replacements. Then there is a final betting round and showdown.', 'Tap cards to mark them for discarding, then press Draw. A typical play: keep a pair and draw three, keep four to a flush and draw one.'],
    }[id];
    sheet(`How to play ${V.name}`, h('div', { class: 'prose' },
      bodies.map((t) => h('p', {}, t)),
      h('p', {}, h('b', {}, 'Hand ranks (high to low): '), 'straight flush, four of a kind, full house, flush, straight, three of a kind, two pair, one pair, high card.'),
      h('p', {}, h('b', {}, 'Opponents: '), 'each computer player has a style (🪨 tight-passive, 🎯 tight-aggressive, 🔥 loose-aggressive, 📞 calling station, 🃏 solid). They estimate their odds by simulating hundreds of run-outs, then weigh pot odds, position and their personality. They bluff sometimes. They never see your cards.')));
  }

  // ---------- Lifecycle ----------
  window.__pokerDebug = () => ({ players, handNo, level });
  const ro = new ResizeObserver(() => render());
  ro.observe(tableWrap);
  render();

  return () => {
    destroyed = true;
    cashOut();
    ro.disconnect();
    topEl._off?.();
    if (userResolve) userResolve({ type: 'fold' });
    if (nextResolve) nextResolve();
    if (drawResolve) drawResolve([]);
  };
}
