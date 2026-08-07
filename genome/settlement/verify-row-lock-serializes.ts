// genome/settlement/verify-row-lock-serializes.ts — handoff_p2/04_RMG_LEDGER_AND_SETTLEMENT.md
//
// Two concurrent settleHeat calls on the same heatId, DIFFERENT idempotency
// keys (so the second isn't just rejected by verify-idempotent-settlement's
// path) — the second must wait for the first's transaction (FOR UPDATE row
// lock on rm_finance.heats), never interleave writes. Proven by: exactly one
// settlements row ends up attached to the heat (settlements.heat_id is
// UNIQUE), and the loser's insert fails on that UNIQUE constraint rather than
// silently producing two settlements or corrupting the ledger.

import { randomUUID } from 'node:crypto';
import { PostgresStore } from '@glassbox/store/postgres';
import { P2FoundryRmStore } from '@glassbox/store/p2-foundry-rm';
import { settleHeat } from './src/settle';

let failures = 0;
const check = (name: string, cond: boolean, detail: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!cond) failures++;
};

if (!process.env.DATABASE_URL_ADMIN) {
  check('verify-row-lock-serializes', false, 'DATABASE_URL_ADMIN is unset — cannot run against a real dev database, not faking a pass');
  process.exit(1);
}
process.env.FEATURE_RM_SETTLEMENT = 'true';

const admin = new PostgresStore({ adminUrl: process.env.DATABASE_URL_ADMIN, userUrl: process.env.DATABASE_URL_ADMIN });
const store = new P2FoundryRmStore();

try {
  const accountIds = [`lock-a-${randomUUID()}`, `lock-b-${randomUUID()}`];
  for (const id of accountIds) await admin.createAccount({ id, ageVerified21Plus: true, selfExcluded: false });

  const heat = await store.createHeat({ seed: 2, branch: 'A', opensAt: new Date().toISOString(), closesAt: new Date().toISOString(), weightConfigVersion: 1 });
  for (let i = 0; i < accountIds.length; i++) {
    await store.createHeatEntry({
      heatId: heat.id,
      accountId: accountIds[i]!,
      stakeFx: 6553600n,
      bankedScoreFx: BigInt((i + 1) * 1000 * 65536),
      inputLogHash: `hash-${i}`,
    });
  }

  // Two DIFFERENT idempotency keys racing on the SAME heat — the row lock, not
  // the idempotency check, is what must serialize this.
  const results = await Promise.allSettled([
    settleHeat(store, heat.id, randomUUID()),
    settleHeat(store, heat.id, randomUUID()),
  ]);

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const rejected = results.filter((r) => r.status === 'rejected').length;
  check(
    'verify-row-lock-serializes:exactly-one-winner',
    succeeded === 1 && rejected === 1,
    `${succeeded} succeeded, ${rejected} rejected (concurrent settleHeat on the same heat must never let both win)`,
  );
  if (rejected === 1) {
    const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    const msg = loser.reason instanceof Error ? loser.reason.message : String(loser.reason);
    check(
      'verify-row-lock-serializes:loser-fails-on-unique-settlement',
      /settlements_heat_id_key|duplicate key|unique/i.test(msg),
      `loser failed with a UNIQUE-constraint-shaped error (settlements.heat_id is UNIQUE), not a corrupted write: ${msg}`,
    );
  }

  const ledgerRowsForA = await store.listLedgerTransactions(accountIds[0]!);
  check(
    'verify-row-lock-serializes:no-double-write',
    ledgerRowsForA.length <= 1,
    `account ${accountIds[0]} has ${ledgerRowsForA.length} ledger row(s) — the loser's writes never landed, no interleaving`,
  );
} finally {
  await admin.close();
  await store.close();
}

process.exit(failures === 0 ? 0 : 1);
