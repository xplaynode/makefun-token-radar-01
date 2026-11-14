// Launch Radar's model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// WHAT THE BOARD IS
// The board ranks launch candidates: protocols that record no token in the snapshot and are not a
// wrapped, staked or bridged product of a token that already trades. The snapshot's watchlist rule
// (TVL at or above the floor, no token recorded, no product of a live token) is applied here at
// every size, not only above the floor: the watchlist is the floor of the board, never its ceiling,
// and every candidate the rule admits is ranked, with no cap. Protocols the product rule sets aside
// are not dropped: they are carried in the data as `products`, named with the rule that set them
// aside, and the dashboard shows them apart from the board. Protocols whose token already trades
// are carried as `live`, at the market's own values, and are never ranked as launches.
//
// THE VALUE MODEL (every figure from the snapshot itself; no protocol name is ever special-cased)
//   implied = tvl_usd x category_multiple x momentum x seasoning x breadth
//
//   category_multiple: what the market itself pays for a dollar of TVL in this protocol's
//     category, measured from the same snapshot: the median mcap/TVL of the category's tokenised
//     protocols, shrunk toward the global median by peer count (weight SHRINK_K) so a thin
//     category cannot shout, pulled a further share toward the global median when the category
//     has fewer than THIN_PEER_THRESHOLD tokenised peers, and clamped to
//     [MULTIPLE_LO, MULTIPLE_HI]. A category with no tokenised peer borrows the global median
//     and says so (peers = 0).
//   momentum: 1 + clamp(change_7d, -50, +100) / 100 x 0.5, so a hot week lifts a value by at
//     most half and a cold one cuts at most a quarter; unreported change counts as flat.
//   seasoning: 0.75 + 0.45 x min(age_days, 1460) / 1460, where age is the days DefiLlama has
//     tracked the protocol with no token recorded: a launch after four tracked years carries
//     more accumulated users than one after four weeks. An unknown listing date borrows the
//     median age of the snapshot's pre-token protocols, computed from the snapshot.
//   breadth: 1 + 0.03 x min(chains - 1, 7): each extra chain is another user base a launch
//     would reach, worth a little, never a lot.
//
// Every factor of every row is written into board.json and shown in the dashboard's detail view,
// so a reader can recompute any row's implied value from the snapshot's own figures.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The model's constants, stated in the dashboard so a reader can re-derive every number. */
export const MODEL = {
  version: 'launch-radar-2',
  shrink_k: 6,
  thin_peer_threshold: 3,
  thin_peer_pull: 0.5,
  multiple_lo: 0.02,
  multiple_hi: 2.0,
  momentum_weight: 0.5,
  momentum_floor_pct: -50,
  momentum_cap_pct: 100,
  seasoning_base: 0.75,
  seasoning_range: 0.45,
  seasoning_days: 1460,
  breadth_per_chain: 0.03,
  breadth_max_extra_chains: 7,
} as const;

const DAY_MS = 86_400_000;

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Whether a protocol records no token in the snapshot (no market cap, no CoinGecko id, no symbol). */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are products of an underlying asset rather than launches of their own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** A whole word wrapped, staked or staking in a name marks a product of an asset that exists. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Names that begin with an exchange's name are that exchange's product, not a launch candidate. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Why a pre-token protocol is set aside as a product rather than ranked as a launch, or null when
 * it is a launch candidate. This is the watchlist's own product rule, applied at every size: it
 * keeps the board honest about the difference between a protocol still to issue a token and a
 * wrapped or staked claim on one that already trades.
 */
export function productReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return `a ${p.category.toLowerCase()} product of an asset that already trades`;
  if (PRODUCT_WORD.test(p.name)) return 'a wrapped or staked product of an asset that already trades';
  if (EXCHANGE_PREFIX.test(p.name)) return 'an exchange product, not an independent launch candidate';
  if (VERSIONED.test(p.name)) return 'a versioned pool of another protocol';
  return null;
}

/** One category's measured multiple: the shrunk median of its tokenised peers' mcap/TVL. */
export interface CategoryMultiple {
  category: string;
  peers: number;
  peer_median: number | null;
  multiple: number;
}

/** Every category's multiple, measured from the snapshot's tokenised protocols. */
export function categoryMultiples(snapshot: Snapshot): { table: Map<string, CategoryMultiple>; global_median: number } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? 'Uncategorized';
    const list = ratios.get(key);
    if (list === undefined) ratios.set(key, [ratio]);
    else list.push(ratio);
  }
  const globalMedian = all.length > 0 ? median(all) : 0;
  const table = new Map<string, CategoryMultiple>();
  for (const [category, rs] of ratios) {
    const peerMedian = median(rs);
    const shrunk = (rs.length * peerMedian + MODEL.shrink_k * globalMedian) / (rs.length + MODEL.shrink_k);
    let multiple = Math.min(MODEL.multiple_hi, Math.max(MODEL.multiple_lo, shrunk));
    // A category with fewer peers than the threshold has a median one or two protocols can
    // dominate: pull its multiple a further share of the way to the global median (half of the
    // remaining distance for a single peer, a third of it for two).
    if (rs.length < MODEL.thin_peer_threshold) {
      const pull = ((MODEL.thin_peer_threshold - rs.length) / MODEL.thin_peer_threshold) * MODEL.thin_peer_pull;
      multiple = multiple * (1 - pull) + globalMedian * pull;
    }
    table.set(category, { category, peers: rs.length, peer_median: peerMedian, multiple });
  }
  return { table, global_median: globalMedian };
}

/** The factor breakdown of one protocol's implied value. */
export interface ValueBreakdown {
  category_multiple: number;
  multiple_peers: number;
  momentum_factor: number;
  seasoning_factor: number;
  breadth_factor: number;
  age_days: number | null;
  implied_value_usd: number;
}

/** Score one protocol: TVL times the four factors, each derived from the snapshot's own figures. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  multiples: Map<string, CategoryMultiple>,
  globalMedian: number,
  medianPreTokenAge: number,
): ValueBreakdown {
  const entry = multiples.get(p.category ?? 'Uncategorized');
  const categoryMultiple = entry === undefined ? globalMedian : entry.multiple;
  const multiplePeers = entry === undefined ? 0 : entry.peers;

  const change = p.change_7d === null ? 0 : Math.min(MODEL.momentum_cap_pct, Math.max(MODEL.momentum_floor_pct, p.change_7d));
  const momentum = 1 + (change / 100) * MODEL.momentum_weight;

  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? medianPreTokenAge;
  const seasoning = MODEL.seasoning_base + MODEL.seasoning_range * (Math.min(Math.max(ageForModel, 0), MODEL.seasoning_days) / MODEL.seasoning_days);

  const breadth = 1 + MODEL.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), MODEL.breadth_max_extra_chains);

  const implied = Math.max(1, Math.round(p.tvl_usd * categoryMultiple * momentum * seasoning * breadth));
  return {
    category_multiple: round4(categoryMultiple),
    multiple_peers: multiplePeers,
    momentum_factor: round4(momentum),
    seasoning_factor: round4(seasoning),
    breadth_factor: round4(breadth),
    age_days: age,
    implied_value_usd: implied,
  };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The snapshot parsed out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}
