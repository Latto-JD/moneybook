// 카테고리 색·무늬 번호 (순수 함수). 번호 1..12 는 tokens.css 의 --viz-N, 무늬는 patterns/viz-N.svg 와 1:1.
// 서버가 카테고리마다 color(1..12)를 저장한다. 값이 없으면(null) 목록 순서로 정한다: 유형별로 비활성 포함 n번째 = ((n-1) % 12) + 1.
export const VIZ_COUNT = 12;

/** 스크린리더용 색 이름 (번호 - 1 이 인덱스). tokens.css 주석과 같은 이름·무늬 */
export const VIZ_NAMES = [
  '하늘·무늬 없음', '밤색·사선', '겨자·점', '남보라·가로줄', '청록·격자', '와인·세로줄',
  '올리브·체크', '자두·역사선', '주황·X 교차', '분홍·큰 점', '회청·지그재그', '보라·굵은 역사선',
];
export const vizName = (n) => VIZ_NAMES[n - 1] || '';

const byOrder = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name).localeCompare(String(b.name), 'ko');
export const validViz = (n) => Number.isInteger(n) && n >= 1 && n <= VIZ_COUNT;

/** GET /api/categories 의 items + 유형 -> Map(이름 -> 1..12). 저장된 color 우선, 없으면 비활성 포함 목록 순서 공식 */
export function stableVizMap(items, type) {
  const list = (Array.isArray(items) ? items : []).filter((i) => i && i.type === type && typeof i.name === 'string');
  const map = new Map();
  list.sort(byOrder).forEach((it, i) => map.set(it.name, validViz(it.color) ? it.color : (i % VIZ_COUNT) + 1));
  return map;
}

/** 목록에 없는 이름(삭제된 이름 등)만 'none' */
export const vizOf = (map, name) => (map && map.get(name)) || 'none';

/**
 * 도넛 조각의 색·무늬 번호. slices: [{label, members?}] (members 가 있으면 "그 외 N개" 묶음 = 'other').
 * 저장된 번호(map)는 다른 조각과 겹쳐도 그대로 쓴다 (다른 화면과 같은 색). 번호가 없는 조각만 남은 가장 작은 번호를 쓴다.
 */
export function assignDonutViz(slices, map) {
  const out = new Array(slices.length).fill(null);
  const used = new Set();
  slices.forEach((s, i) => {
    if (Array.isArray(s.members)) { out[i] = 'other'; return; }
    const n = map && map.get(s.label);
    if (n) { out[i] = n; used.add(n); }
  });
  slices.forEach((s, i) => {
    if (out[i] !== null) return;
    let n = 1;
    while (used.has(n) && n < VIZ_COUNT) n++;
    out[i] = n;
    used.add(n);
  });
  return out;
}
