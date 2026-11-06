// Card primitives, cryptographically fair shuffling, and card rendering.

export const SUITS = ['S', 'H', 'D', 'C'];
export const SUIT_CHAR = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const RANK_CHAR = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
export const isRed = (s) => s === 'H' || s === 'D';

export function makeCard(r, s) {
  return { r, s, id: RANK_CHAR[r] + s };
}

export function newDeck() {
  const d = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push(makeCard(r, s));
  return d;
}

// Unbiased random integer in [0, n) using the Web Crypto API with rejection sampling.
const buf = new Uint32Array(64);
let bufPos = buf.length;
function rand32() {
  if (bufPos >= buf.length) {
    crypto.getRandomValues(buf);
    bufPos = 0;
  }
  return buf[bufPos++];
}
export function randInt(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  let x;
  do { x = rand32(); } while (x >= limit);
  return x % n;
}
export function random() {
  return rand32() / 0x100000000;
}

// Fisher-Yates shuffle, every ordering equally likely.
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function shuffledDeck(decks = 1) {
  let d = [];
  for (let i = 0; i < decks; i++) d = d.concat(newDeck());
  return shuffle(d);
}

// ---------- Rendering ----------
// Pip layouts for number cards: [x%, y%, flipped]
const PIPS = {
  2: [[50, 18], [50, 82, 1]],
  3: [[50, 18], [50, 50], [50, 82, 1]],
  4: [[30, 18], [70, 18], [30, 82, 1], [70, 82, 1]],
  5: [[30, 18], [70, 18], [50, 50], [30, 82, 1], [70, 82, 1]],
  6: [[30, 18], [70, 18], [30, 50], [70, 50], [30, 82, 1], [70, 82, 1]],
  7: [[30, 18], [70, 18], [50, 34], [30, 50], [70, 50], [30, 82, 1], [70, 82, 1]],
  8: [[30, 18], [70, 18], [50, 34], [30, 50], [70, 50], [50, 66, 1], [30, 82, 1], [70, 82, 1]],
  9: [[30, 16], [70, 16], [30, 39], [70, 39], [50, 50], [30, 61, 1], [70, 61, 1], [30, 84, 1], [70, 84, 1]],
  10: [[30, 16], [70, 16], [50, 28], [30, 39], [70, 39], [30, 61, 1], [70, 61, 1], [50, 72, 1], [30, 84, 1], [70, 84, 1]],
};

const FACE_LETTER = { 11: 'J', 12: 'Q', 13: 'K' };

function faceArt(card) {
  // Original stylised court card: framed panel with a crown/emblem motif and big letter.
  const red = isRed(card.s);
  const main = red ? 'var(--card-red)' : 'var(--card-black)';
  const accent = red ? '#c9a227' : '#2f5fa8';
  const crown = card.r === 13
    ? '<path d="M28 34 L34 22 L42 30 L50 18 L58 30 L66 22 L72 34 Z" />'
    : card.r === 12
      ? '<path d="M30 34 Q40 18 50 28 Q60 18 70 34 Z" /><circle cx="50" cy="20" r="3"/>'
      : '<path d="M36 34 L50 20 L64 34 Z" />';
  return `<svg class="face-art" viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden="true">
    <rect x="14" y="14" width="72" height="112" rx="6" fill="none" stroke="${accent}" stroke-width="2"/>
    <rect x="18" y="18" width="64" height="104" rx="4" fill="${red ? 'rgba(200,40,40,.06)' : 'rgba(30,60,140,.06)'}" stroke="${main}" stroke-width="1"/>
    <g fill="${accent}" stroke="${main}" stroke-width="1.2">${crown}</g>
    <g transform="rotate(180 50 70)" fill="${accent}" stroke="${main}" stroke-width="1.2">${crown}</g>
    <text x="50" y="84" text-anchor="middle" font-size="44" font-family="Georgia, 'Times New Roman', serif" font-weight="700" fill="${main}">${FACE_LETTER[card.r]}</text>
    <text x="50" y="104" text-anchor="middle" font-size="16" fill="${main}">${SUIT_CHAR[card.s]}</text>
  </svg>`;
}

export function cardInner(card) {
  const rc = RANK_CHAR[card.r];
  const sc = SUIT_CHAR[card.s];
  let center;
  if (card.r === 14) {
    center = `<div class="pip ace" style="left:50%;top:50%">${sc}</div>`;
  } else if (card.r >= 11) {
    center = faceArt(card);
  } else {
    center = PIPS[card.r].map(([x, y, f]) => `<div class="pip${f ? ' flip' : ''}" style="left:${x}%;top:${y}%">${sc}</div>`).join('');
  }
  return `<div class="corner tl"><span class="cr">${rc}</span><span class="cs">${sc}</span></div>
    <div class="center">${center}</div>
    <div class="corner br"><span class="cr">${rc}</span><span class="cs">${sc}</span></div>
    <div class="big-suit">${sc}</div>`;
}

export function cardEl(card, faceUp = true, extraClass = '') {
  const el = document.createElement('div');
  el.className = 'card ' + extraClass;
  setCardFace(el, card, faceUp);
  return el;
}

export function setCardFace(el, card, faceUp) {
  el.classList.toggle('red', !!card && isRed(card.s));
  el.classList.toggle('back', !faceUp);
  el.classList.toggle('face', !!faceUp);
  el.dataset.id = card ? card.id : '';
  el.innerHTML = faceUp && card ? cardInner(card) : '<div class="back-pattern"></div>';
  el.setAttribute('aria-label', faceUp && card ? cardName(card) : 'face-down card');
}

const RANK_NAME = { 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
const SUIT_NAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
export function cardName(c) {
  return `${RANK_NAME[c.r] || c.r} of ${SUIT_NAME[c.s]}`;
}
