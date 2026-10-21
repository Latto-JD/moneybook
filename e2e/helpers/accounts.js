let seq = 0;

/** 고유 테스트 계정 이메일: qa+<타임스탬프>[-n]@example.com */
export function uniqueEmail(tag = '') {
  seq += 1;
  const ts = Date.now();
  return `qa+${ts}${tag ? '-' + tag : ''}-${seq}@example.com`;
}

export const PASSWORD = 'QaPassw0rd!';
export const DEFAULT_NAME = '큐에이 테스터';

export function newAccount(tag = '') {
  return { email: uniqueEmail(tag), password: PASSWORD, name: DEFAULT_NAME };
}
