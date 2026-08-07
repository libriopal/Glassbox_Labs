// genome/settlement/src/settle.ts — handoff_p2/04_RMG_LEDGER_AND_SETTLEMENT.md
//
// FEATURE_RM_SETTLEMENT check is the FIRST statement, unconditionally, before
// any DB work — do not move it, do not weaken it, do not add a bypass.
//
// DB orchestration goes through @glassbox/store's P2FoundryRmStore (core/store
// is the only package in the repo that imports `pg`) — this file contains no
// SQL and no vendor client, only the pari-mutuel math (matchpoints.ts) and
// the transaction shape.
//
// KNOWN GAP, flagged not silently resolved: Fx (genome/engine/src/fixedpoint.ts)
// is documented as "stored as i32" — Q16.16 overflows a 32-bit int at roughly
// 32768 whole units. rm_finance's DB columns are BIGINT specifically because
// real settlement pools may exceed that. This file does the pari-mutuel math
// in plain JS numbers (safe up to 2^53, far past i32) rather than clamping to
// Fx's documented i32 range, because clamping would silently produce wrong
// payouts for any pool over ~32k units. The tension between Fx's i32 framing
// (inherited from Spec 34's board/tile physics) and real-money pool sizes is
// real and unresolved by handoff_p2 — must be settled before FEATURE_RM_SETTLEMENT
// ever flips true, not decided silently here.

import { createHash } from 'node:crypto';
import type { Fx } from '@glassbox/genome-engine/fixedpoint';
import type { P2FoundryRmStore } from '@glassbox/store/p2-foundry-rm';
import { matchpoints, weight, DEFAULT_WEIGHT_CONFIG } from './matchpoints';

// ledger_transactions.idempotency_key is UUID (02_SCHEMA_MIGRATIONS.sql) — the
// spec's literal `${idempotencyKey}-credit-${i}` pseudocode is not valid UUID
// syntax, so each per-entry credit key is deterministically re-derived as a
// UUID from (idempotencyKey, i) instead: same inputs always produce the same
// key (idempotency preserved), and it's always a well-formed UUID (Postgres's
// uuid type accepts any 8-4-4-4-12 hex string, not just RFC4122-versioned ones).
function deriveCreditIdempotencyKey(settlementIdempotencyKey: string, index: number): string {
  const hex = createHash('sha256').update(`${settlementIdempotencyKey}:credit:${index}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export class AlreadySettledError extends Error {
  constructor(heatId: string) { super(`Heat ${heatId} already settled (idempotency key matched) — returning original result, not re-settling.`); }
}
export class FeatureFlagDisabledError extends Error {
  constructor() { super('FEATURE_RM_SETTLEMENT is disabled — E29 legal review has not cleared this path.'); }
}
export class HeatNotFoundError extends Error {
  constructor(heatId: string) { super(`Heat ${heatId} not found.`); }
}

const RAKE_BPS_DEFAULT = 600; // v1 default per Spec 36 §2.4 — ELECTION PENDING if changed

export async function settleHeat(store: P2FoundryRmStore, heatId: string, idempotencyKey: string): Promise<void> {
  if (process.env.FEATURE_RM_SETTLEMENT !== 'true') {
    throw new FeatureFlagDisabledError();
  }

  await store.withAdminTransaction(async (client) => {
    const existing = await store.findSettlementByIdempotencyKey(client, idempotencyKey);
    if (existing) throw new AlreadySettledError(heatId);

    // Row-level lock for the duration of the payout-write transaction (blueprint §4.2):
    const heat = await store.getHeatForUpdate(client, heatId);
    if (!heat) throw new HeatNotFoundError(heatId);
    const entries = await store.listHeatEntries(client, heatId);

    // banked_score_fx is already a raw Q16.16 integer in the DB (same representation
    // Fx uses internally) — cast, do not re-scale through fx() (that would multiply
    // by 65536 a second time).
    const scores: Fx[] = entries.map((e) => Number(e.bankedScoreFx ?? 0n) as Fx);
    const weights = scores.map((s, i) => weight(matchpoints(scores, i).p_i, DEFAULT_WEIGHT_CONFIG));
    const sumW = weights.reduce((a, b) => a + (b as unknown as number), 0);
    const pool = entries.reduce((a, e) => a + Number(e.stakeFx), 0);
    const rakeBps = RAKE_BPS_DEFAULT;
    const netPool = pool - Math.floor((pool * rakeBps) / 10000);

    const raw = weights.map((w) => Math.floor((netPool * (w as unknown as number)) / sumW));
    const remainder = netPool - raw.reduce((a, b) => a + b, 0);
    const topIdx = raw.indexOf(Math.max(...raw));
    raw[topIdx] = raw[topIdx]! + remainder; // pool closes EXACTLY — Σpayouts === netPool, always

    const payoutsFx: Record<string, bigint> = {};
    for (let i = 0; i < entries.length; i++) payoutsFx[entries[i]!.accountId] = BigInt(raw[i]!);

    // Single transaction: settlements row + paired ledger_transactions rows (double-entry, §4.2a)
    await store.insertSettlement(client, {
      heatId,
      idempotencyKey,
      payoutsFx,
      rakeBps,
      poolFx: BigInt(netPool),
    });
    for (let i = 0; i < entries.length; i++) {
      const amount = BigInt(raw[i]!);
      if (amount <= 0n) continue; // ledger_transactions.amount_fx CHECK (amount_fx > 0) — zero payouts write no row
      await store.insertLedgerTransaction(client, {
        accountId: entries[i]!.accountId,
        amountFx: amount,
        direction: 'credit',
        reason: 'heat_payout',
        referenceTable: 'settlements',
        referenceId: heatId,
        idempotencyKey: deriveCreditIdempotencyKey(idempotencyKey, i),
      });
    }
  });
}
