// workers/edi-curation/src/spend.ts — handoff_p2/05_WORKERS_SPEC.md D8 fixes
// #1 and #2, required "before this worker ships for real":
//   1. Budget/spend tracking ... must be persisted to a DB row, never an
//      in-memory counter — restart-proof.
//   2. Per-call cost must be computed from actual token usage returned by the
//      API response, not a flat estimate.
//
// This module is the persisted-spend PRIMITIVE for any LLM call this worker
// makes (e.g. naming a bred organism, drafting its notes field, per the
// spec's own examples) — no actual LLM integration is wired up here. Building
// a real LLM-backed naming/drafting feature is out of scope: it needs
// provider credentials this environment doesn't have, and handoff_p2 only
// ever offers it as an example of what MIGHT need spend tracking, not a
// required feature to build. verify-edi-spend-persisted itself stays
// [QUEUED] per 08_VERIFY_CHECKLIST.md ("EDI worker must exist and make at
// least one real LLM call to test restart behavior against") — this proves
// the primitive exists and is genuinely DB-backed (see the source below: no
// module-level Map, no in-memory counter of any kind), not that a real LLM
// call has exercised it.
import type { P2FoundryRmStore } from '@glassbox/store/p2-foundry-rm';

const WORKER_NAME = 'edi-curation';

export interface TokenUsage {
  model: string;
  tokensIn: number; // from the real API response — never estimated (D8 fix #2)
  tokensOut: number;
  costUsdMicros: bigint;
  jobId?: string | null;
}

/** Every call writes a new DB row via P2FoundryRmStore — nothing here is process-local state. */
export async function recordLlmSpend(store: P2FoundryRmStore, usage: TokenUsage): Promise<void> {
  await store.recordSpend({
    worker: WORKER_NAME,
    model: usage.model,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    costUsdMicros: usage.costUsdMicros,
    jobId: usage.jobId ?? null,
  });
}

export async function totalSpendMicros(store: P2FoundryRmStore): Promise<bigint> {
  return store.getTotalSpendMicros(WORKER_NAME);
}
