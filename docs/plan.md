# 가계부 앱 계획서 (v2.1)

작성: planner / 작성일: 2026-10-19 / 상태: v2 확정안 (사용자 결정 반영, 남은 열린 질문은 12장)
코드 저장소: https://github.com/Latto-JD/moneybook.git / 배포: Vercel

---

## 0. 변경 이력

### v2 → v2.1 (2026-10-19)

| # | 변경 | 이유 |
|---|---|---|
| 1 | R4 **pace 판정만** 개정: R3로 감지된 반복 거래(월간·주간)를 제외한 이번 달 금액·건수로 판정하고, 제외 후 남은 거래가 **2건 미만이면 pace 판정 안 함**(6장 R4, R4-P, 경계 사례 표, R4 열린 쟁점 추가). exceeded는 v2 그대로. 완료 기준 C22~C24 수정, C68~C71 신규 | 월세·구독료 같은 월 1회 고정비 1건을 `누적 ÷ 경과일 × 그 달 일수`로 외삽해 pace로 오탐(backend 시드 검증 중 발견, 사용자 승인) |

### v1 → v2 (2026-10-19)

| # | 변경 | 이유 |
|---|---|---|
| 1 | 저장소를 **JSON 파일 → Postgres(Neon, Vercel Marketplace)** 로 변경. 로컬/테스트는 PGlite(내장형 Postgres)로 실행 | Vercel 서버리스는 파일시스템이 영구적이지 않아 JSON 파일 저장이 불가 |
| 2 | **로그인(이메일+비밀번호) 추가**, 모든 데이터를 사용자별로 분리. users / sessions / auth_attempts 테이블, transactions.user_id 추가 | 사용자 결정: 외부 접속 전제, 데이터 사용자별 분리 (v1 Q6 대체) |
| 3 | 실행 구조를 "Node 서버 1개" → **Vercel 단일 서버리스 함수(`api/`) + 정적 프론트**로 변경. 로컬은 같은 핸들러를 쓰는 Node 개발 서버 | 사용자 결정: Vercel 배포 |
| 4 | "외부 npm 의존성 0개" 원칙 완화: 런타임 의존성은 **DB 드라이버 `pg` 1개만** 허용. PGlite는 devDependency, Playwright는 QA 전용 `e2e/` 패키지로 분리 | Postgres 접속에 드라이버가 필요. 앱 런타임과 테스트 도구를 분리하라는 사용자 지시 |
| 5 | **대시보드 화면 신설**(KPI, 카테고리 비중 도넛, 월별 수입/지출 추이, 카테고리별 월 추이) + 집계 API 3종 | 사용자 신규 요구 |
| 6 | 차트: v1 "CSS 막대만" → **직접 SVG 렌더링**(라이브러리 없음) 채택, 표 대체 제공 | 대시보드 필요. 의존성/번들 없이 접근성·테스트 용이성 확보 (4.6 비교) |
| 7 | 시간대: 서버 기본 "오늘"을 **Asia/Seoul 고정**. 프론트는 브라우저 로컬 날짜를 `today`로 전달 | Vercel 함수는 UTC로 동작해 한국 00~09시에 날짜가 하루 밀림 (v1 Q7 해결) |
| 8 | 완료 기준: v1 C번호는 유지하고 바뀐 항목에 "(v2 수정)" 표시, 신규는 C35부터. 배포 환경 확인 항목은 P번호로 분리. 브라우저 항목은 Playwright 자동화 | Q1 해결(Playwright 허용), 실제 배포 확인은 자동화 대상과 구분 |
| 9 | GitHub 푸시, Vercel 연결, 프로덕션 배포를 **사용자 승인 체크포인트(CP1~CP3)** 로 지정 | 외부 계정/공개 저장소에 영향을 주는 작업 |

### v1 열린 질문 처리 결과
| ID | 결과 |
|---|---|
| Q1 | 해결: Playwright 허용. `e2e/` 폴더의 별도 package.json devDependency로만 둔다 |
| Q2 | v1 가정 유지: 예산 설정 제외, R4(평균 대비)만 |
| Q3 | v1 가정 유지: 고정 카테고리 |
| Q4 | v1 가정 유지: 임계값 코드 상수, 설정 UI 없음 |
| Q5 | v1 가정 유지: 반복 거래 표시만 (숨김/자동기록 없음) |
| Q6 | 대체됨: 로그인 + 사용자별 분리 + Vercel(HTTPS) 배포 |
| Q7 | 판단: Asia/Seoul 고정 권장 및 채택 (4.5) |

참고: v1은 구현 전에 개정되므로 JSON 데이터 이전 작업은 없다.

---

## 1. 목표

로그인한 사용자별로 분리된 데이터를 바탕으로, 2~3번 터치로 지출/수입을 기록하고 규칙 기반 추천·인사이트와 차트 대시보드를 제공하는 모바일 친화 웹 가계부를 Vercel에 배포한다.

---

## 2. 사용자 스토리

| ID | 사용자 스토리 |
|---|---|
| US-1 | 사용자로서, 앱을 열면 바로 금액 입력칸에 커서가 있어서 금액 → 카테고리 → 저장만으로 지출을 기록하고 싶다. |
| US-2 | 사용자로서, 매일 마시는 커피처럼 자주 쓰는 항목은 "빠른 입력" 버튼 한 번 + 저장으로 기록하고 싶다. |
| US-3 | 사용자로서, 메모를 일부만 입력해도 예전에 쓴 메모가 제안되고, 고르면 카테고리와 금액이 자동으로 채워졌으면 좋겠다. |
| US-4 | 사용자로서, 이번 달 수입/지출 합계와 잔액, 카테고리별 지출을 한 화면에서 보고 싶다. |
| US-5 | 사용자로서, 잘못 입력한 기록을 고치거나 지우고 싶다. |
| US-6 | 사용자로서, 월세, 구독료처럼 반복되는 지출을 앱이 알아서 찾아 주고 다음 예정일을 알려 줬으면 좋겠다. |
| US-7 | 사용자로서, 평소보다 특정 카테고리에서 많이 쓰고 있으면 이번 달 중간에 미리 경고를 받고 싶다. |
| US-8 | 사용자로서, 휴대폰(폭 360px)에서도 확대/가로 스크롤 없이 편하게 쓰고 싶다. |
| US-9 (신규) | 사용자로서, 이메일과 비밀번호로 가입/로그인해서 휴대폰과 PC 어디서든 내 가계부를 쓰고 싶다. |
| US-10 (신규) | 사용자로서, 내 기록은 다른 사용자가 볼 수도, 고칠 수도 없어야 한다. |
| US-11 (신규) | 사용자로서, 이번 달 지출이 어떤 카테고리에 얼마나 쏠렸는지 그래프로 한눈에 보고 싶다. |
| US-12 (신규) | 사용자로서, 최근 몇 달 동안 수입과 지출이 어떻게 변했는지, 특정 카테고리 지출이 늘고 있는지 그래프로 보고 싶다. |
| US-13 (신규) | 색을 구분하기 어려운 사용자/스크린리더 사용자로서, 그래프 대신 표로도 같은 숫자를 확인하고 싶다. |

---

## 3. 범위 / 제외 범위

### 3.1 범위 (v2에서 한다)
- 회원가입/로그인/로그아웃 (이메일+비밀번호), 서버 세션(쿠키), 로그인 시도 제한, CSRF 대응
- 모든 데이터의 사용자별 분리 및 소유권 검증
- 거래 CRUD: 지출/수입 추가, 월별 조회, 수정, 삭제
- 고정 카테고리 목록 (4.2)
- 월별 요약: 수입 합계, 지출 합계, 잔액, 카테고리별 지출 합계
- 빠른 입력 UX (기본값 자동, 칩 버튼, 숫자 키패드)
- 규칙 기반 추천/인사이트 R1~R5 (6장, v1과 동일 규칙, 사용자별 데이터만 사용)
- 대시보드: KPI, 카테고리 비중, 월별 수입/지출 추이, 카테고리별 월 추이 (7.3) + 집계 API
- 모바일 우선 반응형 UI, 접근성(표 대체, 색 외 구분)
- Postgres 스키마/마이그레이션 스크립트, 시드 스크립트
- 저장소 구성(README, .gitignore, .env.example, vercel.json), GitHub 푸시, Vercel 배포 (사용자 승인 후)

### 3.2 제외 범위 (v2에서 하지 않는다)
- 비밀번호 재설정/변경, 이메일 인증, 회원 탈퇴 UI (12장 OQ3 참고), 소셜 로그인, 2단계 인증, 관리자 화면
- 가계부 공유(여러 사용자가 한 가계부 사용)
- 외부 AI/ML/분석 API 호출 (외부 연결은 DB뿐)
- 은행/카드사 연동, 문자/영수증 자동 인식
- 사용자 정의 카테고리, 예산 설정, 임계값 설정 UI, 반복 거래 숨김/자동 기록 (v1 Q2~Q5 결정)
- 차트 라이브러리 및 CDN 스크립트 사용, 차트 툴팁/확대/애니메이션/이미지 내보내기
- 프론트엔드 빌드 도구(번들러, 트랜스파일러), 프론트 프레임워크
- 다중 통화, 소수점 금액 (원화 정수만)
- 푸시 알림, 오프라인(PWA/Service Worker), 데이터 내보내기/가져오기
- 삭제 실행 취소(undo)
- 커스텀 도메인 (`*.vercel.app` 사용)

---

## 4. 기술 스택 및 공통 규약

### 4.0 스택 요약
- 프론트: 바닐라 HTML/CSS/JS(ES module), 빌드 없음, 정적 파일로 배포. 외부 스크립트/CDN 없음.
- 백엔드: Node.js **22.x**, ES module(`"type": "module"`), 프레임워크 없음. Vercel Node.js 런타임 서버리스 함수 **1개**(`api/index.js`)가 모든 `/api/*` 요청을 내부 라우터로 넘긴다.
- DB: Postgres. 프로덕션은 **Neon**(Vercel Marketplace), 로컬 개발/자동 테스트는 **PGlite**.
- 의존성 규칙
  - `dependencies`: `pg` 단 1개 (추가가 필요하면 메인 세션 승인 필요)
  - `devDependencies`(루트): `@electric-sql/pglite` (로컬/테스트 DB)
  - `e2e/package.json`(QA 소유, 별도 패키지): `@playwright/test`. 루트 package.json에는 넣지 않는다.
- 테스트: `node:test` (단위/통합), Playwright (브라우저)

### 4.1 영속 저장소 선택

**추천: Neon Postgres (Vercel Marketplace 통합)**

| 기준 | Neon Postgres (추천) | Upstash Redis | 비고 |
|---|---|---|---|
| 데이터 형태 적합성 | 관계형. users ↔ transactions 외래키, 이메일 UNIQUE, CHECK 제약으로 규칙을 DB가 보장 | KV. 이메일 중복 방지·사용자별 월 인덱스를 앱이 직접 관리 | 사용자 분리와 무결성이 핵심 요구 |
| 대시보드 집계 | `GROUP BY` 월/카테고리 SUM을 SQL 한 번으로 | 전체 조회 후 앱에서 집계 또는 별도 카운터 유지 | 대시보드 신규 요구에 직결 |
| 동시 쓰기 | 트랜잭션/행 단위 처리, 별도 직렬화 불필요 | 원자 명령은 있으나 다중 키 정합성은 직접 처리 | |
| 로컬/테스트 재현성 | 같은 SQL을 PGlite로 계정 없이 실행 가능 | 로컬 Redis 또는 계정 필요 | QA 재현성 |
| 비용/한도 | 무료 플랜 0.5GB 저장, 유휴 시 자동 일시정지 | 무료 플랜 명령 수 제한 | 개인 가계부 규모에 둘 다 충분 |
| 단점 | 유휴 후 첫 요청 콜드스타트(약 0.5~2초) | - | 수용 가능 |

대안 (순서대로 고려): Supabase Postgres(동일 SQL, 자체 Auth는 사용하지 않음), Turso(libSQL/SQLite, SQL이 일부 다름). Upstash Redis는 위 이유로 비추천.

드라이버: `pg`(node-postgres) + Neon **pooled** 연결 문자열. Neon 전용 HTTP 드라이버 대신 `pg`를 고르는 이유는 로컬 Postgres/다른 Postgres 공급자로 바꿔도 코드가 그대로이기 때문이다.

지역: Neon `AWS Asia Pacific (Singapore)`, Vercel 함수 지역 `sin1`(vercel.json `regions`)으로 DB와 같은 지역에 둔다(쿼리 왕복 지연 최소화).

DB 접근 계층 규칙 (backend):
- `query(sql, params)` 형태의 어댑터 인터페이스 하나로 감싸고, 구현은 `pg` 어댑터(프로덕션)와 PGlite 어댑터(로컬/테스트) 두 가지.
- PGlite 어댑터는 로컬 개발 서버와 테스트에서만 import한다. `api/index.js` 경로에서 PGlite를 import하지 않는다(배포 함수 크기/의존성 분리).
- **모든 쿼리는 파라미터 바인딩**. 문자열 연결로 SQL을 만들지 않는다.
- 주의: `pg`는 DATE 컬럼을 JS Date(로컬 시간대)로 바꿔 날짜가 하루 밀릴 수 있으므로 DATE는 `YYYY-MM-DD` 문자열로 받도록 처리한다. SUM 결과(bigint)는 숫자로 변환한다.
- 스키마는 `src/backend/db/schema.sql`(재실행해도 안전한 멱등 SQL), 적용은 `npm run db:migrate`.

### 4.2 데이터 모델 (backend가 api.md와 schema.sql에서 확정)

**users**
| 필드 | 타입 | 규칙 |
|---|---|---|
| id | uuid | PK, 서버 생성 |
| email | text | 정규화(앞뒤 공백 제거, 소문자) 후 저장, UNIQUE, 최대 254자 |
| password_hash | text | `scrypt$N$r$p$salt(base64)$hash(base64)` 형식 (4.4) |
| created_at | timestamptz | 서버 생성 |

**sessions**
| 필드 | 타입 | 규칙 |
|---|---|---|
| token_hash | text | PK. 쿠키 토큰의 SHA-256 해시 (원문 토큰은 저장하지 않음) |
| user_id | uuid | FK → users.id, ON DELETE CASCADE, 인덱스 |
| created_at / expires_at | timestamptz | 만료 = 생성 + 30일 (고정 만료, 연장 없음) |

**auth_attempts** (로그인/가입 시도 제한용)
| 필드 | 타입 | 규칙 |
|---|---|---|
| id | bigserial | PK |
| kind | text | `login` \| `signup` |
| email | text | 정규화 이메일 (가입은 null 가능) |
| ip | text | 클라이언트 IP |
| success | boolean | |
| created_at | timestamptz | 인덱스 (kind, email, created_at), (kind, ip, created_at). 1일 지난 행은 로그인 처리 중 수시 삭제 |

**transactions** (v1 Transaction + user_id)
| 필드 | 타입 | 규칙 |
|---|---|---|
| id | uuid | PK, 서버 생성 |
| user_id | uuid | **필수**, FK → users.id, ON DELETE CASCADE. 요청 본문 값은 무시하고 항상 세션 사용자로 설정 |
| type | text | `expense` \| `income` (CHECK) |
| amount | integer | 1 이상 100,000,000 이하 (CHECK) |
| category | text | 해당 type의 고정 카테고리 중 하나 (앱 검증) |
| memo | text | 앞뒤 공백 제거 후 0~50자 |
| date | date | 실존 날짜, API 입출력은 `YYYY-MM-DD` |
| created_at | timestamptz | 서버 생성. API 필드명은 v1과 같이 `createdAt` |
- 인덱스: (user_id, date)

**고정 카테고리** (v1과 동일, 이 순서가 "고정 순서")
- expense: `식비`, `카페/간식`, `교통`, `쇼핑`, `주거/통신`, `의료/건강`, `문화/여가`, `기타`
- income: `급여`, `용돈`, `부수입`, `기타`

### 4.3 공통 규약
- **메모 정규화 키**: 앞뒤 공백 제거, 연속 공백 1칸, 영문 소문자화. 패턴 판정 시 이 키로 묶는다.
- **기준일(today) 주입**: 추천/인사이트 API는 쿼리 `today=YYYY-MM-DD`를 받으면 그 날을 오늘로 간주한다. 없으면 **Asia/Seoul 기준 현재 날짜**. 프론트는 항상 브라우저 로컬 날짜를 `today`로 보낸다. (today는 본인 데이터 계산에만 영향을 주므로 프로덕션에서도 허용)
- **에러 형식**: `{ "error": { "code": "...", "message": "..." } }`
  | 상태 | code 예 | 상황 |
  |---|---|---|
  | 400 | `VALIDATION_ERROR`, `INVALID_JSON` | 입력 검증 실패, 잘못된 JSON |
  | 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` | 세션 없음/만료/위조, 로그인 실패 |
  | 403 | `CSRF_REJECTED`, `SIGNUP_DISABLED` | Origin 불일치/누락, 가입 닫힘 |
  | 404 | `NOT_FOUND` | 없는 리소스 **및 다른 사용자의 리소스** |
  | 409 | `EMAIL_TAKEN` | 이미 가입된 이메일 |
  | 413 | `PAYLOAD_TOO_LARGE` | 본문 16KB 초과 |
  | 415 | `UNSUPPORTED_MEDIA_TYPE` | 본문이 있는 요청의 Content-Type이 `application/json`이 아님 |
  | 429 | `TOO_MANY_ATTEMPTS` | 로그인/가입 시도 제한 (Retry-After 헤더 포함) |
  | 500 | `INTERNAL_ERROR` | 그 외. 메시지는 일반 문구, 스택/SQL을 응답에 포함하지 않음 |
- **금액 표기**(프론트): `12,500원`, 천 단위 콤마.
- **API 응답 헤더**: `Cache-Control: no-store`, `Content-Type: application/json; charset=utf-8`.

### 4.4 인증/보안 설계

**방식**: 이메일 + 비밀번호. 가입은 기본 **개방**, 환경변수 `SIGNUP_ENABLED=false`로 언제든 닫을 수 있다(닫히면 가입 403 `SIGNUP_DISABLED`). 최종 정책은 12장 OQ1.

**입력 규칙**
- email: 정규화 후 1~254자, `로컬@도메인.최상위` 형태의 단순 검사(공백 없음, `@` 1개, 도메인에 `.` 포함)
- password: 8~128자, 그 외 조합 규칙 없음(길이 우선). 앞뒤 공백도 그대로 비밀번호로 취급

**비밀번호 해싱**: Node 내장 `crypto.scrypt` (추가 의존성 없음)
- 파라미터: N=2^15(32768), r=8, p=1, salt 16바이트(난수), 결과 64바이트. `maxmem`은 64MB로 지정(기본 32MB로는 이 파라미터에서 오류)
- 저장 형식에 파라미터를 포함해 향후 상향 가능하게 한다
- 비교는 `crypto.timingSafeEqual`
- 존재하지 않는 이메일 로그인 시에도 더미 해시로 scrypt를 1회 수행해 응답 시간 차이로 가입 여부가 드러나지 않게 한다
- 검토한 대안: bcrypt/argon2 npm 패키지(네이티브 빌드/의존성 증가로 제외)

**세션**: DB 세션 (JWT 미사용)
- 로그인/가입 성공 시 32바이트 난수 토큰(base64url) 생성, DB에는 SHA-256 해시만 저장
- 쿠키: 이름 `mb_sid`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age=2592000`(30일), Domain 미지정
- `Secure`는 기본 켜짐. 로컬 http 개발에서만 `COOKIE_SECURE=false`로 끈다
- 로그아웃: DB 세션 삭제 + `Max-Age=0` 쿠키로 제거. 이후 같은 토큰은 401
- JWT를 쓰지 않는 이유: 로그아웃/만료 시 서버측 즉시 무효화가 간단하고, 서명 라이브러리/시크릿 관리가 필요 없다. 따라서 **세션 서명용 시크릿 환경변수는 필요 없다**(토큰이 난수이고 해시만 저장)

**로그인/가입 시도 제한** (auth_attempts 테이블 기반. 서버리스는 메모리가 공유되지 않으므로 메모리 카운터 금지)
- 같은 이메일 로그인 **실패 5회 / 15분** → 이후 15분 창 안의 시도는 비밀번호가 맞아도 429. 로그인 성공 시 그 이메일의 실패 기록 초기화
- 같은 IP 로그인 **실패 20회 / 15분** → 429
- 같은 IP 가입 시도 **10회 / 1시간** → 429
- 429 응답에 `Retry-After`(초) 헤더
- 클라이언트 IP: Vercel에서는 `x-forwarded-for` 첫 값(Vercel이 덮어써서 위조 불가). 로컬 개발 서버는 소켓 주소를 쓰고, `TRUST_PROXY=true`일 때만 `x-forwarded-for`를 신뢰(QA가 IP 제한을 재현하기 위함)

**CSRF 대응** (토큰 없이 3중 방어)
1. 쿠키 `SameSite=Lax`
2. 상태 변경 요청(POST/PUT/DELETE, 로그인/가입/로그아웃 포함)은 `Origin` 헤더가 **반드시 있어야 하고**, 그 호스트가 요청 호스트(`x-forwarded-host` 또는 `Host`)와 같거나 `APP_ORIGINS` 목록에 있어야 한다. 아니면 403 `CSRF_REJECTED`
3. 본문이 있는 요청은 `Content-Type: application/json`만 허용(아니면 415). HTML form으로는 이 요청을 만들 수 없다

**인가(소유권)**
- `/api/health`, `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout` 외 모든 API는 유효한 세션 필요(없으면 401)
- 거래 조회/수정/삭제는 항상 `WHERE id = $1 AND user_id = $세션사용자`로 처리. 다른 사용자 리소스와 존재하지 않는 리소스는 **똑같이 404**. UUID 형식이 아닌 id도 404
- 요약/집계/추천/인사이트는 세션 사용자의 거래만 읽는다

**기타 보안 요구**
- 보안 헤더(정적 파일과 API 모두): `Content-Security-Policy: default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`. 인라인 `<script>`/인라인 이벤트 핸들러 금지
- 프론트는 사용자 입력(메모 등)을 `textContent`로만 출력 (innerHTML에 사용자 데이터 금지)
- 비밀 값은 코드/저장소에 넣지 않고 환경변수로만. `.env*`는 .gitignore (`.env.example`만 커밋)
- 로그에 비밀번호, 세션 토큰, 연결 문자열을 남기지 않는다

### 4.5 시간대 결정 (v1 Q7)
- 서버 기본 "오늘" = **Asia/Seoul** 현재 날짜(`Intl.DateTimeFormat`의 timeZone 지정, 고정 상수). 이유: Vercel 함수는 UTC로 동작해 서버 로컬 시간을 쓰면 한국 00:00~08:59에 전날로 계산된다.
- 거래 날짜는 시각 없는 DATE로 저장하므로 저장/집계에는 시간대 변환이 없다.
- 프론트 기본 날짜와 `today` 파라미터는 브라우저 로컬 날짜(한국 사용자 = KST). 해외 체류 시에도 사용자가 보는 날짜와 일치한다.

### 4.6 차트 구현 방식 비교 및 결정

| 기준 | Chart.js 고정 버전 로컬 포함 | **직접 SVG (채택)** |
|---|---|---|
| 의존성/용량 | UMD 파일 약 200KB(min) 저장소에 포함, 라이선스 파일 동봉, 수동 업데이트 | 0. 차트 3종 분량의 자체 코드 |
| 접근성 | canvas라 내용이 보조기술에 노출되지 않음. 표 대체 필수 | SVG `role="img"` + `<title>/<desc>`, 텍스트 레이블이 DOM에 있음. 표 대체 병행 |
| 색 외 구분 | 패턴 플러그인/추가 코드 필요 | SVG `<pattern>`(사선 등)으로 간단 |
| 360px 대응 | 반응형 지원(리사이즈 시 다시 그림) | `viewBox` + `width:100%`로 자동 축소, 레이블 수 조절은 직접 |
| 테스트 용이성 | 캔버스 픽셀이라 값 검증이 어려움 | 기하 계산을 순수 함수로 두면 `node --test`로 검증, Playwright에서 DOM 텍스트 확인 가능 |
| CSP | `default-src 'self'`에서 동작 가능 | 문제 없음 |
| 기능 | 툴팁, 애니메이션 등 풍부 | 필요한 것만 (툴팁/애니메이션 제외 범위) |

결정: **직접 SVG**. 차트 종류가 3개(도넛, 묶은 막대, 단일 막대)로 단순하고, 의존성 0·결정적 테스트·접근성 측면이 유리하다. 이후 상호작용이 많이 필요해지면 Chart.js 고정 버전 로컬 포함으로 전환한다.

차트 공통 요구:
- 각 차트는 `<figure>` + `<figcaption>`, SVG에 `role="img"`와 요약 문장(예: "2026년 10월 지출 1,230,000원 중 식비 32.5%로 가장 큼")
- **표 대체**: 각 차트 바로 아래 같은 숫자의 `<table>`(`<caption>`, `<th scope>`) 제공. 모바일에서는 "표로 보기" 펼침(`<details>`)으로 접어 둘 수 있으나 DOM에는 항상 존재
- **색만으로 구분 금지**: 수입/지출은 색 + 패턴(지출 단색, 수입 사선) + 범례 텍스트. 도넛은 범례 목록에 카테고리명·금액·비율을 모두 텍스트로 표시하고, 조각 순서(12시 방향 시계방향, 금액 내림차순)와 범례 순서를 일치
- 색각이상 친화 팔레트, 그래픽 요소 대비 3:1 이상 (배경 대비)
- 360px: 가로 스크롤 없음, 축/범례 텍스트 렌더링 높이 11px 이상, 12개월 표시 시 월 레이블은 "5월" 형식, 겹치면 격월 표시(표에는 전체)
- 애니메이션 없음, 데이터 없음 상태는 차트 대신 안내 문구
- 화면에 `NaN`, `undefined`, `Infinity`가 표시되지 않음 (0으로 나누기 처리)

### 4.7 배포 구조 / 저장소 구조

```
/                         (GitHub: Latto-JD/moneybook)
  api/index.js            Vercel 함수 진입점. src/backend 라우터 호출만 (backend)
  src/backend/            라우터, 핸들러, 인증, 규칙(R1~R5), 집계, DB 어댑터 (backend)
    db/schema.sql, db/migrate.js
    scripts/dev-server.js  로컬 개발 서버: 정적 파일 + 같은 라우터 (backend)
    scripts/seed.js
    test/
  src/frontend/public/    배포되는 정적 파일 (index.html, login.html, css, js) (frontend)
  src/frontend/test/      프론트 순수 유틸 테스트 (frontend)
  e2e/                    Playwright 테스트 + 별도 package.json (qa)
  docs/                   plan.md, api.md, qa-report.md
  package.json, vercel.json, .gitignore, .env.example, README.md (backend)
```
- 루트 설정 파일(package.json, vercel.json, .gitignore, .env.example, README.md)과 `api/`는 **backend 영역**으로 지정한다. frontend는 README에 넣을 내용이 있으면 보고서로 전달한다.
- 기존 `src/frontend/office/`는 이 앱과 무관하며 배포 대상(outputDirectory) 밖이다. 저장소 포함 여부는 12장 OQ2.

**vercel.json에 담을 내용** (backend가 작성, 실제 값은 B2에서 확정)
- 프레임워크 없음, 빌드 명령 없음, `outputDirectory: src/frontend/public`
- `/api/*` → `api/index.js` 단일 함수로 전달(파일 기반 catch-all 또는 rewrite 중 `vercel dev`/프리뷰에서 동작 확인된 방식)
- `regions: ["sin1"]`
- 보안 헤더(4.4) 전 경로 적용
- 위험: outputDirectory 지정 시 `api/` 함수 인식 여부, Vercel의 요청 본문 자동 파싱과 자체 본문 파싱의 충돌 여부를 B2와 D3에서 확인. 문제가 있으면 정적 파일을 루트 `public/`으로 옮기는 안으로 대체(메인 세션 승인 필요)

**환경변수**
| 이름 | 필수 | 사용처 | 설명 |
|---|---|---|---|
| `DATABASE_URL` | 프로덕션 필수 | 런타임 | Neon pooled 연결 문자열. Marketplace 통합이 자동 주입 |
| `DATABASE_URL_UNPOOLED` | 마이그레이션 시 | `db:migrate` | Neon 직접 연결 문자열(자동 주입). 없으면 `DATABASE_URL` 사용 |
| `DB_DRIVER` | 로컬 | 개발 서버/테스트 | `pglite`면 PGlite 사용 (프로덕션에서는 설정하지 않음) |
| `PGLITE_DIR` | 선택 | 로컬 | PGlite 데이터 디렉터리(기본 `.data/pglite`, 테스트는 메모리) |
| `COOKIE_SECURE` | 선택 | 런타임 | 기본 `true`. 로컬 http에서만 `false` |
| `SIGNUP_ENABLED` | 선택 | 런타임 | 기본 `true` |
| `APP_ORIGINS` | 선택 | 런타임 | 같은 호스트 외 추가 허용 Origin(쉼표 구분) |
| `TRUST_PROXY` | 선택 | 로컬 | `true`면 로컬에서 `x-forwarded-for` 신뢰 |
| `PORT` | 선택 | 로컬 | 개발 서버 포트, 기본 3000 |
- 세션/JWT 시크릿: **불필요** (4.4 세션 설계 참고)
- `.env.example`에 이름과 설명만, 값은 비움

**로컬 개발 방법**
1. 기본(계정 불필요): `npm ci` → `.env` 에 `DB_DRIVER=pglite`, `COOKIE_SECURE=false` → `npm run db:migrate` → `npm run dev` (dev-server가 `src/frontend/public` 정적 파일 + `/api/*`를 같은 핸들러로 처리, http://localhost:3000)
2. Vercel 동작 확인(CP2 이후): `vercel link` → `vercel env pull .env.local` → `vercel dev`. Neon 개발용 브랜치를 쓰는 것을 권장(프로덕션 DB 직접 사용 지양)
- `npm test`: 백엔드/프론트 단위·통합 테스트(PGlite 메모리)
- QA 브라우저 테스트: `cd e2e && npm ci && npx playwright install chromium && BASE_URL=http://localhost:3000 npx playwright test`

---

## 5. API 엔드포인트 목록 (상세는 backend가 `docs/api.md`에 작성)

### 5.1 인증 (신규)
| 메서드 | 경로 | 용도 | 응답 |
|---|---|---|---|
| POST | `/api/auth/signup` | `{email, password}` 가입 + 자동 로그인 | 201 `{user:{id,email}}` + Set-Cookie. 400/403/409/429 |
| POST | `/api/auth/login` | `{email, password}` 로그인 | 200 `{user:{id,email}}` + Set-Cookie. 401/429 |
| POST | `/api/auth/logout` | 로그아웃 (세션 없어도 204) | 204 + 쿠키 제거 |
| GET | `/api/auth/me` | 현재 사용자 | 200 `{user:{id,email}}` / 401 |

### 5.2 기존 (v1과 같고 모두 로그인 필요, 세션 사용자 데이터만)
| 메서드 | 경로 | 용도 |
|---|---|---|
| GET | `/api/health` | 상태 확인(로그인 불필요). `{status:"ok", db:"ok"|"error"}` |
| GET | `/api/categories` | 고정 카테고리 `{expense:[...], income:[...]}` |
| GET | `/api/transactions?month=YYYY-MM` | 월 거래 목록 (date 내림차순, 같은 날은 createdAt 내림차순) |
| POST | `/api/transactions` | 추가 → 201 + 생성 객체 |
| PUT | `/api/transactions/:id` | 전체 필드 수정 → 200 |
| DELETE | `/api/transactions/:id` | 삭제 → 204 |
| GET | `/api/summary?month=YYYY-MM` | `{incomeTotal, expenseTotal, balance, byCategory[]}` |
| GET | `/api/recommendations/quick?type=expense&today=` | R1 (최대 5) |
| GET | `/api/recommendations/autocomplete?q=&type=&today=` | R2 (최대 5) |
| GET | `/api/insights?month=YYYY-MM&today=` | `{recurring:[], overspending:[], largeExpenses:[]}` |
- 거래 응답 객체에는 `userId`를 포함하지 않는다(불필요한 노출 방지). 요청 본문의 `userId`/`user_id`는 무시한다.

### 5.3 대시보드 집계 (신규)
공통 파라미터: `from=YYYY-MM`, `to=YYYY-MM` (둘 다 필수, from ≤ to, 기간 최대 24개월, 위반 시 400). `type=expense|income` (기본 expense). 모든 금액은 원 단위 정수.

| 메서드 | 경로 | 응답 개요 |
|---|---|---|
| GET | `/api/stats/monthly?from=&to=` | `{from, to, months:[{month, incomeTotal, expenseTotal, balance, count}]}` — from~to의 **모든 달을 빠짐없이** 오래된 순, 거래 없는 달은 0 |
| GET | `/api/stats/categories?from=&to=&type=` | `{from, to, type, grandTotal, items:[{category, total, count, ratio}]}` — total > 0인 카테고리만, total 내림차순(동률은 고정 순서), ratio = total/grandTotal 소수 넷째 자리 반올림. 데이터 없으면 `grandTotal:0, items:[]` |
| GET | `/api/stats/category-monthly?from=&to=&type=` | `{from, to, type, months:["YYYY-MM",...], series:[{category, totals:[...], sum}]}` — totals 길이 = months 길이, sum > 0인 카테고리만, sum 내림차순 |
- 단월 비중은 `from=to=해당 월`로 호출한다. KPI의 전월 대비는 프론트가 monthly 결과로 계산한다.

---

## 6. 패턴 인식/추천 규칙 (v1과 동일, 규칙 기반)

v2 변경점: 모든 규칙의 입력은 **세션 사용자의 거래만**. today 기본값은 Asia/Seoul(4.5). 규칙 로직은 DB와 무관한 순수 함수(거래 배열 + today → 결과)로 구현한다.

공통: 모든 기간 계산은 기준일(today) 포함, 날짜 단위. "최근 N일"은 `today-(N-1)일 ~ today`.

### R1. 빠른 입력 제안 (자주 쓰는 항목)
- 대상: 요청한 type의 거래 중 최근 90일 내, 메모가 비어 있지 않은 것
- 그룹 키: (category, 메모 정규화 키)
- 후보 조건: 그룹 내 건수 **3건 이상**
- 대표 금액: 그룹 내 금액의 **최빈값**, 최빈값이 여러 개면 가장 최근 거래의 금액
- 표시 메모: 그룹 내 가장 최근 거래의 원래 메모
- 정렬:
  1. "오늘 요일 일치" 그룹 우선 — 최근 56일(8주) 동안 today와 같은 요일에 **2건 이상** 있는 그룹
  2. 그다음 90일 건수 내림차순
  3. 동률이면 마지막 사용일 내림차순, 그래도 같으면 메모 가나다순
- 최대 **5개**. 각 항목: `{memo, category, amount, count, lastDate, weekdayMatch}`
- 후보 0개면 빈 배열 (프론트는 섹션 숨김)

### R2. 메모 자동완성
- 입력 `q`를 정규화한 뒤 **1글자 이상**일 때만 동작 (빈 값이면 빈 배열)
- 대상: 해당 type의 최근 180일 거래 중 메모 정규화 키가 q로 **시작**하는 것 (시작 일치가 5개 미만이면 **포함** 일치로 보충)
- 메모 정규화 키별로 묶어 반환: `{memo, category, amount}`
  - category: 그 메모에서 가장 많이 쓴 카테고리 (동률이면 최근 사용)
  - amount: 그 메모의 가장 최근 거래 금액
- 정렬: 시작 일치 먼저, 그 안에서 건수 내림차순, 동률이면 최근 사용 순. 최대 **5개**

### R3. 반복 거래 감지
- 대상: 최근 400일 거래 (type 무관, 결과에 type 포함)
- 그룹 키: 메모가 있으면 (type, 메모 정규화 키), 없으면 (type, category, amount 정확히 일치)
- 금액 조건: 그룹 내 모든 금액이 **중앙값의 ±10% 이내**
- 주기 조건 (날짜 오름차순 정렬 후 인접 간격(일)):
  - **월간**: **3건 이상**, 모든 간격 **26~35일**
  - **주간**: **4건 이상**, 모든 간격 **6~8일**
  - 같은 날짜에 같은 그룹 2건 이상이면 1건으로 계산
- 비활성 제외: 마지막 거래일 + 주기 최대값(월간 35일 / 주간 8일) < today 이면 제외
- 다음 예정일: 마지막 거래일 + 간격 중앙값(소수점 내림)
- 각 항목: `{type, memo, category, amount(중앙값), period:"monthly"|"weekly", occurrences, lastDate, nextDate, dueSoon}`
- `dueSoon`: today ≤ nextDate ≤ today+3일 이면 true
- 정렬: nextDate 오름차순

### R4. 카테고리별 과소비 알림 (v2.1 수정: pace 판정에서 반복 거래 제외)
- 대상: `month` 월의 expense 카테고리별 합계 (today가 그 달에 속할 때만 "페이스" 판정)
- baseline: 직전 3개 달력월 중 해당 카테고리 지출이 **1건 이상 있는 달**의 월 합계 평균 (반복 거래 포함, v2와 동일)
  - 기록 있는 달 **2개월 미만**이면 판정 안 함
  - baseline **10,000원 미만**이면 판정 안 함
- 판정 (카테고리당 최대 1개, exceeded 우선):
  - **exceeded** (v2와 동일): 이번 달 누적 ≥ baseline × **1.2**. 이번 달 누적은 반복 거래를 **포함**한 그 카테고리 전체 합계(= `currentTotal`)
  - **pace** (v2.1 수정): 다음을 **모두** 만족할 때
    1. exceeded 아님
    2. today가 `month`에 속하고 경과일 ≥ **7일** (경과일 = today의 일(day). 과거/미래 달 조회 시 pace 판정 안 함)
    3. 그 카테고리의 **pace 대상 거래**(아래 R4-P)가 **2건 이상** (2건 미만이면 pace 판정 안 함: 소수 거래 외삽 금지)
    4. 예상 월 합계 = **pace 대상 합계** ÷ 경과일 × 그 달 일수 ≥ baseline × **1.3**
- 각 항목: `{category, level:"exceeded"|"pace", currentTotal, baseline(원 단위 반올림), projectedTotal(pace일 때, exceeded면 null), ratio(소수 둘째 자리)}` — 응답 형식은 v2와 같다
  - `currentTotal`: 반복 거래 포함 이번 달 누적 (exceeded/pace 공통, v2와 같은 값)
  - `projectedTotal`(pace): 예상 월 합계(**반복 거래 제외 후 pace 대상 합계 기준**)를 원 단위 반올림
  - `ratio`: exceeded는 currentTotal ÷ baseline, pace는 예상 월 합계(제외 후 금액 기준) ÷ baseline. 반올림 전 값끼리 나눈 뒤 소수 둘째 자리 반올림 (api.md 확정 해석 유지)
  - pace 대상 합계·건수, 제외된 반복 거래 목록은 응답에 넣지 않는다
- 경계 비교는 부동소수 오차 없이 정수 연산으로 한다. baseline 산출 달 수 k, 그 달들 합계 S라 할 때
  - exceeded: `currentTotal × k × 5 ≥ S × 6`
  - pace: `pace대상합계 × 그 달 일수 × k × 10 ≥ S × 13 × 경과일`
- 정렬: exceeded 먼저, 그 안에서 ratio 내림차순

#### R4-P. pace 대상 거래 (v2.1 신규)
pace 대상 거래 = 그 카테고리의 이번 달 누적 거래(`currentTotal`에 합산되는 거래와 같은 집합) 중 **반복 거래가 아닌 것**. 반복 거래 판별은 다음과 같이 결정적으로 한다.
1. **R3 실행 조건**: 같은 요청의 거래 입력(세션 사용자 전체 거래)과 **같은 today**로 R3를 실행한 결과를 쓴다. 즉 같은 `/api/insights` 응답의 `recurring` 목록과 동일한 감지 결과다(400일 창, 월간·주간 모두, 비활성 제외 적용 후). `month` 파라미터는 R3에 영향을 주지 않는다.
2. **그룹 키 연결**: R3가 감지한 각 그룹의 그룹 키(R3 정의 그대로: 메모가 있으면 (type, 메모 정규화 키), 없으면 (type, category, amount 정확히 일치))로 "반복 키 집합"을 만든다. 이번 달 expense 거래 중 자기 R3 그룹 키가 이 집합에 있는 거래는 **모두** 반복 거래로 보고 제외한다.
   - 판정은 키 일치만으로 한다(거래별로 금액 ±10%나 간격을 다시 보지 않는다). 그룹이 감지됐다면 400일 창 안 그 그룹 거래는 이미 R3 금액 조건을 통과한 것이다.
   - 같은 날짜 중복 건(R3에서 1건으로 셈)도 키가 같으므로 모두 제외한다.
   - 메모 그룹 키에는 category가 없으므로, 같은 메모의 반복 거래는 어느 카테고리에 기록됐든 제외한다(제외는 그 거래가 속한 카테고리의 pace 대상에서).
   - income 반복 그룹은 type이 달라 expense 거래에 영향이 없다.
3. **R3 미감지 = 반복 아님**: 다음 그룹의 거래는 반복으로 보지 않고 pace 대상에 포함한다.
   - 이번 달 건을 포함해도 R3 건수 조건(월간 3건, 주간 4건)을 못 채운 그룹 (예: 두 번째 결제한 신규 월간 구독). 이번 달 결제가 3번째 건이면 R3 창이 today를 포함하므로 감지되어 제외된다.
   - 금액(중앙값 ±10%)이나 간격 조건을 깬 그룹 (예: 이번 달 월세 20% 인상 → 그룹 전체 미감지)
   - R3 비활성 제외로 목록에서 빠진 그룹
4. **건수**: 거래 행 수로 센다(같은 날 여러 건도 각각 1건).

#### R4 경계 사례 (기대 결과)
공통: month=`2026-09`(30일), today=`2026-09-10`(경과일 10), baseline은 2026-06~08월. 사례마다 해당 카테고리 외 거래가 없는 별도 사용자로 확인한다. "비반복"은 서로 다른 메모로 기록해 R3에 감지되지 않는 거래다.

| # | 사례 | 데이터 (해당 카테고리) | R3 반복 판별 | pace 대상 | 기대 결과 (참고: v2 결과) |
|---|---|---|---|---|---|
| 1 | 월세 1건만 | 주거/통신 "월세" 500,000원: 06-01, 07-01, 08-01, 09-01 (baseline 500,000) | 월간 감지(4건) → 09-01 제외 | 0건 | 항목 없음 (v2: 예상 1,500,000 → pace 오탐) |
| 2 | 월세 + 소액 비반복 2건 | 1번 + 09-03 "전구" 3,000, 09-08 "건전지" 5,000 | 월세만 제외 | 2건 8,000 → 예상 24,000 < 650,000 | 항목 없음 |
| 3 | 월세 + 비반복 지출로 실제 초과 | 1번 + 09-05 "입주 청소" 100,000 | 월세 제외(pace에만 해당) | - | exceeded, currentTotal 600,000, ratio 1.2 (exceeded는 반복 포함 누적) |
| 4 | 반복 아닌 큰 단건 1건 | 쇼핑: 06~08월 각 비반복 100,000 (baseline 100,000), 09-05 "패딩" 90,000 | 없음 | 1건 | 항목 없음 (v2: 예상 270,000 → pace) |
| 5 | 큰 단건 + 소액 1건 | 4번 + 09-07 "양말" 5,000 | 없음 | 2건 95,000 → 예상 285,000 | pace, currentTotal 95,000, projectedTotal 285,000, ratio 2.85 |
| 6 | 신규 구독(R3 미충족)만 | 문화/여가: 06-12 "콘서트" 30,000, 07-20 "전시회" 30,000, 08-03 "유튜브 프리미엄" 14,900, 08-10 "영화" 15,100 (baseline 30,000), 09-03 "유튜브 프리미엄" 14,900 | 유튜브 2건 → 미감지(반복 아님) | 1건 | 항목 없음 |
| 7 | 신규 구독(R3 미충족) + 비반복 1건 | 6번 + 09-06 "영화" 15,000 | 미감지 | 2건 29,900 → 예상 89,700 | pace, currentTotal 29,900, projectedTotal 89,700, ratio 2.99 (신규 구독은 3번째 결제부터 제외됨) |
| 8 | 7번을 today=09-06에 조회 | 7번과 동일 | 미감지 | 2건, 경과일 6 | 항목 없음 (경과일 < 7) |
| 9 | 반복 + 비반복 2건 경계 | 문화/여가 "넷플릭스" 17,000: 06-05, 07-05, 08-05, 09-05 + 06~08월 각 비반복 13,000 (baseline 30,000) + 09-06 "영화" 6,000, 09-08 "책" 7,000 | 넷플릭스 제외 | 2건 13,000 → 예상 39,000 = baseline × 1.3 | pace, currentTotal 30,000, projectedTotal 39,000, ratio 1.3. "책"이 6,999원이면 예상 38,997 → 항목 없음 (v2: 예상 90,000 → pace) |
| 10 | 반복 금액 이탈 | 1번에서 09-01 월세만 600,000 | 중앙값 500,000의 +20% → 그룹 전체 미감지 | 1건 | exceeded, currentTotal 600,000, ratio 1.2 |
| 11 | 주간 반복 | 의료/건강 "필라테스" 20,000: 2026-06-04부터 매주 목요일, 09-10까지 15건 (06월 4건, 07월 5건, 08월 4건 → baseline 86,667) | 주간 감지 → 09-03, 09-10 제외 | 0건 | 항목 없음 (v2: 예상 120,000 → pace 오탐) |

#### R4 열린 쟁점 (v2.1, 메인 세션 확인 필요. 결정 전에는 위 규칙대로 구현)
- R4-Q1. baseline은 반복 거래를 포함한 월 합계인데 pace는 반복을 뺀 금액만 외삽해 비교한다. 반복과 비반복이 섞인 카테고리(사례 9)는 실제 월 예상(반복 실제액 + 비반복 외삽 = 56,000)보다 낮은 값(39,000)으로 비교되어 경고가 늦거나 안 뜬다. 대안: (a) 현행, (b) 예상 월 합계 = 이번 달 반복 실제액 + 비반복 외삽, (c) baseline 계산에서도 반복 거래 제외.
- R4-Q2. 2건 기준은 건수만 본다. 큰 단건 + 소액 1건(사례 5)은 여전히 큰 단건이 외삽되어 pace가 된다. 수용할지 확인 필요.
- R4-Q3. R3 비활성 제외로 빠진 그룹은 반복으로 보지 않는다(같은 응답의 `recurring`과 일치시키기 위한 기본값). 주간 반복이 이번 달 중 끊기면(마지막 결제 후 9일 이상) 이번 달 앞쪽 결제가 pace 대상에 남는다.
- R4-Q4. api.md 6장은 overspending이 "month 안의 거래 전체"를 쓴다고 적고 있어, date > today인 이번 달 거래(미리 입력한 거래)가 `currentTotal`에 포함되는지 문서상 불분명하다. v2.1은 이 집합을 바꾸지 않고 pace 대상도 같은 집합에서 시작한다. backend가 api.md에서 명확히 적어야 한다.

### R5. 평소보다 큰 단건 지출
- 대상: `month` 월의 expense 거래 각각
- 비교군: 해당 거래 날짜 기준 이전 90일(해당 거래 제외) 같은 카테고리 지출
- 조건: 비교군 **5건 이상**, 금액 > 비교군 중앙값 × **3**
- 각 항목: `{transactionId, date, category, memo, amount, median, multiple(소수 첫째 자리)}`
- 정렬: date 내림차순, 최대 **10개**

---

## 7. 화면/UX 요구 (frontend)

### 7.1 페이지 구성
- `login.html`: 로그인/가입 전환 화면. 이미 로그인 상태(`/api/auth/me` 200)면 `/`로 이동
- `index.html`: 앱. 로드 시 `/api/auth/me`가 401이면 `/login.html`로 이동. 상단에 사용자 이메일과 로그아웃 버튼. 하단 탭 2개: **기록**(입력 + 이번 달 + 인사이트), **대시보드**. 탭은 해시(`#record`, `#dashboard`)로 구분해 새로고침/뒤로가기 유지
- 어떤 API든 401을 받으면 "로그인이 만료되었어요" 안내와 함께 로그인 화면으로 이동

### 7.2 로그인/가입 화면
- 이메일(`type="email"`, `autocomplete="email"`), 비밀번호(`autocomplete="current-password"` / 가입 시 `new-password`), 비밀번호 보기 토글
- 클라이언트 검증(이메일 형식, 비밀번호 8~128자) + 서버 오류 문구 표시: 401 "이메일 또는 비밀번호가 맞지 않아요", 409 "이미 가입된 이메일이에요", 429 "시도가 너무 많아요. N분 후 다시 시도해 주세요"(Retry-After 기반), 403 가입 닫힘 문구
- 성공 시 `/`로 이동, 금액칸 포커스

### 7.3 기록 탭 (v1 7장과 동일)
입력 영역:
- 로드 시 금액 입력칸 포커스, `inputmode="numeric"`
- 기본값: type=지출, date=오늘(브라우저 로컬). 날짜는 접힌 상태("오늘" 표시), 누를 때만 변경 UI
- type 전환은 세그먼트 버튼 2개, 카테고리는 **칩 버튼**(드롭다운 금지)
- 금액 입력 시 실시간 천 단위 콤마
- 메모 입력 시 R2 자동완성(디바운스 200ms), 선택하면 메모·카테고리·금액 자동 채움
- R1 빠른 입력 칩: 누르면 채워지고 저장 버튼 포커스 → **2터치**
- 직접 입력 최소 경로: 금액 → 카테고리 칩 → 저장(또는 Enter) = **3동작**
- 저장 성공 시 입력 초기화(type, date 유지), 금액칸 재포커스, 목록/요약/인사이트 갱신, 짧은 완료 메시지
- 검증 실패 시 필드 옆 오류 문구, 서버 400 메시지 표시

이번 달 영역: 월 이동, 수입·지출·잔액, 카테고리별 지출 막대(CSS), 날짜별 거래 목록. 항목 누르면 수정 폼, 삭제는 확인 후.

인사이트 영역: R4(초과 경고/페이스 주의, 아이콘+문구 병행), R3(dueSoon 강조), R5. 한 줄 문장. 결과 없으면 빈 상태 문구.

### 7.4 대시보드 탭 (신규)
컨트롤: 기준 월 선택(이전/다음, 기본 이번 달), 추이 기간 **6개월/12개월** 세그먼트(기본 6). 변경 시 새로고침 없이 갱신.

| 구성 | 내용 | 데이터 |
|---|---|---|
| D1 KPI 카드 | 기준 월 수입, 지출, 잔액, 지출 전월 대비 증감(▲/▼ 기호 + "지난달보다 12.3% 더 썼어요" 문구). 전월 지출 0이면 "비교할 지난달 기록이 없어요" | stats/monthly (기준 월 포함 기간) |
| D2 카테고리 지출 비중 | 기준 월 지출 도넛 + 범례 목록(카테고리, 금액, 비율 %, 소수 첫째 자리). 가운데에 총지출 | stats/categories (from=to=기준 월) |
| D3 월별 수입 vs 지출 | 기간 내 월별 묶은 막대(수입: 사선 패턴, 지출: 단색). 표에는 잔액 열 포함 | stats/monthly |
| D4 카테고리별 월 추이 | 지출 카테고리 칩 선택(기본: 기준 월 지출 1위 카테고리) → 월별 막대 | stats/category-monthly |
- 각 차트는 4.6 공통 요구(표 대체, 색 외 구분, 360px) 준수
- 데이터 없음: 차트 대신 "아직 이 기간에 기록이 없어요" 문구
- 대시보드는 기록 탭에서 저장/수정/삭제가 일어난 뒤 탭 전환 시 최신 데이터로 다시 불러온다

### 7.5 공통
360px 폭 가로 스크롤 없음, 터치 영역 최소 44×44px, 색만으로 의미 전달 금지, 모든 입력에 label 연결, 인라인 스크립트 금지(CSP), 사용자 데이터는 `textContent`로 출력.

---

## 8. 작업 목록

표기: `B` = backend, `F` = frontend, `Q` = qa, `D` = 배포(메인 세션 진행, **사용자 승인 체크포인트 포함**). "의존"이 비어 있으면 즉시 시작 가능.

### 8.1 backend
| ID | 작업 | 의존 |
|---|---|---|
| B1 | `docs/api.md` v2: 5장 전 엔드포인트 요청/응답 예시, 에러 코드(4.3 표), 쿠키 속성, CSRF 규칙(Origin/Content-Type), 시도 제한 규칙, 집계 API 필드 | - |
| B2 | 프로젝트 골격/배포 설정: 루트 package.json(Node 22, ESM, scripts: dev/test/db:migrate/seed, 의존성 규칙 4.0), `api/index.js` 단일 진입점, 프레임워크 독립 `(req,res)` 라우터, 본문 파싱(16KB 제한, JSON 전용), 보안/캐시 헤더, `scripts/dev-server.js`, vercel.json, .gitignore(`.env*`, `!.env.example`, `node_modules`, `.data/`, `.vercel/`, `e2e/test-results`, `e2e/playwright-report`), .env.example, `/api/health` | - |
| B3 | DB 계층: 쿼리 어댑터(pg / PGlite), schema.sql(4.2 테이블·제약·인덱스, 멱등), migrate 스크립트, DATE 문자열·bigint 숫자 변환 | B2 |
| B4 | 인증: signup/login/logout/me, scrypt 해싱, DB 세션·쿠키, 시도 제한, Origin 검사 미들웨어, 인증 가드(요청에 세션 사용자 주입), `SIGNUP_ENABLED`/`TRUST_PROXY`/`COOKIE_SECURE` 처리 | B1, B3 |
| B5 | 거래 CRUD + 카테고리: 입력 검증(4.2), 모든 쿼리 user_id 조건, 타 사용자 404, 본문 userId 무시 | B1, B3, B4(가드 인터페이스만 먼저 합의하면 병행 가능) |
| B6 | 월 요약 + 집계 API 3종(5.3), from/to 검증 | B5 |
| B7 | R1, R2 순수 함수 + API, today 기본값 Asia/Seoul | B1, B5 |
| B8 | R3, R4, R5 순수 함수 + `/api/insights` | B1, B5 |
| B9 | 테스트(`npm test`, PGlite 메모리): 규칙 경계값, 해싱/세션, 시도 제한, CSRF, 사용자 격리, 집계 월 경계, 검증 | B4~B8 |
| B10 | 시드 스크립트 `npm run seed -- --email= --password= --today=YYYY-MM-DD`: 사용자 없으면 생성, 그 사용자에게만 최소 **7개월치** 데이터(R1~R5 각 1건 이상, 대시보드 차트 채움). PGlite가 아닌 DB 대상이면 `--yes` 없이는 실행 거부 | B6, B8 |
| B11 | README.md: 소개, 구조, 환경변수 표, 로컬 실행/마이그레이션/테스트/시드, Vercel+Neon 연결 절차(8.4 D2 단계), 보안 메모 | B2~B10 |

### 8.2 frontend
| ID | 작업 | 의존 |
|---|---|---|
| F1 | 레이아웃/스타일: 모바일 우선 CSS, login.html·index.html 골격, 하단 탭(기록/대시보드), viewport 메타, 인라인 스크립트 없음 | - |
| F2 | 순수 유틸(ES module, Node import 가능) + 테스트: 금액 파싱/포맷, 날짜(브라우저 로컬 today, 월 이동, 월 범위 계산), 입력 검증(이메일/비밀번호 포함), **차트 기하 계산**(도넛 각도/호 경로, 막대 스케일, 눈금 값, 비율 % 포맷, 0 나눗셈 방지) | - |
| F3 | API 클라이언트: 같은 출처 쿠키, JSON Content-Type, 401 시 로그인 이동, 에러 메시지·Retry-After 추출 | B1 |
| F4 | 로그인/가입 화면 (7.2) | F1, F2, F3 |
| F5 | 입력 폼 (7.3 입력 영역) | F1, F2, F3 |
| F6 | 이번 달 영역: 월 이동, 요약, CSS 막대, 목록, 수정/삭제 | F3, F5 |
| F7 | R1 빠른 입력 칩, R2 자동완성 | F5, B1 |
| F8 | 인사이트 영역 R3/R4/R5 | F3, B1 |
| F9 | SVG 차트 컴포넌트 3종(도넛, 묶은 막대, 막대) + 표 대체 + 패턴 + 빈 상태. 목업 데이터로 개발 | F2 |
| F10 | 대시보드 탭: 컨트롤, KPI, D2~D4 연결, 탭 전환 시 재조회 | F3, F9, B1 |
| F11 | 접근성/반응형 점검(360px, 768px), 로컬 개발 서버(B2~B8)와 실연동 확인, 로그아웃/세션 만료 흐름 | F4~F10, B9 |

### 8.3 qa
| ID | 작업 | 의존 |
|---|---|---|
| Q1 | `e2e/` 준비: 별도 package.json(`@playwright/test`), `BASE_URL` 환경변수로 대상 지정, 360px·768px 뷰포트 프로젝트 | B2 (초기 구성은 바로 가능) |
| Q2 | 로컬 검증: 9장 C 항목 전체, `docs/qa-report.md` 작성 | B11, F11 |
| Q3 | 배포 환경 검증: 9.8 P 항목 (프리뷰/프로덕션) | D3 (P8~P9는 D4) |

### 8.4 저장소/배포 (메인 세션 진행)
| ID | 작업 | 의존 |
|---|---|---|
| D1 | 로컬 git 초기화(main 브랜치), 커밋 준비. 푸시 전 점검: `git status`/`git ls-files` 목록, `.env*` 미포함, 비밀 값 문자열(`postgres://`, `postgresql://`, `password=` 등) 검색 0건 | Q2 통과, reviewer "머지 가능" |
| **CP1** | **[사용자 승인] GitHub 푸시**: 메인 세션이 푸시 대상 파일 목록·점검 결과·원격 저장소 상태(`git ls-remote`)를 보여 주고 승인 후 `origin`(Latto-JD/moneybook) main에 푸시. 원격에 기존 커밋이 있으면 중단하고 보고. **force push 금지** | D1 |
| **CP2** | **[사용자 승인/사용자 수행] Vercel 연결**: Vercel에서 GitHub 저장소 Import(프레임워크 Other, 빌드 명령 없음), Marketplace에서 Neon 추가(싱가포르 지역)·프로젝트 연결 → `DATABASE_URL` 등 자동 주입 확인, 필요한 환경변수(4.7) 설정. 승인 후 프로덕션 DB에 `npm run db:migrate` 실행(`vercel env pull`로 받은 값 사용, 파일은 커밋 금지) | CP1 |
| D3 | 프리뷰 배포 확인: 프리뷰 URL에서 Q3 실행. 문제 시 해당 개발자에게 반환 → 수정 → 재푸시(커밋 푸시도 사용자에게 알림) | CP2 |
| **CP3** | **[사용자 승인] 프로덕션 배포**: 프리뷰 결과를 보고하고 승인 후 main 프로덕션 배포(또는 프리뷰 승격). 이후 Q3의 P8~P9 실행 | D3 |

### 8.5 병렬 진행
- 1차(동시 시작): B1, B2 / F1, F2 / Q1
- 2차: B1 완료 직후 frontend는 api.md 응답 예시로 목업을 만들어 F3~F10 진행(F9는 F2 이후 바로). backend는 B3 → B4 → (B5 → B6·B7·B8 병렬)
- 3차: B9, B10, B11 / F11 → Q2 → (실패 시 수정 후 재검증) → reviewer
- 4차: D1 → CP1 → CP2 → D3(Q3) → CP3
- api.md 변경은 backend가 수정 후 메인 세션에 알리고, frontend는 계약을 임의로 바꾸지 않는다.
- 각자 영역 밖 파일 수정 금지: 루트 설정/`api/`는 backend, `src/frontend/`는 frontend, `e2e/`와 `docs/qa-report.md`는 qa.

---

## 9. 완료 기준 (QA 체크리스트)

사전 준비(로컬): `npm ci`, `.env`에 `DB_DRIVER=pglite`, `COOKIE_SECURE=false`, `PGLITE_DIR=<임시 디렉터리>`(IP 제한 검증 시 `TRUST_PROXY=true`) → `npm run db:migrate` → `npm run dev`. 브라우저 항목은 Playwright(`e2e/`)로 자동화한다.
- C6~C26의 API 호출은 **로그인한 세션 쿠키**와 상태 변경 요청 시 `Origin: http://localhost:3000` 헤더를 붙여 수행한다.
- 시간 경과가 필요한 항목(시도 제한 해제, 세션 만료)은 QA가 테스트 DB의 시각 컬럼을 직접 조정해 검증해도 된다.

### 9.1 실행/환경
- [ ] C1. (v2 수정) `npm ci` 후 위 절차로 서버가 뜨고 `GET /api/health`가 200, `{status:"ok", db:"ok"}`.
- [ ] C2. (v2 수정) 루트 package.json `dependencies`가 `pg` 하나뿐이고, Playwright는 루트 package.json에 없고 `e2e/package.json`에만 있다. `src/frontend/public`의 모든 `<script src>`/`<link href>`가 같은 출처 상대 경로다(CDN 없음).
- [ ] C3. (v2 수정) `npm test`가 모두 통과한다(백엔드·프론트 단위/통합).
- [ ] C4. (v2 수정) 빈 DB에 `npm run db:migrate`가 성공하고, 두 번 실행해도 오류가 없다.
- [ ] C5. (v2 수정) `GET /`와 `GET /login.html`이 200 HTML이고 `<meta name="viewport"`가 있으며 인라인 `<script>`(src 없는 script)와 `on*=` 속성이 없다.

### 9.2 거래 API / 검증
- [ ] C6. 정상 POST → 201, 응답에 id·createdAt 포함(userId 미포함), 이후 `GET /api/transactions?month=`에 나타난다.
- [ ] C7. 다음은 모두 400 + 에러 형식: amount 0, 음수, 1.5, 문자열, 100,000,001 / type 누락·잘못된 값 / income + `식비` / date `2026-02-30`, `2026-13-01`, `20261019` / memo 51자 / 잘못된 JSON 본문(`INVALID_JSON`).
- [ ] C8. amount 1과 100,000,000, memo 50자는 201.
- [ ] C9. PUT 수정 후 GET에 반영, 없는 id(유효 UUID)와 UUID 형식이 아닌 id에 PUT/DELETE → 404.
- [ ] C10. DELETE → 204, 이후 목록에서 사라진다.
- [ ] C11. (v2 수정) 개발 서버를 재시작해도 데이터와 로그인 세션이 유지된다(같은 `PGLITE_DIR`).
- [ ] C12. (v2 수정) 같은 사용자로 POST 20건을 병렬 전송하면 20건 모두 201이고 해당 월 목록이 정확히 20건 늘어난다.
- [ ] C13. `GET /api/summary?month=`의 incomeTotal, expenseTotal, balance(=수입-지출), byCategory 합계가 수동 계산과 일치. 데이터 없는 달은 모두 0.

### 9.3 추천/인사이트 규칙 (today 파라미터로 고정)
- [ ] C14. R1: 같은 (카테고리, 메모) 3건 → 제안됨, 2건 → 안 됨. 91일 전 거래는 건수 제외.
- [ ] C15. R1: 대표 금액 최빈값(4,500 / 4,500 / 5,000 → 4,500). 최대 5개.
- [ ] C16. R1: 같은 요일 2건 이상 그룹이 건수가 더 많은 그룹보다 앞, `weekdayMatch: true`.
- [ ] C17. R2: `q=스타` → "스타벅스", category/amount 규칙대로. `q=` 빈 값 → 빈 배열. `q=GS`로 "gs25" 검색.
- [ ] C18. R3 월간: 30일 간격 3건 감지, nextDate = 마지막 + 30일. 2건 미감지, 간격 40일 포함 시 미감지.
- [ ] C19. R3 금액: +10% 이내 감지, +11% 섞이면 미감지.
- [ ] C20. R3 주간: 7일 간격 4건 감지, 3건 미감지. 마지막 거래 후 9일 경과면 제외.
- [ ] C21. R3 dueSoon: nextDate = today+3 → true, today+4 → false.
- R4 항목(C22~C24, C68~C71) 공통: C6~C26과 같은 방식(세션 쿠키)으로 `/api/insights?month=&today=`를 호출한다. 비반복 거래는 서로 다른 메모로 기록해 R3에 감지되지 않게 하고, 사례마다 새 사용자를 쓴다. "사례 N"은 6장 R4 경계 사례 표의 번호다.
- [ ] C22. (v2.1 수정) R4 exceeded: 직전 3개월 식비 각 100,000원, 이번 달 120,000원 → exceeded, 119,999원 → 아님. exceeded는 반복 거래 포함 누적 기준이다: 사례 3 → `exceeded`, currentTotal 600,000, ratio 1.2. 사례 10 → `exceeded`, ratio 1.2.
- [ ] C23. (v2.1 수정) R4 pace: 식비 baseline 100,000원(06~08월 각 100,000원, 비반복), month=`2026-09`, today=`2026-09-10`에 비반복 2건 합계 44,000원(09-02 20,000 + 09-05 24,000) → pace, projectedTotal 132,000, ratio 1.32. 2건 합계 43,334원 → pace(projectedTotal 130,002, ratio 1.3), 43,333원 → 항목 없음. 44,000원 데이터를 today=`2026-09-06`으로 조회 → 판정 안 함(경과일 6).
- [ ] C24. (v2.1 수정) R4 제외: 1개월만 기록 → 판정 안 함. baseline 9,999원 → 판정 안 함(exceeded·pace 모두). C23 데이터를 month=`2026-08`, today=`2026-09-10`으로 조회하면 pace 항목이 없다(과거 달).
- [ ] C25. R5: 비교군 5건 중앙값 10,000원일 때 30,001원 표시, 30,000원 미표시. 비교군 4건 미표시.
- [ ] C26. (v2 수정) B10 시드로 만든 사용자로 로그인 후, 시드에 쓴 today로 `/api/insights`와 `/api/recommendations/quick` 호출 시 recurring, overspending, largeExpenses, quick이 각각 1건 이상이고, 시드 today 기준 최근 6개월 `/api/stats/monthly`의 모든 달 expenseTotal > 0.
- [ ] C35. today 생략 시 기본값이 Asia/Seoul 날짜다: 단위 테스트에서 현재 시각을 UTC 2026-10-18T16:00Z(=KST 10-19 01:00)로 고정하면 today가 `2026-10-19`.
- [ ] C68. (v2.1 신규) R4 pace 반복 제외: 사례 1, 2, 11 → overspending에 해당 카테고리 항목이 없고, 같은 응답의 `recurring`에 "월세"(monthly) / "필라테스"(weekly)가 있다. (모두 v2 규칙이었다면 사례 1·11은 pace가 나오는 데이터)
- [ ] C69. (v2.1 신규) R4 pace 2건 기준: 사례 4 → 항목 없음. 사례 5 → `pace`, currentTotal 95,000, projectedTotal 285,000, ratio 2.85. C23 데이터 대신 09-05 비반복 44,000원 1건만 → 항목 없음.
- [ ] C70. (v2.1 신규) R4 pace R3 경계: 사례 6 → 항목 없음, `recurring`에 "유튜브 프리미엄" 없음. 사례 7 → `pace`, projectedTotal 89,700, ratio 2.99. 사례 8 → 항목 없음. 사례 9 → `pace`, currentTotal 30,000, projectedTotal 39,000, ratio 1.3. 사례 9에서 "책" 6,999원 → 항목 없음.
- [ ] C71. (v2.1 신규) R4 pace 그룹 키 연결: (a) 사례 9에서 09-05 넷플릭스 메모를 `" 넷플릭스  "`(앞뒤·연속 공백)로 기록해도 결과가 사례 9와 같다(pace, projectedTotal 39,000). (b) 메모 없는 반복: 주거/통신 메모 없음 55,000원을 06-02, 07-02, 08-02, 09-02에 기록하고 09-04 메모 없음 3,000원, 09-08 메모 없음 4,000원 추가 → `recurring`에 주거/통신 55,000원 monthly가 있고 overspending은 항목 없음(제외하지 않았다면 예상 186,000으로 pace가 나오는 데이터).

### 9.4 인증/보안
- [ ] C36. 가입 성공 → 201 `{user:{id,email}}`, Set-Cookie `mb_sid`에 `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=2592000`(로컬은 Secure 없음 허용, 프로덕션은 P3). 응답에 비밀번호/해시 없음.
- [ ] C37. 가입 검증: 잘못된 이메일(`a@b`, `ab.com`, 공백 포함), 비밀번호 7자·129자 → 400. 8자·128자 → 201. `A@Ex.com` 가입 후 `a@ex.com` 가입 → 409 `EMAIL_TAKEN`. `SIGNUP_ENABLED=false`면 403.
- [ ] C38. DB의 password_hash가 `scrypt$`로 시작하고 원문 비밀번호를 포함하지 않으며, 같은 비밀번호의 두 사용자 해시가 서로 다르다. sessions 테이블에 쿠키 원문 토큰 값이 없다.
- [ ] C39. 로그인: 정상 200 + 쿠키. 틀린 비밀번호와 없는 이메일 모두 401, 같은 code·message. 이메일 대소문자 무시.
- [ ] C40. 같은 이메일 로그인 실패 5회 후 6번째는 올바른 비밀번호여도 429 + `Retry-After`. 실패 기록 시각을 16분 전으로 조정하면 다시 로그인 가능. 실패 3회 후 성공하면 실패 카운트가 초기화된다.
- [ ] C41. (`TRUST_PROXY=true`) 같은 IP에서 서로 다른 이메일로 실패 20회 후 21번째 → 429. 다른 IP는 영향 없음. 같은 IP 가입 11번째 → 429.
- [ ] C42. 로그아웃 → 204 + `Max-Age=0` 쿠키, 이전 쿠키 값을 재사용하면 `/api/auth/me` 401.
- [ ] C43. 쿠키 없이, 임의 문자열 쿠키로, 만료된 세션(expires_at을 과거로 조정)으로 다음을 호출하면 모두 401 `UNAUTHENTICATED`: `/api/auth/me`, `/api/categories`, transactions GET/POST/PUT/DELETE, summary, stats 3종, recommendations 2종, insights. `/api/health`는 200.
- [ ] C44. CSRF: 유효 쿠키로 POST `/api/transactions` 시 Origin 없음 → 403, `Origin: https://evil.example` → 403, 올바른 Origin + `Content-Type: text/plain` → 415, `application/x-www-form-urlencoded` → 415. 로그인/가입/PUT/DELETE도 Origin 없으면 403.
- [ ] C45. 본문 16KB 초과 → 413.
- [ ] C46. 보안 헤더: `/`, `/login.html`, `/api/health` 응답에 4.4의 CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy`가 있고, API 응답에 `Cache-Control: no-store`.
- [ ] C47. 메모 `' OR 1=1 --`와 `<img src=x onerror=alert(1)>`가 그대로 저장/조회되고, autocomplete `q='`에 500이 나지 않는다.
- [ ] C48. 서버 내부 오류를 유발해도(예: 테스트용 DB 연결 끊김) 응답이 500 `INTERNAL_ERROR`이며 스택/SQL 문구가 없다. (재현 방법은 backend가 api.md 또는 README에 안내)

### 9.5 사용자 데이터 격리
- [ ] C49. 사용자 A의 거래를 사용자 B가 목록에서 볼 수 없고, B가 A의 거래 id로 PUT/DELETE하면 404이며 A의 거래는 변경되지 않는다(A로 재조회해 확인).
- [ ] C50. B가 POST 본문에 `userId`/`user_id`로 A의 id를 넣어도 거래는 B 소유로 저장되고 A 목록에 나타나지 않는다.
- [ ] C51. A에게만 시드 데이터가 있을 때 B의 summary·stats 3종은 0/빈 배열, quick·autocomplete·insights는 모두 빈 결과다.

### 9.6 대시보드 API
- [ ] C52. `/api/stats/monthly?from=2026-05&to=2026-10` → months 6개, 오래된 순, 거래 없는 달 0, balance = income - expense, 수동 계산 일치.
- [ ] C53. `/api/stats/categories?from=2026-10&to=2026-10` → items total 합 = grandTotal, total 내림차순(동률은 고정 순서), ratio 소수 넷째 자리 반올림 일치, total 0 카테고리 없음. 데이터 없으면 `grandTotal:0, items:[]`. `type=income`도 동작.
- [ ] C54. `/api/stats/category-monthly` → 모든 series의 totals 길이 = months 길이, 각 sum = totals 합, 월별 전체 합 = stats/monthly의 해당 type 합계.
- [ ] C55. 검증: from > to, 기간 25개월, `2026-13`, `2026-1`, from/to 누락, `type=foo` → 400. 기간 24개월은 200.
- [ ] C56. 월 경계: `2026-09-30`과 `2026-10-01` 거래가 각각 9월/10월에 집계된다(날짜 밀림 없음). 거래 목록 응답의 date도 입력값과 동일.

### 9.7 프론트엔드 (Playwright, 360px·768px 뷰포트)
- [ ] C27. HTML 정적 확인: 금액 입력 `inputmode="numeric"`, 모든 input에 연결된 label(또는 aria-label), 카테고리 선택에 `<select>` 없음.
- [ ] C28. F2 유틸 테스트: `"12,500"` → 12500, `"abc"`/`""`/`"0"` 무효, 12500 → `"12,500원"`. 차트 기하 함수: 합계 0 입력 시 NaN 없이 빈 결과.
- [ ] C29. 로그인 후 금액칸 포커스, 금액 → 카테고리 칩 → Enter로 저장되고 목록·요약이 새로고침 없이 갱신.
- [ ] C30. R1 칩 클릭 → 저장 클릭 2번으로 기록.
- [ ] C31. 메모 입력 시 자동완성 표시, 선택하면 카테고리·금액 채워짐.
- [ ] C32. (v2 수정) 360px에서 login, 기록 탭, 대시보드 탭(12개월 선택 포함) 모두 `document.documentElement.scrollWidth <= 360`, 주요 버튼 44×44px 이상.
- [ ] C33. 서버 400 시 오류 문구 표시 + 입력값 유지. 서버 중지 상태에서 저장 시 오류 문구, 화면 멈춤 없음.
- [ ] C34. 인사이트 영역 R3/R4/R5 표시, 없으면 빈 상태 문구.
- [ ] C57. 로그인하지 않고 `/` 접속 → `/login.html`로 이동. 로그인 상태로 `/login.html` 접속 → `/`.
- [ ] C58. 가입 화면에서 가입 → 앱 진입. 중복 이메일, 짧은 비밀번호, 429 상황에서 각각 안내 문구가 보이고 입력한 이메일이 유지된다.
- [ ] C59. 로그아웃 → 로그인 화면. 이후 뒤로가기로 앱 화면에 가도 데이터가 보이지 않고 로그인 화면으로 이동.
- [ ] C60. 사용 중 세션을 DB에서 삭제한 뒤 저장을 누르면 만료 안내와 함께 로그인 화면으로 이동.
- [ ] C61. 메모 `<img src=x onerror=alert(1)>` 거래가 목록/인사이트/자동완성에서 글자 그대로 보이고 대화상자(dialog 이벤트)가 발생하지 않는다.
- [ ] C62. 시드 사용자로 대시보드: KPI 수입/지출/잔액, 도넛 범례 금액·비율, 추이 표, 카테고리 추이 표의 숫자가 해당 stats API 응답과 일치. 비율 표시는 소수 첫째 자리 %.
- [ ] C63. 대시보드 접근성: 차트마다 `<figure>`, SVG `role="img"`와 접근 가능한 이름이 있고, 대응하는 `<table>`(caption, `th[scope]`)이 DOM에 있다. 범례에 "수입"/"지출" 텍스트, 도넛 범례 항목마다 카테고리명·금액·% 텍스트가 있고 범례 순서가 금액 내림차순. 수입/지출 막대의 fill이 서로 다른 패턴/색이다(하나는 `url(#...)` 패턴).
- [ ] C64. 360px에서 대시보드 축/범례 텍스트의 렌더링 높이(`getBoundingClientRect().height`)가 11px 이상.
- [ ] C65. 기준 월 이동, 6/12개월 전환, 카테고리 칩 선택 시 새로고침 없이 차트와 표가 갱신된다(12개월 선택 시 추이 표 12행).
- [ ] C66. 신규 사용자 대시보드: 차트 대신 빈 상태 문구, 페이지 텍스트에 `NaN`/`undefined`/`Infinity` 없음. 전월 지출 0이면 "비교할 지난달 기록이 없어요".
- [ ] C67. 기록 탭에서 거래 추가 후 대시보드 탭으로 전환하면 KPI 지출이 그만큼 늘어 있다.

### 9.8 배포 환경 확인 (자동화 대상과 구분, Q3에서 수행)
P1~P7은 **프리뷰 배포**, P8~P9는 **프로덕션**. Playwright는 `BASE_URL=<배포 URL>`로 일부 재사용 가능. 테스트 계정은 `qa+<날짜>@example.com` 형식으로 만들고 결과에 남긴다.
- [ ] P1. 배포 URL이 HTTPS로 응답하고 http 요청은 https로 이동한다. `/api/health` → `{status:"ok", db:"ok"}`.
- [ ] P2. 저장소: `git ls-files`에 `.env`, `.env.local` 등 비밀 파일이 없고 `.env.example`만 있다. 커밋된 파일 전체에서 `postgres://`, `postgresql://`, `npg_` 문자열 검색 0건.
- [ ] P3. 프로덕션/프리뷰 Set-Cookie에 `Secure; HttpOnly; SameSite=Lax`가 모두 있다.
- [ ] P4. 가입 → 로그인 → 거래 추가/수정/삭제 → 대시보드 표시가 배포 환경에서 동작한다(Playwright C29, C62 재사용 가능).
- [ ] P5. 두 테스트 계정으로 C49 격리 시나리오가 배포 환경에서도 통과한다.
- [ ] P6. 재배포(새 커밋 푸시 또는 Redeploy) 후에도 기존 거래가 남아 있다.
- [ ] P7. 보안 헤더(C46)가 배포 응답에 있고, 다른 Origin에서의 POST가 403(C44 축약 재현).
- [ ] P8. 프로덕션 URL에서 P1, P3, P4 스모크 통과. 실제 휴대폰(또는 360px 에뮬레이션)에서 로그인·기록·대시보드 확인(수동 가능, 스크린샷 첨부).
- [ ] P9. Vercel 프로젝트 환경변수가 Production/Preview에 설정되어 있고(이름만 확인, 값은 리포트에 적지 않음) 함수 지역이 `sin1`이다.

### 9.9 프로세스 확인
- [ ] X1. CP1(푸시), CP2(Vercel/Neon 연결·마이그레이션), CP3(프로덕션 배포) 각각 사용자 승인 후 수행되었고 승인 시점이 메인 세션 보고에 남아 있다.

---

## 10. 가정 (사용자 확인 불필요, 바뀌면 알려 주세요)
- 사용 규모: 개인/소수 사용자, 사용자당 수천 건 이하. Vercel Hobby·Neon 무료 플랜으로 충분(Hobby는 비상업 용도)
- 도메인: `*.vercel.app` 기본 도메인
- 프로덕션 브랜치: `main`, 그 외 브랜치/커밋은 프리뷰
- 세션 30일 고정 만료(연장 없음), 여러 기기 동시 로그인 허용
- 가입 시 이메일 소유 확인 없음(인증 메일 미발송)

## 11. 리스크
| 리스크 | 대응 |
|---|---|
| Neon 유휴 후 첫 요청 지연 | 허용. 프론트는 로딩 표시. 필요 시 이후 검토 |
| PGlite와 Neon의 미세한 동작 차이 | 표준 SQL만 사용, D3 프리뷰에서 P4·P5로 재확인 |
| outputDirectory/함수 라우팅/본문 파싱이 로컬 개발 서버와 Vercel에서 다르게 동작 | B2에서 `vercel dev` 가능 시 확인, 최종은 D3 프리뷰. 대체안 4.7 |
| 가입 개방 시 스팸 가입 | IP 가입 제한 + `SIGNUP_ENABLED=false` 스위치 |
| 비밀번호 분실 시 복구 수단 없음 | 12장 OQ3 |

---

## 12. 열린 질문 (사용자 결정 필요)

| ID | 질문 | 결정 전 기본값 |
|---|---|---|
| OQ1 | **가입 개방 정책**: 누구나 가입 가능하게 둘지, 본인/가족 등 지정한 사람만 쓰게 할지(가입 닫기 또는 허용 이메일 목록)? | 개방 + `SIGNUP_ENABLED` 스위치로 닫기 가능. 허용 목록이 필요하면 `SIGNUP_ALLOWED_EMAILS` 환경변수 추가(작업 소폭 증가) |
| OQ2 | **GitHub 저장소에 올릴 범위와 공개 여부**: 저장소가 공개인가? `.claude/`, `CLAUDE.md`, `docs/`, 무관한 `src/frontend/office/`를 포함할까? | 앱 코드 + `docs/` + README 포함, `.claude/`·`CLAUDE.md` 포함, `src/frontend/office/`는 .gitignore로 제외. CP1에서 파일 목록을 다시 보여 드림 |
| OQ3 | **계정 관리 범위**: 비밀번호 재설정(이메일 발송 필요)·변경·회원 탈퇴가 없으면 비밀번호 분실 시 운영자가 DB에서 직접 처리해야 한다. 이대로 괜찮은가? | v2 제외. 필요하면 "로그인 상태에서 비밀번호 변경 + 탈퇴(데이터 삭제)"를 추가하는 것이 이메일 발송 없이 가능한 최소안 |
| OQ4 | **Vercel/Neon 작업 수행 주체**: CP2의 Vercel Import·Neon 추가를 사용자가 대시보드에서 직접 할지, Vercel CLI 로그인 후 메인 세션이 진행할지? | 사용자가 대시보드에서 직접 수행, README와 메인 세션이 단계별로 안내 |
