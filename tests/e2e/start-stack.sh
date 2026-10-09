#!/bin/sh
# Starts a local copy of the whole stack for the end-to-end test:
# Postgres (with the migration) → PostgREST → local Supabase stand-in → Cloudflare Pages (wrangler) with the functions.
# Needs: postgres, psql, a postgrest binary on PATH or $POSTGREST, wrangler in $WRANGLER.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=trace_e2e
SECRET=local-test-jwt-secret-that-is-long-enough-123456
dropdb --if-exists "$DB"; createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/tests/supabase_stub.sql" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/supabase/migrations/001_init.sql" >/dev/null 2>&1
psql -q -d "$DB" -c "do \$\$begin if not exists(select from pg_roles where rolname='authenticator') then create role authenticator login noinherit password 'pw'; end if; end\$\$;
  grant anon, authenticated, service_role to authenticator;
  grant all on all tables in schema public to service_role; grant usage on schema public to service_role;
  grant execute on all functions in schema public to service_role;"
cat > /tmp/pgrst.conf <<CONF
db-uri = "postgres://authenticator:pw@127.0.0.1:5432/$DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-port = 3010
CONF
${POSTGREST:-postgrest} /tmp/pgrst.conf > /tmp/pgrst.log 2>&1 &
node "$ROOT/tests/e2e/local-supabase.mjs" 54321 3010 "$SECRET" "$DB" > /tmp/localsb.log 2>&1 &
sleep 2
SERVICE=$(curl -s http://127.0.0.1:54321/__test/keys | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).service))")
cat > "$ROOT/.dev.vars" <<VARS
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=$SERVICE
PADDLE_WEBHOOK_SECRET=pdl_ntfset_test_secret
PADDLE_API_KEY=test_paddle_api_key
PADDLE_ENV=sandbox
PADDLE_API_BASE=http://127.0.0.1:54321/paddle
VARS
cd "$ROOT" && ${WRANGLER:-npx wrangler} pages dev public --port 8788 --ip 127.0.0.1 > /tmp/wrangler.log 2>&1 &
for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:8788/app.html && break; sleep 1; done
echo "stack up: site http://127.0.0.1:8788  supabase http://127.0.0.1:54321"
