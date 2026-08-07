// 00_GOVERNANCE/verify-p2-checklist.ts — handoff_p2/08_VERIFY_CHECKLIST.md
//
// Runs every [BUILD] item for real and reports the result. Lists every
// [QUEUED] item with its actual blocker, honestly, per the checklist's own
// rule: "Do not mark any [QUEUED] item as passing via a stub or mock that
// always returns green ... A [QUEUED] item stays queued, visibly, until its
// real blocker clears." This script never marks a QUEUED item PASS/FAIL —
// it prints QUEUED with the blocker, full stop.
//
// Requires DATABASE_URL_ADMIN (a real dev Postgres) for most [BUILD] items —
// reports FAIL for those specific items if unreachable (H8), does not skip
// quietly. Run: DATABASE_URL_ADMIN=... npx tsx 00_GOVERNANCE/verify-p2-checklist.ts

import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

interface BuildCheck { name: string; cmd: string; args: string[]; cwd: string; requiresDb?: boolean; }
interface QueuedCheck { name: string; blockedOn: string; }

const BUILD_CHECKS: BuildCheck[] = [
  { name: 'verify-monorepo-boundary', cmd: 'npx', args: ['tsx', '00_GOVERNANCE/verify-monorepo-boundary.ts'], cwd: repoRoot },
  { name: 'verify-isomorphic-build', cmd: 'npx', args: ['tsx', 'verify-isomorphic-build.ts'], cwd: join(repoRoot, 'genome/engine') },
  { name: 'verify-no-float-sim', cmd: 'npx', args: ['tsx', 'verify-no-float-sim.ts'], cwd: join(repoRoot, 'genome/engine') },
  { name: 'verify-k-is-sole-identity', cmd: 'npx', args: ['tsx', 'verify-k-is-sole-identity.ts'], cwd: join(repoRoot, 'genome/engine') },
  { name: 'verify-pool-closes', cmd: 'npx', args: ['tsx', 'verify-pool-closes.ts'], cwd: join(repoRoot, 'genome/settlement') },
  { name: 'verify-idempotent-settlement', cmd: 'npx', args: ['tsx', 'verify-idempotent-settlement.ts'], cwd: join(repoRoot, 'genome/settlement'), requiresDb: true },
  { name: 'verify-row-lock-serializes', cmd: 'npx', args: ['tsx', 'verify-row-lock-serializes.ts'], cwd: join(repoRoot, 'genome/settlement'), requiresDb: true },
  { name: 'verify-ledger-append-only', cmd: 'npx', args: ['tsx', 'verify-ledger-append-only.ts'], cwd: join(repoRoot, 'genome/settlement'), requiresDb: true },
  { name: 'verify-feature-flag-gate', cmd: 'npx', args: ['tsx', 'verify-feature-flag-gate.ts'], cwd: join(repoRoot, 'genome/settlement') },
  { name: 'verify-job-no-double-claim', cmd: 'npx', args: ['tsx', 'core/store/verify-job-no-double-claim.ts'], cwd: repoRoot, requiresDb: true },
  { name: 'verify-edi-no-unscored-promotion', cmd: 'npx', args: ['tsx', 'verify-edi-no-unscored-promotion.ts'], cwd: join(repoRoot, 'workers/edi-curation'), requiresDb: true },
  { name: 'verify-bsl-blocks-self-excluded', cmd: 'npx', args: ['tsx', 'verify-bsl-blocks-self-excluded.ts'], cwd: join(repoRoot, 'edi') },
  { name: 'verify-allowlist-closed', cmd: 'npx', args: ['tsx', 'verify-allowlist-closed.ts'], cwd: join(repoRoot, 'edi') },
  { name: 'verify-promote-human-only', cmd: 'npx', args: ['tsx', 'verify-promote-human-only.ts'], cwd: join(repoRoot, 'edi') },
  { name: 'verify-branch-identity-not-hardcoded-ui', cmd: 'npx', args: ['tsx', 'verify-branch-identity-not-hardcoded-ui.ts'], cwd: join(repoRoot, 'game/branches-bcde') },
  { name: 'verify-economy-self-exclusion-unconditional', cmd: 'npx', args: ['tsx', 'verify-economy-self-exclusion-unconditional.ts'], cwd: join(repoRoot, 'game/branches-bcde') },
];

const QUEUED_CHECKS: QueuedCheck[] = [
  { name: 'verify-edi-spend-persisted', blockedOn: 'EDI worker must exist and make at least one real LLM call to test restart behavior against. The persisted-DB-row primitive is built (genome_foundry.worker_spend, workers/edi-curation/src/spend.ts) but no real LLM integration is wired up — no provider credentials in this environment, and handoff_p2 only offers it as an example, not a required feature.' },
  { name: 'verify-skill-delta', blockedOn: 'workers/montecarlo-harness must be running against real organisms. The worker infrastructure is built and proven (job claim/complete, harness_results writes), but the harness itself plays a single-swap-per-round proxy (no cascade/refill mechanic exists in 03_GENOME_ENGINE_SPEC.md) — not a validated game-balance simulation. See workers/montecarlo-harness/src/agents.ts header.' },
  { name: 'verify-no-degenerate-strategy', blockedOn: 'same as verify-skill-delta — needs real organisms and a validated simulation, not the single-swap proxy.' },
  { name: 'verify-precog-lift-ratio', blockedOn: 'HUMAN-CAL agent calibration, which needs playtest telemetry. No precognition mechanic exists anywhere in handoff_p2 to compute a lift ratio from — precogLiftMcts/precogLiftHumanCal are explicit NaN placeholders, not fabricated numbers.' },
  { name: 'verify-rm-settlement-legal-clearance', blockedOn: "E29 counsel — the gate for flipping FEATURE_RM_SETTLEMENT. Unresolved per every chat transcript and design doc reviewed; genome-settlement ships flagged off, as required." },
  { name: 'verify-branch-d-identity-confirmed', blockedOn: 'E-P2.1 Tier 1 decision. Recorded as openElection: \'E-P2.1\' in game/branches-bcde/src/branch-identity.ts, not silently treated as settled.' },
  { name: 'verify-genome-economy-election', blockedOn: 'E-P2.2 Tier 1 decision (does Track 2 pari-mutuel settlement need its own economy election, separate from Branch A). Not resolved here.' },
];

let passCount = 0;
let failCount = 0;
const failedChecks: string[] = [];

console.log('=== [BUILD] checks — must pass, run for real ===\n');
for (const c of BUILD_CHECKS) {
  if (c.requiresDb && !process.env.DATABASE_URL_ADMIN) {
    console.log(`FAIL  ${c.name} — DATABASE_URL_ADMIN is unset; not counted as a pass (H8)`);
    failCount++;
    failedChecks.push(c.name);
    continue;
  }
  try {
    execFileSync(c.cmd, c.args, { cwd: c.cwd, stdio: 'inherit', env: process.env });
    console.log(`>>> ${c.name}: PASS\n`);
    passCount++;
  } catch {
    console.log(`>>> ${c.name}: FAIL\n`);
    failCount++;
    failedChecks.push(c.name);
  }
}

console.log('=== [QUEUED] checks — blocked on a named external dependency, NOT run, NOT faked ===\n');
for (const c of QUEUED_CHECKS) {
  console.log(`QUEUED  ${c.name} — blocked on: ${c.blockedOn}`);
}

console.log(`\n=== Summary ===`);
console.log(`[BUILD]:  ${passCount}/${BUILD_CHECKS.length} passed${failCount > 0 ? ` (FAILED: ${failedChecks.join(', ')})` : ''}`);
console.log(`[QUEUED]: ${QUEUED_CHECKS.length} items, all honestly reported as still queued`);

process.exit(failCount === 0 ? 0 : 1);
