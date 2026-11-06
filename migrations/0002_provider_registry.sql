INSERT OR IGNORE INTO providers (
  id, name, documentation_url, terms_url, licensing_status,
  public_display_allowed, advertising_supported_allowed, attribution_required,
  storage_allowed, attribution_text, restrictions, verified_at
) VALUES
  (
    'football-data-org',
    'Football-Data.org',
    'https://www.football-data.org/documentation/quickstart',
    'https://www.football-data.org/client/register',
    'approved', 1, 0, 1, 1,
    'Football data provided by the Football-Data.org API',
    'User confirmed public display, storage, and derived prediction use for a no-ad site; do not use source data for advertising. Respect the active account tier and competition coverage.',
    '2026-11-06T00:00:00.000Z'
  ),
  (
    'api-ninjas',
    'API Ninjas',
    'https://api-ninjas.com/api/basketball',
    'https://api-ninjas.com/tos',
    'approved', 1, 0, 1, 1,
    'Basketball data provided by API Ninjas',
    'User confirmed public display, storage, and derived prediction use for a no-ad site; do not use source data for advertising. Respect the active account tier, request allowance, and competition coverage.',
    '2026-11-06T00:00:00.000Z'
  );
