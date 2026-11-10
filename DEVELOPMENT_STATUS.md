# Development status

## Complete

- Responsive football and basketball website shell with shared certainty bands and grey NO BET handling.
- Cloudflare Worker and static asset deployment through GitHub Actions.
- D1 database and initial schema. The user confirmed `/api/health` reports `database: connected` and `schema: ready`.
- Read-only Worker APIs for health, fixtures, sync status, and published predictions.
- Football fixture cards open a match-analysis view and show grey NO BET while no calibrated public prediction exists.
- Daily successful sports-data sync triggers a GitHub workflow that generates Premier League and Primeira Liga shadow forecasts as draft NO BET rows; they are excluded from the public predictions API.
- Each shadow league fits its own Dirichlet calibration on its latest three complete seasons and stores forecasts under a separate unverified model version.
- Shadow generation triggers a GitHub review workflow that scores finished forecasts separately by league with accuracy, Brier score, log loss, and calibration bins.
- Shadow review reports each league's own settled-match count and provisional/ongoing monitoring state; reaching the 100-match monitoring threshold is not publication approval.
- A public Model Lab endpoint and page expose upcoming shadow estimates and settled shadow performance as an unverified experiment, with NO BET labels and no listing in Best Picks or the calibrated-predictions API.
- Multi-competition historical import and a league-by-league chronological evaluation workflow are prepared for Premier League, Championship, Primeira Liga, Italian Serie A, and Brazilian Série A.
- Provider sync prepared for football-data.org football fixtures/results and API Ninjas NBA/WNBA schedules/results.
- Provider credentials are read only by the GitHub Actions sync job and are never put in the browser or Worker.

## Needs to be uploaded and run through GitHub

- Commit the prepared multi-competition importer, evaluator, and workflows.
- Run **Import NeoBet football history**. On success, **Evaluate NeoBet football competitions** runs automatically and reports separate results by league.
- Commit the Primeira Liga shadow-only expansion and let the GitHub validation workflow run.
- Run **Generate NeoBet football shadow predictions** manually once; inspect that Premier League and Primeira Liga forecasts are saved as draft NO BET rows. Daily sync will then trigger it automatically.
- Keep all public predictions disabled; evaluate the league-specific forward shadow results as they settle.

## Still to build

- Shadow sample size and forward evaluation; other leagues remain excluded until their historical coverage and held-out metrics support a shadow trial.
- Public calibrated prediction generation, settlement ingestion, and performance dashboards.
- Confirm each provider account's current quota before increasing the competitions or sync frequency.

All validation and provider sync runs are intended to run on GitHub-hosted runners. No local testing is required.
