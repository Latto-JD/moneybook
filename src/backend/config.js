// 환경변수 해석. 호출 시점에 읽어 테스트에서 env 객체를 주입할 수 있게 한다.
export function readConfig(env = process.env) {
  return {
    cookieSecure: env.COOKIE_SECURE !== 'false',
    signupEnabled: env.SIGNUP_ENABLED !== 'false',
    appOrigins: (env.APP_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        try {
          return new URL(s).origin;
        } catch {
          return null;
        }
      })
      .filter(Boolean),
    trustProxy: env.TRUST_PROXY === 'true' || env.VERCEL === '1',
  };
}

export const MAX_BODY_BYTES = 16 * 1024;
export const SESSION_COOKIE = 'mb_sid';
export const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;
