# 스크롤 출렁임(젤리) 계획서 (plan-spring v1)

작성: planner / 작성일: 2026-10-26 / 기준: 커밋 `6fd78dd`(1차 모션 반영)
관련 문서: `docs/plan-motion.md`(1차 모션, 5.1 규칙 1~8 과 6장 e2e 방침을 이어받는다)

표기: **[사실]** 은 코드에서 확인한 내용(파일:줄), **[권장]** 은 planner 권장 기본값이다. 열린 질문(12장)에 답이 없으면 권장값으로 진행한다. **frontend 만 작업한다. 서버·DB·API 변경은 없다.**

---

## 1. 목표

사용자가 손가락이나 휠로 스크롤하면 카드와 목록 행이 각자 조금씩 늦게 따라왔다가 젤리처럼 살짝 출렁이며 제자리로 돌아오게 한다(아이폰 메시지 말풍선 느낌, B안). 클릭·포커스·레이아웃·1차 모션에는 영향이 없어야 하고, 움직임 줄이기 설정에서는 아예 돌지 않아야 한다.

## 2. 사용자 스토리

- 사용자로서 거래 목록을 스크롤할 때 행들이 따로따로 따라오는 탱글탱글한 느낌을 받고 싶다.
- 사용자로서 출렁이는 도중에 행을 눌러도 내가 누른 거래가 열리기를 바란다.
- 사용자로서 금액·메모를 입력하는 동안에는 화면이 흔들리지 않기를 바란다.
- 움직임에 민감한 사용자로서 OS 의 "동작 줄이기"를 켜면 출렁임이 전혀 없기를 바란다.

## 3. 범위 / 범위 밖

**범위**
1. 문서 스크롤(창 세로 스크롤)에 연동된 스프링 변위: 4장의 "유닛"에만 `transform` 을 CSSOM 으로 쓴다.
2. 물리 모델(순수 함수 모듈)과 DOM 구동기(rAF 루프) 분리, 단일 끄기 스위치.
3. 움직임 줄이기·입력 중·프로그램 스크롤일 때 끄는 규칙.
4. 단위 테스트, 새 e2e `e2e/tests/spring.spec.js`.

**범위 밖**
- A안(등장 시 스프링 이징), 1차 모션 값 변경, 사라지는 움직임.
- 가로 스크롤 영역(`.table-wrap`, `.chips--scroll`)과 바텀시트 안 스크롤의 출렁임.
- 탭 전환·포커스·`scrollIntoView` 같은 프로그램 스크롤에 의한 출렁임(5.4).
- 서버 쪽 설정·원격 스위치, 사용자 설정 화면의 켜기/끄기 토글(OQ-S6).
- `tokens.css`·`components.css` 수정(C-D1), `src/backend/`·`schema.sql`·`docs/api.md`, `src/frontend/office/`, `design_handoff_moneybook/`.

## 4. 현재 상태 조사와 대상(유닛)

### 4.1 조사
- **[사실]** 스크롤 주체는 창(문서)이다. `.screen` 은 `max-width: 480px` 에 아래 여백 `calc(var(--tabbar-h) + var(--space-8) + env(safe-area-inset-bottom))`(`components.css:156`, `--tabbar-h: 64px` `tokens.css:92`).
- **[사실]** 고정 요소: `.app-header`(일반 흐름, 스크롤됨), `.tabbar`(`position: fixed; z-index: 10`, `components.css:157-158`), `#toast`(`position: fixed; z-index: 30; transform: translateX(-50%)`, `components.css:172`, 기록 탭에서는 `#save-dock` 안 static, `style.css:319`), `#save-dock`(`#tx-form` 안 `position: sticky; z-index: 5`, `style.css:317`).
- **[사실]** 1차 모션이 쓰는 속성: 패널 opacity(`style.css:402`), 대시보드 카드 자식 opacity(`:404`), `.legend-bar__fill` 의 `transform: scaleX`(`:406-410`), `#toast`·`.chip--reveal` 의 `translate`(`:412`, `:414`). `.btn` 에는 `transform .1s` transition 이 있다(`components.css:51`).
- **[사실]** 움직임 줄이기 전역 규칙은 CSS 애니메이션·transition 만 끈다(`components.css:199`). **JS 가 매 프레임 쓰는 `style.transform` 은 이 규칙으로 꺼지지 않는다.** 그래서 JS 쪽에서 직접 꺼야 한다(6장).
- **[사실]** 다시 그리기: 거래 목록은 `record.js:504-526` 에서 `h3.list-head.tx-date` + `ul.tx-rows > li.tx-row` 로 새로 만든다. 카테고리 관리 행은 `category-manager.js:49,67` `li.cat-row`. 대시보드 카드 내용은 `replaceChildren`(plan-motion 4장).
- **[사실]** 프로그램 스크롤: `record.js:379` `scrollIntoView`(거래 수정 진입), 포커스 이동 다수(`record.js`, `category-manager.js`, `account.js:37`), `html` 의 `scroll-padding-bottom`(`style.css:321-324`).

### 4.2 유닛(독립적으로 출렁이는 박스) [권장]

규칙: **유닛끼리는 서로 조상·자손이 아니다**(변위가 겹쳐 곱해지지 않게). 목록이 든 카드는 카드 자체가 아니라 그 안의 행이 유닛이다.

| 화면 | 유닛 선택자 | 종류(변위 상한) |
|---|---|---|
| 기록 | `#month-totals`, `#quick-section`(보일 때) | 카드 |
| 기록 | `#tx-list .tx-date`, `#tx-list .tx-row` | 행 |
| 대시보드 | `#kpi`, `.donut-card`, `.insights-card`, `#chart-monthly` 를 담은 `.chart-card`, `#chart-cat-trend` 를 담은 `.chart-card` | 카드 |
| 카테고리 관리 | `#catm-active > .cat-row`, `#catm-inactive > .cat-row`(펼쳤을 때) | 행 |
| 내 정보 | `.account-card` | 카드 |

**제외(절대 transform 을 받지 않음):** `.app-header`, `.tabbar`, `#toast`, `#save-dock`, `#tx-form` 과 그 안 전부, `#account-form`, `#catm-add`, 모든 `section[id^="panel-"]`, `#main`, `body`, `html`, `.page-head`·`.dash-head`·`.cat-top` 제목 줄, 기록 목록 카드의 `.month-nav`, `.logout-btn`.

이 목록은 `js/scroll-spring.js` 의 선택자 상수 한 곳에만 둔다.

## 5. 설계

### 5.1 물리 모델 (F-S1, `js/lib/spring.js` 순수 함수)

유닛마다 상태 `{ y, v }`(px, px/s). `y` 는 레이아웃 위치에서의 시각 변위이고 0 이 제자리다.

1. **끌림(지연) 주입:** 한 프레임의 스크롤 변화량 `Δ = scrollY(now) - scrollY(prev)`(아래로 스크롤하면 양수). 유닛 중심과 기준점(5.4)의 세로 거리 `d` 로 `r = min(d / R, 1)`, `y += Δ × r`. 기준점 바로 아래 유닛(`d≈0`)은 손가락에 딱 붙어 움직이고, 멀수록 더 늦게 따라온다.
2. **상한:** `|y| ≤ Ymax`(카드/행 별도). 넘으면 잘라내고 `v` 도 0 으로 둔다.
3. **복원:** 질량 1 스프링 `a = -k·y - c·v`. 고정 시간 간격 1/120 s 반-암시적 오일러(`v += a·h; y += v·h`), 프레임 간격은 최대 50 ms 로 자른다(탭 백그라운드 복귀 때 폭주 방지).
4. **정지:** `|y| < 0.15px` 이고 `|v| < 5px/s` 이면 `y = v = 0` 으로 두고 그 유닛의 `transform`·`transform-origin`·`will-change` 를 지운다(`''`).
5. **약한 늘어남:** `scaleY = 1 + min(|v| / Vref, 1) × Smax`. `transform-origin` 은 기준점 쪽 가장자리(유닛이 기준점보다 아래면 `top`, 위면 `bottom`)라 손가락 쪽으로 늘어나 보인다. `Smax = 0` 이면 scale 을 쓰지 않는다(OQ-S3).

| 값 | 기본 [권장] | 뜻 |
|---|---|---|
| `k` 강성 | `170 /s²` | 고유 진동수 약 2.1 Hz |
| `c` 감쇠 | `14 /s` | 감쇠비 ζ ≈ 0.54 → 한 번 약 13% 되튐(젤리 느낌) |
| `R` 끌림 거리 | `500px` | 기준점에서 500px 이상 떨어진 유닛은 Δ 를 그대로 받음 |
| `Ymax` 카드 | `20px` | 1차 슬라이드 8px 의 2.5배 |
| `Ymax` 행 | `12px` | 행 높이 64px 의 1/5, 이웃 행과 겹침 최소화 |
| `Vref` | `1200 px/s` | 늘어남이 최대가 되는 속도 |
| `Smax` | `0.015` | 최대 1.5% 세로 늘어남 |
| 수렴 | 스크롤이 멈춘 뒤 **≤ 800ms**(상한 20px 에서 0.15px 까지 이론값 약 750ms), 안전 상한 1200ms 에 강제 0 | |

모든 값은 `lib/spring.js` 의 `SPRING` 객체 하나에 둔다. 단위 테스트가 이 값으로 수렴 시간·되튐을 계산해 확인한다.

### 5.2 구동기 (F-S2, `js/scroll-spring.js`)

- **시작 조건:** `SPRING.enabled` 가 참이고, `matchMedia('(prefers-reduced-motion: reduce)')` 가 거짓일 때만 리스너를 붙인다(6장). `app.js` 에서 한 번 `import`.
- **리스너(모두 `{ passive: true }`):** `scroll`(window), `wheel`, `touchstart`/`touchmove`/`touchend`/`touchcancel`, `keydown`, `focusin`. 리스너 안에서는 값만 기록하고(스크롤 위치, 기준점 Y, 제스처 상태) DOM 을 읽거나 쓰지 않는다. 기록 후 루프가 꺼져 있으면 `requestAnimationFrame` 한 번 예약.
- **rAF 한 프레임 = 읽기 → 계산 → 쓰기:**
  1. 읽기: `scrollY`, 문서 높이(`scrollingElement.scrollHeight - innerHeight`)만 읽는다. 유닛 위치는 캐시를 쓴다.
  2. 계산: `lib/spring.js` 로 모든 활성 유닛 상태 갱신.
  3. 쓰기: 변한 유닛만 `el.style.transform = 'translate3d(0, ${y}px, 0) scaleY(${s})'`(CSSOM, CSP 허용). 한 프레임에 쓰기 뒤 읽기를 하지 않는다.
  4. 모든 활성 유닛이 정지했고 제스처도 끝났으면 루프를 끝낸다(다음 rAF 예약 안 함). **스크롤이 없으면 rAF 가 돌지 않는다.**
- **위치 캐시:** 유닛의 문서 기준 세로 위치·높이는 **변위가 0 인 상태에서만** `getBoundingClientRect` 로 읽어 저장한다(transform 이 섞이지 않게). 읽는 때: 유닛이 활성 집합에 처음 들어올 때, 제스처 시작 때 정지 상태인 유닛. 캐시 무효화: `ResizeObserver(#main)`, `MutationObserver`(`#tx-list`, `#catm-active`, `#catm-inactive`, 대시보드 다섯 컨테이너의 childList), `tabchange`.
- **화면 밖 제외:** `IntersectionObserver`(`rootMargin: '25% 0px'`)로 화면 근처 유닛만 활성 집합에 둔다. 빠른 스크롤로 새로 들어오는 행도 바로 출렁인다. 화면을 벗어난 유닛은 즉시 0 으로 지우고 집합에서 뺀다.
- **요소 수 상한:** 활성 유닛 **최대 40개**. 넘으면 기준점에서 가까운 순으로 40개만.
- **`will-change: transform`:** 유닛이 처음 0 이 아닌 변위를 받을 때 넣고, 정지할 때 지운다. 정지 상태 유닛에는 남기지 않는다(레이어 메모리).
- **다시 그리기:** 출렁이는 중에 노드가 바뀌면(`replaceChildren`) 떨어져 나간 노드는 집합에서 빼고, 새 노드는 0 에서 시작한다.
- **`tabchange`:** 모든 유닛을 즉시 0 으로 지우고 루프를 멈춘 뒤, 새 패널 기준으로 유닛을 다시 모은다.

### 5.3 1차 모션·쌓임 맥락과의 관계 (함정 대응)

| 함정 | 대응 |
|---|---|
| 조상 `transform` 이 안쪽 `fixed`/`sticky` 의 기준을 바꾸고 쌓임 맥락을 만든다. `#save-dock` 은 `#tx-form` 안 sticky(`z-index: 5`), 기록 탭 토스트는 그 안 | `#tx-form`·패널·`#main` 은 유닛도 유닛의 조상도 아니다(4.2). 유닛은 `fixed`/`sticky` 자손을 갖지 않는다(정적 검사 C-S12). 변환된 유닛은 `z-index: 0` 처럼 칠해지므로 루트 쌓임 맥락의 `#save-dock`(5)·탭바(10)·토스트(30) 아래에 그대로 있다 |
| 1차 토스트는 `translate`, 칩 "더 보기"도 `translate` | 스프링은 `transform` 만 쓰고 토스트·칩은 유닛이 아니다(칩은 폼 안). 속성이 서로 다르고 대상도 겹치지 않는다 |
| 1차 막대 `mb-grow-x` 는 `.legend-bar__fill` 의 `transform` | 막대는 유닛이 아니고 유닛 `.donut-card` 의 자손이다. 각자 자기 요소의 `transform` 이라 덮어쓰지 않는다 |
| 1차 카드 페이드는 `#kpi` 등 컨테이너의 **자식** opacity | 유닛 자신의 `transform` 과 다른 요소·속성이다 |
| `.btn` 의 `transform .1s` transition | 버튼은 유닛이 아니다. 유닛으로 고른 요소에는 CSS `transform`·`translate`·transition·animation 이 없다(정적 검사) |
| `.chart-card` 안 `position: absolute` 요소(표로 보기 요약, 숨긴 figcaption) | 이미 `.chart-card { position: relative }` 기준이라 유닛 transform 으로 기준이 바뀌지 않는다 |
| 변위가 스크롤 높이를 늘려 되먹임 | 아래로 밀린 마지막 유닛도 `.screen` 아래 여백(64px + `--space-8`) 안에 있어 `scrollHeight` 가 바뀌지 않는다. 위로 넘친 변위는 스크롤 영역에 들어가지 않는다. C-S7 로 확인 |
| 레이아웃 밀림(CLS) | `transform` 은 레이아웃 이동이 아니라 `layout-shift` 를 만들지 않는다. 1차 C-M3 가 그대로 통과해야 한다 |

### 5.4 기준점과 "사용자 스크롤"만 출렁이게 하기

- **기준점 Y:** 터치 중이면 마지막 터치 `clientY`, 휠이면 그 `wheel` 이벤트의 `clientY`. 손을 뗀 뒤 관성 스크롤 동안은 마지막 터치 위치를 유지한다.
- **제스처 창(이때의 Δ 만 끌림으로 넣는다):** `touchstart` ~ `touchend` 뒤 스크롤 이벤트가 100ms 끊길 때까지(관성 포함), 또는 마지막 `wheel` 뒤 150ms 동안.
- **출렁이지 않는 스크롤:** 제스처 창 밖의 스크롤은 Δ 를 버린다(위치만 갱신). 해당: 키보드(Space·PageDown·화살표·Tab 포커스 이동), `scrollIntoView`(`record.js:379`), `scroll-padding-bottom` 포커스 스크롤, 해시·탭 전환, 스크롤바 끌기. `keydown` 이 오면 제스처 창을 바로 닫는다.
- **입력 중:** `document.activeElement` 가 글자 입력(`input`(button·checkbox·radio 제외), `textarea`, `select`, `[contenteditable]`)이면 출렁임을 끈다. `focusin` 으로 그런 요소에 포커스가 오면 모든 유닛을 즉시 0 으로 지우고 루프를 멈춘다(모바일 키보드가 올라오며 생기는 화면 이동과 섞이지 않게). 카테고리 관리의 이름 바꾸기 입력도 여기에 해당한다.
  - 변경(팀장 결정): 기준을 포커스 여부가 아니라 "입력칸에서 마지막 `input`·`keydown` 뒤 약 800ms 이내"로 바꿨다. 포커스만 있는 상태(로드 시 `#amount` 자동 포커스 포함)는 정상 출렁인다. 위 `focusin` 즉시 0 처리는 `input`·`keydown` 시점으로 옮겼다.
- **iOS 고무줄·관성:** Δ 를 계산하기 전에 `scrollY` 를 `[0, 최대 스크롤]` 로 자른다. 위·아래 끝에서 튕기는 동안은 Δ 가 0 이라 브라우저 고무줄 위에 출렁임이 겹치지 않는다. 관성 중 화면을 눌러 멈추면 그 터치가 새 기준점이 되고 남은 변위는 스프링대로 돌아온다. Android 당겨서 새로고침 구간도 `scrollY` 가 0 이라 영향 없다.

### 5.5 탭·클릭 위치 정확도

- 브라우저의 누르기 판정은 `transform` 을 반영한 **보이는 위치** 기준이다. 그래서 출렁이는 도중에도 손가락 아래 보이는 행이 눌린다. 보정 코드는 두지 않는다.
- 누르는 순간 강제로 0 으로 되돌리지 않는다 [권장]. 되돌리면 손가락 아래 행이 튀어 다른 행이 눌릴 수 있다. 변위는 상한(행 12px)과 정지 규칙대로 자연스럽게 줄어든다.
- `pointer-events`·`visibility`·`inert`·`tabindex` 를 건드리지 않는다(1차 5.1 규칙 5). 키보드 Tab 이동은 출렁임을 만들지 않으므로(5.4) 포커스 링 위치도 흔들리지 않는다.

### 5.6 단일 스위치와 성능 기준 (F-S3)

- **스위치:** `lib/spring.js` 의 `SPRING.enabled`(기본 `true`). `false` 면 `scroll-spring.js` 가 리스너·옵저버를 하나도 붙이지 않는다. 문제가 생기면 이 한 줄만 바꿔 배포한다.
- **자동 꺼짐 [권장](OQ-S5):** 한 제스처 동안 측정한 rAF 간격 중앙값이 25ms 를 넘는 제스처가 연속 2번이면 그 페이지 세션 동안 출렁임을 끈다(모든 유닛 0, 리스너 해제). 저장하지 않는다(새로고침하면 다시 켜짐).
- **성능 기준:**
  - 프레임당 스프링 처리(읽기+계산+쓰기) 1ms 이하(데스크톱 Chrome, 활성 40개).
  - 출렁이는 동안 강제 레이아웃 0: 쓰기 뒤 같은 프레임에서 위치를 읽지 않는다. 출렁임 켬/끔 비교에서 레이아웃 횟수 차이 ≤ 2(캐시 측정분).
  - 50ms 넘는 long task 0.
  - CPU 4배 느림 조건에서 켬/끔 rAF 간격 p95 차이 ≤ 2ms.
  - 실제 폰(U-S1)에서 손으로 확인했을 때 끊김이 보이지 않을 것.

## 6. 움직임 줄이기

- `prefers-reduced-motion: reduce` 이면 `scroll-spring.js` 가 리스너·`IntersectionObserver`·`MutationObserver`·`ResizeObserver` 를 붙이지 않고 rAF 도 예약하지 않는다. 어떤 유닛에도 `transform`·`will-change` 가 쓰이지 않는다.
- 설정이 실행 중에 바뀌면(`matchMedia` `change`): `reduce` 로 바뀌면 즉시 모든 유닛 0, 리스너·옵저버 해제, 루프 중지. `no-preference` 로 바뀌면 다시 붙인다.
- CSS 전역 규칙(`components.css:199`)에 기대지 않는다(JS 가 쓰는 inline transform 은 그 규칙으로 꺼지지 않음). 새 `@media` CSS 도 만들지 않는다.

## 7. e2e·테스트 방침

1. **기존 e2e 는 그대로 `reducedMotion: 'reduce'`**(`playwright.config.js:19`). 스프링 모듈이 아예 돌지 않으므로 기존 위치 측정·클릭 테스트는 바뀌지 않는다. 기존 spec 은 고치지 않는다.
2. **새 `e2e/tests/spring.spec.js`** 에서만 `test.use({ reducedMotion: 'no-preference' })`. `tablet-768` 의 `testMatch` 목록에 `spring` 을 더한다. 데이터는 거래가 많은 달(행 30개 이상)을 만들어 쓴다.
   - 스크롤 만들기: 휠은 `page.mouse.move` 후 `page.mouse.wheel`(기준점 = 마우스 위치). 터치는 mobile-360 에서 CDP `Input.synthesizeScrollGesture`(`gestureSourceType: 'touch'`).
   - 관찰: `page.evaluate` 안에서 rAF 마다 유닛·제외 요소의 `getComputedStyle(el).transform` 행렬에서 `ty`·`scaleY` 를 모은다(테스트 쪽 코드).
   - 상태 표시: 구동기는 루프가 도는 동안 `html[data-spring="running"]` 을 두고 정지하면 지운다(테스트·디버그용, 화면 영향 없음). 수렴은 `waitForTimeout` 대신 이 속성이 사라지는 것과 그 시각으로 잰다.
   - rAF 예약 수: `page.addInitScript` 로 `requestAnimationFrame` 호출 수를 세어 줄이기·입력 중에 0 인지 본다(테스트 쪽 감싸기, 제품 코드 아님).
   - 성능 근사: CDP `Emulation.setCPUThrottlingRate(4)`, `Performance.getMetrics` 의 `LayoutCount` 차이, `PerformanceObserver('longtask')`, 같은 스크롤을 스프링 켬(`no-preference`)/끔(`reduce`)으로 두 번 돌려 비교한다. 절대 프레임 수가 아니라 차이로 판정한다.
3. **단위 테스트 `src/frontend/test/spring.test.js`:** `lib/spring.js` 의 끌림 비율, 상한 자르기, 20px 에서 정지까지 걸리는 시뮬레이션 시간(≤ 800ms), 되튐 비율(5~20%), 큰 dt 자르기, 정지 판정. 정적 검사: `scroll-spring.js` 에 `.animate(`·`animationend`·`transitionend`·`setInterval` 없음, 모든 `addEventListener` 가 `passive: true`(scroll·wheel·touch), 유닛 선택자 목록에 4.2 제외 요소가 없음, `style.css` 에서 유닛 선택자에 `transform`·`translate`·`transition`·`animation` 규칙이 없음.
4. 1차 `motion.spec.js` 는 수정 없이 통과해야 한다(움직임 켠 상태에서 스프링과 같이 돈다).

## 8. 작업 목록

| ID | 작업 | 담당 | 의존 |
|---|---|---|---|
| F-S1 | `js/lib/spring.js`: `SPRING` 값(5.1 표, `enabled`), 순수 함수(끌림·상한·스텝·정지·scaleY) + `src/frontend/test/spring.test.js` | frontend | - |
| F-S2 | `js/scroll-spring.js`: 유닛 선택자(4.2), 리스너(5.2·5.4), rAF 읽기→계산→쓰기, 위치 캐시, IO·MO·RO, 상한 40개, `will-change` 관리, `tabchange` 초기화, `data-spring` 표시. `app.js` 에서 import | frontend | F-S1 |
| F-S3 | 끄기: `SPRING.enabled`, 움직임 줄이기(6장, 실행 중 변경 포함), 입력 중 끄기, 자동 꺼짐(OQ-S5) | frontend | F-S2 |
| F-S4 | 정적 검사(7장 3번)를 단위 테스트에 추가 | frontend | F-S2 |
| F-S9 | 자체 점검: `npm test`, 콘솔 CSP 위반 0, 360/768 × 라이트·다크 × 줄이기 켬/끔, 성능 패널에서 프레임·레이아웃 확인 | frontend | F-S1~F-S4 |
| Q-S1 | 기존 e2e 전체 회귀(`reduce`, 수정 없이 통과) + `motion.spec.js` 통과 | qa | F-S9 |
| Q-S2 | 신규 `e2e/tests/spring.spec.js`(9장 C-S 항목), `playwright.config.js` 768 `testMatch` 에 `spring` 추가, `docs/qa-report.md` "스크롤 출렁임" 절 | qa | Q-S1 |
| R-S1 | 최종 리뷰: 5.2 읽기/쓰기 분리, 5.3 함정 표, 6장 줄이기, 리스너 해제 누수, 유닛 선택자 | reviewer | Q-S2 통과 |
| U-S1 | 푸시 승인, 배포 후 실제 아이폰·안드로이드에서 출렁임 느낌·관성·고무줄·누르기·줄이기 확인, 값 조정 요청 | 사용자(메인 세션 안내) | R-S1 |

CSS 변경은 없다(유닛 선택자에 스타일을 더하지 않는다). U-S1 에서 느낌 조정이 나오면 `SPRING` 값만 바꾼다.

## 9. 완료 기준 (QA 체크리스트)

별도 표시가 없으면 360px(터치)·768px(휠), 라이트·다크, `reducedMotion: 'no-preference'` 에서 확인한다.

**출렁임 자체**
- [ ] C-S1. 체감: 기록 탭 거래 목록에서 600px 스크롤 한 번에 적어도 한 행의 `|ty|` 최대값이 6px 이상이고, 같은 프레임에 서로 다른 두 유닛의 `ty` 차이가 2px 이상인 프레임이 있다(독립적으로 움직임). 대시보드 카드도 같다.
- [ ] C-S2. 끌림 규칙: 기준점(마우스/터치 위치)에 가장 가까운 유닛의 최대 `|ty|` 가 가장 먼 유닛보다 작다.
- [ ] C-S3. 상한: 모든 프레임에서 카드 `|ty| ≤ 20.5px`, 행 `|ty| ≤ 12.5px`, `scaleY ≤ 1.016`(OQ-S3 권장대로라면). 빠른 연속 휠(3000px)·터치 플링에서도 같다.
- [ ] C-S4. 수렴: 마지막 스크롤 이벤트 뒤 1000ms 안에 `html[data-spring]` 이 사라지고, 모든 유닛의 계산된 `transform` 이 `none`, 인라인 `will-change` 가 비어 있다. 그 뒤 rAF 예약이 0 이다.

**제외·함정**
- [ ] C-S5. 제외 요소(4.2: 헤더, 탭바, `#toast`, `#save-dock`, `#tx-form` 과 자손, `#account-form`, `#catm-add`, 패널, `#main`)는 모든 프레임에서 인라인 `transform` 이 없고 계산값이 지금과 같다(토스트는 `translateX(-50%)`/`none` 그대로).
- [ ] C-S6. 기록 탭에서 목록 위로 스크롤하는 동안 `#save-dock` 의 `getBoundingClientRect().bottom` 이 정지 상태와 같다(±0.5px). 저장 버튼과 그 위 토스트가 출렁이는 행보다 위에 보인다(`elementFromPoint` 가 저장 버튼). 탭바 위 토스트(대시보드)도 가운데 정렬·위치가 그대로다.
- [ ] C-S7. 출렁이는 동안 `document.scrollingElement.scrollHeight` 가 정지 상태와 같다.
- [ ] C-S8. 유닛끼리 조상·자손 관계가 없고, 유닛 안에 `position: fixed`/`sticky` 자손이 없다(페이지에서 계산값으로 확인).
- [ ] C-S9. 1차 모션 공존: 출렁이는 중에 달을 바꿔도 `.legend-bar__fill` 의 `mb-grow-x` 와 카드 페이드가 plan-motion C-M8·C-M12 대로 재생된다. `motion.spec.js` 가 수정 없이 통과한다.

**입력·누르기**
- [ ] C-S10. 누르기 정확도: `data-spring="running"` 인 동안 어떤 거래 행의 그 순간 보이는 중심 좌표를 눌렀을 때 그 행의 거래가 수정 상태로 열린다(5회 반복, 다른 행 0회). 대시보드에서는 출렁이는 중 "표로 보기"와 지출/수입 버튼이 같다.
- [ ] C-S11. 출렁이지 않는 스크롤: 키보드(PageDown·Space·Tab 포커스 이동), 거래 수정 진입(`scrollIntoView`), 메모 칸 포커스(`scroll-padding`), 탭 전환 때 모든 유닛 `transform` 이 `none` 이고 rAF 예약이 0 이다. 메모 칸은 저장 영역 뒤로 가려지지 않는다(기존 기준 그대로).
- [ ] C-S12. 입력 중: 금액·메모·카테고리 이름 바꾸기 입력에 포커스가 있을 때 터치/휠 스크롤을 해도 `transform` 이 `none` 이다. 출렁이는 중에 입력칸을 누르면 그 프레임 안에 모든 유닛이 0 으로 지워진다.
- [ ] C-S13. 끝 튕김: 맨 위·맨 아래에서 더 스크롤해도(Δ 를 0 으로 자름) 상한을 넘지 않고, `scrollY` 를 범위 밖 값으로 흉내 낸 단위 테스트에서 끌림이 0 이다.

**끄기·성능**
- [ ] C-S14. 움직임 줄이기: `reducedMotion: 'reduce'` 로 연 페이지에서 같은 스크롤을 해도 모든 프레임에서 유닛 `transform`·`will-change` 가 없고, 스프링 모듈의 rAF 예약이 0, `html[data-spring]` 이 생기지 않는다. 페이지를 연 채 `emulateMedia` 로 `reduce` 로 바꾸면 그 즉시(다음 프레임) 모든 유닛이 0 이 된다.
- [ ] C-S15. 스위치: `SPRING.enabled = false` 로 만든 빌드(테스트에서 모듈 값을 바꾼 경로 또는 단위 테스트)에서 리스너 등록 0.
- [ ] C-S16. 성능 근사(Chromium, CPU 4배 느림): 같은 스크롤에서 스프링 켬/끔의 `LayoutCount` 차이 ≤ 2, long task(>50ms) 0, rAF 간격 p95 차이 ≤ 2ms. 활성 유닛(인라인 `transform` 이 있는 요소)이 어느 프레임에도 40개를 넘지 않는다.

**회귀·범위**
- [ ] C-S17. 기존 e2e 전체(mobile-360·tablet-768, `reduce`)가 수정 없이 통과하고 `npm test` 전부 통과. 콘솔 CSP 위반 0, 인라인 `style` 속성·`<style>`·인라인 스크립트 없음.
- [ ] C-S18. 변경 파일이 `src/frontend/public/js/`(office 제외), `src/frontend/test/`, `e2e/`, `docs/` 안에만 있다. `style.css`·`tokens.css`·`components.css`·`src/backend/`·`schema.sql`·`docs/api.md` 는 바뀌지 않았다.

## 10. 위험

| 위험 | 영향 | 대응 |
|---|---|---|
| 폼·패널에 transform | sticky 저장 영역이 같이 흔들리고 쌓임 순서가 바뀜 | 유닛 목록에서 제외(4.2), C-S5·C-S6·C-S8 |
| JS transform 은 전역 줄이기 규칙이 안 먹음 | 동작 줄이기 사용자에게도 출렁임 | 모듈 시작 전 `matchMedia` 확인, 실행 중 변경 처리(6장), C-S14 |
| 쓰기 뒤 읽기(layout thrash) | 긴 목록에서 프레임 드랍 | 위치 캐시·읽기→쓰기 순서(5.2), C-S16 |
| 긴 목록 전체 측정 | 제스처 시작이 끊김 | IO 로 화면 근처만, 상한 40개 |
| 프로그램 스크롤까지 출렁임 | 포커스·수정 진입 때 화면이 흔들려 위치 판단이 어려움 | 제스처 창 밖 Δ 버림(5.4), C-S11 |
| 키보드가 올라오는 동안 흔들림 | 입력칸이 가려지거나 튐 | 입력 중 끄기, C-S12 |
| iOS 고무줄 위에 출렁임이 겹침 | 끝에서 과하게 출렁임 | `scrollY` 범위 자르기, C-S13 |
| 실제 폰 느낌이 다름 | 너무 약하거나 멀미 | 값은 `SPRING` 한 곳, U-S1 에서 조정, 스위치·자동 꺼짐 |
| 리스너·옵저버 누수 | 탭 전환 반복 시 느려짐 | 모듈은 한 번만 붙이고 `tabchange` 는 유닛만 다시 모음, R-S1 확인 |

## 11. 열린 질문 (답이 없으면 권장값으로 진행)

| ID | 질문 | 권장 기본값 | 비고 |
|---|---|---|---|
| OQ-S1 | 출렁임 세기(변위 상한) | **카드 20px, 행 12px** | 더 세게: 카드 28/행 16. 행을 키우면 이웃 행과 겹쳐 보임 |
| OQ-S2 | 되튐 정도(감쇠) | **ζ ≈ 0.54(약 13% 되튐, 약 0.75초에 멈춤)** | 더 말랑: ζ 0.4(약 25% 되튐, 1초 이상). 덜: ζ 0.7 |
| OQ-S3 | 세로로 살짝 늘어나는 효과(scaleY) | **넣는다, 최대 1.5%** | 글자가 순간 늘어나 보이는 게 싫으면 0 |
| OQ-S4 | 거래 목록 카드: 행마다 따로(권장) vs 카드 통째로 | **행마다 따로**(말풍선 느낌). 카드 테두리·월 이동 줄은 고정 | 대시보드는 카드 단위. 대시보드 카테고리 행도 따로 출렁이게 하려면 도넛 카드는 고정으로 바뀜 |
| OQ-S5 | 프레임이 느린 기기에서 자동으로 끌까? | **끈다**(연속 2제스처 중앙값 25ms 초과 시 그 세션만) | 저장하지 않아 새로고침하면 다시 켜짐 |
| OQ-S6 | 앱 안에 출렁임 켜기/끄기 설정을 둘까? | **두지 않는다**(OS 동작 줄이기로 끔) | 필요하면 내 정보 화면에 별도 작업으로 |
| OQ-S7 | 데스크톱 휠·트랙패드에서도 출렁일까? | **출렁인다**(768 태블릿·PC 공통) | 모바일 터치만으로 제한할 수도 있음 |

## 12. 보고

- 계획서: `docs/plan-spring.md`
- 유닛(카드·목록 행)에만 CSSOM `transform` 을 쓰고 폼·저장 영역·토스트·탭바·패널은 제외한다. 스프링 값은 `lib/spring.js` 한 곳, 구동은 `scroll-spring.js` 의 rAF(스크롤 없으면 정지). 사용자 스크롤일 때만 출렁이고 입력 중·프로그램 스크롤·움직임 줄이기에서는 돌지 않는다.
- 기존 e2e 는 `reduce` 그대로 두고, 새 `spring.spec.js` 에서 상한·수렴·누르기·제외 요소·성능 차이를 검증한다.
