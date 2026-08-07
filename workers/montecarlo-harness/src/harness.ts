// workers/montecarlo-harness/src/harness.ts — handoff_p2/05_WORKERS_SPEC.md
//
// Runs the 4 agent tiers across the committed seed battery and computes the
// Spec 35 §5.2 pass conditions (skill delta >=12, solver margin >=15, max
// chain-type share <=40% of top-decile banked value, MCTS precog lift <=2x
// HUMAN-CAL precog lift). See agents.ts's header for the honest scope limits
// (single-swap-per-round proxy, no precognition mechanic exists to measure —
// precogLift fields are an explicit NaN placeholder, not a fabricated number).

import { makeBoard, ensureSolvable, type OrganismParams } from '@glassbox/genome-engine';
import type { RecordHarnessResultInput } from '@glassbox/store/p2-foundry-rm';
import { AGENTS, type AgentTier } from './agents';
import { seedBattery } from './seed-battery';

const BATTERY_SIZE = 40;
const TOP_DECILE_FRACTION = 0.1;

export interface HarnessReport {
  organismId: string;
  jobId: string | null;
  skillDelta: number;
  solverMargin: number;
  maxChainTypeShare: number;
  precogLiftMcts: number;
  precogLiftHumanCal: number;
  degenerateStrategyFlag: boolean;
  raw: {
    perTier: Record<AgentTier, { scores: number[]; mean: number }>;
    note: string;
  };
}

function mean(xs: number[]): number {
  const finite = xs.filter((x) => Number.isFinite(x));
  if (finite.length === 0) return NaN;
  return finite.reduce((a, b) => a + b, 0) / finite.length;
}

export function runHarness(organismId: string, jobId: string | null, params: OrganismParams): HarnessReport {
  const seeds = seedBattery(BATTERY_SIZE);
  const perTier = {} as Record<AgentTier, { scores: number[]; mean: number }>;
  const kindShareByTier: Record<AgentTier, number[]> = { RANDOM: [], GREEDY: [], 'MCTS-MAX': [], 'HUMAN-CAL': [] };

  for (const tier of Object.keys(AGENTS) as AgentTier[]) {
    const agent = AGENTS[tier];
    const scores: number[] = [];
    for (const seed of seeds) {
      if (tier === 'HUMAN-CAL') { scores.push(NaN); continue; } // explicit stub — see agents.ts
      const board = ensureSolvable(makeBoard(params, seed), params, seed);
      const result = agent.play(board, params, seed);
      scores.push(result.matchedCount);
      if (result.kindsMatched.length > 0) {
        const counts = new Map<number, number>();
        for (const k of result.kindsMatched) counts.set(k, (counts.get(k) ?? 0) + 1);
        const maxShare = Math.max(...counts.values()) / result.kindsMatched.length;
        kindShareByTier[tier].push(maxShare);
      }
    }
    perTier[tier] = { scores, mean: mean(scores) };
  }

  const skillDelta = perTier['MCTS-MAX'].mean - perTier.RANDOM.mean;
  const solverMargin = perTier['MCTS-MAX'].mean - perTier.GREEDY.mean;

  // Top-decile-by-score rounds across the "skilled" tier, worst (highest) single-kind share among them.
  const mctsScored = perTier['MCTS-MAX'].scores
    .map((s, i) => ({ score: s, share: kindShareByTier['MCTS-MAX'][i] ?? 0 }))
    .filter((x) => Number.isFinite(x.score))
    .sort((a, b) => b.score - a.score);
  const topDecileCount = Math.max(1, Math.ceil(mctsScored.length * TOP_DECILE_FRACTION));
  const maxChainTypeShare = mctsScored.slice(0, topDecileCount).reduce((max, x) => Math.max(max, x.share), 0);

  return {
    organismId,
    jobId,
    skillDelta,
    solverMargin,
    maxChainTypeShare,
    // No precognition mechanic exists anywhere in 03_GENOME_ENGINE_SPEC.md or
    // any other handoff_p2 file — NaN, not a fabricated ratio. See module header.
    precogLiftMcts: NaN,
    precogLiftHumanCal: NaN,
    degenerateStrategyFlag: maxChainTypeShare > 0.4,
    raw: {
      perTier,
      note:
        'HUMAN-CAL and precognition-lift are explicit placeholders (NaN) — no playtest telemetry and no ' +
        'precognition mechanic exist in handoff_p2. skillDelta/solverMargin/maxChainTypeShare are computed ' +
        'from real genome-engine board/match primitives over a single-swap-per-round proxy (see agents.ts).',
    },
  };
}

export function toRecordHarnessResultInput(report: HarnessReport): RecordHarnessResultInput {
  return {
    organismId: report.organismId,
    jobId: report.jobId,
    skillDelta: report.skillDelta,
    solverMargin: report.solverMargin,
    maxChainTypeShare: report.maxChainTypeShare,
    precogLiftMcts: report.precogLiftMcts,
    precogLiftHumanCal: report.precogLiftHumanCal,
    degenerateStrategyFlag: report.degenerateStrategyFlag,
    raw: report.raw,
  };
}
