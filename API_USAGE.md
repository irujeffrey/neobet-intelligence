# API usage

## Current state

Football-Data.org and API Ninjas are configured as providers. A daily GitHub Actions workflow stores football fixtures/results and NBA/WNBA schedules/results in D1; the same workflow can be started manually from GitHub. Visitors never trigger upstream provider requests. Provider API keys stay in GitHub Actions secrets and are not sent to the Worker. The integration does not create predictions or odds.

## NeoBet Worker endpoints

- `GET /api/health` — reports whether the D1 binding and initial schema are available. It returns no account, token, or provider details.
- `GET /api/predictions` — reads published predictions only. Optional query parameters are `sport=football|basketball` and `date=YYYY-MM-DD`. It does not trigger a provider request.
- `GET /api/fixtures` — read-only fixture list. Optional filters are `sport=football|basketball` and `date=YYYY-MM-DD`; without a date it returns recent and upcoming fixtures.
- `GET /api/data-status` — latest sync status and record counts for each provider.

The provider sync stores current data but does not generate predictions. Until a calibrated model produces publishable outputs, the predictions endpoint remains empty.

## Integration requirements

- Route provider calls through `scripts/sync-sports-data.mjs`; never put keys in browser code or public repository files.
- Cache and synchronize centrally so visitor count does not multiply upstream requests.
- Record each provider's run time, status, request count, fixture count, and safe error code without recording secrets or response payloads.
- The daily API Ninjas sync fetches the current NBA and WNBA seasons in pages of 50. The code caps this at 35 pages per league (up to 70 calls per run); check the account's current hourly and monthly quota before adding leagues or extra syncs. The Free plan currently lists 100 calls/hour and 3,000 calls/month on the [pricing page](https://api-ninjas.com/pricing).
- `Evaluate NeoBet basketball baseline` reads completed NBA/WNBA fixtures already stored in D1; it makes no API Ninjas requests. The API Ninjas Free plan exposes only current-season basketball history, so the resulting chronological holdout is within-season, not a test on a later unseen season.
- API Ninjas' current [Terms of Service](https://api-ninjas.com/tos), updated November 4, 2026, say Free-plan output is for personal non-commercial use and may not be shared with third parties. Reconfirm permission for public basketball fixture display with API Ninjas or move public basketball data to a provider/license that permits redistribution before treating the current public fixture feed as approved.
- The Football-Data.org sync requests a rolling window of 14 days past and 30 days ahead, split into seven-day calls with a pause to stay within the free plan's 10 requests/minute allowance.
- Do not enable advertisements for provider-derived content; current provider approval is for a no-ad site.
