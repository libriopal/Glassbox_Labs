// workers/montecarlo-harness/verify-worker-processes-job.ts
// Not one of the spec's named verify hooks (those are verify-job-no-double-claim,
// covered centrally in core/store since it tests the shared claim mechanism —
// see that file's header) — this proves THIS worker's own job-processing path
// end to end against a real dev Postgres: claim -> run harness -> write
// harness_results -> mark job done.

import { randomUUID } from 'node:crypto';
import { P2FoundryRmStore } from '@glassbox/store/p2-foundry-rm';
import { processOneJob } from './src/worker';

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
    parentIds: [],
    generation: 0,
    karyotypeLabel: 'verify-worker-probe',
    class: 'stress_test',
    mechanicsGenes: { cols: 8, rows: 8, kinds: 5, minMatch: 3 },
    economyGenes: {},
    notes: 'created by verify-worker-processes-job.ts — not a real organism',
  });

  const job = await store.createJob('montecarlo_harness', { organismId: organism.id, mechanicsGenes: organism.mechanicsGenes }, randomUUID());
  check('verify-worker-processes-job:job-created-pending', true, `seeded job ${job.id} with status ${job.status}`);

  const processed = await processOneJob(store);
  check('verify-worker-processes-job:processed-one', processed, 'processOneJob claimed and processed the seeded job');

  const jobAfter = await store.getJob(job.id);
  check('verify-worker-processes-job:job-marked-done', jobAfter?.status === 'done', `job status after processing: ${jobAfter?.status}`);

  const hasResult = await store.hasHarnessResult(organism.id);
  check('verify-worker-processes-job:harness-result-written', hasResult, 'genome_foundry.harness_results has a row for this organism');

  const emptyQueue = await processOneJob(store);
  check('verify-worker-processes-job:no-double-processing', emptyQueue === false, 'a second call finds no pending job left (queue actually drained)');
} finally {
  await store.close();
}

process.exit(failures === 0 ? 0 : 1);
