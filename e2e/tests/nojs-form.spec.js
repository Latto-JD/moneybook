// R5/재검증: JS 로드 전(또는 JS 실패) 폼 제출 시 비밀번호가 URL(GET 쿼리)에 남지 않아야 한다 (form method=post).
import { test, expect } from '@playwright/test';

const PW_MARKER = 'NoJsPw-Marker-12345';
const EMAIL = 'nojs-marker@example.com';

async function submitWithoutScripts(browser, path, fill) {
  const ctx = await browser.newContext({ javaScriptEnabled: false, extraHTTPHeaders: { 'x-forwarded-for': `10.88.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` } });
  const page = await ctx.newPage();
  const urls = [];
  page.on('request', (r) => urls.push(`${r.method()} ${r.url()}`));
  await page.goto(path);
  await fill(page);
  await Promise.all([page.waitForLoadState('load'), page.keyboard.press('Enter')]).catch(() => {});
  await page.waitForTimeout(500);
  const finalUrl = page.url();
  await ctx.close();
  return { finalUrl, urls };
}

test.describe('폼 method=post (JS 없이 제출)', () => {
  test('login.html: 비밀번호/이메일이 URL 에 없다, 요청 메서드는 POST', async ({ browser }) => {
    const { finalUrl, urls } = await submitWithoutScripts(browser, '/login.html', async (p) => {
      await p.fill('#email', EMAIL);
      await p.fill('#password', PW_MARKER);
    });
    expect(finalUrl).not.toContain(PW_MARKER);
    expect(finalUrl).not.toContain('password');
    expect(urls.join('\n')).not.toContain(PW_MARKER);
    expect(urls.some((u) => u.startsWith('POST '))).toBe(true);
  });

  test('index.html(기록 폼): 입력값이 URL 에 없다', async ({ browser }) => {
    const { finalUrl, urls } = await submitWithoutScripts(browser, '/', async (p) => {
      // 비로그인이면 JS 없이는 리다이렉트가 안 되므로 그대로 index.html 이 열린다.
      await p.fill('#amount', '77777');
    });
    expect(finalUrl).not.toContain('77777');
    expect(urls.join('\n')).not.toContain('77777');
  });
});
