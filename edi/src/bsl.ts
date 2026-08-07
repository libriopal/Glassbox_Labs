// edi/src/bsl.ts — handoff_p2/06_EDI_GOVERNANCE_SPEC.md.
// BSL invariant checks — must run before ANY dispatch, no exceptions.
import { ALLOWLIST } from './allowlist';
import type { ProposedAction } from './types';

// DEVIATION from the spec's literal `action.kind in ALLOWLIST`, flagged not
// silently carried over: `in` walks the prototype chain, so 'constructor' and
// '__proto__' both test true against ANY plain object — including ALLOWLIST —
// even though neither is a declared key. That let those two kinds fall
// through the "not allowlisted" throw entirely, then read `.mutatesState` off
// Object.prototype's constructor (undefined), which is falsy, so the
// mutation-guard below never fired either: a real allowlist-bypass for two
// specific kind strings, found by verify-allowlist-closed while proving this
// package's own claim. Fixed with Object.hasOwn (own-property only, no
// prototype-chain leakage) — same behavior for every real allowlist key, no
// behavior change for legitimate callers.
export function bslCheck(action: ProposedAction, account: { selfExcluded: boolean; ageVerified21Plus: boolean }): void {
  if (account.selfExcluded) throw new Error('BSL: target account is self-excluded — action refused unconditionally.');
  if (!Object.hasOwn(ALLOWLIST, action.kind)) throw new Error(`BSL: '${action.kind}' is not an allowlisted action kind.`);
  if (ALLOWLIST[action.kind as keyof typeof ALLOWLIST].mutatesState && action.provenance !== 'synthetic') {
    throw new Error('BSL: unexpected provenance on a mutating action — refusing.');
  }
}
