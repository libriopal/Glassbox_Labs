// workers/edi-curation/verify-edi-no-unscored-promotion.ts — handoff_p2/05_WORKERS_SPEC.md
// The shortlist workers/edi-curation produces never contains an organism
// lacking harness results.

import { randomUUID } from 'node:crypto';
import { P2FoundryRmStore } from '@glassbox/store/p2-foundry-rm';
import { curate } from './src/curation';

let failures = 0;
const check = (name: string, cond: boolean, detail: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!cond) failures++;
};

if (!process.env.DATABASE_URL_ADMIN) {
  check('verify-edi-no-unscored-promotion', false, 'DATABASE_URL_ADMIN is unset — cannot run against a real dev database, not faking a pass');
  process.exit(1);
}

const store = new P2FoundryRmStore();

try {
  const label = `verify-edi-unscored-${randomUUID()}`;
  const scoredOrganism = await store.createGenomeOrganism({
    parentIds: [], generation: 0, karyotypeLabel: label, class: 'baseline_recreation',
    mechanicsGenes: {}, economyGenes: {}, notes: 'scored probe organism',
  });
  const unscoredOrganism = await store.createGenomeOrganism({
    parentIds: [], generation: 0, karyotypeLabel: label, class: 'stress_test',
    mechanicsGenes: {}, economyGenes: {}, notes: 'unscored probe organism — must never appear in shortlist',
  });

  await store.recordHarnessResult({
    organismId: scoredOrganism.id,
    skillDelta: 20, solverMargin: 25, maxChainTypeShare: 0.2,
    precogLiftMcts: 1, precogLiftHumanCal: 1, degenerateStrategyFlag: false,
    raw: { note: 'verify probe' },
  });

  const result = await curate(store, [scoredOrganism.id, unscoredOrganism.id]);

  check(
    'verify-edi-no-unscored-promotion:scored-included',
    result.shortlist.some((s) => s.organismId === scoredOrganism.id),
    'the scored organism appears in the shortlist',
  );
  check(
    'verify-edi-no-unscored-promotion:unscored-excluded',
    !result.shortlist.some((s) => s.organismId === unscoredOrganism.id),
    'the unscored organism does NOT appear in the shortlist',
  );
  check(
    'verify-edi-no-unscored-promotion:unscored-recorded-as-excluded',
    result.excludedUnscored.includes(unscoredOrganism.id),
    'the unscored organism is recorded in excludedUnscored, not silently dropped',
  );
} finally {
  await store.close();
}

process.exit(failures === 0 ? 0 : 1);
