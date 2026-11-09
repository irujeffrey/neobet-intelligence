import fs from "node:fs";
import path from "node:path";

const ACCOUNT_ID = requireEnv("CLOUDFLARE_ACCOUNT_ID");
const DATABASE_ID = requireEnv("CLOUDFLARE_D1_DATABASE_ID");
const API_TOKEN = requireEnv("CLOUDFLARE_API_TOKEN");
const COMPETITIONS = ["en.1", "en.2", "pt.1", "it.1", "br.1"];
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

async function loadRows() {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(ACCOUNT_ID)}/d1/database/${encodeURIComponent(DATABASE_ID)}/query`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      sql: `SELECT competition_code, competition_name, season, match_date,
          home_team, away_team, home_goals, away_goals
        FROM historical_match_results
        WHERE provider_id = 'openfootball'
          AND competition_code IN (${COMPETITIONS.map((code) => `'${code}'`).join(",")})
        ORDER BY competition_code, match_date, season`,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Cloudflare D1 query returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (!payload.success) {
    const detail = (payload.errors || []).map((entry) => entry.message).filter(Boolean).join("; ");
    throw new Error(`Cloudflare D1 query failed${detail ? `: ${detail}` : "."}`);
  }
  const rows = payload.result?.[0]?.results;
  if (!Array.isArray(rows)) throw new Error("D1 returned no multi-competition history rows.");
  return rows.filter((row) =>
    COMPETITIONS.includes(row.competition_code) && typeof row.season === "string" &&
    typeof row.match_date === "string" && typeof row.home_team === "string" &&
    typeof row.away_team === "string" && Number.isInteger(row.home_goals) && row.home_goals >= 0 &&
    Number.isInteger(row.away_goals) && row.away_goals >= 0,
  );
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
    if (teamCount < 10 || matches.length !== teamCount * (teamCount - 1)) return false;
    return [...teams].every((team) => homeCounts.get(team) === teamCount - 1 && awayCounts.get(team) === teamCount - 1);
  }).map(([season]) => season).sort((a, b) => seasonStart(a) - seasonStart(b));
}

function weightedStats(rows, targetDate) {
  const targetMs = Date.parse(`${targetDate}T00:00:00.000Z`);
  const teams = new Map();
  let homeGoals = 0;
  let awayGoals = 0;
  let weightTotal = 0;
  const outcomeWeights = [0, 0, 0];
  const getTeam = (name) => {
    if (!teams.has(name)) teams.set(name, { homeWeight: 0, homeScored: 0, homeConceded: 0, awayWeight: 0, awayScored: 0, awayConceded: 0 });
    return teams.get(name);
  };
  for (const match of rows) {
    if (match.match_date >= targetDate) continue;
    const ageDays = Math.max(0, (targetMs - Date.parse(`${match.match_date}T00:00:00.000Z`)) / 86400000);
    const weight = Math.exp(-Math.LN2 * ageDays / HALF_LIFE_DAYS);
    const home = getTeam(match.home_team);
    const away = getTeam(match.away_team);
    homeGoals += match.home_goals * weight;
    awayGoals += match.away_goals * weight;
    weightTotal += weight;
    home.homeWeight += weight; home.homeScored += match.home_goals * weight; home.homeConceded += match.away_goals * weight;
    away.awayWeight += weight; away.awayScored += match.away_goals * weight; away.awayConceded += match.home_goals * weight;
    const outcome = match.home_goals > match.away_goals ? 0 : match.home_goals === match.away_goals ? 1 : 2;
    outcomeWeights[outcome] += weight;
  }
  return weightTotal ? { teams, averageHomeGoals: homeGoals / weightTotal, averageAwayGoals: awayGoals / weightTotal, outcomeWeights } : null;
}

function poisson(lambda) {
  const bounded = Math.max(0.1, Math.min(5, lambda));
  const values = [Math.exp(-bounded)];
  for (let goals = 1; goals <= MAX_GOALS; goals += 1) values.push(values[goals - 1] * bounded / goals);
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => value / total);
}

function rate(team, side, metric, average) {
  if (!team) return average;
  const weight = side === "home" ? team.homeWeight : team.awayWeight;
  const total = side === "home"
    ? (metric === "scored" ? team.homeScored : team.homeConceded)
    : (metric === "scored" ? team.awayScored : team.awayConceded);
  return (total + SHRINKAGE_MATCHES * average) / (weight + SHRINKAGE_MATCHES);
}

function rawProbabilities(match, stats) {
  if (!stats) return [1 / 3, 1 / 3, 1 / 3];
  const home = stats.teams.get(match.home_team);
  const away = stats.teams.get(match.away_team);
  const homeAttack = rate(home, "home", "scored", stats.averageHomeGoals) / stats.averageHomeGoals;
  const homeDefence = rate(home, "home", "conceded", stats.averageAwayGoals) / stats.averageAwayGoals;
  const awayAttack = rate(away, "away", "scored", stats.averageAwayGoals) / stats.averageAwayGoals;
  const awayDefence = rate(away, "away", "conceded", stats.averageHomeGoals) / stats.averageHomeGoals;
  const homeGoals = poisson(stats.averageHomeGoals * homeAttack * awayDefence);
  const awayGoals = poisson(stats.averageAwayGoals * awayAttack * homeDefence);
  const probabilities = [0, 0, 0];
  for (let h = 0; h <= MAX_GOALS; h += 1) for (let a = 0; a <= MAX_GOALS; a += 1) {
    probabilities[h > a ? 0 : h === a ? 1 : 2] += homeGoals[h] * awayGoals[a];
  }
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  return probabilities.map((value) => value / total);
}

function baseline(stats) {
  if (!stats) return [1 / 3, 1 / 3, 1 / 3];
  const total = stats.outcomeWeights.reduce((sum, value) => sum + value, 0) + 3;
  return stats.outcomeWeights.map((value) => (value + 1) / total);
}

function actual(match) { return match.home_goals > match.away_goals ? 0 : match.home_goals === match.away_goals ? 1 : 2; }

function applyDirichlet(probabilities, weights, bias) {
  const logs = probabilities.map((value) => Math.log(Math.max(1e-15, value)));
  const logits = OUTCOMES.map((_, outcome) => bias[outcome] + logs.reduce((sum, value, input) => sum + weights[outcome * 3 + input] * value, 0));
  const max = Math.max(...logits);
  const exponentials = logits.map((value) => Math.exp(value - max));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

function objective(predictions, weights, bias) {
  let loss = 0;
  for (const item of predictions) loss -= Math.log(Math.max(1e-15, applyDirichlet(item.probabilities, weights, bias)[item.actual]));
  loss /= predictions.length;
  for (let outcome = 0; outcome < 3; outcome += 1) {
    for (let input = 0; input < 3; input += 1) {
      const delta = weights[outcome * 3 + input] - (outcome === input ? 1 : 0);
      loss += REGULARIZATION * delta * delta / 2;
    }
    loss += REGULARIZATION * bias[outcome] * bias[outcome] / 2;
  }
  return loss;
}

function gradients(predictions, weights, bias) {
  const gw = Array(9).fill(0); const gb = Array(3).fill(0);
  for (const item of predictions) {
    const p = applyDirichlet(item.probabilities, weights, bias);
    const logs = item.probabilities.map((value) => Math.log(Math.max(1e-15, value)));
    for (let outcome = 0; outcome < 3; outcome += 1) {
      const error = p[outcome] - (item.actual === outcome ? 1 : 0);
      gb[outcome] += error;
      for (let input = 0; input < 3; input += 1) gw[outcome * 3 + input] += error * logs[input];
    }
  }
  for (let outcome = 0; outcome < 3; outcome += 1) {
    gb[outcome] = gb[outcome] / predictions.length + REGULARIZATION * bias[outcome];
    for (let input = 0; input < 3; input += 1) {
      const index = outcome * 3 + input;
      gw[index] = gw[index] / predictions.length + REGULARIZATION * (weights[index] - (outcome === input ? 1 : 0));
    }
  }
  return { gw, gb };
}

function fitDirichlet(predictions) {
  if (predictions.length < 300) throw new Error("At least 300 calibration predictions are required.");
  let weights = [1, 0, 0, 0, 1, 0, 0, 0, 1]; let bias = [0, 0, 0];
  let loss = objective(predictions, weights, bias);
  for (let iteration = 0; iteration < 2000; iteration += 1) {
    const { gw, gb } = gradients(predictions, weights, bias);
    const norm = [...gw, ...gb].reduce((sum, value) => sum + value * value, 0);
    if (norm < 1e-12) break;
    let step = 1; let accepted = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const nextW = weights.map((value, index) => value - step * gw[index]);
      const nextB = bias.map((value, index) => value - step * gb[index]);
      const nextLoss = objective(predictions, nextW, nextB);
      if (nextLoss <= loss - 1e-4 * step * norm) {
        weights = nextW; bias = nextB; loss = nextLoss; accepted = true; break;
      }
      step /= 2;
    }
    if (!accepted) break;
  }
  return { weights, bias };
}

function calibration(predictions, outcome) {
  const bins = Array.from({ length: 10 }, () => ({ count: 0, predicted: 0, observed: 0 }));
  for (const item of predictions) {
    const value = item.probabilities[outcome]; const bin = bins[Math.min(9, Math.floor(value * 10))];
    bin.count += 1; bin.predicted += value; bin.observed += item.actual === outcome ? 1 : 0;
  }
  const ece = bins.reduce((sum, bin) => sum + (bin.count / predictions.length) * (bin.count ? Math.abs(bin.predicted / bin.count - bin.observed / bin.count) : 0), 0);
  return { ece, bins: bins.map((bin, index) => ({ range: `${index * 10}-${(index + 1) * 10}%`, count: bin.count, predicted: bin.count ? bin.predicted / bin.count : null, observed: bin.count ? bin.observed / bin.count : null })).filter((bin) => bin.count) };
}

function summarize(predictions) {
  let correct = 0; let brier = 0; let logLoss = 0;
  for (const item of predictions) {
    const winner = item.probabilities.reduce((best, value, index, values) => value > values[best] ? index : best, 0);
    if (winner === item.actual) correct += 1;
    for (let outcome = 0; outcome < 3; outcome += 1) brier += (item.probabilities[outcome] - (item.actual === outcome ? 1 : 0)) ** 2;
    logLoss -= Math.log(Math.max(1e-15, item.probabilities[item.actual]));
  }
  const byOutcome = OUTCOMES.map((label, index) => ({ outcome: label, ...calibration(predictions, index) }));
  return {
    matches: predictions.length,
    accuracy: correct / predictions.length,
    multiclass_brier_score: brier / predictions.length,
    log_loss: logLoss / predictions.length,
    mean_ece: byOutcome.reduce((sum, entry) => sum + entry.ece, 0) / 3,
    calibration_by_outcome: byOutcome,
  };
}

function scoreSeason(rows, season, calibrationSeasons) {
  const allHoldouts = [...calibrationSeasons, season];
  const targetRows = rows.filter((row) => allHoldouts.includes(row.season));
  const dates = [...new Set(targetRows.map((row) => row.match_date))].sort();
  const calibrationPredictions = []; const rawTest = []; const baselineTest = [];
  for (const date of dates) {
    const stats = weightedStats(rows, date);
    for (const match of targetRows.filter((row) => row.match_date === date)) {
      const prediction = { probabilities: rawProbabilities(match, stats), actual: actual(match) };
      if (calibrationSeasons.includes(match.season)) calibrationPredictions.push(prediction);
      if (match.season === season) {
        rawTest.push(prediction);
        baselineTest.push({ probabilities: baseline(stats), actual: prediction.actual });
      }
    }
  }
  const dirichlet = fitDirichlet(calibrationPredictions);
  const calibrated = (predictions) => predictions.map((item) => ({ ...item, probabilities: applyDirichlet(item.probabilities, dirichlet.weights, dirichlet.bias) }));
  return {
    calibration_seasons: calibrationSeasons,
    calibration_matches: calibrationPredictions.length,
    test_season: season,
    test_matches: rawTest.length,
    dirichlet_weights: dirichlet.weights,
    dirichlet_bias: dirichlet.bias,
    calibration_log_loss: {
      raw: summarize(calibrationPredictions).log_loss,
      dirichlet: summarize(calibrated(calibrationPredictions)).log_loss,
    },
    test: {
      raw_poisson: summarize(rawTest),
      dirichlet: summarize(calibrated(rawTest)),
      outcome_baseline: summarize(baselineTest),
    },
  };
}

function mdMetric(value) { return `${(value * 100).toFixed(2)}%`; }
function mdScore(value) { return value.toFixed(4); }

async function main() {
  const allRows = await loadRows();
  const results = [];
  for (const code of COMPETITIONS) {
    const rows = allRows.filter((row) => row.competition_code === code);
    const name = rows[0]?.competition_name || code;
    const seasons = completedSeasons(rows);
    if (seasons.length < 3) {
      results.push({ code, competition: name, status: "SKIPPED_INSUFFICIENT_COMPLETE_SEASONS", complete_seasons: seasons });
      continue;
    }
    const calibrationSeasons = seasons.slice(-3, -1);
    const testSeason = seasons.at(-1);
    const selected = [...calibrationSeasons, testSeason];
    if (selected.some((season, index) => index > 0 && seasonStart(season) - seasonStart(selected[index - 1]) !== 1)) {
      results.push({
        code, competition: name, status: "SKIPPED_GAPPED_COMPLETE_SEASONS",
        complete_seasons: seasons,
        note: "The latest three complete seasons are not consecutive; refusing a stale-history holdout.",
      });
      continue;
    }
    results.push({
      code, competition: name, status: "EVALUATED", complete_seasons: seasons,
      ...scoreSeason(rows, testSeason, calibrationSeasons),
    });
  }
  const report = {
    generated_at: new Date().toISOString(),
    source_match_count: allRows.length,
    method: "For each competition, use its own completed result history; fit regularized Dirichlet on the two latest complete seasons before the most recent complete season; score the untouched latest complete season chronologically.",
    publication_status: "evaluation_only_not_approved_for_publication",
    competitions: results,
  };
  const lines = [
    "# NeoBet multi-competition football evaluation", "",
    `- **Historical result rows read:** ${allRows.length.toLocaleString()}`,
    "- **Method:** each league has separate result history, calibration, and held-out season; match probabilities use only earlier match dates.",
    "- **Publication:** evaluation only; no competition is approved for public picks by this report.", "",
    "| Competition | Calibration seasons | Held-out season | Matches | Raw Brier | Dirichlet Brier | Raw log loss | Dirichlet log loss | Status |",
    "|---|---|---|---:|---:|---:|---:|---:|---|",
  ];
  for (const result of results) {
    lines.push(result.status === "EVALUATED"
      ? `| ${result.competition} (${result.code}) | ${result.calibration_seasons.join(", ")} | ${result.test_season} | ${result.test_matches} | ${mdScore(result.test.raw_poisson.multiclass_brier_score)} | ${mdScore(result.test.dirichlet.multiclass_brier_score)} | ${mdScore(result.test.raw_poisson.log_loss)} | ${mdScore(result.test.dirichlet.log_loss)} | evaluation only |`
      : `| ${result.competition} (${result.code}) | — | — | — | — | — | — | — | ${result.status} |`);
  }
  for (const result of results.filter((entry) => entry.status === "EVALUATED")) {
    lines.push("", `## ${result.competition}: ${result.test_season}`, "", `- Calibration log loss raw / Dirichlet: ${mdScore(result.calibration_log_loss.raw)} / ${mdScore(result.calibration_log_loss.dirichlet)}`, `- Test accuracy raw / Dirichlet / baseline: ${mdMetric(result.test.raw_poisson.accuracy)} / ${mdMetric(result.test.dirichlet.accuracy)} / ${mdMetric(result.test.outcome_baseline.accuracy)}`, `- Test mean ECE raw / Dirichlet / baseline: ${mdMetric(result.test.raw_poisson.mean_ece)} / ${mdMetric(result.test.dirichlet.mean_ece)} / ${mdMetric(result.test.outcome_baseline.mean_ece)}`);
  }
  lines.push("", "A league is not ready for live predictions solely because it has historical data or a completed evaluation. Keep picks in NO BET until calibration, data coverage, and model quality gates are established.");

  const outputDir = process.env.RUNNER_TEMP || process.cwd();
  const reportPath = path.join(outputDir, "neobet-football-competition-evaluation.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  const markdown = `${lines.join("\n")}\n`;
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
}

await main();
