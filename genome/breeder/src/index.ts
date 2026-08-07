// genome/breeder/src/index.ts
//
// GAP (flag, do not silently resolve): handoff_p2/05_WORKERS_SPEC.md says
// workers/genome-breeder "wraps @glassbox/genome-breeder's breed() (historical-
// marker alignment, Spec 38 REV B — NOT the retired hard karyotype gate)".
// The existing foundry/breeder/index.ts IS the retired hard-karyotype-gate
// implementation (W7-gated novelty check, per its own header) — the spec
// explicitly says not to use it. "Spec 38 REV B"'s actual historical-marker-
// alignment algorithm is not included anywhere in handoff_p2/, so there is
// nothing here to wrap without inventing the algorithm myself, which
// CLAUDE_CODE_PROMPT.md's "DO NOT invent requirements beyond what handoff_p2/
// specifies" forbids. This package exposes the typed contract
// workers/genome-breeder needs and throws NotImplementedError rather than
// faking a passing breed() — do not stub this out with a fake success path.

export interface BreedRequest {
  parentIds: string[];
  class: 'baseline_recreation' | 'stress_test';
}

export interface BreedResult {
  offspringId: string;
  parentIds: string[];
  generation: number;
  notes: string; // must state UNEVALUATED per 05_WORKERS_SPEC.md until harness scores it
}

export class BreederNotImplementedError extends Error {
  constructor() {
    super(
      'breed() is not implemented: handoff_p2 references "Spec 38 REV B" historical-marker ' +
        'alignment breeding but does not include that spec. The existing foundry/breeder ' +
        'implementation is the retired hard-karyotype-gate approach this package must NOT use. ' +
        'Blocked on Spec 38 REV B being handed off.',
    );
    this.name = 'BreederNotImplementedError';
  }
}

export function breed(_request: BreedRequest): Promise<BreedResult> {
  throw new BreederNotImplementedError();
}
