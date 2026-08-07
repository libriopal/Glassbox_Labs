// genome/engine/verify-isomorphic-build.ts — handoff_p2/01_MONOREPO_SETUP.md /
// 03_GENOME_ENGINE_SPEC.md. Proves the isomorphic claim rather than asserting
// it: tsc --noEmit under the package's own exact tsconfig, an esbuild bundle
// targeting es2022/browser, and a plain Node run via tsx — all three must
// succeed with zero errors.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

let failures = 0;
const check = (name: string, cond: boolean, detail: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!cond) failures++;
};

const PKG_DIR = dirname(fileURLToPath(import.meta.url));
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: PKG_DIR, stdio: 'pipe', encoding: 'utf8' });

// 1. tsc --noEmit under the exact isomorphic tsconfig (no DOM, no Node types).
try {
  run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json']);
  check('verify-isomorphic-build:tsc', true, 'tsc --noEmit clean under genome/engine/tsconfig.json');
} catch (e) {
  check('verify-isomorphic-build:tsc', false, (e as { stdout?: string }).stdout?.slice(0, 2000) ?? String(e));
}

// 2. Browser-target bundle via esbuild (proves no Node built-ins are pulled in).
try {
  run('npx', ['esbuild', 'src/index.ts', '--bundle', '--platform=browser', '--target=es2022', '--outfile=dist/browser.bundle.js']);
  check('verify-isomorphic-build:browser-bundle', true, 'esbuild --platform=browser bundle succeeded');
} catch (e) {
  check('verify-isomorphic-build:browser-bundle', false, (e as { stdout?: string }).stdout?.slice(0, 2000) ?? String(e));
}

// 3. Plain Node run via tsx (proves the same source also runs unmodified server-side).
const nodeProbeDir = mkdtempSync(join(tmpdir(), 'genome-engine-node-probe-'));
const probeFile = join(nodeProbeDir, 'probe.mjs');
try {
  const out = run('npx', ['tsx', join(PKG_DIR, 'src', 'index.ts')]);
  void out;
  writeFileSync(
    probeFile,
    `import { makeBoard, fx } from ${JSON.stringify(join(PKG_DIR, 'src', 'index.ts'))};
     const b = makeBoard({ cols: 6, rows: 6, kinds: 5, minMatch: 3 }, 42);
     if (b.tiles.length !== 36) throw new Error('unexpected board size: ' + b.tiles.length);
     if (typeof fx(1) !== 'number') throw new Error('fx() did not return a number-branded Fx');
     console.log('node-probe-ok');`,
  );
  const probeOut = run('npx', ['tsx', probeFile]);
  check('verify-isomorphic-build:node-run', probeOut.includes('node-probe-ok'), 'plain Node (tsx) run of src/index.ts succeeded');
} catch (e) {
  check('verify-isomorphic-build:node-run', false, (e as { stdout?: string }).stdout?.slice(0, 2000) ?? String(e));
} finally {
  rmSync(nodeProbeDir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
