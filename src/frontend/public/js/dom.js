// DOM 헬퍼. 사용자 데이터는 항상 textContent 로만 넣는다 (innerHTML 미사용).
export function el(tag, attrs, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

export const $ = (id) => document.getElementById(id);

/** 칩 버튼이 든 li */
export function chipItem(label, { pressed, onClick, ariaLabel } = {}) {
  const li = el('li');
  const b = el('button', { type: 'button', class: 'chip' }, label);
  if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
  if (ariaLabel) b.setAttribute('aria-label', ariaLabel);
  if (onClick) b.addEventListener('click', onClick);
  li.appendChild(b);
  return li;
}

/** render() 로 container 안의 버튼을 다시 그려도 키보드 포커스가 유지되게 한다 (같은 순번 버튼에 복원). */
export function keepFocus(container, render) {
  const buttons = [...container.querySelectorAll('button')];
  const idx = buttons.indexOf(document.activeElement);
  render();
  if (idx >= 0) {
    const next = container.querySelectorAll('button')[idx];
    if (next) next.focus();
  }
}
