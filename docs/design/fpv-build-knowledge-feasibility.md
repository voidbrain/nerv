# FPV Build Knowledge Feasibility (F-099-T01)

Date: 2026-11-15  
Status: Feasibility study only (no wiring answered in this step).

## 1. What Each Input Source Yields

| Source | Method tested | What it yields | Limits |
|---|---|---|---|
| Owner's `diyfpv.com` build link (`https://builder.diyfpv.com/build/b4ee9ef3fb8c`) | Read-only HTTP GET (`2026-11-15`) | Returns `HTTP/2 200` Next.js (`x-powered-by: Next.js`) client-rendered HTML shell loading `/_next/static/chunks/*.js` and setting a `diyfpv-studio-session` cookie. No server-rendered component list or wiring JSON in the HTML response. | Plain HTTP fetch (`F-085` quarantine) cannot read the build graph. Reading it directly from the URL requires a headless browser adapter (`F-089`) and is fragile against site markup changes. |
| `diyfpv.com` PNG export | Raster image inspection model | Visual layout of components, connectors, and drawn wire traces on the exported canvas. | Lossy: small pad labels (`R2`, `T2`, `5V`, `GND`), overlapping traces, or zoomed-out exports can be misread. Must never be guessed when illegible. |
| Saved component list + manufacturer docs (`F-083` / `F-085`) | Local structured document + read-only manufacturer docs | Exact part names, revisions, pinout tables, UART assignments, and configuration requirements with verifiable citations. | Does not capture custom physical choices (for example, which UART the owner actually soldered to) unless recorded in the owner's build note or verified on the PNG. |

## 2. Manufacturer Documents Located

1. **iFlight BLITZ Mini F7 (V1.1 / V1.2)** — Located official iFlight pinout/manual references (`iflight.com`, firmware target `IFLIGHT_BLITZ_F722`):
   - Documents MCU (`STM32F722`), 6 UARTs (`UART 1`–`UART 6`), SH1.0 connectors (including 4-pin Receiver connector and 9-pin VTX connector), and corner/edge solder pads.
2. **BetaFPV SuperD ELRS Diversity Receiver** — Located BetaFPV & ExpressLRS official pinout/setup references (`betafpv.com`, `expresslrs.org`, `manuals.plus`):
   - Documents the 5 PCB pads (`GND`, `5V`, `TX`, `RX`, `BOOT`), uninverted UART requirement, and Betaflight Serial RX / `CRSF` settings.

*(Per F-099-T01 scope, no wiring instructions are generated or answered in this feasibility note.)*

## 3. Recommendation & Limits (for Owner Decision F-099-T02)

1. **Primary source of truth:** Keep the drone's component list and chosen UART/connector notes in a local saved document (`F-083`, `shareable = 0`), paired with fetched-into-quarantine (`F-085`) or locally cached manufacturer pinout docs. Every wiring answer must cite the specific saved build note and/or manufacturer document.
2. **PNG export as visual check:** Allow the owner to attach a `diyfpv.com` PNG export to verify connector/UART choices, **with strict refusal**: if pad labels or wire endpoints are blurry, cropped, or ambiguous, NERV must say it cannot verify the pin from the PNG and ask for confirmation instead of guessing.
3. **Defer `diyfpv.com` scraping:** Do not build a custom `diyfpv.com` web scraper before `F-089` (browser adapter) is decided; a saved component list + PNG export covers the workflow without depending on `diyfpv.com` DOM/API stability.

## Reading the build link (F-099-T04)

`nerv fpv-read-build <https://builder.diyfpv.com/build/<id>>` opens the link read-only in a new tab of the dedicated browser profile (the F-089 adapter, origin in `browser.allowedOrigins`), waits for the client-rendered page, reads its headings and tables, closes the tab and saves the local build note (`src/diyfpv-build.ts`). It expects page structure v1: a parts table with a category column and a part column, and an optional wiring table with From, From pad, To, To pad (UART optional). Any other structure, an empty cell or a wire to an unlisted part fails with a message and saves nothing. Wires read from the page are cited per row and stay unverified until a manufacturer document confirms them. Structure v1 has not yet been checked against a real diyfpv.com build page.
