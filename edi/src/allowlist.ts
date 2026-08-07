// edi/src/allowlist.ts — handoff_p2/06_EDI_GOVERNANCE_SPEC.md, reused verbatim.
// Two Hemispheres' Laboratory zone, extended for the genome track.
export const ALLOWLIST = {
  proposeOrganism:      { gate: 'none', mutatesState: false },   // -> dormant genome_foundry.genome_organisms row
  proposeThemeAllele:   { gate: 'none', mutatesState: false },
  draftPageCopy:        { gate: 'none', mutatesState: false },
  publishPage:          { gate: 'G2',   mutatesState: true },
  adjustPricing:        { gate: 'G1+G4', mutatesState: true },
  postAnnouncement:     { gate: 'G2',   mutatesState: true },
  promoteOrganism:      { gate: 'HUMAN_ONLY', mutatesState: true }, // no programmatic path exists for this gate — ever
} as const;
// Absent from this list, deliberately: anything that mutates rm_finance.*, genome_foundry.genome_organisms'
// immutable fields, or account self-exclusion/age-verification state. Adding a capability here requires
// a new Tier 1 decision record, not a code change alone (mirrors the gate-file pattern: this list is the
// governance surface, and growing it silently is the "standard failure mode of capability systems" the
// design research already named).
