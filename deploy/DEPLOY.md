# 배포 가이드

## 서버 정보

| 항목 | 값 |
|------|-----|
| 대상 서버 | `192.168.102.2` |
| Jump Host | `112.216.247.186:52000` |
| 배포 경로 | `/home/sjs/briify/` |
| 서비스 포트 | `16000` (→ 컨테이너 내부 3000) |
| basePath | `/briify` |
| Database | PostgreSQL 17 (Docker Compose 내 `db` 서비스) |

## 배포 절차

### 1. 이미지 빌드 (프로젝트 루트에서)

```powershell
powershell deploy/build.ps1
```

- `autobriify:latest` — 앱 이미지
- `autobriify-migrator:latest` — SQLite→PostgreSQL 마이그레이션 이미지 (최초 배포용)
- 출력: `deploy/autobriify.tar.gz`, `deploy/autobriify-migrator.tar.gz`

### 2. 전송 + 배포

```powershell
powershell deploy/deploy-remote.ps1
```

이미지, docker-compose.yml, deploy.sh, .env를 jump host 경유로 서버에 전송하고 deploy.sh를 실행합니다.

> 전송 파일: `autobriify.tar.gz`, `autobriify-migrator.tar.gz` (있을 때만), `deploy.sh`, `docker-compose.yml`, `.env`

### 환경변수 (.env)

`deploy/.env`에서 로컬 관리합니다. 최초에 `.env.example`을 복사해서 생성하세요:

```powershell
cp deploy/.env.example deploy/.env
# deploy/.env 에서 비밀값 채우기 (POSTGRES_PASSWORD 포함)
```

> `deploy/.env`는 `.gitignore`에 포함되어 git에 커밋되지 않습니다.

## deploy.sh 동작 순서

1. `docker compose down` — 기존 컨테이너 중지
2. `docker load` — tar.gz에서 이미지 로드
3. PostgreSQL 컨테이너 기동 + healthy 대기
4. 앱 컨테이너 기동 (initDb()로 테이블 자동 생성)
5. **SQLite 마이그레이션 자동 감지** — 기존 `app-data` 볼륨에 SQLite 파일이 있고 PostgreSQL이 비어있으면 자동 이관
6. 완료

## SQLite → PostgreSQL 마이그레이션

최초 PostgreSQL 배포 시 기존 SQLite 데이터를 자동으로 이관합니다.

**자동 실행 조건:**
- `briify_app-data` Docker volume에 `tracker.db` 파일이 존재
- PostgreSQL `users` 테이블의 행 수가 0

**수동 실행 (필요 시):**

```bash
# 서버에서 직접 실행
cd /home/sjs/briify
source .env
SQLITE_MOUNT=$(docker volume inspect --format '{{ .Mountpoint }}' briify_app-data)
docker run --rm \
  --network=briify_default \
  -v "$SQLITE_MOUNT:/sqlite-data:ro" \
  -e DATABASE_URL="postgresql://autobriify:${POSTGRES_PASSWORD}@db:5432/autobriify" \
  -e SQLITE_PATH="/sqlite-data/tracker.db" \
  autobriify-migrator:latest
```

## PostgreSQL 데이터 영속화

PostgreSQL 데이터는 Docker named volume (`pgdata`)에 저장됩니다.
컨테이너를 재배포해도 데이터는 유지됩니다.

> `docker compose down`은 volume을 삭제하지 않습니다. volume까지 삭제하려면 `docker compose down -v`를 사용하세요.

## HRMS OAuth 콜백 등록

basePath 적용으로 OAuth 콜백 URL이 변경됩니다:

```
https://dx-service.cudo.co.kr:8008/briify/api/auth/oauth/hrms/callback
```

HRMS 관리 화면에서 이 콜백 URL을 등록해야 합니다.

## 트러블슈팅

```bash
# 서버 접속
ssh -J root@112.216.247.186:52000 root@192.168.102.2

# 컨테이너 상태 확인
cd /home/sjs/briify && docker compose ps

# 앱 로그
docker compose logs -f app

# DB 로그
docker compose logs -f db

# PostgreSQL 직접 접속
docker compose exec db psql -U autobriify -d autobriify

# 마이그레이션 후 기존 SQLite volume 정리 (선택)
docker volume rm briify_app-data
```
