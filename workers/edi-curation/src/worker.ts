// workers/edi-curation/src/worker.ts — handoff_p2/05_WORKERS_SPEC.md
//
// OUT OF PROCESS from the web server — this package must never be a
// dependency of the production web server package (01_MONOREPO_SETUP.md's
// dependency table).
//
// Output: "a shortlist table/view Tier 1 reviews manually" — implemented as
// the completed job's `result` column (genome_foundry.jobs.result, JSONB,
// already exists per 02_SCHEMA_MIGRATIONS.sql) rather than a new dedicated
// table, since the jobs table already carries exactly this shape for every
// worker kind and handoff_p2 doesn't specify a separate shortlist table.
import { P2FoundryRmStore } from '@glassbox/store/p2-foundry-rm';
import { pollAndClaim } from './poll';
import { curate } from './curation';

export interface EdiCurationPayload { candidateOrganismIds: string[]; }

function isEdiCurationPayload(p: unknown): p is EdiCurationPayload {
  return typeof p === 'object' && p !== null && Array.isArray((p as Record<string, unknown>).candidateOrganismIds);
}

export async function processOneJob(store: P2FoundryRmStore): Promise<boolean> {
  const job = await pollAndClaim(store, 'edi_curation');
  if (!job) return false;

  if (!isEdiCurationPayload(job.payload)) {
    await store.failJob(job.id, { error: 'malformed payload: expected { candidateOrganismIds: string[] }' });
    return true;
  }

  const result = await curate(store, job.payload.candidateOrganismIds);
  await store.completeJob(job.id, result);
  return true;
}

export async function runUntilEmpty(store: P2FoundryRmStore): Promise<number> {
  let processed = 0;
  while (await processOneJob(store)) processed++;
  return processed;
}
