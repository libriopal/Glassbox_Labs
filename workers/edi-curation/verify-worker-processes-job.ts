// workers/edi-curation/verify-worker-processes-job.ts
// End-to-end via the real job queue: claim -> curate -> write shortlist into
// job.result -> mark done. Also proves recordLlmSpend/totalSpendMicros write
// a real, persisted DB row (D8 fix #1) — not that a real LLM call exercised
// it (that stays [QUEUED], see spend.ts's header).

import { randomUUID } from 'node:crypto';
import { P2FoundryRmStore } from '@glassbox/store/p2-foundry-rm';
import { processOneJob } from './src/worker';
import { recordLlmSpend, totalSpendMicros } from './src/spend';

let failures = 0;
const check = (name: string, cond: boolean, detail: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!cond) failures++;
};

if (!process.env.DATABASE_URL_ADMIN) {
  check('verify-worker-processes-job', false, 'DATABASE_URL_ADMIN is unset — cannot run against a real dev database, not faking a pass');
  process.exit(1);
}

const store = new P2FoundryRmStore();

try {
  const organism = await store.createGenomeOrganism({
    parentIds: [], generation: 0, karyotypeLabel: `verify-edi-worker-${randomUUID()}`, class: 'baseline_recreation',
    mechanicsGenes: {}, economyGenes: {}, notes: 'edi worker probe organism',
  });
  await store.recordHarnessResult({
    organismId: organism.id, skillDelta: 15, solverMargin: 18, maxChainTypeShare: 0.25,
    precogLiftMcts: 1, precogLiftHumanCal: 1, degenerateStrategyFlag: false, raw: {},
  });

  const job = await store.createJob('edi_curation', { candidateOrganismIds: [organism.id] }, randomUUID());
  const processed = await processOneJob(store);
  check('verify-worker-processes-job:processed', processed, 'processOneJob claimed and processed the seeded edi_curation job');

  const jobAfter = await store.getJob(job.id);
  check('verify-worker-processes-job:marked-done', jobAfter?.status === 'done', `job status: ${jobAfter?.status}`);
  const shortlist = (jobAfter?.result as { shortlist?: unknown[] } | undefined)?.shortlist;
  check('verify-worker-processes-job:shortlist-in-result', Array.isArray(shortlist) && shortlist.length === 1, `job.result.shortlist = ${JSON.stringify(shortlist)}`);

  const before = await totalSpendMicros(store);
  await recordLlmSpend(store, { model: 'verify-probe-model', tokensIn: 100, tokensOut: 50, costUsdMicros: 1234n });
  const after = await totalSpendMicros(store);
  check('verify-worker-processes-job:spend-persisted', after - before === 1234n, `total spend increased by ${after - before} (expected 1234) — a real DB row, not an in-memory counter`);
} finally {
  await store.close();
}

process.exit(failures === 0 ? 0 : 1);
