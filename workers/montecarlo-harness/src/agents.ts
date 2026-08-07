// workers/montecarlo-harness/src/agents.ts — handoff_p2/05_WORKERS_SPEC.md §"workers/montecarlo-harness"
//
// SCOPE, flagged not silently overstated: 03_GENOME_ENGINE_SPEC.md exports
// board generation (makeBoard), match-finding (findMatches), and
// solvability-checking (hasLegalMove/ensureSolvable) — it does NOT export a
// swap-apply/cascade/refill game loop, and no handoff_p2 file defines one.
// Building a full cascading-match game loop from scratch here would be
// inventing game mechanics (refill algorithm, chain multipliers, etc.) that
// CLAUDE_CODE_PROMPT.md's "DO NOT invent requirements beyond what handoff_p2/
// specifies" forbids. So each agent here plays ONE swap per round on a
// freshly generated board (from the committed seed battery) and its score
// for that round is the match count findMatches actually returns for its
// chosen swap — a real, engine-driven signal, but a single-swap proxy for
// skill, not a validated multi-turn gameplay simulation. Good enough to
// prove the worker infrastructure (job claiming, harness_results writes,
// pass/fail computation) end to end; NOT sufficient to certify game balance.
// 08_VERIFY_CHECKLIST.md itself marks verify-skill-delta / verify-no-degenerate-
// strategy / verify-precog-lift-ratio [QUEUED], blocked on running against
// real organisms — consistent with this being infrastructure, not a
// balance-certified simulation.

import { findMatches, seededRng, type BoardState, type OrganismParams, type Tile } from '@glassbox/genome-engine';

export interface CandidateSwap { i: number; j: number; resultingBoard: BoardState; matchedCount: number; }

/** All adjacent (right/down) swaps on the board, whether or not they produce a match. */
export function enumerateSwaps(board: BoardState, minMatch: number): CandidateSwap[] {
  const { tiles, cols, rows } = board;
  const swaps: CandidateSwap[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const neighbors = [i + 1, i + cols].filter((j) => j < tiles.length && !(i % cols === cols - 1 && j === i + 1));
    for (const j of neighbors) {
      const copy: Tile[] = tiles.map((t) => ({ ...t }));
      const tmp = copy[i]!.k; copy[i]!.k = copy[j]!.k; copy[j]!.k = tmp;
      const resultingBoard = { ...board, tiles: copy };
      const matchedCount = findMatches(resultingBoard, minMatch).length;
      swaps.push({ i, j, resultingBoard, matchedCount });
    }
  }
  void rows;
  return swaps;
}

export interface AgentResult { matchedCount: number; chosenSwap: CandidateSwap | null; kindsMatched: number[] }

function kindsInMatch(board: BoardState, swap: CandidateSwap, minMatch: number): number[] {
  const idxs = findMatches(swap.resultingBoard, minMatch);
  return idxs.map((idx) => swap.resultingBoard.tiles[idx]!.k);
}

export type AgentTier = 'RANDOM' | 'GREEDY' | 'MCTS-MAX' | 'HUMAN-CAL';

export interface Agent { tier: AgentTier; play(board: BoardState, params: OrganismParams, rngSeed: number): AgentResult; }

export const RandomAgent: Agent = {
  tier: 'RANDOM',
  play(board, params, rngSeed) {
    const swaps = enumerateSwaps(board, params.minMatch);
    if (swaps.length === 0) return { matchedCount: 0, chosenSwap: null, kindsMatched: [] };
    const rng = seededRng(rngSeed, 0, 1);
    const chosen = swaps[Math.floor(rng() * swaps.length)]!;
    return { matchedCount: chosen.matchedCount, chosenSwap: chosen, kindsMatched: kindsInMatch(board, chosen, params.minMatch) };
  },
};

export const GreedyAgent: Agent = {
  tier: 'GREEDY',
  play(board, params, rngSeed) {
    const swaps = enumerateSwaps(board, params.minMatch);
    if (swaps.length === 0) return { matchedCount: 0, chosenSwap: null, kindsMatched: [] };
    const best = swaps.reduce((a, b) => (b.matchedCount > a.matchedCount ? b : a));
    if (best.matchedCount === 0) return RandomAgent.play(board, params, rngSeed);
    return { matchedCount: best.matchedCount, chosenSwap: best, kindsMatched: kindsInMatch(board, best, params.minMatch) };
  },
};

const MCTS_ROLLOUTS_PER_CANDIDATE = 6;

/**
 * "MCTS-MAX" per the spec's tier name — implemented here as Monte Carlo
 * sampling over candidate swaps (average outcome across rollouts on freshly
 * seeded boards), not a full UCT tree search: there is no multi-ply game
 * state to tree-search over (see the module-header SCOPE note). This is
 * still a genuine Monte Carlo agent, just over a shallower decision space
 * than the tier name might suggest for a full game.
 */
export const MctsMaxAgent: Agent = {
  tier: 'MCTS-MAX',
  play(board, params, rngSeed) {
    const swaps = enumerateSwaps(board, params.minMatch);
    if (swaps.length === 0) return { matchedCount: 0, chosenSwap: null, kindsMatched: [] };
    const candidates = swaps.filter((s) => s.matchedCount > 0);
    const pool = candidates.length > 0 ? candidates : swaps;
    let best = pool[0]!;
    let bestAvg = -Infinity;
    for (const swap of pool) {
      let total = 0;
      for (let r = 0; r < MCTS_ROLLOUTS_PER_CANDIDATE; r++) {
        const rollout = enumerateSwaps(swap.resultingBoard, params.minMatch);
        const rolloutBest = rollout.length > 0 ? Math.max(...rollout.map((s) => s.matchedCount)) : 0;
        total += swap.matchedCount + rolloutBest;
      }
      const avg = total / MCTS_ROLLOUTS_PER_CANDIDATE;
      if (avg > bestAvg) { bestAvg = avg; best = swap; }
    }
    return { matchedCount: best.matchedCount, chosenSwap: best, kindsMatched: kindsInMatch(board, best, params.minMatch) };
  },
};

/**
 * Explicit stub — per 05_WORKERS_SPEC.md's own text: "HUMAN-CAL [stub until
 * playtest telemetry exists]". Returns a neutral, clearly-flagged placeholder
 * rather than a simulated human result — H10 (17_PHASE2_HANDOFF_COMPLETE.md
 * §0.3) forbids substituting/simulating/model-generating human rater output
 * for any reason, however clearly labelled, so this must stay a stub, not an
 * approximation.
 */
export const HumanCalAgent: Agent = {
  tier: 'HUMAN-CAL',
  play() {
    return { matchedCount: NaN, chosenSwap: null, kindsMatched: [] };
  },
};

export const AGENTS: Record<AgentTier, Agent> = {
  RANDOM: RandomAgent,
  GREEDY: GreedyAgent,
  'MCTS-MAX': MctsMaxAgent,
  'HUMAN-CAL': HumanCalAgent,
};
