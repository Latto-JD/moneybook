# Moneybook 디자인 핸드오프 적용 계획서 (plan-design v1)

작성: planner / 작성일: 2026-10-21 / 상태: 초안 (13장 열린 질문 답변 대기. 답이 없으면 권장 기본값으로 진행)

## 0. 이 문서의 위치와 표기

- 이 문서는 `design_handoff_moneybook/`(README.md, handoff/README.md, tokens.css, fonts.css, components.css, reference/donut.js, 자산 폴더)를 현재 앱(`src/frontend/public/`)에 적용하는 **추가 계획서**다.
- `docs/plan.md`, `docs/plan-categories.md`, `docs/api.md` v3 은 **수정하지 않는다**. 이 문서와 충돌하면 사용자 요구(plan-categories 의 "삭제 = 사용 안 함")가 가장 우선이고, 그다음 이 문서, 그다음 디자인 핸드오프 순이다.
- 완료 기준 번호는 `C-D1…`(로컬), `P-D1…`(배포)로 새로 매긴다. 기존 C/P, C-C/P-C 항목은 회귀 대상으로 유지한다.
- 표기: **[사실]** = 저장소 파일에서 확인(파일:줄), **[가정]** = 확인하지 못했거나 정책 판단.
- 참고: `Moneybook Handoff.dc.html` 은 열어 보지 않았다. 시안 해석은 두 README 와 CSS/JS 자산만 근거로 했다 **[가정: 시안이 README 서술과 같다]**.
- 디자인 README 의 "단계마다 커밋한다"는 이 팀 규칙으로 대체한다: 에이전트는 커밋·푸시하지 않고, 메인 세션이 사용자 승인을 받아 커밋한다.

---

## 1. 목표

기존 기능과 운영 DB를 그대로 둔 채, 기록·대시보드·카테고리 관리 3개 화면에 디자인 토큰·폰트·컴포넌트를 적용해 수입과 지출이 같은 무게로 보이는 라이트/다크 화면을 만든다(최소안은 스키마 변경 없음).

---

## 2. 현재 상태 조사 결과 (적용에 영향을 주는 사실)

| 영역 | 내용 |
|---|---|
| CSP | **[사실]** 정적·API 공통 `default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'` (`vercel.json:11`, `src/backend/http.js:13`). font-src·style-src·script-src 는 `default-src 'self'` 를 따른다 → 같은 출처 woff2, 외부 CSS 파일, CSS `mask: url(…svg)` 는 허용, 인라인 `<style>`·`style=""` 속성·인라인 스크립트는 차단. JS 에서 `el.style.width = …`(CSSOM)는 차단되지 않는다(handoff/README.md 29행과 같은 판단). |
| CSP 테스트 | **[사실]** `e2e/tests/categories-ui.spec.js:559-568` index.html 에 인라인 script·`on*=`·`style=`·`<style>` 없음. `:570-576` 지정 JS 6개 파일에 `innerHTML` 등 없음. `src/frontend/test/charts.test.js:124` 정적 HTML 외부 URL 없음. |
| 개발 서버 MIME | **[사실]** `src/backend/scripts/dev-server.js:11-21` 에 `.woff2` 가 없어 `application/octet-stream` 으로 나간다(`:54`). `.svg` 는 `image/svg+xml` 있음. Vercel 은 확장자로 MIME 을 정한다 **[가정]**. |
| 스타일 | **[사실]** `css/style.css` 217행, 색 변수 `--bg --surface --text --muted --line --primary --danger`(`:2-13`)와 하드코딩 색 다수(`:28` 포커스 `#1a73e8`, `:68` 입력 배경 `#fff`, `:122` `#f4f6f9`, `:156` `#e3e7ec`, `:159-160` 수입/지출 막대 `#0072B2`/`#C4500A`, `:177` `#eaf2fb`). 다크 모드 없음. 클래스 명명은 `.btn-primary`, `.btn-danger`(하이픈 1개)이고 디자인은 `.btn--primary`(BEM). |
| 차트 | **[사실]** `js/charts.js` 가 도넛·묶은 막대·막대를 그린다. 색은 SVG `fill` 속성에 hex 로 직접 넣는다(`:13 PALETTE`, `:16 OTHER_STYLE #6B6B6B`, `:44 stroke '#fff'`, `:69 stroke '#333'`, `:158 stroke '#fff'`, `:194 '#555'/'#d0d4da'`, `:233 '#333'`). 다크 모드에서 그대로 남는다. 도넛 조각 색은 **금액 순위 i** 로 정한다(`:18-21`). 표 대체는 `<details>`+"표로 보기" summary(`:79-80`). |
| donut.js(핸드오프) | **[사실]** (1) 색을 **정렬된 조각 순번**(금액 내림차순)으로 준다(`reference/donut.js:37-49`) — README 의 "색은 카테고리 목록 순서로 정해진다"(handoff/README.md 57행)와 어긋난다. (2) 9개 이상이면 묶음 이름이 `'기타'`(`:25`) — 기본 카테고리 "기타"와 충돌(plan-categories 2.2에서 이미 "그 외 N개"로 해결). (3) 표 대체가 **묶인 행**만 싣는다(`:61-70`) — C-C30 "표는 전체 행" 위반. (4) `table.innerHTML` 사용(`:59`) — 코드베이스 규칙 위반. (5) 안쪽 반지름 58(`:45`) vs README 60. (6) `classList`, `dataset` 사용 — 단위 테스트의 가짜 DOM(`src/frontend/test/charts.test.js:7-21`)에 없음. |
| 기록 화면 | **[사실]** 현재 기록 탭에는 디자인 시안에 없는 기능이 있다: 빠른 입력 R1(`index.html:58-61`), 메모 자동완성 R2(`:45`), 날짜 변경 details(`:47-52`), 월 이동+월 목록+3칸 KPI+카테고리별 수입/지출 막대(`:63-72`, `record.js:279-299`), 인사이트(`:74-77`), 행별 삭제 버튼(`record.js:339-343`). 수정은 같은 폼에서 한다(`record.js:177-196`). 저장 후 카테고리는 비운다(`record.js:126`, plan.md 490행 "입력 초기화(type, date 유지)"). |
| 대시보드 | **[사실]** 월 이동, 6/12개월(`index.html:84-92`), KPI 3칸+전월 대비(`dashboard.js:26-43`), 카테고리 보기 지출/수입(`:96-109`), 도넛, D3 월별 수입 대 지출, D4 카테고리 추이. 시안에는 6/12개월·D3·D4 가 없다. |
| 카테고리 관리 | **[사실]** 해시 패널 `#categories`(`tabs.js:3`), 하단 탭 활성 없음(`tabs.js:14-19` — categories 링크가 없어 아무 탭도 aria-current 아님). "← 기록으로"(`index.html:118`). 행마다 [이름 바꾸기][사용 안 함] 텍스트 버튼(`category-manager.js:45-58`), 추가 입력 폼(`index.html:132-142`), 사용 안 함 목록 details(`:143-146`). 이름 1~15자, 유형별 활성 30개(api.md 3A.1). `sortOrder` 는 API 가 받지 않는다(api.md 3A.4 "sortOrder 등 그 밖의 필드는 무시") — **순서 변경 API 없음**. |
| DB | **[사실]** `categories` 에 `sort_order integer not null` 있음(`schema.sql:50`), `viz_index`·예산 컬럼 없음. `transactions` 에 결제 수단 컬럼 없음(`schema.sql:34` 부근, api.md 4 거래 객체). 거래 객체에 `createdAt` 은 있다(api.md 4). |
| 금액 표기 | **[사실]** `formatWon(12500) === '12,500원'`(`src/frontend/test/utils.test.js:24`). 디자인은 `₩12,500`. 거래 목록 부호는 ASCII `-`(`record.js:326`), 디자인은 U+2212 `−`. |
| ARIA 패턴 | **[사실]** 세그먼트·칩은 `aria-pressed` 토글 버튼(`index.html:30-33`, `dom.js:15`). e2e 가 `aria-pressed` 를 대량으로 검사한다(`frontend.spec.js` 29곳, `categories-ui.spec.js`, `dashboard-ui.spec.js`). 디자인 `components.css:133` 의 세그먼트 선택 스타일은 `aria-checked` 에만 걸려 있다(칩은 `aria-pressed` 도 지원, `:108`). |
| 운영 상태 | **[사실, 지시문]** 카테고리 기능 커밋 `373948e` 는 로컬에만 있고 운영 Neon 에 `categories` 테이블이 아직 없다. 운영 마이그레이션은 사용자가 직접 한다(plan-categories 6.8, `npm run db:migrate:prod -- --yes`). |
| 작업 트리 | **[사실, git status]** `Moneybook mobile app directions.zip`, `design_handoff_moneybook/` 가 추적되지 않은 상태. |

---

## 3. 사용자 스토리

| ID | 스토리 |
|---|---|
| US-D1 | 사용자로서, 기록·대시보드·카테고리 관리가 같은 글꼴·색·간격으로 정돈되어 보이길 원한다. |
| US-D2 | 사용자로서, 수입과 지출이 같은 크기·같은 굵기로 나란히 보이고, 지출이 경고처럼(빨강) 보이지 않길 원한다. 빨강은 오류에만 보인다. |
| US-D3 | 사용자로서, 휴대폰이 다크 모드면 앱도 어둡게 보이길 원한다. |
| US-D4 | 사용자로서, 기록 칩·카테고리 목록·도넛에서 같은 카테고리가 같은 색·무늬로 보여 어느 조각이 어느 카테고리인지 바로 알고 싶다. |
| US-D5 | 사용자로서, 금액을 빠르게 넣도록 `+1천` `+1만` `+5만` 칩을 누르고, 저장 버튼에서 저장할 금액을 확인하고 싶다. |
| US-D6 | 색각이상·스크린리더 사용자로서, 색 말고도 기호(+/−)·라벨(수입/지출)·무늬·표로 같은 정보를 얻고 싶다. |
| US-D7 | 기존 사용자로서, 빠른 입력·자동완성·날짜 변경·월 이동·인사이트·6/12개월 추이·사용 안 함 카테고리 같은 지금 쓰는 기능을 하나도 잃지 않길 원한다. |

---

## 4. 범위 / 제외 범위

### 4.1 두 가지 안 비교

| 구분 | 최소안 M (기본값) | 확장안 E (후속 권장) |
|---|---|---|
| 내용 | 시각 적용(토큰·폰트·아이콘·무늬·컴포넌트), 시스템 다크 모드, 3개 화면 재배치, 프론트만으로 되는 디자인 요소(빠른 금액 칩, 저장 버튼 금액 라벨, 균형 카드, 카테고리 색·무늬 견본, 세그먼트 개수) | M + 월 예산, 결제 수단, 색·무늬 직접 선택(viz_index), 끌어서 순서 변경, 바텀시트 편집, 저장 되돌리기, 다크 모드 토글 |
| 백엔드 | 개발 서버 MIME 1줄(`.woff2`). API·스키마 변경 **없음** | api.md v4, 스키마 변경(categories 2컬럼, transactions 1컬럼), 순서 변경 API |
| 운영 DB 영향 | **없음**. 카테고리 기능 운영 마이그레이션(373948e)을 지금 계획대로 따로 진행 가능 | 있음. categories 컬럼은 운영 마이그레이션 전이면 같이 묶을 수 있다(6장). transactions 컬럼은 기존 데이터 테이블 ALTER |
| 기존 테스트 | 시각·색 관련 테스트 일부 갱신(10장) | M + 카테고리 관리 흐름 테스트(C-C25, C-C26, C-C32) 대부분 재작성 |
| 배포 | 정적 파일만 바뀜. 코드 롤백 = Vercel 이전 배포 승격 | 마이그레이션 → 코드 순서 강제, 백업 필요 |

### 4.2 범위 (최소안 M, 이번에 한다)
1. 자산 반입: `tokens.css`, `fonts.css`, `components.css`, `fonts/*.woff2` + OFL 라이선스 2개, `icons/*.svg` 15개, `patterns/viz-2..8.svg` 7개를 `public/` 아래로 복사.
2. `style.css` 를 토큰 기반으로 다시 쓴다. 하드코딩 색 0개(토큰 정의 파일 제외). 로그인 화면도 같은 토큰을 받는다.
3. 시스템 다크 모드(`prefers-color-scheme`) 지원. 차트 SVG 의 하드코딩 색을 CSS 클래스·토큰으로 바꾼다.
4. 공통 컴포넌트: 버튼, 입력, 칩(견본·✓ 아이콘), 세그먼트, 카드, 목록 행, 배지, 탭바(아이콘), 토스트 모양의 `#flash`, 진행 막대, 표 대체, 포커스 링, reduced-motion.
5. 기록: 헤더(날짜·제목), 월 요약 2칸, 입력 카드 재배치, 빠른 금액 칩, 저장 버튼 금액 라벨·0원 비활성 표시, 칩 가로 스크롤, 목록 행 디자인(견본·배지·−/+), 날짜별 머리줄 합계. 기존 기능 전부 유지.
6. 대시보드: 헤더, 균형 카드("이번 달 남은 돈" + 수입/지출 같은 크기 2칸·같은 기준 막대), "어디에 썼나" 카드(작은 세그먼트, 도넛 R92/r60/간격 2, 범례 행), 기존 6/12개월·D3·D4 유지(토큰 색).
7. 카테고리 관리: 헤더(← + 제목), 세그먼트 개수 표시, 안내 문구, 행 디자인(견본·이름·메타), 한도 안내 문구, 탭바 대시보드 활성. 기존 조작 방식(행 버튼, 추가 폼, 사용 안 함 목록) 유지.
8. 카테고리 색·무늬 규칙(스키마 없이): 5장 D-04 권장안 C.

### 4.3 제외 범위 (판단 근거)
| 제외 | 근거 |
|---|---|
| 카테고리 "삭제"와 기록의 "기타" 이동 | 사용자 요구 "삭제는 사용 안 함, 기존 항목 연동 유지"가 우선(plan-categories 4.2). API 에 DELETE 없음(api.md 3A.5) |
| 월 예산, 결제 수단 | 스키마·API·검증·화면 신규 기능. plan.md 3.2 에서도 예산 제외. 후속(14장) |
| viz_index 컬럼, 색 직접 선택 | 5장 D-04. 위치 기반 규칙으로 견본을 보여 줄 수 있다. 사용자가 원하면 6장 절차로 묶는다 |
| 끌어서 순서 변경(≡, Alt+↑/↓) | 순서 변경 API 가 없다(api.md 3A.4). plan-categories 4.2 에서 제외한 항목. 후속 |
| 바텀시트(거래 수정 시트, 카테고리 편집 시트) | 새 상호작용 컴포넌트(포커스 가두기, scrim, Esc, 애니메이션)이고 검증 완료된 흐름(C-C25·C-C26·C-C32)을 다시 만들어야 한다. 후속(OQ-D7) |
| 저장 되돌리기 | plan.md 3.2 "undo 제외" 결정을 바꾸는 범위 변경. 후속(OQ-D5) |
| 다크 모드 앱 내 토글·localStorage | 시안에 토글 위치가 없다. 시스템 설정만 따른다. 후속(OQ-D4) |
| `donut.js` 그대로 사용 | 2장 6가지 차이. 시각 사양만 `charts.js` 에 옮긴다(D-12) |
| `src/frontend/office/` | 지시문에 따라 건드리지 않는다 |

---

## 5. 충돌 목록과 권장안

범위 표기: F=프론트만, B=백엔드(API) 변경, DB=스키마 변경. 운영 DB 영향: "없음" / "있음(설명)".

| ID | 디자인 요구 | 기존 구현·사용자 요구 | A) 디자인 그대로 | B) 기존 유지 | C) 절충 | 권장 | 범위 | 위험·운영 DB |
|---|---|---|---|---|---|---|---|---|
| D-01 (a) | 편집 시트에 [삭제](빨강), 확인 후 기록을 "기타"로 이동 | 사용자 요구: 삭제 = 사용 안 함, 기록 그대로. API DELETE 405 | 물리 삭제·재분류 | 지금처럼 [사용 안 함] 버튼, 확인 문구 `disableConfirmText` | 디자인 위치·모양에 버튼을 두되 라벨은 "사용 안 함", 색은 빨강이 아닌 `.btn--secondary`(되돌릴 수 있는 동작이므로) | **B** (시트 도입 시 C) | F | A 는 사용자 요구 위반, 비가역. 운영 DB: B/C 없음 |
| D-02 (b) | 차트 카테고리 최대 8개, 8/8 이면 추가 비활성, 이름 1–10자 | 유형별 활성 30, 전체 120, 이름 1–15자(api.md 3A.1), 도넛 상위 7 + "그 외 N개" | 서버 한도 8·10자로 축소 | 30·15자 유지 | 30·15자 유지, 안내 문구만 디자인 형식 "9/30 · 차트에는 금액이 큰 7개와 '그 외'로 보여요" | **C** | F | A 는 이미 11자 이상 이름·9개 이상 카테고리를 만든 사용자 데이터와 충돌(CHECK 축소는 운영 DB 변경). C: 없음 |
| D-03 (c-1) | 월 예산(지출만), 행 메타 "예산 ₩… · 이번 달 ₩…" | 없음 | categories.budget 컬럼+API+화면 | 메타 "기록 N건"(지금 usedCount) | 메타 "이번 달 N원 · 기록 N건"(기존 stats API 로 계산) | **B** (후속에서 A) | A: DB+B+F | A 를 하면 6장 판단. B: 없음 |
| D-04 (d) | `viz_index smallint(1–8)` 컬럼, 기본값 sort_order 순, 사용자가 8칸에서 고르면 유지. 색은 목록 순서로 고정 | `sort_order` 있음, `viz_index` 없음. 현재 도넛 색은 금액 순위 | 컬럼 추가 + 시트 색 선택 | 금액 순위 색 유지, 칩·목록에 견본 없음 | **스키마 없이 위치 기반**: 유형별 `sortOrder` 순(비활성 포함) 1~8번째 카테고리 = viz-1..8 고정. 9번째부터는 "고정 색 없음"(중립 견본). 도넛은 고정 색을 우선 쓰고, 고정 색이 없거나 겹치는 조각은 남은 번호 중 가장 작은 것, "그 외 N개"는 전용 중립 단색 | **C** | F (순수 함수 `lib/viz.js`) | A: 운영 마이그레이션 전이면 묶을 수 있음(6장). C: 없음. C 는 사용 안 함으로 바꿔도 색이 밀리지 않는다(비활성 포함 순위). 기본 지출 8개는 정확히 viz-1..8 |
| D-05 (c-2) | 결제 수단 칩 카드/계좌/현금, 행 메타 "외식 · 카드 · 08:35" | 거래에 method 없음 | transactions.method 컬럼+API+검증+화면 | 표시 안 함 | — | **B** (후속) | A: DB+B+F | A 는 운영 데이터가 있는 `transactions` ALTER(추가 전용 nullable 이면 구버전 호환이지만 plan-categories 8.1 "transactions 변경 없음" 원칙을 깸). B: 없음 |
| D-06 (c-3) | 목록 시간 "08:35" | 거래 시각 필드 없음. `createdAt`(입력 시각)만 있음 | `createdAt` 을 시각으로 표시 | 표시 안 함 | — | **B** | F | A 는 과거 날짜로 입력한 기록에 "입력한 시각"이 거래 시각처럼 보여 오해. 운영 DB 없음 |
| D-07 (c-4) | 저장 후 상단 토스트 "−₩12,500 · 외식 저장됨 [되돌리기]" 3초 | `#flash` 문구 "저장했어요" 4초(`record.js:32-37`), undo 제외(plan.md 96행) | 토스트 + 되돌리기(새 거래는 DELETE, 수정은 이전 값 PUT — 기존 API 로 가능) | 지금 문구 | `#flash` 를 토스트 모양으로, 문구는 "저장했어요"(테스트 훅) 유지, 금액·카테고리는 보조 문구로, 되돌리기 없음 | **C** (되돌리기는 OQ-D5) | F | A 는 API 변경은 없지만 범위 결정 변경, 이중 제출·포커스·3초 경합 검증 필요. 운영 DB 없음 |
| D-08 (e) | 다크 모드: 시스템 + `<html data-theme>` 수동 전환, localStorage 저장 | 다크 없음 | 토글 UI + localStorage + 첫 화면 깜빡임 방지 스크립트 | 라이트만(tokens.css 의 다크 블록 제거) | 시스템 설정만 따름(tokens.css 그대로), 토글은 후속 | **C** | F | A: 인라인 스크립트 금지라 `<head>` 에 외부 동기 스크립트(`js/theme-init.js`) 필요, 토글 위치가 시안에 없음. B 는 다크 OS 사용자에게 디자인 미적용. C 도 **차트·하드코딩 색 전부를 토큰으로 바꿔야** 한다(안 바꾸면 다크에서 흰 칸·검은 선이 남음). 운영 DB 없음 |
| D-09 (f) | 폰트(Pretendard 4종 서브셋, Newsreader 2종), 아이콘 15, 무늬 7을 `public/` 에 두고 CSS 마스크로 사용 | 시스템 폰트, 아이콘 없음 | 그대로 복사 | 시스템 폰트 유지 | 그대로 복사 + 개발 서버 MIME `.woff2` 추가 + OFL 라이선스 2개 함께 배포 + 아이콘만 있는 버튼은 aria-label 필수 | **C** | F + B(dev-server 1줄) | CSP 는 `'self'` 라 문제 없음(font·mask 모두 같은 출처, data: URI 없음). Pretendard 는 KS X 1001 2,350자 서브셋이라 그 밖의 글자(예: 일부 드문 한글 음절)는 대체 글꼴로 보인다 **[가정: 허용]**. 폰트 용량은 확인하지 못함 **[가정]**. 운영 DB 없음 |
| D-10 | 기록 화면: 헤더 → 월 요약 → 입력 카드 → "오늘" 목록. 빠른 입력·자동완성·날짜 변경·월 이동·인사이트·행 삭제 없음 | 기능 전부 있음, e2e 로 검증됨 | 시안에 없는 기능 제거 | 지금 배치 | 시안 순서로 배치하고 기존 기능은 같은 카드 안/아래에 디자인 컴포넌트로 남김: 빠른 입력 칩·메모 제안은 입력 카드 안, 날짜 details 는 메모 아래, 목록 카드는 월 이동 유지, 머리줄은 날짜별 "오늘 · 수입 +… · 지출 −…", 인사이트 카드 유지 | **C** | F | A 는 US-D7 위반, C29~C34·C61 회귀. 운영 DB 없음 |
| D-11 | 대시보드: 헤더 "‹ 2026년 ›" + "10월", 균형 카드, "어디에 썼나". 6/12개월·D3·D4·KPI 증감 없음 | 모두 있음(C57~C67, C-C33, C-C35) | 시안에 없는 기능 제거 | 지금 배치 | 균형 카드가 KPI 3칸을 대신하고(남은 돈·수입·지출 + 보조 문구에 전월 대비 문장), 그 아래 "어디에 썼나", 그 아래 6/12개월 세그먼트·D3·D4 를 토큰 스타일로 유지. 헤더 화살표는 **월 이동**(지금 동작)으로 해석하고 연도는 작은 글자로 표시 | **C** | F | A 는 회귀. 헤더 화살표의 의미는 OQ-D9. 운영 DB 없음 |
| D-12 | `reference/donut.js` 를 `public/js/` 로 옮겨 사용 | `charts.js` 도넛(묶음 "그 외 N개", 전체 행 표, 테스트 다수) | donut.js 로 교체 | charts.js 그대로 | charts.js 를 유지하고 donut.js 의 시각 사양만 이식: R92/r60, 조각 간격 2px(배경색), 색은 `.viz-fill-N` 클래스, 무늬 선 `--viz-pattern-ink`, 중앙 문구 | **C** | F | A 는 2장의 6가지 차이(색 기준, "기타" 이름, 표 묶음, innerHTML, 반지름, 가짜 DOM 비호환)로 C-C30·C-C29 정신·단위 테스트 위반. 운영 DB 없음 |
| D-13 | "표로 보기" 버튼(`aria-expanded`)으로 차트↔표 교체, 버튼 문구 "◔ 차트로 보기"로 변경 | `<details>` + summary "표로 보기"(e2e `dashboard-ui.spec.js:74,193-197`, `categories-ui.spec.js:1090`) | 버튼 토글로 교체 | details 유지 | details 유지, summary 를 `.btn--ghost.btn--sm` 모양 + `icon--table` 로. 표가 열려도 차트는 숨기지 않음 | **C** | F | A 는 e2e 3곳 재작성. 운영 DB 없음 |
| D-14 | 금액 표기 `₩12,500` | `12,500원`(`formatWon`, 단위·e2e 수십 곳) | 전부 ₩ 앞붙임 | `원` 유지 | 화면 표기는 `원` 유지, 큰 숫자(Newsreader)에도 `원` 은 Pretendard 로 자동 대체 | **B** | F | A 는 `utils.test.js:23-30` 과 e2e 의 금액 문자열 비교 대부분 재작성, 스크린리더 읽기("원 12,500")도 어색. 운영 DB 없음 |
| D-15 | 지출 부호 U+2212 `−`, 수입 `+`, 배지·화살표 병기, 금액에 `aria-label="지출 4,800원"` | ASCII `-`, `tx-kind` 텍스트 배지 | 그대로 | `-` 유지 | **A** (테스트는 `12,500원` 포함 여부만 봄 **[가정: 부호 문자열 비교 테스트 없음 — qa 확인]**) | **A** | F | 낮음. 운영 DB 없음 |
| D-16 | 세그먼트·칩 `role="radiogroup"` + `aria-checked` | `aria-pressed` 토글 버튼, e2e 수백 곳 | radiogroup 로 교체(화살표 키 이동까지 구현해야 올바름) | aria-pressed 유지 | aria-pressed 유지 + style.css 에 `.segmented [aria-pressed="true"]` 선택자 추가(components.css 는 칩에서 이미 aria-pressed 지원) | **C** | F | A 는 e2e 대량 재작성, 키보드 패턴 신규. 운영 DB 없음 |
| D-17 | 저장 버튼 "지출 저장 · ₩12,500", 금액 0이면 `disabled` | "저장"/"수정 저장"(`frontend.spec.js:525,530`), 빈 금액 + Enter 시 오류 표시(`frontend.spec.js:378-390`) | 라벨 + `disabled` | "저장" | 라벨 "지출 저장 · 12,500원"/"수입 저장 · …"/수정 모드 "수정 저장 · …", 0원이면 `aria-disabled="true"`(모양은 비활성)로 두고 누르면 지금처럼 금액 오류를 보여 준다 | **C** | F | A 의 `disabled` 는 오류 안내 경로를 없애고 포커스가 빠진다. C: 테스트 2곳 문구 갱신. 운영 DB 없음 |
| D-18 | 저장 후 금액·메모만 비우고 **카테고리 유지** | 카테고리도 비움(`record.js:126`, plan.md 490행) | 카테고리 유지 | 비움 | 새 기록 저장 후에만 유지, 수정 저장·수정 취소 후에는 지금처럼 비움 | **C** | F | 낮음. 같은 카테고리 연속 입력이 쉬워지는 대신 다음 기록에서 카테고리를 안 바꾸고 저장할 위험. OQ-D6. 운영 DB 없음 |
| D-19 | 기본 유형 = "마지막에 쓴 종류"(handoff/README.md 84행) | 지출 고정(OQ-C10 결정: 지출 유지, 기억은 후속) | localStorage 기억 | 지출 | — | **B** | F | 이미 내려진 결정과 충돌, 변경은 OQ-C10 재결정 필요. 운영 DB 없음 |
| D-20 | 카테고리 칩 가로 스크롤(`.chips--scroll`) | 줄바꿈(plan-categories 6.5 의 30개 한도 근거가 줄바꿈 전제) | 가로 스크롤 | 줄바꿈 | **A** + 키보드 포커스 시 칩이 보이도록(기본 동작) + 오른쪽 끝 가림 표시 없이도 "편집 ›" 링크는 라벨 행에 고정 | **A** | F | 30개면 대부분 칩이 화면 밖이라 발견성이 떨어진다. 대신 입력 카드 높이가 일정. C-C28 의 문서 가로 스크롤 없음 조건은 그대로 지켜야 한다. OQ-D8. 운영 DB 없음 |
| D-21 | 카테고리 행: ≡ 핸들 · 견본 · 이름+메타 · › (60px), 편집은 바텀시트 | 행에 [이름 바꾸기][사용 안 함] 텍스트 버튼(C-C25, C-C32, `categories-ui.spec.js:1296-1305` 접근 이름 검사) | 시트 도입, 행은 › 만 | 지금 행 | 행 모양만 디자인(견본·이름·메타), 버튼은 `.btn--ghost.btn--sm` 두 개 유지, ≡ 핸들 없음 | **C** (시트는 OQ-D7) | F | A 는 검증 끝난 흐름 3묶음 재작성 + 시트 컴포넌트 신규. 운영 DB 없음 |
| D-22 | 카테고리 관리에서 탭바는 대시보드 활성, ← 로 돌아감 | 활성 탭 없음, "← 기록으로" `#record` 고정 | 그대로 | 지금 | 탭바는 대시보드 활성(`aria-current="page"`), ← 버튼(44px, `aria-label="뒤로"`, 아이콘)은 앱 안에서 들어왔으면 `history.back()`, 직접 진입이면 `#dashboard`. id `catm-back` 유지 | **C** | F | `categories-ui.spec.js:53` goRecord 는 "편집 ›"으로 들어온 뒤 ← 이면 기록으로 돌아가므로 통과 예상 **[가정]**, `:1278-1291` 직접 진입 케이스는 qa 확인. 운영 DB 없음 |
| D-23 | 앱 헤더 없음(시안) | 사용자 이메일 + 로그아웃(`index.html:12-15`, 360px 줄바꿈 수정 커밋 2959dcf) | 헤더 제거 | 유지 | 유지하되 토큰 스타일(얇은 줄, caption 글자), 로그아웃은 `.btn--ghost.btn--sm` | **C** | F | 로그아웃 경로가 사라지면 안 된다. 운영 DB 없음 |
| D-24 | 도넛 중앙 "지출 N개" + 총액, 카드 제목 "어디에 썼나" | 중앙 "총 지출"/"총 수입", 제목 "카테고리 지출 비중"/"카테고리 수입 비중"(C-C33) | 그대로(수입일 때도 "어디에 썼나") | 지금 | 화면 제목은 지출 "어디에 썼나" / 수입 "어디서 들어왔나"로 대칭, `aria-label`·figcaption 은 지금 문구 유지, 중앙은 "총 지출"/"총 수입" 유지 | **C** | F | A 는 수입을 볼 때도 "썼나"라 균형 컨셉 위반. OQ-D10. 운영 DB 없음 |
| D-25 | 막대 너비는 `style` 대신 `<progress>`/`<meter>` 또는 5% 단위 클래스 권장 | `fill.style.width = …`(CSSOM, `record.js:270`), C-C29 는 `.style.cssText` 만 금지 | `<meter>` 등으로 교체 | CSSOM 유지 | — | **B** | F | CSSOM 은 CSP 위반이 아니다. 교체는 브라우저별 스타일 작업만 늘린다. 운영 DB 없음 |
| D-26 | 오류 색 `--color-error` #AC3A31, 삭제 버튼 `.btn--danger` | `--danger` #b3261e, `.btn-danger`, 테스트가 이 값·이름에 고정(`categories-ui.spec.js:9-10,59,1057-1068,1109`, `src/frontend/test/categories.test.js:73-79`) | 새 토큰·새 클래스 | 옛 값 유지 | 새 토큰 값 사용, 기존 클래스 이름(`.btn-danger`, `.error-text`)은 테스트 훅으로 남기고 디자인 클래스를 병기. 테스트는 새 값(라이트 `rgb(172, 58, 49)`, 다크 `rgb(245, 147, 135)`)으로 갱신 | **C** | F | 테스트 갱신 필요(10장). 운영 DB 없음 |
| D-27 | 카드 패딩: README "패딩 16" vs components.css `.card` 패딩 20(`components.css:146`), `.chips--scroll` 음수 여백 20(`:99`) | — | — | — | components.css 값(20)을 따른다. 음수 여백과 맞아야 칩 스크롤이 카드 끝까지 닿는다 | 20 | F | 디자인 내부 불일치. 시각 차이 작음 |
| D-28 | 도넛 색 "순서대로 써야 이웃 조각 대비 3.1 이상" vs "색은 카테고리 순서로 고정" | — | — | — | D-04 C 를 쓰면 이웃 조각이 홀짝 교차를 못 지킬 수 있다. 조각 사이 2px 배경색 간격(`--viz-gap`)과 무늬로 구분을 보장하고, 대비 검사는 "조각 대 카드 배경 3:1 이상"으로 한다 | 간격+무늬 | F | 디자인 내부 모순. A(viz_index)를 골라도 같은 문제 |
| D-29 | README 지시문은 "sort_order 컬럼 추가 외 서버 변경 없음", 상태 절은 sort_order + viz_index 추가 | sort_order 이미 있음 | — | — | 디자인 문서 내부 불일치. 최소안은 서버·DB 변경 없음 | — | — | — |

---

## 6. DB 판단: 운영 마이그레이션 전에 묶을 것인가

1. **최소안(M)에는 DB 변경이 없다.** 따라서 카테고리 기능(373948e)의 운영 반영(plan-categories 14장: 백업 → `db:migrate:prod` → 푸시)은 이 디자인 작업과 **독립적으로 지금 진행할 수 있다.** 디자인은 그 뒤에 정적 파일만 바꾸는 별도 배포로 나간다(권장, OQ-D1).
2. 사용자가 이번 디자인 라운드에서 **viz_index(D-04 A) 또는 월 예산(D-03 A)** 을 하기로 정하면, 두 컬럼은 `categories` 에 붙으므로 **운영 마이그레이션 전에 묶는 것이 좋다.** 이유: 운영 DB 에 categories 테이블이 아직 없어 사용자가 백업·마이그레이션·검증 절차(plan-categories 6.8)를 **한 번만** 하면 된다.
   - 단, `schema.sql` 의 `create table if not exists` 안에 컬럼을 넣는 것만으로는 부족하다. 로컬 PGlite·QA 픽스처처럼 **이미 categories 가 있는 DB** 에는 적용되지 않는다. `alter table categories add column if not exists …` 를 create 문 뒤에 따로 둬야 멱등이다.
   - 대가: api.md v4(카테고리 객체에 `vizIndex`/`budget`, POST/PATCH 검증), 백엔드 테스트, 카테고리 마이그레이션 검증(Q-C1, C-C1~C-C3) 재실행, reviewer 재검토가 끝날 때까지 **카테고리 기능 운영 반영이 늦어진다.**
3. 하지 않기로 하면 **미리 빈 컬럼을 넣지 않는다**(불필요한 작업 금지). 나중에 넣을 때 nullable `add column if not exists` 는 Postgres 에서 기존 행을 다시 쓰지 않는 가벼운 변경이고 구버전 코드와 호환된다 **[가정: Neon Postgres 11 이상]**. 비용은 사용자가 마이그레이션을 한 번 더 하는 것이다.
4. **결제 수단(D-05 A)** 은 `transactions` 에 붙는다. 운영 데이터가 있는 테이블 ALTER 이고 plan-categories 8.1 의 "transactions 변경 없음" 원칙을 바꾸므로 categories 마이그레이션과 묶지 말고 **후속 별도 계획**으로 한다.
5. **순서 변경(드래그)** 은 `sort_order` 가 이미 있어 DB 변경이 없다. API(예: `PATCH /api/categories/:id` 에 `sortOrder` 허용 또는 일괄 순서 엔드포인트)만 필요하다. 마이그레이션 시점과 무관.

| 선택 | 운영 마이그레이션 | 카테고리 기능 운영 반영 시점 |
|---|---|---|
| 최소안(기본) | 지금 계획 1회 그대로 | 지금 바로 가능 |
| viz_index·예산 이번에 함 | 1회(묶음). `alter … add column if not exists` 포함 | 백엔드 v4 + 재검증 후 |
| 나중에 함 | 지금 1회 + 나중 1회 | 지금 바로 가능 |

---

## 7. 자산 반입과 CSP

| 원본(`design_handoff_moneybook/handoff/`) | 대상(`src/frontend/public/`) | 비고 |
|---|---|---|
| `tokens.css` | `css/tokens.css` | 수정 없이 복사. 다크 값이 두 번 들어 있음(`@media` 와 `[data-theme="dark"]`) — 토글을 안 해도 그대로 둔다 |
| `fonts.css` | `css/fonts.css` | `url("../fonts/…")` 경로 그대로 맞음 |
| `fonts/*.woff2` 6개, `OFL-Pretendard.txt`, `OFL-Newsreader.txt` | `fonts/` | 라이선스 파일도 공개 경로에 둔다(OFL 조건) |
| `components.css` | `css/components.css` | 복사 원본은 고치지 않고, 앱 맞춤(aria-pressed 선택자, 기존 클래스 병기)은 `style.css` 에 둔다. 값 바꿀 때 원본과 비교가 쉽다 |
| `icons/*.svg` 15개 | `icons/` | `url("../icons/…")` 경로 맞음 |
| `patterns/viz-2..8.svg` | `patterns/` | 1번은 무늬 없음 |
| `reference/donut.js` | 복사하지 않음 | D-12 |

- 로드 순서(index.html, login.html 공통): `css/fonts.css` → `css/tokens.css` → `css/components.css` → `css/style.css`. 모두 `<link rel="stylesheet">` 라 CSP 문제 없음.
- 개발 서버: `dev-server.js` MIME 에 `'.woff2': 'font/woff2'` 추가(backend). `.txt` 는 이미 있음.
- `Moneybook Handoff.dc.html`, `support.js`, zip 은 `public/` 에 두지 않는다. 저장소에 커밋할지는 OQ-D11.
- 금지 재확인: 인라인 `style`/`<style>`/`<script>`, `on*=`, 외부 CDN·폰트, `data:` URI, `innerHTML`.

---

## 8. 화면별 변경 (최소안 M)

공통 규칙
- **기존 id·클래스는 테스트 훅이므로 지운다/바꾸지 않는다.** 디자인 클래스는 덧붙인다(예: `class="btn btn-primary btn--primary btn--block"`). 테스트 훅 목록: `#amount #type-expense #type-income #category-chips #memo #memo-suggestions #date-details #date-summary #save-btn #cancel-edit-btn #flash #quick-chips #month-prev #month-next #month-title-h #month-summary #tx-list .tx-row .tx-edit .tx-del #insights #dash-prev #dash-next #dash-month #range-6 #range-12 #kpi .kpi .kpi-label .kpi-value .kpi-extra #catview-expense #catview-income #chart-donut #chart-monthly #chart-cat-trend #cat-trend-chips svg.chart-svg .legend .legend-label .legend-amount .legend-ratio details.chart-table #panel-categories #cat-title #catm-* .cat-row .cat-name a.cat-edit-link #tab-record #tab-dashboard #logout-btn .error-text .btn-danger .chip`.
- 레이아웃: `.screen` 기준 폭 360, 최대 480 가운데, 좌우 20px. (지금 `.app-main` 최대 720 → 480 으로 줄어든다. 768px 에서도 가운데 480 칼럼.)
- 수입/지출 표기: 금액마다 기호(+/−) + 배지 또는 화살표 아이콘 중 둘 이상, `aria-label="지출 12,500원"`.
- 빨강(`--color-error`)은 오류 문구와 거래 삭제 버튼에만.

### 8.1 공통 (단계 1·2)
| 파일 | 변경 | 담당 |
|---|---|---|
| `public/css/tokens.css`, `fonts.css`, `components.css`, `fonts/*`, `icons/*`, `patterns/*` (신규) | 7장 복사 | frontend |
| `public/css/style.css` | 옛 색 변수 제거 → 토큰. 하드코딩 색 제거. 기존 클래스에 디자인 스타일 연결(`.btn-primary`=`.btn--primary` 등). `.segmented [aria-pressed="true"]` 선택 스타일. `.error-text` 에 `.field__error` 모양(⚠ 아이콘). 차트용 클래스(`.chart-axis`, `.chart-grid`, `.chart-stroke`, `.viz-fill-N`, `.viz-other`). `#flash` 토스트 모양. 탭바 2칸 그리드·아이콘 | frontend |
| `public/index.html`, `public/login.html` | `<head>` CSS 4개. 탭바 링크에 아이콘 span(`aria-hidden`). 헤더 클래스 | frontend |
| `public/js/dom.js` | `chipItem` 에 선택 옵션 `viz`(견본 span `data-viz`)와 ✓ 아이콘 span 추가. 버튼 `textContent` 는 라벨 그대로 유지(테스트가 `toHaveText` 사용) | frontend |
| `public/js/tabs.js` | `categories` 일 때 `#tab-dashboard` 에 `aria-current="page"` | frontend |
| `public/js/lib/viz.js` (신규, 순수 함수) | `stableVizMap(items, type)`: 유형별 `sortOrder`(동률 이름) 순, 비활성 포함 1~8번째 → 1..8. `assignDonutViz(slices, map)`: 조각마다 고유 번호(고정 우선, 없거나 겹치면 남은 가장 작은 번호), 묶음 조각은 `'other'` | frontend |
| `src/backend/scripts/dev-server.js` | MIME `.woff2` | backend |
| `src/frontend/test/*.test.js` | 10장 단위 테스트 갱신, `viz.js` 단위 테스트 신규 | frontend |

### 8.2 기록 (단계 3)
| 파일 | 변경 |
|---|---|
| `public/index.html` `#panel-record` | 위에서부터: 헤더(오늘 날짜 caption + "기록" `.title-lg`, 지금 visually-hidden h1 을 보이는 제목으로) → 월 요약 2칸(↓ 이번 달 수입 / ↑ 이번 달 지출, 그 달 = 목록 카드가 보고 있는 달) → 입력 카드(세그먼트 지출\|수입 → 금액(라벨 "금액", 입력 뒤 고정 "원" 표시는 `aria-hidden`) → 빠른 금액 칩 `+1천 +1만 +5만` → 카테고리 라벨 행 "카테고리 / 편집 ›" + 가로 스크롤 칩 → 메모 + 메모 제안 칩 → 날짜 details → 저장 → 수정 취소) → 빠른 입력 카드 → 목록 카드(월 이동, 날짜별 머리줄, 행) → 인사이트 카드 |
| `public/js/record.js` | 빠른 금액 칩(누를 때마다 더함, 상한 100,000,000 에서 멈추고 오류 문구), 저장 라벨 갱신(유형·금액·수정 모드), 0원 `aria-disabled`, 새 기록 저장 후 카테고리 유지(D-18), `#flash` 토스트 문구(유지 "저장했어요"), 월 요약 2칸 렌더(지금 `renderMonthSummary` 의 3칸은 수입/지출 2칸 + "남은 돈" caption 한 줄로), 목록 행(견본 28 · 카테고리 15/500 + 메타 "메모" 13 muted · 오른쪽 금액 15/600 + 배지), 행 삭제 버튼은 텍스트 "삭제" 유지(`.btn--ghost.btn--sm` + danger 색), 날짜 머리줄 합계(그날 수입 +… · 지출 −…) |
| `public/js/lib/money.js` | 빠른 금액 더하기 순수 함수(상한 처리), 부호 붙은 표기(U+2212) 함수 |
| `public/js/lib/viz.js` | 칩 견본용 번호 조회 |

### 8.3 대시보드 (단계 4)
| 파일 | 변경 |
|---|---|
| `public/index.html` `#panel-dashboard` | 헤더(‹ › 월 이동 + 연도 caption + 월 제목 24/700, 오른쪽 "카테고리 관리" `.btn--ghost.btn--sm`) → 균형 카드(`#kpi` 컨테이너 유지) → "어디에 썼나" 카드(제목 + 작은 세그먼트 `#catview-expense/#catview-income`, `#chart-donut`) → 6/12개월 세그먼트 + `#chart-monthly` → `#chart-cat-trend` |
| `public/js/dashboard.js` | 균형 카드: 남은 돈(Newsreader 44, 음수면 −), 수입/지출 2칸(라벨 13/600 해당 색, 금액 Newsreader 24, 막대 8px, 보조 문구 = 지금 전월 대비 문장). 두 막대 기준 = max(수입, 지출). 각 칸은 `.kpi` 훅 유지 |
| `public/js/lib/dashboard-data.js` | 균형 카드 순수 함수(막대 비율, 0/0 처리) + 단위 테스트 |
| `public/js/charts.js` | 색 hex 제거 → 클래스(`viz-fill-N`, 무늬 선 `--viz-pattern-ink`, 축·격자·테두리 클래스). 도넛 R92/r60, 조각 간격 2px(배경색). 조각 색은 `assignDonutViz`. "그 외 N개" 전용 중립 단색(무늬 없음, 클래스 `viz-other`). 묶은 막대 수입 `--color-income`+사선, 지출 `--color-expense`+역사선(같은 밀도 유지). 범례 견본은 `.swatch[data-viz]`. `PALETTE`/`OTHER_STYLE` 상수는 제거하거나 토큰 이름 배열로 바꾼다(테스트 갱신 10장) |
| `public/js/lib/chart-geometry.js` | 조각 간격(gap) 지원 시 `donutSegments` 옵션 추가 + 단위 테스트 |

### 8.4 카테고리 관리 (단계 5)
| 파일 | 변경 |
|---|---|
| `public/index.html` `#panel-categories` | 헤더(← 아이콘 버튼 44px `#catm-back` + "카테고리 관리" 19/600 `#cat-title`) → 세그먼트 "지출 N \| 수입 N"(버튼 텍스트는 "지출"/"수입" 유지하고 개수는 별도 span — `categories.test.js:69` 정규식이 `>지출</button>` 를 기대하므로 개수 span 을 넣으면 이 테스트 갱신 필요) → 안내 문구 "목록 순서대로 차트의 색과 무늬가 정해져요." → 목록 카드(`#catm-active`) → 추가 폼(`#catm-add`, 버튼 `.btn--secondary`) + 한도 문구 → 사용 안 함 details |
| `public/js/category-manager.js` | 행: 견본 28 · 이름 15/500 · 메타 12 muted "기록 N건" · 버튼 2개(`.btn--ghost.btn--sm`, 접근 이름 유지). 마지막 행 구분선 없음. ← 동작(D-22). 한도 문구 "9/30 · …" |
| `public/js/lib/categories-data.js` | 세그먼트 개수·한도 문구 순수 함수 + 단위 테스트 |

---

## 9. 작업 목록 (단계 순서와 담당)

순서: 토큰·폰트 → 공통 컴포넌트 → 기록 → 대시보드 → 카테고리 관리 → 통합 검증. 각 담당은 자기 영역만 수정(frontend: `src/frontend/public/`, `src/frontend/test/` / backend: `src/backend/` / qa: `e2e/`, `docs/qa-report.md`). `src/frontend/office/` 는 누구도 건드리지 않는다.

| ID | 단계 | 작업 | 담당 | 의존 |
|---|---|---|---|---|
| B-D1 | 0 | `dev-server.js` MIME `.woff2` 추가 + 기존 dev-server 테스트에 woff2 Content-Type 1건 | backend | - |
| B-D2 | 0 | (확장안 선택 시에만) api.md v4 초안: 카테고리 `vizIndex`/`budget`, 순서 변경, 스키마 `alter … add column if not exists`. **최소안이면 하지 않는다** | backend | OQ-D2, OQ-D3 |
| F-D1 | 1 | 자산 복사(7장), CSS 4개 로드, `style.css` 토큰 전환·하드코딩 색 제거, 로그인 화면 확인 | frontend | - |
| F-D2 | 2 | 공통 컴포넌트(8.1): 버튼·입력·칩·세그먼트·카드·행·배지·탭바·토스트·막대·포커스·reduced-motion, `dom.js` 칩 견본, `tabs.js`, `lib/viz.js` + 단위 테스트 | frontend | F-D1 |
| F-D3 | 3 | 기록 화면(8.2) + 단위 테스트(빠른 금액, 부호 표기) | frontend | F-D2 |
| F-D4 | 4 | 대시보드(8.3), `charts.js` 토큰화·다크 대응·도넛 사양 + 단위 테스트 갱신 | frontend | F-D2 (F-D3 과 병렬 가능) |
| F-D5 | 5 | 카테고리 관리(8.4) + 단위 테스트 갱신 | frontend | F-D2 (F-D3·F-D4 와 병렬 가능) |
| F-D6 | 6 | 자체 점검: 360/768 × 라이트/다크, 콘솔 CSP 위반 0, `npm test` 전체 | frontend | F-D3~F-D5, B-D1 |
| Q-D1 | 6 | 기존 e2e 갱신(10장 중 e2e 분), 신규 e2e `e2e/tests/design.spec.js`(11장 C-D 항목) | qa | F-D6 |
| Q-D2 | 6 | 전체 회귀(C1~C71, C-C1~C-C38) mobile-360·tablet-768, 라이트·다크, `docs/qa-report.md` "디자인 적용" 절 | qa | Q-D1 |
| R-D1 | 7 | reviewer 최종 리뷰(토큰 외 hex 0, innerHTML 0, 테스트 훅 보존, office 미변경) | reviewer | Q-D2 |

병렬 구간: B-D1 과 F-D1 동시 시작. F-D2 이후 F-D3/F-D4/F-D5 는 같은 `index.html` 의 서로 다른 패널만 고치므로 병렬 가능하나, `style.css` 충돌을 줄이려면 화면별 CSS 를 `style.css` 안 구역 주석(`/* 기록 */` 등)으로 나눈다.

---

## 10. 영향받는 기존 테스트 (파일:줄)

| 파일:줄 | 현재 가정 | 최소안에서의 조치 | 소유 |
|---|---|---|---|
| `e2e/tests/categories-ui.spec.js:9-10, 55-71` | `--danger` = `rgb(179, 38, 30)`, `--ok`, 예외 클래스 `.error-text, .btn-danger` | 금지 색을 "오류 외 요소에 `--color-error`(라이트 172,58,49 / 다크 245,147,135) 없음"으로 바꾸고 다크에서도 실행. 예외 클래스는 훅 유지로 통과 | qa |
| `e2e/tests/categories-ui.spec.js:1057-1068` | CSS 에 `var(--danger)` 가 `.btn-danger/.error-text` 에만, `#b3261e` 1회 | `var(--color-error)` 사용처 검사로 재작성(허용: `.error-text`, `.field__error`, `.btn-danger`/`.btn--danger`, `[aria-invalid]` 테두리) | qa |
| `e2e/tests/categories-ui.spec.js:1109` | 오류 문구 색 = `rgb(179, 38, 30)` | 새 값 | qa |
| `e2e/tests/categories-ui.spec.js:1137-1153` | `charts.js` 의 `PALETTE`·`OTHER_STYLE` hex 를 파싱해 흰 배경 대비 | `tokens.css` 의 `--viz-1..8` 라이트(대 `#FFFFFF` 3:1 이상)·다크(대 `#1F1E1B` 3:1 이상) 파싱으로 재작성, 묶음 색도 같은 방식 | qa |
| `e2e/tests/categories-ui.spec.js:570-576` | 검사 대상 JS 6개 | `lib/viz.js` 추가 | qa |
| `e2e/tests/categories-ui.spec.js:673-760` (C-C30) | 조각 fill 8개 모두 다름, 마지막 "그 외 N개" | 그대로 유지돼야 함(색 규칙만 바뀜). 묶음 조각 무늬 조건이 있으면 갱신 | qa |
| `e2e/tests/categories-ui.spec.js:52-53, 1278-1291` | `a.cat-edit-link` 진입, `#catm-back` 클릭 시 기록으로 | 훅 유지. 직접 진입 후 ← 동작이 `#dashboard` 로 바뀌면 해당 단계 갱신(D-22) | qa |
| `e2e/tests/categories-ui.spec.js:298` | 하단 탭 2개 | 유지. 관리 화면에서 대시보드 탭 `aria-current` 검사 추가 | qa |
| `e2e/tests/dashboard-ui.spec.js:53-54, 108-127` | `#kpi .kpi` 3개, 라벨 `['수입','지출','잔액']`, 잔액 칸 extra 빈 문자열 | 균형 카드 DOM 순서·라벨(OQ-D12 기본: `['남은 돈','수입','지출']`)로 갱신 | qa |
| `e2e/tests/dashboard-ui.spec.js:296-311, 355-372` | `#kpi .kpi-value` `nth(1)` 이 지출 | 순서가 바뀌면 인덱스 갱신 | qa |
| `e2e/tests/dashboard-ui.spec.js:74, 78, 193-197`, `categories-ui.spec.js:1090` | `details.chart-table summary` "표로 보기" | details 유지라 통과 예상(D-13 C) | qa |
| `e2e/tests/dashboard-ui.spec.js:219, 223-230` | `svg.chart-svg > path` fill 서로 다름, 막대 fill `url(#…)` | 클래스·fill 속성 구조 유지로 통과 예상 | qa |
| `e2e/tests/frontend.spec.js:525, 530` | 저장 버튼 문구 "수정 저장"/"저장" | 금액 라벨 포함 문구로 갱신(D-17) | qa |
| `e2e/tests/frontend.spec.js:378-390` | 빈 금액 + Enter → 금액 오류 | `aria-disabled` 방식이면 통과해야 함(회귀 확인) | qa |
| `e2e/tests/frontend.spec.js:336` 등 `#flash` "저장했어요" | 문구 | 토스트에서도 `#flash` 텍스트 유지 → 통과 예상 | qa |
| `e2e/tests/frontend.spec.js:787-802`, `dashboard-ui.spec.js:65-80`, `categories-ui.spec.js:498-555` | 360px 가로 스크롤 없음, 버튼 44×44 | 새 요소(빠른 금액 칩, ← 버튼, 편집 › 링크, 표로 보기)도 대상에 추가 | qa |
| `e2e/tests/frontend.spec.js` 칩 선택 후 상태 검사(저장 후 카테고리 해제를 기대하는 단계가 있으면) | 저장 후 카테고리 비움 | D-18 로 유지되므로 갱신 **[가정: 해당 단계 존재 여부 qa 확인]** | qa |
| `src/frontend/test/charts.test.js:141, 183-185, 221-226` | `PALETTE`, `OTHER_STYLE`, `PATTERN_KINDS` export 와 흰 배경 대비 | 토큰 번호 기반으로 재작성, 묶음 조각 = 무늬 없는 중립 단색이라 `!PATTERN_KINDS.includes(kind)` 조건 변경 | frontend |
| `src/frontend/test/charts.test.js:28-55` | 도넛 구조·범례 textContent·표 행 수 | 견본이 빈 span 이면 통과 예상. 반지름 변경은 `chart-geometry.test.js` 확인 | frontend |
| `src/frontend/test/categories.test.js:62-71` | 세그먼트 버튼 마크업 `>지출</button>` | 개수 span 을 버튼 안에 넣으면 정규식 갱신 | frontend |
| `src/frontend/test/categories.test.js:73-79` | CSS `--ok` 없음, `var(--danger)` 줄이 `.error-text/.btn-danger` 로 시작 | `--color-error` 기준으로 재작성 | frontend |
| `src/frontend/test/utils.test.js:23-30` | `formatWon` → `원` | D-14 B 라 변화 없음 | - |
| `src/backend/test/dev-server-qa.test.js` | 정적 파일 헤더 | woff2 Content-Type 1건 추가(B-D1) | backend |

---

## 11. 완료 기준 (QA 체크리스트)

사전 준비는 plan.md 9장, plan-categories 13장과 같다. "라이트"는 `colorScheme: 'light'`, "다크"는 `page.emulateMedia({ colorScheme: 'dark' })`. 별도 표시가 없으면 360px 라이트·다크 둘 다에서 확인한다.

### 11.1 자산 · CSP
- [ ] C-D1. `public/` 에 `css/tokens.css`, `css/fonts.css`, `css/components.css`, `fonts/` woff2 6개 + OFL 2개, `icons/` svg 15개, `patterns/` svg 7개가 있고 원본(`design_handoff_moneybook/handoff/`)과 바이트가 같다(components.css 포함, 앱 맞춤은 style.css 에만).
- [ ] C-D2. 기록·대시보드·카테고리 관리·로그인 화면을 라이트·다크로 열고 전 흐름(저장, 수정, 삭제, 빠른 금액, 월 이동, 카테고리 보기 전환, 표로 보기, 카테고리 추가·이름 변경·사용 안 함·다시 사용)을 하는 동안 콘솔 CSP 위반·페이지 오류 0건.
- [ ] C-D3. 네트워크 기록에서 모든 요청이 같은 출처이고, 폰트 6개 중 쓰인 것과 아이콘·무늬 svg 가 200. 로컬 개발 서버에서 woff2 의 Content-Type 이 `font/woff2`.
- [ ] C-D4. `document.fonts.check('16px Pretendard')` 와 `document.fonts.check('36px Newsreader')` 가 폰트 로드 후 true. 금액 입력의 computed `font-family` 첫 항목이 Newsreader.
- [ ] C-D5. 정적 검사: index.html·login.html 에 인라인 script·`on*=`·`style=`·`<style>`·`data:`·외부 URL 없음(C-C29 확장). `public/js/**` 에 `innerHTML|outerHTML|insertAdjacentHTML|document.write|eval(|new Function(` 없음. `style.css`·`components.css` 에 `url(` 은 같은 출처 상대 경로만.
- [ ] C-D6. 하드코딩 색 0: `style.css` 와 `public/js/**` 에 hex 색·`rgb(` 문자열이 없다(`tokens.css` 만 예외, `components.css` 의 견본 inset 그림자 `rgba(0,0,0,.08)` 1건은 원본 그대로 허용).

### 11.2 토큰 · 다크 · 균형
- [ ] C-D7. 라이트에서 `body` 배경 `rgb(247, 245, 240)`, 글자 `rgb(27, 26, 23)`. 다크에서 `rgb(20, 20, 18)` / `rgb(238, 235, 227)`.
- [ ] C-D8. 다크에서 세 화면의 모든 보이는 요소 중 computed `background-color` 가 `rgb(255, 255, 255)` 인 것 0개, SVG `fill`/`stroke` 가 `#fff`·`#333`·`#555`·`#d0d4da` 인 것 0개(옛 하드코딩 잔존 검사).
- [ ] C-D9. 대비(라이트·다크 각각, computed 색으로 계산): 본문·보조 글자 대 배경/카드 4.5:1 이상, 입력·칩 테두리와 포커스 링 3:1 이상, 도넛 조각과 막대 색 대 카드 배경 3:1 이상.
- [ ] C-D10. 오류 색 범위: 오류 문구, `aria-invalid` 테두리, 거래 삭제 버튼 외 요소에 `--color-error` 의 computed 값(라이트 `rgb(172, 58, 49)`, 다크 `rgb(245, 147, 135)`)이 없다(C-C36 대체, 라이트·다크).
- [ ] C-D11. 수입 금액은 `--color-income`, 지출은 `--color-expense` 이고, 모든 금액 표시(월 요약, 목록 행, 균형 카드)에 기호(+ 또는 U+2212 −)·배지·화살표 아이콘 중 둘 이상과 `aria-label`("지출 12,500원" 형식)이 있다.
- [ ] C-D12. `prefers-reduced-motion: reduce` 에서 버튼·칩·입력의 computed `transition-duration` 이 모두 0s.

### 11.3 공통 컴포넌트 · 접근성
- [ ] C-D13. 모든 버튼·칩·링크·탭·summary 가 44×44px 이상, 주 버튼(`#save-btn`)은 높이 52px 이상(새 요소 포함, C32·C-C28 확장).
- [ ] C-D14. Tab 으로 이동하는 모든 요소에 `:focus-visible` 일 때 `--color-focus` 링(box-shadow)이 보인다(라이트 `rgb(6, 88, 171)`, 다크 `rgb(125, 182, 254)`).
- [ ] C-D15. 선택된 칩·세그먼트는 색 외에 ✓ 아이콘(칩) 또는 카드 배경+그림자(세그먼트)가 있고 `aria-pressed="true"`.
- [ ] C-D16. 아이콘만 있는 버튼(← 뒤로 등)은 모두 접근 이름이 있다. 아이콘 span 은 `aria-hidden="true"`.
- [ ] C-D17. 입력 오류 시 `aria-invalid="true"` + `aria-describedby` 가 오류 문구를 가리키고, 오류 문구 앞에 ⚠ 아이콘(장식)이 보인다.
- [ ] C-D18. 하단 탭바: 2칸, 활성 탭은 primary 배경·inverse 글자, `aria-current="page"`. 카테고리 관리 화면에서는 대시보드 탭이 활성.
- [ ] C-D19. 360px 세 화면(시드 사용자, 카테고리 30개·15자 이름 포함)에서 `document.documentElement.scrollWidth <= 360`. 768px 에서는 본문 칼럼 폭 480 이하, 가운데 정렬.

### 11.4 기록
- [ ] C-D20. 배치 순서: 헤더(날짜·"기록") → 월 요약 2칸 → 입력 카드 → 빠른 입력 → 목록 카드 → 인사이트. 월 요약 두 칸의 너비·높이 차 1px 이하.
- [ ] C-D21. 빠른 금액: 빈 금액에서 `+1만` → `10,000`, 이어서 `+1천` → `11,000`, `+5만` → `61,000`. 1억에 가까울 때 더하면 1억을 넘지 않고 금액 오류 문구가 보인다. 칩을 눌러도 포커스가 사라지지 않는다.
- [ ] C-D22. 저장 버튼: 지출 12,500 입력 시 "지출 저장 · 12,500원", 수입으로 바꾸면 "수입 저장 · 12,500원", 수정 모드는 "수정 저장 · …". 금액이 비면 `aria-disabled="true"` 모양이고, 누르거나 칩 직후 Enter 면 지금처럼 금액 오류(C29 추가2 유지), POST 0회.
- [ ] C-D23. 새 기록 저장 후 금액·메모는 비고 유형과 카테고리는 유지, `#flash` 토스트에 "저장했어요". 수정 저장·수정 취소 후에는 카테고리 선택이 해제된다(OQ-D6 기본값).
- [ ] C-D24. 카테고리 칩은 가로 스크롤 한 줄, 각 칩 앞에 견본(기본 지출 8개는 data-viz 1..8 순서), 30개여도 문서 가로 스크롤 없음, Tab 으로 마지막 칩까지 가면 그 칩이 보인다. "편집 ›" 링크는 라벨 행 오른쪽에 있고 누르면 카테고리 관리.
- [ ] C-D25. 목록 행: 견본·카테고리·메모·금액(부호)·배지가 보이고 행 높이 64px 이상, 날짜 머리줄에 그날 수입·지출 합계(금액은 그날 행 합과 같음). 행을 누르면 지금처럼 폼 수정 모드, 삭제 버튼 동작(confirm) 그대로.
- [ ] C-D26. 기존 기록 기능 회귀: C29~C34, C61, C-C23, C-C24, R1 빠른 입력, R2 자동완성(null 카테고리 포함), 날짜 변경, 월 이동, 인사이트 문구(C-C38) 모두 통과.

### 11.5 대시보드
- [ ] C-D27. 균형 카드: "이번 달 남은 돈" = 수입 − 지출(음수면 앞에 −), Newsreader 44px. 수입·지출 두 칸 너비 차 1px 이하, 두 막대 높이 8px 로 같고, 큰 쪽 막대 너비가 트랙의 100%(±1px), 작은 쪽은 비율대로(예: 수입 900,000 / 지출 400,000 → 지출 막대 44.4%±1px). 수입·지출이 모두 0이면 두 막대 0%, NaN 없음.
- [ ] C-D28. 균형 카드 보조 문구가 지금 KPI 전월 대비 문장과 같다(C-C35 문구·▲/▼, 색은 muted).
- [ ] C-D29. 도넛: 바깥 반지름 92, 안쪽 60, 조각 사이 배경색 간격이 보인다. 같은 카테고리는 기록 칩 견본과 도넛 조각·범례·표 견본의 `data-viz` 번호가 같다(고정 번호가 있는 카테고리 한정). 한 도넛 안 조각 fill 은 모두 다르고, "그 외 N개"는 중립 단색(C-C30 유지).
- [ ] C-D30. 카테고리 보기 세그먼트가 "어디에 썼나" 카드 제목 줄에 있고, 수입 선택 시 제목 "어디서 들어왔나"(OQ-D10 기본), `#chart-donut` aria-label·figcaption·중앙 문구는 C-C33 그대로.
- [ ] C-D31. 6/12개월, D3 월별 막대(수입 사선·지출 역사선, 수입·지출 토큰 색), D4 추이가 라이트·다크 모두 보이고 C57~C67, C-C33, C-C37(토큰 기준으로 갱신) 통과.
- [ ] C-D32. "표로 보기" summary 가 버튼 모양(44px 이상)이고 열면 표가 보인다. 표 행·합계가 API 와 일치(C62 유지).

### 11.6 카테고리 관리
- [ ] C-D33. 헤더 ← 버튼 44×44(접근 이름 "뒤로"), 기록 "편집 ›"으로 들어오면 ← 로 기록, 대시보드 버튼으로 들어오면 ← 로 대시보드, `#categories` 직접 진입이면 ← 로 대시보드.
- [ ] C-D34. 세그먼트에 유형별 **활성** 개수가 보이고(예: "지출 8", "수입 4"), 추가·사용 안 함·다시 사용 후 바로 바뀐다. 두 버튼 크기 차 1px 이하(C-C32 유지).
- [ ] C-D35. 행: 견본 28px(정렬 순서 1~8번째는 data-viz 1..8, 9번째부터 중립 견본) · 이름 · "기록 N건" · [이름 바꾸기][사용 안 함] 버튼, 마지막 행 아래 구분선 없음. 행 버튼 접근 이름은 지금과 같다(`categories-ui.spec.js:1296-1305` 통과).
- [ ] C-D36. 한도 문구가 "N/30" 형식으로 보이고, 30개면 추가 버튼이 비활성 모양 + 이유 문구(서버 409 문구와 같은 뜻).
- [ ] C-D37. 사용 안 함으로 바꿔도 다른 카테고리의 견본 번호가 바뀌지 않는다(비활성 포함 순위). 다시 사용하면 원래 번호.
- [ ] C-D38. 기존 관리 기능 회귀: C-C23~C-C29, C-C32 모두 통과(문구·흐름 변화 없음).

### 11.7 전체 회귀
- [ ] C-D39. `npm test`(백엔드·프론트 단위) 전부 통과, e2e 전체(C1~C71, C-C1~C-C38, 10장 갱신 반영) mobile-360·tablet-768 통과, 다크 모드로 C-D2·C-D8·C-D10 별도 실행 통과.
- [ ] C-D40. `git status` 로 변경 파일이 `src/frontend/public/`, `src/frontend/test/`, `src/backend/scripts/dev-server.js`(+ 그 테스트), `e2e/`, `docs/` 안에만 있고 `src/frontend/office/` 변경 0, `src/backend/db/schema.sql`·`docs/api.md` 변경 0(최소안).

### 11.8 배포 확인 (운영 반영 후, 사용자 승인 하에)
- [ ] P-D1. 운영 URL 에서 CSS 4개·폰트·아이콘 200, 응답 CSP 헤더가 지금과 같고 콘솔 CSP 위반 0.
- [ ] P-D2. 실제 휴대폰(가능하면 iOS Safari 와 Android Chrome) 라이트·다크에서 세 화면 확인, 금액 입력 포커스 시 화면 확대 없음(입력 16px 이상). 사용자 확인 항목.
- [ ] P-D3. 테스트 계정으로 저장·수정·삭제·카테고리 추가 스모크. 실사용자 데이터 변경 없음.

---

## 12. 위험

| 위험 | 대응 |
|---|---|
| tokens.css 만 넣어도 다크 OS 사용자는 바로 다크가 된다. 차트·입력 등 하드코딩 색이 남으면 다크에서 깨진다 | C-D6, C-D8. 단계 1에서 하드코딩 색을 먼저 없앤다 |
| 기존 클래스·id 를 디자인 이름으로 바꾸면 e2e 수백 곳이 깨진다 | 8장 "테스트 훅 유지 + 디자인 클래스 병기" 원칙, reviewer 확인 |
| 기록 칩 가로 스크롤로 30개 카테고리 발견성 저하 | OQ-D8. 문제가 되면 줄바꿈으로 되돌리는 것은 CSS 1곳 |
| 위치 기반 색 규칙에서 9번째 이후 카테고리는 칩 견본이 중립이라 도넛 색과 연결이 안 된다 | 안내 문구, OQ-D2 에서 viz_index 선택 가능 |
| 폰트 용량으로 첫 화면이 느려짐 **[가정: 용량 미확인]** | `font-display: swap`(fonts.css 이미 적용), 필요하면 굵기 수 축소 검토 |
| CSS 마스크 미지원 브라우저에서 아이콘이 안 보임 **[가정: 대상 브라우저는 지원]** | 아이콘은 장식, 모든 버튼에 텍스트 또는 접근 이름. ← 버튼은 아이콘 없이도 이름이 있음 |
| 디자인 문서 내부 불일치(D-27, D-28, D-29) | 이 문서의 결정으로 고정 |
| 카테고리 기능 운영 반영 전후 순서 혼동 | 6장. 최소안이면 디자인과 무관하게 카테고리 먼저 반영 |

---

## 13. 열린 질문 (답이 없으면 권장 기본값으로 진행)

| ID | 질문 | 권장 기본값 | 근거 |
|---|---|---|---|
| OQ-D1 | 카테고리 기능(373948e)의 운영 마이그레이션·푸시를 디자인과 **따로** 먼저 할까, 디자인 완료 후 한 번에 할까? | **따로 먼저**(최소안은 DB 변경 없음) | 6장. 변경 묶음이 작을수록 롤백이 쉽다 |
| OQ-D2 | 차트 색: viz_index 컬럼 + 색 직접 선택(A) vs 위치 기반 고정(C) | **C, 컬럼 없음** | D-04. A 를 고르면 운영 마이그레이션 전에 묶는다(6장) |
| OQ-D3 | 월 예산을 이번에 할까? | **후속** | D-03. 하기로 하면 viz_index 와 같은 시점에 묶음 |
| OQ-D4 | 다크 모드 앱 안 토글(어디에 둘지 포함)을 이번에 할까? | **시스템 설정만, 토글 후속** | D-08. 시안에 위치 없음 |
| OQ-D5 | 저장 토스트의 [되돌리기]를 이번에 할까?(plan.md "undo 제외" 결정 변경) | **후속** | D-07. API 변경은 없지만 범위 결정 변경 |
| OQ-D6 | 새 기록 저장 후 카테고리를 유지할까?(plan.md 490행 변경) | **유지(새 기록만)** | D-18. 디자인 명시, 프론트 1곳 |
| OQ-D7 | 바텀시트(카테고리 편집 시트 2d, 거래 수정 시트)를 이번에 할까? | **후속**. 이번에는 행 버튼 방식 유지 | D-21. 검증된 흐름 재작성 비용 |
| OQ-D8 | 기록 카테고리 칩: 가로 스크롤(디자인) vs 줄바꿈(지금) | **가로 스크롤** | D-20 |
| OQ-D9 | 대시보드 헤더 "‹ 2026년 ›"의 화살표는 연도 이동인가 월 이동인가? | **월 이동**(지금 동작), 연도는 표시만 | D-11. 시안에 월을 바꾸는 다른 수단이 없다 **[가정]** |
| OQ-D10 | 수입 보기일 때 카드 제목 | **"어디서 들어왔나"**(지출은 "어디에 썼나") | D-24, 균형 컨셉 |
| OQ-D11 | `design_handoff_moneybook/` 와 zip 을 저장소에 커밋할까? | **zip 은 커밋 안 함**, 핸드오프 폴더는 `public/` 에 복사한 자산만 커밋(원본 폴더는 커밋 안 함) | 중복·용량. 원본 보관이 필요하면 사용자 결정 |
| OQ-D12 | 대시보드 균형 카드의 읽는 순서(DOM): 남은 돈 → 수입 → 지출 | **시안 순서(남은 돈 먼저)**, e2e 라벨 순서 갱신 | 화면 순서와 읽는 순서를 같게(WCAG 1.3.2) |
| OQ-D13 | 금액 표기 ₩ 앞붙임(디자인) vs "원" 뒤붙임(지금) | **"원" 유지** | D-14. 테스트·스크린리더 |
| OQ-D14 | 기본 유형을 "마지막에 쓴 종류"로 바꿀까?(OQ-C10 재결정) | **지출 유지** | D-19 |
| OQ-D15 | 결제 수단·거래 시각 | **후속, 별도 계획**(transactions ALTER) | D-05, D-06 |

---

## 14. 후속 후보 (확장안 E, 이번 범위 아님)

| 항목 | 필요한 것 | 운영 DB |
|---|---|---|
| 색·무늬 직접 선택(viz_index) | categories 컬럼, api.md v4, 편집 시트의 8칸 그리드, 도넛 고정 색 충돌 처리 | categories ALTER(운영 마이그레이션 전이면 묶기) |
| 월 예산 | categories 컬럼, 검증(정수, 지출만), 행 메타, 예산 진행률 | categories ALTER |
| 결제 수단 | transactions 컬럼, 거래 API 검증, 기록 칩, 목록 메타, 집계 영향 검토 | transactions ALTER(운영 데이터 테이블) |
| 순서 변경(≡ 드래그, Alt+↑/↓, aria-live) | 순서 변경 API(`sortOrder` 수정 허용), 터치·키보드 대체 수단 | 없음(sort_order 있음) |
| 바텀시트(카테고리 편집, 거래 수정) | 시트 컴포넌트(포커스 가두기, scrim, Esc, 380ms 전환), 관련 e2e 재작성 | 없음 |
| 저장 되돌리기 | 토스트 버튼, 생성 취소=DELETE, 수정 취소=이전 값 PUT, 3초 경합 처리 | 없음 |
| 다크 모드 토글 | `<head>` 외부 동기 스크립트, localStorage, 토글 위치 | 없음 |
| 기록 시각 표시 | 거래 시각 필드(또는 createdAt 표시 정책) | 시각 필드면 transactions ALTER |
