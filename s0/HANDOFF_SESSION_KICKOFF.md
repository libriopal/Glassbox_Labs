# FRESH SESSION KICKOFF — point a new Claude Code session here

**Authoritative spec:** `design_handoff_far_nzy_r1/GLASSBOX_DNA_IMPLEMENTATION.md` (DNA-FINAL, 2026-07-27). That file wins over everything. This kickoff only tells a fresh session where things stand and what was already decided — it does not override the handoff.

## Contract (from handoff §1 — obey before anything)
1. Emit complete files — never `...`, `TODO`, `unchanged`, `omitted`, `truncated`.
2. Vendor, don't paraphrase; read the real repo, don't build from memory.
3. **Extend, never re-implement** (M5–M12 firewall). N files listed ⇒ N produced.
4. One work item → deploy → `claude_code_state='awaiting_test'` → STOP → resume next run.

## Repos & refs
- **Codebase (build here):** `github.com/libriopal/magentadice-cyancode` @ main — pnpm monorepo; Vercel + Capacitor + Supabase.
- **Governance (this repo):** `github.com/libriopal/Glassbox_Labs` @ main; work branch **`So_far_nzy`**; **PR #1** open (kit build → main).
- Submodules: `core → FAR_NZY@45c1d91`, `dream → adabt-core@b0be2a5`, `devos → libriopal-devos@6bf037b (private)`. Add as git submodules; never copy loose.

## Already decided (do not re-litigate)
- **"Correct" is NOT optimal or average.** Per D5 fitness (engagement 0.25 + fun 0.25 dominate; win 0.15; win>95% ⇒ exploit ⇒ quarantine) and HD-HTRP KL-to-human 0.1–0.3, correct = fun + human-aligned + non-exploitable, in a band near human play.
- **S₀ is two-part:** monteCarlo (OPTIMAL/AVG/WEAK) gives state coverage + exploit ceiling; **ground-truth labels come from W10 human telemetry** (`turnLatencyMs`, `selectionFrictionCount`, `spatialGazeDwellTimeMs`, survey). Schema: `s0/s0.schema.json`. Plan + reconciliation: `s0/S0_REVIEW_AND_PLAN.md` §9.
- **Capture = Option B** — a non-behavioral hook in `monteCarlo.ts`, delivered as a PROPOSAL per `core/.ff-core-lock` (Sacred Core), not a silent edit.
- **Sequencing approved:** (1) gameplay S₀ → (2) emotion/music S₀ (AGROS `GameStateSnapshot`→`EmotionalStateVector`) → (3) prove determinism.

## Verify BEFORE W0 (handoff §4 flags these — real blockers)
1. Does `dream` point at **AGROS** or **adabt-core/AMIS**? (`git submodule status`)
2. Is **OWC** wired (`packages/owc`) or still theory? Build-from-design until confirmed.
3. `scripts/governance-check.ts` is to-build, not existing.

## What already exists in Glassbox_Labs `So_far_nzy` (reuse, don't rebuild)
- `game-autobuild-kit/` — a **determinism-proof harness** (62 runnable invariants: compilation, safety, determinism, evolution, consensus, durable, boundary). This is the discipline W1 + R1 acceptance require; it is NOT the game.
- `governance/` — GLASSBOX v3.0.0 package + Scite evidence (`SourceMatrix.md`, 16 admissible DOI-backed sources).
- `s0/` — S₀ schema, plan, and the full magentadice-cyancode review.

## First action in the new session (handoff §13)
Read `claude_code_state` from Supabase → if `awaiting_test`, wait for human `passed` → else do the current/next §8 work item (W0 band tagging → W0.5 board-state authority CRITICAL → …) in `magentadice-cyancode`, extending existing systems. Never start work before reading state.

## Cost note
Keep MCP connectors trimmed to **GitHub + Claude Code Remote (+ Scite, Design when needed)**; disconnect the rest in connector settings. Read this file + the handoff first; don't re-derive.
