// 카테고리 사용 이력의 순수 로직: 정렬 정의, 월 묶음, 날짜 표기, 쪽 이어 붙이기 상태(스토어).
// DOM 을 쓰지 않아 Node 에서 단위 테스트한다. fetchPage 는 주입한다.
import { isValidDate, monthOf } from './date.js';

export const PAGE_SIZE = 30;
export const DEFAULT_SORT = 'date_desc';
export const SORTS = ['date_desc', 'date_asc', 'amount_desc', 'amount_asc'];
export const SORT_LABEL = {
  date_desc: '최신순', date_asc: '오래된순', amount_desc: '금액 큰순', amount_asc: '금액 작은순',
};

/** 날짜순(월 묶음 + 월 소계)이면 true, 금액순(평평한 목록)이면 false */
export const isDateSort = (sort) => sort === 'date_desc' || sort === 'date_asc';

const WEEKDAY = '일월화수목금토';
const parts = (date) => date.split('-').map(Number);
const weekdayOf = (date) => { const [y, m, d] = parts(date); return WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; };

/** 행 날짜: 날짜순 "10월 28일 (화)", 금액순(여러 해가 섞임) "2026년 3월 2일 (월)". 잘못된 날짜면 원문 */
export function rowDateLabel(date, sort) {
  if (!isValidDate(date)) return String(date);
  const [y, m, d] = parts(date);
  const base = `${m}월 ${d}일 (${weekdayOf(date)})`;
  return isDateSort(sort) ? base : `${y}년 ${base}`;
}

/** 기간 표기 "2026년 3월 2일 ~ 2026년 10월 28일", 같은 날이면 한 날짜, 없으면 '' */
export function periodLabel(first, last) {
  const f = (s) => { if (!isValidDate(s)) return ''; const [y, m, d] = parts(s); return `${y}년 ${m}월 ${d}일`; };
  if (!first || !last) return '';
  return first === last ? f(first) : `${f(first)} ~ ${f(last)}`;
}

/**
 * 날짜순 거래를 월별로 묶는다. 입력 순서(서버가 정렬한 순서)를 그대로 지키고, 연속한 같은 달은 한 묶음이다.
 * 월 소계(total, count)는 불러온 행이 아니라 응답의 months 값을 쓴다 (쪽 나눔으로 일부만 불러와도 그 달 전체).
 * months 에 없는 달이면 total/count 는 null.
 * 반환: [{ month, total, count, items }]
 */
export function groupByMonth(txs, months) {
  const info = new Map((Array.isArray(months) ? months : []).map((m) => [m.month, m]));
  const groups = [];
  for (const t of Array.isArray(txs) ? txs : []) {
    const month = monthOf(t.date);
    let g = groups[groups.length - 1];
    if (!g || g.month !== month) {
      const m = info.get(month);
      g = { month, total: m ? m.total : null, count: m ? m.count : null, items: [] };
      groups.push(g);
    }
    g.items.push(t);
  }
  return groups;
}

/** 화면 모양: 날짜순은 { mode: 'grouped', groups }, 금액순은 { mode: 'flat', items } */
export function listView(sort, txs, months) {
  return isDateSort(sort)
    ? { mode: 'grouped', groups: groupByMonth(txs, months) }
    : { mode: 'flat', items: Array.isArray(txs) ? txs : [] };
}

/** 정렬을 바꾸고 첫 쪽을 받았을 때 알림 문구 */
export const sortAnnounce = (sort, count) => `${SORT_LABEL[sort]}으로 정렬했어요. ${count}건`;
/** 더 보기 알림 문구 */
export const moreAnnounce = (added, loaded, count) => `${added}건 더 불러왔어요. ${count}건 중 ${loaded}건`;
/** 더 보기 버튼 글자 */
export const moreLabel = (loaded, count) => `더 보기 (${loaded}/${count})`;
/** 목록 카드의 숨김 캡션 */
export const listCaption = (sort, loaded, count) => `${SORT_LABEL[sort]}, ${count}건 중 ${loaded}건`;

/**
 * 이력 스토어. 선택(type, category), 정렬, 불러온 거래, 커서를 가진다.
 * - 정렬을 바꾸면 커서 없이 처음부터 다시 받고, 진행 중이던 요청의 응답은 순번(seq)으로 버린다.
 * - 커서는 받은 정렬(cursorSort)과 함께 보관해 다른 정렬로 보내지 않는다.
 * fetchPage({ type, category, sort, cursor, limit }) -> 응답. 상태가 바뀔 때마다 onChange(state, event) 를 부른다.
 */
export function createHistoryStore(fetchPage, onChange = () => {}) {
  let seq = 0;
  const fresh = () => ({
    sel: null, sort: DEFAULT_SORT,
    status: 'idle', error: '', // 첫 쪽: idle | loading | ready | error
    moreStatus: 'idle', moreError: '', // 더 보기: idle | loading | error
    summary: null, // { total, count, firstDate, lastDate, months }
    txs: [], nextCursor: null, cursorSort: null,
  });
  const state = fresh();
  const emit = (event) => onChange(state, event);
  const errText = (e) => (e && e.message) || '요청을 처리하지 못했어요.';
  const summaryOf = (r) => ({
    total: r.total ?? 0, count: r.count ?? 0, firstDate: r.firstDate ?? null, lastDate: r.lastDate ?? null, months: Array.isArray(r.months) ? r.months : [],
  });

  function clearList() {
    state.txs = []; state.nextCursor = null; state.cursorSort = null;
    state.moreStatus = 'idle'; state.moreError = '';
  }

  /** 첫 쪽(커서 없음)을 지금 정렬로 받는다 */
  async function load(event = 'load') {
    const my = ++seq;
    const { sel, sort } = state;
    clearList();
    state.status = 'loading'; state.error = '';
    emit('loading');
    try {
      const r = await fetchPage({ type: sel.type, category: sel.category, sort, cursor: undefined, limit: PAGE_SIZE });
      if (my !== seq) return false;
      state.summary = summaryOf(r);
      state.txs = Array.isArray(r.transactions) ? r.transactions.slice() : [];
      state.nextCursor = r.nextCursor || null;
      state.cursorSort = state.nextCursor ? sort : null;
      state.status = 'ready';
      emit(event);
      return true;
    } catch (e) {
      if (my !== seq) return false;
      state.status = 'error'; state.error = errText(e);
      emit('error');
      return false;
    }
  }

  return {
    state,
    /** 이력을 새로 연다: 정렬은 최신순으로 되돌린다 (선택한 정렬은 저장하지 않는다) */
    open(sel) {
      seq++;
      Object.assign(state, fresh(), { sel: { type: sel.type, category: sel.category } });
      return load('open');
    },
    /** 첫 쪽 다시 시도: 지금 눌린 정렬로 */
    retry() { return state.sel ? load('retry') : Promise.resolve(false); },
    /** 정렬 변경: 같은 정렬이면 아무 일도 없다. 커서 없이 처음부터 */
    setSort(sort) {
      if (!state.sel || !SORTS.includes(sort) || sort === state.sort) return Promise.resolve(false);
      state.sort = sort;
      return load('sort');
    },
    /** 다음 쪽을 이어 붙인다. 커서를 받은 정렬이 지금 정렬과 다르면 보내지 않는다 */
    async more() {
      if (!state.sel || state.status !== 'ready' || state.moreStatus === 'loading') return false;
      if (!state.nextCursor || state.cursorSort !== state.sort) return false;
      const my = ++seq;
      const { sel, sort, nextCursor } = state;
      state.moreStatus = 'loading'; state.moreError = '';
      emit('more-loading');
      try {
        const r = await fetchPage({ type: sel.type, category: sel.category, sort, cursor: nextCursor, limit: PAGE_SIZE });
        if (my !== seq) return false;
        const seen = new Set(state.txs.map((t) => t.id));
        const added = (Array.isArray(r.transactions) ? r.transactions : []).filter((t) => !seen.has(t.id));
        state.txs = state.txs.concat(added);
        state.summary = summaryOf(r);
        state.nextCursor = r.nextCursor || null;
        state.cursorSort = state.nextCursor ? sort : null;
        state.moreStatus = 'idle';
        state.added = added.length;
        emit('more');
        return true;
      } catch (e) {
        if (my !== seq) return false;
        state.moreStatus = 'error'; state.moreError = errText(e);
        emit('more-error');
        return false;
      }
    },
    /** 진행 중인 응답을 모두 버린다 (패널을 나갈 때) */
    invalidate() { seq++; },
    /** 선택을 지운다 */
    clear() { seq++; Object.assign(state, fresh()); },
  };
}
