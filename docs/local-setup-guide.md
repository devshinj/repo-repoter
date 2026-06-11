# 로컬 PC 실행 환경 설정 (PM2)

> PC 부팅 시 자동으로 Repo Reporter가 실행되도록 PM2 프로세스 매니저를 사용한 설정 가이드입니다.

---

## 사전 요구사항

- Node.js (nvm4w 등으로 설치)
- PM2 글로벌 설치: `npm install -g pm2`

---

## 구성 파일

### ecosystem.config.cjs

프로젝트 루트에 위치한 PM2 설정 파일입니다.

| 항목 | 값 | 설명 |
|------|----|------|
| name | `repo-reporter` | PM2 프로세스 이름 |
| script | `.next/standalone/server.js` | Next.js standalone 빌드 진입점 |
| PORT | `4000` | 서비스 포트 |
| autorestart | `true` | 크래시 시 자동 재시작 |
| 로그 경로 | `logs/pm2-error.log`, `logs/pm2-out.log` | 에러/출력 로그 |

### pm2-resurrect.bat

Windows 시작 폴더(`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\`)에 위치합니다.
PC 부팅 시 PM2 데몬을 자동 시작하고, 저장된 프로세스 목록을 복구합니다.

---

## 초기 설정 (최초 1회)

```bash
# 1. PM2 글로벌 설치
npm install -g pm2

# 2. Next.js 프로덕션 빌드
npm run build

# 3. standalone 빌드에 정적 파일 복사
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static

# 4. 환경변수 파일 복사
cp .env .next/standalone/.env
cp .env.local .next/standalone/.env.local

# 5. PM2로 시작
pm2 start ecosystem.config.cjs

# 6. 프로세스 목록 저장 (부팅 시 자동 복구용)
pm2 save
```

---

## 자주 사용하는 명령어

| 명령어 | 설명 |
|--------|------|
| `pm2 status` | 프로세스 상태 확인 |
| `pm2 logs` | 실시간 로그 출력 |
| `pm2 logs --lines 100` | 최근 100줄 로그 출력 |
| `pm2 restart repo-reporter` | 프로세스 재시작 |
| `pm2 stop repo-reporter` | 프로세스 중지 |
| `pm2 delete repo-reporter` | 프로세스 삭제 |
| `pm2 monit` | 실시간 모니터링 대시보드 |

---

## 코드 변경 후 재배포

코드를 수정한 뒤 반영하려면:

```bash
# 1. 빌드
npm run build

# 2. 정적 파일 재복사
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static

# 3. 환경변수 재복사 (변경된 경우)
cp .env .next/standalone/.env
cp .env.local .next/standalone/.env.local

# 4. PM2 재시작
pm2 restart repo-reporter
```

---

## Windows 자동 시작 구조

```
PC 부팅
  ↓
Windows 시작 프로그램 실행
  ↓
pm2-resurrect.bat 실행 (10초 대기 후)
  ↓
pm2 resurrect → 저장된 프로세스 목록 복구
  ↓
repo-reporter 프로세스 자동 시작
  ↓
http://localhost:4000 접속 가능
```

---

## 트러블슈팅

### PM2 프로세스가 시작되지 않을 때

```bash
# 로그 확인
pm2 logs repo-reporter --lines 50

# 프로세스 삭제 후 재시작
pm2 delete repo-reporter
pm2 start ecosystem.config.cjs
pm2 save
```

### 부팅 후 자동 시작이 안 될 때

1. `pm2-resurrect.bat` 파일이 시작 프로그램 폴더에 있는지 확인:
   - `Win+R` → `shell:startup` → 파일 존재 여부 확인
2. PM2 경로가 올바른지 확인 (`C:\nvm4w\nodejs\pm2.cmd`)
3. `pm2 save`가 실행되었는지 확인 (`~/.pm2/dump.pm2` 파일 존재 여부)

### Node.js 버전을 변경한 경우

nvm으로 Node.js 버전을 변경하면 PM2 경로가 바뀔 수 있습니다.
`pm2-resurrect.bat`의 PM2 경로를 업데이트하세요.
