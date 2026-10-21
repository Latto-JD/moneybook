// 헤더 사용자 표시: 이름이 있으면 이름, 없으면 이메일. title 은 항상 이메일.
export function userLabel(user) {
  const name = user && typeof user.name === 'string' ? user.name.trim() : '';
  const email = (user && user.email) || '';
  return {
    text: name || email,
    title: email,
    ariaLabel: name ? `내 정보: ${name}` : `내 정보: ${email}, 이름 설정`,
  };
}
