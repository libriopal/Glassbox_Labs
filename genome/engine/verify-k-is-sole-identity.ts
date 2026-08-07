// genome/engine/verify-k-is-sole-identity.ts — handoff_p2/03_GENOME_ENGINE_SPEC.md
// Regression guard for the k-vs-glyph desync bug class (D9): `Tile` must carry
// exactly one field encoding kind/type identity (`k`), and no other field
// name that could plausibly encode a second copy of it.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let failures = 0;
const check = (name: string, cond: boolean, detail: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!cond) failures++;
};

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'src', 'board.ts'), 'utf8');
const tileMatch = /export interface Tile \{([^}]*)\}/.exec(src);
if (!tileMatch) {
  check('verify-k-is-sole-identity', false, 'Tile interface not found in board.ts');
} else {
  const fields = tileMatch[1]!
    .split(';')
    .map(f => f.trim())
    .filter(Boolean)
    .map(f => f.split(':')[0]!.trim());
  const DUPLICATE_IDENTITY_NAMES = /^(glyph|color|colour|type|kind2|display|variant|skin)$/i;
  const suspects = fields.filter(f => f !== 'id' && f !== 'k' && DUPLICATE_IDENTITY_NAMES.test(f));
  check(
    'verify-k-is-sole-identity',
    fields.includes('k') && suspects.length === 0,
    suspects.length === 0
      ? `Tile fields [${fields.join(', ')}] — k is the sole kind/type identity field`
      : `Tile has suspect duplicate-identity field(s): ${suspects.join(', ')}`,
  );
}

process.exit(failures === 0 ? 0 : 1);
