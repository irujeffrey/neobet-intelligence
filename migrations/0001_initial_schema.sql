-- NeoBet Intelligence initial D1 schema.
-- Timestamps are stored as ISO-8601 UTC text and JSON payloads as text so the
-- schema remains straightforward to migrate from SQLite/D1 to PostgreSQL.

PRAGMA foreign_keys = ON;

CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  documentation_url TEXT,
  terms_url TEXT,
  licensing_status TEXT NOT NULL DEFAULT 'not_approved'
    CHECK (licensing_status IN ('approved', 'development_only', 'not_approved')),
  public_display_allowed INTEGER NOT NULL DEFAULT 0 CHECK (public_display_allowed IN (0, 1)),
  advertising_supported_allowed INTEGER NOT NULL DEFAULT 0 CHECK (advertising_supported_allowed IN (0, 1)),
  attribution_required INTEGER NOT NULL DEFAULT 0 CHECK (attribution_required IN (0, 1)),
  storage_allowed INTEGER NOT NULL DEFAULT 0 CHECK (storage_allowed IN (0, 1)),
  free_daily_request_limit INTEGER CHECK (free_daily_request_limit IS NULL OR free_daily_request_limit >= 0),
  attribution_text TEXT,
  restrictions TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE competitions (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL CHECK (sport IN ('football', 'basketball')),
  name TEXT NOT NULL,
  region TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (sport, name, region)
);

CREATE TABLE seasons (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  starts_on TEXT,
  ends_on TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (competition_id, name)
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL CHECK (sport IN ('football', 'basketball')),
  name TEXT NOT NULL,
  short_name TEXT,
  country TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (sport, name, country)
);

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL CHECK (sport IN ('football', 'basketball')),
  full_name TEXT NOT NULL,
  date_of_birth TEXT,
  nationality TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE team_rosters (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  season_id TEXT REFERENCES seasons(id) ON DELETE RESTRICT,
  starts_on TEXT,
  ends_on TEXT,
  UNIQUE (team_id, player_id, season_id, starts_on)
);

CREATE TABLE fixtures (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL CHECK (sport IN ('football', 'basketball')),
  competition_id TEXT REFERENCES competitions(id) ON DELETE RESTRICT,
  season_id TEXT REFERENCES seasons(id) ON DELETE RESTRICT,
  home_team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  away_team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'live', 'finished', 'postponed', 'cancelled', 'abandoned')),
  home_score INTEGER CHECK (home_score IS NULL OR home_score >= 0),
  away_score INTEGER CHECK (away_score IS NULL OR away_score >= 0),
  venue TEXT,
  data_quality TEXT NOT NULL DEFAULT 'unavailable'
    CHECK (data_quality IN ('good', 'fair', 'poor', 'unavailable')),
  source_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (home_team_id <> away_team_id)
);

CREATE TABLE provider_external_ids (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
  entity_type TEXT NOT NULL
    CHECK (entity_type IN ('competition', 'season', 'team', 'player', 'fixture')),
  entity_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (provider_id, entity_type, external_id)
);

CREATE TABLE team_match_statistics (
  id TEXT PRIMARY KEY,
  fixture_id TEXT NOT NULL REFERENCES fixtures(id) ON DELETE RESTRICT,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT,
  observed_at TEXT NOT NULL,
  UNIQUE (fixture_id, team_id, provider_id, metric)
);

CREATE TABLE player_match_statistics (
  id TEXT PRIMARY KEY,
  fixture_id TEXT NOT NULL REFERENCES fixtures(id) ON DELETE RESTRICT,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  team_id TEXT REFERENCES teams(id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT,
  observed_at TEXT NOT NULL,
  UNIQUE (fixture_id, player_id, provider_id, metric)
);

CREATE TABLE odds_snapshots (
  id TEXT PRIMARY KEY,
  fixture_id TEXT NOT NULL REFERENCES fixtures(id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
  bookmaker TEXT NOT NULL,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  decimal_odds REAL NOT NULL CHECK (decimal_odds > 1.0),
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE model_versions (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL CHECK (sport IN ('football', 'basketball')),
  model_name TEXT NOT NULL,
  version TEXT NOT NULL,
  calibration_method TEXT,
  calibration_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (calibration_status IN ('calibrated', 'unverified', 'retired')),
  training_data_start TEXT,
  training_data_end TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (sport, model_name, version)
);

CREATE TABLE predictions (
  id TEXT PRIMARY KEY,
  fixture_id TEXT NOT NULL REFERENCES fixtures(id) ON DELETE RESTRICT,
  model_version_id TEXT NOT NULL REFERENCES model_versions(id) ON DELETE RESTRICT,
  sport TEXT NOT NULL CHECK (sport IN ('football', 'basketball')),
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('pick', 'no_bet')),
  probability REAL CHECK (probability IS NULL OR (probability >= 0.0 AND probability <= 1.0)),
  calibrated INTEGER NOT NULL DEFAULT 0 CHECK (calibrated IN (0, 1)),
  model_confidence REAL CHECK (model_confidence IS NULL OR (model_confidence >= 0.0 AND model_confidence <= 1.0)),
  model_uncertainty REAL CHECK (model_uncertainty IS NULL OR (model_uncertainty >= 0.0 AND model_uncertainty <= 1.0)),
  data_quality TEXT NOT NULL CHECK (data_quality IN ('good', 'fair', 'poor', 'unavailable')),
  value_estimate REAL,
  odds_required INTEGER NOT NULL DEFAULT 0 CHECK (odds_required IN (0, 1)),
  odds_snapshot_id TEXT REFERENCES odds_snapshots(id) ON DELETE RESTRICT,
  no_bet_reason TEXT,
  explanation TEXT,
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (status <> 'published' OR published_at IS NOT NULL),
  CHECK (status <> 'published' OR decision <> 'no_bet' OR no_bet_reason IS NOT NULL)
);

CREATE TABLE prediction_settlements (
  id TEXT PRIMARY KEY,
  prediction_id TEXT NOT NULL UNIQUE REFERENCES predictions(id) ON DELETE RESTRICT,
  result TEXT NOT NULL CHECK (result IN ('win', 'loss', 'push', 'void')),
  settled_at TEXT NOT NULL,
  provider_id TEXT REFERENCES providers(id) ON DELETE RESTRICT,
  source_reference TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE prediction_audit_events (
  id TEXT PRIMARY KEY,
  prediction_id TEXT NOT NULL REFERENCES predictions(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('published', 'settled', 'settlement_corrected')),
  event_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decision TEXT,
  probability REAL,
  model_name TEXT,
  model_version TEXT,
  data_quality TEXT,
  settlement_result TEXT,
  previous_settlement_result TEXT
);

CREATE TABLE provider_sync_runs (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'limited')),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  records_received INTEGER NOT NULL DEFAULT 0 CHECK (records_received >= 0),
  error_code TEXT,
  error_summary TEXT
);

CREATE INDEX idx_fixtures_sport_schedule ON fixtures (sport, scheduled_at);
CREATE INDEX idx_fixtures_competition_season ON fixtures (competition_id, season_id);
CREATE INDEX idx_predictions_published ON predictions (status, sport, published_at);
CREATE INDEX idx_predictions_fixture ON predictions (fixture_id, published_at);
CREATE INDEX idx_odds_fixture_market_time ON odds_snapshots (fixture_id, market, observed_at);
CREATE INDEX idx_team_stats_fixture ON team_match_statistics (fixture_id, team_id);
CREATE INDEX idx_player_stats_fixture ON player_match_statistics (fixture_id, player_id);
CREATE INDEX idx_provider_sync_runs_provider_time ON provider_sync_runs (provider_id, started_at);

CREATE TRIGGER prediction_audit_on_publish_insert
AFTER INSERT ON predictions
WHEN NEW.status = 'published'
BEGIN
  INSERT INTO prediction_audit_events (
    id, prediction_id, event_type, event_at, decision, probability,
    model_name, model_version, data_quality
  ) VALUES (
    lower(hex(randomblob(16))), NEW.id, 'published', NEW.published_at, NEW.decision,
    NEW.probability, NEW.model_name, NEW.model_version, NEW.data_quality
  );
END;

CREATE TRIGGER prediction_audit_on_publish_update
AFTER UPDATE ON predictions
WHEN OLD.status = 'draft' AND NEW.status = 'published'
BEGIN
  INSERT INTO prediction_audit_events (
    id, prediction_id, event_type, event_at, decision, probability,
    model_name, model_version, data_quality
  ) VALUES (
    lower(hex(randomblob(16))), NEW.id, 'published', NEW.published_at, NEW.decision,
    NEW.probability, NEW.model_name, NEW.model_version, NEW.data_quality
  );
END;

CREATE TRIGGER published_predictions_are_immutable
BEFORE UPDATE ON predictions
WHEN OLD.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'Published predictions are immutable');
END;

CREATE TRIGGER published_predictions_cannot_be_deleted
BEFORE DELETE ON predictions
WHEN OLD.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'Published predictions cannot be deleted');
END;

CREATE TRIGGER prediction_audit_on_settlement_insert
AFTER INSERT ON prediction_settlements
BEGIN
  INSERT INTO prediction_audit_events (
    id, prediction_id, event_type, event_at, settlement_result
  ) VALUES (
    lower(hex(randomblob(16))), NEW.prediction_id, 'settled', NEW.settled_at, NEW.result
  );
END;

CREATE TRIGGER prediction_audit_on_settlement_update
AFTER UPDATE ON prediction_settlements
BEGIN
  INSERT INTO prediction_audit_events (
    id, prediction_id, event_type, event_at, settlement_result, previous_settlement_result
  ) VALUES (
    lower(hex(randomblob(16))), NEW.prediction_id, 'settlement_corrected', NEW.settled_at,
    NEW.result, OLD.result
  );
END;

CREATE TRIGGER prediction_audit_events_are_immutable
BEFORE UPDATE ON prediction_audit_events
BEGIN
  SELECT RAISE(ABORT, 'Prediction audit events are immutable');
END;

CREATE TRIGGER prediction_audit_events_cannot_be_deleted
BEFORE DELETE ON prediction_audit_events
BEGIN
  SELECT RAISE(ABORT, 'Prediction audit events cannot be deleted');
END;
