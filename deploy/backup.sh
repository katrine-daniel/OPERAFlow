#!/usr/bin/env sh
# Nightly backup for the Docker Compose deployment: PostgreSQL dump + uploaded documents/report files.
# Usage (cron, from the repository root):  0 2 * * *  ./deploy/backup.sh /srv/backups/operaflow
# Copy the backup directory off this host (object storage, another server). Test restores regularly.
# ENCRYPTION_KEY is NOT included — store it in your password manager / secret store separately.
set -eu
DEST="${1:?usage: backup.sh <backup-dir>}"
KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
COMPOSE="docker compose --env-file deploy/.env.docker"
mkdir -p "$DEST"

echo "dumping database…"
$COMPOSE exec -T postgres pg_dump -U operaflow -Fc operaflow > "$DEST/operaflow-db-$STAMP.dump"

echo "archiving storage volume…"
$COMPOSE run --rm --no-deps -v "$(cd "$DEST" && pwd)":/backup --entrypoint sh api \
  -c "tar -czf /backup/operaflow-storage-$STAMP.tar.gz -C /app/storage ."

echo "pruning backups older than $KEEP_DAYS days…"
find "$DEST" -name 'operaflow-*' -type f -mtime +"$KEEP_DAYS" -delete

echo "done: $DEST/operaflow-db-$STAMP.dump, $DEST/operaflow-storage-$STAMP.tar.gz"
# Restore:
#   $COMPOSE exec -T postgres pg_restore -U operaflow -d operaflow --clean --if-exists < operaflow-db-<stamp>.dump
#   $COMPOSE run --rm --no-deps -v "$PWD":/backup --entrypoint sh api -c "tar -xzf /backup/operaflow-storage-<stamp>.tar.gz -C /app/storage"
