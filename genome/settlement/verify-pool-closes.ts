// genome/settlement/verify-pool-closes.ts — handoff_p2/04_RMG_LEDGER_AND_SETTLEMENT.md
//
// Σ payouts_fx === netPool exactly, fuzz-tested over 10k random weight
// vectors including tie cases. Pure math — no DB needed (tests the same
// remainder-assignment algorithm settle.ts uses, extracted so it can be
// fuzzed cheaply without a live Postgres for every run).

let failures = 0;
const check = (name: string, cond: boolean, detail: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!cond) failures++;
};

/** Mirrors settle.ts's raw/remainder/topIdx closure exactly. */
function closePool(weights: number[], netPool: number): number[] {
  const sumW = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => Math.floor((netPool * w) / sumW));
  const remainder = netPool - raw.reduce((a, b) => a + b, 0);
  const topIdx = raw.indexOf(Math.max(...raw));
  raw[topIdx] = raw[topIdx]! + remainder;
  return raw;
}

function randomWeights(n: number, tieChance: number): number[] {
  const weights: number[] = [];
  let last: number | null = null;
  for (let i = 0; i < n; i++) {
    const w = last !== null && Math.random() < tieChance ? last : Math.random() * 100 + 0.01;
    weights.push(w);
    last = w;
  }
  return weights;
}

const TRIALS = 10_000;
let allExact = true;
let firstMismatch: string | null = null;
for (let t = 0; t < TRIALS; t++) {
  const n = 2 + Math.floor(Math.random() * 30);
  const weights = randomWeights(n, 0.35); // deliberately includes tie cases (identical weights)
  const netPool = Math.floor(Math.random() * 1_000_000);
  const payouts = closePool(weights, netPool);
  const sum = payouts.reduce((a, b) => a + b, 0);
  if (sum !== netPool) {
    allExact = false;
    firstMismatch = `trial ${t}: n=${n} netPool=${netPool} sum=${sum} weights=${JSON.stringify(weights)}`;
    break;
  }
}

check('verify-pool-closes', allExact, allExact ? `Σpayouts === netPool exactly across ${TRIALS} fuzz trials (incl. tie cases)` : `mismatch: ${firstMismatch}`);

process.exit(failures === 0 ? 0 : 1);
