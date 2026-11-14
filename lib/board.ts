// Board assembly: the ranked launch candidates, the products set aside, the live tokens set
// apart, the dashboard's dataset, and the gate's own checks restated so a bad board fails here
// before it is ever handed in.

import {
  ageDays,
  categoryMultiples,
  impliedValue,
  median,
  productReason,
  recordsNoToken,
  MODEL,
  type CategoryMultiple,
  type Snapshot,
  type SnapshotProtocol,
  type ValueBreakdown,
} from './model.ts';
import { farmSteps, planTotals, type PlanTotals } from './farm.ts';

/** One row of board.json: a ranked launch candidate with its model breakdown and farm plan. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  model: ValueBreakdown;
  plan: PlanTotals;
  farm_steps: string[];
}

/** A pre-token protocol the product rule set aside: tracked and explained, never ranked as a launch. */
export interface ProductRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  reason: string;
}

/** A protocol whose token already trades: the market's own value, shown apart from the board. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  multiple: number | null;
}

/** Everything the dashboard renders, written beside the page as data.js. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: typeof MODEL;
  global_multiple: number;
  median_age_days: number;
  protocols_scanned: number;
  board_size: number;
  watchlist_size: number;
  products_size: number;
  live_size: number;
  multiples: CategoryMultiple[];
  rows: BoardRow[];
  products: ProductRow[];
  live: LiveRow[];
}

/** How many live-token protocols the dashboard's Already trading view carries, by market cap. */
const LIVE_ROWS = 30;

/**
 * Build the whole radar from the snapshot: rank every launch candidate (the watchlist's product
 * rule at every size, no cap), set the products aside with their reasons, and set the live tokens
 * apart at the market's own values.
 */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { table, global_median } = categoryMultiples(snapshot);
  const watchlist = new Set(snapshot.watchlist);

  const preToken = snapshot.protocols.filter(recordsNoToken);
  const knownAges = preToken
    .map((p) => ageDays(snapshot.as_of, p.listed_at))
    .filter((a): a is number => a !== null);
  const medianAge = knownAges.length > 0 ? median(knownAges) : 365;

  const candidates: SnapshotProtocol[] = [];
  const products: ProductRow[] = [];
  for (const p of preToken) {
    if (p.category === 'CEX') {
      products.push({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d, reason: 'an exchange’s own product, not an independent launch candidate' });
      continue;
    }
    const reason = productReason(p);
    if (reason !== null) {
      products.push({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d, reason });
    } else {
      candidates.push(p);
    }
  }
  // The watchlist is the floor: a watchlist slug the product rule somehow set aside still ranks.
  for (const slug of watchlist) {
    const at = products.findIndex((r) => r.slug === slug);
    if (at >= 0) {
      const [row] = products.splice(at, 1);
      const p = snapshot.protocols.find((x) => x.slug === row!.slug);
      if (p !== undefined) candidates.push(p);
    }
  }
  products.sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));

  const scored = candidates.map((p) => {
    const value = impliedValue(p, snapshot.as_of, table, global_median, medianAge);
    return { p, value };
  });
  scored.sort(
    (a, b) =>
      b.value.implied_value_usd - a.value.implied_value_usd ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.value.age_days,
    watchlist: watchlist.has(s.p.slug),
    implied_value_usd: s.value.implied_value_usd,
    model: s.value,
    plan: planTotals(s.p, s.value.age_days),
    farm_steps: farmSteps(s.p, s.value.age_days),
  }));

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? Math.round((p.mcap_usd / p.tvl_usd) * 1e4) / 1e4 : null,
    }));

  const multiples = [...table.values()]
    .filter((m) => board.some((r) => (r.category ?? 'Uncategorized') === m.category))
    .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1))
    .map((m) => ({ ...m, peer_median: m.peer_median === null ? null : Math.round(m.peer_median * 1e4) / 1e4, multiple: Math.round(m.multiple * 1e4) / 1e4 }));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL.version,
    model: MODEL,
    global_multiple: Math.round(global_median * 1e4) / 1e4,
    median_age_days: medianAge,
    protocols_scanned: snapshot.protocols.length,
    board_size: board.length,
    watchlist_size: snapshot.watchlist.length,
    products_size: products.length,
    live_size: live.length,
    multiples,
    rows: board,
    products,
    live,
  };
  return { board, radar };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board names a slug twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `row ${i + 1} carries rank ${r.rank}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters once trimmed`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  return null;
}

/** The dashboard's dataset as one script: window.RADAR, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
