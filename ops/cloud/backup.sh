#!/usr/bin/env bash
# Nightly dump -> Railway bucket. Run by the `backup` service on a cron schedule.
#
# Required variables (all supplied by Railway; see docs/DEPLOYMENT.md):
#   DATABASE_ADMIN_URL   the OWNER connection — pg_dump must read every table,
#                        including the ones the app role is restricted on
#   BUCKET, ENDPOINT, ACCESS_KEY_ID, SECRET_ACCESS_KEY, REGION   the bucket
# Optional: MEHVAR_BACKUP_RETENTION_DAYS (default 30)
set -euo pipefail

: "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL is not set}"
: "${BUCKET:?BUCKET is not set}"
: "${ENDPOINT:?ENDPOINT is not set}"
: "${ACCESS_KEY_ID:?ACCESS_KEY_ID is not set}"
: "${SECRET_ACCESS_KEY:?SECRET_ACCESS_KEY is not set}"

export AWS_ACCESS_KEY_ID="$ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="${REGION:-auto}"
RETENTION_DAYS="${MEHVAR_BACKUP_RETENTION_DAYS:-30}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="/tmp/mehvar-${stamp}.dump"

# Custom format, as `ops:backup` writes: restorable into a scratch database.
pg_dump --format=custom --no-owner --no-acl --file "$file" "$DATABASE_ADMIN_URL"

# A zero-byte dump looks like a backup and is not one.
if [ ! -s "$file" ]; then
  echo "pg_dump produced an empty file; refusing to upload it." >&2
  exit 1
fi

aws --endpoint-url "$ENDPOINT" s3 cp "$file" "s3://${BUCKET}/backups/mehvar-${stamp}.dump" --only-show-errors
echo "Uploaded mehvar-${stamp}.dump ($(du -h "$file" | cut -f1))"

# Prune dumps older than the retention window. Names carry the UTC date, so the
# cutoff is compared as a string and no clock arithmetic on object metadata is needed.
cutoff="$(date -u -d "-${RETENTION_DAYS} days" +%Y%m%d)"
aws --endpoint-url "$ENDPOINT" s3 ls "s3://${BUCKET}/backups/" | awk '{print $4}' | while read -r name; do
  day="${name#mehvar-}"; day="${day%%T*}"
  if [[ "$day" =~ ^[0-9]{8}$ ]] && [ "$day" -lt "$cutoff" ]; then
    aws --endpoint-url "$ENDPOINT" s3 rm "s3://${BUCKET}/backups/${name}" --only-show-errors
    echo "Pruned ${name}"
  fi
done
