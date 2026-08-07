// game/branches-bcde/src/economy.ts — handoff_p2/07_TRACK1_BRANCH_EXPANSION.md
//
// Re-exports the EXISTING economyVisible (game/economy/rules.ts), now
// branch-aware (see that file for the actual logic and its reasoning) —
// this package does NOT fork a second copy of the function, per the spec's
// explicit instruction. game/economy has no package.json (it's part of the
// existing flat root tsconfig.json project, not a pnpm workspace package),
// so this is a plain relative import, not a workspace:* dependency — matches
// 01_MONOREPO_SETUP.md's table, which lists game/branches-bcde as depending
// on "none new (uses existing schema types)".
export { economyVisible } from '../../economy/rules';
