// edi/verify-promote-human-only.ts — handoff_p2/06_EDI_GOVERNANCE_SPEC.md
// Grep confirms zero programmatic call sites invoke anything resembling
// promoteOrganism outside a human-triggered admin action.
import { readFileSync, readdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let failures = 0;
const check = (name: string, cond: boolean, detail: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!cond) failures++;
};

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
// Every dir a P2+ package could live in — the whole point is "anywhere in the repo," not just edi/.
const SCAN_DIRS = ['edi', 'workers', 'genome', 'game', 'core', 'families', 'foundry', 'corpus', '00_GOVERNANCE'];

// promoteOrganism appearing as an ALLOWLIST key (edi/src/allowlist.ts, gate: 'HUMAN_ONLY') is fine —
// that's the declaration, not a call site. A call site looks like `promoteOrganism(` or
// `.promoteOrganism(` or being invoked as a property access followed by a call.
const CALL_SITE_PATTERN = /\bpromoteOrganism\s*\(/;
const ALLOWLIST_FILE = join(repoRoot, 'edi', 'src', 'allowlist.ts');

const THIS_FILE = fileURLToPath(import.meta.url);
const callSites: string[] = [];
for (const dir of SCAN_DIRS) {
  for (const file of walk(join(repoRoot, dir))) {
    if (file === ALLOWLIST_FILE) continue; // the declaration site, not a call
    if (file === THIS_FILE) continue; // this script's own description text mentions the pattern it looks for
    const src = readFileSync(file, 'utf8');
    if (CALL_SITE_PATTERN.test(src)) callSites.push(file.slice(repoRoot.length + 1));
  }
}

check(
  'verify-promote-human-only',
  callSites.length === 0,
  callSites.length === 0
    ? 'zero programmatic call sites invoke promoteOrganism(...) anywhere in the repo — HUMAN_ONLY holds'
    : `found call site(s) in: ${callSites.join(', ')}`,
);

process.exit(failures === 0 ? 0 : 1);
