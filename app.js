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
  ];
  const TAUNT_BY_ID = Object.fromEntries(TAUNTS.map((t) => [t[0], t]));
  // Attacks you earn by winning a hand (the rules live in engine.js).
  const ATTACK_INFO = {
    smash: { emoji: '🪓', label: 'Break the table', blurb: 'crack their table in half', sent: (n) => `You smashed ${n}’s table in half!` },
    spiders: { emoji: '🕷️', label: 'Release spiders', blurb: 'set spiders loose on their screen', sent: (n) => `You set spiders loose on ${n}!` },
    bloom: { emoji: '🍄', label: 'Mushroom bloom', blurb: 'sprout mushrooms all over their table', sent: (n) => `Mushrooms are sprouting all over ${n}’s table!` },
  };

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
      const peer = new Peer(PEER_PREFIX + this.t.code, { debug: 1 });
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
          phase: 'lobby', seat, code: t.code, settings: t.settings, names: t.players.map((p) => p.name), online, backs, grabs,
          lastGame: t.game ? { names: t.game.names, totals: t.game.totals } : null,
        };
      }
      return { ...E.viewFor(t.game, seat), code: t.code, online, backs, grabs };
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
      const peer = new Peer({ debug: 1 });
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
        conn.send({ type: 'hello', token: this.token, name: this.name, back: myBack(), grab: myGrab() });
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
    Object.assign(ui, { net: null, role: null, code: null, view: null, status: 'idle', summaryKey: null, orderKey: null, order: [], attackSeen: undefined, drag: null });
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
    const text = statusText();
    el.textContent = text;
    el.hidden = !text;
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
    if (g && g.phase === 'gameOver') bits.push(`${g.names[g.winner]} won ${Math.max(...g.totals)}–${Math.min(...g.totals)}`);
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
          h('div', { class: 'opp-strip', id: 'opp' }),
          h('div', { class: 'piles', id: 'piles' }),
          h('div', { class: 'table', id: 'melds' }),
          h('div', { class: 'my-area' },
            h('div', { class: 'status', id: 'status', 'aria-live': 'polite' }),
            h('div', { class: 'hand', id: 'hand' }),
            h('div', { class: 'controls', id: 'controls' }))),
        h('aside', { class: 'side', id: 'side' },
          h('section', { id: 'video', class: 'panel' }),
          h('div', { id: 'side-panels', class: 'side-panels' }))));
    }
    const pilesBefore = pileRects(); // where the cards were, for the pick-up animation
    syncHand(prev);
    renderTopbar();
    renderOpp();
    renderPiles();
    renderMelds();
    renderStatus();
    renderHand();
    renderSide();
    syncSummary();
    const myTurn = (x) => x && x.phase === 'play' && x.turn === x.seat && x.handNo === v.handNo && x.gameNo === v.gameNo;
    if (prev && v.step === 'draw' && myTurn(v) && !myTurn(prev)) yourTurnCue();
    if (prev && prev.handNo !== v.handNo && v.phase === 'play') {
      if (charges(v, v.seat)) toast('⚔️ You won the last hand, so you get three attacks to use this hand. They’re next to Taunt.', 'poke');
      else if (charges(v, 1 - v.seat)) toast(`⚔️ ${v.names[1 - v.seat]} won the last hand and has attacks to use on you. Watch out!`);
    }
    if (!ui.wildHinted && v.phase === 'play' && v.wild && v.wild[v.seat] > 0) {
      ui.wildHinted = true;
      setTimeout(() => toast('⭐ You each start the game with a wild attack. Use it whenever you like with ⚔️ Attacks, next to Taunt.'), 1200);
    }
    renderVideo();
    syncAttack();
    const drew = prev && prev.phase === 'play' && v.phase === 'play' && prev.handNo === v.handNo && prev.gameNo === v.gameNo &&
      prev.turn === v.turn && prev.step === 'draw' && v.step === 'play';
    if (drew) pickupCue(pilesBefore);
  }

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
        h('a', { class: 'btn ghost small', href: '#', title: 'Back to the start page. The game is saved.' }, 'Leave')));
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
    const backs = h('div', { class: 'opp-hand', 'aria-label': `${v.names[o]} has ${plural(n, 'card')}` },
      Array.from({ length: n }, () => backEl(v.backs && v.backs[o], 'sm')));
    $('#opp').replaceChildren(
      h('div', { class: 'who' + (theirTurn ? ' active' : '') },
        h('span', { class: 'avatar opp' }, initial(v.names[o])),
        h('div', { class: 'who-text' },
          h('div', { class: 'who-name' }, nm(v.names[o]),
            h('span', { class: 'dot ' + (online ? 'on' : 'off'), title: online ? 'Connected' : 'Not connected' }),
            online ? null : h('span', { class: 'muted small' }, ' offline'),
            charges(v, o) ? h('span', { class: 'armed', title: `${v.names[o]} won the last hand and has attacks to use this hand` }, '⚔️') : null),
          h('div', { class: 'who-sub' }, `${plural(n, 'card')} · ${onTable} on the table this hand · ${v.totals[o]} total`)),
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
    const el = $('#status');
    el.className = 'status ' + tone;
    el.replaceChildren(...[
      h('span', null, text),
      extra && h('span', { class: 'status-extra' }, extra),
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
        h('table', { class: 'scores' },
          h('thead', null, h('tr', null, h('th', null, 'Hand'), h('th', null, 'You'), h('th', null, nm(v.names[o])))),
          h('tbody', null, v.history.length
            ? v.history.map((x) => h('tr', null, h('td', null, x.hand), cell(x.score[me]), cell(x.score[o])))
            : h('tr', null, h('td', { colspan: 3, class: 'muted' }, 'Each hand’s score is added here when it ends.'))),
          h('tfoot', null, h('tr', null, h('th', null, 'Total'), h('th', null, v.totals[me]), h('th', null, v.totals[o])))),
        v.history.length ? h('button', { class: 'link', onclick: () => openSummary(true) }, 'Last hand in detail') : null),
      h('section', { class: 'panel log' },
        h('h3', null, 'Moves'),
        h('ol', null, v.log.slice().reverse().map((e) => h('li', null, e.text)))));
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
      return TAUNTS.map(([id, emoji, text]) => h('button', { type: 'button', class: 'taunt', role: 'menuitem', onclick: () => doTaunt(id) },
        h('span', { class: 'taunt-emoji', 'aria-hidden': 'true' }, emoji), h('span', null, text)));
    }
    const mine = (ui.view.attacks && ui.view.attacks[ui.view.seat]) || {};
    const wild = (ui.view.wild && ui.view.wild[ui.view.seat]) || 0;
    return [
      wild ? h('div', { class: 'menu-note' }, '⭐ You have a wild attack: spend it on any of these.') : null,
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

  // A speech bubble by the opponent's avatar, or above your status line for your own taunts.
  function showTaunt(id, who) {
    const [, emoji, text] = TAUNT_BY_ID[id];
    const anchor = who === 'opp' ? $('#opp .avatar') : $('#status');
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const old = $(`#fx .bubble.${who}`);
    if (old) old.remove();
    const bubble = h('div', { class: 'bubble ' + who, role: 'status' },
      h('span', { class: 'bubble-emoji', 'aria-hidden': 'true' }, emoji), h('span', null, text));
    Object.assign(bubble.style, who === 'opp'
      ? { left: `${Math.max(8, r.left - 4)}px`, top: `${r.bottom + 12}px` }
      : { left: `${Math.max(8, r.left + 16)}px`, top: `${r.top - 12}px` });
    fx().append(bubble);
    burst(emoji, r.left + (who === 'opp' ? r.width / 2 : 60), who === 'opp' ? r.top + r.height / 2 : r.top);
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
    if (la.by === ui.view.seat) launchAttack(la.kind);
    else if (la.kind === 'smash') smashTable(ui.view.names[la.by]);
    else if (la.kind === 'spiders') releaseSpiders(ui.view.names[la.by]);
    else if (la.kind === 'bloom') mushroomBloom(ui.view.names[la.by]);
  }

  // What the attacker sees: the attack flies over to the other player.
  function launchAttack(kind) {
    const info = ATTACK_INFO[kind];
    toast(`${info.emoji} ${info.sent(oppName())}`, 'poke');
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

  // The video panel keeps its <video> elements between updates so the picture never flickers.
  function renderVideo() {
    const box = $('#video');
    if (!box || !ui.view) return;
    const name = oppName();
    if (!video.local && !video.remote) {
      box.className = 'panel video-off';
      setVideoWidth(null);
      box.replaceChildren(h('div', { class: 'video-prompt' },
        h('span', null, video.peerOn ? `📷 ${name} has video on` : '📷 Video chat'),
        h('button', { class: 'btn small' + (video.peerOn ? ' primary' : ''), disabled: video.starting, onclick: startVideo },
          video.starting ? 'Starting…' : video.peerOn ? 'Join video' : 'Start video')));
      return;
    }
    box.className = 'panel video-on';
    if (!box.querySelector('.video-stage')) {
      box.replaceChildren(
        h('div', { class: 'video-stage' },
          h('video', { class: 'remote', autoplay: true, playsinline: true }),
          h('div', { class: 'video-note' }),
          h('video', { class: 'self', autoplay: true, playsinline: true, muted: true }),
          h('div', {
            class: 'video-resize', role: 'separator', 'aria-label': 'Resize video',
            title: 'Drag to resize the video · double-click to reset',
            onpointerdown: startVideoResize,
            ondblclick: () => { store.del('r500:videoWidth'); setVideoWidth(null); },
          })),
        h('div', { class: 'video-controls' }));
      setVideoWidth(store.get('r500:videoWidth'));
    }
    const remoteEl = box.querySelector('video.remote');
    const selfEl = box.querySelector('video.self');
    const note = box.querySelector('.video-note');
    selfEl.muted = true; // never play your own microphone back to yourself
    if (remoteEl.srcObject !== video.remote) remoteEl.srcObject = video.remote;
    if (selfEl.srcObject !== video.local) selfEl.srcObject = video.local;
    selfEl.hidden = !video.local || !video.cam;
    note.hidden = Boolean(video.remote);
    note.textContent = video.peerOn ? `Connecting to ${name}…` : `Waiting for ${name} to turn on video…`;
    box.querySelector('.video-controls').replaceChildren(...[
      video.local && h('button', { class: 'btn small', onclick: toggleMic, 'aria-pressed': String(!video.mic) }, video.mic ? '🎤 Mute' : '🔇 Unmute'),
      video.local && h('button', { class: 'btn small', onclick: toggleCam, 'aria-pressed': String(!video.cam) }, video.cam ? '📷 Camera off' : '📷 Camera on'),
      h('button', { class: 'btn small ghost', onclick: stopVideo }, 'Leave video'),
    ].filter(Boolean));
  }

  // The grip sits on the video's bottom-left corner: drag out to enlarge it over the table, in to shrink it.
  function startVideoResize(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const box = $('#video');
    const startW = box.getBoundingClientRect().width;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const move = (ev) => {
      const byX = startW + (x0 - ev.clientX);
      const byY = startW + ((ev.clientY - y0) * 16) / 9; // the picture keeps its 16:9 shape
      setVideoWidth(Math.abs(byX - startW) >= Math.abs(byY - startW) ? byX : byY);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      store.set('r500:videoWidth', Math.round(box.getBoundingClientRect().width));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function setVideoWidth(w) {
    const box = $('#video');
    if (!box) return;
    if (!w) box.style.removeProperty('--vw');
    else box.style.setProperty('--vw', `${Math.round(Math.min(innerWidth - 40, Math.max(200, w)))}px`);
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

  function sfx(kind) {
    try {
      unlockAudio();
      if (!audio) return;
      const now = audio.currentTime;
      if (kind === 'poke') { tone(880, now, 0.35, 0.3); tone(1320, now + 0.16, 0.35, 0.3); }
      else if (kind === 'turn') { tone(784, now, 0.3, 0.12); tone(1047, now + 0.13, 0.45, 0.12); }
      else if (kind === 'taunt') tone(520, now, 0.22, 0.16, 'triangle', 980);
      else if (kind === 'whoosh') whoosh(now);
      else if (kind === 'crack') {
        noiseBurst(now, 0.14, 'highpass', 1800, 0.55);
        tone(110, now, 0.5, 0.35, 'sine', 45);
        noiseBurst(now + 0.35, 0.9, 'lowpass', 380, 0.3);
      } else if (kind === 'skitter') {
        for (let i = 0; i < 16; i++) noiseBurst(now + i * 0.06 + Math.random() * 0.03, 0.022, 'bandpass', 3400, 0.22);
      } else if (kind === 'pop') {
        for (let i = 0; i < 9; i++) tone(520 + Math.random() * 380, now + i * 0.1 + Math.random() * 0.04, 0.09, 0.13, 'sine', 240);
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

  function syncSummary() {
    const v = ui.view;
    const over = v.phase === 'handOver' || v.phase === 'gameOver';
    const key = v.history.length ? `${v.gameNo}:${v.history.length}` : null;
    if (over && key !== ui.summaryKey) {
      ui.summaryKey = key;
      openSummary(false);
    } else if (ui.modal && ui.modal.kind === 'summary') {
      if (!over && !ui.modal.manual) closeModal();
      else openSummary(ui.modal.manual);
    }
  }

  function openSummary(manual) {
    const v = ui.view;
    const x = v.history[v.history.length - 1];
    if (!x) return;
    const me = v.seat;
    const o = 1 - me;
    const gameOver = v.phase === 'gameOver';
    const waiting = v.phase === 'handOver' || gameOver;
    const tied = v.phase === 'handOver' && v.totals[0] === v.totals[1] && v.totals[0] >= v.settings.target;
    const out = x.wentOut == null ? 'Nobody went out: the cards ran out.' : `${x.wentOut === me ? 'You' : v.names[x.wentOut]} went out.`;
    const row = (p, who) => h('tr', null,
      h('th', null, who),
      h('td', null, '+' + x.table[p]),
      h('td', null, x.inHand[p] ? '−' + x.inHand[p] : '0'),
      h('td', { class: x.score[p] > 0 ? 'pos' : x.score[p] < 0 ? 'neg' : null }, E.signed(x.score[p])),
      h('td', null, x.totals[p]));
    const body = [
      h('p', { class: 'lede' }, gameOver ? `Final score ${Math.max(...v.totals)} to ${Math.min(...v.totals)}. ${out}` : out,
        tied ? ' You’re tied, so there’s one more hand.' : ''),
      !gameOver && x.won != null ? h('p', { class: 'armed-note' }, x.won === me
        ? '⚔️ You won the hand, so you get three attacks to use in the next one.'
        : `⚔️ ${v.names[x.won]} won the hand and gets three attacks to use in the next one. Watch out!`) : null,
      h('table', { class: 'summary' },
        h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'On table'), h('th', null, 'Left in hand'), h('th', null, 'This hand'), h('th', null, 'Total'))),
        h('tbody', null, row(me, 'You'), row(o, nm(v.names[o])))),
      [me, o].filter((p) => x.left[p].length).map((p) => h('div', { class: 'left-hand' },
        h('div', { class: 'muted small' }, p === me ? 'Left in your hand:' : `Left in ${v.names[p]}’s hand:`),
        h('div', { class: 'meld-cards' }, x.left[p].map((id) => cardEl(id, { cls: 'tiny' }))))),
    ];
    const actions = [h('button', { class: 'btn ghost', onclick: closeModal }, 'Close')];
    if (waiting) {
      if (gameOver && ui.role === 'host') actions.push(h('button', { class: 'btn', onclick: () => send({ type: 'lobby' }) }, 'Change settings'));
      if (v.ready[me]) actions.push(h('span', { class: 'muted' }, `Waiting for ${v.names[o]}…`));
      else {
        if (v.ready[o]) actions.push(h('span', { class: 'muted' }, `${v.names[o]} is ready.`));
        actions.push(h('button', { class: 'btn primary', onclick: () => send({ type: 'ready' }) }, gameOver ? 'Play again' : 'Deal the next hand'));
      }
    }
    const title = gameOver ? (v.winner === me ? 'You win! 🏆' : `${v.names[v.winner]} wins 🏆`) : `Hand ${x.hand} results`;
    openModal({ title, body, actions, kind: 'summary', manual, wide: true });
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
        li('Winning:', `the first to ${st.target} wins. If you both pass it in the same hand, the higher total wins; a tie means one more hand.`)),
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
