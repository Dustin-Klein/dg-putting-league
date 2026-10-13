#!/usr/bin/env bash
# Helpers for the CI jobs that manage hosted Supabase databases
# (.github/workflows/ci.yml migrate-preview, .github/workflows/reset-preview.yml).
#
#   tools/preview-db.sh check-drift        fail if the remote has migration versions not in supabase/migrations
#   tools/preview-db.sh backup-auth <dir>  copy auth.users + auth.identities rows to <dir>
#   tools/preview-db.sh restore-auth <dir> load them back (after `supabase db reset` truncated auth)
#
# Connects with $SUPABASE_DB_URL (session pooler, port 5432).
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is not set}"

AUTH_TABLES=(users identities)

q() {
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -Atqc "$1"
}

# Non-generated columns of auth.<table>: COPY cannot write generated columns.
auth_columns() {
  q "select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
     from information_schema.columns
     where table_schema = 'auth' and table_name = '$1' and is_generated = 'NEVER'"
}

case "${1:-}" in
  check-drift)
    remote=""
    if [ "$(q "select to_regclass('supabase_migrations.schema_migrations') is not null")" = "t" ]; then
      remote=$(q "select version from supabase_migrations.schema_migrations" | LC_ALL=C sort)
    fi
    local_versions=$(find supabase/migrations -maxdepth 1 -name '*.sql' -exec basename {} \; \
      | cut -d_ -f1 | LC_ALL=C sort)
    foreign=$(LC_ALL=C comm -23 <(printf '%s\n' "$remote" | sed '/^$/d') <(printf '%s\n' "$local_versions"))
    if [ -n "$foreign" ]; then
      echo "::error::Preview DB has foreign migrations (applied remotely but not in this branch):"
      printf '  %s\n' $foreign
      echo "Run the 'Reset preview DB' workflow to rebuild it from main (or this branch), then re-approve."
      exit 1
    fi
    echo "No foreign migrations on the remote."
    ;;

  backup-auth)
    dir=${2:?usage: backup-auth <dir>}
    mkdir -p "$dir"
    for t in "${AUTH_TABLES[@]}"; do
      cols=$(auth_columns "$t")
      echo "$cols" > "$dir/$t.columns"
      psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q \
        -c "\\copy (select $cols from auth.$t) to '$dir/$t.csv' with (format csv)"
      echo "Backed up auth.$t: $(wc -l < "$dir/$t.csv" | tr -d ' ') rows"
    done
    ;;

  restore-auth)
    dir=${2:?usage: restore-auth <dir>}
    args=()
    # users before identities (identities.user_id references users.id). Staged through a temp
    # table so rows that survived a failed reset are skipped instead of aborting the restore.
    for t in "${AUTH_TABLES[@]}"; do
      cols=$(cat "$dir/$t.columns")
      args+=(
        -c "create temp table restore_$t (like auth.$t) on commit drop"
        -c "\\copy restore_$t ($cols) from '$dir/$t.csv' with (format csv)"
        -c "insert into auth.$t ($cols) select $cols from restore_$t on conflict do nothing"
      )
    done
    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -1 "${args[@]}"
    echo "Restored auth.users and auth.identities."
    ;;

  *)
    echo "usage: $0 check-drift | backup-auth <dir> | restore-auth <dir>" >&2
    exit 2
    ;;
esac
