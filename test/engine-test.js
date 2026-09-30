// Rules engine tests. Run from the rummy-500 folder with macOS's JavaScriptCore:
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc test/engine-test.js
load('engine.js');
const R = globalThis.R500;

let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) passed++;
  else { failed++; print('FAIL: ' + msg); }
}
function eq(got, want, msg) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  ok(a === b, `${msg}\n     got  ${a}\n     want ${b}`);
}
function seeded(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TRAD = { scoring: 'traditional', handSize: 7, jokers: false, target: 500 };
const SIMP = { ...TRAD, scoring: 'simplified' };
const ADV = { ...TRAD, scoring: 'advanced' };
const ranksOf = (m) => m.cards.map((c) => R.eff(c).rank);
const jokerAs = (m, id) => m.cards.find((c) => c.id === id).as;
function meld(cards, st = TRAD, choice = 0) {
  const o = R.meldOptions(cards, st).options[choice];
  return { id: 'm1', ...o, cards: o.cards.map((c) => ({ ...c, by: 0 })) };
}

// ---------- new melds ----------
let r = R.meldOptions(['4C', '4D', '4S'], TRAD);
eq([r.options.length, r.options[0].type], [1, 'set'], 'set of three 4s');
ok(R.meldOptions(['4C', '4D', '5S'], TRAD).error, 'mixed ranks and suits rejected');
ok(R.meldOptions(['4C', '4D'], TRAD).error, 'two cards rejected');
ok(R.meldOptions(['4C', '4D', '4S', '4H', 'X1'], TRAD).error, 'five-card set rejected');
eq(R.meldOptions(['7H', '5H', '6H'], TRAD).options.map(ranksOf), [[5, 6, 7]], 'run put in order');
r = R.meldOptions(['AH', '2H', '3H'], TRAD);
eq([r.options.length, r.options[0].start], [1, 1], 'ace-low run');
r = R.meldOptions(['QH', 'KH', 'AH'], TRAD);
eq([r.options.length, r.options[0].start], [1, 12], 'ace-high run');
ok(R.meldOptions(['KH', 'AH', '2H'], TRAD).error, 'no K-A-2 in Traditional');
ok(R.meldOptions(['KH', 'AH', '2H'], SIMP).error, 'no K-A-2 in Simplified');
r = R.meldOptions(['KH', 'AH', '2H'], ADV);
eq([r.options.length, r.options[0].start, ranksOf(r.options[0])], [1, 13, [13, 1, 2]], 'K-A-2 wraps in Advanced');
ok(R.meldOptions(['5H', '7H', '9H'], TRAD).error, 'run with gaps rejected');
eq(R.meldOptions(['5H', 'X1', '7H'], TRAD).options.map((m) => jokerAs(m, 'X1')), [{ rank: 6, suit: 'H' }], 'Joker fills a gap');
r = R.meldOptions(['5H', '6H', 'X1'], TRAD);
eq(r.options.map((m) => jokerAs(m, 'X1').rank).sort(), [4, 7], 'Joker at either end gives two choices');
ok(R.meldOptions(['5H', 'X1', 'X2'], TRAD).error, 'two Jokers in a 3-card meld rejected');
r = R.meldOptions(['8S', '8H', 'X1'], TRAD);
eq(r.options.map((m) => jokerAs(m, 'X1').suit).sort(), ['C', 'D'], 'Joker in a set takes a missing suit');
eq(R.meldOptions(['8S', '8H', 'X1', 'X2'], TRAD).options.length, 1, 'two Jokers in a 4-card set');
const HEARTS = ['AH', '2H', '3H', '4H', '5H', '6H', '7H', '8H', '9H', '10H', 'JH', 'QH', 'KH'];
eq(R.meldOptions(HEARTS, TRAD).options.length, 2, 'whole suit, Traditional: Ace low or high');
eq(R.meldOptions(HEARTS, ADV).options.length, 3, 'whole suit, Advanced: Ace low, high or wrapped');

// ---------- lay-offs ----------
const set8 = meld(['8S', '8H', '8D']);
eq(R.layoffOptions(set8, ['8C'], TRAD).options.length, 1, 'fourth 8 lays off');
ok(R.layoffOptions(set8, ['9C'], TRAD).error, 'wrong rank rejected');
const set8j = meld(['8S', '8H', 'X1']); // Joker declared as 8♣
eq(jokerAs(set8j, 'X1').suit, 'C', 'first set option puts the Joker on clubs');
ok(R.layoffOptions(set8j, ['8C'], TRAD).error, 'suit already taken by the Joker');
eq(R.layoffOptions(set8j, ['8D'], TRAD).options.length, 1, 'remaining suit lays off');
const run = meld(['5H', '6H', '7H']);
eq(ranksOf(R.layoffOptions(run, ['8H'], TRAD).options[0]), [5, 6, 7, 8], 'extend the top end');
eq(ranksOf(R.layoffOptions(run, ['4H'], TRAD).options[0]), [4, 5, 6, 7], 'extend the bottom end');
eq(ranksOf(R.layoffOptions(run, ['4H', '8H'], TRAD).options[0]), [4, 5, 6, 7, 8], 'both ends at once');
eq(ranksOf(R.layoffOptions(run, ['9H', '8H'], TRAD).options[0]), [5, 6, 7, 8, 9], 'two cards on one end');
ok(R.layoffOptions(run, ['9H'], TRAD).error, 'can’t leave a gap');
ok(R.layoffOptions(run, ['8S'], TRAD).error, 'wrong suit rejected');
eq(R.layoffOptions(run, ['X1'], TRAD).options.length, 2, 'a lone Joker can go on either end');
ok(R.layoffOptions(meld(['QH', 'KH', 'AH']), ['2H'], TRAD).error, 'no wrapping lay-off in Traditional');
const wrapped = R.layoffOptions(meld(['QH', 'KH', 'AH'], ADV), ['2H'], ADV).options;
eq([wrapped.length, R.aceClass(wrapped[0], 2)], [1, 'wrap'], 'wrapping lay-off in Advanced');
const kFront = R.layoffOptions(meld(['AH', '2H', '3H'], ADV), ['KH'], ADV).options[0];
eq([kFront.start, ranksOf(kFront), R.aceClass(kFront, 1)], [13, [13, 1, 2, 3], 'wrap'], 'K in front of A-2-3 in Advanced');
const twoToKing = meld(HEARTS.slice(1));
eq(R.layoffOptions(twoToKing, ['AH'], TRAD).options.map((m) => R.aceClass(m, m.cards.findIndex((c) => c.id === 'AH'))).sort(),
  ['high', 'low'], 'Ace on 2–K can go low or high');
eq(R.layoffOptions(meld(['5H', 'X1', '7H']), ['X2'], TRAD).options.length, 2, 'second Joker on a 4-card run is allowed');
ok(R.layoffOptions(meld(['5H', 'X1', '7H']), ['X2', '8H'], TRAD).options.length > 0, 'Joker plus a natural card');

// ---------- scoring ----------
const pts = (m, st) => m.cards.map((c, i) => R.tablePoints(m, i, st));
eq(pts(meld(['AH', '2H', '3H']), TRAD), [1, 2, 3], 'Traditional: Ace low is 1');
eq(pts(meld(['QH', 'KH', 'AH']), TRAD), [10, 10, 15], 'Traditional: Ace high is 15');
eq(pts(meld(['AH', 'AS', 'AD']), TRAD), [15, 15, 15], 'Aces in a set are 15');
eq(pts(meld(['AH', '2H', '3H'], SIMP), SIMP), [5, 5, 5], 'Simplified: 2–9 and Ace low are 5');
eq(pts(meld(['QH', 'KH', 'AH'], SIMP), SIMP), [10, 10, 15], 'Simplified: Ace high is 15');
eq(pts(meld(['KH', 'AH', '2H'], ADV), ADV), [10, 5, 2], 'Advanced: Ace in K-A-2 is 5');
eq(pts(meld(['QH', 'KH', 'AH'], ADV), ADV), [10, 10, 10], 'Advanced: Ace high is 10');
eq(pts(meld(['AH', '2H', '3H'], ADV), ADV), [1, 2, 3], 'Advanced: Ace low is 1');
eq(pts(meld(['5H', 'X1', '7H']), TRAD), [5, 15, 7], 'a Joker on the table is 15');
eq(['AS', 'X1', '7C', 'KD'].map((id) => R.handPoints(id, TRAD)), [15, 15, 7, 10], 'cards left in hand, Traditional');
eq(['AS', '7C'].map((id) => R.handPoints(id, SIMP)), [15, 5], 'cards left in hand, Simplified');

// ---------- turns ----------
const rng = seeded(7);
const act = (g, seat, a) => R.apply(g, seat, a, rng);
function game(st = TRAD) {
  const g = R.newGame(st, ['Sol', 'Alex']);
  R.dealHand(g, seeded(1));
  return g;
}
function setup(g, { hands, discard, stock, turn = 0 }) {
  Object.assign(g, { hands, discard, stock, melds: [], turn, step: 'draw', phase: 'play' });
  g.ti = { drew: null, took: [], mustPlay: null, topOnly: null, undo: [] };
}

let g = game();
eq([g.hands[0].length, g.hands[1].length, g.discard.length, g.stock.length], [7, 7, 1, 37], 'deal 7 each and turn one up');
g = game({ ...TRAD, handSize: 13, jokers: true });
eq([g.hands[0].length, g.hands[1].length, g.stock.length], [13, 13, 54 - 27], 'deal 13 with Jokers');

// Rule sheet 2's example: take the 4 and everything above it, meld 4-4-4, discard.
g = game();
setup(g, { hands: [['2H', '4S', '5D', '8C', 'JC', 'KS', 'KD'], ['3C', '3D', '9S', '10S', 'JD', 'QD', '6C']], discard: ['6S', '4C', '7H', '4D'], stock: ['9C', '2C', '5S'] });
eq(act(g, 1, { type: 'draw-stock' }), 'It’s not your turn.', 'can’t play out of turn');
ok(!act(g, 0, { type: 'draw-discard', index: 1 }), 'take the 4♣ and the cards above it');
eq([g.discard, g.ti.mustPlay, g.hands[0].length], [['6S'], '4C', 10], 'only the 6♠ is left and the 4♣ must be played');
ok(act(g, 0, { type: 'discard', card: '2H' }), 'can’t discard before playing the 4♣');
ok(!act(g, 0, { type: 'meld', cards: ['4C', '4D', '4S'] }), 'meld the 4s');
ok(!act(g, 0, { type: 'discard', card: '2H' }), 'then discard');
eq([g.turn, g.step, g.discard], [1, 'draw', ['6S', '2H']], 'turn passes');

g = game();
setup(g, { hands: [['2H', '4S'], ['3C', '9S']], discard: ['6S', '4C', '7H', '4D'], stock: ['9C'] });
act(g, 0, { type: 'draw-discard', index: 1 });
ok(!act(g, 0, { type: 'undo' }), 'undo a discard-pile pickup');
eq([g.discard, g.hands[0], g.step], [['6S', '4C', '7H', '4D'], ['2H', '4S'], 'draw'], 'cards go back where they were');

g = game();
setup(g, { hands: [['2H', '9S', 'KD'], ['3C', '9C', '5D']], discard: ['6S', 'QC'], stock: ['9D'] });
act(g, 0, { type: 'draw-discard', index: 1 });
ok(act(g, 0, { type: 'discard', card: 'QC' }), 'can’t throw the top discard straight back');
ok(!act(g, 0, { type: 'discard', card: '2H' }), 'can discard a different card');

g = game();
setup(g, { hands: [['5H', '6H', 'X1'], ['3C', '9C', '5D']], discard: ['2S'], stock: ['9D'] });
act(g, 0, { type: 'draw-stock' });
eq(act(g, 0, { type: 'meld', cards: ['5H', '6H', 'X1'] }), 'Choose how to play the Joker.', 'ambiguous Joker needs a choice');
ok(!act(g, 0, { type: 'meld', cards: ['5H', '6H', 'X1'], choice: 1 }), 'meld with a choice');
eq(jokerAs(g.melds[0], 'X1').rank, 7, 'Joker declared as chosen');

// You go out only by discarding, so you must keep a card.
g = game();
setup(g, { hands: [['5H', '6H'], ['3C', '9S', '5D']], discard: ['2S'], stock: ['7H'] });
act(g, 0, { type: 'draw-stock' });
ok(act(g, 0, { type: 'meld', cards: ['5H', '6H', '7H'] }), 'can’t meld your whole hand');
g = game();
setup(g, { hands: [['5H', '6H', '7H'], ['3C', '9S', '5D']], discard: ['2S', 'QC'], stock: ['7C'] });
act(g, 0, { type: 'draw-discard', index: 1 });
ok(act(g, 0, { type: 'meld', cards: ['5H', '6H', '7H'] }), 'can’t keep only the top discard you just took');
g = game();
setup(g, { hands: [['5H', '6H', '9C'], ['3C', '9S', '5D']], discard: ['2S'], stock: ['7H'] });
act(g, 0, { type: 'draw-stock' });
ok(!act(g, 0, { type: 'meld', cards: ['5H', '6H', '7H'] }), 'meld keeping one card');
ok(!act(g, 0, { type: 'discard', card: '9C' }), 'go out with the last discard');
eq([g.phase, g.history[0].wentOut, g.history[0].table, g.history[0].inHand, g.totals], ['handOver', 0, [18, 0], [0, 17], [18, -17]], 'hand scored');

// Laying off on the other player's meld scores for whoever lays off.
g = game();
setup(g, { hands: [['5H', '6H', '7H', 'KC'], ['8H', '2C', '3D']], discard: ['2S'], stock: ['9D', 'QS'] });
act(g, 0, { type: 'draw-stock' });
act(g, 0, { type: 'meld', cards: ['5H', '6H', '7H'] });
act(g, 0, { type: 'discard', card: 'KC' });
act(g, 1, { type: 'draw-stock' });
ok(!act(g, 1, { type: 'layoff', meld: 'm1', cards: ['8H'] }), 'lay off on the other player’s run');
eq(R.pointsOnTable(g.melds, TRAD), [18, 8], 'laid-off card scores for whoever played it');

// Empty draw pile: reshuffle the discards; with nothing to reshuffle, the hand ends.
g = game();
setup(g, { hands: [['5H', '9C'], ['3C', '9S']], discard: ['2S', '3S', '4D', 'KC'], stock: [] });
ok(!act(g, 0, { type: 'draw-stock' }), 'drawing from an empty pile reshuffles');
eq([g.discard, g.stock.length, g.hands[0].length], [['KC'], 2, 3], 'all discards but the top became the draw pile');
g = game();
setup(g, { hands: [['5H', '9C'], ['3C', '9S']], discard: [], stock: ['4D'], turn: 1 });
act(g, 1, { type: 'draw-stock' });
act(g, 1, { type: 'discard', card: '9S' });
eq([g.phase, g.history[0].wentOut], ['handOver', null], 'nothing left to draw ends the hand');

// Winning, ties and the next hand.
function goOut(g) {
  setup(g, { hands: [['5H', '6H', '9C'], ['3C', '9S', '5D']], discard: ['2S'], stock: ['7H'] });
  act(g, 0, { type: 'draw-stock' });
  act(g, 0, { type: 'meld', cards: ['5H', '6H', '7H'] });
  act(g, 0, { type: 'discard', card: '9C' });
}
g = game();
g.totals = [480, 300];
goOut(g);
eq([g.phase, g.winner, g.totals], ['handOver', null, [498, 283]], 'not at 500 yet');
const starter = g.starter;
ok(!act(g, 0, { type: 'ready' }) && g.phase === 'handOver', 'waits for both players');
ok(!act(g, 1, { type: 'ready' }), 'both ready');
eq([g.phase, g.handNo, g.starter], ['play', 2, 1 - starter], 'next hand dealt, other player starts');
g = game();
g.totals = [490, 300];
goOut(g);
eq([g.phase, g.winner], ['gameOver', 0], 'reaching 500 wins');
act(g, 0, { type: 'ready' });
act(g, 1, { type: 'ready' });
eq([g.phase, g.gameNo, g.handNo, g.totals, g.history.length], ['play', 2, 1, [0, 0], 0], 'play again starts a fresh game');
g = game();
g.totals = [482, 517];
goOut(g);
eq([g.phase, g.winner, g.totals], ['handOver', null, [500, 500]], 'a tie means another hand');

// Attacks: whoever scores more in a hand gets one of each for the next hand.
g = game();
goOut(g); // Sol +18, Alex −17
eq(g.history[0].won, 0, 'higher hand score wins the hand');
act(g, 0, { type: 'ready' });
act(g, 1, { type: 'ready' });
eq([g.attacks[0], g.attacks[1], g.wild], [{ smash: 1, spiders: 1, bloom: 1, tornado: 1, catstorm: 1, gray: 1 }, {}, [2, 1]], 'the winner gets one of each attack; everyone has a wild one, plus one for the meld');
g.wild = [1, 1]; // keep the counting below simple
ok(!act(g, 1, { type: 'attack', kind: 'spiders' }) && g.wild[1] === 0, 'the loser can still spend their wild attack');
eq(act(g, 1, { type: 'attack', kind: 'spiders' }), 'You don’t have that attack. Win a hand to earn attacks for the next one.', 'but only once');
ok(!act(g, 0, { type: 'attack', kind: 'spiders' }), 'use an attack, even on the other player’s turn or before drawing');
eq([g.attacks[0].spiders, g.wild[0], g.lastAttack], [0, 1, { n: 2, by: 0, kind: 'spiders' }], 'earned attacks are spent before the wild one');
ok(!act(g, 0, { type: 'attack', kind: 'spiders' }) && g.wild[0] === 0, 'a used-up kind falls back on the wild attack');
ok(act(g, 0, { type: 'attack', kind: 'spiders' }), 'then that kind is gone');
ok(!act(g, 0, { type: 'attack', kind: 'smash' }) && g.lastAttack.n === 4, 'a different earned attack still works');
ok(act(g, 0, { type: 'attack', kind: 'nuke' }), 'unknown attacks rejected');
eq(R.viewFor(g, 1).lastAttack, { n: 4, by: 0, kind: 'smash' }, 'the other player sees the attack in their view');
goOut(g);
ok(act(g, 0, { type: 'attack', kind: 'bloom' }), 'no attacks between hands');
g.history[g.history.length - 1].won = null;
act(g, 0, { type: 'ready' });
act(g, 1, { type: 'ready' });
eq(g.attacks, [{}, {}], 'a tied hand earns nobody attacks, and unused ones expire');
delete g.wild;
eq(R.viewFor(g, 0).wild, [1, 1], 'games saved before wild attacks get one each');
ok(!act(g, 0, { type: 'attack', kind: 'bloom' }) && g.wild[0] === 0, 'and can spend it');

// The move list starts fresh with each deal.
g = game();
goOut(g);
ok(g.log.some((e) => e.text.includes('went out')), 'the finished hand’s moves are listed until the next deal');
act(g, 0, { type: 'ready' });
act(g, 1, { type: 'ready' });
ok(g.log.length <= 2 && g.log[0].text.startsWith('Hand 2:'), 'a new deal clears the previous hand’s moves');

// Every meld or lay-off earns a wild attack; Undo takes it back.
g = game();
setup(g, { hands: [['5H', '6H', '7H', '8H', '9C', 'KD'], ['3C', '9S', '5D']], discard: ['2S'], stock: ['QC'] });
act(g, 0, { type: 'draw-stock' });
ok(!act(g, 0, { type: 'meld', cards: ['5H', '6H', '7H'] }) && g.wild[0] === 2, 'a meld earns a wild attack');
ok(!act(g, 0, { type: 'layoff', meld: 'm1', cards: ['8H'] }) && g.wild[0] === 3, 'so does a lay-off');
ok(!act(g, 0, { type: 'undo' }) && g.wild[0] === 2, 'undoing the lay-off takes its attack back');
ok(!act(g, 0, { type: 'attack', kind: 'spiders' }) && g.wild[0] === 1, 'spend one');
ok(!act(g, 0, { type: 'undo' }) && g.wild[0] === 0, 'undoing the meld still takes back the attack it earned');
eq(R.viewFor(g, 1).wild, [0, 1], 'both players can see the counts');

// Trading one card each.
g = game();
setup(g, { hands: [['5H', '6H', '9C', 'KD'], ['3C', '9S', '5D', '7H']], discard: ['2S'], stock: ['8D', 'QC'] });
eq(act(g, 1, { type: 'trade-offer', card: '3C' }), 'It’s not your turn.', 'only offer on your own turn');
ok(!act(g, 0, { type: 'trade-offer', card: 'KD' }), 'offer the K♦');
eq([g.trade, R.viewFor(g, 1).trade], [{ from: 0, card: 'KD' }, { from: 0, card: 'KD' }], 'the other player sees the offer');
ok(act(g, 0, { type: 'trade-offer', card: '9C' }), 'one offer at a time');
ok(act(g, 0, { type: 'trade-accept', card: '5H' }), 'you can’t accept your own offer');
ok(act(g, 1, { type: 'trade-accept', card: 'KS' }), 'you can only give a card you hold');
ok(!act(g, 1, { type: 'trade-accept', card: '7H' }), 'accept, giving the 7♥');
eq([g.hands[0], g.hands[1], g.trade], [['5H', '6H', '9C', '7H'], ['3C', '9S', '5D', 'KD'], null], 'the cards swapped hands');
ok(!act(g, 0, { type: 'draw-stock' }) && !act(g, 0, { type: 'meld', cards: ['5H', '6H', '7H'] }), 'the traded card is yours to play');
ok(!act(g, 0, { type: 'trade-offer', card: '9C' }) && !act(g, 1, { type: 'trade-decline' }) && g.trade === null, 'a declined offer goes away');
ok(!act(g, 0, { type: 'trade-offer', card: '9C' }) && !act(g, 0, { type: 'trade-cancel' }) && g.trade === null, 'and so does a cancelled one');
ok(!act(g, 0, { type: 'trade-offer', card: '9C' }) && !act(g, 0, { type: 'discard', card: '9C' }) && g.trade === null, 'an offer lapses when the card leaves your hand');
g = game();
setup(g, { hands: [['2H', '4S', 'KD'], ['3C', '9S']], discard: ['6S', '4C', '7H', '4D'], stock: ['9C'] });
act(g, 0, { type: 'draw-discard', index: 1 });
ok(act(g, 0, { type: 'trade-offer', card: '4C' }), 'can’t trade away a card you must play');
ok(!act(g, 0, { type: 'trade-offer', card: 'KD' }) && !act(g, 1, { type: 'trade-accept', card: '9S' }) && !g.ti.canUndo && g.ti.undo.length === 0, 'a trade clears Undo');

// Views keep each hand private.
g = game();
setup(g, { hands: [['5H', '6H', '9C'], ['3C', '9S', '5D']], discard: ['2S'], stock: ['7H', '8D'] });
act(g, 0, { type: 'draw-stock' });
const v1 = R.viewFor(g, 1);
ok(!('hands' in v1) && !('stock' in v1), 'view has no hands or draw pile');
eq([v1.hand, v1.counts, v1.ti.took], [['3C', '9S', '5D'], [4, 3], []], 'the other player sees only a card count, not the drawn card');
eq(R.viewFor(g, 0).ti.took, ['8D'], 'the drawer sees their new card');

print(`${passed} passed, ${failed} failed`);
if (failed) throw new Error('engine tests failed');
