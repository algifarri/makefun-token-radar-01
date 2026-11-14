// Token Radar's Compass model: one sealed snapshot of the protocol universe in, one ranked
// board of pre-token protocols out.
//
// Where the ranking comes from
// ----------------------------
// The snapshot carries two populations: protocols whose token already trades (a market cap, a
// CoinGecko id, a symbol) and protocols that record no token. The market has already priced the
// first population, so the model learns from it: for every category with at least two trading
// protocols it takes the median market-cap-to-TVL multiple the market pays in that category.
// A pre-token protocol is then valued the way the market values its trading peers:
//
//   base        = tvl_usd x category_multiple        (median mcap/TVL of the category's
//                                                      trading protocols, clamped to [0.02, 3];
//                                                      the all-category median when the
//                                                      category has fewer than two peers)
//   momentum    = 1 + clamp(change_7d, -40, 80)/100 x 0.35    (a hot week lifts, a bad week cuts)
//   maturity    = 0.75 + min(age_days, 1460)/1460 x 0.5      (older and still token-less has had
//                                                      longer to build the thing a token prices;
//                                                      unknown listing date counts as 365 days)
//   breadth     = 1 + 0.03 x min(chains - 1, 6)               (each extra chain is distribution)
//   implied     = max(1, round(base x momentum x maturity x breadth))
//
// Every input is a figure the snapshot itself carries; no protocol name is special-cased, and the
// same function scores every row. The board covers the snapshot's whole watchlist (the floor,
// never a ceiling) and adds the strongest pre-token protocols below the floor that the radar
// exists to find early. Trading protocols are never ranked: they are set aside and shown at the
// market's own values. Language stays careful: a board row "records no token" in this snapshot.
//
// The snapshot parser is strict about figures that cannot be real: a negative TVL is refused
// outright, and a negative market cap is read as no market cap recorded at all — the sealed
// snapshot itself carries one such sentinel (a trading protocol with mcap_usd -1), and treating
// it as a real price would let a placeholder leak into the trading view.
//
// A conviction score (0-100) sits beside the value so a reader can sort by either: it blends the
// row's TVL scale, its momentum, its maturity, its chain breadth and how much trading evidence
// its category carries.

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

/** The model's version label: the dashboard names it and the board's rows carry its constants. */
export const MODEL_VERSION = 'compass-1';

/** The model's constants, stated in full on the dashboard's method panel. */
export const MODEL = {
  multiple_min: 0.02,
  multiple_max: 3,
  min_category_samples: 2,
  min_sample_tvl_usd: 1_000_000,
  momentum_weight: 0.35,
  momentum_floor_pct: -40,
  momentum_cap_pct: 80,
  maturity_base: 0.75,
  maturity_span: 0.5,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_max_extra_chains: 6,
} as const;

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 180;

/** How many trading protocols the dashboard's "already trading" view carries, by market cap. */
export const LIVE_ROWS = 24;

/** What the market pays for one TVL dollar in a category, and how much evidence backs it. */
export interface CategoryMultiple {
  category: string;
  /** The multiple the model applies: the category median, clamped; the global median as fallback. */
  multiple: number;
  /** The category's raw median before clamping, or null when the category has too few peers. */
  raw_median: number | null;
  /** How many trading protocols in the category were sampled. */
  samples: number;
  /** True when the row's category had too few peers and the global median was used. */
  fallback: boolean;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row, with the model's working shown. */
export interface BoardRow {
  rank: number;
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
  token_status: 'records-no-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  conviction: number;
  model: {
    category_multiple: number;
    multiple_samples: number;
    multiple_fallback: boolean;
    momentum_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one board row; farm plans are regenerated in the page. */
export type RadarRow = [
  rank: number,
  slug: string,
  name: string,
  category: string | null,
  chains: string[],
  tvl_usd: number,
  change_7d: number | null,
  age_days: number | null,
  implied_value_usd: number,
  category_multiple: number,
  momentum_multiplier: number,
  maturity_multiplier: number,
  breadth_multiplier: number,
  conviction: number,
  watchlist: 0 | 1,
];

/** A trading protocol: the board shows the market's own value for it, never a model's. */
export type LiveRow = [
  slug: string,
  name: string,
  category: string | null,
  chains: string[],
  tvl_usd: number,
  mcap_usd: number | null,
  change_7d: number | null,
];

/** Everything the dashboard needs: the board, the trading set, the multiples, and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: typeof MODEL;
  global_multiple: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  multiples: [category: string, applied: number, raw_median: number | null, samples: number][];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all in the snapshot. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: records no token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * The market's multiples, learned from the snapshot's trading protocols: per category, the
 * median market-cap-to-TVL of the protocols that already trade, sampled only where the TVL is
 * at least the model's floor for a sample so a dust pool cannot set a category's price.
 */
export function categoryMultiples(snapshot: Snapshot): { byCategory: Map<string, CategoryMultiple>; global: number } {
  const samples = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0) continue;
    if (p.tvl_usd < MODEL.min_sample_tvl_usd) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? '(uncategorised)';
    const list = samples.get(key) ?? [];
    list.push(ratio);
    samples.set(key, list);
  }
  const global = all.length > 0 ? median(all) : 0.25;
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, ratios] of samples) {
    const raw = median(ratios);
    const fallback = ratios.length < MODEL.min_category_samples;
    byCategory.set(category, {
      category,
      multiple: clamp(fallback ? global : raw, MODEL.multiple_min, MODEL.multiple_max),
      raw_median: raw,
      samples: ratios.length,
      fallback,
    });
  }
  return { byCategory, global };
}

/** The multiple one protocol is priced with: its category's, or the global median when unseen. */
function multipleFor(
  p: SnapshotProtocol,
  table: { byCategory: Map<string, CategoryMultiple>; global: number },
): { multiple: number; samples: number; fallback: boolean } {
  const entry = table.byCategory.get(p.category ?? '(uncategorised)');
  if (entry === undefined) return { multiple: clamp(table.global, MODEL.multiple_min, MODEL.multiple_max), samples: 0, fallback: true };
  return { multiple: entry.multiple, samples: entry.samples, fallback: entry.fallback };
}

/** The model's full working for one protocol: the implied value and every multiplier behind it. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  table: { byCategory: Map<string, CategoryMultiple>; global: number },
): {
  implied: number;
  conviction: number;
  age: number | null;
  multiple: number;
  samples: number;
  fallback: boolean;
  momentumMult: number;
  maturityMult: number;
  breadthMult: number;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, samples, fallback } = multipleFor(protocol, table);
  const growthPct = clamp(finite(protocol.change_7d, 0), MODEL.momentum_floor_pct, MODEL.momentum_cap_pct);
  const momentumMult = 1 + (growthPct / 100) * MODEL.momentum_weight;
  const ageForModel = age ?? MODEL.unknown_age_days;
  const maturityMult = MODEL.maturity_base + (clamp(ageForModel, 0, MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_span;
  const breadthMult = 1 + MODEL.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), MODEL.breadth_max_extra_chains);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * momentumMult * maturityMult * breadthMult));

  // Conviction, 0-100: TVL scale (log) 40, momentum 20, maturity 20, breadth 10, evidence 10.
  const tvlPart = clamp((Math.log10(Math.max(protocol.tvl_usd, 1)) - 6) / (9.7 - 6), 0, 1) * 40;
  const momentumPart = clamp((growthPct - MODEL.momentum_floor_pct) / (MODEL.momentum_cap_pct - MODEL.momentum_floor_pct), 0, 1) * 20;
  const maturityPart = ((maturityMult - MODEL.maturity_base) / MODEL.maturity_span) * 20;
  const breadthPart = ((breadthMult - 1) / (MODEL.breadth_per_chain * MODEL.breadth_max_extra_chains)) * 10;
  const evidencePart = samples >= 3 ? 10 : samples === 2 ? 7 : samples === 1 ? 3 : 4;
  const conviction = Math.round(clamp(tvlPart + momentumPart + maturityPart + breadthPart + evidencePart, 0, 100));

  return { implied, conviction, age, multiple, samples, fallback, momentumMult, maturityMult, breadthMult };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const table = categoryMultiples(snapshot);
  const index = bySlug(snapshot.protocols);
  const onWatchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it is a row, whatever the model thinks of it.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable protocols below the watchlist floor, by TVL, capped. A watchlist
  // row is never displaced by an early one.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, v: impliedValue(p, snapshot.as_of, table) }));
  scored.sort(
    (a, b) => b.v.implied - a.v.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'records-no-token',
    watchlist: onWatchlist.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    conviction: s.v.conviction,
    model: {
      category_multiple: round4(s.v.multiple),
      multiple_samples: s.v.samples,
      multiple_fallback: s.v.fallback,
      momentum_multiplier: round4(s.v.momentumMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The second chain a protocol names, for a bridge leg, or its first. */
function secondChainOf(p: SnapshotProtocol): string {
  return p.chains.length > 1 ? p.chains[1]! : chainOf(p);
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 10_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The farm family a category belongs to: it picks the plan's core and second actions. */
function familyOf(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return 'lending';
  if (c.includes('dex') || c.includes('liquidity')) return 'dex';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('staking') || c.includes('restak')) return 'staking';
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) return 'derivatives';
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator') || c.includes('farm')) return 'yield';
  if (c.includes('stable') || c.includes('rwa')) return 'stable';
  return 'generic';
}

/** The family's core action, in words a farmer can follow, with this protocol's figures in it. */
function coreAction(p: SnapshotProtocol, family: string, capital: number): string {
  const chain = chainOf(p);
  const name = p.name;
  switch (family) {
    case 'lending':
      return `Supply $${capital} of USDC to ${name} on ${chain} as the base position and leave it earning.`;
    case 'dex':
      return `Add $${capital} of liquidity to the busiest USDC pair on ${name} (${chain}) and keep the LP position in the wallet.`;
    case 'bridge':
      return `Bridge $${capital} of USDC through ${name} to ${secondChainOf(p)} and make one transaction on the far side the same day.`;
    case 'staking':
      return `Stake $${capital} worth of the chain's staking asset through ${name} and hold the receipt token in the same wallet.`;
    case 'derivatives':
      return `Deposit $${capital} of USDC as margin on ${name} and run one small hedged position for at least a day.`;
    case 'yield':
      return `Deposit $${capital} of USDC into the highest-TVL ${name} vault on ${chain} and keep the vault shares untouched.`;
    case 'stable':
      return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the wallet.`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${chain} through its official app and leave the position open.`;
  }
}

/** The family's second action: the interaction that makes the wallet read as a real user. */
function secondAction(p: SnapshotProtocol, family: string): FarmStep {
  const name = p.name;
  switch (family) {
    case 'lending':
      return {
        text: `Borrow a small amount against the position (under 40% of its value) and repay it a week later, so the wallet shows both sides of the market.`,
        cost: 'about $3 of gas across the two transactions',
        time: '10 minutes, twice',
      };
    case 'dex':
      return {
        text: `Make two swaps through ${name}'s interface on different days, each above $25, so the wallet reads as a user and not a script.`,
        cost: 'about $3 of gas and swap fees',
        time: '10 minutes, twice',
      };
    case 'bridge':
      return {
        text: `Bridge a smaller amount ($25 or more) back through ${name} a week later, so the wallet has traffic in both directions.`,
        cost: 'about $4 of gas and bridge fees',
        time: '15 minutes',
      };
    case 'staking':
      return {
        text: `Claim or compound the staking rewards once, so the wallet has a rewards interaction on record.`,
        cost: 'about $2 of gas',
        time: '5 minutes',
      };
    case 'derivatives':
      return {
        text: `Open and close one more small position in a later week, keeping total volume modest and realistic.`,
        cost: 'about $3 of fees and gas',
        time: '15 minutes',
      };
    case 'yield':
      return {
        text: `Move about 10% of the deposit into a second ${name} vault, so the wallet uses more than one product.`,
        cost: 'about $3 of gas',
        time: '10 minutes',
      };
    case 'stable':
      return {
        text: `Use the stable asset once inside the same app (a swap or a deposit) rather than only holding it idle.`,
        cost: 'about $2 of gas',
        time: '10 minutes',
      };
    default:
      return {
        text: `Use a second feature of ${name} once (a swap, a vote or a settings change) so the wallet is more than a single deposit.`,
        cost: 'about $2 of gas',
        time: '10 minutes',
      };
  }
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list
 * of names, and the dashboard regenerates the identical plan from the same record.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const family = familyOf(p);
  return [
    {
      text: `Open a dedicated farming wallet for ${p.name} and fund it only with what this plan uses; keep the recovery phrase offline.`,
      cost: 'about $2 in gas to fund',
      time: '5 minutes',
    },
    {
      text: coreAction(p, family, capital),
      cost: `$${capital} of working capital plus roughly $${capital >= 150 ? 8 : 5} of gas`,
      time: '10-20 minutes',
    },
    secondAction(p, family),
    {
      text: `Repeat one small qualifying action every week: a top-up, a swap, a vote or a claim check, always from the same wallet.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position at least ${hold} days; points and airdrop snapshots favour wallets that stay across several weekly snapshots.`,
      cost: `the $${capital} stays deployed, with normal market risk on it`,
      time: `${hold} days`,
    },
    {
      text: `Each week, open ${p.name}'s own rewards or points page from the protocol's official site, save a screenshot of the balance, and log the wallet, dates and transaction hashes in a farm journal.`,
      cost: 'nothing; never pay a third party to claim',
      time: '10 minutes a week',
    },
  ];
}

/** The trading protocols, by market cap, for the dashboard's "already trading" view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => [p.slug, p.name, p.category, p.chains, p.tvl_usd, p.mcap_usd, p.change_7d]);
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return [
    row.rank,
    row.slug,
    row.name,
    row.category,
    row.chains,
    row.tvl_usd,
    row.change_7d,
    row.age_days,
    row.implied_value_usd,
    row.model.category_multiple,
    row.model.momentum_multiplier,
    row.model.maturity_multiplier,
    row.model.breadth_multiplier,
    row.conviction,
    row.watchlist ? 1 : 0,
  ];
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const table = categoryMultiples(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const multiples: RadarData['multiples'] = [...table.byCategory.values()]
    .sort((a, b) => b.samples - a.samples || (a.category < b.category ? -1 : 1))
    .map((m) => [m.category, round4(m.multiple), m.raw_median === null ? null : round4(m.raw_median), m.samples]);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: MODEL,
    global_multiple: round4(clamp(table.global, MODEL.multiple_min, MODEL.multiple_max)),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    multiples,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
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
    // A negative TVL cannot be real: refuse the snapshot rather than rank on it.
    if (p.tvl_usd < 0) throw new SnapshotError(`snapshot.json's protocol ${i} has a negative TVL`);
    // A negative market cap is a missing-data sentinel, not a price: the sealed snapshot
    // carries one (mcap_usd -1). Normalise it to "no market cap recorded" so no placeholder
    // leaks into the trading view or the multiples.
    const mcap =
      typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) && p.mcap_usd >= 0 ? p.mcap_usd : null;
    // A listing date that is not a calendar date would silently count as "unknown age" in
    // ageDays; refuse it instead so a malformed snapshot cannot quietly shift maturities.
    if (typeof p.listed_at === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(p.listed_at)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} has a listed_at that is not a date`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: mcap,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
