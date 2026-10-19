# e2e (QA 전용 Playwright 패키지)

앱 런타임과 분리된 별도 패키지다. 루트 package.json에는 Playwright를 넣지 않는다.

## 실행

```bash
cd e2e
npm ci                              # package-lock.json 이 없으면 최초 1회 npm install
npx playwright install chromium
BASE_URL=http://localhost:3000 npx playwright test
```

- `BASE_URL` 기본값은 `http://localhost:3000`. 배포 환경은 `BASE_URL=https://<배포 URL>`.
- 대상 서버는 미리 띄워 둔다(plan 9장 사전 준비: `DB_DRIVER=pglite`, `COOKIE_SECURE=false`, `npm run db:migrate`, `npm run dev`). Playwright가 서버를 띄우지 않는다.
- 테스트 목록만 확인: `npx playwright test --list`
- 한 프로젝트만: `npx playwright test --project=mobile-360`
- 리포트: `npx playwright show-report` (결과 폴더 `test-results/`, `playwright-report/`). 주의: 실행할 때마다 `test-results/` 는 비워진다.

## 프로젝트

| 이름 | 뷰포트 | 실행 대상 |
|---|---|---|
| mobile-360 | 360x740 | 전체 (API 테스트 포함) |
| tablet-768 | 768x1024 | UI 테스트(`frontend`, `dashboard-ui`)만 (C64 는 360px 전용이라 skip) |

`workers: 1` 직렬 실행. 시도 제한 테스트(C40, C41)가 이메일/IP 기준 공유 상태를 쓰기 때문이다.

## 환경변수 (조건부 테스트)

| 변수 | 용도 | 비고 |
|---|---|---|
| `BASE_URL` | 대상 서버 | 기본 `http://localhost:3000` |
| `TRUST_PROXY=true` | 테스트 계정/브라우저 컨텍스트마다 고유 `x-forwarded-for` 를 보냄 | **메인 서버도 `TRUST_PROXY=true` 로 띄워야 함.** 아니면 모든 테스트가 같은 IP(127.0.0.1)로 보여 "같은 IP 가입 10회/시간" 제한(정상 동작)에 걸려 11번째 가입부터 429 |
| `QA_AUX_PORT_BASE` | `managed.spec.js` 가 띄우는 보조 서버 시작 포트 | 기본 3201 |
| `QA_UI_PORT_CLOSED` / `QA_UI_PORT_BROKEN` / `QA_UI_PORT_STOP` | UI 스펙이 띄우는 보조 서버 포트(가입 닫힘 / DB 연결 실패 / 서버 중지 시나리오) | 기본 3512 / 3513 / 3514 |
| `SEED_EMAIL`, `SEED_PASSWORD`, `SEED_TODAY` | 시드 사용자 UI 검증(C32 일부, C34 일부, C62~C65)용 | 없으면 skip. `SEED_TODAY` 는 `2026-10-19` 여야 한다(UI 시각 고정값) |

## 권장 실행 (API + UI 전체)

시드 사용자는 **서버를 띄우기 전에** 같은 `PGLITE_DIR` 로 `seed.js` 를 실행해 만든다(서버 실행 중 같은 디렉터리를 다른 프로세스로 열면 안 된다).

```bash
export DB_DRIVER=pglite COOKIE_SECURE=false QA_TOOLS=true TRUST_PROXY=true PGLITE_DIR=<임시 디렉터리> PORT=3500
node src/backend/db/migrate.js
node src/backend/scripts/seed.js --email=seed-ui@example.com --password=<데모 비밀번호> --today=2026-10-19
node src/backend/scripts/dev-server.js &        # 메인 서버 (3500)

cd e2e
SEED_EMAIL=seed-ui@example.com SEED_PASSWORD=<데모 비밀번호> SEED_TODAY=2026-10-19 \
BASE_URL=http://localhost:3500 TRUST_PROXY=true QA_AUX_PORT_BASE=3520 \
npx playwright test --project=mobile-360
# 같은 환경변수로 --project=tablet-768 (UI 스펙만 실행됨)
# 한 번에 둘 다: npx playwright test --project=mobile-360 --project=tablet-768  (6차 기준 291개 = 290 통과 + C64 skip, 약 4.7분. 여기에 `nojs-form` 2개 추가)
```

- `managed.spec.js` 와 UI 스펙의 일부(가입 닫힘/서버 오류/서버 중지)는 자기 서버를 직접 띄우고 끈다(임시 `PGLITE_DIR`). 메인 서버 없이도 동작한다.
- C40(시각 조정), C43(만료), C60(세션 삭제)은 메인 서버의 `/__qa/*`(QA_TOOLS=true)를 쓴다. QA_TOOLS 가 꺼진 서버면 해당 테스트는 실패/skip.
- UI "오늘"은 브라우저 시각이다. `helpers/ui.js` 의 `newUiPage` 가 `ctx.clock.setFixedTime(2026-10-19 12:00 KST)` 와 `Asia/Seoul` 시간대로 고정한다.
- 로컬에서 `PGLITE_DIR` 없이 `db:migrate`/`dev` 를 돌려도 이제 상위 디렉터리(`.data/` 등)가 자동 생성된다(구 O7 해소, 6차에 빈 디렉터리에서 `db:migrate` 성공 확인). 하네스는 그래도 `PGLITE_DIR` 로 임시 디렉터리를 지정하는 편이 안전하다.
- 끝나면 서버 프로세스를 종료하고 임시 디렉터리를 지운다.

## 구조

- `helpers/env.js` BASE_URL/ORIGIN/SEED_* 등 환경값
- `helpers/accounts.js` 고유 계정 `qa+<타임스탬프>-<n>@example.com`
- `helpers/api.js` API 컨텍스트(쿠키 보관, 상태 변경 요청에 `Origin: <BASE_URL 출처>`), 가입/로그인, `uniqueIp()`(프로세스마다 무작위 기점)
- `helpers/errors.js` 에러 응답 형식(`{error:{code,message}}`) 및 스택/SQL 미노출 검사
- `helpers/server.js` 보조 서버 기동/종료, 임시 PGlite 조회, `/__qa/*` 호출
- `helpers/ui.js` 가로 스크롤, NaN/undefined/Infinity 검사, `newUiPage`(시각 고정·고유 IP 브라우저 컨텍스트), `uiLogin`
- `tests/` 파일별 plan 9장 항목: `auth`(C1,C36,C37,C39,C40,C42~C47), `transactions`(C6~C10,C12,C13,C47,C56), `rules`(C14~C21,C25), `rules-r4`(C22~C24,C68~C71, R4-Q4 관찰), `isolation`(C49~C51), `dashboard-api`(C52~C55), `contract`(api.md 보충), `managed`(C11,C26,C35,C37 닫힘,C38,C41,C48; 서버 직접 제어), `frontend`(C5,C27~C31,C33,C34,C57~C61, 로그인 화면 문구, C32 일부), `dashboard-ui`(C32 일부,C62~C67), `nojs-form`(JS 없이 폼 제출 시 URL 에 입력값이 남지 않음, mobile-360 만)
- 테스트 제목 앞의 `Cxx`가 plan 항목 번호.
- `tablet-768` 프로젝트는 `frontend|dashboard-ui` 스펙만 실행하므로 UI 스펙은 이 두 파일에만 둔다.


## 비밀 값 검색 대비 (plan P2)

- 테스트 코드는 연결 문자열 스킴을 `'postgres' + 'ql://'` 로 조립하고, 더미 비밀번호는 `qa_leak_pw` 같은 이름을 쓴다(PostgreSQL 연결 문자열 스킴, `secret` 문자열 검색에 걸리지 않게).
- 문서의 시드 예시는 `--password=<데모 비밀번호>` 자리표시자를 쓴다. 실제 값은 실행자가 정한다.
