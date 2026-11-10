import fs from "node:fs";
import path from "node:path";

const ACCOUNT_ID = requireEnv("CLOUDFLARE_ACCOUNT_ID");
const DATABASE_ID = requireEnv("CLOUDFLARE_D1_DATABASE_ID");
const API_TOKEN = requireEnv("CLOUDFLARE_API_TOKEN");
const MODEL_ID = "basketball-nba-elo-shadow-fixed-0-1-0";
const MIN_MONITORING_MATCHES = 100;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing from GitHub Actions secrets or environment.`);
  return value;
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
  const rows = payload.result?.[0]?.results;
  if (!Array.isArray(rows)) throw new Error("Cloudflare D1 returned no NBA shadow forecast rows.");
  return rows;
}

function logLoss(items) {
  return items.reduce((sum, item) => {
    const p = Math.max(1e-12, Math.min(1 - 1e-12, item.probability));
    return sum - (item.actual ? Math.log(p) : Math.log(1 - p));
  }, 0) / items.length;
}

function score(items) {
  if (!items.length) return { matches: 0, accuracy: null, brier_score: null, log_loss: null, ece: null, calibration_bins: [] };
  let correct = 0;
  let brier = 0;
  const bins = Array.from({ length: 10 }, (_, index) => ({ range: `${index * 10}-${(index + 1) * 10}%`, matches: 0, predicted: 0, observed: 0 }));
  for (const item of items) {
    if ((item.probability >= 0.5 ? 1 : 0) === item.actual) correct += 1;
    brier += (item.probability - item.actual) ** 2;
    const bin = bins[Math.min(9, Math.floor(item.probability * 10))];
    bin.matches += 1;
    bin.predicted += item.probability;
    bin.observed += item.actual;
  }
  let ece = 0;
  for (const bin of bins) {
    if (!bin.matches) continue;
    bin.mean_predicted = bin.predicted / bin.matches;
    bin.observed_frequency = bin.observed / bin.matches;
    ece += bin.matches / items.length * Math.abs(bin.mean_predicted - bin.observed_frequency);
    delete bin.predicted;
    delete bin.observed;
  }
  return { matches: items.length, accuracy: correct / items.length, brier_score: brier / items.length, log_loss: logLoss(items), ece, calibration_bins: bins.filter((bin) => bin.matches) };
}

function percentage(value) { return value == null ? "—" : `${(value * 100).toFixed(2)}%`; }
function number(value) { return value == null ? "—" : value.toFixed(4); }

async function main() {
  const rows = await queryD1(`
    SELECT p.id AS prediction_id, p.fixture_id, p.probability, p.created_at,
      f.scheduled_at, f.status, f.home_score, f.away_score
    FROM predictions AS p
    JOIN fixtures AS f ON f.id = p.fixture_id
    JOIN competitions AS competition ON competition.id = f.competition_id
    WHERE p.model_version_id = '${MODEL_ID}' AND p.sport = 'basketball'
      AND p.status = 'draft' AND p.decision = 'no_bet' AND p.calibrated = 0
      AND p.probability IS NOT NULL AND competition.name = 'NBA'
      AND f.status = 'finished' AND f.home_score IS NOT NULL AND f.away_score IS NOT NULL
      AND p.created_at < f.scheduled_at
    ORDER BY f.scheduled_at ASC
  `);
  const items = rows.filter((row) => Number.isFinite(row.probability) && Number.isInteger(row.home_score) && Number.isInteger(row.away_score) && row.home_score !== row.away_score)
    .map((row) => ({ probability: row.probability, actual: row.home_score > row.away_score ? 1 : 0 }));
  const report = {
    generated_at: new Date().toISOString(), model_version_id: MODEL_ID,
    status: items.length < MIN_MONITORING_MATCHES ? "PROVISIONAL_SHADOW_SAMPLE" : "ONGOING_SHADOW_MONITORING",
    settled_pre_kickoff_forecasts: items.length,
    monitoring_threshold: MIN_MONITORING_MATCHES,
    metrics: score(items),
    public_status: "draft-only prospective evaluation; no calibrated public picks; basketball remains NO BET",
    note: items.length < MIN_MONITORING_MATCHES
      ? `Only ${items.length} forecasts have settled after being saved before tip-off; ${MIN_MONITORING_MATCHES} is a monitoring threshold, not publication approval.`
      : `The ${MIN_MONITORING_MATCHES}-match threshold enables ongoing monitoring only. It does not establish calibration, betting value, or approval for public picks.`,
  };
  const reportPath = path.join(process.env.RUNNER_TEMP || process.cwd(), "neobet-basketball-shadow-evaluation.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      "# NBA prospective shadow evaluation", "",
      `- Model: ${MODEL_ID} (fixed Elo reference; unverified, shadow only)`,
      `- Settled pre-tip forecasts: ${items.length}; monitoring threshold: ${MIN_MONITORING_MATCHES}`,
      `- Status: ${report.status}`,
      "- Public status: all rows remain drafts with NO BET decisions; no public basketball picks are approved.", "",
      "| Matches | Accuracy | Brier (lower better) | Log loss (lower better) | ECE (lower better) |",
      "|---:|---:|---:|---:|---:|",
      `| ${items.length} | ${percentage(report.metrics.accuracy)} | ${number(report.metrics.brier_score)} | ${number(report.metrics.log_loss)} | ${percentage(report.metrics.ece)} |`,
      "", report.note, "",
    ];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
  }
}

await main();
