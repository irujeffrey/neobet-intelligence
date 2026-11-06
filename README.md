# NeoBet Intelligence

Responsive, zero-dependency website foundation for transparent football and basketball analysis. The current public preview is intentionally data-empty: no sports provider, licensed odds feed, or calibrated model is configured, so it does not display invented fixtures, picks, results, or performance figures.

## GitHub-based validation

No local preview or test command is required. The GitHub Actions workflow in `.github/workflows/validate.yml` checks JavaScript syntax and confirms the homepage, stylesheet, and JavaScript asset respond when a change is pushed, a pull request is opened, or the workflow is run manually. View the result in the repository's **Actions** tab.

## Certainty system

The shared `window.NeoBet.getCertainty(prediction)` function in `public/src/app.js` uses calibrated model probability and a common set of bands for both sports. It returns grey `NO BET` when probability is missing or invalid, calibration is absent, data quality is not good, required odds are stale, or model uncertainty is over the current 0.20 threshold. Probability is never treated as model confidence or betting value.

## Deployment foundation

`wrangler.jsonc` points Cloudflare Workers Static Assets at `public/` so project notes and workflows are not published as website files. No sports API keys, provider credentials, database, or external data service are configured. Before public data display, verify provider display and advertising permissions and wire the site to server-side Workers endpoints. Never place secret API credentials in frontend files.

After the first GitHub validation run succeeds and the Cloudflare secrets are configured, open **Actions → Deploy NeoBet to Cloudflare → Run workflow** to publish. The deploy workflow is manual so you can review checks before publishing.

## Project notes

- `DEVELOPMENT_STATUS.md` — current implementation status and next stage.
- `DECISIONS.md` — architecture decisions.
- `PROVIDER_LICENSING.md` — provider permission register.
- `API_USAGE.md` — usage and request accounting plan.
- `DEPLOYMENT_GUIDE.md` — initial Cloudflare publishing notes.
