#!/bin/sh
# Creates a throwaway Postgres database, loads a stand-in for Supabase auth, applies the migration, runs the tests.
set -e
DB=trace_test_$$
cd "$(dirname "$0")/.."
createdb "$DB"
trap 'dropdb "$DB"' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/supabase_stub.sql
for pass in 1 2; do   # applying the migrations again, in order, must be safe
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/001_init.sql 2>/dev/null
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/002_profiles.sql 2>/dev/null
done
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/db_test.sql 2>&1 | sed -n 's/^psql:[^ ]* NOTICE:  /  /p; /ERROR\|PASSED/p'
