import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PROVIDER_ID = "openfootball";
const COMPETITION_CODE = "en.1";
const COMPETITION_NAME = "Premier League";
const SEASONS = [
  "2010-11", "2011-12", "2012-13", "2013-14", "2014-15", "2015-16",
  "2016-17", "2017-18", "2018-19", "2019-20", "2020-21", "2021-22",
  "2022-23", "2023-24", "2024-25", "2025-26", "2026-27",
];
const BASE_URL = "https://raw.githubusercontent.com/openfootball/football.json/master";

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function stableId(matchDate, homeTeam, awayTeam) {
  const key = [PROVIDER_ID, COMPETITION_CODE, matchDate, homeTeam, awayTeam].join("|").toLowerCase();
  return `${PROVIDER_ID}:history:${createHash("sha256").update(key).digest("hex")}`;
}

async function fetchSeason(season) {
  const sourceUrl = `${BASE_URL}/${season}/en.1.json`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(20000) });
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
  for (const season of SEASONS) {
    const { sourceUrl, matches } = await fetchSeason(season);
    let completed = 0;
    for (const match of matches) {
      const matchDate = typeof match.date === "string" ? match.date.slice(0, 10) : "";
      const score = match.score?.ft;
      const homeTeam = typeof match.team1 === "string" ? match.team1.trim() : "";
      const awayTeam = typeof match.team2 === "string" ? match.team2.trim() : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(matchDate)) continue;
      if (!Array.isArray(score) || score.length !== 2 || !score.every(Number.isInteger)) continue;
      if (score[0] < 0 || score[1] < 0 || !homeTeam || !awayTeam || homeTeam === awayTeam) continue;
      rows.push({
        id: stableId(matchDate, homeTeam, awayTeam), provider_id: PROVIDER_ID,
        competition_code: COMPETITION_CODE, competition_name: COMPETITION_NAME,
        season, match_date: matchDate, home_team: homeTeam, away_team: awayTeam,
        home_goals: score[0], away_goals: score[1], source_url: sourceUrl,
      });
      completed += 1;
    }
    seasonCounts.push({ season, completed_matches: completed });
    console.log(`${season}: ${completed} completed results prepared`);
  }

  if (rows.length < 2500) {
    throw new Error(`Only ${rows.length} completed matches were prepared; refusing to import an unexpectedly small history.`);
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
    provider: PROVIDER_ID, competition: COMPETITION_NAME, total_completed_matches: rows.length, seasons: seasonCounts,
  }), { encoding: "utf8", mode: 0o600 });
  console.log(`Prepared ${rows.length} completed Premier League results across ${seasonCounts.length} seasons.`);
}

await main();
