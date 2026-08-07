// workers/edi-curation/src/curation.ts — handoff_p2/05_WORKERS_SPEC.md
// §"workers/edi-curation"
//
// EDI curates, it does not autonomously cull — promotion stays HUMAN ONLY
// (Two Hemispheres allowlist, @glassbox/edi's ALLOWLIST.promoteOrganism:
// { gate: 'HUMAN_ONLY' }). This module never calls anything resembling
// promoteOrganism — see edi/verify-promote-human-only.ts, which greps the
// whole repo including this package for exactly that.
//
// D1 population constraint: don't let the archive drift entirely toward one
// of (naturally-derived recreation) vs (synthetically-derived stress/creation)
// — flag drift beyond 70/30 as a curation WARNING, not a hard block.
//
// D8 fix #4: this is plain ratio arithmetic over a count, named for what it
// is (computeClassRatioDrift) — it must never be dressed up as a formal
// temporal-logic verification result (Eventually(...), Always(...)), and it
// isn't one.

import type { GenomeOrganismRow, OrganismClass } from '@glassbox/store/p2-foundry-rm';

export interface ClassRatioDrift {
  baselineRecreationCount: number;
  stressTestCount: number;
  baselineRecreationShare: number; // 0..1, NaN if the shortlist is empty
  driftWarning: boolean; // true if either class exceeds the 70% threshold
}

const DRIFT_THRESHOLD = 0.7;

export function computeClassRatioDrift(classes: OrganismClass[]): ClassRatioDrift {
  const baselineRecreationCount = classes.filter((c) => c === 'baseline_recreation').length;
  const stressTestCount = classes.filter((c) => c === 'stress_test').length;
  const total = baselineRecreationCount + stressTestCount;
  const baselineRecreationShare = total === 0 ? NaN : baselineRecreationCount / total;
  const driftWarning = total > 0 && (baselineRecreationShare > DRIFT_THRESHOLD || baselineRecreationShare < 1 - DRIFT_THRESHOLD);
  return { baselineRecreationCount, stressTestCount, baselineRecreationShare, driftWarning };
}

export interface ShortlistEntry {
  organismId: string;
  class: OrganismClass;
  karyotypeLabel: string;
  skillDelta: number;
  solverMargin: number;
  degenerateStrategyFlag: boolean;
}

export interface CurationResult {
  shortlist: ShortlistEntry[];
  excludedUnscored: string[]; // organism ids that were candidates but have no harness_results row
  ratioDrift: ClassRatioDrift;
}

export interface HarnessLookup {
  getGenomeOrganism(id: string): Promise<GenomeOrganismRow | null>;
  hasHarnessResult(id: string): Promise<boolean>;
  getLatestHarnessResult(id: string): Promise<{ skillDelta: number; solverMargin: number; degenerateStrategyFlag: boolean } | null>;
}

/**
 * workers/edi-curation must never curate an unscored organism (verify-edi-no-
 * unscored-promotion) — enforced structurally here: an organism with no
 * harness_results row is excluded from `shortlist` and placed in
 * `excludedUnscored` instead, unconditionally, before any other filtering.
 */
export async function curate(store: HarnessLookup, candidateOrganismIds: string[]): Promise<CurationResult> {
  const shortlist: ShortlistEntry[] = [];
  const excludedUnscored: string[] = [];

  for (const id of candidateOrganismIds) {
    const scored = await store.hasHarnessResult(id);
    if (!scored) {
      excludedUnscored.push(id);
      continue;
    }
    const organism = await store.getGenomeOrganism(id);
    const harness = await store.getLatestHarnessResult(id);
    if (!organism || !harness) {
      // hasHarnessResult said yes but the row vanished/organism missing — exclude, don't guess.
      excludedUnscored.push(id);
      continue;
    }
    shortlist.push({
      organismId: id,
      class: organism.class,
      karyotypeLabel: organism.karyotypeLabel,
      skillDelta: harness.skillDelta,
      solverMargin: harness.solverMargin,
      degenerateStrategyFlag: harness.degenerateStrategyFlag,
    });
  }

  const ratioDrift = computeClassRatioDrift(shortlist.map((s) => s.class));
  return { shortlist, excludedUnscored, ratioDrift };
}
