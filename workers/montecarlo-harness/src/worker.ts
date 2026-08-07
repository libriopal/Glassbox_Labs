// workers/montecarlo-harness/src/worker.ts — handoff_p2/05_WORKERS_SPEC.md
//
// OUT OF PROCESS from the web server (blueprint §3.4/§5.4) — this package is
// not, and must never become, a dependency of the production web server
// package (01_MONOREPO_SETUP.md's dependency table).
import type { OrganismParams } from '@glassbox/genome-engine';
import type { P2FoundryRmStore } from '@glassbox/store/p2-foundry-rm';
import { pollAndClaim } from './poll';
import { runHarness, toRecordHarnessResultInput } from './harness';

export interface MonteCarloJobPayload {
  organismId: string;
  mechanicsGenes: OrganismParams;
}

function isMonteCarloJobPayload(p: unknown): p is MonteCarloJobPayload {
  return typeof p === 'object' && p !== null && typeof (p as Record<string, unknown>).organismId === 'string';
}

/** Claims and processes exactly one pending montecarlo_harness job, if any. Returns whether one was processed. */
export async function processOneJob(store: P2FoundryRmStore): Promise<boolean> {
  const job = await pollAndClaim(store, 'montecarlo_harness');
  if (!job) return false;

  if (!isMonteCarloJobPayload(job.payload)) {
    await store.failJob(job.id, { error: 'malformed payload: expected { organismId, mechanicsGenes }' });
    return true;
  }

  try {
    const report = runHarness(job.payload.organismId, job.id, job.payload.mechanicsGenes);
    await store.recordHarnessResult(toRecordHarnessResultInput(report));
    await store.completeJob(job.id, { skillDelta: report.skillDelta, solverMargin: report.solverMargin, maxChainTypeShare: report.maxChainTypeShare });
  } catch (err) {
    await store.failJob(job.id, { error: err instanceof Error ? err.message : String(err) });
  }
  return true;
}

/** Drains the queue: processes jobs until none remain. Used by long-running worker processes. */
export async function runUntilEmpty(store: P2FoundryRmStore): Promise<number> {
  let processed = 0;
  while (await processOneJob(store)) processed++;
  return processed;
}
