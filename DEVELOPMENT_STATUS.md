# Development status

## Complete

- Responsive football and basketball website shell with shared certainty bands and grey NO BET handling.
- Cloudflare Worker and static asset deployment through GitHub Actions.
- D1 database and initial schema. The user confirmed `/api/health` reports `database: connected` and `schema: ready`.
- Read-only Worker APIs for health, fixtures, sync status, and published predictions.
- Football fixture cards open a match-analysis view and show grey NO BET while no calibrated public prediction exists.
- Daily successful sports-data sync triggers a GitHub workflow that generates football shadow forecasts as draft NO BET rows; they are excluded from the public predictions API.
- Shadow generation triggers a GitHub review workflow that scores finished forecasts with accuracy, Brier score, log loss, and calibration bins.
- Multi-competition historical import and a league-by-league chronological evaluation workflow are prepared for Premier League, Championship, Primeira Liga, Italian Serie A, and Brazilian Série A.
- Provider sync prepared for football-data.org football fixtures/results and API Ninjas NBA/WNBA schedules/results.
- Provider credentials are read only by the GitHub Actions sync job and are never put in the browser or Worker.

## Needs to be uploaded and run through GitHub

- Commit the prepared multi-competition importer, evaluator, and workflows.
- Run **Import NeoBet football history**. On success, **Evaluate NeoBet football competitions** runs automatically and reports separate results by league.
- Review each competition's complete-season coverage and held-out metrics before adding it to shadow forecasts.

## Still to build

- League-specific shadow forecast generation after reviewing the new per-competition evaluation.
- Public calibrated prediction generation, settlement ingestion, and performance dashboards.
- Confirm each provider account's current quota before increasing the competitions or sync frequency.

All validation and provider sync runs are intended to run on GitHub-hosted runners. No local testing is required.
