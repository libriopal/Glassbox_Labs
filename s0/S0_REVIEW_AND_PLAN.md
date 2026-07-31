# S₀ Review & Plan — grounded in the FAR_NZY engine

**Repos reviewed:** `libriopal/magentadice-cyancode` (integration hub) and `libriopal/FAR_NZY` (game engine, `core` submodule).
**Purpose:** turn the placeholder `|S₀|` in `game-autobuild-kit/01_RESEARCH/seed-corpus.placeholder.json` into a real, comprehensive corpus.
**Every claim below cites a file I actually read.**

---

## 1. What the game actually is

FAR_NZY ("Farkle Frenzy") is **not classic Farkle**. It's a **Match-3D voxel puzzle scored with Farkle dice combos**: you chain dice on a grid, and each chain is scored by `scoreFarkle(faces)` (`packages/farkle-engine/src/farkleScorer.ts`). The board also holds special entities — sphere, ice, lock, wild, bomb, rainbow_bomb, mirror, stone, multiplier_orb, ghost, catalyst (`packages/farkle-shared/src/types.ts`, `EntityType`).

**Implication for us:** the kit's current DSL and placeholder S₀ are **Rack-O-shaped** (`isSmaller`, `hasRacko`, `draw`/`show`) and do **not** match this game. The real decisions are different (below), so S₀ must be FAR_NZY-native and the kit's policy DSL must be re-targeted to FAR_NZY decisions.

## 2. The decisions that make up S₀ (verified in code)

| Decision | Where it lives | Shape |
|----------|----------------|-------|
| **Continue vs. Bank** (push-your-luck) | `monteCarlo.ts` → `playerContinue(model, unbanked, multiplierStep, rng)` | the core Farkle decision |
| **Chain selection** (which dice to commit) | scored via `scoreFarkle(faces)` / `chainIndex.lookupScore` | Match-3 chain choice |
| **Use multiplier orb / doubler** | `monteCarlo.ts` (`decisionRng() < useProb` branches) | yes / no |
| **Rally vote** (team modes) | `simulateRallyVote(role, model, …)` | continue / bank / pass |

## 3. Why this engine is almost an S₀ generator already

- **Skill oracle already exists:** `PlayerModel = 'OPTIMAL' | 'AVERAGE' | 'WEAK'` (`monteCarlo.ts`). `OPTIMAL` = the "correct move" answer key; `AVERAGE`/`WEAK` = human-like play for realism and for setting the C(σ) bar.
- **Answer-key labeler exists:** `scoreFarkle` returns `{score, scaledScore, isFarkle, combo, triggersBomb}` — enumerate legal chains, score each, and the optimal choice is well-defined.
- **Fully deterministic:** `csprng.ts` `seededRng(seed)` drives every state and decision (`decisionRng = seededRng(sessionSeed ^ 0x778899)`). Every S₀ row is reproducible from its seed — this matches the kit's determinism/replay model exactly.
- **State generation exists:** `runMonteCarlo()` / the V2 sim already run thousands of sessions across modes, blocker densities, player counts, roles.

## 4. The one real gap (small, and precisely located)

The simulator **makes** every decision internally but **keeps only aggregates** — `MonteCarloResult` / `MonteCarloResultV2` return `averageScore`, `farkleRate`, RTP breakdowns, and `voteOutcomeDistribution: {continue, bank, pass}` (counts). It does **not** emit per-decision `(state → chosen decision)` rows, which *are* the S₀ rows.

So building S₀ is **an extraction pass, not a rewrite**: capture each decision as it's made, with its state features and the chosen option, tagged by `playerModel` and `seed`.

**Governance constraint:** `monteCarlo.ts` is **Sacred Core** (listed in `.ff-core-lock`; header says "DO NOT MODIFY without … explicit developer approval"). So the capture must not silently alter game math. Two clean options:

- **Option A — standalone generator (no Sacred edits).** New non-sacred module (here in Glassbox_Labs) that imports FAR_NZY's exported `scoreFarkle` + `seededRng` and re-implements the *documented* `playerContinue` EV policy to emit labeled rows. Fast, but duplicates policy logic (drift risk vs. the sacred file).
- **Option B — tiny capture hook (needs approval).** Propose a **non-behavioral** `captureSink?` parameter on the sim that emits a row at each `playerContinue` / orb / doubler / vote call. Zero change to scoring math; guarantees S₀ matches the real engine exactly. Requires developer approval per `.ff-core-lock` (PROPOSE-only). **Recommended for fidelity**, with A as an interim.

## 5. Sources that combine into a comprehensive S₀

1. **Monte-Carlo (`OPTIMAL`)** → breadth of states + correct-decision labels.
2. **Monte-Carlo (`AVERAGE`/`WEAK`)** → realistic human-like decisions; lets you grade "plays like a typical human" vs. "plays optimally."
3. **Event-sourced replay** (`magentadice-cyancode/contracts/ReplayEvent.v1`) → once real games are logged, every event is a genuine human `(state → move)` pair. The contract is **frozen and built**; it just needs real logged play to populate it.
4. **RTP Monte-Carlo plan** (`magentadice-cyancode/docs/P3_RTP_MONTE_CARLO_PLAN.md`) → the simulation design to run at scale.

## 6. What's missing / incomplete / not yet written

- **No S₀ / decision dataset exists** anywhere in either repo (searched: only *plans* and one ADR, no labeled data).
- **Per-decision capture is not implemented** (§4) — the precise, small piece to add.
- **Kit DSL mismatch** — the Rack-O DSL must be re-targeted to FAR_NZY decisions (continue/bank, chain-select, orb/doubler, vote).
- **Submodules aren't wired for cross-repo use** — FAR_NZY is a submodule of the hub; a generator that imports its engine needs the dependency path decided.
- **Security debt (from their own READMEs):** a BrightData token was committed to git history (revoke + scrub before any public push); `.mcp.json` must never be committed.

## 7. Proposed schema

See `s0/s0.schema.json`. Each row is one decision: `{seed, turnIndex, decisionType, state, options, decision, labelSource, verifiedBy}`. Grading (`C(σ)`) = fraction of rows where an evolved policy's decision matches `decision`; threshold per D4 (currently 0.98).

## 8. Recommended next actions

1. **Decide labeling target:** should the AI learn to play **OPTIMAL** (best EV) or **AVERAGE** (like a typical human)? This sets what `labelSource` we generate and what `C(σ)` means.
2. **Choose Option A or B** for capture (recommend B — the faithful hook — as a proposal to the FAR_NZY developer, A as interim).
3. I then write the **generator** + emit a first real `S₀` (a few thousand labeled decisions across modes/densities/seeds) into this branch, replacing the placeholder.
4. **Re-target the kit DSL** to FAR_NZY decisions so the evolutionary engine can express and evolve real strategies.

---

## 9. RECONCILIATION with the authoritative handoff (GLASSBOX_DNA_IMPLEMENTATION.md, DNA-FINAL 2026-07-27)

The owner's master handoff supersedes prior assumptions. Corrections and the resolved labeling answer:

### 9.1 The labeling question is answered — and it is NOT "optimal vs average"
The design's fitness function (handoff §8 D5) is:
`fitness = spatial_entropy·0.10 + human_drl_alignment·0.10 + win_rate·0.15 + engagement·0.25 + fun_score·0.25 + exploit_free·0.15`.
Engagement + fun = **50%**; win-rate is only **15%**; and a DRL win-rate **>95% → exploit → quarantine** (§12). The HD-HTRP reward is `R = 0.40·spatial_entropy + 0.35·telemetry_alignment + 0.25·survey_satisfaction`, with **KL-to-human-comfort 0.1–0.3** as the target (§11, §12).

**Therefore "correct" = a fun, human-aligned, non-exploitable decision — a tuned band *near* human play (KL 0.1–0.3), not the EV-optimal move and not the average move.** OPTIMAL/AVERAGE/WEAK from `monteCarlo` are used to *bound the space and detect exploits* (the >95% ceiling), not as ground truth.

### 9.2 What this makes S₀
- **Primary anchor = human telemetry**, not a solver. The real answer key is human decisions captured by the W10 pipeline (`turnLatencyMs`, `selectionFrictionCount`, `spatialGazeDwellTimeMs`) plus survey satisfaction. `labelSource: HUMAN_TELEMETRY`.
- **monteCarlo models** provide state coverage + the exploit ceiling, not the "right move."
- **Grading (`C(σ)`) is re-defined:** not "match optimal," but **fitness ≥ threshold AND KL-to-human within 0.1–0.3 AND exploit_free**. The schema now carries `fitness` and `humanTelemetry` fields.

### 9.3 Repo-truth corrections
- **`magentadice-cyancode` = the CODEBASE repo** (where the game is built, W0→D5.5, by *extending* existing systems); **`Glassbox_Labs` = the GOVERNANCE repo** (aegis/decisions — where this `game-autobuild-kit` and these S₀ docs live). The game build does **not** happen here.
- Submodules pinned: `core → FAR_NZY@45c1d91`, `dream → adabt-core@b0be2a5`, `devos → libriopal-devos@6bf037b (private)`.
- **"Extend, never re-implement" (handoff §1.4, M5–M12 firewall)** is the prime rule. The kit in this repo is a **governance/method + determinism-proof harness**, not the game — its Rack-O DSL is a demonstrator; the real strategy layer is the **organism/DNA system** (Command A+ → DNA JSON, D3/D4) evaluated by D5 fitness.
- Verify-before-W0 flags carried: (1) `dream` = AGROS vs adabt-core/AMIS naming conflict; (2) OWC "theory vs ACTIVE"; (3) `governance-check.ts` is to-build, not existing.

### 9.4 Where the kit genuinely serves the product
Determinism is mandated and gate-tested by the handoff (C6 CSPRNG, no `Math.random()` in seed paths, `same seed = same board everywhere`, Q×1000 fixed-point — §7.4, §14). The kit's **62 runnable determinism/verification invariants are directly the discipline W1 and the R1 acceptance criteria require** — that is the honest, non-duplicative contribution of this repo to the product.

---

*This document is a review artifact; it modifies no Sacred Core file. Reconciled with GLASSBOX_DNA_IMPLEMENTATION.md (DNA-FINAL).*
