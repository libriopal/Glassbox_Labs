// edi/src/types.ts — handoff_p2/06_EDI_GOVERNANCE_SPEC.md, the "corpus callosum".
export type Provenance = 'nutrient' | 'synthetic'; // nutrient = real player/game data; synthetic = ACC/EDI-proposed, NEVER treated as nutrient
export interface AuditLogEntry {
  id: string; actor: 'ACC' | 'BSL' | 'SFC' | 'human'; action: string;
  provenance: Provenance; timestamp: string; payload: unknown;
}
export interface HaltCondition { code: `H${number}`; description: string; }
// H1-H10's actual descriptions live in one place only: §0.3 of
// design_handoff_glassbox_v6_phase2/17_PHASE2_HANDOFF_COMPLETE.md. No code-level
// registry of all ten exists anywhere in this repo to import (game/branch-a's
// constraint.ts references H1 ad hoc, as a string literal, not from a shared
// table) — so there is nothing to import. Per the spec's "do not redefine,
// import" instruction, this file intentionally does NOT fabricate a second,
// competing enumeration of H1-H10's descriptions; HaltCondition is a shape,
// not a lookup table. Consult the source doc for the actual ten conditions.

export interface ProposedAction {
  kind: string; payload: unknown; rationale: string; syntheticScore: number;
  provenance: 'synthetic'; // ACC output is ALWAYS synthetic — this is a type-level guarantee, not a runtime check
}
