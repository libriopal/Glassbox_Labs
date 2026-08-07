// game/branches-bcde/src/branch-identity.ts — handoff_p2/07_TRACK1_BRANCH_EXPANSION.md
//
// Branch identity (fresh, per D7 — both prior taxonomy docs formally retired).
// Branch letter assignment for a given piece of content happens at PROMOTION
// TIME (HUMAN_ONLY, see @glassbox/edi's ALLOWLIST.promoteOrganism), not at
// authoring time — nothing here pre-commits a fixed identity/theme to a
// branch at build time (verify-branch-identity-not-hardcoded-ui).

export interface BranchIdentityNote {
  branch: 'B' | 'C' | 'D' | 'E';
  description: string;
  /** Present only when Tier 1 has not explicitly (re)confirmed this identity — do not treat as settled. */
  openElection?: string;
}

export const BRANCH_IDENTITY_NOTES: readonly BranchIdentityNote[] = [
  {
    branch: 'B',
    description:
      'Exploration branch. No fixed identity pre-assigned. Content may express social-drama-lineage ideas ' +
      '(negotiation, hidden information) or spectatorship-lineage ideas (witnessed risk, observer roles), or blends, ' +
      'as the foundry breeds it (D2).',
  },
  {
    branch: 'C',
    description: 'Exploration branch, same latitude as Branch B (D2) — no fixed identity pre-assigned.',
  },
  {
    branch: 'D',
    description: 'Solo skill/mastery-lineage — preserved for continuity with existing inline code comments.',
    // ELECTION PENDING (E-P2.1): Tier 1 has not explicitly re-confirmed this identity. Do not treat as settled.
    openElection: 'E-P2.1',
  },
  {
    branch: 'E',
    description: 'Exploration branch, spectatorship-lineage leaning, not bound to any specific mechanic bundle.',
  },
] as const;

// The known structural tension (inherited from retired docs, not solved here): social-drama mechanics
// (negotiation, hidden info, betrayal) structurally conflict with the existing transparent, async,
// stranger-cohort shared-board design — negotiation requires either synchronicity or repeated-identity
// players, neither of which the current architecture provides. Any Branch B/C/E organism built on this
// idea-lineage must be evaluated by EDI against this specific tension as a first-class harness question,
// not assumed solved by relabeling. Not resolved here — this module records the tension, it doesn't fix it.
export const SOCIAL_DRAMA_ARCHITECTURE_TENSION =
  'Social-drama mechanics (negotiation, hidden info, betrayal) structurally conflict with the transparent, ' +
  'async, stranger-cohort shared-board design. Unresolved — flag at EDI harness evaluation time, not here.';
