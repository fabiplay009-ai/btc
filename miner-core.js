/*
 * miner-core.js – Bitcoin SHA-256d Kern (double SHA-256 auf 80-Byte-Blockheader).
 * Läuft im Web Worker (importScripts) und in Node (require) für Tests.
 * Optimierung: Midstate – der erste 64-Byte-Block des Headers wird nur einmal
 * komprimiert, pro Nonce sind dann nur noch 2 Kompressionen nötig.
 */
(function (root) {
  'use strict';

  const K = new Int32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  const IV = new Int32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  // Eine SHA-256-Kompression. w[0..15] muss gefüllt sein, w[16..63] wird überschrieben.
  function compress(st, w, out) {
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = st[0], b = st[1], c = st[2], d = st[3], e = st[4], f = st[5], g = st[6], h = st[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    out[0] = (st[0] + a) | 0; out[1] = (st[1] + b) | 0;
    out[2] = (st[2] + c) | 0; out[3] = (st[3] + d) | 0;
    out[4] = (st[4] + e) | 0; out[5] = (st[5] + f) | 0;
    out[6] = (st[6] + g) | 0; out[7] = (st[7] + h) | 0;
  }

  function bswap(x) {
    return ((x & 0xff) << 24) | ((x & 0xff00) << 8) | ((x >>> 8) & 0xff00) | (x >>> 24);
  }

  function readBE(b, o) {
    return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
  }

  // Ziel (Target) aus dem kompakten "bits"-Feld als BigInt.
  function bitsToTarget(bits) {
    const exp = bits >>> 24;
    const mant = BigInt(bits & 0x007fffff);
    return exp <= 3 ? mant >> BigInt(8 * (3 - exp)) : mant << BigInt(8 * (exp - 3));
  }

  const DIFF1 = 0xffffn << 208n;

  // Bereitet einen Job vor: Midstate + feste Wörter des zweiten Blocks.
  function prepare(header) {
    const w = new Int32Array(64);
    for (let i = 0; i < 16; i++) w[i] = readBE(header, i * 4);
    const mid = new Int32Array(8);
    compress(IV, w, mid);

    const w2 = new Int32Array(64);
    w2[0] = readBE(header, 64); // letzte 4 Bytes Merkle-Root
    w2[1] = readBE(header, 68); // Zeit
    w2[2] = readBE(header, 72); // bits
    w2[4] = 0x80000000 | 0;     // Padding
    w2[15] = 640;               // Länge: 80 Bytes = 640 Bit

    const w3 = new Int32Array(64);
    w3[8] = 0x80000000 | 0;
    w3[15] = 256;

    const bits = ((header[75] << 24) | (header[74] << 16) | (header[73] << 8) | header[72]) >>> 0;
    const target = bitsToTarget(bits);
    return {
      mid, w2, w3,
      out1: new Int32Array(8), out2: new Int32Array(8),
      target,
      targetHi: Number((target >> 224n) & 0xffffffffn),
      targetLo: Number((target >> 192n) & 0xffffffffn),
    };
  }

  // Hash eines fertigen Zustands als Hex in Bitcoin-Darstellung (umgedreht).
  function stateToHex(out) {
    let s = '';
    for (let i = 7; i >= 0; i--) {
      s += (bswap(out[i]) >>> 0).toString(16).padStart(8, '0');
    }
    return s;
  }

  function stateToBigInt(out) {
    return BigInt('0x' + stateToHex(out));
  }

  /*
   * Prüft `count` Nonces ab `start`. `best` = {hi, lo, nonce, hash} wird aktualisiert,
   * wenn ein "besserer" (kleinerer) Hash gefunden wird.
   * Rückgabe: Block-Fund {nonce, hash} oder null.
   */
  function scan(job, start, count, best) {
    const { mid, w2, w3, out1, out2, targetHi, targetLo } = job;
    let bestHi = best.hi, bestLo = best.lo;
    let found = null;
    const end = start + count;
    for (let n = start; n < end; n++) {
      w2[3] = bswap(n | 0);
      compress(mid, w2, out1);
      w3[0] = out1[0]; w3[1] = out1[1]; w3[2] = out1[2]; w3[3] = out1[3];
      w3[4] = out1[4]; w3[5] = out1[5]; w3[6] = out1[6]; w3[7] = out1[7];
      compress(IV, w3, out2);

      const hi = bswap(out2[7]) >>> 0;
      if (hi > bestHi && hi > targetHi) continue;
      const lo = bswap(out2[6]) >>> 0;
      if (hi < bestHi || (hi === bestHi && lo < bestLo)) {
        bestHi = hi; bestLo = lo;
        best.hi = hi; best.lo = lo; best.nonce = n >>> 0;
        best.hash = stateToHex(out2);
      }
      if (hi < targetHi || (hi === targetHi && lo <= targetLo)) {
        if (stateToBigInt(out2) <= job.target) {
          found = { nonce: n >>> 0, hash: stateToHex(out2) };
        }
      }
    }
    return found;
  }

  // Ungefähre Difficulty eines Hashes aus seinen obersten 64 Bit.
  function difficultyFromTop(hi, lo) {
    const v = hi * 4294967296 + lo;
    return v === 0 ? Infinity : (0xffff * 65536) / v;
  }

  function hashHeader(header) {
    const job = prepare(header);
    const nonce = (header[76] | (header[77] << 8) | (header[78] << 16) | (header[79] << 24)) >>> 0;
    const best = { hi: 0xffffffff, lo: 0xffffffff, nonce: 0, hash: '' };
    const found = scan(job, nonce, 1, best);
    return { hash: best.hash, found: !!found };
  }

  const api = { prepare, scan, difficultyFromTop, bitsToTarget, hashHeader, DIFF1 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MinerCore = api;
})(typeof self !== 'undefined' ? self : this);
