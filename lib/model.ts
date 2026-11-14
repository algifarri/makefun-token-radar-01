// Compass model (compass-1) — the value model behind the Pre-Token Radar.
//
// Idea: a protocol that records no token yet is worth, in expectation, what a
// token of its size usually trades for. The snapshot itself supplies the
// comparison set: for every category, the median market-cap/TVL ratio of the
// protocols in that category whose token already trades. That median is the
// category multiple; a protocol's implied value is its TVL times that
// multiple, adjusted for how fast it is growing, how long it has run, and how
// many chains it spans. No protocol name is special-cased anywhere: the same
// arithmetic runs over every record in the snapshot.
//
//   implied = TVL x category multiple x momentum x maturity x breadth
//
//   category multiple = median(mcap / TVL) over the snapshot's own trading
//     protocols in the same category, samples restricted to TVL >= $1,000,000,
//     clamped to [0.02, 3]. The median is the upper median: for a sorted
//     sample of n values it is sample[floor(n / 2)]. A category with fewer
//     than 2 trading peers falls back to the global multiple, which is the
//     median of the per-category medians across all categories that have at
//     least one trading sample.
//   momentum = 1 + clamp(change_7d, -40, 80) / 100 x 0.35
//     (change_7d null counts as 0: no reported growth, no adjustment).
//   maturity = 0.75 + min(age_days, 1460) / 1460 x 0.5
//     (age_days counts from listed_at to the snapshot's as_of date; a
//     protocol with no listed date is counted as 365 days old).
//   breadth = 1 + 0.03 x min(chains - 1, 6)
//
// Conviction (0-100) scores how much the snapshot's own figures support the
// implied value, split across five legs:
//   TVL 40    — log scale: 40 x clamp((log10(TVL) - log10(5M)) /
//               (log10(3B) - log10(5M)), 0, 1). The snapshot's floor is $5M,
//               so the smallest record scores 0 and anything near $3B scores
//               the full 40.
//   momentum 20 — 20 x (clamp(change_7d, -40, 80) + 40) / 120, so -40% scores
//               0, 0% scores 6.7 and +80% scores the full 20.
//   maturity 20 — 20 x min(age_days, 1460) / 1460, so a four-year record
//               scores the full 20 and a fresh listing near 0.
//   breadth 10  — 10 x min(chains - 1, 6) / 6, one point per extra chain up
//               to six.
//   evidence 10 — how many trading peers the category multiple rests on:
//               10+ peers -> 10, 5-9 -> 8, 3-4 -> 6, exactly 2 -> 4, and
//               fewer than 2 (the global fallback) -> 2. A multiple borrowed
//               from the whole market earns less trust than one the category
//               itself supplies.
// The five legs are summed and rounded to the nearest whole number.

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

export interface SnapshotDoc {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface CategoryMultiple {
  category: string;
  multiple: number;
  samples: number;
}

export interface ModelFactors {
  ageDays: number;
  momentum: number;
  maturity: number;
  breadth: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  multiple: number;
  momentum: number;
  maturity: number;
  breadth: number;
  conviction: number;
  implied_value_usd: number;
  farm_steps: string[];
  rank: number;
  is_watchlist: boolean;
  origin: "watchlist" | "early";
}

export interface TradingRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  mcap_tvl_ratio: number;
}

export interface BoardResult {
  rows: BoardRow[];
  trading: TradingRow[];
  multiples: CategoryMultiple[];
  globalMultiple: number;
  meta: {
    model: string;
    as_of: string;
    source: string;
    floor_usd: number;
    total_rows: number;
    watchlist_rows: number;
    early_rows: number;
    trading_rows: number;
    total_implied_usd: number;
  };
}

export const MODEL_ID = "compass-1";
export const BOARD_SIZE = 220;
export const EARLY_SIZE = 180;
export const TRADING_SIZE = 24;
export const MIN_SAMPLE_TVL = 1_000_000;
export const MULTIPLE_MIN = 0.02;
export const MULTIPLE_MAX = 3;

const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Upper median: sorted[floor(n / 2)], the middle value for odd n and the
 *  upper of the two middle values for even n. */
export function upperMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** True when the snapshot records no token for the protocol at all. */
export function isRecordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** True when the protocol can be ranked: it records no token, it is not a
 *  centralised exchange, and its name does not end in a version marker such
 *  as "V2" or "1.2". */
export function isRankable(p: SnapshotProtocol): boolean {
  return isRecordsNoToken(p) && p.category !== "CEX" && !VERSION_SUFFIX.test(p.name);
}

/** Whole days from listed_at to the snapshot's as_of date; unknown listing
 *  dates count as 365 days, and a listing after as_of counts as 0. */
export function ageDays(p: SnapshotProtocol, asOf: Date): number {
  if (!p.listed_at) return 365;
  const listed = new Date(p.listed_at + "T00:00:00Z");
  const days = Math.floor((asOf.getTime() - listed.getTime()) / 86_400_000);
  return Math.max(0, days);
}

export function modelFactors(p: SnapshotProtocol, asOf: Date): ModelFactors {
  const age = ageDays(p, asOf);
  const change = p.change_7d === null ? 0 : p.change_7d;
  return {
    ageDays: age,
    momentum: 1 + (clamp(change, -40, 80) / 100) * 0.35,
    maturity: 0.75 + (Math.min(age, 1460) / 1460) * 0.5,
    breadth: 1 + 0.03 * Math.min(p.chains.length - 1, 6),
  };
}

/** Category multiples from the snapshot's own trading protocols, plus the
 *  global fallback (median of the per-category medians). */
export function computeMultiples(protocols: SnapshotProtocol[]): {
  byCategory: Map<string, { multiple: number; samples: number }>;
  globalMultiple: number;
} {
  const ratiosByCategory = new Map<string, number[]>();
  for (const p of protocols) {
    if (p.mcap_usd === null || p.tvl_usd < MIN_SAMPLE_TVL) continue;
    const key = p.category ?? "(none)";
    const list = ratiosByCategory.get(key) ?? [];
    list.push(p.mcap_usd / p.tvl_usd);
    ratiosByCategory.set(key, list);
  }
  const byCategory = new Map<string, { multiple: number; samples: number }>();
  const medians: number[] = [];
  for (const [category, ratios] of [...ratiosByCategory.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : 1,
  )) {
    const median = upperMedian(ratios);
    byCategory.set(category, { multiple: clamp(median, MULTIPLE_MIN, MULTIPLE_MAX), samples: ratios.length });
    medians.push(median);
  }
  const globalMultiple = clamp(upperMedian(medians), MULTIPLE_MIN, MULTIPLE_MAX);
  return { byCategory, globalMultiple };
}

export function multipleFor(
  p: SnapshotProtocol,
  multiples: { byCategory: Map<string, { multiple: number; samples: number }>; globalMultiple: number },
): { multiple: number; samples: number; fallback: boolean } {
  const entry = multiples.byCategory.get(p.category ?? "(none)");
  if (entry && entry.samples >= 2) return { multiple: entry.multiple, samples: entry.samples, fallback: false };
  return { multiple: multiples.globalMultiple, samples: entry ? entry.samples : 0, fallback: true };
}

/** The conviction score, 0-100, from the five documented legs. */
export function convictionScore(
  p: SnapshotProtocol,
  factors: ModelFactors,
  samples: number,
): number {
  const tvlLeg = 40 * clamp((Math.log10(p.tvl_usd) - Math.log10(5_000_000)) / (Math.log10(3_000_000_000) - Math.log10(5_000_000)), 0, 1);
  const change = p.change_7d === null ? 0 : p.change_7d;
  const momentumLeg = 20 * ((clamp(change, -40, 80) + 40) / 120);
  const maturityLeg = 20 * (Math.min(factors.ageDays, 1460) / 1460);
  const breadthLeg = 10 * (Math.min(p.chains.length - 1, 6) / 6);
  const evidenceLeg = samples >= 10 ? 10 : samples >= 5 ? 8 : samples >= 3 ? 6 : samples >= 2 ? 4 : 2;
  return Math.round(clamp(tvlLeg + momentumLeg + maturityLeg + breadthLeg + evidenceLeg, 0, 100));
}

// --- Farm plans -----------------------------------------------------------
// Every plan is derived from the row's own record, in six steps: verify the
// protocol, take the core position for its category family, widen it, track
// it, hold it for the age tier's window, and close it safely. The capital
// tier follows TVL ($50 under $50M, $75 to $100M, $100 to $500M, $150 to
// $1B, $250 above it) and the hold window follows age (30 days under a year,
// 45 days to two years, 60 days above that). The dashboard's drawer runs
// the same derivation from the same fields, so what the drawer shows and
// what board.json carries always agree.

export function capitalTier(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 250;
  if (tvlUsd >= 500_000_000) return 150;
  if (tvlUsd >= 100_000_000) return 100;
  if (tvlUsd >= 50_000_000) return 75;
  return 50;
}

export function holdTier(ageDays: number): number {
  if (ageDays >= 730) return 60;
  if (ageDays >= 365) return 45;
  return 30;
}

/** The core action for a category family: what "farming" this protocol
 *  actually means in practice. Unknown categories fall back to using the
 *  protocol's main product with a small first position. */
export function familyAction(category: string | null): string {
  switch (category) {
    case "Lending":
    case "CDP":
    case "Collateral Management":
      return "supply a major asset to its lending market and borrow a small amount against it";
    case "Dexs":
    case "Liquidity Manager":
      return "swap a small amount through its pools and add liquidity to the deepest core pair";
    case "Yield":
    case "Yield Aggregator":
    case "Farm":
    case "Leveraged Farming":
      return "deposit into its yield vault or farm and let the position compound";
    case "Bridge":
    case "Cross Chain Bridge":
    case "Canonical Bridge":
      return "bridge a small amount between chains through its own bridge";
    case "Liquid Staking":
    case "Liquid Restaking":
    case "Restaking":
    case "Restaked BTC":
      return "stake assets through it and hold the liquid receipt token";
    case "Derivatives":
    case "Options":
    case "Basis Trading":
    case "Prediction Market":
    case "DOR":
      return "open a small, defined-risk trading position and cap the downside before entering";
    case "RWA":
    case "Indexes":
    case "Onchain Capital Allocator":
      return "buy a small allocation of its tokenised product";
    case "Risk Curators":
    case "Governance Incentives":
      return "deposit into its curated vault and vote on the proposals that steer it";
    default:
      return "use its main product with a small first position and learn its flows";
  }
}

export function farmStepsFor(row: {
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  age_days: number;
}): string[] {
  const capital = capitalTier(row.tvl_usd);
  const hold = holdTier(row.age_days);
  const action = familyAction(row.category);
  const firstChain = row.chains[0] ?? "its home chain";
  const secondChain = row.chains.length > 1 ? row.chains[1] : null;
  const categoryLabel = row.category ?? "uncategorised";
  const widen = secondChain
    ? `Repeat the same position on ${secondChain} with about $${Math.round(capital / 2)} so your activity shows on two chains, and compare the gas cost per step before adding more.`
    : `After a week, add a second, smaller deposit of about $${Math.round(capital / 2)} from the reserve you kept back, so the position grows in two on-chain touches instead of one.`;
  return [
    `Open ${row.name} on ${firstChain} and confirm it is the real protocol: match its name and ${categoryLabel} category against the DefiLlama record before you connect a wallet or move any funds.`,
    `Start with about $${capital} in total and ${action} on ${firstChain}; keep roughly a third of the budget aside for gas and a follow-up deposit instead of committing it all at once.`,
    widen,
    `Check the position once a week and write down every deposit, reward and point balance in a simple log, so you can prove the activity later if the protocol asks for it.`,
    `Hold the position for at least ${hold} days and only exit early if the protocol pauses, the TVL drops sharply for two weeks running, or a token launch is announced with a snapshot you have already passed.`,
    `Stay safe: never share a seed phrase, revoke token approvals you no longer use, and only trust a token launch announced on ${row.name}'s own channels — a fake airdrop link costs more than the position is worth.`,
  ];
}

export function buildBoard(snapshot: SnapshotDoc): BoardResult {
  const asOf = new Date(snapshot.as_of + "T00:00:00Z");
  const multiples = computeMultiples(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);

  const rankable = snapshot.protocols.filter(isRankable);
  const watchRows = rankable.filter((p) => watchlist.has(p.slug));
  const earlyPool = rankable
    .filter((p) => !watchlist.has(p.slug) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, EARLY_SIZE);

  const picked = [...watchRows, ...earlyPool];
  const rows: BoardRow[] = picked.map((p) => {
    const factors = modelFactors(p, asOf);
    const { multiple, samples } = multipleFor(p, multiples);
    const implied = Math.max(1, Math.round(p.tvl_usd * multiple * factors.momentum * factors.maturity * factors.breadth));
    const base = { name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, age_days: factors.ageDays };
    return {
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: factors.ageDays,
      multiple,
      momentum: factors.momentum,
      maturity: factors.maturity,
      breadth: factors.breadth,
      conviction: convictionScore(p, factors, samples),
      implied_value_usd: implied,
      farm_steps: farmStepsFor(base),
      rank: 0,
      is_watchlist: watchlist.has(p.slug),
      origin: (watchlist.has(p.slug) ? "watchlist" : "early") as "watchlist" | "early",
    };
  });
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  const trading: TradingRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.category !== "CEX")
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number) || (a.slug < b.slug ? -1 : 1))
    .slice(0, TRADING_SIZE)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      mcap_tvl_ratio: (p.mcap_usd as number) / p.tvl_usd,
    }));

  const multiplesList: CategoryMultiple[] = [...multiples.byCategory.entries()]
    .map(([category, v]) => ({ category, multiple: v.multiple, samples: v.samples }))
    .sort((a, b) => (a.category < b.category ? -1 : 1));

  return {
    rows,
    trading,
    multiples: multiplesList,
    globalMultiple: multiples.globalMultiple,
    meta: {
      model: MODEL_ID,
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      total_rows: rows.length,
      watchlist_rows: rows.filter((r) => r.is_watchlist).length,
      early_rows: rows.filter((r) => !r.is_watchlist).length,
      trading_rows: trading.length,
      total_implied_usd: rows.reduce((sum, r) => sum + r.implied_value_usd, 0),
    },
  };
}
