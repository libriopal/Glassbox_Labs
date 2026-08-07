// genome/settlement/verify-feature-flag-gate.ts — handoff_p2/04_RMG_LEDGER_AND_SETTLEMENT.md
//
// Run FIRST, before any other verify script for this package (spec's own
// instruction): proves settleHeat throws — does not silently no-op or
// silently proceed — when FEATURE_RM_SETTLEMENT is unset/false, before
// anything else in this package is trusted.

import { settleHeat, FeatureFlagDisabledError } from './src/settle';
import type { P2FoundryRmStore } from '@glassbox/store/p2-foundry-rm';

let failures = 0;
const check = (name: string, cond: boolean, detail: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!cond) failures++;
};

// A store that would explode if settleHeat ever tried to touch it — proves the
// flag check happens before any DB work, not just before the final commit.
const explodingStore = new Proxy(
  {},
  {
    get() {
      throw new Error('settleHeat touched the store before checking FEATURE_RM_SETTLEMENT — flag check is not actually first');
    },
  },
) as unknown as P2FoundryRmStore;

async function attemptsThrow(envValue: string | undefined): Promise<boolean> {
  const prev = process.env.FEATURE_RM_SETTLEMENT;
  if (envValue === undefined) delete process.env.FEATURE_RM_SETTLEMENT;
  else process.env.FEATURE_RM_SETTLEMENT = envValue;
  try {
    await settleHeat(explodingStore, 'fake-heat-id', 'fake-idempotency-key');
    return false; // did not throw — FAIL
  } catch (e) {
    return e instanceof FeatureFlagDisabledError;
  } finally {
    if (prev === undefined) delete process.env.FEATURE_RM_SETTLEMENT;
    else process.env.FEATURE_RM_SETTLEMENT = prev;
  }
}

check('verify-feature-flag-gate:unset', await attemptsThrow(undefined), 'settleHeat throws FeatureFlagDisabledError when FEATURE_RM_SETTLEMENT is unset');
check('verify-feature-flag-gate:false', await attemptsThrow('false'), 'settleHeat throws FeatureFlagDisabledError when FEATURE_RM_SETTLEMENT=false');
check('verify-feature-flag-gate:garbage', await attemptsThrow('yes'), 'settleHeat throws FeatureFlagDisabledError for any value other than the literal string "true"');

process.exit(failures === 0 ? 0 : 1);
