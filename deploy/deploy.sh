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

# --- SQLite → PostgreSQL 일회성 마이그레이션 (앱 시작 전) ---
NEED_MIGRATE=false
SQLITE_MOUNT=$(docker volume inspect --format '{{ .Mountpoint }}' briify_app-data 2>/dev/null || echo "")

if [ -n "$SQLITE_MOUNT" ] && [ -f "$SQLITE_MOUNT/tracker.db" ]; then
  # 테이블이 아직 없을 수 있으므로 존재 여부부터 확인
  TABLE_EXISTS=$($DC exec -T db psql -U autobriify -d autobriify -t -c \
    "SELECT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users');" \
    2>/dev/null | tr -d '[:space:]' || echo "f")

  if [ "$TABLE_EXISTS" = "t" ]; then
    PG_COUNT=$($DC exec -T db psql -U autobriify -d autobriify -t -c \
      "SELECT COUNT(*) FROM users;" 2>/dev/null | tr -d '[:space:]' || echo "-1")
    if [ "$PG_COUNT" = "0" ]; then
      NEED_MIGRATE=true
    fi
  else
    # 테이블이 없으면 앱을 잠깐 시작해서 테이블 생성 후 중지
    echo "=== 테이블 생성을 위해 앱 임시 시작 ==="
    $DC up -d app
    sleep 15
    $DC stop app
    NEED_MIGRATE=true
  fi
fi

if [ "$NEED_MIGRATE" = "true" ]; then
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
  echo "마이그레이션 불필요 (기존 SQLite 없거나 이미 이관됨)"
fi

echo "=== Starting app ==="
$DC up -d app

echo ""
echo "=== Done ==="
$DC ps
