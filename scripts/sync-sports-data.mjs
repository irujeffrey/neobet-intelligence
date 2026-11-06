import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const FOOTBALL_DATA_PROVIDER = "football-data-org";
const API_NINJAS_PROVIDER = "api-ninjas";
const API_NINJAS_BASKETBALL_LEAGUES = ["nba", "wnba"];
const MAX_BASKETBALL_PAGES = 35;
const PAGE_SIZE = 50;
const LEAGUE_NAMES = { nba: "NBA", wnba: "WNBA" };

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function internalId(provider, type, externalId) {
  return `${provider}:${type}:${safeId(externalId)}`;
}

function validDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function integerOrNull(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function footballDataStatus(status) {
  switch (status) {
    case "IN_PLAY":
    case "PAUSED": return "live";
    case "FINISHED":
    case "AWARDED": return "finished";
    case "POSTPONED": return "postponed";
    case "CANCELLED": return "cancelled";
    case "SUSPENDED": return "abandoned";
    default: return "scheduled";
  }
}

function apiNinjasStatus(status) {
  switch (status) {
    case "in_progress": return "live";
    case "final": return "finished";
    case "postponed":
    case "delayed": return "postponed";
    case "canceled": return "cancelled";
    case "suspended": return "abandoned";
    default: return "scheduled";
  }
}

function newDataset() {
  return { competitions: new Map(), seasons: new Map(), teams: new Map(), fixtures: [] };
}

function addFixture(dataset, fixture) {
  if (fixture.id && fixture.scheduled_at && fixture.home_team_id && fixture.away_team_id && fixture.home_team_id !== fixture.away_team_id) {
    dataset.fixtures.push(fixture);
  }
}

function fromFootballData(matches) {
  const dataset = newDataset();
  for (const match of matches) {
    const competition = match.competition;
    const home = match.homeTeam;
    const away = match.awayTeam;
    const scheduledAt = validDate(match.utcDate);
    if (!competition?.id || !home?.id || !away?.id || !scheduledAt) continue;

    const competitionId = internalId(FOOTBALL_DATA_PROVIDER, "competition", competition.id);
    const homeTeamId = internalId(FOOTBALL_DATA_PROVIDER, "team", home.id);
    const awayTeamId = internalId(FOOTBALL_DATA_PROVIDER, "team", away.id);
    const seasonId = match.season?.id == null ? null : internalId(FOOTBALL_DATA_PROVIDER, "season", `${competition.id}-${match.season.id}`);

    dataset.competitions.set(competitionId, {
      id: competitionId, sport: "football", name: competition.name || String(competition.code || competition.id),
      region: competition.area?.name || null,
    });
    if (seasonId) {
      dataset.seasons.set(seasonId, {
        id: seasonId, competition_id: competitionId,
        name: match.season.startDate?.slice(0, 4) || String(match.season.id),
        starts_on: match.season.startDate || null, ends_on: match.season.endDate || null,
      });
    }
    dataset.teams.set(homeTeamId, {
      id: homeTeamId, sport: "football", name: home.name, short_name: home.shortName || home.tla || null,
      country: home.area?.name || competition.area?.name || null,
    });
    dataset.teams.set(awayTeamId, {
      id: awayTeamId, sport: "football", name: away.name, short_name: away.shortName || away.tla || null,
      country: away.area?.name || competition.area?.name || null,
    });

    addFixture(dataset, {
      id: internalId(FOOTBALL_DATA_PROVIDER, "fixture", match.id), sport: "football",
      competition_id: competitionId, season_id: seasonId, home_team_id: homeTeamId, away_team_id: awayTeamId,
      scheduled_at: scheduledAt, status: footballDataStatus(match.status),
      home_score: integerOrNull(match.score?.fullTime?.home), away_score: integerOrNull(match.score?.fullTime?.away),
      venue: match.venue || null, data_quality: match.lastUpdated ? "good" : "fair",
      source_updated_at: validDate(match.lastUpdated),
    });
  }
  return dataset;
}

function fromApiNinjas(games) {
  const dataset = newDataset();
  for (const game of games) {
    const league = game.league;
    const home = game.home_team;
    const away = game.away_team;
    const scheduledAt = validDate(game.start_time || `${game.date}T00:00:00Z`);
    if (!league || !home?.team_id || !away?.team_id || !scheduledAt) continue;

    const competitionId = internalId(API_NINJAS_PROVIDER, "competition", league);
    const homeTeamId = internalId(API_NINJAS_PROVIDER, "team", home.team_id);
    const awayTeamId = internalId(API_NINJAS_PROVIDER, "team", away.team_id);
    const seasonId = game.season == null ? null : internalId(API_NINJAS_PROVIDER, "season", `${league}-${game.season}`);
    dataset.competitions.set(competitionId, {
      id: competitionId, sport: "basketball", name: LEAGUE_NAMES[league] || league.toUpperCase(), region: null,
    });
    if (seasonId) {
      dataset.seasons.set(seasonId, {
        id: seasonId, competition_id: competitionId, name: game.season_label || String(game.season),
        starts_on: null, ends_on: null,
      });
    }
    dataset.teams.set(homeTeamId, {
      id: homeTeamId, sport: "basketball", name: home.name, short_name: home.abbreviation || null, country: null,
    });
    dataset.teams.set(awayTeamId, {
      id: awayTeamId, sport: "basketball", name: away.name, short_name: away.abbreviation || null, country: null,
    });
    addFixture(dataset, {
      id: internalId(API_NINJAS_PROVIDER, "fixture", game.game_id), sport: "basketball",
      competition_id: competitionId, season_id: seasonId, home_team_id: homeTeamId, away_team_id: awayTeamId,
      scheduled_at: scheduledAt, status: apiNinjasStatus(game.status),
      home_score: integerOrNull(game.home_score), away_score: integerOrNull(game.away_score),
      venue: game.venue?.name || null, data_quality: game.updated_at ? "good" : "fair",
      source_updated_at: validDate(game.updated_at),
    });
  }
  return dataset;
}

async function getJson(url, headers) {
  let response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  } catch {
    const error = new Error("Network request failed or timed out");
    error.code = "network_error";
    throw error;
  }
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = String(body?.error || body?.message || body?.detail || "");
    } catch {
      detail = "";
    }
    for (const secret of [process.env.API_NINJAS_API_KEY, process.env.FOOTBALL_DATA_TOKEN]) {
      if (secret) detail = detail.replaceAll(secret, "[redacted]");
    }
    detail = detail.replace(/[\r\n\t]+/g, " ").slice(0, 180);
    const error = new Error(`Provider returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    error.code = `http_${response.status}`;
    throw error;
  }
  try {
    return await response.json();
  } catch {
    const error = new Error("Provider returned invalid JSON");
    error.code = "invalid_json";
    throw error;
  }
}

async function fetchFootballData() {
  if (!process.env.FOOTBALL_DATA_TOKEN) {
    const error = new Error("FOOTBALL_DATA_TOKEN is missing in GitHub Secrets");
    error.code = "missing_key";
    throw error;
  }
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 14));
  const endExclusive = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 31));
  const matches = new Map();
  let requestCount = 0;
  for (let cursor = start; cursor < endExclusive;) {
    const next = new Date(Math.min(cursor.getTime() + 7 * 86400000, endExclusive.getTime()));
    const url = new URL("https://api.football-data.org/v4/matches");
    url.searchParams.set("dateFrom", cursor.toISOString().slice(0, 10));
    url.searchParams.set("dateTo", next.toISOString().slice(0, 10));
    requestCount += 1;
    let result;
    try {
      result = await getJson(url, { "X-Auth-Token": process.env.FOOTBALL_DATA_TOKEN });
    } catch (error) {
      error.requestCount = requestCount;
      throw error;
    }
    for (const match of Array.isArray(result.matches) ? result.matches : []) {
      matches.set(String(match.id), match);
    }
    cursor = next;
    if (cursor < endExclusive) await new Promise((resolve) => setTimeout(resolve, 6500));
  }
  return { dataset: fromFootballData([...matches.values()]), requestCount };
}

function currentSeason(league, date = new Date()) {
  const year = date.getUTCFullYear();
  if (league === "nba") return date.getUTCMonth() >= 8 ? year : year - 1;
  return year;
}

async function fetchApiNinjas() {
  if (!process.env.API_NINJAS_API_KEY) {
    const error = new Error("API_NINJAS_API_KEY is missing in GitHub Secrets");
    error.code = "missing_key";
    throw error;
  }
  const games = [];
  let requestCount = 0;
  for (const league of API_NINJAS_BASKETBALL_LEAGUES) {
    const season = currentSeason(league);
    let offset = 0;
    for (let page = 0; page < MAX_BASKETBALL_PAGES; page += 1) {
      const url = new URL("https://api.api-ninjas.com/v1/basketballgames");
      url.searchParams.set("league", league);
      url.searchParams.set("season", String(season));
      url.searchParams.set("offset", String(offset));
      let response;
      try {
        response = await getJson(url, { "X-Api-Key": process.env.API_NINJAS_API_KEY });
        requestCount += 1;
      } catch (error) {
        error.requestCount = requestCount;
        throw error;
      }
      if (!Array.isArray(response)) {
        const error = new Error("API Ninjas returned an unexpected response");
        error.code = "invalid_response";
        error.requestCount = requestCount;
        throw error;
      }
      games.push(...response);
      if (response.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
      if (page === MAX_BASKETBALL_PAGES - 1) {
        const error = new Error("Basketball schedule exceeded the sync page limit");
        error.code = "page_limit";
        error.requestCount = requestCount;
        throw error;
      }
    }
  }
  return { dataset: fromApiNinjas(games), requestCount };
}

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function upserts(table, columns, rows, updateColumns, batchSize = 20) {
  const statements = [];
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const chunk = rows.slice(offset, offset + batchSize);
    const values = chunk.map((row) => `(${columns.map((column) => sql(row[column])).join(",")})`).join(",\n");
    const updates = updateColumns.map((column) => `${column}=excluded.${column}`).join(",");
    statements.push(`INSERT INTO ${table} (${columns.join(",")}) VALUES\n${values}\nON CONFLICT(id) DO UPDATE SET ${updates};`);
  }
  return statements;
}

function datasetSql(dataset) {
  return [
    ...upserts("competitions", ["id", "sport", "name", "region"], [...dataset.competitions.values()], ["sport", "name", "region"]),
    ...upserts("seasons", ["id", "competition_id", "name", "starts_on", "ends_on"], [...dataset.seasons.values()], ["competition_id", "name", "starts_on", "ends_on"]),
    ...upserts("teams", ["id", "sport", "name", "short_name", "country"], [...dataset.teams.values()], ["sport", "name", "short_name", "country"]),
    ...upserts("fixtures", ["id", "sport", "competition_id", "season_id", "home_team_id", "away_team_id", "scheduled_at", "status", "home_score", "away_score", "venue", "data_quality", "source_updated_at"], dataset.fixtures, ["sport", "competition_id", "season_id", "home_team_id", "away_team_id", "scheduled_at", "status", "home_score", "away_score", "venue", "data_quality", "source_updated_at"], 7).map((statement) => statement.replace(
      /home_score=excluded\.home_score,away_score=excluded\.away_score/,
      "home_score=COALESCE(excluded.home_score,fixtures.home_score),away_score=COALESCE(excluded.away_score,fixtures.away_score)",
    )),
  ];
}

async function runProvider(providerId, fetcher) {
  const startedAt = new Date().toISOString();
  try {
    const result = await fetcher();
    return {
      providerId, startedAt, finishedAt: new Date().toISOString(), status: "succeeded",
      requestCount: result.requestCount || 0, fixtureCount: result.dataset.fixtures.length,
      dataset: result.dataset, errorCode: null, errorSummary: null,
    };
  } catch (error) {
    return {
      providerId, startedAt, finishedAt: new Date().toISOString(), status: "failed",
      requestCount: Number(error?.requestCount) || 0, fixtureCount: 0, dataset: newDataset(),
      errorCode: String(error?.code || "sync_failed").slice(0, 80),
      errorSummary: String(error?.message || "Provider sync failed").slice(0, 240),
    };
  }
}

function syncRunSql(run) {
  return `INSERT INTO provider_sync_runs (id, provider_id, started_at, finished_at, status, request_count, records_received, error_code, error_summary) VALUES (${sql(randomUUID())},${sql(run.providerId)},${sql(run.startedAt)},${sql(run.finishedAt)},${sql(run.status)},${run.requestCount},${run.fixtureCount},${sql(run.errorCode)},${sql(run.errorSummary)});`;
}

async function main() {
  const runs = [];
  runs.push(await runProvider(FOOTBALL_DATA_PROVIDER, fetchFootballData));
  runs.push(await runProvider(API_NINJAS_PROVIDER, fetchApiNinjas));

  const statements = [];
  for (const run of runs) statements.push(...datasetSql(run.dataset));
  statements.push(...runs.map(syncRunSql));

  const runnerTemp = process.env.RUNNER_TEMP || process.cwd();
  const sqlPath = path.join(runnerTemp, "neobet-provider-sync.sql");
  const resultPath = path.join(runnerTemp, "neobet-provider-sync-result.json");
  fs.writeFileSync(sqlPath, `${statements.join("\n\n")}\n`, { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(resultPath, JSON.stringify(runs.map(({ providerId, status, requestCount, fixtureCount, errorCode, errorSummary }) => ({
    provider: providerId, status, request_count: requestCount, fixtures: fixtureCount, error: errorCode, error_summary: errorSummary,
  }))), { encoding: "utf8", mode: 0o600 });
  console.log(`Prepared D1 import for ${runs.reduce((count, run) => count + run.fixtureCount, 0)} fixtures from ${runs.length} provider(s).`);
  for (const run of runs) {
    console.log(`${run.providerId}: ${run.status}; ${run.requestCount} request(s); ${run.fixtureCount} fixture(s)${run.errorCode ? `; ${run.errorCode}` : ""}${run.errorSummary ? `; ${run.errorSummary}` : ""}`);
  }
}

await main();
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const FOOTBALL_DATA_PROVIDER = "football-data-org";
const API_NINJAS_PROVIDER = "api-ninjas";
const API_NINJAS_BASKETBALL_LEAGUES = ["nba", "wnba"];
const MAX_BASKETBALL_PAGES = 35;
const PAGE_SIZE = 50;
const LEAGUE_NAMES = { nba: "NBA", wnba: "WNBA" };

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function internalId(provider, type, externalId) {
  return `${provider}:${type}:${safeId(externalId)}`;
}

function validDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function integerOrNull(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function footballDataStatus(status) {
  switch (status) {
    case "IN_PLAY":
    case "PAUSED": return "live";
    case "FINISHED":
    case "AWARDED": return "finished";
    case "POSTPONED": return "postponed";
    case "CANCELLED": return "cancelled";
    case "SUSPENDED": return "abandoned";
    default: return "scheduled";
  }
}

function apiNinjasStatus(status) {
  switch (status) {
    case "in_progress": return "live";
    case "final": return "finished";
    case "postponed":
    case "delayed": return "postponed";
    case "canceled": return "cancelled";
    case "suspended": return "abandoned";
    default: return "scheduled";
  }
}

function newDataset() {
  return { competitions: new Map(), seasons: new Map(), teams: new Map(), fixtures: [] };
}

function addFixture(dataset, fixture) {
  if (fixture.id && fixture.scheduled_at && fixture.home_team_id && fixture.away_team_id && fixture.home_team_id !== fixture.away_team_id) {
    dataset.fixtures.push(fixture);
  }
}

function fromFootballData(matches) {
  const dataset = newDataset();
  for (const match of matches) {
    const competition = match.competition;
    const home = match.homeTeam;
    const away = match.awayTeam;
    const scheduledAt = validDate(match.utcDate);
    if (!competition?.id || !home?.id || !away?.id || !scheduledAt) continue;

    const competitionId = internalId(FOOTBALL_DATA_PROVIDER, "competition", competition.id);
    const homeTeamId = internalId(FOOTBALL_DATA_PROVIDER, "team", home.id);
    const awayTeamId = internalId(FOOTBALL_DATA_PROVIDER, "team", away.id);
    const seasonId = match.season?.id == null ? null : internalId(FOOTBALL_DATA_PROVIDER, "season", `${competition.id}-${match.season.id}`);

    dataset.competitions.set(competitionId, {
      id: competitionId, sport: "football", name: competition.name || String(competition.code || competition.id),
      region: competition.area?.name || null,
    });
    if (seasonId) {
      dataset.seasons.set(seasonId, {
        id: seasonId, competition_id: competitionId,
        name: match.season.startDate?.slice(0, 4) || String(match.season.id),
        starts_on: match.season.startDate || null, ends_on: match.season.endDate || null,
      });
    }
    dataset.teams.set(homeTeamId, {
      id: homeTeamId, sport: "football", name: home.name, short_name: home.shortName || home.tla || null,
      country: home.area?.name || competition.area?.name || null,
    });
    dataset.teams.set(awayTeamId, {
      id: awayTeamId, sport: "football", name: away.name, short_name: away.shortName || away.tla || null,
      country: away.area?.name || competition.area?.name || null,
    });

    addFixture(dataset, {
      id: internalId(FOOTBALL_DATA_PROVIDER, "fixture", match.id), sport: "football",
      competition_id: competitionId, season_id: seasonId, home_team_id: homeTeamId, away_team_id: awayTeamId,
      scheduled_at: scheduledAt, status: footballDataStatus(match.status),
      home_score: integerOrNull(match.score?.fullTime?.home), away_score: integerOrNull(match.score?.fullTime?.away),
      venue: match.venue || null, data_quality: match.lastUpdated ? "good" : "fair",
      source_updated_at: validDate(match.lastUpdated),
    });
  }
  return dataset;
}

function fromApiNinjas(games) {
  const dataset = newDataset();
  for (const game of games) {
    const league = game.league;
    const home = game.home_team;
    const away = game.away_team;
    const scheduledAt = validDate(game.start_time || `${game.date}T00:00:00Z`);
    if (!league || !home?.team_id || !away?.team_id || !scheduledAt) continue;

    const competitionId = internalId(API_NINJAS_PROVIDER, "competition", league);
    const homeTeamId = internalId(API_NINJAS_PROVIDER, "team", home.team_id);
    const awayTeamId = internalId(API_NINJAS_PROVIDER, "team", away.team_id);
    const seasonId = game.season == null ? null : internalId(API_NINJAS_PROVIDER, "season", `${league}-${game.season}`);
    dataset.competitions.set(competitionId, {
      id: competitionId, sport: "basketball", name: LEAGUE_NAMES[league] || league.toUpperCase(), region: null,
    });
    if (seasonId) {
      dataset.seasons.set(seasonId, {
        id: seasonId, competition_id: competitionId, name: game.season_label || String(game.season),
        starts_on: null, ends_on: null,
      });
    }
    dataset.teams.set(homeTeamId, {
      id: homeTeamId, sport: "basketball", name: home.name, short_name: home.abbreviation || null, country: null,
    });
    dataset.teams.set(awayTeamId, {
      id: awayTeamId, sport: "basketball", name: away.name, short_name: away.abbreviation || null, country: null,
    });
    addFixture(dataset, {
      id: internalId(API_NINJAS_PROVIDER, "fixture", game.game_id), sport: "basketball",
      competition_id: competitionId, season_id: seasonId, home_team_id: homeTeamId, away_team_id: awayTeamId,
      scheduled_at: scheduledAt, status: apiNinjasStatus(game.status),
      home_score: integerOrNull(game.home_score), away_score: integerOrNull(game.away_score),
      venue: game.venue?.name || null, data_quality: game.updated_at ? "good" : "fair",
      source_updated_at: validDate(game.updated_at),
    });
  }
  return dataset;
}

async function getJson(url, headers) {
  let response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  } catch {
    const error = new Error("Network request failed or timed out");
    error.code = "network_error";
    throw error;
  }
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = String(body?.error || body?.message || body?.detail || "");
    } catch {
      detail = "";
    }
    for (const secret of [process.env.API_NINJAS_API_KEY, process.env.FOOTBALL_DATA_TOKEN]) {
      if (secret) detail = detail.replaceAll(secret, "[redacted]");
    }
    detail = detail.replace(/[\r\n\t]+/g, " ").slice(0, 180);
    const error = new Error(`Provider returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    error.code = `http_${response.status}`;
    throw error;
  }
  try {
    return await response.json();
  } catch {
    const error = new Error("Provider returned invalid JSON");
    error.code = "invalid_json";
    throw error;
  }
}

async function fetchFootballData() {
  if (!process.env.FOOTBALL_DATA_TOKEN) {
    const error = new Error("FOOTBALL_DATA_TOKEN is missing in GitHub Secrets");
    error.code = "missing_key";
    throw error;
  }
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 14));
  const endExclusive = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 31));
  const matches = new Map();
  let requestCount = 0;
  for (let cursor = start; cursor < endExclusive;) {
    const next = new Date(Math.min(cursor.getTime() + 7 * 86400000, endExclusive.getTime()));
    const url = new URL("https://api.football-data.org/v4/matches");
    url.searchParams.set("dateFrom", cursor.toISOString().slice(0, 10));
    url.searchParams.set("dateTo", next.toISOString().slice(0, 10));
    requestCount += 1;
    let result;
    try {
      result = await getJson(url, { "X-Auth-Token": process.env.FOOTBALL_DATA_TOKEN });
    } catch (error) {
      error.requestCount = requestCount;
      throw error;
    }
    for (const match of Array.isArray(result.matches) ? result.matches : []) {
      matches.set(String(match.id), match);
    }
    cursor = next;
    if (cursor < endExclusive) await new Promise((resolve) => setTimeout(resolve, 6500));
  }
  return { dataset: fromFootballData([...matches.values()]), requestCount };
}

function currentSeason(league, date = new Date()) {
  const year = date.getUTCFullYear();
  if (league === "nba") return date.getUTCMonth() >= 8 ? year : year - 1;
  return year;
}

async function fetchApiNinjas() {
  if (!process.env.API_NINJAS_API_KEY) {
    const error = new Error("API_NINJAS_API_KEY is missing in GitHub Secrets");
    error.code = "missing_key";
    throw error;
  }
  const games = [];
  let requestCount = 0;
  for (const league of API_NINJAS_BASKETBALL_LEAGUES) {
    const season = currentSeason(league);
    let offset = 0;
    for (let page = 0; page < MAX_BASKETBALL_PAGES; page += 1) {
      const url = new URL("https://api.api-ninjas.com/v1/basketballgames");
      url.searchParams.set("league", league);
      url.searchParams.set("season", String(season));
      url.searchParams.set("offset", String(offset));
      let response;
      try {
        response = await getJson(url, { "X-Api-Key": process.env.API_NINJAS_API_KEY });
        requestCount += 1;
      } catch (error) {
        error.requestCount = requestCount;
        throw error;
      }
      if (!Array.isArray(response)) {
        const error = new Error("API Ninjas returned an unexpected response");
        error.code = "invalid_response";
        error.requestCount = requestCount;
        throw error;
      }
      games.push(...response);
      if (response.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
      if (page === MAX_BASKETBALL_PAGES - 1) {
        const error = new Error("Basketball schedule exceeded the sync page limit");
        error.code = "page_limit";
        error.requestCount = requestCount;
        throw error;
      }
    }
  }
  return { dataset: fromApiNinjas(games), requestCount };
}

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function upserts(table, columns, rows, updateColumns, batchSize = 20) {
  const statements = [];
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const chunk = rows.slice(offset, offset + batchSize);
    const values = chunk.map((row) => `(${columns.map((column) => sql(row[column])).join(",")})`).join(",\n");
    const updates = updateColumns.map((column) => `${column}=excluded.${column}`).join(",");
    statements.push(`INSERT INTO ${table} (${columns.join(",")}) VALUES\n${values}\nON CONFLICT(id) DO UPDATE SET ${updates};`);
  }
  return statements;
}

function datasetSql(dataset) {
  return [
    ...upserts("competitions", ["id", "sport", "name", "region"], [...dataset.competitions.values()], ["sport", "name", "region"]),
    ...upserts("seasons", ["id", "competition_id", "name", "starts_on", "ends_on"], [...dataset.seasons.values()], ["competition_id", "name", "starts_on", "ends_on"]),
    ...upserts("teams", ["id", "sport", "name", "short_name", "country"], [...dataset.teams.values()], ["sport", "name", "short_name", "country"]),
    ...upserts("fixtures", ["id", "sport", "competition_id", "season_id", "home_team_id", "away_team_id", "scheduled_at", "status", "home_score", "away_score", "venue", "data_quality", "source_updated_at"], dataset.fixtures, ["sport", "competition_id", "season_id", "home_team_id", "away_team_id", "scheduled_at", "status", "home_score", "away_score", "venue", "data_quality", "source_updated_at"], 7).map((statement) => statement.replace(
      /home_score=excluded\.home_score,away_score=excluded\.away_score/,
      "home_score=COALESCE(excluded.home_score,fixtures.home_score),away_score=COALESCE(excluded.away_score,fixtures.away_score)",
    )),
  ];
}

async function runProvider(providerId, fetcher) {
  const startedAt = new Date().toISOString();
  try {
    const result = await fetcher();
    return {
      providerId, startedAt, finishedAt: new Date().toISOString(), status: "succeeded",
      requestCount: result.requestCount || 0, fixtureCount: result.dataset.fixtures.length,
      dataset: result.dataset, errorCode: null, errorSummary: null,
    };
  } catch (error) {
    return {
      providerId, startedAt, finishedAt: new Date().toISOString(), status: "failed",
      requestCount: Number(error?.requestCount) || 0, fixtureCount: 0, dataset: newDataset(),
      errorCode: String(error?.code || "sync_failed").slice(0, 80),
      errorSummary: String(error?.message || "Provider sync failed").slice(0, 240),
    };
  }
}

function syncRunSql(run) {
  return `INSERT INTO provider_sync_runs (id, provider_id, started_at, finished_at, status, request_count, records_received, error_code, error_summary) VALUES (${sql(randomUUID())},${sql(run.providerId)},${sql(run.startedAt)},${sql(run.finishedAt)},${sql(run.status)},${run.requestCount},${run.fixtureCount},${sql(run.errorCode)},${sql(run.errorSummary)});`;
}

async function main() {
  const runs = [];
  runs.push(await runProvider(FOOTBALL_DATA_PROVIDER, fetchFootballData));
  runs.push(await runProvider(API_NINJAS_PROVIDER, fetchApiNinjas));

  const statements = [];
  for (const run of runs) statements.push(...datasetSql(run.dataset));
  statements.push(...runs.map(syncRunSql));

  const runnerTemp = process.env.RUNNER_TEMP || process.cwd();
  const sqlPath = path.join(runnerTemp, "neobet-provider-sync.sql");
  const resultPath = path.join(runnerTemp, "neobet-provider-sync-result.json");
  fs.writeFileSync(sqlPath, `${statements.join("\n\n")}\n`, { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(resultPath, JSON.stringify(runs.map(({ providerId, status, requestCount, fixtureCount, errorCode, errorSummary }) => ({
    provider: providerId, status, request_count: requestCount, fixtures: fixtureCount, error: errorCode, error_summary: errorSummary,
  }))), { encoding: "utf8", mode: 0o600 });
  console.log(`Prepared D1 import for ${runs.reduce((count, run) => count + run.fixtureCount, 0)} fixtures from ${runs.length} provider(s).`);
  for (const run of runs) {
    console.log(`${run.providerId}: ${run.status}; ${run.requestCount} request(s); ${run.fixtureCount} fixture(s)${run.errorCode ? `; ${run.errorCode}` : ""}${run.errorSummary ? `; ${run.errorSummary}` : ""}`);
  }
}

await main();
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const FOOTBALL_DATA_PROVIDER = "football-data-org";
const API_NINJAS_PROVIDER = "api-ninjas";
const API_NINJAS_BASKETBALL_LEAGUES = ["nba", "wnba"];
const MAX_BASKETBALL_PAGES = 35;
const PAGE_SIZE = 50;
const LEAGUE_NAMES = { nba: "NBA", wnba: "WNBA" };

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function internalId(provider, type, externalId) {
  return `${provider}:${type}:${safeId(externalId)}`;
}

function validDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function integerOrNull(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function footballDataStatus(status) {
  switch (status) {
    case "IN_PLAY":
    case "PAUSED": return "live";
    case "FINISHED":
    case "AWARDED": return "finished";
    case "POSTPONED": return "postponed";
    case "CANCELLED": return "cancelled";
    case "SUSPENDED": return "abandoned";
    default: return "scheduled";
  }
}

function apiNinjasStatus(status) {
  switch (status) {
    case "in_progress": return "live";
    case "final": return "finished";
    case "postponed":
    case "delayed": return "postponed";
    case "canceled": return "cancelled";
    case "suspended": return "abandoned";
    default: return "scheduled";
  }
}

function newDataset() {
  return { competitions: new Map(), seasons: new Map(), teams: new Map(), fixtures: [] };
}

function addFixture(dataset, fixture) {
  if (fixture.id && fixture.scheduled_at && fixture.home_team_id && fixture.away_team_id && fixture.home_team_id !== fixture.away_team_id) {
    dataset.fixtures.push(fixture);
  }
}

function fromFootballData(matches) {
  const dataset = newDataset();
  for (const match of matches) {
    const competition = match.competition;
    const home = match.homeTeam;
    const away = match.awayTeam;
    const scheduledAt = validDate(match.utcDate);
    if (!competition?.id || !home?.id || !away?.id || !scheduledAt) continue;

    const competitionId = internalId(FOOTBALL_DATA_PROVIDER, "competition", competition.id);
    const homeTeamId = internalId(FOOTBALL_DATA_PROVIDER, "team", home.id);
    const awayTeamId = internalId(FOOTBALL_DATA_PROVIDER, "team", away.id);
    const seasonId = match.season?.id == null ? null : internalId(FOOTBALL_DATA_PROVIDER, "season", `${competition.id}-${match.season.id}`);

    dataset.competitions.set(competitionId, {
      id: competitionId, sport: "football", name: competition.name || String(competition.code || competition.id),
      region: competition.area?.name || null,
    });
    if (seasonId) {
      dataset.seasons.set(seasonId, {
        id: seasonId, competition_id: competitionId,
        name: match.season.startDate?.slice(0, 4) || String(match.season.id),
        starts_on: match.season.startDate || null, ends_on: match.season.endDate || null,
      });
    }
    dataset.teams.set(homeTeamId, {
      id: homeTeamId, sport: "football", name: home.name, short_name: home.shortName || home.tla || null,
      country: home.area?.name || competition.area?.name || null,
    });
    dataset.teams.set(awayTeamId, {
      id: awayTeamId, sport: "football", name: away.name, short_name: away.shortName || away.tla || null,
      country: away.area?.name || competition.area?.name || null,
    });

    addFixture(dataset, {
      id: internalId(FOOTBALL_DATA_PROVIDER, "fixture", match.id), sport: "football",
      competition_id: competitionId, season_id: seasonId, home_team_id: homeTeamId, away_team_id: awayTeamId,
      scheduled_at: scheduledAt, status: footballDataStatus(match.status),
      home_score: integerOrNull(match.score?.fullTime?.home), away_score: integerOrNull(match.score?.fullTime?.away),
      venue: match.venue || null, data_quality: match.lastUpdated ? "good" : "fair",
      source_updated_at: validDate(match.lastUpdated),
    });
  }
  return dataset;
}

function fromApiNinjas(games) {
  const dataset = newDataset();
  for (const game of games) {
    const league = game.league;
    const home = game.home_team;
    const away = game.away_team;
    const scheduledAt = validDate(game.start_time || `${game.date}T00:00:00Z`);
    if (!league || !home?.team_id || !away?.team_id || !scheduledAt) continue;

    const competitionId = internalId(API_NINJAS_PROVIDER, "competition", league);
    const homeTeamId = internalId(API_NINJAS_PROVIDER, "team", home.team_id);
    const awayTeamId = internalId(API_NINJAS_PROVIDER, "team", away.team_id);
    const seasonId = game.season == null ? null : internalId(API_NINJAS_PROVIDER, "season", `${league}-${game.season}`);
    dataset.competitions.set(competitionId, {
      id: competitionId, sport: "basketball", name: LEAGUE_NAMES[league] || league.toUpperCase(), region: null,
    });
    if (seasonId) {
      dataset.seasons.set(seasonId, {
        id: seasonId, competition_id: competitionId, name: game.season_label || String(game.season),
        starts_on: null, ends_on: null,
      });
    }
    dataset.teams.set(homeTeamId, {
      id: homeTeamId, sport: "basketball", name: home.name, short_name: home.abbreviation || null, country: null,
    });
    dataset.teams.set(awayTeamId, {
      id: awayTeamId, sport: "basketball", name: away.name, short_name: away.abbreviation || null, country: null,
    });
    addFixture(dataset, {
      id: internalId(API_NINJAS_PROVIDER, "fixture", game.game_id), sport: "basketball",
      competition_id: competitionId, season_id: seasonId, home_team_id: homeTeamId, away_team_id: awayTeamId,
      scheduled_at: scheduledAt, status: apiNinjasStatus(game.status),
      home_score: integerOrNull(game.home_score), away_score: integerOrNull(game.away_score),
      venue: game.venue?.name || null, data_quality: game.updated_at ? "good" : "fair",
      source_updated_at: validDate(game.updated_at),
    });
  }
  return dataset;
}

async function getJson(url, headers) {
  let response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  } catch {
    const error = new Error("Network request failed or timed out");
    error.code = "network_error";
    throw error;
  }
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = String(body?.error || body?.message || body?.detail || "");
    } catch {
      detail = "";
    }
    for (const secret of [process.env.API_NINJAS_API_KEY, process.env.FOOTBALL_DATA_TOKEN]) {
      if (secret) detail = detail.replaceAll(secret, "[redacted]");
    }
    detail = detail.replace(/[\r\n\t]+/g, " ").slice(0, 180);
    const error = new Error(`Provider returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    error.code = `http_${response.status}`;
    throw error;
  }
  try {
    return await response.json();
  } catch {
    const error = new Error("Provider returned invalid JSON");
    error.code = "invalid_json";
    throw error;
  }
}

async function fetchFootballData() {
  if (!process.env.FOOTBALL_DATA_TOKEN) {
    const error = new Error("FOOTBALL_DATA_TOKEN is missing in GitHub Secrets");
    error.code = "missing_key";
    throw error;
  }
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 14));
  const endExclusive = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 31));
  const matches = new Map();
  let requestCount = 0;
  for (let cursor = start; cursor < endExclusive;) {
    const next = new Date(Math.min(cursor.getTime() + 7 * 86400000, endExclusive.getTime()));
    const url = new URL("https://api.football-data.org/v4/matches");
    url.searchParams.set("dateFrom", cursor.toISOString().slice(0, 10));
    url.searchParams.set("dateTo", next.toISOString().slice(0, 10));
    requestCount += 1;
    let result;
    try {
      result = await getJson(url, { "X-Auth-Token": process.env.FOOTBALL_DATA_TOKEN });
    } catch (error) {
      error.requestCount = requestCount;
      throw error;
    }
    for (const match of Array.isArray(result.matches) ? result.matches : []) {
      matches.set(String(match.id), match);
    }
    cursor = next;
    if (cursor < endExclusive) await new Promise((resolve) => setTimeout(resolve, 6500));
  }
  return { dataset: fromFootballData([...matches.values()]), requestCount };
}

function currentSeason(league, date = new Date()) {
  const year = date.getUTCFullYear();
  if (league === "nba") return date.getUTCMonth() >= 8 ? year : year - 1;
  return year;
}

async function fetchApiNinjas() {
  if (!process.env.API_NINJAS_API_KEY) {
    const error = new Error("API_NINJAS_API_KEY is missing in GitHub Secrets");
    error.code = "missing_key";
    throw error;
  }
  const games = [];
  let requestCount = 0;
  for (const league of API_NINJAS_BASKETBALL_LEAGUES) {
    const season = currentSeason(league);
    let offset = 0;
    for (let page = 0; page < MAX_BASKETBALL_PAGES; page += 1) {
      const url = new URL("https://api.api-ninjas.com/v1/basketballgames");
      url.searchParams.set("league", league);
      url.searchParams.set("season", String(season));
      url.searchParams.set("offset", String(offset));
      let response;
      try {
        response = await getJson(url, { "X-Api-Key": process.env.API_NINJAS_API_KEY });
        requestCount += 1;
      } catch (error) {
        error.requestCount = requestCount;
        throw error;
      }
      if (!Array.isArray(response)) {
        const error = new Error("API Ninjas returned an unexpected response");
        error.code = "invalid_response";
        error.requestCount = requestCount;
        throw error;
      }
      games.push(...response);
      if (response.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
      if (page === MAX_BASKETBALL_PAGES - 1) {
        const error = new Error("Basketball schedule exceeded the sync page limit");
        error.code = "page_limit";
        error.requestCount = requestCount;
        throw error;
      }
    }
  }
  return { dataset: fromApiNinjas(games), requestCount };
}

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function upserts(table, columns, rows, updateColumns, batchSize = 20) {
  const statements = [];
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const chunk = rows.slice(offset, offset + batchSize);
    const values = chunk.map((row) => `(${columns.map((column) => sql(row[column])).join(",")})`).join(",\n");
    const updates = updateColumns.map((column) => `${column}=excluded.${column}`).join(",");
    statements.push(`INSERT INTO ${table} (${columns.join(",")}) VALUES\n${values}\nON CONFLICT(id) DO UPDATE SET ${updates};`);
  }
  return statements;
}

function datasetSql(dataset) {
  return [
    ...upserts("competitions", ["id", "sport", "name", "region"], [...dataset.competitions.values()], ["sport", "name", "region"]),
    ...upserts("seasons", ["id", "competition_id", "name", "starts_on", "ends_on"], [...dataset.seasons.values()], ["competition_id", "name", "starts_on", "ends_on"]),
    ...upserts("teams", ["id", "sport", "name", "short_name", "country"], [...dataset.teams.values()], ["sport", "name", "short_name", "country"]),
    ...upserts("fixtures", ["id", "sport", "competition_id", "season_id", "home_team_id", "away_team_id", "scheduled_at", "status", "home_score", "away_score", "venue", "data_quality", "source_updated_at"], dataset.fixtures, ["sport", "competition_id", "season_id", "home_team_id", "away_team_id", "scheduled_at", "status", "home_score", "away_score", "venue", "data_quality", "source_updated_at"], 7).map((statement) => statement.replace(
      /home_score=excluded\.home_score,away_score=excluded\.away_score/,
      "home_score=COALESCE(excluded.home_score,fixtures.home_score),away_score=COALESCE(excluded.away_score,fixtures.away_score)",
    )),
  ];
}

async function runProvider(providerId, fetcher) {
  const startedAt = new Date().toISOString();
  try {
    const result = await fetcher();
    return {
      providerId, startedAt, finishedAt: new Date().toISOString(), status: "succeeded",
      requestCount: result.requestCount || 0, fixtureCount: result.dataset.fixtures.length,
      dataset: result.dataset, errorCode: null, errorSummary: null,
    };
  } catch (error) {
    return {
      providerId, startedAt, finishedAt: new Date().toISOString(), status: "failed",
      requestCount: Number(error?.requestCount) || 0, fixtureCount: 0, dataset: newDataset(),
      errorCode: String(error?.code || "sync_failed").slice(0, 80),
      errorSummary: String(error?.message || "Provider sync failed").slice(0, 240),
    };
  }
}

function syncRunSql(run) {
  return `INSERT INTO provider_sync_runs (id, provider_id, started_at, finished_at, status, request_count, records_received, error_code, error_summary) VALUES (${sql(randomUUID())},${sql(run.providerId)},${sql(run.startedAt)},${sql(run.finishedAt)},${sql(run.status)},${run.requestCount},${run.fixtureCount},${sql(run.errorCode)},${sql(run.errorSummary)});`;
}

async function main() {
  const runs = [];
  runs.push(await runProvider(FOOTBALL_DATA_PROVIDER, fetchFootballData));
  runs.push(await runProvider(API_NINJAS_PROVIDER, fetchApiNinjas));

  const statements = [];
  for (const run of runs) statements.push(...datasetSql(run.dataset));
  statements.push(...runs.map(syncRunSql));

  const runnerTemp = process.env.RUNNER_TEMP || process.cwd();
  const sqlPath = path.join(runnerTemp, "neobet-provider-sync.sql");
  const resultPath = path.join(runnerTemp, "neobet-provider-sync-result.json");
  fs.writeFileSync(sqlPath, `${statements.join("\n\n")}\n`, { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(resultPath, JSON.stringify(runs.map(({ providerId, status, requestCount, fixtureCount, errorCode, errorSummary }) => ({
    provider: providerId, status, request_count: requestCount, fixtures: fixtureCount, error: errorCode, error_summary: errorSummary,
  }))), { encoding: "utf8", mode: 0o600 });
  console.log(`Prepared D1 import for ${runs.reduce((count, run) => count + run.fixtureCount, 0)} fixtures from ${runs.length} provider(s).`);
  for (const run of runs) {
    console.log(`${run.providerId}: ${run.status}; ${run.requestCount} request(s); ${run.fixtureCount} fixture(s)${run.errorCode ? `; ${run.errorCode}` : ""}${run.errorSummary ? `; ${run.errorSummary}` : ""}`);
  }
}

await main();
