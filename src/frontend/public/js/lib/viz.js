// 카테고리 색·무늬 번호 (순수 함수). 번호 1..8 은 tokens.css 의 --viz-N, 무늬는 patterns/viz-N.svg 와 1:1.
// 서버에 번호를 저장하지 않으므로 목록 순서(sortOrder)로 정한다: 유형별로 비활성 포함 1~8번째 = 1..8. 9번째부터는 고정 번호 없음.
export const VIZ_COUNT = 8;

const byOrder = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name).localeCompare(String(b.name), 'ko');

/** GET /api/categories 의 items + 유형 -> Map(이름 -> 1..8). 비활성도 순위에 넣어 사용 안 함으로 바꿔도 다른 색이 밀리지 않는다. */
export function stableVizMap(items, type) {
  const list = (Array.isArray(items) ? items : []).filter((i) => i && i.type === type && typeof i.name === 'string');
  const map = new Map();
  list.sort(byOrder).slice(0, VIZ_COUNT).forEach((it, i) => map.set(it.name, i + 1));
  return map;
}

/** 목록 순서 기준 번호. 고정 번호가 없는 이름(9번째 이후, 모르는 이름)은 'none'. */
export const vizOf = (map, name) => (map && map.get(name)) || 'none';

/**
 * 도넛 조각마다 서로 다른 번호를 준다. slices: [{label, members?}] (members 가 있으면 "그 외 N개" 묶음).
 * 고정 번호(map)가 있고 겹치지 않으면 그것을, 없으면 남은 번호 중 가장 작은 것을 쓴다. 묶음은 'other'.
 */
export function assignDonutViz(slices, map) {
  const out = new Array(slices.length).fill(null);
  const used = new Set();
  slices.forEach((s, i) => {
    if (Array.isArray(s.members)) { out[i] = 'other'; return; }
    const n = map && map.get(s.label);
    if (n && !used.has(n)) { out[i] = n; used.add(n); }
  });
  slices.forEach((s, i) => {
    if (out[i] !== null) return;
    let n = 1;
    while (used.has(n) && n < VIZ_COUNT) n++;
    out[i] = n; // 일반 조각은 최대 8개라 항상 남는다. 넘치면 마지막 번호를 재사용
    used.add(n);
  });
  return out;
}
