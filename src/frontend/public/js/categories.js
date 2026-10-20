// 카테고리 상태: GET /api/categories 를 한 번 받아 두고, 바뀔 때마다 'categorieschanged' 를 발행한다.
// detail: { renamed: {type, from, to} | null, dataChanged: boolean } (이름 변경/사용 안 함은 거래·집계 표시도 바뀐다)
import { api } from './api.js';
import { activeNamesOf } from './lib/categories-data.js';

const store = { status: 'loading', resp: null, error: '' }; // status: loading | ready | error
let inflight = null;

export const categoryStatus = () => store.status;
export const categoryError = () => store.error;
export const categoryResponse = () => store.resp;
/** { expense: string[], income: string[] } 활성 이름. 로드 전/실패 시 빈 목록 */
export const activeCategories = () => activeNamesOf(store.resp);

export function emitCategoriesChanged(detail = {}) {
  document.dispatchEvent(new CustomEvent('categorieschanged', {
    detail: { renamed: null, dataChanged: false, ...detail },
  }));
}

/** 서버에서 다시 받는다. 동시에 여러 번 불러도 요청은 하나. detail 은 이벤트에 그대로 실린다. */
export function loadCategories(detail = {}) {
  // 진행 중인 요청은 변경 전 데이터일 수 있으니 끝난 뒤 한 번 더 받는다
  if (inflight) return inflight.then(() => loadCategories(detail));
  if (!store.resp) store.status = 'loading';
  inflight = (async () => {
    try {
      store.resp = await api.categories();
      store.status = 'ready';
      store.error = '';
    } catch (e) {
      store.status = 'error';
      store.error = (e && e.message) || '카테고리를 불러오지 못했어요.';
    } finally {
      inflight = null;
    }
    emitCategoriesChanged(detail);
    return store.status === 'ready';
  })();
  return inflight;
}
