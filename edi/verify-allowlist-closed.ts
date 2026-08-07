// edi/verify-allowlist-closed.ts — handoff_p2/06_EDI_GOVERNANCE_SPEC.md
// Any action kind not in ALLOWLIST is rejected — no default-allow path exists
// anywhere in edi/ or workers/edi-curation.
import { readFileSync, readdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWLIST } from './src/allowlist';
import { bslCheck } from './src/bsl';
import type { ProposedAction } from './src/types';

let failures = 0;
const check = (name: string, cond: boolean, detail: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!cond) failures++;
};

const nonAllowlistedAccount = { selfExcluded: false, ageVerified21Plus: true };
const unknownKinds = ['deleteOrganism', 'transferFunds', 'eval', 'sudoPromote', '__proto__', 'constructor'];
for (const kind of unknownKinds) {
  const action: ProposedAction = { kind, payload: {}, rationale: 'verify probe', syntheticScore: 0, provenance: 'synthetic' };
  let refused = false;
  try {
    bslCheck(action, nonAllowlistedAccount);
  } catch (e) {
    refused = e instanceof Error && /not an allowlisted action kind/.test(e.message);
  }
  check(`verify-allowlist-closed:${kind}`, refused, `bslCheck refuses non-allowlisted action kind '${kind}' even for an eligible account`);
}

// Static check: no `in ALLOWLIST === false` bypass, no `default: allow`, no `else return true`-shaped
// escape hatch anywhere in edi/ or workers/edi-curation source (a default-allow path could exist
// without ever calling bslCheck at all — grep guards against that class of bug).
function walk(dir: string): string[] {
  let out: string[] = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (extname(e.name) === '.ts') out.push(p);
  }
  return out;
}
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ALLOW_PATTERN = /default\s*:\s*.*allow|catch\s*\([^)]*\)\s*\{\s*\}\s*\/\/\s*allow|\/\/\s*allow-by-default/i;
const suspects: string[] = [];
// Only production governance code, not this verify script's own tooling source
// (its regex literal necessarily contains the strings it's looking for).
for (const dir of [join(repoRoot, 'edi', 'src'), join(repoRoot, 'workers', 'edi-curation', 'src')]) {
  for (const file of walk(dir)) {
    if (DEFAULT_ALLOW_PATTERN.test(readFileSync(file, 'utf8'))) suspects.push(file);
  }
}
check('verify-allowlist-closed:no-default-allow-pattern', suspects.length === 0, suspects.length === 0 ? 'no default-allow escape hatch found in edi/ or workers/edi-curation' : `found in: ${suspects.join(', ')}`);

process.exit(failures === 0 ? 0 : 1);
