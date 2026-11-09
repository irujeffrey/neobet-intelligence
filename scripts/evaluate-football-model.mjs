import fs from "node:fs";
import path from "node:path";

// All calibration data predates the fresh 2026-27 test season.
const CALIBRATION_SEASONS = ["2023-24", "2024-25", "2025-26"];
const FINAL_TEST_SEASON = "2026-27";
// Freeze the calibrator after reviewing the initial 50-match sample. Future
// reports score only matches completed from this date onward.
const FINAL_TEST_START_DATE = "2026-11-10";
const HOLDOUT_SEASONS = [...CALIBRATION_SEASONS, FINAL_TEST_SEASON];
const OUTCOMES = ["home", "draw", "away"];
const HALF_LIFE_DAYS = 730;
const SHRINKAGE_MATCHES = 8;
const MAX_GOALS = 15;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing from GitHub Actions secrets or environment.`);
  return value;
}

async function loadHistoricalRows() {
  const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
  const databaseId = requireEnv("CLOUDFLARE_D1_DATABASE_ID");
  const token = requireEnv("CLOUDFLARE_API_TOKEN");
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sql: `SELECT season, match_date, home_team, away_team, home_goals, away_goals
        FROM historical_match_results
        WHERE provider_id = 'openfootball' AND competition_code = 'en.1'
        ORDER BY match_date ASC, season ASC`,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Cloudflare D1 query returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (!payload.success) {
    const reason = (payload.errors || []).map((item) => item.message).filter(Boolean).join("; ");
    throw new Error(`Cloudflare D1 query failed${reason ? `: ${reason}` : "."}`);
  }
  const rows = payload.result?.[0]?.results;
  if (!Array.isArray(rows)) throw new Error("D1 returned no historical match rows.");
  return rows.filter((row) =>
    typeof row.season === "string" && /^\d{4}-\d{2}$/.test(row.season) &&
    typeof row.match_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.match_date) &&
    typeof row.home_team === "string" && typeof row.away_team === "string" &&
    Number.isInteger(row.home_goals) && row.home_goals >= 0 &&
    Number.isInteger(row.away_goals) && row.away_goals >= 0,
  );
}

function weightedStats(priorMatches, targetDate) {
  const targetMs = Date.parse(`${targetDate}T00:00:00.000Z`);
  const teams = new Map();
  let homeGoals = 0;
  let awayGoals = 0;
  let weightTotal = 0;
  const outcomeWeights = [0, 0, 0];

  function teamStats(name) {
    if (!teams.has(name)) teams.set(name, {
      homeWeight: 0, homeScored: 0, homeConceded: 0,
      awayWeight: 0, awayScored: 0, awayConceded: 0,
    });
    return teams.get(name);
  }

  for (const match of priorMatches) {
    if (match.match_date >= targetDate) continue;
    const ageDays = Math.max(0, (targetMs - Date.parse(`${match.match_date}T00:00:00.000Z`)) / 86400000);
    const weight = Math.exp(-Math.LN2 * ageDays / HALF_LIFE_DAYS);
    const home = teamStats(match.home_team);
    const away = teamStats(match.away_team);

    homeGoals += match.home_goals * weight;
    awayGoals += match.away_goals * weight;
    weightTotal += weight;
    home.homeWeight += weight;
    home.homeScored += match.home_goals * weight;
    home.homeConceded += match.away_goals * weight;
    away.awayWeight += weight;
    away.awayScored += match.away_goals * weight;
    away.awayConceded += match.home_goals * weight;

    const outcomeIndex = match.home_goals > match.away_goals ? 0 : match.home_goals === match.away_goals ? 1 : 2;
    outcomeWeights[outcomeIndex] += weight;
  }

  if (!weightTotal) return null;
  return {
    teams,
    averageHomeGoals: homeGoals / weightTotal,
    averageAwayGoals: awayGoals / weightTotal,
    weightTotal,
    outcomeWeights,
  };
}

function poissonDistribution(lambda) {
  const bounded = Math.max(0.1, Math.min(5, lambda));
  const values = [Math.exp(-bounded)];
  for (let goals = 1; goals <= MAX_GOALS; goals += 1) {
    values.push(values[goals - 1] * bounded / goals);
  }
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

function probabilitiesFor(match, stats) {
  if (!stats) return [1 / 3, 1 / 3, 1 / 3];
  const homeTeam = stats.teams.get(match.home_team);
  const awayTeam = stats.teams.get(match.away_team);
  const homeAttack = teamRate(homeTeam, "home", "scored", stats.averageHomeGoals) / stats.averageHomeGoals;
  const homeDefence = teamRate(homeTeam, "home", "conceded", stats.averageAwayGoals) / stats.averageAwayGoals;
  const awayAttack = teamRate(awayTeam, "away", "scored", stats.averageAwayGoals) / stats.averageAwayGoals;
  const awayDefence = teamRate(awayTeam, "away", "conceded", stats.averageHomeGoals) / stats.averageHomeGoals;
  const expectedHome = stats.averageHomeGoals * homeAttack * awayDefence;
  const expectedAway = stats.averageAwayGoals * awayAttack * homeDefence;
  const homeGoals = poissonDistribution(expectedHome);
  const awayGoals = poissonDistribution(expectedAway);
  const probabilities = [0, 0, 0];

  for (let homeScore = 0; homeScore <= MAX_GOALS; homeScore += 1) {
    for (let awayScore = 0; awayScore <= MAX_GOALS; awayScore += 1) {
      const mass = homeGoals[homeScore] * awayGoals[awayScore];
      probabilities[homeScore > awayScore ? 0 : homeScore === awayScore ? 1 : 2] += mass;
    }
  }
  const total = probabilities.reduce((sum, probability) => sum + probability, 0);
  return probabilities.map((probability) => probability / total);
}

function baselineProbabilities(stats) {
  if (!stats) return [1 / 3, 1 / 3, 1 / 3];
  const total = stats.outcomeWeights.reduce((sum, value) => sum + value, 0) + OUTCOMES.length;
  return stats.outcomeWeights.map((value) => (value + 1) / total);
}

function actualOutcome(match) {
  return match.home_goals > match.away_goals ? 0 : match.home_goals === match.away_goals ? 1 : 2;
}

function calibrationSummary(predictions) {
  const byOutcome = OUTCOMES.map((label, outcomeIndex) => {
    const bins = Array.from({ length: 10 }, () => ({ count: 0, predicted: 0, observed: 0 }));
    for (const prediction of predictions) {
      const probability = prediction.probabilities[outcomeIndex];
      const bin = bins[Math.min(9, Math.floor(probability * 10))];
      bin.count += 1;
      bin.predicted += probability;
      bin.observed += prediction.actual === outcomeIndex ? 1 : 0;
    }
    const ece = bins.reduce((sum, bin) => sum + (bin.count / predictions.length) *
      (bin.count ? Math.abs(bin.predicted / bin.count - bin.observed / bin.count) : 0), 0);
    return {
      outcome: label,
      ece,
      bins: bins.map((bin, index) => ({
        range: `${index * 10}-${index === 9 ? 100 : (index + 1) * 10}%`,
        count: bin.count,
        mean_probability: bin.count ? bin.predicted / bin.count : null,
        observed_frequency: bin.count ? bin.observed / bin.count : null,
      })),
    };
  });
  return { mean_ece: byOutcome.reduce((sum, item) => sum + item.ece, 0) / byOutcome.length, by_outcome: byOutcome };
}

function summarize(predictions) {
  let correct = 0;
  let brierTotal = 0;
  let logLossTotal = 0;
  for (const prediction of predictions) {
    let predictedOutcome = 0;
    let brier = 0;
    for (let outcome = 0; outcome < OUTCOMES.length; outcome += 1) {
      if (prediction.probabilities[outcome] > prediction.probabilities[predictedOutcome]) predictedOutcome = outcome;
      const target = prediction.actual === outcome ? 1 : 0;
      brier += (prediction.probabilities[outcome] - target) ** 2;
    }
    if (predictedOutcome === prediction.actual) correct += 1;
    brierTotal += brier;
    logLossTotal -= Math.log(Math.max(1e-15, prediction.probabilities[prediction.actual]));
  }
  return {
    matches: predictions.length,
    accuracy: correct / predictions.length,
    multiclass_brier_score: brierTotal / predictions.length,
    log_loss: logLossTotal / predictions.length,
    calibration: calibrationSummary(predictions),
  };
}

function applyTemperature(probabilities, temperature) {
  const logits = probabilities.map((probability) => Math.log(Math.max(1e-15, probability)) / temperature);
  const maxLogit = Math.max(...logits);
  const exponentials = logits.map((value) => Math.exp(value - maxLogit));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

function temperatureLogLoss(predictions, temperature) {
  return predictions.reduce((total, prediction) => {
    const adjusted = applyTemperature(prediction.probabilities, temperature);
    return total - Math.log(Math.max(1e-15, adjusted[prediction.actual]));
  }, 0) / predictions.length;
}

function fitTemperature(predictions) {
  if (!predictions.length) throw new Error("No calibration predictions are available for temperature fitting.");
  // Golden-section search minimizes multiclass validation log loss without extra packages.
  let left = 0.2;
  let right = 5;
  const ratio = (Math.sqrt(5) - 1) / 2;
  let x1 = right - ratio * (right - left);
  let x2 = left + ratio * (right - left);
  let y1 = temperatureLogLoss(predictions, x1);
  let y2 = temperatureLogLoss(predictions, x2);
  for (let iteration = 0; iteration < 100; iteration += 1) {
    if (y1 <= y2) {
      right = x2;
      x2 = x1;
      y2 = y1;
      x1 = right - ratio * (right - left);
      y1 = temperatureLogLoss(predictions, x1);
    } else {
      left = x1;
      x1 = x2;
      y1 = y2;
      x2 = left + ratio * (right - left);
      y2 = temperatureLogLoss(predictions, x2);
    }
  }
  return (left + right) / 2;
}

function applyDirichlet(probabilities, weights, bias) {
  const logProbabilities = probabilities.map((probability) => Math.log(Math.max(1e-15, probability)));
  const logits = OUTCOMES.map((_, outcome) =>
    bias[outcome] + logProbabilities.reduce((sum, value, input) => sum + weights[outcome * 3 + input] * value, 0),
  );
  const maxLogit = Math.max(...logits);
  const exponentials = logits.map((value) => Math.exp(value - maxLogit));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

function dirichletObjective(predictions, weights, bias, regularization = 0.02) {
  if (!predictions.length) return Number.POSITIVE_INFINITY;
  let loss = 0;
  for (const prediction of predictions) {
    const adjusted = applyDirichlet(prediction.probabilities, weights, bias);
    loss -= Math.log(Math.max(1e-15, adjusted[prediction.actual]));
  }
  loss /= predictions.length;
  for (let outcome = 0; outcome < 3; outcome += 1) {
    for (let input = 0; input < 3; input += 1) {
      const difference = weights[outcome * 3 + input] - (outcome === input ? 1 : 0);
      loss += (regularization / 2) * difference * difference;
    }
    loss += (regularization / 2) * bias[outcome] * bias[outcome];
  }
  return loss;
}

function dirichletGradient(predictions, weights, bias, regularization = 0.02) {
  const weightGradient = Array(9).fill(0);
  const biasGradient = Array(3).fill(0);
  for (const prediction of predictions) {
    const adjusted = applyDirichlet(prediction.probabilities, weights, bias);
    const logProbabilities = prediction.probabilities.map((probability) => Math.log(Math.max(1e-15, probability)));
    for (let outcome = 0; outcome < 3; outcome += 1) {
      const error = adjusted[outcome] - (prediction.actual === outcome ? 1 : 0);
      biasGradient[outcome] += error;
      for (let input = 0; input < 3; input += 1) {
        weightGradient[outcome * 3 + input] += error * logProbabilities[input];
      }
    }
  }
  for (let outcome = 0; outcome < 3; outcome += 1) {
    biasGradient[outcome] = biasGradient[outcome] / predictions.length + regularization * bias[outcome];
    for (let input = 0; input < 3; input += 1) {
      const index = outcome * 3 + input;
      weightGradient[index] = weightGradient[index] / predictions.length +
        regularization * (weights[index] - (outcome === input ? 1 : 0));
    }
  }
  return { weightGradient, biasGradient };
}

function fitDirichlet(predictions) {
  if (predictions.length < 300) throw new Error("Dirichlet calibration needs at least 300 calibration predictions.");
  const regularization = 0.02;
  let weights = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let bias = [0, 0, 0];
  let objective = dirichletObjective(predictions, weights, bias, regularization);
  for (let iteration = 0; iteration < 2000; iteration += 1) {
    const { weightGradient, biasGradient } = dirichletGradient(predictions, weights, bias, regularization);
    const gradient = [...weightGradient, ...biasGradient];
    const normSquared = gradient.reduce((sum, value) => sum + value * value, 0);
    if (normSquared < 1e-12) break;

    let step = 1;
    let accepted = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const candidateWeights = weights.map((value, index) => value - step * weightGradient[index]);
      const candidateBias = bias.map((value, index) => value - step * biasGradient[index]);
      const candidateObjective = dirichletObjective(predictions, candidateWeights, candidateBias, regularization);
      if (candidateObjective <= objective - 1e-4 * step * normSquared) {
        weights = candidateWeights;
        bias = candidateBias;
        objective = candidateObjective;
        accepted = true;
        break;
      }
      step /= 2;
    }
    if (!accepted) break;
  }
  return { weights, bias, regularization, training_objective: objective };
}

function percent(value) { return `${(value * 100).toFixed(2)}%`; }

function makeMarkdown(report) {
  const lines = [
    "# NeoBet football probability calibration evaluation",
    "",
    `- **Calibration seasons used to fit adjustments:** ${CALIBRATION_SEASONS.join(", ")} (${report.calibration_match_count.toLocaleString()} matches)`,
    `- **Forward-only test window:** ${FINAL_TEST_SEASON} from ${FINAL_TEST_START_DATE} (${report.final_test_match_count.toLocaleString()} completed matches)`,
    `- **Forward-test status:** ${report.test_season_status}`,
    `- **Evaluation type:** chronological rolling evaluation; each match uses only results dated before that match. Same-day games are excluded because historical kick-off times are unavailable.`,
    `- **Historical matches available:** ${report.source_match_count.toLocaleString()}`,
    `- **Fitted temperature:** ${report.calibration.temperature.toFixed(4)}`,
    `- **Dirichlet calibration:** regularized 3-class affine mapping of log probabilities (fit only on calibration seasons)`,
    `- **Calibration log loss, raw / temperature / Dirichlet:** ${report.calibration.log_loss_raw.toFixed(4)} / ${report.calibration.log_loss_temperature.toFixed(4)} / ${report.calibration.log_loss_dirichlet.toFixed(4)}`,
    `- **Model status:** evaluation only; no probabilities are published or claimed production-calibrated.`,
    `- **Limitations:** scores-only Premier League history; no odds, line-ups, injuries, or match-time information.`,
    "",
    `## Final test results: ${FINAL_TEST_SEASON}`,
    "",
    "| Method | Accuracy | Multiclass Brier (lower is better) | Log loss (lower is better) | Mean one-vs-rest ECE (lower is better) |",
    "|---|---:|---:|---:|---:|",
    `| Raw rolling goal-rate Poisson | ${percent(report.final_test.poisson_raw.accuracy)} | ${report.final_test.poisson_raw.multiclass_brier_score.toFixed(4)} | ${report.final_test.poisson_raw.log_loss.toFixed(4)} | ${percent(report.final_test.poisson_raw.calibration.mean_ece)} |`,
    `| Temperature-scaled Poisson | ${percent(report.final_test.poisson_scaled.accuracy)} | ${report.final_test.poisson_scaled.multiclass_brier_score.toFixed(4)} | ${report.final_test.poisson_scaled.log_loss.toFixed(4)} | ${percent(report.final_test.poisson_scaled.calibration.mean_ece)} |`,
    `| Dirichlet-calibrated Poisson | ${percent(report.final_test.poisson_dirichlet.accuracy)} | ${report.final_test.poisson_dirichlet.multiclass_brier_score.toFixed(4)} | ${report.final_test.poisson_dirichlet.log_loss.toFixed(4)} | ${percent(report.final_test.poisson_dirichlet.calibration.mean_ece)} |`,
    `| Expanding outcome-rate baseline | ${percent(report.final_test.outcome_baseline.accuracy)} | ${report.final_test.outcome_baseline.multiclass_brier_score.toFixed(4)} | ${report.final_test.outcome_baseline.log_loss.toFixed(4)} | ${percent(report.final_test.outcome_baseline.calibration.mean_ece)} |`,
    "",
    `## Per-outcome calibration: Dirichlet-calibrated Poisson on ${FINAL_TEST_SEASON}`,
    "",
    "| Outcome | ECE | Probability bin | Matches | Mean predicted | Observed frequency |",
    "|---|---:|---:|---:|---:|---:|",
  ];
  for (const outcome of report.final_test.poisson_dirichlet.calibration.by_outcome) {
    for (const bin of outcome.bins.filter((entry) => entry.count > 0)) {
      lines.push(`| ${outcome.outcome} | ${percent(outcome.ece)} | ${bin.range} | ${bin.count} | ${percent(bin.mean_probability)} | ${percent(bin.observed_frequency)} |`);
    }
  }
  lines.push("", `This is a scores-only, forward-only evaluation, not approval to publish live picks. Calibration settings were fit only on seasons through 2025-26 and are held fixed. Only ${FINAL_TEST_SEASON} matches dated ${FINAL_TEST_START_DATE} or later are included in this test window. Treat the results as exploratory while the forward sample is small; assess calibration across a larger sample and probability bins before any production decision.`);
  return `${lines.join("\n")}\n`;
}

async function main() {
  const rows = await loadHistoricalRows();
  if (rows.length < 4000) throw new Error(`Only ${rows.length} valid historical rows were read from D1.`);
  rows.sort((a, b) => a.match_date.localeCompare(b.match_date) || a.season.localeCompare(b.season));

  const counts = new Map();
  for (const row of rows) counts.set(row.season, (counts.get(row.season) || 0) + 1);
  for (const season of CALIBRATION_SEASONS) {
    const count = counts.get(season) || 0;
    if (count !== 380) throw new Error(`Holdout season ${season} has ${count} rows; expected exactly 380 completed Premier League matches. Refusing an incomplete evaluation.`);
  }
  const finalTestCount = rows.filter((row) =>
    row.season === FINAL_TEST_SEASON && row.match_date >= FINAL_TEST_START_DATE,
  ).length;
  if (finalTestCount < 30) {
    throw new Error(`Only ${finalTestCount} completed ${FINAL_TEST_SEASON} matches fall on or after ${FINAL_TEST_START_DATE}; at least 30 are required for an exploratory forward-test report. Import newer completed results and try again later.`);
  }

  const holdout = rows.filter((row) => HOLDOUT_SEASONS.includes(row.season));
  const testDates = [...new Set(holdout.map((row) => row.match_date))].sort();
  const calibrationPredictions = [];
  const finalTestRaw = [];
  const finalTestBaseline = [];
  for (const date of testDates) {
    const stats = weightedStats(rows, date);
    for (const match of holdout.filter((row) => row.match_date === date)) {
      const actual = actualOutcome(match);
      const raw = { probabilities: probabilitiesFor(match, stats), actual };
      if (CALIBRATION_SEASONS.includes(match.season)) calibrationPredictions.push(raw);
      if (match.season === FINAL_TEST_SEASON && match.match_date >= FINAL_TEST_START_DATE) {
        finalTestRaw.push(raw);
        finalTestBaseline.push({ probabilities: baselineProbabilities(stats), actual });
      }
    }
  }

  const temperature = fitTemperature(calibrationPredictions);
  const dirichlet = fitDirichlet(calibrationPredictions);
  const scaledCalibration = calibrationPredictions.map((prediction) => ({
    ...prediction, probabilities: applyTemperature(prediction.probabilities, temperature),
  }));
  const dirichletCalibration = calibrationPredictions.map((prediction) => ({
    ...prediction, probabilities: applyDirichlet(prediction.probabilities, dirichlet.weights, dirichlet.bias),
  }));
  const finalTestScaled = finalTestRaw.map((prediction) => ({
    ...prediction, probabilities: applyTemperature(prediction.probabilities, temperature),
  }));
  const finalTestDirichlet = finalTestRaw.map((prediction) => ({
    ...prediction, probabilities: applyDirichlet(prediction.probabilities, dirichlet.weights, dirichlet.bias),
  }));

  const report = {
    generated_at: new Date().toISOString(),
    source: "OpenFootball CC0; historical_match_results in NeoBet D1",
    source_match_count: rows.length,
    holdout_seasons: HOLDOUT_SEASONS,
    holdout_counts: Object.fromEntries(HOLDOUT_SEASONS.map((season) => [season, counts.get(season)])),
    calibration_match_count: calibrationPredictions.length,
    final_test_match_count: finalTestRaw.length,
    test_season_status: "FORWARD_ONLY_EXPLORATORY",
    methodology: "Rolling date-based evaluation; only strictly earlier dates are used for each match; two-year exponential half-life; team scoring/conceding rates shrunk toward league averages using eight pseudo-matches.",
    calibration: {
      methods: [
        "multiclass temperature scaling fitted by minimizing calibration log loss",
        "L2-regularized Dirichlet calibration fitted on log probabilities",
      ],
      calibration_seasons: CALIBRATION_SEASONS,
      temperature,
      dirichlet_weights: dirichlet.weights,
      dirichlet_bias: dirichlet.bias,
      dirichlet_regularization: dirichlet.regularization,
      log_loss_raw: summarize(calibrationPredictions).log_loss,
      log_loss_temperature: summarize(scaledCalibration).log_loss,
      log_loss_dirichlet: summarize(dirichletCalibration).log_loss,
    },
    final_test: {
      season: FINAL_TEST_SEASON,
      start_date: FINAL_TEST_START_DATE,
      poisson_raw: summarize(finalTestRaw),
      poisson_scaled: summarize(finalTestScaled),
      poisson_dirichlet: summarize(finalTestDirichlet),
      outcome_baseline: summarize(finalTestBaseline),
    },
    publication_status: "evaluation_only_not_approved_for_publication",
  };

  const outputDir = process.env.RUNNER_TEMP || process.cwd();
  const reportPath = path.join(outputDir, "neobet-football-model-evaluation.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  const markdown = makeMarkdown(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  console.log(markdown);
  console.log(`Detailed evaluation JSON written to ${reportPath}`);
}

await main();
