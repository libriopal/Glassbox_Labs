// workers/genome-breeder/verify-worker-fails-honestly.ts
// Proves this worker does NOT fake a success path for genome_breed jobs while
// breed() is unimplemented — it claims the job for real and marks it failed
// with the real blocking reason, rather than silently no-oping or fabricating
// a result. verify-job-no-double-claim (the shared claim mechanism) is
// covered centrally in core/store — see that file's header.

import { randomUUID } from 'node:crypto';
import { P2FoundryRmStore } from '@glassbox/store/p2-foundry-rm';
import { processOneJob } from './src/worker';

let failures = 0;
const check = (name: string, cond: boolean, detail: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!cond) failures++;
};

if (!process.env.DATABASE_URL_ADMIN) {
  check('verify-worker-fails-honestly', false, 'DATABASE_URL_ADMIN is unset — cannot run against a real dev database, not faking a pass');
  process.exit(1);
}

const store = new P2FoundryRmStore();

try {
  const job = await store.createJob('genome_breed', { parentIds: [], class: 'stress_test' }, randomUUID());
  const processed = await processOneJob(store);
  check('verify-worker-fails-honestly:job-claimed', processed, 'processOneJob claimed the seeded genome_breed job');

  const jobAfter = await store.getJob(job.id);
  check('verify-worker-fails-honestly:marked-failed-not-done', jobAfter?.status === 'failed', `job status: ${jobAfter?.status} (must be 'failed', never a fabricated 'done')`);

  const resultBlocked = (jobAfter?.result as Record<string, unknown> | undefined)?.blocked;
  check('verify-worker-fails-honestly:reason-recorded', resultBlocked === 'Spec 38 REV B not included in handoff_p2', `job.result.blocked = ${JSON.stringify(resultBlocked)}`);
} finally {
  await store.close();
}

process.exit(failures === 0 ? 0 : 1);
