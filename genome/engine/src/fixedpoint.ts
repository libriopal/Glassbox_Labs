// genome/engine/src/fixedpoint.ts — Spec 34 §5.2, reused verbatim.
//
// Q16.16 fixed-point, distinct from game/determinism/fixed-point.ts's Q×1000
// scheme used for turn-scoring. Do not mix the two schemes — they use
// different scale factors and interoperating them silently produces wrong
// values. This module backs board/match physics and, downstream, rm_finance
// money math (genome/settlement) — nothing in game/determinism/.

export type Fx = number & { readonly __fx: unique symbol }; // Q16.16, stored as i32
const FX_SHIFT = 16;

export const fx = (n: number): Fx => ((n * (1 << FX_SHIFT)) | 0) as Fx;
export const fxToFloat = (v: Fx): number => v / (1 << FX_SHIFT);
export const fxAdd = (a: Fx, b: Fx): Fx => ((a as number) + (b as number)) as Fx;
export const fxMul = (a: Fx, b: Fx): Fx => (Math.imul(a >> 8, b >> 8)) as Fx; // guard bits per Spec 34
