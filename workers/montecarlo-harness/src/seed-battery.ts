// workers/montecarlo-harness/src/seed-battery.ts — handoff_p2/05_WORKERS_SPEC.md
// "a committed, hashed seed battery (not freshly generated per run — see
// Spec 35 §5.3)". Committed = the same battery every run, derived
// deterministically from a fixed label (not Math.random/Date.now — genome-
// engine's own verify-no-float-sim rule extended here by convention, since
// this battery feeds genome-engine runs and must be exactly reproducible).
import { createHash } from 'node:crypto';

const BATTERY_LABEL = 'glassbox-p2-montecarlo-harness-seed-battery-v1';

export function seedBattery(size: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < size; i++) {
    const hex = createHash('sha256').update(`${BATTERY_LABEL}:${i}`).digest('hex').slice(0, 8);
    out.push(parseInt(hex, 16) >>> 0);
  }
  return out;
}
