# Token Radar — model radar-2

A token launch radar: it reads the sealed DefiLlama snapshot at
`/input/snapshot.json`, ranks every protocol that records no token by an
implied value, and writes a dashboard a reader can use to farm each one.

## The model

`implied = round( tvl_usd × 0.30 × growth × age × breadth )`, one function
for every protocol, no name special-cased:

- **growth** = `1 + clamp(change_7d, -50, 100) / 100 × 0.6` (unknown growth: 0)
- **age** = `0.5 + min(age_days, 1460) / 1460 × 0.5`, where age is days from
  `listed_at` to the snapshot date; unknown age uses 0.75
- **breadth** = `1 + min(chains − 1, 6) × 0.02` — TVL spread over several chains

The board is all 198 protocols in the snapshot that record no token
(no market cap, no CoinGecko id, no symbol) and could plausibly issue one
of their own, including the 40-protocol watchlist. Exchanges, versioned
pools and wrapped, staked or bridged products are set aside: they are not
launches waiting to happen. Protocols whose token already trades are set
aside in a separate live view with their market cap, never a model number.

## The farm plan

Each row carries eight steps with a cost and a time, derived from the
protocol's own record — category, chains, TVL band and age. Capital is
$250 / $150 / $100 / $50 by TVL band; the hold window is 90 / 60 / 45 / 30
days by age. "Records no token" is what the snapshot says, never proof
that no token exists.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and
`dossier.json` under the output directory. Node 22 or later, standard
library only.

## Layout

- `main.ts` — entrypoint: read the snapshot, score, write outputs, dossier
- `lib/model.ts` — the radar-2 model, the board builder and the farm plans
- `vendor/makefun-board.ts` — make.fun's dossier library, as shipped
- `dashboard/` — the page: `index.html`, `app.css`, `app.js` (offline, no network)
- `screenshots/` — the board, a detail view and a filtered view
