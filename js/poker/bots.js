// Computer opponents: Monte Carlo equity + personality-driven decisions.
import { newDeck, random, randInt } from '../cards.js';
import { eval5, bestHigh, bestOmaha, bestOmahaLow, bestLow, partialScore, combos } from './eval.js';

export const BOT_NAMES = ['Rusty', 'Vera', 'Doc', 'Lulu', 'Tex', 'Mabel', 'Ace', 'Junior', 'Dolly', 'Sal', 'Marge', 'Hank', 'Pearl', 'Duke', 'Ruby', 'Boone', 'Gus', 'Ivy', 'Nash', 'Opal'];

// tight: how picky preflop (higher = tighter). aggr: raise vs call tendency. bluff: bluff frequency.
export const STYLES = {
  rock: { label: 'Tight-passive', tight: 1.35, aggr: 0.25, bluff: 0.02 },
  tag: { label: 'Tight-aggressive', tight: 1.2, aggr: 0.7, bluff: 0.08 },
  lag: { label: 'Loose-aggressive', tight: 0.85, aggr: 0.8, bluff: 0.16 },
  station: { label: 'Calling station', tight: 0.75, aggr: 0.15, bluff: 0.03 },
  solid: { label: 'Solid regular', tight: 1.05, aggr: 0.55, bluff: 0.07 },
};

export function pickStyle(mode) {
  if (mode && mode !== 'mixed' && STYLES[mode]) return mode;
  const keys = Object.keys(STYLES);
  return keys[randInt(keys.length)];
}

const key = (c) => c.r + c.s;

// ctx: { variant, hole, board, upcards: [[..]] per opponent (stud), opponents, hiLo, iters, drawPhase }
export function equity(ctx) {
  const { variant, hole, board = [], opponents, hiLo } = ctx;
  if (opponents <= 0) return 1;
  const known = new Set([...hole, ...board, ...(ctx.dead || []), ...(ctx.oppUp || []).flat()].map(key));
  const stub = newDeck().filter((c) => !known.has(key(c)));
  const iters = ctx.iters || (variant === 'omaha' ? 160 : 260);
  let share = 0;
  const n = stub.length;
  const deck = stub.slice();
  for (let it = 0; it < iters; it++) {
    // partial Fisher-Yates
    let top = 0;
    const take = () => { const j = top + Math.floor(random() * (n - top)); const t = deck[top]; deck[top] = deck[j]; deck[j] = t; return deck[top++]; };
    let myHi; let myLo = null;
    const oppHi = []; const oppLo = [];
    if (variant === 'holdem' || variant === 'omaha') {
      const b = board.slice();
      while (b.length < 5) b.push(take());
      const holeN = variant === 'omaha' ? 4 : 2;
      if (variant === 'omaha') {
        myHi = bestOmaha(hole, b).score;
        if (hiLo) myLo = bestOmahaLow(hole, b)?.score ?? null;
      } else myHi = bestHigh(hole.concat(b)).score;
      for (let k = 0; k < opponents; k++) {
        const oh = [];
        for (let i = 0; i < holeN; i++) oh.push(take());
        if (variant === 'omaha') {
          oppHi.push(bestOmaha(oh, b).score);
          if (hiLo) oppLo.push(bestOmahaLow(oh, b)?.score ?? null);
        } else oppHi.push(bestHigh(oh.concat(b)).score);
      }
    } else if (variant === 'stud') {
      const mine = hole.slice();
      while (mine.length < 7) mine.push(take());
      myHi = bestHigh(mine).score;
      if (hiLo) myLo = bestLow(mine)?.score ?? null;
      for (let k = 0; k < opponents; k++) {
        const oc = (ctx.oppUp?.[k] || []).slice();
        while (oc.length < 7) oc.push(take());
        oppHi.push(bestHigh(oc).score);
        if (hiLo) oppLo.push(bestLow(oc)?.score ?? null);
      }
    } else {
      // draw: compare made hands; before the draw give the hand a chance to improve by simulating a simple draw.
      const mine = ctx.drawPhase === 'pre' ? simulateDraw(hole, take) : hole;
      myHi = eval5(mine);
      for (let k = 0; k < opponents; k++) {
        let oh = [take(), take(), take(), take(), take()];
        if (ctx.drawPhase === 'pre' || (ctx.oppDrew && ctx.oppDrew[k] !== undefined)) {
          // Opponents also draw; a player who stood pat or drew one is likely strong.
          oh = simulateDraw(oh, take, ctx.oppDrew?.[k]);
        }
        oppHi.push(eval5(oh));
      }
    }
    // Scoring: share of pot won.
    const bestOppHi = Math.max(...oppHi);
    let hiShare = 0;
    if (myHi > bestOppHi) hiShare = 1;
    else if (myHi === bestOppHi) hiShare = 1 / (1 + oppHi.filter((x) => x === myHi).length);
    if (!hiLo) { share += hiShare; continue; }
    const lows = oppLo.filter((x) => x !== null);
    const bestOppLo = lows.length ? Math.min(...lows) : null;
    const anyLow = myLo !== null || bestOppLo !== null;
    if (!anyLow) { share += hiShare; continue; }
    let loShare = 0;
    if (myLo !== null && (bestOppLo === null || myLo < bestOppLo)) loShare = 1;
    else if (myLo !== null && myLo === bestOppLo) loShare = 1 / (1 + lows.filter((x) => x === myLo).length);
    share += hiShare * 0.5 + loShare * 0.5;
  }
  return share / iters;
}

// Choose which cards to keep in five-card draw. Returns indexes to discard.
export function drawDiscards(hand) {
  const counts = {};
  hand.forEach((c) => { counts[c.r] = (counts[c.r] || 0) + 1; });
  const score = eval5(hand);
  const cat = Math.floor(score / 15 ** 5);
  if (cat >= 4) return []; // straight or better: stand pat
  const idx = [0, 1, 2, 3, 4];
  if (cat === 3) return idx.filter((i) => counts[hand[i].r] !== 3);
  if (cat === 2) return idx.filter((i) => counts[hand[i].r] !== 2);
  if (cat === 1) return idx.filter((i) => counts[hand[i].r] !== 2);
  // four to a flush
  const bySuit = {};
  hand.forEach((c, i) => { (bySuit[c.s] ||= []).push(i); });
  for (const s in bySuit) if (bySuit[s].length === 4) return idx.filter((i) => !bySuit[s].includes(i));
  // open-ended four to a straight
  for (const four of combos(idx, 4)) {
    const rs = four.map((i) => hand[i].r).sort((a, b) => a - b);
    if (new Set(rs).size === 4 && rs[3] - rs[0] === 3 && rs[0] >= 2 && rs[3] <= 13) return idx.filter((i) => !four.includes(i));
  }
  // keep ace + kicker or two highest
  const sorted = idx.slice().sort((a, b) => hand[b].r - hand[a].r);
  const keep = hand[sorted[0]].r === 14 ? sorted.slice(0, 2) : sorted.slice(0, 2);
  return idx.filter((i) => !keep.includes(i));
}

function simulateDraw(hand, take, forcedCount) {
  let disc = drawDiscards(hand);
  if (forcedCount !== undefined) {
    // Respect how many cards the opponent actually drew by keeping their best cards.
    disc = forcedCount === 0 ? [] : disc.slice(0, forcedCount);
    while (disc.length < forcedCount) { const i = [0, 1, 2, 3, 4].find((x) => !disc.includes(x)); disc.push(i); }
  }
  const out = hand.slice();
  for (const i of disc) out[i] = take();
  return out;
}

// Decide an action. v: {equity, toCall, pot, minTo, maxTo, canRaise, bet (current table bet), myBet, stack, bb,
//   street ('pre'|'post'), opponents, structure, facingRaises}
export function decide(styleKey, v) {
  const st = STYLES[styleKey] || STYLES.solid;
  const r = random();
  const eq = v.equity;
  const fair = 1 / (v.opponents + 1);
  const potAfter = v.pot + v.toCall;
  const potOdds = v.toCall > 0 ? v.toCall / potAfter : 0;
  // Opponents who raise usually hold better than random hands: demand extra equity versus bigger bets.
  const pressure = v.toCall > 0 ? Math.min(0.25, (v.toCall / Math.max(v.pot, 1)) * 0.12 + v.facingRaises * 0.04) : 0;
  const strong = eq > Math.min(0.92, fair * (1.9 * st.tight));
  const good = eq > fair * (1.25 * st.tight);
  const sizeTo = (frac) => {
    const target = v.bet + Math.round((potAfter) * frac);
    return Math.max(v.minTo, Math.min(v.maxTo, target));
  };

  if (v.street === 'pre') {
    // Preflop: judge the hand against an average hand at this table, not against pot odds alone.
    const rel = eq / fair;
    const need = st.tight * (1 + 0.22 * v.facingRaises);
    const cheap = v.toCall <= v.stack * 0.12;
    if (v.toCall === 0) {
      if (v.canRaise && (rel > 1.7 * st.tight || (rel > 1.3 * st.tight && r < st.aggr * 0.5) || r < st.bluff * 0.4)) return { type: 'raise', to: preRaise(v) };
      return { type: 'check' };
    }
    if (v.canRaise && rel > 1.75 * need && r < 0.3 + st.aggr * 0.6) return { type: 'raise', to: preRaise(v) };
    if (rel > 1.05 * need && (cheap || rel > 1.6 * need)) return { type: 'call' };
    if (v.toCall <= v.bb * 0.5 && rel > 0.85 * st.tight) return { type: 'call' }; // complete the small blind
    if (v.canRaise && r < st.bluff * 0.3 && v.toCall <= v.bb * 3) return { type: 'raise', to: preRaise(v) };
    return { type: 'fold' };
  }

  if (v.toCall === 0) {
    if (v.canRaise) {
      if (strong && r < 0.55 + st.aggr * 0.4) return { type: 'raise', to: sizeTo(0.55 + r * 0.3) };
      if (good && r < st.aggr * 0.7) return { type: 'raise', to: sizeTo(0.45) };
      if (r < st.bluff * (v.opponents <= 2 ? 1.5 : 0.6)) return { type: 'raise', to: sizeTo(0.5) };
    }
    return { type: 'check' };
  }
  if (strong && v.canRaise && r < st.aggr * 0.75) return { type: 'raise', to: sizeTo(0.7 + r * 0.3) };
  const looseness = st.tight < 0.9 ? 0.05 : 0;
  if (eq + looseness >= potOdds + pressure) return { type: 'call' };
  if (v.canRaise && r < st.bluff * 0.35 && v.opponents <= 2) return { type: 'raise', to: sizeTo(0.8) };
  return { type: 'fold' };
}

function preRaise(v) {
  // Standard open 2.5-3x, or 3x the raise when facing one.
  const base = v.bet <= v.bb ? v.bb * (2.5 + random()) : v.bet * 3;
  return Math.max(v.minTo, Math.min(v.maxTo, Math.round(base)));
}

export { partialScore };
