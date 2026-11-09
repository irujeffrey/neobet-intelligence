import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PROVIDER_ID = "openfootball";
const COMPETITIONS = [
  { code: "en.1", name: "Premier League", calendarYear: false },
  { code: "en.2", name: "Championship", calendarYear: false },
  { code: "pt.1", name: "Primeira Liga", calendarYear: false },
  { code: "it.1", name: "Serie A", calendarYear: false },
  { code: "br.1", name: "Campeonato Brasileiro Série A", calendarYear: true },
];
const FIRST_YEAR = 2010;
const LAST_YEAR = 2026;
const BASE_URL = "https://raw.githubusercontent.com/openfootball/football.json/master";

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function stableId(competitionCode, matchDate, homeTeam, awayTeam) {
  const key = [PROVIDER_ID, competitionCode, matchDate, homeTeam, awayTeam].join("|").toLowerCase();
  return `${PROVIDER_ID}:history:${createHash("sha256").update(key).digest("hex")}`;
}

function seasonKeys(competition) {
  return Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, index) => FIRST_YEAR + index)
    .map((year) => competition.calendarYear ? String(year) : `${year}-${String(year + 1).slice(-2)}`);
}

async function fetchSeason(competition, season) {
  const sourceUrl = `${BASE_URL}/${season}/${competition.code}.json`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(20000) });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.matches)) throw new Error("Dataset has no matches array");
      return { sourceUrl, matches: data.matches };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw new Error(`${season} could not be downloaded after 3 attempts: ${lastError?.message || "unknown error"}`);
}

async function main() {
  const rows = [];
  const seasonCounts = [];
  const todayUtc = new Date().toISOString().slice(0, 10);
  for (const competition of COMPETITIONS) {
    for (const season of seasonKeys(competition)) {
      const dataset = await fetchSeason(competition, season);
      let completed = 0;
      if (dataset) {
        for (const match of dataset.matches) {
          const matchDate = typeof match.date === "string" ? match.date.slice(0, 10) : "";
          // OpenFootball uses bare score arrays for some completed matches,
          // including confirmed 0-0 results; other results use score.ft.
          const score = Array.isArray(match.score) ? match.score : match.score?.ft;
          const homeTeam = typeof match.team1 === "string" ? match.team1.trim() : "";
          const awayTeam = typeof match.team2 === "string" ? match.team2.trim() : "";
          if (!/^\d{4}-\d{2}-\d{2}$/.test(matchDate)) continue;
          if (matchDate >= todayUtc) continue;
          if (!Array.isArray(score) || score.length !== 2 || !score.every(Number.isInteger)) continue;
          if (score[0] < 0 || score[1] < 0 || !homeTeam || !awayTeam || homeTeam === awayTeam) continue;
          rows.push({
            id: stableId(competition.code, matchDate, homeTeam, awayTeam), provider_id: PROVIDER_ID,
            competition_code: competition.code, competition_name: competition.name,
            season, match_date: matchDate, home_team: homeTeam, away_team: awayTeam,
            home_goals: score[0], away_goals: score[1], source_url: dataset.sourceUrl,
          });
          completed += 1;
        }
      }
      seasonCounts.push({ competition_code: competition.code, competition: competition.name, season, completed_matches: completed, source_found: Boolean(dataset) });
      if (dataset) console.log(`${competition.name} ${season}: ${completed} completed results prepared`);
    }
  }

  for (const competition of COMPETITIONS) {
    const seasonsWithResults = seasonCounts.filter((item) => item.competition_code === competition.code && item.completed_matches > 0).length;
    if (seasonsWithResults < 3) {
      throw new Error(`${competition.name} produced only ${seasonsWithResults} seasons with results; refusing to claim multi-league history is ready.`);
    }
  }
  if (rows.length < 5000) {
    throw new Error(`Only ${rows.length} completed football results were prepared; refusing an unexpectedly small multi-league import.`);
  }

  const columns = [
    "id", "provider_id", "competition_code", "competition_name", "season",
    "match_date", "home_team", "away_team", "home_goals", "away_goals", "source_url",
  ];
  const statements = [];
  for (let offset = 0; offset < rows.length; offset += 25) {
    const batch = rows.slice(offset, offset + 25);
    const values = batch.map((row) => `(${columns.map((column) => sql(row[column])).join(",")})`).join(",\n");
    statements.push(
      `INSERT INTO historical_match_results (${columns.join(",")}) VALUES\n${values}\n` +
      "ON CONFLICT(id) DO UPDATE SET " +
      "competition_name=excluded.competition_name,season=excluded.season,match_date=excluded.match_date," +
      "home_team=excluded.home_team,away_team=excluded.away_team,home_goals=excluded.home_goals," +
      "away_goals=excluded.away_goals,source_url=excluded.source_url,imported_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');",
    );
  }

  const runnerTemp = process.env.RUNNER_TEMP || process.cwd();
  const sqlPath = path.join(runnerTemp, "neobet-football-history.sql");
  const resultPath = path.join(runnerTemp, "neobet-football-history-result.json");
  fs.writeFileSync(sqlPath, `${statements.join("\n\n")}\n`, { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(resultPath, JSON.stringify({
    provider: PROVIDER_ID, competitions: COMPETITIONS, total_completed_matches: rows.length, seasons: seasonCounts,
  }), { encoding: "utf8", mode: 0o600 });
  console.log(`Prepared ${rows.length} completed football results across ${COMPETITIONS.length} competitions and ${seasonCounts.length} season sources.`);
}

await main();
