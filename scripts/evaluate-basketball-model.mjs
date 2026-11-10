import fs from "node:fs";
import path from "node:path";

const ACCOUNT_ID = requireEnv("CLOUDFLARE_ACCOUNT_ID");
const DATABASE_ID = requireEnv("CLOUDFLARE_D1_DATABASE_ID");
const API_TOKEN = requireEnv("CLOUDFLARE_API_TOKEN");
const LEAGUES = ["NBA", "WNBA"];
const TRAIN_FRACTION = 0.6;
const VALIDATION_FRACTION = 0.2;
const MIN_TRAIN_GAMES = 100;
const MIN_VALIDATION_GAMES = 30;
const MIN_TEST_GAMES = 30;
const ELO_K = 20;
const HOME_ADVANTAGE_ELO = 65;
const ELO_SCALE = 400;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing from GitHub Actions secrets or environment.`);
  return value;
}

async function queryD1(sql) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(ACCOUNT_ID)}/d1/database/${encodeURIComponent(DATABASE_ID)}/query`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ sql }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Cloudflare D1 query returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (!payload.success) {
    const detail = (payload.errors || []).map((entry) => entry.message).filter(Boolean).join("; ");
    throw new Error(`Cloudflare D1 query failed${detail ? `: ${detail}` : "."}`);
  }
  const rows = payload.result?.[0]?.results;
  if (!Array.isArray(rows)) throw new Error("Cloudflare D1 returned no basketball fixture rows.");
  return rows;
}

function sigmoid(value) {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function logit(probability) {
  const bounded = Math.max(1e-12, Math.min(1 - 1e-12, probability));
  return Math.log(bounded / (1 - bounded));
}

function probability(homeRating, awayRating) {
  return sigmoid(Math.LN10 * (homeRating - awayRating + HOME_ADVANTAGE_ELO) / ELO_SCALE);
}

function outcome(game) {
  return game.home_score > game.away_score ? 1 : 0;
}

function leagueGameDate(scheduledAt) {
  const date = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(scheduledAt)).map((part) => [part.type, part.value]));
  return `${date.year}-${date.month}-${date.day}`;
}

function rollingPredictions(games) {
  const ratings = new Map();
  const days = new Map();
  for (const game of games) {
    const day = leagueGameDate(game.scheduled_at);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(game);
  }

  const predictions = [];
  for (const [day, dayGames] of [...days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const dayRatings = dayGames.map((game) => ({
      game,
      homeRating: ratings.get(game.home_team) ?? 1500,
      awayRating: ratings.get(game.away_team) ?? 1500,
    }));
    for (const item of dayRatings) {
      predictions.push({ game: item.game, probability: probability(item.homeRating, item.awayRating) });
    }

    const deltas = new Map();
    for (const item of dayRatings) {
      const expectedHome = probability(item.homeRating, item.awayRating);
      const delta = ELO_K * (outcome(item.game) - expectedHome);
      deltas.set(item.game.home_team, (deltas.get(item.game.home_team) || 0) + delta);
      deltas.set(item.game.away_team, (deltas.get(item.game.away_team) || 0) - delta);
    }
    for (const [team, delta] of deltas) ratings.set(team, (ratings.get(team) ?? 1500) + delta);
  }
  return predictions;
}

function logLoss(items, transform = (p) => p) {
  if (!items.length) return null;
  return items.reduce((sum, item) => {
    const p = Math.max(1e-12, Math.min(1 - 1e-12, transform(item.probability)));
    return sum - (item.actual ? Math.log(p) : Math.log(1 - p));
  }, 0) / items.length;
}

function fitTemperature(validation) {
  const lossAt = (temperature) => logLoss(validation, (p) => sigmoid(logit(p) / temperature));
  let left = 0.1;
  let right = 10;
  const ratio = (Math.sqrt(5) - 1) / 2;
  let x1 = right - ratio * (right - left);
  let x2 = left + ratio * (right - left);
  let f1 = lossAt(x1);
  let f2 = lossAt(x2);
  for (let iteration = 0; iteration < 100; iteration += 1) {
    if (f1 <= f2) {
      right = x2; x2 = x1; f2 = f1;
      x1 = right - ratio * (right - left); f1 = lossAt(x1);
    } else {
      left = x1; x1 = x2; f1 = f2;
      x2 = left + ratio * (right - left); f2 = lossAt(x2);
    }
  }
  return (left + right) / 2;
}

function metrics(items, transform = (p) => p) {
  if (!items.length) return { games: 0, accuracy: null, brier_score: null, log_loss: null, ece: null, calibration_bins: [] };
  let correct = 0;
  let brier = 0;
  const bins = Array.from({ length: 10 }, (_, index) => ({
    range: `${index * 10}-${(index + 1) * 10}%`, games: 0, mean_predicted: 0, observed_frequency: 0,
  }));
  for (const item of items) {
    const p = Math.max(1e-12, Math.min(1 - 1e-12, transform(item.probability)));
    const actual = item.actual;
    if ((p >= 0.5 ? 1 : 0) === actual) correct += 1;
    brier += (p - actual) ** 2;
    const bin = bins[Math.min(9, Math.floor(p * 10))];
    bin.games += 1; bin.mean_predicted += p; bin.observed_frequency += actual;
  }
  let ece = 0;
  for (const bin of bins) {
    if (!bin.games) continue;
    bin.mean_predicted /= bin.games;
    bin.observed_frequency /= bin.games;
    ece += bin.games / items.length * Math.abs(bin.mean_predicted - bin.observed_frequency);
  }
  return {
    games: items.length,
    accuracy: correct / items.length,
    brier_score: brier / items.length,
    log_loss: logLoss(items, transform),
    ece,
    calibration_bins: bins.filter((bin) => bin.games > 0),
  };
}

function evaluateSeason(games) {
  const dates = [...new Set(games.map((game) => leagueGameDate(game.scheduled_at)))].sort();
  const trainEnd = Math.floor(dates.length * TRAIN_FRACTION);
  const validationEnd = Math.floor(dates.length * (TRAIN_FRACTION + VALIDATION_FRACTION));
  const validationDates = new Set(dates.slice(trainEnd, validationEnd));
  const testDates = new Set(dates.slice(validationEnd));
  const allPredictions = rollingPredictions(games);
  const training = allPredictions.filter(({ game }) => !validationDates.has(leagueGameDate(game.scheduled_at)) && !testDates.has(leagueGameDate(game.scheduled_at)));
  const validation = allPredictions.filter(({ game }) => validationDates.has(leagueGameDate(game.scheduled_at)));
  const test = allPredictions.filter(({ game }) => testDates.has(leagueGameDate(game.scheduled_at)));
  const counts = { training_games: training.length, validation_games: validation.length, held_out_games: test.length };
  if (training.length < MIN_TRAIN_GAMES || validation.length < MIN_VALIDATION_GAMES || test.length < MIN_TEST_GAMES) {
    return {
      status: "INSUFFICIENT_HISTORY",
      seasons: [...new Set(games.map((game) => game.season))],
      completed_games: games.length,
      distinct_game_dates: dates.length,
      ...counts,
      message: `Need at least ${MIN_TRAIN_GAMES} training, ${MIN_VALIDATION_GAMES} validation, and ${MIN_TEST_GAMES} held-out completed games.`,
    };
  }
  const temperature = fitTemperature(validation);
  const homeRate = training.filter(({ game }) => outcome(game) === 1).length / training.length;
  const constantHome = test.map(({ game }) => ({ game, actual: outcome(game), probability: homeRate }));
  const rawTest = test.map(({ game, probability: p }) => ({ game, actual: outcome(game), probability: p }));
  const validationWithTargets = validation.map(({ game, probability: p }) => ({ game, actual: outcome(game), probability: p }));
  const evaluated = {
    raw_elo: metrics(rawTest),
    temperature_scaled_elo: metrics(rawTest, (p) => sigmoid(logit(p) / temperature)),
    training_home_win_rate_baseline: metrics(constantHome),
  };
  const rawValidationLoss = logLoss(validationWithTargets);
  const scaledValidationLoss = logLoss(validationWithTargets, (p) => sigmoid(logit(p) / temperature));
  const testStart = test.reduce((min, item) => item.game.scheduled_at < min ? item.game.scheduled_at : min, test[0].game.scheduled_at);
  const testEnd = test.reduce((max, item) => item.game.scheduled_at > max ? item.game.scheduled_at : max, test[0].game.scheduled_at);
  return {
    status: "EVALUATED_WITHIN_SEASON",
    seasons: [...new Set(games.map((game) => game.season))],
    completed_games: games.length,
    distinct_game_dates: dates.length,
    ...counts,
    validation_temperature: temperature,
    validation_log_loss_raw: rawValidationLoss,
    validation_log_loss_temperature_scaled: scaledValidationLoss,
    final_held_out_window: { from: testStart, through: testEnd },
    metrics: evaluated,
    note: "Chronological holdout within the available season, not an unseen-season test. Evaluation only; no public prediction approval.",
  };
}

async function main() {
  const rows = await queryD1(`
    SELECT f.id AS fixture_id, f.scheduled_at, f.status, f.home_score, f.away_score,
      f.data_quality, competition.name AS competition, season.name AS season,
      home.name AS home_team, away.name AS away_team
    FROM fixtures AS f
    JOIN competitions AS competition ON competition.id = f.competition_id
    LEFT JOIN seasons AS season ON season.id = f.season_id
    JOIN teams AS home ON home.id = f.home_team_id
    JOIN teams AS away ON away.id = f.away_team_id
    WHERE f.sport = 'basketball' AND f.id LIKE 'api-ninjas:fixture:%'
      AND competition.name IN ('NBA', 'WNBA')
    ORDER BY competition.name, season.name, f.scheduled_at ASC
  `);
  const grouped = new Map();
  const skipped = Object.fromEntries(LEAGUES.map((league) => [league, { non_final: 0, missing_scores: 0, low_quality: 0 }]));
  for (const row of rows) {
    if (!LEAGUES.includes(row.competition)) continue;
    const skip = skipped[row.competition];
    if (row.status !== "finished") { skip.non_final += 1; continue; }
    if (!Number.isInteger(row.home_score) || !Number.isInteger(row.away_score) || row.home_score === row.away_score) { skip.missing_scores += 1; continue; }
    if (row.data_quality !== "good") { skip.low_quality += 1; continue; }
    if (!Number.isFinite(Date.parse(row.scheduled_at)) || !row.home_team || !row.away_team) { skip.missing_scores += 1; continue; }
    const season = row.season || "season-unavailable";
    const key = `${row.competition}|${season}`;
    if (!grouped.has(key)) grouped.set(key, { competition: row.competition, season, games: [] });
    grouped.get(key).games.push(row);
  }

  const evaluations = [];
  for (const league of LEAGUES) {
    const seasons = [...grouped.values()].filter((entry) => entry.competition === league);
    if (!seasons.length) {
      evaluations.push({ competition: league, status: "INSUFFICIENT_HISTORY", completed_games: 0,
        message: "No good-quality completed API Ninjas fixtures are available in D1." });
      continue;
    }
    for (const entry of seasons) {
      evaluations.push({ competition: league, season: entry.season, ...evaluateSeason(entry.games) });
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    source: "API Ninjas current-season results already stored in remote D1",
    evaluation_type: "per-league chronological within-season prequential holdout; games share an Eastern Time calendar date and that date's scores update Elo only on the next date",
    split: { training_fraction: TRAIN_FRACTION, validation_fraction: VALIDATION_FRACTION, final_held_out_fraction: 1 - TRAIN_FRACTION - VALIDATION_FRACTION },
    model: { name: "basketball Elo baseline", home_advantage_elo: HOME_ADVANTAGE_ELO, k_factor: ELO_K,
      calibration: "single temperature fitted only on the validation window" },
    public_status: "evaluation only; all basketball selections remain NO BET",
    source_limitations: [
      "API Ninjas Free provides current-season basketball data only; this cannot establish cross-season generalization.",
      "Do not publish forecasts from this evaluation. Holdout metrics do not by themselves approve public picks.",
    ],
    rows_read: rows.length,
    skipped_rows: skipped,
    evaluations,
  };
  const outputDir = process.env.RUNNER_TEMP || process.cwd();
  const reportPath = path.join(outputDir, "neobet-basketball-evaluation.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      "# NeoBet basketball model evaluation",
      "",
      `- Source: ${report.source}`,
      `- Evaluation: ${report.evaluation_type}`,
      `- Public status: ${report.public_status}`,
      "",
      "| League | Season | Status | Completed | Train | Validation | Held out | Raw Brier | Scaled Brier | Raw log loss | Scaled log loss |",
      "|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ];
    for (const result of evaluations) {
      const raw = result.metrics?.raw_elo;
      const scaled = result.metrics?.temperature_scaled_elo;
      lines.push(`| ${result.competition} | ${result.season || "—"} | ${result.status} | ${result.completed_games ?? 0} | ${result.training_games ?? 0} | ${result.validation_games ?? 0} | ${result.held_out_games ?? 0} | ${raw ? raw.brier_score.toFixed(4) : "—"} | ${scaled ? scaled.brier_score.toFixed(4) : "—"} | ${raw ? raw.log_loss.toFixed(4) : "—"} | ${scaled ? scaled.log_loss.toFixed(4) : "—"} |`);
    }
    lines.push("", "Metrics are chronological and evaluation-only. Same-day results are excluded from rating updates until the following date.",
      "The free API source has only current-season history, so this report does not test transfer to a new season.", "");
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
  }
}

await main();
