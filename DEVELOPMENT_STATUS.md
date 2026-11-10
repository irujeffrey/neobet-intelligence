# Development status

## Complete

- Responsive football and basketball website shell with shared certainty bands and grey NO BET handling.
- Cloudflare Worker and static asset deployment through GitHub Actions.
- D1 database and initial schema. The user confirmed `/api/health` reports `database: connected` and `schema: ready`.
- Read-only Worker APIs for health, fixtures, sync status, and published predictions.
- Football fixture cards open a match-analysis view and show grey NO BET while no calibrated public prediction exists.
- Basketball page reads the existing NBA/WNBA API Ninjas fixtures endpoint and shows upcoming games as responsive cards with league, teams, local kickoff, and grey NO BET status. Cards open the shared match-analysis page.
- A private GitHub evaluation workflow scores an Elo basketball baseline chronologically from completed NBA/WNBA results already stored in D1. It uses 60% initial dates, 20% validation for temperature calibration, and the final 20% as a prequential holdout; games on the same Eastern Time date do not update ratings until the next date. It reports insufficient history instead of pretending to evaluate a tiny sample, and never publishes picks.
- Daily successful sports-data sync triggers a GitHub workflow that generates Premier League and Primeira Liga shadow forecasts as draft NO BET rows; they are excluded from the public predictions API.
- Each shadow league fits its own Dirichlet calibration on its latest three complete seasons and stores forecasts under a separate unverified model version.
- Shadow generation triggers a GitHub review workflow that scores finished forecasts separately by league with accuracy, Brier score, log loss, and calibration bins.
- Shadow review reports each league's own settled-match count and provisional/ongoing monitoring state; reaching the 100-match monitoring threshold is not publication approval.
- A public Model Lab endpoint and page expose upcoming shadow estimates and settled shadow performance as an unverified experiment, with NO BET labels and no listing in Best Picks or the calibrated-predictions API.
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
- Basketball cross-season historical evaluation; API Ninjas Free only provides current-season history, so the current report is within-season and exploratory.
- Confirm each provider account's current quota before increasing the competitions or sync frequency.

All validation and provider sync runs are intended to run on GitHub-hosted runners. No local testing is required.
