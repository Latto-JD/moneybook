// 브라우저 수동 확인용 목업. node --test 가 실수로 로드해도 아무것도 하지 않는다.
if (typeof document !== 'undefined' && document.getElementById('chart-donut')) {
  const { renderDonut, renderGroupedBars, renderBars } = await import('../../public/js/charts.js');
  const { monthsBetween, trailingRange } = await import('../../public/js/lib/date.js');

  const categories = ['식비', '카페/간식', '교통', '쇼핑', '주거/통신', '의료/건강', '문화/여가', '기타'];
  renderDonut(document.getElementById('chart-donut'), {
    title: '카테고리 지출 비중', periodLabel: '2026년 10월',
    items: categories.map((label, i) => ({ label, value: [420000, 180000, 95000, 210000, 550000, 30000, 76000, 12000][i] })),
  });

  function draw(n) {
    const { from, to } = trailingRange('2026-10', n);
    const months = monthsBetween(from, to).map((month, i) => {
      const incomeTotal = i % 4 === 3 ? 0 : 3200000 + i * 10000;
      const expenseTotal = 1800000 + ((i * 370000) % 1400000);
      return { month, incomeTotal, expenseTotal, balance: incomeTotal - expenseTotal, count: 10 };
    });
    renderGroupedBars(document.getElementById('chart-monthly'), { title: '월별 수입 대 지출', months });
    renderBars(document.getElementById('chart-cat-trend'), {
      title: '식비 월별 추이', seriesName: '식비', months: months.map((m) => m.month),
      totals: months.map((_, i) => (i === 1 ? 0 : 300000 + i * 25000)),
    });
  }
  draw(6);
  for (const n of [6, 12]) {
    document.getElementById(`range-${n}`).addEventListener('click', () => {
      document.getElementById('range-6').setAttribute('aria-pressed', String(n === 6));
      document.getElementById('range-12').setAttribute('aria-pressed', String(n === 12));
      draw(n);
    });
  }
  renderDonut(document.getElementById('chart-empty'), { title: '빈 도넛', items: [] });
}
