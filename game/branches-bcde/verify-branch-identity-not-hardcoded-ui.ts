// game/branches-bcde/verify-branch-identity-not-hardcoded-ui.ts
// handoff_p2/07_TRACK1_BRANCH_EXPANSION.md
//
// No UI component pre-commits a fixed identity/theme to Branch B, C, or E at
// build time (D2's "don't pre-commit" instruction) — identity is a
// runtime/content property, not a compile-time one.
//
// No UI layer exists anywhere in this repo yet (confirmed: no apps/web, no
// component directory, no .tsx/.jsx anywhere) — there is nothing to grep a
// violation INTO. Rather than skip this check (which would silently report
// green for the wrong reason), it positively verifies the two things that
// currently make the claim true: (1) BRANCH_IDENTITY_NOTES for B/C/E carry
// no fixed theme/mechanic-bundle assignment (D2), only D carries any
// specific identity, and it's marked ELECTION PENDING, not baked in; (2) a
// repo-wide grep for a hardcoded UI-identity pattern (e.g. a theme/component
// name keyed directly to "branchB"/"branchC"/"branchE") finds nothing. If a
// UI layer is added later, this same grep should be re-run against it.

import { readFileSync, readdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRANCH_IDENTITY_NOTES } from './src/branch-identity';

let failures = 0;
const check = (name: string, cond: boolean, detail: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!cond) failures++;
};

// Spec's own wording differs per branch (B/C: "no fixed identity pre-assigned";
// E: "not bound to any specific mechanic bundle") — both phrasings assert the
// same thing (no pre-commitment), so the check accepts either rather than
// assuming B/C's exact phrase applies verbatim to E too.
const NOT_PRE_COMMITTED_PATTERN = /no fixed identity pre-assigned|not bound to any specific/i;
const openIdentityBranches = ['B', 'C', 'E'] as const;
for (const branch of openIdentityBranches) {
  const note = BRANCH_IDENTITY_NOTES.find((n) => n.branch === branch)!;
  check(
    `verify-branch-identity-not-hardcoded-ui:${branch}-no-fixed-identity`,
    NOT_PRE_COMMITTED_PATTERN.test(note.description),
    `Branch ${branch}'s identity note does not pre-commit a fixed identity/theme`,
  );
}
const noteD = BRANCH_IDENTITY_NOTES.find((n) => n.branch === 'D')!;
check('verify-branch-identity-not-hardcoded-ui:D-flagged-open', noteD.openElection === 'E-P2.1', "Branch D's identity is flagged openElection: 'E-P2.1', not silently treated as settled");

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (['.ts', '.tsx', '.jsx', '.js', '.css'].includes(extname(e.name))) out.push(p);
  }
  return out;
}
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARDCODE_PATTERN = /branch[_-]?[bce]\s*[:=]\s*['"`](theme|component|style)/i;
const offending: string[] = [];
for (const file of walk(repoRoot)) {
  if (HARDCODE_PATTERN.test(readFileSync(file, 'utf8'))) offending.push(file.slice(repoRoot.length + 1));
}
check(
  'verify-branch-identity-not-hardcoded-ui:no-ui-layer-violation',
  offending.length === 0,
  offending.length === 0 ? 'no hardcoded branch-to-theme/component binding found anywhere in the repo (no UI layer exists yet)' : `found in: ${offending.join(', ')}`,
);

process.exit(failures === 0 ? 0 : 1);
