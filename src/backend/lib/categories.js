// 고정 카테고리. 배열 순서가 "고정 순서"이다.
export const CATEGORIES = {
  expense: ['식비', '카페/간식', '교통', '쇼핑', '주거/통신', '의료/건강', '문화/여가', '기타'],
  income: ['급여', '용돈', '부수입', '기타'],
};

export const TYPES = ['expense', 'income'];

// 고정 순서 인덱스 (목록에 없으면 맨 뒤)
export function categoryOrder(type, category) {
  const i = CATEGORIES[type]?.indexOf(category) ?? -1;
  return i < 0 ? 999 : i;
}
