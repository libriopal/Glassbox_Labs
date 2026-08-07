-- core/store/migrations/0002_p2_genome_foundry_rm_finance.postgres.admin.sql
-- handoff_p2/02_SCHEMA_MIGRATIONS.sql, adapted to land in the ADMIN database
-- (same physical Postgres connection as `accounts`) rather than a standalone
-- database with a "public" schema of its own, per the P1 admin/user split
-- (see 0001_init.postgres.admin.sql). This means rm_finance.heat_entries can
-- take a REAL foreign key to accounts(id) instead of the soft-reference
-- pattern the P1 split needed for its admin<->user boundary — accounts.id is
-- TEXT (see 0001_init.postgres.admin.sql), not UUID, so account_id columns
-- below are TEXT to match, not UUID as the handoff's literal snippet had it.
--
-- KNOWN GAP, flagged not silently resolved: genome_foundry.genome_organisms
-- (this file) and the existing `organisms` table (0001_init.postgres.admin.sql)
-- are different, unreconciled schemas for overlapping-but-distinct purposes.
-- No governance decision was found tying them together — see the P2+ status
-- report. Proceeding with genome_foundry.genome_organisms exactly as
-- handoff_p2/02_SCHEMA_MIGRATIONS.sql specifies.
--
-- SQLite parity is intentionally NOT provided for this migration (unlike the
-- P1 Store, which requires adapter parity for every table). The guarantees
-- this schema exists to prove — FOR UPDATE SKIP LOCKED concurrent job
-- claiming, row-level settlement locking, trigger-enforced immutability/
-- append-only — have no meaningful SQLite equivalent for real concurrent
-- access, and handoff_p2 only ever specifies running this "against a dev
-- database" (Postgres). Run in order. Idempotent guards included.

CREATE SCHEMA IF NOT EXISTS genome_foundry;
CREATE SCHEMA IF NOT EXISTS rm_finance;

-- ============ genome_foundry (disposable — DROP SCHEMA CASCADE is an acceptable DR step) ============

CREATE TABLE IF NOT EXISTS genome_foundry.genome_organisms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_ids      UUID[] NOT NULL DEFAULT '{}',
  generation      INTEGER NOT NULL DEFAULT 0,
  karyotype_label TEXT NOT NULL,           -- organizational only, per Spec 38 REV B (not a breeding gate)
  class           TEXT NOT NULL CHECK (class IN ('baseline_recreation','stress_test')),
  mechanics_genes JSONB NOT NULL,
  economy_genes   JSONB NOT NULL,
  visual_genes    JSONB NOT NULL DEFAULT '[]',
  seed_lineage_recent SMALLINT[] NOT NULL DEFAULT '{}',   -- last N ancestors only; full history in blob storage
  seed_lineage_blob_ref TEXT,                              -- external object-storage key, NULL if lineage is short
  notes           TEXT NOT NULL,            -- non-empty per the review invariant carried from experiments.ts
  immutable       BOOLEAN NOT NULL DEFAULT TRUE,
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_genome_organisms_karyotype ON genome_foundry.genome_organisms (karyotype_label);
CREATE INDEX IF NOT EXISTS idx_genome_organisms_class ON genome_foundry.genome_organisms (class);
-- GIN index for querying mechanics_genes params (e.g. "find all organisms with kinds=6")
CREATE INDEX IF NOT EXISTS idx_genome_organisms_genes_gin ON genome_foundry.genome_organisms USING GIN (mechanics_genes);

-- Enforce immutability at the DB level, not just application convention:
CREATE OR REPLACE FUNCTION genome_foundry.reject_organism_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.immutable THEN
    RAISE EXCEPTION 'genome_organisms row % is immutable; fork (insert a new row with parent_ids) instead of editing', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_genome_organisms_immutable ON genome_foundry.genome_organisms;
CREATE TRIGGER trg_genome_organisms_immutable
  BEFORE UPDATE OR DELETE ON genome_foundry.genome_organisms
  FOR EACH ROW EXECUTE FUNCTION genome_foundry.reject_organism_mutation();

-- Job queue for workers/* (shared idempotency pattern with rm_finance.settlements)
CREATE TABLE IF NOT EXISTS genome_foundry.jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL CHECK (kind IN ('montecarlo_harness','genome_breed','edi_curation')),
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  idempotency_key UUID NOT NULL UNIQUE,
  result          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_status_kind ON genome_foundry.jobs (status, kind);

-- harness_results: queryable by workers/edi-curation to prove an organism has
-- been scored before it may appear in any shortlist (verify-edi-no-unscored-promotion).
-- Sibling table (Claude Code's choice per 05_WORKERS_SPEC.md), not a JSONB column,
-- so workers/edi-curation can query "has this organism_id ever been scored" cheaply.
CREATE TABLE IF NOT EXISTS genome_foundry.harness_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organism_id         UUID NOT NULL REFERENCES genome_foundry.genome_organisms(id),
  job_id              UUID REFERENCES genome_foundry.jobs(id),
  skill_delta         DOUBLE PRECISION NOT NULL,
  solver_margin        DOUBLE PRECISION NOT NULL,
  max_chain_type_share DOUBLE PRECISION NOT NULL, -- top-decile banked-value share, must not exceed 0.40
  precog_lift_mcts     DOUBLE PRECISION NOT NULL,
  precog_lift_human_cal DOUBLE PRECISION NOT NULL,
  degenerate_strategy_flag BOOLEAN NOT NULL DEFAULT FALSE,
  raw                 JSONB NOT NULL, -- full per-tier report (RANDOM/GREEDY/HUMAN-CAL/MCTS-MAX)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_harness_results_organism ON genome_foundry.harness_results (organism_id);

-- ============ rm_finance (NEVER disposable — real money. DR = backup restore, not DROP) ============

CREATE TABLE IF NOT EXISTS rm_finance.heats (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seed                  BIGINT NOT NULL,
  branch                TEXT NOT NULL CHECK (branch IN ('A','B','C','D','E')),
  opens_at              TIMESTAMPTZ NOT NULL,
  closes_at             TIMESTAMPTZ NOT NULL,
  min_n                 INTEGER NOT NULL DEFAULT 8,   -- Spec 36 §2.2 merge-forward threshold
  weight_config_version INTEGER NOT NULL,
  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','settled','merged_forward')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rm_finance.heat_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  heat_id          UUID NOT NULL REFERENCES rm_finance.heats(id),
  account_id       TEXT NOT NULL REFERENCES accounts(id), -- real FK: same DB as accounts (admin split)
  stake_fx         BIGINT NOT NULL, -- Q16.16 fixed-point, integer only
  banked_score_fx  BIGINT,
  input_log_hash   TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (heat_id, account_id)
);

CREATE TABLE IF NOT EXISTS rm_finance.settlements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  heat_id         UUID NOT NULL UNIQUE REFERENCES rm_finance.heats(id),
  idempotency_key UUID NOT NULL UNIQUE,
  payouts_fx      JSONB NOT NULL,      -- { account_id: amount_fx, ... }
  rake_bps        INTEGER NOT NULL,
  pool_fx         BIGINT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','settled','failed')),
  settled_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Double-entry ledger — append-only. No UPDATE/DELETE at the application layer, ever.
CREATE TABLE IF NOT EXISTS rm_finance.ledger_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      TEXT NOT NULL REFERENCES accounts(id), -- real FK: same DB as accounts (admin split)
  amount_fx       BIGINT NOT NULL CHECK (amount_fx > 0),
  direction       TEXT NOT NULL CHECK (direction IN ('credit','debit')),
  reason          TEXT NOT NULL CHECK (reason IN ('heat_stake','heat_payout','rake','manual_adjustment')),
  reference_table TEXT NOT NULL,
  reference_id    UUID NOT NULL,
  idempotency_key UUID NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON rm_finance.ledger_transactions (account_id);

CREATE OR REPLACE FUNCTION rm_finance.reject_ledger_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ledger_transactions is append-only — % not permitted (row %)', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ledger_no_update ON rm_finance.ledger_transactions;
CREATE TRIGGER trg_ledger_no_update
  BEFORE UPDATE OR DELETE ON rm_finance.ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION rm_finance.reject_ledger_mutation();

-- Account balance is NEVER a stored column — always derived:
CREATE OR REPLACE VIEW rm_finance.account_balances AS
  SELECT account_id,
         COALESCE(SUM(amount_fx) FILTER (WHERE direction = 'credit'), 0)
       - COALESCE(SUM(amount_fx) FILTER (WHERE direction = 'debit'), 0) AS balance_fx
  FROM rm_finance.ledger_transactions
  GROUP BY account_id;

-- ============ public schema addition (Track 1 — no new schema needed, per blueprint §4.2b) ============
-- CONFIRMED, not re-run: 0001_init.postgres.user.sql's sessions.branch CHECK already
-- includes 'A','B','C','D','E' (see core/store/migrations/0001_init.postgres.user.sql:15).
-- No ALTER needed here.
