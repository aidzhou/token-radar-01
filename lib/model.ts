// Token Radar's model, version radar-2: one sealed snapshot in, one ranked board out.
//
// The board ranks the snapshot's pre-token protocols that could plausibly
// issue a token of their own — 198 of the 758 protocols here. A protocol
// ranks when it records no token at all (no market cap, no CoinGecko id, no
// symbol) and is not a wrapped, staked or bridged product of a token that
// already trades, not a centralised exchange, and not a versioned pool of
// another protocol: those are not launches waiting to happen, and ranking
// them at the top on TVL alone would put exchanges above real candidates.
// Protocols whose token already trades are never ranked either; they are set
// aside in a separate live view with the market cap the snapshot records,
// never a model number. The watchlist (40 protocols) is a floor inside the
// board, never its boundary: every watchlist slug is ranked, and so is every
// other rankable protocol below the floor.
//
// Implied value is one function of the snapshot's own figures, the same for
// every protocol, no name ever special-cased:
//
//   base     = tvl_usd x 0.30
//   growth   = clamp(change_7d, -50, 100) per cent; unknown growth counts as 0
//   growthM  = 1 + (growth / 100) x 0.6
//   ageM     = 0.5 + min(age_days, 1460) / 1460 x 0.5   (unknown age: 0.75 flat)
//   breadthM = 1 + min(chains - 1, 6) x 0.02           (multi-chain stickiness)
//   implied  = max(1, round(base x growthM x ageM x breadthM))
//
// Age is days from listed_at to the snapshot's as_of date: how long the
// protocol has run with no token on record. A protocol listed yesterday has
// barely been tested; one that ran four years without issuing a token has a
// long record to price. Breadth rewards protocols whose TVL sits on several
// chains, where one chain's outage cannot take the whole record away.

/** One protocol entry: exactly the ten fields the sealed snapshot carries. */
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

/** The whole sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, printed on the dashboard so a reader can re-run it. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  age_floor: number;
  age_range: number;
  age_cap_days: number;
  unknown_age_multiplier: number;
  breadth_step: number;
  breadth_cap: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  age_floor: 0.5,
  age_range: 0.5,
  age_cap_days: 1460,
  unknown_age_multiplier: 0.75,
  breadth_step: 0.02,
  breadth_cap: 6,
};

/** The model version the dashboard names. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's separate live view carries. */
export const LIVE_ROWS = 24;

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
    breadth_multiplier: number;
  };
  farm_steps: string[];
}

/** A live-token protocol, shown with its market value, never a model value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs to render, written to data.js. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

/** Why a snapshot file is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Whole days from `listedAt` to `asOf`, at least zero; null when the date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol's implied value and the four factors that produced it. */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  model: ModelConstants = MODEL,
): { implied: number; base: number; growthPct: number; growthMult: number; ageMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finiteNumber(p.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageMult =
    age === null
      ? model.unknown_age_multiplier
      : model.age_floor + (Math.min(Math.max(age, 0), model.age_cap_days) / model.age_cap_days) * model.age_range;
  const breadthMult = 1 + Math.min(Math.max(p.chains.length - 1, 0), model.breadth_cap) * model.breadth_step;
  const base = p.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * ageMult * breadthMult));
  return { implied, base: Math.round(base), growthPct, growthMult, ageMult, breadthMult, age };
}

/** A protocol records no token at all in the snapshot. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A name ending in a version marker is a pool of another protocol, not a launch. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories that are wrapped, staked or bridged products of a token that trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
/** Exchange names a protocol may not start with: a product of that exchange. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
/** A whole word in a name that marks a wrapped or staked product. */
const WRAPPED_WORD = /\bwrapped\b|\bstaked\b|\bstaking\b/i;

/**
 * Whether a protocol could plausibly issue a token of its own: pre-token, not
 * a centralised exchange, not a versioned pool, and not a wrapped, staked or
 * bridged product. The snapshot carries no parentProtocol field, so the
 * parent check the watchlist rule uses cannot be repeated here; the name,
 * category and exchange checks are the ones the snapshot's own fields allow.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category === 'CEX') return false;
  if (VERSIONED.test(p.name)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** The board: every rankable pre-token protocol, strongest implied value first, ranks 1..N. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, model) }));
  scored.sort(
    (a, b) =>
      b.s.implied - a.s.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    token_status: 'pre-token' as const,
    watchlist: watch.has(p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_usd: s.base,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      age_multiplier: round4(s.ageMult),
      breadth_multiplier: round4(s.breadthMult),
    },
    farm_steps: farmPlan(p, s.age),
  }));
}

/** The live-token protocols by market cap, for the dashboard's separate view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

// ---------------------------------------------------------------- farm plans

/** The first chain a protocol names, or a neutral phrase when it names none. */
function primaryChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A second chain for a cross-chain step, or null when the protocol runs on one chain. */
function secondChain(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** How much capital one farm position takes, from the protocol's own TVL band. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** How long to hold the position, from the protocol's age: younger records need a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 30;
}

/** The category's core farming action, in the words a farmer can follow. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $20 of a stable asset against it and repay the borrow within a week.`;
  }
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain}, then swap $10 through the pool so the position shows both actions.`;
  }
  if (c.includes('yield') || c.includes('aggregator') || c.includes('vault')) {
    return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the vault shares in the same wallet.`;
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return `Bridge $${capital} of USDC into ${chain} through ${name}, then use at least half of it inside an app on ${chain} the same day.`;
  }
  if (c.includes('stak') || c.includes('restak')) {
    return `Stake $${capital} of the chain's native asset through ${name} on ${chain} and keep the staking receipt token in the same wallet.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small long position of about $25 notional.`;
  }
  if (c.includes('prediction')) {
    return `Fund ${name} with $${capital} on ${chain} and place one $10 position on a market that settles within the week.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset ${name} issues on ${chain} and keep it in the farming wallet.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} for a position you already hold, and keep the policy active.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('manager')) {
    return `Allocate $${capital} to a ${name} vault on ${chain} and keep the vault shares in the farming wallet.`;
  }
  if (c.includes('launchpad')) {
    return `Deposit $${capital} of USDC into ${name}'s staking or allocation pool on ${chain} and join one sale it lists.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open in the farming wallet.`;
}

/** A step string: its action, then its cost and time, inside the gate's 20..600 characters. */
function step(action: string, cost: string, time: string): string {
  let s = `${action} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time.
 * Every figure comes from the protocol's own record — its category, its chains,
 * its TVL band and its age — never from a hand-written list of names.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): string[] {
  const chain = primaryChain(p);
  const other = secondChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? '$8' : '$4';
  const steps: string[] = [
    step(
      `Open a fresh wallet for this farm only, fund it with $${capital + 20} on ${chain}, and keep its seed phrase offline on paper.`,
      `about ${gas} of gas for the first transaction`,
      '10 minutes',
    ),
    step(coreAction(p, capital, chain), `$${capital} of capital and about ${gas} of gas`, '20 minutes to set up'),
    step(
      other === null
        ? `Do a second, different action on ${nameSafe(p)} on ${chain}: a swap, a deposit or a vote, so the wallet shows more than one touch.`
        : `Repeat the core position on ${other} with $25 of the same wallet's funds, so the farm spans two chains and two snapshots.`,
      'about $25 of capital and $3 of gas',
      '15 minutes',
    ),
    step(
      `Do one qualifying action every week on ${nameSafe(p)} — a deposit, a swap, a borrow or a vote — and leave the position open between them.`,
      'about $2 of gas a week',
      '10 minutes a week',
    ),
    step(
      `Hold the position for at least ${hold} days so the activity lands in more than one snapshot window the protocol may take.`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ),
    step(
      `Check ${nameSafe(p)}'s own points or rewards page once a week, using only the link the protocol itself publishes, and note the balance in your log.`,
      'no fee to check',
      '5 minutes a week',
    ),
    step(
      `If ${nameSafe(p)} opens a vote or a community quest, take part once with the farming wallet and keep the receipt or the confirmation.`,
      'about $1 of gas if a vote is on chain',
      '10 minutes',
    ),
    step(
      `Write the wallet, the dates and every transaction hash in a farm log, and unwind in reverse order: claim first, then withdraw, never paying anyone to claim for you.`,
      'nothing but the log',
      '10 minutes',
    ),
  ];
  return steps;
}

function nameSafe(p: SnapshotProtocol): string {
  return p.name;
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
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
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
