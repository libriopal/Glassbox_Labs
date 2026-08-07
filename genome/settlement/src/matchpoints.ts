// genome/settlement/src/matchpoints.ts — Spec 36 §2, reused verbatim from the design phase.
import { fx, type Fx } from '@glassbox/genome-engine/fixedpoint';

export class HeatTooSmallError extends Error {
  constructor(n: number) { super(`Heat has ${n} entrant(s); minimum is 2 (matchpoints require a comparator).`); }
}

export function matchpoints(scores: Fx[], selfIdx: number): { m_i: Fx; M: number; p_i: Fx } {
  if (scores.length < 2) throw new HeatTooSmallError(scores.length);
  const s = scores[selfIdx]!;
  let beats = 0, ties = 0;
  for (let j = 0; j < scores.length; j++) {
    if (j === selfIdx) continue;
    if (scores[j]! < s) beats++; else if (scores[j] === s) ties++;
  }
  const m_i = (fx(beats) as number + (fx(ties) as number) / 2) as Fx;
  const M = scores.length - 1;
  return { m_i, M, p_i: ((m_i as number) / M) as Fx };
}

// Neuberg normalization for unequal heat sizes (Spec 36 §2.2)
export function neuberg(m_i: Fx, n: number, N: number): Fx {
  return (((m_i as number + (fx(1) as number)) * N) / n - (fx(1) as number)) as Fx;
}
export const MIN_HEAT_N = 8; // below this, merge_forward per schema `heats.status`

// Weight curve — g(p) — ELECTION PENDING (E-P2.3): FLOOR_W/GAMMA below are the
// unsourced v1 placeholders flagged in Spec 38 REV B, accepted here as engineering
// defaults pending Tier 1 resolution. Do not treat as tuned/final.
export interface WeightConfig { FLOOR_W: number; GAMMA: number; version: number; }
export const DEFAULT_WEIGHT_CONFIG: WeightConfig = { FLOOR_W: 0.18, GAMMA: 2.4, version: 1 }; // ELECTION PENDING

export function weight(p: Fx, cfg: WeightConfig): Fx {
  const pf = Math.max(0, Math.min(1, fxToFloatSafe(p)));
  return fx(cfg.FLOOR_W + (1 - cfg.FLOOR_W) * Math.pow(pf, cfg.GAMMA));
}
function fxToFloatSafe(v: Fx): number { return (v as number) / 65536; }
