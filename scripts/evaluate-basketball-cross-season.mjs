import fs from "node:fs";
import path from "node:path";

const DATASET_SEASONS = ["2022-23", "2023-24", "2024-25", "2025-26"];
const TRAIN_SEASONS = new Set(["2022-23", "2023-24"]);
const VALIDATION_SEASON = "2024-25";
const TEST_SEASON = "2025-26";
const ELO_K = 20;
const HOME_ADVANTAGE_ELO = 65;
const ELO_SCALE = 400;
const SEASON_CARRYOVER = 0.75;
const MIN_TRAIN_GAMES = 1000;
const MIN_VALIDATION_GAMES = 500;
const MIN_TEST_GAMES = 500;
const SOURCE_BASE = "https://www.boxscorelab.com/downloads/";

function sigmoid(value) {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function logit(probability) {
  const bounded = Math.max(1e-12, Math.min(1 - 1e-12, probability));
  return Math.log(bounded / (1 - bounded));
}

function expectedHome(homeRating, awayRating) {
  return sigmoid(Math.LN10 * (homeRating - awayRating + HOME_ADVANTAGE_ELO) / ELO_SCALE);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { value += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(value); value = ""; }
    else if (char === "\n") {
      row.push(value.replace(/\r$/, ""));
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = []; value = "";
    } else value += char;
  }
  if (quoted) throw new Error("The source CSV ended inside a quoted field.");
  row.push(value.replace(/\r$/, ""));
  if (row.some((cell) => cell !== "")) rows.push(row);
  if (rows.length < 2) throw new Error("The source CSV has no data rows.");
  const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"));
  return rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, (cells[index] ?? "").trim()])));
}

function findField(headers, aliases) {
  return aliases.find((name) => headers.includes(name));
}

function requiredField(headers, aliases, label) {
  const field = findField(headers, aliases);
  if (!field) throw new Error(`Could not identify CSV ${label}. Headers received: ${headers.join(", ")}`);
  return field;
}

function parseBoolean(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "y", "home", "h", "vs", "vs."].includes(normalized)) return true;
  if (["false", "0", "no", "n", "away", "a", "@"].includes(normalized)) return false;
  return null;
}

function homeSideFromPair(pair, fields) {
  if (pair.length !== 2) return null;
  const [first, second] = pair;
  const firstTeam = first[fields.team].toLowerCase();

  for (const field of [fields.homeTeam, fields.awayTeam].filter(Boolean)) {
    const values = pair.map((row) => row[field]?.trim().toLowerCase()).filter(Boolean);
    if (values.length !== 2 || values[0] !== values[1]) continue;
    const namedSide = values[0];
    if (namedSide === firstTeam || namedSide === first[fields.opponent].toLowerCase()) {
      const isHomeField = field === fields.homeTeam;
      const firstIsNamedSide = namedSide === firstTeam;
      return isHomeField ? (firstIsNamedSide ? first : second) : (firstIsNamedSide ? second : first);
    }
  }

  for (const row of pair) {
    const team = row[fields.team].trim().toLowerCase();
    const matchup = row[fields.matchup]?.trim().toLowerCase();
    if (!matchup) continue;
    const vs = matchup.match(/^(.+?)\s+vs\.?\s+(.+)$/);
    if (vs && (vs[1].trim() === team || vs[2].trim() === team)) return vs[1].trim() === team ? row : pair.find((entry) => entry !== row);
    const at = matchup.match(/^(.+?)\s*@\s*(.+)$/);
    if (at && (at[1].trim() === team || at[2].trim() === team)) return at[2].trim() === team ? row : pair.find((entry) => entry !== row);
  }

  for (const field of fields.homeFlags) {
    const values = pair.map((row) => parseBoolean(row[field]));
    if (values[0] === true && values[1] === false) return first;
    if (values[0] === false && values[1] === true) return second;
  }
  return null;
}

async function downloadSeason(season) {
  const url = new URL(`${season}-team-game-results.csv`, SOURCE_BASE);
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`BoxScore Lab returned HTTP ${response.status} for ${season} (${url}).`);
  const records = parseCsv(await response.text());
  const headers = Object.keys(records[0]);
  const fields = {
    date: requiredField(headers, ["game_date", "date", "game_date_iso", "date_iso"], "game date"),
    team: requiredField(headers, ["team", "team_name", "team_full_name"], "team name"),
    opponent: requiredField(headers, ["opponent", "opponent_team", "opponent_name", "opp_team"], "opponent name"),
    points: requiredField(headers, ["points", "pts", "team_points", "team_score", "score"], "team score"),
    opponentPoints: requiredField(headers, ["opponent_points", "opp_points", "opponent_pts", "opp_pts", "opponent_score", "opp_score"], "opponent score"),
    gameId: findField(headers, ["game_id", "gameid", "id"]),
    homeTeam: findField(headers, ["home_team", "home_team_name", "home_team_abbreviation", "home_team_abbr"]),
    awayTeam: findField(headers, ["away_team", "away_team_name", "away_team_abbreviation", "away_team_abbr", "visitor_team"]),
    homeFlags: ["is_home", "home_away", "homeaway", "location", "venue", "site", "home"].filter((field) => headers.includes(field)),
    matchup: findField(headers, ["matchup", "match_up", "game_matchup"]),
  };
  if (!fields.homeFlags.length && !fields.matchup && !fields.homeTeam && !fields.awayTeam) {
    throw new Error(`Could not identify a home/away or matchup column in ${season}. Headers received: ${headers.join(", ")}`);
  }

  const groups = new Map();
  for (const row of records) {
    const dateValue = row[fields.date];
    const time = Date.parse(dateValue);
    const team = row[fields.team];
    const opponent = row[fields.opponent];
    const points = Number(row[fields.points]);
    const opponentPoints = Number(row[fields.opponentPoints]);
    if (!Number.isFinite(time) || !team || !opponent || !Number.isFinite(points) || !Number.isFinite(opponentPoints) || points === opponentPoints) continue;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
      ? dateValue
      : new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(time));
    const pair = [team, opponent].sort((a, b) => a.localeCompare(b)).join("|");
    const key = `${season}|${date}|${pair}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...row, __date: date, __team: team, __opponent: opponent, __points: points, __opponent_points: opponentPoints });
  }
  const games = [];
  for (const [key, pair] of groups) {
    if (pair.length !== 2) continue;
    const homeRow = homeSideFromPair(pair, fields);
    if (!homeRow) {
      const indicators = Object.fromEntries([...fields.homeFlags, fields.homeTeam, fields.awayTeam, fields.matchup].filter(Boolean).map((field) => [field, pair.map((row) => row[field])]));
      throw new Error(`Could not unambiguously identify the home team for ${key}. CSV indicators: ${JSON.stringify(indicators)}. No metrics were produced.`);
    }
    const awayRow = pair.find((row) => row !== homeRow);
    games.push({
      season,
      id: fields.gameId ? (homeRow[fields.gameId] || awayRow[fields.gameId] || key) : key,
      date: homeRow.__date,
      home_team: homeRow.__team,
      away_team: awayRow.__team,
      home_score: homeRow.__points,
      away_score: awayRow.__points,
    });
  }
  if (games.length < 1000) throw new Error(`${season} produced only ${games.length} paired regular-season games from ${records.length} rows; refusing to evaluate incomplete input.`);
  return games.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

function carryRatings(ratings) {
  for (const [team, rating] of ratings) ratings.set(team, 1500 + (rating - 1500) * SEASON_CARRYOVER);
}

function predictAndUpdate(games, ratings) {
  const byDate = new Map();
  for (const game of games) {
    if (!byDate.has(game.date)) byDate.set(game.date, []);
    byDate.get(game.date).push(game);
  }
  const predictions = [];
  for (const [date, dateGames] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const day = dateGames.map((game) => {
      const homeRating = ratings.get(game.home_team) ?? 1500;
      const awayRating = ratings.get(game.away_team) ?? 1500;
      return { game, probability: expectedHome(homeRating, awayRating), homeRating, awayRating };
    });
    predictions.push(...day);
    const deltas = new Map();
    for (const item of day) {
      const actual = item.game.home_score > item.game.away_score ? 1 : 0;
      const delta = ELO_K * (actual - item.probability);
      deltas.set(item.game.home_team, (deltas.get(item.game.home_team) || 0) + delta);
      deltas.set(item.game.away_team, (deltas.get(item.game.away_team) || 0) - delta);
    }
    for (const [team, delta] of deltas) ratings.set(team, (ratings.get(team) ?? 1500) + delta);
  }
  return predictions;
}

function logLoss(items, transform = (p) => p) {
  return items.reduce((sum, item) => {
    const p = Math.max(1e-12, Math.min(1 - 1e-12, transform(item.probability)));
    return sum - (item.actual ? Math.log(p) : Math.log(1 - p));
  }, 0) / items.length;
}

function fitTemperature(items) {
  const lossAt = (temperature) => logLoss(items, (p) => sigmoid(logit(p) / temperature));
  let left = 0.1;
  let right = 10;
  const ratio = (Math.sqrt(5) - 1) / 2;
  let x1 = right - ratio * (right - left);
  let x2 = left + ratio * (right - left);
  let f1 = lossAt(x1);
  let f2 = lossAt(x2);
  for (let step = 0; step < 100; step += 1) {
    if (f1 <= f2) { right = x2; x2 = x1; f2 = f1; x1 = right - ratio * (right - left); f1 = lossAt(x1); }
    else { left = x1; x1 = x2; f1 = f2; x2 = left + ratio * (right - left); f2 = lossAt(x2); }
  }
  return (left + right) / 2;
}

function metrics(items, transform = (p) => p) {
  let correct = 0;
  let brier = 0;
  const bins = Array.from({ length: 10 }, (_, index) => ({ range: `${index * 10}-${(index + 1) * 10}%`, games: 0, predicted: 0, observed: 0 }));
  for (const item of items) {
    const probability = Math.max(1e-12, Math.min(1 - 1e-12, transform(item.probability)));
    if ((probability >= 0.5 ? 1 : 0) === item.actual) correct += 1;
    brier += (probability - item.actual) ** 2;
    const bin = bins[Math.min(9, Math.floor(probability * 10))];
    bin.games += 1; bin.predicted += probability; bin.observed += item.actual;
  }
  let ece = 0;
  for (const bin of bins) {
    if (!bin.games) continue;
    bin.mean_predicted = bin.predicted / bin.games;
    bin.observed_frequency = bin.observed / bin.games;
    ece += bin.games / items.length * Math.abs(bin.mean_predicted - bin.observed_frequency);
    delete bin.predicted; delete bin.observed;
  }
  return { games: items.length, accuracy: correct / items.length, brier_score: brier / items.length, log_loss: logLoss(items, transform), ece, calibration_bins: bins.filter((bin) => bin.games) };
}

function addActual(predictions) {
  return predictions.map(({ game, probability }) => ({ game, probability, actual: game.home_score > game.away_score ? 1 : 0 }));
}

function pct(value) { return value == null ? "—" : `${(value * 100).toFixed(2)}%`; }
function num(value) { return value == null ? "—" : value.toFixed(4); }

async function main() {
  const seasons = new Map();
  for (const season of DATASET_SEASONS) seasons.set(season, await downloadSeason(season));

  const ratings = new Map();
  let train = [];
  let validation = [];
  let test = [];
  for (const season of DATASET_SEASONS) {
    if (season !== DATASET_SEASONS[0]) carryRatings(ratings);
    const predictions = predictAndUpdate(seasons.get(season), ratings);
    if (TRAIN_SEASONS.has(season)) train.push(...addActual(predictions));
    else if (season === VALIDATION_SEASON) validation = addActual(predictions);
    else if (season === TEST_SEASON) test = addActual(predictions);
  }
  if (train.length < MIN_TRAIN_GAMES || validation.length < MIN_VALIDATION_GAMES || test.length < MIN_TEST_GAMES) {
    throw new Error(`Cross-season evaluation blocked by insufficient paired games: training=${train.length}, validation=${validation.length}, test=${test.length}. Required ${MIN_TRAIN_GAMES}/${MIN_VALIDATION_GAMES}/${MIN_TEST_GAMES}.`);
  }

  const temperature = fitTemperature(validation);
  const pretest = [...train, ...validation];
  const homeRate = pretest.filter((item) => item.actual === 1).length / pretest.length;
  const metricsByMethod = {
    raw_elo: metrics(test),
    temperature_scaled_elo: metrics(test, (p) => sigmoid(logit(p) / temperature)),
    pretest_home_win_rate_baseline: metrics(test.map((item) => ({ ...item, probability: homeRate }))),
  };
  const report = {
    generated_at: new Date().toISOString(),
    source: { name: "BoxScore Lab NBA team game results", url: "https://www.boxscorelab.com/downloads/", license: "CC BY 4.0", attribution: `BoxScore Lab, boxscorelab.com; data downloaded ${new Date().toISOString().slice(0, 10)}. Statistics originate from NBA Stats. BoxScore Lab is not affiliated with the NBA.`, rows_are_team_game_rows: true },
    evaluation_type: "cross-season chronological prequential evaluation; results from each date update team ratings only for later dates; ratings regress toward league average between seasons",
    seasons: { training: [...TRAIN_SEASONS], calibration_validation: VALIDATION_SEASON, final_untouched_test: TEST_SEASON, excluded_ongoing_season: "2026-27" },
    game_counts: { training: train.length, calibration_validation: validation.length, final_untouched_test: test.length, paired_games_by_season: Object.fromEntries([...seasons].map(([season, games]) => [season, games.length])) },
    model: { name: "NBA Elo home-win probability baseline", k_factor: ELO_K, home_advantage_elo: HOME_ADVANTAGE_ELO, season_carryover: SEASON_CARRYOVER, temperature_fitted_only_on: VALIDATION_SEASON, fitted_temperature: temperature, baseline_home_win_rate_fitted_before_test: homeRate },
    validation_metrics: { raw_elo_log_loss: logLoss(validation), temperature_scaled_elo_log_loss: logLoss(validation, (p) => sigmoid(logit(p) / temperature)) },
    held_out_test_metrics: metricsByMethod,
    public_status: "evaluation only; no basketball probabilities or picks approved for publication; keep NO BET safeguards",
    limitations: ["This is a score-history Elo baseline, not a production model and not evidence of betting value.", "The final test is one complete past NBA season; results may not transfer to future seasons.", "WNBA is not included because the licensed historical data source used here covers NBA only.", "BoxScore Lab republishes nightly during the season; reports must be interpreted with the retrieval date and source attribution."],
  };
  const outputDir = process.env.RUNNER_TEMP || process.cwd();
  const reportPath = path.join(outputDir, "neobet-basketball-cross-season-evaluation.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));

  if (process.env.GITHUB_STEP_SUMMARY) {
    const methods = [
      ["Raw Elo", metricsByMethod.raw_elo],
      ["Temperature-scaled Elo", metricsByMethod.temperature_scaled_elo],
      ["Pre-test home-win-rate baseline", metricsByMethod.pretest_home_win_rate_baseline],
    ];
    const lines = [
      "# NeoBet NBA cross-season evaluation", "",
      `- Data: [BoxScore Lab NBA team game results](${report.source.url}), CC BY 4.0. Attribution: ${report.source.attribution}`,
      `- Training seasons: ${[...TRAIN_SEASONS].join(", ")} (${train.length} games)`,
      `- Calibration season: ${VALIDATION_SEASON} (${validation.length} games); temperature fitted only here: ${temperature.toFixed(4)}`,
      `- Untouched final test: ${TEST_SEASON} (${test.length} games)`,
      "- Ongoing 2026-27 excluded. Predictions are prequential; same-date games do not update ratings until the next date.",
      "- Public status: evaluation only. Do not publish these as approved picks; basketball remains NO BET.", "",
      "| Test method | Games | Accuracy | Brier (lower better) | Log loss (lower better) | Mean ECE (lower better) |",
      "|---|---:|---:|---:|---:|---:|",
    ];
    for (const [name, result] of methods) lines.push(`| ${name} | ${result.games} | ${pct(result.accuracy)} | ${num(result.brier_score)} | ${num(result.log_loss)} | ${pct(result.ece)} |`);
    lines.push("", "This is an evaluation report, not a recommendation or proof of betting value. BoxScore Lab data is from NBA Stats; BoxScore Lab is not affiliated with the NBA.", "");
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
  }
}

await main();
