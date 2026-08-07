// workers/genome-breeder/src/poll.ts — handoff_p2/05_WORKERS_SPEC.md
// Job polling contract (shared shape, all three workers).
import type { P2FoundryRmStore } from '@glassbox/store/p2-foundry-rm';

export interface Job { id: string; kind: 'montecarlo_harness' | 'genome_breed' | 'edi_curation'; payload: unknown; }

export async function pollAndClaim(store: P2FoundryRmStore, kind: Job['kind']): Promise<Job | null> {
  const row = await store.claimJob(kind);
  return row ? { id: row.id, kind: row.kind, payload: row.payload } : null;
}
