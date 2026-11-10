# NeoBet Intelligence

Responsive, zero-dependency website foundation for transparent football and basketball analysis. Provider sync is prepared for football-data.org and API Ninjas. The site will not show invented picks or performance figures; calibrated model outputs are still to be built.

## GitHub-based validation

No local preview or test command is required. GitHub Actions checks JavaScript syntax and confirms the homepage, stylesheet, and JavaScript asset respond. Provider sync and remote D1 import also run on GitHub-hosted runners.

## Basketball cross-season evaluation

The **Evaluate NeoBet NBA cross-season model** workflow downloads BoxScore Lab NBA team-game CSVs on the GitHub runner, pairs each game's two team rows, and evaluates an Elo probability baseline across complete seasons. It trains/updates through 2022-23 and 2023-24, fits a single temperature using 2024-25, then reports raw, calibrated, and pre-test home-win-rate metrics on the untouched 2025-26 season. Ratings update only after all games on a date and regress toward the league mean between seasons. The ongoing 2026-27 season is excluded. The workflow summary includes Brier score, log loss, accuracy, and ECE; a 90-day JSON artifact contains detailed calibration bins.

The source CSVs are published by [BoxScore Lab](https://www.boxscorelab.com/downloads/) under CC BY 4.0. Reports include attribution and retrieval date. The evaluation is NBA-only, score-history-only, and not evidence of betting value or approval for public picks. WNBA and public basketball selections remain NO BET.

## Certainty system

The shared `window.NeoBet.getCertainty(prediction)` function in `public/src/app.js` uses calibrated model probability and a common set of bands for both sports. It returns grey `NO BET` when probability is missing or invalid, calibration is absent, data quality is not good, required odds are stale, or model uncertainty is over the current 0.20 threshold. Probability is never treated as model confidence or betting value.

## Deployment foundation

`wrangler.jsonc` points Cloudflare Workers Static Assets at `public/` and binds the existing D1 database. Provider keys belong only in the GitHub Actions secrets `API_NINJAS_API_KEY` and `FOOTBALL_DATA_TOKEN`. The current provider approval is for a no-ad site; never place credentials in frontend files.

After uploading changes, apply pending D1 migrations, then run **Deploy NeoBet to Cloudflare**. The deploy workflow is manual so you can review checks before publishing.

## Database setup

The D1 schema is versioned in `migrations/`. The GitHub-hosted **Sync NeoBet sports data** workflow fetches licensed provider records and imports them into D1. The public API exposes fixtures and sync status, while predictions remain empty until a calibrated model is built.

## Project notes

- `DEVELOPMENT_STATUS.md` — current implementation status and next stage.
- `DECISIONS.md` — architecture decisions.
- `PROVIDER_LICENSING.md` — provider permission register.
- `API_USAGE.md` — usage and request accounting plan.
- `DEPLOYMENT_GUIDE.md` — initial Cloudflare publishing notes.
