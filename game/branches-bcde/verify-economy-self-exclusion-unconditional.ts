// game/branches-bcde/verify-economy-self-exclusion-unconditional.ts
// handoff_p2/07_TRACK1_BRANCH_EXPANSION.md
// Fuzz-test economyVisible across all branch values with selfExcluded: true —
// must return false in every case, no branch-specific bypass possible.
import { economyVisible } from './src/economy';
import type { Account } from '../economy/types';

let failures = 0;
const check = (name: string, cond: boolean, detail: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!cond) failures++;
};

const BRANCHES = ['A', 'B', 'C', 'D', 'E'] as const;
const TRIALS_PER_BRANCH = 200;

let anyBypass = false;
let bypassDetail = '';
for (const branch of BRANCHES) {
  for (let t = 0; t < TRIALS_PER_BRANCH; t++) {
    const account: Account = {
      id: `fuzz-${branch}-${t}`,
      ageVerified21Plus: Math.random() < 0.5, // fuzz age too — self-exclusion must dominate regardless
      selfExcluded: true,
    };
    const visible = economyVisible(account, branch);
    if (visible) {
      anyBypass = true;
      bypassDetail = `branch=${branch} account=${JSON.stringify(account)} returned economyVisible=true`;
      break;
    }
  }
  if (anyBypass) break;
}
check(
  'verify-economy-self-exclusion-unconditional:no-bypass',
  !anyBypass,
  anyBypass ? `bypass found: ${bypassDetail}` : `economyVisible(selfExcluded=true, *) === false across all 5 branches x ${TRIALS_PER_BRANCH} fuzz trials`,
);

// Also confirm branch-less callers (existing single-arg call sites) still get the same guarantee.
const excludedNoBranch: Account = { id: 'fuzz-no-branch', ageVerified21Plus: true, selfExcluded: true };
check(
  'verify-economy-self-exclusion-unconditional:branchless-callers-unaffected',
  economyVisible(excludedNoBranch) === false,
  'the existing single-arg economyVisible(account) call shape is unaffected by the additive branch parameter',
);

process.exit(failures === 0 ? 0 : 1);
