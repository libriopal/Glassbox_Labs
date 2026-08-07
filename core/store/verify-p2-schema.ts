// core/store/verify-p2-schema.ts — handoff_p2/02_SCHEMA_MIGRATIONS.sql
//
// Confirms genome_foundry and rm_finance schemas exist with their triggers
// actually firing: attempts a forbidden UPDATE against an immutable
// genome_organisms row and against ledger_transactions, and confirms both
// raise. Mirrors verify-store.ts's fallback: uses DATABASE_URL_ADMIN if set
// and reachable, else provisions a throwaway postgres:16-alpine container via
// docker for this run only. If neither is available, reports FAIL — not a
// quiet skip (H8: never report a gate green when the thing it gates could
// not actually run).
//
// Run: npx tsx core/store/verify-p2-schema.ts

import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { P2FoundryRmStore, LedgerAppendOnlyViolation, OrganismImmutableViolation } from './p2-foundry-rm.ts';
import { PostgresStore } from './postgres.ts';

let failures = 0;
const check = (name: string, cond: boolean, detail: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!cond) failures++;
};

function dockerAvailable(): boolean {
  return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
}

function provisionPostgres(): { containerName: string; url: string } {
  const containerName = `glassbox-verify-p2-pg-${process.pid}`;
  execFileSync('docker', [
    'run', '-d', '--rm', '--name', containerName,
    '-p', '0:5432',
    '-e', 'POSTGRES_PASSWORD=glassbox',
    '-e', 'POSTGRES_DB=glassbox_p2',
    'postgres:16-alpine',
  ]);
  const portOut = execFileSync('docker', ['port', containerName, '5432']).toString();
  const port = portOut.trim().split('\n')[0]!.split(':').pop();
  return { containerName, url: `postgres://postgres:glassbox@localhost:${port}/glassbox_p2` };
}

async function waitForReachable(url: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const admin = new PostgresStore({ adminUrl: url, userUrl: url });
      await admin.migrate();
      const p2 = new P2FoundryRmStore(url);
      await p2.migrate();
      await admin.close();
      await p2.close();
      return true;
    } catch {
      await new Promise((res) => setTimeout(res, 500));
    }
  }
  return false;
}

let adminUrl = process.env.DATABASE_URL_ADMIN ?? null;
let ownContainer: string | null = null;
let reachable = false;

if (adminUrl) {
  reachable = await waitForReachable(adminUrl, 10_000);
  if (!reachable) console.log('DATABASE_URL_ADMIN was set but unreachable/invalid — falling back to a throwaway local Postgres.');
}
if (!reachable && dockerAvailable()) {
  console.log('Provisioning a throwaway Postgres container via docker for this run (removed on exit).');
  const p = provisionPostgres();
  ownContainer = p.containerName;
  adminUrl = p.url;
  reachable = await waitForReachable(adminUrl, 60_000);
}

if (!reachable || !adminUrl) {
  check('verify-p2-schema', false, 'no reachable Postgres — set DATABASE_URL_ADMIN or install docker; not counted as a pass (H8)');
  process.exit(1);
}

const admin = new PostgresStore({ adminUrl, userUrl: adminUrl });
const p2 = new P2FoundryRmStore(adminUrl);

try {
  // Ensure a real account exists for the FK we added (heat_entries/ledger -> accounts).
  const accountId = `verify-p2-${randomUUID()}`;
  await admin.createAccount({ id: accountId, ageVerified21Plus: true, selfExcluded: false });

  // --- verify-organism-immutable-trigger ------------------------------------
  const organism = await p2.createGenomeOrganism({
    parentIds: [],
    generation: 0,
    karyotypeLabel: 'verify-p2-schema-probe',
    class: 'stress_test',
    mechanicsGenes: { cols: 6, rows: 6, kinds: 5, minMatch: 3 },
    economyGenes: {},
    notes: 'created by verify-p2-schema.ts — not a real organism',
  });
  let orgUpdateRaised = false;
  try {
    await p2.attemptForbiddenOrganismUpdate(organism.id);
  } catch (e) {
    orgUpdateRaised = e instanceof OrganismImmutableViolation;
  }
  check('verify-organism-immutable-trigger', orgUpdateRaised, 'UPDATE on immutable genome_organisms row raised OrganismImmutableViolation');

  // --- verify-ledger-append-only ---------------------------------------------
  await p2.withAdminTransaction(async (client) => {
    await p2.insertLedgerTransaction(client, {
      accountId,
      amountFx: 100n,
      direction: 'credit',
      reason: 'manual_adjustment',
      referenceTable: 'verify-p2-schema',
      referenceId: randomUUID(),
      idempotencyKey: randomUUID(),
    });
  });
  const rows = await p2.listLedgerTransactions(accountId);
  let ledgerUpdateRaised = false;
  try {
    await p2.attemptForbiddenLedgerUpdate(rows[0]!.id);
  } catch (e) {
    ledgerUpdateRaised = e instanceof LedgerAppendOnlyViolation;
  }
  check('verify-ledger-append-only', ledgerUpdateRaised, 'UPDATE on ledger_transactions raised LedgerAppendOnlyViolation');

  // --- schemas/tables exist ---------------------------------------------------
  const balance = await p2.getAccountBalance(accountId);
  check('verify-ledger-balance-view', balance === 100n, `rm_finance.account_balances derived correctly (balance_fx=${balance})`);
} finally {
  await admin.close();
  await p2.close();
  if (ownContainer) spawnSync('docker', ['stop', ownContainer]);
}

process.exit(failures === 0 ? 0 : 1);
