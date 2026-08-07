/**
 * core/store/verify-store.ts — §14 checks owned by core/store/, admin/user split.
 *   verify-store-parity · verify-no-vendor-leak · verify-branch-a-db-constraint
 *   verify-telemetry-schema-clean · verify-economy-columns-match
 *   verify-deletion-cascade · verify-r1-anonymity · verify-branch-a-needs-opponent
 *   verify-rater-deletion
 * plus checks introduced by the admin/user split itself (not in the original
 * §14 table, since that table predates the split): the four former foreign
 * keys that now cross the physical database boundary are verified as
 * application-enforced soft references instead.
 *
 * P1 gate (§2): "Schema migrates clean; branch_a_no_bots a real DB CHECK;
 * adapter parity green." The SAME battery runs against both adapters —
 * that identity is what "parity" means.
 *
 * Postgres arm: uses DATABASE_URL_ADMIN / DATABASE_URL_USER if set. If
 * unset and docker is available, provisions two throwaway postgres:16-alpine
 * containers for this run only and removes them afterward. If neither is
 * available, the postgres-side checks and verify-store-parity report FAIL,
 * not a quiet skip — H8 forbids reporting a gate as green when the thing it
 * gates could not actually run.
 *
 * Run: npm run verify:store   ·   Exit 0 = every named check holds.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteStore } from './sqlite.ts';
import { PostgresStore } from './postgres.ts';
import { StoreConstraintError, type Store } from './types.ts';

let failures = 0;
const checkNames: string[] = [];
const check = (name: string, cond: boolean, detail: string) => {
  checkNames.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!cond) failures++;
};

// ---------------------------------------------------------------------------
// shared battery — identical operations against every Store implementation
// ---------------------------------------------------------------------------

async function runBattery(store: Store, label: string): Promise<Record<string, boolean>> {
  const r: Record<string, boolean> = {};
  await store.migrate();

  try {
    await store.createSession({ id: `${label}-bad1`, branch: 'A', isBotSession: true, seedCommit: 'c', boardSeed: 'b', playerCount: 2 });
    r['branch-a-db-constraint'] = false;
  } catch {
    r['branch-a-db-constraint'] = true;
  }

  try {
    await store.createSession({ id: `${label}-bad2`, branch: 'A', isBotSession: false, seedCommit: 'c', boardSeed: 'b', playerCount: 1 });
    r['branch-a-needs-opponent'] = false;
  } catch {
    r['branch-a-needs-opponent'] = true;
  }

  // a legitimate Branch A session (human-vs-human, two players) must still succeed
  await store.createSession({ id: `${label}-good`, branch: 'A', isBotSession: false, seedCommit: 'c', boardSeed: 'b', playerCount: 2 });

  const telCols = await store.listTelemetryColumns();
  const forbidden = ['session_length_ms', 'return_rate', 'streak_length', 'daily_active_flag'];
  r['telemetry-schema-clean'] = telCols.length > 0 && !telCols.some((c) => forbidden.includes(c));

  const acctCols = await store.listAccountColumns();
  const allowed = new Set(['id', 'age_verified_21_plus', 'self_excluded', 'self_exclusion_cooling_off_until', 'created_at', 'deleted_at']);
  const required = ['id', 'age_verified_21_plus', 'self_excluded'];
  r['economy-columns-match'] = acctCols.every((c) => allowed.has(c)) && required.every((c) => acctCols.includes(c));

  // --- admin/user split: soft-FK enforcement (application-checked, since the
  // real FK can no longer cross the physical database boundary) -------------

  let sessionRejectedBogusAccount = false;
  try {
    await store.createSession({ id: `${label}-bogus-acct`, accountId: `${label}-nonexistent-acct`, branch: 'B', isBotSession: false, seedCommit: 'c', boardSeed: 'b', playerCount: 1 });
  } catch (e) {
    sessionRejectedBogusAccount = e instanceof StoreConstraintError;
  }
  r['sessions-account-soft-fk'] = sessionRejectedBogusAccount;

  let contestedStateRejectedBogusHarvestRun = false;
  try {
    await store.createContestedState({ id: `${label}-bogus-hr`, harvestRunId: `${label}-nonexistent-hr`, stateSnapshot: {}, candidateMoves: ['a'], committeeMargin: 0 });
  } catch (e) {
    contestedStateRejectedBogusHarvestRun = e instanceof StoreConstraintError;
  }
  r['contested-states-harvest-run-soft-fk'] = contestedStateRejectedBogusHarvestRun;

  let auditLogRejectedBogusSession = false;
  try {
    await store.appendAuditLog({ sessionId: `${label}-nonexistent-session`, entry: { x: 1 } });
  } catch (e) {
    auditLogRejectedBogusSession = e instanceof StoreConstraintError;
  }
  r['audit-log-session-soft-fk'] = auditLogRejectedBogusSession;

  let convergedSeedRejectedBogusState = false;
  try {
    await store.upsertConvergedSeed({ contestedStateId: `${label}-nonexistent-cs`, distribution: {}, raterCount: 1 });
  } catch (e) {
    convergedSeedRejectedBogusState = e instanceof StoreConstraintError;
  }
  r['converged-seeds-contested-state-soft-fk'] = convergedSeedRejectedBogusState;

  // a legitimate harvest_run -> contested_state -> converged_seed chain must
  // still work once the referenced rows genuinely exist
  const hr = await store.createHarvestRun({ id: `${label}-hr1`, branch: 'D', committee: ['greedy'], seed: 's' });
  const cs0 = await store.createContestedState({ id: `${label}-cs0`, harvestRunId: hr.id, stateSnapshot: {}, candidateMoves: ['a', 'b'], committeeMargin: 0.2 });
  r['contested-states-harvest-run-soft-fk-accepts-real'] = cs0.harvestRunId === hr.id;

  // --- deletion cascade, now cross-database (§3.3) --------------------------

  const acct = await store.createAccount({ id: `${label}-acct` });
  const s2 = await store.createSession({
    id: `${label}-s2`,
    accountId: acct.id,
    branch: 'B',
    isBotSession: false,
    seedCommit: 'c',
    boardSeed: 'b',
    playerCount: 1,
  });
  await store.appendSessionEvent({ sessionId: s2.id, seq: 1, kind: 'TEST', payload: { ok: true } });
  await store.recordTelemetryEvent({ sessionId: s2.id, decisionLatencyMs: 100 });
  const cs = await store.createContestedState({ id: `${label}-cs1`, stateSnapshot: { board: 'x' }, candidateMoves: ['a', 'b'], committeeMargin: 0.1 });
  await store.upsertConvergedSeed({ contestedStateId: cs.id, distribution: { a: 1 }, raterCount: 1 });
  await store.deleteAccount(acct.id);
  const gone = await store.getSession(s2.id);
  const seedSurvives = await store.getConvergedSeed(cs.id);
  r['deletion-cascade'] = gone === null && seedSurvives !== null;

  const cs2 = await store.createContestedState({ id: `${label}-cs2`, stateSnapshot: { board: 'y' }, candidateMoves: ['x', 'y'], committeeMargin: 0.05 });
  await store.submitRaterJudgment({ raterId: `${label}-rA`, contestedStateId: cs2.id, round: 1, chosenMoveIndex: 0 });
  await store.submitRaterJudgment({ raterId: `${label}-rC`, contestedStateId: cs2.id, round: 1, chosenMoveIndex: 0 });
  const viewAsB = await store.getStateForRating(`${label}-rB`, cs2.id, 1);
  const round1Clean = viewAsB.round1Distribution === null && !JSON.stringify(viewAsB).includes(`${label}-rA`);
  const viewRound2 = await store.getStateForRating(`${label}-rD`, cs2.id, 2);
  const round2Clean =
    Array.isArray(viewRound2.round1Distribution) &&
    viewRound2.round1Distribution[0] === 2 &&
    !JSON.stringify(viewRound2).includes(`${label}-rA`) &&
    !JSON.stringify(viewRound2).includes(`${label}-rC`);
  r['r1-anonymity'] = round1Clean && round2Clean;

  await store.deleteRaterJudgments(`${label}-rA`);
  let resubmitOk = false;
  try {
    await store.submitRaterJudgment({ raterId: `${label}-rA`, contestedStateId: cs2.id, round: 1, chosenMoveIndex: 0 });
    resubmitOk = true;
  } catch {
    resubmitOk = false;
  }
  const seedStillThere = await store.getConvergedSeed(cs.id);
  r['rater-deletion'] = resubmitOk && seedStillThere !== null;

  await store.close();
  return r;
}

const NAMED: Record<string, string> = {
  'branch-a-db-constraint': 'verify-branch-a-db-constraint',
  'branch-a-needs-opponent': 'verify-branch-a-needs-opponent',
  'telemetry-schema-clean': 'verify-telemetry-schema-clean',
  'economy-columns-match': 'verify-economy-columns-match',
  'sessions-account-soft-fk': 'verify-sessions-account-soft-fk',
  'contested-states-harvest-run-soft-fk': 'verify-contested-states-harvest-run-soft-fk',
  'contested-states-harvest-run-soft-fk-accepts-real': 'verify-contested-states-harvest-run-soft-fk-accepts-real',
  'audit-log-session-soft-fk': 'verify-audit-log-session-soft-fk',
  'converged-seeds-contested-state-soft-fk': 'verify-converged-seeds-contested-state-soft-fk',
  'deletion-cascade': 'verify-deletion-cascade',
  'r1-anonymity': 'verify-r1-anonymity',
  'rater-deletion': 'verify-rater-deletion',
};

// ---------------------------------------------------------------------------
// verify-no-vendor-leak (DEF-08) — grep the source tree, core/store/ exempt
// ---------------------------------------------------------------------------

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_DIRS = ['core', 'engine', 'server', 'client', 'harvest', 'console', 'foundry', 'families', 'game', 'corpus', '00_GOVERNANCE', 'genome', 'edi', 'workers'];

function walk(dir: string, exts: string[]): string[] {
  let out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p, exts));
    else if (exts.includes(extname(e.name))) out.push(p);
  }
  return out;
}

/**
 * DEF-08 is about coupling (an import, a client, a hardcoded endpoint) —
 * not about being unable to explain the rule in a comment. Strip comments
 * before matching so a doc-comment referencing "Supabase" to explain *why*
 * a check exists doesn't trip the same alarm as an actual `import` would.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function scanForVendorLeak(): { clean: boolean; offendingFiles: string[] } {
  const offending: string[] = [];
  const exemptPrefix = join(repoRoot, 'core', 'store');
  for (const d of SOURCE_DIRS) {
    for (const file of walk(join(repoRoot, d), ['.ts', '.tsx'])) {
      if (file.startsWith(exemptPrefix)) continue;
      if (/supabase/i.test(stripComments(readFileSync(file, 'utf8')))) offending.push(file.slice(repoRoot.length + 1));
    }
  }
  return { clean: offending.length === 0, offendingFiles: offending };
}

// ---------------------------------------------------------------------------
// throwaway admin+user Postgres via docker, only when env URLs are absent
// ---------------------------------------------------------------------------

function dockerAvailable(): boolean {
  return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
}

function provisionPostgres(name: string): { containerName: string; url: string } {
  const containerName = `glassbox-verify-pg-${name}-${process.pid}`;
  execFileSync('docker', [
    'run', '-d', '--rm', '--name', containerName,
    '-p', '0:5432',
    '-e', 'POSTGRES_PASSWORD=glassbox',
    '-e', `POSTGRES_DB=glassbox_${name}`,
    'postgres:16-alpine',
  ]);
  const portOut = execFileSync('docker', ['port', containerName, '5432']).toString();
  const port = portOut.trim().split('\n')[0]!.split(':').pop();
  return { containerName, url: `postgres://postgres:glassbox@localhost:${port}/glassbox_${name}` };
}

function teardownPostgres(containerName: string): void {
  spawnSync('docker', ['stop', containerName]);
}

async function waitForPostgres(check: () => Promise<void>, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await check();
      return true;
    } catch {
      await new Promise((res) => setTimeout(res, 500));
    }
  }
  return false;
}

// ---------------------------------------------------------------------------

async function main() {
  const sqliteResults = await runBattery(new SqliteStore({ admin: ':memory:', user: ':memory:' }), 'sq');
  for (const [key, name] of Object.entries(NAMED)) {
    check(`${name} [sqlite]`, sqliteResults[key] === true, 'sqlite adapter enforces this independently of app code');
  }

  let adminUrl = process.env.DATABASE_URL_ADMIN ?? null;
  let userUrl = process.env.DATABASE_URL_USER ?? null;
  let ownContainers: string[] = [];
  let pgReachable = false;

  if (adminUrl && userUrl) {
    pgReachable = await waitForPostgres(async () => {
      const s = new PostgresStore({ adminUrl: adminUrl!, userUrl: userUrl! });
      await s.migrate();
      await s.close();
    }, 10_000);
    if (!pgReachable) console.log('DATABASE_URL_ADMIN/DATABASE_URL_USER were set but unreachable/invalid — falling back to throwaway local Postgres.');
  }
  if (!pgReachable && dockerAvailable()) {
    console.log('Provisioning two throwaway Postgres containers via docker for this run (removed on exit).');
    const admin = provisionPostgres('admin');
    const user = provisionPostgres('user');
    ownContainers = [admin.containerName, user.containerName];
    adminUrl = admin.url;
    userUrl = user.url;
    pgReachable = await waitForPostgres(async () => {
      const s = new PostgresStore({ adminUrl: adminUrl!, userUrl: userUrl! });
      await s.migrate(); // doubles as the literal "schema migrates clean" check, on both databases
      await s.close();
    }, 60_000);
  }

  let pgResults: Record<string, boolean> | null = null;
  try {
    if (pgReachable && adminUrl && userUrl) {
      pgResults = await runBattery(new PostgresStore({ adminUrl, userUrl }), 'pg');
      for (const [key, name] of Object.entries(NAMED)) {
        check(`${name} [postgres]`, pgResults[key] === true, 'postgres adapter enforces this independently of app code');
      }
    } else {
      for (const name of Object.values(NAMED)) {
        check(`${name} [postgres]`, false, 'no reachable admin+user Postgres pair — set DATABASE_URL_ADMIN/DATABASE_URL_USER or install docker; not counted as a pass (H8)');
      }
    }

    const vendorLeak = scanForVendorLeak();
    check(
      'verify-no-vendor-leak',
      vendorLeak.clean,
      vendorLeak.clean ? 'no vendor SDK name outside core/store/' : `found in ${vendorLeak.offendingFiles.join(', ')}`,
    );

    const parityHolds = pgResults !== null && Object.keys(NAMED).every((k) => sqliteResults[k] === pgResults![k]);
    check(
      'verify-store-parity',
      parityHolds,
      pgResults ? 'sqlite and postgres adapters agree on every check' : 'cannot claim parity without a reachable postgres admin+user pair',
    );
  } finally {
    for (const c of ownContainers) teardownPostgres(c);
  }

  console.log('');
  console.log(`${checkNames.length} named checks exercised.`);
  if (failures === 0) {
    console.log('P1 GATE HELD: schema migrates clean on both adapters (admin+user split); branch_a_no_bots is a real DB CHECK; adapter parity green.');
    process.exit(0);
  } else {
    console.log(`${failures} CHECK(S) FAILED.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
