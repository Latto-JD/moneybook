// DOM 헬퍼. 사용자 데이터는 항상 textContent 로만 넣는다 (innerHTML 미사용).
export function el(tag, attrs, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

export const $ = (id) => document.getElementById(id);

/** 색·무늬 견본 (장식). viz: 1..8 | 'other' | 'none'. size: 'lg' 면 28px */
export function swatch(viz, size) {
  return el('span', { class: size === 'lg' ? 'swatch swatch--lg' : 'swatch', 'data-viz': String(viz), 'aria-hidden': 'true' });
}

/**
 * 칩 버튼이 든 li. 버튼의 접근 이름·textContent 는 label 그대로 (견본·체크는 빈 장식 span).
 * viz 가 있으면 앞에 색·무늬 견본, pressed 가 정의되어 있으면 선택 시 보이는 ✓ 아이콘.
 */
export function chipItem(label, { pressed, onClick, ariaLabel, viz } = {}) {
  const li = el('li');
  const b = el('button', { type: 'button', class: 'chip' });
  if (viz !== undefined) b.appendChild(swatch(viz));
  if (pressed !== undefined) b.appendChild(el('span', { class: 'icon icon--check', 'aria-hidden': 'true' }));
  b.appendChild(document.createTextNode(label));
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
