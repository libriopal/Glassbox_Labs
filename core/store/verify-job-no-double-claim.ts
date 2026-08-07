// core/store/verify-job-no-double-claim.ts — handoff_p2/05_WORKERS_SPEC.md
//
// N concurrent worker instances of the same kind, M pending jobs — each job
// claimed exactly once. Tests the shared pollAndClaim contract (P2FoundryRmStore
// .claimJob, FOR UPDATE SKIP LOCKED) all three workers/* packages use — this
// lives in core/store because that's where the DB mechanics actually live;
// workers/* each depend on it but don't reimplement it. Requires a real dev
// Postgres — reports FAIL, not a quiet skip, if unreachable (H8).

import { randomUUID } from 'node:crypto';
import { P2FoundryRmStore, type JobRow } from './p2-foundry-rm.ts';

let failures = 0;
const check = (name: string, cond: boolean, detail: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!cond) failures++;
};

if (!process.env.DATABASE_URL_ADMIN) {
  check('verify-job-no-double-claim', false, 'DATABASE_URL_ADMIN is unset — cannot run against a real dev database, not faking a pass');
  process.exit(1);
}

const M_JOBS = 12;
const N_WORKERS = 4;

const seeder = new P2FoundryRmStore();
const workerStores = Array.from({ length: N_WORKERS }, () => new P2FoundryRmStore());

try {
  const createdIds = new Set<string>();
  for (let i = 0; i < M_JOBS; i++) {
    const job = await seeder.createJob('montecarlo_harness', { probe: i }, randomUUID());
    createdIds.add(job.id);
  }

  // Each "worker instance" repeatedly claims until the queue is empty, all N
  // running concurrently against the SAME shared job queue — this is the
  // actual race verify-job-no-double-claim exists to prove doesn't happen.
  async function drain(store: P2FoundryRmStore): Promise<JobRow[]> {
    const claimed: JobRow[] = [];
    while (true) {
      const job = await store.claimJob('montecarlo_harness');
      if (!job) break;
      claimed.push(job);
    }
    return claimed;
  }

  const results = await Promise.all(workerStores.map((s) => drain(s)));
  const allClaimed = results.flat();

  const claimedForThisRun = allClaimed.filter((j) => createdIds.has(j.id));
  const claimedIds = claimedForThisRun.map((j) => j.id);
  const uniqueClaimedIds = new Set(claimedIds);

  check(
    'verify-job-no-double-claim:every-job-claimed',
    claimedForThisRun.length === M_JOBS,
    `${claimedForThisRun.length}/${M_JOBS} seeded jobs were claimed across ${N_WORKERS} concurrent worker instances`,
  );
  check(
    'verify-job-no-double-claim:no-job-claimed-twice',
    uniqueClaimedIds.size === claimedIds.length,
    `${claimedIds.length} claims, ${uniqueClaimedIds.size} unique job ids — FOR UPDATE SKIP LOCKED prevented any double-claim`,
  );

  const perWorkerCounts = results.map((r) => r.filter((j) => createdIds.has(j.id)).length);
  check(
    'verify-job-no-double-claim:work-actually-distributed',
    perWorkerCounts.filter((c) => c > 0).length > 1,
    `claims distributed across worker instances as ${JSON.stringify(perWorkerCounts)} (not all claimed by a single instance)`,
  );
} finally {
  await seeder.close();
  await Promise.all(workerStores.map((s) => s.close()));
}

process.exit(failures === 0 ? 0 : 1);
