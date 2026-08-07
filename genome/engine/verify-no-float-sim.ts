// genome/engine/verify-no-float-sim.ts — handoff_p2/03_GENOME_ENGINE_SPEC.md
// Grep the package source for non-deterministic primitives. Zero matches required.
import { readFileSync, readdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let failures = 0;
const check = (name: string, cond: boolean, detail: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!cond) failures++;
};

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'src');
const FORBIDDEN = /Math\.random|Date\.now|performance\.now|Math\.sin/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (extname(e.name) === '.ts') out.push(p);
  }
  return out;
}

const offending: string[] = [];
for (const file of walk(SRC_DIR)) {
  if (FORBIDDEN.test(readFileSync(file, 'utf8'))) offending.push(file);
}

check('verify-no-float-sim', offending.length === 0, offending.length === 0 ? 'no non-deterministic primitives found in src/' : `found in: ${offending.join(', ')}`);

process.exit(failures === 0 ? 0 : 1);
