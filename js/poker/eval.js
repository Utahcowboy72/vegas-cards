// Poker hand evaluation: high hands, ace-to-five 8-or-better lows, Omaha rules.
// Cards are {r: 2..14, s: 'S'|'H'|'D'|'C'}.

export const CAT = { HIGH: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4, FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8 };
export const CAT_NAME = ['High card', 'One pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
const RN = { 2: 'Twos', 3: 'Threes', 4: 'Fours', 5: 'Fives', 6: 'Sixes', 7: 'Sevens', 8: 'Eights', 9: 'Nines', 10: 'Tens', 11: 'Jacks', 12: 'Queens', 13: 'Kings', 14: 'Aces' };
const R1 = { 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };

// Score a 5-card hand. Higher is better. Score = cat * 15^5 + kickers.
export function eval5(c) {
  const counts = new Array(15).fill(0);
  let flush = true;
  for (let i = 0; i < 5; i++) { counts[c[i].r]++; if (c[i].s !== c[0].s) flush = false; }
  // groups sorted by count desc then rank desc
  const groups = [];
  for (let r = 14; r >= 2; r--) if (counts[r]) groups.push([counts[r], r]);
  groups.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  let straightHigh = 0;
  if (groups.length === 5) {
    if (groups[0][1] - groups[4][1] === 4) straightHigh = groups[0][1];
    else if (groups[0][1] === 14 && groups[1][1] === 5) straightHigh = 5; // wheel
  }
  let cat;
  if (straightHigh && flush) cat = CAT.STRAIGHT_FLUSH;
  else if (groups[0][0] === 4) cat = CAT.QUADS;
  else if (groups[0][0] === 3 && groups[1][0] === 2) cat = CAT.FULL_HOUSE;
  else if (flush) cat = CAT.FLUSH;
  else if (straightHigh) cat = CAT.STRAIGHT;
  else if (groups[0][0] === 3) cat = CAT.TRIPS;
  else if (groups[0][0] === 2 && groups[1][0] === 2) cat = CAT.TWO_PAIR;
  else if (groups[0][0] === 2) cat = CAT.PAIR;
  else cat = CAT.HIGH;
  let score = cat;
  if (straightHigh) score = score * 15 ** 5 + straightHigh * 15 ** 4;
  else {
    const ranks = groups.map((g) => g[1]);
    for (let i = 0; i < 5; i++) score = score * 15 + (ranks[i] || 0);
  }
  return score;
}

export const catOf = (score) => Math.floor(score / 15 ** 5);

function* combos(arr, k, start = 0, acc = []) {
  if (acc.length === k) { yield acc.slice(); return; }
  for (let i = start; i <= arr.length - (k - acc.length); i++) {
    acc.push(arr[i]);
    yield* combos(arr, k, i + 1, acc);
    acc.pop();
  }
}
export { combos };

export function bestHigh(cards) {
  if (cards.length <= 5) return cards.length === 5 ? { score: eval5(cards), hand: cards } : { score: partialScore(cards), hand: cards };
  let best = -1; let hand = null;
  for (const c of combos(cards, 5)) {
    const s = eval5(c);
    if (s > best) { best = s; hand = c; }
  }
  return { score: best, hand };
}

// For fewer than 5 cards (e.g. early stud streets): pairs/trips/quads + high cards.
export function partialScore(cards) {
  const counts = {};
  cards.forEach((c) => { counts[c.r] = (counts[c.r] || 0) + 1; });
  const groups = Object.entries(counts).map(([r, n]) => [n, Number(r)]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  let cat = CAT.HIGH;
  if (groups[0][0] === 4) cat = CAT.QUADS;
  else if (groups[0][0] === 3) cat = CAT.TRIPS;
  else if (groups[0][0] === 2 && groups[1] && groups[1][0] === 2) cat = CAT.TWO_PAIR;
  else if (groups[0][0] === 2) cat = CAT.PAIR;
  let score = cat;
  const ranks = groups.map((g) => g[1]);
  for (let i = 0; i < 5; i++) score = score * 15 + (ranks[i] || 0);
  return score;
}

export function bestOmaha(hole, board) {
  let best = -1; let hand = null;
  for (const h2 of combos(hole, 2)) for (const b3 of combos(board, 3)) {
    const c = h2.concat(b3);
    const s = eval5(c);
    if (s > best) { best = s; hand = c; }
  }
  return { score: best, hand };
}

// Ace-to-five low, 8 or better. Returns null if no qualifying low; lower value is better.
function low5(c) {
  const rs = c.map((x) => (x.r === 14 ? 1 : x.r));
  if (new Set(rs).size !== 5 || rs.some((r) => r > 8)) return null;
  rs.sort((a, b) => b - a);
  return rs.reduce((a, r) => a * 9 + r, 0);
}
export function bestLow(cards) {
  let best = null; let hand = null;
  for (const c of combos(cards, 5)) {
    const s = low5(c);
    if (s !== null && (best === null || s < best)) { best = s; hand = c; }
  }
  return best === null ? null : { score: best, hand };
}
export function bestOmahaLow(hole, board) {
  let best = null; let hand = null;
  for (const h2 of combos(hole, 2)) for (const b3 of combos(board, 3)) {
    const s = low5(h2.concat(b3));
    if (s !== null && (best === null || s < best)) { best = s; hand = h2.concat(b3); }
  }
  return best === null ? null : { score: best, hand };
}
export function lowName(hand) {
  const rs = hand.map((x) => (x.r === 14 ? 1 : x.r)).sort((a, b) => b - a);
  return rs.map((r) => (r === 1 ? 'A' : r)).join('-') + ' low';
}

export function handName(score) {
  const cat = catOf(score);
  let rem = score % 15 ** 5;
  const k = [];
  for (let i = 0; i < 5; i++) { k.unshift(rem % 15); rem = Math.floor(rem / 15); }
  switch (cat) {
    case CAT.STRAIGHT_FLUSH: return k[0] === 14 ? 'Royal flush' : `Straight flush, ${R1[k[0]]} high`;
    case CAT.QUADS: return `Four ${RN[k[0]]}`;
    case CAT.FULL_HOUSE: return `Full house, ${RN[k[0]]} full of ${RN[k[1]]}`;
    case CAT.FLUSH: return `Flush, ${R1[k[0]]} high`;
    case CAT.STRAIGHT: return `Straight, ${R1[k[0]]} high`;
    case CAT.TRIPS: return `Three ${RN[k[0]]}`;
    case CAT.TWO_PAIR: return `Two pair, ${RN[k[0]]} and ${RN[k[1]]}`;
    case CAT.PAIR: return `Pair of ${RN[k[0]]}`;
    default: return `${R1[k[0]]} high`;
  }
}
