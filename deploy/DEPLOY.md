# 배포 가이드

## 서버 정보

| 항목 | 값 |
|------|-----|
| 대상 서버 | `192.168.102.2` |
| Jump Host | `112.216.247.186:52000` |
| 배포 경로 | `/home/sjs/briify/` |
| 서비스 포트 | `16000` (→ 컨테이너 내부 3000) |
| basePath | `/briify` |

## 배포 절차

### 1. 이미지 빌드 (프로젝트 루트에서)

```powershell
powershell deploy/build.ps1
```

- `autobriify:latest` — 앱 이미지
- 출력: `deploy/autobriify.tar.gz`

### 2. 전송 + 배포

```powershell
powershell deploy/deploy-remote.ps1
```

이미지, docker-compose.yml, deploy.sh, .env를 jump host 경유로 서버에 전송하고 deploy.sh를 실행합니다.

> 전송 파일 목록: `autobriify.tar.gz`, `deploy.sh`, `docker-compose.yml`, `.env`

### 환경변수 (.env)

`deploy/.env`에서 로컬 관리합니다. 최초에 `.env.example`을 복사해서 생성하세요:

```powershell
cp deploy/.env.example deploy/.env
# deploy/.env 에서 비밀값 채우기
```

> `deploy/.env`는 `.gitignore`에 포함되어 git에 커밋되지 않습니다.

## deploy.sh 동작 순서

1. `docker compose down` — 기존 컨테이너 중지
2. `docker load` — tar.gz에서 이미지 로드
3. 앱 컨테이너 기동

## SQLite 데이터 영속화

SQLite DB 파일은 Docker named volume (`app-data`)에 저장됩니다.
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

# SQLite 데이터 확인 (volume 위치)
docker volume inspect briify_app-data
```
