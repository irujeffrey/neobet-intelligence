import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ACCOUNT_ID = requireEnv("CLOUDFLARE_ACCOUNT_ID");
const DATABASE_ID = requireEnv("CLOUDFLARE_D1_DATABASE_ID");
const API_TOKEN = requireEnv("CLOUDFLARE_API_TOKEN");
const MODEL_NAME = "rolling-goal-rate-poisson-dirichlet-shadow";
const MODEL_VERSION = "0.1.0";
const COMPETITIONS = [
  { code: "en.1", name: "Premier League", modelName: MODEL_NAME, modelVersionId: "football-poisson-dirichlet-shadow-0-1-0" },
  { code: "pt.1", name: "Primeira Liga", modelName: \${MODEL_NAME}-pt-1`, modelVersionId: "football-poisson-dirichlet-shadow-pt-1-0-1-0" },
];
const OUTCOMES = ["home", "draw", "away"];
const HALF_LIFE_DAYS = 730;
const SHRINKAGE_MATCHES = 8;
const MAX_GOALS = 15;
const REGULARIZATION = 0.02;

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

function seasonStart(season) { return Number(String(season).slice(0, 4)); }

function completedSeasons(rows) {
  const seasons = new Map();
  for (const row of rows) {
    if (!seasons.has(row.season)) seasons.set(row.season, []);
    seasons.get(row.season).push(row);
  }
  return [...seasons.entries()].filter(([, matches]) => {
    const homeCounts = new Map();
    const awayCounts = new Map();
    for (const match of matches) {
      homeCounts.set(match.home_team, (homeCounts.get(match.home_team) || 0) + 1);
      awayCounts.set(match.away_team, (awayCounts.get(match.away_team) || 0) + 1);
    }
    const teams = new Set([...homeCounts.keys(), ...awayCounts.keys()]);
    const teamCount = teams.size;
    return teamCount >= 10 && matches.length === teamCount * (teamCount - 1) &&
      [...teams].every((team) => homeCounts.get(team) === teamCount - 1 && awayCounts.get(team) === teamCount - 1);
  }).map(([season]) => season).sort((a, b) => seasonStart(a) - seasonStart(b));
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

function canonicalTeam(name) {
  const normalized = String(name || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/\b(and)\b/g, " ").replace(/\b(fc|afc|cf|sc|ac)\b/g, " ")
    .replace(/\s+/g, " ").trim();
  const aliases = {
    "man united": "manchester united", "man utd": "manchester united",
    "man city": "manchester city", "wolves": "wolverhampton wanderers",
    "spurs": "tottenham hotspur", "west ham": "west ham united",
    "newcastle": "newcastle united", "leeds": "leeds united",
    "nottingham": "nottingham forest", "brighton hove albion": "brighton hove albion",
    "bournemouth": "bournemouth", "leicester": "leicester city",
    "ipswich": "ipswich town", "sheffield utd": "sheffield united",
  };
  return aliases[normalized] || normalized;
}

function teamStats(name, teams) {
  const key = canonicalTeam(name);
  if (!teams.has(key)) teams.set(key, {
    homeWeight: 0, homeScored: 0, homeConceded: 0,
    awayWeight: 0, awayScored: 0, awayConceded: 0,
  });
  return teams.get(key);
}

function weightedStats(rows, targetDate) {
  const targetMs = Date.parse(`${targetDate}T00:00:00.000Z`);
  const teams = new Map();
  let homeGoals = 0;
  let awayGoals = 0;
  let weightTotal = 0;
  const outcomeWeights = [0, 0, 0];
  for (const match of rows) {
    if (match.match_date >= targetDate) continue;
    const ageDays = Math.max(0, (targetMs - Date.parse(`${match.match_date}T00:00:00.000Z`)) / 86400000);
    const weight = Math.exp(-Math.LN2 * ageDays / HALF_LIFE_DAYS);
    const home = teamStats(match.home_team, teams);
    const away = teamStats(match.away_team, teams);
    homeGoals += match.home_goals * weight;
    awayGoals += match.away_goals * weight;
    weightTotal += weight;
    home.homeWeight += weight;
    home.homeScored += match.home_goals * weight;
    home.homeConceded += match.away_goals * weight;
    away.awayWeight += weight;
    away.awayScored += match.away_goals * weight;
    away.awayConceded += match.home_goals * weight;
    const outcome = match.home_goals > match.away_goals ? 0 : match.home_goals === match.away_goals ? 1 : 2;
    outcomeWeights[outcome] += weight;
  }
  if (!weightTotal) return null;
  return {
    teams,
    averageHomeGoals: homeGoals / weightTotal,
    averageAwayGoals: awayGoals / weightTotal,
    outcomeWeights,
  };
}

function poissonDistribution(lambda) {
  const bounded = Math.max(0.1, Math.min(5, lambda));
  const values = [Math.exp(-bounded)];
  for (let goals = 1; goals <= MAX_GOALS; goals += 1) values.push(values[goals - 1] * bounded / goals);
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => value / total);
}

function teamRate(team, side, metric, leagueAverage) {
  if (!team) return leagueAverage;
  const weight = side === "home" ? team.homeWeight : team.awayWeight;
  const total = side === "home"
    ? (metric === "scored" ? team.homeScored : team.homeConceded)
    : (metric === "scored" ? team.awayScored : team.awayConceded);
  return (total + SHRINKAGE_MATCHES * leagueAverage) / (weight + SHRINKAGE_MATCHES);
}

function rawProbabilities(match, stats) {
  if (!stats) return [1 / 3, 1 / 3, 1 / 3];
  const homeTeam = stats.teams.get(canonicalTeam(match.home_team));
  const awayTeam = stats.teams.get(canonicalTeam(match.away_team));
  const homeAttack = teamRate(homeTeam, "home", "scored", stats.averageHomeGoals) / stats.averageHomeGoals;
  const homeDefence = teamRate(homeTeam, "home", "conceded", stats.averageAwayGoals) / stats.averageAwayGoals;
  const awayAttack = teamRate(awayTeam, "away", "scored", stats.averageAwayGoals) / stats.averageAwayGoals;
  const awayDefence = teamRate(awayTeam, "away", "conceded", stats.averageHomeGoals) / stats.averageHomeGoals;
  const homeGoals = poissonDistribution(stats.averageHomeGoals * homeAttack * awayDefence);
  const awayGoals = poissonDistribution(stats.averageAwayGoals * awayAttack * homeDefence);
  const probabilities = [0, 0, 0];
  for (let home = 0; home <= MAX_GOALS; home += 1) {
    for (let away = 0; away <= MAX_GOALS; away += 1) {
      probabilities[home > away ? 0 : home === away ? 1 : 2] += homeGoals[home] * awayGoals[away];
    }
  }
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  return probabilities.map((value) => value / total);
}

function applyDirichlet(probabilities, weights, bias) {
  const logs = probabilities.map((value) => Math.log(Math.max(1e-15, value)));
  const logits = OUTCOMES.map((_, outcome) => bias[outcome] + logs.reduce(
    (sum, value, input) => sum + weights[outcome * 3 + input] * value, 0,
  ));
  const max = Math.max(...logits);
  const exp = logits.map((value) => Math.exp(value - max));
  const total = exp.reduce((sum, value) => sum + value, 0);
  return exp.map((value) => value / total);
}

function objective(predictions, weights, bias) {
  let loss = 0;
  for (const item of predictions) {
    const probabilities = applyDirichlet(item.probabilities, weights, bias);
    loss -= Math.log(Math.max(1e-15, probabilities[item.actual]));
  }
  loss /= predictions.length;
  for (let outcome = 0; outcome < 3; outcome += 1) {
    for (let input = 0; input < 3; input += 1) {
      const difference = weights[outcome * 3 + input] - (outcome === input ? 1 : 0);
      loss += REGULARIZATION * difference * difference / 2;
    }
    loss += REGULARIZATION * bias[outcome] * bias[outcome] / 2;
  }
  return loss;
}

function gradient(predictions, weights, bias) {
  const gradWeights = Array(9).fill(0);
  const gradBias = Array(3).fill(0);
  for (const item of predictions) {
    const probabilities = applyDirichlet(item.probabilities, weights, bias);
    const logs = item.probabilities.map((value) => Math.log(Math.max(1e-15, value)));
    for (let outcome = 0; outcome < 3; outcome += 1) {
      const error = probabilities[outcome] - (item.actual === outcome ? 1 : 0);
      gradBias[outcome] += error;
      for (let input = 0; input < 3; input += 1) gradWeights[outcome * 3 + input] += error * logs[input];
    }
  }
  for (let outcome = 0; outcome < 3; outcome += 1) {
    gradBias[outcome] = gradBias[outcome] / predictions.length + REGULARIZATION * bias[outcome];
    for (let input = 0; input < 3; input += 1) {
      const index = outcome * 3 + input;
      gradWeights[index] = gradWeights[index] / predictions.length +
        REGULARIZATION * (weights[index] - (outcome === input ? 1 : 0));
    }
  }
  return { gradWeights, gradBias };
}

function fitDirichlet(predictions) {
  if (predictions.length < 300) throw new Error("At least 300 historical calibration predictions are required.");
  let weights = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let bias = [0, 0, 0];
  let loss = objective(predictions, weights, bias);
  for (let iteration = 0; iteration < 2000; iteration += 1) {
    const { gradWeights, gradBias } = gradient(predictions, weights, bias);
    const norm = [...gradWeights, ...gradBias].reduce((sum, value) => sum + value * value, 0);
    if (norm < 1e-12) break;
    let step = 1;
    let accepted = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const nextWeights = weights.map((value, index) => value - step * gradWeights[index]);
      const nextBias = bias.map((value, index) => value - step * gradBias[index]);
      const nextLoss = objective(predictions, nextWeights, nextBias);
      if (nextLoss <= loss - 1e-4 * step * norm) {
        weights = nextWeights;
        bias = nextBias;
        loss = nextLoss;
        accepted = true;
        break;
      }
      step /= 2;
    }
    if (!accepted) break;
  }
  return { weights, bias };
}

function mainOutcome(match) {
  return match.home_goals > match.away_goals ? 0 : match.home_goals === match.away_goals ? 1 : 2;
}

function insertPrediction(row) {
  const id = stableId(row.fixture_id, row.model_version_id, row.selection);
  return `INSERT OR IGNORE INTO predictions (
    id, fixture_id, model_version_id, sport, market, selection, decision, probability,
    calibrated, model_confidence, model_uncertainty, data_quality, value_estimate,
    odds_required, odds_snapshot_id, no_bet_reason, explanation, model_name,
    model_version, status, published_at
  ) VALUES (
    ${sql(id)}, ${sql(row.fixture_id)}, ${sql(row.model_version_id)}, 'football', '1X2',
    ${sql(row.selection)}, 'no_bet', ${row.probability.toFixed(10)}, 0, NULL, NULL,
    ${sql(row.data_quality)}, NULL, 0, NULL,
    'Shadow estimate only; model calibration is not approved for publication.',
     ${sql(row.explanation)}, ${sql(row.model_name)}, ${sql(MODEL_VERSION)}, 'draft', NULL
  );`;
}

async function main() {
  const history = await queryD1(`
    SELECT competition_code, season, match_date, home_team, away_team, home_goals, away_goals
    FROM historical_match_results
    WHERE provider_id = 'openfootball' AND competition_code IN (${COMPETITIONS.map(({ code }) => sql(code)).join(",")})
    ORDER BY competition_code, match_date ASC, season ASC
  `);
  const validHistory = history.filter((row) =>
    typeof row.season === "string" && typeof row.match_date === "string" &&
    typeof row.home_team === "string" && typeof row.away_team === "string" &&
    Number.isInteger(row.home_goals) && Number.isInteger(row.away_goals),
  );
  const profiles = COMPETITIONS.map((competition) => {
    const rows = validHistory.filter((row) => row.competition_code === competition.code);
    const seasons = completedSeasons(rows);
    const calibrationSeasons = seasons.slice(-3);
    if (calibrationSeasons.length !== 3 || calibrationSeasons.some((season, index) =>
      index > 0 && seasonStart(season) - seasonStart(calibrationSeasons[index - 1]) !== 1)) {
      throw new Error(`${competition.name} needs three consecutive complete historical seasons for shadow-only calibration; found ${seasons.join(", ") || "none"}.`);
    }
    const calibrationRows = rows.filter((row) => calibrationSeasons.includes(row.season));
    const calibrationPredictions = calibrationRows.map((match) => ({
      probabilities: rawProbabilities(match, weightedStats(rows, match.match_date)),
      actual: mainOutcome(match),
    }));
    return { ...competition, rows, seasons: calibrationSeasons, calibrationPredictions,
      trainingDataStart: calibrationRows.map((row) => row.match_date).sort()[0],
      trainingDataEnd: calibrationRows.map((row) => row.match_date).sort().at(-1),
      dirichlet: fitDirichlet(calibrationPredictions) };
  });

  const now = new Date();
  const start = now.toISOString();
  const end = new Date(now.getTime() + 30 * 86400000).toISOString();
  const fixtures = await queryD1(`
    SELECT f.id AS fixture_id, f.scheduled_at, f.data_quality, f.source_updated_at,
      home.name AS home_team, away.name AS away_team, competition.name AS competition
    FROM fixtures AS f
    JOIN teams AS home ON home.id = f.home_team_id
    JOIN teams AS away ON away.id = f.away_team_id
    LEFT JOIN competitions AS competition ON competition.id = f.competition_id
    WHERE f.sport = 'football' AND f.status = 'scheduled'
      AND competition.name IN (${COMPETITIONS.map(({ name }) => sql(name)).join(",")})
      AND f.scheduled_at >= ${sql(start)} AND f.scheduled_at < ${sql(end)}
    ORDER BY f.scheduled_at ASC
    LIMIT 100
  `);

  const sqlStatements = profiles.map((profile) => `INSERT OR IGNORE INTO model_versions (
      id, sport, model_name, version, calibration_method, calibration_status,
      training_data_start, training_data_end
    ) VALUES (
        ${sql(profile.modelVersionId)}, 'football', ${sql(profile.modelName)}, ${sql(MODEL_VERSION)},
      ${sql(`L2-regularized Dirichlet; shadow-only; ${profile.code}`)}, 'unverified',

      ${sql(profile.trainingDataStart)}, ${sql(profile.trainingDataEnd)}
    );`);
  let preparedPredictions = 0;
  for (const fixture of fixtures) {
    const profile = profiles.find((entry) => entry.name === fixture.competition);
    if (!profile) continue;
    const targetDate = String(fixture.scheduled_at).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) continue;
    const stats = weightedStats(profile.rows, targetDate);
    const probabilities = applyDirichlet(rawProbabilities(fixture, stats), profile.dirichlet.weights, profile.dirichlet.bias);
    const bothTeamsKnown = stats?.teams.has(canonicalTeam(fixture.home_team)) &&
      stats?.teams.has(canonicalTeam(fixture.away_team));
    const dataQuality = ["good", "fair", "poor", "unavailable"].includes(fixture.data_quality)
      ? fixture.data_quality : "unavailable";
    const explanation = `Shadow-only 1X2 estimate. Rolling score data through ${targetDate}; ${bothTeamsKnown ? "team names matched historical records" : "one or both teams lack a historical-name match"}. Not calibrated/approved for public picks; odds and betting value are not assessed.`;
    for (let index = 0; index < OUTCOMES.length; index += 1) {
      sqlStatements.push(insertPrediction({
        fixture_id: fixture.fixture_id,
         model_name: profile.modelName,
        selection: OUTCOMES[index],
        probability: probabilities[index],
        data_quality: bothTeamsKnown ? dataQuality : "fair",
        explanation,
      }));
      preparedPredictions += 1;
    }
  }

  const outputDir = process.env.RUNNER_TEMP || process.cwd();
  const sqlPath = path.join(outputDir, "neobet-football-shadow-predictions.sql");
  fs.writeFileSync(sqlPath, `${sqlStatements.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  const summary = {
    model_name: MODEL_NAME,
    model_version: MODEL_VERSION,
    model_status: "unverified_shadow_only",
    calibration_method: "L2-regularized Dirichlet on rolling Poisson 1X2 probabilities",
    competitions: profiles.map((profile) => ({
      competition: profile.name,
      competition_code: profile.code,
      model_version_id: profile.modelVersionId,
      calibration_seasons: profile.seasons,
      calibration_matches: profile.calibrationPredictions.length,
      upcoming_fixtures: fixtures.filter((fixture) => fixture.competition === profile.name).length,
    })),
    draft_no_bet_prediction_rows_prepared: preparedPredictions,
    note: "Predictions are draft, decision=no_bet, calibrated=0, and are not returned by the public predictions API.",
  };
  const summaryPath = path.join(outputDir, "neobet-football-shadow-summary.json");
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(JSON.stringify(summary, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `# Football shadow forecast run\n\n` +
      `- Model: ${MODEL_NAME} v${MODEL_VERSION} (${summary.model_status})\n` +
      profiles.map((profile) => `- ${profile.name}: ${profile.calibrationPredictions.length} calibration matches from ${profile.seasons.join(", ")}; ${fixtures.filter((fixture) => fixture.competition === profile.name).length} upcoming fixtures`).join("\n") + "\n" +
      `- Draft NO BET outcome rows prepared: ${preparedPredictions}\n\n` +
      `These records remain unpublished; no probabilities are presented as production-calibrated.\n`,
    );
  }
}

await main();
