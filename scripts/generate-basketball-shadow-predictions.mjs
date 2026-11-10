import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ACCOUNT_ID = requireEnv("CLOUDFLARE_ACCOUNT_ID");
const DATABASE_ID = requireEnv("CLOUDFLARE_D1_DATABASE_ID");
const API_TOKEN = requireEnv("CLOUDFLARE_API_TOKEN");
const MODEL_ID = "basketball-nba-elo-shadow-fixed-0-1-0";
const MODEL_NAME = "nba-elo-shadow-fixed";
const MODEL_VERSION = "0.1.0";
const K_FACTOR = 20;
const HOME_ADVANTAGE_ELO = 65;
const ELO_SCALE = 400;
const SOURCE_MAX_AGE_DAYS = 7;
const MINUTES_BEFORE_KICKOFF = 30;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing from GitHub Actions secrets or environment.`);
  return value;
}

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function stableId(...parts) {
  return createHash("sha256").update(parts.join("|").toLowerCase()).digest("hex");
}

async function queryD1(statement) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(ACCOUNT_ID)}/d1/database/${encodeURIComponent(DATABASE_ID)}/query`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ sql: statement }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Cloudflare D1 query returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (!payload.success) {
    const reason = (payload.errors || []).map((entry) => entry.message).filter(Boolean).join("; ");
    throw new Error(`Cloudflare D1 query failed${reason ? `: ${reason}` : "."}`);
  }
  return payload.result?.[0]?.results || [];
}

function easternDate(value) {
  const date = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${date.year}-${date.month}-${date.day}`;
}

function probability(homeRating, awayRating) {
  const value = Math.LN10 * (homeRating - awayRating + HOME_ADVANTAGE_ELO) / ELO_SCALE;
  return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
}

function updateRatingsForDate(games, ratings) {
  const deltas = new Map();
  for (const game of games) {
    const homeRating = ratings.get(game.home_team) ?? 1500;
    const awayRating = ratings.get(game.away_team) ?? 1500;
    const expected = probability(homeRating, awayRating);
    const actual = game.home_score > game.away_score ? 1 : 0;
    const delta = K_FACTOR * (actual - expected);
    deltas.set(game.home_team, (deltas.get(game.home_team) || 0) + delta);
    deltas.set(game.away_team, (deltas.get(game.away_team) || 0) - delta);
  }
  for (const [team, delta] of deltas) ratings.set(team, (ratings.get(team) ?? 1500) + delta);
}

function toSql(output) {
  const insertVersion = `INSERT OR IGNORE INTO model_versions (
    id, sport, model_name, version, calibration_method, calibration_status, training_data_start, training_data_end
  ) VALUES (
    ${sql(MODEL_ID)}, 'basketball', ${sql(MODEL_NAME)}, ${sql(MODEL_VERSION)},
    'uncalibrated fixed Elo; prospective shadow only', 'unverified', '2026-27', '2026-27'
  );`;
  const rows = output.forecasts.map((forecast) => `INSERT OR IGNORE INTO predictions (
    id, fixture_id, model_version_id, sport, market, selection, decision, probability,
    calibrated, model_confidence, model_uncertainty, data_quality, value_estimate,
    odds_required, odds_snapshot_id, no_bet_reason, explanation, model_name,
    model_version, status, published_at
  ) VALUES (
    ${sql(forecast.id)}, ${sql(forecast.fixture_id)}, ${sql(MODEL_ID)}, 'basketball',
    'moneyline', 'home_win', 'no_bet', ${forecast.probability}, 0, NULL, NULL,
    ${sql(forecast.data_quality)}, NULL, 0, NULL,
    'Uncalibrated prospective shadow forecast; evaluation only; NO BET.',
    ${sql(`Experimental fixed Elo shadow estimate. No betting recommendation. Source: ${forecast.source}.`)},
    ${sql(MODEL_NAME)}, ${sql(MODEL_VERSION)}, 'draft', NULL
  );`).join("\n");
  return `${insertVersion}\n${rows}\n`;
}

async function main() {
  const now = new Date();
  const fixtures = await queryD1(`
    SELECT f.id AS fixture_id, f.scheduled_at, f.status, f.home_score, f.away_score,
      f.data_quality, f.source_updated_at, competition.name AS competition,
      home.name AS home_team, away.name AS away_team
    FROM fixtures AS f
    JOIN competitions AS competition ON competition.id = f.competition_id
    JOIN teams AS home ON home.id = f.home_team_id
    JOIN teams AS away ON away.id = f.away_team_id
    WHERE f.sport = 'basketball' AND competition.name = 'NBA'
      AND f.id LIKE 'api-ninjas:fixture:%'
    ORDER BY f.scheduled_at ASC
  `);
  const validFixtures = fixtures.filter((fixture) => Number.isFinite(Date.parse(fixture.scheduled_at)) && fixture.home_team && fixture.away_team);
  const completed = validFixtures.filter((fixture) => fixture.status === "finished" && Number.isInteger(fixture.home_score) && Number.isInteger(fixture.away_score) && fixture.home_score !== fixture.away_score && fixture.data_quality === "good");
  const sourceCutoff = now.getTime() - SOURCE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const eligible = validFixtures.filter((fixture) => {
    const freshness = Date.parse(fixture.source_updated_at || "");
    return fixture.status === "scheduled" && fixture.data_quality === "good" &&
      Date.parse(fixture.scheduled_at) > now.getTime() + MINUTES_BEFORE_KICKOFF * 60 * 1000 &&
      Number.isFinite(freshness) && freshness >= sourceCutoff;
  });

  const forecasts = [];
  let targetDate = null;
  let ratings = new Map();
  if (eligible.length) {
    targetDate = eligible.map((fixture) => easternDate(fixture.scheduled_at)).sort()[0];
    const completedDates = new Map();
    for (const game of completed) {
      const date = easternDate(game.scheduled_at);
      if (date >= targetDate) continue;
      if (!completedDates.has(date)) completedDates.set(date, []);
      completedDates.get(date).push(game);
    }
    for (const [date, games] of [...completedDates.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      updateRatingsForDate(games, ratings);
    }
    for (const fixture of eligible.filter((item) => easternDate(item.scheduled_at) === targetDate)) {
      const homeRating = ratings.get(fixture.home_team) ?? 1500;
      const awayRating = ratings.get(fixture.away_team) ?? 1500;
      forecasts.push({
        id: stableId(MODEL_ID, fixture.fixture_id), fixture_id: fixture.fixture_id,
        scheduled_at: fixture.scheduled_at, home_team: fixture.home_team, away_team: fixture.away_team,
        probability: probability(homeRating, awayRating), data_quality: fixture.data_quality,
        source: "API Ninjas fixture metadata in remote D1",
      });
    }
  }

  const report = {
    generated_at: now.toISOString(), model_name: MODEL_NAME, model_version: MODEL_VERSION,
    model_status: "unverified prospective NBA shadow; fixed reference Elo; no calibrated probabilities",
    target_eastern_date: targetDate,
    completed_current_season_games_used: completed.length,
    forecast_count: forecasts.length,
    inserted_rows_are: { status: "draft", decision: "no_bet", calibrated: 0 },
    public_status: "not published; public basketball picks remain NO BET",
    note: forecasts.length ? "Ratings start at 1500 because the current-season shadow uses only finished 2026-27 results in D1; same-date results are not used to predict other games that date." : "No upcoming NBA fixture passed the date, quality, and source-freshness gates; no forecast rows were inserted.",
  };
  const outputDir = process.env.RUNNER_TEMP || process.cwd();
  const sqlPath = path.join(outputDir, "neobet-basketball-shadow-predictions.sql");
  const jsonPath = path.join(outputDir, "neobet-basketball-shadow-summary.json");
  fs.writeFileSync(sqlPath, toSql({ forecasts }), { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      "# NBA prospective shadow forecasts", "",
      `- Model: ${MODEL_NAME} v${MODEL_VERSION}; fixed Elo reference (K=${K_FACTOR}, home advantage=${HOME_ADVANTAGE_ELO}).`,
      `- Target NBA date (Eastern): ${targetDate || "none; no fixtures passed the data gates"}`,
      `- Completed 2026-27 games used for ratings: ${completed.length}`,
      `- Eligible upcoming fixtures: ${forecasts.length}`,
      "- Every stored row is draft, uncalibrated, and NO BET. Public basketball picks remain NO BET.", "",
    ];
    lines.push("", report.note, "");
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
  }
}

await main();
