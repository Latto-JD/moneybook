# 구현 계획서: UX 묶음 1 (plan-ux1)

작성: planner / 작성일: 2026-11-17 / 기준: `af0e339` 작업 트리
출처: `docs/ux-suggestions.md` 의 U1·U2·U3·U4·U5·U6·U9 와 사용자 새 요청 U14. 사용자가 범위와 열린 질문 답(모두 권장안)을 승인했다.
표기: **[사실]** 코드에서 확인(파일:줄). **[결정]** 이 계획에서 확정한 방식. **[확인 필요]** 자동 시험으로 확인할 수 없어 실제 폰에서 봐야 하는 것.

---

## 1. 목표

휴대폰에서 거래를 넣고·고치고·지우는 흐름의 탭 수와 실수를 줄이고(날짜, 수정 후 위치, 삭제 되돌리기, 저장 후 숫자 패드), 홈 화면 실행·실패 복구·이메일 표시를 고친다. 백엔드·DB·API 는 바꾸지 않는다.

## 2. 사용자 스토리

- U1: 어제 쓴 돈을 넣을 때 달력을 열지 않고 "어제"를 한 번 눌러 고르고 싶다.
- U2: 목록 아래쪽의 거래를 고친 뒤 그 행으로 바로 돌아가 다음 거래를 이어서 보고 싶다.
- U3: 삭제를 확인창 없이 하고, 잘못 지웠으면 바로 되돌리고 싶다.
- U4: 휴대폰 홈 화면 아이콘으로 앱처럼 열고 싶다.
- U5: 기록 탭에서 거래 목록을 보려고 카테고리 막대를 매번 지나 스크롤하고 싶지 않다.
- U6: 불러오기에 실패하면 새로고침하지 않고 그 자리에서 다시 시도하고 싶다.
- U9: 내 정보에서 긴 이메일 전체를 보고 싶다.
- U14: 휴대폰에서 저장한 뒤 숫자 패드가 저절로 내려가면 좋겠다.

## 3. 범위 / 범위 밖

**범위:** 아래 4장의 8개 항목. 수정은 `src/frontend/public/`(office 제외), 프론트 단위 테스트, e2e, `docs/` 만.

**범위 밖:** 바텀시트(3단계), 예산·결제수단(4단계), U7 카테고리 순서, U8 검색, U10 비밀번호·계정 삭제, U11~U13, service worker·오프라인 캐시, 카테고리 "사용 안 함" 확인창(그대로 `window.confirm`), 출렁임·모션 값(`lib/spring.js`, `lib/motion.js` 의 값), `tokens.css`·`components.css`, 백엔드·`docs/api.md`·`vercel.json`·`schema.sql`.

---

## 4. 항목별 변경안

### 4.1 U14 저장 후 숫자 패드 내리기 (터치 입력일 때만)

**[사실] 지금 금액 칸으로 포커스를 주는 곳**
- 새 기록 저장 성공: `onSubmit` → `resetForm()` 의 `$('amount').focus()` (`record.js:311`, 호출 :344).
- 되돌리기 성공·실패: 포커스가 되돌리기 버튼에 있었으면 금액 칸 (`record.js:96, 101`).
- 토스트가 사라질 때 포커스가 되돌리기 버튼에 있었으면 금액 칸 (`record.js:61` `hideUndo`).
- 수정 취소 `resetForm()` (`record.js:666`), 입력 초기화 (`record.js:288-295`), 검증 오류 (`record.js:327`), 첫 화면 (`record.js:678`).
- 빠른 입력 칩은 이미 저장 버튼으로 보낸다 (`record.js:417`).

**[결정] 터치 판정:** 기기 종류(`pointer: coarse` 미디어 쿼리)가 아니라 **마지막 포인터 입력의 종류**로 정한다.
- `record.js` 에 `document` 의 `pointerdown`(capture) 리스너를 두고 `ev.pointerType` 을 기억한다. `touch` 또는 `pen` 이면 터치 모드다. `mouse` 이거나 아직 포인터 입력이 없으면(키보드만 사용) 지금처럼 동작한다.
- 이유: 휴대폰에서는 금액 칸을 손가락으로 눌러야 입력을 시작하므로, 숫자 패드의 Enter 로 저장해도 터치 모드가 된다. 데스크톱·터치 노트북의 마우스·키보드 사용은 그대로다. 시험에서 `click()`(마우스)은 기존 동작, `tap()`(터치)은 새 동작이 되어 결과가 정해진다.
- 판정 함수는 순수 함수로 `lib/` 에 둔다(예: `lib/input-mode.js` 의 `isTouchType(pointerType)`). 단위 테스트를 붙인다.

**[결정] 터치 모드에서 포커스를 보내는 곳: 저장 버튼 `#save-btn`**
- 이유: 버튼은 키보드를 띄우지 않는다. 고정 저장 영역이라 화면에 늘 보여 스크롤이 생기지 않는다(`focus({ preventScroll: true })`). 토스트가 저장 버튼 바로 앞(DOM 상 형제 앞)에 있으므로 키보드·스크린리더 사용자는 Shift+Tab 한 번으로 [되돌리기]에 간다. 되돌리기 버튼 자체에 포커스를 주면 토스트가 멈춰서(`record.js:664`) 사라지지 않으므로 쓰지 않는다. 제목(`tabindex=-1`)은 화면 맨 위로 스크롤되어 쓰지 않는다.
- 저장 중에는 버튼이 `disabled` 이므로 `onSubmit` 의 `finally`(버튼을 다시 켠 뒤)에서 포커스를 준다. 그 시점에 금액 칸이 아직 포커스를 갖고 있으면 `blur()` 도 한다.
- 적용하는 곳(터치 모드일 때만 바뀜):
  1. 새 기록 저장 성공 → `#save-btn`.
  2. 되돌리기 성공·실패 후(되돌리기 버튼에 포커스가 있었을 때) → `#save-btn`. 단 삭제 되돌리기는 4.3 규칙(되살린 행)을 따른다.
  3. `hideUndo` 에서 되돌리기 버튼이 포커스를 갖고 사라질 때 → `#save-btn`.
- 바꾸지 않는 곳: 검증 오류(고쳐 써야 하므로 금액 칸), 입력 초기화(다시 쓰려는 동작), 첫 화면 자동 포커스, 수정 저장·수정 취소(4.2 에서 행으로 감, 모드와 무관).
- 스크린리더: 저장 알림은 지금처럼 `#flash`(`role=status`)가 읽는다. 되돌리기 버튼의 접근 이름·5초 타이머·포커스 시 멈춤 규칙은 바꾸지 않는다.
- 포커스 링: 터치 뒤의 코드 포커스는 `:focus-visible` 이 아니어야 한다(Chromium 기본 동작). 보이면 frontend 가 원인을 확인해 보고한다(포커스 링 규칙은 바꾸지 않는다).

### 4.2 U2 수정 저장·취소 후 고친 행으로 돌아가기

- `txRow` 의 `li.tx-row` 에 `data-id`(거래 id)를 붙인다 (`record.js:536`).
- 수정 저장 성공: `resetForm({ keepFocus: false })` 로 금액 칸 포커스를 하지 않고, `refreshAll()` 이 끝난 뒤 같은 id 행의 `.tx-edit` 버튼을 찾아 `scrollIntoView({ block: 'center' })` 후 `focus({ preventScroll: true })` 한다. 그 행에 강조 클래스(예: `tx-row--landed`)를 약 1.2초 붙인다. `prefers-reduced-motion: reduce` 이면 스크롤은 즉시, 강조는 색 전환 없이 붙였다 뗀다(값은 기존 motion 토큰 사용).
- 수정 취소(`#cancel-edit-btn`): 수정하던 id 로 같은 방식으로 돌아간다(목록을 다시 받지 않음).
- 그 행이 목록에 없으면(다른 달로 옮겨 저장 등, 저장한 달은 `state.month` 로 이미 옮겨짐) 날짜 묶음 머리줄이 아니라 `#month-title-h` 로 포커스·스크롤한다.
- 이 규칙은 터치·마우스·키보드 모두 같다(행 버튼은 키보드를 띄우지 않음). 이력 화면에서 연 수정(`edittx`)도 같다.
- 토스트 [되돌리기]는 그대로 뜬다. 수정 되돌리기를 누르면 지금처럼 되돌린다(포커스는 4.1 규칙).
- 출렁임: 코드 스크롤은 입력 이벤트가 아니어서 출렁임이 없어야 한다. frontend 가 확인한다(값은 바꾸지 않음).

### 4.3 U3 삭제 되돌리기

- `onDelete`(`record.js:565-588`):
  - 거래 카테고리가 **지금 활성**이면 확인창 없이 바로 `DELETE` 하고, 토스트 "삭제했어요" + [되돌리기](접근 이름 "방금 삭제한 기록 되돌리기", 5초, 기존 규칙)를 띄운다.
  - 거래 카테고리가 **사용 안 함**이면 지금처럼 `window.confirm` 을 묻고 되돌리기 없이 "삭제했어요"만 띄운다. 이유: 다시 만들기(`POST`)는 활성 카테고리만 받는다(`docs/api.md:390` "POST와 같은 검증").
  - 삭제 후 포커스 규칙(같은 자리의 다음 행, 없으면 월 제목, `record.js:579-581`)은 그대로.
- `lib/undo.js` `undoPlan` 에 `kind: 'delete'` 를 추가한다: `{ method: 'POST', id: null, body: txBody(deleted), month: 'YYYY-MM'(지운 거래의 달) }`. 단위 테스트를 추가한다.
- `onUndo`: `POST` 이면 `api.createTransaction(body)`. 성공하면 "되돌렸어요", `state.month = plan.month`, `refreshAll()`. 되돌리기 버튼에 포커스가 있었으면 응답 id 의 행 `.tx-edit` 로 포커스·스크롤(4.2 와 같은 함수, 강조 포함). 실패하면 `undoFailText`(400 이면 "되돌리지 못했어요. 목록에서 직접 고쳐 주세요.") 를 보인다.
- 되살린 기록은 새 id·새 `createdAt` 이다. 같은 날짜 안 순서가 바뀔 수 있다(사용자 수용).
- 수정 중인 거래를 지운 경우 폼 초기화(`record.js:573`)는 그대로, 되돌려도 수정 상태로 돌아가지 않는다.
- `plan.md:96` 의 "삭제 실행 취소 제외" 결정은 이 계획으로 바뀐다(활성 카테고리 거래만).

### 4.4 U1 날짜 빠른 선택

- `index.html:75-80` 날짜 영역 앞에 버튼 묶음을 둔다: `<div class="segmented segmented--sm date-quick" role="group" aria-label="날짜 빠른 선택">` 안에 `#date-today`(오늘), `#date-yesterday`(어제), `aria-pressed`. 지금의 `<details id="date-details">`(요약 "날짜: …", `#date` 입력)는 그대로 "다른 날" 용도로 남긴다(기존 선택자 유지).
- 누르면 `state.date`·`#date` 값·요약 글자·초기화 아이콘(`updateResetBtn`)을 갱신한다. 열린 `details` 는 닫지 않는다.
- `aria-pressed`: 날짜가 오늘이면 오늘, 어제면 어제, 그 밖이면 둘 다 false. 달력으로 고른 값이 오늘·어제이면 해당 버튼이 눌린 상태가 된다. 수정 시작·초기화·저장 후에도 맞춘다.
- 요약 글자(`#date-summary`): 오늘 "오늘", 어제 "어제", 그 밖은 지금 형식("11월 14일 (금)"). 새 순수 함수(예: `lib/date.js` 의 `shiftDay(date, n)`, `dateSummaryLabel(date, today)`)로 만들고 단위 테스트. **목록 날짜 머리줄의 `dayLabel` 은 바꾸지 않는다.**
- 어제 계산은 로컬 날짜 기준(`todayLocal`), 월·연 경계(1일 → 전달 말일, 1월 1일 → 전년 12월 31일)를 지킨다.
- 터치 높이 44px 이상(기존 segmented 규칙).

### 4.5 U5 카테고리 막대 기본 접힘 + 펼침 기억

- `index.html:100` `#month-summary` 를 `<details class="month-cats" id="month-cats"><summary>카테고리별 수입·지출</summary> … </details>` 로 감싼다. `#month-summary` id 와 안의 그리기(`record.js:488-497`)는 그대로.
- 기본은 접힘. `toggle` 이벤트에서 `localStorage['mb-month-cats']` 에 `'open'`(열림)을 저장, 닫으면 키를 지운다. 시작할 때 읽어 반영한다. 저장소 예외는 무시하고 접힘으로 둔다.
- 이력에서 돌아올 때 포커스 복귀(`history.js:180-185`)는 그대로 둔다. 펼쳐 있어야 막대를 누를 수 있으므로 정상 경로에서는 같은 막대로 돌아온다. 접혀 있으면 지금처럼 월 제목으로 간다.
- 요약 줄 터치 높이 44px 이상, 펼침 표시는 기존 chevron 아이콘(CSS mask), 포커스 링 기존 규칙.
- 펼치고 접어 레이아웃이 바뀐 뒤 거래 목록 행의 출렁임 위치가 어긋나지 않는지 frontend 가 확인한다(값은 바꾸지 않음. 어긋나면 기존 재측정 경로를 부르는 것만 허용).

### 4.6 U6 불러오기 실패 시 다시 시도

**기록 탭 월 카드**
- `#month-error` 옆에 `#month-retry`("다시 시도", `btn--ghost btn--sm`, 기본 `hidden`)를 둔다(`index.html:99`).
- `loadMonth` 실패 시 보이고, 누르면 `loadMonth()` 를 다시 부른다. 진행 중에는 `aria-disabled="true"`(포커스 유지). 성공하면 숨기고, 포커스가 버튼에 있었으면 `#month-title-h` 로 옮긴다.

**대시보드**
- `#dash-error` 를 감싸는 영역에 `#dash-retry` 를 둔다(`index.html:116`).
- 실패한 요청을 종류별로 모은다: `insights`, `monthly`, `cat`, `trend`. 같은 종류의 최신 요청이 성공하면 지운다. 오래된(순서 번호가 지난) 응답은 모음에 손대지 않는다. `loadAll`(달 이동·탭 진입)은 모음을 비우고 새로 시작한다.
- 문구: 실패 1개면 그 오류 문구, 2개 이상이면 "일부 내용을 불러오지 못했어요. " + 첫 실패 문구. 모음이 비면 문구와 버튼을 숨긴다(지금의 "마지막 실패만 남음" 문제 해소, `dashboard.js:74`).
- 다시 시도: 실패한 것만 다시 부른다. `cat` 이 실패했으면 `loadTrend(…, loadCat(…))` 로 같이 부른다. 이유 값은 모션이 없는 값('retry', `motionFor` 표에 없음 → 정지)을 쓴다.
- `loadInsights` 는 결과(성공·실패·지난 응답)를 돌려주도록 바꾸고, 실패 시 인사이트 카드 안에는 짧은 안내 "불러오지 못했어요" 만 둔다(긴 문구는 대시보드 상단 한 곳).
- 이력·카테고리 관리의 기존 다시 시도는 바꾸지 않는다.

### 4.7 U4 홈 화면에 추가 (manifest)

- 새 파일 `public/manifest.json`(확장자 `.json`: 개발 서버 MIME 표 `dev-server.js:16` 에 이미 있어 백엔드 변경이 없다): `name` "가계부", `short_name` "가계부", `start_url` "/", `scope` "/", `display` "standalone", `background_color`·`theme_color` 는 `tokens.css` 라이트 배경색 값, `icons` 3개.
- 새 폴더 `public/app-icons/`(기존 `icons/` 는 아이콘 개수 시험 대상이라 쓰지 않음): `app-192.png`, `app-512.png`(`purpose: any`), `app-maskable-512.png`(`purpose: maskable`, 그림을 가운데 80% 안전 영역에 두고 배경 `#0b5cad` 로 꽉 채움), `apple-touch-icon-180.png`. 그림은 `favicon.svg` 와 같다. 만드는 방법은 frontend 가 정한다(예: 이미 있는 Playwright 로 svg 를 렌더링해 저장. 만드는 스크립트는 커밋하지 않고 README 에 방법 한 줄).
- `index.html`·`login.html` `<head>`: `<link rel="manifest" href="manifest.json">`, `<link rel="apple-touch-icon" href="app-icons/apple-touch-icon-180.png">`, `<meta name="theme-color" content="(라이트 배경)">`, `<meta name="apple-mobile-web-app-title" content="가계부">`.
- 화면 모드와 상단 막대 색 맞추기: `lib/theme.js` 의 적용 함수와 `theme-init.js` 가 `meta[name=theme-color]` 의 `content` 를 지금 모드의 배경색(`getComputedStyle` 의 `--color-bg` 값)으로 바꾼다. `theme-init.js` 는 head 에서 CSS 앞에 돌기 때문에 meta 태그를 그보다 앞에 둔다.
- CSP(`default-src 'self'`)는 manifest·PNG 를 막지 않는다. service worker 는 넣지 않는다.

### 4.8 U9 내 정보 이메일 전체 표시

- `style.css:339` `.account-row__value` 를 말줄임 대신 줄바꿈으로: `white-space: normal; overflow-wrap: anywhere;` (말줄임 규칙 제거). `title` 은 그대로 둬도 된다. 헤더 이름 링크는 바꾸지 않는다.

---

## 5. 수정 파일

| 파일 | 항목 |
|---|---|
| `src/frontend/public/index.html` | U1 날짜 버튼, U5 details, U6 다시 시도 버튼 2개, U4 head 태그 |
| `src/frontend/public/login.html` | U4 head 태그 |
| `src/frontend/public/js/record.js` | U14, U2, U3, U1, U5, U6(기록) |
| `src/frontend/public/js/dashboard.js` | U6(실패 모음·다시 시도) |
| `src/frontend/public/js/insights.js` | U6(결과 반환, 짧은 안내) |
| `src/frontend/public/js/lib/undo.js` | U3 `kind: 'delete'` |
| `src/frontend/public/js/lib/date.js` | U1 `shiftDay`, `dateSummaryLabel` |
| `src/frontend/public/js/lib/input-mode.js` (새) | U14 터치 판정 |
| `src/frontend/public/js/lib/theme.js`, `js/theme-init.js` | U4 theme-color |
| `src/frontend/public/css/style.css` | U1, U2 강조, U5, U6, U9 |
| `src/frontend/public/manifest.json`, `public/app-icons/*.png` (새) | U4 |
| `src/frontend/test/*.test.js` | 새 순수 함수 단위 테스트(undo delete, shiftDay·dateSummaryLabel 경계, isTouchType, 대시보드 실패 문구 함수를 순수 함수로 뺀다면 그것) |
| `e2e/tests/ux1.spec.js` (새), 기존 spec 갱신 | qa (6장) |
| `README.md` | U4 아이콘 만드는 방법 한 줄 |

백엔드, `docs/api.md`, `vercel.json`, `schema.sql`, `tokens.css`, `components.css`, `lib/spring.js`, `lib/motion.js` 는 바꾸지 않는다.

## 6. 작업 목록

| ID | 작업 | 담당 | 의존 |
|---|---|---|---|
| F1 | U14 터치 판정 + 저장·되돌리기 후 포커스(4.1) | frontend | - |
| F2 | U2 행 `data-id`, 행으로 돌아가기 함수, 강조(4.2) | frontend | - |
| F3 | U3 삭제 되돌리기(4.3) | frontend | F2(행 찾기 함수 공유), F1(포커스 규칙) |
| F4 | U1 날짜 빠른 선택(4.4) | frontend | - |
| F5 | U5 카테고리 블록 접힘·기억(4.5) | frontend | - |
| F6 | U6 다시 시도(기록·대시보드·인사이트)(4.6) | frontend | - |
| F7 | U4 manifest·아이콘·theme-color(4.7) | frontend | - |
| F8 | U9 이메일 줄바꿈(4.8) | frontend | - |
| F9 | 자체 점검: `npm test`, 콘솔 CSP 위반 0, 360/768 × 라이트·다크 화면 확인 | frontend | F1~F8 |
| Q1 | 기존 e2e 갱신(7.3 표) | qa | F9 |
| Q2 | 새 e2e `e2e/tests/ux1.spec.js` + 회귀 mobile-360·tablet-768 + `docs/qa-report.md` "UX 묶음 1" 절 | qa | Q1 |
| R1 | 최종 리뷰 | reviewer | Q2 |
| U | 실제 휴대폰 확인(7.4) 후 푸시 승인(마이그레이션 없음) | 사용자(메인 안내) | R1 |

F1·F2·F4~F8 은 서로 병렬로 할 수 있다(같은 `record.js` 를 고치므로 한 사람이 순서대로 하는 것을 권함).

## 7. 완료 기준 (QA 체크리스트)

별도 표시가 없으면 mobile-360(`hasTouch`)·tablet-768, 라이트·다크. "터치"는 Playwright `tap()`, "마우스"는 `click()`, "키보드"는 `press()` 만 사용.

### 7.1 새 기준

**U14 숫자 패드**
- [ ] UX-01. 터치: 금액 칸 tap → 숫자 입력 → 카테고리 tap → 저장 tap 하면 저장 성공 후 `document.activeElement` 가 `#save-btn` 이고, 입력 요소(`input`·`textarea`)에 포커스가 없다. 화면 스크롤 위치가 저장 직전과 같다(±2px).
- [ ] UX-02. 터치: 금액 칸 tap 후 키보드 Enter 로 저장해도 UX-01 과 같다.
- [ ] UX-03. 마우스 클릭 또는 키보드만으로 저장하면 지금처럼 `#amount` 에 포커스가 간다(기존 시험 그대로 통과).
- [ ] UX-04. 터치 저장 뒤 `#flash` 가 "저장했어요", `#flash-undo` 가 보이고 접근 이름 "방금 저장한 기록 되돌리기". `#save-btn` 에서 Shift+Tab 한 번에 `#flash-undo` 에 닿는다. 되돌리기 5초 타이머와 포커스 시 멈춤이 지금과 같다.
- [ ] UX-05. 터치로 [되돌리기]를 누르면 되돌린 뒤 포커스가 `#save-btn`(삭제 되돌리기는 UX-13). 마우스·키보드는 지금처럼 `#amount`.
- [ ] UX-06. 터치 저장 뒤 `#save-btn` 이 `:focus-visible` 이 아니다. 키보드로 저장 버튼에 Tab 해 오면 포커스 링이 보인다(기존).
- [ ] UX-07. 검증 오류(금액 없이 저장)는 터치에서도 `#amount` 로 포커스(고쳐 쓰기).

**U2 수정 후 행으로**
- [ ] UX-08. 거래 15건 이상인 달에서 목록 아래쪽 행을 눌러 수정 → 금액을 바꿔 저장하면 같은 `data-id` 행의 `.tx-edit` 에 포커스, 그 행이 화면 안(탭바·저장 영역에 가리지 않음)에 있고 바뀐 금액이 보인다. 마우스·터치 모두.
- [ ] UX-09. 수정 취소도 같은 행으로 돌아간다(목록 요청 추가 없음).
- [ ] UX-10. 날짜를 다른 달로 바꿔 저장하면 그 달 목록으로 바뀌고 그 행으로 포커스. 행이 없으면 `#month-title-h`. 포커스가 `body` 로 가지 않는다.
- [ ] UX-11. 이력 화면에서 연 수정도 UX-08 과 같다. reduce 모션이면 즉시 스크롤, 강조 애니메이션 없음.

**U3 삭제 되돌리기**
- [ ] UX-12. 활성 카테고리 거래 삭제 시 dialog 가 뜨지 않고(`page.on('dialog')` 0회) 행이 사라지며 "삭제했어요" + [되돌리기](접근 이름 "방금 삭제한 기록 되돌리기"). 포커스는 같은 자리 다음 행(없으면 월 제목).
- [ ] UX-13. 5초 안에 [되돌리기] → `POST /api/transactions` 1회, 같은 type·amount·category·memo·date 의 기록이 목록·요약 합계·대시보드에 다시 보인다. 포커스는 되살린 행의 `.tx-edit`. "되돌렸어요" 알림.
- [ ] UX-14. 사용 안 함 카테고리 거래 삭제는 dialog 가 뜨고, 취소하면 지워지지 않으며, 확인하면 지워지고 [되돌리기]가 없다.
- [ ] UX-15. 되돌리기 POST 가 400 이면(시험에서 응답 가로채기) "되돌리지 못했어요. 목록에서 직접 고쳐 주세요." 가 보이고 목록이 바뀌지 않는다. 빠른 두 번 누름에도 POST 는 1회.
- [ ] UX-16. 다른 달 거래(월 이동 후)를 지우고 되돌리면 그 달 목록에 다시 보인다.

**U1 날짜**
- [ ] UX-17. 처음에는 "오늘" `aria-pressed=true`, 요약 "날짜: 오늘". "어제" 누르면 `aria-pressed` 가 바뀌고 요약 "날짜: 어제", 저장한 거래의 `date` 가 어제(시험 시계 고정: 3월 1일 → 2월 28일, 1월 1일 → 전년 12월 31일 포함).
- [ ] UX-18. 달력(`#date`)으로 오늘·어제를 고르면 해당 버튼이 눌린 상태, 다른 날이면 둘 다 false 이고 요약은 "M월 D일 (요일)". 목록 날짜 머리줄 형식은 바뀌지 않는다.
- [ ] UX-19. "어제" 선택 시 초기화 아이콘이 보이고, 초기화하면 오늘로 돌아간다. 수정 시작 시 그 거래 날짜에 맞게 버튼 상태가 바뀐다. 두 버튼 높이 44px 이상, 접근 이름 "오늘"/"어제", 묶음 이름 "날짜 빠른 선택".

**U5 카테고리 블록**
- [ ] UX-20. 새 저장소에서 `#month-cats` 가 닫혀 있고 `#month-summary` 막대가 보이지 않으며, 거래 목록 첫 행이 지금보다 위에 있다(360×740 에서 측정값 기록).
- [ ] UX-21. 펼치면 `localStorage['mb-month-cats']==='open'`, 새로고침 후에도 펼침. 접으면 키가 없고 새로고침 후 접힘.
- [ ] UX-22. 펼친 상태에서 막대 → 이력 → 뒤로 시 같은 막대 버튼에 포커스(기존 기준 유지). 요약 줄 높이 44px 이상, 키보드 Enter/Space 로 여닫힘.
- [ ] UX-23. 펼치고 접은 뒤 거래 목록을 터치 스크롤해도 기존 출렁임 시험(`spring.spec.js`)이 통과한다.

**U6 다시 시도**
- [ ] UX-24. 기록 탭 월 요청 하나를 500 으로 가로채면 `#month-error` 문구와 `#month-retry` 가 보인다. 가로채기를 풀고 누르면 목록이 보이고 버튼이 숨으며 포커스는 `#month-title-h`.
- [ ] UX-25. 대시보드에서 2개 요청(예: insights, stats/monthly)을 실패시키면 `#dash-error` 가 "일부 내용을 불러오지 못했어요. …" 하나, `#dash-retry` 보임. 누르면 **실패한 두 요청만** 다시 간다(요청 수 기록). 성공하면 문구·버튼이 숨는다.
- [ ] UX-26. 실패 1개면 그 오류 문구만. 실패 뒤 달을 이동해 모두 성공하면 문구가 남지 않는다. 다시 시도로 그린 카드에는 모션(`data-motion`)이 없다.

**U4 manifest**
- [ ] UX-27. `GET /manifest.json` 200, JSON 파싱 가능, `display: standalone`, `start_url: "/"`, 아이콘 192·512·maskable 512 의 `src` 가 모두 200 `image/png`, 실제 픽셀 크기가 적힌 크기와 같다. `index.html`·`login.html` 에 manifest·apple-touch-icon(180, 200)·theme-color 가 있다.
- [ ] UX-28. 라이트/다크 전환 시 `meta[name=theme-color]` 값이 그 모드의 배경색과 같다. 새로고침(다크 저장) 직후에도 다크 값. CSP 위반 0. `icons/` 폴더 파일 수는 그대로(기존 C-D1 통과).

**U9 이메일**
- [ ] UX-29. 64자 이메일 계정으로 내 정보를 열면 `#account-email` 의 `text-overflow` 가 `ellipsis` 가 아니고 전체 글자가 보이며(요소 `scrollWidth <= clientWidth`), 가로 스크롤이 없다(360px).

### 7.2 회귀
- [ ] UX-30. `npm test` 전부 통과, e2e 전체(기존 + 갱신 + 신규) mobile-360·tablet-768 통과, 콘솔 오류·CSP 위반 0.
- [ ] UX-31. 변경 파일이 5장 표 안에만 있다. `src/backend/`, `docs/api.md`, `vercel.json`, `schema.sql`, `tokens.css`, `components.css`, `lib/spring.js`, `lib/motion.js` 변경 0.

### 7.3 갱신이 예상되는 기존 시험 (qa)

| 바뀌는 동작 | 영향 |
|---|---|
| 거래 삭제 확인창 없음(활성 카테고리) | 삭제 dialog 를 기다리거나 검사하는 시험. `helpers/ui.js` 의 dialog 자동 수락은 카테고리 "사용 안 함" 용으로 그대로 둔다 |
| 수정 저장·취소 후 포커스가 금액 칸이 아니라 행 | 수정 뒤 `#amount` `toBeFocused` 를 보는 시험 |
| `#month-summary` 기본 접힘 | 막대 버튼을 누르거나 재는 시험(`category-history`, `categories-ui`, `design`, `redesign`, `improvements` 등): 먼저 `#month-cats` 를 여는 도우미를 쓴다 |
| 날짜 요약 "어제" | 어제 날짜 요약 글자를 보는 시험(`frontend`, `followup-2c` 등) |
| 이메일 말줄임 제거 | `redesign.spec.js:245` 의 `ell`·`nowrap` 기대값 |
| 대시보드 오류 문구 | `dash-error`·인사이트 오류 문구를 보는 시험 |

### 7.4 실제 휴대폰 확인 (사용자, [확인 필요])

자동 시험은 가상 키보드를 띄우지 못한다. 배포 전 미리보기 또는 배포 후 사용자에게 다음 확인을 요청한다.
- 저장 버튼을 누르면 숫자 패드가 내려가는지(iOS Safari·Android Chrome 중 쓰는 쪽).
- 홈 화면에 추가 후 아이콘·이름 "가계부"·주소창 없는 화면으로 열리는지, 다크 모드에서 상단 막대 색.

## 8. 위험

| 위험 | 대응 |
|---|---|
| iOS 에서 버튼으로 포커스를 옮겨도 키보드가 남는다 | F1 에서 `blur()` 를 함께 한다. 7.4 에서 남으면 frontend 에 되돌려 다른 방법을 찾는다 |
| 포인터 종류 판정이 스크린리더(TalkBack 두 번 탭)에서 다르게 나온다 | 어느 쪽이 나와도 저장 알림·되돌리기 접근성은 같다(포커스 위치만 다름) |
| 확인창 없는 삭제로 실수가 늘어난다 | 5초 되돌리기. 사용 안 함 카테고리 거래는 확인창 유지 |
| 기본 접힘으로 기존 시험이 대량으로 깨진다 | 7.3 도우미로 한 번에 갱신 |
| 홈 화면 standalone 에서 로그인 만료 후 이동 | 같은 출처(`scope: "/"`) 안이라 앱 안에서 열린다. 7.4 에서 확인 |

## 9. 막힌 것

없음. 실제 키보드 동작(7.4)만 사용자 기기 확인이 필요하다.
