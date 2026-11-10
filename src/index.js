const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function api(request, env, url) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/health") {
    if (!env.DB) return json({ ok: false, database: "not_bound" }, 503);
    try {
      const result = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'fixtures' LIMIT 1",
      ).first();
      if (!result) return json({ ok: false, database: "schema_pending" }, 503);
      return json({ ok: true, database: "connected", schema: "ready" });
    } catch {
      return json({ ok: false, database: "unavailable" }, 503);
    }
  }

  if (url.pathname === "/api/predictions") {
    if (!env.DB) return json({ error: "Database is not configured" }, 503);

    const sport = url.searchParams.get("sport");
    const matchDate = url.searchParams.get("date");
    if (sport && sport !== "football" && sport !== "basketball") {
      return json({ error: "sport must be football or basketball" }, 400);
    }
    if (matchDate && !isIsoDate(matchDate)) {
      return json({ error: "date must be a valid YYYY-MM-DD date" }, 400);
    }

    const conditions = ["p.status = 'published'"];
    const bindings = [];
    if (sport) {
      conditions.push("p.sport = ?");
      bindings.push(sport);
    }
    if (matchDate) {
      conditions.push("substr(f.scheduled_at, 1, 10) = ?");
      bindings.push(matchDate);
    }

    const query = `
      SELECT
        p.id, p.sport, p.market, p.selection, p.decision, p.probability,
        p.calibrated, p.model_confidence, p.model_uncertainty,
        p.data_quality, p.value_estimate, p.odds_required,
        p.no_bet_reason, p.model_name, p.model_version, p.published_at,
        f.id AS fixture_id, f.scheduled_at, f.source_updated_at,
        competition.name AS competition,
        home.name AS home_team, away.name AS away_team,
        odds.decimal_odds, odds.observed_at AS odds_observed_at
      FROM predictions AS p
      JOIN fixtures AS f ON f.id = p.fixture_id
      LEFT JOIN competitions AS competition ON competition.id = f.competition_id
      JOIN teams AS home ON home.id = f.home_team_id
      JOIN teams AS away ON away.id = f.away_team_id
      LEFT JOIN odds_snapshots AS odds ON odds.id = p.odds_snapshot_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY f.scheduled_at ASC, p.published_at DESC
      LIMIT 100
    `;

    try {
      const result = await env.DB.prepare(query).bind(...bindings).all();
      return json({ predictions: result.results || [] });
    } catch {
      return json({ error: "Predictions are temporarily unavailable" }, 503);
    }
  }

  if (url.pathname === "/api/fixtures") {
    if (!env.DB) return json({ error: "Database is not configured" }, 503);

    const sport = url.searchParams.get("sport");
    const matchDate = url.searchParams.get("date");
    if (sport && sport !== "football" && sport !== "basketball") {
      return json({ error: "sport must be football or basketball" }, 400);
    }
    if (matchDate && !isIsoDate(matchDate)) {
      return json({ error: "date must be a valid YYYY-MM-DD date" }, 400);
    }

    const now = new Date();
    const from = matchDate
      ? `${matchDate}T00:00:00.000Z`
      : new Date(now.getTime() - 14 * 86400000).toISOString();
    const to = matchDate
      ? new Date(new Date(`${matchDate}T00:00:00.000Z`).getTime() + 86400000).toISOString()
      : new Date(now.getTime() + 30 * 86400000).toISOString();
    const conditions = ["f.scheduled_at >= ?", "f.scheduled_at < ?"];
    const bindings = [from, to];
    if (sport) {
      conditions.push("f.sport = ?");
      bindings.push(sport);
    }

    try {
      const result = await env.DB.prepare(`
        SELECT
          f.id, f.sport, f.scheduled_at, f.status, f.home_score, f.away_score,
          f.venue, f.data_quality, f.source_updated_at,
          competition.name AS competition,
          home.name AS home_team, away.name AS away_team
        FROM fixtures AS f
        LEFT JOIN competitions AS competition ON competition.id = f.competition_id
        JOIN teams AS home ON home.id = f.home_team_id
        JOIN teams AS away ON away.id = f.away_team_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY f.scheduled_at ASC
        LIMIT 250
      `).bind(...bindings).all();
      return json({ fixtures: result.results || [] });
    } catch {
      return json({ error: "Fixtures are temporarily unavailable" }, 503);
    }
  }

  if (url.pathname === "/api/shadow-lab") {
    if (!env.DB) return json({ error: "Database is not configured" }, 503);
    const modelProfiles = [
      { id: "football-poisson-dirichlet-shadow-0-1-0", competition: "Premier League" },
      { id: "football-poisson-dirichlet-shadow-en-2-0-1-0", competition: "Championship" },
      { id: "football-poisson-dirichlet-shadow-pt-1-0-1-0", competition: "Primeira Liga" },
      { id: "football-poisson-dirichlet-shadow-it-1-0-1-0", competition: "Serie A" },
      { id: "football-poisson-dirichlet-shadow-br-1-0-1-0", competition: "Campeonato Brasileiro Série A" },
    ];
    const suppliedFrom = url.searchParams.get("from");
    const suppliedTo = url.searchParams.get("to");
    const todayParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const today = Object.fromEntries(todayParts.map((part) => [part.type, part.value]));
    const lagosStart = Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day)) - 3600000;
    const from = suppliedFrom || new Date(lagosStart).toISOString();
    const to = suppliedTo || new Date(lagosStart + 86400000).toISOString();
    const fromTime = Date.parse(from);
    const toTime = Date.parse(to);
    if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || toTime <= fromTime ||
      toTime - fromTime < 22 * 3600000 || toTime - fromTime > 26 * 3600000) {
      return json({ error: "from and to must define one local calendar day as ISO timestamps" }, 400);
    }
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    try {
      const ids = modelProfiles.map((profile) => `'${profile.id}'`).join(",");
      const result = await env.DB.prepare(`
        SELECT p.fixture_id, p.model_version_id, p.selection, p.probability, p.created_at,
          f.scheduled_at, f.status, f.home_score, f.away_score,
          competition.name AS competition, home.name AS home_team, away.name AS away_team
        FROM predictions AS p
        JOIN fixtures AS f ON f.id = p.fixture_id
        LEFT JOIN competitions AS competition ON competition.id = f.competition_id
        JOIN teams AS home ON home.id = f.home_team_id
        JOIN teams AS away ON away.id = f.away_team_id
        WHERE p.model_version_id IN (${ids}) AND p.sport = 'football'
          AND p.status = 'draft' AND p.decision = 'no_bet' AND p.calibrated = 0
          AND p.market = '1X2'
        ORDER BY f.scheduled_at DESC
        LIMIT 6000
      `).all();
      const dailyFixtures = await env.DB.prepare(`
        SELECT f.id AS fixture_id, f.scheduled_at, f.data_quality,
          competition.name AS competition, home.name AS home_team, away.name AS away_team
        FROM fixtures AS f
        LEFT JOIN competitions AS competition ON competition.id = f.competition_id
        JOIN teams AS home ON home.id = f.home_team_id
        JOIN teams AS away ON away.id = f.away_team_id
        WHERE f.sport = 'football' AND f.status = 'scheduled'
          AND f.scheduled_at >= ? AND f.scheduled_at < ? AND f.scheduled_at > ?
          AND competition.name IS NOT NULL
        ORDER BY f.scheduled_at ASC LIMIT 500
      `).bind(from, to, nowIso).all();
      const rows = result.results || [];
      const groups = new Map();
      for (const row of rows) {
        if (!Number.isFinite(Date.parse(row.scheduled_at)) || !Number.isFinite(Date.parse(row.created_at)) ||
          !["home", "draw", "away"].includes(row.selection) || !Number.isFinite(row.probability)) continue;
        const key = `${row.model_version_id}|${row.fixture_id}`;
        if (!groups.has(key)) groups.set(key, {
          model_version_id: row.model_version_id, competition: row.competition,
          fixture_id: row.fixture_id, scheduled_at: row.scheduled_at, status: row.status,
          home_team: row.home_team, away_team: row.away_team,
          home_score: row.home_score, away_score: row.away_score,
          created_at: row.created_at, probabilities: {},
        });
        groups.get(key).probabilities[row.selection] = row.probability;
      }
      const complete = [...groups.values()].filter((match) => {
        const outcomes = ["home", "draw", "away"];
        if (outcomes.some((outcome) => !Number.isFinite(match.probabilities[outcome]))) return false;
        const total = outcomes.reduce((sum, outcome) => sum + match.probabilities[outcome], 0);
        return Math.abs(total - 1) <= 0.002 && Date.parse(match.created_at) < Date.parse(match.scheduled_at);
      });
      const score = (matches) => {
        let correct = 0;
        let brier = 0;
        let logLoss = 0;
        const bins = Object.fromEntries(["home", "draw", "away"].map((outcome) => [outcome,
          Array.from({ length: 10 }, () => ({ n: 0, predicted: 0, observed: 0 }))]));
        for (const match of matches) {
          const actual = match.home_score > match.away_score ? "home" : match.home_score === match.away_score ? "draw" : "away";
          const predicted = ["home", "draw", "away"].reduce((best, outcome) =>
            match.probabilities[outcome] > match.probabilities[best] ? outcome : best, "home");
          if (predicted === actual) correct += 1;
          for (const outcome of ["home", "draw", "away"]) {
            const probability = match.probabilities[outcome];
            const observed = actual === outcome ? 1 : 0;
            brier += (probability - observed) ** 2;
            if (outcome === actual) logLoss -= Math.log(Math.max(1e-15, probability));
            const bin = bins[outcome][Math.min(9, Math.floor(probability * 10))];
            bin.n += 1; bin.predicted += probability; bin.observed += observed;
          }
        }
        let eceTotal = 0;
        let outcomeCount = 0;
        for (const outcome of ["home", "draw", "away"]) {
          const outcomeN = bins[outcome].reduce((sum, bin) => sum + bin.n, 0);
          if (!outcomeN) continue;
          const ece = bins[outcome].reduce((sum, bin) => sum + (bin.n / outcomeN) *
            (bin.n ? Math.abs(bin.predicted / bin.n - bin.observed / bin.n) : 0), 0);
          eceTotal += ece; outcomeCount += 1;
        }
        return matches.length ? {
          settled_matches: matches.length, accuracy: correct / matches.length,
          multiclass_brier_score: brier / matches.length,
          log_loss: logLoss / matches.length,
          mean_one_vs_rest_ece: outcomeCount ? eceTotal / outcomeCount : null,
        } : { settled_matches: 0, accuracy: null, multiclass_brier_score: null, log_loss: null, mean_one_vs_rest_ece: null };
      };
      const leagues = modelProfiles.map((profile) => {
        const profileMatches = complete.filter((match) => match.model_version_id === profile.id);
        const settled = profileMatches.filter((match) => match.status === "finished" &&
          Number.isInteger(match.home_score) && Number.isInteger(match.away_score));
        const forecastByFixture = new Map(profileMatches
          .filter((match) => match.status === "scheduled" && Date.parse(match.scheduled_at) > now)
          .map((match) => [match.fixture_id, match]));
        const upcoming = (dailyFixtures.results || []).filter((fixture) => fixture.competition === profile.competition)
          .map((fixture) => {
            const forecast = forecastByFixture.get(fixture.fixture_id);
            return {
              fixture_id: fixture.fixture_id, scheduled_at: fixture.scheduled_at,
              home_team: fixture.home_team, away_team: fixture.away_team,
              data_quality: fixture.data_quality, probabilities: forecast?.probabilities || null,
              decision: "NO BET",
              reason: forecast ? "Public experimental estimate only; no approved pick." : "No eligible league model estimate is available; NO BET.",
            };
          });
        return {
          competition: profile.competition,
          model_status: profileMatches.length
            ? "unverified shadow experiment; not approved for public picks"
            : "no eligible shadow model forecast; NO BET",
          metrics: score(settled),
          upcoming: upcoming.slice(0, 30),
        };
      });
      const knownCompetitions = new Set(modelProfiles.map((profile) => profile.competition));
      const additionalCompetitions = new Map();
      for (const fixture of dailyFixtures.results || []) {
        if (!fixture.competition || knownCompetitions.has(fixture.competition)) continue;
        if (!additionalCompetitions.has(fixture.competition)) additionalCompetitions.set(fixture.competition, []);
        additionalCompetitions.get(fixture.competition).push({
          fixture_id: fixture.fixture_id, scheduled_at: fixture.scheduled_at,
          home_team: fixture.home_team, away_team: fixture.away_team,
          data_quality: fixture.data_quality, probabilities: null, decision: "NO BET",
          reason: "No eligible league model estimate is available; NO BET.",
        });
      }
      for (const [competition, upcoming] of additionalCompetitions) {
        leagues.push({ competition, model_status: "no eligible shadow model forecast; NO BET",
          metrics: score([]), upcoming });
      }
      return json({ generated_at: new Date().toISOString(), day_from: from, day_to: to,
        publication_status: "public experimental results; no approved picks", leagues });
    } catch {
      return json({ error: "Shadow experiment results are temporarily unavailable" }, 503);
    }
  }

  if (url.pathname === "/api/data-status") {
    if (!env.DB) return json({ error: "Database is not configured" }, 503);
    try {
      const result = await env.DB.prepare(`
        SELECT p.name AS provider, r.started_at, r.finished_at, r.status,
          r.request_count, r.records_received, r.error_code
        FROM provider_sync_runs AS r
        JOIN providers AS p ON p.id = r.provider_id
        WHERE r.started_at = (
          SELECT MAX(latest.started_at)
          FROM provider_sync_runs AS latest
          WHERE latest.provider_id = r.provider_id
        )
        ORDER BY p.name
      `).all();
      return json({ providers: result.results || [] });
    } catch {
      return json({ error: "Provider status is temporarily unavailable" }, 503);
    }
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return api(request, env, url);
    return env.ASSETS.fetch(request);
  },
};
