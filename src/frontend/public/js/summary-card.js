// 요약 카드 (기록·대시보드 공용): 남은 돈 한 줄 + 구분선 + 수입 | 지출 2열.
// 금액은 한 글자도 나뉘지 않는다(nowrap). 모자라면 라벨 아래 줄로 내려가 오른쪽 정렬된다.
import { el } from './dom.js';
import { formatWon, formatBalanceWon } from './lib/money.js';
import { amountAria } from './lib/summary-data.js';

/**
 * container 안을 다시 그린다.
 * opts: { balanceLabel, income, expense, balance, prefix(aria 앞말, 예 '이번 달'), rate?: {text}, notes?: { income, expense } }
 * notes.income / notes.expense: { text, cls } 열 아래 보조 글자(대시보드 전월 대비)
 */
export function renderSummaryCard(container, opts) {
  const { balanceLabel, income, expense, balance, prefix = '', rate = null, notes = null } = opts;
  const nodes = [];
  const bal = el('div', { class: 'sum-balance' });
  bal.appendChild(el('span', { class: 'sum-balance__label' }, balanceLabel));
  bal.appendChild(el('span', { class: 'sum-balance__value figure' }, formatBalanceWon(balance)));
  nodes.push(bal);
  if (rate) nodes.push(el('p', { class: 'balance-rate' }, rate.text));
  nodes.push(el('div', { class: 'sum-divider', 'aria-hidden': 'true' }));
  const col = (kind, label, value, note) => {
    const c = el('div', { class: `sum-col sum-col--${kind}` });
    const line = el('div', { class: 'sum-line' });
    const head = el('span', { class: `sum-label amt-${kind}` });
    head.appendChild(el('span', { class: `icon icon--${kind}`, 'aria-hidden': 'true' }));
    head.appendChild(document.createTextNode(label));
    line.appendChild(head);
    line.appendChild(el('span', {
      class: `sum-amount figure amt-${kind}`, 'aria-label': amountAria(prefix, label, formatWon(value)),
    }, formatWon(value)));
    c.appendChild(line);
    if (note) c.appendChild(el('div', { class: `kpi-extra ${note.cls || 'muted'}` }, note.text));
    return c;
  };
  const pair = el('div', { class: 'sum-pair' });
  pair.appendChild(col('income', '수입', income, notes && notes.income));
  pair.appendChild(col('expense', '지출', expense, notes && notes.expense));
  nodes.push(pair);
  container.replaceChildren(...nodes);
}
