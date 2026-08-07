// genome/engine/src/board.ts — Spec 34 §5.2, reused verbatim.

export interface OrganismParams {
  cols: number; rows: number; kinds: number; minMatch: number;
  layerParam?: number; revealParam?: number; tracks?: string[]; stressFlag?: string;
}
export interface Tile { id: number; k: number; }
export interface BoardState { tiles: Tile[]; cols: number; rows: number; tick: number; }

// Counter-based PRNG per Spec 34 §5.2 B3 — deterministic given (seed, tick, stream).
export function seededRng(seed: number, tick: number, stream: number): () => number {
  let s = (seed ^ (tick * 2654435761) ^ (stream * 40503)) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function makeBoard(params: OrganismParams, seed: number): BoardState {
  const rng = seededRng(seed, 0, 0);
  const total = params.cols * params.rows;
  const tiles = Array.from({ length: total }, (_, i) => ({ id: i, k: Math.floor(rng() * params.kinds) }));
  return { tiles, cols: params.cols, rows: params.rows, tick: 0 };
}

export function findMatches(board: BoardState, minMatch: number): number[] {
  const { tiles, cols, rows } = board;
  const hit = new Set<number>();
  for (let r = 0; r < rows; r++) for (let c = 0; c <= cols - minMatch; c++) {
    const base = r * cols + c;
    const k = tiles[base]!.k;
    let run = 1;
    while (c + run < cols && tiles[base + run]!.k === k) run++;
    if (run >= minMatch) for (let i = 0; i < run; i++) hit.add(base + i);
  }
  for (let c = 0; c < cols; c++) for (let r = 0; r <= rows - minMatch; r++) {
    const base = r * cols + c;
    const k = tiles[base]!.k;
    let run = 1;
    while (r + run < rows && tiles[base + run * cols]!.k === k) run++;
    if (run >= minMatch) for (let i = 0; i < run; i++) hit.add(base + i * cols);
  }
  return [...hit];
}

// Bug-class regression guard (D9 / the k-vs-glyph desync found in the mock prototype):
// this engine has NO separate "display" field — `k` IS the only identity a tile has.
// Any render layer deriving glyph/color from `k` must do so at render time, never store
// a second copy that can drift. This constraint is the fix, encoded structurally.
