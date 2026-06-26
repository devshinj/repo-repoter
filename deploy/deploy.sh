#!/bin/bash
set -e

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "ERROR: .env file not found in $(pwd)" >&2
  exit 1
fi

source .env
DC="docker compose --env-file .env"

echo "=== Stopping containers ==="
$DC down

echo "=== Loading images ==="
docker load -i autobriify.tar.gz
if [ -f autobriify-migrator.tar.gz ]; then
  docker load -i autobriify-migrator.tar.gz
fi

echo "=== Starting database ==="
$DC up -d db

echo "=== Waiting for database ==="
until $DC exec -T db pg_isready -U autobriify > /dev/null 2>&1; do
  sleep 2
done
echo "Database is ready"

# --- SQLite → PostgreSQL 일회성 마이그레이션 ---
# 조건: 기존 app-data 볼륨에 SQLite 파일 존재
# migrator가 initDb()로 테이블 생성 + 데이터 이관을 모두 처리
SQLITE_MOUNT=$(docker volume inspect --format '{{ .Mountpoint }}' briify_app-data 2>/dev/null || echo "")

if [ -n "$SQLITE_MOUNT" ] && [ -f "$SQLITE_MOUNT/tracker.db" ]; then
  # PostgreSQL에 이미 데이터가 있는지 확인 (테이블 없어도 안전)
  PG_COUNT=$($DC exec -T db psql -U autobriify -d autobriify -t -c \
    "SELECT COUNT(*) FROM users;" 2>/dev/null | tr -d '[:space:]' || echo "0")

  if [ "$PG_COUNT" = "0" ]; then
    echo ""
    echo "=== SQLite → PostgreSQL 데이터 마이그레이션 ==="
    echo "기존 SQLite 데이터를 PostgreSQL로 이관합니다..."

    docker run --rm \
      --network="$(basename $(pwd))_default" \
      -v "$SQLITE_MOUNT:/sqlite-data:ro" \
      -e DATABASE_URL="postgresql://autobriify:${POSTGRES_PASSWORD}@db:5432/autobriify" \
      -e SQLITE_PATH="/sqlite-data/tracker.db" \
      autobriify-migrator:latest

    echo "=== 마이그레이션 완료 ==="
  else
    echo "PostgreSQL에 이미 데이터가 있습니다. 마이그레이션 스킵."
  fi
else
  echo "기존 SQLite 데이터 없음. 마이그레이션 스킵."
fi

echo "=== Starting app ==="
$DC up -d app

echo ""
echo "=== Done ==="
$DC ps
