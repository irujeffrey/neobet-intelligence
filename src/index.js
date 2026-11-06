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
    const from = now.toISOString();
    const to = matchDate
      ? new Date(
          new Date(`${matchDate}T00:00:00.000Z`).getTime() + 86400000,
        ).toISOString()
      : new Date(now.getTime() + 30 * 86400000).toISOString();
           const conditions = ["f.scheduled_at >= ?", "f.scheduled_at < ?"];
    const bindings = [from, to];

    if (matchDate) {
      conditions.push("substr(f.scheduled_at, 1, 10) = ?");
      bindings.push(matchDate);
    }
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
