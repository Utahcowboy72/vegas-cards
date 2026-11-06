# High Card Casino

Vegas-style card games that install like an app on Android, iPhone/iPad, Windows, Linux and Mac. It's a Progressive Web App (PWA), so you install it from the browser, with no app store needed, and it works offline once installed. Everything is played with play money.

## Games

| Game | What you can change |
| --- | --- |
| **Klondike Solitaire** | Draw 1 or 3, unlimited / 3 / 1 passes, no scoring / standard / Vegas / Vegas using your bankroll, left-handed layout, tap-to-move, auto-play safe cards, timer, hints, undo, auto-finish |
| **Blackjack** | Rule presets (Strip, Downtown, single deck 6:5, 8-deck, European), 1–8 decks, S17/H17, 3:2 or 6:5, dealer peek or no hole card, double rules, DAS, late surrender, split to 2–4 hands, resplit/hit split aces, table limits, 1–3 betting spots, cut-card depth, live house-edge readout, basic-strategy hints and coach, Hi-Lo count trainer |
| **Video Poker** | Jacks or Better, Bonus Poker, Double Bonus, Double Double Bonus, Deuces Wild with real pay tables (full-pay and short-pay), 25¢–$25 denominations, 1–5 coins, single / 3 / 5 / 10-play, exact optimal-hold hints and mistake coach |
| **Texas Hold'em, Omaha, Seven Card Stud, Five Card Draw** | Cash game or sit-and-go tournament against 1–6 computer opponents, no-limit / pot-limit / fixed-limit, Omaha and Stud Hi-Lo 8, stakes, buy-in depth, opponent style, blind speed, equity/pot-odds helper, hand history |

Shared settings cover felt colour, card back, animation speed and sound.

## Fairness

Every shuffle is a Fisher–Yates shuffle driven by the Web Crypto random number generator (`crypto.getRandomValues`) with rejection sampling, so every card order is equally likely. Nothing adjusts the odds based on your results.

* Blackjack deals from a real shoe with a cut card. It burns one card after each shuffle and reshuffles only after the round in which the cut card comes out.
* Video poker deals each hand from a freshly shuffled 52-card deck, the way certified machines do. Multi-play hands draw from separate copies of the same remaining deck.
* Poker burns a card before each street, works out side pots and uncalled bets correctly, and gives odd chips to the first winner left of the button.

## Install

* **iPhone / iPad:** open the site in Safari, tap Share, then tap **Add to Home Screen**.
* **Android:** open the site in Chrome, open the menu, then tap **Install app**.
* **Windows / Linux / Mac:** open the site in Chrome or Edge and click the install icon in the address bar.

## Run locally

There's no build step. Serve the folder with any static server:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Hosting

Turn on GitHub Pages under **Settings → Pages → Deploy from a branch → main / (root)**. When you change any file, bump `VERSION` in `sw.js` so installed copies pick up the update.
