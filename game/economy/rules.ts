// game/economy/rules.ts — §6 (07_CLAUDE_CODE_HANDOFF_V6.md)
// Age architecture, self-exclusion, anti-manipulation, and economy rules.

import type { Account, AccountMessage, PurchaseCatalogItem, SessionUXConfig, StakeRelease } from './types.ts';

// --- §6.1 / §6.2 — one code path, two triggers ------------------------------

/**
 * Under-21 accounts never see the economy. Self-exclusion reuses the same invisible-layer mechanism.
 *
 * `branch` (handoff_p2/07_TRACK1_BRANCH_EXPANSION.md, D3) is an ADDITIVE extension point for Track 1's
 * B-E branch expansion — optional, so every existing caller (single-arg `economyVisible(account)`) is
 * unaffected. Self-exclusion/age-verification remain UNCONDITIONAL regardless of branch (blueprint §2,
 * non-negotiable): a self-excluded account must stay excluded from the economy on every branch, no
 * exceptions carved out for new branches. v1 has no branch-specific denial logic beyond that — this is
 * the extension point, not a completed per-branch feature. `[OPEN — E-P2.2]` decides whether Track 2's
 * economy needs its own visibility rule distinct from this function entirely.
 */
export function economyVisible(account: Account, branch?: 'A' | 'B' | 'C' | 'D' | 'E'): boolean {
  void branch;
  return account.ageVerified21Plus && !account.selfExcluded;
}

export function canReverseSelfExclusion(account: Account, now: Date): boolean {
  if (!account.selfExcluded) return false;
  if (!account.selfExclusionCoolingOffUntil) return false; // no cooling-off window set = cannot reverse yet
  return now.getTime() >= new Date(account.selfExclusionCoolingOffUntil).getTime();
}

export interface EconomyVisibilityResult {
  passed: boolean;
  violations: string[];
}

/** verify-economy-invisibility: fails when an economy surface would render for under-21 or self-excluded. */
export function verifyEconomyInvisibility(accounts: Account[], renderedEconomyFor: string[]): EconomyVisibilityResult {
  const violations: string[] = [];
  const renderedSet = new Set(renderedEconomyFor);
  for (const account of accounts) {
    const shouldBeVisible = economyVisible(account);
    const wasRendered = renderedSet.has(account.id);
    if (wasRendered && !shouldBeVisible) {
      violations.push(`economy rendered for ${account.id} (age21+=${account.ageVerified21Plus}, selfExcluded=${account.selfExcluded})`);
    }
  }
  return { passed: violations.length === 0, violations };
}

// --- §6.2 — no solicitation to reverse self-exclusion -----------------------

export interface SelfExclusionSolicitResult {
  passed: boolean;
  violations: string[];
}

const REVERSAL_SOLICIT_PATTERN = /re-?activate|come back|un-?exclude|reverse.*exclusion|rejoin (the )?economy/i;

/** verify-self-exclusion-no-solicit: any prompt/offer/incentive to reverse exclusion is a violation. */
export function verifySelfExclusionNoSolicit(accounts: Account[], messages: AccountMessage[]): SelfExclusionSolicitResult {
  const excludedIds = new Set(accounts.filter((a) => a.selfExcluded).map((a) => a.id));
  const violations = messages
    .filter((m) => excludedIds.has(m.accountId))
    .filter((m) => m.promptsReversal || REVERSAL_SOLICIT_PATTERN.test(m.content))
    .map((m) => `${m.accountId}: [${m.messageType}] "${m.content}"`);
  return { passed: violations.length === 0, violations };
}

// --- §6.3 layer 1 — anti-manipulation verify-suite invariants --------------

export interface AntiManipulationResult {
  passed: boolean;
  violations: string[];
}

/** verify-anti-manipulation: dark pattern, loss-framing, scarcity timer, streak-punishment, abrupt session end. */
export function verifyAntiManipulation(config: SessionUXConfig): AntiManipulationResult {
  const violations: string[] = [];
  if (config.hasDarkPatterns) violations.push('dark pattern present');
  if (config.hasLossFraming) violations.push('loss-framing present');
  if (config.hasArtificialScarcityTimer) violations.push('artificial scarcity timer present');
  if (config.hasStreakPunishment) violations.push('streak-punishment present');
  if (!config.sessionEndIsGraceful) violations.push('session end is not graceful');
  return { passed: violations.length === 0, violations };
}

// --- §6.5 — economy rules ----------------------------------------------------

export interface PdxPurchaseResult {
  passed: boolean;
  violations: string[];
}

/** PDX: ONLY awarded as a reward. NEVER purchasable. No purchase of dust. Ever. */
export function verifyPdxNeverPurchasable(catalog: PurchaseCatalogItem[]): PdxPurchaseResult {
  const violations = catalog.filter((item) => item.grants === 'pdx').map((item) => item.sku);
  return { passed: violations.length === 0, violations };
}

/** At release: principal returned at 100% — NO BONUS (Tier 1, R6Q2). The ~2% bonus was removed. */
export function verifyNoStakeBonus(release: StakeRelease): boolean {
  return release.payout === release.principal;
}
