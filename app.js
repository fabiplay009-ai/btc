/* Pocket Miner – App-Logik: Netzwerkdaten, Worker-Steuerung, Akku, Anzeige. */
'use strict';

const API = 'https://mempool.space/api';
const TIP_POLL_MS = 60_000;
// Offline-Fallback (Schätzwert), falls mempool.space nicht erreichbar ist.
const OFFLINE = {
  height: null,
  prevHash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  bits: 0x1702f128,
  live: false,
};

const $ = (id) => document.getElementById(id);
const ui = {
  toggle: $('toggle'), status: $('status'), badge: $('net-badge'),
  hashrate: $('hashrate'), uptime: $('uptime'), total: $('total'),
  best: $('best'), netdiff: $('netdiff'), chance: $('chance'), eta: $('eta'),
  threads: $('threads'), threadsVal: $('threads-val'),
  intensity: $('intensity'), intensityVal: $('intensity-val'),
  onlyCharging: $('only-charging'), battery: $('battery'), wakelock: $('wakelock'),
  height: $('height'), prev: $('prev'), besthash: $('besthash'), log: $('log'),
};

const state = {
  want: false,          // Nutzer hat Start gedrückt
  running: false,       // Worker laufen gerade
  workers: [],
  rates: [],            // H/ms je Worker (geglättet)
  total: 0,
  activeMs: 0,
  lastTick: 0,
  net: null,
  battery: null,
  wakeLock: null,
  best: loadBest(),
};

/* ---------- Formatierung ---------- */
const nf = (d = 0) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d });
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

function fmtBig(n, d = 2) {
  if (!isFinite(n)) return '∞';
  if (n > 0 && n < 1) return n.toLocaleString('de-DE', { maximumSignificantDigits: 3 });
  if (n < 1e6) return nf(n < 10 ? d : 0).format(n);
  if (n < 1e9) return nf(d).format(n / 1e6) + ' Mio.';
  if (n < 1e12) return nf(d).format(n / 1e9) + ' Mrd.';
  const exp = Math.floor(Math.log10(n));
  const mant = n / 10 ** exp;
  return nf(1).format(mant) + ' × 10' + String(exp).split('').map((c) => SUP[c]).join('');
}

function fmtRate(hps) {
  const u = ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s'];
  let i = 0;
  while (hps >= 1000 && i < u.length - 1) { hps /= 1000; i++; }
  return nf(i ? 2 : 0).format(hps) + ' ' + u[i];
}

function fmtDuration(sec) {
  if (!isFinite(sec)) return '∞';
  const y = sec / 31_557_600;
  if (y >= 2) return fmtBig(y, 1) + ' Jahre';
  const days = sec / 86400;
  if (days >= 2) return nf(0).format(days) + ' Tage';
  return nf(1).format(sec / 3600) + ' Std.';
}

function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function log(msg) {
  const li = document.createElement('li');
  const t = document.createElement('time');
  t.textContent = new Date().toLocaleTimeString('de-DE');
  li.append(t, document.createTextNode(msg));
  ui.log.prepend(li);
  while (ui.log.children.length > 50) ui.log.lastChild.remove();
}

function setStatus(msg, cls = '') {
  ui.status.textContent = msg;
  ui.status.className = 'status ' + cls;
}

/* ---------- Bitcoin-Hilfen ---------- */
function bitsToDifficulty(bits) {
  const exp = bits >>> 24, mant = bits & 0x007fffff;
  return (0xffff / mant) * 256 ** (0x1d - exp);
}

function hexToBytesReversed(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[out.length - 1 - i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function buildHeader(net) {
  const h = new Uint8Array(80);
  const dv = new DataView(h.buffer);
  dv.setUint32(0, 0x20000000, true);                 // Version (BIP9)
  h.set(hexToBytesReversed(net.prevHash), 4);        // vorheriger Blockhash
  crypto.getRandomValues(h.subarray(36, 68));        // Merkle-Root (Lotterie, siehe README)
  dv.setUint32(68, Math.floor(Date.now() / 1000), true); // Zeit
  dv.setUint32(72, net.bits, true);                  // Target (bits)
  return h;                                          // Nonce (76..79) setzt der Worker
}

/* ---------- Netzwerk ---------- */
async function fetchNetwork() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const hash = (await (await fetch(`${API}/blocks/tip/hash`, { signal: ctl.signal })).text()).trim();
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('ungültiger Hash');
    const block = await (await fetch(`${API}/block/${hash}`, { signal: ctl.signal })).json();
    clearTimeout(timer);
    // Hinweis: An Retarget-Grenzen (alle 2016 Blöcke) ändert sich bits für den nächsten Block.
    return { height: block.height + 1, prevHash: hash, bits: block.bits >>> 0, live: true };
  } catch (err) {
    return null;
  }
}

async function refreshNetwork(initial = false) {
  const net = await fetchNetwork();
  if (!net) {
    if (!state.net) {
      state.net = OFFLINE;
      log('mempool.space nicht erreichbar – Offline-Modus mit Schätzwerten');
    }
    ui.badge.textContent = 'offline';
    ui.badge.className = 'badge off';
    renderNet();
    return;
  }
  const changed = !state.net || state.net.prevHash !== net.prevHash;
  state.net = net;
  ui.badge.textContent = 'live';
  ui.badge.className = 'badge live';
  if (changed) {
    if (!initial) log(`Neuer Bitcoin-Block – arbeite jetzt an Block ${net.height}`);
    else log(`Verbunden – arbeite an Block ${net.height}`);
    if (state.running) restartWorkers();
  }
  renderNet();
}

function renderNet() {
  const n = state.net;
  ui.height.textContent = n.height ? nf().format(n.height) : '– (offline)';
  ui.prev.textContent = n.prevHash;
  ui.netdiff.textContent = fmtBig(bitsToDifficulty(n.bits));
}

/* ---------- Worker ---------- */
function startWorkers() {
  if (state.running) return;
  const count = +ui.threads.value;
  const intensity = +ui.intensity.value / 100;
  state.rates = new Array(count).fill(0);
  for (let i = 0; i < count; i++) {
    const w = new Worker('miner-worker.js');
    w.onmessage = onWorkerMessage;
    w.onerror = (e) => { log('Worker-Fehler: ' + e.message); };
    w.postMessage({ type: 'start', id: i, header: buildHeader(state.net || OFFLINE), intensity });
    state.workers.push(w);
  }
  state.running = true;
  state.lastTick = performance.now();
  updateWakeLock();
}

function stopWorkers() {
  state.workers.forEach((w) => w.terminate());
  state.workers = [];
  state.rates = [];
  state.running = false;
  updateWakeLock();
}

function restartWorkers() {
  stopWorkers();
  startWorkers();
}

function onWorkerMessage(e) {
  const m = e.data;
  if (m.type === 'progress') {
    state.total += m.hashes;
    const r = m.hashes / m.ms;
    state.rates[m.id] = state.rates[m.id] ? state.rates[m.id] * 0.7 + r * 0.3 : r;
  } else if (m.type === 'best') {
    const d = MinerDiff(m.hi, m.lo);
    if (d > state.best.diff) {
      state.best = { diff: d, hash: m.hash };
      saveBest();
      log(`Neue beste Share: Difficulty ${fmtBig(d)}`);
      renderBest();
    }
  } else if (m.type === 'block') {
    log('🎉 BLOCK-HASH UNTER DEM TARGET GEFUNDEN: ' + m.hash);
    setStatus('Unglaublich – ein gültiger Hash! Details im Protokoll.', 'ok');
    alert('Gültiger Block-Hash gefunden!\n\n' + m.hash + '\n\nNonce: ' + m.nonce);
  }
}

function MinerDiff(hi, lo) {
  const v = hi * 4294967296 + lo;
  return v === 0 ? Infinity : (0xffff * 65536) / v;
}

/* ---------- Steuerung ---------- */
function canRun() {
  const b = state.battery;
  if (ui.onlyCharging.checked && b && !b.charging) return 'Pausiert – warte auf Ladekabel 🔌';
  if (b && !b.charging && b.level < 0.15) return 'Pausiert – Akku unter 15 %';
  return null;
}

function evaluate() {
  if (!state.want) {
    stopWorkers();
    setStatus('Bereit');
  } else {
    const blocked = canRun();
    if (blocked) {
      if (state.running) log(blocked);
      stopWorkers();
      setStatus(blocked, 'warn');
    } else {
      if (!state.running) startWorkers();
      setStatus(`Mining läuft mit ${state.workers.length} Thread(s)`, 'ok');
    }
  }
  ui.toggle.textContent = state.want ? '■ Stopp' : '▶ Start';
  ui.toggle.className = 'btn ' + (state.want ? 'stop' : 'start');
}

ui.toggle.addEventListener('click', () => {
  state.want = !state.want;
  log(state.want ? 'Start' : 'Stopp');
  evaluate();
});

ui.threads.addEventListener('input', () => {
  ui.threadsVal.textContent = ui.threads.value;
});
ui.threads.addEventListener('change', () => {
  localStorage.setItem('pm-threads', ui.threads.value);
  if (state.running) { restartWorkers(); evaluate(); }
});

ui.intensity.addEventListener('input', () => {
  ui.intensityVal.textContent = ui.intensity.value + ' %';
  const v = +ui.intensity.value / 100;
  state.workers.forEach((w) => w.postMessage({ type: 'intensity', value: v }));
  localStorage.setItem('pm-intensity', ui.intensity.value);
});

ui.onlyCharging.addEventListener('change', () => {
  localStorage.setItem('pm-charging', ui.onlyCharging.checked ? '1' : '0');
  evaluate();
});

ui.wakelock.addEventListener('change', updateWakeLock);

/* ---------- Akku & Wake Lock ---------- */
async function initBattery() {
  if (!navigator.getBattery) {
    ui.battery.textContent = '(Akku-Status in diesem Browser nicht verfügbar)';
    return;
  }
  try {
    const b = await navigator.getBattery();
    state.battery = b;
    const show = () => {
      ui.battery.textContent = `(Akku ${Math.round(b.level * 100)} %, ${b.charging ? 'lädt' : 'lädt nicht'})`;
      evaluate();
    };
    b.addEventListener('chargingchange', show);
    b.addEventListener('levelchange', show);
    show();
  } catch {
    ui.battery.textContent = '(Akku-Status nicht verfügbar)';
  }
}

async function updateWakeLock() {
  const want = ui.wakelock.checked && state.running && document.visibilityState === 'visible';
  if (want && !state.wakeLock && 'wakeLock' in navigator) {
    try {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
    } catch { /* nicht erlaubt */ }
  } else if (!want && state.wakeLock) {
    state.wakeLock.release();
    state.wakeLock = null;
  }
}

document.addEventListener('visibilitychange', () => {
  updateWakeLock();
  if (document.visibilityState === 'hidden' && state.running) {
    log('App im Hintergrund – der Browser drosselt oder pausiert das Mining');
  }
});

/* ---------- Anzeige ---------- */
function loadBest() {
  try {
    const b = JSON.parse(localStorage.getItem('pm-best'));
    if (b && typeof b.diff === 'number') return b;
  } catch { /* ignorieren */ }
  return { diff: 0, hash: '' };
}

function saveBest() {
  localStorage.setItem('pm-best', JSON.stringify(state.best));
}

function renderBest() {
  ui.best.textContent = state.best.diff ? fmtBig(state.best.diff) : '–';
  ui.besthash.textContent = state.best.hash || '–';
}

function tick() {
  const now = performance.now();
  if (state.running) state.activeMs += now - state.lastTick;
  state.lastTick = now;

  const hps = state.running ? state.rates.reduce((a, b) => a + b, 0) * 1000 : 0;
  ui.hashrate.textContent = fmtRate(hps);
  ui.total.textContent = fmtBig(state.total);
  ui.uptime.textContent = fmtClock(state.activeMs);

  if (state.net && hps > 0) {
    const diff = bitsToDifficulty(state.net.bits);
    const hashesNeeded = diff * 4294967296;
    const perDay = (hps * 86400) / hashesNeeded;
    ui.chance.textContent = '1 zu ' + fmtBig(1 / perDay);
    ui.eta.textContent = fmtDuration(hashesNeeded / hps);
  } else {
    ui.chance.textContent = '–';
    ui.eta.textContent = '–';
  }
}

/* ---------- Start ---------- */
(function init() {
  const cores = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 16));
  ui.threads.max = cores;
  ui.threads.value = Math.min(+localStorage.getItem('pm-threads') || Math.max(1, Math.floor(cores / 2)), cores);
  ui.threadsVal.textContent = ui.threads.value;
  ui.intensity.value = localStorage.getItem('pm-intensity') || 50;
  ui.intensityVal.textContent = ui.intensity.value + ' %';
  ui.onlyCharging.checked = localStorage.getItem('pm-charging') !== '0';

  renderBest();
  initBattery();
  refreshNetwork(true).then(evaluate);
  setInterval(() => refreshNetwork(), TIP_POLL_MS);
  setInterval(tick, 1000);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
