// 인사이트 목록 (#insights): 대시보드가 보고 있는 달 기준. 기록 화면에서 옮겨 왔다.
import { api } from './api.js';
import { el, $ } from './dom.js';
import { todayLocal } from './lib/date.js';
import { buildInsightSections, INSIGHT_EMPTY_TEXT } from './lib/insight-text.js';

const errMsg = (e) => (e && e.message) || '요청을 처리하지 못했어요.';
let seq = 0;

/** month: 'YYYY-MM'. 오래된 응답은 버린다. */
export async function loadInsights(month) {
  const my = ++seq;
  const box = $('insights');
  try {
    const data = await api.insights(month, todayLocal());
    if (my !== seq) return;
    const sections = buildInsightSections(data);
    if (!sections.length) {
      box.replaceChildren(el('p', { class: 'hint' }, INSIGHT_EMPTY_TEXT));
      return;
    }
    box.replaceChildren(...sections.map((sec) => {
      const wrap = el('div', { class: `insight-section insight-${sec.key}` });
      wrap.appendChild(el('h3', {}, sec.title));
      const ul = el('ul', { class: 'insight-list' });
      for (const line of sec.lines) {
        const li = el('li', { class: line.strong ? 'insight strong' : 'insight' });
        li.appendChild(el('span', { class: 'insight-icon', 'aria-hidden': 'true' }, line.icon));
        li.appendChild(el('span', { class: 'insight-label' }, line.label));
        li.appendChild(el('span', { class: 'insight-text' }, line.text));
        ul.appendChild(li);
      }
      wrap.appendChild(ul);
      return wrap;
    }));
  } catch (e) {
    if (my === seq) box.replaceChildren(el('p', { class: 'error-text' }, errMsg(e)));
  }
}
