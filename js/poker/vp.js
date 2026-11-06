// Video poker pay tables, hand classification and exact optimal-hold analysis.
// Pay values are per coin. Royal flush pays 800 per coin only with max (5) coins, 250 otherwise.

export const GAMES = {
  jacks: {
    name: 'Jacks or Better',
    rows: ['Royal Flush', 'Straight Flush', 'Four of a Kind', 'Full House', 'Flush', 'Straight', 'Three of a Kind', 'Two Pair', 'Jacks or Better'],
    tables: {
      '9/6': { pays: [800, 50, 25, 9, 6, 4, 3, 2, 1], ret: 99.54 },
      '8/5': { pays: [800, 50, 25, 8, 5, 4, 3, 2, 1], ret: 97.30 },
      '7/5': { pays: [800, 50, 25, 7, 5, 4, 3, 2, 1], ret: 96.15 },
      '6/5': { pays: [800, 50, 25, 6, 5, 4, 3, 2, 1], ret: 95.00 },
    },
    def: '9/6',
  },
  bonus: {
    name: 'Bonus Poker',
    rows: ['Royal Flush', 'Straight Flush', 'Four Aces', 'Four 2s, 3s, 4s', 'Four 5s thru Kings', 'Full House', 'Flush', 'Straight', 'Three of a Kind', 'Two Pair', 'Jacks or Better'],
    tables: {
      '8/5': { pays: [800, 50, 80, 40, 25, 8, 5, 4, 3, 2, 1], ret: 99.17 },
      '7/5': { pays: [800, 50, 80, 40, 25, 7, 5, 4, 3, 2, 1], ret: 98.01 },
      '6/5': { pays: [800, 50, 80, 40, 25, 6, 5, 4, 3, 2, 1], ret: 96.87 },
    },
    def: '8/5',
  },
  double: {
    name: 'Double Bonus',
    rows: ['Royal Flush', 'Straight Flush', 'Four Aces', 'Four 2s, 3s, 4s', 'Four 5s thru Kings', 'Full House', 'Flush', 'Straight', 'Three of a Kind', 'Two Pair', 'Jacks or Better'],
    tables: {
      '10/7': { pays: [800, 50, 160, 80, 50, 10, 7, 5, 3, 1, 1], ret: 100.17 },
      '9/7': { pays: [800, 50, 160, 80, 50, 9, 7, 5, 3, 1, 1], ret: 99.11 },
      '9/6': { pays: [800, 50, 160, 80, 50, 9, 6, 5, 3, 1, 1], ret: 97.81 },
    },
    def: '10/7',
  },
  ddb: {
    name: 'Double Double Bonus',
    rows: ['Royal Flush', 'Straight Flush', 'Four Aces + 2, 3, 4', 'Four Aces', 'Four 2s-4s + A-4', 'Four 2s, 3s, 4s', 'Four 5s thru Kings', 'Full House', 'Flush', 'Straight', 'Three of a Kind', 'Two Pair', 'Jacks or Better'],
    tables: {
      '9/6': { pays: [800, 50, 400, 160, 160, 80, 50, 9, 6, 4, 3, 1, 1], ret: 98.98 },
      '9/5': { pays: [800, 50, 400, 160, 160, 80, 50, 9, 5, 4, 3, 1, 1], ret: 97.87 },
      '8/5': { pays: [800, 50, 400, 160, 160, 80, 50, 8, 5, 4, 3, 1, 1], ret: 96.79 },
    },
    def: '9/6',
  },
  deuces: {
    name: 'Deuces Wild',
    rows: ['Natural Royal Flush', 'Four Deuces', 'Wild Royal Flush', 'Five of a Kind', 'Straight Flush', 'Four of a Kind', 'Full House', 'Flush', 'Straight', 'Three of a Kind'],
    tables: {
      'Full Pay': { pays: [800, 200, 25, 15, 9, 5, 3, 2, 2, 1], ret: 100.76 },
      'Not So Ugly': { pays: [800, 200, 25, 16, 10, 4, 4, 3, 2, 1], ret: 99.73 },
      '25/15/9/4/4/3': { pays: [800, 200, 25, 15, 9, 4, 4, 3, 2, 1], ret: 98.91 },
    },
    def: 'Full Pay',
  },
};

// Cards as ints: rank 2..14, suit 0..3. code = rank*4 + suit.
const SUIT_IX = { S: 0, H: 1, D: 2, C: 3 };
export const toCode = (c) => c.r * 4 + SUIT_IX[c.s];

const cnt = new Int8Array(15);

// Returns row index into GAMES[game].rows, or -1 for no win.
export function classify(game, codes) {
  if (game === 'deuces') return classifyDeuces(codes);
  cnt.fill(0);
  let suit0 = codes[0] & 3; let flush = true; let mask = 0;
  for (let i = 0; i < 5; i++) {
    const r = codes[i] >> 2;
    cnt[r]++;
    mask |= 1 << r;
    if ((codes[i] & 3) !== suit0) flush = false;
  }
  let pairs = 0; let trips = 0; let quad = 0; let pairRank = 0; let distinct = 0;
  for (let r = 2; r <= 14; r++) {
    const n = cnt[r];
    if (!n) continue;
    distinct++;
    if (n === 2) { pairs++; pairRank = r; } else if (n === 3) trips = r; else if (n === 4) quad = r;
  }
  let straight = false; let royal = false;
  if (distinct === 5) {
    const low = Math.log2(mask & -mask) | 0;
    if (mask === (0x1f << low)) straight = true;
    if (mask === ((1 << 14) | 0b111100)) straight = true; // A2345
    royal = mask === (0x1f << 10);
  }
  const jb = pairs === 1 && pairRank >= 11;
  if (game === 'jacks') {
    if (straight && flush) return royal ? 0 : 1;
    if (quad) return 2;
    if (trips && pairs) return 3;
    if (flush) return 4;
    if (straight) return 5;
    if (trips) return 6;
    if (pairs === 2) return 7;
    return jb ? 8 : -1;
  }
  if (game === 'bonus' || game === 'double') {
    if (straight && flush) return royal ? 0 : 1;
    if (quad) return quad === 14 ? 2 : quad <= 4 ? 3 : 4;
    if (trips && pairs) return 5;
    if (flush) return 6;
    if (straight) return 7;
    if (trips) return 8;
    if (pairs === 2) return 9;
    return jb ? 10 : -1;
  }
  // ddb
  if (straight && flush) return royal ? 0 : 1;
  if (quad) {
    let kicker = 0;
    for (let r = 2; r <= 14; r++) if (cnt[r] === 1) kicker = r;
    if (quad === 14) return kicker >= 2 && kicker <= 4 ? 2 : 3;
    if (quad <= 4) return (kicker === 14 || (kicker >= 2 && kicker <= 4)) ? 4 : 5;
    return 6;
  }
  if (trips && pairs) return 7;
  if (flush) return 8;
  if (straight) return 9;
  if (trips) return 10;
  if (pairs === 2) return 11;
  return jb ? 12 : -1;
}

function classifyDeuces(codes) {
  cnt.fill(0);
  let w = 0; let flush = true; let suit = -1; let mask = 0; let maxN = 0; let distinct = 0;
  for (let i = 0; i < 5; i++) {
    const r = codes[i] >> 2;
    if (r === 2) { w++; continue; }
    const s = codes[i] & 3;
    if (suit < 0) suit = s; else if (s !== suit) flush = false;
    if (!cnt[r]) distinct++;
    cnt[r]++;
    if (cnt[r] > maxN) maxN = cnt[r];
    mask |= 1 << r;
  }
  const nat = 5 - w;
  if (w === 0) {
    // natural royal
    if (flush && mask === (0x1f << 10)) return 0;
  }
  if (w === 4) return 1;
  // straight possible with wilds: all naturals distinct and fit in a 5-wide window
  let straight = false;
  if (distinct === nat) {
    for (let lo = 1; lo <= 10 && !straight; lo++) {
      let win = 0;
      for (let r = lo; r < lo + 5; r++) win |= 1 << (r === 1 ? 14 : r);
      if ((mask & ~win) === 0) straight = true;
    }
  }
  const royalOk = distinct === nat && (mask & ~(0x1f << 10)) === 0;
  if (flush && royalOk) return 2;
  if (maxN + w >= 5) return 3;
  if (flush && straight) return 4;
  if (maxN + w >= 4) return 5;
  if (w === 0) {
    let three = false; let two = 0;
    for (let r = 3; r <= 14; r++) { if (cnt[r] === 3) three = true; if (cnt[r] === 2) two++; }
    if (three && two) return 6;
  } else if (w === 1) {
    let two = 0;
    for (let r = 3; r <= 14; r++) if (cnt[r] === 2) two++;
    if (two === 2) return 6;
  }
  if (flush) return 7;
  if (straight) return 8;
  if (maxN + w >= 3) return 9;
  return -1;
}

export function payFor(game, table, row, coins) {
  if (row < 0) return 0;
  const p = GAMES[game].tables[table].pays[row];
  if (row === 0 && coins < 5) return 250 * coins;
  return p * coins;
}

// Exact expected value (per coin, max coins) of every possible hold. Returns best mask and the list.
export function analyze(game, table, hand) {
  const pays = GAMES[game].tables[table].pays;
  const codes = hand.map(toCode);
  const used = new Set(codes);
  const rest = [];
  for (let r = 2; r <= 14; r++) for (let s = 0; s < 4; s++) { const c = r * 4 + s; if (!used.has(c)) rest.push(c); }
  const results = [];
  const buf = new Int32Array(5);
  const n = rest.length;
  for (let mask = 0; mask < 32; mask++) {
    let k = 0;
    for (let i = 0; i < 5; i++) if (mask & (1 << i)) buf[k++] = codes[i];
    const need = 5 - k;
    let total = 0; let count = 0;
    const rec = (start, depth) => {
      if (depth === need) {
        const row = classify(game, buf);
        if (row >= 0) total += pays[row];
        count++;
        return;
      }
      for (let i = start; i <= n - (need - depth); i++) { buf[k + depth] = rest[i]; rec(i + 1, depth + 1); }
    };
    rec(0, 0);
    results.push({ mask, ev: total / count });
  }
  results.sort((a, b) => b.ev - a.ev);
  return results;
}
