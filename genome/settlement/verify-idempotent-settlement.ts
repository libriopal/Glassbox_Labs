// genome/settlement/verify-idempotent-settlement.ts — handoff_p2/04_RMG_LEDGER_AND_SETTLEMENT.md
//
// Calling settleHeat twice with the same idempotencyKey produces one
// settlement row, not two. Requires a real dev Postgres (DATABASE_URL_ADMIN)
// — reports FAIL, not a quiet skip, if unset (H8).

import { randomUUID } from 'node:crypto';
import { PostgresStore } from '@glassbox/store/postgres';
import { P2FoundryRmStore } from '@glassbox/store/p2-foundry-rm';
import { settleHeat, AlreadySettledError } from './src/settle';

let failures = 0;
const check = (name: string, cond: boolean, detail: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!cond) failures++;
};

if (!process.env.DATABASE_URL_ADMIN) {
  check('verify-idempotent-settlement', false, 'DATABASE_URL_ADMIN is unset — cannot run against a real dev database, not faking a pass');
  process.exit(1);
}
process.env.FEATURE_RM_SETTLEMENT = 'true';

const admin = new PostgresStore({ adminUrl: process.env.DATABASE_URL_ADMIN, userUrl: process.env.DATABASE_URL_ADMIN });
const store = new P2FoundryRmStore();

try {
  const accountIds = [`idem-a-${randomUUID()}`, `idem-b-${randomUUID()}`, `idem-c-${randomUUID()}`];
  for (const id of accountIds) await admin.createAccount({ id, ageVerified21Plus: true, selfExcluded: false });

  const heat = await store.createHeat({ seed: 1, branch: 'A', opensAt: new Date().toISOString(), closesAt: new Date().toISOString(), weightConfigVersion: 1 });
  const scores = [1000, 2000, 1500];
  for (let i = 0; i < accountIds.length; i++) {
    await store.createHeatEntry({
      heatId: heat.id,
      accountId: accountIds[i]!,
      stakeFx: 6553600n, // 100.0 in Q16.16
      bankedScoreFx: BigInt(scores[i]! * 65536),
      inputLogHash: `hash-${i}`,
    });
  }

  const idempotencyKey = randomUUID();
  await settleHeat(store, heat.id, idempotencyKey);
  let secondCallResult: 'threw-already-settled' | 'silently-succeeded' | 'other-error' = 'silently-succeeded';
  try {
    await settleHeat(store, heat.id, idempotencyKey);
  } catch (e) {
    secondCallResult = e instanceof AlreadySettledError ? 'threw-already-settled' : 'other-error';
  }
  check('verify-idempotent-settlement:second-call-rejected', secondCallResult === 'threw-already-settled', `second settleHeat call with same idempotencyKey: ${secondCallResult}`);

  const ledgerRowsForA = await store.listLedgerTransactions(accountIds[0]!);
  check(
    'verify-idempotent-settlement:one-ledger-row-not-two',
    ledgerRowsForA.length === 1,
    `account ${accountIds[0]} has ${ledgerRowsForA.length} ledger row(s) after two settleHeat calls with the same idempotencyKey — must be exactly 1`,
  );
} finally {
  await admin.close();
  await store.close();
}

process.exit(failures === 0 ? 0 : 1);
