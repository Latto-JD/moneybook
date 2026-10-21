# 인앱 다크/라이트 전환 + 가입 시 이름 받기 계획서 (plan-theme-name v1)

작성: planner / 작성일: 2026-10-22 / 기준 커밋: `440e9e6`(운영 배포본)
관련 문서: `docs/plan.md`, `docs/plan-categories.md`, `docs/plan-design.md`(OQ-D4, D-08, 14장 "다크 모드 토글"), `docs/api.md`(v3)

표기: **[사실]** 은 코드에서 확인한 내용(파일:줄), **[권장]** 은 planner 의 권장 기본값. 열린 질문(9장)에 사용자 결정이 필요한 것을 모았다. 답이 없으면 권장 기본값으로 진행한다.

---

## 1. 목표

운영 데이터를 잃지 않고, 사용자가 앱 안에서 화면 모드(자동/라이트/다크)를 고를 수 있게 하고, 가입할 때 이름을 받아 헤더에 이메일 대신 이름을 보여 준다(이메일은 로그인 ID 로 유지).

## 2. 현재 상태 조사 결과

### 2.1 이름 기능에 영향을 주는 사실

| 항목 | 사실 |
|---|---|
| users 스키마 | **[사실]** `id, email(unique, 3~254), password_hash, created_at` 뿐, 이름 없음 (`src/backend/db/schema.sql:3-8`). 스키마는 `create table if not exists` 멱등 방식이며 ALTER 는 아직 한 번도 쓰지 않았다 |
| 마이그레이션 | **[사실]** `schema.sql` 전체를 한 번의 `exec` 로 보내 중간 실패 시 전체 롤백 (`src/backend/db/migrate.js:16-24`). 운영은 `npm run db:migrate:prod -- --yes`, `.env.production.local` 만 읽음 (`src/backend/scripts/migrate-prod.js`, `docs/api.md` 8.4) |
| 운영 데이터 | 사용자 6명(QA 테스트 계정 포함), 모두 이름 없음. 운영과 프리뷰가 같은 Neon DB 를 쓴다 |
| 사용자 객체 | **[사실]** `userBody = { user: { id, email } }` 를 signup/login/me 가 공통 사용 (`src/backend/auth/routes.js:18`). 세션 조회는 `select u.id, u.email` (`src/backend/auth/session.js:29-33`), 로그인은 `select id, email, password_hash` (`routes.js:66`) |
| 가입 검증 | **[사실]** email·password 만 검사, 실패 시 400 `VALIDATION_ERROR` + `fields` (`routes.js:22-28`). 사용자 INSERT 와 기본 카테고리 생성이 한 트랜잭션 (`routes.js:36-43`) |
| 문자열 검증 선례 | **[사실]** 카테고리 이름: 제어문자(`\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f`) 거부 → NFC → trim → 연속 공백 1칸 → 코드포인트 길이 검사 (`src/backend/lib/categories.js:24-35`). 프론트 동일 함수 `js/lib/categories-data.js:6-8` |
| 헤더 | **[사실]** `<span class="user" id="user-email" aria-live="polite">` + 로그아웃 버튼 (`src/frontend/public/index.html:16-19`). `app.js:11-12` 가 `textContent`/`title` 에 이메일을 넣는다. CSS 는 말줄임 (`css/style.css:29-32`) |
| 가입 화면 | **[사실]** `login.html` 하나에서 로그인/가입 세그먼트 전환, 입력은 이메일·비밀번호뿐 (`login.html:18-36`, `js/login.js:14-24`). `api.signup(email, password)` (`js/api.js:91`) |
| 계정 정보 수정 API | **[사실]** 없음. `/api/auth/*` 는 signup/login/logout/me(GET) 4개 (`routes.js:89-94`) |
| 테스트 고정점 | **[사실]** `e2e/tests/auth.spec.js:52` 가 `body.user` 를 `{ id, email }` 와 **정확히 같다**고 검사. `#user-email` 이 이메일 텍스트인지 검사: `e2e/tests/frontend.spec.js:24, 196, 682`, `e2e/tests/categories-ui.spec.js:46`. e2e 가입 헬퍼는 `{ email, password }` 만 보냄 (`e2e/helpers/api.js:48`), `contract.spec.js:84`·`auth.spec.js:236` 도 가입 본문 사용. `src/backend/test/auth.test.js:33` 은 me 와 signup 의 user 가 같음을 검사 |
| 사용자 직접 INSERT | **[사실]** `e2e/tests/categories-migration.spec.js:67, 237`, `src/backend/scripts/seed.js:77` 이 name 없이 users 에 INSERT → 컬럼이 nullable 이면 그대로 동작 |

### 2.2 다크 전환에 영향을 주는 사실

| 항목 | 사실 |
|---|---|
| 토큰 | **[사실]** `css/tokens.css:108-143` `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }`, `:146-159` `:root[data-theme="dark"] {…}`. 즉 `<html>` 에 속성이 없으면 자동, `light`/`dark` 면 수동 고정이 **CSS 수정 없이** 이미 동작한다 |
| 다른 CSS 의 미디어 쿼리 | **[사실]** `prefers-color-scheme` 은 `tokens.css` 에만 있다(`style.css`·`components.css` 에 없음) → 속성 하나로 전부 바뀐다 |
| 차트 | **[사실]** `js/charts.js` 는 색을 CSS 클래스(`viz-fill-N`, `viz-ink-stroke`, `chart-fill-income/expense`, `chart-stroke`)로만 넣는다(`:21-32, 54, 164-167, 243, 282`). JS 에서 색을 계산하지 않는다(`getComputedStyle` 은 `record.js:514` 의 padding 1곳뿐) → 전환 시 **다시 그릴 필요 없음**(QA 로 확인) |
| CSP | **[사실]** 정적·API 공통 `default-src 'self'; img-src 'self' data:; …` (`vercel.json:11`, `src/backend/http.js:13`). script-src 가 `'self'` 이므로 **인라인 `<script>` 는 차단**, 같은 출처의 외부 스크립트 파일은 허용. 정적 검사 C-D5 가 인라인 script·`on*=`·`style=` 를 금지 |
| 스크립트 로드 | **[사실]** 두 페이지 모두 `<script type="module">` 을 body 끝에서 로드(`index.html:180-181`, `login.html:39`). 모듈은 지연 실행이라 여기서 테마를 적용하면 첫 화면이 자동 테마로 그려진 뒤 바뀐다(깜빡임) |
| meta | **[사실]** 두 페이지 `<meta name="color-scheme" content="light dark">` |
| 캐시 | **[사실]** `/`, `/index.html` 만 `no-store` (`vercel.json:16-23`). js/css 는 Vercel 기본 캐시(재검증) |
| 아이콘 | **[사실]** `public/icons/` 15개에 해·달 아이콘 없음 |
| 기존 다크 테스트 | **[사실]** `e2e/tests/design.spec.js` 가 `emulateMedia({ colorScheme })` 로 다크를 검사. 수동 전환 테스트는 없음 |
| 기존 결정 | `plan-design.md` OQ-D4 "시스템 설정만, 토글 후속", D-08 은 "`<head>` 외부 동기 스크립트(`js/theme-init.js`) 필요, 토글 위치가 시안에 없음" 으로 정리됨 |

## 3. 사용자 스토리

| ID | 스토리 |
|---|---|
| US-T1 | 사용자로서, 휴대폰 설정과 다르게 앱만 밝게(또는 어둡게) 보고 싶다. |
| US-T2 | 사용자로서, 다시 "휴대폰 설정 따르기"로 돌아갈 수 있어야 한다. |
| US-T3 | 사용자로서, 앱을 다시 열거나 새로고침할 때 화면이 잠깐 다른 색으로 번쩍이지 않아야 한다. |
| US-N1 | 새 사용자로서, 가입할 때 이름을 입력하고 앱 상단에서 내 이름을 보고 싶다. |
| US-N2 | 사용자로서, 로그인은 계속 이메일로 하고 싶다. |
| US-N3 | 기존 사용자로서, 이름이 없어도 앱이 그대로 동작해야 하고(이메일 표시), 원하면 이름을 넣을 수 있어야 한다. (권장안) |
| US-N4 | 사용자로서, 이름을 잘못 넣었으면 고칠 수 있어야 한다. (권장안) |

## 4. 범위 / 제외 범위

### 4.1 범위 (이번에 한다)

**A. 화면 모드 전환 (프론트만, DB·API 변경 없음)**
1. 선택지 3개: 자동(시스템 설정, 기본) / 라이트 / 다크.
2. 저장: 브라우저 `localStorage` 키 `mb-theme`, 값 `light` | `dark`. "자동"은 키 삭제. 그 외 값은 무시(자동). 기기·브라우저별 저장이며 계정과 무관.
3. 적용: `<html data-theme="light|dark">` 설정/제거. `tokens.css` 는 수정하지 않는다.
4. 깜빡임 방지: `<head>` 에서 **CSS `<link>` 보다 앞에** 같은 출처 외부 **classic 동기 스크립트** `js/theme-init.js`(`type="module"`·`defer`·`async` 없음)를 둔다. `localStorage` 읽기를 `try/catch` 로 감싼다(사파리 사생활 보호 모드 등 예외 시 자동). 인라인 스크립트는 CSP 로 불가하므로 쓰지 않는다. `index.html`·`login.html` 둘 다 넣는다(로그인 화면도 저장된 모드를 따른다).
5. 전환 UI: 메인 화면 헤더에만 둔다(로그인 화면에는 두지 않음, 저장값만 따른다). 배치는 6.1.
6. 다른 탭 동기화: `storage` 이벤트로 다른 탭에서 바꾼 값을 반영(헤더 선택 상태 포함).

**B. 이름 (DB + 백엔드 + 프론트)**
1. DB: `users.name` 컬럼 추가(**nullable**), 추가 전용·멱등(7.1).
2. API: 사용자 객체에 `name`(문자열 또는 `null`) 추가, 가입에 `name` 필수, (권장안) `PATCH /api/auth/me` 로 이름 설정·수정(7.2).
3. 가입 폼: 가입 모드에서만 "이름" 입력 표시(6.2).
4. 헤더: 이름이 있으면 이름, 없으면 이메일(폴백, 6.3).
5. (권장안) 이름 설정·수정 화면 `#account`(6.4).
6. 문서: `docs/api.md` v4(backend 가 구현 전에 먼저), README 의 운영 반영 순서.

### 4.2 제외 범위

| 항목 | 이유 |
|---|---|
| 월 예산, 결제 수단, 저장 되돌리기, 바텀시트, 끌어서 순서 변경, 색·무늬 직접 선택 | `plan-design.md` 14장 후속. 이번 요청 아님 |
| R4 "이번 달 남은 돈" 라벨, 미래 날짜 R4 포함(O2), 도넛 범례 0.1%p(O1) | 별도 후속 |
| 수입 인사이트·저축률, 카테고리 이름의 보이지 않는 문자 검증 통일 | 별도 후속(카테고리 검증은 손대지 않는다) |
| 테마를 서버(계정)에 저장해 기기 간 동기화 | 스키마·API 추가가 필요. localStorage 로 충분(OQ-T3) |
| 이메일 변경, 비밀번호 변경, 계정 삭제, 이메일 인증 | 범위 밖 |
| 이름 중복 검사, 이름으로 로그인 | 이름은 표시용. 로그인 ID 는 이메일 |
| 이름을 다시 비우기(null 로 되돌리기) | 권장안에서도 1자 이상만 허용 |
| 미사용 CSS·SVG 정리, 폰트 용량 | 별도 후속 |
| `src/frontend/office/` | 이 프로젝트와 무관. **손대지 않는다** |
| `design_handoff_moneybook/` 커밋 | 로컬 참고용, 커밋하지 않는다 |
| `tokens.css` 값 변경 | 수동 전환 규칙이 이미 있다 |

## 5. 최소안 / 권장안 (이름 수정 방법)

| 구분 | 최소안 M | 권장안 R (기본값) |
|---|---|---|
| 내용 | 가입 시 이름 필수 + 헤더 표시 + 폴백. 이름 수정 수단 없음 | M + `PATCH /api/auth/me` + `#account` 화면(이름 입력·저장, 이메일은 읽기 전용 표시) |
| 기존 6명 | 영구히 이메일 표시 | 언제든 이름 입력 가능 |
| 오타 | 고칠 수 없음 | 고칠 수 있음 |
| 추가 비용 | 없음 | API 1개, 화면 1개(기존 `#categories` 패널 방식 재사용), 테스트 |
| 판단 | 요구 "헤더에 이름" 이 기존 사용자에게는 영원히 충족되지 않는다 | **권장**. 운영 사용자 6명 전원이 이름이 없는 상태라 M 만으로는 실사용자에게 기능이 보이지 않는다 |

OQ-N1 에서 확정한다. 아래 작업·완료 기준은 권장안 기준이며 최소안이면 [R] 표시 항목을 뺀다.

## 6. 화면 변경 (frontend)

### 6.1 헤더 모드 전환 UI

- **[권장]** 헤더의 이름과 로그아웃 버튼 사이에 네이티브 `<select id="theme-select">`(선택지 "자동"/"라이트"/"다크") + 화면에 보이지 않는 `<label for="theme-select">화면 모드</label>`(`.visually-hidden`).
  - 근거: 키보드·스크린리더 접근성이 기본 제공되고, 휴대폰에서는 OS 선택창이 뜬다. 새 아이콘(해·달 없음)이나 새 팝업 컴포넌트가 필요 없다. 3버튼 세그먼트는 360px 헤더에서 이름 공간을 너무 줄인다.
  - 대안: 누를 때마다 자동→라이트→다크로 도는 버튼 1개(OQ-T1).
- 스타일: 기존 `.input` 계열 토큰으로 작은 크기, 터치 높이 `--touch-min`(44px) 이상, 포커스 링 `--shadow-focus`. 인라인 style 금지(C-D5).
- 값 변경 즉시 `data-theme` 반영 + 저장. 화면 다시 그리기 없음. 포커스는 select 에 그대로.
- 360px 에서 헤더 한 줄 유지: 이름(말줄임) | 모드 선택 | 로그아웃. 이름 영역 최소 폭은 frontend 가 실측해 정한다(완료 기준 C-T9).
- 상태 알림: 네이티브 select 는 선택값을 읽어 주므로 별도 `aria-live` 알림을 넣지 않는다.

### 6.2 가입 폼

- `login.html` 에 "이름" 필드(`#name`, `autocomplete="name"`, `maxlength` 는 7.3 길이, `aria-describedby="name-error"`, `#name-error`) 추가. **가입 모드에서만 보이고**(`hidden` 토글), 로그인 모드에서는 숨기며 값을 보내지 않는다.
- 위치: 이메일 위(가입 폼 관례). 로그인 모드 첫 포커스는 계속 이메일.
- 클라이언트 검증은 서버와 같은 규칙(7.3)을 `js/lib/validate.js` 에 `validateName` 으로 추가, 실패 시 해당 필드 오류 + 포커스(이메일·비밀번호와 같은 방식). 서버 `fields.name` 도 같은 자리에 표시.
- `api.signup(email, password, name)` 으로 확장.
- JS 없이 제출 시 URL 에 값이 남지 않는 기존 성질 유지(`method="post"`, `nojs-form.spec.js`).

### 6.3 헤더 이름 표시와 폴백

- 표시 텍스트: `user.name` 이 비어 있지 않은 문자열이면 이름, 아니면 `user.email`. **`textContent` 로만** 출력.
- `title` 은 이메일(로그인 ID 확인용). 터치 기기에서 툴팁이 안 보이는 기존 한계는 그대로(권장안이면 `#account` 에서 이메일을 볼 수 있다).
- 요소 id: `#user-email` → **`#user-name`** 으로 바꾼다(이제 이메일이 아니므로). e2e 4곳을 함께 고친다(Q-TN1). 바꾸지 않기로 하면 OQ-N5.
- [R] 헤더 이름은 `#account` 로 가는 링크(`<a href="#account">`)로 만든다. 접근 이름 예: 이름이 있으면 "내 정보: 홍길동", 없으면 "내 정보: a@ex.com, 이름 설정". 말줄임 CSS 유지.

### 6.4 [R] 내 정보 화면 `#account`

- `index.html` 에 `#panel-account` 추가, `js/tabs.js` 의 `TABS` 에 `account` 추가(탭바 활성은 `record`, `#categories` 와 같은 방식).
- 내용: 뒤로 버튼, 제목 "내 정보", 이메일(읽기 전용 텍스트, "로그인에 쓰는 이메일"), 이름 입력 + 저장 버튼, 오류·상태 문구(`role="status"`/`role="alert"`, 카테고리 관리 화면과 같은 패턴). 이름 없는 사용자에게는 안내 문구 "이름을 넣으면 위쪽에 이메일 대신 이름이 보여요."
- 저장 성공 시 헤더 이름 즉시 갱신, 상태 문구 "저장했어요".
- 모드 선택을 이 화면에 함께 둘지는 OQ-T2(기본: 헤더에만).

## 7. API · DB 변경 (backend)

backend 는 구현 전에 `docs/api.md` 를 v4 로 갱신한다(0장 변경 요약 표에 아래 항목, 2장 인증, 8장 마이그레이션 계약 8.5 신설).

### 7.1 스키마 (추가 전용, 멱등)

`src/backend/db/schema.sql` 의 users 정의 뒤에 추가:

```sql
-- v4: 표시용 이름. 기존 사용자는 null (헤더는 이메일로 폴백).
alter table users add column if not exists name text
  check (name is null or char_length(name) between 1 and 20);
```

- **nullable 권장**: 기존 6명에게 값을 만들어 넣을 근거가 없고, 구버전 코드(name 을 모르는 INSERT)가 마이그레이션 후에도 그대로 동작한다. `not null default ''` 는 "빈 이름"이라는 세 번째 상태를 만들어 폴백 판정이 흐려지므로 쓰지 않는다.
- `add column if not exists` 이므로 재실행 시 아무것도 하지 않는다(제약도 다시 만들지 않는다). Postgres(Neon)·PGlite 둘 다 지원 — backend 가 PGlite 에서 두 번 실행 테스트로 확인.
- 기존 컬럼·테이블·인덱스 변경 없음. 데이터 이관(백필) 없음.
- `migrate.js` / `migrate-prod.js` 출력 형식은 바꾸지 않아도 된다. (선택) 성공 출력에 `name 컬럼=있음` 을 덧붙이면 사용자 확인이 쉬워진다 — 하면 api.md 8.3/8.4 출력 예시와 `migrate-prod.test.js` 갱신.
- `seed.js` 는 데모 사용자에게 이름을 넣도록 바꿔도 된다(선택).

### 7.2 API 계약 변경

| 엔드포인트 | 변경 |
|---|---|
| 사용자 객체(공통) | `{ "id", "email", "name" }`. `name` 은 문자열 또는 `null`. signup/login/me/PATCH me 모두 같은 모양. 세션 조회(`session.js` `findSessionUser`)와 로그인 조회 SQL 에 `name` 추가 |
| `POST /api/auth/signup` | 본문 `{ email, password, name }`. `name` **필수**. 실패 시 400 `VALIDATION_ERROR` + `fields.name`(이메일·비밀번호 오류와 함께 모아서). 검사 순서는 기존과 같이 형식 검증(400) → 시도 기록 → INSERT. 이름 형식 오류도 이메일 형식 오류처럼 시도 기록에 넣지 않는다 |
| `POST /api/auth/login` | 요청 불변. 응답 user 에 `name` |
| `GET /api/auth/me` | 응답 user 에 `name` |
| [R] `PATCH /api/auth/me` (신규) | 인증 필요, Origin 필수(1.2 상태 변경 규칙). 본문 `{ "name": "홍길동" }`. 200 `{ "user": {…} }`. 400 `VALIDATION_ERROR` + `fields.name`. `name` 이 없거나 `null`/빈 문자열이면 400(비우기 불가). 다른 필드(email 등)는 무시하고 바꾸지 않는다(무시 vs 400 은 api.md 3A.4 의 기존 관례를 따름). `/api/auth/me` 의 GET 외 메서드 405 목록 갱신 |

### 7.3 이름 검증 규칙 (서버가 기준, 프론트 동일)

1. 문자열이 아니면 "이름을 입력해 주세요."
2. 제어문자 거부: 카테고리와 같은 정규식 `[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]` → "이름에 쓸 수 없는 문자가 있어요." (탭·줄바꿈은 공백으로 취급)
3. 정규화: NFC → 앞뒤 공백 제거 → 연속 공백(탭·줄바꿈 포함) 1칸. **정규화된 값을 저장**한다.
4. 길이: 정규화 후 코드포인트 1~20자(`[...s].length`, DB `char_length` 와 같은 기준) → "이름은 1자 이상 20자 이하여야 해요."
5. 중복 허용, 대소문자 그대로 저장.
6. 보이지 않는 문자(U+200B 등 서식 문자)만으로 된 이름: 이번에는 카테고리와 같은 수준(거부 안 함)으로 두고, 카테고리 검증 통일 후속에서 함께 다룬다(OQ-N3).

- 구현 위치 권장: `src/backend/auth/validate.js` 에 `normalizeName`(카테고리 함수와 같은 형태 `{ name } | { error }`). 프론트는 `js/lib/validate.js` 에 같은 규칙. 공통 정규식은 복사하되 양쪽 단위 테스트에 같은 표(경계값)를 넣는다.

## 8. 운영 반영 순서 (사용자 직접 수행)

새 코드는 signup/login/me 에서 `users.name` 을 읽는다. **컬럼이 없는 DB 에 새 코드가 배포되면 로그인·세션 확인·가입이 전부 500 → 모든 사용자가 앱을 못 쓴다.** 반대로 컬럼만 먼저 추가하면 구버전 코드는 영향이 없다(nullable, 구버전은 name 을 읽지 않음). 따라서:

1. (사용자) Neon 백업 브랜치 생성(예: `backup-before-user-name`).
2. (사용자) `vercel env pull .env.production.local --environment=production` 후 `npm run db:migrate:prod -- --yes`. 출력에 `driver=pg` 확인. 연결 문자열은 채팅에 붙여넣지 않는다.
3. (사용자) Neon SQL Editor 확인(숫자만):
   - `select count(*) from information_schema.columns where table_name = 'users' and column_name = 'name';` = 1
   - `select count(*), count(name) from users;` = (6 이상, 0)
   - `select count(*), sum(amount) from transactions;` 와 `select count(*) from categories;` 가 실행 전과 같음
4. **위 1~3 완료 보고 후에** 메인 세션이 사용자 승인을 받아 푸시(Vercel 배포).
5. 배포 후 `/api/health`, 기존 계정 로그인 → 헤더에 이메일 폴백, 새 계정 가입 → 헤더에 이름, [R] `#account` 에서 이름 저장 확인.
6. 마이그레이션 재실행은 필요 없지만 해도 무해(멱등). 며칠 안정 후 백업 브랜치 삭제, `.env.production.local` 삭제.

- 프리뷰 배포도 같은 Neon DB 를 쓰므로 1~3 은 프리뷰 확인 전에 해야 한다.
- 다크 전환은 DB 와 무관하므로 순서 제약이 없다(같은 커밋에 들어가도 위 순서를 따르면 된다).
- 롤백: 코드를 이전 커밋으로 되돌려도 컬럼이 남아 있어 문제없다. 컬럼 DROP 은 하지 않는다.

## 9. 열린 질문 (메인 세션 → 사용자 확인, 답 없으면 권장값으로 진행)

| ID | 질문 | 권장 기본값 | 비고 |
|---|---|---|---|
| OQ-N1 | 기존 사용자가 이름을 넣고 고칠 방법(`PATCH /api/auth/me` + `#account` 화면)을 이번에 만들까? | **만든다(권장안 R)** | 안 만들면 운영 6명은 계속 이메일만 보인다 |
| OQ-N2 | 이름 최대 길이 | **20자**(코드포인트) | 헤더는 말줄임. 영문 전체 이름이 길면 30 도 가능 |
| OQ-N3 | 보이지 않는 문자·방향 제어 문자(U+200B, U+202E 등) 거부 | **이번에는 카테고리와 같은 수준(제어문자만 거부)**, 후속 통일 시 함께 | 이름은 본인 화면에만 보이므로 위험 낮음 |
| OQ-N4 | 가입 시 이름 필수? | **필수** | 선택으로 하면 신규 사용자도 이메일 폴백이 남는다 |
| OQ-N5 | 헤더 요소 id 를 `#user-email` → `#user-name` 으로 바꿀까? | **바꾼다**(e2e 4곳 동시 수정) | 안 바꾸면 테스트 수정은 줄지만 이름이 내용과 어긋남 |
| OQ-N6 | 헤더 `title` 에 이메일을 남길까? | **남긴다** | 이름과 로그인 ID 를 같이 확인할 수 있다 |
| OQ-T1 | 모드 전환 UI 형태 | **네이티브 select(자동/라이트/다크)** | 대안: 순환 버튼 1개(아이콘 새로 필요), 3버튼 세그먼트(360px 폭 부족) |
| OQ-T2 | 모드 전환 위치 | **메인 헤더에만**(로그인 화면은 저장값만 따름) | [R] `#account` 에도 둘 수 있음 |
| OQ-T3 | 모드 저장 위치 | **기기별 localStorage** | 계정 저장은 스키마·API 추가가 필요해 범위 밖 |
| OQ-T4 | 기본값 | **자동(시스템 설정)** | 지금 동작과 같다 |

## 10. 작업 목록

선행 관계: `→` 앞 작업이 끝나야 시작. 다크 트랙(T)과 이름 트랙(N)은 서로 독립이라 병렬 가능.

| ID | 작업 | 담당 | 의존 |
|---|---|---|---|
| B-TN1 | `docs/api.md` v4: 0장 변경 요약, 2장 사용자 객체·signup·me·[R] PATCH me, 1.1 표(변경 없음 확인), 8.5 마이그레이션 계약(7.1 SQL, 8장 순서). **구현 전에 먼저** 작성하고 메인 세션에 알림 | backend | - |
| B-TN2 | `schema.sql` 컬럼 추가 + 멱등 테스트(PGlite 2회 실행, 기존 사용자 name null, 구버전 방식 INSERT(name 없음) 성공, 21자·빈 문자열 CHECK 위반) | backend | B-TN1 |
| B-TN3 | `validate.js` `normalizeName` + 단위 테스트(경계: 0/1/20/21자, 앞뒤·연속 공백, 탭·줄바꿈, 제어문자, NFC 조합형 한글, 이모지 코드포인트) | backend | B-TN1 |
| B-TN4 | signup 에 name 필수·저장, login/me/`findSessionUser` 에 name, `userBody` 확장 + `auth.test.js`·`api.test.js` 갱신 | backend | B-TN2, B-TN3 |
| B-TN5 | [R] `PATCH /api/auth/me` + 테스트(성공, 정규화 저장, 400, 401, CSRF 403, 다른 사용자 영향 없음, email 불변) | backend | B-TN4 |
| B-TN6 | (선택) migrate 출력 보강, `seed.js` 이름, README 운영 반영 순서(8장) | backend | B-TN2 |
| F-T1 | `js/theme-init.js`(classic, head, CSS 앞) + `js/lib/theme.js`(값 해석·저장·적용 순수 함수) + 단위 테스트(`src/frontend/test/`) | frontend | - |
| F-T2 | 헤더 모드 선택 UI, 즉시 적용·저장, `storage` 이벤트 동기화, 360/768 배치, 라이트·다크 수동/자동 전 조합 화면 점검 | frontend | F-T1 |
| F-N1 | 가입 폼 이름 필드·클라이언트 검증·`api.signup` 확장 + 단위 테스트(`validateName` 은 서버와 같은 경계 표) | frontend | B-TN1(계약) |
| F-N2 | 헤더 이름 표시·폴백, id `#user-name`, `title` 이메일 | frontend | B-TN1 |
| F-N3 | [R] `#account` 패널, `tabs.js`, `api.updateMe(name)`, 저장 후 헤더 갱신 | frontend | B-TN1, F-N2 |
| F-TN9 | 자체 점검: `npm test`, 콘솔 CSP 위반 0, 백엔드 실제 연동으로 가입·로그인·이름 저장 | frontend | F-T2, F-N1~F-N3, B-TN4(B-TN5) |
| Q-TN1 | 기존 테스트 갱신: `e2e/helpers/api.js:48` 가입 헬퍼에 name, `auth.spec.js:52` 사용자 객체, `#user-email` 4곳(`frontend.spec.js:24,196,682`, `categories-ui.spec.js:46`), UI 가입 흐름(C58 등)에 이름 입력, `contract.spec.js:84`·`auth.spec.js:236` 본문 | qa | B-TN4, F-N1, F-N2 |
| Q-TN2 | 신규 e2e `e2e/tests/theme-name.spec.js`(11장 C-T·C-N) + 전체 회귀 mobile-360·tablet-768, `docs/qa-report.md` "다크 전환·이름" 절 | qa | Q-TN1, F-TN9 |
| R-TN1 | 최종 리뷰 | reviewer | Q-TN2 통과 |
| U-TN1 | 운영 마이그레이션(8장 1~3) → 푸시 승인 → 배포 후 확인(8장 5) | 사용자(메인 세션 안내) | R-TN1 "머지 가능" |

## 11. 완료 기준 (QA 체크리스트)

사전 준비는 `plan.md` 9장과 같다. "OS 라이트/다크"는 `page.emulateMedia({ colorScheme })`, "저장값"은 `addInitScript` 로 `localStorage['mb-theme']` 설정. 별도 표시가 없으면 360px 에서 확인한다.

### 11.1 화면 모드 전환

- [ ] C-T1. 저장값 없음: OS 라이트 → `body` 배경 `rgb(247, 245, 240)`, OS 다크 → `rgb(20, 20, 18)`. `<html>` 에 `data-theme` 속성 없음. 헤더 선택값 "자동".
- [ ] C-T2. 저장값 `dark` + OS 라이트 → 다크 값(배경 `rgb(20, 20, 18)`, 글자 `rgb(238, 235, 227)`), 저장값 `light` + OS 다크 → 라이트 값. 메인·로그인 화면 모두.
- [ ] C-T3. 헤더에서 자동→라이트→다크→자동으로 바꿀 때마다 새로고침 없이 즉시 색이 바뀌고, `localStorage['mb-theme']` 가 `light`/`dark`/(없음)이 된다. 새로고침·재방문 후에도 유지된다.
- [ ] C-T4. 깜빡임 없음: 저장값이 OS 와 다를 때 `DOMContentLoaded` 시점과 첫 `requestAnimationFrame` 시점에 이미 `data-theme` 가 저장값이고 `body` 배경이 저장값 색이다. 정적 검사: 두 HTML 의 `<head>` 에서 `js/theme-init.js` 가 첫 `<link rel="stylesheet">` 보다 앞이고 `type="module"`·`defer`·`async` 가 없다.
- [ ] C-T5. 저장값이 `blue` 등 잘못된 값이거나 `localStorage` 접근이 예외를 던지면(addInitScript 로 getItem 을 throw 하도록 대체) 자동으로 동작하고 페이지 오류 0건.
- [ ] C-T6. 다른 탭에서 모드를 바꾸면 열린 탭의 색과 헤더 선택값이 따라 바뀐다.
- [ ] C-T7. 차트: 대시보드를 연 상태에서 모드를 바꾸면 도넛·월별 막대·카테고리 추이의 색이 다시 그리기 없이 해당 모드 토큰 값이 된다(`--viz-N`, 수입·지출 토큰). 수동 다크(OS 라이트)에서 `plan-design.md` C-D8(흰 배경 0, 옛 하드코딩 stroke 0), C-D9(대비), C-D10(오류 색 범위), C-D14(포커스 링 색)를 다시 실행해 통과. 수동 라이트(OS 다크)에서도 C-D9·C-D14 통과.
- [ ] C-T8. 접근성: 모드 선택은 접근 이름 "화면 모드", Tab 으로 도달·`:focus-visible` 링 보임, 키보드로 값 변경 가능, 터치 높이 44px 이상. axe(또는 기존 접근성 검사) 위반 0.
- [ ] C-T9. 360px·768px 에서 헤더가 한 줄이고 이름(또는 20자 이름/긴 이메일)이 말줄임되며 모드 선택·로그아웃 버튼이 잘리거나 겹치지 않는다. 가로 스크롤 없음.
- [ ] C-T10. CSP: 모든 모드·화면에서 콘솔 CSP 위반 0, `plan-design.md` C-D5 정적 검사(인라인 script·`on*=`·`style=`·`<style>`) 통과.

### 11.2 이름

- [ ] C-N1. 스키마: PGlite 에서 마이그레이션 2회 실행 오류 없음, `users.name` nullable, 기존 사용자(마이그레이션 전 생성) name `null`, name 없는 INSERT 성공, 21자 직접 INSERT 는 CHECK 위반.
- [ ] C-N2. 가입 API: `name` 누락/`null`/숫자/공백만/21자/제어문자 포함 → 400 `VALIDATION_ERROR` + `fields.name`, 사용자 생성 안 됨, 시도 기록 안 남음. 이메일·이름 동시 오류면 `fields` 에 둘 다.
- [ ] C-N3. 정규화 저장: `"  홍   길동 "` 가입 → 응답·me 의 `name` 이 `"홍 길동"`. 20자(코드포인트, 이모지 포함) 성공.
- [ ] C-N4. signup·login·me 응답 user 가 정확히 `{ id, email, name }` 이고 비밀번호·해시 없음. 기존 사용자 login/me 는 `name: null`.
- [ ] C-N5. 로그인은 이메일+비밀번호로만 된다(이름으로 로그인 불가, 로그인 요청 형식 불변). 이메일 대소문자·공백 무시 동작 불변.
- [ ] C-N6. 가입 화면: 가입 모드에서만 이름 필드가 보이고 라벨이 연결됨(`getByLabel('이름')`), 로그인 모드에서는 숨김이며 로그인 요청 본문에 name 없음. 클라이언트 오류 시 `#name-error` 표시·`aria-invalid`·포커스, 서버 `fields.name` 도 같은 자리에 표시.
- [ ] C-N7. 헤더: 이름 있는 사용자는 `#user-name` 텍스트가 이름, 이름 없는 사용자는 이메일. `title` 은 이메일. `<b>x</b>`·`<img src=x onerror=…>` 이름이 문자 그대로 보이고 실행되지 않는다.
- [ ] C-N8. [R] `PATCH /api/auth/me`: 성공 시 200 + 정규화된 이름, 이후 me 반영, 다른 사용자 이름 불변, email 필드를 같이 보내도 이메일 불변. 400(검증), 401(세션 없음), 403(Origin 없음/다름), 빈 값으로 비우기 불가.
- [ ] C-N9. [R] `#account`: 헤더 이름 링크로 진입, 이메일 읽기 전용 표시, 이름 저장 후 새로고침 없이 헤더 갱신, 뒤로 가기·새로고침 시 해시 화면 유지, 오류·상태 문구가 role 로 읽힘. 이름 없는 기존 사용자 → 이름 저장 → 헤더가 이메일에서 이름으로 바뀜.
- [ ] C-N10. JS 없이 가입 폼 제출 시 URL·GET 요청에 이름·비밀번호 없음(`nojs-form.spec.js` 확장).

### 11.3 회귀 · 범위

- [ ] C-TN1. `npm test`(백엔드·프론트 단위) 전부 통과, e2e 전체(기존 + Q-TN1 갱신 + 신규) mobile-360·tablet-768 통과. `design.spec.js` 의 `emulateMedia` 다크 검사는 저장값 없음 상태에서 그대로 통과.
- [ ] C-TN2. 기존 기능(거래 저장·수정·삭제, 대시보드, 카테고리 관리, 로그아웃, 세션 만료 안내, 시도 제한) 회귀 없음.
- [ ] C-TN3. 변경 파일이 `src/frontend/public/`(office 제외), `src/frontend/test/`, `src/backend/`, `e2e/`, `docs/`, `README.md` 안에만 있다. `src/frontend/office/`·`tokens.css`·`design_handoff_moneybook/` 변경 없음. 카테고리 검증 규칙 변경 없음.
- [ ] C-TN4. 마이그레이션 계약 문서(api.md 8.5)와 README 에 "백업 → `db:migrate:prod -- --yes` → 확인 쿼리 → 푸시" 순서가 적혀 있다.
- [ ] P-TN1. (사용자 확인) 실제 휴대폰에서 수동 라이트/다크 전환과 재실행 시 깜빡임 없음.
- [ ] P-TN2. (사용자 확인) 운영 마이그레이션 후 8장 3번 쿼리 결과, 배포 후 기존 계정 이메일 폴백·새 계정 이름 표시.

## 12. 충돌 · 위험

| 위험 | 영향 | 대응 |
|---|---|---|
| 마이그레이션 전에 푸시 | 로그인·me·가입 500, 전 사용자 사용 불가 | 8장 순서 고정. 메인 세션은 U-TN1 의 1~3 완료 보고 전 푸시하지 않는다 |
| 프리뷰와 운영이 같은 DB | 프리뷰 배포도 컬럼 없으면 500 | 프리뷰 확인 전에 마이그레이션 |
| 가입 API 가 name 필수로 바뀜 | e2e 가입 헬퍼·계약 테스트 대량 실패 | Q-TN1 에서 헬퍼 한 곳(`e2e/helpers/api.js:48`)과 직접 본문 사용처 갱신 |
| 구버전 `login.js` 가 캐시된 열린 탭 | 이름 없이 가입 → 400(메시지는 기존 오류 영역에 표시) | 수용. js 는 재검증 캐시라 새로고침 시 해소 |
| `auth.spec.js:52` 등 사용자 객체 정확 비교 | 실패 | Q-TN1 |
| `#user-email` id 변경 | e2e 4곳 실패 | Q-TN1 에서 함께 수정(OQ-N5) |
| `theme-init.js` 를 module/defer 로 넣음 | 깜빡임 | C-T4 정적 검사 |
| localStorage 예외(사생활 보호 모드, 저장 거부) | 페이지 오류 | try/catch, C-T5 |
| 헤더 360px 공간 부족 | 버튼 잘림·두 줄 | select 사용, C-T9 |
| 수동 다크에서만 드러나는 색 문제(이전 QA 는 OS 다크만 검사) | 대비 미달·흰 칸 | C-T7 에서 C-D8~C-D10·C-D14 재실행. 단, tokens 의 두 다크 블록 값이 같으므로 이론상 동일 |
| `meta color-scheme="light dark"` + 수동 라이트 + OS 다크 | CSS 로드 전 아주 짧은 어두운 캔버스 가능 | CSS 는 렌더 차단이라 실측상 문제 없을 것으로 봄. P-TN1 에서 확인, 문제 시 frontend 가 theme-init 에서 meta 도 갱신 |
| 이름에 HTML·스크립트 문자열 | XSS | `textContent` 만 사용(기존 규칙), C-N7 |
| 이름을 운영 로그·시도 기록에 남김 | 개인정보 확대 | auth_attempts·로그에 이름을 넣지 않는다 |
| QA 테스트 계정이 운영 DB 에 남아 있음 | name null 계정 증가 | 폴백으로 무해. 기존 수동 삭제 방침 유지 |

## 13. 보고

- 계획서: `docs/plan-theme-name.md`
- 사용자 결정 필요: 9장 OQ-N1(이름 수정 화면, 권장: 만든다), OQ-N2(길이 20), OQ-T1(select) 등. 답이 없으면 권장값으로 진행.
- 운영 반영은 반드시 "백업 → 마이그레이션 → 확인 → 푸시" 순서(8장).
