-- core/store/migrations/0003_p2_worker_spend.postgres.admin.sql
-- handoff_p2/05_WORKERS_SPEC.md, workers/edi-curation D8 fix #1: "Budget/spend
-- tracking for any LLM calls this worker makes ... must be persisted to a DB
-- row, never an in-memory counter — restart-proof." This table is that row.
-- D8 fix #2 (cost computed from actual token usage, not a flat estimate) is
-- enforced by the shape of recordSpend's inputs (tokensIn/tokensOut are
-- required, not optional) rather than by this schema alone.
--
-- No SQLite parity for the same reason as 0002's tables — see that file's
-- header. Idempotent guard included.

CREATE TABLE IF NOT EXISTS genome_foundry.worker_spend (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker        TEXT NOT NULL,
  model         TEXT NOT NULL,
  tokens_in     INTEGER NOT NULL CHECK (tokens_in >= 0),
  tokens_out    INTEGER NOT NULL CHECK (tokens_out >= 0),
  cost_usd_micros BIGINT NOT NULL CHECK (cost_usd_micros >= 0), -- USD * 1e6, integer, no float money
  job_id        UUID REFERENCES genome_foundry.jobs(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_worker_spend_worker ON genome_foundry.worker_spend (worker);
