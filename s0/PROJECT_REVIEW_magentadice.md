# magentadice-cyancode — complete project review & directions

Reviewed three repos: `magentadice-cyancode` (hub), `libriopal/FAR_NZY` (game, `core`), `libriopal/adabt-core` (AGROS/AMIS music, `dream`). Every claim cites a file I read.

## The system, in one picture

```
FAR_NZY (game)            AGROS / AMIS (music)             Governance
Match-3D + Farkle   ──►   Emotional Runtime Kernel   ◄──►  .ff-core-lock (game sacred core)
seeded CSPRNG             GameStateSnapshot → ERK          operational-law.md (music constitution)
scoreFarkle / chains      → EmotionalStateVector (5 axes)  @Viktor/@CodeRabbit agent audit
monteCarlo OPTIMAL/AVG    → leitmotif + harmonic gen       glassbox-labs / glassbox-forest
```

## The one idea running through everything: **deterministic emergence**

Independently, all three layers arrived at the *same* architecture:

- **FAR_NZY:** provably-fair `seededRng` (`csprng.ts`); every state reproducible from a seed.
- **AGROS constitution (`operational-law.md`):** *"Law of Deterministic Emergence — procedural orchestration MUST derive from synchronized seeds and bounded mutation. Uncontrolled generative divergence is a constitutional violation."* Its receptor is a *pure function* ("same input = same output").
- **AGROS multiplayer:** *"Hybrid Symbolic Replication — authoritative seeds and states are replicated; orchestral decoration is local."*

That last line is **exactly** the Research/Execution boundary in the `game-autobuild-kit` we just built, and exactly BFT SMR's "replicate the deterministic core, keep non-determinism out of consensus." Three systems, one principle. The GLASSBOX kit is a fourth instance of the same DNA.

## The game→music contract (a clean, small, reusable seam)

`adabt-core/apps/frontend/src/erk/types.ts` defines the entire coupling as two interfaces:

- **Input** `GameStateSnapshot`: `energy, mode, multiplierStep, banked, unbanked, chainLength, farkleCount, activeDisruptions, heistActive, rallyDecisionActive, winScore, gamePhase`.
- **Output** `EmotionalStateVector` (5 axes, all [0,1]): **tension, momentum, risk, chaos, resolution** — with `risk = unbanked/total` explicitly called "the bank-or-push signal."

The receptor turns game state into emotion with hand-tuned constants (`SMOOTHING_ALPHA=0.15`, `MAX_ENERGY=300`, thresholds). 8 canonical emotional states: Dread, Suspense, Escalation, Catastrophic Release, Mourning, Recovery, Silence, Ritualistic Build.

## What this opens up (directions — grounded, not speculative)

1. **There are TWO S₀ surfaces, not one.**
   - *Gameplay S₀:* game state → continue/bank/chain (from FAR_NZY `monteCarlo`, as already planned).
   - *Emotion/music S₀:* `GameStateSnapshot` → correct `EmotionalStateVector` / leitmotif. The receptor mapping is currently hand-tuned constants; it could be **learned/evolved** against human judgment ("this moment should feel like Dread"). The repo's own contract makes this a first-class, buildable target.

2. **The `EmotionalStateVector` is a ready-made, compact feature space for S₀.** 5 meaningful axes already derived from raw game state — far more tractable than the full grid, and shared by both game and music. S₀ rows can be keyed on it.

3. **The GLASSBOX kit slots in natively — twice.** Its DSL+verifier+MWUA evolutionary engine is exactly a "bounded mutation" engine. (a) Evolve FAR_NZY AI opponents/rule variants against gameplay S₀. (b) Evolve AGROS **leitmotif variations within envelope bounds** — the constitution *already mandates* "bounded mutation," and the kit's verifier could enforce constitutional compliance (no divergence) the same way it enforces game-safety.

4. **Factor out a shared determinism/replication library.** `prng.ts`, `scheduler.ts`, `merkle.ts`, `durable.ts` from the kit are the common substrate all three layers reinvent (seeded RNG, replicated seeds, checkpoint/replay). One library, three consumers.

5. **Unify three governance systems into one.** `.ff-core-lock` (game), `operational-law.md` (music), GLASSBOX Tier1/Tier2 (kit) are parallel constitutions with the same shape (sacred cores, propose→audit→ratify, human sovereign). The hub already contains `glassbox-labs/` and `glassbox-forest/` — this consolidation is already in motion.

## Risks / gaps (verified)

- **Security:** BrightData API token committed to git history (flagged in the hub's own README) — revoke + scrub before any public push. Never commit `.mcp.json`.
- **Determinism is asserted by constitution but not yet *proven*** — a natural place to apply the kit's verification discipline (the 62 runnable invariants). Same for the receptor's purity claim.
- **Browser-runtime fragility in AGROS** — WASM/AudioWorklet/SharedArrayBuffer/COOP-COEP + tiered fidelity; real deployment risk surface.
- **Cross-repo contract drift** — `@match3d/farkle-shared` types and the decoupled `GameStateSnapshot` must stay in sync across submodules.

## Bottom line

This isn't three separate projects — it's **one deterministic-emergence platform** (play → feel → sound) wrapped in agent-audited governance, and the GLASSBOX kit is the missing "evolve, verify, and replicate strategies safely" layer that all three were implicitly asking for. The highest-value near-term moves: build the gameplay S₀ (planned), then treat the music receptor as a second S₀ target, and factor the shared determinism core into a library all three import.
