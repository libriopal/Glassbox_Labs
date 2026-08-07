// genome/engine/src/solvable.ts — every board must have >=1 legal match-producing swap.
import { findMatches, makeBoard, type BoardState, type OrganismParams } from './board';

export function hasLegalMove(board: BoardState, minMatch: number): boolean {
  const { tiles, cols, rows } = board;
  for (let i = 0; i < tiles.length; i++) {
    const neighbors = [i + 1, i + cols].filter(j => j < tiles.length && !(i % cols === cols - 1 && j === i + 1));
    for (const j of neighbors) {
      const copy = tiles.map(t => ({ ...t }));
      const tmp = copy[i]!.k; copy[i]!.k = copy[j]!.k; copy[j]!.k = tmp;
      if (findMatches({ ...board, tiles: copy }, minMatch).length > 0) return true;
    }
  }
  return false;
}
export function ensureSolvable(board: BoardState, params: OrganismParams, seed: number): BoardState {
  let b = board, attempt = 0;
  while (!hasLegalMove(b, params.minMatch) && attempt < 50) {
    b = makeBoard(params, seed + attempt + 1);
    attempt++;
  }
  return b;
}
