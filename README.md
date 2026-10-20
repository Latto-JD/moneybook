# 가계부 (moneybook)

로그인한 사용자별로 분리된 데이터를 바탕으로 지출/수입을 빠르게 기록하고, 규칙 기반 추천·인사이트와 차트 대시보드를 보여 주는 모바일 친화 웹 가계부입니다. Vercel(서버리스 함수 1개 + 정적 프론트)에 배포하고, DB는 Postgres(Neon)를 씁니다. 로컬/테스트는 계정 없이 내장형 Postgres(PGlite)로 동작합니다.

- 계획서: `docs/plan.md` / API 계약: `docs/api.md` / QA 리포트: `docs/qa-report.md`
- 런타임 의존성은 DB 드라이버 `pg` 하나뿐입니다. 외부 AI/분석 API는 쓰지 않습니다.

## 구조

```
api/index.js              Vercel 함수 진입점 (모든 /api/* 요청, src/backend 핸들러 호출만)
src/backend/              (req,res) 핸들러, 라우터, 인증, 거래/집계, 규칙 R1~R5, DB 어댑터
  app.js, router.js       핸들러/라우트 표
  auth/                   가입·로그인·세션·시도 제한·scrypt
  transactions/, stats/   거래 CRUD, 월 요약·집계 API
  rules/                  추천/인사이트 (DB와 무관한 순수 함수) + routes.js
  db/schema.sql, migrate.js, pg.js(프로덕션), pglite.js(로컬/테스트)
  scripts/                dev-server.js, seed.js, qa-tools.js(개발 전용)
  test/                   node:test 테스트 (PGlite 메모리)
src/frontend/public/      배포되는 정적 파일 (프레임워크/빌드 없음)
e2e/                      Playwright 테스트 (QA 전용 별도 패키지)
docs/                     plan.md, api.md, qa-report.md
vercel.json               outputDirectory, /api rewrite, regions=sin1, 보안 헤더
```

`src/frontend/office/` 는 이 앱과 무관한 폴더이며 배포 대상이 아닙니다.

## 환경변수

값은 `.env`(로컬, 커밋 금지) 또는 Vercel 환경변수에 둡니다. `.env.example` 에는 이름과 설명만 있습니다. 세션/JWT 시크릿은 필요 없습니다(난수 토큰의 SHA-256 해시만 DB에 저장).

| 이름 | 필수 | 설명 |
|---|---|---|
| `DATABASE_URL` | 프로덕션 | Neon pooled 연결 문자열 (Marketplace 통합이 자동 주입) |
| `DATABASE_URL_UNPOOLED` | 마이그레이션 시 | Neon 직접 연결 문자열. 없으면 `DATABASE_URL` 사용 |
| `DB_DRIVER` | 로컬 | `pglite` 면 내장 DB 사용. 프로덕션에서는 설정하지 않음 |
| `PGLITE_DIR` | 선택 | PGlite 데이터 디렉터리 (기본 `.data/pglite`, 테스트는 메모리). 없으면 상위 디렉터리까지 자동 생성(Vercel/production 제외) |
| `COOKIE_SECURE` | 선택 | 기본 `true`. 로컬 http 에서만 `false` |
| `SIGNUP_ENABLED` | 선택 | 기본 `true`. `false` 면 가입 403 |
| `APP_ORIGINS` | 선택 | 같은 호스트 외 추가 허용 Origin (쉼표 구분) |
| `TRUST_PROXY` | 선택 | `true` 면 로컬에서 `x-forwarded-for` 신뢰 (IP 제한 재현용). Vercel 에서는 자동 |
| `PORT` | 선택 | 개발 서버 포트 (기본 3000) |
| `QA_TOOLS` | 선택 | `true` 면 개발 서버에 QA 전용 `/__qa/*` 활성화 (아래 참고, 프로덕션 금지) |

## 로컬 실행

Node.js 22 이상이 필요합니다. (계정 불필요)

```bash
npm ci
# .env 파일 (커밋 금지)
#   DB_DRIVER=pglite
#   COOKIE_SECURE=false
npm run db:migrate     # 스키마 적용 (여러 번 실행해도 안전)
npm run dev            # http://localhost:3000  (정적 파일 + /api/*)
```

Windows PowerShell 에서 `.env` 없이 쓰려면 `$env:DB_DRIVER="pglite"; $env:COOKIE_SECURE="false"` 후 같은 명령을 실행합니다. 데이터는 `.data/pglite/` 에 남습니다(삭제하면 초기화).

### 마이그레이션

`npm run db:migrate` 는 `src/backend/db/schema.sql`(멱등 SQL)을 적용합니다. 프로덕션에서는 `DATABASE_URL_UNPOOLED` 를 우선 사용합니다. 출력의 `driver=` 로 대상을 구분합니다: `driver=pglite` 는 로컬, `driver=pg` 가 실제 Postgres 입니다.

주의: 이 스크립트는 `.env` 만 읽고, `.env` 에 `DB_DRIVER=pglite` 가 있으면 **운영이 아닌 로컬 PGlite** 에 적용되어 "완료"만 출력됩니다. 운영 DB에는 아래 `db:migrate:prod` 를 쓰세요.

카테고리 마이그레이션(v3)은 `categories` 테이블을 추가하고, 카테고리 행이 하나도 없는 사용자에게만 기본 12개를 넣습니다(사용자가 바꾼 이름·상태는 재실행해도 되살아나지 않음). 기존 테이블은 바꾸지 않아 구버전 코드와 호환됩니다. 성공 출력: `마이그레이션 완료 (driver=pglite, categories 생성 사용자=N)`. 반드시 **백업 -> 마이그레이션 -> 코드 배포** 순서로 진행합니다(코드를 먼저 배포하면 `categories` 테이블이 없어 거래 저장·카테고리 조회가 500).

#### 운영 DB 마이그레이션 (`db:migrate:prod`, 사용자가 직접 실행)

1. **백업**: Neon 콘솔 -> Branches 에서 운영 브랜치로 `backup-before-categories-<날짜>` 브랜치를 만듭니다. 연결 문자열은 채팅·이슈에 붙여넣지 않습니다.
2. **실행 전 기록**: Neon SQL Editor 에서 `select count(*) from users;`, `select count(*), sum(amount) from transactions;` 결과(숫자만)를 적어 둡니다.
3. **환경변수 받기**: `vercel env pull .env.production.local --environment=production` (`.env*` 는 `.gitignore` 대상, 커밋 금지)
4. **실행**: `npm run db:migrate:prod -- --yes`
   - `.env.production.local` **만** 읽습니다(`.env` 는 읽지 않음). `DB_DRIVER` 가 파일이나 프로세스 환경에 있으면 거부하고, `--yes` 가 없으면 아무것도 실행하지 않으며, 접속 정보(`DATABASE_URL_UNPOOLED` -> `DATABASE_URL`)가 없으면 종료 코드 1 입니다.
   - 출력이 `마이그레이션 완료 (driver=pg, categories 생성 사용자=N)` 인지 확인합니다. `driver=pg` 가 아니면 운영에 적용되지 않은 것입니다.
5. **실행 후 확인** (Neon SQL Editor): `select count(*) from categories;` = 사용자 수 x 12, `select count(*) from users u where not exists (select 1 from categories c where c.user_id = u.id);` = 0, transactions 의 count·sum 이 2번과 같음.
6. 같은 명령을 한 번 더 실행해 `생성 사용자=0` 인지 확인합니다(멱등).
7. 끝나면 `.env.production.local` 을 삭제하는 것을 권장합니다.

롤백: 마이그레이션 중 실패하면 SQL 이 한 번에 실행되므로 전부 롤백됩니다(원인 수정 후 재실행). 마이그레이션 후 코드 배포 전에는 구버전 코드가 `categories` 를 읽지 않아 그대로 동작합니다. 새 코드 배포 후 문제가 생기면 Vercel 에서 이전 배포로 Instant Rollback 하고 스키마는 그대로 둡니다(구버전 호환). 단, 새 코드에서 이름을 바꾸거나 새로 만든 카테고리의 거래는 구버전에서 조회·집계는 되지만 수정(PUT)이 400 이 됩니다. 데이터 손상 시 최후 수단은 백업 브랜치 복원이며 백업 이후의 모든 입력이 사라지므로 영향 범위를 확인하고 진행합니다.

### 테스트

```bash
npm test               # 백엔드·프론트 단위/통합 테스트 (PGlite 메모리, node:test)
```

브라우저 테스트(QA): `cd e2e && npm ci && npx playwright install chromium && BASE_URL=http://localhost:3000 npx playwright test`

### 시드 데이터

```bash
npm run seed -- --email=demo@example.com --password=<데모 비밀번호> --today=2026-10-19
```

- 사용자가 없으면 생성하고, 그 사용자에게만 `today` 가 속한 달을 포함해 7개월치 거래(약 110건)를 넣습니다. 추천 R1, 반복 R3(월간·주간), 과소비 R4(exceeded), 큰 지출 R5가 모두 나오고 최근 6개월 모든 달에 지출이 있습니다.
- `today` 생략 시 Asia/Seoul 오늘. 이후 `/api/insights?month=<today의 달>&today=<같은 날짜>` 로 확인합니다.
- 이미 거래가 있는 사용자에게는 `--reset`(그 사용자 거래 삭제 후 재생성)이 있어야 실행됩니다. 다른 사용자 데이터는 건드리지 않습니다.
- `DB_DRIVER=pglite` 가 아닌 DB(예: Neon)가 대상이면 **`--yes` 없이는 실행을 거부**합니다. 대상 DB를 확인한 뒤에만 `--yes` 를 붙이세요.

## QA/테스트 지원

QA가 DB를 직접 조작해야 하는 검증용 도구입니다. **개발 전용**이며 `VERCEL` 또는 `NODE_ENV=production` 이 설정되었거나 `DB_DRIVER` 가 `pglite` 가 아니면 동작하지 않습니다. `api/` 함수 경로에서는 import 되지 않습니다.

주의: PGlite 데이터 디렉터리는 한 프로세스만 열 수 있습니다. 서버가 켜져 있는 동안 같은 `PGLITE_DIR` 을 다른 프로세스(스크립트, psql 대용 도구)로 열면 데이터가 손상될 수 있으므로, 서버 실행 중에는 아래 (A), 서버를 멈춘 상태에서는 (B)를 쓰세요.

### (A) 서버 실행 중: `/__qa/<명령>` (QA_TOOLS=true)

```bash
DB_DRIVER=pglite COOKIE_SECURE=false QA_TOOLS=true PGLITE_DIR=<임시 디렉터리> npm run dev
```

`POST http://localhost:3000/__qa/<명령>?email=&minutes=` 에 헤더 `X-QA-Tools: 1` 이 필요하고, 루프백(127.0.0.1) 요청만 허용됩니다. 응답은 JSON.

| 명령 | 효과 | 대응 항목 |
|---|---|---|
| `expire-sessions[?email=]` | 세션 `expires_at` 을 하루 전으로 (이후 해당 쿠키는 401) | C43 만료 세션 |
| `delete-sessions[?email=]` | 세션 삭제 | C60 사용 중 세션 소멸 |
| `age-attempts?minutes=16[&email=]` | `auth_attempts.created_at` 을 N분 과거로 이동 | C40 시도 제한 해제 |
| `clear-attempts` | 시도 기록 전체 삭제 | C40/C41 초기화 |
| `break-db` | `transactions` 테이블 이름을 바꿔 거래·요약·통계·추천 API 가 500 `INTERNAL_ERROR` 가 되게 함 (로그인/health 는 정상) | C48 |
| `repair-db` | 위 변경 원복 | |

```bash
curl -X POST -H "X-QA-Tools: 1" "http://localhost:3000/__qa/age-attempts?minutes=16&email=a@ex.com"
curl -X POST -H "X-QA-Tools: 1" http://localhost:3000/__qa/break-db
```

### (B) 서버 정지 상태: `npm run qa:tools`

같은 명령을 CLI 로 실행합니다. 서버를 멈추고 → 실행 → 서버를 같은 `PGLITE_DIR` 로 다시 시작하는 흐름이라 C11(재시작 후 데이터·세션 유지)과도 맞습니다.

```bash
DB_DRIVER=pglite PGLITE_DIR=<같은 디렉터리> npm run qa:tools -- expire-sessions --email=a@ex.com
DB_DRIVER=pglite PGLITE_DIR=<같은 디렉터리> npm run qa:tools -- age-attempts --minutes=16
```

### 그 밖의 재현 방법

- 서버 재시작(C11): 같은 `PGLITE_DIR` 로 서버를 껐다 켭니다. 거래와 세션이 유지됩니다.
- 내부 오류(C48), DB 연결 실패 형태: `DB_DRIVER` 없이 닫힌 포트의 `DATABASE_URL`(포트 1 같은 닫힌 로컬 포트를 가리키는 Postgres 연결 문자열)로 기동하면 세션이 필요한 요청은 500, `/api/health` 는 `db:"error"`.
- IP 제한(C41): `TRUST_PROXY=true` 로 기동하고 `X-Forwarded-For` 헤더로 IP 를 바꿉니다.
- 규칙 경계값은 `today` 쿼리로 고정합니다: `/api/insights?month=2026-10&today=2026-10-19`.
- 가입을 닫은 상태(C37): `SIGNUP_ENABLED=false` 로 기동.

## Vercel + Neon 연결 절차

외부 계정에 영향을 주는 단계이므로 순서대로, 각 단계 전에 확인하세요. (계획서 CP1~CP3)

1. **GitHub 푸시 (CP1)**: `git ls-files` 에 `.env*`(`.env.example` 제외)가 없는지, Postgres 연결 문자열(스킴이 postgres 로 시작하는 URL, Neon 비밀번호 접두사 등) 검색 결과가 0건인지 확인한 뒤 푸시합니다. force push 금지.
2. **Vercel 프로젝트 (CP2)**: Vercel 에서 저장소를 Import 합니다. Framework Preset 은 `Other`, Build Command 는 비웁니다. `vercel.json` 이 `outputDirectory: src/frontend/public`, `/api/*` → `api/index.js` rewrite, `regions: ["sin1"]`, 보안 헤더를 지정합니다.
3. **Neon 추가**: Vercel 프로젝트 Storage/Marketplace 에서 Neon Postgres 를 추가하고 지역을 `AWS Asia Pacific (Singapore)` 로 선택해 프로젝트에 연결합니다. `DATABASE_URL`(pooled), `DATABASE_URL_UNPOOLED` 가 환경변수로 자동 주입되는지 확인합니다.
4. **환경변수**: Production/Preview 에 필요 시 `SIGNUP_ENABLED`, `APP_ORIGINS` 를 설정합니다. `DB_DRIVER`, `COOKIE_SECURE=false`, `QA_TOOLS` 는 **설정하지 않습니다**.
5. **마이그레이션**: 위 "운영 DB 마이그레이션" 절차(`vercel env pull .env.production.local --environment=production` 후 `npm run db:migrate:prod -- --yes`)를 따릅니다. `npm run db:migrate` 는 `.env` 만 읽으므로(`.env.local`/`.env.production.local` 은 읽지 않음) 운영 대상에 쓰지 않습니다. 운영과 프리뷰가 같은 Neon DB 이면 프리뷰도 운영 데이터에 씁니다. 개발/프리뷰용 Neon 브랜치를 따로 쓰는 것을 권장합니다.
6. **프리뷰 확인 (D3)**: 프리뷰 URL 에서 `/api/health` 가 `{"status":"ok","db":"ok"}` 인지, 가입→기록→대시보드, Set-Cookie 에 `Secure; HttpOnly; SameSite=Lax` 가 있는지 확인합니다.
7. **프로덕션 배포 (CP3)**: 프리뷰 결과 확인 후 main 프로덕션 배포(또는 프리뷰 승격).
8. (선택) Vercel 로컬 재현: `vercel link` → `vercel env pull .env.local` → `vercel dev`.

## 보안 메모

- 비밀번호: Node 내장 scrypt(N=2^15, r=8, p=1, 솔트 16바이트, `timingSafeEqual` 비교). 없는 이메일 로그인에도 더미 해시 검증을 해 응답 시간 차이로 가입 여부가 드러나지 않게 합니다.
- 세션: 32바이트 난수 토큰, DB 에는 SHA-256 해시만 저장. 쿠키 `mb_sid` 는 `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`(30일 고정).
- CSRF: 상태 변경 요청은 `Origin` 필수·호스트 일치(또는 `APP_ORIGINS`), 본문은 `application/json` 만 허용(415), `SameSite=Lax`.
- 시도 제한: DB(`auth_attempts`) 기반 - 이메일 실패 5회/15분, IP 실패 20회/15분, IP 가입 10회/시간. 서버리스라 메모리 카운터를 쓰지 않습니다.
- 격리: 모든 거래 쿼리에 `user_id` 조건. 타 사용자 리소스와 없는 리소스는 동일하게 404. 본문의 `userId` 는 무시.
- 모든 SQL 은 파라미터 바인딩. 500 응답에는 SQL/스택/연결 문자열을 담지 않고 로그에도 남기지 않습니다.
- 보안 헤더(CSP `default-src 'self'` 등)는 정적 파일과 API 모두에 적용됩니다. 프론트는 사용자 입력을 `textContent` 로만 출력합니다.
- 비밀번호 재설정/변경, 이메일 인증, 회원 탈퇴는 아직 없습니다(비밀번호 분실 시 운영자가 DB 에서 처리). 계획서 12장 OQ1~OQ3 참고.
