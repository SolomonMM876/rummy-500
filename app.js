/*
 * Rummy 500: table UI and peer-to-peer play.
 *
 * Whoever starts a table is the host. Their browser keeps the authoritative
 * game (the R500 engine in engine.js), saves it in localStorage, and sends each
 * player a view containing only their own hand. The friend's browser connects
 * straight to the host over WebRTC (introduced by PeerJS's free public server),
 * sends moves, and renders the views it gets back.
 */
(() => {
  'use strict';

  const E = window.R500;
  // This page's release, read from the ?v= on its own <script> tag. Bump it in index.html with every release:
  // the new URLs make browsers fetch fresh files, and the two players' pages compare versions.
  const APP_VERSION = (() => {
    try { return new URL(document.currentScript.src).searchParams.get('v') || 'dev'; } catch (e) { return 'dev'; }
  })();
  const PEER_PREFIX = 'sm-rummy500-';
  const HEARTBEAT_MS = 4000;
  const STALE_MS = 13000;
  const COOLDOWN = { poke: 10000, fake: 6000, taunt: 3000 }; // ms before each button works again
  // PeerJS destroys the peer after these errors, so we start a new one.
  const FATAL = new Set(['unavailable-id', 'server-error', 'socket-error', 'socket-closed', 'invalid-id', 'ssl-unavailable', 'browser-incompatible', 'invalid-key']);
  const DEFAULTS = { handSize: 7, scoring: 'traditional', jokers: false, target: 500 };
  const SCORING_INFO = {
    simplified: '2–9 are worth 5 and 10–K are worth 10. An Ace is 5 played low (A-2-3) and 15 played high or in a set.',
    traditional: '2–9 are worth face value and 10–K are worth 10. An Ace is 1 played low (A-2-3) and 15 played high or in a set.',
    advanced: 'Face values as in Traditional, and runs can wrap around (K-A-2). An Ace is 1 low, 5 in a wrap, 10 high and 15 in a set.',
  };
  const STATUS = {
    starting: 'Opening your table…',
    'id-taken': 'This table is open in another tab or window. Close the other one; retrying…',
    server: 'Can’t reach the PeerJS connection server. Retrying…',
    connecting: 'Connecting to the table…',
    slow: 'Still trying to connect… If this keeps happening, a firewall on one of your networks may be blocking the connection.',
    'host-offline': 'The host’s table isn’t open right now. Waiting for them…',
    reconnecting: 'Connection lost. Reconnecting…',
  };
  // Card backs. `emoji` or `art` (an SVG from ART) sits in the middle; the patterns live in style.css.
  const BACKS = [
    { id: 'classic', name: 'Classic' },
    { id: 'amanita', name: 'Fly agaric', emoji: '🍄' },
    { id: 'forest', name: 'Mushroom patch' },
    { id: 'morel', name: 'Morels', art: 'morel' },
    { id: 'chanterelle', name: 'Chanterelles', art: 'chanterelle' },
    { id: 'porcini', name: 'Porcini', art: 'porcini' },
    { id: 'turkeytail', name: 'Turkey tail' },
    { id: 'mushcat', name: 'Toadstool cat', art: 'mushcat' },
    { id: 'blackcat', name: 'Black cat', art: 'blackcat' },
    { id: 'whitecat', name: 'White cat', art: 'whitecat' },
    { id: 'cat', name: 'Cat', emoji: '🐱' },
    { id: 'fox', name: 'Fox', emoji: '🦊' },
    { id: 'owl', name: 'Owl', emoji: '🦉' },
    { id: 'frog', name: 'Frog', emoji: '🐸' },
    { id: 'hedgehog', name: 'Hedgehog', emoji: '🦔' },
    { id: 'bee', name: 'Bee', emoji: '🐝' },
  ];
  const BACK_BY_ID = Object.fromEntries(BACKS.map((b) => [b.id, b]));
  const BACK_IDS = new Set(Object.keys(BACK_BY_ID));
  // How your draws look to both players: nothing, or a hand or foot that swoops in and carries the card off.
  const GRAB_STYLES = { none: { label: 'Nothing' }, hand: { label: '✋ Hand', emoji: '✋', ms: 1300 }, foot: { label: '🦶 Foot', emoji: '🦶', ms: 2600 } };
  const isGrab = (g) => Object.prototype.hasOwnProperty.call(GRAB_STYLES, g);
  // Hand-drawn art for card backs (and the mushroom bloom attack), on a 40×40 grid.
  const ART = {
    whitecat: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M26 35C33.5 35 34.5 27.5 30.5 26" fill="none" stroke="#f6f4f0" stroke-width="2.6" stroke-linecap="round"/><path d="M13.5 36.5C12.5 29 15 25 20 25C25 25 27.5 29 26.5 36.5Z" fill="#f6f4f0" stroke="#c9c4bb" stroke-width=".6"/><circle cx="20" cy="20" r="5.6" fill="#f6f4f0" stroke="#c9c4bb" stroke-width=".6"/><path d="M15.1 18.3L15.3 12.2L18.8 15.4ZM24.9 18.3L24.7 12.2L21.2 15.4Z" fill="#f6f4f0" stroke="#c9c4bb" stroke-width=".6" stroke-linejoin="round"/><path d="M15.9 16.9L16 14.1L17.6 15.6ZM24.1 16.9L24 14.1L22.4 15.6Z" fill="#f4a7b9"/><g fill="#5aa9e6"><ellipse cx="18" cy="20" rx="1.1" ry="1.4"/><ellipse cx="22" cy="20" rx="1.1" ry="1.4"/></g><g fill="#1b1b22"><rect x="17.8" y="19.1" width=".4" height="1.8" rx=".2"/><rect x="21.8" y="19.1" width=".4" height="1.8" rx=".2"/></g><path d="M19.3 22.2L20.7 22.2L20 23Z" fill="#f08aa0"/><g stroke="#b9b3a9" stroke-width=".4" stroke-linecap="round"><path d="M17.5 22.6L14 22"/><path d="M17.5 23.2L14 23.6"/><path d="M22.5 22.6L26 22"/><path d="M22.5 23.2L26 23.6"/></g></svg>',
    morel: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M16.5 27.5Q15.5 33 17 36.5L23 36.5Q24.5 33 23.5 27.5Z" fill="#f1e4c8"/><path d="M20 3.5C27 7.5 29.5 18 26.5 28.5L13.5 28.5C10.5 18 13 7.5 20 3.5Z" fill="#b8895a"/><g fill="#6f4a2a"><ellipse cx="17.6" cy="10" rx="1.5" ry="2.1"/><ellipse cx="22.2" cy="9.6" rx="1.5" ry="2.1"/><ellipse cx="15.6" cy="15.2" rx="1.6" ry="2.3"/><ellipse cx="20" cy="14.8" rx="1.7" ry="2.3"/><ellipse cx="24.4" cy="15.2" rx="1.6" ry="2.3"/><ellipse cx="15.2" cy="20.8" rx="1.7" ry="2.4"/><ellipse cx="19.9" cy="20.4" rx="1.8" ry="2.5"/><ellipse cx="24.7" cy="20.8" rx="1.7" ry="2.4"/><ellipse cx="17.4" cy="25.6" rx="1.7" ry="1.8"/><ellipse cx="22.5" cy="25.6" rx="1.7" ry="1.8"/></g></svg>',
    chanterelle: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M5 12C8 8.5 12 11 15 9.5C18 8 22 10.5 25 9C28.5 7.5 32 10 35 12C33.5 15 27.5 17.5 24 19.5C23.2 25 23 31 22.6 36L17.4 36C17 31 16.8 25 16 19.5C12.5 17.5 6.5 15 5 12Z" fill="#f3a632"/><path d="M5 12C12 14.8 28 14.8 35 12" fill="none" stroke="#c77a12" stroke-width="1"/><g fill="none" stroke="#d98718" stroke-width=".8" stroke-linecap="round"><path d="M9.5 13.6Q15 17 18 24"/><path d="M14 14.4Q17.6 18 19.2 27"/><path d="M26 14.4Q22.4 18 20.8 27"/><path d="M30.5 13.6Q25 17 22 24"/></g><path d="M11 11.2C15 10.2 18 11.5 21 10.6" fill="none" stroke="#ffd27a" stroke-width="1.2" stroke-linecap="round"/></svg>',
    porcini: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M13 22C10.5 30 13 36.5 20 36.5C27 36.5 29.5 30 27 22Z" fill="#efe3c6"/><path d="M15.5 26L24.5 26M15 29.5L25 29.5M15.8 33L24.2 33" stroke="#d8c7a0" stroke-width=".7"/><path d="M4.5 22.5C4.5 11 12 5.5 20 5.5C28 5.5 35.5 11 35.5 22.5Z" fill="#7b4a26"/><rect x="6" y="21.2" width="28" height="2.6" rx="1.3" fill="#d6b86a"/><path d="M9 16C10.5 11.5 14.5 9 19 8.6" fill="none" stroke="#a66d3d" stroke-width="2" stroke-linecap="round"/></svg>',
    mushcat: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M10 22L11 12.5L17 17.5ZM30 22L29 12.5L23 17.5Z" fill="#f2a65a"/><circle cx="20" cy="25.5" r="10" fill="#f2a65a"/><path d="M11.5 18.5C11.5 9 28.5 9 28.5 18.5Z" fill="#d7322b"/><g fill="#fff"><circle cx="16" cy="14" r="1.5"/><circle cx="21" cy="12" r="1.7"/><circle cx="25" cy="15.5" r="1.2"/></g><rect x="12" y="17.6" width="16" height="1.8" rx=".9" fill="#f6e7c8"/><g fill="#2a2a2a"><ellipse cx="16" cy="25" rx="1.6" ry="2.2"/><ellipse cx="24" cy="25" rx="1.6" ry="2.2"/></g><g fill="#fff"><circle cx="16.5" cy="24.2" r=".5"/><circle cx="24.5" cy="24.2" r=".5"/></g><path d="M19 28.4L21 28.4L20 29.7Z" fill="#e0707a"/><path d="M20 29.7Q18.6 31.4 17.2 30.5M20 29.7Q21.4 31.4 22.8 30.5" fill="none" stroke="#2a2a2a" stroke-width=".8" stroke-linecap="round"/><g stroke="#8a5a30" stroke-width=".6" stroke-linecap="round"><path d="M13 28L7.5 27"/><path d="M13 29.6L7.5 30.6"/><path d="M27 28L32.5 27"/><path d="M27 29.6L32.5 30.6"/></g></svg>',
    blackcat: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M14 35C6.5 35 5.5 27.5 9.5 26" fill="none" stroke="#1b1b22" stroke-width="2.4" stroke-linecap="round"/><path d="M13.5 36.5C12.5 29 15 25 20 25C25 25 27.5 29 26.5 36.5Z" fill="#1b1b22"/><circle cx="20" cy="20" r="5.4" fill="#1b1b22"/><path d="M15.2 18.2L15.4 12.4L18.6 15.4ZM24.8 18.2L24.6 12.4L21.4 15.4Z" fill="#1b1b22"/><g fill="#f5d547"><ellipse cx="18" cy="20" rx="1.1" ry="1.5"/><ellipse cx="22" cy="20" rx="1.1" ry="1.5"/></g><g fill="#1b1b22"><rect x="17.8" y="19" width=".4" height="2" rx=".2"/><rect x="21.8" y="19" width=".4" height="2" rx=".2"/></g><path d="M28 33.8A3.6 3 0 0 1 35.2 33.8Z" fill="#d7322b"/><rect x="30.7" y="33.8" width="1.8" height="3" rx=".8" fill="#f4ead2"/><circle cx="30.4" cy="32.2" r=".6" fill="#fff"/><circle cx="33" cy="32.6" r=".5" fill="#fff"/><path d="M34.2 36.2A2.2 1.9 0 0 1 38.6 36.2Z" fill="#d7322b"/><rect x="35.9" y="36.2" width="1.1" height="1.8" rx=".5" fill="#f4ead2"/></svg>',
  };
  // Taunts: [id, emoji, text]. Both players' pages need the same ids.
  const TAUNTS = [
    ['nice', '😏', 'Nice try.'],
    ['wait', '⏰', 'Any day now…'],
    ['see', '👀', 'I know what you’re holding.'],
    ['sleep', '😴', 'Wake me when it’s my turn.'],
    ['fire', '🔥', 'I’m on fire!'],
    ['please', '🙏', 'Please discard something good.'],
    ['dont', '🤫', 'Don’t pick that up…'],
    ['oof', '😬', 'Oof. That’s gonna cost you.'],
    ['called', '🎯', 'Called it.'],
    ['bye', '👋', 'Say goodbye to those points!'],
    ['yawn', '🥱', 'Is that all you’ve got?'],
    ['gg', '🤝', 'Good game!'],
    ['icecream', '🍦', 'Here, have an ice cream. You’ve earned it.'],
    ['maxibon', '🍦', 'Here, have my Maxibon…', 'maxibon'], // offered, then snatched back
  ];
  const TAUNT_BY_ID = Object.fromEntries(TAUNTS.map((t) => [t[0], t]));
  // A generic ice cream sandwich (half dipped in chocolate, half biscuit) for the Maxibon taunt.
  const MAXIBON_SVG = '<svg viewBox="0 0 60 30" aria-hidden="true"><rect x="2" y="3" width="30" height="24" rx="4" fill="#4a2a17"/><g fill="#c9a26b"><circle cx="8" cy="9" r="1.2"/><circle cx="14" cy="16" r="1"/><circle cx="21" cy="8" r="1.1"/><circle cx="26" cy="19" r="1.2"/><circle cx="10" cy="22" r="1"/><circle cx="19" cy="23" r=".9"/><circle cx="27" cy="11" r=".9"/></g><rect x="30" y="3" width="28" height="7" rx="2" fill="#3b2415"/><rect x="30" y="10" width="28" height="10" fill="#fdf4dc"/><rect x="30" y="20" width="28" height="7" rx="2" fill="#3b2415"/><g fill="#5a3a24"><circle cx="36" cy="6.5" r=".8"/><circle cx="44" cy="6.5" r=".8"/><circle cx="52" cy="6.5" r=".8"/><circle cx="36" cy="23.5" r=".8"/><circle cx="44" cy="23.5" r=".8"/><circle cx="52" cy="23.5" r=".8"/></g><path d="M5 6.5H28" stroke="#6e4428" stroke-width="1.4" stroke-linecap="round" opacity=".7"/></svg>';
  // Attacks you earn by winning a hand (the rules live in engine.js).
  const ATTACK_INFO = {
    smash: { emoji: '🪓', label: 'Break the table', blurb: 'crack their table in half', sent: (n) => `You smashed ${n}’s table in half!` },
    spiders: { emoji: '🕷️', label: 'Release spiders', blurb: 'set spiders loose on their screen', sent: (n) => `You set spiders loose on ${n}!` },
    bloom: { emoji: '🍄', label: 'Mushroom bloom', blurb: 'sprout mushrooms all over their table', sent: (n) => `Mushrooms are sprouting all over ${n}’s table!` },
    tornado: { emoji: '🌪️', label: 'Tornado', blurb: 'whip their cards around and scramble their hand', sent: (n) => `A tornado is tearing through ${n}’s table!` },
    catstorm: { emoji: '🐈', label: 'Cat storm', blurb: 'make it rain cats on their screen', sent: (n) => `It’s raining cats on ${n}!` },
    gray: { emoji: '🌫️', label: 'Drain the colour', blurb: 'turn their hand grey for 30 seconds', sent: (n) => `${n}’s hand has gone grey for 30 seconds!` },
    peek: { emoji: '🔍', label: 'Mirror peek', blurb: 'see one of their cards in a mirror', sent: (n) => `You spotted one of ${n}’s cards!` },
    fire: { emoji: '🔥', label: 'Burn their cards', blurb: 'set their hand on fire until it crumbles to ash', sent: (n) => `${n}’s cards are going up in flames!` },
  };
  // How the fire plays out, in ms: each card chars from the bottom up, the hand smoulders, crumbles to ash,
  // stays gone for a moment, then grows back.
  const FIRE = { burn: 1500, spread: 1100, hold: 500, crumble: 650, gone: 700, reborn: 700, scorch: 20000 };

  // ---------- helpers ----------

  const $ = (sel, root = document) => root.querySelector(sel);

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : String(kid));
    }
    return el;
  }

  const store = {
    get(key, fallback = null) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
    },
    del(key) {
      try { localStorage.removeItem(key); } catch (e) { /* blocked */ }
    },
  };

  const rng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const myBack = () => (BACK_IDS.has(store.get('r500:back')) ? store.get('r500:back') : 'classic');
  const myGrab = () => (isGrab(store.get('r500:grab')) ? store.get('r500:grab') : 'none');
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();

  function randomCode() {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => alphabet[b % alphabet.length]).join('');
  }
  function randomToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function cleanSettings(s) {
    s = s || {};
    const target = Math.round(Number(s.target));
    return {
      handSize: [7, 10, 13].includes(s.handSize) ? s.handSize : DEFAULTS.handSize,
      scoring: E.SCORING.includes(s.scoring) ? s.scoring : DEFAULTS.scoring,
      jokers: s.jokers === true,
      target: Number.isFinite(target) ? Math.min(5000, Math.max(50, target)) : DEFAULTS.target,
    };
  }

  const tableKey = (code) => 'r500:host:' + code;
  function saveTable(t) {
    t.updated = Date.now();
    store.set(tableKey(t.code), t);
    const codes = store.get('r500:tables', []).filter((c) => c !== t.code);
    codes.unshift(t.code);
    store.set('r500:tables', codes.slice(0, 12));
  }
  function forgetTable(code) {
    store.del(tableKey(code));
    store.del('r500:order:' + code);
    store.set('r500:tables', store.get('r500:tables', []).filter((c) => c !== code));
  }

  // ---------- host: runs the game ----------

  class HostNet {
    constructor(table, cb) {
      this.t = table;
      this.cb = cb;
      this.conn = null;
      this.online = false;
      this.lastSeen = 0;
    }

    start() {
      this.openPeer();
      this.beat = setInterval(() => {
        if (this.online && Date.now() - this.lastSeen > STALE_MS) this.setOnline(false);
      }, 2000);
    }

    openPeer() {
      if (this.stopped) return;
      this.cb.onStatus('starting');
      const peer = new Peer(PEER_PREFIX + this.t.code, { debug: 0 });
      this.peer = peer;
      peer.on('open', () => this.cb.onStatus('ready'));
      peer.on('connection', (conn) => this.accept(conn));
      peer.on('call', (call) => this.cb.onCall(call));
      peer.on('disconnected', () => {
        if (this.stopped || peer.destroyed) return;
        setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 1500);
      });
      peer.on('error', (err) => {
        if (this.stopped || err.type === 'peer-unavailable') return;
        this.cb.onStatus(err.type === 'unavailable-id' ? 'id-taken' : 'server');
        if (FATAL.has(err.type)) {
          try { peer.destroy(); } catch (e) { /* already gone */ }
          clearTimeout(this.reopen);
          this.reopen = setTimeout(() => this.openPeer(), 4000);
        }
      });
    }

    accept(conn) {
      conn.on('data', (msg) => this.onData(conn, msg));
      const drop = () => {
        if (this.conn !== conn) return;
        this.conn = null;
        this.setOnline(false);
      };
      conn.on('close', drop);
      conn.on('error', drop);
    }

    onData(conn, msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'hello') { this.hello(conn, msg); return; }
      if (conn !== this.conn) return;
      this.lastSeen = Date.now();
      if (!this.online) this.setOnline(true);
      if (msg.type === 'ping') conn.send({ type: 'pong' });
      else if (msg.type === 'poke') this.cb.onPoke(this.names()[1] || 'Your friend');
      else if (msg.type === 'emote') this.cb.onEmote(msg.emote);
      else if (msg.type === 'video') this.cb.onVideo(Boolean(msg.on));
      else if (msg.type === 'act') {
        const err = this.act(1, msg.action);
        if (err) conn.send({ type: 'error', msg: err });
      }
    }

    hello(conn, msg) {
      const token = String(msg.token || '').slice(0, 64);
      if (!token) return;
      const seat = this.t.players[1];
      // Nobody else can take the seat while its player is connected.
      if (seat.token && seat.token !== token && this.online && this.conn && this.conn !== conn) {
        conn.send({ type: 'full' });
        setTimeout(() => conn.close(), 500);
        return;
      }
      if (this.conn && this.conn !== conn) {
        const old = this.conn;
        try { old.send({ type: 'replaced' }); } catch (e) { /* closing it anyway */ }
        setTimeout(() => old.close(), 300);
      }
      seat.token = token;
      if (this.t.lobby || !seat.name) seat.name = cleanName(msg.name) || 'Friend';
      if (BACK_IDS.has(msg.back)) seat.back = msg.back;
      this.guestVersion = String(msg.version || ''); // '' = a page from before versions existed
      if (isGrab(msg.grab)) seat.grab = msg.grab;
      this.conn = conn;
      this.lastSeen = Date.now();
      this.online = true;
      conn.send({ type: 'welcome', seat: 1 });
      this.cb.onLink();
      saveTable(this.t);
      this.broadcast();
    }

    setOnline(on) {
      if (this.online === on) return;
      this.online = on;
      this.broadcast();
      if (!on) this.cb.onVideo(false);
    }

    names() {
      return this.t.game && !this.t.lobby ? this.t.game.names : this.t.players.map((p) => p.name);
    }

    act(seat, action) {
      const t = this.t;
      if (!action || typeof action !== 'object') return 'Unknown move.';
      if (action.type === 'settings') {
        if (seat !== 0 || !t.lobby) return 'Only the host can change the settings, before dealing.';
        t.settings = cleanSettings(action.settings);
      } else if (action.type === 'start') {
        if (seat !== 0 || !t.lobby) return 'Only the host can deal.';
        if (!t.players[1].name) return 'Wait for your friend to join first.';
        t.game = E.newGame(t.settings, t.players.map((p) => p.name), (t.game ? t.game.gameNo : 0) + 1);
        E.dealHand(t.game, rng);
        t.lobby = false;
      } else if (action.type === 'lobby') {
        if (seat !== 0 || !t.game || t.game.phase !== 'gameOver') return 'You can change the settings once the game is over.';
        t.lobby = true;
      } else if (action.type === 'back') {
        if (!BACK_IDS.has(action.back)) return 'Unknown card back.';
        t.players[seat].back = action.back;
      } else if (action.type === 'grab') {
        if (!isGrab(action.grab)) return 'Unknown pick-up style.';
        t.players[seat].grab = action.grab;
      } else {
        if (!t.game || t.lobby) return 'The game hasn’t started yet.';
        const g = clone(t.game); // apply to a copy so a rejected move changes nothing
        const err = E.apply(g, seat, action, rng);
        if (err) return err;
        if (g.phase === 'gameOver' && t.game.phase !== 'gameOver' && g.winner != null) {
          t.record = t.record || [0, 0]; // games won at this table, by seat
          t.record[g.winner] += 1;
        }
        t.game = g;
      }
      saveTable(t);
      this.broadcast();
      return null;
    }

    viewFor(seat) {
      const t = this.t;
      const online = [true, this.online];
      const backs = t.players.map((p) => p.back || 'classic');
      const grabs = t.players.map((p) => p.grab || 'none');
      if (t.lobby || !t.game) {
        return {
          phase: 'lobby', seat, code: t.code, settings: t.settings, names: t.players.map((p) => p.name), online, backs, grabs, record: t.record || [0, 0], version: APP_VERSION,
          lastGame: t.game ? { names: t.game.names, totals: t.game.totals } : null,
        };
      }
      return { ...E.viewFor(t.game, seat), code: t.code, online, backs, grabs, record: t.record || [0, 0], version: APP_VERSION };
    }

    broadcast() {
      this.cb.onView(this.viewFor(0));
      if (this.conn && this.conn.open) {
        try { this.conn.send({ type: 'view', view: this.viewFor(1) }); } catch (e) { /* the heartbeat will notice */ }
      }
    }

    send(action) {
      return this.act(0, action);
    }

    poke() {
      if (!this.conn || !this.conn.open || !this.online) return false;
      this.conn.send({ type: 'poke', from: this.t.players[0].name });
      return true;
    }

    emote(e) {
      if (!this.conn || !this.conn.open || !this.online) return false;
      this.conn.send({ type: 'emote', emote: e });
      return true;
    }

    sendVideo(on) {
      if (this.conn && this.conn.open) this.conn.send({ type: 'video', on });
    }

    call(stream) {
      return this.conn && this.conn.open ? this.peer.call(this.conn.peer, stream) : null;
    }

    stop() {
      this.stopped = true;
      clearInterval(this.beat);
      clearTimeout(this.reopen);
      try { if (this.peer) this.peer.destroy(); } catch (e) { /* already gone */ }
    }
  }

  // ---------- guest: connects to the host ----------

  class GuestNet {
    constructor(code, name, token, cb) {
      Object.assign(this, { code, name, token, cb });
      this.conn = null;
      this.lastHeard = 0;
    }

    start() {
      this.openPeer();
      this.beat = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    }

    openPeer() {
      if (this.stopped) return;
      this.cb.onStatus('connecting');
      const peer = new Peer({ debug: 0 });
      this.peer = peer;
      peer.on('open', () => this.connect());
      peer.on('call', (call) => this.cb.onCall(call));
      peer.on('disconnected', () => {
        if (this.stopped || peer.destroyed) return;
        setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 1500);
      });
      peer.on('error', (err) => {
        if (this.stopped) return;
        if (err.type === 'peer-unavailable') {
          this.cb.onStatus('host-offline');
          this.retry(4000);
          return;
        }
        this.cb.onStatus('server');
        if (FATAL.has(err.type)) {
          try { peer.destroy(); } catch (e) { /* already gone */ }
          this.retry(5000, true);
        }
      });
    }

    connect() {
      if (this.stopped || !this.peer || this.peer.destroyed || this.peer.disconnected) return;
      if (this.conn) { try { this.conn.close(); } catch (e) { /* already closed */ } }
      // PeerJS's default binary mode splits large messages; its JSON mode silently refuses anything over ~16 KB.
      const conn = this.peer.connect(PEER_PREFIX + this.code, { reliable: true });
      this.conn = conn;
      clearTimeout(this.openTimer);
      this.openTimer = setTimeout(() => {
        if (this.conn === conn && !conn.open) {
          this.cb.onStatus('slow');
          this.retry(500);
        }
      }, 12000);
      conn.on('open', () => {
        clearTimeout(this.openTimer);
        this.lastHeard = Date.now();
        conn.send({ type: 'hello', token: this.token, name: this.name, back: myBack(), grab: myGrab(), version: APP_VERSION });
      });
      conn.on('data', (msg) => { if (this.conn === conn) this.onData(msg); });
      const lost = () => {
        if (this.conn !== conn || this.stopped) return;
        this.cb.onStatus('reconnecting');
        this.retry(2000);
      };
      conn.on('close', lost);
      conn.on('error', lost);
    }

    retry(delay, freshPeer) {
      if (this.stopped || this.retryTimer) return;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        if (freshPeer || !this.peer || this.peer.destroyed) this.openPeer();
        else if (this.peer.disconnected) this.peer.reconnect(); // 'open' then reconnects to the host
        else this.connect();
      }, delay);
    }

    onData(msg) {
      if (!msg || typeof msg !== 'object') return;
      this.lastHeard = Date.now();
      if (msg.type === 'welcome' || msg.type === 'view') this.cb.onStatus('connected');
      if (msg.type === 'welcome') this.cb.onLink();
      if (msg.type === 'view') this.cb.onView(msg.view);
      else if (msg.type === 'error') this.cb.onError(String(msg.msg));
      else if (msg.type === 'poke') this.cb.onPoke(cleanName(msg.from) || 'Your friend');
      else if (msg.type === 'emote') this.cb.onEmote(msg.emote);
      else if (msg.type === 'video') this.cb.onVideo(Boolean(msg.on));
      else if (msg.type === 'full' || msg.type === 'replaced') {
        this.stop();
        this.cb.onStatus(msg.type);
      }
    }

    heartbeat() {
      const conn = this.conn;
      if (!conn || !conn.open) return;
      if (Date.now() - this.lastHeard > STALE_MS) {
        this.cb.onStatus('reconnecting');
        this.conn = null;
        try { conn.close(); } catch (e) { /* already closed */ }
        this.retry(500);
        return;
      }
      try { conn.send({ type: 'ping' }); } catch (e) { /* noticed next beat */ }
    }

    send(action) {
      if (!this.conn || !this.conn.open) return 'You’re not connected to the table right now.';
      this.conn.send({ type: 'act', action });
      return null;
    }

    poke() {
      if (!this.conn || !this.conn.open) return false;
      this.conn.send({ type: 'poke' });
      return true;
    }

    emote(e) {
      if (!this.conn || !this.conn.open) return false;
      this.conn.send({ type: 'emote', emote: e });
      return true;
    }

    sendVideo(on) {
      if (this.conn && this.conn.open) this.conn.send({ type: 'video', on });
    }

    call(stream) {
      return this.peer && !this.peer.destroyed ? this.peer.call(PEER_PREFIX + this.code, stream) : null;
    }

    stop() {
      this.stopped = true;
      clearInterval(this.beat);
      clearTimeout(this.retryTimer);
      clearTimeout(this.openTimer);
      try { if (this.peer) this.peer.destroy(); } catch (e) { /* already gone */ }
    }
  }

  // ---------- app state & routing ----------

  const ui = {
    screen: null, // 'home' | 'join' | 'connecting' | 'lobby' | 'game' | 'ended'
    role: null, // 'host' | 'guest'
    code: null,
    net: null,
    view: null,
    status: 'idle',
    selected: new Set(),
    order: [], // your hand's order on screen, including cards played this turn (so Undo puts them back)
    orderKey: null,
    fresh: new Set(),
    cool: { poke: 0, fake: 0, taunt: 0 }, // when each social button can be used again
    menu: null, // the open popup menu: { kind, el }
    drag: null, // a card being dragged within your hand
    attackSeen: undefined, // the last attack already played on this page
    fire: { mine: null, theirs: null }, // a fire burning your hand, or the other player's (as you see it)
    revealed: new Set(), // hand results already played out on this page
    revealTimers: [],
    revealing: false,
    summaryKey: null,
    modal: null,
    dragId: null,
  };

  const callbacks = {
    onView: (view) => setView(view),
    onStatus: (status) => setStatus(status),
    onPoke: (from) => gotPoke(from),
    onEmote: (e) => gotEmote(e),
    onVideo: (on) => gotVideo(on),
    onCall: (call) => gotCall(call),
    onLink: () => linked(),
    onError: (msg) => toast(msg, 'error'),
  };

  function mount(node) {
    $('#app').replaceChildren(node);
  }

  function parseCode() {
    const m = location.hash.match(/^#([A-Za-z0-9]{6})$/);
    return m ? m[1].toUpperCase() : null;
  }

  function route() {
    const code = parseCode();
    if (ui.net && ui.code === code) return;
    leaveTable();
    if (!code) { showHome(); return; }
    const table = store.get(tableKey(code));
    if (table) { startHost(table); return; }
    const guest = store.get('r500:guest:' + code);
    if (guest && guest.name && guest.token) { startGuest(code, guest.name, guest.token); return; }
    showJoin(code);
  }

  function leaveTable() {
    shutVideo();
    if (ui.net) ui.net.stop();
    closeModal();
    closeMenu();
    Object.assign(ui, { net: null, role: null, code: null, view: null, status: 'idle', summaryKey: null, orderKey: null, order: [], attackSeen: undefined, drag: null, fire: { mine: null, theirs: null } });
    ui.selected.clear();
    ui.fresh.clear();
  }

  function startHost(table) {
    ui.role = 'host';
    ui.code = table.code;
    ui.net = new HostNet(table, callbacks);
    ui.net.start();
    setView(ui.net.viewFor(0));
  }

  function startGuest(code, name, token) {
    ui.role = 'guest';
    ui.code = code;
    ui.status = 'connecting';
    showConnecting();
    ui.net = new GuestNet(code, name, token, callbacks);
    ui.net.start();
  }

  function setView(view) {
    const prev = ui.view;
    ui.view = view;
    if (view.phase === 'lobby') renderLobby();
    else renderGame(prev);
    renderBanner();
  }

  function setStatus(status) {
    ui.status = status;
    if (status === 'full') {
      showEnded('This table already has two players.', 'Ask whoever sent you the link to check it, or start a table of your own.');
    } else if (status === 'replaced') {
      showEnded('This table is open in another tab or window.', 'Keep playing there, or reload this page to move the game here.');
    } else if (ui.screen === 'connecting') {
      const el = $('#conn-msg');
      if (el) el.textContent = statusText() || 'Connecting…';
    } else {
      renderBanner();
      if (ui.screen === 'game') { renderTopbar(); renderOpp(); }
    }
  }

  function statusText() {
    if (ui.role === 'guest' && ui.status === 'host-offline' && ui.view) {
      return `${ui.view.names[0]} isn’t connected right now. Waiting for them to come back…`;
    }
    return STATUS[ui.status] || '';
  }

  function renderBanner() {
    const el = $('#banner');
    if (!el) return;
    const status = statusText();
    const ver = status ? null : versionCheck();
    el.replaceChildren(...[
      status || (ver && ver.text),
      ver && ver.mine && h('button', { class: 'btn small', onclick: () => location.reload() }, 'Reload now'),
    ].filter(Boolean));
    el.hidden = !(status || ver);
  }

  // The host's page runs the rules, so both pages should be the same release. Versions sort as text.
  function versionCheck() {
    const v = ui.view;
    if (!v || !ui.net) return null;
    const other = ui.role === 'host' ? ui.net.guestVersion : v.version || '';
    if (other == null || other === APP_VERSION) return null; // (host: friend not connected yet)
    const name = v.names[1 - v.seat] || 'Your friend';
    if (other < APP_VERSION) return { mine: false, text: `${name}’s page is an older version of the game. Ask them to reload it; the game carries on.` };
    return { mine: true, text: 'A newer version of the game is out. Reload this page to get it; the game carries on.' };
  }

  // Your opponent's connection, as far as this browser can tell.
  function oppOnline(v) {
    return ui.role === 'host' ? v.online[1] : ui.status === 'connected';
  }

  // ---------- start, join & lobby screens ----------

  function brand(big) {
    return h('div', { class: 'brand' + (big ? ' big' : '') },
      h('span', { class: 'brand-name' }, 'Rummy 500'),
      h('span', { class: 'brand-suits', 'aria-hidden': 'true' },
        h('i', { class: 'b' }, '♠'), h('i', { class: 'r' }, '♥'), h('i', { class: 'b' }, '♣'), h('i', { class: 'r' }, '♦')));
  }

  function nameInput(onEnter) {
    const input = h('input', { type: 'text', placeholder: 'Your name', value: store.get('r500:name', ''), autocomplete: 'off' });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') onEnter(); });
    input.addEventListener('input', () => input.classList.remove('bad'));
    return input;
  }

  function takeName(input) {
    const name = cleanName(input.value);
    if (!name) {
      input.classList.add('bad');
      input.focus();
      return null;
    }
    store.set('r500:name', name);
    return name;
  }

  function showHome() {
    ui.screen = 'home';
    const create = () => {
      const name = takeName(input);
      if (!name) return;
      const code = randomCode();
      saveTable({ code, created: Date.now(), lobby: true, settings: { ...DEFAULTS }, players: [{ name, token: 'host', back: myBack(), grab: myGrab() }, { name: null, token: null }], game: null });
      location.hash = code;
    };
    const input = nameInput(create);
    const recent = store.get('r500:tables', []).map((c) => store.get(tableKey(c))).filter(Boolean).slice(0, 5);
    mount(h('main', { class: 'center' }, h('div', { class: 'panel-card' },
      brand(true),
      h('p', { class: 'lede' }, 'Play Rummy 500 against a friend, each on your own computer. Start a table, send your friend the link, and deal.'),
      h('label', { class: 'field' }, h('span', null, 'Your name'), input),
      h('button', { class: 'btn primary big', onclick: create }, 'Start a new table'),
      recent.length ? h('div', { class: 'recent' }, h('h3', null, 'Your tables'), recent.map(recentRow)) : null,
      h('p', { class: 'fine' }, 'Your browser runs the game, so keep the tab open while you play. Games are saved on this computer and pick up where you left off.'))));
    input.focus();
  }

  function recentRow(t) {
    const g = t.game;
    const bits = [t.players[1].name ? `vs ${t.players[1].name}` : 'waiting for a friend'];
    if (g && g.phase === 'gameOver' && g.forfeit) bits.push(`${g.names[g.winner]} won when ${g.names[g.forfeit.by]} forfeited`);
    else if (g && g.phase === 'gameOver') bits.push(`${g.names[g.winner]} won ${Math.max(...g.totals)}–${Math.min(...g.totals)}`);
    else if (g) bits.push(`hand ${g.handNo}, ${g.totals[0]}–${g.totals[1]}`);
    return h('div', { class: 'recent-row' },
      h('div', null, h('strong', null, 'Table ' + t.code), h('span', { class: 'muted' }, ' · ' + bits.join(' · '))),
      h('div', { class: 'recent-actions' },
        h('a', { class: 'btn small', href: '#' + t.code }, 'Open'),
        h('button', {
          class: 'btn small ghost',
          onclick: () => {
            if (confirm(`Delete table ${t.code} and its saved game from this computer?`)) { forgetTable(t.code); showHome(); }
          },
        }, 'Delete')));
  }

  function showJoin(code) {
    ui.screen = 'join';
    const join = () => {
      const name = takeName(input);
      if (!name) return;
      const token = randomToken();
      store.set('r500:guest:' + code, { name, token });
      startGuest(code, name, token);
    };
    const input = nameInput(join);
    mount(h('main', { class: 'center' }, h('div', { class: 'panel-card' },
      brand(true),
      h('h2', null, 'You’re invited to a game'),
      h('p', { class: 'lede' }, `Table ${code}. Type your name and you’ll join the host at the table.`),
      h('label', { class: 'field' }, h('span', null, 'Your name'), input),
      h('button', { class: 'btn primary big', onclick: join }, 'Join the table'),
      h('p', { class: 'fine' }, h('a', { class: 'link', href: '#' }, 'Start my own table instead')))));
    input.focus();
  }

  function showConnecting() {
    ui.screen = 'connecting';
    mount(h('main', { class: 'center' }, h('div', { class: 'panel-card narrow' },
      brand(true),
      h('div', { class: 'spinner', 'aria-hidden': 'true' }),
      h('p', { id: 'conn-msg', class: 'lede', 'aria-live': 'polite' }, statusText() || 'Connecting…'),
      h('p', { class: 'fine' }, h('a', { class: 'link', href: '#' }, 'Cancel')))));
  }

  function showEnded(title, text) {
    ui.screen = 'ended';
    closeModal();
    mount(h('main', { class: 'center' }, h('div', { class: 'panel-card narrow' },
      brand(true),
      h('h2', null, title),
      h('p', { class: 'lede' }, text),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Try again'),
        h('a', { class: 'btn ghost', href: '#' }, 'Start page')))));
  }

  function renderLobby() {
    ui.screen = 'lobby';
    closeModal();
    const v = ui.view;
    const host = v.seat === 0;
    const ready = Boolean(v.names[1] && v.online[1]);
    mount(h('main', { class: 'center' }, h('div', { class: 'panel-card wide' },
      brand(true),
      h('div', { id: 'banner', class: 'banner', hidden: true }),
      h('h2', null, host ? 'Your table is ready' : `You’re at ${v.names[0]}’s table`),
      host ? h('div', { class: 'invite' },
        h('label', { for: 'invite' }, 'Send your friend this link'),
        h('div', { class: 'invite-row' },
          h('input', { id: 'invite', class: 'wide-input', readonly: true, value: inviteLink(), onfocus: (e) => e.target.select() }),
          h('button', { class: 'btn', onclick: copyInvite }, 'Copy link'))) : null,
      h('ul', { class: 'players' }, [0, 1].map((p) => playerRow(v, p))),
      h('div', { class: 'back-row' },
        backEl(v.backs && v.backs[v.seat], 'sm'),
        h('div', null,
          h('strong', null, 'Your card back: '), (BACK_BY_ID[v.backs && v.backs[v.seat]] || BACK_BY_ID.classic).name,
          h('div', { class: 'muted small' }, 'Your friend sees your cards with this design.')),
        h('button', { class: 'btn small', onclick: chooseStyle }, 'Change')),
      v.lastGame ? h('p', { class: 'fine' }, `Last game: ${v.lastGame.names[0]} ${v.lastGame.totals[0]}, ${v.lastGame.names[1]} ${v.lastGame.totals[1]}.`) : null,
      v.record && v.record[0] + v.record[1] > 0 ? recordLine(v) : null,
      settingsForm(v, host),
      h('div', { class: 'lobby-start' }, host
        ? h('button', { class: 'btn primary big', disabled: !ready, onclick: () => send({ type: 'start' }) }, ready ? 'Deal the first hand' : 'Waiting for your friend to join…')
        : h('p', { class: 'waiting' }, h('span', { class: 'spinner small', 'aria-hidden': 'true' }), `Waiting for ${v.names[0]} to deal…`)))));
  }

  function playerRow(v, p) {
    const name = v.names[p];
    if (!name) {
      return h('li', { class: 'player empty' }, h('span', { class: 'avatar' }, '?'), h('span', { class: 'muted' }, 'Waiting for your friend to open the link…'));
    }
    const online = p === v.seat || (ui.role === 'host' ? v.online[p] : ui.status === 'connected');
    return h('li', { class: 'player' },
      h('span', { class: 'avatar ' + (p === v.seat ? 'me' : 'opp') }, initial(name)),
      h('span', null, h('strong', null, name), p === v.seat ? ' (you)' : '', h('span', { class: 'muted' }, p === 0 ? ' · host' : '')),
      h('span', { class: 'dot ' + (online ? 'on' : 'off'), title: online ? 'Connected' : 'Not connected' }));
  }

  function settingsForm(v, editable) {
    const s = v.settings;
    const set = (patch) => send({ type: 'settings', settings: { ...s, ...patch } });
    const seg = (key, choices) => h('div', { class: 'seg', role: 'radiogroup' }, choices.map(([val, text]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(s[key] === val), class: s[key] === val ? 'on' : null,
      disabled: !editable && s[key] !== val, onclick: editable ? () => set({ [key]: val }) : null,
    }, text)));
    const row = (label, ...content) => h('div', { class: 'setting' }, h('div', { class: 'setting-label' }, label), h('div', { class: 'setting-body' }, content));
    return h('section', { class: 'settings' + (editable ? '' : ' readonly') },
      h('h3', null, editable ? 'Game settings' : 'Game settings (the host chooses)'),
      row('Cards dealt', seg('handSize', [[7, '7'], [10, '10'], [13, '13']])),
      row('Scoring', seg('scoring', [['simplified', 'Simplified'], ['traditional', 'Traditional'], ['advanced', 'Advanced']]),
        h('p', { class: 'hint' }, SCORING_INFO[s.scoring], ' Cards left in your hand count against you (Aces and Jokers 15).')),
      row('Jokers', seg('jokers', [[false, 'Off'], [true, 'On (2 wild)']])),
      row('Play to', editable
        ? h('input', { class: 'num', type: 'number', min: 50, max: 5000, step: 50, value: s.target, 'aria-label': 'Target score', onchange: (e) => set({ target: Number(e.target.value) }) })
        : h('strong', null, String(s.target)),
      h('span', { class: 'muted' }, 'points')));
  }

  function inviteLink() {
    return location.origin + location.pathname + '#' + ui.code;
  }

  function copyInvite() {
    const link = inviteLink();
    const fallback = () => openModal({
      title: 'Invite link',
      body: [h('p', null, 'Copy this link and send it to your friend:'), h('input', { class: 'wide-input', readonly: true, value: link, onfocus: (e) => e.target.select() })],
      actions: [h('button', { class: 'btn primary', onclick: closeModal }, 'Done')],
    });
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(() => toast('Invite link copied. Send it to your friend.'), fallback);
    } else {
      fallback();
    }
  }

  // ---------- the table ----------

  function renderGame(prev) {
    const v = ui.view;
    if (ui.screen !== 'game') {
      ui.screen = 'game';
      mount(h('div', { class: 'game' },
        h('header', { class: 'topbar', id: 'topbar' }),
        h('div', { id: 'banner', class: 'banner', hidden: true }),
        h('section', { class: 'board' },
          h('div', { class: 'opp-row' },
            h('div', { id: 'opp-video', class: 'video-tile', hidden: true }),
            h('div', { class: 'opp-strip', id: 'opp' })),
          h('div', { class: 'piles', id: 'piles' }),
          h('div', { class: 'table', id: 'melds' }),
          h('div', { class: 'my-area' },
            h('div', { class: 'status', id: 'status', 'aria-live': 'polite' }),
            h('div', { class: 'hand-row' },
              h('div', { id: 'my-video', class: 'video-tile my-tile', hidden: true }),
              h('div', { class: 'hand', id: 'hand' })),
            h('div', { class: 'controls', id: 'controls' }))),
        h('aside', { class: 'side', id: 'side' },
          h('div', {
            class: 'side-resize', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize the side panel',
            title: 'Drag to resize the side panel · double-click to reset',
            onpointerdown: (e) => startSideResize(e, false), ondblclick: resetSideWidth,
          }),
          h('section', { id: 'video', class: 'panel' }),
          h('div', { id: 'side-panels', class: 'side-panels' }))));
      applySideWidth(savedSideWidth());
      applyTileWidth(store.get('r500:tileWidth'));
    }
    const pilesBefore = pileRects(); // where the cards were, for the pick-up animation
    const handBefore = Object.fromEntries([...document.querySelectorAll('#hand .card')].map((c) => [c.dataset.id, c.getBoundingClientRect()]));
    syncHand(prev);
    renderTopbar();
    renderOpp();
    renderPiles();
    renderMelds();
    renderStatus();
    renderHand();
    renderSide();
    syncSummary();
    syncTrade(prev);
    const myTurn = (x) => x && x.phase === 'play' && x.turn === x.seat && x.handNo === v.handNo && x.gameNo === v.gameNo;
    if (prev && v.step === 'draw' && myTurn(v) && !myTurn(prev)) yourTurnCue();
    if (prev && prev.handNo !== v.handNo && v.phase === 'play') {
      if (charges(v, v.seat)) toast('⚔️ You won the last hand, so you get one of each attack to use this hand. They’re next to Taunt.', 'poke');
      else if (charges(v, 1 - v.seat)) toast(`⚔️ ${v.names[1 - v.seat]} won the last hand and has attacks to use on you. Watch out!`);
    }
    if (!ui.wildHinted && v.phase === 'play' && v.wild && v.wild[v.seat] > 0) {
      ui.wildHinted = true;
      setTimeout(() => toast('⭐ You each start with a wild attack and earn another for every meld or lay-off. Use them with ⚔️ Attacks, next to Taunt.'), 1200);
    }
    renderVideo();
    syncAttack();
    const wildNow = v.wild ? v.wild[v.seat] : 0;
    if (prev && prev.wild && sameHand(prev, v) && wildNow > prev.wild[v.seat]) toast('⚔️ +1 wild attack for that play!');
    const drew = prev && prev.phase === 'play' && v.phase === 'play' && prev.handNo === v.handNo && prev.gameNo === v.gameNo &&
      prev.turn === v.turn && prev.step === 'draw' && v.step === 'play';
    if (drew) pickupCue(pilesBefore);
    const sameTurn = prev && prev.phase === 'play' && v.phase === 'play' && prev.handNo === v.handNo && prev.gameNo === v.gameNo && prev.turn === v.turn;
    if (sameTurn) playCue(prev, handBefore);
  }

  const sameHand = (a, b) => a.phase === 'play' && b.phase === 'play' && a.gameNo === b.gameNo && a.handNo === b.handNo;

  // Keep your own card order between updates: new cards go on the right and glow.
  function syncHand(prev) {
    const v = ui.view;
    const key = `${ui.code}:${v.gameNo}:${v.handNo}`;
    const inHand = new Set(v.hand);
    if (ui.orderKey !== key) {
      const saved = store.get('r500:order:' + ui.code);
      ui.orderKey = key;
      ui.order = saved && saved.key === key ? saved.order.filter((id) => inHand.has(id)) : [];
      ui.order = ui.order.concat(sortIds(v.hand.filter((id) => !ui.order.includes(id)), 'suit'));
      ui.selected.clear();
      ui.fresh.clear();
    } else {
      if (v.turn === v.seat && (!prev || prev.turn !== v.seat)) ui.order = ui.order.filter((id) => inHand.has(id));
      const added = v.hand.filter((id) => !ui.order.includes(id));
      if (added.length) {
        ui.order = ui.order.concat(added);
        ui.fresh = new Set(added);
      }
      if (v.turn !== v.seat) ui.fresh.clear();
    }
    for (const id of [...ui.selected]) if (!inHand.has(id)) ui.selected.delete(id);
    saveOrder();
  }

  function saveOrder() {
    store.set('r500:order:' + ui.code, { key: ui.orderKey, order: ui.order });
  }

  const SUIT_ORDER = { S: 0, H: 1, C: 2, D: 3 };
  function sortIds(ids, mode) {
    const rank = (id) => (E.isJoker(id) ? 99 : E.rankOf(id));
    const suit = (id) => (E.isJoker(id) ? 9 : SUIT_ORDER[E.suitOf(id)]);
    return ids.slice().sort((a, b) => (mode === 'rank' ? rank(a) - rank(b) || suit(a) - suit(b) : suit(a) - suit(b) || rank(a) - rank(b)));
  }

  function sortHand(mode) {
    const inHand = new Set(ui.view.hand);
    ui.order = sortIds(ui.order.filter((id) => inHand.has(id)), mode).concat(ui.order.filter((id) => !inHand.has(id)));
    saveOrder();
    renderHand();
  }

  function renderTopbar() {
    const v = ui.view;
    const st = v.settings;
    $('#topbar').replaceChildren(
      brand(false),
      h('div', { class: 'tb-info' },
        h('span', null, `Hand ${v.handNo}`),
        h('span', null, `${cap(st.scoring)} scoring`),
        h('span', null, st.jokers ? 'Jokers wild' : 'No Jokers'),
        h('span', null, `First to ${st.target}`)),
      h('div', { class: 'tb-actions' },
        ui.role === 'host' ? h('button', { class: 'btn ghost small', onclick: copyInvite }, 'Invite link') : null,
        h('button', { class: 'btn ghost small', onclick: chooseStyle }, 'Card style'),
        h('button', { class: 'btn ghost small', onclick: showRules }, 'Rules'),
        v.phase !== 'gameOver' ? h('button', { class: 'btn ghost small', onclick: confirmForfeit, title: 'Give up this game and move on to the next one' }, '🏳️ Forfeit') : null,
        h('a', { class: 'btn ghost small', href: '#', title: 'Back to the start page. The game is saved.' }, 'Leave')));
  }

  function confirmForfeit() {
    const v = ui.view;
    const o = v.names[1 - v.seat];
    openModal({
      title: '🏳️ Forfeit this game?',
      body: [
        h('p', null, `${o} wins the game, and it counts in the games won. `, v.phase === 'play' ? 'The hand you’re playing isn’t scored.' : ''),
        h('p', null, `The next game starts as soon as ${o} is ready.`),
      ],
      actions: [
        h('button', { class: 'btn ghost', onclick: closeModal }, 'Keep playing'),
        h('button', { class: 'btn danger', onclick: () => { closeModal(); send({ type: 'forfeit' }); } }, 'Forfeit the game'),
      ],
    });
  }

  function renderOpp() {
    const v = ui.view;
    const o = 1 - v.seat;
    const n = v.counts[o];
    const theirTurn = v.phase === 'play' && v.turn === o;
    const online = oppOnline(v);
    const offline = online ? null : `${v.names[o]} isn’t connected`;
    const onTable = E.pointsOnTable(v.melds, v.settings)[o];
    const wait = (kind) => Math.max(0, Math.ceil((ui.cool[kind] - Date.now()) / 1000));
    const menuOpen = (kind) => String(Boolean(ui.menu && ui.menu.kind === kind));
    const armed = charges(v, v.seat);
    // Between hands and after the game, their leftover cards are face up.
    const left = v.phase === 'play' ? null : v.forfeit ? v.forfeit.left : v.history.length ? v.history[v.history.length - 1].left : null;
    const backs = left
      ? h('div', { class: 'opp-hand revealed', 'aria-label': `${v.names[o]} was left holding ${plural(left[o].length, 'card')}` },
        left[o].map((id) => cardEl(id)))
      : h('div', { class: 'opp-hand', 'aria-label': `${v.names[o]} has ${plural(n, 'card')}` },
        Array.from({ length: n }, (_, k) => {
          const el = burnable(backEl(v.backs && v.backs[o], 'sm'), 'theirs', k);
          el.style.setProperty('--i', k); // staggers the fire's crumble and regrowth
          return el;
        }));
    $('#opp').replaceChildren(
      h('div', { class: 'who' + (theirTurn ? ' active' : '') },
        h('span', { class: 'avatar opp' }, initial(v.names[o])),
        h('div', { class: 'who-text' },
          h('div', { class: 'who-name' }, nm(v.names[o]),
            h('span', { class: 'dot ' + (online ? 'on' : 'off'), title: online ? 'Connected' : 'Not connected' }),
            online ? null : h('span', { class: 'muted small' }, ' offline'),
            charges(v, o) ? h('span', { class: 'armed', title: `${v.names[o]} won the last hand and has attacks to use this hand` }, '⚔️') : null),
          h('div', { class: 'who-sub' }, `${plural(n, 'card')} · ${onTable} on the table this hand · ${v.totals[o]} total`),
          seenCards(v).length ? h('div', { class: 'seen', title: 'Cards you spotted with Mirror peek this hand' }, '👀 Seen: ', seenCards(v).map(E.label).join(' ')) : null),
        theirTurn ? h('span', { class: 'badge' }, v.step === 'draw' ? 'Drawing…' : 'Playing…') : null),
      backs,
      h('div', { class: 'social' },
        h('button', {
          class: 'btn small', disabled: Boolean(offline) || wait('poke') > 0, onclick: poke,
          title: offline || 'Nudge them with a sound and a message',
        }, wait('poke') ? `Poked (${wait('poke')})` : '👉 Poke'),
        h('button', {
          class: 'btn small', disabled: Boolean(offline) || v.phase !== 'play' || v.turn !== v.seat || !v.discard.length || wait('fake') > 0, onclick: doFake,
          title: offline || (v.turn !== v.seat ? 'Only on your turn' : 'Reach for the discard pile, then put it all back at the last second'),
        }, '✋ Fake grab'),
        h('button', {
          class: 'btn small', 'data-menu': 'taunt', disabled: Boolean(offline) || wait('taunt') > 0, onclick: (e) => toggleMenu(e, 'taunt'),
          title: offline || 'Send a taunt', 'aria-haspopup': 'menu', 'aria-expanded': menuOpen('taunt'),
        }, '😏 Taunt'),
        armed ? h('button', {
          class: 'btn small attack', id: 'attack-btn', 'data-menu': 'attack', disabled: Boolean(offline) || v.phase !== 'play',
          onclick: (e) => toggleMenu(e, 'attack'), title: offline || 'You won the last hand: use your attacks',
          'aria-haspopup': 'menu', 'aria-expanded': menuOpen('attack'),
        }, `⚔️ Attacks (${armed})`) : null));
    fitRow(backs, 4);
  }

  function renderPiles() {
    const v = ui.view;
    const canDraw = v.phase === 'play' && v.turn === v.seat && v.step === 'draw';
    const empty = v.stockCount === 0;
    const stockCan = canDraw && (!empty || v.discard.length >= 2);
    const stock = h('button', {
      type: 'button', class: 'stock' + (stockCan ? ' can' : ''), disabled: !stockCan, onclick: stockCan ? drawStock : null,
      title: stockCan ? (empty ? 'Shuffle the discards into a new draw pile and draw' : 'Draw the top card') : null,
      'aria-label': empty ? 'Draw pile is empty' : `Draw pile, ${plural(v.stockCount, 'card')}`,
    }, empty
      ? h('div', { class: 'card empty-slot' }, v.discard.length >= 2 ? 'Empty: click to shuffle the discards' : 'Empty')
      : backEl(v.backs && v.backs[v.seat]));
    const disc = h('div', { class: 'discard' + (canDraw ? ' can' : '') }, v.discard.map((id, i) => {
      const above = v.discard.length - 1 - i;
      const el = cardEl(id, { title: canDraw ? (above ? `Take the ${E.label(id)} and the ${plural(above, 'card')} above it` : `Take the ${E.label(id)}`) : E.label(id) });
      if (canDraw) {
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        el.addEventListener('click', () => takeDiscard(i));
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); takeDiscard(i); } });
      }
      return el;
    }));
    $('#piles').replaceChildren(
      h('div', { class: 'pile' }, h('div', { class: 'pile-label' }, 'Draw', h('span', { class: 'count' }, v.stockCount)), stock),
      h('div', { class: 'pile grow' },
        h('div', { class: 'pile-label' }, 'Discard pile', h('span', { class: 'count' }, v.discard.length),
          canDraw ? h('span', { class: 'hint-inline' }, 'click any card to take it and every card above it') : null),
        v.discard.length ? disc : h('div', { class: 'card empty-slot', style: '--cw:62px;--ch:88px' }, 'Empty')));
    if (v.discard.length) fitRow(disc, 6);
  }

  function renderMelds() {
    const v = ui.view;
    const o = 1 - v.seat;
    const canLay = v.phase === 'play' && v.turn === v.seat && v.step === 'play' && ui.selected.size > 0;
    const head = h('div', { class: 'table-head' },
      h('span', { class: 'pile-label' }, 'Table'),
      h('span', { class: 'legend' }, h('i', { class: 'sw' }), 'yours', h('i', { class: 'sw opp' }), h('span', null, nm(v.names[o]), '’s')),
      canLay && v.melds.length ? h('span', { class: 'hint-inline' }, 'click a meld to lay the selected cards off on it') : null);
    const body = v.melds.length
      ? h('div', { class: 'meld-grid' }, v.melds.map((m) => h('div', {
        class: 'meld' + (canLay ? ' can' : ''),
        'data-meld': m.id,
        role: canLay ? 'button' : null,
        tabindex: canLay ? 0 : null,
        title: canLay ? `Lay off the selected cards on this ${E.meldName(m)}` : null,
        onclick: canLay ? () => layOff(m.id) : null,
        onkeydown: canLay ? (e) => { if (e.key === 'Enter') layOff(m.id); } : null,
      },
      h('div', { class: 'meld-cards' }, m.cards.map((c) => cardEl(c.id, { as: c.as, cls: c.by === v.seat ? 'mine' : 'theirs' }))),
      h('div', { class: 'meld-name' }, E.meldName(m)))))
      : h('div', { class: 'empty-table' }, 'No melds yet. Sets and runs either of you lays down show up here.');
    $('#melds').replaceChildren(head, body);
  }

  function renderStatus() {
    const v = ui.view;
    const me = v.seat;
    const o = 1 - me;
    let text;
    let tone = '';
    let extra = null;
    if (v.phase === 'handOver') text = `Hand ${v.handNo} is over.`;
    else if (v.phase === 'gameOver' && v.forfeit) text = v.forfeit.by === me ? `Game over: you forfeited, so ${v.names[o]} wins.` : `Game over: ${v.names[o]} forfeited, so you win!`;
    else if (v.phase === 'gameOver') text = `Game over: ${v.winner === me ? 'you win' : v.names[v.winner] + ' wins'}!`;
    else if (v.turn !== me) {
      text = `${v.names[o]}’s turn: ${v.step === 'draw' ? 'drawing' : 'playing'}…`;
      tone = 'wait';
    } else if (v.step === 'draw') {
      text = 'Your turn. Draw from the draw pile, or take a card from the discard pile along with every card above it.';
      tone = 'go';
    } else if (v.ti.mustPlay && v.hand.includes(v.ti.mustPlay)) {
      text = `Meld or lay off the ${E.label(v.ti.mustPlay)} before you discard. You took it from deeper in the discard pile.`;
      tone = 'must';
    } else {
      text = 'Select cards and click Meld, or click a meld on the table to lay them off. Then discard one card to end your turn.';
      tone = 'go';
      if (v.ti.topOnly && v.hand.includes(v.ti.topOnly)) extra = `You can’t discard the ${E.label(v.ti.topOnly)} this turn.`;
    }
    const over = v.phase === 'handOver' || v.phase === 'gameOver';
    const t = v.phase === 'play' && v.trade;
    const el = $('#status');
    el.className = 'status ' + tone;
    el.replaceChildren(...[
      h('span', null, text),
      extra && h('span', { class: 'status-extra' }, extra),
      t && t.from === me && h('span', { class: 'status-extra' }, `Waiting for ${v.names[o]} to answer your trade (${E.label(t.card)}).`),
      t && t.from !== me && h('button', { class: 'btn small primary', onclick: openTrade }, `🤝 Answer ${v.names[o]}’s trade`),
      over && h('button', { class: 'btn small primary', onclick: () => openSummary(true) }, v.phase === 'gameOver' ? 'Final scores' : 'Hand results'),
    ].filter(Boolean));
  }

  function renderHand() {
    if (ui.drag && ui.drag.active) { ui.drag.rerender = true; return; } // don't pull the hand out from under a drag
    const v = ui.view;
    const myTurn = v.phase === 'play' && v.turn === v.seat;
    const inHand = new Set(v.hand);
    const row = $('#hand');
    row.replaceChildren(...ui.order.filter((id) => inHand.has(id)).map((id, k) => {
      const must = myTurn && v.ti.mustPlay === id;
      const keep = myTurn && v.step === 'play' && v.ti.topOnly === id;
      const el = cardEl(id, { cls: [ui.selected.has(id) && 'sel', ui.fresh.has(id) && 'fresh', must && 'must'].filter(Boolean).join(' ') });
      el.style.setProperty('--i', k); // staggers the your-turn wave
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-pressed', String(ui.selected.has(id)));
      el.setAttribute('aria-label', E.label(id));
      if (must) el.append(h('span', { class: 'tag' }, 'must play'));
      else if (keep) el.append(h('span', { class: 'tag muted' }, 'can’t discard'));
      burnable(el, 'mine', id);
      el.addEventListener('pointerdown', (e) => startDrag(e, id, el));
      el.addEventListener('click', () => { if (!ui.dragEnded) toggleSelect(id); });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSelect(id); } });
      return el;
    }));
    fitRow(row, 8);
    renderControls();
  }

  function renderControls() {
    const v = ui.view;
    const playing = v.phase === 'play' && v.turn === v.seat && v.step === 'play';
    const n = ui.selected.size;
    const onTable = E.pointsOnTable(v.melds, v.settings)[v.seat];
    $('#controls').replaceChildren(
      h('div', { class: 'ctl-group' },
        h('span', { class: 'ctl-label' }, 'Sort'),
        h('button', { class: 'btn small', onclick: () => sortHand('suit') }, 'By suit'),
        h('button', { class: 'btn small', onclick: () => sortHand('rank') }, 'By rank'),
        h('span', { class: 'me-info' }, `You: ${plural(v.hand.length, 'card')} · ${onTable} on the table this hand · ${v.totals[v.seat]} total`)),
      h('div', { class: 'ctl-group' },
        n ? h('button', { class: 'btn ghost small', onclick: clearSelection }, `Clear (${n})`) : null,
        v.phase === 'play' && v.turn === v.seat && !v.trade
          ? h('button', { class: 'btn', disabled: n !== 1, onclick: offerTrade, title: 'Offer the selected card to swap for one of theirs' }, '🤝 Offer trade') : null,
        v.trade && v.trade.from === v.seat ? h('button', { class: 'btn', onclick: () => send({ type: 'trade-cancel' }) }, 'Cancel trade') : null,
        playing && v.ti.canUndo ? h('button', { class: 'btn', onclick: () => send({ type: 'undo' }), title: 'Take back your last play this turn' }, 'Undo') : null,
        playing ? h('button', { class: 'btn', disabled: n < 3, onclick: doMeld, title: 'Put the selected cards down as a new set or run' }, n >= 3 ? `Meld ${n} cards` : 'Meld') : null,
        playing ? h('button', { class: 'btn primary', disabled: n !== 1, onclick: doDiscard, title: 'Discard the selected card and end your turn' }, 'Discard') : null));
  }

  function renderSide() {
    const v = ui.view;
    const me = v.seat;
    const o = 1 - me;
    const cell = (x) => h('td', { class: x > 0 ? 'pos' : x < 0 ? 'neg' : null }, E.signed(x));
    $('#side-panels').replaceChildren(
      h('section', { class: 'panel' },
        h('h3', null, 'Scores', h('span', { class: 'muted' }, ` · first to ${v.settings.target}`)),
        recordLine(v),
        h('table', { class: 'scores' },
          h('thead', null, h('tr', null, h('th', null, 'Hand'), h('th', null, 'You'), h('th', null, nm(v.names[o])))),
          h('tbody', null, v.history.length
            ? v.history.map((x) => h('tr', null, h('td', null, x.hand), cell(x.score[me]), cell(x.score[o])))
            : h('tr', null, h('td', { colspan: 3, class: 'muted' }, 'Each hand’s score is added here when it ends.'))),
          h('tfoot', null, h('tr', null, h('th', null, 'Total'), h('th', null, v.totals[me]), h('th', null, v.totals[o])))),
        v.history.length ? h('button', { class: 'link', onclick: () => openHandResults(true) }, 'Last hand in detail') : null),
      h('section', { class: 'panel log' },
        h('h3', null, 'Moves'),
        h('ol', null, v.log.slice().reverse().map((e) => h('li', null, e.text)))));
  }

  // Games won at this table so far, e.g. "Games won: You 2 – 1 Alex".
  function recordLine(v) {
    const r = v.record || [0, 0];
    const me = v.seat;
    return h('div', { class: 'record' },
      h('span', { class: 'record-label' }, 'Games won'),
      h('span', { class: 'record-score' }, h('strong', null, 'You ', r[me]), ' – ', h('strong', null, r[1 - me], ' '), nm(v.names[1 - me])));
  }

  // Overlap a row of cards just enough to fit its width.
  function fitRow(row, gap) {
    const fit = () => {
      const first = row.firstElementChild;
      if (!first) return;
      const cw = first.offsetWidth;
      const n = row.children.length;
      const step = n > 1 ? Math.min(cw + gap, Math.max(10, (row.clientWidth - cw - 4) / (n - 1))) : cw + gap;
      row.style.setProperty('--ov', `${Math.floor(step - cw)}px`);
    };
    fit();
    if (!row.dataset.fit) {
      row.dataset.fit = '1';
      new ResizeObserver(fit).observe(row);
    }
  }

  function cardEl(id, opts = {}) {
    const joker = E.isJoker(id);
    const classes = ['card', joker ? 'joker' : /[HD]$/.test(id) ? 'red' : 'black'];
    if (opts.cls) classes.push(opts.cls);
    const el = h('div', { class: classes.join(' '), 'data-id': id, title: opts.title });
    if (joker) {
      const as = opts.as ? h('span', { class: 'as ' + (/[HD]/.test(opts.as.suit) ? 'red' : 'black') }, E.asLabel(opts.as)) : null;
      el.append(h('span', { class: 'idx' }, h('b', null, '★'), as), h('span', { class: 'mid joker-mid' }, 'JOKER'));
    } else {
      const rank = E.rankOf(id);
      const r = E.RANKS[rank];
      const s = E.SUIT_SYM[E.suitOf(id)];
      el.append(
        h('span', { class: 'idx' }, h('b', null, r), h('i', null, s)),
        rank > 10 ? h('span', { class: 'mid face' }, h('b', null, r), h('i', null, s)) : h('span', { class: 'mid' }, s),
        h('span', { class: 'idx br' }, h('b', null, r), h('i', null, s)));
    }
    return el;
  }

  // ---------- moves ----------

  function send(action) {
    if (!ui.net) return;
    const err = ui.net.send(action);
    if (err) toast(err, 'error');
  }

  function toggleSelect(id) {
    if (ui.selected.has(id)) ui.selected.delete(id);
    else ui.selected.add(id);
    renderHand();
    renderMelds();
  }

  function clearSelection() {
    ui.selected.clear();
    renderHand();
    renderMelds();
  }

  const selectedInOrder = () => ui.order.filter((id) => ui.selected.has(id));
  const KEEP_ONE = 'You have to keep one card to discard: you can only go out by discarding your last card.';

  function drawStock() {
    send({ type: 'draw-stock' });
  }

  function takeDiscard(i) {
    const v = ui.view;
    const n = v.discard.length - i;
    const card = v.discard[i];
    const go = () => send({ type: 'draw-discard', index: i });
    if (n === 1) { go(); return; }
    openModal({
      title: `Take ${n} cards?`,
      body: [
        h('div', { class: 'meld-cards' }, v.discard.slice(i).map((id, k) => cardEl(id, { cls: 'tiny' + (k === 0 ? ' must' : '') }))),
        h('p', null, `The ${E.label(card)} and the ${plural(n - 1, 'card')} above it go into your hand. You must meld or lay off the ${E.label(card)} this turn. If that doesn’t work out, Undo puts the cards back.`),
      ],
      actions: [
        h('button', { class: 'btn ghost', onclick: closeModal }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => { closeModal(); go(); } }, `Take ${n} cards`),
      ],
    });
  }

  function doMeld() {
    const v = ui.view;
    const cards = selectedInOrder();
    if (cards.length >= v.hand.length) { toast(KEEP_ONE, 'error'); return; }
    const res = E.meldOptions(cards, v.settings);
    if (res.error) { toast(res.error, 'error'); return; }
    choose(res.options, (choice) => send({ type: 'meld', cards, choice }));
  }

  function layOff(meldId) {
    const v = ui.view;
    const m = v.melds.find((x) => x.id === meldId);
    const cards = selectedInOrder();
    if (!m || !cards.length) return;
    if (cards.length >= v.hand.length) { toast(KEEP_ONE, 'error'); return; }
    const res = E.layoffOptions(m, cards, v.settings);
    if (res.error) { toast(res.error, 'error'); return; }
    choose(res.options, (choice) => send({ type: 'layoff', meld: meldId, cards, choice }));
  }

  function doDiscard() {
    const v = ui.view;
    if (ui.selected.size !== 1) { toast('Select exactly one card to discard.', 'error'); return; }
    const card = [...ui.selected][0];
    if (v.ti.mustPlay && v.hand.includes(v.ti.mustPlay)) {
      toast(`First meld or lay off the ${E.label(v.ti.mustPlay)}: you took it from deeper in the discard pile.`, 'error');
      return;
    }
    if (card === v.ti.topOnly) {
      toast(`You took the ${E.label(card)} from the top of the discard pile, so you have to discard a different card.`, 'error');
      return;
    }
    send({ type: 'discard', card });
  }

  // When a Joker (or an Ace) could go more than one way, ask which.
  function choose(options, done) {
    if (options.length === 1) { done(0); return; }
    const st = ui.view.settings;
    openModal({
      title: 'How do you want to play it?',
      body: h('div', { class: 'choices' }, options.map((m, i) => h('button', {
        type: 'button', class: 'choice', onclick: () => { closeModal(); done(i); },
      },
      h('div', { class: 'meld-cards' }, m.cards.map((c) => cardEl(c.id, { as: c.as, cls: 'tiny' }))),
      h('div', { class: 'choice-text' }, optionText(m, st))))),
      actions: [h('button', { class: 'btn ghost', onclick: closeModal }, 'Cancel')],
    });
  }

  function optionText(m, st) {
    const bits = [cap(E.meldName(m))];
    m.cards.forEach((c, i) => {
      if (E.isJoker(c.id)) bits.push(`Joker as ${E.asLabel(c.as)}`);
      else if (m.type === 'run' && E.rankOf(c.id) === 1) {
        const cls = E.aceClass(m, i);
        bits.push(`Ace ${cls === 'wrap' ? 'in the K-A-2 wrap' : cls}, ${plural(E.tablePoints(m, i, st), 'point')}`);
      }
    });
    return bits.join(' · ');
  }

  // ---------- poke, taunts, fake grabs, card backs & the turn cue ----------

  const fx = () => $('#fx');
  const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // A player's name in a tight spot: cut short with "…", full name on hover.
  const nm = (name) => h('span', { class: 'nm', title: name }, name);

  const oppName = () => (ui.view ? ui.view.names[1 - ui.view.seat] : 'Your friend');
  const charges = (v, seat) => {
    const a = (v.attacks && v.attacks[seat]) || {};
    return E.ATTACKS.reduce((sum, k) => sum + (a[k] || 0), (v.wild && v.wild[seat]) || 0);
  };

  function backEl(design, cls) {
    const b = BACK_BY_ID[design] || BACK_BY_ID.classic;
    const el = h('div', { class: `card back back-${b.id}${cls ? ' ' + cls : ''}` });
    if (b.emoji) el.append(h('span', { class: 'back-art', 'aria-hidden': 'true' }, b.emoji));
    else if (b.art) {
      const art = h('span', { class: 'back-art', 'aria-hidden': 'true' });
      art.innerHTML = ART[b.art];
      el.append(art);
    }
    return el;
  }

  function chooseStyle() {
    const v = ui.view;
    const current = v && v.backs ? v.backs[v.seat] : myBack();
    const grab = myGrab();
    openModal({
      title: 'Card style',
      wide: true,
      body: [
        h('h3', { class: 'modal-sub' }, 'Pick up cards with'),
        h('p', null, 'Whenever you draw, it swoops in and carries the card off. Your friend sees it too.'),
        h('div', { class: 'seg', role: 'radiogroup' }, Object.entries(GRAB_STYLES).map(([id, g]) => h('button', {
          type: 'button', role: 'radio', class: id === grab ? 'on' : null, 'aria-checked': String(id === grab),
          onclick: () => {
            store.set('r500:grab', id);
            send({ type: 'grab', grab: id });
            chooseStyle(); // redraw with the new choice highlighted
          },
        }, g.label))),
        h('h3', { class: 'modal-sub' }, 'Card back'),
        h('p', null, 'Your friend sees your hand with this design, and it’s on the draw pile on your screen.'),
        h('div', { class: 'back-grid' }, BACKS.map(({ id, name }) => h('button', {
          type: 'button', class: 'back-choice' + (id === current ? ' on' : ''), 'aria-pressed': String(id === current),
          onclick: () => {
            store.set('r500:back', id);
            closeModal();
            send({ type: 'back', back: id });
          },
        }, backEl(id), h('span', null, name)))),
      ],
      actions: [h('button', { class: 'btn ghost', onclick: closeModal }, 'Done')],
    });
  }

  function startCooldown(kind) {
    ui.cool[kind] = Date.now() + COOLDOWN[kind];
    renderOpp();
    const tick = setInterval(() => {
      if (ui.screen === 'game' && ui.view) renderOpp();
      if (Date.now() >= ui.cool[kind]) clearInterval(tick);
    }, 1000);
  }

  function poke() {
    const name = oppName();
    if (!ui.net.poke()) { toast(`${name} isn’t connected right now.`, 'error'); return; }
    toast(`You poked ${name}.`);
    startCooldown('poke');
  }

  function gotPoke(from) {
    toast(`👉 ${from} poked you!`, 'poke');
    sfx('poke');
    document.body.classList.remove('nudge');
    void document.body.offsetWidth; // restart the shake animation
    document.body.classList.add('nudge');
    if (!document.hasFocus()) flashTitle(`👉 ${from} poked you`);
  }

  function sendEmote(e) {
    if (ui.net && ui.net.emote(e)) return true;
    toast(`${oppName()} isn’t connected right now.`, 'error');
    return false;
  }

  function gotEmote(e) {
    if (!e || typeof e !== 'object' || ui.screen !== 'game' || !ui.view) return;
    if (e.kind === 'taunt' && Object.prototype.hasOwnProperty.call(TAUNT_BY_ID, e.id)) showTaunt(e.id, 'opp');
    else if (e.kind === 'fake' && ui.view.phase === 'play') playFake(e.index, true);
  }

  function doTaunt(id) {
    closeMenu();
    if (!sendEmote({ kind: 'taunt', id })) return;
    startCooldown('taunt');
    showTaunt(id, 'me');
  }

  function doFake() {
    const v = ui.view;
    if (v.phase !== 'play' || v.turn !== v.seat || !v.discard.length) return;
    const index = Math.floor(rng() * v.discard.length);
    if (!sendEmote({ kind: 'fake', index })) return;
    startCooldown('fake');
    playFake(index, false);
  }

  // Popup menus under the Taunt and Attacks buttons.
  function menuItems(kind) {
    if (kind === 'taunt') {
      return TAUNTS.map(([id, emoji, text, special]) => h('button', { type: 'button', class: 'taunt', role: 'menuitem', onclick: () => doTaunt(id) },
        tauntIcon('taunt-emoji', emoji, special), h('span', null, text)));
    }
    const mine = (ui.view.attacks && ui.view.attacks[ui.view.seat]) || {};
    const wild = (ui.view.wild && ui.view.wild[ui.view.seat]) || 0;
    return [
      wild ? h('div', { class: 'menu-note' }, `⭐ You have ${plural(wild, 'wild attack')}: spend ${wild === 1 ? 'it' : 'them'} on any of these. You earn one for every meld or lay-off.`) : null,
      ...E.ATTACKS.map((k) => h('button', { type: 'button', class: 'taunt', role: 'menuitem', disabled: !(mine[k] || wild), onclick: () => doAttack(k) },
        h('span', { class: 'taunt-emoji', 'aria-hidden': 'true' }, ATTACK_INFO[k].emoji),
        h('span', null, h('strong', null, ATTACK_INFO[k].label),
          h('span', { class: 'muted' }, mine[k] ? `: ${ATTACK_INFO[k].blurb}` : wild ? `: ${ATTACK_INFO[k].blurb} (uses your wild attack)` : ' (used)')))),
    ].filter(Boolean);
  }

  function toggleMenu(e, kind) {
    const r = e.currentTarget.getBoundingClientRect(); // before closeMenu re-renders the button
    const wasOpen = ui.menu && ui.menu.kind === kind;
    closeMenu();
    if (wasOpen) return;
    const width = Math.min(kind === 'taunt' ? 440 : 330, innerWidth - 16);
    const el = h('div', { class: `taunt-menu ${kind}-menu`, role: 'menu', 'aria-label': kind === 'taunt' ? 'Taunts' : 'Attacks' }, menuItems(kind));
    Object.assign(el.style, {
      top: `${r.bottom + 8}px`,
      left: `${Math.max(8, Math.min(r.right - width, innerWidth - width - 8))}px`,
      width: `${width}px`,
      maxHeight: `${Math.max(160, innerHeight - r.bottom - 16)}px`, // scrolls in a short window
    });
    document.body.append(el);
    ui.menu = { kind, el };
    document.addEventListener('pointerdown', menuOutside, true);
    renderOpp();
    const first = el.querySelector('button:not([disabled])');
    if (first) first.focus();
  }

  function menuOutside(e) {
    if (!ui.menu || ui.menu.el.contains(e.target) || (e.target.closest && e.target.closest('[data-menu]'))) return;
    closeMenu();
  }

  function closeMenu() {
    if (!ui.menu) return;
    ui.menu.el.remove();
    ui.menu = null;
    document.removeEventListener('pointerdown', menuOutside, true);
    if (ui.screen === 'game' && ui.view) renderOpp();
  }

  function tauntIcon(cls, emoji, special) {
    const el = h('span', { class: cls + (special ? ' art' : ''), 'aria-hidden': 'true' }, special ? null : emoji);
    if (special === 'maxibon') el.innerHTML = MAXIBON_SVG;
    return el;
  }

  // The Maxibon floats over as if it's a gift, dangles in front of the other player, then gets snatched back.
  function maxibonTease(fromOpp) {
    if (calm()) return;
    const hand = $('#hand');
    const avatar = $('#opp .avatar');
    if (!hand || !avatar) return;
    const me = hand.getBoundingClientRect();
    const them = avatar.getBoundingClientRect();
    const mine = { x: me.left + me.width / 2, y: me.top - 20 };
    const theirs = { x: them.left + them.width / 2 + 70, y: them.bottom + 60 };
    const giver = fromOpp ? theirs : mine;
    const taker = fromOpp ? mine : theirs;
    const near = { x: taker.x + (giver.x - taker.x) * 0.12, y: taker.y + (giver.y - taker.y) * 0.12 }; // just out of reach
    const treat = h('div', { class: 'maxibon', 'aria-hidden': 'true' });
    treat.innerHTML = MAXIBON_SVG;
    fx().append(treat);
    const at = (p, s, r = 0) => `translate(${p.x}px, ${p.y}px) scale(${s}) rotate(${r}deg)`;
    const T = 3400;
    treat.animate([
      { transform: at(giver, 0.4), opacity: 0 },
      { transform: at(giver, 1), opacity: 1, offset: 0.1 },
      { transform: at(near, 1.25, -6), opacity: 1, offset: 0.52 },
      { transform: at(near, 1.25, 6), opacity: 1, offset: 0.62 },
      { transform: at(near, 1.3, -4), opacity: 1, offset: 0.7 },
      { transform: at(giver, 0.9), opacity: 1, offset: 0.84 },
      { transform: at(giver, 0.4), opacity: 0 },
    ], { duration: T, easing: 'ease-in-out' }).onfinish = () => treat.remove();
    setTimeout(() => {
      sfx('whoosh');
      const label = h('div', { class: 'psych', 'aria-hidden': 'true' }, 'Psych! It’s mine 😋');
      Object.assign(label.style, { left: `${near.x}px`, top: `${near.y - 40}px` });
      fx().append(label);
      label.animate([
        { transform: 'translateY(6px) scale(0.8)', opacity: 0 },
        { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.15 },
        { transform: 'translateY(-12px)', opacity: 1, offset: 0.8 },
        { transform: 'translateY(-18px)', opacity: 0 },
      ], { duration: 1800, easing: 'ease-out' }).onfinish = () => label.remove();
    }, T * 0.7);
  }

  // A speech bubble by the opponent's avatar, or above your status line for your own taunts.
  function showTaunt(id, who) {
    const [, emoji, text, special] = TAUNT_BY_ID[id];
    const anchor = who === 'opp' ? $('#opp .avatar') : $('#status');
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const old = $(`#fx .bubble.${who}`);
    if (old) old.remove();
    const bubble = h('div', { class: 'bubble ' + who, role: 'status' },
      tauntIcon('bubble-emoji', emoji, special), h('span', null, text));
    Object.assign(bubble.style, who === 'opp'
      ? { left: `${Math.max(8, r.left - 4)}px`, top: `${r.bottom + 12}px` }
      : { left: `${Math.max(8, r.left + 16)}px`, top: `${r.top - 12}px` });
    fx().append(bubble);
    if (special === 'maxibon') maxibonTease(who === 'opp');
    else burst(emoji, r.left + (who === 'opp' ? r.width / 2 : 60), who === 'opp' ? r.top + r.height / 2 : r.top);
    sfx('taunt');
    setTimeout(() => {
      bubble.classList.add('out');
      setTimeout(() => bubble.remove(), 350);
    }, 4000);
  }

  function burst(emoji, x, y) {
    if (calm()) return;
    for (let i = 0; i < 7; i++) {
      const el = h('span', { class: 'burst', 'aria-hidden': 'true' }, emoji);
      Object.assign(el.style, { left: `${x}px`, top: `${y}px` });
      fx().append(el);
      const dx = (rng() - 0.5) * 150;
      const dy = 60 + rng() * 90;
      el.animate([
        { transform: 'translate(0, 0) scale(0.4)', opacity: 0 },
        { transform: `translate(${dx * 0.3}px, ${-dy * 0.3}px) scale(1.1)`, opacity: 1, offset: 0.25 },
        { transform: `translate(${dx}px, ${-dy}px) scale(0.9)`, opacity: 0 },
      ], { duration: 1100 + rng() * 500, delay: i * 45, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'backwards' }).onfinish = () => el.remove();
    }
  }

  // A hand reaches into the discard pile, lifts the cards, and puts them back at the last second.
  // The opponent's hand comes from the top of the screen; yours from the bottom.
  function playFake(index, fromOpp) {
    const cards = [...document.querySelectorAll('.discard .card')];
    if (!cards.length) return;
    const i = Number.isInteger(index) && index >= 0 && index < cards.length ? index : cards.length - 1;
    const r = cards[i].getBoundingClientRect();
    const next = cards[i + 1];
    const visible = next ? next.getBoundingClientRect().left - r.left : r.width;
    const x = r.left + Math.max(14, visible / 2);
    const y = r.top + r.height * 0.45;
    const lifted = cards.slice(i);
    const T = 2400;
    const later = (frac, f) => setTimeout(f, T * frac);
    later(0.48, () => lifted.forEach((c) => c.classList.add('fake-lift')));
    later(0.78, () => {
      lifted.forEach((c) => c.classList.remove('fake-lift'));
      sfx('whoosh');
      psych(x, r.top);
    });
    if (calm()) return;
    const hand = h('div', { class: 'fake-hand', 'aria-hidden': 'true' }, h('span', { class: fromOpp ? 'down' : 'up' }, '✋'));
    fx().append(hand);
    const fromX = x + 160;
    const fromY = fromOpp ? -90 : innerHeight + 90;
    const at = (px, py, s) => `translate(${px}px, ${py}px) scale(${s})`;
    hand.animate([
      { transform: at(fromX, fromY, 1), opacity: 0 },
      { transform: at(x, y, 1), opacity: 1, offset: 0.4 },
      { transform: at(x, y, 0.82), opacity: 1, offset: 0.48 },
      { transform: at(x, y - 20, 0.82), opacity: 1, offset: 0.7 },
      { transform: at(x, y, 0.9), opacity: 1, offset: 0.78 },
      { transform: at(fromX, fromY, 1), opacity: 0 },
    ], { duration: T, easing: 'ease-in-out' }).onfinish = () => hand.remove();
  }

  function psych(x, y) {
    const el = h('div', { class: 'psych', 'aria-hidden': 'true' }, 'Just kidding! 😜');
    Object.assign(el.style, { left: `${x}px`, top: `${y - 8}px` });
    fx().append(el);
    el.animate([
      { transform: 'translateY(6px) scale(0.8)', opacity: 0 },
      { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.15 },
      { transform: 'translateY(-12px)', opacity: 1, offset: 0.8 },
      { transform: 'translateY(-18px)', opacity: 0 },
    ], { duration: 1700, easing: 'ease-out' }).onfinish = () => el.remove();
  }

  // Chime, pop-up and a wave across your cards when the turn comes to you.
  function yourTurnCue() {
    sfx('turn');
    const hand = $('#hand');
    if (hand && !calm()) {
      hand.classList.remove('pulse');
      void hand.offsetWidth;
      hand.classList.add('pulse');
      setTimeout(() => hand.classList.remove('pulse'), 900 + 55 * hand.children.length);
    }
    const status = $('#status');
    if (!status) return;
    const r = status.getBoundingClientRect();
    const pill = h('div', { class: 'turn-pill', 'aria-hidden': 'true' }, 'Your turn!');
    Object.assign(pill.style, { left: `${r.left + r.width / 2}px`, top: `${r.top}px` });
    fx().append(pill);
    pill.animate([
      { transform: 'scale(0.6)', opacity: 0 },
      { transform: 'scale(1.08)', opacity: 1, offset: 0.12 },
      { transform: 'scale(1)', opacity: 1, offset: 0.2 },
      { transform: 'scale(1)', opacity: 1, offset: 0.85 },
      { transform: 'scale(0.96)', opacity: 0 },
    ], { duration: 2000, easing: 'ease-out' }).onfinish = () => pill.remove();
  }

  // ---------- picking up with a hand or foot ----------

  function pileRects() {
    const stock = $('.stock');
    return {
      stock: stock ? stock.getBoundingClientRect() : null,
      discard: [...document.querySelectorAll('.discard .card')].map((c) => c.getBoundingClientRect()),
    };
  }

  // The drawing player's chosen hand or foot swoops in and carries the card off to their side.
  function pickupCue(before) {
    const v = ui.view;
    const who = v.turn;
    const style = v.grabs && v.grabs[who];
    if (!isGrab(style) || style === 'none' || calm()) return;
    const took = v.ti.took || [];
    const from = v.ti.drew === 'stock' ? before.stock : before.discard[before.discard.length - Math.max(1, took.length)];
    const mine = who === v.seat;
    const dest = mine ? $('#hand') : $('#opp .opp-hand');
    if (!from || !dest) return;
    const d = dest.getBoundingClientRect();
    const x = from.left + Math.min(from.width, 44) / 2 + 4;
    const y = from.top + from.height * 0.45;
    const tx = Math.max(d.left + 40, d.right - 40);
    const ty = d.top + d.height / 2;
    const sx = x + 160;
    const sy = mine ? innerHeight + 90 : -90;
    const hold = mine ? -44 : 44; // the card sits past the fingertips (or toes)
    const limb = h('div', { class: 'fake-hand', 'aria-hidden': 'true' }, h('span', { class: mine ? 'up' : 'down' }, GRAB_STYLES[style].emoji));
    const card = v.ti.drew === 'discard' && took.length ? cardEl(took[0], { cls: 'carried' }) : backEl(v.backs && v.backs[v.seat], 'carried');
    card.setAttribute('aria-hidden', 'true');
    fx().append(card, limb);
    const at = (px, py, s = 1) => `translate(${px}px, ${py}px) scale(${s})`;
    const cw = 50;
    const ch = 71;
    const T = GRAB_STYLES[style].ms; // the foot takes its time
    limb.animate([
      { transform: at(sx, sy), opacity: 0 },
      { transform: at(x, y), opacity: 1, offset: 0.32 },
      { transform: at(x, y, 0.85), opacity: 1, offset: 0.42 },
      { transform: at(x, y - 6, 0.85), opacity: 1, offset: 0.52 },
      { transform: at(tx, ty, 0.85), opacity: 1, offset: 0.88 },
      { transform: at(tx, sy), opacity: 0 },
    ], { duration: T, easing: 'ease-in-out' }).onfinish = () => limb.remove();
    card.animate([
      { transform: at(x - cw / 2, y + hold - ch / 2), opacity: 0 },
      { transform: at(x - cw / 2, y + hold - ch / 2), opacity: 0, offset: 0.4 },
      { transform: at(x - cw / 2, y + hold - ch / 2), opacity: 1, offset: 0.44 },
      { transform: at(x - cw / 2, y - 6 + hold - ch / 2), opacity: 1, offset: 0.52 },
      { transform: at(tx - cw / 2, ty + hold - ch / 2), opacity: 1, offset: 0.88 },
      { transform: at(tx - cw / 2, ty + hold - ch / 2, 0.6), opacity: 0 },
    ], { duration: T, easing: 'ease-in-out' }).onfinish = () => card.remove();
  }

  // ---------- attacks ----------

  function doAttack(kind) {
    closeMenu();
    send({ type: 'attack', kind });
  }

  // Each attack plays once, when it first shows up in a view; a reload doesn't replay old ones.
  function syncAttack() {
    const la = ui.view.lastAttack;
    const n = la ? la.n : 0;
    if (ui.attackSeen === undefined || n < ui.attackSeen) { ui.attackSeen = n; return; }
    if (n === ui.attackSeen) return;
    ui.attackSeen = n;
    if (la.kind === 'peek') {
      const p = ui.view.peek;
      if (p && p.n === la.n) {
        if (la.by === ui.view.seat) peekTheirs(p.card);
        else peekMine(p.card, ui.view.names[la.by]);
      }
      return;
    }
    if (la.by === ui.view.seat) {
      const burn = la.kind === 'fire' && !calm(); // their cards burning says it all (a message would cover them)
      launchAttack(la.kind, burn);
      if (burn) setTimeout(() => startFire('theirs'), 700); // as the flame lands on them
    } else if (la.kind === 'fire') burnHand(ui.view.names[la.by]);
    else if (la.kind === 'smash') smashTable(ui.view.names[la.by]);
    else if (la.kind === 'spiders') releaseSpiders(ui.view.names[la.by]);
    else if (la.kind === 'bloom') mushroomBloom(ui.view.names[la.by]);
    else if (la.kind === 'tornado') tornado(ui.view.names[la.by]);
    else if (la.kind === 'catstorm') catStorm(ui.view.names[la.by]);
    else if (la.kind === 'gray') drainColour(ui.view.names[la.by]);
  }

  // What the attacker sees: the attack flies over to the other player.
  function launchAttack(kind, quiet) {
    const info = ATTACK_INFO[kind];
    if (!quiet) toast(`${info.emoji} ${info.sent(oppName())}`, 'poke');
    const to = $('#opp .avatar');
    if (calm() || !to) return;
    const from = ($('#attack-btn') || $('#status')).getBoundingClientRect();
    const end = to.getBoundingClientRect();
    const el = h('div', { class: 'burst', 'aria-hidden': 'true' }, info.emoji);
    Object.assign(el.style, { left: '0px', top: '0px', fontSize: '44px' });
    fx().append(el);
    const x0 = from.left + from.width / 2;
    const y0 = from.top + from.height / 2;
    const x1 = end.left + end.width / 2;
    const y1 = end.top + end.height / 2;
    el.animate([
      { transform: `translate(${x0}px, ${y0}px) scale(0.6)`, opacity: 0 },
      { transform: `translate(${(x0 + x1) / 2}px, ${Math.max(y0, y1) + 70}px) scale(1.5)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${x1}px, ${y1}px) scale(0.7)`, opacity: 0 },
    ], { duration: 900, easing: 'ease-in-out' }).onfinish = () => el.remove();
  }

  // The table cracks down the middle, both halves fall off the screen, and it's rebuilt.
  function smashTable(name) {
    const board = $('.board');
    const msg = `💥 ${name} smashed your table!`;
    sfx('crack');
    if (!board || calm() || board.dataset.smashed) { toast(msg, 'poke'); return; }
    board.dataset.smashed = '1';
    const r = board.getBoundingClientRect();
    const w = r.width;
    const ht = r.height;
    const n = 14;
    const pts = Array.from({ length: n + 1 }, (_, i) => [w / 2 + (i === 0 || i === n ? 0 : (rng() - 0.5) * 80), (ht * i) / n]);
    const crackLine = pts.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`);
    const place = (el) => Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${w}px`, height: `${ht}px` });
    const hole = h('div', { class: 'smash-void', 'aria-hidden': 'true' });
    place(hole);
    const half = (clip) => {
      const c = board.cloneNode(true);
      c.removeAttribute('id');
      c.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
      c.classList.add('board-half');
      c.setAttribute('aria-hidden', 'true');
      place(c);
      Object.assign(c.style, { clipPath: clip, transformOrigin: `${w / 2}px ${ht}px` });
      return c;
    };
    const left = half(`polygon(0px 0px, ${crackLine.join(', ')}, 0px ${ht}px)`);
    const right = half(`polygon(${w}px 0px, ${w}px ${ht}px, ${crackLine.slice().reverse().join(', ')})`);
    const ns = 'http://www.w3.org/2000/svg';
    const crack = document.createElementNS(ns, 'svg');
    crack.setAttribute('class', 'crack');
    crack.setAttribute('viewBox', `0 0 ${w} ${ht}`);
    place(crack);
    const line = document.createElementNS(ns, 'polyline');
    line.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
    crack.append(line);
    fx().append(hole, left, right, crack);
    board.style.visibility = 'hidden';
    const len = ht * 1.4;
    line.style.strokeDasharray = `${len}`;
    line.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 280, easing: 'ease-out', fill: 'forwards' });
    crack.animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: 650, fill: 'forwards' });
    const game = $('.game');
    if (game) {
      game.animate([
        { transform: 'translate(0, 0)' }, { transform: 'translate(-10px, 5px)' }, { transform: 'translate(9px, -6px)' },
        { transform: 'translate(-5px, 3px)' }, { transform: 'translate(0, 0)' },
      ], { duration: 420 });
    }
    const fall = (el, dir) => el.animate([
      { transform: 'translate(0, 0) rotate(0deg)' },
      { transform: `translate(${dir * 16}px, 8px) rotate(${dir * 5}deg)`, offset: 0.22 },
      { transform: `translate(${dir * 140}px, ${innerHeight + ht}px) rotate(${dir * 38}deg)` },
    ], { duration: 1600, delay: 320, easing: 'cubic-bezier(.5,0,.9,.5)', fill: 'forwards' });
    fall(left, -1);
    fall(right, 1);
    const label = h('div', { class: 'attack-label', role: 'status' }, msg);
    Object.assign(label.style, { left: `${r.left + w / 2}px`, top: `${r.top + ht / 2}px` });
    setTimeout(() => {
      fx().append(label);
      label.animate([{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 250, easing: 'ease-out' });
    }, 900);
    setTimeout(() => {
      [hole, left, right, crack, label].forEach((el) => el.remove());
      board.style.visibility = '';
      delete board.dataset.smashed;
      board.animate([{ opacity: 0, transform: 'scale(0.94)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 500, easing: 'cubic-bezier(.2,1.3,.4,1)' });
    }, 2800);
  }

  const SPIDER_SVG = '<svg viewBox="-20 -20 40 40" aria-hidden="true"><g class="legs" fill="none" stroke="#1d1712" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M-2.5 -3L-9 -9L-12 -17"/><path d="M-3 -1L-11 -4L-18 -7"/><path d="M-3 1.5L-11 4L-17 9"/><path d="M-2.5 3.5L-8 10L-11 17"/><path d="M2.5 -3L9 -9L12 -17"/><path d="M3 -1L11 -4L18 -7"/><path d="M3 1.5L11 4L17 9"/><path d="M2.5 3.5L8 10L11 17"/></g><ellipse cx="0" cy="-5" rx="3.4" ry="3.8" fill="#1d1712"/><ellipse cx="0" cy="4.5" rx="5.4" ry="7" fill="#2a1f17"/><path d="M-2 2Q0 4 2 2M-2 6Q0 8 2 6" fill="none" stroke="#6b3b2a" stroke-width=".8"/><circle cx="-1.3" cy="-7.2" r=".8" fill="#ff4a3d"/><circle cx="1.3" cy="-7.2" r=".8" fill="#ff4a3d"/></svg>';

  function spiderEl(size) {
    const el = h('div', { class: 'spider', 'aria-hidden': 'true' });
    el.innerHTML = SPIDER_SVG;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    return el;
  }

  // A route from one screen edge, through a few random points, off another edge.
  function wanderPath() {
    const W = innerWidth;
    const H = innerHeight;
    const edge = () => {
      const t = rng();
      return [[t * W, -40], [W + 40, t * H], [t * W, H + 40], [-40, t * H]][Math.floor(rng() * 4)];
    };
    const pts = [edge()];
    const stops = 3 + Math.floor(rng() * 2);
    for (let k = 0; k < stops; k++) pts.push([W * (0.08 + rng() * 0.84), H * (0.1 + rng() * 0.8)]);
    pts.push(edge());
    return pts;
  }

  // Three spiders drop down on threads while a swarm scuttles across the screen.
  function releaseSpiders(name) {
    sfx('skitter');
    toast(`🕷️ ${name} released spiders on you!`, 'poke');
    if (calm()) return;
    const W = innerWidth;
    const H = innerHeight;
    for (let i = 0; i < 3; i++) {
      const x = W * (0.22 + 0.28 * i) + (rng() - 0.5) * 80;
      const drop = H * (0.22 + rng() * 0.3);
      const timing = { duration: 4300 + rng() * 700, delay: i * 300, easing: 'ease-in-out', fill: 'backwards' };
      const thread = h('div', { class: 'thread', 'aria-hidden': 'true' });
      thread.style.left = `${x}px`;
      const sp = spiderEl(42 + rng() * 12);
      fx().append(thread, sp);
      const at = (y, offset) => ({ transform: `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(180deg)`, offset });
      thread.animate([
        { height: '0px' }, { height: `${drop}px`, offset: 0.25 }, { height: `${drop - 22}px`, offset: 0.45 },
        { height: `${drop}px`, offset: 0.62 }, { height: `${drop}px`, offset: 0.8 }, { height: '0px' },
      ], timing).onfinish = () => thread.remove();
      sp.animate([at(-30, 0), at(drop, 0.25), at(drop - 22, 0.45), at(drop, 0.62), at(drop, 0.8), at(-30, 1)], timing)
        .onfinish = () => sp.remove();
    }
    for (let i = 0; i < 10; i++) {
      const sp = spiderEl(24 + rng() * 20);
      fx().append(sp);
      const pts = wanderPath();
      let prevAngle = null;
      const frames = pts.map(([x, y], k) => {
        const [ax, ay] = pts[Math.max(0, k - 1)];
        const [bx, by] = pts[Math.min(pts.length - 1, k + 1)];
        let angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI + 90; // the drawing faces up
        if (prevAngle !== null) {
          while (angle - prevAngle > 180) angle -= 360;
          while (prevAngle - angle > 180) angle += 360;
        }
        prevAngle = angle;
        return { transform: `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${angle}deg)` };
      });
      sp.animate(frames, { duration: 3400 + rng() * 2400, delay: rng() * 1500, easing: 'linear', fill: 'backwards' })
        .onfinish = () => sp.remove();
    }
  }

  // Toadstools, morels, chanterelles and porcini pop up all over the table, then wilt.
  function mushroomBloom(name) {
    sfx('pop');
    toast(`🍄 ${name} made mushrooms sprout all over your table!`, 'poke');
    if (calm()) return;
    const area = ($('.board') || document.body).getBoundingClientRect();
    const kinds = ['emoji', 'morel', 'chanterelle', 'porcini'];
    for (let i = 0; i < 28; i++) {
      const kind = kinds[i % kinds.length];
      const size = 34 + rng() * 46;
      const el = h('div', { class: 'sprout', 'aria-hidden': 'true' });
      if (kind === 'emoji') {
        el.textContent = '🍄';
        el.style.fontSize = `${size * 0.85}px`;
      } else {
        el.innerHTML = ART[kind];
      }
      Object.assign(el.style, {
        left: `${area.left + rng() * area.width}px`,
        top: `${area.top + area.height * (0.12 + rng() * 0.88)}px`,
        width: `${size}px`,
        height: `${size}px`,
      });
      fx().append(el);
      const tilt = (rng() - 0.5) * 18;
      el.animate([
        { transform: 'translate(-50%, -100%) scale(0)', opacity: 0 },
        { transform: `translate(-50%, -100%) scale(1.18) rotate(${tilt}deg)`, opacity: 1, offset: 0.12 },
        { transform: `translate(-50%, -100%) scale(1) rotate(${-tilt / 2}deg)`, opacity: 1, offset: 0.2 },
        { transform: `translate(-50%, -100%) scale(1) rotate(${tilt / 3}deg)`, opacity: 1, offset: 0.82 },
        { transform: 'translate(-50%, -100%) scale(0.2)', opacity: 0 },
      ], { duration: 4300, delay: rng() * 1000, easing: 'ease-out', fill: 'backwards' }).onfinish = () => el.remove();
    }
  }

  // A twister crosses the table, whipping up the cards it passes and dropping them back in place.
  function tornado(name) {
    sfx('wind');
    toast(`🌪️ ${name} sent a tornado through your table, and it scrambled your hand!`, 'poke');
    const boardEl = $('.board');
    if (calm() || !boardEl) return;
    const b = boardEl.getBoundingClientRect();
    const ltr = rng() < 0.5;
    const x0 = ltr ? b.left - 160 : b.right + 160;
    const x1 = ltr ? b.right + 160 : b.left - 160;
    const baseY = b.bottom - 20;
    const T = 4600;
    const funnel = h('div', { class: 'tornado', 'aria-hidden': 'true' }, h('span', null, '🌪️'));
    fx().append(funnel);
    funnel.animate([
      { transform: `translate(${x0}px, ${baseY}px)` },
      { transform: `translate(${(x0 + x1) / 2}px, ${baseY - 24}px)`, offset: 0.5 },
      { transform: `translate(${x1}px, ${baseY}px)` },
    ], { duration: T, easing: 'linear' }).onfinish = () => funnel.remove();
    const speed = (x1 - x0) / T;
    const when = (r) => (r.left + r.width / 2 - x0) / (x1 - x0); // how far along the funnel is when it reaches r
    document.querySelectorAll('.discard .card, .meld .card').forEach((card) => {
      const r = card.getBoundingClientRect();
      const t = when(r);
      if (t > 0 && t < 1) setTimeout(() => whirl(card, r, speed), t * T);
    });
    const hand = $('#hand');
    if (hand) setTimeout(scrambleHand, Math.min(0.9, Math.max(0.1, when(hand.getBoundingClientRect()))) * T);
    const game = $('.game');
    if (game) {
      game.animate([...Array.from({ length: 14 }, (_, i) => ({ transform: i % 2 ? 'translate(3px, -2px)' : 'translate(-3px, 2px)' })), { transform: 'none' }],
        { duration: T, easing: 'linear' });
    }
  }

  // Lift one card into the wind, spin it round, and set it back down where it was.
  function whirl(card, r, speed) {
    if (!card.isConnected) return;
    const ghost = card.cloneNode(true);
    ghost.classList.remove('sel', 'fresh', 'placeholder', 'landing', 'whisked');
    ghost.classList.add('whirled');
    Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, translate: 'none' });
    ghost.style.setProperty('--cw', `${r.width}px`);
    ghost.style.setProperty('--ch', `${r.height}px`);
    fx().append(ghost);
    card.classList.add('whisked');
    const D = 1700;
    const drift = speed * D * 0.35;
    const spin = (rng() < 0.5 ? -360 : 360) * (1 + Math.floor(rng() * 2)); // whole turns, so it lands upright
    const lift = 140 + rng() * 120;
    const done = () => { ghost.remove(); card.classList.remove('whisked'); };
    ghost.animate([
      { transform: 'translate(0, 0) rotate(0deg)' },
      { transform: `translate(${drift * 0.5 + 30}px, ${-lift * 0.6}px) rotate(${spin * 0.35}deg)`, offset: 0.25 },
      { transform: `translate(${drift - 30}px, ${-lift}px) rotate(${spin * 0.65}deg)`, offset: 0.5 },
      { transform: `translate(${drift * 0.6 + 20}px, ${-lift * 0.5}px) rotate(${spin * 0.85}deg)`, offset: 0.72 },
      { transform: `translate(0, 0) rotate(${spin}deg)` },
    ], { duration: D, easing: 'ease-in-out' }).onfinish = done;
    setTimeout(done, D + 800); // in case the animation can't run
  }

  // Your hand fades to black and white for 30 seconds (the suit symbols still show).
  let greyTimer = null;
  function drainColour(name) {
    sfx('drain');
    toast(`🌫️ ${name} drained the colour from your hand for 30 seconds!`, 'poke');
    const hand = $('#hand');
    if (!hand) return;
    hand.classList.add('greyed');
    clearTimeout(greyTimer);
    greyTimer = setTimeout(() => {
      const el = $('#hand');
      if (el) el.classList.remove('greyed');
      toast('🎨 Your colours are back.');
    }, 30000);
  }

  // The tornado scoops up your whole hand and drops it back in a random order.
  function scrambleHand() {
    const row = $('#hand');
    if (!row || !ui.view || (ui.drag && ui.drag.active)) return;
    const before = new Map([...row.children].map((c) => [c.dataset.id, c.getBoundingClientRect()]));
    const inHand = new Set(ui.view.hand);
    const cards = ui.order.filter((id) => inHand.has(id));
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    ui.order = cards.concat(ui.order.filter((id) => !inHand.has(id)));
    saveOrder();
    renderHand();
    const D = 1900;
    [...row.children].forEach((el) => {
      const from = before.get(el.dataset.id);
      if (!from) return;
      const to = el.getBoundingClientRect();
      const ghost = el.cloneNode(true);
      ghost.classList.remove('sel', 'fresh', 'whisked');
      ghost.classList.add('whirled');
      Object.assign(ghost.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, translate: 'none' });
      fx().append(ghost);
      el.classList.add('whisked');
      const dx = to.left - from.left;
      const dy = to.top - from.top;
      const lift = 160 + rng() * 140;
      const spin = (rng() < 0.5 ? -360 : 360) * (1 + Math.floor(rng() * 2));
      const swirl = (rng() - 0.5) * 240;
      const done = () => { ghost.remove(); el.classList.remove('whisked'); };
      ghost.animate([
        { transform: 'translate(0, 0) rotate(0deg)' },
        { transform: `translate(${swirl}px, ${-lift * 0.7}px) rotate(${spin * 0.35}deg)`, offset: 0.3 },
        { transform: `translate(${dx * 0.5 - swirl}px, ${-lift}px) rotate(${spin * 0.7}deg)`, offset: 0.6 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${spin}deg)` },
      ], { duration: D, delay: rng() * 250, easing: 'ease-in-out', fill: 'backwards' }).onfinish = done;
      setTimeout(done, D + 1000); // in case the animation can't run
    });
  }

  const CAT_EMOJI = ['🐱', '🐈', '😺', '😸', '😹', '😻', '🙀', '😼'];

  // The sky darkens, lightning flashes, and it rains cats.
  function catStorm(name) {
    sfx('catstorm');
    toast(`🐈 ${name} made it rain cats on you!`, 'poke');
    if (calm()) return;
    const W = innerWidth;
    const H = innerHeight;
    const clouds = h('div', { class: 'storm', 'aria-hidden': 'true' });
    const flash = h('div', { class: 'flash', 'aria-hidden': 'true' });
    fx().append(clouds, flash);
    clouds.animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration: 5600 }).onfinish = () => clouds.remove();
    flash.animate([{ opacity: 0 }, { opacity: 0.85, offset: 0.06 }, { opacity: 0.1, offset: 0.16 }, { opacity: 0.7, offset: 0.24 }, { opacity: 0 }],
      { duration: 1000 }).onfinish = () => flash.remove();
    const drawn = ['mushcat', 'blackcat', 'whitecat'];
    for (let i = 0; i < 46; i++) {
      const size = 30 + rng() * 50;
      const el = h('div', { class: 'falling-cat', 'aria-hidden': 'true' });
      if (i % 4 === 3) el.innerHTML = ART[drawn[Math.floor(rng() * drawn.length)]];
      else el.textContent = CAT_EMOJI[Math.floor(rng() * CAT_EMOJI.length)];
      Object.assign(el.style, { width: `${size}px`, height: `${size}px`, fontSize: `${size * 0.85}px` });
      fx().append(el);
      const x = rng() * W;
      const drift = (rng() - 0.3) * 160; // the storm blows them a little to the right
      el.animate([
        { transform: `translate(${x}px, ${-size - 20}px) rotate(0deg)` },
        { transform: `translate(${x + drift}px, ${H + size}px) rotate(${(rng() - 0.5) * 720}deg)` },
      ], { duration: 1600 + rng() * 1800, delay: 300 + rng() * 3200, easing: 'cubic-bezier(.4,0,.8,.6)', fill: 'backwards' }).onfinish = () => el.remove();
    }
  }

  // ---------- fire ----------
  // Flames catch on one card and spread along the hand. Each card chars from the bottom up, the whole hand
  // smoulders, crumbles to ash, and a moment later grows back (a little singed). The char and flames are
  // drawn inside the cards (see burnable), so the hand can redraw mid-fire without losing its place.

  // You're the target: a warm glow comes up from the bottom of the screen while your hand burns.
  function burnHand(name) {
    toast(`🔥 ${name} set your cards on fire!`, 'poke');
    if (calm()) { sfx('fire', 2); scorch(); return; }
    const secs = startFire('mine');
    if (!secs) return;
    const heat = h('div', { class: 'burn-heat', 'aria-hidden': 'true' });
    fx().append(heat);
    const T = secs * 1000 + 600;
    heat.animate([{ opacity: 0 }, { opacity: 1, offset: 400 / T }, { opacity: 1, offset: (T - 900) / T }, { opacity: 0 }], { duration: T })
      .onfinish = () => heat.remove();
  }

  // Sets one side's cards alight; returns how long they burn before crumbling, in seconds.
  function startFire(side) {
    if (ui.screen !== 'game' || !ui.view || ui.fire[side]) return 0; // one fire at a time
    const v = ui.view;
    const mine = side === 'mine';
    const box = mine ? $('#hand') : $('#opp');
    const keys = mine ? ui.order.filter((id) => v.hand.includes(id)) : [...Array(v.counts[1 - v.seat]).keys()];
    if (!box || !keys.length || (!mine && v.phase !== 'play')) return 0;
    const first = Math.floor(rng() * keys.length); // where it catches
    const step = Math.min(140, FIRE.spread / Math.max(1, keys.length - 1));
    const delays = Object.fromEntries(keys.map((k, i) => [k, Math.round(Math.abs(i - first) * step)]));
    const fire = { t0: Date.now(), delays };
    ui.fire[side] = fire;
    const redraw = () => { if (ui.screen === 'game' && ui.view) (mine ? renderHand : renderOpp)(); };
    redraw();
    const crumbleAt = Math.max(...Object.values(delays)) + FIRE.burn + FIRE.hold;
    sfx('fire', crumbleAt / 1000);
    const soon = (ms, fn) => setTimeout(() => { if (ui.fire[side] === fire) fn(); }, ms);
    soon(crumbleAt, () => {
      box.classList.add('crumbling');
      sfx('ash');
      ashes(box, mine);
    });
    soon(crumbleAt + FIRE.crumble + FIRE.gone, () => {
      ui.fire[side] = null;
      box.classList.remove('crumbling');
      box.classList.add('reborn');
      redraw();
      sfx('reborn');
      if (mine) scorch();
      setTimeout(() => box.classList.remove('reborn'), FIRE.reborn + 45 * keys.length);
    });
    return crumbleAt / 1000;
  }

  // Adds the fire's char and flames to a card, picking up the burn wherever it's got to.
  function burnable(el, side, key) {
    const f = ui.fire[side];
    const d = f && f.delays[key];
    if (d == null) return el;
    el.classList.add('burning');
    el.append(h('span', { class: 'burn-char', 'aria-hidden': 'true', style: `--d:${Math.round(d - (Date.now() - f.t0))}ms;--burn:${FIRE.burn}ms` },
      h('span', { class: 'burn-flames' }, h('span', null, '🔥'), h('span', null, '🔥'), h('span', null, '🔥'))));
    return el;
  }

  // As the hand crumbles: ash drifts down, embers float up, and (on your own hand) smoke rises.
  function ashes(box, big) {
    box.querySelectorAll('.card').forEach((card) => {
      const r = card.getBoundingClientRect();
      const bit = (cls, x, y, frames, ms) => {
        const el = h('div', { class: cls, 'aria-hidden': 'true' });
        fx().append(el);
        el.animate(frames.map(([dx, dy, s, o, rot = 0]) => ({ transform: `translate(${x + dx}px, ${y + dy}px) scale(${s}) rotate(${rot}deg)`, opacity: o })),
          { duration: ms, delay: rng() * 250, easing: 'ease-out', fill: 'backwards' }).onfinish = () => el.remove();
      };
      const spot = () => [r.left + rng() * r.width, r.top + r.height * (0.3 + rng() * 0.7)];
      for (let i = 0; i < (big ? 6 : 3); i++) {
        const [x, y] = spot();
        const drift = (rng() - 0.5) * 60;
        bit('burn-ash', x, y, [[0, 0, 1, 0.9], [drift * 0.5, 30, 1, 0.8, 120], [drift, 70 + rng() * 50, 0.7, 0, 260]], 1100 + rng() * 700);
      }
      for (let i = 0; i < (big ? 3 : 2); i++) {
        const [x, y] = spot();
        const sway = (rng() - 0.5) * 50;
        bit('burn-ember', x, y, [[0, 0, 1, 1], [sway, -50, 0.9, 1], [-sway * 0.4, -110 - rng() * 60, 0.4, 0]], 900 + rng() * 700);
      }
      if (big) {
        bit('burn-smoke', r.left + r.width / 2, r.top + r.height / 2,
          [[0, 0, 0.5, 0.7], [(rng() - 0.5) * 40, -120 - rng() * 60, 2.2, 0]], 1800 + rng() * 600);
      }
    });
  }

  // Your cards keep singed edges for a while after the fire.
  let scorchTimer = null;
  function scorch() {
    const hand = $('#hand');
    if (!hand) return;
    hand.classList.add('scorched');
    clearTimeout(scorchTimer);
    scorchTimer = setTimeout(() => { const el = $('#hand'); if (el) el.classList.remove('scorched'); }, FIRE.scorch);
  }

  // When someone melds or lays off, their hand or foot carries the cards onto the table.
  function playCue(prev, handBefore) {
    const v = ui.view;
    const who = v.turn;
    const style = v.grabs && v.grabs[who];
    if (!isGrab(style) || style === 'none' || calm()) return;
    const had = new Map(prev.melds.map((m) => [m.id, new Set(m.cards.map((c) => c.id))]));
    const meld = v.melds.find((m) => m.cards.some((c) => !had.has(m.id) || !had.get(m.id).has(c.id)));
    if (!meld) return;
    const added = meld.cards.filter((c) => !had.has(meld.id) || !had.get(meld.id).has(c.id)).map((c) => c.id);
    const meldEl = document.querySelector(`.meld[data-meld="${meld.id}"]`);
    const placed = meldEl ? added.map((id) => meldEl.querySelector(`.card[data-id="${id}"]`)).filter(Boolean) : [];
    if (!placed.length) return;
    const mine = who === v.seat;
    const src = mine && handBefore[added[0]] ? handBefore[added[0]] : ($('#opp .opp-hand') || $('#opp')).getBoundingClientRect();
    const dst = placed[0].getBoundingClientRect();
    const fx0 = src.left + Math.min(src.width, 60) / 2;
    const fy0 = src.top + src.height / 2;
    const tx = dst.left + dst.width / 2;
    const ty = dst.top + dst.height / 2;
    const sy = mine ? innerHeight + 90 : -90;
    const hold = mine ? -44 : 44;
    const T = GRAB_STYLES[style].ms;
    placed.forEach((c) => c.classList.add('arriving'));
    const limb = h('div', { class: 'fake-hand', 'aria-hidden': 'true' }, h('span', { class: mine ? 'up' : 'down' }, GRAB_STYLES[style].emoji));
    const fan = h('div', { class: 'carried-fan', 'aria-hidden': 'true' }, added.map((id) => cardEl(id, { cls: 'tiny' })));
    fx().append(fan, limb);
    const at = (px, py, s = 1) => `translate(${px}px, ${py}px) scale(${s})`;
    limb.animate([
      { transform: at(fx0 + 120, sy), opacity: 0 },
      { transform: at(fx0, fy0), opacity: 1, offset: 0.25 },
      { transform: at(fx0, fy0, 0.85), opacity: 1, offset: 0.32 },
      { transform: at(tx, ty, 0.85), opacity: 1, offset: 0.7 },
      { transform: at(tx, ty + (mine ? 6 : -6), 0.85), opacity: 1, offset: 0.78 },
      { transform: at(tx, sy), opacity: 0 },
    ], { duration: T, easing: 'ease-in-out' }).onfinish = () => limb.remove();
    fan.animate([
      { transform: at(fx0, fy0 + hold), opacity: 0 },
      { transform: at(fx0, fy0 + hold), opacity: 0, offset: 0.3 },
      { transform: at(fx0, fy0 + hold), opacity: 1, offset: 0.33 },
      { transform: at(tx, ty + hold * 0.3), opacity: 1, offset: 0.7 },
      { transform: at(tx, ty), opacity: 0, offset: 0.76 },
      { transform: at(tx, ty), opacity: 0 },
    ], { duration: T, easing: 'ease-in-out' }).onfinish = () => fan.remove();
    const reveal = () => placed.forEach((c) => c.classList.remove('arriving'));
    setTimeout(reveal, T * 0.72);
  }

  // ---------- mirror peek ----------

  const seenKey = (v) => `${v.gameNo}:${v.handNo}`;

  // Cards you've spotted this hand that could still be in their hand (not since played, discarded or traded to you).
  function seenCards(v) {
    const saved = store.get('r500:seen:' + ui.code);
    if (!saved || saved.key !== seenKey(v)) return [];
    const gone = new Set([...v.discard, ...v.hand, ...v.melds.flatMap((m) => m.cards.map((c) => c.id))]);
    return saved.cards.filter((id) => !gone.has(id));
  }

  function rememberSeen(card) {
    const v = ui.view;
    const saved = store.get('r500:seen:' + ui.code);
    const cards = saved && saved.key === seenKey(v) ? saved.cards : [];
    if (!cards.includes(card)) cards.push(card);
    store.set('r500:seen:' + ui.code, { key: seenKey(v), cards });
  }

  function mirrorEl(card) {
    return h('div', { class: 'mirror', 'aria-hidden': 'true' },
      h('div', { class: 'mirror-glass' }, cardEl(card, { cls: 'reflected' }), h('span', { class: 'mirror-shine' })));
  }

  const mirrorFrames = [
    { transform: 'translate(-50%, -30%) scale(0.6)', opacity: 0 },
    { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.15 },
    { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.8 },
    { transform: 'translate(-50%, -40%) scale(0.9)', opacity: 0 },
  ];

  // A gilt mirror rises behind their hand and reflects one card (back to front, as mirrors do);
  // then the card flips out to you the right way round. A note by their name keeps it for the hand.
  function peekTheirs(card) {
    const name = oppName();
    sfx('shimmer');
    rememberSeen(card);
    renderOpp();
    toast(`🔍 In the mirror: ${name} is holding the ${E.label(card)}.`, 'poke');
    const strip = $('#opp .opp-hand');
    const boardEl = $('.board');
    if (calm() || !strip || !boardEl) return;
    const r = strip.getBoundingClientRect();
    const cx = r.left + Math.min(r.width, 320) / 2;
    const cy = r.top + r.height / 2 + 70;
    const mirror = mirrorEl(card);
    Object.assign(mirror.style, { left: `${cx}px`, top: `${cy}px` });
    fx().append(mirror);
    mirror.animate(mirrorFrames, { duration: 4200, easing: 'ease-out' }).onfinish = () => mirror.remove();
    const b = boardEl.getBoundingClientRect();
    const tx = b.left + b.width / 2;
    const ty = b.top + b.height * 0.48;
    const pop = h('div', { class: 'peek-pop', 'aria-hidden': 'true' }, cardEl(card), h('div', { class: 'peek-label' }, `👀 ${name} has the ${E.label(card)}`));
    fx().append(pop);
    const at = (x, y, s, turn) => `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s}) rotateY(${turn}deg)`;
    pop.animate([
      { transform: at(cx, cy, 0.5, 180), opacity: 0 },
      { transform: at(cx, cy, 0.6, 180), opacity: 0, offset: 0.25 },
      { transform: at(tx, ty, 1.35, 0), opacity: 1, offset: 0.45 },
      { transform: at(tx, ty, 1.35, 0), opacity: 1, offset: 0.88 },
      { transform: at(tx, ty, 1.2, 0), opacity: 0 },
    ], { duration: 5200, easing: 'ease-in-out' }).onfinish = () => pop.remove();
  }

  // What the other player sees: the same mirror behind their own hand, and the spotted card glows.
  function peekMine(card, name) {
    sfx('shimmer');
    toast(`🔍 ${name} spotted your ${E.label(card)} in a mirror!`, 'poke');
    const el = $(`#hand .card[data-id="${card}"]`);
    if (el) {
      el.classList.add('spotted');
      setTimeout(() => { const now = $(`#hand .card[data-id="${card}"]`); if (now) now.classList.remove('spotted'); }, 4000);
    }
    const handEl = $('#hand');
    if (calm() || !handEl) return;
    const hr = handEl.getBoundingClientRect();
    const target = el ? el.getBoundingClientRect() : hr;
    const mirror = mirrorEl(card);
    Object.assign(mirror.style, { left: `${target.left + target.width / 2}px`, top: `${hr.top - 90}px` });
    fx().append(mirror);
    mirror.animate(mirrorFrames, { duration: 4200, easing: 'ease-out' }).onfinish = () => mirror.remove();
  }

  // ---------- rearranging your hand ----------
  // Press on a card and drag: it lifts off and the other cards slide aside to show where it will land.

  function startDrag(e, id, el) {
    if (e.button !== 0 || ui.drag) return;
    ui.drag = { id, el, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, active: false };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
  }

  function onDragMove(e) {
    const d = ui.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return; // still a click
      const r = d.el.getBoundingClientRect();
      d.active = true;
      d.offX = d.x0 - r.left;
      d.offY = d.y0 - r.top;
      d.ghost = d.el.cloneNode(true);
      d.ghost.className = 'card drag-ghost ' + (E.isJoker(d.id) ? 'joker' : /[HD]$/.test(d.id) ? 'red' : 'black');
      d.ghost.style.cssText = `width:${d.el.offsetWidth}px;height:${d.el.offsetHeight}px`;
      document.body.append(d.ghost);
      d.el.classList.add('placeholder');
      $('#hand').classList.add('dragging');
    }
    e.preventDefault();
    d.ghost.style.transform = `translate(${e.clientX - d.offX}px, ${e.clientY - d.offY}px) rotate(4deg)`;
    const row = $('#hand');
    const cards = [...row.children].filter((c) => c !== d.el);
    const cw = d.el.offsetWidth;
    const ov = parseFloat(row.style.getPropertyValue('--ov'));
    const step = cw + (Number.isFinite(ov) ? ov : 8);
    const x = e.clientX - row.getBoundingClientRect().left;
    // Land in front of the first card whose visible middle is right of the pointer.
    const before = cards.find((c, i) => x < c.offsetLeft + (i === cards.length - 1 ? cw : step) / 2) || null;
    if (d.el.nextElementSibling !== before) flipMove(row, () => row.insertBefore(d.el, before));
  }

  // Move cards in the DOM, then slide each from where it was to where it is now.
  function flipMove(row, mutate) {
    const kids = [...row.children];
    const first = kids.map((c) => c.offsetLeft);
    mutate();
    const moved = [];
    kids.forEach((c, i) => {
      const dx = first[i] - c.offsetLeft;
      if (!dx) return;
      c.style.transition = 'none';
      c.style.translate = `${dx}px 0`;
      moved.push(c);
    });
    if (!moved.length) return;
    void row.offsetWidth;
    moved.forEach((c) => {
      c.style.transition = '';
      c.style.translate = '';
    });
  }

  function onDragEnd(e) {
    const d = ui.drag;
    if (!d || (e && e.pointerId !== d.pointerId)) return;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
    ui.drag = null;
    if (!d.active) return; // a plain click: the click handler selects the card
    $('#hand').classList.remove('dragging');
    ui.dragEnded = true; // swallow the click that follows the drop
    setTimeout(() => { ui.dragEnded = false; }, 0);
    const shown = [...$('#hand').children].map((c) => c.dataset.id);
    ui.order = shown.concat(ui.order.filter((id) => !shown.includes(id)));
    saveOrder();
    renderHand();
    const landed = $(`#hand .card[data-id="${d.id}"]`);
    if (!landed) { d.ghost.remove(); return; }
    landed.classList.add('landing');
    const r = landed.getBoundingClientRect();
    const done = () => { d.ghost.remove(); landed.classList.remove('landing'); };
    d.ghost.animate([{ transform: d.ghost.style.transform }, { transform: `translate(${r.left}px, ${r.top}px) rotate(0deg)` }], { duration: 130, easing: 'ease-out' })
      .onfinish = done;
    setTimeout(done, 400); // in case the animation can't run
  }

  // ---------- video chat ----------
  // Each of you turns your camera on; once both are on, the guest calls the host over PeerJS
  // (always that way round, so the two never call each other at once).

  const video = { local: null, remote: null, call: null, peerOn: false, mic: true, cam: true, starting: false };

  async function startVideo() {
    if (video.local || video.starting) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('This browser can’t use a camera on this page.', 'error');
      return;
    }
    video.starting = true;
    renderVideo();
    try {
      video.local = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      video.mic = true;
      video.cam = true;
    } catch (err) {
      const blocked = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      toast(blocked
        ? 'Camera access is blocked. Allow the camera and microphone for this site (look for the camera icon in the address bar), then try again.'
        : `Couldn’t start your camera (${(err && err.name) || 'unknown error'}).`, 'error');
    }
    video.starting = false;
    if (video.local && ui.net) {
      ui.net.sendVideo(true);
      maybeCall();
    }
    renderVideo();
  }

  function stopVideo() {
    shutVideo();
    if (ui.net) ui.net.sendVideo(false);
    renderVideo();
  }

  // Stop the camera and hang up, without telling the other side (used when leaving the table).
  function shutVideo() {
    if (video.local) video.local.getTracks().forEach((t) => t.stop());
    video.local = null;
    endCall();
  }

  function endCall() {
    const call = video.call;
    video.call = null;
    video.remote = null;
    if (call) { try { call.close(); } catch (e) { /* already closed */ } }
  }

  function maybeCall() {
    if (ui.role !== 'guest' || !video.local || !video.peerOn || video.call || !ui.net) return;
    const call = ui.net.call(video.local);
    if (call) wireCall(call);
  }

  function gotCall(call) {
    endCall();
    call.answer(video.local || undefined);
    wireCall(call);
  }

  function wireCall(call) {
    video.call = call;
    call.on('stream', (stream) => {
      if (video.call !== call) return;
      video.remote = stream;
      renderVideo();
    });
    const gone = () => {
      if (video.call !== call) return;
      video.call = null;
      video.remote = null;
      renderVideo();
    };
    call.on('close', gone);
    call.on('error', gone);
  }

  function gotVideo(on) {
    const was = video.peerOn;
    video.peerOn = on;
    if (!on) endCall();
    else if (!was && !video.local && ui.screen === 'game') toast(`📷 ${oppName()} turned on video. Click “Join video” in the side panel to chat face to face.`);
    maybeCall();
    renderVideo();
  }

  // The connection to the other player just came up (again): any old call is dead, so start over.
  function linked() {
    endCall();
    if (video.local && ui.net) ui.net.sendVideo(true);
    renderVideo();
  }

  function toggleMic() {
    video.mic = !video.mic;
    if (video.local) video.local.getAudioTracks().forEach((t) => { t.enabled = video.mic; });
    renderVideo();
  }

  function toggleCam() {
    video.cam = !video.cam;
    if (video.local) video.local.getVideoTracks().forEach((t) => { t.enabled = video.cam; });
    renderVideo();
  }

  // Videos sit next to each player's hand: theirs by their cards at the top, yours by your hand.
  // The side panel just holds the controls.
  function renderVideo() {
    const box = $('#video');
    if (!box || !ui.view) return;
    const name = oppName();
    renderTiles();
    if (!video.local && !video.remote) {
      box.className = 'panel video-off';
      box.replaceChildren(h('div', { class: 'video-prompt' },
        h('span', null, video.peerOn ? `📷 ${name} has video on` : '📷 Video chat'),
        h('button', { class: 'btn small' + (video.peerOn ? ' primary' : ''), disabled: video.starting, onclick: startVideo },
          video.starting ? 'Starting…' : video.peerOn ? 'Join video' : 'Start video')));
      return;
    }
    box.className = 'panel video-on';
    box.replaceChildren(
      h('div', { class: 'video-prompt' }, h('span', null,
        video.remote ? '📷 Video is on, next to your hands' : video.peerOn ? `📷 Connecting to ${name}…` : `📷 Waiting for ${name} to turn on video…`)),
      h('div', { class: 'video-controls' }, ...[
        video.local && h('button', { class: 'btn small', onclick: toggleMic, 'aria-pressed': String(!video.mic) }, video.mic ? '🎤 Mute' : '🔇 Unmute'),
        video.local && h('button', { class: 'btn small', onclick: toggleCam, 'aria-pressed': String(!video.cam) }, video.cam ? '📷 Camera off' : '📷 Camera on'),
        h('button', { class: 'btn small ghost', onclick: stopVideo }, 'Leave video'),
      ].filter(Boolean)));
  }

  function renderTiles() {
    const connecting = video.local && video.peerOn && !video.remote;
    tile($('#opp-video'), video.remote, false, oppName(), connecting ? 'Connecting…' : null, 'down');
    tile($('#my-video'), video.local, true, 'You', video.local && !video.cam ? 'Camera off' : null, 'up');
  }

  // One video tile. Its <video> is kept between updates so the picture never flickers.
  function tile(el, stream, mirror, label, note, grow) {
    if (!el) return;
    el.hidden = !stream && !note;
    if (el.hidden) {
      el.replaceChildren();
      return;
    }
    if (!el.querySelector('video')) {
      el.replaceChildren(
        h('video', { class: mirror ? 'mirrored' : null, autoplay: true, playsinline: true }),
        h('span', { class: 'tile-note' }),
        h('span', { class: 'tile-label' }),
        h('div', {
          class: 'tile-resize', role: 'separator', 'aria-label': 'Resize the videos',
          title: 'Drag to resize the videos · double-click to reset',
          onpointerdown: (e) => startTileResize(e, grow), ondblclick: resetTileSize,
        }));
    }
    const vid = el.querySelector('video');
    if (mirror) vid.muted = true; // never play your own microphone back to yourself
    if (vid.srcObject !== (stream || null)) vid.srcObject = stream || null;
    el.querySelector('.tile-label').textContent = label;
    const n = el.querySelector('.tile-note');
    n.textContent = note || '';
    n.hidden = !note;
  }

  // Both tiles share one size. The grip on your tile grows it upward; the one on theirs, downward.
  function startTileResize(e, grow) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const tileEl = e.currentTarget.closest('.video-tile');
    const startW = tileEl.getBoundingClientRect().width;
    const x0 = e.clientX;
    const y0 = e.clientY;
    document.body.classList.add('resizing');
    const move = (ev) => {
      const byX = startW + (ev.clientX - x0);
      const byY = startW + (((grow === 'up' ? y0 - ev.clientY : ev.clientY - y0) * 16) / 9);
      applyTileWidth(Math.abs(byY - startW) > Math.abs(byX - startW) ? byY : byX);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing');
      store.set('r500:tileWidth', Math.round(tileEl.getBoundingClientRect().width));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function applyTileWidth(w) {
    const game = $('.game');
    if (!game) return;
    if (!w) game.style.removeProperty('--tile-w');
    else game.style.setProperty('--tile-w', `${Math.round(Math.min(480, Math.max(120, w)))}px`);
  }

  function resetTileSize() {
    store.del('r500:tileWidth');
    applyTileWidth(null);
  }

  // ---------- side panel width ----------
  // Drag the video's corner grip, or the panel's left edge, to widen the side panel; the table makes room.

  const savedSideWidth = () => store.get('r500:sideWidth') || store.get('r500:videoWidth'); // older pages saved the video width

  function applySideWidth(w) {
    const game = $('.game');
    if (!game) return;
    if (!w) { game.style.removeProperty('--side-w'); return; }
    const most = Math.max(220, innerWidth - 520); // always leave the table at least 520 px
    game.style.setProperty('--side-w', `${Math.round(Math.min(most, Math.max(220, w)))}px`);
  }

  function resetSideWidth() {
    store.del('r500:sideWidth');
    store.del('r500:videoWidth');
    applySideWidth(null);
  }

  function startSideResize(e, fromVideo) {
    if (e.button !== 0) return;
    e.preventDefault();
    const side = $('.side');
    if (!side) return;
    const startW = side.getBoundingClientRect().width;
    const x0 = e.clientX;
    const y0 = e.clientY;
    document.body.classList.add('resizing');
    const move = (ev) => {
      const byX = startW + (x0 - ev.clientX);
      const byY = startW + ((ev.clientY - y0) * 16) / 9; // dragging the video's corner down also widens it
      applySideWidth(fromVideo && Math.abs(byY - startW) > Math.abs(byX - startW) ? byY : byX);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing');
      store.set('r500:sideWidth', Math.round(side.getBoundingClientRect().width));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // ---------- sounds ----------

  let audio = null;
  let noise = null;
  function unlockAudio() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
    } catch (e) { /* no sound available */ }
  }

  function tone(freq, at, dur, vol, type = 'sine', toFreq = 0) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (toFreq) osc.frequency.exponentialRampToValueAtTime(toFreq, at + dur * 0.6);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(vol, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain).connect(audio.destination);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  function noiseBuffer() {
    if (!noise) {
      noise = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.5), audio.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return noise;
  }

  function noiseBurst(at, dur, type, freq, vol) {
    const src = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    src.buffer = noiseBuffer();
    src.loop = true;
    filter.type = type;
    filter.frequency.value = freq;
    gain.gain.setValueAtTime(vol, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter).connect(gain).connect(audio.destination);
    src.start(at);
    src.stop(at + dur + 0.02);
  }

  function whoosh(at) {
    const src = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    src.buffer = noiseBuffer();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(500, at);
    filter.frequency.exponentialRampToValueAtTime(2600, at + 0.3);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.35, at + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
    src.connect(filter).connect(gain).connect(audio.destination);
    src.start(at);
    src.stop(at + 0.4);
  }

  function meow(at) {
    const osc = audio.createOscillator();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    const base = 480 + Math.random() * 220;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(base * 0.8, at);
    osc.frequency.exponentialRampToValueAtTime(base * 1.5, at + 0.12);
    osc.frequency.exponentialRampToValueAtTime(base * 0.9, at + 0.5);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, at);
    filter.frequency.linearRampToValueAtTime(2600, at + 0.12);
    filter.frequency.linearRampToValueAtTime(900, at + 0.5);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.12, at + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.55);
    osc.connect(filter).connect(gain).connect(audio.destination);
    osc.start(at);
    osc.stop(at + 0.6);
  }

  function wind(at) {
    const src = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    src.buffer = noiseBuffer();
    src.loop = true;
    filter.type = 'bandpass';
    filter.Q.value = 0.9;
    filter.frequency.setValueAtTime(300, at);
    for (let i = 1; i <= 9; i++) filter.frequency.linearRampToValueAtTime(300 + Math.random() * 700, at + i * 0.5);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.35, at + 0.8);
    gain.gain.setValueAtTime(0.35, at + 3.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 4.6);
    src.connect(filter).connect(gain).connect(audio.destination);
    src.start(at);
    src.stop(at + 4.7);
  }

  // A fire: a whoomph as it catches, a low roar, and crackles until it dies down.
  function blaze(at, dur) {
    const src = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    src.buffer = noiseBuffer();
    src.loop = true;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, at);
    filter.frequency.exponentialRampToValueAtTime(420, at + 0.6);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.5, at + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.16, at + 0.8);
    gain.gain.setValueAtTime(0.16, at + Math.max(0.9, dur - 0.5));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur + 0.3);
    src.connect(filter).connect(gain).connect(audio.destination);
    src.start(at);
    src.stop(at + dur + 0.4);
    tone(70, at, 0.6, 0.3, 'sine', 40);
    for (let i = 0; i < 18 * dur; i++) {
      noiseBurst(at + 0.15 + Math.random() * dur, 0.008 + Math.random() * 0.02, 'highpass', 1500 + Math.random() * 3500, 0.05 + Math.random() * 0.25);
    }
  }

  // A sad trombone: wah, wah, wah, waaah.
  function trombone(at) {
    [[311, 0.42], [294, 0.42], [277, 0.42], [262, 1.3]].forEach(([f, dur], i) => {
      const t = at + i * 0.48;
      const osc = audio.createOscillator();
      const filter = audio.createBiquadFilter();
      const gain = audio.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t);
      if (i === 3) { // the long last note wobbles
        const lfo = audio.createOscillator();
        const depth = audio.createGain();
        lfo.frequency.value = 5.5;
        depth.gain.value = 7;
        lfo.connect(depth).connect(osc.frequency);
        lfo.start(t);
        lfo.stop(t + dur + 0.05);
      }
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(500, t);
      filter.frequency.linearRampToValueAtTime(1300, t + 0.12);
      filter.frequency.linearRampToValueAtTime(700, t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.13, t + 0.06);
      gain.gain.setValueAtTime(0.13, t + dur - 0.12);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(filter).connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    });
  }

  function sfx(kind, secs) {
    try {
      unlockAudio();
      if (!audio) return;
      const now = audio.currentTime;
      if (kind === 'poke') { tone(880, now, 0.35, 0.3); tone(1320, now + 0.16, 0.35, 0.3); }
      else if (kind === 'turn') { tone(784, now, 0.3, 0.12); tone(1047, now + 0.13, 0.45, 0.12); }
      else if (kind === 'boom') { tone(110, now, 0.7, 0.35, 'sine', 50); noiseBurst(now, 0.35, 'lowpass', 300, 0.3); }
      else if (kind === 'flip') noiseBurst(now, 0.05, 'highpass', 2500, 0.25);
      else if (kind === 'drumroll') {
        for (let i = 0; i < 32; i++) noiseBurst(now + i * 0.045, 0.04, 'bandpass', 900, 0.08 + i * 0.006);
        noiseBurst(now + 1.5, 0.9, 'highpass', 3000, 0.35);
      } else if (kind === 'fanfare') {
        [523, 659, 784].forEach((f, i) => tone(f, now + i * 0.12, 0.3, 0.14, 'triangle'));
        [659, 784, 1047].forEach((f) => tone(f, now + 0.42, 0.9, 0.1, 'triangle'));
      }
      else if (kind === 'shimmer') { [1318, 1568, 2093, 2637].forEach((f, i) => tone(f, now + i * 0.07, 0.35, 0.07, 'triangle')); }
      else if (kind === 'trade') { tone(523, now, 0.25, 0.12); tone(659, now + 0.1, 0.25, 0.12); tone(784, now + 0.2, 0.4, 0.12); }
      else if (kind === 'taunt') tone(520, now, 0.22, 0.16, 'triangle', 980);
      else if (kind === 'whoosh') whoosh(now);
      else if (kind === 'crack') {
        noiseBurst(now, 0.14, 'highpass', 1800, 0.55);
        tone(110, now, 0.5, 0.35, 'sine', 45);
        noiseBurst(now + 0.35, 0.9, 'lowpass', 380, 0.3);
      } else if (kind === 'skitter') {
        for (let i = 0; i < 16; i++) noiseBurst(now + i * 0.06 + Math.random() * 0.03, 0.022, 'bandpass', 3400, 0.22);
      } else if (kind === 'drain') {
        tone(660, now, 1.2, 0.14, 'triangle', 180);
      } else if (kind === 'wind') {
        wind(now);
      } else if (kind === 'catstorm') {
        noiseBurst(now, 1.4, 'lowpass', 220, 0.5); // thunder
        for (let i = 0; i < 6; i++) meow(now + 0.5 + i * 0.55 + Math.random() * 0.3);
      } else if (kind === 'pop') {
        for (let i = 0; i < 9; i++) tone(520 + Math.random() * 380, now + i * 0.1 + Math.random() * 0.04, 0.09, 0.13, 'sine', 240);
      } else if (kind === 'fire') {
        blaze(now, Math.min(6, Math.max(1, secs || 3))); // secs: how long it burns
      } else if (kind === 'ash') {
        noiseBurst(now, 0.8, 'lowpass', 260, 0.3);
        noiseBurst(now + 0.05, 0.5, 'bandpass', 1800, 0.08);
      } else if (kind === 'reborn') {
        [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, now + i * 0.07, 0.45, 0.07, 'triangle'));
      } else if (kind === 'sad') {
        trombone(now);
      }
    } catch (e) { /* no sound available */ }
  }

  let flashTimer = null;
  function flashTitle(msg) {
    stopTitleFlash();
    let on = false;
    flashTimer = setInterval(() => { document.title = (on = !on) ? msg : 'Rummy 500'; }, 900);
  }
  function stopTitleFlash() {
    clearInterval(flashTimer);
    flashTimer = null;
    document.title = 'Rummy 500';
  }

  // ---------- modals & toasts ----------

  // ---------- trades ----------

  function offerTrade() {
    const v = ui.view;
    if (ui.selected.size !== 1) { toast('Select one card to offer.', 'error'); return; }
    const card = [...ui.selected][0];
    if (card === v.ti.mustPlay || card === v.ti.topOnly) {
      toast(`You can’t trade the ${E.label(card)}: you just took it from the discard pile.`, 'error');
      return;
    }
    ui.selected.clear();
    send({ type: 'trade-offer', card });
  }

  // Pop the offer up for the other player once, close it when it's settled, and say how it went.
  function syncTrade(prev) {
    const v = ui.view;
    const t = v.trade;
    const key = t ? `${v.gameNo}:${v.handNo}:${t.from}:${t.card}` : null;
    if (t && t.from !== v.seat && key !== ui.tradeKey) {
      ui.tradeKey = key;
      ui.tradePick = null;
      sfx('trade');
      openTrade();
    } else if (t && ui.modal && ui.modal.kind === 'trade') {
      openTrade(); // refresh the choice of cards
    }
    if (!t && ui.modal && ui.modal.kind === 'trade') closeModal();
    if (prev && prev.trade && !t) {
      const last = v.log.length ? v.log[v.log.length - 1].text : '';
      if (/trade/.test(last)) toast(last);
      if (/traded/.test(last)) sfx('trade');
    }
  }

  function openTrade() {
    const v = ui.view;
    const t = v.trade;
    if (!t || t.from === v.seat) return;
    const inHand = new Set(v.hand);
    if (!inHand.has(ui.tradePick)) ui.tradePick = null;
    const pick = (id) => { ui.tradePick = id; openTrade(); };
    openModal({
      title: '🤝 Trade offer',
      kind: 'trade',
      body: [
        h('p', null, `${v.names[t.from]} offers you this card:`),
        h('div', { class: 'trade-offer' }, cardEl(t.card)),
        h('p', null, 'Pick one of your cards to give in return:'),
        h('div', { class: 'trade-pick' }, ui.order.filter((id) => inHand.has(id)).map((id) => {
          const el = cardEl(id, { cls: 'tiny' + (ui.tradePick === id ? ' picked' : '') });
          el.tabIndex = 0;
          el.setAttribute('role', 'button');
          el.setAttribute('aria-pressed', String(ui.tradePick === id));
          el.setAttribute('aria-label', E.label(id));
          el.addEventListener('click', () => pick(id));
          el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(id); } });
          return el;
        })),
      ],
      actions: [
        h('button', { class: 'btn ghost', onclick: () => send({ type: 'trade-decline' }) }, 'No thanks'),
        h('button', { class: 'btn primary', disabled: !ui.tradePick, onclick: () => send({ type: 'trade-accept', card: ui.tradePick }) },
          ui.tradePick ? `Trade my ${E.label(ui.tradePick)}` : 'Trade'),
      ],
    });
  }

  function syncSummary() {
    const v = ui.view;
    const over = v.phase === 'handOver' || v.phase === 'gameOver';
    const key = v.forfeit ? `${v.gameNo}:forfeit` : v.history.length ? `${v.gameNo}:${v.history.length}` : null;
    if (over && key !== ui.summaryKey) {
      ui.summaryKey = key;
      openSummary(false);
    } else if (ui.modal && ui.modal.kind === 'summary') {
      if (!over && !ui.modal.manual) closeModal();
      else if (!ui.revealing) refreshSummaryActions(); // never restart a reveal that's playing
    }
  }

  // Close, plus "Deal the next hand" / "Play again" while you're both between hands.
  function summaryActions() {
    const v = ui.view;
    const me = v.seat;
    const o = 1 - me;
    const gameOver = v.phase === 'gameOver';
    const actions = [h('button', { class: 'btn ghost', onclick: closeModal }, 'Close')];
    if (v.phase === 'handOver' || gameOver) {
      if (gameOver && ui.role === 'host') actions.push(h('button', { class: 'btn', onclick: () => send({ type: 'lobby' }) }, 'Change settings'));
      if (v.ready[me]) actions.push(h('span', { class: 'muted' }, `Waiting for ${v.names[o]}…`));
      else {
        if (v.ready[o]) actions.push(h('span', { class: 'muted' }, `${v.names[o]} is ready.`));
        actions.push(h('button', { class: 'btn primary', onclick: () => send({ type: 'ready' }) }, gameOver ? 'Play again' : 'Deal the next hand'));
      }
    }
    return actions;
  }

  function refreshSummaryActions() {
    const bar = $('#modal-root .modal-actions');
    if (bar) bar.replaceChildren(...summaryActions());
  }

  // The results of the hand just played, or of the whole game if someone forfeited it.
  function openSummary(manual) {
    if (ui.view.forfeit) openForfeit(manual);
    else openHandResults(manual);
  }

  // Hand results. The first time they appear they play out like a scoreboard: leftover cards flip over
  // one by one, the numbers count up, the hand's winner lights up, and at the end of a game there's a
  // drumroll, the winner, and confetti. Reopening them later just shows the result.
  function openHandResults(manual) {
    const v = ui.view;
    const x = v.history[v.history.length - 1];
    if (!x) return;
    const me = v.seat;
    const o = 1 - me;
    const ended = v.phase === 'gameOver';
    const gameOver = ended && !v.forfeit; // this hand won the game (a forfeited game has its own results)
    const key = `${v.gameNo}:${v.history.length}`;
    const animate = !manual && !calm() && !ui.revealed.has(key);
    ui.revealed.add(key);
    clearReveal();
    const tied = v.phase === 'handOver' && v.totals[0] === v.totals[1] && v.totals[0] >= v.settings.target;
    const out = x.wentOut == null ? 'Nobody went out: the cards ran out.' : `${x.wentOut === me ? 'You' : v.names[x.wentOut]} went out!`;
    const winnerTitle = gameOver ? (v.winner === me ? 'You win the game! 🏆' : `${v.names[v.winner]} wins the game! 🏆`) : null;
    const counts = [];
    const num = (from, to, fmt, cls) => {
      const el = h('td', { class: cls }, fmt(animate ? from : to));
      counts.push([el, from, to, fmt]);
      return el;
    };
    const plus = (n) => '+' + n;
    const minus = (n) => (n ? '−' + n : '0');
    const rows = [me, o].map((p) => h('tr', { 'data-seat': p },
      h('th', null, p === me ? 'You' : nm(v.names[p])),
      num(0, x.table[p], plus),
      num(0, x.inHand[p], minus),
      num(0, x.score[p], E.signed, x.score[p] > 0 ? 'pos' : x.score[p] < 0 ? 'neg' : null),
      num(x.totals[p] - x.score[p], x.totals[p], String)));
    const flips = [];
    const leftovers = [o, me].filter((p) => x.left[p].length).map((p) => h('div', { class: 'reveal-row' },
      h('div', { class: 'muted small' }, p === me ? 'Left in your hand' : `Left in ${v.names[p]}’s hand`),
      h('div', { class: 'reveal-cards' }, x.left[p].map((id) => {
        const f = flipCard(id, v.backs && v.backs[p], E.handPoints(id, v.settings), !animate);
        flips.push(f);
        return f;
      }))));
    const pending = animate ? ' pending' : '';
    const winnerNote = !ended && x.won != null ? h('p', { class: 'armed-note' + pending }, x.won === me
      ? '⚔️ You won the hand, so you get one of each attack to use in the next one.'
      : `⚔️ ${v.names[x.won]} won the hand and gets one of each attack to use in the next one. Watch out!`) : null;
    const banner = gameOver ? h('div', { class: 'winner-banner' + pending }, winnerTitle) : null;
    const record = gameOver ? recordLine(v) : null;
    if (record && animate) record.classList.add('pending');
    const body = [
      h('p', { class: 'lede' }, out, tied ? ' You’re tied, so there’s one more hand.' : ''),
      leftovers.length ? h('div', { class: 'reveal-hands' }, leftovers) : h('p', { class: 'muted' }, 'Nobody had cards left over.'),
      h('table', { class: 'summary' },
        h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'On table'), h('th', null, 'Left in hand'), h('th', null, 'This hand'), h('th', null, 'Total'))),
        h('tbody', null, rows)),
      winnerNote,
      banner,
      record,
    ];
    const title = animate ? (gameOver ? 'The final hand…' : `Hand ${x.hand} is over`) : winnerTitle || `Hand ${x.hand} results`;
    const actions = animate ? [h('button', { class: 'btn ghost', onclick: skipReveal }, 'Skip ▸▸')] : summaryActions();
    openModal({ title, body, actions, kind: 'summary', manual, wide: true });
    if (!animate) {
      highlightWinner(rows, x);
      return;
    }
    ui.revealing = true;
    sfx('boom');
    const box = $('#modal-root .modal');
    if (box) box.animate([{ transform: 'scale(0.85)', opacity: 0 }, { transform: 'scale(1.03)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)', opacity: 1 }], { duration: 450, easing: 'ease-out' });
    let t = 800;
    flips.forEach((f) => {
      later(t, () => { f.classList.add('shown'); sfx('flip'); });
      t += 280;
    });
    t += 400;
    later(t, () => counts.forEach(([el, from, to, fmt]) => countUp(el, from, to, 1000, fmt)));
    t += 1200;
    later(t, () => {
      highlightWinner(rows, x);
      if (winnerNote) winnerNote.classList.remove('pending');
    });
    if (gameOver) {
      later(t + 300, () => sfx('drumroll'));
      t += 2000;
      later(t, () => {
        const titleEl = $('#modal-title');
        if (titleEl) titleEl.textContent = winnerTitle;
        banner.classList.remove('pending');
        if (record) record.classList.remove('pending');
        sfx('fanfare');
        confetti();
      });
      t += 700;
    }
    later(t, finishReveal);
  }

  // A forfeited game. The first time: up goes the white flag (to a sad trombone), then the winner's
  // banner, the fanfare and confetti. Reopening it just shows the result.
  function openForfeit(manual) {
    const v = ui.view;
    const f = v.forfeit;
    const me = v.seat;
    const o = 1 - me;
    const key = `${v.gameNo}:forfeit`;
    const animate = !manual && !calm() && !ui.revealed.has(key);
    ui.revealed.add(key);
    clearReveal();
    const winnerTitle = v.winner === me ? 'You win the game! 🏆' : `${v.names[v.winner]} wins the game! 🏆`;
    const pending = animate ? ' pending' : '';
    const banner = h('div', { class: 'winner-banner' + pending }, winnerTitle);
    const record = recordLine(v);
    if (animate) record.classList.add('pending');
    const handsWon = (p) => v.history.filter((x) => x.won === p).length;
    const rows = [me, o].map((p) => h('tr', { 'data-seat': p },
      h('th', null, p === me ? 'You' : nm(v.names[p])),
      h('td', null, String(handsWon(p))),
      h('td', null, String(v.totals[p]))));
    const crown = () => rows.forEach((r) => r.classList.toggle('hand-winner', Number(r.dataset.seat) === v.winner));
    const body = [
      h('div', { class: 'forfeit-flag', 'aria-hidden': 'true' }, '🏳️'),
      h('p', { class: 'lede' }, f.by === me ? `You gave up the game, so ${v.names[o]} wins it.` : `${v.names[f.by]} gave up the game, so you win it!`,
        f.midHand ? ` Hand ${v.handNo} wasn’t finished, so it isn’t scored.` : ''),
      v.history.length ? h('table', { class: 'summary' },
        h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Hands won'), h('th', null, 'Score'))),
        h('tbody', null, rows)) : null,
      banner,
      record,
    ];
    const title = animate ? `🏳️ ${f.by === me ? 'You' : v.names[f.by]} forfeited` : winnerTitle;
    const actions = animate ? [h('button', { class: 'btn ghost', onclick: skipReveal }, 'Skip ▸▸')] : summaryActions();
    openModal({ title, body, actions, kind: 'summary', manual, wide: true });
    if (!animate) {
      crown();
      return;
    }
    ui.revealing = true;
    sfx('sad');
    const box = $('#modal-root .modal');
    if (box) box.animate([{ transform: 'scale(0.85)', opacity: 0 }, { transform: 'scale(1.03)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)', opacity: 1 }], { duration: 450, easing: 'ease-out' });
    later(2700, () => {
      const titleEl = $('#modal-title');
      if (titleEl) titleEl.textContent = winnerTitle;
      crown();
      banner.classList.remove('pending');
      record.classList.remove('pending');
      sfx('fanfare');
      confetti();
    });
    later(3400, finishReveal);
  }

  const later = (ms, fn) => ui.revealTimers.push(setTimeout(fn, ms));

  function clearReveal() {
    ui.revealTimers.forEach(clearTimeout);
    ui.revealTimers = [];
    ui.revealing = false;
  }

  function finishReveal() {
    clearReveal();
    refreshSummaryActions();
  }

  // Jump to the end: the reveal is already marked as seen, so this draws the finished results.
  function skipReveal() {
    clearReveal();
    openSummary(ui.modal ? ui.modal.manual : false);
  }

  function highlightWinner(rows, x) {
    rows.forEach((r) => r.classList.toggle('hand-winner', x.won != null && Number(r.dataset.seat) === x.won));
  }

  // A leftover card that starts face down and flips over, showing what it costs.
  function flipCard(id, back, pts, shown) {
    return h('div', { class: 'flip' + (shown ? ' shown' : '') },
      h('div', { class: 'flip-inner' },
        h('div', { class: 'flip-face' }, cardEl(id, { cls: 'tiny' })),
        h('div', { class: 'flip-face flip-back' }, backEl(back, 'tiny'))),
      h('span', { class: 'flip-pts' }, `−${pts}`));
  }

  function countUp(el, from, to, ms, fmt) {
    const t0 = Date.now();
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / ms);
      el.textContent = fmt(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
      if (k < 1) ui.revealTimers.push(setTimeout(step, 30));
    };
    step();
  }

  function confetti() {
    if (calm()) return;
    const colours = ['#f3c24f', '#ff6b6b', '#58aefc', '#7be0a6', '#c792ea', '#fffdf7'];
    for (let i = 0; i < 90; i++) {
      const el = h('div', { class: 'confetti', 'aria-hidden': 'true' });
      el.style.background = colours[i % colours.length];
      fx().append(el);
      const x = rng() * innerWidth;
      el.animate([
        { transform: `translate(${x}px, -20px) rotate(0deg)` },
        { transform: `translate(${x + (rng() - 0.5) * 220}px, ${innerHeight + 20}px) rotate(${(rng() - 0.5) * 1080}deg)` },
      ], { duration: 2200 + rng() * 1800, delay: rng() * 700, easing: 'cubic-bezier(.3,.6,.6,1)', fill: 'backwards' }).onfinish = () => el.remove();
    }
  }

  function showRules() {
    const st = (ui.view && ui.view.settings) || DEFAULTS;
    const li = (b, t) => h('li', null, h('strong', null, b), ' ', t);
    openModal({
      title: 'How to play',
      wide: true,
      body: h('ul', { class: 'rules' },
        li('Each turn:', 'draw, then meld and lay off if you want to, then discard one card.'),
        li('Drawing:', 'take the top card of the draw pile, or any card in the discard pile along with every card above it. If you take more than one, you must meld or lay off the deepest one that turn. If you take only the top discard, you can’t discard it again that turn.'),
        li('Melds:', 'a set is 3 or 4 cards of one rank, each a different suit. A run is 3 or more cards in sequence in one suit. Aces go high (Q-K-A) or low (A-2-3); runs only wrap around (K-A-2) with Advanced scoring.'),
        li('Laying off:', 'add cards to any meld on the table, yours or your opponent’s. The points go to whoever plays the card; the coloured bar under each card shows whose it is.'),
        st.jokers ? li('Jokers:', 'wild. When you play one you choose what it stands for, and it stays that for the hand. No more than half the cards in a meld can be Jokers. Each is worth 15.') : null,
        li('Going out:', 'you go out by discarding your last card, which ends the hand. You can’t meld or lay off your last card, so always keep one to discard.'),
        li('Empty draw pile:', 'the discards, apart from the top card, are shuffled into a new draw pile. If there’s nothing to shuffle, the hand ends.'),
        li('Scoring:', `you score the cards you put on the table, minus the cards left in your hand (Aces and Jokers in hand count 15). ${SCORING_INFO[st.scoring]}`),
        li('Winning:', `the first to ${st.target} wins. If you both pass it in the same hand, the higher total wins; a tie means one more hand.`),
        li('Forfeiting:', 'either of you can give up the game with 🏳️ Forfeit at the top. The other player wins it, and the next game starts as soon as they’re ready.'),
        li('Attacks (just for fun):', 'you start each game with one wild attack and earn another for every meld or lay-off. Whoever scores more in a hand also gets one of each for the next hand. They never change the cards or the score.')),
      actions: [h('button', { class: 'btn primary', onclick: closeModal }, 'Got it')],
    });
  }

  function openModal({ title, body, actions, kind, manual, wide }) {
    const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title' },
      h('div', { class: 'modal-head' },
        h('h2', { id: 'modal-title' }, title),
        h('button', { class: 'x', type: 'button', 'aria-label': 'Close', onclick: closeModal }, '×')),
      h('div', { class: 'modal-body' }, body),
      actions && actions.length ? h('div', { class: 'modal-actions' }, actions) : null);
    const scrim = h('div', { class: 'scrim' }, box);
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) closeModal(); });
    $('#modal-root').replaceChildren(scrim);
    ui.modal = { kind: kind || 'dialog', manual: Boolean(manual) };
    const focus = box.querySelector('.modal-actions .btn.primary') || box.querySelector('.x');
    if (focus) focus.focus({ preventScroll: true });
  }

  function closeModal() {
    $('#modal-root').replaceChildren();
    ui.modal = null;
  }

  function toast(text, kind = 'info') {
    const el = h('div', { class: 'toast ' + kind, role: kind === 'error' ? 'alert' : 'status' }, text);
    $('#toasts').append(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 400);
    }, kind === 'error' ? 5500 : 3500);
  }

  // ---------- boot ----------

  function boot() {
    if (typeof Peer === 'undefined') {
      mount(h('main', { class: 'center' }, h('div', { class: 'panel-card narrow' },
        brand(true),
        h('h2', null, 'Couldn’t load the game'),
        h('p', { class: 'lede' }, 'The connection library (PeerJS) didn’t load. Check your internet connection and reload the page.'),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Reload')))));
      return;
    }
    window.addEventListener('hashchange', route);
    window.addEventListener('focus', stopTitleFlash);
    window.addEventListener('resize', () => { if (ui.screen === 'game') applySideWidth(savedSideWidth()); });
    document.addEventListener('pointerdown', unlockAudio, { once: true });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (ui.menu) closeMenu();
      else if (ui.modal) closeModal();
    });
    route();
  }

  window.__r500 = { ui }; // handy for poking at the game from the console
  boot();
})();
