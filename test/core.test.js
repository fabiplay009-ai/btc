// Testet den SHA-256d-Kern gegen den Bitcoin-Genesis-Block. Ausführen: node test/core.test.js
const assert = require('assert');
const core = require('../miner-core.js');

const GENESIS =
  '01000000' + '00'.repeat(32) +
  '3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a' +
  '29ab5f49' + 'ffff001d' + '1dac2b7c';
const GENESIS_HASH = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
const header = Uint8Array.from(Buffer.from(GENESIS, 'hex'));

// 1) Einzelner Hash stimmt und erfüllt das Target
const r = core.hashHeader(header);
assert.strictEqual(r.hash, GENESIS_HASH);
assert.strictEqual(r.found, true);

// 2) Scan über einen Bereich findet die Genesis-Nonce
const job = core.prepare(header);
const best = { hi: 0xffffffff, lo: 0xffffffff, nonce: 0, hash: '' };
const found = core.scan(job, 2083236893 - 5000, 10000, best);
assert.ok(found, 'Block sollte gefunden werden');
assert.strictEqual(found.nonce, 2083236893);
assert.strictEqual(found.hash, GENESIS_HASH);
assert.strictEqual(best.nonce, 2083236893);

// 3) Difficulty des Genesis-Hashes ≈ 2536
const d = core.difficultyFromTop(best.hi, best.lo);
assert.ok(d > 2530 && d < 2540, 'Difficulty ' + d);

// 4) Target aus bits
assert.strictEqual(core.bitsToTarget(0x1d00ffff), core.DIFF1);

// 5) Mini-Benchmark
const t0 = Date.now();
const N = 300000;
core.scan(job, 0, N, { hi: 0xffffffff, lo: 0xffffffff, nonce: 0, hash: '' });
const s = (Date.now() - t0) / 1000;
console.log('Alle Tests bestanden. Benchmark: ' + (N / s / 1e6).toFixed(2) + ' MH/s (1 Thread, Node)');
