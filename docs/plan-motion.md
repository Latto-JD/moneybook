# 움직임(모션) 계획서 (plan-motion v1)

작성: planner / 작성일: 2026-10-24 / 기준: 운영 반영 커밋 `806fdf3`
관련 문서: `docs/plan-redesign.md`, `docs/improvements.md`(A2 토스트 위치, A9 대시보드 요청 분리), `docs/plan-followup.md` 13.6(되돌리기 토스트), 7.2(3단계 바텀시트)

표기: **[사실]** 은 코드에서 확인한 내용(파일:줄), **[권장]** 은 planner 권장 기본값. 열린 질문(12장)의 답이 없으면 권장값으로 진행한다. **frontend 만 작업한다. 서버·DB·API 변경은 없다.**

---

## 1. 목표

화면이 갑자기 바뀌는 느낌을 줄이는 짧은 움직임 네 가지를 넣는다. 모션 공통값, 패널·카드 페이드 인, 토스트·"더 보기" 슬라이드 인, 대시보드 막대 스태거다. 움직임은 클릭·포커스·레이아웃에 영향이 없어야 하고, 움직임 줄이기 설정에서는 모두 꺼진다.

## 2. 사용자 스토리

- 사용자로서 탭을 바꾸거나 달을 넘길 때 화면이 툭 바뀌지 않고 부드럽게 이어지기를 바란다.
- 사용자로서 저장 직후 토스트가 어디서 나타났는지 자연스럽게 알아차리고 싶다.
- 사용자로서 대시보드 카테고리 막대가 자라나는 짧은 움직임으로 새 달의 데이터를 읽고 싶다. 다만 기다리게 되면 안 된다.
- 움직임에 민감한 사용자로서 OS 의 "동작 줄이기"를 켜면 앱에서도 움직임이 전혀 없기를 바란다.

## 3. 범위 / 범위 밖

**범위 (사용자 승인 4가지)**
1. 모션 공통값(시간·이징 변수, 공용 keyframes·클래스)
2. 페이드 인: 탭 전환 시 패널, 대시보드 카드에 데이터가 들어올 때
3. 슬라이드 인: 토스트(저장 영역 안·탭바 위), 카테고리 "더 보기" 펼침. 3단계 바텀시트가 그대로 가져다 쓸 수 있는 형태
4. 스태거: 대시보드 카테고리 막대(조건부)

**범위 밖**
- 마키, 패럴랙스, 판단할 수 없었던 3번 효과(사용자 제외).
- 사라지는 애니메이션(토스트 퇴장, "접기", 탭을 떠날 때). OQ-M4.
- SVG 차트(도넛 조각, 월별 막대, 카테고리 추이 막대)의 그리기 애니메이션, 숫자 카운트업, 기록 화면 요약 카드·목록의 움직임.
- 바텀시트 자체(3단계). 이번에는 재사용할 공용 keyframes·변수만 만든다.
- `tokens.css`·`components.css` 수정(C-D1 원본 비교 규칙), 서버·DB·`docs/api.md`, `src/frontend/office/`, `design_handoff_moneybook/`.

## 4. 현재 상태 조사

- **[사실]** 애니메이션은 없다. transition 은 두 곳뿐이다: `.btn` `background-color .15s, border-color .15s, transform .1s`(`components.css:51`), `.input` `border-color .15s, box-shadow .15s`(`:78`).
- **[사실]** 전역 움직임 줄이기 규칙이 있다: `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } }`(`components.css:199`). CSS 애니메이션·transition 은 이 규칙으로 꺼진다. **JS 의 Web Animations API(`element.animate`)는 이 규칙으로 꺼지지 않는다.**
- **[사실]** 탭 전환은 `tabs.js:12-24` 가 패널의 `hidden` 을 바꾸고 `tabchange` 이벤트를 보낸다. `hidden` 은 `display: none !important`(`style.css` 기본 블록)다. CSS 애니메이션은 요소가 `display:none` 에서 보이게 될 때 처음부터 다시 재생되므로, **패널 페이드는 CSS 만으로 된다.**
- **[사실]** 토스트: `#toast`(`index.html:26-28`)는 `#flash` 글자가 비고 버튼이 숨겨지면 `display:none`(`style.css:76`). 기록 탭에서는 `#save-dock` 안 저장 버튼 위(`position: static`, `style.css:310`), 다른 탭에서는 `#main` 맨 앞에서 `position: fixed` 로 탭바 위(`style.css:75`)에 있다. 자리는 `record.js:106-111` `placeToast` 가 DOM 노드를 옮겨 바꾼다. `.toast` 는 가운데 정렬에 `transform: translateX(-50%)` 를 쓴다(`components.css:172`). **토스트에 `transform` 애니메이션을 걸면 이 가운데 정렬이 덮인다.**
- **[사실]** 대시보드 요청은 이미 종류별로 나뉘어 있다(`dashboard.js:67-152`).
  - 달 변경·탭 진입: `loadAll` 이 인사이트·월별·카테고리·추이를 모두 다시 받는다.
  - 6/12개월: 월별(+요약 카드)·추이만 다시 받는다.
  - 지출/수입: 카테고리(도넛·막대)·추이만 다시 받는다.
  - 카테고리 목록 변경(`categorieschanged`): `loadAll` 을 부른다.
  - 각 그리기는 `replaceChildren` 으로 노드를 새로 만든다.
- **[사실]** 카테고리 막대는 `charts.js:180-184` 의 `.legend-bar__fill` 이고, 너비는 CSSOM `fill.style.width` 로 넣는다. 행 수는 도넛 묶음 규칙 때문에 **최대 8개**다(`DONUT_MAX_PIECES = 8`, `lib/dashboard-data.js:61`). 카테고리가 30개여도 막대는 8줄을 넘지 않는다(9개 이상이면 "그 외 N개" 1줄).
- **[사실]** "더 보기"는 `record.js` `toggleChip` 이 `state.expanded` 를 바꾸고 `renderCategoryChips` 로 격자 전체를 다시 그린다. 칩을 누를 때도 `keepFocus` 로 다시 그린다. 자동 펼침(`ensureSelectedVisible`)은 코드로 일어난다.
- **[사실]** e2e: `e2e/playwright.config.js` 에 `reducedMotion` 설정이 없다. mobile-360(360×740)·tablet-768 두 프로젝트, 직렬 실행.

## 5. 설계

### 5.1 모션 공통값 (F-M1)

**위치 [권장]:** `style.css` 맨 앞 앱 변수 블록(`--h-control` 등이 있는 곳)에 둔다. `tokens.css` 에 두면 C-D1(원본 비교, `design.spec.js:181`)의 허용 차이 목록을 고쳐야 한다.

| 변수 | 값 | 쓰임 |
|---|---|---|
| `--motion-short` | `150ms` | 패널 페이드, 버튼·입력 상태 변화 |
| `--motion-base` | `220ms` | 카드 페이드, 토스트·"더 보기" 슬라이드 |
| `--motion-stagger` | `30ms` | 스태거 한 칸 간격 |
| `--motion-stagger-total` | `300ms` | 스태거 전체 상한(마지막 막대가 다 자란 시점) |
| `--motion-distance` | `8px` | 슬라이드 거리(바텀시트는 `100%` 로 덮어씀) |
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | 나타날 때 |
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | 위치 이동(막대 자라기, 바텀시트 이동) |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | 사라질 때(이번에는 바텀시트용으로만 정의, OQ-M4) |

**공용 keyframes (재사용 단위):** 모두 `style.css` 의 "모션" 블록 하나에 모은다.
- `mb-fade-in`: `from { opacity: 0 }`
- `mb-slide-in`: `from { opacity: 0; translate: 0 var(--motion-distance) }`. **`transform` 대신 개별 속성 `translate` 를 쓴다.** 그래서 토스트의 `transform: translateX(-50%)` 와 겹치지 않는다. 바텀시트도 같은 keyframes 에 `--motion-distance: 100%` 만 주면 된다.
- `mb-grow-x`: `from { transform: scaleX(0) }`, `transform-origin: left`(막대 전용, 막대에는 다른 transform 이 없다)

**규칙**
1. keyframes 는 **`from` 만** 정의하고 끝 상태는 요소의 원래 스타일이다. 기본 스타일에 `opacity: 0` 같은 "숨김 시작값"을 두지 않는다. 그래서 움직임 줄이기 규칙(`animation: none !important`)이 걸려도 요소는 정상 상태로 보인다.
2. `animation-fill-mode` 는 **`backwards`** 만 쓴다(지연 시간 동안만 시작값을 적용하고, 끝나면 효과가 남지 않음). `both`/`forwards` 를 쓰면 끝난 뒤에도 opacity 애니메이션이 남아 쌓임 맥락(stacking context)이 유지되고, 저장 영역(`z-index: 5`) 같은 겹침 순서가 바뀔 수 있다.
3. 움직이는 속성은 `opacity`, `translate`, `transform`(막대 `scaleX`)뿐이다. `width`·`height`·`top`·`margin` 은 애니메이션하지 않는다(레이아웃 밀림 0).
4. **패널(`section[id^=panel-]`)에는 opacity 만** 쓴다. 조상에 transform 이 걸리면 그 안의 `position: fixed` 요소의 기준이 바뀐다(탭바 위 토스트, sticky 저장 영역 위험).
5. `pointer-events`·`visibility`·`inert` 를 건드리지 않는다. 움직이는 동안에도 클릭·포커스·스크린리더 읽기가 그대로다.
6. JS 는 `element.animate()`(Web Animations API)로 애니메이션을 **만들지 않는다**(전역 줄이기 규칙이 안 먹음). `animationend`·`transitionend` 를 기다리는 로직도 두지 않는다(줄이기 상태에서는 이벤트가 오지 않음). 이미 재생 중인 CSS 애니메이션을 `getAnimations()` 으로 끝내는 것은 허용한다(5.4).
7. CSP: 모든 keyframes·클래스는 외부 `style.css` 에 둔다. JS 는 `el.dataset.*`, `el.classList`, `el.style.setProperty('--motion-i', …)`(CSSOM)만 쓴다. 인라인 `style` 속성·`<style>`·인라인 스크립트는 없다.
8. 움직임 줄이기: 새 `@media` 규칙을 만들지 않는다. `components.css:199` 전역 규칙이 모든 CSS 애니메이션을 끈다. 이 규칙을 덮는 `!important` animation 선언을 `style.css` 에 쓰지 않는다.

**`components.css` 의 기존 transition (.15s, .1s) [권장]:** 그대로 둔다. 값이 이미 `--motion-short`(150ms)와 같고, 고치면 C-D1 원본 비교 허용 목록이 늘어난다. 변수와의 대응은 `style.css` 모션 블록 주석에 적는다(OQ-M1).

### 5.2 페이드 인: 탭 전환 패널 (F-M2)

- CSS: `html[data-motion-ready] .app-main > section[id^="panel-"]:not([hidden]) { animation: mb-fade-in var(--motion-short) var(--ease-out) backwards; }`
- 패널이 `hidden` 에서 풀릴 때마다(기록 ↔ 대시보드 ↔ 내 정보 ↔ 카테고리 관리) 자동으로 재생된다. JS 타이머는 없다.
- **첫 화면에서는 재생하지 않는다 [권장]**(OQ-M5). 첫 화면이 늦게 보이는 느낌과 e2e 첫 측정 흔들림을 막기 위해서다. `tabs.js` 가 첫 `apply()` 다음 프레임에 `document.documentElement.dataset.motionReady = ''` 를 넣는다(모듈 스크립트, CSP 안전).
- 거리 이동 없이 투명도만 바꾼다(5.1 규칙 4). 내 정보·카테고리 관리의 제목 포커스(`account.js:37`)는 그대로다.

### 5.3 페이드 인: 대시보드 카드 데이터 (F-M3)

- 대상 컨테이너: `#kpi`, `#chart-donut`, `#chart-monthly`, `#chart-cat-trend`, `#insights`.
- 방식: 그리기 직전에 컨테이너에 `data-motion="fade"` 를 넣거나 지운다. CSS `[data-motion~="fade"] > * { animation: mb-fade-in var(--motion-base) var(--ease-out) backwards; }`. 새로 그린 자식만 재생되고, 다음 그리기에서 속성이 없으면 재생되지 않는다.
- 언제 재생하나: **데이터가 실제로 바뀐 카드만** 재생한다. 같은 숫자를 다시 그리는 경우(예: 6/12개월 전환 때 요약 카드)에 깜빡이지 않게 하기 위해서다.

| 이유 | `#kpi` | `#chart-donut`(막대 포함) | `#chart-monthly` | `#chart-cat-trend` | `#insights` |
|---|---|---|---|---|---|
| 달 변경(‹ ›) | 페이드 | 페이드 + 스태거 | 페이드 | 페이드 | 페이드 |
| 탭 진입(`tabchange`) | 페이드 | 페이드 + 스태거 | 페이드 | 페이드 | 페이드 |
| 6/12개월 | 없음(같은 값) | 다시 그리지 않음 | 페이드 | 페이드 | 다시 그리지 않음 |
| 지출/수입 | 다시 그리지 않음 | 페이드 + 스태거(OQ-M2) | 다시 그리지 않음 | 페이드 | 다시 그리지 않음 |
| 카테고리 목록 변경(`categorieschanged`) | 없음 | 없음 | 없음 | 없음 | 없음 |
| 추이 칩 선택(`renderTrend`) | - | - | - | 없음 | - |

- 순수 함수 `lib/motion.js` 의 `motionFor(reason, card)` → `{ fade: boolean, stagger: boolean }` 에 위 표를 그대로 두고 단위 테스트한다. `dashboard.js` 는 `loadAll(reason)`, `loadMonthly(reason)`, `loadCat(reason)`, `loadTrend(reason)` 로 이유를 넘긴다. `insights.js` `loadInsights(month, { fade })` 도 같다.
- 6/12개월 전환 때 `#kpi` 는 다시 그려지지만 값이 같으므로 `data-motion` 을 지운 채 그린다. 같은 숫자가 깜빡이지 않는다.
- 응답이 늦게 와도 페이드는 응답을 그릴 때 한 번이다. 오래된 응답은 기존 `seqs` 규칙대로 버려져 재생되지 않는다.

### 5.4 슬라이드 인: 토스트 (F-M4)

- CSS: `#toast { animation: mb-slide-in var(--motion-base) var(--ease-out) backwards; }`. 토스트가 `display:none` 에서 보이게 될 때마다 재생되고, 아래에서 8px 올라오며 나타난다. 두 자리(저장 영역 안 static, 탭바 위 fixed) 모두 같은 규칙이다. `translate` 속성을 쓰므로 fixed 쪽의 `transform: translateX(-50%)` 가운데 정렬이 유지된다.
- 이미 떠 있는 토스트의 글자만 바뀌는 경우(예: `저장했어요` → `되돌렸어요`)는 `display` 가 바뀌지 않아 다시 재생되지 않는다. 의도된 동작이다(같은 자리의 상태 변화).
- **자리 이동 시 다시 재생하지 않는다 [권장]**(OQ-M6). `placeToast` 가 노드를 옮기면 브라우저가 애니메이션을 처음부터 다시 시작해서, 새 메시지가 온 것처럼 보인다. `placeToast` 가 옮긴 직후 `toast.getAnimations().forEach((a) => a.finish())` 를 부른다(만드는 것이 아니라 끝내는 것이라 5.1 규칙 6 에 맞음, 줄이기 상태에서는 빈 배열).
- 타이머(4초/5초), 포인터·포커스 일시정지, 되돌리기 동작, `#flash` 글자, `role="status"` 알림은 **바꾸지 않는다.** 사라질 때는 지금처럼 바로 사라진다(OQ-M4).
- 움직이는 동안에도 [되돌리기]를 누를 수 있다(opacity·translate 만 바뀜, 지연 0).

### 5.5 슬라이드 인: 카테고리 "더 보기" (F-M5)

- 사용자가 `더 보기 (N)` 를 **눌렀을 때 그 한 번의 그리기에서만** 새로 드러난 칸(8번째부터, 마지막 `접기` 칸 포함)에 `chip--reveal` 클래스를 붙인다. CSS `.chip--reveal { animation: mb-slide-in var(--motion-base) var(--ease-out) backwards; }`
- 그 뒤 칩 선택 등으로 다시 그릴 때는 클래스를 붙이지 않는다(새 노드라도 재생 안 됨). 자동 펼침(빠른 입력·자동완성·거래 수정으로 고른 경우)과 `접기` 는 움직이지 않는다.
- 칸 사이 스태거는 넣지 않는다 [권장]. 한 번에 올라온다. 펼친 뒤 포커스를 8번째 카테고리로 옮기는 동작(`record.js` `GRID_FOCUS_AFTER_MORE`)은 바로 일어나고, 움직이는 동안에도 Enter·클릭이 된다.
- 격자가 길어지면서 아래 내용(메모 등)이 내려가는 것은 "펼침" 자체의 결과다. 애니메이션이 추가로 만드는 레이아웃 이동은 없다.

### 5.6 스태거: 대시보드 카테고리 막대 (F-M6)

- 대상: `#chart-donut` 범례의 `.legend-bar__fill`(최대 8줄). 5.3 표에서 `stagger` 가 참인 그리기에서만 재생한다. `#chart-donut` 에 `data-motion="fade grow"` 를 넣으면 CSS `[data-motion~="grow"] .legend-bar__fill` 가 적용된다.
- `charts.js` 는 막대마다 `fill.style.setProperty('--motion-i', String(i))` 를 넣는다(CSSOM, CSP 허용). 너비는 지금처럼 `style.width` 로 두고, 자라기는 `transform: scaleX` 로 한다(레이아웃 불변).
- 시간 **[권장]:** 막대 하나 `--motion-short`(150ms), 지연 `min(i × 30ms, 150ms)`. 마지막 막대가 다 자라는 시점은 최대 `150 + 150 = 300ms` 다. 앞의 6줄(0~150ms)은 30ms 간격으로 순서대로 자라고, 7·8번째 줄은 150ms 에 함께 시작한다.
  - CSS 로 쓰면: `animation: mb-grow-x var(--motion-short) var(--ease-in-out) backwards; animation-delay: min(calc(var(--motion-i, 0) * var(--motion-stagger)), calc(var(--motion-stagger-total) - var(--motion-short)));`
  - 행이 30개가 되는 일은 없지만(4장), 공식이 상한을 두므로 몇 줄이든 300ms 를 넘지 않는다.
- 재생 시점: 달 변경, 탭 진입. **지출/수입 전환 때도 재생 [권장]**(목록 전체가 새 데이터로 바뀌므로, OQ-M2). **6/12개월 전환은 해당 없음**(카테고리 막대를 다시 그리지 않음, `dashboard.js:146-152`). 카테고리 목록 변경 때는 재생하지 않는다.
- 도넛 조각과 "그 외 N개" 묶은 이름 줄은 움직이지 않는다. 막대는 장식(`aria-hidden`)이라 스크린리더 영향이 없다.

## 6. e2e·테스트 방침

1. **기존 e2e 는 움직임 없이 돈다 [권장].** `e2e/playwright.config.js` 의 공통 `use` 에 `reducedMotion: 'reduce'` 를 넣는다. 그러면 `components.css:199` 가 모든 애니메이션을 끄므로 지금 테스트(픽셀 샘플링, 위치 측정, `toBeVisible` 직후 측정)는 결과가 바뀌지 않는다. 5.1 규칙 1·2 덕분에 줄이기 상태의 화면은 지금과 같다.
2. **움직임 자체는 새 e2e 한 파일에서만** 확인한다: `e2e/tests/motion.spec.js` 에 `test.use({ reducedMotion: 'no-preference' })`. 두 프로젝트(360·768)의 UI 목록(`testMatch`)에 추가한다. 시간은 `getAnimations()` 의 `effect.getComputedTiming()`·`getKeyframes()` 로 읽는다. 실제 시간을 기다리는 `waitForTimeout` 은 쓰지 않는다.
3. 단위 테스트(`src/frontend/test/motion.test.js`):
   - `motionFor` 표
   - CSS 정적 검사: `style.css` 의 모든 `@keyframes` 가 `opacity`·`translate`·`transform` 만 쓴다, `animation-fill-mode`/단축 속성에 `both`·`forwards` 없음, `!important` 붙은 animation 없음
   - JS 정적 검사: `src/frontend/public/js` 에 `.animate(`·`animationend`·`transitionend` 없음
4. 줄이기 상태 확인은 같은 spec 안에서 `reducedMotion: 'reduce'` 로 각 장면을 다시 열어 `document.getAnimations().length === 0` 을 본다.

## 7. 접근성

- 움직임 줄이기: 모든 CSS 애니메이션 0개(전역 규칙). 페이드도 끈다(사용자 요구 "모든 움직임").
- 가장 긴 움직임 300ms(스태거 전체), 그 밖은 150~220ms. 깜빡임·반복 재생 없음(WCAG 2.3).
- 움직이는 동안 클릭·Tab·Enter·스크린리더 읽기가 그대로다. 투명도 0 인 순간에도 요소는 접근성 트리에 있고, 상태 알림(`#flash` `role="status"`, `#kpi` `aria-live`)의 읽기 시점은 바뀌지 않는다.
- 포커스 링은 페이드 중에도 같이 보인다(투명도는 함께 바뀌지만 위치는 그대로).

## 8. 작업 목록

| ID | 작업 | 담당 | 의존 |
|---|---|---|---|
| F-M1 | `style.css` 모션 변수(5.1 표), 공용 keyframes 3개, 규칙 주석(기존 `.15s` 대응 포함) | frontend | - |
| F-M2 | 패널 페이드 CSS + `tabs.js` 첫 `apply()` 뒤 `data-motion-ready` | frontend | F-M1, OQ-M5 |
| F-M3 | `lib/motion.js` `motionFor` + 단위 테스트, `dashboard.js`·`insights.js` 에 이유 전달·`data-motion` 설정, 카드 페이드 CSS | frontend | F-M1 |
| F-M4 | 토스트 슬라이드 CSS, `placeToast` 이동 후 `finish()` | frontend | F-M1, OQ-M6 |
| F-M5 | "더 보기" 눌렀을 때만 `chip--reveal` (`record.js` `toggleChip`·`renderCategoryChips`) | frontend | F-M1 |
| F-M6 | 막대 스태거: `charts.js` `--motion-i`, `[data-motion~="grow"]` CSS, 지연 상한 공식 | frontend | F-M3, OQ-M2, OQ-M3 |
| F-M9 | 자체 점검: `npm test`, 콘솔 CSP 위반 0, 360/768 × 라이트·다크 × 줄이기 켬/끔 손으로 확인, 성능 패널에서 레이아웃 이동 0 | frontend | F-M1~F-M6 |
| Q-M1 | `playwright.config.js` 에 `reducedMotion: 'reduce'` 추가 후 기존 e2e 전체 회귀(결과가 지금과 같아야 함) | qa | F-M9 |
| Q-M2 | 신규 `e2e/tests/motion.spec.js`(9장 C-M 항목) + 단위 정적 검사 확인 + `docs/qa-report.md` "모션" 절 | qa | Q-M1 |
| R-M1 | 최종 리뷰(5.1 규칙 1~8 위반 여부 중심) | reviewer | Q-M2 통과 |
| U-M1 | 푸시 승인(운영 마이그레이션 없음), 배포 후 실제 폰에서 움직임·줄이기 확인 | 사용자(메인 세션 안내) | R-M1 |

`playwright.config.js` 는 테스트 설정이라 qa 영역이다. `src/frontend/test/` 의 단위 테스트는 frontend 가 쓴다(기존 관례).

## 9. 완료 기준 (QA 체크리스트)

별도 표시가 없으면 360px·768px, 라이트·다크, `reducedMotion: 'no-preference'` 에서 확인한다.

**공통**
- [ ] C-M1. `style.css` 에 `--motion-short 150ms`, `--motion-base 220ms`, `--motion-stagger 30ms`, `--motion-stagger-total 300ms`, `--motion-distance 8px`, `--ease-out`·`--ease-in-out`·`--ease-in` 이 있다. 새 애니메이션의 시간·이징은 모두 이 변수에서 온다(계산된 값으로 확인). `tokens.css`·`components.css` 는 바뀌지 않았다(C-D1 통과).
- [ ] C-M2. 모든 keyframes 의 속성이 `opacity`·`translate`·`transform` 뿐이고, fill-mode 는 `backwards` 다. 애니메이션이 끝난 뒤 `getAnimations()` 이 비어 있고, 대상 요소의 계산된 `opacity` 1·`translate` none 이다.
- [ ] C-M3. 레이아웃 밀림 0: 각 장면(패널 전환, 카드 페이드, 토스트, 더 보기, 막대)에서 애니메이션 시작 직후와 끝난 뒤의 주변 요소 `getBoundingClientRect`(카드·버튼·다음 형제)가 같다(±0.5px, 더 보기는 펼침 자체 이동을 뺀 비교). `PerformanceObserver('layout-shift')` 값 합이 애니메이션 때문에 늘지 않는다.
- [ ] C-M4. 움직이는 도중(시작 후 50ms 안)에 대상 안의 버튼 클릭·Tab 이동·Enter 가 바로 동작한다: 탭 전환 직후 저장 버튼, 토스트 [되돌리기], 펼친 직후 8번째 카테고리, 달 변경 직후 "표로 보기".
- [ ] C-M5. `reducedMotion: 'reduce'` 에서 모든 장면의 `document.getAnimations().length` 가 0 이고, 화면(위치·투명도)이 움직임 없을 때의 끝 상태와 같다.
- [ ] C-M6. JS 에 `element.animate(`·`animationend`·`transitionend` 가 없고, 인라인 `style` 속성·`<style>`·인라인 스크립트가 없다. 콘솔 CSP 위반 0.

**페이드**
- [ ] C-M7. 기록 → 대시보드 → 내 정보 → 기록, 카테고리 관리 진입 때마다 보이게 된 패널에 `mb-fade-in` 150ms `--ease-out` 이 한 번 재생된다. 첫 화면 로드 때는 재생되지 않는다(OQ-M5 권장대로라면). 패널에는 transform·translate 가 걸리지 않는다.
- [ ] C-M8. 대시보드 카드 페이드가 5.3 표와 정확히 같다. 달 변경·탭 진입은 다섯 컨테이너 모두. 6/12개월은 `#chart-monthly`·`#chart-cat-trend` 만, `#kpi` 는 없음. 지출/수입은 `#chart-donut`·`#chart-cat-trend` 만. 카테고리 목록 변경·추이 칩 선택은 없음. 시간 220ms.

**슬라이드**
- [ ] C-M9. 토스트: 기록 탭(저장 영역 안)과 대시보드·내 정보(탭바 위)에서 나타날 때 `translate` 가 `0 8px` → `0 0`, opacity 0 → 1, 220ms `--ease-out`. 탭바 위 토스트는 애니메이션 동안에도 가로 가운데(`translateX(-50%)` 유지). 글자만 바뀔 때와 탭 이동으로 자리를 옮길 때는 다시 재생되지 않는다. 토스트 타이머·일시정지·되돌리기 관련 기존 e2e(2단계 C-S3~C-S10)가 수정 없이 통과한다.
- [ ] C-M10. 카테고리 9개 이상에서 `더 보기` 를 누르면 새로 드러난 칸(8번째~, `접기` 포함)만 슬라이드 인. 그 뒤 칩 선택·자동 펼침·`접기` 때는 애니메이션 0개.
- [ ] C-M11. 재사용성: 같은 `mb-slide-in` 에 `--motion-distance: 100%` 를 준 임시 요소(테스트 안에서 만든 것)가 아래에서 전체 높이만큼 올라온다(바텀시트용 확인, 제품 코드에는 추가 없음).

**스태거**
- [ ] C-M12. 달 변경·탭 진입·지출/수입 전환(OQ-M2 권장대로라면) 때 막대마다 `mb-grow-x` 가 재생되고, i번째 지연이 `min(i×30, 150)ms`, 길이 150ms, 마지막 막대의 `endTime` 이 300ms 이하다. 행 1개·8개("그 외" 포함) 모두 확인한다.
- [ ] C-M13. 6/12개월 전환, 카테고리 목록 변경 때는 막대 애니메이션 0개. 막대 너비(끝 상태)는 지금과 같다(최대 금액 = 100%).

**회귀 · 범위**
- [ ] C-M14. `reducedMotion: 'reduce'` 를 넣은 설정으로 기존 e2e 전체가 mobile-360·tablet-768 에서 통과하고, `npm test` 전부 통과한다.
- [ ] C-M15. 변경 파일이 `src/frontend/public/`(office 제외), `src/frontend/test/`, `e2e/`, `docs/` 안에만 있다. `src/backend/`·`schema.sql`·`docs/api.md`·`tokens.css`·`components.css` 는 바뀌지 않았다.

## 10. 위험

| 위험 | 영향 | 대응 |
|---|---|---|
| 토스트에 `transform` 애니메이션 | 탭바 위 토스트가 가운데에서 벗어남 | `translate` 개별 속성 사용(5.4), C-M9 |
| `forwards`/`both` fill | 끝난 뒤에도 쌓임 맥락이 남아 저장 영역·토스트 겹침 순서가 바뀜 | `backwards` 만(5.1 규칙 2), C-M2 |
| 패널에 transform | fixed 토스트·sticky 저장 영역 기준이 바뀜 | 패널은 opacity 만(규칙 4), C-M7 |
| `element.animate()` 사용 | 움직임 줄이기에서 안 꺼짐 | 금지 + 정적 검사(C-M6) |
| 같은 숫자를 다시 그릴 때 깜빡임 | 6/12개월 전환 때 요약 카드가 번쩍임 | 이유별 표(5.3), `motionFor` 단위 테스트 |
| 노드 이동·다시 그리기로 애니메이션이 재시작 | 토스트·칩이 엉뚱한 때 다시 움직임 | 토스트 `finish()`, `chip--reveal` 은 한 번만 |
| 기존 e2e 불안정 | 픽셀·위치 측정이 애니메이션 중간값을 읽음 | 전체 설정 `reducedMotion: 'reduce'`, 움직임 검증은 `motion.spec.js` 만 |
| 테스트 설정 때문에 실제 움직임 회귀를 놓침 | 움직임이 사라져도 기존 e2e 는 통과 | `motion.spec.js` 가 `no-preference` 로 각 장면의 애니메이션 존재·시간을 단언 |
| 전역 줄이기 규칙이 `components.css` 에만 있음 | 나중에 누가 `!important` animation 을 쓰면 규칙이 무력화 | 정적 검사(6장 3번) |

## 11. 3단계 바텀시트에서 다시 쓰는 방법 (참고)

- 열 때: `.sheet { animation: mb-slide-in var(--motion-base) var(--ease-out) backwards; --motion-distance: 100%; }`, scrim 은 `mb-fade-in`.
- 닫을 때(이번 범위 밖): `--ease-in` 으로 반대 방향 keyframes 를 추가해야 한다. 이때는 닫기 완료를 `animationend` 대신 **정해진 시간이 아닌 상태(class) 기준**으로 처리해야 줄이기 상태에서도 닫힌다. 3단계 계획서에서 정한다.

## 12. 열린 질문 (답이 없으면 권장값으로 진행)

| ID | 질문 | 권장 기본값 | 비고 |
|---|---|---|---|
| OQ-M1 | `components.css` 의 기존 transition(.15s, 버튼 누름 .1s)을 새 변수로 통일할까? | **그대로 둔다**(값이 이미 150ms, 원본 비교 규칙 유지). 대응 관계만 주석으로 | 통일하려면 `style.css` 에서 덮어쓰기 규칙을 추가해야 해서 중복이 생긴다 |
| OQ-M2 | 지출/수입 전환 때 막대 스태거를 재생할까? (6/12개월은 막대를 다시 그리지 않아 해당 없음) | **재생한다**(목록 전체가 새 데이터) | 자주 전환하는 사용자에게 거슬리면 끄기 쉬움(`motionFor` 표 한 칸) |
| OQ-M3 | "전체 0.3초 이내" 의 기준 | **마지막 막대가 다 자란 시점 ≤ 300ms**(막대 150ms + 지연 상한 150ms) | 대안: 마지막 시작 시점 ≤ 300ms(막대 길이를 더 길게 쓸 수 있음) |
| OQ-M4 | 사라질 때 움직임(토스트 퇴장, 접기) | **이번엔 없음**. `--ease-in` 은 바텀시트용으로만 정의 | 토스트 퇴장을 넣으면 글자를 비우는 시점이 늦어져 타이머·e2e 에 영향 |
| OQ-M5 | 앱 첫 화면 로드 때도 패널 페이드를 할까? | **안 한다** | 첫 화면이 늦게 보이는 느낌 방지 |
| OQ-M6 | 토스트가 떠 있는 채로 탭을 옮기면 새 자리에서 다시 올라올까? | **다시 재생하지 않는다**(새 메시지처럼 보이지 않게) | |
| OQ-M7 | 대시보드 탭에 들어올 때 카드 페이드도 할까?(패널 페이드와 겹침) | **한다**. 패널은 150ms 로 먼저, 데이터가 오면 카드가 220ms 로 이어진다 | 겹쳐 보이면 탭 진입 때는 카드 페이드를 끄고 패널 페이드만 둔다 |

## 13. 보고

- 계획서: `docs/plan-motion.md`
- 프론트만 바뀐다. 변수·keyframes 는 `style.css` 한 곳에 둔다. 움직이는 속성은 opacity·translate·transform 만이고 fill 은 `backwards` 만 쓴다. 움직임 줄이기는 기존 전역 규칙이 처리한다. 기존 e2e 는 `reducedMotion: 'reduce'` 로 고정하고, 움직임은 새 `motion.spec.js` 에서만 검증한다.
- 사용자 확인이 필요한 것: OQ-M2(지출/수입 전환 때 스태거), OQ-M3(0.3초 기준), OQ-M4(사라짐 움직임 없음), OQ-M1(기존 transition 그대로).
