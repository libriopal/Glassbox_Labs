// core/store/p2-foundry-rm.ts — genome_foundry / rm_finance persistence.
//
// Postgres-only by design (unlike the P1 Store, which requires SQLite
// parity): the guarantees this module exists to prove — FOR UPDATE SKIP
// LOCKED concurrent job claiming, row-level settlement locking, DB-trigger-
// enforced immutability/append-only — have no meaningful SQLite equivalent
// for real concurrent access, and handoff_p2/02_SCHEMA_MIGRATIONS.sql only
// ever specifies running this "against a dev database" (Postgres). See the
// migration file's header comment for the full reasoning.
//
// This file, like postgres.ts/sqlite.ts, is exempt from verify-no-vendor-leak
// (core/store/ is the sanctioned single place the repo's Postgres client
// lives). genome/settlement and workers/* depend on `@glassbox/store` via
// workspace:* and import only from this module or ./types.ts — never `pg`
// directly.
//
// Pure math (matchpoints, weight curve, Fx arithmetic) intentionally stays
// OUT of this file and lives in genome/settlement — this module is DB
// orchestration only: claim a job, lock a row, write paired ledger rows in
// one transaction. genome/settlement composes these primitives with its own
// math via `withAdminTransaction`.

import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const { Pool } = pg;
type PoolClient = InstanceType<typeof pg.Client>;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const P2_MIGRATION_PATH = join(MIGRATIONS_DIR, '0002_p2_genome_foundry_rm_finance.postgres.admin.sql');

// --- jobs (genome_foundry.jobs) ---------------------------------------------

export type JobKind = 'montecarlo_harness' | 'genome_breed' | 'edi_curation';
export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface JobRow {
  id: string;
  kind: JobKind;
  payload: unknown;
  status: JobStatus;
  attempts: number;
  idempotencyKey: string;
  result: unknown;
  createdAt: string;
  updatedAt: string;
}

// --- genome_foundry.genome_organisms ----------------------------------------

export type OrganismClass = 'baseline_recreation' | 'stress_test';

export interface CreateGenomeOrganismInput {
  parentIds: string[];
  generation: number;
  karyotypeLabel: string;
  class: OrganismClass;
  mechanicsGenes: unknown;
  economyGenes: unknown;
  visualGenes?: unknown;
  seedLineageRecent?: number[];
  seedLineageBlobRef?: string | null;
  notes: string;
}

export interface GenomeOrganismRow {
  id: string;
  parentIds: string[];
  generation: number;
  karyotypeLabel: string;
  class: OrganismClass;
  mechanicsGenes: unknown;
  economyGenes: unknown;
  visualGenes: unknown;
  notes: string;
  immutable: boolean;
  archivedAt: string | null;
  createdAt: string;
}

export interface RecordHarnessResultInput {
  organismId: string;
  jobId?: string | null;
  skillDelta: number;
  solverMargin: number;
  maxChainTypeShare: number;
  precogLiftMcts: number;
  precogLiftHumanCal: number;
  degenerateStrategyFlag: boolean;
  raw: unknown;
}

// --- rm_finance ---------------------------------------------------------------

export type Branch = 'A' | 'B' | 'C' | 'D' | 'E';

export interface CreateHeatInput {
  seed: number;
  branch: Branch;
  opensAt: string;
  closesAt: string;
  minN?: number;
  weightConfigVersion: number;
}

export interface HeatRow {
  id: string;
  seed: number;
  branch: Branch;
  opensAt: string;
  closesAt: string;
  minN: number;
  weightConfigVersion: number;
  status: 'open' | 'closed' | 'settled' | 'merged_forward';
  createdAt: string;
}

export interface CreateHeatEntryInput {
  heatId: string;
  accountId: string;
  stakeFx: bigint;
  bankedScoreFx?: bigint | null;
  inputLogHash: string;
}

export interface HeatEntryRow {
  id: string;
  heatId: string;
  accountId: string;
  stakeFx: bigint;
  bankedScoreFx: bigint | null;
  inputLogHash: string;
  createdAt: string;
}

export interface InsertSettlementInput {
  heatId: string;
  idempotencyKey: string;
  payoutsFx: Record<string, bigint>;
  rakeBps: number;
  poolFx: bigint;
}

export interface InsertLedgerTransactionInput {
  accountId: string;
  amountFx: bigint;
  direction: 'credit' | 'debit';
  reason: 'heat_stake' | 'heat_payout' | 'rake' | 'manual_adjustment';
  referenceTable: string;
  referenceId: string;
  idempotencyKey: string;
}

export class LedgerAppendOnlyViolation extends Error {}
export class OrganismImmutableViolation extends Error {}

function wrapPgError(err: unknown): never {
  const pgErr = err as { code?: string; message?: string };
  if (pgErr?.code === 'P0001' && /append-only/.test(pgErr.message ?? '')) {
    throw new LedgerAppendOnlyViolation(pgErr.message);
  }
  if (pgErr?.code === 'P0001' && /immutable/.test(pgErr.message ?? '')) {
    throw new OrganismImmutableViolation(pgErr.message);
  }
  throw err;
}

export class P2FoundryRmStore {
  private readonly pool: InstanceType<typeof Pool>;

  constructor(connectionString?: string) {
    const url = connectionString ?? process.env.DATABASE_URL_ADMIN ?? '';
    if (!url) throw new Error('P2FoundryRmStore requires DATABASE_URL_ADMIN (env) or an explicit connectionString');
    this.pool = new Pool({ connectionString: url });
  }

  async migrate(): Promise<void> {
    await this.pool.query(readFileSync(P2_MIGRATION_PATH, 'utf8'));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Generic escape hatch for multi-statement atomic operations (e.g. settleHeat). */
  async withAdminTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // --- jobs ------------------------------------------------------------------

  async createJob(kind: JobKind, payload: unknown, idempotencyKey: string): Promise<JobRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO genome_foundry.jobs (kind, payload, idempotency_key) VALUES ($1, $2, $3) RETURNING *`,
      [kind, JSON.stringify(payload), idempotencyKey],
    );
    return toJobRow(rows[0]);
  }

  /** FOR UPDATE SKIP LOCKED — the standard Postgres job-queue pattern (05_WORKERS_SPEC.md). */
  async claimJob(kind: JobKind): Promise<JobRow | null> {
    const { rows } = await this.pool.query(
      `UPDATE genome_foundry.jobs SET status='running', attempts = attempts + 1, updated_at=now()
       WHERE id = (SELECT id FROM genome_foundry.jobs WHERE kind=$1 AND status='pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
      [kind],
    );
    return rows[0] ? toJobRow(rows[0]) : null;
  }

  async completeJob(id: string, result: unknown): Promise<void> {
    await this.pool.query(`UPDATE genome_foundry.jobs SET status='done', result=$2, updated_at=now() WHERE id=$1`, [id, JSON.stringify(result)]);
  }

  async failJob(id: string, result: unknown): Promise<void> {
    await this.pool.query(`UPDATE genome_foundry.jobs SET status='failed', result=$2, updated_at=now() WHERE id=$1`, [id, JSON.stringify(result)]);
  }

  async getJob(id: string): Promise<JobRow | null> {
    const { rows } = await this.pool.query(`SELECT * FROM genome_foundry.jobs WHERE id=$1`, [id]);
    return rows[0] ? toJobRow(rows[0]) : null;
  }

  // --- genome organisms --------------------------------------------------------

  /** Every insert is a fork — there is no update path (immutable=true, trigger-enforced). */
  async createGenomeOrganism(input: CreateGenomeOrganismInput): Promise<GenomeOrganismRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO genome_foundry.genome_organisms
         (parent_ids, generation, karyotype_label, class, mechanics_genes, economy_genes, visual_genes,
          seed_lineage_recent, seed_lineage_blob_ref, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        input.parentIds,
        input.generation,
        input.karyotypeLabel,
        input.class,
        JSON.stringify(input.mechanicsGenes),
        JSON.stringify(input.economyGenes),
        JSON.stringify(input.visualGenes ?? []),
        input.seedLineageRecent ?? [],
        input.seedLineageBlobRef ?? null,
        input.notes,
      ],
    ).catch(wrapPgError);
    return toOrganismRow(rows[0]);
  }

  async getGenomeOrganism(id: string): Promise<GenomeOrganismRow | null> {
    const { rows } = await this.pool.query(`SELECT * FROM genome_foundry.genome_organisms WHERE id=$1`, [id]);
    return rows[0] ? toOrganismRow(rows[0]) : null;
  }

  /** Proves the DB-level immutability trigger actually fires (verify-ledger/organism-immutability). */
  async attemptForbiddenOrganismUpdate(id: string): Promise<never | void> {
    await this.pool.query(`UPDATE genome_foundry.genome_organisms SET notes = notes WHERE id=$1`, [id]).catch(wrapPgError);
  }

  async recordHarnessResult(input: RecordHarnessResultInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO genome_foundry.harness_results
         (organism_id, job_id, skill_delta, solver_margin, max_chain_type_share, precog_lift_mcts,
          precog_lift_human_cal, degenerate_strategy_flag, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        input.organismId,
        input.jobId ?? null,
        input.skillDelta,
        input.solverMargin,
        input.maxChainTypeShare,
        input.precogLiftMcts,
        input.precogLiftHumanCal,
        input.degenerateStrategyFlag,
        JSON.stringify(input.raw),
      ],
    );
  }

  async hasHarnessResult(organismId: string): Promise<boolean> {
    const { rows } = await this.pool.query(`SELECT 1 FROM genome_foundry.harness_results WHERE organism_id=$1 LIMIT 1`, [organismId]);
    return rows.length > 0;
  }

  // --- rm_finance ----------------------------------------------------------------

  async createHeat(input: CreateHeatInput): Promise<HeatRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO rm_finance.heats (seed, branch, opens_at, closes_at, min_n, weight_config_version)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [input.seed, input.branch, input.opensAt, input.closesAt, input.minN ?? 8, input.weightConfigVersion],
    );
    return toHeatRow(rows[0]);
  }

  async createHeatEntry(input: CreateHeatEntryInput): Promise<HeatEntryRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO rm_finance.heat_entries (heat_id, account_id, stake_fx, banked_score_fx, input_log_hash)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [input.heatId, input.accountId, input.stakeFx.toString(), input.bankedScoreFx?.toString() ?? null, input.inputLogHash],
    );
    return toHeatEntryRow(rows[0]);
  }

  /** Row-level lock for the duration of the caller's transaction — must be called with a client from withAdminTransaction. */
  async getHeatForUpdate(client: PoolClient, heatId: string): Promise<HeatRow | null> {
    const { rows } = await client.query(`SELECT * FROM rm_finance.heats WHERE id=$1 FOR UPDATE`, [heatId]);
    return rows[0] ? toHeatRow(rows[0]) : null;
  }

  async listHeatEntries(client: PoolClient, heatId: string): Promise<HeatEntryRow[]> {
    const { rows } = await client.query(`SELECT * FROM rm_finance.heat_entries WHERE heat_id=$1 ORDER BY created_at`, [heatId]);
    return rows.map(toHeatEntryRow);
  }

  async findSettlementByIdempotencyKey(client: PoolClient, idempotencyKey: string): Promise<{ id: string } | null> {
    const { rows } = await client.query(`SELECT id FROM rm_finance.settlements WHERE idempotency_key=$1`, [idempotencyKey]);
    return rows[0] ?? null;
  }

  async insertSettlement(client: PoolClient, input: InsertSettlementInput): Promise<void> {
    const payouts = Object.fromEntries(Object.entries(input.payoutsFx).map(([k, v]) => [k, v.toString()]));
    await client.query(
      `INSERT INTO rm_finance.settlements (heat_id, idempotency_key, payouts_fx, rake_bps, pool_fx, status, settled_at)
       VALUES ($1,$2,$3,$4,$5,'settled', now())`,
      [input.heatId, input.idempotencyKey, JSON.stringify(payouts), input.rakeBps, input.poolFx.toString()],
    );
  }

  async insertLedgerTransaction(client: PoolClient, input: InsertLedgerTransactionInput): Promise<void> {
    await client
      .query(
        `INSERT INTO rm_finance.ledger_transactions (account_id, amount_fx, direction, reason, reference_table, reference_id, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [input.accountId, input.amountFx.toString(), input.direction, input.reason, input.referenceTable, input.referenceId, input.idempotencyKey],
      )
      .catch(wrapPgError);
  }

  /** Proves the ledger's append-only trigger actually fires. */
  async attemptForbiddenLedgerUpdate(id: string): Promise<never | void> {
    await this.pool.query(`UPDATE rm_finance.ledger_transactions SET amount_fx = amount_fx WHERE id=$1`, [id]).catch(wrapPgError);
  }

  async listLedgerTransactions(accountId: string): Promise<{ id: string }[]> {
    const { rows } = await this.pool.query(
      `SELECT id FROM rm_finance.ledger_transactions WHERE account_id=$1 ORDER BY created_at DESC`,
      [accountId],
    );
    return rows;
  }

  async getAccountBalance(accountId: string): Promise<bigint> {
    const { rows } = await this.pool.query(`SELECT balance_fx FROM rm_finance.account_balances WHERE account_id=$1`, [accountId]);
    return BigInt(rows[0]?.balance_fx ?? 0);
  }
}

function toJobRow(r: Record<string, unknown>): JobRow {
  return {
    id: r.id as string,
    kind: r.kind as JobKind,
    payload: r.payload,
    status: r.status as JobStatus,
    attempts: r.attempts as number,
    idempotencyKey: r.idempotency_key as string,
    result: r.result,
    createdAt: (r.created_at as Date).toISOString(),
    updatedAt: (r.updated_at as Date).toISOString(),
  };
}

function toOrganismRow(r: Record<string, unknown>): GenomeOrganismRow {
  return {
    id: r.id as string,
    parentIds: r.parent_ids as string[],
    generation: r.generation as number,
    karyotypeLabel: r.karyotype_label as string,
    class: r.class as OrganismClass,
    mechanicsGenes: r.mechanics_genes,
    economyGenes: r.economy_genes,
    visualGenes: r.visual_genes,
    notes: r.notes as string,
    immutable: r.immutable as boolean,
    archivedAt: r.archived_at ? (r.archived_at as Date).toISOString() : null,
    createdAt: (r.created_at as Date).toISOString(),
  };
}

function toHeatRow(r: Record<string, unknown>): HeatRow {
  return {
    id: r.id as string,
    seed: Number(r.seed),
    branch: r.branch as Branch,
    opensAt: (r.opens_at as Date).toISOString(),
    closesAt: (r.closes_at as Date).toISOString(),
    minN: r.min_n as number,
    weightConfigVersion: r.weight_config_version as number,
    status: r.status as HeatRow['status'],
    createdAt: (r.created_at as Date).toISOString(),
  };
}

function toHeatEntryRow(r: Record<string, unknown>): HeatEntryRow {
  return {
    id: r.id as string,
    heatId: r.heat_id as string,
    accountId: r.account_id as string,
    stakeFx: BigInt(r.stake_fx as string),
    bankedScoreFx: r.banked_score_fx === null ? null : BigInt(r.banked_score_fx as string),
    inputLogHash: r.input_log_hash as string,
    createdAt: (r.created_at as Date).toISOString(),
  };
}
