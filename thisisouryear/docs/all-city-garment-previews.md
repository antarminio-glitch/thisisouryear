# All-city garment previews

Verified October 13, 2026 against live https://thisisouryear.team and origin/main at `0cb5f09a308c5bbefe0231b4af529038098857c1`.

## Diagnosis

The live site already resolves all 128 combinations (32 cities × adult tee, adult hoodie, kids tee, kids hoodie), with no browser JavaScript errors in the city-page audit. Dallas is not uniquely enabled in current source or the current live deployment. All four garments already have 32 city mappings and locally committed SanMar photos. No missing mapping or reproducible switching failure was found. See `live-audit.json`.

The visible options depend on two separate fit/style controls, and optional model thumbnails differ by city. Those model photos are editorial extras, not garment availability. Some vendor blank colors are only approximations: Philadelphia's kids hoodie is Dark Green rather than its teal adult hoodie. Expanding model photography or claiming exact color matches would be misleading.

## Changes

- Every city picker now shows the same four full-garment thumbnail choices after a city is selected. The homepage picker uses the same component.
- Clicking a thumbnail changes fit and garment together, updates the original radios, URL and preview, and retains the existing size/availability rules. Back navigation restores the selection.
- Shared server/browser previews identify the actual SanMar style and color and explain that the city color is approximate. This also covers shop, rival-color gifts and matching sets. An unavailable photo is labeled as an illustration.
- Kids hoodies remain preview-only. Catalog flags, stock, checkout checks, typography, homepage copy, artwork, photo assets and per-garment print placements are unchanged.
- Strengthened photo tests require all four configured garments, all 32 cities, identical server/browser mappings, garment-specific print placement and full-garment framing.
- Added `scripts/validate-garment-previews.mjs` for repeatable browser validation. Set `PLAYWRIGHT_MODULE` and `CHROME_PATH` when using a shared runtime; optionally set `SITE_URL` and `PREVIEW_OUTPUT`.

## Validation

- Production build: 50 pages built successfully.
- Unit tests: 159 passed; built-site tests: 15 passed.
- Browser: 1,335 checks passed with zero JavaScript errors. All 32 cities × four garments checked across city pages, homepage picker, shop filters, gifts and matching sets, at 1440px desktop and 390px mobile widths. Checks include actual image mappings, lettering, thumbnail/radio state, URL/back navigation, unavailable-product blocking, horizontal overflow and all 51 unique garment assets responding successfully.
- Additional screenshots of the production build at 320px confirm the thumbnail layout wraps without horizontal overflow. Screenshots were refreshed against production preview to omit the development toolbar.
- `git diff --check` passed.
- Runtime lacks npm; ran the equivalent build, unit-test and built-site scripts with pnpm individually. No dependency changes were made.

## Limits

Existing SanMar color approximations remain; vendor approval and physical samples are still needed to establish final garment/ink matches. Kids hoodies cannot be purchased. The optional on-model photo coverage remains uneven; it does not control preview choices. The original Dallas-only report could not be reproduced on the current live deployment.

No merge or deployment was performed.

## Publication

The change is committed on `codex/all-city-garment-previews` in the isolated clone under `work/repo`. Shell push lacks credentials; the GitHub integration also rejected the write endpoint with HTTP 403 (“Resource not accessible by integration”). No remote branch or PR was created. A portable commit patch, draft PR text and GitHub Desktop handoff are included with these outputs.
