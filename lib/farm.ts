// Farm plans: one plan per protocol, generated from the protocol's own record — its category
// decides the core action, its first chain prices the gas, its TVL sizes the position, and its
// age sets how long the position must be held to count. No plan is a slogan: every step names
// the action, what it costs and how long it takes, and the plan's totals are written into the
// board so the dashboard's detail view can show them.

import type { SnapshotProtocol } from './model.ts';

/** Working capital for one farm position, sized to the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long a position must be held: younger protocols get the longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 35;
  if (age < 180) return 45;
  if (age < 540) return 35;
  return 30;
}

/** The gas class of a chain, in the words and prices a farmer budgets with. */
export interface GasClass {
  label: string;
  per_action: string;
  midpoint_usd: number;
}

const L2_CHAINS = new Set([
  'Arbitrum', 'Base', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Mode',
  'Taiko', 'Starknet', 'Manta', 'Zora', 'Fraxtal', 'Sonic', 'Berachain', 'Unichain', 'Ink',
  'Abstract', 'World Chain', 'Soneium', 'Metis', 'Polygon zkEVM', 'X Layer', 'Bob', 'Lisk',
]);

export function gasFor(chain: string | null): GasClass {
  if (chain === 'Ethereum') return { label: 'Ethereum mainnet', per_action: '$6-12 of gas', midpoint_usd: 9 };
  if (chain === 'Solana') return { label: 'Solana', per_action: 'under $0.05 of fees', midpoint_usd: 0.05 };
  if (chain === 'BNB Chain') return { label: 'BNB Chain', per_action: '$0.20-1 of gas', midpoint_usd: 0.6 };
  if (chain !== null && L2_CHAINS.has(chain)) return { label: chain, per_action: '$0.10-1 of gas', midpoint_usd: 0.5 };
  return { label: chain ?? 'its main chain', per_action: '$1-3 of gas', midpoint_usd: 2 };
}

/** The category families the plan templates speak to. */
type Family = 'lending' | 'liquidity' | 'perps' | 'curator' | 'staking' | 'chain' | 'prediction' | 'payments' | 'generic';

function familyOf(p: SnapshotProtocol): Family {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('dex') || c.includes('liquidity') || c.includes('yield') || c.includes('farm')) return 'liquidity';
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) return 'perps';
  if (c.includes('curator') || c.includes('allocator')) return 'curator';
  if (c.includes('staking pool')) return 'staking';
  if (c === 'chain') return 'chain';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('payment') || c.includes('card')) return 'payments';
  return 'generic';
}

/** The family's core position: the one action that makes a wallet a real user of the protocol. */
function coreAction(family: Family, name: string, capital: number, chainLabel: string): string {
  switch (family) {
    case 'lending':
      return `Supply $${capital} of USDC as collateral in ${name} on ${chainLabel} and borrow about 40% of it against the position, so the wallet both lends and borrows.`;
    case 'liquidity':
      return `Provide $${capital} split between USDC and the pool's paired asset in ${name}'s most-used pool on ${chainLabel} and keep the LP position open.`;
    case 'perps':
      return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position (long one asset, short another of equal size) so the account trades without directional risk.`;
    case 'curator':
      return `Deposit $${capital} of USDC into the largest ${name} vault on ${chainLabel} and keep the vault shares in the wallet.`;
    case 'staking':
      return `Stake $${capital} of the chain's native asset through ${name} on ${chainLabel} and keep the staking position and its receipts.`;
    case 'chain':
      return `Bridge $${capital} of USDC to ${name} and hold it there, paying gas in the chain's native asset for every action so the wallet builds a real history on the chain.`;
    case 'prediction':
      return `Fund the account with $${capital} and take one position on each side of two liquid markets on ${name}, so the wallet both makes and settles trades.`;
    case 'payments':
      return `Load $${capital} onto the ${name} account or card and make three ordinary payments with it, so the wallet reads as a customer, not a visitor.`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${chainLabel} through its main app and keep the position open.`;
  }
}

/** The family's second action: a different surface of the same protocol, used on the weekly visit. */
function secondAction(family: Family, name: string): string {
  switch (family) {
    case 'lending':
      return `Repay part of the borrow and re-borrow a smaller amount, then vote in any governance poll ${name} opens to its users.`;
    case 'liquidity':
      return `Claim any fees the pool shows, swap a few dollars through ${name}'s own interface and add the proceeds back to the position.`;
    case 'perps':
      return `Adjust the hedge once (close one leg and reopen it at the current price) so the account shows ordinary trading activity on ${name}.`;
    case 'curator':
      return `Move about a fifth of the position into a second ${name} vault, so the wallet holds more than one of the curator's strategies.`;
    case 'staking':
      return `Claim the staking rewards ${name} shows and restake them into the same position rather than withdrawing them.`;
    case 'chain':
      return `Use one native app on the chain each week (a swap or a name registration) and keep the receipts in the same wallet.`;
    case 'prediction':
      return `Settle any finished position and place one new trade on a market that closes within the week.`;
    case 'payments':
      return `Make one more ordinary payment and, if ${name} offers referrals, send one to a wallet you control.`;
    default:
      return `Repeat the core action with a small top-up of $10-20 and claim anything the app shows as claimable.`;
  }
}

/** A step as one string for board.json: the action, then its cost and time, within 20..600 characters. */
function step(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page before acting.`;
  return s;
}

/** The plan's headline numbers, shown in the dashboard's detail view. */
export interface PlanTotals {
  capital_usd: number;
  gas_usd: number;
  hold_days: number;
  weeks: number;
  minutes_per_week: number;
}

export function planTotals(p: SnapshotProtocol, age: number | null): PlanTotals {
  const gas = gasFor(p.chains.length > 0 ? p.chains[0]! : null);
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  // Funding transfer + core action + one closing action, plus one weekly action per week.
  const gasUsd = Math.round((gas.midpoint_usd * (3 + weeks)) * 100) / 100;
  return { capital_usd: capitalFor(p), gas_usd: gasUsd, hold_days: hold, weeks, minutes_per_week: 10 };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived from the
 * protocol's own record. The same function writes board.json's steps and the dashboard's plan,
 * so the two can never disagree.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const family = familyOf(p);
  const chainName = p.chains.length > 0 ? p.chains[0]! : null;
  const gas = gasFor(chainName);
  const totals = planTotals(p, age);
  const capital = totals.capital_usd;
  const where = chainName === null ? 'its main chain' : gas.label;
  return [
    step(
      `Create a fresh wallet for this farm alone, back up its seed phrase offline, and fund it on ${where} with the $${capital} position plus a gas buffer.`,
      `one funding transfer, about ${gas.per_action}`,
      '10 minutes',
    ),
    step(coreAction(family, p.name, capital, where), `$${capital} of working capital plus ${gas.per_action}`, '15 minutes to set up'),
    step(secondAction(family, p.name), `about ${gas.per_action} a visit`, '10 minutes a week'),
    step(
      `Return once a week for ${totals.weeks} weeks and repeat one qualifying action each visit, varying the amount slightly so the history reads as ordinary use of ${p.name}.`,
      `about ${gas.per_action} a week, roughly $${totals.gas_usd} of gas across the whole plan`,
      '10 minutes a week',
    ),
    step(
      `Hold the position for at least ${totals.hold_days} days without withdrawing, so the wallet appears in several weekly snapshots of ${p.name}'s users rather than one.`,
      `the $${capital} stays in the position for the full ${totals.hold_days} days`,
      `${totals.hold_days} days`,
    ),
    step(
      `Each week, check ${p.name}'s own app and announcements for a points or rewards program; if one opens, register this same wallet before doing anything new, and never connect it to a look-alike site.`,
      'nothing to check; never pay to register',
      '5 minutes a week',
    ),
    step(
      `If ${p.name} issues a token, claim only from the link its own app or announcement publishes, pay nothing to claim beyond gas, and then decide with the position in front of you whether to hold or sell the allocation.`,
      'claim gas only, about ' + gas.per_action,
      '15 minutes on the day',
    ),
  ];
}
