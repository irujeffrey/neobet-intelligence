# Development status

## Complete

- Responsive football and basketball website shell with shared certainty bands and grey NO BET handling.
- Cloudflare Worker and static asset deployment through GitHub Actions.
- D1 database and initial schema. The user confirmed `/api/health` reports `database: connected` and `schema: ready`.
- Read-only Worker APIs for health, fixtures, sync status, and published predictions.
- Football fixture cards open a match-analysis view and show grey NO BET while no calibrated public prediction exists.
- Basketball page reads the existing NBA/WNBA API Ninjas fixtures endpoint and shows upcoming games as responsive cards with league, teams, local kickoff, and grey NO BET status. Cards open the shared match-analysis page.
- A private GitHub evaluation workflow scores an Elo basketball baseline chronologically from completed NBA/WNBA results already stored in D1. It uses 60% initial dates, 20% validation for temperature calibration, and the final 20% as a prequential holdout; games on the same Eastern Time date do not update ratings until the next date. It reports insufficient history instead of pretending to evaluate a tiny sample, and never publishes picks.
- A separate GitHub-only NBA cross-season evaluator downloads paired team-game rows from BoxScore Lab's CC BY 4.0 CSVs, uses 2022-23 as a rating warm-up, selects Elo settings only on 2023-24, fits temperature only on 2024-25, and reports the untouched 2025-26 season. It excludes ongoing 2026-27 and leaves WNBA outside this dataset-specific evaluation. It is evaluation-only and cannot approve public basketball picks.
- An NBA prospective shadow workflow stores same-day uncalibrated fixed-reference Elo estimates as unpublished NO BET drafts and evaluates them as fixtures settle. It uses only earlier completed 2026-27 games for ratings and applies source freshness and fixture quality gates. The report remains evaluation-only.
- Basketball page has a visitor-facing daily NBA experimental-pick board backed by settled prospective shadow metrics. It displays no odds, keeps every selection NO BET, and filters by visitor-local match day, fixture quality, source freshness, and pre-tip forecast timing. Its Worker endpoint is gated off by default because API Ninjas Free terms prohibit sharing output; public estimates require the approved license flag. Best Picks links to both the football Model Lab and basketball page.
- Daily successful sports-data sync triggers a GitHub workflow that generates Premier League and Primeira Liga shadow forecasts as draft NO BET rows; they are excluded from the public predictions API.
- Each shadow league fits its own Dirichlet calibration on its latest three complete seasons and stores forecasts under a separate unverified model version.
- Shadow generation triggers a GitHub review workflow that scores finished forecasts separately by league with accuracy, Brier score, log loss, and calibration bins.
- Shadow review reports each league's own settled-match count and provisional/ongoing monitoring state; reaching the 100-match monitoring threshold is not publication approval.
- A public Model Lab endpoint and page expose upcoming shadow estimates and settled shadow performance as an unverified experiment, with NO BET labels and no listing in Best Picks or the calibrated-predictions API.
- The OpenFootball history importer refreshes daily at 05:00 UTC; a successful import triggers the forward-only Premier League evaluation automatically. It reports the evolving 2026-27 sample while leaving the test-start date and calibration settings frozen.
- Public experimental picks are surfaced from the Football page and Best Picks page through a clear link to the daily Model Lab. Each eligible card names the leading model outcome and exact probability while retaining a grey NO BET label; no experimental forecast is treated as an approved bet.
- Public experimental estimates are hidden unless the forecast is complete and pre-kickoff, fixture quality is `good`, and the provider source timestamp is no more than seven days old. Competitions without an eligible model and any stale/poor-quality fixture remain NO BET.
- Model Lab is scoped to today's remaining fixtures in the visitor's local timezone and lists every competition present in the daily football feed; it shows the highest-probability experimental model lean when a forecast exists, with a grey NO BET badge. Forecast models run only for configured leagues with three consecutive complete calibration seasons; other competitions remain visible as NO BET.
- The provider sync is scheduled daily at 04:00 UTC (05:00 Lagos time); successful sync triggers shadow forecast generation and its review workflow.
- Multi-competition historical import and a league-by-league chronological evaluation workflow are prepared for Premier League, Championship, Primeira Liga, Italian Serie A, and Brazilian Série A.
- Provider sync prepared for football-data.org football fixtures/results and API Ninjas NBA/WNBA schedules/results.
- Provider credentials are read only by the GitHub Actions sync job and are never put in the browser or Worker.

## Needs to be uploaded and run through GitHub

- Commit the prepared multi-competition importer, evaluator, and workflows.
- Run **Import NeoBet football history**. On success, **Evaluate NeoBet football competitions** runs automatically and reports separate results by league.
- Commit the Primeira Liga shadow-only expansion and let the GitHub validation workflow run.
- Run **Generate NeoBet football shadow predictions** manually once; inspect that Premier League and Primeira Liga forecasts are saved as draft NO BET rows. Daily sync will then trigger it automatically.
- Keep approved/calibrated predictions disabled; the public Model Lab may show clearly labeled experimental estimates with the NO BET safeguards above.

## Still to build

- Shadow sample size and forward evaluation; other leagues remain excluded until their historical coverage and held-out metrics support a shadow trial.
- Public calibrated prediction generation, settlement ingestion, and performance dashboards.
- Upload the parameter-selection update to `scripts/evaluate-basketball-cross-season.mjs`, then run **Evaluate NeoBet NBA cross-season model** manually from GitHub Actions and inspect the summary and 90-day JSON artifact. The run compares a fixed Elo reference, train-season-selected Elo, temperature scaling, and the pre-test home-rate baseline; it does not authorize public picks. If BoxScore Lab changes its CSV headers or coverage, the workflow fails rather than reporting partial data.
- Upload the NBA shadow monitor script and workflow, then allow **Sync NeoBet sports data** to trigger **Monitor NeoBet NBA shadow forecasts**. Check that new predictions are draft/no_bet/uncalibrated and review the prospective settled metrics as their sample grows. The 100-match mark is for monitoring only, not publication approval.
- Public NBA estimates are disabled until the API Ninjas plan or written provider permission allows visitors to see the output. After confirming that permission, set `BASKETBALL_PUBLIC_EXPERIMENT_LICENSE` to `approved` and deploy; otherwise leave it `disabled` and the page explains that the board is unavailable.
- Confirm each provider account's current quota before increasing the competitions or sync frequency.

All validation and provider sync runs are intended to run on GitHub-hosted runners. No local testing is required.
