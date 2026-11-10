# Start-to-finish GitHub and Cloudflare guide

This project is set up so checks and deployments run on GitHub-hosted runners. You do not need to install software, open a terminal, or test the site locally.

GitHub stores the private source code and runs the validation workflow. Cloudflare Workers Static Assets serves the public website. GitHub Pages is not used as the primary host, following the project brief.

## 1. Create the private GitHub repository

1. Sign in to [GitHub](https://github.com).
2. Select the **+** menu in the upper right, then **New repository**.
3. Set **Repository name** to `neobet-intelligence`.
4. Choose **Private**.
5. Leave **Add a README file**, **Add .gitignore**, and **Choose a license** unchecked. The project already contains a README and supporting files.
6. Select **Create repository**.

Success looks like an empty repository page with GitHub's Quick Setup instructions.

## 2. Upload the project files using GitHub's website

1. In the empty repository, choose **Add file → Upload files**.
2. Open Windows File Explorer and go to `C:\Users\DELL\Documents\NEOBET`.
3. Select the project contents and drag them into GitHub's upload area. Include the `.github` folder, the `public` folder, and the root-level `.md` and `wrangler.jsonc` files. GitHub keeps the folder structure when folders are uploaded.
4. Confirm the pending file list includes at least:
   - `.github/workflows/validate.yml`
   - `.github/workflows/deploy.yml`
   - `public/index.html`
   - `public/src/app.js`
   - `public/src/styles.css`
   - `wrangler.jsonc`
   - `README.md`
5. In **Commit changes**, enter `Add NeoBet Intelligence website` and commit to the `main` branch.

Do not upload API tokens, passwords, `.env` files, or other credentials. The current project contains no sports-provider credentials.

## 3. Confirm GitHub validation

1. Open the repository's **Actions** tab.
2. Select the newest **Validate NeoBet website** run.
3. Open the **Syntax and website smoke check** job.
4. Wait for a green check. The job checks JavaScript syntax and confirms the homepage, CSS, and JavaScript files respond on a GitHub-hosted runner.

You do not need to preview or test the website on your computer. If the GitHub Actions job failed, open the failed step and copy its error text; do not change secrets or disable the workflow to make it green.

## 4. Create a free Cloudflare account and enable its preview domain

1. Sign in or create an account at [Cloudflare](https://dash.cloudflare.com/sign-up).
2. You do not need to select a Workers plan during signup: Cloudflare says Workers Free is available by default. Continue with the free account and do not select an upgrade, paid plan, or trial.
3. In the dashboard, open **Workers & Pages** and set up the account's free `workers.dev` subdomain if prompted. No purchased domain is required.
4. In **Workers & Pages → Overview**, copy the **Account ID**. You will add it to GitHub in the next section.

NeoBet uses a Worker for its API and a D1 database, in addition to serving static assets. Provider syncing runs on GitHub-hosted runners, so provider calls do not run on a visitor's browser or inside a Cloudflare Cron Trigger.

## 5. Make a Cloudflare deployment token

1. In the Cloudflare dashboard, open the account's **API Tokens** page and choose **Create Token**.
2. Under permission policies, choose the **Edit Cloudflare Workers** template.
3. Limit the token's account resource to the Cloudflare account you will deploy into. Do not include zones or other accounts.
4. Name it `NeoBet GitHub deploy` and create it.
5. Copy the token when Cloudflare shows it. Cloudflare shows the secret once; keep it private and do not paste it into a chat or file.

Cloudflare's GitHub Actions guide documents this token template and recommends limiting the account scope. [Cloudflare GitHub Actions deployment](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)

## 6. Save the Cloudflare credentials as GitHub Actions secrets

1. Return to the GitHub repository and open **Settings**.
2. In the left sidebar, choose **Secrets and variables → Actions**.
3. Select **New repository secret**.
4. Create `CLOUDFLARE_API_TOKEN`, then paste the token value into the **Secret** field and save it.
5. Select **New repository secret** again.
6. Create `CLOUDFLARE_ACCOUNT_ID`, paste the Account ID, and save it.

The deploy workflow reads these two secrets without putting their values in the source files. Never put credentials in `public/`, the README, or an ordinary chat message.

## 7. Publish from GitHub Actions

1. Open the repository's **Actions** tab.
2. In the left column, select **Deploy NeoBet to Cloudflare**.
3. Select **Run workflow**, keep the branch set to `main`, then select the green **Run workflow** button.
4. Open the new deployment run and wait for a green check.
5. In the **Deploy with Wrangler** step, find the `workers.dev` deployment URL in the output.
6. Open that URL in a browser. The NeoBet dashboard should load. `/api/health` should report the D1 database as connected and the schema as ready.

The deployment is manual so a GitHub Actions check does not publish a change automatically. Cloudflare's Workers Static Assets configuration publishes only `public/`; project notes and workflow files remain out of the public website.

## 8. Publish later changes

For the beginner workflow, make changes through GitHub's web editor or upload page. When you commit a change to `main`, GitHub runs **Validate NeoBet website**. If it is green, run **Deploy NeoBet to Cloudflare** again to publish the new version.

## Troubleshooting

- **No validation run:** Confirm both `.github/workflows/*.yml` files are present on `main`, then check **Settings → Actions → General** to confirm Actions are allowed.
- **Deploy says authentication failed:** Recheck both repository secrets. If the token was lost, create a replacement token and update `CLOUDFLARE_API_TOKEN`; never reveal the old token.
- **Worker name mismatch:** `wrangler.jsonc` names the Worker `neobet-intelligence`. Keep that name if editing the Cloudflare configuration.
- **No live URL:** Confirm the Cloudflare account has a `workers.dev` subdomain enabled, then inspect the failed Wrangler step in the Action log.
- **Any screen offers a paid upgrade:** stop there and do not select it. The initial static website does not require one.

## 9. Connect the approved sports data sources

The D1 database and initial schema are already working. These steps add football-data.org football fixtures/results and API Ninjas NBA/WNBA schedules/results. All fetching, validation, and database imports run on GitHub-hosted runners.

### 9.1 Upload the integration files

From the GitHub repository, use **Add file → Upload files** to upload the updated project files, preserving the folder structure. Include `src/index.js`, `scripts/sync-sports-data.mjs`, `migrations/0002_provider_registry.sql`, `.github/workflows/validate.yml`, `.github/workflows/deploy.yml`, `.github/workflows/sync-sports-data.yml`, `wrangler.jsonc`, and the updated documentation. The `wrangler.jsonc` database binding must remain `DB` with the existing database ID. Commit the changes to `main` and wait for **Validate NeoBet website** to pass.

### 9.2 Add the provider keys to GitHub

Open **Repository → Settings → Secrets and variables → Actions → New repository secret**. Add these two secrets, entering each value only in GitHub:

- `API_NINJAS_API_KEY` — the API Ninjas key. The same key covers its sports APIs.
- `FOOTBALL_DATA_TOKEN` — the football-data.org token.

Keep the existing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets. The Cloudflare token needs **Workers Scripts Edit** and **D1 Edit** so GitHub can deploy the Worker and import the migration/data.

### 9.3 Apply the provider registry migration

Run **Actions → Apply NeoBet D1 migrations → Run workflow**. It should apply `0002_provider_registry.sql`; it will not recreate the existing database or reapply `0001_initial_schema.sql`.

### 9.4 Deploy the Worker update

Run **Actions → Deploy NeoBet to Cloudflare → Run workflow** and wait for green. The Worker reads the fixture and provider sync status endpoints from D1.

### 9.5 Run the first provider sync

Run **Actions → Sync NeoBet sports data → Run workflow**. GitHub fetches football fixtures/results for the recent 14-day and upcoming 30-day window, then fetches the current NBA and WNBA seasons in pages. The sync is also scheduled daily at 04:00 UTC.

After the Action succeeds, open these URLs using the same base address as the site:

- `/api/data-status` — last run and record counts for each provider.
- `/api/fixtures?sport=football` — football fixtures/results.
- `/api/fixtures?sport=basketball` — NBA/WNBA schedules/results.

`/api/predictions` will remain empty until the calibrated prediction model is implemented. Provider fixture data does not itself create betting picks.

If the Action fails, open **Sync NeoBet sports data → Fetch provider data into D1** and share the error text only. Do not share the API keys or Cloudflare token. No local testing is needed.
