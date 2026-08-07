// genome/settlement/verify-ledger-append-only.ts — handoff_p2/04_RMG_LEDGER_AND_SETTLEMENT.md
//
// The DB-level trigger itself is proven once in core/store/verify-p2-schema.ts
// (the schema's own concern). This check proves the same guarantee holds for
// a row genome-settlement's own settleHeat actually produced — not just a
// manually inserted one — since that's the row this package's callers care
// about.

import { randomUUID } from 'node:crypto';
import { PostgresStore } from '@glassbox/store/postgres';
import { P2FoundryRmStore, LedgerAppendOnlyViolation } from '@glassbox/store/p2-foundry-rm';
import { settleHeat } from './src/settle';

let failures = 0;
const check = (name: string, cond: boolean, detail: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!cond) failures++;
};

if (!process.env.DATABASE_URL_ADMIN) {
  check('verify-ledger-append-only', false, 'DATABASE_URL_ADMIN is unset — cannot run against a real dev database, not faking a pass');
  process.exit(1);
}
process.env.FEATURE_RM_SETTLEMENT = 'true';

const admin = new PostgresStore({ adminUrl: process.env.DATABASE_URL_ADMIN, userUrl: process.env.DATABASE_URL_ADMIN });
const store = new P2FoundryRmStore();

try {
  const accountId = `ledger-ao-${randomUUID()}`;
  const secondAccountId = `ledger-ao-b-${randomUUID()}`;
  await admin.createAccount({ id: accountId, ageVerified21Plus: true, selfExcluded: false });
  await admin.createAccount({ id: secondAccountId, ageVerified21Plus: true, selfExcluded: false });

  const heat = await store.createHeat({ seed: 3, branch: 'A', opensAt: new Date().toISOString(), closesAt: new Date().toISOString(), weightConfigVersion: 1 });
  await store.createHeatEntry({ heatId: heat.id, accountId, stakeFx: 6553600n, bankedScoreFx: 65536000n, inputLogHash: 'h0' });
  await store.createHeatEntry({ heatId: heat.id, accountId: secondAccountId, stakeFx: 6553600n, bankedScoreFx: 32768000n, inputLogHash: 'h1' });

  await settleHeat(store, heat.id, randomUUID());

  const rows = await store.listLedgerTransactions(accountId);
  check('verify-ledger-append-only:settlement-produced-a-row', rows.length === 1, `settleHeat produced ${rows.length} ledger row(s) for the account under test`);

  let raised = false;
  try {
    await store.attemptForbiddenLedgerUpdate(rows[0]!.id);
  } catch (e) {
    raised = e instanceof LedgerAppendOnlyViolation;
  }
  check('verify-ledger-append-only:update-rejected', raised, 'UPDATE on a real settlement-produced ledger row raises LedgerAppendOnlyViolation');
} finally {
  await admin.close();
  await store.close();
}

process.exit(failures === 0 ? 0 : 1);
