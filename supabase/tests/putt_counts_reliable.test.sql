-- Putt-count provenance tests. Run with: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = putting_league, public, extensions;

SELECT no_plan();

SELECT col_not_null('putting_league', 'events', 'putt_counts_reliable', 'events.putt_counts_reliable is NOT NULL');
SELECT col_default_is('putting_league', 'events', 'putt_counts_reliable', 'true', 'new events have reliable putt counts');

SELECT ok(
  NOT has_column_privilege(r, 'putting_league.events', 'putt_counts_reliable', 'SELECT'),
  format('%s cannot read events.putt_counts_reliable', r)
)
FROM unnest(ARRAY['anon', 'authenticated']) AS r;

SELECT * FROM finish();
ROLLBACK;
