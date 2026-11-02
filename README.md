# Amazon India Laptop Comparison

A Playwright + TypeScript tool that reads a list of Amazon India laptop product URLs, extracts hardware and pricing information, normalizes it, and generates a comparable report in CSV, JSON, and a self-contained HTML dashboard.

The report keeps listing claims separate from manufacturer-verified specifications and never invents missing VRAM, wattage, or conditional prices.

## Requirements

- Node.js **20.12 or newer** (uses `process.loadEnvFile`)
- npm
- Internet access to Amazon India
- Chromium installed through Playwright
- A desktop/display session for the default headed browser (use `--headless` on servers)

## Quick start

```bash
npm install
npx playwright install chromium
npm run compare
```

`npm run compare` opens a visible Chromium window by default. Use `npm run compare -- --headless` for unattended runs.

Open:

```text
output/latest.html
```

The repository includes one sample product URL in `data/laptop-links.txt` so the first run has something to process.

## Add or remove products

Edit `data/laptop-links.txt`:

```text
# Gaming laptops
https://www.amazon.in/dp/PRODUCT_ID_1
https://www.amazon.in/dp/PRODUCT_ID_2
```

Rules:

- One Amazon India product URL per line.
- Blank lines are ignored.
- Lines beginning with `#` are ignored.
- Tracking parameters are removed.
- Duplicate ASINs are collapsed to one product.
- Only `amazon.in` / `www.amazon.in` product URLs are supported.
- Product URLs are canonicalized to `https://www.amazon.in/dp/ASIN` where an ASIN can be found.

## Outputs

Each run writes:

```text
output/latest.html
output/latest.json
output/latest.csv
output/laptops-<timestamp>.html
output/laptops-<timestamp>.json
output/laptops-<timestamp>.csv
```

While a run is in progress, a checkpoint is written to `output/partial.json`. Failed or blocked products do not prevent successful results from being written.

The HTML dashboard is self-contained and does not load external CDNs or frameworks.

### Dashboard

The dashboard uses a dark, table-first layout:

- Search plus GPU, RAM, stock, and sort controls
- Laptop rows with the product hero image, GPU, VRAM, TGP, CPU, RAM, storage, display, price, discount, and stock
- The **Price** cell shows the actual listed price first, then the full-payment effective price with eligible offers applied, then the best EMI price in smaller type before fees
- **Effective price** is the best full-payment price; if no full-payment offer is available it falls back to the listed price
- **EMI\*** is shown below the effective price, before processing fees/interest, and is never treated as the overall lowest price
- Lowest effective price is highlighted green in the current view
- Click a row to open a right-side detail panel with the hero image, full price breakdown, offers, component offers, specifications, verification states, sources, warnings, and missing fields
- Export CSV and JSON buttons in the header
- Responsive: the detail panel becomes a full-height drawer on smaller screens

### JSON

The JSON report contains:

- Run metadata and sanitized configuration
- Input parsing summary, duplicates, invalid lines, and truncation
- One record per processed product
- Extracted specifications with value, unit, source URL/type, verification status, qualification, and raw text
- Price breakdown and all detected offers
- Extraction status, errors, warnings, and missing fields
- Source list for externally verified information

### CSV

One row per product with normalized comparison columns, including:

- Product, ASIN, canonical URL, hero image URL
- GPU model/type, VRAM, base TGP, maximum graphics power, Dynamic Boost
- CPU model, base TDP, maximum turbo power, configurable TDP
- RAM capacity/type/speed/upgradeability
- Storage, display, and weight
- Listed price, MRP, coupons, bank offers, other offers
- Price without conditional offers, best effective price
- Full-payment conditional price and separate EMI conditional price (before fees)
- Offer eligibility, calculation notes, price timestamp
- Extraction status, missing fields, warnings, errors

Missing values use `unknown`; non-applicable values use `not_applicable`.

## Specification verification

Every important specification carries:

- **Value**
- **Unit**
- **Source** (`amazon_structured_data`, `amazon_technical_specs`, `amazon_listing_text`, `amazon_title`, or `manufacturer_official`)
- **Verification status**
  - `verified` — cross-checked against a cited manufacturer source
  - `unverified` — extracted from the Amazon listing only
  - `unknown` — not found
  - `not_applicable` — the field does not apply, such as dedicated VRAM on an integrated GPU

### GPU rules

- VRAM is extracted only from explicit graphics-memory text or a capacity stated directly in the GPU description. It is not inferred from the GPU model name.
- Base TGP, maximum graphics power, and Dynamic Boost are separate fields.
- `115W + 25W Dynamic Boost` is recorded as 115 W base TGP, 25 W Dynamic Boost, and a derived 140 W maximum, with a qualification.
- `140W including Dynamic Boost` records 140 W maximum graphics power and leaves base TGP unknown.
- GPU TGP is never treated as total laptop power consumption.

### CPU rules

- `TDP`, `Processor Base Power`, `Maximum Turbo Power`, and `Configurable TDP` are kept distinct.
- A bare wattage in a title is not treated as CPU TDP.
- A configurable range such as `35–54 W` is stored as a range, not converted into a fictional fixed base TDP.

### Memory rules

- RAM capacity/type are parsed from RAM-specific fields or bullets, not from storage capacity.
- `512GB SSD` is never treated as RAM.
- Upgradeability is only marked `yes`/`no` when the listing explicitly mentions upgradeability, a memory slot, soldered/onboard memory, or a maximum memory capacity. Otherwise it is `unknown`.

## Price semantics

The report distinguishes:

1. **Listed price** — the current selling/deal price before additional conditional offers.
2. **Price without conditional offers** — listed price minus only unconditional, explicitly stackable instant reductions.
3. **Best effective price** — lowest reliably calculable price without assuming eligibility, stacking, exchange, EMI, or cashback. It normally equals the listed price.
4. **Full-payment conditional price** — lowest reliably calculable price after **one** full-payment (non-EMI) eligibility-dependent offer group, such as a bank-card offer stack, coupon clip, or membership.
5. **EMI conditional price** — a separate EMI-only calculation, shown **before processing fees/interest**. It is never used as the overall lowest or best price because EMI fees and eligibility can erase the discount.

Additional rules:

- Cashback and rewards are recorded separately and are **never subtracted** from the listed price.
- Exchange offers are not subtracted because the old-device valuation is unknown.
- No-cost EMI is a payment option, not a price reduction.
- Coupon and full-payment bank offers are conditional; EMI offers are shown as a separate smaller line under the effective price.
- Amazon’s full bank offer sheet is read from the page. Offers explicitly labelled **Additional** under the same bank, card type, and payment mode are aggregated; the base offer is chosen separately and additional offers are summed. For the sample listing, HDFC Credit Card is ₹6,050 on non-EMI (Buy for ₹96,940) and ₹7,750 on 9+ month EMI (₹95,240 before fees).
- Different banks, cashback, exchange, coupons, and separate offer groups are never stacked with each other.
- Percentage discounts without a stated cap are marked unknown instead of guessed.
- “Up to ₹X” bank/exchange offers are recorded with a cap; only explicit flat/percentage+cap components enter a calculated bank stack.
- Every calculation has a note explaining what was and was not applied.

## Manufacturer specification overrides

Amazon listings are often incomplete. `data/manufacturer-specs.json` lets you add curated, cited manufacturer specifications keyed by ASIN. Each entry must include a source URL, and values are marked `verified` only when `verified` is `true`.

Example:

```json
{
  "version": 1,
  "entries": [
    {
      "asin": "B0HJGRVBFF",
      "verified": true,
      "source": {
        "type": "manufacturer_official",
        "url": "https://psref.lenovo.com/Product/LOQ/LOQ_15ARP10E",
        "retrievedAt": "2026-11-02T00:00:00.000Z"
      },
      "specs": {
        "brand": "Lenovo",
        "gpu": {
          "source": {
            "type": "manufacturer_official",
            "url": "https://psref.lenovo.com/Product/LOQ/LOQ_15ARP10E",
            "retrievedAt": "2026-11-02T00:00:00.000Z"
          },
          "model": "NVIDIA GeForce RTX 3050 Laptop GPU",
          "type": "discrete",
          "vramGb": 6,
          "baseTgpW": 65,
          "maxGraphicsPowerW": null,
          "dynamicBoostW": null,
          "qualification": "Lenovo PSREF lists RTX 3050 6GB GDDR6 with TGP 65W for this configuration."
        },
        "cpu": {
          "source": {
            "type": "manufacturer_official",
            "url": "https://www.amd.com/en/products/processors/laptop/ryzen/7000-series/amd-ryzen-5-7535hs.html",
            "retrievedAt": "2026-11-02T00:00:00.000Z"
          },
          "model": "AMD Ryzen 5 7535HS",
          "configurableTdpW": { "min": 35, "max": 54 },
          "qualification": "AMD lists Default TDP and Configurable TDP (cTDP) as 35-54W; this is a range, not a fixed base TDP."
        },
        "memory": {
          "installedGb": 16,
          "type": "DDR5",
          "speedMhz": 4800,
          "upgradeability": "yes",
          "notes": "SODIMM slot indicated by Lenovo PSREF; verify the exact retail SKU."
        }
      }
    }
  ]
}
```

Behavior:

- Exact ASIN match is preferred.
- An optional `modelPattern` regex can match title/model when ASIN is not present.
- If the manufacturer value agrees with Amazon, the field is marked `verified`.
- If values conflict, the manufacturer value is used, the Amazon claim is preserved in `candidates`, and a `manufacturer_conflict` warning is recorded.
- Entries without a source URL are skipped.

The tool deliberately does **not** run web searches or automatically scrape arbitrary manufacturer sites. That would be unreliable and could fabricate or misattribute specifications. The provider interface is isolated, so another source can be added later.

> The included sample manufacturer entry documents the sample ASIN. Amazon configurations can change; update or remove the entry if the exact SKU differs.

## Configuration

Copy the example file:

```bash
cp .env.example .env
```

| Variable | Default | Description |
| --- | --- | --- |
| `HEADLESS` | `false` | Open a visible Chromium window; set `true` for unattended runs |
| `BROWSER_CHANNEL` | empty | Set to `chrome` to use installed Google Chrome |
| `SLOW_MO_MS` | `0` | Playwright slow motion delay |
| `BLOCK_IMAGES` | `false` | Block image/font/media requests |
| `LINKS_FILE` | `data/laptop-links.txt` | Input URL file |
| `OUTPUT_DIR` | `output` | Report directory |
| `MANUFACTURER_SPECS_FILE` | `data/manufacturer-specs.json` | Curated overrides |
| `MAX_PRODUCTS` | `30` | Maximum unique products per run |
| `CONCURRENCY` | `1` | Worker pages; allowed range 1–3 |
| `MIN_DELAY_MS` | `4000` | Minimum delay between product navigations |
| `MAX_DELAY_MS` | `8000` | Maximum delay between product navigations |
| `NAV_TIMEOUT_MS` | `45000` | Navigation timeout |
| `NAV_RETRIES` | `2` | Retries for transient navigation failures |
| `RETRY_BASE_DELAY_MS` | `3000` | Retry backoff base |
| `BLOCK_THRESHOLD` | `2` | Consecutive blocks before stopping the run |
| `RESPECT_ROBOTS` | `true` | Check robots.txt before product requests |
| `WAIT_FOR_MANUAL_CHALLENGE` | `true` | Wait for you to solve CAPTCHA/login in the visible browser |
| `CHALLENGE_WAIT_MS` | `600000` | How long to wait for a manual challenge |
| `CHALLENGE_POLL_MS` | `2500` | How often to check whether the challenge was cleared |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `DEBUG` | `false` | Save failure screenshots/HTML under `output/debug` |

## CLI

```bash
npm run compare
npm run compare:headed
npm run compare -- --limit 3
npm run compare -- --concurrency 2
npm run compare -- --links data/my-links.txt --output reports
npm run dry-run
```

Options:

```text
--headed                 Show the browser window (default)
--headless               Run without a browser window
--links <path>           Link file
--output <path>          Output directory
--manufacturer-specs <path>
--no-manufacturer        Skip manufacturer overrides
--concurrency <1-3>      Concurrent product pages
--limit <n>              Process at most n products
--dry-run                Parse links without launching a browser
--no-robots              Skip the robots.txt preflight
--no-challenge-wait      Do not wait for a manual CAPTCHA/login solve
--debug                  Save debug screenshots/HTML for failures
--help
--version
```

## Reliability and compliance

- Product pages are processed sequentially by default; concurrency is capped at 3.
- A configurable random delay is applied between product navigations.
- Transient navigation failures are retried with backoff.
- CAPTCHA, robot checks, and sign-in redirects wait for manual completion in a visible browser. The script never solves or bypasses them itself.
- If the challenge is not completed within `CHALLENGE_WAIT_MS`, or the run is headless, the product is reported as `blocked`.
- Unrecoverable responses such as 401, 403, 429, and repeated 503 are reported as `blocked`.
- After repeated access restrictions, the run stops requesting more products and marks the remainder `skipped`.
- Only product URLs are visited. Search, cart, reviews, and account pages are not crawled.
- robots.txt is checked once per run and cached.
- No stealth plugins, CAPTCHA solving, proxies, authentication bypass, or credential handling are used.
- The browser is visible by default so you can observe the run and complete challenges manually.

If Amazon blocks the run, the outputs still contain a blocked row and a clear error. Wait and retry later rather than increasing request rate.

## Status values

| Status | Meaning |
| --- | --- |
| `success` | Core fields and price extracted; missing-field list is empty |
| `partial` | Some useful data extracted, but important fields or price are missing |
| `failed` | Navigation or extraction failed |
| `blocked` | CAPTCHA/login not completed, 401/403/429/503, or robots.txt restriction |
| `unavailable` | 404/page-not-found or product unavailable |
| `skipped` | Not processed after interruption or repeated blocks |

## Development

```bash
npm run typecheck
npm test
npm run build
npm start
npm run clean
```

Scripts:

- `npm run compare` — run from TypeScript with `tsx` (headed by default)
- `npm run compare:headed` — headed browser
- `npm run compare:headless` — unattended headless browser
- `npm run dev` — headed development run
- `npm run dry-run` — inspect input without browsing
- `npm run typecheck` — strict TypeScript check
- `npm test` — unit tests for URL, GPU, CPU, memory, physical specs, price, and CSV logic
- `npm run build` — compile to `dist/` and copy report assets
- `npm start` — run compiled output
- `npm run clean` — remove `dist/` and `output/`
- `npm run playwright:install` — install Chromium

## Project structure

```text
data/                       Input URLs and curated manufacturer specs
src/browser/                Launch, navigation, robots, DOM snapshot
src/input/                  URL validation, canonicalization, deduplication
src/extract/                Product, GPU, CPU, memory, storage/display, and price extraction
src/normalize/              Text, number, hardware, and source utilities
src/manufacturer/           Curated provider and merge/conflict logic
src/report/                 CSV, JSON, HTML template/assets
src/pipeline.ts             Per-product orchestration, retries, partial results
src/output.ts               Atomic output writes and checkpoints
src/types.ts                Shared domain types
tests/                      Unit tests and fixtures
```

## Troubleshooting

**Chromium is not installed**

```bash
npx playwright install chromium
```

If the bundled browser cannot run on the host, set `BROWSER_CHANNEL=chrome` and use installed Google Chrome.

**Amazon returns a CAPTCHA or login page**

The run is headed by default. Solve the CAPTCHA or sign in directly in the open browser window; the script detects that the challenge has cleared and continues automatically. It does not solve the challenge itself. In headless mode there is nobody to complete it, so the product is marked `blocked`.

If the challenge is not solved within `CHALLENGE_WAIT_MS` (10 minutes by default), the product is marked `blocked`. You can adjust the timeout or disable waiting with `--no-challenge-wait`.

**A product is missing specifications**

Amazon listings are inconsistent. Add a cited entry to `data/manufacturer-specs.json` for that ASIN. Unknown values are intentional; they are not filled by guessing.

**Amazon changed its layout**

Selectors and parsing rules are isolated under `src/browser/snapshot-page.txt` and `src/extract/`. Add or adjust aliases and extend the unit tests. `DEBUG=true` saves the failure screenshot and page HTML under `output/debug/`.

**CSV appears to have text in numeric columns**

Missing values are exported as `unknown`/`not_applicable` so they are explicit. Use the JSON output or the dashboard for typed numeric comparisons.

## Notes

- Prices and offers are dynamic; always verify on Amazon before purchase.
- The dashboard distinguishes `verified`, `unverified`, `unknown`, and `not_applicable` fields.
- The report is a comparison aid, not a purchasing guarantee.
