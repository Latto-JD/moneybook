# API 계약 (v2)

작성: backend / 기준: `docs/plan.md` v2 / 변경 시 backend가 수정 후 메인 세션에 알린다. frontend는 계약을 임의로 바꾸지 않는다.

## 1. 공통 규약

- 모든 경로는 `/api` 아래, 같은 출처(same-origin)에서만 호출한다. 요청/응답은 JSON(UTF-8).
- 응답 헤더(모든 API): `Content-Type: application/json; charset=utf-8` (204 제외), `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Content-Security-Policy: default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`.
- 금액은 원 단위 정수. 날짜는 `YYYY-MM-DD`, 월은 `YYYY-MM` 문자열.
- 알 수 없는 경로는 404 `NOT_FOUND`, 허용되지 않은 메서드는 405 `METHOD_NOT_ALLOWED` (`Allow` 헤더 포함).

### 1.1 에러 형식

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "금액은 1 이상 100000000 이하의 정수여야 합니다." } }
```

`message`는 사람이 읽을 수 있는 한국어 문장이며 비밀 값/스택/SQL을 포함하지 않는다. 프론트는 `code`로 분기한다. 필드별 검증 실패 시 `error.fields`(선택)에 `{ "필드명": "사유" }` 객체가 함께 올 수 있다.

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
| 413 | `PAYLOAD_TOO_LARGE` | 본문 16KB(16384바이트) 초과 |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | 본문이 있는 요청의 Content-Type이 `application/json`이 아님 |
| 429 | `TOO_MANY_ATTEMPTS` | 로그인/가입 시도 제한. `Retry-After`(초) 헤더 포함 |
| 500 | `INTERNAL_ERROR` | 그 외. 메시지는 "서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요." 고정 |

검사 순서(먼저 걸리는 것이 응답): 경로/메서드(404/405) -> CSRF Origin(403) -> Content-Type(415) -> 본문 크기(413) -> JSON 파싱(400) -> 인증(401) -> 입력 검증(400) -> 비즈니스(404/409/429).

### 1.2 CSRF 규칙

1. 쿠키는 `SameSite=Lax`.
2. **상태 변경 요청(POST/PUT/DELETE)** 은 `Origin` 헤더가 **반드시 있어야** 한다 (로그인/가입/로그아웃 포함, 세션 유무 무관). Origin의 host(포트 포함)가 요청 호스트(`x-forwarded-host` 우선, 없으면 `Host`)와 같거나, 환경변수 `APP_ORIGINS`(쉼표 구분 전체 Origin 목록)에 있어야 한다. 아니면 403 `CSRF_REJECTED`. 브라우저의 same-origin `fetch`는 POST/PUT/DELETE에 Origin을 자동으로 붙인다. GET은 검사하지 않는다.
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

사용자 객체: `{ "id": "uuid", "email": "a@ex.com" }` (비밀번호/해시는 어떤 응답에도 없음)

### 2.1 POST /api/auth/signup

요청 (Origin 필수):
```json
{ "email": "User@Example.com", "password": "correct horse" }
```
- email: 앞뒤 공백 제거 + 소문자화 후 1~254자, 공백 없음, `@` 정확히 1개, 로컬/도메인 비어있지 않음, 도메인에 `.` 포함하며 `.`로 시작/끝나지 않음
- password: 문자열 8~128자 (조합 규칙 없음, 공백 그대로)

201 + `Set-Cookie`(자동 로그인):
```json
{ "user": { "id": "5b1c6f0e-5b0a-4c36-8d0f-0c3b8f6a1e11", "email": "user@example.com" } }
```
오류: 400 `VALIDATION_ERROR`(`fields.email` / `fields.password`), 403 `CSRF_REJECTED` / `SIGNUP_DISABLED`, 409 `EMAIL_TAKEN`, 429 `TOO_MANY_ATTEMPTS`.

### 2.2 POST /api/auth/login

요청 (Origin 필수): `{ "email": "user@example.com", "password": "correct horse" }` (이메일 대소문자/앞뒤 공백 무시)

200 + `Set-Cookie`: `{ "user": { "id": "...", "email": "user@example.com" } }`

오류:
- 400 `VALIDATION_ERROR` (email/password가 문자열이 아니거나 비어 있음)
- 401 `INVALID_CREDENTIALS` `"이메일 또는 비밀번호가 맞지 않아요."` (틀린 비밀번호/없는 이메일 동일, 응답 시간도 비슷하게 유지)
- 429 `TOO_MANY_ATTEMPTS` + `Retry-After`

### 2.3 POST /api/auth/logout

Origin 필수. 본문 없음. 세션이 없어도 **204**. DB 세션을 삭제하고 `Max-Age=0` 쿠키를 보낸다. 이후 같은 토큰은 401.

### 2.4 GET /api/auth/me

200 `{ "user": { "id": "...", "email": "..." } }` / 401 `UNAUTHENTICATED`.

## 3. 기본

### 3.1 GET /api/health (인증 불필요)
```json
{ "status": "ok", "db": "ok" }
```
DB 연결 실패 시 **200** `{ "status": "ok", "db": "error" }` (프로세스는 살아있음을 의미; 세부 오류 미노출).

### 3.2 GET /api/categories
```json
{
  "expense": ["식비", "카페/간식", "교통", "쇼핑", "주거/통신", "의료/건강", "문화/여가", "기타"],
  "income": ["급여", "용돈", "부수입", "기타"]
}
```
배열 순서가 "고정 순서"이다.

## 4. 거래

거래 객체 (`userId` 없음):
```json
{ "id": "uuid", "type": "expense", "amount": 4500, "category": "카페/간식", "memo": "스타벅스", "date": "2026-10-19", "createdAt": "2026-10-19T03:12:45.123Z" }
```

입력 검증(POST/PUT 공통, 모두 필수 필드 `type, amount, category, date`, `memo` 선택(기본 ""))
- type: `expense` | `income`
- amount: 정수(JSON number, 1.5/문자열 불가), 1 ~ 100,000,000
- category: 해당 type의 고정 카테고리 중 하나
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
`byCategory`는 **지출**만, total > 0인 카테고리, total 내림차순(동률은 고정 순서), ratio = total/expenseTotal(소수 넷째 자리 반올림). 데이터 없으면 모두 0, `byCategory: []`.

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
total > 0만, total 내림차순(동률은 고정 순서), ratio는 소수 넷째 자리 반올림(0~1 값, % 아님). 없으면 `grandTotal: 0, items: []`.

### 5.4 GET /api/stats/category-monthly?from=&to=&type=
```json
{ "from": "2026-08", "to": "2026-10", "type": "expense",
  "months": ["2026-08", "2026-09", "2026-10"],
  "series": [ { "category": "식비", "totals": [380000, 410000, 400000], "sum": 1190000 } ] }
```
totals 길이 = months 길이, sum > 0인 카테고리만, sum 내림차순(동률은 고정 순서).

## 6. 추천 / 인사이트

`today=YYYY-MM-DD`(선택): 있으면 그 날을 오늘로 간주, 형식 오류는 400. 없으면 Asia/Seoul 현재 날짜. 규칙은 plan.md 6장.

### 6.1 GET /api/recommendations/quick?type=expense&today=
type 기본 expense(`expense|income` 외 400). 최대 5개:
```json
{ "items": [ { "memo": "스타벅스", "category": "카페/간식", "amount": 4500, "count": 12, "lastDate": "2026-10-17", "weekdayMatch": true } ] }
```

### 6.2 GET /api/recommendations/autocomplete?q=&type=&today=
q는 정규화 후 1글자 이상일 때만 동작(빈 값이면 `items: []`, 400 아님). q 최대 50자(초과 400). 최대 5개:
```json
{ "items": [ { "memo": "스타벅스", "category": "카페/간식", "amount": 4500 } ] }
```

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

## 7. 로컬 확인용 메모

- 서버 오류 재현(C48), 세션 만료/시도 제한 해제 등 DB 조작이 필요한 검증 방법은 README "QA/테스트 지원" 절 참고(`QA_TOOLS=true` 개발 서버의 `/__qa/*`, `npm run qa:tools`). 이 도구는 API 계약의 일부가 아니며 프로덕션에서는 동작하지 않는다.
- 다른 방법의 서버 오류 재현(C48): 개발 서버에서 `DB_DRIVER` 없이 잘못된 `DATABASE_URL`(예: 닫힌 포트의 로컬 주소)로 기동하면 형식이 올바른 세션 쿠키가 있는 요청(DB 조회 필요)은 500 `INTERNAL_ERROR`(형식이 틀린 쿠키는 DB 조회 없이 401), `/api/health`는 `db: "error"`가 된다.
- 개발 서버의 정적 파일 요청도 같은 보안 헤더를 받는다(API만 `Cache-Control: no-store`).
