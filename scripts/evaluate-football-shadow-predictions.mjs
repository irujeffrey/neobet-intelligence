import fs from "node:fs";
import path from "node:path";

const ACCOUNT_ID = requireEnv("CLOUDFLARE_ACCOUNT_ID");
const DATABASE_ID = requireEnv("CLOUDFLARE_D1_DATABASE_ID");
const API_TOKEN = requireEnv("CLOUDFLARE_API_TOKEN");
const MODEL_VERSION_IDS = [
  "football-poisson-dirichlet-shadow-0-1-0",
  "football-poisson-dirichlet-shadow-en-2-0-1-0",
  "football-poisson-dirichlet-shadow-pt-1-0-1-0",
  "football-poisson-dirichlet-shadow-it-1-0-1-0",
  "football-poisson-dirichlet-shadow-br-1-0-1-0",
];
const OUTCOMES = ["home", "draw", "away"];
const MIN_SHADOW_MATCHES = 100;

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
      sql: `SELECT p.fixture_id, p.model_version_id, p.market, p.selection, p.probability, p.created_at,
          f.scheduled_at, f.status, f.home_score, f.away_score, home.name AS home_team,
          away.name AS away_team, competition.name AS competition
        FROM predictions AS p
        JOIN fixtures AS f ON f.id = p.fixture_id
        JOIN teams AS home ON home.id = f.home_team_id
        JOIN teams AS away ON away.id = f.away_team_id
        LEFT JOIN competitions AS competition ON competition.id = f.competition_id
        WHERE p.model_version_id IN (${MODEL_VERSION_IDS.map((id) => `'${id}'`).join(",")})
          AND p.status = 'draft' AND p.decision = 'no_bet' AND p.calibrated = 0
          AND p.market = '1X2' AND f.sport = 'football'
        ORDER BY f.scheduled_at ASC, p.selection ASC`,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Cloudflare D1 query returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (!payload.success) {
    const reason = (payload.errors || []).map((entry) => entry.message).filter(Boolean).join("; ");
    throw new Error(`Cloudflare D1 query failed${reason ? `: ${reason}` : "."}`);
  }
  const rows = payload.result?.[0]?.results;
  if (!Array.isArray(rows)) throw new Error("D1 returned no shadow prediction rows.");
  return rows;
}

function actualOutcome(homeScore, awayScore) {
  return homeScore > awayScore ? "home" : homeScore === awayScore ? "draw" : "away";
}

function calibration(probabilityRows, outcome) {
  const bins = Array.from({ length: 10 }, () => ({ count: 0, predicted: 0, observed: 0 }));
  for (const row of probabilityRows) {
    const probability = row.probabilities[outcome];
    const bin = bins[Math.min(9, Math.floor(probability * 10))];
    bin.count += 1;
    bin.predicted += probability;
    bin.observed += row.actual === outcome ? 1 : 0;
  }
  const ece = probabilityRows.length
    ? bins.reduce((sum, bin) => sum + (bin.count / probabilityRows.length) *
      (bin.count ? Math.abs(bin.predicted / bin.count - bin.observed / bin.count) : 0), 0)
    : null;
  return {
    ece,
    bins: bins.filter((bin) => bin.count).map((bin, index) => ({
      range: `${index * 10}-${index === 9 ? 100 : (index + 1) * 10}%`,
      matches: bin.count,
      mean_probability: bin.predicted / bin.count,
      observed_frequency: bin.observed / bin.count,
    })),
  };
}

function score(matches) {
  if (!matches.length) return { matches: 0, accuracy: null, multiclass_brier_score: null, log_loss: null, calibration: null };
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  for (const match of matches) {
    const predicted = OUTCOMES.reduce((best, outcome) =>
      match.probabilities[outcome] > match.probabilities[best] ? outcome : best, OUTCOMES[0]);
    if (predicted === match.actual) correct += 1;
    for (const outcome of OUTCOMES) {
      const target = match.actual === outcome ? 1 : 0;
      brier += (match.probabilities[outcome] - target) ** 2;
    }
    logLoss -= Math.log(Math.max(1e-15, match.probabilities[match.actual]));
  }
  const probabilityRows = matches.map((match) => ({ probabilities: match.probabilities, actual: match.actual }));
  const perOutcome = Object.fromEntries(OUTCOMES.map((outcome) => [outcome, calibration(probabilityRows, outcome)]));
  return {
    matches: matches.length,
    accuracy: correct / matches.length,
    multiclass_brier_score: brier / matches.length,
    log_loss: logLoss / matches.length,
    mean_one_vs_rest_ece: OUTCOMES.reduce((sum, outcome) => sum + perOutcome[outcome].ece, 0) / OUTCOMES.length,
    calibration_by_outcome: perOutcome,
  };
}

function pct(value) { return value === null ? "—" : `${(value * 100).toFixed(2)}%`; }
function metric(value) { return value === null ? "—" : value.toFixed(4); }

function markdown(report) {
  const lines = [
    "# NeoBet football shadow forecast review",
    "",
    `- **Models:** ${MODEL_VERSION_IDS.join(", ")} (unverified, shadow only)`,
    `- **Draft forecast rows read:** ${report.draft_rows_read.toLocaleString()}`,
    `- **Complete, pre-kickoff forecast triples settled:** ${report.scored.matches.toLocaleString()}`,
    `- **Status:** ${report.status}`,
    "- **Publication:** all forecasts remain drafts with NO BET decisions; this report does not authorize public picks.",
    "- **Scoring:** only finished fixtures with all three 1X2 probabilities recorded before scheduled kickoff are included.",
    `- **Monitoring threshold:** fewer than ${MIN_SHADOW_MATCHES} settled forecasts for a league is provisional; reaching the threshold is not approval for public predictions.`,
    "",
    "| League model | Settled matches | Monitoring state | Accuracy | Multiclass Brier (lower is better) | Log loss (lower is better) | Mean one-vs-rest ECE (lower is better) |",
    "|---|---:|---|---:|---:|---:|---:|",
  ];
  for (const [modelId, result] of Object.entries(report.by_model)) {
    lines.push(`| ${modelId} | ${result.scored.matches} | ${result.status} | ${pct(result.scored.accuracy)} | ${metric(result.scored.multiclass_brier_score)} | ${metric(result.scored.log_loss)} | ${pct(result.scored.mean_one_vs_rest_ece)} |`);
  }
  if (report.scored.matches) {
    for (const [modelId, model] of Object.entries(report.by_model)) {
      if (!model.scored.matches) continue;
      lines.push("", `## Calibration by outcome: ${modelId}`, "", "| Outcome | ECE | Bin | Matches | Mean predicted | Observed frequency |", "|---|---:|---:|---:|---:|---:|");
      for (const outcome of OUTCOMES) {
        const result = model.scored.calibration_by_outcome[outcome];
        for (const bin of result.bins) {
          lines.push(`| ${outcome} | ${pct(result.ece)} | ${bin.range} | ${bin.matches} | ${pct(bin.mean_probability)} | ${pct(bin.observed_frequency)} |`);
        }
      }
    }
  } else {
    lines.push("", "No shadow forecasts have settled yet. Run **Sync NeoBet sports data**, then run **Generate NeoBet football shadow predictions** for upcoming fixtures. Re-run this workflow after completed match results are synced.");
  }
  lines.push("", "Shadow forecasts are experimental. Small samples and sparse probability bins are descriptive only; do not treat them as evidence of production calibration.");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const rows = await loadRows();
  const grouped = new Map();
  for (const row of rows) {
    if (row.market !== "1X2" || !OUTCOMES.includes(row.selection) ||
      typeof row.fixture_id !== "string" || typeof row.created_at !== "string" ||
      !Number.isFinite(Date.parse(row.created_at)) || !Number.isFinite(Date.parse(row.scheduled_at))) continue;
    if (row.status !== "finished" || !Number.isInteger(row.home_score) || !Number.isInteger(row.away_score)) continue;
    if (Date.parse(row.created_at) >= Date.parse(row.scheduled_at)) continue;
    if (typeof row.probability !== "number" || row.probability < 0 || row.probability > 1) continue;
    const key = `${row.model_version_id}|${row.fixture_id}`;
    if (!grouped.has(key)) grouped.set(key, { rows: [], model_version_id: row.model_version_id, actual: actualOutcome(row.home_score, row.away_score), home_team: row.home_team, away_team: row.away_team, competition: row.competition, scheduled_at: row.scheduled_at });
    grouped.get(key).rows.push(row);
  }

  const matches = [];
  for (const [fixtureId, group] of grouped) {
    const probabilities = {};
    for (const row of group.rows) probabilities[row.selection] = row.probability;
    if (OUTCOMES.some((outcome) => !Number.isFinite(probabilities[outcome])) || group.rows.length !== 3) continue;
    const total = OUTCOMES.reduce((sum, outcome) => sum + probabilities[outcome], 0);
    if (Math.abs(total - 1) > 0.002) continue;
    matches.push({ fixture_id: group.rows[0].fixture_id, ...group, probabilities });
  }

  const scored = score(matches);
  const report = {
    generated_at: new Date().toISOString(),
    model_version_ids: MODEL_VERSION_IDS,
    draft_rows_read: rows.length,
    scored,
    by_model: Object.fromEntries(MODEL_VERSION_IDS.map((modelVersionId) => {
      const modelMatches = matches.filter((match) => match.model_version_id === modelVersionId);
      const modelScore = score(modelMatches);
      return [modelVersionId, {
        scored: modelScore,
        status: modelMatches.length < MIN_SHADOW_MATCHES ? "PROVISIONAL_SHADOW_SAMPLE" : "ONGOING_SHADOW_MONITORING",
        minimum_matches_for_ongoing_monitoring: MIN_SHADOW_MATCHES,
        matches: modelMatches.map((match) => ({
        fixture_id: match.fixture_id, competition: match.competition, home_team: match.home_team,
        away_team: match.away_team, scheduled_at: match.scheduled_at, actual: match.actual,
        probabilities: match.probabilities,
        })),
      }];
    })),
    status: matches.length < MIN_SHADOW_MATCHES ? "PROVISIONAL_SHADOW_SAMPLE" : "ONGOING_SHADOW_MONITORING",
    note: "Draft-only; no public predictions or betting recommendations.",
    matches: matches.map((match) => ({
      fixture_id: match.fixture_id,
      competition: match.competition,
      home_team: match.home_team,
      away_team: match.away_team,
      scheduled_at: match.scheduled_at,
      actual: match.actual,
      probabilities: match.probabilities,
    })),
  };
  const outputDir = process.env.RUNNER_TEMP || process.cwd();
  const reportPath = path.join(outputDir, "neobet-football-shadow-evaluation.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  const summary = markdown(report);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

await main();
