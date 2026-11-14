# Launch Radar — a token launch radar for token-radar-01

A Node 22 program (standard library only) that reads the sealed DefiLlama snapshot and hands in
a dashboard: every protocol that records no token yet, separated into launch candidates, products
of tokens that already trade, and the live tokens themselves — the candidates ranked by an
implied launch value with a concrete farm plan for each.

## What it does

- **Ranks 198 launch candidates** by implied value. The candidate rule is the snapshot watchlist's
  own rule applied at every size, not only above its $50M floor: a protocol must record no token
  (no market cap, no CoinGecko id, no symbol) and must not be a wrapped, staked or bridged product
  of a token that already trades. All 40 watchlist protocols are covered; there is no cap.
- **Sets 144 products aside** (bridges, liquid staking, wrapped/staked names, exchange products,
  versioned pools), each named with the rule that set it aside, and shows **30 live tokens** at the
  market's own values. Neither group is ever ranked as a launch.
- **The value model** — every figure from the snapshot itself, no name ever special-cased:

      implied = TVL x category multiple x momentum x seasoning x breadth

  The category multiple is the median market-cap/TVL of the category's tokenised protocols *in the
  same snapshot*, shrunk toward the global median (x0.169) by peer count, pulled further toward it
  for categories with fewer than three peers, and clamped to 0.02–2.00. Momentum reads the 7-day
  TVL change (capped −50%/+100%); seasoning reads the days tracked with no token (up to x1.20 at
  four years; unknown listing dates borrow the pre-token median age, 513 days); breadth adds 3%
  per extra chain to x1.21. Every factor of every row is in `board.json` and recomputed live on
  the detail page, so a reader can check any row against the snapshot's figures.
- **Farm plans** are generated per protocol from its own record: the category picks the core
  action, the first chain prices the gas (Ethereum mainnet $6–12 an action, L2s $0.10–1, Solana
  under $0.05), TVL sizes the working capital ($50–$250), and age sets the hold (30–45 days).
  Seven steps each, every step with its cost and time, and plan totals on the detail view.
- **The dashboard** (`dashboard/`, no network, no framework) shows the ranked board with sortable
  columns and search/category/chain/tier filters, a detail view per protocol (the record, the
  model's arithmetic factor by factor, the full farm plan), and the products and live tokens on
  their own tabs. Its whole source is 29,557 bytes, inside the dossier's 64 KB text cap.

## Layout

    main.ts                 the program: snapshot in, board.json + data.js + dashboard + dossier out
    lib/model.ts            snapshot parsing, category multiples, the value model, product rule
    lib/farm.ts             per-protocol farm plans and plan totals
    lib/board.ts            board assembly, set-aside products, live set, gate checks restated
    dashboard/              index.html, app.css, app.js — the page the judge reads
    screenshots/            1-board.png, 2-detail.png, 3-filtered.png (1440x900, rendered from
                            this dashboard in headless Chromium)
    vendor/makefun-board.ts the kit's dossier library, byte for byte (sha256 9ca51b6e…f77b0)
    tools/selftest.mjs      local gate checks + a determinism double-run

## Run it

    mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to>/snapshot.json
    node tools/selftest.mjs out --input <path-to>/snapshot.json

`MAKEFUN_DATA_ONLY=1` stops after `board.json`, `data.js` and the dashboard copy — the pass used
to render the screenshots the full run then ships. The program is deterministic: two runs write
identical bytes (verified by the self-test).

## Verification (this snapshot, as_of 2026-11-14)

    launch radar: 758 protocols scanned, 40 on the watchlist, 198 launch candidates ranked, 144 products set aside, 30 live tokens shown apart
    launch radar: wrote board.json (198 rows), data.js, dashboard/ (3 files), screenshots/ (3 images) and dossier.json (813075 bytes) under out

Self-test: **24/24 checks pass** — row count, unique snapshot slugs, watchlist coverage 40/40,
ranks exactly 1..N, implied values positive, sorted and never all equal, farm steps 3..12 strings
of 20..600 trimmed characters, dashboard within its file/byte caps and under the 64 KB dossier
text cap, no network address in any attribute/import/CSS, screenshots whole PNGs at 1440x900
within 512 KiB, dossier 813,075 bytes (at most 1.5 MiB) and byte-identical to a fresh
`buildDossier(output, {text_max_bytes: 65536})` rebuild, and two runs byte-identical.

Top of the board it produces:

    #1 Steakhouse Financial (Risk Curators)  TVL $2.75B  x0.436 (1 peer)  -> $1.32B implied
    #2 Sentora Curator (Risk Curators)       TVL $2.76B  x0.436 (1 peer)  -> $1.16B implied
    #3 Gauntlet (Risk Curators)              TVL $1.58B  x0.436 (1 peer)  -> $785M implied
    #4 Polymarket International (Prediction Market) TVL $320M x1.390 (1 peer) -> $531M implied
    #5 Veda (Onchain Capital Allocator)      TVL $1.56B  x0.115 (3 peers) -> $196M implied

Implied values are this entry's own model claims, derived only from the snapshot's figures; they
are not predictions that a token will be issued. A protocol here *records* no token — a statement
about DefiLlama's record, not proof that none exists.

## License

MIT — see `LICENSE` (SPDX-License-Identifier: MIT).
