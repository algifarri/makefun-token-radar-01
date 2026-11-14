# Pre-Token Radar — token-radar-01 entry

A ranked board of the protocols in the sealed DefiLlama snapshot that **record no token**
(no market cap, no CoinGecko id, no symbol in the index), priced by the **Compass model**,
with a static dashboard and a generated farm plan for every row.

## Run it

```
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22, standard library only. Writes `board.json`, `data.js`, `dashboard/`,
`screenshots/` and `dossier.json` (via the vendored `vendor/makefun-board.ts`) to the
output directory. The program is deterministic: two runs write identical bytes.

## The Compass model

The snapshot holds two populations: protocols whose token already trades, and protocols
that record no token. The model learns from the first to price the second:

```
implied = TVL × category_multiple × momentum × maturity × breadth
```

- **category multiple** — median market-cap/TVL of the snapshot's *trading* protocols in
  the same category (samples need ≥ $1M TVL), clamped to [0.02, 3]; a category with fewer
  than two trading peers falls back to the all-category median.
- **momentum** — `1 + clamp(change_7d, −40%, +80%) × 0.35`.
- **maturity** — `0.75 + min(age_days, 1460)/1460 × 0.5`; an unknown listing date counts
  as 365 days. Longer without a token = more built = more credited.
- **breadth** — `1 + 0.03 × min(chains − 1, 6)`.

A **conviction** score (0–100) blends TVL scale (40), momentum (20), maturity (20),
breadth (10) and category evidence (10).

The snapshot parser is strict about figures that cannot be real: a negative TVL refuses
the snapshot outright, a negative market cap is read as no market cap recorded (the sealed
snapshot carries one such sentinel, `mcap_usd: -1`), and a listing date that is not a
calendar date is refused rather than silently counting as an unknown age. Before the
dossier is written, the entry point also checks its own output against the scorer's caps:
at most 4 screenshots, each a real PNG or JPEG, and the dashboard within its file-count
and byte caps.

## Board composition

- All 40 watchlist slugs (TVL ≥ $50M floor, records no token) — the floor, never a ceiling.
- Plus the 180 strongest rankable pre-token protocols below the floor, by TVL.
- Never ranked: exchanges, versioned pools of another protocol (name ends in a version
  marker), and anything whose token already trades — trading protocols are shown separately
  at the market's own values in the dashboard's Trading view.

## Farm plans

Six steps per row, each with a cost and a duration, generated from the row's own record
(category family → core position; TVL tier → capital; age tier → hold window). The plan in
`board.json` and the plan in each dashboard drawer come from the same derivation.

## Layout

- `main.ts` — entry point; `lib/model.ts` — the model, board builder and farm plans.
- `dashboard/` — static page (no framework, no network); `vendor/makefun-board.ts` — the
  kit's dossier library, vendored as the bounty requires.
- `screenshots/` — the board, a protocol detail drawer, and a filtered view.
