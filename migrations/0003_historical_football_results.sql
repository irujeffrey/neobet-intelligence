-- Historical outcome data is stored separately from live fixtures because
-- OpenFootball provides match dates but not reliable kickoff timestamps.
INSERT OR IGNORE INTO providers (
  id, name, documentation_url, terms_url, licensing_status,
  public_display_allowed, advertising_supported_allowed, attribution_required,
  storage_allowed, attribution_text, restrictions, verified_at
) VALUES (
  'openfootball',
  'OpenFootball (CC0)',
  'https://github.com/openfootball/football.json',
  'https://github.com/openfootball/football.json/blob/master/LICENSE.md',
  'approved', 1, 1, 0, 1,
  'Historical football results from OpenFootball (CC0 1.0)',
  'CC0 public-domain dataset. This import is limited to completed English Premier League matches; source dates have no kickoff time. Review season coverage and data quality before model use.',
  '2026-11-06T00:00:00.000Z'
);

CREATE TABLE IF NOT EXISTS historical_match_results (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
  competition_code TEXT NOT NULL,
  competition_name TEXT NOT NULL,
  season TEXT NOT NULL,
  match_date TEXT NOT NULL CHECK (match_date GLOB '????-??-??'),
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_goals INTEGER NOT NULL CHECK (home_goals >= 0),
  away_goals INTEGER NOT NULL CHECK (away_goals >= 0),
  source_url TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (provider_id, competition_code, season, match_date, home_team, away_team)
);

CREATE INDEX IF NOT EXISTS idx_historical_results_competition_season_date
  ON historical_match_results (competition_code, season, match_date);
CREATE INDEX IF NOT EXISTS idx_historical_results_teams_date
  ON historical_match_results (home_team, away_team, match_date);
