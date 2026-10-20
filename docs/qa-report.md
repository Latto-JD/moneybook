# QA 리포트

작성: qa / 갱신: 2026-10-19 (Q2 6차: reviewer 지적 수정 재검증 + R5 비밀 값 정리) / 대상: plan v2.1, api.md (R4 v2.1)

> 2026-10-21: 카테고리 기능 + 수입·지출 균형 컨셉 검증은 파일 끝의 "카테고리 기능 + 수입·지출 균형 컨셉 검증" 장을 참고한다 (C-C1~C-C38: 38 통과 / 0 실패, 별도 결함 D-C1 1건).

## 요약

| 구분 | 통과 | 실패 | 미실행 | 검증 불가 |
|---|---|---|---|---|
| plan 9장 C 항목 (71개) | 71 (D2 해소 확인) | 0 | 0 | 0 |
| 그 중 UI 항목 (C5, C27~C34, C57~C67, 20개) | 20 | 0 | 0 | 0 |
| 배포 항목 P1~P9, 프로세스 X1 (10개) | - | - | 10 (이번 차수 범위 아님) | - |
| 6차 추가 확인 (10개: npm test, 시도 제한, /__qa Host, 폼 post, O7, R5 검색, 하네스·회귀, 로그인 폼 등 8 + vercel no-store + bfcache) | 8 | 0 | 0 | 2 (vercel.json no-store 로컬 헤더, 실제 브라우저 bfcache) |

- **6차(수정 재검증) 결과: 실패 0.** `npm test` **145/145 통과**. Playwright 전체(mobile-360 + tablet-768, 한 번에) **290 통과 / 0 실패 / 1 skip(C64, 360px 전용)** — 수정 전과 동일한 291개. 이어서 R5 수정 후 영향 spec(`managed`, `frontend`, 신규 `nojs-form`)을 양쪽 프로젝트로 재실행: **103 통과 / 0 실패**. C 항목 71개 모두 통과 유지. 열린 제품 결함 0건.
- 6차 실패/결함 Top 3: (1) 없음(실패 0). (2) **검증 불가**: `vercel.json` 의 `/`, `/index.html` `Cache-Control: no-store` 는 로컬 dev-server 가 `Cache-Control: no-cache` 로 응답하므로 로컬에서 확인할 수 없다(배포 후 P 항목에서 `curl -I` 필요; JSON 문법은 파일 로드로 확인되지 않았고 육안 확인만 함). (3) **검증 한계**: bfcache 복원(C59 뒤로가기, pageshow 처리)은 Playwright chromium 에서 복원이 일어나지 않아 실제 브라우저 동작은 수동 확인이 필요하다. 또 P1~P9, X1 은 계속 미실행.

- **5차(D2 재검증, 전체 재실행) 결과**: `npm test` 135개 전부 통과. 하네스(TRUST_PROXY + 고유 x-forwarded-for, 시드 사용자)로 Playwright **전체**를 두 프로젝트 모두 한 번에 실행: **mobile-360 233개 = 233 통과 / 0 실패 / 0 skip**, **tablet-768 58개 = 57 통과 / 0 실패 / 1 skip(C64, 360px 전용으로 의도적)**. 합계 291개 중 290 통과, 0 실패, 1 skip. 이전에 429 로 못 돌렸던 월 이동/탭 테스트, 768px C29 전체 포함 모두 통과. `C29(Enter 추가4)` 양쪽 폭 통과 = **D2 해소**. 이번에 시나리오 2개 추가(추가5 서버 건수 확인, 추가6 실패 후 재시도), 양쪽 폭 통과. 실행 시간 약 4.6분.
- (아래 3차 수치는 이력) Playwright: **mobile-360 227개 = 226 통과 / 1 실패 / 0 skip**, **tablet-768 52개 = 50 통과 / 1 실패 / 1 skip**(C64는 360px 전용이라 768에서 의도적 skip). 합계 279개 중 276 통과, 2 실패(같은 테스트가 두 뷰포트에서 실패), 1 skip. `test.fixme` 는 0개(전부 해소).
- (3차 이력) `npm test`(루트): **130개 통과 / 0 실패** (2차 때 116개에서 R4 v2.1 테스트 등으로 증가).
- C 항목 집계: C1~C26(26) + C27~C34(8) + C35 + C36~C56(21) + C57~C67(11) + C68~C71(4) = 71개. 2차(백엔드/API) 47개는 이번 전체 재실행에서도 모두 통과, 신규 C68~C71 4개 통과, UI 19개 통과, C29 1개 실패.

실패/결함 Top 3 (심각도 순):
1. **(해소) D2 Enter 이중 저장.** frontend 가 `record.js` 에 `submitting` 플래그를 넣은 뒤 `C29(Enter 추가4)`(응답 800ms 지연 중 Enter 2회 → POST 1회) 양쪽 폭 통과. 추가5(Enter 3회 → UI 1행 + 서버 `GET /api/transactions` 1건)와 추가6(실패 후 재시도)도 통과. 열린 제품 결함은 0건.
2. **(해소, 6차) 구 B1/O7** `.data/` 자동 생성 확인(아래 O7).
3. (관찰) O1 도넛 범례 % 반올림 차이, O2 미래 날짜 거래의 R4 포함은 이전과 동일(결함 아님, 아래 참고). P1~P9(배포), X1 은 이번에도 미실행.

## 실행 환경

- Node v24.20.0 (package.json `engines` 22.x. 로컬 동작에는 문제 없음), Playwright 1.64.1 chromium.
- 메인 서버: `DB_DRIVER=pglite COOKIE_SECURE=false QA_TOOLS=true TRUST_PROXY=true PORT=3500` + 임시 `PGLITE_DIR`. **서버를 띄우기 전에** `migrate.js` 와 `seed.js --email=seed-ui@example.com --password=<데모 비밀번호> --today=2026-10-19`(거래 127건) 실행. e2e 는 `TRUST_PROXY=true`, `QA_AUX_PORT_BASE=3520`, `SEED_EMAIL/SEED_PASSWORD/SEED_TODAY` 지정.
- UI "오늘": 브라우저 컨텍스트에 `ctx.clock.setFixedTime(2026-10-19 12:00 KST)` + `Asia/Seoul` 고정(`e2e/helpers/ui.js newUiPage`). 컨텍스트마다 고유 `x-forwarded-for`.
- 보조 서버(스펙이 직접 기동/종료): 3520~(managed), 3512(가입 닫힘), 3513(DB 연결 실패), 3514(서버 중지 시나리오). 3000, 3200~3300, 3400, 8765 는 사용하지 않음.
- 종료 확인: 3500, 3512~3514, 3520~ LISTEN 없음(`netstat`), 임시 PGlite 디렉터리 삭제. 저장소 루트 `.data/pglite` 는 5차 중 22:16 에 생성돼 있었고(O7 참고) 그대로 둠. **8765 는 실행 전후 동일(PID 1688, LISTEN 그대로)**.

## 실행한 명령과 결과

| 명령 | 결과 |
|---|---|
| 6차: `npm test` | tests 145, pass 145, fail 0, 약 20초 |
| 6차 메인 서버: `DB_DRIVER=pglite COOKIE_SECURE=false QA_TOOLS=true TRUST_PROXY=true PORT=3500 PGLITE_DIR=<임시>` → `migrate.js` → `seed.js`(거래 127건) → `dev-server.js` | 정상 기동. 종료 후 3500 LISTEN 없음(PID 종료), 8765 는 PID 1688 그대로, 임시 디렉터리 삭제 |
| 6차: `cd e2e && SEED_* BASE_URL=http://localhost:3500 TRUST_PROXY=true QA_AUX_PORT_BASE=3520 npx playwright test --project=mobile-360 --project=tablet-768` (전체) | **290 passed, 1 skipped(C64), 0 failed**, 4.7분. 로그인 제한(C40/C41/C58 6번째 429), C59, C60, 로그인 화면 폼, 기록 삭제/저장 회귀 전부 포함 |
| 6차: `probe.mjs`(직접 HTTP 호출, 임시 스크립트) | 아래 "6차 상세 1" |
| 6차: `... --project=mobile-360 tests/nojs-form.spec.js` (JS 비활성 컨텍스트로 submit) | 2 passed |
| 6차: R5 수정 후 `... --project=mobile-360 --project=tablet-768 tests/managed.spec.js tests/frontend.spec.js tests/nojs-form.spec.js` | 103 passed, 0 failed, 2.7분 |
| 6차: 빈 임시 디렉터리에서 `DB_DRIVER=pglite node <저장소>/src/backend/db/migrate.js` (PGLITE_DIR 미지정), 및 `PGLITE_DIR=<임시>/a/b/c` | 둘 다 `마이그레이션 완료`, 종료 코드 0. `.data/` 와 `a/b/c` 가 자동 생성됨 |
| `npm test` (루트) | 4차: tests 135, pass 135, fail 0, 약 20초 (3차: 130/130) |
| 5차: `cd e2e && SEED_* BASE_URL=http://localhost:3500 TRUST_PROXY=true QA_AUX_PORT_BASE=3520 npx playwright test --project=mobile-360 --project=tablet-768 -g C29` | 28개 전부 통과(양쪽 폭 각 14개: 추가1~6 포함) |
| 5차: 같은 환경변수로 `npx playwright test --project=mobile-360 --project=tablet-768` (전체, 한 번에) | **290 passed, 1 skipped, 0 failed**, 4.6분. mobile-360 233 통과, tablet-768 57 통과 + C64 skip. frontend/dashboard-ui/rules-r4/managed/contract 및 나머지 spec 전부 포함 |
| 5차 메인 서버: `DB_DRIVER=pglite COOKIE_SECURE=false QA_TOOLS=true TRUST_PROXY=true PORT=3500 PGLITE_DIR=<임시>` → `migrate.js` → `seed.js --email=seed-ui@example.com --password=<데모 비밀번호> --today=2026-10-19`(거래 127건) → `dev-server.js` | 정상 기동, 종료 후 3500 LISTEN 없음(8765 PID 1688 그대로), 임시 PGlite 삭제 |
| 5차: 빈 작업 디렉터리에서 `DB_DRIVER=pglite node <저장소>/src/backend/db/migrate.js` (`PGLITE_DIR` 미지정) 및 `PGLITE_DIR=<없는 상위>/a/b/c` | 둘 다 `마이그레이션 실패: ENOENT` (재현됨, O7) |
| 4차: `cd e2e && ... npx playwright test --project=mobile-360 또는 tablet-768 -g C29` | 각 11개: 10 통과 / 1 실패(추가4). 칩 직후 Enter 포함 나머지 전부 통과 |
| 4차: `... --project=mobile-360 또는 tablet-768 tests/frontend.spec.js tests/dashboard-ui.spec.js` | mobile-360 55 통과 1 실패(추가4), tablet-768 54 통과 1 실패(추가4) 1 skip(C64). 그 외 회귀 없음 |
| `cd e2e && BASE_URL=http://localhost:3500 TRUST_PROXY=true npx playwright test --project=mobile-360 tests/rules-r4.spec.js tests/rules.spec.js` (R4 선행 확인) | 37 passed |
| `... npx playwright test --project=mobile-360` (SEED_* 지정, 전체) | **226 passed, 1 failed**, 약 120초. 실패 = `frontend.spec.js C29(Enter) 금액 -> 카테고리 칩 -> Enter 로 저장` |
| `... npx playwright test --project=tablet-768` (UI 스펙만) | **50 passed, 1 failed, 1 skipped**, 약 39초. 실패 = 위와 같은 C29(Enter), skip = C64(360px 전용) |
| `curl` 로 시드 사용자 `/api/insights?month=2026-10&today=2026-10-19` | 아래 (A) 참고 |

중간 과정(근거): 처음 `uniqueIp()` 가 `Date.now()%250` 기점이라 1시간 내 이전 실행과 IP 가 겹치면 "IP 가입 10회/시간" 429 로 C58 429 시나리오(가입 10회를 채우는 사전 단계)가 1회 불안정하게 실패했다. 서버 결함이 아니라 하네스 문제라 `e2e/helpers/api.js` 를 프로세스마다 무작위 기점으로 고쳤고 이후 재실행에서 안정적이었다. 대시보드 UI 테스트 중 (a) `accessible description` 을 기대했으나 구현은 `aria-labelledby="제목 요약"` 두 요소를 이름으로 쓰는 구조(plan 은 "접근 가능한 이름"만 요구)라 기대를 이름 검사로 정정, (b) 월 이동 직후 KPI 비교가 재조회 전 값을 읽는 경합이 있어 `expect.poll` 로 정정했다. 모두 테스트 오류이며 제품 결함이 아니다.

## (A) R4 v2.1 재검증

`e2e/tests/rules-r4.spec.js`(신규, 27개, 사례마다 새 사용자, 비반복은 서로 다른 메모) — **전부 통과**. 기존 `rules.spec.js` 의 구 R4 describe(v2 기대값)는 제거해 이 파일로 옮겼다.

| 항목 | 결과 | 근거 |
|---|---|---|
| C22 exceeded (v2.1) | 통과 | 식비 100,000x3 + 120,000 → exceeded(ratio 1.2), 119,999 → 없음. 사례 3: 월세+입주청소 → exceeded, currentTotal 600,000(반복 포함), ratio 1.2, recurring 에 월세. 사례 10: 09-01 월세 600,000 → 그룹 미감지(recurring 에 월세 없음) + exceeded ratio 1.2 |
| C23 pace (v2.1) | 통과 | 비반복 2건 20,000+24,000=44,000 → pace(projectedTotal 132,000, ratio 1.32). 43,334(20,000+23,334) → pace(130,002, ratio 1.3), 43,333 → 항목 없음. today=09-06 → 없음(경과일 6). 31일 달(10월, today=10-10) 44,000 → projected 136,400 |
| C24 제외 | 통과 | 1개월만 기록 → 없음. baseline 9,999 → 없음(대조: 10,000 이면 exceeded). C23 데이터를 month=2026-08, today=2026-09-10 으로 조회 → pace 없음(대조: 09월 조회는 pace) |
| C68 반복 제외 | 통과 | 사례 1, 2 → 주거/통신 항목 없음 + recurring 월세 monthly. 사례 11(필라테스 주간 15건, 06-04~09-10) → 의료/건강 항목 없음 + recurring 필라테스 weekly occurrences 15 |
| C69 2건 기준 | 통과 | 사례 4 → 없음. 사례 5 → pace, currentTotal 95,000, projectedTotal 285,000, ratio 2.85. 44,000원 1건만 → 없음 |
| C70 R3 경계 | 통과 | 사례 6 → 없음, recurring 에 유튜브 프리미엄 없음. 사례 7 → pace(29,900 / 89,700 / 2.99). 사례 8 → 없음. 사례 9 → pace(currentTotal 30,000, projected 39,000, ratio 1.3), 책 6,999원 → 없음 |
| C71 그룹 키 연결 | 통과 | (a1) 09-05 메모 `" 넷플릭스  "` → 사례 9 와 동일. (a2) `Netflix`/`NETFLIX`/`netflix  `/` NetFlix` 대소문자·공백 차이 → 동일 그룹, pace 39,000. (a3) `Netflix  Premium`/`netflix premium` 내부 연속 공백 → 동일. (b) 메모 없는 55,000x4 + 3,000 + 4,000 → recurring 에 주거/통신 55,000 monthly, overspending 항목 없음. (대조) 메모 같고 이번 달 건만 카테고리 `기타` → recurring 은 monthly 4건, 기타 항목 없음(이 대조 케이스는 기타 baseline 이 없어 판정 자체가 안 나오므로 증명력이 약함) |
| C26 시드 사용자 | 통과 | `managed.spec.js C26` 를 v2.1 기대로 수정(월세·넷플릭스가 overspending 에 없음, 쇼핑·식비 exceeded, 교통 pace, recurring 에 월세·넷플릭스) + 통과 |

**(A) 시드 사용자 실측** (`seed.js --today=2026-10-19`, `/api/insights?month=2026-10&today=2026-10-19`):
`overspending = [쇼핑 exceeded 290,000/baseline 100,000/ratio 2.9, 식비 exceeded 420,000/300,000/1.4, 교통 pace currentTotal 50,000/baseline 60,000/projected 81,579/ratio 1.36]`. **주거/통신(월세)·문화/여가(넷플릭스)는 없음** (2차 리포트의 O1 오탐 해소). `recurring = 스타벅스(weekly), 월급(monthly), 월세(monthly), 넷플릭스(monthly)`, `largeExpenses` 1건(패딩). UI 에서도 같은 결과가 인사이트 영역에 표시됨(C34).

## (B) UI 항목 결과 (mobile-360 / tablet-768 모두 실행)

| 항목 | 결과 | 근거 (스펙, 요약) |
|---|---|---|
| C5 정적 HTML | 통과 | `/`, `/login.html` 200 HTML, viewport 메타, src 없는 `<script>`·`on*=` 속성·외부 URL 없음 |
| C27 정적 접근성 | 통과 | 기록 탭: `#amount[inputmode=numeric]`, 모든 input 에 label, `select` 0개, 카테고리 버튼 칩 8개(수입 4개). 로그인 화면: label, `type=email/password`, `autocomplete` |
| C28 유틸 | 통과 | 프론트 `lib/money.js`·`chart-geometry.js` 를 Node 에서 직접 import: `"12,500"`→12500, `"abc"/""/"0"/-5/1.5/100,000,001` 무효, 1·100,000,000 유효, `12500`→`"12,500원"`, 도넛/비율/눈금/막대 함수에 합계 0 입력 시 빈 결과·NaN 없음. `npm test` 130/130 |
| C29 기록 입력 | 통과 | 5차: 양쪽 폭 14개 전부 통과. 금액 → 칩 → Enter 저장, 추가1(선택 전 칩 Enter/Space 는 선택만, POST 0), 추가2(금액 비면 오류, POST 0), 추가3(한 번 Enter → POST 1), **추가4(응답 800ms 지연 중 Enter 2회 → POST 1, 행 1)**, **추가5(Enter 3회 → UI 행 1, 서버 거래 1건)**, **추가6(첫 저장 요청 abort → "네트워크" 오류 + 저장 버튼 활성 + 행 0 → 칩에서 재시도 Enter 2회 → 저장 성공, POST 총 2(실패 1+성공 1), 행 1)**. 이전 통과 부분(저장 버튼 저장, 금액칸 Enter, 날짜, 수정/삭제, 월 이동, 탭)도 재통과 |
| C30 빠른 입력 | 통과 | 같은 (카테고리, 메모) 3건 → `#quick-chips` 칩 클릭 1회(메모·금액·카테고리 채움, `#save-btn` 포커스) + 저장 클릭 1회 = 2번 클릭으로 4번째 기록. 후보 없으면 섹션 숨김 |
| C31 자동완성 | 통과 | 메모 "스타" 입력 → `#memo-suggestions` 에 "스타벅스 · 카페/간식 · …" 표시, 선택 시 메모/카테고리 칩(aria-pressed)/금액(가장 최근 거래 4,500) 채움 |
| C32 가로 스크롤/터치 | 통과 | 360·768 모두: login, 기록 탭(시드: 목록·인사이트·빠른입력·수정 모드·자동완성 포함), 대시보드(6/12개월, 표 모두 펼친 상태, 빈 상태) `scrollWidth <= viewport`. 주요 버튼(로그인/가입 전환·제출, 비밀번호 보기 label, 타입 버튼, 칩, 저장/취소, 월 이동, `.tx-edit`, `.tx-del`, 탭 링크, 로그아웃, `summary`, 범위 버튼, 카테고리 추이 칩) 모두 44x44px 이상 |
| C33 오류 처리 | 통과 | (1) 실제 서버 400: 요청 본문 amount 를 0 으로 바꿔 전달 → `#tx-error`·`#amount-error` 에 "금액은 1 이상 100000000 이하의 정수여야 해요." 표시, 금액·메모·카테고리 유지, 저장 버튼 복구. (2) 요청 차단(abort) → "네트워크 연결을 확인하고 다시 시도해 주세요.", 복구 후 재저장 성공. (3) 보조 서버를 실제로 종료한 뒤 저장 → 같은 문구, 화면 멈춤 없음(메모 입력 가능) |
| C34 인사이트 | 통과 | 신규 사용자 빈 상태 "아직 알려드릴 내용이 없어요…". R3 `곧 예정`(dueSoon, `.insight.strong`)/일반 `반복`, R4 `초과`, R5 `큰 지출`(배수 문장), 아이콘 `aria-hidden`+텍스트 라벨. 시드 사용자: 쇼핑 190%·식비 40% 초과, 교통 "페이스 주의 … 81,579원 예상", 월세·넷플릭스는 과소비 알림에 없고 반복 거래에 있음, 패딩 큰 지출 |
| C57 리다이렉트 | 통과 | 비로그인 `/` → `/login.html`, 로그인 상태 `/login.html` → `/` |
| C58 가입 | 통과 | 가입 → 앱 진입(금액칸 포커스, `#user-email`). 중복(대문자로 입력) "이미 가입된 이메일이에요"+이메일 유지. 7자 "비밀번호는 8자 이상이어야 해요"+이메일 유지(요청 없음). 실제 429(같은 IP 가입 10회 후) "시도가 너무 많아요. N분 후 다시 시도해 주세요"+이메일 유지. 로그인 5회 실패 후 6번째 "시도가 너무 많아요. 15분 후 다시 시도해 주세요". 가입 닫힘 서버 "지금은 새로 가입할 수 없어요. 관리자에게 문의해 주세요". DB 연결 실패 서버 "서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요."(연결 문자열 미노출). 틀린 비밀번호 "이메일 또는 비밀번호가 맞지 않아요"(role=alert). `?expired=1` "로그인이 만료되었어요. 다시 로그인해 주세요". 모드 전환 버튼 문구 "로그인"/"가입하기", `#show-password` 토글 |
| C59 로그아웃 | 통과 | `#logout-btn` → `/login.html`, 이전 쿠키로 `/api/auth/me` 401, 뒤로가기 → 다시 `/login.html`, 본문에 메모·이메일 없음, `#tx-list` 없음 |
| C60 세션 소멸 | 통과 | `/__qa/delete-sessions?email=` 후 저장 → `/login.html?expired=1`, "로그인이 만료되었어요. 다시 로그인해 주세요" |
| C61 XSS | 통과 | 메모 `<img src=x onerror=alert(1)>` 가 `#tx-list`, `#quick-chips`, `#insights`(반복 거래), `#memo-suggestions`(자동완성)에 글자 그대로 표시, `img[src="x"]` 0개, dialog 이벤트 0회 |
| C62 시드 대시보드 | 통과 | KPI 수입/지출/잔액·전월 대비 문구("▲ 지난달보다 N.N% 더 썼어요")가 `stats/monthly` 와 일치. 도넛 범례 카테고리·금액·%, 중앙 총지출, 표 행·합계(100.0%)가 `stats/categories` 와 일치, % 는 `N.N%` 형식. 월별 추이 표(수입/지출/잔액 6행)·카테고리 추이 표(6행+합계)가 API 와 일치. 관찰사항 O1 |
| C63 접근성 | 통과 | 차트 3개 모두 `figure`+`figcaption`, `svg[role=img]` 이름(`aria-labelledby` 제목+요약), `table` caption, 모든 `th[scope]`, "표로 보기" details(닫힘 시 표 숨김, 열면 표시). 월별 범례에 "수입 (사선 무늬)"/"지출 (단색)". 도넛 범례 카테고리·금액·% 텍스트, 금액 내림차순, 조각 수=범례 수, 조각 fill 모두 상이. 수입 막대 fill=`url(#…)`(실존하는 pattern), 지출 막대=단색, 범례 견본도 동일 |
| C64 360px 텍스트 높이 | 통과 | 360px, 6·12개월 모두: svg 텍스트 22개 `getBoundingClientRect().height` 최소 15.00px(기준 11px), 범례 21개 최소 24.00px. 참고: 글자 크기 렌더링 환산값(12px x 축소비) 최소 11.48px. 12개월 월 레이블 `11월,1월,3월,5월,7월,9월`(격월, "N월" 형식, 겹침 없음), 표는 12행 |
| C65 상호작용 | 통과 | `#dash-prev`/`#dash-next`(2026년 9월↔10월, KPI·도넛·요약 갱신), `#range-6`↔`#range-12`(추이 표 6↔12행, aria-pressed), 카테고리 칩 선택(figcaption "<카테고리> 월별 지출 추이"·표 갱신). 전 과정에서 `window.__qaMarker` 유지(새로고침 없음), `#dash-error` 빈 값 |
| C66 빈 상태 | 통과 | 신규 사용자: 도넛·월별·카테고리 추이 모두 `.chart-empty` "아직 이 기간에 기록이 없어요", svg 0개, KPI 3개(0원)+"비교할 지난달 기록이 없어요", 12개월 선택 후에도 `NaN/undefined/Infinity` 없음 |
| C67 탭 전환 재조회 | 통과 | 대시보드 지출 5,000원 → 기록 탭에서 UI 로 12,500원 저장 → 대시보드 17,500원, 도넛 범례 2개 → 삭제 후 다시 5,000원 |

색 대비(plan 4.6 "그래픽 요소 대비 3:1 이상", C 항목은 아님): 브라우저 측정 도구는 없어 **렌더링 측정은 검증 불가**. 대신 소스(`charts.js PALETTE`)의 색을 WCAG 상대 휘도 공식으로 계산: 흰 배경(#fff)에서 5.19 / 4.67 / 4.53 / 5.40 / 5.87 / 8.86 / 5.08 / 5.70, 페이지 배경(#f4f6f9)에서 최소 4.19 로 모두 3:1 이상(수식 계산이며 렌더링된 화면 측정이 아님).

## 6차 상세

### 6차 상세 1. 로그인/가입 시도 제한 (새 방식: 실패 선기록 후 count > max 면 429)

직접 HTTP 호출(서버 TRUST_PROXY=true, 요청마다 고유 x-forwarded-for, 신규 이메일). 결과: 통과.

| 시나리오 | 기대 | 실제 |
|---|---|---|
| 같은 이메일, 틀린 비밀번호 10건 **병렬** | 401 최대 5건, 나머지 429 (병렬 우회 없음) | 401 x5, 429 x5 |
| 위 이후 올바른 비밀번호 | 429 (잠금 유지) | 429 |
| 틀림 3회 -> 정답(200) -> 틀림 5회 -> 정답 | 성공 시 실패 기록 초기화: 3회 후 성공해도 이후 5회까지 401, 6번째 429 | 401,401,401,200,401,401,401,401,401,429 |
| 존재하지 않는 이메일 7회 | 5회 401, 이후 429 (계정 존재 여부와 동일 동작) | 401 x5, 429 x2 |

e2e 의 로그인 제한 테스트(C40, C41, frontend "로그인 연속 실패 5회 후 6번째 -> 15분", C58 가입 429)는 새 동작과 충돌하지 않고 양쪽 폭에서 그대로 통과했다. 따라서 테스트 가정이 낡은 부분도, 제품 결함도 발견하지 못했다. 한계: 429 시 "자기 기록 삭제"는 외부에서 관측되지 않아 별도로 검증하지 않았다(unit 테스트 범위; `npm test` 145 통과). 로그인 중 cleanup 5% 확률 await 도 확률적이라 직접 검증하지 않았다.

### 6차 상세 2. /__qa Host 검사

`/__qa/delete-sessions` 에 Host 헤더만 바꿔 호출: `localhost:3500` -> 400(Host 통과, email 파라미터 검증 단계), `127.0.0.1:3500` -> 400(동일), `evil.example.com` -> **403**. 하네스(managed/C40/C43/C60)는 모두 통과해 정상 동작.

### 6차 상세 3. 폼 method=post, JS 없이 제출

`e2e/tests/nojs-form.spec.js`(신규): `javaScriptEnabled: false` 컨텍스트에서 `/login.html` 에 이메일/마커 비밀번호 입력 후 Enter -> 최종 URL 과 모든 요청 URL 에 비밀번호가 없고 `POST` 요청이 발생. `/`(기록 폼)도 금액 값이 URL 에 남지 않음. 2개 통과. 한계: 대조군(GET 폼이면 실패함)은 소스를 바꿀 수 없어 확인하지 못했다.

### 6차 상세 4. 정적 헤더 (vercel.json)

로컬 dev-server: `/` 는 CSP 포함 `Cache-Control: no-cache`, `/login.html` 은 `no-cache`. `vercel.json` 의 `no-store` 는 Vercel 에서만 적용되므로 **로컬 검증 불가**. 배포 후 `curl -I <URL>/` 와 `/index.html` 로 확인 필요.

### 6차 상세 5. 그 외 회귀

로그아웃 후 뒤로가기(C59), 로그인 화면 폼 동작(모드 전환/검증/오류/429), 기록 화면 삭제·저장(C29 수정/삭제 포함, 추가1~6)이 양쪽 폭에서 통과. bfcache/pageshow 는 위 Top 3 (3) 참고.

## R5. 비밀 값 검색 정리 (plan P2)

변경: `e2e/tests/frontend.spec.js`, `e2e/tests/managed.spec.js` 의 연결 문자열을 `'postgres' + 'ql://' + ...` 조립으로 바꾸고 더미 값 `qa_secret_pw` -> `qa_leak_pw`(의미 유지: 오류/로그에 비밀번호·사용자·호스트가 노출되지 않아야 함), `'secretpw1'` -> `'toggle-pw-1'`, `managed.spec.js` 의 `--password=` 템플릿을 분리 조립. 문서의 `--password=demopass123` 은 `--password=<데모 비밀번호>` 로 교체(README.md, e2e/README.md, 이 리포트). 해당 spec 은 수정 후 재실행해 통과(103 통과).

검색 범위(건수는 이 리포트 표와 e2e/README.md '비밀 값 검색 대비' 절처럼 패턴 이름을 설명하려고 적은 줄은 제외한 값이며, 그런 줄은 `password=`/`secret`/`sk-`/`AKIA`/`-----BEGIN` 검색에 자기 자신이 걸린다. 배포 전 검색에서는 `docs/qa-report.md`, `e2e/README.md` 도 예외 처리하거나 문구를 바꿔야 한다): 저장소 전체, `node_modules`, `.data`, `src/frontend/office`, 생성물(`playwright-report`, `test-results`; .gitignore 대상) 제외, 대소문자 무시. 진짜 비밀 값: **없음**(`.env` 파일 없음, `.env.example` 는 키 이름만 있고 값 비어 있음, 키/토큰 패턴 0건).

| 패턴 | 건수 | 위치 / 판정 |
|---|---|---|
| `postgres`+`ql://` (한 문자열) | 2 | `docs/plan.md` 559, 670행 (P2 검사 규칙을 설명하는 문구) |
| `postgres://` (이 표 밖에서) | 2 | 위와 같은 plan.md 두 행 |
| `password` + `=` | 12 | plan.md 531, 559 (규칙/CLI 설명); README.md 75, e2e/README.md 46, 50(`SEED_PASSWORD=`, 대소문자 무시로 걸림), docs/qa-report.md 30, 49 (모두 `<데모 비밀번호>` 자리표시자); src/backend/scripts/seed.js 1, 105 (사용법 문구, `...`/자리표시자); src/backend/test/app.test.js 70 (`password=b` 폼 파싱 입력), scripts.test.js 18, 28 (`password123` 단위 테스트 더미) |
| `secret` | 0 | 수정 후 0건 |
| `sk-` | 0 | |
| `AKIA` | 0 | |
| `-----BEGIN` | 0 | |

참고: plan.md 는 planner 영역이라 건드리지 않았다. P2 의 "커밋된 파일 전체에서 PostgreSQL 연결 문자열 스킴 0건" 기준을 그대로 적용하면 **plan.md 의 규칙 설명 문구 두 행이 걸린다**(실제 비밀 아님). 배포 전 검색에서 `docs/plan.md` 를 제외하거나 문구를 조정해야 한다. src 의 `password=` 단위 테스트 더미 3건과 seed.js 사용법 2건도 `password=` 검색에는 걸리지만 값은 더미/자리표시자다(소스 영역이라 수정하지 않음).

## 결함

### D1. (해소) 카테고리 칩을 누른 직후 Enter 로 저장되지 않음 (C29)
- frontend 수정(`lib/chip-keys.js`, `record.js` #category-chips keydown) 후 `C29(Enter)` 가 mobile-360, tablet-768 모두 통과.

### D2. (해소) 저장 응답 전 Enter 를 두 번 누르면 이중 POST
- 수정: `src/frontend/public/js/record.js` 의 `submitting` 플래그(`onSubmit` 진입 시 확인, `finally` 에서 해제).
- 재검증(5차): 추가4(POST 1회), 추가5(Enter 3회, 서버 목록 1건 = 중복 거래 없음), 추가6(실패 후 `finally` 로 플래그·버튼이 풀려 재시도 가능, 재시도 중 이중 Enter 도 POST 1회) 모두 mobile-360, tablet-768 통과.
- 한계: 서버 측 멱등성(같은 요청 2번 오면 2건)은 이번 범위 밖이며 검증하지 않았다(클라이언트 방어만 확인). 다른 탭/기기에서 동시 제출은 대상 아님.

## 관찰사항 (결함 아님)

- **O1. 도넛 범례 %의 반올림 기준.** UI 는 `value/total` 로 직접 % 를 계산한다. API `ratio`(소수 넷째 자리 반올림)를 %로 바꾸면 시드 기준 6행 중 2행이 0.1%p 다르다(UI 32.5% / 1.0%, API ratio 환산 32.6% / 1.1%). 이중 반올림 때문이며 UI 값이 정확하다. plan C62 는 "소수 첫째 자리 %"만 요구하므로 통과로 판정했고, 테스트는 금액 기반 값을 기대값으로 쓴다(스펙 annotation 에 차이 기록).
- **O2. 미래 날짜 거래의 R4 포함 (R4-Q4).** `date > today` 인 이번 달 거래가 `currentTotal` 과 exceeded 판정에 포함된다. 예: baseline 100,000x3, today=2026-09-10 에서 09-25 거래 130,000원 → `exceeded`, currentTotal 130,000, ratio 1.3 (`rules-r4.spec.js` "관찰사항 O-R4-Q4"에 현재 동작을 고정). api.md 6.3 에 명시된 동작이며 결함으로 단정하지 않는다.
- **O3. 가입 10회/시간 IP 제한과 QA.** 한 IP 로 계정을 계속 만들면 11번째부터 429 (정상). 서버·e2e 모두 `TRUST_PROXY=true` 가 필요하다. UI 컨텍스트도 고유 `x-forwarded-for` 를 보낸다. 배포 환경(P 항목)에서는 쓸 수 없다.
- **O4. 접근 가능한 이름.** 차트 SVG 는 `aria-labelledby` 로 `<title>`+`<desc>`(요약 문장)를 묶어 이름으로 쓴다. 별도의 `aria-describedby` 설명은 없다(plan 은 이름만 요구, 문제 아님).
- **O5. 2차 O1(월세 pace 오탐) 해소.** 시드 사용자 결과는 위 (A) 참고. 2차 O2(IP 제한), O3(DB 장애 시 형식이 틀린 쿠키는 401)은 그대로이며 이번 범위 밖.
- **O6. 테스트 한계.** C71 의 마지막 대조 케이스(메모 같고 카테고리가 다른 이번 달 건)는 `기타` baseline 이 없어 판정 자체가 나지 않으므로 "다른 카테고리여도 제외"를 직접 증명하지는 못한다(recurring 감지 확인까지). C33 의 서버 400 은 UI 가 클라이언트 검증으로 대부분 막기 때문에, 실제 서버 400 을 얻으려고 요청 본문의 amount 를 가로채 0 으로 바꾸는 방식을 썼다(서버 응답은 진짜). C59 뒤로가기는 Playwright chromium 에서 bfcache 복원이 일어나지 않는 환경이다(실제 브라우저의 bfcache 동작은 별도 수동 확인이 필요할 수 있음).
- **O7. (해소, 6차) `.data/` 부재 시 ENOENT.** backend 수정 후 빈 임시 디렉터리에서 `PGLITE_DIR` 미지정으로 `db:migrate` 를 실행하면 `.data/pglite` 가 자동 생성되고 `마이그레이션 완료`, 종료 코드 0. 존재하지 않는 `PGLITE_DIR=<임시>/a/b/c` 도 성공하고 PG_VERSION/base/global 이 생성됨. 5차 재현 증상은 더 이상 나지 않는다.
- Node 버전: 이 PC 는 v24.20.0, package.json 은 `22.x`. Vercel(22.x) 동작은 P 항목에서 확인해야 한다.

## 이번 차수 변경 파일 (e2e/, docs/qa-report.md 만)

- 6차: 신규 `e2e/tests/nojs-form.spec.js`; 수정 `e2e/tests/frontend.spec.js`, `e2e/tests/managed.spec.js`(R5 문자열 조립), `e2e/README.md`(O7 해소, nojs-form, 비밀 값 안내), 루트 `README.md` 시드 예시 한 줄(자리표시자, QA 요청 R5로 문서만 수정), `docs/qa-report.md`. 소스는 수정하지 않음.

- 5차: `e2e/tests/frontend.spec.js` 에 `C29(Enter 추가5)`, `C29(Enter 추가6)` 추가, `e2e/README.md` 갱신. 소스는 수정하지 않음.

- 신규: `e2e/tests/rules-r4.spec.js`(R4 v2.1, 27개)
- 전면 재작성: `e2e/tests/frontend.spec.js`(기록 탭·로그인·세션 UI, 40개), `e2e/tests/dashboard-ui.spec.js`(대시보드 UI, 12개) — `test.fixme` 전부 해소
- 수정: `e2e/tests/rules.spec.js`(구 R4 describe 제거), `e2e/tests/managed.spec.js`(C26 v2.1 기대), `e2e/helpers/ui.js`(`newUiPage`, `uiLogin`, 시각 고정), `e2e/helpers/api.js`(`uniqueIp` export + 무작위 기점), `e2e/README.md`
- 소스·루트 README·plan·api·`src/frontend/office/` 는 수정하지 않았다.

## 이월 / 미실행

- P1~P9(배포 환경), X1(프로세스 확인): 이번 차수에서 하지 않음.
- 색 대비 렌더링 측정: 검증 불가(수식 계산만 수행).
- 6차: vercel.json no-store 로컬 검증 불가, bfcache 수동 확인 필요, P1~P9/X1 미실행.
- D2 재검증 완료(5차). API 스펙 포함 mobile-360 전체를 5차에 재실행했다.

---

## 배포 검증 (Q3, 대상: https://moneybook-psi.vercel.app, 2026-10-20 실행)

범위: P1, P3, P4, P5, P6(남기기까지), P7, P8(360px 에뮬레이션), reviewer 추가 확인 3건. P2 는 메인 세션, P9·X1 은 메인 세션 담당이라 제외. 공개 HTTP 와 Playwright 로만 실행했고 DB 직접 접속은 하지 않았다. 소스는 수정하지 않았다.

### 결과 요약: 통과 11 / 실패 0 / 검증 불가·미실행 1 (P8 실제 휴대폰). 재배포(커밋 2959dcf) 후 재확인 3건(P6, 헤더 수정, 간단 회귀)은 아래 "재배포 후 확인" 참고

| 항목 | 결과 | 근거 |
|---|---|---|
| P1 HTTPS / 리다이렉트 / health | 통과 | `curl -sI http://…/` -> 308, `Location: https://moneybook-psi.vercel.app/`. https `/` 200, HSTS 있음. `/api/health` -> `{"status":"ok","db":"ok"}`. `/__qa/state`, `/__qa/health` 모두 404(기대대로) |
| P3 Set-Cookie | 통과 | 가입(201)·로그인(200) 모두 `mb_sid=<값>; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax`. 로그아웃은 `Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`. 응답에 비밀번호/해시 없음(user 키는 id, email 만) |
| P4 가입->로그인->거래 CRUD->대시보드 | 통과 | API: 가입 201, 로그인 200, me 200/무쿠키 401, 거래 3건 생성 201, PUT 200(createdAt 유지), 목록·summary·stats/monthly·categories·category-monthly·insights·quick·autocomplete 모두 200 이고 값 일치(수입 100000 / 지출 17000 / 잔액 83000), 검증 오류 5종(0원, 1.5, 상한 초과, 2026-02-30, 잘못된 카테고리) 400, 삭제 204 후 재삭제 404, 정리 후 목록 0건. UI(Playwright): 미로그인 `/`가 login.html 로 이동, 가입, 지출·수입 추가, 수정, 대시보드 KPI/도넛/월별/추이 렌더(NaN/undefined 없음), 로그아웃, 재로그인 후 거래 유지, UI 삭제(confirm) |
| P4 기존 e2e 재사용 | 불가(대체함) | `env.js` 는 `BASE_URL` 을 받지만 헬퍼가 계정을 대량 생성하고 `x-forwarded-for` 를 위조해 IP 제한을 피하는 구조(TRUST_PROXY 전용)라 이 공유 DB 에서 쓰면 가입 한도(10/시간)와 계정 수 제한을 어긴다. API 스크립트 + 별도 Playwright 스모크로 대체 |
| P5 C49 격리 | 통과 | B 가 A 의 거래 id 로 PUT 404 NOT_FOUND, DELETE 404. B 의 목록 0건, summary 0/0/카테고리 0, monthly 0, insights 비어 있음, autocomplete 비어 있음. 이후 A 가 같은 거래를 PUT 200(B 의 시도로 훼손 없음). 비UUID id PUT 404, 존재하지 않는 UUID DELETE 404, 무세션 목록 401 |
| P6 재배포 후 유지 | 통과 | 재배포(2959dcf) 후 거래가 그대로 유지됨. 아래 "재배포 후 확인" 참고 |
| P7 보안 헤더 / CSRF / 415 / no-store | 통과 | 정적(`/`, `/index.html`, `/js/app.js`, `/css/style.css`, 404 페이지)과 API(200/404/405 응답) 모두 CSP(`default-src 'self'; … frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` 존재. 프레임 금지는 CSP frame-ancestors 로만 제공(X-Frame-Options 헤더는 없음). `/`, `/index.html` `Cache-Control: no-store`. API 는 `no-store`. `Origin: https://evil.example` POST: 거래 403 CSRF_REJECTED, 로그인 403, 가입 403(쿠키 발급 없음). Origin 없는 로그인 403. `text/plain` 415, form-urlencoded 415. 20KB 본문 413. PATCH 405 + `Allow: GET, POST` |
| 추가 1: 잘못된 JSON | 통과 | `{bad json` 을 거래(인증), 로그인, 가입에 전송 -> 모두 400 `INVALID_JSON`(500 아님). `[1,2]` 도 400 INVALID_JSON |
| 추가 2: Vercel 에서 IP/이메일 제한 | 통과 | 없는 이메일로 순차 실패 로그인 6회: 401 x5, 6번째 429 `TOO_MANY_ATTEMPTS`, `Retry-After: 899`. 잠긴 후 올바른 비밀번호도 429, 잘못된 비밀번호도 429(`Retry-After: 900`) |
| 추가 3: 병렬 로그인 실패 10건 | 통과 | 전용 계정 하나에 오답 10건 동시 전송 -> 401 정확히 5건, 429 정확히 5건(한도 초과 통과 없음). 이후 정답 비밀번호도 429(잠금). 계정 -4 는 잠긴 상태(약 15분 후 해제) |
| P8 360px 스모크 | 통과(에뮬레이션) | Chromium 360x800, isMobile, touch. 로그인 화면, 기록 화면, 대시보드 모두 가로 스크롤 없음(scrollWidth 360 = innerWidth). 위 P4 UI 흐름 전체 성공 |
| P8 실제 휴대폰 | 미실행 | 사용자 확인 필요 |

IP 기반 제한에 대한 한계: 클라이언트 IP 의 `x-forwarded-for` 해석은 이메일 한도로만 관찰했다. IP 20회/15분 한도(이메일이 다른 실패 20회)와 가입 10회/시간은 한도에 가까운 호출이 다른 사용자에게 영향을 줄 수 있어 시험하지 않았다(미실행). 즉 "x-forwarded-for 기반 IP 제한"은 Vercel 에서 동작을 직접 증명하지 못했고, 이메일 단위 제한 동작만 확인했다.

### 관찰사항 (결함 아님)
- 정적 `/` 응답에 `Access-Control-Allow-Origin: *` 가 있다(Vercel 정적 파일 기본값으로 추정). API 응답에는 없다. 정적 공개 파일이라 영향은 작다.
- `/` 응답에 `Cache-Control: no-store` 이면서 `Age: 471`, `X-Vercel-Cache: HIT` 가 함께 보였다(Vercel 엣지 캐시 사용). 브라우저 캐시 금지 목적은 달성되지만 엣지에서는 캐시될 수 있다.
- (재배포 전 관찰, 수정 확인됨) 360px 에서 헤더의 로그아웃 버튼 글자가 두 줄로 꺾이고 이메일도 줄바꿈되던 문제는 2959dcf 에서 해소됨(아래 참고). 풀페이지 스크린샷에서 하단 탭바가 화면 중간에 겹쳐 보이는 것은 fixed 요소의 캡처 특성이다.
- 브라우저 콘솔에 401 리소스 오류 3건: 미로그인 상태의 `/api/auth/me` 호출로 보이며 기대 동작이다.
- `quick` 추천은 거래 1~2건 계정에서 빈 목록이었다(임계치 미달로 추정, 규칙 검증은 배포 범위 아님).

### 가장 심각한 문제 3개
실패 항목은 없다. 주의가 필요한 순서는 다음과 같다.
1. IP 기반 제한(실패 20/15분, 가입 10/시간)의 Vercel 동작은 미증명(위험 때문에 미시험). 이메일 제한만 확인.
2. 정적 응답의 `Access-Control-Allow-Origin: *` 와 no-store 가 엣지에서 HIT 인 점(낮음, 정적 공개 파일).
3. (해소) 360px 헤더 로그아웃 버튼 줄바꿈은 재배포로 수정 확인됨.

### 생성한 테스트 계정 (이메일만, 총 5개, example.com)
- qa-deploy-1792425483117-1@example.com (P3/P4/P5 계정 A, 거래 정리 완료)
- qa-deploy-1792425483117-2@example.com (P5 계정 B)
- qa-deploy-1792425483117-3@example.com (P6 재배포 후 확인 완료, 거래 정리 완료)
- qa-deploy-1792425483117-4@example.com (429 잠금 전용, 잠긴 상태)
- qa-deploy-1792425483117-5@example.com (Playwright 360px UI 스모크, 거래 정리 완료)

존재하지 않는 이메일 `qa-deploy-1792425483117-ghost@example.com` 으로 순차 로그인 실패 시도를 했으나 가입한 계정은 아니다.

### 재배포 후 확인 (커밋 2959dcf, 2026-10-20)

| 항목 | 결과 | 근거 |
|---|---|---|
| P6 거래 유지 | 통과 | 계정 -3 로그인 200(1회). `GET /api/transactions?month=2026-10` 200, 거래 1건: id c6413bc8-0785-4e39-9e78-0e9239d97b96, expense 7777, 기타, 메모 "QA 재배포 확인용", 2026-10-20, createdAt 2026-10-19T15:58:37.604Z (재배포 전과 동일) |
| P6 정리 | 통과 | `DELETE /api/transactions/<id>` 204, 이후 같은 월 목록 0건, 로그아웃 204 |
| 헤더 360x800 | 통과 | 계정 -5 로 로그인(Chromium, isMobile). 로그아웃 버튼(#logout-btn) 98x44px(한 줄, 높이 44). scrollWidth 360 = innerWidth 360, body.scrollWidth 360. 이메일 span#user-email 의 title 이 전체 이메일(`qa-deploy-1792425483117-5@example.com`)이며 표시 텍스트는 말줄임 처리 |
| 헤더 320x640 | 통과 | 로그아웃 버튼 98x44px, scrollWidth 320 = innerWidth 320. 이메일 title 전체 이메일. 스크린샷에서 버튼 글자 한 줄("로그아웃"), 이메일은 말줄임(`…`), 가로 스크롤 없음 |
| 회귀: 페이지 | 통과 | `/` 200, `/login.html` 200 |
| 회귀: health | 통과 | `/api/health` -> `{"status":"ok","db":"ok"}` |
| 회귀: 보안 헤더 | 통과 | `/`, `/login.html`, `/css/style.css` 모두 CSP(`default-src 'self'; … frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` |
| 회귀: no-store | 통과 | `/` `Cache-Control: no-store` 유지 |

비고: 로그아웃 버튼의 줄 수는 높이(44px = 한 줄 + 최소 터치 높이)와 스크린샷 육안으로 판단했다. 이메일은 긴 주소가 말줄임으로 잘리고 전체는 title(툴팁)로만 볼 수 있다(터치 기기에서는 툴팁이 뜨지 않음, 낮은 영향). 스크린샷은 레포 밖 임시 폴더에 `hdr-fix-360.png`, `hdr-fix-320.png` 로 저장했다. 로그인은 계정 -3 에서 1회(API), 계정 -5 에서 2회(UI 360/320). 새 가입 없음(계정 총 5개 유지). 계정 -3 은 거래 0건 상태로 정리됨.

### 실행 명령 요약
- `curl -sI` http/https/`/index.html`/정적 자산/404/API 404 헤더, `curl -si /api/health`, `/__qa/*` 404 확인.
- Node 18+ fetch 스크립트(임시 폴더): `p4.mjs`(P3/P4/P5, 정리), `p7.mjs`(P7, 잘못된 JSON, 로그아웃), `p6.mjs`(P6 거래, 병렬 10건·순차 6건 429).
- Playwright 스모크 `ui.mjs`(Chromium 360x800).
- 임시 파일 위치: 레포 밖 작업용 임시 폴더(계정 비밀번호를 담은 state 파일 포함, 커밋 금지).
- 스크린샷: 같은 폴더의 `shot-1-login.png`, `shot-2-record.png`, `shot-3-dashboard.png`, `shot-4-after-relogin.png`
- 가입 시도 합계: IP 당 5회(제한 10/시간 이내).

### 사용자 확인 항목 (2026-10-20)
- P8 실제 휴대폰 확인: 사용자가 "다 정상"이라고 회신함(사용자 확인, QA 미실행, 스크린샷 없음).
- P9 Vercel 환경변수(Production/Preview, 이름만): 사용자가 "다 정상"이라고 회신함(사용자 확인, QA·메인 세션이 값을 직접 보지 않음). 함수 지역 `sin1` 은 응답 헤더(`X-Vercel-Id`)로 확인함.
- 남은 한계: IP 기반 제한(실패 20회/15분, 가입 10회/시간)의 운영 동작은 미증명(단위 테스트로만 검증). 실제 기기 bfcache 동작은 미확인. 헤더 이메일은 말줄임이라 터치 기기에서는 `title` 툴팁이 보이지 않음.

---

# 카테고리 기능 + 수입·지출 균형 컨셉 검증 (Q-C1~Q-C5, 2026-10-21)

대상: `docs/plan-categories.md` 완료 기준 C-C1~C-C38, 계약 `docs/api.md` v3. 배포 확인 P-C1~P-C5, X-C1, Q-C6 은 운영 작업이라 **이번 범위에서 제외(미실행)**. 운영 DB/Neon 에는 접속하지 않았고 로컬 PGlite 임시 디렉터리만 사용했다. `src/`(특히 `src/frontend/office/`)는 수정하지 않았고, 변경한 것은 `e2e/` 와 이 문서뿐이다. 커밋·푸시도 하지 않았다.

## 요약

| 구분 | 통과 | 실패 | 미검증 |
|---|---|---|---|
| 완료 기준 C-C1~C-C38 (38개) | **38** | **0** | 0 (세부 미검증 항목은 아래 "검증 한계" 참고) |
| 번호 없는 추가 검증 중 실패 | - | **1건** (D-C1, 관리 화면 건수가 오래된 값. 두 뷰포트에서 각 1회 실패) | - |
| 기존 e2e 회귀 (문구·계약 변경 대응 후) | 전부 통과 | 0 | - |

- `npm test` (루트): **204개 중 204 통과, 0 실패** (직접 재실행해 확인, 약 12초).
- Playwright 전체 (mobile-360 + tablet-768 한 번에, 시드 사용자 포함): **450 통과 / 2 실패 / 1 skip(C64, 360px 전용)**, 총 453개, 4.4분. 2 실패는 같은 테스트(D-C1)가 두 뷰포트에서 실패한 것이다. 이를 제외한 나머지(기존 회귀 C1~C71 포함)는 전부 통과.
- 실패 정리: **제품 결함 1건 (D-C1, 담당 frontend, 낮음~중간)**. 그 외 실패는 모두 e2e 기대값 갱신으로 해결했고 소스 버그가 아니다(아래 "기존 e2e 수정 내역").
- 번호 있는 기준은 38개 모두 통과했다. D-C1 은 plan 9.3 의 확인 문구("기록 N건")와 이름 변경 안내("지난 기록 N건도 새 이름으로 바뀌어요")가 사실과 다르게 보이는 문제라 번호 기준에는 걸리지 않지만, 사용자에게 보이는 오류이므로 실패로 보고한다.

가장 심각한 문제 3개:
1. **D-C1 (frontend, 낮음~중간)**: 기록 탭에서 거래를 저장한 뒤 카테고리 관리 화면에 가면 그 카테고리의 건수가 저장 전 값(예: 0건)으로 남는다. "사용 안 함" 확인창이 "기록 1건…" 없이 "통계는 그대로 남고…"로만 나오고, 이름 바꾸기 안내가 "지난 기록 N건도…" 대신 "새 이름으로 바뀌어요."가 된다. 데이터 손상은 없고 표시만 틀리다. 재현은 아래 D-C1.
2. **알려진 롤백 한계 (설계상, 수정 대상 아님, 운영 주의)**: 새 코드에서 이름을 바꾼 카테고리의 거래는 구버전(22bbc17) 코드로 롤백하면 조회·집계·삭제는 되지만 수정(PUT)이 400 이다. C-C4 에서 실제 구버전 서버로 재현해 plan 14.3 의 서술과 같음을 확인했다. 롤백이 길어지면 사용자 안내가 필요하다.
3. **검증 한계**: 이름 변경과 거래 저장의 동시 경합(plan 6.3)은 PGlite 가 단일 연결이라 실제 경합 상황을 만들지 못했다(병렬 요청으로 결과 일관성만 확인). 실제 휴대폰·스크린리더·색각 이상 시뮬레이션은 실행하지 않았다. Neon(pg) 과 PGlite 의 트랜잭션·잠금 차이는 P-C2 이후 운영 확인이 필요하다.

## 실행 환경과 명령

- 메인 서버: `DB_DRIVER=pglite COOKIE_SECURE=false QA_TOOLS=true TRUST_PROXY=true PORT=3500` + 임시 `PGLITE_DIR`(작업 폴더). 서버 기동 전에 `node src/backend/db/migrate.js` → `seed.js --email=seed-ui@example.com --password=<데모 비밀번호> --today=2026-10-19` (출력: `마이그레이션 완료 (driver=pglite, categories 생성 사용자=0)`, `시드 완료 ... 거래 127건`). 종료 후 3500 LISTEN 없음 확인, 8765(별개 프로세스)는 그대로.
- 마이그레이션/구버전 테스트는 보조 서버를 자체 임시 디렉터리·포트(3201~, `QA_AUX_PORT_BASE`)로 띄운다. 구버전 코드는 `git archive 22bbc17 src package.json` 을 임시 폴더에 풀어 사용했다(git worktree·저장소 상태 변경 없음, 루트 `node_modules` 는 junction 으로 연결하고 정리 때 junction 을 먼저 분리).

| 명령 | 결과 |
|---|---|
| (1) `cd e2e && SEED_* BASE_URL=http://localhost:3500 TRUST_PROXY=true npx playwright test --project=mobile-360` (수정 전 기존 e2e) | 235개 중 230 통과 / **5 실패** (모두 문구·계약 변경: 아래 표) |
| (2) 같은 환경, `tests/categories.spec.js` (신규 API) | 46개: 1 실패(테스트 데이터 오류: 반복 간격) → 수정 후 46/46 통과 |
| (3) `tests/categories-migration.spec.js` (신규, Q-C1/Q-C2) | 8개: 처음에 보조 헬퍼의 tar 경로 오류와 테스트의 수입 행 정렬 가정 오류로 실패 → 테스트·헬퍼 수정 후 8/8 통과, 22초 |
| (4) `tests/categories-ui.spec.js` (신규 UI, mobile-360) | 최종 51개 중 50 통과 / 1 실패(D-C1). 중간에 나온 13건은 테스트 코드 오류(svg 2개 매칭 strict mode, 소스 주석 문자열 오탐, 시드 사용자 이번 달 수입 없음 등)라 테스트에서 고침 |
| (5) `... --project=mobile-360 --project=tablet-768` (전체, 마지막 실행) | **450 passed, 2 failed(D-C1 x 2 뷰포트), 1 skipped(C64)**, 4.4분 |
| (6) `npm test` | tests 204, pass 204, fail 0 |
| (7) 빈 임시 디렉터리에서 `DB_DRIVER=pglite node src/backend/db/migrate.js` 2회 연속 | 둘 다 `마이그레이션 완료 (driver=pglite, categories 생성 사용자=0)`, 종료 코드 0 |
| (8) 임시 폴더에 가짜 `.env.production.local` 을 두고 `node src/backend/scripts/migrate-prod.js` (a) 인자 없음 (b) `DB_DRIVER=pglite ... --yes` (c) 파일 안에 `DB_DRIVER` | (a) `--yes` 를 요구하며 거부, (b)(c) `DB_DRIVER 가 설정되어 있어요 ... 거부`, 모두 종료 코드 1. 파일이 없을 때도 안내 후 종료 코드 1. 어느 경우도 DB 에 접속하지 않음 |

## 기존 e2e 수정 내역 (테스트 코드만)

수정 전 5 실패는 frontend 가 예고한 지점과 일치하며 **모두 계약/문구 변경에 따른 기대값 갱신**이다. 소스 버그는 없었다.

| 파일 | 지점 | 수정 |
|---|---|---|
| `contract.spec.js` | `/api/categories` 응답 `toEqual({expense,income})` | `expense`/`income` 배열 검사 + `items` 12개 확인으로 변경 (plan 12.5) |
| `frontend.spec.js` C34 (2건) | "과소비 알림", "초과", "…보다 30% 더 썼어요", "페이스 주의" | "평소보다 많은 지출", "평소보다 많음", "…보다 N% 많아요", "지금 속도" |
| `dashboard-ui.spec.js` C62 | KPI "더 썼어요/덜 썼어요" | 수입·지출 대칭 문구 "지난달보다 수입/지출이 N% 늘었어요/줄었어요" (전월 0 이면 "비교할 지난달 기록이 없어요"), 잔액 카드에 증감 없음 확인 |
| `dashboard-ui.spec.js` C63 | 지출 막대 단색 가정, 범례 견본 수입=패턴·지출=단색 | 수입·지출 막대 모두 서로 다른 `url(#…)` 패턴, 범례 "수입 (/ 무늬)", "지출 (\ 무늬)" |
| `auth.spec.js` | C43 401 목록 | `POST /api/categories`, `PATCH /api/categories/:id` 추가 |
| `playwright.config.js` | tablet-768 `testMatch` | 신규 `categories-ui.spec.js` 를 768px 에서도 실행하도록 추가 |
| `helpers/server.js` | 보조 서버 헬퍼 | `migrate`/`startServer` 에 `cwd` 인자, `dbExec`, `checkoutCommit`, `removeCheckout` 추가 |

frontend 가 예고한 `frontend.spec.js:61,63,497`(칩 비동기 로드)은 신규 사용자 기준으로 수정 없이 통과했다(Playwright 가 칩이 나타날 때까지 자동 대기). 기록 탭 `#month-summary` 가 항상 h3 두 개("카테고리별 수입", "카테고리별 지출")인 변경도 기존 테스트가 깨지지 않았고 C-C34 에서 직접 검증했다.

## 신규 테스트 파일

| 파일 | 개수 | 대상 |
|---|---|---|
| `e2e/tests/categories.spec.js` | 46 | C-C6~C-C22 (API) |
| `e2e/tests/categories-migration.spec.js` | 8 | C-C1~C-C5 (마이그레이션·구버전 호환·지연 생성) |
| `e2e/tests/categories-ui.spec.js` | 51 (뷰포트마다) | C-C23~C-C30, C-C32~C-C38 + 연동/접근성/오류 상태 |

## 완료 기준별 결과

범례: 통과 = 아래 근거대로 실제 실행해 기대값이 맞음. 모든 "통과"는 위 (5)의 전체 실행에서 확인했다.

### 마이그레이션 / 데이터 (13.1)

| 기준 | 결과 | 근거 (테스트) |
|---|---|---|
| C-C1 빈 DB 2회 마이그레이션, categories 존재, transactions 구조 불변 | 통과 | (7) 빈 DB 2회 성공. migration 스펙: 구버전 스키마에 새 마이그레이션 2회 성공(`생성 사용자=4` → `0`), `to_regclass('categories')` 존재, transactions 의 `information_schema.columns` 와 `pg_constraint` 가 적용 전후 완전히 동일, 인덱스 `categories_user_type_sort_idx` 와 `unique (user_id, type, name_key)` 존재 |
| C-C2 v2 픽스처 적용 → 사용자당 정확히 12행 | 통과 | 구버전(22bbc17) 서버로 사용자 3명 + 기본 카테고리 12종을 모두 쓴 거래 생성 → 새 마이그레이션. 사용자별 12행(지출 8·수입 4), 이름·순서·sort_order(0~7, 0~3) 기존 고정 목록과 동일, 전부 active. 거래 count/sum/(사용자,유형,카테고리)별 건수가 적용 전과 동일. 방어 케이스: users 에 직접 넣은 사용자의 목록 밖 카테고리(경조사, 수입 "식비", 대소문자만 다른 Pet/pet 중 하나)는 비활성 행이 생기고 15자 초과 이름은 건너뜀, 거래는 그대로 |
| C-C3 이름 변경·사용 안 함 후 재마이그레이션 | 통과 | A 가 "식비"→"밥", "교통" 사용 안 함 후 migrate 재실행(`생성 사용자=0`): "식비" 행 부활 없음, "교통" 비활성·sort_order 2 유지, 행 12개 유지, 거래 "밥" 1건/"식비" 0건, 다른 사용자 불변 |
| C-C4 마이그레이션된 DB 로 22bbc17 서버 | 통과 | 구버전 서버로 로그인, me, 거래 POST/PUT/GET/DELETE, summary, stats 3종, insights, quick, autocomplete 모두 정상(200/201/204). 관찰: 새 코드에서 이름을 바꾼 거래("밥")는 구버전에서 조회·집계·삭제는 되지만 PUT 400 (plan 14.3 알려진 한계) |
| C-C5 행 없는 사용자 동시 GET 5회 | 통과 | 구버전으로 가입한 사용자(행 0개 확인) → 새 서버에서 `GET /api/categories` 동시 5회: 모두 200, 목록 동일, DB 행 정확히 12개. 변형: 거래 POST 2건 + summary + stats + insights + quick + categories 2건을 동시에 보내도 201x2/200x6, 행 12개. 이후 마이그레이션 재실행은 그 사용자를 건드리지 않고(`생성 사용자=0`), 행 없는 사용자는 재실행이 보강(`생성 사용자=1`) |
| C-C6 가입 직후 목록 | 통과 | expense 8개/income 4개 = 고정 목록과 동일, items 12개, 모두 `active:true`, `usedCount:0`, sortOrder 0부터, 지출→수입 순, 필드 키 6개만 노출 |

### 카테고리 API (13.2)

| 기준 | 결과 | 근거 |
|---|---|---|
| C-C7 추가·정규화·맨 끝 | 통과 | `"  반려   동물 "` → 201, name `"반려 동물"`, sortOrder 8, expense 배열 맨 끝. 두 번째 추가 sortOrder 9. 분해형 한글(NFD) → NFC 로 저장 |
| C-C8 이름 검증 | 통과 | 빈 문자열, 공백만, 탭/줄바꿈만, 16자, NUL, DEL, 숫자, null, name 없음, type `transfer`/없음 → 400 `VALIDATION_ERROR` + `fields`, 행 수 불변. 15자 → 201, 이모지 15개(코드포인트 기준) 201 / 16개 400, `<b onclick=x>` → 201 그대로 저장되고 그 이름으로 거래 등록 201. 본문의 `active`/`sortOrder`/`userId`/`id` 는 무시 |
| C-C9 중복 | 통과 | `식비`, ` 식비 ` → 409 `CATEGORY_EXISTS`. `Netflix` 후 `netflix`, ` NETFLIX ` 409. 수입에 `식비` 201(기타는 양 유형에 각각 존재). 연속 공백 정규화 후 중복 409. 같은 이름 병렬 POST 3건 → 201 1 + 409 2, 행 1개 |
| C-C10 사용 안 함 재추가·복구 | 통과 | "교통" 비활성 후 POST `교통`, ` 교통 ` → 409 `CATEGORY_INACTIVE` + `categoryId`(교통 id). 비활성 상태에서 stats 에 교통 3000원 유지. PATCH active:true → 200, sortOrder 2 유지, 칩 순서가 원래 위치 |
| C-C11 이름 변경 연동 | 통과 | 3개월 5건 "카페/간식" → "커피": 거래 목록(8·9·10월), summary, stats/categories, category-monthly 에 옛 이름 0건, 새 이름의 total/count/ratio/totals/sum 동일, grandTotal·expenseTotal 동일. 새 이름으로 거래 입력 201 / 옛 이름 400. 다른 사용자의 "카페/간식"·"기타" 거래·목록 불변. 지출 "기타"→"잡비" 변경 시 같은 사용자의 수입 "기타" 거래·카테고리 불변. 병렬 POST 6건 + 이름 변경 동시 요청: 각 POST 201 또는 400 이고 최종 목록에 옛 이름 거래 0건(단일 연결 한계는 검증 한계 참고) |
| C-C12 이름 변경 충돌 | 통과 | 활성 "식비", 비활성 "교통", ` 식비 ` 로 변경 → 409 `CATEGORY_EXISTS`(거래 불변). ` 커피 ` 자기 자신 → 200, 이름 정규화. 다른 유형의 같은 이름 허용. `netflix`→`Netflix` 200 이고 거래 문자열도 `Netflix`. 이름 규칙 위반 PATCH 400, 빈 객체/`active` 비boolean 400, 같은 상태 재요청 200(멱등), 이름 충돌이면 함께 보낸 active 변경도 반영 안 됨, 비활성 상태에서 이름 변경 가능 |
| C-C13 사용 안 함 동작 (a)~(e) | 통과 | "쇼핑" 비활성: (a) 거래 POST 400 + 문구 "사용 안 함으로 바꾼 카테고리예요. 다른 카테고리를 골라 주세요.", 목록 밖 이름은 "해당 구분에 없는 카테고리예요." (b) 기존 거래 6건이 목록·summary·stats 에 그대로, R4(level/currentTotal/baseline/ratio)·R5(큰옷) 불변 (c) 금액만 PUT 200 (d) 다른 거래를 쇼핑으로 PUT 400 (e) 쇼핑→식비 PUT 200 이고 되돌리기 400, 유형 변경(지출→수입 쇼핑) 400. 형식 오류+카테고리 오류는 형식 오류만(`fields` 키 amount 하나), 없는 거래는 404 |
| C-C14 마지막 활성 | 통과 | 지출·수입 각각 마지막 하나를 끄면 409 `CATEGORY_LAST_ACTIVE`(메시지 "카테고리가 하나는 있어야 해요."), 이름+active 동시 요청도 전체 롤백, 다른 유형 영향 없음, 하나 다시 켜면 마지막 것을 끌 수 있음 |
| C-C15 상한 | 통과 | 지출 활성 30개까지 201, 31번째 409 `CATEGORY_LIMIT`(지출 30개 문구). 30개에서 비활성 다시 사용 409, 같은 이름 재추가는 LIMIT 이 아니라 INACTIVE 먼저. 수입도 30 상한과 수입 문구. 사용자 전체 120개(기본 12 + 108 생성 후 즉시 비활성) 도달 후 지출/수입 추가 모두 409(전체 120 문구), 비활성 다시 사용은 활성 30 미만이면 허용 |
| C-C16 격리 | 통과 | B 의 GET 에 A 의 카테고리 없음. B 가 A 의 id 로 PATCH(이름/상태) 404, 비UUID 404, 없는 UUID 404, A 데이터 불변. A 의 이름으로 B 가 거래 POST 400. B 가 같은 이름을 만들어 이름을 바꿔도 A 불변. PATCH 의 `type`/`userId`/`user_id`/`id`/`sortOrder` 무시(유형·소유자 불변), `type` 만 보내면 400 |
| C-C17 보안 | 통과 | POST·PATCH: Origin 없음 403 / 다른 Origin 403 `CSRF_REJECTED`, `text/plain` 415, 16KB 초과 413, 거부된 요청은 데이터 불변. 쿠키 없음 GET/POST/PATCH 401, 잘못된 JSON 400 `INVALID_JSON`. `DELETE /api/categories/:id` 405 + `Allow: PATCH`, 컬렉션 PUT/PATCH/DELETE 405 + `Allow: GET, POST`, 항목 GET/POST/PUT 405 |
| C-C18 응답 형식 | 통과 | 400/404/405/409 모두 `{error:{code,message}}`, SQL·스택 없음. 오류와 201 응답의 Content-Type/Cache-Control/CSP/nosniff 가 존재하고 201 응답의 보안 헤더가 `/api/summary` 와 동일. 카테고리 객체에 내부 필드(user_id, name_key) 없음 |

### 규칙·통계 (13.3)

| 기준 | 결과 | 근거 |
|---|---|---|
| C-C19 R1 | 통과 | 3건 그룹의 카테고리 사용 안 함 → quick 에서 사라짐, 다시 사용 → 복귀, 이름 변경 → category 새 이름·count 3 유지. 같은 메모를 활성 카테고리로 3건 이상 쓴 쪽은 계속 제안, 비활성 제외 후 5개를 채움 |
| C-C20 R2 | 통과 | 점심: 식비 3 + 쇼핑 1 → 식비 비활성 → category "쇼핑" → 쇼핑도 비활성 → `category:null` 이고 memo·amount 유지 → 다시 사용하면 복귀. 동률은 가장 최근. UI: category null 제안 선택 시 메모·금액만 채워지고 선택된 칩 없음, 저장 시 카테고리 선택 안내, 제안 문구에 카테고리 이름 없음 |
| C-C21 R4/R5 연속성 | 통과 | 식비 이름 변경 후 `exceeded` 의 currentTotal/baseline/ratio/projectedTotal, R5 큰 지출의 median/multiple 동일하고 category 만 새 이름, 옛 이름 항목 없음. 비활성으로 바꿔도 항목 유지. R3 반복(메모 있음/없음)도 이름 변경 후 그대로 이어짐 |
| C-C22 동률 정렬 | 통과 | total 동률 5개 카테고리가 sortOrder 순(기본 세트 기존 순서, 새 카테고리 맨 뒤): stats/categories, summary.byCategory, category-monthly 동일. 이름 변경·사용 안 함 후에도 sortOrder 기준 유지 |

### 프런트엔드 UI (13.4, mobile-360 + tablet-768 모두 실행)

| 기준 | 결과 | 근거 |
|---|---|---|
| C-C23 추가→칩 반영 | 통과 | 관리 화면에서 `"  반려   동물 "` Enter 추가("'반려 동물' 카테고리를 추가했어요", 포커스가 입력칸, 연속 추가), `← 기록으로` 후 `window` 마커 유지(새로고침 없음)로 칩 9개·맨 끝, 금액→칩→Enter 저장(서버 확인 12,000원/반려 동물), 사용 안 함(confirm 수락) 후 칩 8개로 줄고 과거 거래는 목록에 그대로 |
| C-C24 비활성 거래 수정 | 통과 | `"경조사 (사용 안 함)"` 칩이 `aria-pressed=true` 로 맨 끝에 보임, 금액만 바꿔 저장 "수정했어요", 저장 후 칩 사라짐. 다시 수정 모드에서 다른 칩("식비")을 누르면 비활성 칩이 사라지고 저장 성공. 수정 취소 후에도 사라짐. 선택한 카테고리를 관리 화면에서 사용 안 함으로 바꾸고 돌아오면 선택 해제 |
| C-C25 키보드 전 흐름 | 통과 | 편집 링크에 Tab+Enter 진입(포커스 h1) → 입력칸 Tab, 입력, Enter 추가 → 식비 "이름 바꾸기"에 Tab, Space 로 편집(전체 선택 0~2), 안내 "지난 기록 1건도…", Esc 취소 후 포커스가 그 행 "이름 바꾸기" 버튼, Enter 로 다시 편집·입력·Enter 저장 후 포커스가 그 행 버튼 → 사용 안 함 Enter: 확인창 취소 시 변화 없음 / 수락 시 포커스가 다음 행("카페/간식") → "사용 안 함 (1)" summary 를 Enter 로 열고 "다시 사용" Enter → Shift+Tab 으로 `← 기록으로` Enter 복귀. 이름 변경이 기록 목록에 반영. 브라우저 뒤로가기 복귀, 대시보드 "카테고리 관리" 링크 진입, 하단 탭 2개 유지. 이름 바꾸기 입력의 접근 이름·describedby·`aria-invalid`·입력값 유지 확인 |
| C-C26 이중 제출 | 통과 | 응답 400ms 지연 하에 [추가] 더블클릭, Enter 3연타 → POST 각 1회·카테고리 1개. 이름 저장 Enter 3연타 → PATCH 1회, 사용 안 함 더블클릭 → PATCH 1회(확인창 1회). 기록 저장 이중 제출은 기존대로 POST 1회(회귀) |
| C-C27 오류 표시 | 통과 | 중복 추가: `role=alert` 영역에 서버 문구 "이미 같은 이름의 카테고리가 있어요.", 입력값 유지, `aria-invalid`. 비활성과 같은 이름: "같은 이름의 사용 안 함 카테고리가 있어요." + [다시 사용](접근 이름 "같은 이름의 사용 안 함 카테고리 다시 사용") 클릭 시 활성화. 마지막 활성 사용 안 함 → 행 오류 "카테고리가 하나는 있어야 해요." 버튼은 숨기지 않음. 빈/16자 이름은 요청 없이 클라이언트에서 차단. 세션 만료(401) 시 로그인 화면으로 이동. 카테고리 로드 실패 시 칩 자리·관리 화면 모두 오류 문구 + [다시 시도], 복구 후 정상 |
| C-C28 360px 레이아웃·터치 영역 | 통과 | 지출 활성 30개(15자 이름 포함): 관리 화면 `scrollWidth <= 폭`, 이름 편집 상태·수입 탭·한도 오류 상태도 가로 스크롤 없음, 관리 화면의 모든 버튼·링크·summary·입력 ≥ 44x44. 기록 칩 30개·대시보드(지출/수입)·기록 탭 가로 스크롤 없음, 칩 44x44 이상. 대시보드 보기 토글·관리 링크·기록 폼 "편집" 링크 44x44 이상 |
| C-C29 CSP·XSS | 통과 | `index.html` 에 인라인 script·`on*=`·`style=` 속성·`<style>` 없음. 관리/기록/대시보드/차트 JS 소스(주석 제외)에 innerHTML·outerHTML·insertAdjacentHTML·eval 없음. `<b onclick=x>`, `<i onfocus=1>`, `"><u>x</u>` 이름이 칩·관리 목록·이름 변경 입력·확인창·사용 안 함 목록·도넛 범례·표·추이 칩(지출/수입 보기)에 글자 그대로, 해당 요소(b[onclick], i[onfocus], u) 생성 0, confirm 외 dialog 0. 전 흐름(추가/이름 변경/사용 안 함/다시 사용/수정/대시보드 전환)에서 `securitypolicyviolation` 0건, 콘솔 CSP 오류 0건, pageerror 0건 |
| C-C30 도넛 묶음 | 통과 | 지출 12개(사용자 "기타" 포함, 상위 7에 듦): path 8, 범례 8행 = 식비·기타·교통·쇼핑·주거/통신·의료/건강·문화/여가·"그 외 5개"(마지막, 이름이 "기타" 아님), 묶인 이름 "카페/간식, 반려동물, 구독, 보험, 세금", fill 8개 모두 다르고 pattern 정의(색+모양) 서명도 8종 모두 다름, 표 12행 + 합계 780,000원 = 총지출, 중심 라벨 780,000원, 묶음 금액 150,000원, svg desc 요약 형식 유지. 8개면 묶음 없음, 9개면 "그 외 2개", 수입 12개도 "그 외 5개"·표 12행 |
| C-C31 회귀 | 통과 | 수정한 기존 e2e 포함 기존 spec 전부 통과 (frontend 의 C27~C34, C57~C61, dashboard-ui 의 C62~C67, auth/transactions/rules/rules-r4/isolation/managed/dashboard-api/contract/nojs-form). 마지막 전체 실행에서 실패는 D-C1 두 건뿐 |

### 수입·지출 균형 컨셉 (13.5)

| 기준 | 결과 | 근거 |
|---|---|---|
| C-C32 관리 화면 대칭 | 통과 | 지출/수입 토글 두 버튼 크기 차 ≤ 1px. 두 유형의 컨트롤 구성 동일(이름 입력 1, 추가 버튼 1, 행당 버튼 2 = "이름 바꾸기","사용 안 함", details 1, 제목/라벨 문구 구조 동일, 사용 안 함 0개 문구 "사용 안 함인 {지출/수입} 카테고리가 없어요"). 같은 스크립트(추가→이름 변경→사용 안 함→다시 사용)를 두 유형에 실행해 조작 수(클릭/키 입력) 동일. 수입도 활성 30 상한(C-C15)과 문구 대칭. 참고: 조작 수 동일성은 같은 스크립트가 양쪽에서 끝까지 성공함으로 확인했고, UI 에 유형별 추가 단계가 없음은 구조 비교로 보강했다 |
| C-C33 대시보드 수입/지출 전환 | 통과 | 기본 선택 지출(`aria-pressed`). 수입 선택 시 제목·section aria-label "카테고리 수입 비중", 중심 라벨 "총 수입", 범례 이름·금액·%가 `stats/categories?type=income` 와 일치, 중심 금액=grandTotal, svg desc "…수입 … 중 급여 …", D4 칩이 수입 카테고리(급여·부수입·용돈), figcaption "급여/용돈 월별 수입 추이". 6/12개월 전환·탭 이동 후에도 선택 유지, 새로고침하면 지출로 복귀(OQ-C11). 지출 복귀 시 범례·추이 원래대로. 두 토글 버튼 크기 차 ≤ 1px. 수입 기록이 없는 달은 빈 상태 문구(NaN 없음) |
| C-C34 기록 탭 수입 블록 | 통과 | h3 두 개 "카테고리별 수입" → "카테고리별 지출" 순, 같은 마크업(자식 클래스 구성 동일), 금액·비율이 stats 응답과 일치(수입 bar-fill `income`, 지출 `expense`). 수입 0 / 지출 0 / 둘 다 0 일 때 각각 "이 달에는 수입 기록이 없어요" / "이 달에는 지출 기록이 없어요" 대칭 빈 문구 |
| C-C35 KPI 증감 | 통과 | 전월 수입·지출 모두 있으면 "▲ 지난달보다 수입이 10.0% 늘었어요", "▼ 지난달보다 지출이 20.0% 줄었어요"(같은 문장 형식), 잔액 카드엔 증감 없음, 두 증감 색이 같고 빨강/초록 아님. 전월 0 이면 두 카드 모두 "비교할 지난달 기록이 없어요", 한쪽만 0 이면 그 카드만. 전월과 같으면 두 카드 "= 지난달과 같아요". 시드 사용자 C62 도 갱신 문구로 통과 |
| C-C36 가치 중립 색 | 통과 | 정적: CSS 에서 `var(--danger)` 사용처는 `.error-text`, `.btn-danger` 둘뿐, `--ok`/`#0b6b3a` 없음, `#b3261e` 는 정의 1회, JS 소스에 두 색 상수 없음. 동적: 시드 사용자의 기록 탭(수입 토글·수정 모드 포함)·대시보드(지출/표 펼침/수입 보기)·관리 화면(지출/수입)에서 `.error-text`/`.btn-danger` 를 제외한 모든 요소의 computed color·background·border·fill·stroke·outline 과 svg fill/stroke 속성에 `rgb(179,38,30)`·`rgb(11,107,58)` 없음. 오류 문구는 `--danger` 를 계속 쓰고(허용 범위) 그 오류 상태의 나머지도 중립 |
| C-C37 D3 막대·팔레트 | 통과 | 수입·지출 막대 fill 모두 `url(#…)` 패턴, 서로 다른 패턴 id 와 정의, 범례 "수입 (/ 무늬)", "지출 (\ 무늬)" 수입→지출 순. 팔레트 8색 흰 배경 대비 ≥ 3:1, 묶음 색 `#6B6B6B` ≥ 4.5:1 이며 팔레트와 겹치지 않음(수식 계산). 렌더링된 화면에서 대비 측정은 하지 않음 |
| C-C38 문구 | 통과 | 시드 사용자 기록 탭·대시보드(지출/수입 보기)·관리 화면 본문에 "과소비", "더 썼어요", "덜 썼어요", "초과", "페이스 주의", "⚠" 없음. R4 는 "평소보다 많은 지출" 섹션에서 "평소보다 많음" 라벨과 "…평소 월 평균 N원보다 N% 많아요", "지금 속도" 라벨. 인사이트 아이콘은 모두 `aria-hidden` |

## 결함

### D-C1. 관리 화면의 카테고리 건수(usedCount)가 오래된 값으로 남는다 (담당 frontend, 낮음~중간)

- 재현: (1) 새 계정으로 로그인해 기록 탭에서 금액 7000, 칩 "교통" 선택, 저장 ("저장했어요"). (2) "편집"으로 카테고리 관리 화면 진입. (3) "교통" 행을 본다. 이어서 "교통 이름 바꾸기"를 누르거나 "교통 사용 안 함"을 누른다.
- 기대: 행에 "1건", 이름 바꾸기 안내 "지난 기록 1건도 새 이름으로 바뀌어요.", 사용 안 함 확인창 "…지금까지의 기록 1건과 통계는 그대로 남고…" (plan 9.3, 서버 `usedCount` 는 1).
- 실제: 행에 "0건", 안내 "새 이름으로 바뀌어요.", 확인창 "'교통' 카테고리를 사용 안 함으로 바꿀까요? 통계는 그대로 남고, 새 기록에서만 고를 수 없어요." (기록 건수 문구 없음).
- 원인 추정: `categories.js` 가 앱 시작 때와 카테고리 변경 때만 `GET /api/categories` 를 받고, 거래 저장·수정·삭제(`datachanged`)나 관리 화면 진입(`tabchange`)에서는 다시 받지 않는다. 서버 값은 맞다(`GET /api/categories` 의 `usedCount` 가 1). 관리 화면 진입 시 `loadCategories()` 를 호출하면 해결될 것으로 보인다(소스는 수정하지 않았다).
- 영향: 표시만 틀리며 이름 변경·사용 안 함 동작과 데이터는 정상. 사용자가 "기록이 없다"고 오해할 수 있다.
- 테스트: `categories-ui.spec.js` "관리 화면 건수(usedCount) 최신성" (mobile-360, tablet-768 모두 실패 중). 수정 후 재검증이 필요하다.

## 관찰사항 (결함 아님)

- O-C1. 새 코드에서 이름을 바꾼 카테고리의 거래는 구버전으로 롤백하면 PUT 400(삭제·조회는 가능). plan 14.3 에 이미 적힌 한계를 실제 구버전 서버로 재현해 확인했다.
- O-C2. 대시보드에서 해당 달에 수입이 하나도 없는 사용자가 "수입" 보기를 고르면 도넛 영역에 `figcaption` 제목 없이 빈 상태 문구만 나온다(영역의 `aria-label` 은 "카테고리 수입 비중"). 지출 쪽 빈 상태도 같은 방식이라 대칭이다.
- O-C3. 이름 길이는 코드포인트 기준이라 이모지 15개까지 허용된다(서버·클라이언트 일치).
- O-C4. 같은 이름을 병렬로 3건 추가하면 정확히 1건만 생성되고 나머지는 409 `CATEGORY_EXISTS` 다(unique 제약으로 수렴).
- O-C5. 시드 사용자는 이번 달(2026-10) 수입 거래가 오늘 이후 날짜(25일)뿐이라 수입 보기 도넛이 비어 있다. 수입 보기 검증은 테스트가 만든 사용자로 수행했다.

## 검증 한계 / 미검증

- **미검증**: P-C1~P-C5, X-C1, Q-C6 (운영 반영 후 항목, 이번 범위 제외). Neon(pg 드라이버) 환경에서의 마이그레이션·잠금·암묵 트랜잭션 동작.
- **미검증**: 이름 변경과 거래 저장의 진짜 동시 경합(plan 6.3, reviewer 가 코드로 확인할 항목). PGlite 는 단일 연결이라 병렬 요청이 직렬 처리되어, 결과 일관성(옛 이름 거래가 남지 않음)만 확인했다.
- **미검증**: 마이그레이션 SQL 도중 실패 시 전체 롤백(plan 6.7 원자성)의 직접 실패 주입. (backend 단위 테스트가 `npm test` 204개에 포함돼 통과했으나 이번 QA 에서 별도 주입 시험은 하지 않았다.)
- **미검증**: `db:migrate:prod -- --yes` 로 실제 `driver=pg` 접속(운영 접속 금지로 실행하지 않음). 거부 경로 3종만 확인.
- **미검증**: 실제 휴대폰·스크린리더(NVDA/VoiceOver) 사용성, 색각 이상 시뮬레이션과 렌더링 화면 기준 대비 측정, 브라우저 bfcache.
- 키보드 검증은 Playwright 가상 키 입력이며 한글 IME 조합 중 Enter(`isComposing`) 처리는 실제 IME 로 시험하지 못했다.
