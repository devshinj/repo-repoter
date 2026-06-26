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

echo "=== Starting app ==="
$DC up -d app

echo "=== Waiting for app (테이블 자동 생성) ==="
sleep 10

# --- SQLite → PostgreSQL 일회성 마이그레이션 ---
# 조건: (1) 기존 app-data 볼륨에 SQLite 파일 존재 (2) PostgreSQL users 테이블이 비어있음
NEED_MIGRATE=false

# app-data 볼륨 마운트 포인트 확인 (이전 배포의 SQLite 데이터)
SQLITE_MOUNT=$(docker volume inspect --format '{{ .Mountpoint }}' briify_app-data 2>/dev/null || echo "")

if [ -n "$SQLITE_MOUNT" ] && [ -f "$SQLITE_MOUNT/tracker.db" ]; then
  PG_COUNT=$($DC exec -T db psql -U autobriify -d autobriify -t -c "SELECT COUNT(*) FROM users;" 2>/dev/null | tr -d '[:space:]' || echo "-1")
  if [ "$PG_COUNT" = "0" ]; then
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

echo ""
echo "=== Done ==="
$DC ps
