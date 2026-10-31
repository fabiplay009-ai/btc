/* Web Worker: hasht Nonces in Paketen und meldet Fortschritt an die App. */
importScripts('miner-core.js');

let intensity = 1;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomizeExtraNonce(header) {
  // Merkle-Root (Bytes 36..67) neu würfeln -> neuer, unabhängiger Nonce-Raum.
  crypto.getRandomValues(header.subarray(36, 68));
}

async function mine(header, id) {
  let job = MinerCore.prepare(header);
  const best = { hi: 0xffffffff, lo: 0xffffffff, nonce: 0, hash: '' };
  let reportedHi = best.hi, reportedLo = best.lo;
  let nonce = 0;
  let batch = 4096;
  let pending = 0;
  let lastReport = performance.now();

  for (;;) {
    const t0 = performance.now();
    const found = MinerCore.scan(job, nonce, batch, best);
    const dt = performance.now() - t0;
    nonce += batch;
    pending += batch;

    if (found) {
      self.postMessage({ type: 'block', id, nonce: found.nonce, hash: found.hash, header: Array.from(header) });
    }
    if (best.hi !== reportedHi || best.lo !== reportedLo) {
      reportedHi = best.hi; reportedLo = best.lo;
      self.postMessage({ type: 'best', id, hi: best.hi, lo: best.lo, nonce: best.nonce, hash: best.hash });
    }

    const now = performance.now();
    if (now - lastReport >= 500) {
      self.postMessage({ type: 'progress', id, hashes: pending, ms: now - lastReport });
      pending = 0;
      lastReport = now;
    }

    if (nonce >= 0x100000000 - batch) {
      randomizeExtraNonce(header);
      job = MinerCore.prepare(header);
      nonce = 0;
    }

    // Paketgröße so anpassen, dass ein Paket ~40 ms dauert.
    if (dt < 25 && batch < 1 << 20) batch <<= 1;
    else if (dt > 80 && batch > 1024) batch >>= 1;

    // Drosselung: bei z. B. 50 % Leistung genauso lange pausieren wie gerechnet.
    await sleep(intensity >= 1 ? 0 : (dt * (1 - intensity)) / intensity);
  }
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'intensity') {
    intensity = Math.min(1, Math.max(0.05, msg.value));
  } else if (msg.type === 'start') {
    intensity = msg.intensity;
    const header = new Uint8Array(msg.header);
    randomizeExtraNonce(header);
    mine(header, msg.id);
  }
};
