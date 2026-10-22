# API 계약 (v4.1)

작성: backend / 기준: `docs/plan.md` v2.1 + `docs/plan-categories.md` + `docs/plan-theme-name.md` / 변경 시 backend가 수정 후 메인 세션에 알린다. frontend는 계약을 임의로 바꾸지 않는다.

## 0B. v4.1 변경 요약 (후속 1단계, 응답 형식·스키마 변경 없음)

| 구분 | 변경 | 호환 |
|---|---|---|
| 동작 변경 | 사용자 이름·카테고리 이름 공통 검증 강화: 방향 제어 문자 거부, 폭 없는 문자 제거 (2장, 3A.1) | 응답 형식 동일. 해당 문자를 보내던 입력만 400 또는 정리됨 |
| 동작 변경 | 카테고리를 **새로** 추가하거나 이름을 **바꿀** 때 정규화된 이름이 `그 외 N개`(N=ASCII 숫자) 모양이면 400 (3A.1, 3A.3, 3A.4) | 이미 저장된 이름은 그대로 유지 |
| 불변 | DB 스키마(CHECK 포함), 마이그레이션, 응답 객체, 에러 코드 | - |
| 배포 | `/fonts/*` 에 `Cache-Control: public, max-age=31536000, immutable` (`vercel.json`). HTML(`/`, `/index.html`)은 no-store 유지 | - |

## 0A. v4 변경 요약 (v3 대비): 사용자 이름

| 구분 | 변경 | v3 클라이언트 호환 |
|---|---|---|
| **비호환** | 사용자 객체가 `{ id, email, name }` 이 됨. `name` 은 문자열 또는 `null` (2장) | `body.user` 를 `{id, email}` 와 정확 비교하면 깨짐 |
| **비호환** | `POST /api/auth/signup` 에 `name` **필수**. 없으면 400 `fields.name` (2.1) | name 없이 가입하면 400 |
| 추가 | `PATCH /api/auth/me` (2.5): 이름 설정·수정 | 호환 (신규) |
| 추가 | `users.name` 컬럼 (nullable, 추가 전용, 8.5) | 구버전 코드와 호환 |
| 불변 | 로그인 요청 형식(이메일+비밀번호), 로그아웃, 쿠키, 에러 코드, CSRF 규칙 | - |

운영 반영 순서는 8.5 참고: 컬럼 없는 DB 에 새 코드가 배포되면 로그인·me·가입이 500 이므로 마이그레이션이 먼저다.

## 0. v3 변경 요약 (v2 대비)

v3은 사용자별 카테고리 관리(추가, 이름 변경, 사용 안 함/다시 사용)를 추가한다. 이 문서의 카테고리 관련 서술이 plan.md와 다르면 이 문서가 우선한다.

| 구분 | 변경 | v2 클라이언트 호환 |
|---|---|---|
| 추가 | `GET /api/categories` 응답에 `items` 추가 (3A.2) | 호환 (`expense`/`income` 배열은 그대로) |
| 추가 | `POST /api/categories`, `PATCH /api/categories/:id` (3A.3, 3A.4), `DELETE`는 405 (3A.5) | 호환 (신규) |
| 추가 | 에러 코드 `CATEGORY_EXISTS`, `CATEGORY_INACTIVE`, `CATEGORY_LIMIT`, `CATEGORY_LAST_ACTIVE` (1.1) | 호환 (신규 코드) |
| 추가 | 상태 변경 메서드에 `PATCH` 포함 (1.2) | 호환 |
| **비호환** | 거래 `category` 검증 기준이 "고정 목록"에서 "세션 사용자의 **활성** 카테고리"로 바뀜. 사용 안 함 카테고리를 신규 선택(POST, 또는 PUT으로 변경)하면 400 (4) | 하드코딩 목록을 쓰는 클라이언트는 사용 안 함/사용자 추가 카테고리에서 어긋남 |
| **비호환** | `GET /api/recommendations/autocomplete` 항목의 `category`가 **`null`** 일 수 있음 (6.2) | `category`를 항상 문자열로 가정하면 깨짐 |
| 동작 변경 | `GET /api/recommendations/quick`은 사용 안 함 카테고리 그룹을 제외 (6.1) | 응답 형식 동일, 항목 수 감소 가능 |
| 동작 변경 | 이름 변경 시 과거 거래의 `category` 문자열이 일괄 바뀜 (3A.4). 같은 거래를 이전에 조회한 클라이언트의 캐시는 낡음 | 클라이언트가 재조회해야 함 |
| 동작 변경 | stats/summary/R4의 "고정 순서" 동률 기준이 사용자 카테고리 `sortOrder`로 바뀜 (5, 6.3). 기본 세트 사용자는 결과 동일 | 호환 |
| 불변 | 거래 객체, 집계/인사이트 응답 형식, 인증, 쿠키, 보안 헤더, 사용 안 함 카테고리의 과거 거래 조회·집계·R3/R4/R5 포함 | - |

## 1. 공통 규약

- 모든 경로는 `/api` 아래, 같은 출처(same-origin)에서만 호출한다. 요청/응답은 JSON(UTF-8).
- 응답 헤더(모든 API): `Content-Type: application/json; charset=utf-8` (204 제외), `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Content-Security-Policy: default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`.
- 금액은 원 단위 정수. 날짜는 `YYYY-MM-DD`, 월은 `YYYY-MM` 문자열.
- 알 수 없는 경로는 404 `NOT_FOUND`, 허용되지 않은 메서드는 405 `METHOD_NOT_ALLOWED` (`Allow` 헤더 포함).

### 1.1 에러 형식

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "금액은 1 이상 100000000 이하의 정수여야 합니다." } }
```

`message`는 사람이 읽을 수 있는 한국어 문장이며 비밀 값/스택/SQL을 포함하지 않는다. 프론트는 `code`로 분기한다. 필드별 검증 실패 시 `error.fields`(선택)에 `{ "필드명": "사유" }` 객체가 함께 올 수 있다. `CATEGORY_INACTIVE`에서만 `error.categoryId`(문자열 uuid)가 추가로 온다.

| 상태 | code | 상황 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | 입력 검증 실패 (`error.fields` 포함 가능) |
| 400 | `INVALID_JSON` | 본문이 올바른 JSON 객체가 아님 |
| 401 | `UNAUTHENTICATED` | 세션 없음/만료/위조 |
| 401 | `INVALID_CREDENTIALS` | 로그인 실패 (틀린 비밀번호와 없는 이메일 동일 응답) |
| 403 | `CSRF_REJECTED` | Origin 누락/불일치 |
| 403 | `SIGNUP_DISABLED` | `SIGNUP_ENABLED=false` |
| 404 | `NOT_FOUND` | 없는 경로/리소스, 다른 사용자의 리소스, UUID 아닌 id |
| 405 | `METHOD_NOT_ALLOWED` | 해당 경로에서 허용되지 않는 메서드 |
| 409 | `EMAIL_TAKEN` | 이미 가입된 이메일 |
| 409 | `CATEGORY_EXISTS` | 같은 유형에 같은 이름(정규화 키 기준)의 다른 카테고리가 있음 (3A.3, 3A.4) |
| 409 | `CATEGORY_INACTIVE` | 추가하려는 이름이 같은 유형의 **사용 안 함** 카테고리와 같음. `error.categoryId` 포함 (3A.3) |
| 409 | `CATEGORY_LIMIT` | 유형별 활성 30개 또는 사용자 전체 120개 초과 (3A.3, 3A.4) |
| 409 | `CATEGORY_LAST_ACTIVE` | 그 유형의 마지막 활성 카테고리를 사용 안 함으로 바꾸려 함 (3A.4) |
| 413 | `PAYLOAD_TOO_LARGE` | 본문 16KB(16384바이트) 초과 |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | 본문이 있는 요청의 Content-Type이 `application/json`이 아님 |
| 429 | `TOO_MANY_ATTEMPTS` | 로그인/가입 시도 제한. `Retry-After`(초) 헤더 포함 |
| 500 | `INTERNAL_ERROR` | 그 외. 메시지는 "서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요." 고정 |

검사 순서(먼저 걸리는 것이 응답): 경로/메서드(404/405) -> CSRF Origin(403) -> Content-Type(415) -> 본문 크기(413) -> JSON 파싱(400) -> 인증(401) -> 입력 검증(400) -> 비즈니스(404/409/429).

### 1.2 CSRF 규칙

1. 쿠키는 `SameSite=Lax`.
2. **상태 변경 요청(POST/PUT/PATCH/DELETE)** 은 `Origin` 헤더가 **반드시 있어야** 한다 (로그인/가입/로그아웃 포함, 세션 유무 무관). Origin의 host(포트 포함)가 요청 호스트(`x-forwarded-host` 우선, 없으면 `Host`)와 같거나, 환경변수 `APP_ORIGINS`(쉼표 구분 전체 Origin 목록)에 있어야 한다. 아니면 403 `CSRF_REJECTED`. 브라우저의 same-origin `fetch`는 POST/PUT/PATCH/DELETE에 Origin을 자동으로 붙인다. GET은 검사하지 않는다.
3. 본문이 있는 요청(Content-Length > 0 또는 Transfer-Encoding)은 `Content-Type: application/json`(charset 파라미터 허용)만 허용, 아니면 415. 본문 없는 POST(예: logout)는 Content-Type 불필요.

프론트 `fetch`는 `credentials: "same-origin"`(기본값)과 본문이 있을 때 `Content-Type: application/json`을 사용한다.

### 1.3 세션 쿠키

| 속성 | 값 |
|---|---|
| 이름 | `mb_sid` |
| 값 | 32바이트 난수(base64url). 서버 DB에는 SHA-256 해시만 저장 |
| 속성 | `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` (30일 고정 만료, 연장 없음), Domain 미지정 |
| Secure | 기본 켜짐. 로컬 http에서만 `COOKIE_SECURE=false` |
| 제거 | `mb_sid=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax` (+Secure 설정 따름) |

예: `Set-Cookie: mb_sid=Zk3...; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax`

### 1.4 로그인/가입 시도 제한

`auth_attempts` 테이블 기반(서버리스에서 메모리 카운터 사용 안 함). 윈도우는 "현재 시각 - 기간 이후".

| 대상 | 한도 | 효과 |
|---|---|---|
| 같은 이메일 로그인 **실패** | 5회 / 15분 | 한도 도달 후 15분 창 안의 로그인 시도는 비밀번호가 맞아도 429 |
| 같은 IP 로그인 **실패** | 20회 / 15분 | 429 |
| 같은 IP 가입 **시도**(성공/실패 모두) | 10회 / 1시간 | 11번째부터 429 |

- 이메일 로그인 성공 시 그 이메일의 실패 기록은 초기화된다.
- 429는 `Retry-After: <초>` 헤더(가장 오래된 한도 내 기록이 창을 벗어나기까지 남은 초, 최소 1)를 포함한다.
- 429 판정은 비밀번호 검증 전에 수행한다. 한도 초과 중인 시도는 새 실패 기록으로 쌓지 않는다.
- 클라이언트 IP: Vercel에서는 `x-forwarded-for` 첫 값. 로컬 개발 서버는 소켓 주소, `TRUST_PROXY=true`일 때만 `x-forwarded-for` 첫 값을 신뢰.
- 이메일이 형식 오류인 요청(400)은 시도 기록에 포함하지 않는다.
- 비밀번호 검증 중인 요청도 잠시 실패로 집계된다(검증 결과가 나오면 성공 시 초기화). 따라서 실패가 한도 직전일 때 같은 계정으로 동시에 로그인을 여러 번 보내면 일부 요청(올바른 비밀번호 포함)이 429가 될 수 있다.
- 429 요청은 시도 기록을 남기지 않으므로 잠금 시간을 연장하지 않는다(잠금은 한도 내 가장 오래된 기록 기준으로 풀린다).

### 1.5 인증 필요 여부

`/api/health`, `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout` 외 모든 API는 유효한 세션 쿠키가 필요하다(없거나 무효하면 401 `UNAUTHENTICATED`). 사용자 데이터는 항상 세션 사용자의 것만 읽고 쓴다.

## 2. 인증

사용자 객체 (v4): `{ "id": "uuid", "email": "a@ex.com", "name": "홍길동" }`. `name` 은 문자열 또는 `null`(이름을 아직 넣지 않은 기존 사용자). signup/login/me/PATCH me 모두 같은 모양이다. 비밀번호/해시는 어떤 응답에도 없다.

이름 규칙 (signup·PATCH me 공통, 서버가 기준):
1. 문자열이 아니면 "이름을 입력해 주세요."
2. 제어문자 `[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]` 가 있으면 "이름에 쓸 수 없는 문자가 있어요." (탭·줄바꿈은 공백 취급이라 제외)
3. 방향 제어 문자가 있으면 같은 메시지로 거부: U+200E, U+200F, U+202A-U+202E, U+2066-U+2069 (v4.1).
4. 정규화: 폭 없는 문자 U+200B, U+2060, U+FEFF 제거 -> NFC -> 앞뒤 공백 제거 -> 연속 공백(탭·줄바꿈 포함) 1칸. **정규화된 값을 저장·응답**한다. U+200C/U+200D(ZWNJ/ZWJ)는 이모지 조합(예: 👨‍👩‍👧)에 쓰이므로 그대로 둔다. 정규화 후 비면 5번의 길이 오류.
5. 정규화 후 코드포인트(`[...s].length`) 1~20자. 아니면 "이름은 1자 이상 20자 이하여야 해요."
6. 중복 허용, 대소문자 그대로. (v4 에서 보류했던 보이지 않는 문자 처리는 v4.1 에서 3~4번으로 해결)

### 2.1 POST /api/auth/signup

요청 (Origin 필수):
```json
{ "email": "User@Example.com", "password": "correct horse", "name": "  홍   길동 " }
```
- email: 앞뒤 공백 제거 + 소문자화 후 1~254자, 공백 없음, `@` 정확히 1개, 로컬/도메인 비어있지 않음, 도메인에 `.` 포함하며 `.`로 시작/끝나지 않음
- password: 문자열 8~128자 (조합 규칙 없음, 공백 그대로)
- name: **필수**. 위 이름 규칙

201 + `Set-Cookie`(자동 로그인):
```json
{ "user": { "id": "5b1c6f0e-5b0a-4c36-8d0f-0c3b8f6a1e11", "email": "user@example.com", "name": "홍 길동" } }
```
오류: 400 `VALIDATION_ERROR`(`fields.email` / `fields.password` / `fields.name`, 여러 개면 모두 `fields` 에 담긴다. `message` 는 이메일, 비밀번호, 이름 순으로 첫 항목), 403 `CSRF_REJECTED` / `SIGNUP_DISABLED`, 409 `EMAIL_TAKEN`, 429 `TOO_MANY_ATTEMPTS`.

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "이름은 1자 이상 20자 이하여야 해요.", "fields": { "name": "이름은 1자 이상 20자 이하여야 해요." } } }
```
형식 오류(400)는 이메일 형식 오류와 마찬가지로 가입 시도 기록에 남지 않는다. 이름은 시도 기록·로그에 저장하지 않는다.

### 2.2 POST /api/auth/login

요청 (Origin 필수): `{ "email": "user@example.com", "password": "correct horse" }` (이메일 대소문자/앞뒤 공백 무시)

200 + `Set-Cookie`: `{ "user": { "id": "...", "email": "user@example.com", "name": "홍 길동" } }` (이름이 없는 기존 사용자는 `"name": null`). 로그인은 이메일로만 한다.

오류:
- 400 `VALIDATION_ERROR` (email/password가 문자열이 아니거나 비어 있음)
- 401 `INVALID_CREDENTIALS` `"이메일 또는 비밀번호가 맞지 않아요."` (틀린 비밀번호/없는 이메일 동일, 응답 시간도 비슷하게 유지)
- 429 `TOO_MANY_ATTEMPTS` + `Retry-After`

### 2.3 POST /api/auth/logout

Origin 필수. 본문 없음. 세션이 없어도 **204**. DB 세션을 삭제하고 `Max-Age=0` 쿠키를 보낸다. 이후 같은 토큰은 401.

### 2.4 GET /api/auth/me

200 `{ "user": { "id": "...", "email": "...", "name": "홍 길동" | null } }` / 401 `UNAUTHENTICATED`. GET, PATCH(2.5) 외 메서드는 405 (`Allow: GET, PATCH`).

### 2.5 PATCH /api/auth/me (v4 신규)

이름 설정·수정. 인증 필요, Origin 필수(1.2), `Content-Type: application/json`.

요청: `{ "name": "  홍   길동 " }` (이름 규칙은 2장 서두)
- `name` 이 없거나 `null`/빈 문자열/공백뿐이면 400 (이름 비우기 불가).
- `email` 등 다른 필드는 무시하며 바꾸지 않는다(오류 아님, 3A.4 관례).

200 `{ "user": { "id": "...", "email": "user@example.com", "name": "홍 길동" } }` (정규화된 값)

오류: 400 `VALIDATION_ERROR`(`fields.name`), 401 `UNAUTHENTICATED`, 403 `CSRF_REJECTED`, 415 / 413 / 400 `INVALID_JSON`(1.1 공통). 세션 사용자의 행만 갱신하며 다른 사용자에게는 영향이 없다.

## 3. 기본

### 3.1 GET /api/health (인증 불필요)
```json
{ "status": "ok", "db": "ok" }
```
DB 연결 실패 시 **200** `{ "status": "ok", "db": "error" }` (프로세스는 살아있음을 의미; 세부 오류 미노출).

## 3A. 카테고리 (v3)

거래는 카테고리를 **이름 문자열**로 저장한다(ID 참조 아님). `categories` 테이블은 "사용자가 고를 수 있는 목록과 상태"만 관리한다. 모든 카테고리 API는 세션 필수(없으면 401)이고, 세션 사용자의 카테고리만 읽고 쓴다.

### 3A.1 카테고리 객체

```json
{ "id": "0b9e6c3a-6a0e-4d0f-9c55-3d6f1a2b7e10", "type": "expense", "name": "식비", "active": true, "sortOrder": 0, "usedCount": 21 }
```

| 필드 | 설명 |
|---|---|
| id | uuid |
| type | `expense` \| `income`. 생성 후 변경 불가 |
| name | 정규화된 표시 이름 (아래 이름 규칙) |
| active | `true` 새 거래에서 선택 가능 / `false` 사용 안 함 |
| sortOrder | 유형별 정렬 순서(0부터, 정수, 오름차순). 유형 안에서 유일하다는 보장은 없다(동률이면 `name` 가나다순). 새 카테고리는 그 유형의 `max(sortOrder)+1`(비활성 포함), 다시 사용해도 값 유지 |
| usedCount | 세션 사용자의 같은 유형·같은 이름 거래 건수(전 기간, 비활성 카테고리 포함). 기본 0 |

**이름 규칙** (POST의 `name`, PATCH의 `name` 공통)
1. 문자열이어야 한다(아니면 400).
2. 정규화(사용자 이름과 같은 공통 규칙, v4.1): 방향 제어 문자(U+200E/F, U+202A-E, U+2066-9)가 있으면 400 -> 폭 없는 문자(U+200B, U+2060, U+FEFF) 제거 -> NFC -> 앞뒤 공백 제거 -> 연속 공백(탭·줄바꿈 포함) 1칸. ZWNJ/ZWJ(U+200C/D)는 유지. 저장·응답은 정규화된 값이고 중복 판정 키도 제거 후 값 기준이다.
3. 정규화 후 길이 1~15 코드포인트(폭 없는 문자만으로 된 이름은 비어서 길이 오류). 제어문자(U+0000~U+001F, U+007F)가 있으면 400. `/`, `<`, 이모지 등 그 밖의 문자는 허용한다. 서버는 이스케이프하지 않고 그대로 돌려주므로 **프론트는 `textContent`로만 출력한다**.
4. 중복 판정 키 = 정규화된 이름의 소문자화. 같은 사용자 + 같은 유형 안에서 활성·비활성 구분 없이 키가 같으면 중복(`netflix` = `Netflix` = ` NETFLIX `). 다른 유형의 같은 이름은 허용(예: 지출 "기타"와 수입 "기타").

**금지 이름 (v4.1)**: 정규화된 이름이 정규식 `^그 외 \d+개$`(`\d` 는 ASCII 숫자)와 맞으면 도넛 차트 묶음 라벨과 구분이 안 되므로 400 `VALIDATION_ERROR`, `fields.name` = `'그 외 N개'는 차트 묶음 이름이라 쓸 수 없어요.` 예: `그 외 2개`, ` 그 외  12개 `. 허용: `그 외`, `그 외 것`, `그외 2개`. 대상은 POST 와 PATCH 로 이름을 **바꾸는** 경우뿐이며, 이미 그 이름인 카테고리에 같은 이름을 다시 보내는 PATCH(예: 이름 그대로 `active` 변경)는 막지 않는다. 기존 데이터는 바꾸지 않는다. PATCH 에서는 대상 조회(404) 후에 이 검사가 일어난다.

**한도** (서버 코드 상수, 설정 UI 없음)

| 항목 | 값 |
|---|---|
| 유형별 활성 카테고리 | 최대 30 |
| 사용자 전체 카테고리(비활성 포함) | 최대 120 |
| 이름 길이 | 1~15 코드포인트 |
| 유형별 활성 카테고리 하한 | 최소 1 (마지막 하나는 사용 안 함 불가) |

**기본 세트**: 가입 시(같은 트랜잭션) 아래 12개가 사용자 행으로 복사된다. 기본 카테고리도 이름 변경·사용 안 함이 가능하다("기타" 포함).
- 지출(sortOrder 0~7): 식비, 카페/간식, 교통, 쇼핑, 주거/통신, 의료/건강, 문화/여가, 기타
- 수입(sortOrder 0~3): 급여, 용돈, 부수입, 기타

**지연 생성**: 카테고리 행이 0개인 사용자(예: 마이그레이션 후 구버전 코드로 가입)는 카테고리를 읽는 모든 경로(`GET /api/categories`, `POST /api/categories`, 거래 POST/PUT 검증, quick/autocomplete, 그리고 정렬 동률 기준을 읽는 `GET /api/summary`, `/api/stats/categories`, `/api/stats/category-monthly`, `/api/insights`)에서 기본 세트가 자동 생성된다. 즉 통계·인사이트 같은 조회 요청도 행이 없는 사용자에게는 쓰기(기본 12행 INSERT)를 일으킨다(응답 형식은 불변). 동시 요청이 와도 12행으로 수렴한다. 클라이언트가 신경 쓸 것은 없다.

### 3A.2 GET /api/categories

v2 형식을 유지하고 `items`를 추가한다.

```json
{
  "expense": ["식비", "카페/간식", "교통", "쇼핑", "주거/통신", "의료/건강", "문화/여가", "기타", "반려동물"],
  "income": ["급여", "용돈", "부수입", "기타"],
  "items": [
    { "id": "0b9e6c3a-6a0e-4d0f-9c55-3d6f1a2b7e10", "type": "expense", "name": "식비", "active": true, "sortOrder": 0, "usedCount": 21 },
    { "id": "7c1d2e4f-1b3a-4a55-8f20-9e6d5c4b3a21", "type": "expense", "name": "경조사", "active": false, "sortOrder": 8, "usedCount": 4 },
    { "id": "f2a4c6e8-0b1d-4c3e-a5f7-192837465abc", "type": "income", "name": "급여", "active": true, "sortOrder": 0, "usedCount": 6 }
  ]
}
```

- `expense`/`income`: **활성** 카테고리 이름만, `sortOrder` 오름차순(동률은 이름 가나다순). 기록 폼 칩은 이 배열을 쓴다.
- `items`: 활성+비활성 **전부**, 지출 먼저 그다음 수입, 각 유형 안에서 `sortOrder` 오름차순(동률은 이름 가나다순). 관리 화면은 이 배열을 쓴다.
- 오류: 401만 (입력 없음).

### 3A.3 POST /api/categories

Origin 필수. 요청:
```json
{ "type": "income", "name": "  이자 " }
```
**201** (카테고리 객체 자체, 래핑 없음):
```json
{ "id": "a1b2c3d4-0000-4000-8000-00000000abcd", "type": "income", "name": "이자", "active": true, "sortOrder": 4, "usedCount": 0 }
```
`usedCount`는 같은 이름의 과거 거래가 이미 있으면 0이 아닐 수 있다(예: 이름 변경으로 비워진 이름을 다시 만든 경우).

검사 순서: 입력 검증(400) -> 중복(409 EXISTS/INACTIVE) -> 한도(409 LIMIT).

| 상태 | code | 상황 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `type`이 expense/income 아님 -> `fields.type`; `name`이 문자열 아님·정규화 후 0자·16자 이상·제어문자 -> `fields.name` |
| 409 | `CATEGORY_EXISTS` | 같은 유형에 같은 키의 **활성** 카테고리가 있음 |
| 409 | `CATEGORY_INACTIVE` | 같은 유형에 같은 키의 **사용 안 함** 카테고리가 있음. 새로 만들지 않는다. `error.categoryId`로 복구 대상을 알려 준다 |
| 409 | `CATEGORY_LIMIT` | 그 유형의 활성이 이미 30개이거나 사용자 전체가 이미 120개 |

예 - 400:
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "카테고리 이름은 1자 이상 15자 이하여야 해요.", "fields": { "name": "카테고리 이름은 1자 이상 15자 이하여야 해요." } } }
```
예 - 409 EXISTS:
```json
{ "error": { "code": "CATEGORY_EXISTS", "message": "이미 같은 이름의 카테고리가 있어요." } }
```
예 - 409 INACTIVE (프론트는 "다시 사용할까요?"를 묻고 `PATCH /api/categories/{categoryId}` `{ "active": true }` 호출):
```json
{ "error": { "code": "CATEGORY_INACTIVE", "message": "같은 이름의 사용 안 함 카테고리가 있어요.", "categoryId": "7c1d2e4f-1b3a-4a55-8f20-9e6d5c4b3a21" } }
```
예 - 409 LIMIT:
```json
{ "error": { "code": "CATEGORY_LIMIT", "message": "지출 카테고리는 사용 중인 것이 30개까지예요." } }
```
(사용자 전체 120개 초과 메시지: "카테고리는 모두 합쳐 120개까지 만들 수 있어요.")

### 3A.4 PATCH /api/categories/:id

Origin 필수. 본문에 `name`, `active` 중 **1개 이상**. 둘 다 있으면 한 트랜잭션에서 이름 변경 후 상태 변경을 처리하고, 어느 한쪽이 실패하면 둘 다 반영되지 않는다. 본문의 `type`, `userId`, `id`, `sortOrder` 등 그 밖의 필드는 무시한다(유형·소유자 불변). 값이 `undefined`(키 없음)인 필드만 "없음"으로 본다(`null`이면 있는 것으로 보고 타입 검증에 걸려 400).

요청 예 (이름 변경):
```json
{ "name": "커피" }
```
요청 예 (사용 안 함): `{ "active": false }` / (다시 사용): `{ "active": true }` / (둘 다): `{ "name": "커피", "active": true }`

**200** 갱신된 카테고리 객체:
```json
{ "id": "...", "type": "expense", "name": "커피", "active": true, "sortOrder": 1, "usedCount": 5 }
```

검사 순서: 입력 검증(400) -> 대상 조회(404) -> 이름 중복(409 EXISTS) -> 마지막 활성(409 LAST_ACTIVE) -> 한도(409 LIMIT).

| 상태 | code | 상황 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `name`/`active` 둘 다 없음(`fields` 없이 message만: "name 또는 active 중 하나는 보내 주세요."); `name` 규칙 위반 -> `fields.name`; `active`가 boolean 아님 -> `fields.active` |
| 404 | `NOT_FOUND` | 없는 id, 다른 사용자의 id, UUID 형식이 아닌 id (message "카테고리를 찾을 수 없어요.") |
| 409 | `CATEGORY_EXISTS` | 새 이름의 키가 같은 유형의 **다른** 카테고리(활성·비활성 모두)와 같음. 병합은 지원하지 않는다 |
| 409 | `CATEGORY_LAST_ACTIVE` | 그 유형의 활성 카테고리가 이 하나뿐인데 `active:false`로 바꾸려 함. message "카테고리가 하나는 있어야 해요." |
| 409 | `CATEGORY_LIMIT` | `active:true`로 되돌리면 그 유형의 활성이 30개를 넘음 |

동작 규칙
- **이름 변경은 과거 거래를 함께 바꾼다.** 한 DB 트랜잭션에서 `categories.name`과, `user_id = 세션 사용자 AND type = 그 카테고리의 유형 AND category = 옛 이름`인 모든 거래의 `category`를 새 이름으로 UPDATE한다. 다른 사용자, 다른 유형(지출 "기타"를 바꿔도 수입 "기타"는 그대로)의 거래는 바뀌지 않는다. 응답 이후 어느 API에도 옛 이름은 나오지 않는다(거래 목록, summary, stats, 추천, 인사이트). 프론트는 변경 성공 후 거래/대시보드를 다시 조회해야 한다.
- 자기 자신과 키가 같은 이름(대소문자·공백만 변경, `netflix` -> `Netflix`)은 허용하고 거래 문자열도 새 표기로 바뀐다. 정규화 결과가 현재 이름과 완전히 같으면 200, 변화 없음.
- 이미 같은 상태로 바꾸는 요청(`active:true`인데 이미 활성, `active:false`인데 이미 비활성)은 200, 변화 없음(멱등). 이 경우 LAST_ACTIVE/LIMIT 검사는 하지 않는다.
- 비활성 카테고리도 이름 변경이 가능하다(활성 여부와 무관).
- 사용 안 함은 **새 입력에서만** 빠진다. 그 카테고리의 과거 거래는 조회·집계·R3/R4/R5에 그대로 나온다.
- 이름 변경과 거래 쓰기가 동시에 일어나도 "목록에 없는 옛 이름을 가진 새 거래"가 생기지 않도록 서버가 보장한다. 구현: 카테고리 POST/PATCH와 거래 POST/PUT은 모두 시작할 때 세션 사용자의 `users` 행에 `FOR NO KEY UPDATE` 잠금을 걸어 같은 사용자의 쓰기를 직렬화한다(거래 INSERT의 FK 확인과는 충돌하지 않는다). 카테고리 행 공유 잠금 방식은 PUT(거래 행 -> 카테고리 행)과 이름 변경(카테고리 행 -> 거래 행)의 잠금 순서가 엇갈려 교착될 수 있어 쓰지 않는다.

### 3A.5 DELETE /api/categories/:id

지원하지 않는다. 405 `METHOD_NOT_ALLOWED`, `Allow: PATCH`. 삭제 = 사용 안 함(3A.4). `/api/categories` 컬렉션 경로의 PUT/PATCH/DELETE도 405(`Allow: GET, POST`).

### 3A.6 오류 처리 요약 (카테고리 API 공통)

- 401 `UNAUTHENTICATED`(세션 없음, GET 포함), 403 `CSRF_REJECTED`(POST/PATCH에 Origin 없음/불일치), 413(16KB 초과), 415(JSON 아닌 Content-Type), 400 `INVALID_JSON`은 1장 규약 그대로.
- 모든 오류는 `{ "error": { "code", "message" } }` 형식이며 SQL·스택을 포함하지 않는다.

## 4. 거래

거래 객체 (`userId` 없음):
```json
{ "id": "uuid", "type": "expense", "amount": 4500, "category": "카페/간식", "memo": "스타벅스", "date": "2026-10-19", "createdAt": "2026-10-19T03:12:45.123Z" }
```

입력 검증(POST/PUT 공통, 모두 필수 필드 `type, amount, category, date`, `memo` 선택(기본 ""))
- type: `expense` | `income`
- amount: 정수(JSON number, 1.5/문자열 불가), 1 ~ 100,000,000
- category: 문자열. 세션 사용자의 해당 type **활성** 카테고리 이름과 **정확히 같아야** 한다(정규화·대소문자 무시 없음, `GET /api/categories`의 `expense`/`income` 배열 값을 그대로 보낸다). 다른 사용자의 카테고리 이름은 불일치다. PUT에는 예외가 있다(아래 4.3).
  - 목록에 없는 이름 -> `fields.category = "해당 구분에 없는 카테고리예요."`
  - 사용 안 함 카테고리 이름 -> `fields.category = "사용 안 함으로 바꾼 카테고리예요. 다른 카테고리를 골라 주세요."`
  - 문자열이 아님 -> type이 올바르지 않으면 `fields.category = "카테고리를 선택해 주세요."`, type이 올바르면 `"해당 구분에 없는 카테고리예요."` (v2 동작과 동일)
  - 형식 오류(type/amount/date/memo, category가 문자열 아님)가 하나라도 있으면 그 오류만 `fields`에 담기고, 카테고리 이름 검사(목록에 없음/사용 안 함)는 형식이 통과한 뒤에 DB로 판정한다.
- date: 실존하는 `YYYY-MM-DD` (`2026-02-30`, `20261019` 불가)
- memo: 문자열, 앞뒤 공백 제거 후 0~50자
- 본문의 `userId`/`user_id`/`id`/`createdAt` 등 알 수 없는 필드는 무시 (소유자는 항상 세션 사용자)

### 4.1 GET /api/transactions?month=YYYY-MM
month 필수(형식 오류/누락 400). 응답: date 내림차순, 같은 날은 createdAt 내림차순.
```json
{ "month": "2026-10", "transactions": [ { "id": "...", "type": "expense", "amount": 4500, "category": "카페/간식", "memo": "스타벅스", "date": "2026-10-19", "createdAt": "..." } ] }
```

### 4.2 POST /api/transactions
요청: `{ "type": "expense", "amount": 4500, "category": "카페/간식", "memo": "스타벅스", "date": "2026-10-19" }` -> **201** 거래 객체(래핑 없이 객체 자체).

### 4.3 PUT /api/transactions/:id
전체 필드 교체(POST와 같은 본문). 200 거래 객체(`createdAt`은 유지). 없는 id, 타 사용자 id, UUID 형식이 아닌 id는 모두 404 `NOT_FOUND`.

**카테고리 유지 예외 (v3)**: 요청의 `(type, category)`가 **그 거래의 현재 저장 값과 같으면**, 그 카테고리가 사용 안 함이거나 목록에 없어도 허용한다(과거 기록의 금액·메모·날짜만 고치는 경우). 다른 카테고리나 다른 type으로 바꾸면 대상이 활성 카테고리여야 한다(POST와 같은 검증).
- 검사 순서: type/amount/date/memo 형식 검증(400) -> 대상 거래 조회(404) -> 카테고리 검증(400 `fields.category`). 즉 존재하지 않는 거래에 잘못된 카테고리를 보내면 404이고, 존재하는 거래에 형식 오류와 카테고리 오류가 함께 있으면 형식 오류 400 하나만 `fields`에 담긴다(카테고리 오류는 형식이 통과한 뒤에 판정).
- 예: "경조사"(사용 안 함)로 기록된 거래의 금액만 고치기: `PUT {type:"expense", amount:50000, category:"경조사", ...}` -> 200. 같은 거래를 활성 "식비"로 바꾸기 -> 200. 다른 거래를 "경조사"로 바꾸기 -> 400.

### 4.4 DELETE /api/transactions/:id
204 (본문 없음). 404 규칙은 PUT과 동일.

## 5. 요약 / 대시보드 집계

### 5.1 GET /api/summary?month=YYYY-MM
```json
{
  "month": "2026-10", "incomeTotal": 2500000, "expenseTotal": 1230000, "balance": 1270000,
  "byCategory": [ { "category": "식비", "total": 400000, "count": 21, "ratio": 0.3252 } ]
}
```
`byCategory`는 **지출**만, total > 0인 카테고리(사용 안 함 카테고리의 과거 거래도 포함), total 내림차순(동률은 아래 "정렬 동률 기준"), ratio = total/expenseTotal(소수 넷째 자리 반올림). 데이터 없으면 모두 0, `byCategory: []`.

### 정렬 동률 기준 (v3, summary·stats/categories·stats/category-monthly·R4 공통)

v2의 "고정 순서"는 v3에서 **세션 사용자의 카테고리 `sortOrder`**(비활성 포함, 같은 type 기준)로 바뀐다. 금액(또는 sum) 동률이면 `sortOrder` 오름차순, `categories`에 없는 문자열은 맨 뒤, 그다음 이름 가나다순(ko 로케일 비교). 기본 세트만 가진 사용자는 v2와 결과가 같다. 새 카테고리는 기본 세트 뒤에 온다.

### 집계 공통 파라미터
(`/api/stats/monthly`는 `type`을 사용하지 않지만 `expense|income` 외 값이면 마찬가지로 400이다.)

`from=YYYY-MM`, `to=YYYY-MM` 필수, from <= to, 기간(양 끝 포함) 최대 24개월. 위반/누락/형식 오류(`2026-1`, `2026-13`)/`type`이 `expense|income`이 아님은 400 `VALIDATION_ERROR`. `type` 기본 `expense`.

### 5.2 GET /api/stats/monthly?from=&to=
from~to **모든 달**, 오래된 순, 거래 없는 달은 0.
```json
{ "from": "2026-05", "to": "2026-07",
  "months": [
    { "month": "2026-05", "incomeTotal": 2500000, "expenseTotal": 1800000, "balance": 700000, "count": 42 },
    { "month": "2026-06", "incomeTotal": 0, "expenseTotal": 0, "balance": 0, "count": 0 },
    { "month": "2026-07", "incomeTotal": 2500000, "expenseTotal": 900000, "balance": 1600000, "count": 20 }
  ] }
```

### 5.3 GET /api/stats/categories?from=&to=&type=
```json
{ "from": "2026-10", "to": "2026-10", "type": "expense", "grandTotal": 1230000,
  "items": [ { "category": "식비", "total": 400000, "count": 21, "ratio": 0.3252 } ] }
```
total > 0만(사용 안 함 카테고리 포함), total 내림차순(동률은 위 "정렬 동률 기준"), ratio는 소수 넷째 자리 반올림(0~1 값, % 아님). 없으면 `grandTotal: 0, items: []`.

### 5.4 GET /api/stats/category-monthly?from=&to=&type=
```json
{ "from": "2026-08", "to": "2026-10", "type": "expense",
  "months": ["2026-08", "2026-09", "2026-10"],
  "series": [ { "category": "식비", "totals": [380000, 410000, 400000], "sum": 1190000 } ] }
```
totals 길이 = months 길이, sum > 0인 카테고리만(사용 안 함 카테고리 포함), sum 내림차순(동률은 위 "정렬 동률 기준").

## 6. 추천 / 인사이트

`today=YYYY-MM-DD`(선택): 있으면 그 날을 오늘로 간주, 형식 오류는 400. 없으면 Asia/Seoul 현재 날짜. 규칙은 plan.md 6장.

### 6.1 GET /api/recommendations/quick?type=expense&today=
type 기본 expense(`expense|income` 외 400). 최대 5개:
```json
{ "items": [ { "memo": "스타벅스", "category": "카페/간식", "amount": 4500, "count": 12, "lastDate": "2026-10-17", "weekdayMatch": true } ] }
```
v3: 새 입력용 제안이므로 `category`가 **사용 안 함**이거나 사용자 카테고리 목록에 없는 그룹은 후보에서 제외한다(제외 후 최대 5개를 채운다). 같은 메모를 다른 활성 카테고리로 3건 이상 쓴 그룹은 그대로 제안된다. 응답 형식은 v2와 같고 `category`는 항상 활성 카테고리 이름 문자열이다. 이름 변경 후에는 과거 거래도 새 이름이므로 `category`가 새 이름이고 `count`는 유지된다.

### 6.2 GET /api/recommendations/autocomplete?q=&type=&today=
q는 정규화 후 1글자 이상일 때만 동작(빈 값이면 `items: []`, 400 아님). q 최대 50자(초과 400). 최대 5개:
```json
{ "items": [ { "memo": "스타벅스", "category": "카페/간식", "amount": 4500 } ] }
```
v3 (**비호환**): `category`는 그 메모 그룹에서 가장 많이 쓴 **활성** 카테고리(동률은 가장 최근 사용)이고, 그룹의 카테고리가 모두 사용 안 함이거나 목록에 없으면 **`null`** 이다. 이때 `memo`와 `amount`는 그대로 제안된다.
```json
{ "items": [ { "memo": "조의금", "category": null, "amount": 50000 } ] }
```
프론트는 `category`가 `null`이면 카테고리를 채우지 않는다(선택 상태 변경 없음).

### 6.3 GET /api/insights?month=YYYY-MM&today=
```json
{
  "month": "2026-10",
  "recurring": [ { "type": "expense", "memo": "넷플릭스", "category": "문화/여가", "amount": 17000, "period": "monthly", "occurrences": 4, "lastDate": "2026-10-05", "nextDate": "2026-11-04", "dueSoon": false } ],
  "overspending": [ { "category": "식비", "level": "exceeded", "currentTotal": 130000, "baseline": 100000, "projectedTotal": null, "ratio": 1.3 } ],
  "largeExpenses": [ { "transactionId": "uuid", "date": "2026-10-12", "category": "쇼핑", "memo": "패딩", "amount": 250000, "median": 40000, "multiple": 6.3 } ]
}
```
`projectedTotal`은 level이 `pace`일 때만 숫자(예상 월 합계, 반올림), `exceeded`면 `null`. 정렬/제한은 plan.md 6장.

구현 세부(plan에서 모호했던 부분의 확정):
- `overspending` (R4, plan.md 6장 v2.1): 카테고리당 최대 1개(exceeded 우선). 응답 형식은 v2와 같다.
  - `currentTotal`: 그 달 그 카테고리 지출 누적. **반복 거래(R3로 감지된 것)를 포함**한다. `exceeded`/`pace` 공통.
  - `baseline`: 직전 3개 달력월 중 지출이 있는 달의 월 합계 평균(반복 포함), 원 단위 반올림. 기록 있는 달 2개월 미만이거나 baseline 10,000원 미만이면 판정 안 함.
  - `exceeded`: `currentTotal >= baseline x 1.2` (반복 포함 누적으로 판정, 정수 연산).
  - `pace`: exceeded가 아니고, `today`가 `month`에 속하며 today의 일(day) >= 7, 그리고 **반복 거래를 제외한 이번 달 거래(pace 대상)가 2건 이상**이며 `pace대상합계 / 경과일 x 그 달 일수 >= baseline x 1.3` (정수 연산: `pace대상합계 x 일수 x k x 10 >= S x 13 x 경과일`). 과거/미래 달 조회 시 `exceeded`만.
  - `projectedTotal`(pace): `pace대상합계 / 경과일 x 그 달 일수`를 원 단위 반올림한 값. 반복 거래 제외 금액 기준이라 `currentTotal`보다 작을 수 있다.
  - `ratio`(소수 둘째 자리): `exceeded`는 `currentTotal / baseline`, `pace`는 반올림 전 예상 월 합계 / `baseline`.
  - 반복 거래 판별: 같은 요청의 `recurring`(R3, 같은 거래 데이터와 같은 today)과 동일하다. 이번 달 지출 중 R3가 감지한 그룹(메모 정규화 키, 메모 없으면 구분+카테고리+금액)에 속한 거래는 모두 pace 대상에서 제외한다(같은 메모면 카테고리가 달라도 제외). R3 건수/금액/간격 조건을 못 채운 그룹(예: 두 번째 결제한 신규 구독), 비활성 제외된 그룹은 반복으로 보지 않는다. 제외된 거래 목록/건수는 응답에 없다.
  - 예: 월세 500,000원이 매달 같은 날 4건 감지되면 이번 달 월세는 pace에서 빠지고, 월세 외 비반복 지출이 2건 미만이면 pace 항목이 없다. 월세 + 비반복 지출로 `currentTotal`이 baseline의 1.2배 이상이면 `exceeded`는 나온다.
  - 알려진 한계(plan 열린 쟁점 R4-Q1~Q3, 기본값대로 구현): baseline은 반복 포함 합계인데 pace는 반복 제외 금액만 외삽해 비교한다(반복+비반복 혼합 카테고리의 pace가 늦게/안 뜰 수 있음). 큰 단건 1건 + 소액 1건은 pace가 될 수 있다. 비활성 제외로 빠진 주간 반복은 반복으로 보지 않는다.
- `largeExpenses` 비교군: 해당 거래일 포함 90일(거래일-89 ~ 거래일) 같은 카테고리 지출 중 해당 거래 제외. `median`은 정수가 아닐 수 있음(짝수 건수 평균).
- `recurring`/`quick`/`autocomplete`는 `date <= today`인 거래만 쓴다. `largeExpenses`/`overspending`은 **month 안의 거래 전체**를 쓰므로, `today` 이후 날짜로 미리 입력한 이번 달 거래(`date > today`)도 `currentTotal`(과 exceeded 판정)에 **포함된다**. pace 대상도 같은 집합(반복 제외)에서 시작해 미리 입력한 거래가 합계·건수에 들어가지만, 경과일은 today 기준이다. (R4-Q4: 현재 구현 동작을 그대로 문서화했으며 변경하지 않음)
- 거래 `memo` 비교는 정규화 키(앞뒤 공백 제거, 연속 공백 1칸, 소문자화)로 하고, 응답의 `memo`는 가장 최근 거래의 원래 메모(앞뒤 공백 제거)이다.

### 6.4 카테고리 변경이 인사이트에 주는 영향 (v3)

응답 형식은 v2와 같다. 규칙은 거래의 카테고리 **문자열**로 묶으므로 다음과 같이 동작한다.

| 상황 | R3 recurring | R4 overspending | R5 largeExpenses |
|---|---|---|---|
| 이름 변경 | 과거 거래도 새 이름이라 그룹·건수·간격이 이어진다 | 직전 3개월 baseline이 새 이름으로 합쳐져 연속(같은 `currentTotal`/`baseline`/`ratio`) | 비교군 연속 |
| 사용 안 함 | 계속 감지·표시 | 계속 판정(`level`/값 불변). 정렬 동률만 `sortOrder` 기준 | 계속 판정 |
| 새 카테고리 | 기존 규칙(건수 조건) | 기록 있는 달 2개월 미만이면 판정 없음 | 비교군 5건 미만이면 판정 없음 |

`level` 값(`exceeded`/`pace`) 등 응답 필드는 바뀌지 않는다. 사용 안 함 여부는 응답에 담지 않는다(프론트는 `GET /api/categories`의 `items`로 판단한다).

## 7. 로컬 확인용 메모

- 서버 오류 재현(C48), 세션 만료/시도 제한 해제 등 DB 조작이 필요한 검증 방법은 README "QA/테스트 지원" 절 참고(`QA_TOOLS=true` 개발 서버의 `/__qa/*`, `npm run qa:tools`). 이 도구는 API 계약의 일부가 아니며 프로덕션에서는 동작하지 않는다.
- 다른 방법의 서버 오류 재현(C48): 개발 서버에서 `DB_DRIVER` 없이 잘못된 `DATABASE_URL`(예: 닫힌 포트의 로컬 주소)로 기동하면 형식이 올바른 세션 쿠키가 있는 요청(DB 조회 필요)은 500 `INTERNAL_ERROR`(형식이 틀린 쿠키는 DB 조회 없이 401), `/api/health`는 `db: "error"`가 된다.
- 개발 서버의 정적 파일 요청도 같은 보안 헤더를 받는다(API만 `Cache-Control: no-store`).

## 8. 마이그레이션 계약 (v3)

API가 아니라 배포 계약이다. 운영 반영 순서는 **백업 -> 마이그레이션 -> 코드 배포**이며 코드를 먼저 배포하면 안 된다(새 코드가 없는 `categories` 테이블을 읽어 거래 저장·카테고리 조회가 500).

### 8.1 스키마 (추가 전용)

`src/backend/db/schema.sql`에 아래만 추가한다. 기존 테이블 ALTER/DROP, `transactions` 쓰기, `transactions`에 FK/CHECK 추가는 하지 않는다(구버전 코드와 호환 유지).

```sql
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null check (type in ('expense', 'income')),
  name text not null check (char_length(name) between 1 and 15),
  name_key text not null,
  active boolean not null default true,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, type, name_key)
);
create index if not exists categories_user_type_sort_idx on categories (user_id, type, sort_order);
```
- `unique (user_id, type, name_key)`는 활성·비활성 모두에 적용된다(같은 이름의 카테고리가 둘이면 문자열 저장 구조에서 구분할 수 없다).
- `transactions.category`는 계속 이름 문자열이다.

### 8.2 데이터 이관 (멱등)

1. **기본 세트**: `categories` 행이 **하나도 없는** 사용자에게만 기본 12행(3A.1의 이름·순서, 모두 active)을 INSERT한다. "행이 하나도 없는 사용자" 조건이 핵심이다. 이 조건이 없으면 사용자가 "식비"를 "밥"으로 바꾼 뒤 마이그레이션을 다시 돌릴 때 "식비"가 되살아난다.
2. **방어용 비활성 행**: 기존 거래에 사용자·유형별로 기본 세트 밖의 카테고리 문자열이 있으면 그 (사용자, 유형, 문자열)마다 `active=false` 행을 만든다(관리 화면에서 보이고 다시 사용 가능). 이름이 15자를 넘거나 `name_key`가 겹치면 건너뛴다(거래는 그대로). 현재 검증상 생길 수 없는 경우를 대비한 안전망이며 정상 운영 DB에서는 0건이어야 한다.
3. 두 번 이상 실행해도 결과가 같다. 사용자가 바꾼 이름·상태·순서는 재실행으로 덮어쓰지 않는다.
4. 원자성: 마이그레이션 SQL은 한 번에 실행되어 중간 실패 시 전체가 롤백되어야 한다(Postgres 단순 쿼리는 암묵 트랜잭션; PGlite `exec` 동작은 구현 시 확인하고 다르면 BEGIN/COMMIT으로 감싼다).
5. 구버전 코드는 `categories`를 읽지 않으므로 마이그레이션 후 코드 배포 전에는 구버전 코드로 정상 운영된다. 그 사이 구버전으로 가입한 사용자는 행이 없지만 새 코드의 지연 생성(3A.1)과 마이그레이션 재실행으로 해소된다.

### 8.3 `npm run db:migrate`

기존 스크립트. `.env`만 읽고 `DB_DRIVER=pglite`이면 로컬 PGlite에 적용된다. 출력의 `driver=`로 대상을 구분한다. v3부터 성공 출력에 카테고리 행이 생성된 사용자 수를 덧붙인다(비밀 값 없음).

```
마이그레이션 완료 (driver=pglite, categories 생성 사용자=3)
```

### 8.4 `npm run db:migrate:prod` (신규)

운영 DB 마이그레이션 전용. 사용자가 직접 실행한다.

```
npm run db:migrate:prod -- --yes
```

| 규칙 | 동작 |
|---|---|
| 환경 파일 | `.env.production.local`**만** 읽는다(`vercel env pull .env.production.local --environment=production`으로 준비). `.env`는 읽지 않는다. 파일이 없으면 종료 코드 1과 안내 메시지 |
| `--yes` | 없으면 아무것도 실행하지 않고 종료 코드 1(대상 driver 이름만 안내) |
| `DB_DRIVER` | 환경 파일에 또는 프로세스 환경에 설정되어 있으면(값 무관) 거부, 종료 코드 1 |
| 접속 정보 | `DATABASE_URL_UNPOOLED` -> `DATABASE_URL` 순. 둘 다 없으면 종료 코드 1 |
| 출력 | 성공: `마이그레이션 완료 (driver=pg, categories 생성 사용자=N)` / 실패: 코드·이름만(연결 문자열 마스킹), 종료 코드 1 |
| 확인 | `driver=pg`가 아니면 운영에 적용되지 않은 것 |
| 멱등 | 같은 명령을 다시 실행해도 오류 없고 `생성 사용자=0` |

### 8.5 사용자 이름 컬럼 (v4)

`schema.sql` 의 users 정의 뒤에 추가한다. 추가 전용·멱등이며 기존 컬럼·인덱스·데이터는 건드리지 않는다(백필 없음).

```sql
alter table users add column if not exists name text
  check (name is null or char_length(name) between 1 and 20);
```
- nullable: 기존 사용자는 `null`(헤더는 이메일로 폴백), name 을 모르는 구버전 INSERT 도 그대로 동작한다.
- 재실행해도 아무것도 하지 않는다. `db:migrate`, `db:migrate:prod` 출력 형식은 변하지 않는다.
- **운영 반영 순서(사용자 직접)**: (1) Neon 백업 브랜치 -> (2) `npm run db:migrate:prod -- --yes` (출력 `driver=pg` 확인) -> (3) 확인 쿼리 -> (4) 그 뒤에 코드 푸시(배포). 코드를 먼저 배포하면 로그인·me·가입이 500 이다. 프리뷰 배포도 같은 DB 를 쓰므로 프리뷰 확인 전에 (2)가 필요하다.
- 확인 쿼리(숫자만): `select count(*) from information_schema.columns where table_name = 'users' and column_name = 'name';` = 1, `select count(*), count(name) from users;` = (기존 사용자 수, 0), `select count(*), sum(amount) from transactions;` 와 `select count(*) from categories;` 가 실행 전과 같음.
- 롤백: 코드를 이전 커밋으로 되돌려도 컬럼이 남아 문제없다. 컬럼 DROP 은 하지 않는다.

v3 마이그레이션 실행 후 확인 쿼리(Neon SQL Editor, 숫자만 보고):
- `select count(*) from categories;` = 사용자 수 x 12 (방어용 비활성 행 0건 가정)
- `select count(*) from users u where not exists (select 1 from categories c where c.user_id = u.id);` = 0
- `select count(*), sum(amount) from transactions;` 이 실행 전 기록과 같음
