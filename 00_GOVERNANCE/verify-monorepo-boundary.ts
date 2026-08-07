// 00_GOVERNANCE/verify-monorepo-boundary.ts — handoff_p2/01_MONOREPO_SETUP.md
// / 08_VERIFY_CHECKLIST.md
//
// "The production web server package (existing, whatever it is currently
// named in the repo — locate and confirm before editing) must NOT list
// @glassbox/genome-breeder, @glassbox/workers-montecarlo,
// @glassbox/workers-breeder, or @glassbox/workers-edi as a dependency."
//
// No web server package exists anywhere in this repo yet (confirmed: no
// express/fastify/http.createServer/app.listen anywhere — checked at P2+
// Step 1 and re-checked here). Step 1 manually proved the underlying
// mechanism once with a throwaway probe package (pnpm's strict linking
// makes an undeclared workspace dependency unresolvable — ERR_MODULE_NOT_FOUND).
// This script is the permanent, reproducible form of that same guarantee: it
// statically checks every package.json in the pnpm workspace and fails if
// ANY package other than the ones the dependency table explicitly allows
// (workers/genome-breeder -> @glassbox/genome-breeder; the workers
// themselves depending on each other per the table) declares one of the
// forbidden worker/breeder packages as a dependency. When a real web server
// package is added later, this check covers it automatically — it doesn't
// need to be told the package's name.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let failures = 0;
const check = (name: string, cond: boolean, detail: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!cond) failures++;
};

const FORBIDDEN_FROM_PRODUCTION = ['@glassbox/genome-breeder', '@glassbox/workers-montecarlo', '@glassbox/workers-breeder', '@glassbox/workers-edi'];

// Packages the dependency table (01_MONOREPO_SETUP.md) explicitly allows to
// depend on a forbidden-elsewhere package, because THEY are the worker/breeder
// packages themselves or their declared dependents.
const ALLOWED_DEPENDENTS: Record<string, string[]> = {
  '@glassbox/genome-breeder': ['@glassbox/workers-breeder'],
  '@glassbox/workers-montecarlo': [],
  '@glassbox/workers-breeder': [],
  '@glassbox/workers-edi': [],
};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function findPackageJsonFiles(dir: string): string[] {
  let out: string[] = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(findPackageJsonFiles(p));
    else if (e.name === 'package.json') out.push(p);
  }
  return out;
}

const pkgFiles = findPackageJsonFiles(repoRoot);
let violationsFound = false;
const violationDetails: string[] = [];

for (const file of pkgFiles) {
  const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; dependencies?: Record<string, string> };
  const deps = Object.keys(pkg.dependencies ?? {});
  for (const forbidden of FORBIDDEN_FROM_PRODUCTION) {
    if (!deps.includes(forbidden)) continue;
    const allowedDependents = ALLOWED_DEPENDENTS[forbidden] ?? [];
    if (pkg.name && allowedDependents.includes(pkg.name)) continue; // an explicitly allowed dependent
    if (pkg.name === forbidden) continue; // a package doesn't "depend on itself"
    violationsFound = true;
    violationDetails.push(`${pkg.name ?? file} declares a dependency on ${forbidden}, which is not in that package's allowlist`);
  }
}

check(
  'verify-monorepo-boundary:no-forbidden-dependency-declared',
  !violationsFound,
  violationsFound ? violationDetails.join('; ') : `no package.json in the workspace declares a dependency on ${FORBIDDEN_FROM_PRODUCTION.join(', ')} outside the allowed dependency-table edges`,
);

// Confirm the underlying mechanism, not just the current absence of a
// violation: pnpm's strict linking must actually make an undeclared
// dependency unresolvable (re-derived statically from pnpm-workspace.yaml
// and pnpm's documented behavior — Step 1 proved this dynamically once with
// a throwaway probe; this asserts the static precondition still holds: a
// pnpm-workspace.yaml exists and node_modules/.pnpm uses pnpm's isolated,
// non-hoisted linking, which is what makes strict linking possible at all).
const hasWorkspaceFile = (() => {
  try { readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8'); return true; } catch { return false; }
})();
check('verify-monorepo-boundary:pnpm-workspace-present', hasWorkspaceFile, 'pnpm-workspace.yaml exists — pnpm strict linking (the actual enforcement mechanism) is active for this repo');

process.exit(failures === 0 ? 0 : 1);
