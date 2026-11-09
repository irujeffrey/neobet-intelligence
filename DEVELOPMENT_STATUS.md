# Development status

## Complete

- Responsive football and basketball website shell with shared certainty bands and grey NO BET handling.
- Cloudflare Worker and static asset deployment through GitHub Actions.
- D1 database and initial schema. The user confirmed `/api/health` reports `database: connected` and `schema: ready`.
- Read-only Worker APIs for health, fixtures, sync status, and published predictions.
- Football fixture cards open a match-analysis view and show grey NO BET while no calibrated public prediction exists.
- GitHub workflow prepared to generate football shadow forecasts as draft NO BET rows; they are excluded from the public predictions API.
- Provider sync prepared for football-data.org football fixtures/results and API Ninjas NBA/WNBA schedules/results.
- Provider credentials are read only by the GitHub Actions sync job and are never put in the browser or Worker.

## Needs to be uploaded and run through GitHub

- Upload the changed Worker, D1 migration, provider sync script, workflows, and updated documentation.
- Add `API_NINJAS_API_KEY` and `FOOTBALL_DATA_TOKEN` as repository Actions secrets.
- Apply D1 migration `0002_provider_registry.sql`, then deploy the Worker.
- Run **Sync NeoBet sports data** and check `/api/data-status` and `/api/fixtures`.

## Still to build

- Public calibrated prediction generation, settlement ingestion, and performance dashboards.
- Shadow forecast settlement and prospective calibration reporting still need to be built before considering public picks.
- Confirm each provider account's current quota before increasing the competitions or sync frequency.

All validation and provider sync runs are intended to run on GitHub-hosted runners. No local testing is required.
