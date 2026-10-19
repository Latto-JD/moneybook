// 디바운스: 마지막 호출 후 wait ms 뒤에 실행. cancel() 지원.
export function debounce(fn, wait, timers = { set: (f, ms) => setTimeout(f, ms), clear: (i) => clearTimeout(i) }) {
  let id = null;
  const debounced = (...args) => {
    if (id !== null) timers.clear(id);
    id = timers.set(() => { id = null; fn(...args); }, wait);
  };
  debounced.cancel = () => { if (id !== null) { timers.clear(id); id = null; } };
  return debounced;
}
