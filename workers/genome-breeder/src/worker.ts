// workers/genome-breeder/src/worker.ts — handoff_p2/05_WORKERS_SPEC.md
//
// Wraps @glassbox/genome-breeder's breed(). Triggered on schedule or explicit
// request, never per-request from the web server — and this package must
// never be a dependency of the production web server package
// (01_MONOREPO_SETUP.md's dependency table).
//
// @glassbox/genome-breeder's breed() currently throws BreederNotImplementedError
// (see genome/breeder/src/index.ts — blocked on "Spec 38 REV B" historical-
// marker-alignment breeding, which handoff_p2 references but does not
// include). This worker's job handling is fully real and testable — claim,
// attempt breed(), mark done or failed honestly — it just cannot currently
// produce a successful breed because the algorithm it wraps doesn't exist
// yet. Marking every genome_breed job 'failed' with that reason recorded is
// the honest outcome, not a bug to paper over with a fake success path.
import { breed, BreederNotImplementedError, type BreedRequest } from '@glassbox/genome-breeder';
import type { P2FoundryRmStore } from '@glassbox/store/p2-foundry-rm';
import { pollAndClaim } from './poll';

function isBreedRequest(p: unknown): p is BreedRequest {
  return (
    typeof p === 'object' &&
    p !== null &&
    Array.isArray((p as Record<string, unknown>).parentIds) &&
    ((p as Record<string, unknown>).class === 'baseline_recreation' || (p as Record<string, unknown>).class === 'stress_test')
  );
}

export async function processOneJob(store: P2FoundryRmStore): Promise<boolean> {
  const job = await pollAndClaim(store, 'genome_breed');
  if (!job) return false;

  if (!isBreedRequest(job.payload)) {
    await store.failJob(job.id, { error: 'malformed payload: expected a BreedRequest ({ parentIds, class })' });
    return true;
  }

  try {
    const result = await breed(job.payload);
    await store.completeJob(job.id, result);
  } catch (err) {
    if (err instanceof BreederNotImplementedError) {
      await store.failJob(job.id, { error: err.message, blocked: 'Spec 38 REV B not included in handoff_p2' });
    } else {
      await store.failJob(job.id, { error: err instanceof Error ? err.message : String(err) });
    }
  }
  return true;
}

export async function runUntilEmpty(store: P2FoundryRmStore): Promise<number> {
  let processed = 0;
  while (await processOneJob(store)) processed++;
  return processed;
}
