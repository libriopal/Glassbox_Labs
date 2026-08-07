// edi/verify-bsl-blocks-self-excluded.ts — handoff_p2/06_EDI_GOVERNANCE_SPEC.md
// Every allowlisted action attempted against a self-excluded account is
// refused, no exceptions, tested exhaustively over the allowlist.
import { ALLOWLIST } from './src/allowlist';
import { bslCheck } from './src/bsl';
import type { ProposedAction } from './src/types';

let failures = 0;
const check = (name: string, cond: boolean, detail: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!cond) failures++;
};

const selfExcludedAccount = { selfExcluded: true, ageVerified21Plus: true };

for (const kind of Object.keys(ALLOWLIST)) {
  const action: ProposedAction = { kind, payload: {}, rationale: 'verify probe', syntheticScore: 0, provenance: 'synthetic' };
  let refused = false;
  try {
    bslCheck(action, selfExcludedAccount);
  } catch (e) {
    refused = e instanceof Error && /self-excluded/.test(e.message);
  }
  check(`verify-bsl-blocks-self-excluded:${kind}`, refused, `bslCheck refuses '${kind}' against a self-excluded account`);
}

process.exit(failures === 0 ? 0 : 1);
