/*
 * Rummy 500 rules engine: pure functions over a plain-JSON game state.
 *
 * The host's browser runs the authoritative game with it, and both players use
 * it to check melds before sending them. It never touches the DOM, so the tests
 * in test/engine-test.js run it under JavaScriptCore (`jsc`).
 *
 * Cards are strings: rank + suit ("AS", "10H", "QD"), Jokers are "X1"/"X2".
 * A meld is { id, type: 'set'|'run', rank (set) | suit + start (run), cards },
 * where cards are { id, by: seat, as?: {rank, suit} } (`as` = a Joker's
 * declared value). Run position i has value start + i; values 1 and 14 are
 * both the Ace (low and high), and in Advanced scoring values past 14 wrap.
 *
 * House rules: you go out only by discarding your last card (so no play may
 * empty your hand), and an empty draw pile is refilled from the discards.
 */
(function (root) {
  'use strict';

  const SUITS = ['S', 'H', 'C', 'D']; // sort order, alternating colours
  const SUIT_SYM = { S: '♠', H: '♥', C: '♣', D: '♦' };
  const SUIT_NAME = { S: 'spades', H: 'hearts', C: 'clubs', D: 'diamonds' };
  const SUIT_ONE = { S: 'spade', H: 'heart', C: 'club', D: 'diamond' };
  const RANKS = [null, 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const RANK_PLURAL = [null, 'Aces', '2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s', '10s', 'Jacks', 'Queens', 'Kings'];
  const SCORING = ['simplified', 'traditional', 'advanced'];

  const isJoker = (id) => id.charAt(0) === 'X';
  const rankOf = (id) => RANKS.indexOf(id.slice(0, -1));
  const suitOf = (id) => id.slice(-1);
  const cardId = (rank, suit) => RANKS[rank] + suit;
  const mod13 = (v) => ((((v - 1) % 13) + 13) % 13) + 1; // run value -> rank 1..13
  const maxWild = (n) => Math.floor(n / 2);
  const wraps = (st) => st.scoring === 'advanced';
  const fail = (error) => ({ error, options: [] });
  const signed = (x) => (x > 0 ? '+' + x : x < 0 ? '−' + Math.abs(x) : '0');

  function range(a, b) {
    const out = [];
    for (let v = a; v <= b; v++) out.push(v);
    return out;
  }

  // What a table card counts as: its own rank and suit, or a Joker's declaration.
  const eff = (c) => (isJoker(c.id) ? c.as : { rank: rankOf(c.id), suit: suitOf(c.id) });
  const label = (id) => (isJoker(id) ? 'Joker' : RANKS[rankOf(id)] + SUIT_SYM[suitOf(id)]);
  const asLabel = (as) => RANKS[as.rank] + SUIT_SYM[as.suit];
  const entryLabel = (c) => (isJoker(c.id) && c.as ? `Joker (as ${asLabel(c.as)})` : label(c.id));

  function meldName(m) {
    if (m.type === 'set') return `set of ${RANK_PLURAL[m.rank]}`;
    const first = eff(m.cards[0]).rank;
    const last = eff(m.cards[m.cards.length - 1]).rank;
    return `${SUIT_SYM[m.suit]} run ${RANKS[first]}–${RANKS[last]}`;
  }

  function newDeck(withJokers) {
    const deck = [];
    for (const s of SUITS) for (let r = 1; r <= 13; r++) deck.push(cardId(r, s));
    if (withJokers) deck.push('X1', 'X2');
    return deck;
  }

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function combos(arr, k) {
    if (k === 0) return [[]];
    const out = [];
    arr.forEach((x, i) => {
      for (const rest of combos(arr.slice(i + 1), k - 1)) out.push([x, ...rest]);
    });
    return out;
  }

  function sortSet(cards) {
    return cards.sort((a, b) => SUITS.indexOf(eff(a).suit) - SUITS.indexOf(eff(b).suit));
  }

  // An Ace in a run is low (A-2-3), high (Q-K-A) or in a wrap (K-A-2).
  function aceClass(m, i) {
    if (m.start + i === 1) return 'low';
    return i === m.cards.length - 1 ? 'high' : 'wrap';
  }

  // Options that would score and play identically are shown once.
  function signature(m) {
    const ranks = m.cards.map((c) => eff(c).rank).sort((a, b) => a - b);
    const marks = m.cards.map((c, i) => {
      if (isJoker(c.id)) return c.id + '=' + c.as.rank + c.as.suit;
      if (m.type === 'run' && rankOf(c.id) === 1) return 'A:' + aceClass(m, i);
      return '';
    });
    return m.type + '|' + ranks.join(',') + '|' + marks.filter(Boolean).sort().join(',');
  }

  function uniq(options) {
    const seen = new Set();
    return options.filter((m) => {
      const s = signature(m);
      if (seen.has(s)) return false;
      seen.add(s);
      return true;
    });
  }

  // Place naturals at the run values matching their rank and Jokers in the gaps,
  // in order. Null unless every card lands and every value is covered.
  function fillRun(values, suit, nats, jokers) {
    const byRank = new Map(nats.map((id) => [rankOf(id), id]));
    const cards = [];
    let j = 0;
    for (const v of values) {
      const r = mod13(v);
      if (byRank.has(r)) {
        cards.push({ id: byRank.get(r) });
        byRank.delete(r);
      } else if (j < jokers.length) {
        cards.push({ id: jokers[j++], as: { rank: r, suit } });
      } else {
        return null;
      }
    }
    return byRank.size === 0 && j === jokers.length ? cards : null;
  }

  const tooWild = (n) => `No more than half the cards in a meld can be Jokers (at most ${maxWild(n)} of ${n}).`;

  // Every legal way to meld these cards as a new set or run.
  function meldOptions(ids, st) {
    const n = ids.length;
    if (n < 3) return fail('A meld needs at least 3 cards.');
    const jokers = ids.filter(isJoker);
    const nats = ids.filter((id) => !isJoker(id));
    if (jokers.length > maxWild(n)) return fail(tooWild(n));
    const ranks = nats.map(rankOf);
    const suits = nats.map(suitOf);

    if (ranks.every((r) => r === ranks[0])) {
      if (n > 4) return fail('A set can have at most 4 cards.');
      if (new Set(suits).size < suits.length) return fail('Every card in a set must be a different suit.');
      const missing = SUITS.filter((s) => !suits.includes(s));
      return {
        options: combos(missing, jokers.length).map((pick) => ({
          type: 'set',
          rank: ranks[0],
          cards: sortSet([
            ...nats.map((id) => ({ id })),
            ...jokers.map((id, i) => ({ id, as: { rank: ranks[0], suit: pick[i] } })),
          ]),
        })),
      };
    }

    if (suits.every((s) => s === suits[0])) {
      if (new Set(ranks).size < ranks.length) return fail('A run can’t have the same rank twice.');
      const suit = suits[0];
      const out = [];
      if (n <= 13) {
        const lastStart = wraps(st) ? 13 : 15 - n;
        for (let start = 1; start <= lastStart; start++) {
          const cards = fillRun(range(start, start + n - 1), suit, nats, jokers);
          if (cards) out.push({ type: 'run', suit, start, cards });
        }
      }
      if (out.length) return { options: uniq(out) };
      if (ranks.includes(1) && ranks.includes(13) && ranks.includes(2) && !wraps(st)) {
        return fail('Runs can’t wrap around K-A-2 unless you’re using Advanced scoring.');
      }
      return fail(jokers.length ? 'Those cards aren’t in sequence, even with the Joker filling a gap.' : 'Those cards aren’t in sequence.');
    }

    return fail('That isn’t a meld. A set is 3–4 cards of one rank; a run is 3 or more cards in sequence in one suit.');
  }

  // Every legal way to add these cards to an existing meld.
  function layoffOptions(m, ids, st) {
    if (!ids.length) return fail('Select the cards to lay off first.');
    const n0 = m.cards.length;
    const n = n0 + ids.length;
    const jokers = ids.filter(isJoker);
    const nats = ids.filter((id) => !isJoker(id));
    const wild = m.cards.filter((c) => isJoker(c.id)).length + jokers.length;
    if (wild > maxWild(n)) return fail(tooWild(n));
    const old = m.cards.map((c) => ({ ...c }));

    if (m.type === 'set') {
      if (n > 4) return fail('A set can’t have more than 4 cards.');
      const wrong = nats.find((id) => rankOf(id) !== m.rank);
      if (wrong) return fail(`The ${label(wrong)} doesn’t belong in a set of ${RANK_PLURAL[m.rank]}.`);
      const have = old.map((c) => eff(c).suit);
      const suits = nats.map(suitOf);
      const dup = suits.find((s, i) => have.includes(s) || suits.indexOf(s) !== i);
      if (dup) return fail(`That set already has a ${SUIT_ONE[dup]}.`);
      const missing = SUITS.filter((s) => !have.includes(s) && !suits.includes(s));
      return {
        options: combos(missing, jokers.length).map((pick) => ({
          ...m,
          cards: sortSet([
            ...old,
            ...nats.map((id) => ({ id })),
            ...jokers.map((id, i) => ({ id, as: { rank: m.rank, suit: pick[i] } })),
          ]),
        })),
      };
    }

    if (n > 13) return fail('A run can’t be longer than 13 cards.');
    const wrong = nats.find((id) => suitOf(id) !== m.suit);
    if (wrong) return fail(`The ${label(wrong)} isn’t a ${SUIT_ONE[m.suit]}, so it can’t go on this run.`);
    const k = ids.length;
    const end = m.start + n0 - 1;
    const out = [];
    for (let a = 0; a <= k; a++) { // a cards go before the run, the rest after it
      const lo = m.start - a;
      const hi = end + (k - a);
      if (!wraps(st) && (lo < 1 || hi > 14)) continue;
      const added = fillRun(range(lo, m.start - 1).concat(range(end + 1, hi)), m.suit, nats, jokers);
      if (!added) continue;
      out.push({ ...m, start: lo < 1 ? lo + 13 : lo, cards: [...added.slice(0, a), ...old, ...added.slice(a)] });
    }
    if (out.length) return { options: uniq(out) };
    return fail(`That doesn’t fit the ${meldName(m)}. Cards can only go on either end of a run.`);
  }

  // ---------- scoring ----------

  function tablePoints(m, i, st) {
    const id = m.cards[i].id;
    if (isJoker(id)) return 15;
    const r = rankOf(id);
    if (r === 1) {
      if (m.type === 'set') return 15;
      const cls = aceClass(m, i);
      if (st.scoring === 'simplified') return cls === 'low' ? 5 : 15;
      if (st.scoring === 'traditional') return cls === 'low' ? 1 : 15;
      return cls === 'low' ? 1 : cls === 'wrap' ? 5 : 10;
    }
    if (r >= 10) return 10;
    return st.scoring === 'simplified' ? 5 : r;
  }

  function handPoints(id, st) {
    if (isJoker(id) || rankOf(id) === 1) return 15;
    const r = rankOf(id);
    if (r >= 10) return 10;
    return st.scoring === 'simplified' ? 5 : r;
  }

  function pointsOnTable(melds, st) {
    const pts = [0, 0];
    for (const m of melds) m.cards.forEach((c, i) => { pts[c.by] += tablePoints(m, i, st); });
    return pts;
  }

  // ---------- game flow ----------

  const blankTurn = () => ({ drew: null, took: [], mustPlay: null, topOnly: null, undo: [] });

  function newGame(settings, names, gameNo) {
    return {
      settings: { ...settings },
      names: names.slice(0, 2),
      gameNo: gameNo || 1,
      handNo: 0,
      starter: null,
      phase: 'play', // 'play' | 'handOver' | 'gameOver'
      turn: 0,
      step: 'draw', // 'draw' | 'play'
      stock: [],
      discard: [], // index 0 is the bottom, the last card is the top
      hands: [[], []],
      melds: [],
      meldSeq: 0,
      ti: blankTurn(),
      history: [],
      totals: [0, 0],
      ready: [false, false],
      winner: null,
      log: [],
      logSeq: 0,
      seq: 0,
    };
  }

  function note(g, text) {
    g.log.push({ n: ++g.logSeq, text });
    if (g.log.length > 150) g.log.splice(0, g.log.length - 150);
  }

  function dealHand(g, rng) {
    g.handNo += 1;
    g.starter = g.starter == null ? (rng() < 0.5 ? 0 : 1) : 1 - g.starter;
    const deck = shuffle(newDeck(g.settings.jokers), rng);
    g.hands = [[], []];
    for (let i = 0; i < g.settings.handSize; i++) {
      g.hands[1 - g.starter].push(deck.pop());
      g.hands[g.starter].push(deck.pop());
    }
    g.discard = [deck.pop()];
    g.stock = deck;
    g.melds = [];
    g.meldSeq = 0;
    g.phase = 'play';
    g.ready = [false, false];
    note(g, `Hand ${g.handNo}: ${g.settings.handSize} cards each. ${g.names[g.starter]} goes first.`);
    beginTurn(g, g.starter);
  }

  function beginTurn(g, p) {
    g.turn = p;
    g.step = 'draw';
    g.ti = blankTurn();
    // With nothing to draw or reshuffle, players could only pass the top discard back and forth.
    if (!g.stock.length && g.discard.length < 2) {
      note(g, 'The draw pile is empty and there’s nothing left to reshuffle, so the hand is over.');
      endHand(g, null);
    }
  }

  function endHand(g, wentOut) {
    const st = g.settings;
    const table = pointsOnTable(g.melds, st);
    const inHand = g.hands.map((hand) => hand.reduce((s, id) => s + handPoints(id, st), 0));
    const score = [table[0] - inHand[0], table[1] - inHand[1]];
    g.totals = [g.totals[0] + score[0], g.totals[1] + score[1]];
    g.history.push({ hand: g.handNo, wentOut, table, inHand, score, totals: g.totals.slice(), left: g.hands.map((x) => x.slice()) });
    note(g, `Hand ${g.handNo} scores: ${g.names[0]} ${signed(score[0])}, ${g.names[1]} ${signed(score[1])}.`);
    g.phase = 'handOver';
    g.ready = [false, false];
    g.ti = blankTurn();
    const [a, b] = g.totals;
    if (Math.max(a, b) >= st.target) {
      if (a !== b) {
        g.winner = a > b ? 0 : 1;
        g.phase = 'gameOver';
        note(g, `${g.names[g.winner]} wins the game, ${Math.max(a, b)} to ${Math.min(a, b)}!`);
      } else {
        note(g, `You’re tied on ${a}, so you play another hand to settle it.`);
      }
    }
  }

  function turnCheck(g, seat, step) {
    if (g.phase !== 'play') return 'The hand is over.';
    if (g.turn !== seat) return 'It’s not your turn.';
    if (step === 'draw' && g.step !== 'draw') return 'You’ve already drawn this turn.';
    if (step === 'play' && g.step !== 'play') return 'Draw a card first, from the draw pile or the discard pile.';
    return null;
  }

  function ownCheck(hand, cards) {
    if (!Array.isArray(cards) || !cards.length) return 'Select the cards first.';
    if (cards.some((id) => typeof id !== 'string' || !hand.includes(id))) return 'Those cards aren’t all in your hand.';
    if (new Set(cards).size !== cards.length) return 'You selected the same card twice.';
    return null;
  }

  function pick(options, choice) {
    if (options.length === 1) return options[0];
    return Number.isInteger(choice) && options[choice] ? options[choice] : null;
  }

  function snapshot(g, seat) {
    return JSON.parse(JSON.stringify({
      hand: g.hands[seat], melds: g.melds, discard: g.discard, meldSeq: g.meldSeq, step: g.step,
      ti: { drew: g.ti.drew, took: g.ti.took, mustPlay: g.ti.mustPlay, topOnly: g.ti.topOnly },
    }));
  }

  const mustPlayMsg = (id) => `First meld or lay off the ${label(id)}: you took it from deeper in the discard pile, so it has to be played this turn.`;

  // You can only go out by discarding, so a meld or lay-off must leave a card you're allowed to discard.
  function keepCheck(g, rest) {
    if (!rest.length) return 'You have to keep one card to discard: you can only go out by discarding your last card.';
    if (rest.some((id) => id !== g.ti.topOnly && id !== g.ti.mustPlay)) return null;
    const id = rest[0];
    return id === g.ti.mustPlay
      ? `That would leave only the ${label(id)}, which you still have to play, and nothing to discard. Keep another card.`
      : `That would leave only the ${label(id)}, which you can’t discard this turn because you just took it from the top of the discard pile. Keep another card.`;
  }

  // Each action validates before it changes anything and returns an error message, or nothing on success.
  const ACTIONS = {
    'draw-stock'(g, seat, act, rng) {
      const e = turnCheck(g, seat, 'draw');
      if (e) return e;
      if (!g.stock.length) {
        if (g.discard.length < 2) return 'There’s nothing left in the draw pile.';
        const top = g.discard.pop();
        g.stock = shuffle(g.discard, rng);
        g.discard = [top];
        note(g, `The draw pile ran out, so ${g.stock.length} discards were shuffled into a new draw pile.`);
      }
      const card = g.stock.pop();
      g.hands[seat].push(card);
      g.step = 'play';
      g.ti.drew = 'stock';
      g.ti.took = [card];
      note(g, `${g.names[seat]} drew from the draw pile.`);
    },

    'draw-discard'(g, seat, act) {
      const e = turnCheck(g, seat, 'draw');
      if (e) return e;
      const i = act.index;
      if (!Number.isInteger(i) || i < 0 || i >= g.discard.length) return 'That card isn’t in the discard pile any more.';
      const snap = snapshot(g, seat);
      const taken = g.discard.splice(i);
      g.hands[seat].push(...taken);
      g.step = 'play';
      g.ti.drew = 'discard';
      g.ti.took = taken;
      g.ti.undo = [snap]; // the discard pile is public, so taking cards from it can be undone
      if (taken.length === 1) {
        g.ti.topOnly = taken[0];
        note(g, `${g.names[seat]} took the ${label(taken[0])} from the discard pile.`);
      } else {
        g.ti.mustPlay = taken[0];
        note(g, `${g.names[seat]} took ${taken.length} cards from the discard pile (${taken.map(label).join(' ')}) and must play the ${label(taken[0])}.`);
      }
    },

    meld(g, seat, act) {
      const e = turnCheck(g, seat, 'play') || ownCheck(g.hands[seat], act.cards);
      if (e) return e;
      const res = meldOptions(act.cards, g.settings);
      if (res.error) return res.error;
      const opt = pick(res.options, act.choice);
      if (!opt) return 'Choose how to play the Joker.';
      const rest = g.hands[seat].filter((id) => !act.cards.includes(id));
      const keep = keepCheck(g, rest);
      if (keep) return keep;
      g.ti.undo.push(snapshot(g, seat));
      const m = { id: 'm' + ++g.meldSeq, type: opt.type, cards: opt.cards.map((c) => ({ ...c, by: seat })) };
      if (opt.type === 'set') m.rank = opt.rank;
      else { m.suit = opt.suit; m.start = opt.start; }
      g.melds.push(m);
      g.hands[seat] = rest;
      note(g, `${g.names[seat]} melded ${m.cards.map(entryLabel).join(' ')}.`);
    },

    layoff(g, seat, act) {
      const e = turnCheck(g, seat, 'play') || ownCheck(g.hands[seat], act.cards);
      if (e) return e;
      const idx = g.melds.findIndex((m) => m.id === act.meld);
      if (idx < 0) return 'That meld isn’t on the table.';
      const before = g.melds[idx];
      const res = layoffOptions(before, act.cards, g.settings);
      if (res.error) return res.error;
      const opt = pick(res.options, act.choice);
      if (!opt) return 'Choose how to play the Joker.';
      const rest = g.hands[seat].filter((id) => !act.cards.includes(id));
      const keep = keepCheck(g, rest);
      if (keep) return keep;
      g.ti.undo.push(snapshot(g, seat));
      g.melds[idx] = { ...opt, cards: opt.cards.map((c) => (c.by == null ? { ...c, by: seat } : c)) };
      g.hands[seat] = rest;
      const added = g.melds[idx].cards.filter((c) => act.cards.includes(c.id));
      note(g, `${g.names[seat]} laid off ${added.map(entryLabel).join(' ')} on the ${meldName(before)}.`);
    },

    discard(g, seat, act) {
      const e = turnCheck(g, seat, 'play');
      if (e) return e;
      const hand = g.hands[seat];
      const card = act.card;
      if (typeof card !== 'string' || !hand.includes(card)) return 'That card isn’t in your hand.';
      if (g.ti.mustPlay && hand.includes(g.ti.mustPlay)) return mustPlayMsg(g.ti.mustPlay);
      if (card === g.ti.topOnly) return `You took the ${label(card)} from the top of the discard pile, so you have to discard a different card.`;
      hand.splice(hand.indexOf(card), 1);
      g.discard.push(card);
      note(g, `${g.names[seat]} discarded the ${label(card)}.`);
      if (!hand.length) {
        note(g, `${g.names[seat]} went out!`);
        endHand(g, seat);
        return;
      }
      beginTurn(g, 1 - seat);
    },

    undo(g, seat) {
      const e = turnCheck(g, seat, 'play');
      if (e) return e;
      const s = g.ti.undo.pop();
      if (!s) return 'There’s nothing to undo.';
      g.hands[seat] = s.hand;
      g.melds = s.melds;
      g.discard = s.discard;
      g.meldSeq = s.meldSeq;
      g.step = s.step;
      Object.assign(g.ti, s.ti);
      note(g, s.step === 'draw' ? `${g.names[seat]} put the cards back on the discard pile.` : `${g.names[seat]} took back a play.`);
    },

    // Both players confirm before the next hand (or a new game) is dealt.
    ready(g, seat, act, rng) {
      if (g.phase === 'play') return 'The hand is still being played.';
      g.ready[seat] = true;
      if (!(g.ready[0] && g.ready[1])) return;
      if (g.phase === 'gameOver') {
        Object.assign(g, { gameNo: g.gameNo + 1, handNo: 0, starter: null, history: [], totals: [0, 0], winner: null });
        note(g, 'New game!');
      }
      dealHand(g, rng);
    },
  };

  function apply(g, seat, act, rng) {
    const fn = act && Object.prototype.hasOwnProperty.call(ACTIONS, act.type) ? ACTIONS[act.type] : null;
    if (!fn) return 'Unknown move.';
    const err = fn(g, seat, act, rng);
    if (err) return err;
    g.seq += 1;
    return null;
  }

  // What one player may see: their own hand, but only the size of the other's.
  function viewFor(g, seat) {
    const mine = g.turn === seat;
    return {
      seat,
      phase: g.phase,
      settings: g.settings,
      names: g.names,
      gameNo: g.gameNo,
      handNo: g.handNo,
      turn: g.turn,
      step: g.step,
      stockCount: g.stock.length,
      discard: g.discard,
      melds: g.melds,
      hand: g.hands[seat],
      counts: g.hands.map((x) => x.length),
      ti: {
        drew: g.ti.drew,
        took: g.ti.drew === 'discard' || mine ? g.ti.took : [],
        mustPlay: g.ti.mustPlay,
        topOnly: g.ti.topOnly,
        canUndo: mine && g.ti.undo.length > 0,
      },
      history: g.history,
      totals: g.totals,
      ready: g.ready,
      winner: g.winner,
      log: g.log.slice(-80),
      seq: g.seq,
    };
  }

  const api = {
    SUITS, SUIT_SYM, SUIT_NAME, RANKS, RANK_PLURAL, SCORING,
    isJoker, rankOf, suitOf, cardId, label, asLabel, entryLabel, eff, meldName, signed,
    newDeck, shuffle, meldOptions, layoffOptions, aceClass, tablePoints, handPoints, pointsOnTable,
    newGame, dealHand, apply, viewFor,
  };
  root.R500 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
