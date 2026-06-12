#!/bin/bash
set -e

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "ERROR: .env file not found in $(pwd)" >&2
  exit 1
fi

DC="docker compose --env-file .env"

echo "=== Stopping containers ==="
$DC down

echo "=== Loading image ==="
docker load -i autobriify.tar.gz

echo "=== Starting app ==="
$DC up -d app

echo "=== Done ==="
$DC ps
