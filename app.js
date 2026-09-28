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
  // Card backs: [id, name, emoji in the middle ('' = pattern only)]. The patterns live in style.css.
  const BACKS = [
    ['classic', 'Classic', ''],
    ['amanita', 'Fly agaric', '🍄'],
    ['forest', 'Mushroom patch', ''],
    ['fox', 'Fox', '🦊'],
    ['owl', 'Owl', '🦉'],
    ['frog', 'Frog', '🐸'],
    ['hedgehog', 'Hedgehog', '🦔'],
    ['cat', 'Cat', '🐱'],
    ['bee', 'Bee', '🐝'],
  ];
  const BACK_BY_ID = Object.fromEntries(BACKS.map((b) => [b[0], b]));
  const BACK_IDS = new Set(Object.keys(BACK_BY_ID));
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
      this.conn = conn;
      this.lastSeen = Date.now();
      this.online = true;
      conn.send({ type: 'welcome', seat: 1 });
      saveTable(this.t);
      this.broadcast();
    }

    setOnline(on) {
      if (this.online === on) return;
      this.online = on;
      this.broadcast();
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
      if (t.lobby || !t.game) {
        return {
          phase: 'lobby', seat, code: t.code, settings: t.settings, names: t.players.map((p) => p.name), online, backs,
          lastGame: t.game ? { names: t.game.names, totals: t.game.totals } : null,
        };
      }
      return { ...E.viewFor(t.game, seat), code: t.code, online, backs };
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
        conn.send({ type: 'hello', token: this.token, name: this.name, back: myBack() });
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
      if (msg.type === 'view') this.cb.onView(msg.view);
      else if (msg.type === 'error') this.cb.onError(String(msg.msg));
      else if (msg.type === 'poke') this.cb.onPoke(cleanName(msg.from) || 'Your friend');
      else if (msg.type === 'emote') this.cb.onEmote(msg.emote);
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
    tauntMenu: null,
    summaryKey: null,
    modal: null,
    dragId: null,
  };

  const callbacks = {
    onView: (view) => setView(view),
    onStatus: (status) => setStatus(status),
    onPoke: (from) => gotPoke(from),
    onEmote: (e) => gotEmote(e),
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
    if (ui.net) ui.net.stop();
    closeModal();
    closeTauntMenu();
    Object.assign(ui, { net: null, role: null, code: null, view: null, status: 'idle', summaryKey: null, orderKey: null, order: [] });
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
      saveTable({ code, created: Date.now(), lobby: true, settings: { ...DEFAULTS }, players: [{ name, token: 'host', back: myBack() }, { name: null, token: null }], game: null });
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
          h('strong', null, 'Your card back: '), (BACK_BY_ID[v.backs && v.backs[v.seat]] || BACK_BY_ID.classic)[1],
          h('div', { class: 'muted small' }, 'Your friend sees your cards with this design.')),
        h('button', { class: 'btn small', onclick: chooseBack }, 'Change')),
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
        h('aside', { class: 'side', id: 'side' })));
    }
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
        h('button', { class: 'btn ghost small', onclick: chooseBack }, 'Card back'),
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
    const backs = h('div', { class: 'opp-hand', 'aria-label': `${v.names[o]} has ${plural(n, 'card')}` },
      Array.from({ length: n }, () => backEl(v.backs && v.backs[o], 'sm')));
    $('#opp').replaceChildren(
      h('div', { class: 'who' + (theirTurn ? ' active' : '') },
        h('span', { class: 'avatar opp' }, initial(v.names[o])),
        h('div', { class: 'who-text' },
          h('div', { class: 'who-name' }, nm(v.names[o]),
            h('span', { class: 'dot ' + (online ? 'on' : 'off'), title: online ? 'Connected' : 'Not connected' }),
            online ? null : h('span', { class: 'muted small' }, ' offline')),
          h('div', { class: 'who-sub' }, `${plural(n, 'card')} · ${onTable} on the table this hand · ${v.totals[o]} total`)),
        theirTurn ? h('span', { class: 'badge' }, v.step === 'draw' ? 'Drawing…' : 'Playing…') : null),
      backs,
      h('div', { class: 'social' },
        h('button', {
          class: 'btn small', disabled: Boolean(offline) || wait('poke') > 0, onclick: poke,
          title: offline || 'Nudge them with a sound and a message',
        }, wait('poke') ? `Poked (${wait('poke')})` : '👉 Poke'),
        h('button', {
          class: 'btn small', disabled: Boolean(offline) || v.phase !== 'play' || !v.discard.length || wait('fake') > 0, onclick: doFake,
          title: offline || 'Reach for the discard pile, then put it all back at the last second',
        }, '✋ Fake grab'),
        h('button', {
          class: 'btn small', id: 'taunt-btn', disabled: Boolean(offline) || wait('taunt') > 0, onclick: toggleTauntMenu,
          title: offline || 'Send a taunt', 'aria-haspopup': 'menu', 'aria-expanded': String(Boolean(ui.tauntMenu)),
        }, '😏 Taunt')));
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
    const v = ui.view;
    const myTurn = v.phase === 'play' && v.turn === v.seat;
    const inHand = new Set(v.hand);
    const row = $('#hand');
    row.replaceChildren(...ui.order.filter((id) => inHand.has(id)).map((id, k) => {
      const must = myTurn && v.ti.mustPlay === id;
      const keep = myTurn && v.step === 'play' && v.ti.topOnly === id;
      const el = cardEl(id, { cls: [ui.selected.has(id) && 'sel', ui.fresh.has(id) && 'fresh', must && 'must'].filter(Boolean).join(' ') });
      el.style.setProperty('--i', k); // staggers the your-turn wave
      el.draggable = true;
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-pressed', String(ui.selected.has(id)));
      el.setAttribute('aria-label', E.label(id));
      if (must) el.append(h('span', { class: 'tag' }, 'must play'));
      else if (keep) el.append(h('span', { class: 'tag muted' }, 'can’t discard'));
      el.addEventListener('click', () => toggleSelect(id));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSelect(id); } });
      el.addEventListener('dragstart', (e) => {
        ui.dragId = id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => { ui.dragId = null; el.classList.remove('dragging'); });
      el.addEventListener('dragover', (e) => { if (ui.dragId && ui.dragId !== id) e.preventDefault(); });
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!ui.dragId || ui.dragId === id) return;
        // Cards overlap, so compare against the middle of the part you can see.
        const r = el.getBoundingClientRect();
        const next = el.nextElementSibling;
        const visible = next ? next.getBoundingClientRect().left - r.left : r.width;
        moveCard(ui.dragId, id, e.clientX > r.left + visible / 2);
      });
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
    $('#side').replaceChildren(
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

  function moveCard(from, to, after) {
    const order = ui.order.filter((id) => id !== from);
    const i = order.indexOf(to);
    order.splice(after ? i + 1 : i, 0, from);
    ui.order = order;
    saveOrder();
    renderHand();
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

  function backEl(design, cls) {
    const b = BACK_BY_ID[design] || BACK_BY_ID.classic;
    return h('div', { class: `card back back-${b[0]}${cls ? ' ' + cls : ''}` },
      b[2] ? h('span', { class: 'back-art', 'aria-hidden': 'true' }, b[2]) : null);
  }

  function chooseBack() {
    const v = ui.view;
    const current = v && v.backs ? v.backs[v.seat] : myBack();
    openModal({
      title: 'Choose your card back',
      body: [
        h('p', null, 'Your friend sees your hand with this design, and it’s on the draw pile on your screen.'),
        h('div', { class: 'back-grid' }, BACKS.map(([id, name]) => h('button', {
          type: 'button', class: 'back-choice' + (id === current ? ' on' : ''), 'aria-pressed': String(id === current),
          onclick: () => {
            store.set('r500:back', id);
            closeModal();
            send({ type: 'back', back: id });
          },
        }, backEl(id), h('span', null, name)))),
      ],
      actions: [h('button', { class: 'btn ghost', onclick: closeModal }, 'Cancel')],
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
    const name = ui.view.names[1 - ui.view.seat];
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
    toast(`${ui.view.names[1 - ui.view.seat]} isn’t connected right now.`, 'error');
    return false;
  }

  function gotEmote(e) {
    if (!e || typeof e !== 'object' || ui.screen !== 'game' || !ui.view) return;
    if (e.kind === 'taunt' && Object.prototype.hasOwnProperty.call(TAUNT_BY_ID, e.id)) showTaunt(e.id, 'opp');
    else if (e.kind === 'fake' && ui.view.phase === 'play') playFake(e.index, true);
  }

  function doTaunt(id) {
    closeTauntMenu();
    if (!sendEmote({ kind: 'taunt', id })) return;
    startCooldown('taunt');
    showTaunt(id, 'me');
  }

  function doFake() {
    const v = ui.view;
    if (v.phase !== 'play' || !v.discard.length) return;
    const index = Math.floor(rng() * v.discard.length);
    if (!sendEmote({ kind: 'fake', index })) return;
    startCooldown('fake');
    playFake(index, false);
  }

  function toggleTauntMenu(e) {
    if (ui.tauntMenu) { closeTauntMenu(); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const width = Math.min(440, innerWidth - 16);
    const menu = h('div', { class: 'taunt-menu', role: 'menu', 'aria-label': 'Taunts' },
      TAUNTS.map(([id, emoji, text]) => h('button', { type: 'button', class: 'taunt', role: 'menuitem', onclick: () => doTaunt(id) },
        h('span', { class: 'taunt-emoji', 'aria-hidden': 'true' }, emoji), h('span', null, text))));
    Object.assign(menu.style, {
      top: `${r.bottom + 8}px`,
      left: `${Math.max(8, Math.min(r.right - width, innerWidth - width - 8))}px`,
      width: `${width}px`,
    });
    document.body.append(menu);
    ui.tauntMenu = menu;
    document.addEventListener('pointerdown', tauntOutside, true);
    renderOpp();
    menu.querySelector('button').focus();
  }

  function tauntOutside(e) {
    if (!ui.tauntMenu || ui.tauntMenu.contains(e.target) || (e.target.closest && e.target.closest('#taunt-btn'))) return;
    closeTauntMenu();
  }

  function closeTauntMenu() {
    if (!ui.tauntMenu) return;
    ui.tauntMenu.remove();
    ui.tauntMenu = null;
    document.removeEventListener('pointerdown', tauntOutside, true);
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

  function whoosh(at) {
    if (!noise) {
      noise = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.4), audio.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    src.buffer = noise;
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
      if (ui.tauntMenu) closeTauntMenu();
      else if (ui.modal) closeModal();
    });
    route();
  }

  window.__r500 = { ui }; // handy for poking at the game from the console
  boot();
})();
